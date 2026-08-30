"""SDD-12 P0-04：配置指纹、CheckRun 记录、启用门禁与健康度派生。

不变量（§3.2 / AR-04）：Test 与正式运行共用同一解析/执行路径；启用（enable）
只信任服务端写下的 CheckRun，不信任任何客户端自报字段（`tested: true` 等）。

健康度派生规则（§11.2，读时计算，不落假绿灯）：
- 无任何检查记录 → untested（H-02：不得显示 healthy）
- 最近检查指纹 ≠ 当前配置指纹 → stale（C-03：config/Secret 变化立即降级）
- 指纹一致的最近检查：succeeded→healthy / partial→degraded / failed→failed
"""
from __future__ import annotations

import hashlib
import json
import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .contracts import error_detail
from .models import (CheckRun, Connection, Datasource, KnowledgeSource, McpServer,
                     Model, ModelProvider, Tool, ToolVersion)


def _hash(payload) -> str:
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode()
    ).hexdigest()


def new_trace_id() -> str:
    return uuid.uuid4().hex


# ---------- 配置指纹 ----------

def _conn_secret_state(conn) -> dict:
    """Connection 影响运行时的凭据/端点状态（只取引用与配置，绝不包含解密内容）。"""
    return {"endpoint": conn.endpoint or {}, "secretRef": conn.secret_ref or "",
            "kind": conn.kind, "authScript": conn.auth_script or "",
            "environments": conn.environments or [], "defaultEnv": conn.default_env or ""}


def connection_env_fingerprint(conn, env_code: str | None = None) -> str:
    """某环境（缺省=默认环境）生效配置指纹：endpoint/凭据引用/鉴权方式任一变化即变。"""
    envs = conn.environments or []
    code = env_code if env_code is not None else (
        conn.default_env or (envs[0].get("code") if envs else None))
    entry = next((e for e in envs if e.get("code") == code), None) if code else None
    endpoint = dict(entry["endpoint"]) if entry and entry.get("endpoint") else dict(conn.endpoint or {})
    ref = (entry.get("secret_ref") if entry else None) or conn.secret_ref or ""
    return _hash({"protocol": conn.protocol, "kind": conn.kind, "env": code or "",
                  "endpoint": endpoint, "secretRef": ref,
                  "authScript": conn.auth_script or ""})


def connection_current_fingerprint(conn) -> str:
    return connection_env_fingerprint(conn, None)


def resource_fingerprint(db: Session, rtype: str, obj) -> str:
    """资源当前配置指纹：绑定 Connection 的凭据状态一并纳入（Secret 轮换连带 stale）。"""
    conn_state = {}
    cid = getattr(obj, "connection_id", None)
    if cid:
        conn = db.get(Connection, cid)
        if conn:
            conn_state = _conn_secret_state(conn)
    if rtype == "tool":
        tv = db.query(ToolVersion).filter_by(tool_id=obj.id)\
            .order_by(ToolVersion.version_no.desc()).first()
        return _hash({"type": "tool", "connection": conn_state,
                      "spec": tv.spec if tv else {}, "versionNo": tv.version_no if tv else 0,
                      "inputSchema": tv.input_schema if tv else {},
                      "outputSchema": tv.output_schema if tv else {}})
    if rtype == "model":
        prov = db.get(ModelProvider, obj.provider_id) if obj.provider_id else None
        return _hash({"type": "model", "modelKey": obj.model_key,
                      "capabilities": obj.capabilities or [],
                      "defaultParams": obj.default_params or {},
                      "provider": {"baseUrl": prov.base_url if prov else "",
                                   "authConnectionId": prov.auth_connection_id if prov else ""}})
    if rtype == "mcp":
        return _hash({"type": "mcp", "transport": obj.transport, "command": obj.command,
                      "envKeys": sorted((obj.env or {}).keys()), "connection": conn_state})
    if rtype == "knowledge":
        return _hash({"type": "knowledge", "kind": obj.kind,
                      "embeddingModelId": obj.embedding_model_id or "",
                      "sourceConfig": obj.source_config or {}})
    if rtype == "datasource":
        return _hash({"type": "datasource", "dsType": obj.type, "location": obj.location,
                      "config": obj.config or {}, "connection": conn_state})
    if rtype == "asset":
        return _hash({"type": "asset", "datasourceId": obj.datasource_id or "",
                      "location": obj.location, "timeField": obj.time_field,
                      "recordIdField": obj.record_id_field,
                      "rowsDigest": _hash(obj.rows or [])})
    return _hash({"type": rtype, "id": getattr(obj, "id", "")})


# ---------- CheckRun 记录 ----------

def record_check(db: Session, *, scope: str, target_id: str, purpose: str,
                 ok: bool, fingerprint: str, env_code: str = "", latency_ms: int | None = None,
                 error: dict | None = None, diagnostics: dict | None = None,
                 actor: str = "", partial: bool = False) -> CheckRun:
    run = CheckRun(scope=scope, target_id=target_id, env_code=env_code or "",
                   purpose=purpose,
                   status="succeeded" if ok else ("partial" if partial else "failed"),
                   latency_ms=latency_ms, error=error,
                   diagnostics={k: v for k, v in (diagnostics or {}).items()
                                if k in ("statusCode", "stage", "driver", "toolCount",
                                         "sampled", "fixture")},
                   config_fingerprint=fingerprint, trace_id=new_trace_id(), actor=actor)
    db.add(run)
    db.commit()
    return run


def latest_check(db: Session, scope: str, target_id: str,
                 env_code: str | None = None) -> CheckRun | None:
    q = db.query(CheckRun).filter_by(scope=scope, target_id=target_id)
    if env_code is not None:
        q = q.filter(CheckRun.env_code == env_code)
    return q.order_by(CheckRun.created_at.desc()).first()


def health_of_check(last: CheckRun | None, current_fingerprint: str) -> str:
    if last is None:
        return "untested"
    if last.config_fingerprint != current_fingerprint:
        return "stale"
    return {"succeeded": "healthy", "partial": "degraded"}.get(last.status, "failed")


def connection_health(db: Session, conn) -> str:
    """连接级健康（按默认环境最近检查派生；未检查=untested，配置变化=stale）。"""
    code = conn.default_env or ((conn.environments or [{}])[0].get("code")
                                if conn.environments else "")
    last = latest_check(db, "connection", conn.id, env_code=code or "")
    return health_of_check(last, connection_env_fingerprint(conn, code or None))


def connection_env_health(db: Session, conn, env_code: str) -> str:
    last = latest_check(db, "connection", conn.id, env_code=env_code)
    return health_of_check(last, connection_env_fingerprint(conn, env_code))


def resource_health(db: Session, rtype: str, obj) -> str:
    """资源健康（读时派生）：未测试=untested；配置/绑定变化=stale；否则最近检查结果。"""
    fp = resource_fingerprint(db, rtype, obj)
    last = latest_check(db, "resource", obj.id)
    return health_of_check(last, fp)


# ---------- 启用门禁（只信服务端 CheckRun） ----------

def assert_check_gate(db: Session, *, scope: str, target_id: str, fingerprint: str,
                      env_code: str = "", unchecked_code: str = "CONNECTION_UNCHECKED") -> CheckRun:
    """启用/转正前强制：当前指纹存在最近成功检查。

    - 无记录 → 422 + unchecked_code（连接为 CONNECTION_UNCHECKED）
    - 指纹漂移 → 409 RESOURCE_HEALTH_STALE（config/Secret 改动后须重新检查）
    - 最近检查失败 → 409 + 失败原因（不含凭据）
    """
    env_filter = (env_code or "") if scope == "connection" else None
    last = latest_check(db, scope, target_id, env_code=env_filter)
    if last is None:
        raise HTTPException(422, error_detail(
            unchecked_code, "尚未通过真实检查，不能启用；请先执行检查/测试",
            details={"scope": scope, "targetId": target_id, "reason": "untested"}))
    if last.config_fingerprint != fingerprint:
        raise HTTPException(409, error_detail(
            "RESOURCE_HEALTH_STALE", "配置或凭据已变化，最近检查结果失效；请重新检查后再启用",
            details={"scope": scope, "targetId": target_id,
                     "lastCheckedAt": last.created_at.isoformat()}))
    if last.status != "succeeded":
        code = "CONNECTION_AUTH_FAILED" if (last.error or {}).get("stage") == "auth" else unchecked_code
        raise HTTPException(409, error_detail(
            code, "最近一次检查未通过，不能启用",
            details={"scope": scope, "targetId": target_id,
                     "error": (last.error or {}).get("message", ""),
                     "checkRunId": last.id}))
    return last
