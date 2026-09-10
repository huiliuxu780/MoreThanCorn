"""自动任务后台闭环（审核 P0-4）：无人读取也生效的准入/回写/对账/轮询。

30s 周期 daemon 线程（dev 嵌入；生产独立进程部署同函数）：
1. Schedule 触发回写：运行时 schedule sessions → AgentSessionIndex + 触发日志；
2. max_runs 准入：达限即停运行时 Schedule（不依赖用户读取历史）；
3. Workflow/AgentFlow 触发日志终态对账；
4. polling 数据源定时 tick（游标/去重/死信在 ingest 内）；
5. P0-B（09-10）：v2 一次性运行 Run（running+session）按真实 Session 状态结算。

P0-6 修复：PG advisory lock 保证多进程仅一个 watcher 执行；SessionIndex 回写
补齐 runtime_agent_id + release_id；max_runs 仍为 30s 反应式（非原子触发门——
AgentScope Schedule 原生无 max_runs，此为准入门补丁）。
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from . import agentscope_client as rt
from .db import SessionLocal
from .models import (
    AgentFlowRun,
    AgentSessionIndex,
    AutomationDefinition,
    AutomationTriggerLog,
    DataSource,
    Release,
    Run,
)

log = logging.getLogger("mtc.automation_watcher")
INTERVAL = 30.0
WATCHER_LOCK_ID = 614912839


def _try_acquire_watcher_lock(db: Session) -> bool:
    """PG advisory lock：多进程部署时只有 holder 执行 reconcile_once。"""
    try:
        locked = db.execute(
            text(f"SELECT pg_try_advisory_lock({WATCHER_LOCK_ID})")
        ).scalar()
        return bool(locked)
    except Exception:
        return False


def _release_watcher_lock(db: Session) -> None:
    try:
        db.execute(text(f"SELECT pg_advisory_unlock({WATCHER_LOCK_ID})"))
    except Exception:
        pass


def reconcile_once(db: Session) -> dict:
    """P0-6：PG advisory lock — 多进程仅一个 watcher 执行。

    P0-09 修复（锁泄漏）：advisory lock 绑定的是 DBAPI 连接，而 ORM Session
    在 _reconcile_impl 内部 commit 后会把连接放回池、后续 execute 换连接——
    旧实现 unlock 落在另一条连接上静默失败，锁泄漏在池化连接里：跨进程时
    其他 watcher 永远拿不到锁（单例保证被破坏），测试进程内表现为后续
    "首次获取"偶发失败。锁生命周期改为专用 raw connection，与 ORM 事务解耦。
    """
    from .db import engine

    with engine.connect() as lock_conn:
        locked = lock_conn.execute(
            text(f"SELECT pg_try_advisory_lock({WATCHER_LOCK_ID})")
        ).scalar()
        if not locked:
            return {"skipped": True, "reason": "not the leader"}
        try:
            return _reconcile_impl(db)
        finally:
            lock_conn.execute(
                text(f"SELECT pg_advisory_unlock({WATCHER_LOCK_ID})")
            )


def _reconcile_impl(db: Session) -> dict:
    stats = {"sessions": 0, "logs": 0, "schedules_stopped": 0, "polls": 0,
             "runs_settled": 0}
    autos = db.query(AutomationDefinition).filter_by(enabled=True).all()
    for auto in autos:
        uid = auto.created_by or "dev"
        # 1+2: schedule sessions 回写与准入
        if auto.runtime_schedule_id:
            try:
                sessions = rt.schedule_sessions(uid, auto.runtime_schedule_id)
            except rt.RuntimeError_:
                sessions = []
            known = {
                r.session_id
                for r in db.query(AgentSessionIndex).filter_by(
                    automation_id=auto.id, trigger_kind="schedule"
                ).all()
            }
            # P0-6: resolve runtime_agent_id / release_id for schedule sessions
            runtime_agent_id = None
            release_id = None
            if auto.agent_id:
                rel = (
                    db.query(Release)
                    .filter_by(agent_id=auto.agent_id, status="active")
                    .order_by(Release.created_at.desc())
                    .first()
                )
                if rel:
                    release_id = rel.id
                    runtime_agent_id = (rel.runtime_binding_snapshot or {}).get(
                        "agentscope_agent_id"
                    )
            for s in sessions:
                sid = s.get("session_id")
                if not sid or sid in known:
                    continue
                db.add(
                    AgentSessionIndex(
                        session_id=sid,
                        user_id=uid,
                        agent_id=auto.agent_id or "",
                        runtime_agent_id=runtime_agent_id,
                        release_id=release_id,
                        trigger_kind="schedule",
                        automation_id=auto.id,
                    )
                )
                db.add(
                    AutomationTriggerLog(
                        automation_id=auto.id,
                        source="schedule",
                        status="running",
                        session_id=sid,
                    )
                )
                stats["sessions"] += 1
            db.commit()
            auto.auto_run_count = len(sessions)
            if sessions:
                latest = max(sessions, key=lambda x: x.get("created_at", ""))
                if latest.get("created_at"):
                    auto.last_auto_fire_at = datetime.fromisoformat(
                        latest["created_at"].replace("Z", "+00:00")
                    )
            if auto.max_runs is not None and auto.auto_run_count >= auto.max_runs:
                try:
                    rt.patch_schedule(uid, auto.runtime_schedule_id, enabled=False)
                    stats["schedules_stopped"] += 1
                except rt.RuntimeError_:
                    pass
            db.commit()
        # 3: 触发日志终态对账（schedule/api/event + workflow/agentflow）
        running = (
            db.query(AutomationTriggerLog)
            .filter_by(automation_id=auto.id, status="running")
            .all()
        )
        for l in running:
            terminal = None
            if l.session_id:
                idx = (
                    db.query(AgentSessionIndex).filter_by(session_id=l.session_id).first()
                )
                runtime_id = idx.runtime_agent_id if idx else None
                # P0-6: runtime_agent_id 缺失时回退到 Release 快照
                if not runtime_id and idx and idx.agent_id:
                    rel = (
                        db.query(Release)
                        .filter_by(agent_id=idx.agent_id, status="active")
                        .order_by(Release.created_at.desc())
                        .first()
                    )
                    if rel:
                        runtime_id = (rel.runtime_binding_snapshot or {}).get(
                            "agentscope_agent_id"
                        )
                if runtime_id:
                    try:
                        st = rt.session_status(uid, runtime_id, l.session_id)
                        if st.get("status") != "running":
                            terminal = (
                                "failed"
                                if st.get("last_error")
                                else "completed"
                            )
                    except rt.RuntimeError_:
                        terminal = None
            elif l.workflow_run_id:
                run = db.get(Run, l.workflow_run_id)
                if run and run.status in ("succeeded", "failed", "cancelled"):
                    terminal = "completed" if run.status == "succeeded" else "failed"
            elif l.agentflow_run_id:
                fr = db.get(AgentFlowRun, l.agentflow_run_id)
                if fr and fr.status in ("succeeded", "failed", "cancelled"):
                    terminal = "completed" if fr.status == "succeeded" else "failed"
            if terminal:
                l.status = terminal
                stats["logs"] += 1
        db.commit()
    # 4: polling 源定时 tick
    from .routers.as_automations import tick_poll_source

    for src in db.query(DataSource).filter_by(kind="polling", status="active").all():
        interval = float((src.config or {}).get("interval_seconds", 0) or 0)
        if interval <= 0:
            continue
        last = src.last_poll_at
        now = datetime.now(timezone.utc)
        if last is None or (now - last).total_seconds() >= interval:
            try:
                tick_poll_source(db, src)
                stats["polls"] += 1
            except Exception:  # noqa: BLE001
                log.exception("poll tick failed source=%s", src.id)
    db.commit()
    # 5: P0-B 一次性运行 Run 结算（v2 single-run 异步路径）——
    #    status=running 且带 agentscope_session_id、非批次（task_run_id 为空）
    #    的 Run，按真实 Session 状态结算终态；输出取会话最后一条已完成
    #    assistant 消息（拿不到就空串，不伪造）。
    running_runs = (
        db.query(Run)
        .filter(Run.status == "running",
                Run.task_run_id.is_(None),
                Run.agentscope_session_id.isnot(None))
        .order_by(Run.created_at.asc())
        .limit(50)
        .all()
    )
    for run in running_runs:
        idx = (
            db.query(AgentSessionIndex)
            .filter_by(session_id=run.agentscope_session_id)
            .first()
        )
        if not idx or not idx.runtime_agent_id:
            continue
        try:
            st = rt.session_status(idx.user_id, idx.runtime_agent_id,
                                   run.agentscope_session_id)
        except rt.RuntimeError_:
            continue
        if st.get("status") == "running":
            continue
        now = datetime.now(timezone.utc)
        if st.get("last_error"):
            run.status = "failed"
            run.error = {"message": str(st.get("last_error"))}
        else:
            text_out = ""
            try:
                msgs = rt.session_messages(
                    idx.user_id, idx.runtime_agent_id, run.agentscope_session_id
                ).get("messages", [])
                done = [m for m in msgs
                        if m.get("role") == "assistant" and m.get("finished_reason")]
                if done:
                    text_out = "".join(
                        b.get("text", "") for b in done[-1].get("content", [])
                        if isinstance(b, dict)
                    )
            except rt.RuntimeError_:
                pass
            run.status = "succeeded"
            run.output = {"content": text_out}
        run.ended_at = now
        if run.started_at:
            run.duration_ms = int((now - run.started_at).total_seconds() * 1000)
        stats["runs_settled"] += 1
    db.commit()
    return stats


def watcher_loop() -> None:
    while True:
        db = SessionLocal()
        try:
            reconcile_once(db)
        except Exception:  # noqa: BLE001
            log.exception("automation watcher cycle failed")
        finally:
            db.close()
        time.sleep(INTERVAL)


def start_watcher() -> threading.Thread:
    t = threading.Thread(target=watcher_loop, name="mtc-automation-watcher", daemon=True)
    t.start()
    return t
