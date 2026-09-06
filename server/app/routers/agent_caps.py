"""Agent 能力一等实体路由（09-07 重构）：run-stats / skills / memory / chat / uploads。

写端点统一 require_operator；archived Agent 全部写入口 409（R-Archive 语义延续）。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..agent_chat import start_chat_turn
from ..auth import require_operator
from ..db import get_db
from ..models import (Agent, AgentChatMessage, AgentChatSession, AgentMemory,
                      AgentMemoryRevision, AgentSkill, Run, SkillResource)
from ..resource_registry import to_dto

router = APIRouter(prefix="/api/agents", tags=["agent-caps"])

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "var" / "uploads"

RUNNING_STATES = ("running", "waiting", "paused")
PENDING_STATES = ("queued",)


def _agent_or_404(db: Session, aid: str) -> Agent:
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
    return a


def _assert_writable(a: Agent) -> None:
    if a.archived:
        raise HTTPException(409, {"code": "LEGACY_AGENT_ARCHIVED",
                                  "message": "已封存 Agent 只读，不支持该操作"})


# ---------- 概览统计 ----------


@router.get("/{aid}/run-stats")
def run_stats(aid: str, db: Session = Depends(get_db)):
    """工作日志卡数据：四数字 + 触发类型分布 + 近 365 天按日计数。"""
    a = _agent_or_404(db, aid)
    since = datetime.now(timezone.utc) - timedelta(days=365)
    rows = db.execute(
        select(Run.status, Run.trigger, func.count(Run.id))
        .where(Run.agent_id == aid, Run.created_at >= since)
        .group_by(Run.status, Run.trigger)).all()
    by_status: dict[str, int] = {}
    by_trigger: dict[str, int] = {}
    running = done = pending = 0
    for status, trigger, cnt in rows:
        by_status[status] = by_status.get(status, 0) + cnt
        by_trigger[trigger or "unknown"] = by_trigger.get(trigger or "unknown", 0) + cnt
        if status in RUNNING_STATES:
            running += cnt
        elif status == "succeeded":
            done += cnt
        elif status in PENDING_STATES:
            pending += cnt
    days = db.execute(
        select(func.date(Run.created_at), func.count(Run.id))
        .where(Run.agent_id == aid, Run.created_at >= since)
        .group_by(func.date(Run.created_at))).all()
    now = datetime.now(timezone.utc)
    return {"sinceDays": max((now - a.created_at).days, 0),
            "running": running, "done": done, "pending": pending,
            "byStatus": by_status, "byTrigger": by_trigger,
            "byDay": [{"date": str(d), "count": c} for d, c in days]}


# ---------- Skills ----------


@router.get("/{aid}/skills")
def list_agent_skills(aid: str, db: Session = Depends(get_db)):
    _agent_or_404(db, aid)
    links = db.execute(select(AgentSkill).where(AgentSkill.agent_id == aid)
                       .order_by(AgentSkill.installed_at)).scalars().all()
    items = []
    for l in links:
        s = db.get(SkillResource, l.skill_id)
        if not s:
            continue
        dto = to_dto(db, "skill", s)
        dto["installedAt"] = l.installed_at.isoformat()
        items.append(dto)
    return {"items": items}


@router.post("/{aid}/skills", status_code=201)
def install_skill(aid: str, payload: dict, db: Session = Depends(get_db),
                  _user: dict = Depends(require_operator)):
    a = _agent_or_404(db, aid)
    _assert_writable(a)
    sid = payload.get("skillId", "")
    if not db.get(SkillResource, sid):
        raise HTTPException(404, "skill not found")
    exists = db.execute(select(AgentSkill).where(AgentSkill.agent_id == aid,
                                                 AgentSkill.skill_id == sid)).scalars().first()
    if exists:
        raise HTTPException(409, {"code": "SKILL_INSTALLED", "message": "该 Skill 已安装"})
    db.add(AgentSkill(agent_id=aid, skill_id=sid))
    db.commit()
    return {"id": sid}


@router.delete("/{aid}/skills/{sid}")
def uninstall_skill(aid: str, sid: str, db: Session = Depends(get_db),
                    _user: dict = Depends(require_operator)):
    a = _agent_or_404(db, aid)
    _assert_writable(a)
    link = db.execute(select(AgentSkill).where(AgentSkill.agent_id == aid,
                                               AgentSkill.skill_id == sid)).scalars().first()
    if not link:
        raise HTTPException(404, "未安装该 Skill")
    db.delete(link)
    db.commit()
    return {"id": sid}


# ---------- 记忆 ----------


def _memory_row(db: Session, aid: str) -> AgentMemory:
    mem = db.execute(select(AgentMemory).where(AgentMemory.agent_id == aid)).scalars().first()
    if not mem:
        mem = AgentMemory(agent_id=aid)
        db.add(mem)
        db.commit()
    return mem


@router.get("/{aid}/memory")
def get_memory(aid: str, db: Session = Depends(get_db)):
    _agent_or_404(db, aid)
    mem = _memory_row(db, aid)
    return {"content": mem.content, "version": mem.version,
            "updatedAt": mem.updated_at.isoformat(), "updatedBy": mem.updated_by}


@router.put("/{aid}/memory")
def save_memory(aid: str, payload: dict, db: Session = Depends(get_db),
                _user: dict = Depends(require_operator)):
    a = _agent_or_404(db, aid)
    _assert_writable(a)
    mem = _memory_row(db, aid)
    mem.content = payload.get("content", "") or ""
    mem.version += 1
    mem.updated_by = "质量管理员"
    db.add(AgentMemoryRevision(memory_id=mem.id, version=mem.version, content=mem.content,
                               note=payload.get("note", "") or "", created_by=mem.updated_by))
    db.commit()
    return {"version": mem.version, "updatedAt": mem.updated_at.isoformat()}


@router.get("/{aid}/memory/revisions")
def memory_revisions(aid: str, db: Session = Depends(get_db)):
    _agent_or_404(db, aid)
    mem = db.execute(select(AgentMemory).where(AgentMemory.agent_id == aid)).scalars().first()
    if not mem:
        return {"items": []}
    rows = db.execute(select(AgentMemoryRevision).where(AgentMemoryRevision.memory_id == mem.id)
                      .order_by(AgentMemoryRevision.version.desc())).scalars().all()
    return {"items": [{"id": r.id, "version": r.version, "content": r.content, "note": r.note,
                       "createdBy": r.created_by, "createdAt": r.created_at.isoformat()}
                      for r in rows]}


@router.get("/{aid}/memory/timeline")
def memory_timeline(aid: str, limit: int = 20, db: Session = Depends(get_db)):
    """记忆与学习时间线：记忆版本事件 + Skill 安装事件合并倒序。"""
    _agent_or_404(db, aid)
    events: list[dict] = []
    mem = db.execute(select(AgentMemory).where(AgentMemory.agent_id == aid)).scalars().first()
    if mem:
        for r in db.execute(select(AgentMemoryRevision)
                            .where(AgentMemoryRevision.memory_id == mem.id)
                            .order_by(AgentMemoryRevision.created_at.desc())).scalars():
            events.append({"type": "memory_updated", "version": r.version,
                           "note": r.note or f"记忆更新至 V{r.version}",
                           "at": r.created_at.isoformat()})
    for l in db.execute(select(AgentSkill).where(AgentSkill.agent_id == aid)
                        .order_by(AgentSkill.installed_at.desc())).scalars():
        s = db.get(SkillResource, l.skill_id)
        events.append({"type": "skill_installed", "name": s.name if s else l.skill_id,
                       "note": f"安装 Skill：{s.name if s else l.skill_id}",
                       "at": l.installed_at.isoformat()})
    events.sort(key=lambda e: e["at"], reverse=True)
    return {"items": events[:limit]}


# ---------- 对话 ----------


@router.get("/{aid}/chat/sessions")
def chat_sessions(aid: str, db: Session = Depends(get_db)):
    _agent_or_404(db, aid)
    rows = db.execute(select(AgentChatSession).where(AgentChatSession.agent_id == aid)
                      .order_by(AgentChatSession.updated_at.desc())).scalars().all()
    return {"items": [{"id": s.id, "title": s.title, "createdAt": s.created_at.isoformat(),
                       "updatedAt": s.updated_at.isoformat()} for s in rows]}


@router.post("/{aid}/chat/sessions", status_code=201)
def create_chat_session(aid: str, payload: dict | None = None, db: Session = Depends(get_db),
                        _user: dict = Depends(require_operator)):
    a = _agent_or_404(db, aid)
    _assert_writable(a)
    s = AgentChatSession(agent_id=aid, title=(payload or {}).get("title", "") or "")
    db.add(s)
    db.commit()
    return {"id": s.id, "title": s.title}


@router.get("/{aid}/chat/sessions/{sid}/messages")
def chat_messages(aid: str, sid: str, db: Session = Depends(get_db)):
    _agent_or_404(db, aid)
    s = db.get(AgentChatSession, sid)
    if not s or s.agent_id != aid:
        raise HTTPException(404, "session not found")
    rows = db.execute(select(AgentChatMessage).where(AgentChatMessage.session_id == sid)
                      .order_by(AgentChatMessage.created_at)).scalars().all()
    return {"items": [{"id": m.id, "role": m.role, "content": m.content,
                       "attachments": m.attachments or [], "modelId": m.model_id,
                       "runId": m.run_id, "status": m.status,
                       "createdAt": m.created_at.isoformat()} for m in rows]}


@router.post("/{aid}/chat/sessions/{sid}/turns", status_code=202)
def chat_turn(aid: str, sid: str, payload: dict, db: Session = Depends(get_db),
              _user: dict = Depends(require_operator)):
    a = _agent_or_404(db, aid)
    _assert_writable(a)
    s = db.get(AgentChatSession, sid)
    if not s or s.agent_id != aid:
        raise HTTPException(404, "session not found")
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(422, "消息不能为空")
    return start_chat_turn(db, a, s, text, payload.get("attachments") or [],
                           payload.get("modelId") or "")


# ---------- 附件 ----------


@router.post("/{aid}/chat/uploads", status_code=201)
async def chat_upload(aid: str, file: UploadFile, db: Session = Depends(get_db),
                      _user: dict = Depends(require_operator)):
    a = _agent_or_404(db, aid)
    _assert_writable(a)
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "附件上限 10MB")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    fid = uuid4().hex[:16]
    safe = (file.filename or "upload").replace("/", "_").replace("\\", "_")
    (UPLOAD_DIR / f"{fid}_{safe}").write_bytes(data)
    return {"id": fid, "name": safe, "size": len(data), "mime": file.content_type or ""}


download_router = APIRouter(tags=["agent-caps"])


@download_router.get("/api/agent-caps/uploads/{fid}")
def download_upload(fid: str):
    hits = sorted(UPLOAD_DIR.glob(f"{fid}_*")) if UPLOAD_DIR.exists() else []
    if not hits:
        raise HTTPException(404, "附件不存在")
    from fastapi.responses import FileResponse
    return FileResponse(hits[0], filename=hits[0].name.split("_", 1)[1])
