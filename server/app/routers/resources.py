"""资源管理路由 — AI Resources / Data Resources / Data Definitions / picker 供给。

契约见 uiux/03-backend-frontend-design.md §6。删除防护统一 409 + refs。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (Connection, DataAsset, DataDefinition, Datasource, KnowledgeSource,
                      McpServer, Model, Tool, ToolVersion)
from ..resource_registry import (AI_TYPES, DATA_TYPES, assert_deletable, change_log,
                                 list_resources, log_change, references, set_status, to_dto)
from ..resource_tests import run_test

router = APIRouter(tags=["resources"])

COLL = {"models": "model", "tools": "tool", "mcp-servers": "mcp",
        "knowledge-sources": "knowledge", "datasources": "datasource", "assets": "asset"}


def _rtype(coll: str) -> str:
    t = COLL.get(coll)
    if not t:
        raise HTTPException(404, "未知资源集合")
    return t


def _check_tested(payload: dict) -> bool:
    return bool(payload.get("tested"))


# ---------- 列表 / 创建 ----------

@router.get("/api/ai-resources/{coll}")
def list_ai(coll: str, page: int = 1, pageSize: int = 12, search: str = "",
            status: str = "", health: str = "", db: Session = Depends(get_db)):
    return list_resources(db, _rtype(coll), page=page, page_size=pageSize,
                          search=search, status=status, health=health)


@router.get("/api/data-resources/{coll}")
def list_data(coll: str, page: int = 1, pageSize: int = 12, search: str = "",
              status: str = "", health: str = "", type: str = "", db: Session = Depends(get_db)):
    return list_resources(db, _rtype(coll), page=page, page_size=pageSize,
                          search=search, status=status, health=health, ds_type=type)


@router.post("/api/ai-resources/{coll}", status_code=201)
def create_ai(coll: str, payload: dict, db: Session = Depends(get_db)):
    return _create(db, _rtype(coll), payload)


@router.post("/api/data-resources/{coll}", status_code=201)
def create_data(coll: str, payload: dict, db: Session = Depends(get_db)):
    return _create(db, _rtype(coll), payload)


def _create(db: Session, rtype: str, p: dict) -> dict:
    tested = _check_tested(p)
    if rtype == "model":
        if not p.get("providerId") or not p.get("modelKey"):
            raise HTTPException(422, "providerId / modelKey 必填")
        obj = Model(provider_id=p["providerId"], model_key=p["modelKey"],
                    display_name=p.get("name", p["modelKey"]),
                    capabilities=p.get("capabilities", ["text"]),
                    default_params=p.get("defaultParams", {}), enabled=tested)
    elif rtype == "tool":
        obj = Tool(name=p["name"], kind=p.get("kind", "builtin"),
                   connection_id=p.get("connectionId"), description=p.get("description", ""),
                   status="ready" if tested else "disabled")
        db.add(obj)
        db.commit()
        db.add(ToolVersion(tool_id=obj.id, version_no=1,
                           input_schema=p.get("inputSchema", {}),
                           output_schema=p.get("outputSchema", {}),
                           spec=p.get("spec", {"kind": "echo"})))
        db.commit()
        log_change(db, rtype, obj.id, "create", detail={"tested": tested})
        return {"id": obj.id, "name": obj.name, "status": obj.status}
    elif rtype == "mcp":
        if p.get("transport") not in ("stdio", "http"):
            raise HTTPException(422, "transport 必须为 stdio|http")
        obj = McpServer(name=p["name"], description=p.get("description", ""),
                        transport=p["transport"], command=p.get("command", ""),
                        connection_id=p.get("connectionId"), env=p.get("env", {}),
                        status="enabled" if tested else "disabled")
    elif rtype == "knowledge":
        obj = KnowledgeSource(name=p["name"], description=p.get("description", ""),
                              kind=p.get("kind", "vector"),
                              embedding_model_id=p.get("embeddingModelId"),
                              source_config=p.get("sourceConfig", {}),
                              status="enabled" if tested else "disabled")
    elif rtype == "datasource":
        if p.get("type") not in ("mysql", "postgresql", "oss", "http"):
            raise HTTPException(422, "datasource 类型非法")
        obj = Datasource(name=p["name"], description=p.get("description", ""),
                         type=p["type"], connection_id=p.get("connectionId"),
                         location=p.get("location", ""), config=p.get("config", {}),
                         status="enabled" if tested else "disabled")
    elif rtype == "asset":
        obj = DataAsset(name=p["name"], description=p.get("description", ""),
                        datasource_id=p.get("datasourceId"), location=p.get("location", ""),
                        record_meaning=p.get("recordMeaning", "一条业务记录"),
                        time_field=p.get("timeField", ""),
                        lifecycle="Ready" if tested else "Draft",
                        rows=p.get("rows", []))
    else:
        raise HTTPException(404, "未知资源类型")
    db.add(obj)
    db.commit()
    log_change(db, rtype, obj.id, "create", detail={"tested": tested})
    return {"id": obj.id, "name": getattr(obj, "display_name", None) or obj.name,
            "status": to_dto(db, rtype, obj)["status"]}


# ---------- 详情 / 更新 / 删除 / 状态 / 测试 / 引用 ----------

def _get_obj(db: Session, rtype: str, rid: str):
    from ..resource_registry import CLS
    obj = db.get(CLS[rtype], rid)
    if not obj:
        raise HTTPException(404, "资源不存在")
    return obj


@router.get("/api/ai-resources/{coll}/{rid}")
@router.get("/api/data-resources/{coll}/{rid}")
def get_resource(coll: str, rid: str, db: Session = Depends(get_db)):
    rtype = _rtype(coll)
    obj = _get_obj(db, rtype, rid)
    dto = to_dto(db, rtype, obj)
    dto["config"] = _config_of(db, rtype, obj)
    dto["changeLog"] = change_log(db, rtype, rid)
    return dto


def _config_of(db: Session, rtype: str, obj) -> dict:
    if rtype == "model":
        from ..models import ModelProvider
        prov = db.get(ModelProvider, obj.provider_id)
        return {"modelKey": obj.model_key, "provider": prov.name if prov else "",
                "baseUrl": prov.base_url if prov else "", "defaultParams": obj.default_params,
                "capabilities": obj.capabilities, "version": obj.version}
    if rtype == "tool":
        tv = db.query(ToolVersion).filter_by(tool_id=obj.id).order_by(ToolVersion.version_no.desc()).first()
        return {"kind": obj.kind, "connectionId": obj.connection_id,
                "spec": tv.spec if tv else {}, "version": tv.version_no if tv else 0}
    if rtype == "mcp":
        return {"transport": obj.transport, "command": obj.command,
                "connectionId": obj.connection_id, "envKeys": list((obj.env or {}).keys()),
                "discoveredTools": obj.discovered_tools or []}
    if rtype == "knowledge":
        return {"kind": obj.kind, "embeddingModelId": obj.embedding_model_id,
                "sourceConfig": obj.source_config, "sliceCount": obj.slice_count}
    if rtype == "datasource":
        conn = db.get(Connection, obj.connection_id) if obj.connection_id else None
        return {"type": obj.type, "location": obj.location, "config": obj.config,
                "connectionId": obj.connection_id,
                "endpoint": conn.endpoint if conn else {}, "secretConfigured": bool(conn and conn.secret_ref)}
    return {"datasourceId": obj.datasource_id, "location": obj.location,
            "recordMeaning": obj.record_meaning, "timeField": obj.time_field,
            "rowCount": len(obj.rows or []), "lifecycle": obj.lifecycle, "revision": obj.revision}


@router.put("/api/ai-resources/{coll}/{rid}")
@router.put("/api/data-resources/{coll}/{rid}")
def update_resource(coll: str, rid: str, payload: dict, db: Session = Depends(get_db)):
    rtype = _rtype(coll)
    obj = _get_obj(db, rtype, rid)
    if rtype == "tool":
        last = db.query(ToolVersion).filter_by(tool_id=rid).order_by(ToolVersion.version_no.desc()).first()
        db.add(ToolVersion(tool_id=rid, version_no=(last.version_no if last else 0) + 1,
                           input_schema=payload.get("inputSchema", {}),
                           output_schema=payload.get("outputSchema", {}),
                           spec=payload.get("spec", {})))
        if payload.get("connectionId") is not None:
            obj.connection_id = payload.get("connectionId")
        db.commit()
        log_change(db, rtype, rid, "update", detail={"newVersion": (last.version_no if last else 0) + 1})
        return {"id": rid, "newVersion": (last.version_no if last else 0) + 1}
    if rtype == "model":
        for k, attr in [("name", "display_name"), ("modelKey", "model_key"),
                        ("capabilities", "capabilities"), ("defaultParams", "default_params"),
                        ("providerId", "provider_id")]:
            if payload.get(k) is not None:
                setattr(obj, attr, payload[k])
        obj.version = (obj.version or 1) + 1
        db.commit()
        log_change(db, rtype, rid, "update", detail={"version": obj.version})
        return {"id": rid, "version": obj.version}
    simple = {
        "mcp": [("name", "name"), ("description", "description"), ("command", "command"),
                ("connectionId", "connection_id"), ("env", "env")],
        "knowledge": [("name", "name"), ("description", "description"), ("kind", "kind"),
                      ("embeddingModelId", "embedding_model_id"), ("sourceConfig", "source_config")],
        "datasource": [("name", "name"), ("description", "description"), ("type", "type"),
                       ("connectionId", "connection_id"), ("location", "location"), ("config", "config")],
        "asset": [("name", "name"), ("description", "description"), ("datasourceId", "datasource_id"),
                  ("location", "location"), ("recordMeaning", "record_meaning"),
                  ("timeField", "time_field"), ("lifecycle", "lifecycle")],
    }[rtype]
    for k, attr in simple:
        if payload.get(k) is not None:
            setattr(obj, attr, payload[k])
    db.commit()
    log_change(db, rtype, rid, "update", detail={k: payload[k] for k, _ in simple if payload.get(k) is not None})
    return {"id": rid}


@router.delete("/api/ai-resources/{coll}/{rid}")
@router.delete("/api/data-resources/{coll}/{rid}")
def delete_resource(coll: str, rid: str, db: Session = Depends(get_db)):
    rtype = _rtype(coll)
    _get_obj(db, rtype, rid)
    assert_deletable(db, rtype, rid)
    if rtype == "tool":
        db.query(ToolVersion).filter_by(tool_id=rid).delete()
    if rtype == "asset":
        db.query(DataDefinition).filter_by(data_asset_id=rid).delete()
    db.delete(db.get(_cls(rtype), rid))
    db.commit()
    return {"ok": True}


def _cls(rtype: str):
    from ..resource_registry import CLS
    return CLS[rtype]


@router.post("/api/ai-resources/{coll}/{rid}/toggle")
@router.post("/api/data-resources/{coll}/{rid}/toggle")
def toggle_resource(coll: str, rid: str, payload: dict, db: Session = Depends(get_db)):
    set_status(db, _rtype(coll), rid, bool(payload.get("enabled")))
    return {"id": rid, "enabled": bool(payload.get("enabled"))}


@router.post("/api/ai-resources/{coll}/{rid}/test")
@router.post("/api/data-resources/{coll}/{rid}/test")
def test_resource(coll: str, rid: str, payload: dict | None = None, db: Session = Depends(get_db)):
    return run_test(db, _rtype(coll), rid, payload or {})


@router.get("/api/ai-resources/{coll}/{rid}/usage")
@router.get("/api/data-resources/{coll}/{rid}/usage")
def usage_resource(coll: str, rid: str, db: Session = Depends(get_db)):
    rtype = _rtype(coll)
    _get_obj(db, rtype, rid)
    return {"refs": references(db, rtype, rid)}


# ---------- Tool 版本 ----------

@router.get("/api/ai-resources/tools/{rid}/versions")
def tool_versions(rid: str, db: Session = Depends(get_db)):
    rows = db.query(ToolVersion).filter_by(tool_id=rid).order_by(ToolVersion.version_no.desc()).all()
    return [{"id": v.id, "version": v.version_no, "status": v.status, "spec": v.spec} for v in rows]


@router.post("/api/ai-resources/tools/{rid}/versions", status_code=201)
def tool_new_version(rid: str, db: Session = Depends(get_db)):
    _get_obj(db, "tool", rid)
    last = db.query(ToolVersion).filter_by(tool_id=rid).order_by(ToolVersion.version_no.desc()).first()
    tv = ToolVersion(tool_id=rid, version_no=(last.version_no if last else 0) + 1,
                     input_schema=last.input_schema if last else {},
                     output_schema=last.output_schema if last else {},
                     spec=last.spec if last else {}, status="draft")
    db.add(tv)
    db.commit()
    log_change(db, "tool", rid, "new_version", detail={"version": tv.version_no})
    return {"version": tv.version_no, "status": tv.status}


# ---------- Data Definitions ----------

@router.get("/api/data-definitions")
def list_definitions(assetId: str = "", search: str = "", page: int = 1, pageSize: int = 20,
                     db: Session = Depends(get_db)):
    q = db.query(DataDefinition)
    if assetId:
        q = q.filter(DataDefinition.data_asset_id == assetId)
    if search:
        q = q.filter(DataDefinition.name.ilike(f"%{search}%"))
    total = q.count()
    rows = q.order_by(DataDefinition.updated_at.desc()).offset((page - 1) * pageSize).limit(pageSize).all()
    items = []
    for d in rows:
        asset = db.get(DataAsset, d.data_asset_id)
        task_n = sum(1 for t in db.query(_task_cls()).filter_by(data_definition_id=d.id))
        items.append({"id": d.id, "name": d.name, "assetId": d.data_asset_id,
                      "assetName": asset.name if asset else "", "lifecycle": d.lifecycle,
                      "revision": d.revision, "fieldCount": len(d.field_schema or []),
                      "taskCount": task_n, "updatedAt": d.updated_at.isoformat()})
    return {"items": items, "total": total, "page": page, "pageSize": pageSize}


def _task_cls():
    from ..models import AnalysisTask
    return AnalysisTask


@router.post("/api/data-definitions", status_code=201)
def create_definition(payload: dict, db: Session = Depends(get_db)):
    if not db.get(DataAsset, payload["assetId"]):
        raise HTTPException(404, "Data Asset 不存在")
    d = DataDefinition(name=payload["name"], data_asset_id=payload["assetId"],
                       field_schema=payload.get("fieldSchema", []),
                       eligibility=payload.get("eligibility", []))
    db.add(d)
    db.commit()
    log_change(db, "definition", d.id, "create")
    return {"id": d.id, "name": d.name}


@router.get("/api/data-definitions/{did}")
def get_definition(did: str, db: Session = Depends(get_db)):
    d = db.get(DataDefinition, did)
    if not d:
        raise HTTPException(404, "数据定义不存在")
    asset = db.get(DataAsset, d.data_asset_id)
    return {"id": d.id, "name": d.name, "assetId": d.data_asset_id,
            "assetName": asset.name if asset else "", "fieldSchema": d.field_schema,
            "eligibility": d.eligibility, "lifecycle": d.lifecycle, "revision": d.revision,
            "changeLog": change_log(db, "definition", did)}


@router.put("/api/data-definitions/{did}")
def update_definition(did: str, payload: dict, db: Session = Depends(get_db)):
    d = db.get(DataDefinition, did)
    if not d:
        raise HTTPException(404, "数据定义不存在")
    for k, attr in [("name", "name"), ("fieldSchema", "field_schema"), ("eligibility", "eligibility")]:
        if payload.get(k) is not None:
            setattr(d, attr, payload[k])
    db.commit()
    log_change(db, "definition", did, "update")
    return {"id": did, "revision": d.revision}


@router.delete("/api/data-definitions/{did}")
def delete_definition(did: str, db: Session = Depends(get_db)):
    d = db.get(DataDefinition, did)
    if not d:
        raise HTTPException(404, "数据定义不存在")
    assert_deletable(db, "definition", did)
    db.delete(d)
    db.commit()
    return {"ok": True}


@router.post("/api/data-definitions/{did}/publish")
def publish_definition(did: str, db: Session = Depends(get_db)):
    d = db.get(DataDefinition, did)
    if not d:
        raise HTTPException(404, "数据定义不存在")
    if not (d.field_schema or []):
        raise HTTPException(422, "字段 schema 为空，不能发布")
    d.lifecycle = "Ready"
    d.revision += 1
    db.commit()
    log_change(db, "definition", did, "publish", detail={"revision": d.revision})
    return {"id": did, "revision": d.revision, "lifecycle": d.lifecycle}


@router.post("/api/data-definitions/{did}/infer")
def infer_definition(did: str, db: Session = Depends(get_db)):
    """从所属 Asset 抽样推断字段 schema（内联 rows 或 mock 样例）。"""
    d = db.get(DataDefinition, did)
    if not d:
        raise HTTPException(404, "数据定义不存在")
    asset = db.get(DataAsset, d.data_asset_id)
    rows = (asset.rows or [])[:20] if asset else []
    if not rows:
        rows = [{"interactionId": "S-001", "interactionTime": "2026-08-01T10:00:00Z",
                 "agentName": "坐席A", "text": "您好…"}]
    schema = []
    for key, val in rows[0].items():
        t = "Number" if isinstance(val, (int, float)) and not isinstance(val, bool) \
            else "Boolean" if isinstance(val, bool) \
            else "DateTime" if "time" in key.lower() or "date" in key.lower() else "String"
        schema.append({"key": key, "displayName": key, "type": t, "required": key in rows[0]})
    d.field_schema = schema
    db.commit()
    log_change(db, "definition", did, "infer", detail={"fields": len(schema)})
    return {"fieldSchema": schema}


# ---------- picker 供给（设计器/向导共用） ----------

@router.get("/api/registry/resources")
def registry_resources(types: str = "", enabledOnly: bool = True, db: Session = Depends(get_db)):
    want = [t for t in types.split(",") if t in COLL.values()] or list(COLL.values())
    out = []
    for t in want:
        for row in db.query(_cls(t)).all():
            dto = to_dto(db, t, row)
            if enabledOnly and dto["status"] != "enabled":
                continue
            out.append({"id": dto["id"], "type": t, "name": dto["name"],
                        "status": dto["status"], "metadata": dto["metadata"]})
    return {"items": out}
