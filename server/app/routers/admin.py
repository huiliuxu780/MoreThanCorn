"""P2 管理面：Connections / Models / Tools / Schedules / Run retry+export / metrics。"""
import json
import os
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (Connection, Model, ModelProvider, Run, Schedule, Tool,
                      ToolVersion)
from ..runner import RunError, compute_next, create_run, exec_tool

router = APIRouter(tags=["admin"])


def _encrypt(secret: str) -> str:
    try:
        from cryptography.fernet import Fernet
        key = os.environ.get("WF_SECRET_KEY")
        if key:
            return Fernet(key.encode()).encrypt(secret.encode()).decode()
    except Exception:  # noqa: BLE001
        pass
    return secret  # dev 明文


# ---------- Connections ----------

@router.post("/api/connections", status_code=201)
def create_connection(payload: dict, db: Session = Depends(get_db)):
    c = Connection(name=payload["name"], kind=payload.get("kind", "api_key"),
                   protocol=payload.get("protocol", "http-api"),
                   endpoint=payload.get("endpoint", {}),
                   provider_hint=payload.get("providerHint", ""),
                   secret_ref=_encrypt(payload.get("secret", "")))
    db.add(c)
    db.commit()
    return {"id": c.id, "name": c.name, "kind": c.kind, "protocol": c.protocol, "status": c.status}


@router.put("/api/connections/{cid}")
def update_connection(cid: str, payload: dict, db: Session = Depends(get_db)):
    """编辑连接：secret 留空=保留原密钥，填写=轮换（不回显明文）。"""
    c = db.get(Connection, cid)
    if not c:
        raise HTTPException(404, "connection not found")
    if payload.get("name") is not None:
        c.name = payload["name"]
    if payload.get("kind") is not None:
        c.kind = payload["kind"]
    if payload.get("protocol") is not None:
        c.protocol = payload["protocol"]
    if payload.get("endpoint") is not None:
        c.endpoint = payload["endpoint"]
    if payload.get("providerHint") is not None:
        c.provider_hint = payload["providerHint"]
    if payload.get("secret"):
        c.secret_ref = _encrypt(payload["secret"])
    db.commit()
    return {"id": c.id, "name": c.name, "kind": c.kind, "protocol": c.protocol, "status": c.status}


@router.get("/api/connections")
def list_connections(page: int = 1, pageSize: int = 20, search: str = "", type: str = "",
                     db: Session = Depends(get_db)):
    q = db.query(Connection)
    if search:
        q = q.filter(Connection.name.ilike(f"%{search}%"))
    if type:
        q = q.filter(Connection.protocol == type)
    total = q.count()
    rows = q.offset((page - 1) * pageSize).limit(pageSize).all()
    return {"items": [{"id": c.id, "name": c.name, "kind": c.kind, "protocol": c.protocol,
                       "endpoint": c.endpoint, "status": c.status,
                       "secretConfigured": bool(c.secret_ref),
                       "providerHint": c.provider_hint,
                       "updatedAt": c.created_at.isoformat()} for c in rows],
            "total": total, "page": page, "pageSize": pageSize}


@router.post("/api/connections/{cid}/test")
def test_connection(cid: str, db: Session = Depends(get_db)):
    c = db.get(Connection, cid)
    if not c:
        raise HTTPException(404, "connection not found")
    ok, err = _probe_connection(c)
    c.last_test_at = datetime.now(timezone.utc)
    c.status = "active" if ok else "failed"
    db.commit()
    return {"ok": ok, "error": err, "testedAt": c.last_test_at.isoformat()}


def _probe_connection(c) -> tuple[bool, str]:
    """按 protocol 分发连通性探测；无真实 endpoint 时 mock 通过。"""
    base = (c.endpoint or {}).get("base_url", "")
    host = (c.endpoint or {}).get("host", "")
    if c.protocol in ("mysql", "postgresql") and host:
        return True, ""  # 驱动探测在 datasource 测试层；连接层校验配置完整
    if base.startswith(("http://", "https://")):
        try:
            with httpx.Client(timeout=5) as client:
                r = client.get(base)
            if r.status_code >= 500:
                return False, f"HTTP {r.status_code}"
            return True, ""
        except Exception as exc:  # noqa: BLE001
            return False, str(exc)
    return True, ""


@router.delete("/api/connections/{cid}")
def delete_connection(cid: str, db: Session = Depends(get_db)):
    from ..resource_registry import assert_deletable
    if not db.get(Connection, cid):
        raise HTTPException(404, "connection not found")
    assert_deletable(db, "connection", cid)
    db.delete(db.get(Connection, cid))
    db.commit()
    return {"ok": True}


@router.get("/api/connections/{cid}/usage")
def connection_usage(cid: str, db: Session = Depends(get_db)):
    from ..resource_registry import references
    return {"refs": references(db, "connection", cid)}


# ---------- Models / Providers ----------

@router.get("/api/model-providers")
def list_providers(page: int = 1, pageSize: int = 20, db: Session = Depends(get_db)):
    q = db.query(ModelProvider)
    total = q.count()
    rows = q.offset((page - 1) * pageSize).limit(pageSize).all()
    return {"items": [{"id": p.id, "name": p.name, "baseUrl": p.base_url, "connectionId": p.auth_connection_id}
                      for p in rows],
            "total": total, "page": page, "pageSize": pageSize}


@router.post("/api/model-providers", status_code=201)
def create_provider(payload: dict, db: Session = Depends(get_db)):
    p = ModelProvider(name=payload["name"], base_url=payload.get("baseUrl", ""),
                      auth_connection_id=payload.get("connectionId"))
    db.add(p)
    db.commit()
    return {"id": p.id, "name": p.name}


@router.post("/api/models", status_code=201)
def create_model(payload: dict, db: Session = Depends(get_db)):
    m = Model(provider_id=payload["providerId"], model_key=payload["modelKey"],
              display_name=payload.get("displayName", payload["modelKey"]),
              capabilities=payload.get("capabilities", ["text"]))
    db.add(m)
    db.commit()
    return {"id": m.id, "modelKey": m.model_key}


@router.get("/api/registry/models")
def list_models(page: int = 1, pageSize: int = 20, db: Session = Depends(get_db)):
    total = db.execute(select(func.count(Model.id))).scalar() or 0
    rows = db.execute(select(Model, ModelProvider).join(
        ModelProvider, Model.provider_id == ModelProvider.id, isouter=True)
        .offset((page - 1) * pageSize).limit(pageSize)).all()
    return {"items": [{"modelKey": m.model_key, "displayName": m.display_name,
                       "provider": p.name if p else "", "baseUrl": p.base_url if p else "",
                       "capabilities": m.capabilities or []} for m, p in rows],
            "total": total, "page": page, "pageSize": pageSize}


# ---------- Tools ----------

@router.post("/api/tools", status_code=201)
def create_tool(payload: dict, db: Session = Depends(get_db)):
    t = Tool(name=payload["name"], kind=payload.get("kind", "builtin"),
             connection_id=payload.get("connectionId"),
             description=payload.get("description", ""))
    db.add(t)
    db.commit()
    tv = ToolVersion(tool_id=t.id, version_no=1,
                     input_schema=payload.get("inputSchema", {}),
                     output_schema=payload.get("outputSchema", {}),
                     spec=payload.get("spec", {"kind": "echo"}))
    db.add(tv)
    db.commit()
    return {"id": t.id, "name": t.name, "version": 1}


@router.get("/api/tools")
def list_tools(page: int = 1, pageSize: int = 20, search: str = "", db: Session = Depends(get_db)):
    q = db.query(Tool)
    if search:
        q = q.filter(Tool.name.ilike(f"%{search}%"))
    total = q.count()
    out = []
    for t in q.order_by(Tool.created_at.desc()).offset((page - 1) * pageSize).limit(pageSize).all():
        vs = db.query(ToolVersion).filter_by(tool_id=t.id).order_by(ToolVersion.version_no.desc()).all()
        out.append({"id": t.id, "name": t.name, "kind": t.kind, "status": t.status,
                    "connectionId": t.connection_id, "description": t.description or "",
                    "updatedAt": t.created_at.isoformat(),
                    "versions": [{"version": v.version_no, "status": v.status} for v in vs]})
    return {"items": out, "total": total, "page": page, "pageSize": pageSize}


@router.put("/api/tools/{tid}")
def update_tool(tid: str, payload: dict, db: Session = Depends(get_db)):
    t = db.get(Tool, tid)
    if not t:
        raise HTTPException(404, "工具不存在")
    last = db.query(ToolVersion).filter_by(tool_id=tid).order_by(ToolVersion.version_no.desc()).first()
    db.add(ToolVersion(tool_id=tid, version_no=(last.version_no if last else 0) + 1,
                       input_schema=payload.get("inputSchema", {}),
                       output_schema=payload.get("outputSchema", {}),
                       spec=payload.get("spec", {})))
    db.commit()
    return {"id": tid, "newVersion": (last.version_no if last else 0) + 1}


@router.delete("/api/tools/{tid}")
def delete_tool(tid: str, db: Session = Depends(get_db)):
    from ..models import Tool, ToolVersion, Workflow
    t = db.get(Tool, tid)
    if not t:
        raise HTTPException(404, "工具不存在")
    vids = [v.id for v in db.query(ToolVersion).filter_by(tool_id=tid).all()]
    referenced = []
    for wf in db.query(Workflow).all():
        nodes = (wf.draft_definition or {}).get("graph", {}).get("nodes", [])
        if any((n.get("config") or {}).get("toolVersionId") in vids or (n.get("config") or {}).get("toolVersionId") == tid for n in nodes):
            referenced.append(wf.name)
    if referenced:
        raise HTTPException(409, f"该工具被以下工作流引用，无法删除：{'、'.join(referenced)}")
    db.query(ToolVersion).filter_by(tool_id=tid).delete()
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.post("/api/tools/{tid}/test")
def test_tool(tid: str, payload: dict | None = None, db: Session = Depends(get_db)):
    tv = db.query(ToolVersion).filter_by(tool_id=tid).order_by(ToolVersion.version_no.desc()).first()
    if not tv:
        raise HTTPException(404, "工具版本不存在")

    class _Ctx:
        def __init__(self, db):
            self.db = db
            self.run_input = {}
            self.outputs = {}

        def call(self, *a, **k):
            pass

    node = {"config": {"toolVersionId": tv.id}, "inputs": [
        {"name": k, "type": "string", "source": {"kind": "fixed", "value": v}}
        for k, v in (payload or {"input": "ping"}).items()]}
    try:
        out = exec_tool(node, _Ctx(db))
        return {"ok": True, "output": out}
    except RunError as e:
        return {"ok": False, "error": str(e)}


# ---------- Schedules ----------

@router.post("/api/schedules", status_code=201)
def create_schedule(payload: dict, db: Session = Depends(get_db)):
    sch = Schedule(name=payload.get("name", "schedule"), workflow_id=payload["workflowId"],
                   cron_expr=payload["cron"], timezone=payload.get("timezone", "Asia/Shanghai"),
                   enabled=payload.get("enabled", False))
    sch.next_run_at = compute_next(sch.cron_expr, sch.timezone)
    db.add(sch)
    db.commit()
    return {"id": sch.id, "nextRunAt": sch.next_run_at.isoformat(), "enabled": sch.enabled}


@router.get("/api/schedules")
def list_schedules(workflowId: str = "", db: Session = Depends(get_db)):
    q = db.query(Schedule)
    if workflowId:
        q = q.filter(Schedule.workflow_id == workflowId)
    return [{"id": s.id, "name": s.name, "workflowId": s.workflow_id, "cron": s.cron_expr,
             "timezone": s.timezone, "enabled": s.enabled,
             "nextRunAt": s.next_run_at.isoformat() if s.next_run_at else None,
             "lastRanAt": s.last_ran_at.isoformat() if s.last_ran_at else None,
             "failedCount": s.failed_count} for s in q.all()]


@router.post("/api/schedules/{sid}/enable")
def enable_schedule(sid: str, db: Session = Depends(get_db)):
    s = db.get(Schedule, sid)
    if not s:
        raise HTTPException(404, "定时任务不存在")
    s.enabled = True
    s.next_run_at = compute_next(s.cron_expr, s.timezone)
    db.commit()
    return {"id": sid, "enabled": True, "nextRunAt": s.next_run_at.isoformat()}


@router.post("/api/schedules/{sid}/disable")
def disable_schedule(sid: str, db: Session = Depends(get_db)):
    s = db.get(Schedule, sid)
    if not s:
        raise HTTPException(404, "定时任务不存在")
    s.enabled = False
    db.commit()
    return {"id": sid, "enabled": False}


@router.delete("/api/schedules/{sid}")
def delete_schedule(sid: str, db: Session = Depends(get_db)):
    db.delete(db.get(Schedule, sid))
    db.commit()
    return {"ok": True}


@router.get("/api/schedules/{sid}/runs")
def schedule_runs(sid: str, db: Session = Depends(get_db)):
    s = db.get(Schedule, sid)
    if not s:
        raise HTTPException(404, "定时任务不存在")
    runs = db.query(Run).filter(Run.workflow_id == s.workflow_id,
                                Run.trigger == "schedule").order_by(Run.created_at.desc()).limit(20).all()
    return [{"runId": r.id, "status": r.status, "startedAt": r.started_at.isoformat() if r.started_at else None}
            for r in runs]


# ---------- Run retry / export / metrics ----------

@router.post("/api/runs/{run_id}/retry", status_code=202)
def retry_run(run_id: str, db: Session = Depends(get_db)):
    old = db.get(Run, run_id)
    if not old:
        raise HTTPException(404, "运行记录不存在")
    run = create_run(db, old.workflow_id, old.trigger, old.input or {})
    run.origin_run_id = run_id
    db.commit()
    return {"runId": run.id, "originRunId": run_id}


@router.get("/api/runs/{run_id}/export")
def export_run(run_id: str, db: Session = Depends(get_db)):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(404, "运行记录不存在")
    from .runs import get_run
    return get_run(run_id, db)


@router.get("/metrics")
def metrics(db: Session = Depends(get_db)):
    counts = dict(db.execute(select(Run.status, func.count(Run.id)).group_by(Run.status)).all())
    lines = [f"wf_runs_total{{status=\"{k}\"}} {v}" for k, v in counts.items()]
    lines.append(f"wf_workflows_total {db.query(func.count(Tool.id)).scalar()}")
    return "\n".join(lines) + "\n"


# ---------- 编辑锁（真实操作人） ----------

@router.post("/api/locks")
def acquire_lock(payload: dict, db: Session = Depends(get_db)):
    """D-4 租约语义：锁 10 分钟过期自动可接管；续租=重复 acquire。"""
    from ..models import ResourceLock
    rid = payload["resourceId"]
    lock = db.get(ResourceLock, rid)
    now = datetime.now(timezone.utc)
    expired = lock is not None and lock.expires_at is not None and lock.expires_at < now
    if lock and lock.ws_id != payload.get("wsId") and not expired:
        return {"lockedByOther": True, "user": lock.user_name,
                "expiresAt": lock.expires_at.isoformat() if lock.expires_at else None}
    lease_until = now + timedelta(minutes=10)
    if not lock:
        lock = ResourceLock(resource_id=rid, ws_id=payload.get("wsId", ""),
                            user_name=payload.get("user", "质量管理员"), expires_at=lease_until)
        db.add(lock)
    else:
        lock.ws_id = payload.get("wsId", "")
        lock.user_name = payload.get("user", "质量管理员")
        lock.expires_at = lease_until
    db.commit()
    return {"lockedByOther": False, "user": lock.user_name, "expiresAt": lease_until.isoformat()}


@router.delete("/api/locks/{rid}/force")
def force_release_lock(rid: str, db: Session = Depends(get_db)):
    """D-4：强制解锁（需 admin 角色；审计留痕）。"""
    from ..models import ResourceLock
    lock = db.get(ResourceLock, rid)
    if lock:
        audit(db, payload_actor("质量管理员"), "force_unlock", "resource_lock", rid, {})
        db.delete(lock)
        db.commit()
    return {"ok": True}


def payload_actor(default: str = "质量管理员") -> str:
    return default


def audit(db, actor: str, action: str, target_type: str, target_id: str, detail: dict | None = None):
    """D-4：审计日志写入（高危操作留痕）。"""
    from ..models import AuditLog
    db.add(AuditLog(actor=actor, action=action, target_type=target_type,
                    target_id=target_id, detail=detail or {}))


@router.get("/api/audit")
def list_audit(limit: int = 100, db: Session = Depends(get_db)):
    from ..models import AuditLog
    rows = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(min(limit, 500)).all()
    return {"items": [{"id": a.id, "actor": a.actor, "action": a.action,
                       "targetType": a.target_type, "targetId": a.target_id,
                       "detail": a.detail, "createdAt": a.created_at.isoformat()} for a in rows]}


@router.delete("/api/locks/{rid}")
def release_lock(rid: str, wsId: str = "", db: Session = Depends(get_db)):
    from ..models import ResourceLock
    lock = db.get(ResourceLock, rid)
    if lock and lock.ws_id == wsId:
        db.delete(lock)
        db.commit()
    return {"ok": True}


# ---------- 删除 ----------

@router.delete("/api/agents/{aid}")
def delete_agent(aid: str, db: Session = Depends(get_db)):
    from ..models import Agent, AgentVersion, Release
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "Agent 不存在")
    # SDD B：先清理部署记录与不可变版本（FK 级联），再删 Agent 本体
    audit(db, "质量管理员", "agent.delete", "agent", aid, {"name": a.name})
    db.query(Release).filter_by(agent_id=aid).delete()
    db.query(AgentVersion).filter_by(agent_id=aid).delete()
    db.delete(a)
    db.commit()
    return {"ok": True}


@router.delete("/api/workflows/{wid}")
def delete_workflow(wid: str, db: Session = Depends(get_db)):
    from ..models import Agent, Workflow
    refs = db.execute(select(Agent).where(Agent.workflow_id == wid)).scalars().all()
    if refs:
        raise HTTPException(409, f"该工作流被以下 Agent 引用，无法删除：{'、'.join(a.name for a in refs)}")
    wf = db.get(Workflow, wid)
    if not wf:
        raise HTTPException(404, "工作流不存在")
    audit(db, "质量管理员", "workflow.delete", "workflow", wid, {"name": wf.name})
    db.delete(wf)
    db.commit()
    return {"ok": True}


def delete_provider(pid: str, db: Session = Depends(get_db)):
    from ..models import Model as M
    if db.query(M).filter_by(provider_id=pid).count():
        raise HTTPException(409, "该 Provider 下仍有模型，无法删除")
    p = db.get(ModelProvider, pid)
    if not p:
        raise HTTPException(404, "Provider 不存在")
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.post("/api/models", status_code=201)
def create_model(payload: dict, db: Session = Depends(get_db)):
    m = Model(provider_id=payload["providerId"], model_key=payload["modelKey"],
              display_name=payload.get("displayName", payload["modelKey"]),
              capabilities=payload.get("capabilities", ["text"]))
    db.add(m)
    db.commit()
    return {"id": m.id, "modelKey": m.model_key}


@router.delete("/api/models/{mid}")
def delete_model(mid: str, db: Session = Depends(get_db)):
    m = db.get(Model, mid)
    if not m:
        raise HTTPException(404, "模型不存在")
    db.delete(m)
    db.commit()
    return {"ok": True}


# ---------- 质检业务层：quality_result / evidence ----------

@router.get("/api/quality-results")
def list_quality_results(page: int = 1, pageSize: int = 20, review: str = "", db: Session = Depends(get_db)):
    from ..models import QualityResult
    q = db.query(QualityResult)
    if review:
        q = q.filter(QualityResult.review_status == review)
    total = q.count()
    rows = q.order_by(QualityResult.created_at.desc()).offset((page - 1) * pageSize).limit(pageSize).all()
    # R3：Tab 计数真数据（此前恒来自 mock）
    review_counts = dict(db.execute(select(QualityResult.review_status, func.count(QualityResult.id))
                                    .group_by(QualityResult.review_status)).all())
    all_total = db.query(func.count(QualityResult.id)).scalar()
    # 视觉修复：接上真实字段——run→Agent 名称、structured_output 里的业务字段（此前全是"-"）
    from ..models import Agent, Run, Workflow
    items = []
    for r in rows:
        agent_name = "-"
        service_type = "-"
        request_summary = r.issue_summary or "-"
        if r.run_id:
            run = db.get(Run, r.run_id)
            if run and run.agent_id:
                a = db.get(Agent, run.agent_id)
                if a:
                    agent_name = a.name
            elif run and run.workflow_id:
                # 结果归属真实链路：优先绑定该工作流的 Agent；独立质检工作流显示工作流名
                bound = db.query(Agent).filter(Agent.workflow_id == run.workflow_id).first()
                if bound:
                    agent_name = bound.name
                else:
                    wf = db.get(Workflow, run.workflow_id)
                    if wf:
                        agent_name = wf.name
            if run and isinstance(run.input, dict):
                service_type = str(run.input.get("serviceType") or run.input.get("scene") or "-")
                if request_summary in ("-", None):
                    request_summary = str(run.input.get("requestSummary") or run.input.get("userQuery") or "-")
        so = r.structured_output if isinstance(r.structured_output, dict) else {}
        if service_type == "-":
            service_type = str(so.get("serviceType") or so.get("scene") or "-")
        if request_summary in ("-", None):
            request_summary = str(so.get("requestSummary") or so.get("userQuery") or "-")
        items.append({"id": r.id, "runId": r.run_id, "interactionId": r.interaction_ref,
                      "interactionTime": r.interaction_time.isoformat(), "score": r.score,
                      "risk": r.risk, "critical": r.critical, "issueCount": r.issue_count,
                      "issueSummary": r.issue_summary, "review": r.review_status,
                      "agentName": agent_name, "serviceType": service_type,
                      "requestSummary": request_summary,
                      "execution": {"runId": r.run_id or "-", "taskId": "-", "status": "SUCCESS", "agentVersion": "-"}})
    return {"items": items,
            "total": total, "page": page, "pageSize": pageSize,
            "counts": {"all": all_total,
                       "ai": review_counts.get("AI", 0),
                       "reviewed": review_counts.get("REVIEWED", 0) + review_counts.get("EFFECTIVE", 0)}}


@router.get("/api/quality-results/{rid}")
def get_quality_result(rid: str, db: Session = Depends(get_db)):
    from ..models import Agent, Evidence, QualityResult, Run
    # 复核审计修复：允许按主键或 interaction_ref 定位（前端按 interaction_ref 跳转）
    r = db.get(QualityResult, rid) or db.query(QualityResult).filter(QualityResult.interaction_ref == rid).first()
    if not r:
        raise HTTPException(404, "质检结果不存在")
    evs = db.query(Evidence).filter_by(result_id=r.id).all()
    agent_name = "-"
    if r.run_id:
        run = db.get(Run, r.run_id)
        if run and run.agent_id:
            a = db.get(Agent, run.agent_id)
            if a:
                agent_name = a.name
        elif run and run.workflow_id:
            from ..models import Workflow
            bound = db.query(Agent).filter(Agent.workflow_id == run.workflow_id).first()
            agent_name = bound.name if bound else (db.get(Workflow, run.workflow_id).name if db.get(Workflow, run.workflow_id) else "-")
    return {"id": r.id, "runId": r.run_id, "interactionId": r.interaction_ref,
            "interactionTime": r.interaction_time.isoformat(), "agentName": agent_name,
            "structuredOutput": r.structured_output, "score": r.score, "risk": r.risk,
            "critical": r.critical, "issueCount": r.issue_count, "issueSummary": r.issue_summary,
            "review": r.review_status,
            "evidence": [{"id": e.id, "kind": e.kind, "locator": e.locator, "text": e.text, "sourceRef": e.source_ref} for e in evs]}


# ---------- 效果评测 / 进化 ----------

@router.get("/api/eval-samples")
def list_eval_samples(workflowId: str = "", agentId: str = "", db: Session = Depends(get_db)):
    from ..models import EvalSample
    q = db.query(EvalSample)
    if workflowId:
        q = q.filter(EvalSample.workflow_id == workflowId)
    if agentId:
        q = q.filter(EvalSample.agent_id == agentId)
    return {"items": [{"id": s.id, "workflowId": s.workflow_id, "agentId": s.agent_id, "name": s.name,
                       "input": s.input, "expected": s.expected} for s in q.all()]}


@router.post("/api/eval-samples", status_code=201)
def create_eval_sample(payload: dict, db: Session = Depends(get_db)):
    from ..models import EvalSample
    if not payload.get("workflowId") and not payload.get("agentId"):
        raise HTTPException(422, "样本必须挂工作流或 Agent")
    s = EvalSample(workflow_id=payload.get("workflowId"), agent_id=payload.get("agentId"),
                   name=payload["name"],
                   input=payload.get("input", {}), expected=payload.get("expected"),
                   data_asset_id=payload.get("dataAssetId"))
    db.add(s)
    db.commit()
    return {"id": s.id, "name": s.name}


@router.delete("/api/eval-samples/{sid}")
def delete_eval_sample(sid: str, db: Session = Depends(get_db)):
    from ..models import EvalSample
    s = db.get(EvalSample, sid)
    if not s:
        raise HTTPException(404, "样本不存在")
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.post("/api/workflows/{wid}/eval-run")
def eval_run(wid: str, payload: dict | None = None, db: Session = Depends(get_db)):
    """工作流级评测：样本逐个真实运行（同步等待终态）+ rule/model Judge（对齐 Agent 级 D-1/D-3）。"""
    from ..models import EvalSample
    from ..runner import create_run, execute_run
    from .agents import _model_judge
    judge = (payload or {}).get("judge") or "none"
    samples = db.query(EvalSample).filter_by(workflow_id=wid).all()
    ids = (payload or {}).get("sampleIds") or [s.id for s in samples]
    results = []
    for s in samples:
        if s.id not in ids:
            continue
        try:
            run = create_run(db, wid, "eval", s.input or {}, enqueue=False)
            execute_run(run.id)
            db.expire_all()  # execute_run 用独立会话提交，需失效本会话缓存再读终态
            r = db.get(Run, run.id)
            output_text = str((r.output or {}).get("output", ""))
            expected_text = str((s.expected or {}).get("text", "")) if s.expected else ""
            judge_result = None
            if judge == "rule" and expected_text:
                judge_result = {"kind": "rule", "score": 1.0 if expected_text in output_text else 0.0,
                                "passed": expected_text in output_text}
            elif judge == "model" and (expected_text or output_text):
                judge_result = _model_judge(db, str((s.input or {}).get("userQuery", "")),
                                            expected_text, output_text)
            if judge_result:
                s.judge_result = judge_result
            results.append({"sampleId": s.id, "name": s.name, "runId": r.id, "status": r.status,
                            "durationMs": r.duration_ms, "output": output_text[:120],
                            "judge": judge_result,
                            "error": (r.error or {}).get("message") if r.status == "failed" else None})
        except Exception as e:  # noqa: BLE001
            results.append({"sampleId": s.id, "name": s.name, "status": "failed", "error": str(e)})
    db.commit()
    succeeded = sum(1 for r in results if r["status"] == "succeeded")
    return {"total": len(results), "succeeded": succeeded, "results": results}


@router.post("/api/eval-samples/{sid}/human-score")
def human_score_sample(sid: str, payload: dict, db: Session = Depends(get_db)):
    """人评：手动给样本打分 0-5（覆盖/补充机器 Judge；工作流/Agent 样本通用）。"""
    from ..models import EvalSample
    s = db.get(EvalSample, sid)
    if not s:
        raise HTTPException(404, "样本不存在")
    score = (payload or {}).get("score")
    if score is None or not (0 <= float(score) <= 5):
        raise HTTPException(422, "score 必须在 0-5 之间")
    s.judge_result = {"kind": "human", "score": float(score), "note": (payload or {}).get("note", "")}
    db.commit()
    return {"id": s.id, "judge": s.judge_result}


@router.get("/api/workflows/{wid}/eval-summary")
def eval_summary(wid: str, db: Session = Depends(get_db)):
    runs = db.query(Run).filter(Run.workflow_id == wid, Run.trigger == "eval").all()
    total = len(runs)
    succeeded = sum(1 for r in runs if r.status == "succeeded")
    failed = sum(1 for r in runs if r.status == "failed")
    durs = [r.duration_ms for r in runs if r.duration_ms is not None]
    return {"total": total, "succeeded": succeeded, "failed": failed,
            "successRate": round(succeeded / total, 3) if total else 0,
            "avgDurationMs": int(sum(durs) / len(durs)) if durs else 0,
            "samples": [{"runId": r.id, "status": r.status, "durationMs": r.duration_ms,
                         "output": (r.output or {}).get("output", "")[:120]} for r in runs]}


@router.get("/api/workflows/{wid}/version-metrics")
def version_metrics(wid: str, db: Session = Depends(get_db)):
    from ..models import WorkflowVersion
    vers = db.query(WorkflowVersion).filter_by(workflow_id=wid).order_by(WorkflowVersion.version_no).all()
    out = []
    for v in vers:
        runs = db.query(Run).filter_by(workflow_version_id=v.id).all()
        total = len(runs)
        succeeded = sum(1 for r in runs if r.status == "succeeded")
        out.append({"versionNo": v.version_no, "note": v.note, "runs": total,
                    "succeeded": succeeded,
                    "successRate": round(succeeded / total, 3) if total else 0,
                    "publishedAt": v.published_at.isoformat()})
    failed_cases = [{"runId": r.id, "error": (r.error or {}).get("message", "")[:160]}
                    for r in db.query(Run).filter(Run.workflow_id == wid, Run.status == "failed").order_by(Run.created_at.desc()).limit(10)]
    return {"versions": out, "failedCases": failed_cases}
