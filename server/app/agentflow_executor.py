"""AgentFlow 控制面编排（审核 P0-1 返工版）。

执行 = 运行时官方 PipelineProtocol 实现（/mtc/flow-run：ChatService 节点执行 +
structured_run_core + GoalPipeline）。本模块只做：
- Release/版本解析与节点运行时绑定；
- 单次 flow-run 调用（无轮询、无 sleep）；
- 控制面记录（run/node_run/Session 索引）；
- 选择性重跑：计算目标节点+下游 stale 集合，以上游最新成功输出为输入重执行，
  并重算 Flow 总输出与终态。
"""
from __future__ import annotations

import ast as _ast_mod
import hashlib
import secrets as _secrets
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from . import agent_execution as ex
from . import agentscope_client as rt
from .models import (
    Agent,
    AgentFlowNodeRun,
    AgentFlowRelease,
    AgentFlowRun,
    AgentFlowVersion,
    AgentSessionIndex,
    AutomationDefinition,
)


def resolve_agentflow_release(
    db: Session,
    *,
    release_id: str | None = None,
    definition_id: str | None = None,
    environment: str | None = None,
) -> AgentFlowRelease:
    """THE one AgentFlow release resolution (P0-05).

    Manual runs, automations and agent Tool callbacks all resolve through
    this function.  ``definition_id`` walks the correct chain
    definition → AgentFlowVersion → active AgentFlowRelease — it is NEVER
    treated as a version id.  ``environment`` filters when given (flow
    releases currently publish to sandbox by default, so it stays optional
    until the product defines flow environments).
    """
    if release_id:
        release = db.get(AgentFlowRelease, release_id)
        if release is None or release.status != "active":
            raise ValueError(
                f"agentflow release {release_id} not found or not active"
            )
        return release
    if not definition_id:
        raise ValueError("release_id or definition_id required")
    query = (
        db.query(AgentFlowRelease)
        .join(AgentFlowVersion, AgentFlowVersion.id == AgentFlowRelease.version_id)
        .filter(
            AgentFlowVersion.definition_id == definition_id,
            AgentFlowRelease.status == "active",
        )
    )
    if environment:
        query = query.filter(AgentFlowRelease.environment == environment)
    release = query.order_by(AgentFlowRelease.created_at.desc()).first()
    if release is None:
        raise ValueError(
            f"agentflow definition {definition_id} has no active release"
            + (f" in environment {environment}" if environment else "")
        )
    return release


def script_projection(script: str) -> tuple[list[dict], list[dict]]:
    """ast 解析 run() 体生成画布投影与调用点（16号稿 §9，保存时固化）。

    返回 (projection, callSites)：
    - projection: [{type:"phase", title, line, items:[{type:"worker"|"ask_user"|"log",
      label, line} | {type:"parallel", label, line, items:[worker...]}]}]
    - callSites: [{primitive, label, line, column}]（点击卡片跳行用）。"""
    import ast as _ast

    tree = _ast.parse(script)
    run_fn = next(
        (n for n in tree.body if isinstance(n, _ast_mod.AsyncFunctionDef) and n.name == "run"),
        None,
    )
    if run_fn is None:
        raise ValueError("script must define `async def run(ctx)`")

    def _name(call: _ast_mod.Call) -> str | None:
        return getattr(call.func, "id", None) or getattr(call.func, "attr", None)

    calls = [n for n in _ast_mod.walk(run_fn)
             if isinstance(n, _ast_mod.Call) and _name(n) in ("phase", "log", "worker", "askUser", "parallel")]
    parallel_spans = [(c.lineno, (c.end_lineno or c.lineno)) for c in calls if _name(c) == "parallel"]

    def _in_parallel(call: _ast_mod.Call) -> bool:
        return any(a <= call.lineno <= b for a, b in parallel_spans)

    def _label_kw(call: _ast_mod.Call) -> str | None:
        for kw in call.keywords:
            if kw.arg == "label" and isinstance(kw.value, _ast_mod.Constant) and isinstance(kw.value.value, str):
                return kw.value.value
        return None

    phases: list[dict] = []
    call_sites: list[dict] = []
    current: dict | None = None
    open_parallel: dict | None = None
    seq = 0
    for call in sorted(calls, key=lambda c: (c.lineno, c.col_offset)):
        name = _name(call)
        if name == "phase":
            title = None
            if call.args and isinstance(call.args[0], _ast_mod.Constant) and isinstance(call.args[0].value, str):
                title = call.args[0].value
            current = {"type": "phase", "title": title or f"阶段{len(phases) + 1}",
                       "line": call.lineno, "items": []}
            phases.append(current)
            open_parallel = None
            call_sites.append({"primitive": "phase", "label": current["title"],
                               "line": call.lineno, "column": call.col_offset})
            continue
        if current is None:
            current = {"type": "phase", "title": "开始", "line": call.lineno, "items": []}
            phases.append(current)
        seq += 1
        if name == "parallel":
            open_parallel = {"type": "parallel", "label": f"并行组 {seq}", "line": call.lineno, "items": []}
            current["items"].append(open_parallel)
            call_sites.append({"primitive": "parallel", "label": open_parallel["label"],
                               "line": call.lineno, "column": call.col_offset})
            continue
        if _in_parallel(call) and open_parallel is not None:
            container: dict = open_parallel
        else:
            container = current
            if name != "worker":
                open_parallel = None
        if name == "worker":
            label = _label_kw(call) or f"w{seq}"
        elif name == "askUser":
            label = _label_kw(call) or f"确认 {seq}"
        elif name == "log":
            label = "log"
        else:  # pragma: no cover
            continue
        container["items"].append({"type": name if name != "askUser" else "ask_user",
                                   "label": label, "line": call.lineno})
        call_sites.append({"primitive": name, "label": label,
                           "line": call.lineno, "column": call.col_offset})
    return phases, call_sites


def scan_script_wakers(script: str) -> list[str]:
    """ast 静态扫描脚本中 worker(waker="...") 的常量实参（16号稿 §4，保存/运行前置）。"""
    import ast as _ast

    try:
        tree = _ast.parse(script)
    except SyntaxError as exc:
        raise ValueError(f"script syntax error: {exc}") from exc
    ids: list[str] = []
    for node in _ast.walk(tree):
        if not isinstance(node, _ast.Call):
            continue
        name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
        if name != "worker":
            continue
        for kw in node.keywords:
            if (
                kw.arg == "waker"
                and isinstance(kw.value, _ast.Constant)
                and isinstance(kw.value.value, str)
                and kw.value.value not in ids
            ):
                ids.append(kw.value.value)
    return ids


def validate_script_definition(db: Session, definition: dict) -> None:
    """脚本形态版本保存校验（16号稿 §4 契约）：可解析/run 入口/waker 可解析/大小上限。"""
    script = definition.get("script") or ""
    if not script:
        raise ValueError("script definition requires `script`")
    if len(script) > 64 * 1024:
        raise ValueError(f"script too large: {len(script)} > 65536")
    waker_ids = scan_script_wakers(script)  # 语法错误在此抛 ValueError
    has_run = any(
        isinstance(n, _ast_mod.AsyncFunctionDef) and n.name == "run"
        for n in _ast_mod.walk(_ast_mod.parse(script))
    )
    if not has_run:
        raise ValueError("script must define `async def run(ctx)`")
    meta = definition.get("meta") or {}
    if not isinstance(meta, dict):
        raise ValueError("script meta must be an object")
    for key in ("inputSchema", "outputSchema"):
        if key in meta and not isinstance(meta[key], dict):
            raise ValueError(f"script meta.{key} must be an object")
    scope = meta.get("scope_agent_id")
    if scope and scope not in waker_ids:
        waker_ids.append(scope)
    for wid in waker_ids:
        if db.get(Agent, wid) is None:
            raise ValueError(f"script waker {wid} not found")


def build_script_body(
    db: Session,
    uid: str,
    definition: dict,
    flow_input: dict,
) -> dict:
    """脚本形态 body（16号稿 §6）：每个 waker 预解析运行时绑定，缺绑定即失败。"""
    script = definition.get("script") or ""
    meta = definition.get("meta") or {}
    waker_ids = scan_script_wakers(script)
    scope = meta.get("scope_agent_id")
    if scope and scope not in waker_ids:
        waker_ids.append(scope)
    wakers: dict[str, dict] = {}
    for wid in waker_ids:
        if not wid:
            continue
        if db.get(Agent, wid) is None:
            raise ValueError(f"script waker {wid} not found")
        runtime_id, extra = _node_runtime_binding(db, uid, wid)
        wakers[wid] = {
            "runtime_agent_id": runtime_id,
            "chat_model_config": extra["chat_model_config"],
            "knowledge_ids": extra["knowledge_ids"],
        }
    if not wakers:
        raise ValueError("script declares no resolvable waker")
    return {
        "user_id": uid,
        "script": script,
        "wakers": wakers,
        "flow_input": flow_input,
        "deadline_seconds": float(meta.get("deadline_seconds") or 600),
    }


def _topo_order(node_ids: list[str], edges: list[dict]) -> list[str]:
    indeg = {i: 0 for i in node_ids}
    adj: dict[str, list[str]] = {i: [] for i in node_ids}
    for e in edges:
        if e.get("from") in adj and e.get("to") in indeg:
            adj[e["from"]].append(e["to"])
            indeg[e["to"]] += 1
    queue = [i for i in node_ids if indeg[i] == 0]
    order: list[str] = []
    while queue:
        cur = queue.pop(0)
        order.append(cur)
        for nxt in adj[cur]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
    return order


def _downstream(node_id: str, edges: list[dict]) -> set[str]:
    adj: dict[str, list[str]] = {}
    for e in edges:
        adj.setdefault(e.get("from", ""), []).append(e.get("to", ""))
    seen: set[str] = set()
    stack = [node_id]
    while stack:
        cur = stack.pop()
        for nxt in adj.get(cur, []):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return seen


def _node_runtime_binding(db: Session, uid: str, agent_id: str) -> tuple[str, dict]:
    agent = db.get(Agent, agent_id)
    if agent is None:
        raise ValueError(f"node agent {agent_id} not found")
    runtime_id, release = ex.resolve_runtime_agent(db, uid, agent, environment="prod")
    # P0-02: AgentFlow nodes use the SAME release-snapshot model resolution as
    # chat/fresh run/schedule — no live-default drift.
    model_cfg = ex.chat_model_config_for_release(db, uid, release)
    manifest = ex.manifest_for_release(release)
    frozen_kbs = manifest.get("_frozen_knowledges") or {}
    knowledge_ids = [
        (frozen_kbs.get(kid) or {}).get("runtime_kb_id")
        for kid in (manifest.get("knowledge_ids") or [])
    ]
    return runtime_id, {
        "chat_model_config": model_cfg,
        # P0-01: only REAL AgentScope KB ids cross the boundary
        "knowledge_ids": [k for k in knowledge_ids if k and not k.startswith("kb_")],
    }


def _build_flow_body(
    db: Session,
    uid: str,
    definition: dict,
    flow_input: dict,
    only: list[str] | None = None,
) -> dict:
    nodes = definition.get("nodes") or []
    edges = definition.get("edges") or []
    if only:
        nodes = [n for n in nodes if n.get("id") in set(only)]
        keep = {n.get("id") for n in nodes}
        edges = [e for e in edges if e.get("from") in keep and e.get("to") in keep]
    body_nodes = []
    for n in nodes:
        runtime_id, extra = _node_runtime_binding(db, uid, n.get("agent_id", ""))
        body_nodes.append(
            {
                "id": n.get("id"),
                "agent_id": runtime_id,
                "prompt_template": n.get("prompt_template", ""),
                "structured_schema": n.get("structured_schema"),
                **extra,
            }
        )
    return {
        "user_id": uid,
        "nodes": body_nodes,
        "edges": edges,
        "flow_input": flow_input,
        "goal": definition.get("goal"),
    }


def _record_nodes(
    db: Session,
    run: AgentFlowRun,
    definition: dict,
    result: dict,
    attempt_base: dict[str, int] | None = None,
    runtime_map: dict[str, str] | None = None,
) -> None:
    node_defs = {n.get("id"): n for n in definition.get("nodes") or []}
    for nr in result.get("nodes") or []:
        nid = nr.get("id")
        attempt = (attempt_base or {}).get(nid, 0) + 1
        row = AgentFlowNodeRun(
            run_id=run.id,
            node_id=nid,
            attempt=attempt,
            agent_id=(node_defs.get(nid) or {}).get("agent_id"),
            session_id=nr.get("session_id"),
            status=nr.get("status"),
            input_version=attempt,
            output=nr.get("output") if isinstance(nr.get("output"), dict) else (
                {"text": nr.get("output")} if nr.get("output") is not None else None
            ),
            error=nr.get("error") or "",
            started_at=datetime.now(timezone.utc),
            ended_at=datetime.now(timezone.utc),
        )
        db.add(row)
        if nr.get("session_id"):
            db.add(
                AgentSessionIndex(
                    session_id=nr["session_id"],
                    user_id="system",
                    agent_id=(node_defs.get(nid) or {}).get("agent_id") or "",
                    runtime_agent_id=(runtime_map or {}).get(nid),
                    trigger_kind="agentflow",
                    agentflow_run_id=run.id,
                    agentflow_node_run_id=row.id,
                )
            )
    db.commit()


def _latest_outputs(db: Session, run_id: str) -> dict[str, Any]:
    rows = (
        db.query(AgentFlowNodeRun)
        .filter_by(run_id=run_id, status="succeeded")
        .order_by(AgentFlowNodeRun.attempt.desc())
        .all()
    )
    out: dict[str, Any] = {}
    for r in rows:
        out.setdefault(r.node_id, r.output)
    return out


def start_run(
    db: Session,
    user_id: str,
    release: AgentFlowRelease,
    flow_input: dict,
    *,
    trigger_kind: str = "manual",
    automation_id: str | None = None,
    parent_session_id: str | None = None,
) -> AgentFlowRun:
    """F0：run-now 不再阻塞 HTTP —— 落 queued 行 + 入 job 队列即返回（AC-004）。

    真实执行在 worker（``execute_agentflow_run``）里消费运行时 SSE 流并逐节点
    增量落 NodeRun/SessionIndex；节点 Session 回调令牌在 worker 开跑时签发
    （哈希落 run 行），节点执行前不会有任何回调，无窗口风险。"""
    version = db.get(AgentFlowVersion, release.version_id)
    definition = version.definition or {}
    run = AgentFlowRun(
        release_id=release.id,
        trigger_kind=trigger_kind,
        status="queued",
        input=flow_input,
        automation_id=automation_id,
        parent_session_id=parent_session_id,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    try:
        # 绑定校验前置：节点 agent 缺失等配置错误在提交时即失败，不留僵尸 queued 行
        if definition.get("kind") == "script":
            build_script_body(db, user_id, definition, flow_input)
        else:
            _build_flow_body(db, user_id, definition, flow_input)
    except Exception as exc:  # noqa: BLE001
        run.status = "failed"
        run.error = repr(exc)
        run.ended_at = datetime.now(timezone.utc)
        db.commit()
        raise ValueError(f"agentflow run {run.id} preflight failed: {exc}") from exc
    from .models import JobQueue

    db.add(
        JobQueue(
            type="agentflow-execution",
            payload={"run_id": run.id, "user_id": user_id},
        )
    )
    db.commit()
    db.refresh(run)
    return run


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _wrap_node_output(value: Any) -> dict | None:
    if isinstance(value, dict):
        return value
    if value is None:
        return None
    return {"text": value}


def _handle_flow_event(
    db: Session,
    run: AgentFlowRun,
    node_defs: dict[str, dict],
    runtime_map: dict[str, str],
    attempts: dict[str, int],
    uid: str,
    ev: dict,
) -> None:
    """消费一条运行时 stage/flow 事件，增量落库（F0 ③④）。

    stage start（此刻 Session 已在运行时建好）→ NodeRun(running)+SessionIndex；
    stage end → 终态回写；flow:complete → run 终态。每事件独立 commit，
    保证看板/SSE 逐步可见且 worker 崩溃后已落事实不丢。"""
    name = ev.get("event") or ""
    data = ev.get("data") or {}
    if name == "needs_input":
        # P2/AC-S3：askUser 挂起——落 waiting 节点，request_id 存 input 供答复端点定位
        label = str(data.get("label") or f"input-{str(data.get('request_id', ''))[:8]}")
        attempt = attempts.get(label, 0) + 1
        attempts[label] = attempt
        db.add(
            AgentFlowNodeRun(
                run_id=run.id,
                node_id=label,
                attempt=attempt,
                status="waiting",
                input={
                    "request_id": data.get("request_id"),
                    "prompt": data.get("prompt"),
                    "options": data.get("options") or [],
                    "default": data.get("default"),
                },
                started_at=_now(),
            )
        )
        db.commit()
        return
    if name == "flow:complete":
        run.output = data.get("output")
        run.status = data.get("status", "failed")
        run.error = "" if run.status == "succeeded" else (data.get("error") or "node failed")
        run.ended_at = _now()
        # run 终态时仍挂起的 askUser 一并结算（kill/deadline/崩溃路径）
        for w in (
            db.query(AgentFlowNodeRun)
            .filter_by(run_id=run.id, status="waiting")
            .all()
        ):
            w.status = "cancelled"
            w.ended_at = _now()
        db.commit()
        return
    if not name.startswith("stage:"):
        return
    nid = name[len("stage:"):]
    phase = data.get("phase")
    if phase == "start":
        session_id = data.get("session_id")
        attempt = attempts.get(nid, 0) + 1
        attempts[nid] = attempt
        agent_id = data.get("agent_id") or (node_defs.get(nid) or {}).get("agent_id")
        row = AgentFlowNodeRun(
            run_id=run.id,
            node_id=nid,
            attempt=attempt,
            agent_id=agent_id,
            session_id=session_id,
            status="running",
            input_version=attempt,
            started_at=_now(),
        )
        db.add(row)
        db.flush()
        if session_id:
            db.add(
                AgentSessionIndex(
                    session_id=session_id,
                    user_id=uid,
                    agent_id=agent_id or "",
                    runtime_agent_id=data.get("runtime_agent_id") or runtime_map.get(nid),
                    trigger_kind="agentflow",
                    agentflow_run_id=run.id,
                    agentflow_node_run_id=row.id,
                )
            )
        db.commit()
    elif phase == "end":
        attempt = attempts.get(nid, 0)
        row = (
            db.query(AgentFlowNodeRun)
            .filter_by(run_id=run.id, node_id=nid, attempt=attempt)
            .first()
        )
        if row is None:
            return
        row.status = data.get("status", "failed")
        row.output = _wrap_node_output(data.get("output"))
        row.error = data.get("error") or ""
        row.session_id = data.get("session_id") or row.session_id
        row.ended_at = _now()
        db.commit()


def execute_agentflow_run(run_id: str, user_id: str | None = None) -> None:
    """job worker 入口（queue type=agentflow-execution, F0 ②③④）。

    消费运行时 ``/mtc/flows/run/stream``，逐事件增量落库。域内失败（节点失败/
    运行时不可达）结算为 run 终态并正常完成 job；worker 进程崩溃则靠 job 租约
    回收重试（run 仍为 running 时整体重跑，节点 attempt 递增、不撞唯一约束）。"""
    from .db import SessionLocal

    db = SessionLocal()
    try:
        run = db.get(AgentFlowRun, run_id)
        if run is None or run.status not in ("queued", "running"):
            return
        if run.ended_at is not None:
            return  # 已有终态：job 重复投递防御，不重算
        release = db.get(AgentFlowRelease, run.release_id)
        version = db.get(AgentFlowVersion, release.version_id)
        definition = version.definition or {}
        uid = user_id
        if not uid and run.automation_id:
            auto = db.get(AutomationDefinition, run.automation_id)
            uid = (auto.created_by if auto else "") or ""
        uid = uid or "dev"
        # P0-08: 每 worker 执行签发新 run 级回调令牌（重跑使旧令牌自然失效）
        run_token = _secrets.token_urlsafe(32)
        run.run_token_hash = hashlib.sha256(run_token.encode()).hexdigest()
        run.status = "running"
        db.commit()
        try:
            if definition.get("kind") == "script":
                body = build_script_body(db, uid, definition, run.input or {})
            else:
                body = _build_flow_body(db, uid, definition, run.input or {})
        except Exception as exc:  # noqa: BLE001
            run.status = "failed"
            run.error = repr(exc)
            run.ended_at = _now()
            db.commit()
            return
        body["internal_token"] = run_token
        body["agentflow_run_id"] = run.id
        if definition.get("kind") == "script":
            # 脚本形态：start 事件自带 agent_id/runtime_agent_id，无静态节点表
            runtime_map: dict[str, str] = {}
            node_defs: dict[str, dict] = {}
            events = rt.script_run_stream(body)
        else:
            runtime_map = {n["id"]: n["agent_id"] for n in body["nodes"]}
            node_defs = {n.get("id"): n for n in definition.get("nodes") or []}
            events = rt.flow_run_stream(body)
        attempts = {
            r.node_id: r.attempt
            for r in db.query(AgentFlowNodeRun).filter_by(run_id=run.id).all()
        }
        try:
            for ev in events:
                _handle_flow_event(db, run, node_defs, runtime_map, attempts, uid, ev)
            if run.ended_at is None:  # 流异常终止且无 flow:complete
                run.status = "failed"
                run.error = "runtime stream ended without flow:complete"
                run.ended_at = _now()
                db.commit()
        except Exception as exc:  # noqa: BLE001
            run.status = "failed"
            run.error = repr(exc)
            run.ended_at = _now()
            db.commit()
    finally:
        db.close()


def rerun_node(db: Session, user_id: str, run_id: str, node_id: str) -> AgentFlowNodeRun:
    """选择性重跑（审核 P0-1）：目标+下游 stale，上游最新成功输出为输入，
    重算 Flow 总输出与终态。"""
    run = db.get(AgentFlowRun, run_id)
    if run is None:
        raise ValueError("run not found")
    release = db.get(AgentFlowRelease, run.release_id)
    version = db.get(AgentFlowVersion, release.version_id)
    definition = version.definition or {}
    edges = definition.get("edges") or []
    stale = {node_id} | _downstream(node_id, edges)
    order = [i for i in _topo_order([n.get("id") for n in definition.get("nodes") or []], edges) if i in stale]
    upstream = {k: v for k, v in _latest_outputs(db, run_id).items() if k not in stale}
    flow_input = {**(run.input or {}), **upstream}
    attempts = {
        r.node_id: r.attempt
        for r in db.query(AgentFlowNodeRun).filter_by(run_id=run_id).all()
    }
    body = _build_flow_body(db, user_id, definition, flow_input, only=order)
    runtime_map = {n["id"]: n["agent_id"] for n in body["nodes"]}
    result = rt.flow_run(body)
    _record_nodes(db, run, definition, result, attempt_base=attempts, runtime_map=runtime_map)
    # 重算总输出与终态
    merged = {**upstream, **(result.get("output") or {})}
    run.output = merged
    run.status = result.get("status", "failed")
    run.error = "" if run.status == "succeeded" else "node failed"
    run.ended_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return (
        db.query(AgentFlowNodeRun)
        .filter_by(run_id=run_id, node_id=node_id)
        .order_by(AgentFlowNodeRun.attempt.desc())
        .first()
    )
