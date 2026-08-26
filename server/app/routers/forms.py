"""07-SDD（08-26 决策+V1.5）：集中表单 CRUD/发布/版本/记录——工作流输入契约+业务结果 Schema。"""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Form, FormRecord, FormVersion, Workflow

router = APIRouter(prefix="/api/forms", tags=["forms"])

KEY_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*$")  # V1.5：放宽大小写（触发内置字段为 camelCase；推荐 snake）
DATA_TYPES = {"string", "number", "boolean", "array", "object", "datetime", "file", "none"}
UI_TYPES = {"text", "textarea", "number", "select", "multi-select", "radio", "checkbox-group",
            "switch", "date", "datetime", "file", "heading", "description", "divider", "section"}
BIND_TYPES = {"manual", "workflow_output", "data_source", "expression", "constant"}

LEGACY_SIX = [
    {"key": "userQuery", "type": "textarea", "dataType": "string", "label": "用户问题", "required": True},
    {"key": "chatHistory", "type": "textarea", "dataType": "string", "label": "历史对话"},
    {"key": "userId", "type": "text", "dataType": "string", "label": "用户 ID"},
    {"key": "conversationId", "type": "text", "dataType": "string", "label": "会话 ID"},
    {"key": "chatId", "type": "text", "dataType": "string", "label": "对话 ID"},
    {"key": "reference", "type": "text", "dataType": "string", "label": "引用内容"},
]


def _norm_field(f: dict, idx: int) -> dict:
    import uuid as _uuid
    key = str(f.get("key") or "").strip()
    if not key:
        raise HTTPException(422, f"字段 #{idx + 1} 缺少 key")
    if not KEY_RE.match(key):
        raise HTTPException(422, f"字段 key 非法（^[a-z][a-z0-9_]*$）：{key}")
    ftype = f.get("type") or "text"
    if ftype not in UI_TYPES:
        raise HTTPException(422, f"字段 {key} UI 类型非法：{ftype}")
    dtype = f.get("dataType") or "string"
    if dtype not in DATA_TYPES:
        raise HTTPException(422, f"字段 {key} 数据类型非法：{dtype}")
    opts = f.get("options") or []
    norm_opts = [{"label": str(o.get("label") or o.get("value") or ""), "value": str(o.get("value") or o.get("label") or "")}
                for o in opts] if opts and isinstance(opts[0], dict) else [{"label": str(v), "value": str(v)} for v in opts]
    val = f.get("validation") or {}
    if "required" not in val and "required" in f:
        val = {**val, "required": bool(f.get("required"))}  # 兼容顶层 required
    layout = f.get("layout") or {}
    span = int(layout.get("span") or 12)
    if span not in (3, 6, 9, 12):
        raise HTTPException(422, f"字段 {key} span 仅支持 3/6/9/12")
    binding = f.get("binding") or {}
    if (binding.get("type") or "manual") not in BIND_TYPES:
        raise HTTPException(422, f"字段 {key} binding 类型非法")
    return {
        "id": f.get("id") or _uuid.uuid4().hex[:12],
        "key": key,
        "type": ftype,
        "dataType": dtype,
        "label": str(f.get("label") or key),
        "description": f.get("description") or "",
        "placeholder": f.get("placeholder") or "",
        "default": f.get("default") or "",
        "options": norm_opts,
        "validation": {"required": bool(val.get("required")),
                       **{k: val[k] for k in ("minLength", "maxLength", "min", "max", "pattern",
                                              "minSelections", "maxSelections") if val.get(k) is not None}},
        "layout": {"span": span},
        "binding": {"type": binding.get("type") or "manual",
                    **{k: binding[k] for k in ("path", "sourceId", "sourceField", "expression") if binding.get(k)}},
        "condition": f.get("condition") or {},
    }


def _validate_fields(fields) -> list[dict]:
    if not isinstance(fields, list):
        raise HTTPException(422, "fields 必须为数组")
    seen = set()
    out = []
    for i, f in enumerate(fields):
        nf = _norm_field(f, i)
        if nf["key"] in seen:
            raise HTTPException(422, f"字段 key 重复：{nf['key']}")
        seen.add(nf["key"])
        out.append(nf)
    return out


def validate_form_input(fields: list[dict], values: dict) -> list[str]:
    """07-SDD V1.5：运行时校验引擎（required/min-max/length/pattern/selections）。"""
    errs: list[str] = []
    for f in fields or []:
        if f.get("dataType") == "none":
            continue
        key = f.get("key")
        v = values.get(key)
        val = f.get("validation") or {}
        empty = v in (None, "") or v == []
        if val.get("required") and empty and f.get("default") in (None, ""):
            errs.append(f"{key} 必填")
            continue
        if empty:
            continue
        s = v if isinstance(v, str) else str(v)
        if val.get("minLength") is not None and len(s) < int(val["minLength"]):
            errs.append(f"{key} 长度小于 {val['minLength']}")
        if val.get("maxLength") is not None and len(s) > int(val["maxLength"]):
            errs.append(f"{key} 长度大于 {val['maxLength']}")
        if f.get("dataType") == "number":
            try:
                nv = float(v)
            except (TypeError, ValueError):
                errs.append(f"{key} 非数值")
                continue
            if val.get("min") is not None and nv < float(val["min"]):
                errs.append(f"{key} 小于 {val['min']}")
            if val.get("max") is not None and nv > float(val["max"]):
                errs.append(f"{key} 大于 {val['max']}")
        if val.get("pattern"):
            try:
                if not re.search(val["pattern"], s):
                    errs.append(f"{key} 不匹配 {val['pattern']}")
            except re.error:
                pass
        if f.get("type") in ("multi-select", "checkbox-group") and isinstance(v, list):
            if val.get("minSelections") is not None and len(v) < int(val["minSelections"]):
                errs.append(f"{key} 至少选 {val['minSelections']} 项")
            if val.get("maxSelections") is not None and len(v) > int(val["maxSelections"]):
                errs.append(f"{key} 至多选 {val['maxSelections']} 项")
    return errs


def _usage(db: Session, fid: str) -> int:
    n = 0
    for w in db.query(Workflow).all():
        nodes = (w.draft_definition or {}).get("graph", {}).get("nodes", [])
        if any(nd.get("type") == "input" and (nd.get("config") or {}).get("formId") == fid for nd in nodes):
            n += 1
    return n


def _to_dto(db: Session, f: Form) -> dict:
    return {"id": f.id, "key": f.key, "name": f.name, "description": f.description,
            "status": f.status, "fields": f.fields or [], "revision": f.revision,
            "fieldCount": len(f.fields or []), "usage": _usage(db, f.id),
            "updatedAt": f.updated_at.isoformat()}


@router.get("")
def list_forms(db: Session = Depends(get_db)):
    return {"items": [_to_dto(db, f) for f in db.query(Form).order_by(Form.updated_at.desc()).all()]}


@router.post("", status_code=201)
def create_form(payload: dict, db: Session = Depends(get_db)):
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "name 必填")
    key = str(payload.get("key") or "").strip() or re.sub(r"[^a-z0-9_]", "_", name.lower()) or f"form_{datetime.now(timezone.utc).timestamp()}"
    if not KEY_RE.match(key):
        raise HTTPException(422, "Form Key 非法（^[a-z][a-z0-9_]*$）")
    if db.query(Form).filter_by(key=key).first():
        raise HTTPException(409, f"Form Key 已存在：{key}")
    f = Form(name=name, key=key, description=payload.get("description") or "",
             fields=_validate_fields(payload.get("fields") or []))
    db.add(f)
    db.commit()
    return {"id": f.id, "name": f.name, "key": f.key}


@router.get("/{fid}")
def get_form(fid: str, db: Session = Depends(get_db)):
    f = db.get(Form, fid)
    if not f:
        raise HTTPException(404, "form not found")
    return _to_dto(db, f)


@router.put("/{fid}")
def update_form(fid: str, payload: dict, db: Session = Depends(get_db)):
    f = db.get(Form, fid)
    if not f:
        raise HTTPException(404, "form not found")
    # V1.5：key 创建后不可改
    if payload.get("key") and payload["key"] != f.key:
        raise HTTPException(409, "Form Key 创建后不允许修改")
    if payload.get("name"):
        f.name = str(payload["name"]).strip()
    if "description" in payload:
        f.description = payload.get("description") or ""
    if "fields" in payload:
        new_fields = _validate_fields(payload.get("fields"))
        # 字段 key 不可改（按 id 匹配旧 key）
        old_by_id = {x.get("id"): x.get("key") for x in (f.fields or [])}
        for nf in new_fields:
            ok = old_by_id.get(nf["id"])
            if ok is not None and ok != nf["key"]:
                raise HTTPException(409, f"字段 key 不允许修改：{ok} → {nf['key']}")
        f.fields = new_fields
    f.revision += 1
    f.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"id": f.id, "revision": f.revision}


@router.post("/{fid}/publish", status_code=201)
def publish_form(fid: str, payload: dict | None = None, db: Session = Depends(get_db)):
    f = db.get(Form, fid)
    if not f:
        raise HTTPException(404, "form not found")
    if not (f.fields or []):
        raise HTTPException(422, "空表单不可发布")
    vno = (db.query(FormVersion).filter_by(form_id=fid).count()) + 1
    db.add(FormVersion(form_id=fid, version_no=vno, fields=f.fields or [],
                       note=(payload or {}).get("note") or ""))
    f.status = "published"
    f.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"versionNo": vno}


@router.get("/{fid}/versions")
def list_versions(fid: str, db: Session = Depends(get_db)):
    vs = db.query(FormVersion).filter_by(form_id=fid).order_by(FormVersion.version_no.desc()).all()
    return [{"versionId": v.id, "versionNo": v.version_no, "fieldCount": len(v.fields or []),
             "note": v.note, "createdAt": v.created_at.isoformat()} for v in vs]


@router.post("/{fid}/disable")
def disable_form(fid: str, db: Session = Depends(get_db)):
    f = db.get(Form, fid)
    if not f:
        raise HTTPException(404, "form not found")
    f.status = "disabled"
    db.commit()
    return {"ok": True}


@router.post("/{fid}/duplicate", status_code=201)
def duplicate_form(fid: str, db: Session = Depends(get_db)):
    f = db.get(Form, fid)
    if not f:
        raise HTTPException(404, "form not found")
    cp = Form(name=f"{f.name} 副本", key=f"{f.key}_copy_{datetime.now(timezone.utc).timestamp()}",
              description=f.description, fields=[dict(x) for x in (f.fields or [])])
    db.add(cp)
    db.commit()
    return {"id": cp.id, "name": cp.name}


@router.delete("/{fid}")
def delete_form(fid: str, db: Session = Depends(get_db)):
    f = db.get(Form, fid)
    if not f:
        raise HTTPException(404, "form not found")
    used = _usage(db, fid)
    records = db.query(FormRecord).filter_by(form_id=fid).count()
    if used or records or f.status == "published":
        raise HTTPException(409, {"message": f"被引用={used} 记录数={records} 状态={f.status}：禁止删除，仅可停用"})
    db.delete(f)
    db.commit()
    return {"ok": True}


@router.post("/{fid}/records", status_code=201)
def create_record(fid: str, payload: dict, db: Session = Depends(get_db)):
    f = db.get(Form, fid)
    if not f:
        raise HTTPException(404, "form not found")
    version = payload.get("formVersion")
    if version:
        ver = db.query(FormVersion).filter_by(form_id=fid, version_no=int(version)).first()
        fields = ver.fields if ver else (f.fields or [])
    else:
        fields = f.fields or []
    errs = validate_form_input(fields, payload.get("values") or {})
    if errs:
        raise HTTPException(422, {"message": "；".join(errs)})
    rec = FormRecord(form_id=fid, form_version=int(version or 0), values=payload.get("values") or {},
                     created_by=payload.get("createdBy") or "", run_id=payload.get("runId"),
                     task_id=payload.get("taskId"))
    db.add(rec)
    db.commit()
    return {"recordId": rec.id}


@router.get("/{fid}/records")
def list_records(fid: str, db: Session = Depends(get_db)):
    rs = db.query(FormRecord).filter_by(form_id=fid).order_by(FormRecord.created_at.desc()).limit(100).all()
    return [{"recordId": r.id, "formVersion": r.form_version, "values": r.values,
             "createdBy": r.created_by, "runId": r.run_id, "createdAt": r.created_at.isoformat()} for r in rs]


@router.get("/{fid}/references")
def references(fid: str, db: Session = Depends(get_db)):
    wfs = []
    for w in db.query(Workflow).all():
        nodes = (w.draft_definition or {}).get("graph", {}).get("nodes", [])
        if any(nd.get("type") == "input" and (nd.get("config") or {}).get("formId") == fid for nd in nodes):
            wfs.append({"id": w.id, "name": w.name})
    return {"workflows": wfs, "tasks": []}


def seed_default_forms(db: Session) -> None:
    """08-26：种子“对话六件套”与“空表单”（V1.5 结构）；存量非法 key 归一化。"""
    for f in db.query(Form).all():
        if not f.key or not KEY_RE.match(f.key):
            base = re.sub(r"[^a-z0-9_]", "_", (f.name or "form").lower()) or f"form_{f.id[:6]}"
            f.key = base if not db.query(Form).filter(Form.key == base, Form.id != f.id).first() else f"{base}_{f.id[:4]}"
    db.commit()
    if db.query(Form).count() > 0:
        return
    db.add(Form(name="对话六件套", key="conversation_six", description="聊天触发标准输入（存量兼容默认）",
                fields=_validate_fields([dict(x) for x in LEGACY_SIX])))
    db.add(Form(name="空表单", key="empty_form", description="从零定义输入字段", fields=[]))
    db.commit()
