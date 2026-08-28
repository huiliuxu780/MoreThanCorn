"""Runtime Provider 管理 API（SDD 10 §15.1 / R1-2）。

- Provider 是独立资源，禁止与 ModelProvider 合表；不接收明文 Secret（凭据仅经
  connectionId 引用现有 Connection/Secret 管理）；
- 统一错误结构 + RBAC（写操作 operator 起，disable 需 admin）+ AuditLog 留痕。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import require_admin, require_operator
from ..db import get_db
from ..models import AgentRuntimeProvider, Connection
from ..runtime_providers.registry import PROVIDER_KINDS, PROVIDER_STATUSES, probe_provider

router = APIRouter(prefix="/api/runtime-providers", tags=["runtime-providers"])


def _get_or_404(db: Session, provider_id: str) -> AgentRuntimeProvider:
    provider = db.get(AgentRuntimeProvider, provider_id)
    if not provider:
        raise HTTPException(404, detail={"code": "PROVIDER_NOT_FOUND",
                                         "message": "runtime provider 不存在"})
    return provider


def _validate_base_url(base_url: str) -> None:
    if not base_url.startswith(("http://", "https://")):
        raise HTTPException(422, detail={"code": "VALIDATION_FAILED",
                                         "message": "baseUrl 必须是 http(s) URL",
                                         "path": "baseUrl"})


def _summary(p: AgentRuntimeProvider) -> dict:
    return {"id": p.id, "name": p.name, "kind": p.kind, "baseUrl": p.base_url,
            "status": p.status, "contractVersion": p.contract_version,
            "capabilities": p.capabilities or {}, "healthStatus": p.health_status,
            "lastHealthAt": p.last_health_at.isoformat() if p.last_health_at else None,
            "connectionId": p.connection_id, "createdAt": p.created_at.isoformat()}


@router.post("", status_code=201)
def create_provider(payload: dict, db: Session = Depends(get_db),
                    user: dict = Depends(require_operator)):
    name = (payload.get("name") or "").strip()
    kind = payload.get("kind") or ""
    if not name:
        raise HTTPException(422, detail={"code": "VALIDATION_FAILED",
                                         "message": "name 必填", "path": "name"})
    if kind not in PROVIDER_KINDS:
        raise HTTPException(422, detail={"code": "VALIDATION_FAILED",
                                         "message": f"kind 必须是 {'|'.join(PROVIDER_KINDS)}",
                                         "path": "kind"})
    base_url = payload.get("baseUrl") or ""
    _validate_base_url(base_url)
    provider_id = payload.get("id")
    if provider_id:
        if len(provider_id) > 32 or db.get(AgentRuntimeProvider, provider_id):
            raise HTTPException(409, detail={"code": "PROVIDER_ID_EXISTS",
                                             "message": f"provider id {provider_id} 已存在"})
    connection_id = payload.get("connectionId")
    if connection_id and not db.get(Connection, connection_id):
        raise HTTPException(422, detail={"code": "VALIDATION_FAILED",
                                         "message": "connectionId 不存在", "path": "connectionId"})
    if isinstance(payload.get("config"), dict) and any(
            "key" in k.lower() or "secret" in k.lower() or "token" in k.lower()
            for k in (payload["config"] or {})):
        raise HTTPException(422, detail={"code": "VALIDATION_FAILED",
                                         "message": "config 禁止保存 API Key/Secret/Token"
                                                    "（请使用 connectionId 引用）",
                                         "path": "config"})
    provider = AgentRuntimeProvider(
        id=provider_id or None, name=name, kind=kind, base_url=base_url,
        connection_id=connection_id, status="draft",
        contract_version=str(payload.get("contractVersion") or "1.0"),
        capabilities=payload.get("capabilities") or {},
        config=payload.get("config") or {})
    db.add(provider)
    db.flush()
    from .admin import audit
    audit(db, user.get("username", "system"), "runtime_provider.create", "runtime_provider",
          provider.id, {"kind": kind, "baseUrl": base_url})
    db.commit()
    return _summary(provider)


@router.get("")
def list_providers(db: Session = Depends(get_db)):
    rows = db.query(AgentRuntimeProvider).order_by(AgentRuntimeProvider.created_at).all()
    return {"items": [_summary(p) for p in rows], "total": len(rows)}


@router.get("/{provider_id}")
def get_provider(provider_id: str, db: Session = Depends(get_db)):
    provider = _get_or_404(db, provider_id)
    detail = _summary(provider)
    detail["config"] = provider.config or {}
    return detail


@router.put("/{provider_id}")
def update_provider(provider_id: str, payload: dict, db: Session = Depends(get_db),
                    user: dict = Depends(require_operator)):
    provider = _get_or_404(db, provider_id)
    if "name" in payload:
        provider.name = (payload.get("name") or "").strip() or provider.name
    if "baseUrl" in payload:
        _validate_base_url(payload["baseUrl"])
        provider.base_url = payload["baseUrl"]
    if "connectionId" in payload:
        if payload["connectionId"] and not db.get(Connection, payload["connectionId"]):
            raise HTTPException(422, detail={"code": "VALIDATION_FAILED",
                                             "message": "connectionId 不存在",
                                             "path": "connectionId"})
        provider.connection_id = payload["connectionId"]
    if "status" in payload:
        status = payload["status"]
        if status not in PROVIDER_STATUSES:
            raise HTTPException(422, detail={"code": "VALIDATION_FAILED",
                                             "message": f"status 必须是 {'|'.join(PROVIDER_STATUSES)}",
                                             "path": "status"})
        provider.status = status
    if "contractVersion" in payload:
        provider.contract_version = str(payload["contractVersion"] or "1.0")
    if "config" in payload:
        provider.config = payload["config"] or {}
    from .admin import audit
    audit(db, user.get("username", "system"), "runtime_provider.update", "runtime_provider",
          provider_id, {k: payload[k] for k in payload if k in
                        ("name", "baseUrl", "connectionId", "status", "contractVersion")})
    db.commit()
    return _summary(provider)


@router.post("/{provider_id}/probe")
def probe(provider_id: str, db: Session = Depends(get_db),
          user: dict = Depends(require_operator)):
    """主动健康与 capability 验证：写回 health_status/last_health_at。"""
    provider = _get_or_404(db, provider_id)
    report = probe_provider(db, provider)
    from .admin import audit
    audit(db, user.get("username", "system"), "runtime_provider.probe", "runtime_provider",
          provider_id, {"ok": report.get("ok"),
                        "healthStatus": provider.health_status})
    db.commit()
    return report


@router.post("/{provider_id}/disable")
def disable_provider(provider_id: str, db: Session = Depends(get_db),
                     user: dict = Depends(require_admin)):
    """停用 Provider：只影响后续提交，不影响历史 Run（SDD 10 §15.1）。"""
    provider = _get_or_404(db, provider_id)
    previous = provider.status
    provider.status = "disabled"
    from .admin import audit
    audit(db, user.get("username", "system"), "runtime_provider.disable", "runtime_provider",
          provider_id, {"previousStatus": previous})
    db.commit()
    return _summary(provider)
