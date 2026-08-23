"""Resource Registry — 六类强类型资源之上的统一门面（注册/查询/状态/引用/删除防护）。

不建万能 Resource 表；每类资源保持独立表，本模块提供统一 DTO 与引用扫描。
引用链（Frozen）：Agent → Workflow → Version → Node Config → Resource。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import (AnalysisTask, CallRecord, Connection, DataAsset, DataDefinition,
                     Datasource, EvalSample, KnowledgeSource, McpServer, Model,
                     ModelProvider, ResourceChangeLog, Tool, ToolVersion, Workflow,
                     WorkflowVersion)

AI_TYPES = ("model", "tool", "mcp", "knowledge")
DATA_TYPES = ("datasource", "asset")
TYPES = AI_TYPES + DATA_TYPES

CLS = {"model": Model, "tool": Tool, "mcp": McpServer, "knowledge": KnowledgeSource,
       "datasource": Datasource, "asset": DataAsset}


def _status_of(obj) -> str:
    if isinstance(obj, Model):
        return "enabled" if obj.enabled else "disabled"
    if isinstance(obj, DataAsset):
        return "disabled" if obj.lifecycle == "Deprecated" else "enabled"
    return obj.status or "enabled"


def _health_of(obj) -> str:
    return getattr(obj, "health", "healthy") or "healthy"


def calls_7d(db: Session, target_id: str) -> int:
    since = datetime.now(timezone.utc) - timedelta(days=7)
    return int(db.execute(select(func.count(CallRecord.id)).where(
        CallRecord.target_id == target_id, CallRecord.created_at >= since)).scalar() or 0)


def _tool_version_ids(db: Session, tool_id: str) -> list[str]:
    return [v.id for v in db.execute(select(ToolVersion).where(ToolVersion.tool_id == tool_id)).scalars()]


def _scan_node_refs(db: Session, match) -> list[dict]:
    """扫描全部 Workflow 草稿 + 已发布 Version 的节点 config，match(config) 返回节点名/True。"""
    refs: list[dict] = []
    for wf in db.query(Workflow).all():
        for n in (wf.draft_definition or {}).get("graph", {}).get("nodes", []):
            if match(n.get("config") or {}):
                refs.append({"kind": "workflow_node", "workflowId": wf.id, "workflowName": wf.name,
                             "version": "draft", "nodeId": n.get("id"), "nodeName": n.get("name")})
    for v in db.query(WorkflowVersion).all():
        for n in (v.definition or {}).get("graph", {}).get("nodes", []):
            if match(n.get("config") or {}):
                refs.append({"kind": "workflow_node", "workflowId": v.workflow_id,
                             "workflowName": db.get(Workflow, v.workflow_id).name if db.get(Workflow, v.workflow_id) else v.workflow_id,
                             "version": f"v{v.version_no}", "nodeId": n.get("id"), "nodeName": n.get("name")})
    return refs


def references(db: Session, rtype: str, rid: str) -> list[dict]:
    refs: list[dict] = []
    if rtype == "model":
        refs += _scan_node_refs(db, lambda c: ((c.get("modelRef") or {}).get("modelId") == rid)
                                or ((c.get("modelRef") or {}).get("modelKey") == rid))
        for ks in db.execute(select(KnowledgeSource).where(KnowledgeSource.embedding_model_id == rid)).scalars():
            refs.append({"kind": "knowledge_embedding", "label": ks.name, "id": ks.id})
    elif rtype == "tool":
        vids = set(_tool_version_ids(db, rid))
        refs += _scan_node_refs(db, lambda c: c.get("toolVersionId") in vids or c.get("toolVersionId") == rid)
    elif rtype == "mcp":
        refs += _scan_node_refs(db, lambda c: c.get("mcpServerId") == rid)
    elif rtype == "knowledge":
        refs += _scan_node_refs(db, lambda c: c.get("knowledgeSourceId") == rid)
    elif rtype == "datasource":
        for a in db.execute(select(DataAsset).where(DataAsset.datasource_id == rid)).scalars():
            refs.append({"kind": "data_asset", "label": a.name, "id": a.id})
    elif rtype == "asset":
        for d in db.execute(select(DataDefinition).where(DataDefinition.data_asset_id == rid)).scalars():
            refs.append({"kind": "data_definition", "label": d.name, "id": d.id})
        for t in db.execute(select(AnalysisTask).where(AnalysisTask.data_asset_id == rid)).scalars():
            refs.append({"kind": "analysis_task", "label": t.name, "id": t.id})
        for s in db.execute(select(EvalSample).where(EvalSample.data_asset_id == rid)).scalars():
            refs.append({"kind": "eval_sample", "label": s.name, "id": s.id})
    elif rtype == "definition":
        for t in db.execute(select(AnalysisTask).where(AnalysisTask.data_definition_id == rid)).scalars():
            refs.append({"kind": "analysis_task", "label": t.name, "id": t.id})
    elif rtype == "connection":
        for t in db.execute(select(Tool).where(Tool.connection_id == rid)).scalars():
            refs.append({"kind": "tool", "label": t.name, "id": t.id})
        for m in db.execute(select(McpServer).where(McpServer.connection_id == rid)).scalars():
            refs.append({"kind": "mcp_server", "label": m.name, "id": m.id})
        for d in db.execute(select(Datasource).where(Datasource.connection_id == rid)).scalars():
            refs.append({"kind": "datasource", "label": d.name, "id": d.id})
        for p in db.execute(select(ModelProvider).where(ModelProvider.auth_connection_id == rid)).scalars():
            refs.append({"kind": "model_provider", "label": p.name, "id": p.id})
    return refs


def assert_deletable(db: Session, rtype: str, rid: str) -> None:
    refs = references(db, rtype, rid)
    if refs:
        raise HTTPException(409, {"message": "使用中的资源不允许删除", "refs": refs})


def log_change(db: Session, rtype: str, rid: str, action: str, actor: str = "", detail: dict | None = None) -> None:
    db.add(ResourceChangeLog(resource_type=rtype, resource_id=rid, action=action,
                             actor=actor or "质量管理员", detail=detail or {}))
    db.commit()


def change_log(db: Session, rtype: str, rid: str) -> list[dict]:
    rows = db.execute(select(ResourceChangeLog).where(
        ResourceChangeLog.resource_type == rtype, ResourceChangeLog.resource_id == rid)
        .order_by(ResourceChangeLog.created_at.desc())).scalars().all()
    return [{"action": r.action, "actor": r.actor, "detail": r.detail,
             "at": r.created_at.isoformat()} for r in rows]


def set_status(db: Session, rtype: str, rid: str, enabled: bool, actor: str = "") -> None:
    obj = db.get(CLS[rtype], rid)
    if not obj:
        raise HTTPException(404, "资源不存在")
    if isinstance(obj, Model):
        obj.enabled = enabled
    elif isinstance(obj, DataAsset):
        obj.lifecycle = "Ready" if enabled else "Deprecated"
    else:
        obj.status = "enabled" if enabled else "disabled"
    db.commit()
    log_change(db, rtype, rid, "enable" if enabled else "disable", actor)


def _conn_name(db: Session, cid: str | None) -> str:
    if not cid:
        return ""
    c = db.get(Connection, cid)
    return c.name if c else ""


def _name_of(obj) -> str:
    return obj.display_name if isinstance(obj, Model) else obj.name


def to_dto(db: Session, rtype: str, obj) -> dict:
    ts = getattr(obj, "updated_at", None) or getattr(obj, "created_at", None)
    base = {"id": obj.id, "type": rtype, "name": _name_of(obj),
            "description": getattr(obj, "description", "") or "",
            "status": _status_of(obj), "health": _health_of(obj),
            "updatedAt": ts.isoformat() if ts else ""}
    meta: dict = {}
    usage: dict = {"refCount": len(references(db, rtype, obj.id)), "calls7d": 0}
    if rtype == "model":
        prov = db.get(ModelProvider, obj.provider_id)
        meta = {"provider": prov.name if prov else "", "modelKey": obj.model_key,
                "capabilities": obj.capabilities or [], "version": obj.version}
        usage["calls7d"] = calls_7d(db, obj.model_key)
    elif rtype == "tool":
        vs = db.execute(select(ToolVersion).where(ToolVersion.tool_id == obj.id)
                        .order_by(ToolVersion.version_no.desc())).scalars().first()
        meta = {"kind": obj.kind, "version": vs.version_no if vs else 1,
                "connection": _conn_name(db, obj.connection_id)}
        usage["calls7d"] = calls_7d(db, obj.id)
    elif rtype == "mcp":
        meta = {"transport": obj.transport, "tools": len(obj.discovered_tools or []),
                "endpoint": _conn_name(db, obj.connection_id) if obj.transport == "http" else (obj.command or "")}
        usage["calls7d"] = calls_7d(db, obj.id)
    elif rtype == "knowledge":
        emb = db.get(Model, obj.embedding_model_id) if obj.embedding_model_id else None
        meta = {"kind": obj.kind, "slices": obj.slice_count,
                "embedding": emb.display_name if emb else ""}
        usage["calls7d"] = calls_7d(db, obj.id)
    elif rtype == "datasource":
        meta = {"dsType": obj.type, "location": obj.location,
                "connection": _conn_name(db, obj.connection_id),
                "lastCheckAt": obj.last_check_at.isoformat() if obj.last_check_at else None}
    elif rtype == "asset":
        ds = db.get(Datasource, obj.datasource_id) if obj.datasource_id else None
        meta = {"datasource": ds.name if ds else "内联数据", "location": obj.location,
                "recordMeaning": obj.record_meaning, "timeField": obj.time_field,
                "lifecycle": obj.lifecycle, "revision": obj.revision}
    base["metadata"] = meta
    base["usage"] = usage
    return base


def list_resources(db: Session, rtype: str, *, page: int = 1, page_size: int = 12,
                   search: str = "", status: str = "", health: str = "", ds_type: str = "") -> dict:
    cls = CLS[rtype]
    q = db.query(cls)
    if search:
        q = q.filter(cls.name.ilike(f"%{search}%"))
    if ds_type and rtype == "datasource":
        q = q.filter(Datasource.type == ds_type)
    order_col = getattr(cls, "updated_at", None) or getattr(cls, "created_at", None)
    rows = q.order_by(order_col.desc()).all() if order_col is not None else q.all()
    dtos = [to_dto(db, rtype, r) for r in rows]
    if status:
        dtos = [d for d in dtos if d["status"] == status]
    if health:
        dtos = [d for d in dtos if d["health"] == health]
    total = len(dtos)
    start = (page - 1) * page_size
    return {"items": dtos[start:start + page_size], "total": total, "page": page, "pageSize": page_size}
