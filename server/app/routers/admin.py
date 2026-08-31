"""P2 管理面：Connections / Models / Tools / Schedules / Run retry+export / metrics。"""
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from ..auth import data_scope_members, require_admin, require_operator, require_role
from ..auth_sandbox import run_auth_script
from ..auth_signers import AuthSignError, build_auth_headers, normalize_kind
from ..check_runs import (connection_current_fingerprint, connection_env_fingerprint,
                          connection_env_health, connection_health, record_check)
from ..connection_runtime import resolve_for_request
from ..connection_schemas import ConnectionCreate, ConnectionUpdate, DryRunSign
from ..contracts import error_detail
from ..db import get_db
from ..models import (Connection, ConnectionSecretRevision, Model, ModelProvider, Run,
                      Schedule, Tool, ToolVersion)
from ..runner import RunError, compute_next, create_run, exec_tool
from ..secrets import encrypt_secret, serialize_secret
from .. import secret_ledger

router = APIRouter(tags=["admin"])

# SDD-12 §5.3：清除凭据的二次确认口令（B-03）
CLEAR_CONFIRM_TOKEN = "CLEAR_SECRET"


def _encrypt(secret: str) -> str:
    """09 P0-11：Secret 强制加密（失败关闭语义统一归 secrets.encrypt_secret）。"""
    try:
        return encrypt_secret(secret)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))


def _is_masked(secret) -> bool:
    """SDD-12 §5.4：缺省/空串/{}/'******' 均视为掩码=保留旧 secret_ref。"""
    return secret in (None, "", {}, "******")


def _env_rows_create(envs) -> list[dict]:
    """创建路径：EnvEntry 列表 → 落库形态（secret 明文加密为 secret_ref）。"""
    rows = []
    for e in envs or []:
        ref = None
        if not _is_masked(e.secret):
            ref = _encrypt(serialize_secret(e.secret))
        rows.append({"code": e.code, "label": e.label or e.code,
                     "endpoint": e.endpoint or {}, "secret_ref": ref})
    return rows


def _env_rows_patch(conn, patches) -> tuple[list[dict], list[str]]:
    """SDD-12 修复轮 A-03：环境按 code 做 **patch**，不是整体替换。

    - 未提交的环境整体保留（含 endpoint 与 secret_ref），绝不因"没出现在请求里"被删；
    - 字段级缺省（二次验收修复）：仅覆盖请求实际携带的字段（`model_fields_set`）——
      只改 label 不清空 endpoint，只改 endpoint 不覆盖 label；
    - 提交的环境在此路径绝不触碰 secret_ref（B-03：EnvPatch 已拒绝 secret/clearSecret
      字段，凭据写入只走专用高危端点）;
    - 仅显式 `remove=true` 删除环境（返回被删 codes，供账本退役与审计）。
    保持原顺序，新增环境追加末尾。返回 (新 rows, 被删 codes)。
    """
    merged = {e.get("code"): dict(e) for e in (conn.environments or [])}
    removed: list[str] = []
    for p in patches or []:
        if p.remove:
            if p.code in merged:
                removed.append(p.code)
            continue
        prev = merged.get(p.code) or {}
        submitted = p.model_fields_set
        row = {
            "code": p.code,
            # 缺省保留存量；新增环境 label 落到 code、endpoint 空
            "label": prev.get("label") or p.code,
            "endpoint": dict(prev.get("endpoint") or {}),
            "secret_ref": prev.get("secret_ref"),
        }
        if "label" in submitted:
            row["label"] = p.label or p.code
        if "endpoint" in submitted:
            row["endpoint"] = p.endpoint or {}
        merged[p.code] = row
    for code in removed:
        merged.pop(code, None)
    rows, seen = [], set()
    for e in (conn.environments or []):  # 原顺序优先
        code = e.get("code")
        if code in merged and code not in seen:
            rows.append(merged[code])
            seen.add(code)
    for code, row in merged.items():  # 新增环境追加
        if code not in seen:
            rows.append(row)
            seen.add(code)
    return rows, removed


# ---------- Connections ----------

def _actor(user: dict | None) -> str:
    from ..auth import actor_of
    return actor_of(user)


def _get_conn(db: Session, cid: str) -> Connection:
    c = db.get(Connection, cid)
    if not c:
        raise HTTPException(404, error_detail("CONNECTION_NOT_FOUND", "connection not found"))
    return c


@router.post("/api/connections", status_code=201)
def create_connection(payload: ConnectionCreate, db: Session = Depends(get_db),
                        user: dict = Depends(require_admin)):
    """SDD-12 C-01：新建默认 Draft，不需要客户端自报 tested；启用走 :enable 门禁。"""
    root_ref = "" if _is_masked(payload.secret) else _encrypt(serialize_secret(payload.secret))
    c = Connection(name=payload.name, kind=payload.kind, protocol=payload.protocol,
                   endpoint=payload.endpoint, environments=_env_rows_create(payload.environments),
                   default_env=payload.default_env, auth_script=payload.auth_script,
                   provider_hint=payload.providerHint,
                   secret_ref=root_ref,
                   lifecycle="draft", status="draft")
    db.add(c)
    db.flush()
    actor = _actor(user)
    # Secret 账本：根级与每个环境的初始 revision（v1）
    if not _is_masked(payload.secret):
        secret_ledger.record_initial(db, c, "", c.secret_ref, payload.secret, actor)
    for e in c.environments:
        if e.get("secret_ref"):
            src = next((x for x in payload.environments if x.code == e.get("code")), None)
            if src is not None and not _is_masked(src.secret):
                secret_ledger.record_initial(db, c, e["code"], e["secret_ref"], src.secret, actor)
    audit(db, actor, "connection.created", "connection", c.id,
          {"name": c.name, "protocol": c.protocol, "lifecycle": "draft"})
    db.commit()
    return {"id": c.id, "name": c.name, "kind": c.kind, "protocol": c.protocol,
            "status": c.status, "lifecycle": c.lifecycle, "revision": c.revision}


@router.put("/api/connections/{cid}")
def update_connection(cid: str, payload: ConnectionUpdate, db: Session = Depends(get_db),
                        user: dict = Depends(require_admin)):
    """编辑连接（SDD-12 P0-01/§5.4 + 修复轮 A-03/B-03/C-04）：

    - environments 为按 code 的 patch：未提交环境整体保留（含密钥）；
      仅显式 remove=true 删除；
    - PUT 不接受任何 Secret 写入/清除：根级显式拒绝，环境级由 EnvPatch
      （extra=forbid）拒绝；凭据变更一律走 /secret:rotate、/secret:clear（B-03）；
    - default_env 必须存在于合并后的环境集合，ghost 码拒绝落库（C-04）。
    """
    c = _get_conn(db, cid)
    if c.lifecycle == "archived":
        raise HTTPException(409, error_detail("CONNECTION_DISABLED", "已归档连接不可编辑"))
    if payload.secret is not None:
        raise HTTPException(422, error_detail(
            "VALIDATION_FAILED", "Secret 变更必须走专用轮换接口：POST /api/connections/{id}/secret:rotate",
            path="secret"))
    actor = _actor(user)
    # 二次验收修复：存在任何凭据（根级或任一环境）时拒绝非原子 kind 变更——
    # 旧凭据结构可能与新鉴权方式不兼容（如字符串 api_key → 需对象的 basic），
    # 会留下签名器无法使用的坏状态。需先按目标结构轮换/清除凭据，或新建连接。
    if payload.kind is not None and payload.kind != c.kind:
        has_secret = bool(c.secret_ref) or any(
            e.get("secret_ref") for e in (c.environments or []))
        if has_secret:
            raise HTTPException(422, error_detail(
                "VALIDATION_FAILED",
                "已配置凭据时不允许变更鉴权方式（kind）：存量凭据结构可能与新方式不兼容。"
                "请先清除凭据或按目标结构轮换，或新建连接",
                path="kind"))
    removed: list[str] = []
    if payload.environments is not None:
        rows, removed = _env_rows_patch(c, payload.environments)
        c.environments = rows
        for code in removed:
            # 被删环境若带凭据：退役其账本（引用指向连接级，环境码本身无外部引用）
            secret_ledger.clear(db, c, code, actor)
            audit(db, actor, "connection.env_removed", "connection", c.id, {"envCode": code})
    # C-04：default_env 对合并后的环境集合校验（未提交=保持不变）
    new_default = payload.default_env if payload.default_env is not None else c.default_env
    if payload.default_env is not None or payload.environments is not None:
        codes = [e.get("code") for e in (c.environments or [])]
        if new_default and new_default not in codes:
            raise HTTPException(422, error_detail(
                "VALIDATION_FAILED", f"default_env 必须是已配置的环境：{new_default}",
                path="default_env"))
        c.default_env = new_default
    if payload.name is not None:
        c.name = payload.name
    if payload.kind is not None:
        c.kind = payload.kind
    if payload.protocol is not None:
        c.protocol = payload.protocol
    if payload.endpoint is not None:
        c.endpoint = payload.endpoint
    if payload.auth_script is not None:
        c.auth_script = payload.auth_script
    if payload.providerHint is not None:
        c.provider_hint = payload.providerHint
    if payload.kind == "script" and not (c.auth_script or "").strip():
        raise HTTPException(422, error_detail("VALIDATION_FAILED", "script 鉴权必须提供鉴权脚本"))
    c.revision += 1  # 乐观锁推进（P1 PATCH If-Match 基座）
    audit(db, actor, "connection.updated", "connection", c.id,
          {"revision": c.revision, "envRemoved": removed})
    db.commit()
    return {"id": c.id, "name": c.name, "kind": c.kind, "protocol": c.protocol,
            "status": c.status, "lifecycle": c.lifecycle, "revision": c.revision}


@router.get("/api/connections")
def list_connections(page: int = 1, pageSize: int = 20, search: str = "", type: str = "",
                     lifecycle: str = "", db: Session = Depends(get_db)):
    # 确定性排序：否则测试连接更新行后物理位置漂移，前端"静默刷新"会看到列表重排（用户实测回归）
    q = db.query(Connection).order_by(Connection.created_at.desc())
    if search:
        q = q.filter(Connection.name.ilike(f"%{search}%"))
    if type:
        q = q.filter(Connection.protocol == type)
    if lifecycle:
        q = q.filter(Connection.lifecycle == lifecycle)
    total = q.count()
    rows = q.offset((page - 1) * pageSize).limit(pageSize).all()
    return {"items": [{"id": c.id, "name": c.name, "kind": c.kind, "protocol": c.protocol,
                       "endpoint": c.endpoint, "status": c.status,
                       "lifecycle": c.lifecycle, "health": connection_health(db, c),
                       "secretConfigured": bool(c.secret_ref),
                       "secretRevision": secret_ledger.revision_info(db, c.id, ""),
                       "environments": [{"code": e.get("code"), "label": e.get("label"),
                                         "endpoint": e.get("endpoint"),
                                         "secretConfigured": bool(e.get("secret_ref")),
                                         "secretRevision": secret_ledger.revision_info(db, c.id, e.get("code") or ""),
                                         "health": connection_env_health(db, c, e.get("code") or "")}
                                        for e in (c.environments or [])],
                       "defaultEnv": c.default_env,
                       "authScript": c.auth_script or "",
                       "providerHint": c.provider_hint,
                       "revision": c.revision,
                       "archivedAt": c.archived_at.isoformat() if c.archived_at else None,
                       "updatedAt": c.created_at.isoformat()} for c in rows],
            "total": total, "page": page, "pageSize": pageSize}


@router.get("/api/connections/{cid}")
def get_connection(cid: str, db: Session = Depends(get_db)):
    """SDD-12 §5.3：只返回凭据字段状态（configured/版本/轮换时间），永不回明文。"""
    c = _get_conn(db, cid)
    return {"id": c.id, "name": c.name, "kind": c.kind, "protocol": c.protocol,
            "endpoint": c.endpoint, "lifecycle": c.lifecycle,
            "health": connection_health(db, c), "status": c.status,
            "secretConfigured": bool(c.secret_ref),
            "secretRevision": secret_ledger.revision_info(db, c.id, ""),
            "environments": [{"code": e.get("code"), "label": e.get("label"),
                              "endpoint": e.get("endpoint"),
                              "secretConfigured": bool(e.get("secret_ref")),
                              "secretRevision": secret_ledger.revision_info(db, c.id, e.get("code") or ""),
                              "health": connection_env_health(db, c, e.get("code") or "")}
                             for e in (c.environments or [])],
            "defaultEnv": c.default_env, "authScript": c.auth_script or "",
            "providerHint": c.provider_hint, "revision": c.revision,
            "lastTestAt": c.last_test_at.isoformat() if c.last_test_at else None}


@router.get("/api/connections/{cid}/reveal")
def reveal_connection(cid: str, db: Session = Depends(get_db),
                      _user: dict = Depends(require_admin)):
    """SDD-12 §5.3 / B-01：产品面永久关闭 Secret 回显；兼容期路由恒 410。"""
    _ = db.get(Connection, cid)
    raise HTTPException(410, error_detail(
        "SECRET_REVEAL_DISABLED", "已保存的 Secret 不可回显；请通过轮换（rotate）更新凭据"))


class SecretRotatePayload(BaseModel):
    secret: str | dict = Field(description="新凭据明文（仅本请求传输，落库即加密）")
    envCode: str | None = Field(default=None, description="缺省=连接级根凭据")


@router.post("/api/connections/{cid}/secret:rotate")
def rotate_connection_secret(cid: str, payload: SecretRotatePayload,
                             db: Session = Depends(get_db),
                             user: dict = Depends(require_admin)):
    """SDD-12 §5.3：唯一写 Secret 的常规入口。旧 revision 退役，新 revision 生效。

    修复轮：按 Connection.kind 做与创建同源的凭据结构校验（禁止把结构化
    凭据轮换为普通字符串）；归档连接拒绝。
    """
    from ..connection_schemas import validate_secret_structure
    c = _get_conn(db, cid)
    if c.lifecycle == "archived":
        raise HTTPException(409, error_detail("CONNECTION_DISABLED", "已归档连接不可轮换凭据"))
    if _is_masked(payload.secret):
        raise HTTPException(422, error_detail("SECRET_REQUIRED", "轮换必须提供新凭据"))
    try:
        validate_secret_structure(c.kind, payload.secret)
    except ValueError as exc:
        raise HTTPException(422, error_detail("VALIDATION_FAILED", str(exc), path="secret")) from exc
    actor = _actor(user)
    env_code = payload.envCode or ""
    new_ref = _encrypt(serialize_secret(payload.secret))
    if env_code:
        if not _set_env_ref(c, env_code, new_ref):
            raise HTTPException(404, error_detail("VALIDATION_FAILED",
                                f"环境不存在：{env_code}", path="envCode"))
    else:
        c.secret_ref = new_ref
    rev = secret_ledger.rotate(db, c, env_code, new_ref, payload.secret, actor)
    c.revision += 1
    audit(db, actor, "secret.rotated", "connection", c.id,
          {"envCode": env_code, "versionNo": rev.version_no})
    db.commit()
    return {"ok": True, "envCode": env_code, "versionNo": rev.version_no,
            "rotatedAt": rev.created_at.isoformat()}


class SecretClearPayload(BaseModel):
    envCode: str | None = None
    confirm: str = Field(description=f"必须填写 {CLEAR_CONFIRM_TOKEN}（二次确认）")
    force: bool = Field(default=False, description="存在引用时强制清除（审计留痕）")


@router.post("/api/connections/{cid}/secret:clear")
def clear_connection_secret(cid: str, payload: SecretClearPayload,
                            db: Session = Depends(get_db),
                            user: dict = Depends(require_admin)):
    """SDD-12 §5.3 / B-03：admin + 二次确认 + 依赖检查 + 审计。归档连接拒绝。"""
    from ..resource_registry import references
    c = _get_conn(db, cid)
    if c.lifecycle == "archived":
        raise HTTPException(409, error_detail("CONNECTION_DISABLED", "已归档连接不可清除凭据"))
    if payload.confirm != CLEAR_CONFIRM_TOKEN:
        raise HTTPException(422, error_detail(
            "VALIDATION_FAILED", f"清除凭据为高危操作：confirm 必须为 {CLEAR_CONFIRM_TOKEN}",
            path="confirm"))
    refs = references(db, "connection", cid)
    if refs and not payload.force:
        raise HTTPException(409, error_detail(
            "REFERENCE_CONFLICT", "该连接仍被资源引用，清除凭据将导致其鉴权失败；"
                                   "确认影响后携带 force=true 重试",
            details={"refs": refs}) | {"refs": refs})
    actor = _actor(user)
    env_code = payload.envCode or ""
    if env_code:
        if not _set_env_ref(c, env_code, None):
            raise HTTPException(404, error_detail("VALIDATION_FAILED",
                                f"环境不存在：{env_code}", path="envCode"))
    else:
        c.secret_ref = ""
    retired = secret_ledger.clear(db, c, env_code, actor)
    c.revision += 1
    audit(db, actor, "secret.cleared", "connection", c.id,
          {"envCode": env_code, "retired": retired, "refCount": len(refs),
           "forced": bool(refs and payload.force)})
    db.commit()
    return {"ok": True, "envCode": env_code, "retired": retired}


def _set_env_ref(conn, env_code: str, ref: str | None) -> bool:
    """替换某环境的 secret_ref。

    注意：必须构造全新 dict 列表——原地改动 JSONB 缓存对象会让 SQLAlchemy
    比较不出差异、变更不落库（环境级轮换/清除静默丢失）。
    """
    rows, hit = [], False
    for e in (conn.environments or []):
        if e.get("code") == env_code:
            rows.append({**e, "secret_ref": ref})
            hit = True
        else:
            rows.append(dict(e))
    conn.environments = rows
    return hit


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
                 user: dict = Depends(require_operator)):
    """真实探测并写 CheckRun（SDD-12 P0-04）：启用门禁与健康度只信这条记录。

    探测不再改写生命周期（AR-07 生命周期/健康分离）；健康度由 CheckRun 派生。
    """
    c = _get_conn(db, cid)
    # SDD-12 修复轮（附加缺口）：归档连接不得再探测/写 CheckRun
    if c.lifecycle == "archived":
        raise HTTPException(409, error_detail("CONNECTION_DISABLED", "已归档连接不可测试"))
    env = (payload or {}).get("env")
    fp = connection_env_fingerprint(c, env)
    t0 = datetime.now(timezone.utc)
    ok, err, diag = _probe_connection(c, env=env)
    latency = int((datetime.now(timezone.utc) - t0).total_seconds() * 1000)
    code = c.default_env or ((c.environments or [{}])[0].get("code") if c.environments else "")
    run = record_check(db, scope="connection", target_id=c.id, env_code=env or code or "",
                       purpose="connectivity", ok=ok, fingerprint=fp, latency_ms=latency,
                       error={"message": err, "stage": diag.get("stage", "")} if err else None,
                       diagnostics=diag, actor=_actor(user))
    c.last_test_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": ok, "error": err, "testedAt": c.last_test_at.isoformat(),
            "checkRunId": run.id, "traceId": run.trace_id, "envCode": run.env_code,
            "latencyMs": latency, "configFingerprint": fp[:16],
            "diagnostics": run.diagnostics}


def _probe_connection(c, env: str | None = None) -> tuple[bool, str, dict]:
    """09 P0：连接探测必须真实验证；缺 endpoint / 无法连通一律失败关闭。

    SDD-12 C-06：返回 (ok, error, diagnostics)；diagnostics 只含脱敏阶段信息
    （stage/statusCode/driver），不含凭据与完整报文。
    """
    ep, payload, _code = resolve_for_request(c, env)
    base = ep.get("base_url", "")
    host = ep.get("host", "")
    if c.protocol in ("mysql", "postgresql"):
        if not host:
            return False, "缺少 host 配置", {"stage": "config"}
        driver = {"mysql": "pymysql", "postgresql": "psycopg"}[c.protocol]
        try:
            mod = __import__(driver)
        except ImportError:
            return False, f"驱动 {driver} 未安装，无法真实探测", {"stage": "driver", "driver": driver}
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
            return True, "", {"stage": "connected", "driver": driver}
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            stage = "auth" if any(k in msg.lower() for k in ("access denied", "password", "authentication")) else "connect"
            return False, f"连接失败：{msg}", {"stage": stage, "driver": driver}
    if base.startswith(("http://", "https://")):
        from ..egress import EgressError, enforce_egress
        try:
            enforce_egress(base)
        except EgressError as exc:
            return False, str(exc), {"stage": "egress"}
        try:
            headers = build_auth_headers(c.kind, payload, script=c.auth_script,
                                         env_vars=payload if isinstance(payload, dict) else None)
        except AuthSignError as exc:
            return False, str(exc), {"stage": "auth-build"}
        try:
            with httpx.Client(timeout=5, follow_redirects=False) as client:
                r = client.get(base, headers=headers)
            if r.status_code in (401, 403):
                return False, f"鉴权失败（HTTP {r.status_code}）", \
                    {"stage": "auth", "statusCode": r.status_code}
            if r.status_code >= 500:
                return False, f"HTTP {r.status_code}", \
                    {"stage": "capability", "statusCode": r.status_code}
            return True, "", {"stage": "capability", "statusCode": r.status_code}
        except Exception as exc:  # noqa: BLE001
            return False, str(exc), {"stage": "connect"}
    return False, "缺少可用 endpoint（无 host/base_url），无法探测", {"stage": "config"}


@router.post("/api/connections/{cid}:enable")
def enable_connection(cid: str, db: Session = Depends(get_db),
                      user: dict = Depends(require_admin)):
    """SDD-12 C-02：启用必须依赖当前配置指纹的真实成功 CheckRun。"""
    from ..check_runs import assert_check_gate
    c = _get_conn(db, cid)
    if c.lifecycle == "archived":
        raise HTTPException(409, error_detail("CONNECTION_DISABLED", "已归档连接不可启用"))
    env_code = c.default_env or ((c.environments or [{}])[0].get("code") if c.environments else "") or ""
    assert_check_gate(db, scope="connection", target_id=c.id,
                      fingerprint=connection_env_fingerprint(c, env_code or None),
                      env_code=env_code, unchecked_code="CONNECTION_UNCHECKED")
    c.lifecycle = "active"
    c.status = "active"
    audit(db, _actor(user), "connection.enabled", "connection", c.id, {"envCode": env_code})
    db.commit()
    return {"id": c.id, "lifecycle": c.lifecycle}


@router.post("/api/connections/{cid}:disable")
def disable_connection(cid: str, db: Session = Depends(get_db),
                       user: dict = Depends(require_admin)):
    c = _get_conn(db, cid)
    if c.lifecycle == "archived":
        raise HTTPException(409, error_detail("CONNECTION_DISABLED", "已归档连接不可停用"))
    c.lifecycle = "disabled"
    c.status = "disabled"
    audit(db, _actor(user), "connection.disabled", "connection", c.id, {})
    db.commit()
    return {"id": c.id, "lifecycle": c.lifecycle}


@router.delete("/api/connections/{cid}")
def delete_connection(cid: str, hard: bool = False, db: Session = Depends(get_db),
                        user: dict = Depends(require_admin)):
    """SDD-12 P0-03 / B-05～B-07：不再静默解绑。

    - 有引用 → 409 + 完整 refs（引用方不被改动）；
    - 默认执行归档（软删除，历史可查）；
    - 硬删除仅限无引用的 draft，并留审计。
    """
    from ..resource_registry import references
    c = _get_conn(db, cid)
    refs = references(db, "connection", cid)
    if refs:
        raise HTTPException(409, error_detail(
            "REFERENCE_CONFLICT", "该连接仍被以下资源引用，不允许删除；请先处理引用或改用停用/归档",
            details={"refs": refs}) | {"refs": refs})
    actor = _actor(user)
    if hard:
        if c.lifecycle != "draft":
            raise HTTPException(422, error_detail(
                "VALIDATION_FAILED", "硬删除仅限无引用的 draft 连接；其余一律归档",
                details={"lifecycle": c.lifecycle}))
        db.query(ConnectionSecretRevision).filter_by(connection_id=cid).delete()
        db.delete(c)
        audit(db, actor, "connection.hard_deleted", "connection", cid, {"name": c.name})
        db.commit()
        return {"ok": True, "hardDeleted": True}
    c.lifecycle = "archived"
    c.status = "archived"
    c.archived_at = datetime.now(timezone.utc)
    c.archived_by = actor
    audit(db, actor, "connection.archived", "connection", cid, {"name": c.name})
    db.commit()
    return {"ok": True, "lifecycle": "archived"}


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
    from .resources import _assert_not_echo_spec
    _assert_not_echo_spec(payload.get("spec", {"kind": "echo"}), payload)
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
    from .resources import _assert_not_echo_spec
    t = db.get(Tool, tid)
    if not t:
        raise HTTPException(404, "工具不存在")
    if payload.get("connectionId") is not None:
        t.connection_id = payload.get("connectionId")
    if payload.get("name") is not None:
        t.name = payload["name"]
    if payload.get("description") is not None:
        t.description = payload["description"]
    if not any(k in payload for k in ("spec", "inputSchema", "outputSchema")):
        db.commit()  # 审计 P0-6：元数据更新不生成空版本
        return {"id": tid}
    _assert_not_echo_spec(payload.get("spec", {}), payload)
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
