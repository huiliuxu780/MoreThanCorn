"""P2 管理面：Connections / Models / Tools / Schedules / Run retry+export / metrics。"""
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from ..auth import data_scope_members, require_admin, require_operator, require_role
from ..auth_sandbox import run_auth_script
from ..auth_signers import AuthSignError, build_auth_headers, normalize_kind
from ..connection_runtime import resolve_for_request
from ..connection_schemas import ConnectionCreate, ConnectionUpdate, DryRunSign
from ..db import get_db
from ..models import (Connection, Model, ModelProvider, Run, Schedule, Tool,
                      ToolVersion)
from ..runner import RunError, compute_next, create_run, exec_tool
from ..secrets import decrypt_payload, encrypt_secret, serialize_secret

router = APIRouter(tags=["admin"])


def _encrypt(secret: str) -> str:
    """09 P0-11：Secret 强制加密（失败关闭语义统一归 secrets.encrypt_secret）。"""
    try:
        return encrypt_secret(secret)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))


def _env_rows(envs) -> list[dict]:
    """EnvEntry 列表 → 落库形态：secret 明文加密为 secret_ref，永不原样落库。"""
    rows = []
    for e in envs or []:
        ref = None
        if e.secret not in (None, "", {}):
            ref = _encrypt(serialize_secret(e.secret))
        rows.append({"code": e.code, "label": e.label or e.code,
                     "endpoint": e.endpoint or {}, "secret_ref": ref})
    return rows


# ---------- Connections ----------

@router.post("/api/connections", status_code=201)
def create_connection(payload: ConnectionCreate, db: Session = Depends(get_db),
                        _user: dict = Depends(require_admin)):
    c = Connection(name=payload.name, kind=payload.kind, protocol=payload.protocol,
                   endpoint=payload.endpoint, environments=_env_rows(payload.environments),
                   default_env=payload.default_env, auth_script=payload.auth_script,
                   provider_hint=payload.providerHint,
                   secret_ref=_encrypt(serialize_secret(payload.secret or "")))
    db.add(c)
    db.commit()
    return {"id": c.id, "name": c.name, "kind": c.kind, "protocol": c.protocol, "status": c.status}


@router.put("/api/connections/{cid}")
def update_connection(cid: str, payload: ConnectionUpdate, db: Session = Depends(get_db),
                        _user: dict = Depends(require_admin)):
    """编辑连接：secret=None 保留原密钥，填写=轮换（不回显明文）。"""
    c = db.get(Connection, cid)
    if not c:
        raise HTTPException(404, "connection not found")
    if payload.name is not None:
        c.name = payload.name
    if payload.kind is not None:
        c.kind = payload.kind
    if payload.protocol is not None:
        c.protocol = payload.protocol
    if payload.endpoint is not None:
        c.endpoint = payload.endpoint
    if payload.environments is not None:
        c.environments = _env_rows(payload.environments)
    if payload.default_env is not None or payload.environments is not None:
        c.default_env = payload.default_env
    if payload.auth_script is not None:
        c.auth_script = payload.auth_script
    if payload.providerHint is not None:
        c.provider_hint = payload.providerHint
    if payload.kind == "script" and not (c.auth_script or "").strip():
        raise HTTPException(400, "script 鉴权必须提供鉴权脚本")
    if payload.secret is not None:
        c.secret_ref = _encrypt(serialize_secret(payload.secret))
    db.commit()
    return {"id": c.id, "name": c.name, "kind": c.kind, "protocol": c.protocol, "status": c.status}


@router.get("/api/connections")
def list_connections(page: int = 1, pageSize: int = 20, search: str = "", type: str = "",
                     db: Session = Depends(get_db)):
    # 确定性排序：否则测试连接更新行后物理位置漂移，前端"静默刷新"会看到列表重排（用户实测回归）
    q = db.query(Connection).order_by(Connection.created_at.desc())
    if search:
        q = q.filter(Connection.name.ilike(f"%{search}%"))
    if type:
        q = q.filter(Connection.protocol == type)
    total = q.count()
    rows = q.offset((page - 1) * pageSize).limit(pageSize).all()
    return {"items": [{"id": c.id, "name": c.name, "kind": c.kind, "protocol": c.protocol,
                       "endpoint": c.endpoint, "status": c.status,
                       "secretConfigured": bool(c.secret_ref),
                       "environments": [{"code": e.get("code"), "label": e.get("label"),
                                         "endpoint": e.get("endpoint"),
                                         "secretConfigured": bool(e.get("secret_ref"))}
                                        for e in (c.environments or [])],
                       "defaultEnv": c.default_env,
                       "authScript": c.auth_script or "",
                       "providerHint": c.provider_hint,
                       "updatedAt": c.created_at.isoformat()} for c in rows],
            "total": total, "page": page, "pageSize": pageSize}


@router.get("/api/connections/{cid}/reveal")
def reveal_connection(cid: str, db: Session = Depends(get_db),
                      _user: dict = Depends(require_admin)):
    """08-27 用户反馈：编辑页眼睛可回显密钥。09 P0：仅 admin 可读（修复审计反例：
    viewer 可读密钥）。R4：含按环境覆盖的密钥。"""
    c = db.get(Connection, cid)
    if not c:
        raise HTTPException(404, "connection not found")
    env_secrets = {e.get("code"): decrypt_payload(e["secret_ref"])
                   for e in (c.environments or []) if e.get("secret_ref")}
    return {"secret": decrypt_payload(c.secret_ref) if c.secret_ref else "",
            "envSecrets": env_secrets}


@router.post("/api/connections/dry-run-sign")
def dry_run_sign(body: DryRunSign, _user: dict = Depends(require_admin)):
    """编辑器空跑：不落库、不打网络，仅返回鉴权产出头与脚本日志。"""
    try:
        kind = normalize_kind(body.kind)
        if kind == "script":
            headers, logs = run_auth_script(body.script or "", body.envVars)
        else:
            headers, logs = build_auth_headers(kind, body.secret if body.secret is not None else {}), []
    except AuthSignError as exc:
        raise HTTPException(400, str(exc))
    return {"headers": headers, "logs": logs}


@router.post("/api/connections/{cid}/test")
def test_connection(cid: str, payload: dict | None = None, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    c = db.get(Connection, cid)
    if not c:
        raise HTTPException(404, "connection not found")
    ok, err = _probe_connection(c, env=(payload or {}).get("env"))
    c.last_test_at = datetime.now(timezone.utc)
    c.status = "active" if ok else "failed"
    db.commit()
    return {"ok": ok, "error": err, "testedAt": c.last_test_at.isoformat()}


def _probe_connection(c, env: str | None = None) -> tuple[bool, str]:
    """09 P0：连接探测必须真实验证；缺 endpoint / 无法连通一律失败关闭
    （修复审计反例：空 endpoint 直接返回 True）。R4：按环境解析 endpoint/凭据，
    探测携带真实鉴权头，401/403 判失败（测试按钮能真正验出鉴权对错）。"""
    ep, payload, _code = resolve_for_request(c, env)
    base = ep.get("base_url", "")
    host = ep.get("host", "")
    if c.protocol in ("mysql", "postgresql"):
        if not host:
            return False, "缺少 host 配置"
        driver = {"mysql": "pymysql", "postgresql": "psycopg"}[c.protocol]
        try:
            mod = __import__(driver)
        except ImportError:
            return False, f"驱动 {driver} 未安装，无法真实探测"
        password = payload if isinstance(payload, str) else str((payload or {}).get("password", ""))
        try:
            if driver == "pymysql":
                conn = mod.connect(host=host, port=int(ep.get("port", 3306)),
                                   user=ep.get("user", ""), password=password,
                                   database=ep.get("database", ""), connect_timeout=5)
            else:
                conn = mod.connect(host=host, port=int(ep.get("port", 5432)),
                                   user=ep.get("user", ""), password=password,
                                   dbname=ep.get("database", ""))
            conn.close()
            return True, ""
        except Exception as exc:  # noqa: BLE001
            return False, f"连接失败：{exc}"
    if base.startswith(("http://", "https://")):
        from ..egress import EgressError, enforce_egress
        try:
            enforce_egress(base)
        except EgressError as exc:
            return False, str(exc)
        try:
            headers = build_auth_headers(c.kind, payload, script=c.auth_script,
                                         env_vars=payload if isinstance(payload, dict) else None)
        except AuthSignError as exc:
            return False, str(exc)
        try:
            with httpx.Client(timeout=5, follow_redirects=False) as client:
                r = client.get(base, headers=headers)
            if r.status_code in (401, 403):
                return False, f"鉴权失败（HTTP {r.status_code}）"
            if r.status_code >= 500:
                return False, f"HTTP {r.status_code}"
            return True, ""
        except Exception as exc:  # noqa: BLE001
            return False, str(exc)
    return False, "缺少可用 endpoint（无 host/base_url），无法探测"


@router.delete("/api/connections/{cid}")
def delete_connection(cid: str, db: Session = Depends(get_db),
                        _user: dict = Depends(require_admin)):
    from ..resource_registry import assert_deletable
    if not db.get(Connection, cid):
        raise HTTPException(404, "connection not found")
    # 08-27 用户反馈：连接始终可删——先解绑全部引用方（provider/tool/mcp/datasource）再删
    from ..models import Datasource, McpServer, ModelProvider, Tool
    for prov in db.query(ModelProvider).filter_by(auth_connection_id=cid).all():
        prov.auth_connection_id = None
    for t in db.query(Tool).filter_by(connection_id=cid).all():
        t.connection_id = None
    for m in db.query(McpServer).filter_by(connection_id=cid).all():
        m.connection_id = None
    for d in db.query(Datasource).filter_by(connection_id=cid).all():
        d.connection_id = None
    db.flush()
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


def _assert_no_mock_base(base_url: str) -> None:
    """09 P0-01：生产禁止注册/保留 mock:// Provider（审计反例）。"""
    from ..config import is_production
    if is_production() and str(base_url or "").startswith("mock://"):
        raise HTTPException(422, "生产环境禁止注册 mock:// Provider")


@router.post("/api/model-providers", status_code=201)
def create_provider(payload: dict, db: Session = Depends(get_db),
                        _user: dict = Depends(require_admin)):
    base_url = payload.get("baseUrl", "")
    _assert_no_mock_base(base_url)
    p = ModelProvider(name=payload["name"], base_url=base_url,
                      auth_connection_id=payload.get("connectionId"))
    db.add(p)
    db.commit()
    return {"id": p.id, "name": p.name}


@router.post("/api/models", status_code=201)
def create_model(payload: dict, db: Session = Depends(get_db),
                   _user: dict = Depends(require_admin)):
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
def create_tool(payload: dict, db: Session = Depends(get_db),
                        _user: dict = Depends(require_admin)):
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
def update_tool(tid: str, payload: dict, db: Session = Depends(get_db),
                        _user: dict = Depends(require_admin)):
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
def delete_tool(tid: str, db: Session = Depends(get_db),
                        _user: dict = Depends(require_admin)):
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
def test_tool(tid: str, payload: dict | None = None, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
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
def create_schedule(payload: dict, db: Session = Depends(get_db),
                        _user: dict = Depends(require_admin)):
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
def enable_schedule(sid: str, db: Session = Depends(get_db),
                        _user: dict = Depends(require_operator)):
    s = db.get(Schedule, sid)
    if not s:
        raise HTTPException(404, "定时任务不存在")
    s.enabled = True
    s.next_run_at = compute_next(s.cron_expr, s.timezone)
    db.commit()
    return {"id": sid, "enabled": True, "nextRunAt": s.next_run_at.isoformat()}


@router.post("/api/schedules/{sid}/disable")
def disable_schedule(sid: str, db: Session = Depends(get_db),
                        _user: dict = Depends(require_operator)):
    s = db.get(Schedule, sid)
    if not s:
        raise HTTPException(404, "定时任务不存在")
    s.enabled = False
    db.commit()
    return {"id": sid, "enabled": False}


@router.delete("/api/schedules/{sid}")
def delete_schedule(sid: str, db: Session = Depends(get_db),
                        _user: dict = Depends(require_admin)):
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
def retry_run(run_id: str, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    old = db.get(Run, run_id)
    if not old:
        raise HTTPException(404, "运行记录不存在")
    if old.agent_id:
        # E-3.2：Agent 运行重试走 run_agent（自主规划无工作流，此前直接 500）
        from ..agent_runtime import RunError, run_agent
        from ..legacy_agent_archive import assert_agent_executable
        from ..models import Agent
        a = db.get(Agent, old.agent_id)
        if not a:
            raise HTTPException(404, "该运行的 Agent 已不存在")
        assert_agent_executable(a)  # R-Archive：旧 Agent Run 不重放
        trigger = old.trigger if old.trigger in ("manual", "api", "schedule", "test") else "manual"
        try:
            new_id = run_agent(db, a, old.input or {}, trigger=trigger,
                               version_id=old.agent_version_id)
        except RunError as e:
            raise HTTPException(409, str(e))
        fresh = db.get(Run, new_id)
        fresh.origin_run_id = run_id
        db.commit()
        return {"runId": new_id, "originRunId": run_id}
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
def acquire_lock(payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
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
def force_release_lock(rid: str, db: Session = Depends(get_db),
                 _user: dict = Depends(require_admin) ):
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
def release_lock(rid: str, wsId: str = "", db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    from ..models import ResourceLock
    lock = db.get(ResourceLock, rid)
    if lock and lock.ws_id == wsId:
        db.delete(lock)
        db.commit()
    return {"ok": True}


# ---------- 删除 ----------

@router.delete("/api/agents/{aid}")
def delete_agent(aid: str, db: Session = Depends(get_db),
                        _user: dict = Depends(require_admin)):
    from ..models import Agent, AgentVersion, Release
    from ..legacy_agent_archive import assert_agent_executable
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "Agent 不存在")
    # R-Archive：旧 Agent 历史不可删除（SDD 10：不得不可恢复地删除源码/历史记录）
    assert_agent_executable(a)
    # SDD B：先清理部署记录与不可变版本（FK 级联），再删 Agent 本体
    audit(db, "质量管理员", "agent.delete", "agent", aid, {"name": a.name})
    db.query(Release).filter_by(agent_id=aid).delete()
    db.query(AgentVersion).filter_by(agent_id=aid).delete()
    db.delete(a)
    db.commit()
    return {"ok": True}


@router.delete("/api/workflows/{wid}")
def delete_workflow(wid: str, db: Session = Depends(get_db),
                        _user: dict = Depends(require_admin)):
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
def create_model(payload: dict, db: Session = Depends(get_db),
                   _user: dict = Depends(require_admin)):
    m = Model(provider_id=payload["providerId"], model_key=payload["modelKey"],
              display_name=payload.get("displayName", payload["modelKey"]),
              capabilities=payload.get("capabilities", ["text"]))
    db.add(m)
    db.commit()
    return {"id": m.id, "modelKey": m.model_key}


@router.delete("/api/models/{mid}")
def delete_model(mid: str, db: Session = Depends(get_db),
                        _user: dict = Depends(require_admin)):
    m = db.get(Model, mid)
    if not m:
        raise HTTPException(404, "模型不存在")
    db.delete(m)
    db.commit()
    return {"ok": True}


# ---------- 质检业务层：quality_result / evidence ----------

_DIM_KEYS = ["department", "team", "brand", "productCategory", "issue", "requestType", "serviceType"]


def _dim_sql(key: str):
    """09 P1-10：业务维度的 SQL 表达式（与 _quality_dims 的取值优先级一致）。

    取值优先级：run.input → structured_output → businessContext → org；"-" 视为空。
    供列表筛选在数据库侧完成，不再全表载入 Python。"""
    from sqlalchemy import func as _f
    from ..models import QualityResult, Run
    so = QualityResult.structured_output
    org_field = "teamName" if key == "team" else ("agentName" if key == "agent" else key)
    if key == "agent":  # 坐席名：org.agentName → agentName → agent
        cands = [so[("org", "agentName")].astext, so["agentName"].astext, so["agent"].astext,
                 Run.input["agentName"].astext]
    else:
        cands = [Run.input[key].astext, so[key].astext,
                 so[("businessContext", key)].astext, so[("org", org_field)].astext]
    return _f.coalesce(*[_f.nullif(c, "-") for c in cands], "")


def _quality_dims(r, run) -> dict:
    """E-1.1：质量结果的业务维度真实来源（词表聚合与列表筛选共用）：
    run.input → structured_output → businessContext 依次合并，另取 org 块与坐席名。"""
    so = r.structured_output if isinstance(r.structured_output, dict) else {}
    bc = so.get("businessContext") if isinstance(so.get("businessContext"), dict) else {}
    org = so.get("org") if isinstance(so.get("org"), dict) else {}
    src = {**(run.input if run is not None and isinstance(run.input, dict) else {}), **so, **bc}
    dims: dict[str, str] = {}
    for k in _DIM_KEYS:
        v = src.get(k) or (org.get("teamName") if k == "team" else org.get(k))
        dims[k] = str(v) if v and str(v) != "-" else ""
    a = org.get("agentName") or src.get("agentName") or src.get("agent")
    dims["agent"] = str(a) if a and str(a) != "-" else ""
    return dims


@router.get("/api/quality-results")
def list_quality_results(page: int = 1, pageSize: int = 20, review: str = "",
                         tab: str = "", search: str = "", criterion: str = "", risk: str = "",
                         quality: str = "", time: str = "", sort: str = "time:desc",
                         reviewStatus: str = "", serviceType: str = "", team: str = "",
                         department: str = "", agent: str = "", brand: str = "",
                         productCategory: str = "", issue: str = "", requestType: str = "",
                         db: Session = Depends(get_db),
                         user: dict = Depends(require_role())):
    """E-1.1：筛选参数真落地（此前前端筛选不进后端）：列内条件走 SQL，业务维度走真实数据扫描。
    P2-02：team 数据范围按任务创建者归属强制（无任务归属的行对 team 范围不可见）。"""
    from datetime import datetime, timedelta, timezone
    from ..models import AnalysisTask, QualityResult, Run
    q = db.query(QualityResult)
    members = data_scope_members(db, user)
    if members is not None:
        q = q.join(AnalysisTask, QualityResult.task_id == AnalysisTask.id) \
            .filter(AnalysisTask.created_by.in_(members))
    if tab == "pending":
        q = q.filter(QualityResult.review_status == "AI")
    elif tab == "reviewed":
        q = q.filter(QualityResult.review_status.in_(["REVIEWED", "EFFECTIVE"]))
    elif review:
        q = q.filter(QualityResult.review_status == review)
    if reviewStatus == "待复核":
        q = q.filter(QualityResult.review_status == "AI")
    elif reviewStatus == "已复核":
        q = q.filter(QualityResult.review_status.in_(["REVIEWED", "EFFECTIVE"]))
    elif reviewStatus == "AI/人工不一致":
        q = q.filter(QualityResult.id.in_([]))  # 数据模型暂无不一致标记：诚实空结果
    if risk:
        q = q.filter(QualityResult.risk == risk)
    if quality == "有问题":
        q = q.filter(QualityResult.issue_count > 0)
    elif quality == "Critical":
        q = q.filter(QualityResult.risk == "Critical")
    if criterion:
        q = q.filter(QualityResult.issue_summary.ilike(f"%{criterion}%"))
    if search:
        like = f"%{search}%"
        q = q.filter(or_(QualityResult.interaction_ref.ilike(like),
                         QualityResult.issue_summary.ilike(like)))
    if time == "今日":
        q = q.filter(QualityResult.interaction_time >= datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0))
    elif time == "近7日":
        q = q.filter(QualityResult.interaction_time >= datetime.now(timezone.utc) - timedelta(days=7))
    elif time == "近30日":
        q = q.filter(QualityResult.interaction_time >= datetime.now(timezone.utc) - timedelta(days=30))
    # 09 P1-10：业务维度筛选下推 SQL（JSONB 提取 + outerjoin Run），不再全表进 Python
    dim_filters = {"serviceType": serviceType, "team": team, "department": department,
                   "agent": agent, "brand": brand, "productCategory": productCategory,
                   "issue": issue, "requestType": requestType}
    dim_filters = {k: v for k, v in dim_filters.items() if v and v != "__all__"}
    if dim_filters:
        q = q.outerjoin(Run, QualityResult.run_id == Run.id)
        for k, v in dim_filters.items():
            q = q.filter(_dim_sql(k) == v)
    total = q.count()
    if sort == "time:asc":
        q = q.order_by(QualityResult.interaction_time.asc())
    elif sort == "score:desc":
        q = q.order_by(QualityResult.score.desc().nullslast())
    elif sort == "score:asc":
        q = q.order_by(QualityResult.score.asc().nullslast())
    elif sort == "risk:desc":
        q = q.order_by(case((QualityResult.risk == "Critical", 4), (QualityResult.risk == "High", 3),
                            (QualityResult.risk == "Medium", 2), (QualityResult.risk == "Low", 1)).desc())
    else:
        q = q.order_by(QualityResult.interaction_time.desc())
    rows = q.offset((page - 1) * pageSize).limit(pageSize).all()
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


@router.get("/api/quality/vocab")
def quality_vocab(db: Session = Depends(get_db)):
    """E-1.1：筛选词表真实来源——聚合质量结果/运行输入的去重值 + 已发布结果规则目录（替代前端 mocks catalog）。"""
    from ..models import QualityResult, Run
    acc: dict[str, set[str]] = {k: set() for k in _DIM_KEYS}
    agents: set[str] = set()
    rows = db.query(QualityResult).limit(2000).all()
    runs = {r.id: r for r in db.query(Run).filter(Run.id.in_([x.run_id for x in rows if x.run_id] or ["-"]))}
    for r in rows:
        dims = _quality_dims(r, runs.get(r.run_id or ""))
        for k in _DIM_KEYS:
            if dims[k]:
                acc[k].add(dims[k])
        if dims["agent"]:
            agents.add(dims["agent"])
    # P0-B1：criteria 来自当前冻结的活跃规则版本（不再扫 ruleset 行）
    from .business import active_rule_version
    rv = active_rule_version(db)
    criteria = [{"criterion": str(x.get("criterion") or ""), "severity": str(x.get("severity") or "Medium")}
                for x in ((rv.rules or {}).get("issueRules", []) if rv else []) if x.get("criterion")]
    return {k: sorted(v) for k, v in acc.items()} | {
        "agents": sorted(agents), "criteria": criteria}


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
    # 09 P0-B1：复核修订链（只追加）+ AI 原始值回查
    from ..models import ReviewRevision
    revs = db.query(ReviewRevision).filter_by(quality_result_id=r.id)\
        .order_by(ReviewRevision.revision_no.asc()).all()
    return {"id": r.id, "runId": r.run_id, "interactionId": r.interaction_ref,
            "interactionTime": r.interaction_time.isoformat(), "agentName": agent_name,
            "structuredOutput": r.structured_output, "score": r.score, "risk": r.risk,
            "critical": r.critical, "issueCount": r.issue_count, "issueSummary": r.issue_summary,
            "review": r.review_status,
            # 09 §9.6：追踪与版本链
            "taskRunId": r.task_run_id, "taskId": r.task_id, "taskVersionId": r.task_version_id,
            "workflowVersionId": r.workflow_version_id,
            "ruleVersionId": r.rule_version_id,
            "outputSchemaVersionId": r.output_schema_version_id,
            "aiResult": r.ai_result, "derivedResult": r.derived_result,
            "reviewRevisions": [{"id": v.id, "revisionNo": v.revision_no, "action": v.action,
                                 "reason": v.reason, "reviewer": v.reviewer_id,
                                 "before": v.before, "after": v.after,
                                 "createdAt": v.created_at.isoformat()} for v in revs],
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
def create_eval_sample(payload: dict, db: Session = Depends(get_db),
                        _user: dict = Depends(require_operator)):
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
def delete_eval_sample(sid: str, db: Session = Depends(get_db),
                        _user: dict = Depends(require_admin)):
    from ..models import EvalSample
    s = db.get(EvalSample, sid)
    if not s:
        raise HTTPException(404, "样本不存在")
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.post("/api/workflows/{wid}/eval-run")
def eval_run(wid: str, payload: dict | None = None, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
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
def human_score_sample(sid: str, payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
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


@router.get("/api/ops/slo")
def ops_slo(db: Session = Depends(get_db), _user: dict = Depends(require_role())):
    """P2-09/§15.1：SLO 草稿目标 + 可测项测量对比；不可测项显式注记（不造假结论）。"""
    from ..slo import SLO_DRAFT_NOTE, SLO_TARGETS, measure
    return {"note": SLO_DRAFT_NOTE, "targets": SLO_TARGETS, "measured": measure(db)}
