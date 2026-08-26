"""07-SDD（08-26 决策）：集中表单 CRUD——工作流输入契约实体。"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Form, Workflow

router = APIRouter(prefix="/api/forms", tags=["forms"])

FIELD_TYPES = {"string", "number", "boolean", "array", "object", "datetime"}
CONTROLS = {"text", "textarea", "number", "select", "switch", "date"}

LEGACY_SIX = [
    {"name": "userQuery", "type": "string", "required": True, "default": "", "description": "用户问题", "control": "textarea"},
    {"name": "chatHistory", "type": "string", "required": False, "default": "", "description": "历史对话", "control": "textarea"},
    {"name": "userId", "type": "string", "required": False, "default": "", "description": "用户 ID", "control": "text"},
    {"name": "conversationId", "type": "string", "required": False, "default": "", "description": "会话 ID", "control": "text"},
    {"name": "chatId", "type": "string", "required": False, "default": "", "description": "对话 ID", "control": "text"},
    {"name": "reference", "type": "string", "required": False, "default": "", "description": "引用内容", "control": "text"},
]


def _validate_fields(fields) -> list[dict]:
    if not isinstance(fields, list):
        raise HTTPException(422, "fields 必须为数组")
    seen = set()
    out = []
    for f in fields:
        name = str(f.get("name") or "").strip()
        if not name:
            raise HTTPException(422, "字段名不能为空")
        if name in seen:
            raise HTTPException(422, f"字段名重复：{name}")
        seen.add(name)
        ftype = f.get("type") or "string"
        if ftype not in FIELD_TYPES:
            raise HTTPException(422, f"字段 {name} 类型非法：{ftype}")
        control = f.get("control") or "text"
        if control not in CONTROLS:
            raise HTTPException(422, f"字段 {name} 控件非法：{control}")
        out.append({"name": name, "type": ftype, "required": bool(f.get("required")),
                    "default": f.get("default") or "", "description": f.get("description") or "",
                    "control": control, "options": f.get("options") or []})
    return out


def _usage(db: Session, fid: str) -> int:
    n = 0
    for w in db.query(Workflow).all():
        nodes = (w.draft_definition or {}).get("graph", {}).get("nodes", [])
        if any(nd.get("type") == "input" and (nd.get("config") or {}).get("formId") == fid for nd in nodes):
            n += 1
    return n


@router.get("")
def list_forms(db: Session = Depends(get_db)):
    items = []
    for f in db.query(Form).order_by(Form.updated_at.desc()).all():
        items.append({"id": f.id, "name": f.name, "description": f.description,
                      "fieldCount": len(f.fields or []), "revision": f.revision,
                      "usage": _usage(db, f.id), "updatedAt": f.updated_at.isoformat()})
    return {"items": items}


@router.post("", status_code=201)
def create_form(payload: dict, db: Session = Depends(get_db)):
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "name 必填")
    f = Form(name=name, description=payload.get("description") or "",
             fields=_validate_fields(payload.get("fields") or []))
    db.add(f)
    db.commit()
    return {"id": f.id, "name": f.name}


@router.get("/{fid}")
def get_form(fid: str, db: Session = Depends(get_db)):
    f = db.get(Form, fid)
    if not f:
        raise HTTPException(404, "form not found")
    return {"id": f.id, "name": f.name, "description": f.description,
            "fields": f.fields or [], "revision": f.revision, "usage": _usage(db, fid)}


@router.put("/{fid}")
def update_form(fid: str, payload: dict, db: Session = Depends(get_db)):
    f = db.get(Form, fid)
    if not f:
        raise HTTPException(404, "form not found")
    if payload.get("name"):
        f.name = str(payload["name"]).strip()
    if "description" in payload:
        f.description = payload.get("description") or ""
    if "fields" in payload:
        f.fields = _validate_fields(payload.get("fields"))
    f.revision += 1
    f.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"id": f.id, "revision": f.revision}


@router.post("/{fid}/duplicate", status_code=201)
def duplicate_form(fid: str, db: Session = Depends(get_db)):
    f = db.get(Form, fid)
    if not f:
        raise HTTPException(404, "form not found")
    cp = Form(name=f"{f.name} 副本", description=f.description,
              fields=[dict(x) for x in (f.fields or [])])
    db.add(cp)
    db.commit()
    return {"id": cp.id, "name": cp.name}


@router.delete("/{fid}")
def delete_form(fid: str, db: Session = Depends(get_db)):
    f = db.get(Form, fid)
    if not f:
        raise HTTPException(404, "form not found")
    used = _usage(db, fid)
    if used:
        raise HTTPException(409, {"message": f"表单被 {used} 个工作流引用，不允许删除"})
    db.delete(f)
    db.commit()
    return {"ok": True}


def seed_default_forms(db: Session) -> None:
    """08-26：种子“对话六件套”与“空表单”。"""
    if db.query(Form).count() > 0:
        return
    db.add(Form(name="对话六件套", description="聊天触发标准输入（存量兼容默认）",
                fields=[dict(x) for x in LEGACY_SIX]))
    db.add(Form(name="空表单", description="从零定义输入字段", fields=[]))
    db.commit()
