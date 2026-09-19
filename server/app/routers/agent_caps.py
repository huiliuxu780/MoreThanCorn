"""Agent 能力一等实体路由（09-07 重构）：run-stats / skills / memory / chat / uploads。

写端点统一 require_operator；archived Agent 全部写入口 409（R-Archive 语义延续）。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
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
    """工作日志卡数据：四数字 + 触发类型分布 + 近 365 天按日计数。

    09-18 修正（用户指认假零）：事件/自动任务触发的执行不落 Run 表，只读 Run
    会把跑了几百通的 agent 显示成全 0。并入 AgentSessionIndex 会话，状态由
    Invocation 终态 + 平台消息事实推导（completed 但零模型回复=静默消失→failed，
    与看板 lane 同口径）。"""
    a = _agent_or_404(db, aid)
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=365)
    rows = db.execute(
        select(Run.status, Run.trigger, func.count(Run.id))
        .where(Run.agent_id == aid, Run.created_at >= since)
        .group_by(Run.status, Run.trigger)).all()
    by_status: dict[str, int] = {}
    by_trigger: dict[str, int] = {}
    day_counts: dict[str, int] = {}
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
    for d, c in days:
        day_counts[str(d)] = day_counts.get(str(d), 0) + c
    # —— 会话并入（事件/自动任务/对话触发的真实执行量）——
    from ..models import AgentSessionIndex, AutomationTriggerLog
    sess = db.execute(
        select(AgentSessionIndex.session_id, AgentSessionIndex.trigger_kind,
               AgentSessionIndex.created_at, AutomationTriggerLog.status)
        .outerjoin(AutomationTriggerLog,
                   AutomationTriggerLog.session_id == AgentSessionIndex.session_id)
        .where(AgentSessionIndex.agent_id == aid,
               AgentSessionIndex.created_at >= since)).all()
    msg_n: dict[str, int] = {}
    sids = [s[0] for s in sess]
    if sids:
        from sqlalchemy import text as _sa_text
        from sqlalchemy.exc import ProgrammingError as _Prog
        try:
            for c0 in range(0, len(sids), 500):
                res = db.execute(
                    _sa_text("SELECT session_id, count(*) FROM messages "
                             "WHERE session_id = ANY(:s) GROUP BY session_id"),
                    {"s": sids[c0:c0 + 500]})
                for sid, n in res:
                    msg_n[sid] = int(n)
        except _Prog:
            db.rollback()  # 无运行时 storage 表的测试库：按无消息口径继续
    for sid, trig, created, inv in sess:
        has_reply = msg_n.get(sid, 0) > 1
        if inv == "running":
            st = "running"
        elif inv in ("queued", "accepted"):
            st = "queued"
        elif inv == "failed":
            st = "failed"
        elif inv == "cancelled":
            st = "cancelled"
        elif inv == "completed":
            st = "succeeded" if has_reply else "failed"
        else:  # 对话/手动会话无 invocation：有回复=完成；无回复且新鲜=在跑，否则废弃
            st = "succeeded" if has_reply else (
                "running" if (now - created) < timedelta(minutes=10) else "failed")
        by_status[st] = by_status.get(st, 0) + 1
        key = trig or "chat"
        by_trigger[key] = by_trigger.get(key, 0) + 1
        dk = str(created.date())
        day_counts[dk] = day_counts.get(dk, 0) + 1
        if st in RUNNING_STATES:
            running += 1
        elif st == "succeeded":
            done += 1
        elif st in PENDING_STATES:
            pending += 1
    return {"sinceDays": max((now - a.created_at).days, 0),
            "running": running, "done": done, "pending": pending,
            "byStatus": by_status, "byTrigger": by_trigger,
            "byDay": [{"date": d, "count": c} for d, c in sorted(day_counts.items())]}


# ---------- Skills ----------


@router.get("/{aid}/skills")
def list_agent_skills(aid: str, db: Session = Depends(get_db)):
    a = _agent_or_404(db, aid)
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
    # 09-18 修正：agent_skill 表已退役为辅助登记，真挂载在 config.skills
    # （发布冻结进 release）；此前只读表 → skill 页安装态全假（"都没安装"根因）
    seen = {s["id"] for s in items}
    for ref in (a.config or {}).get("skills", []):
        srow = db.get(SkillResource, ref) or db.query(SkillResource).filter_by(name=ref).first()
        if not srow or srow.id in seen:
            continue
        seen.add(srow.id)
        dto = to_dto(db, "skill", srow)
        dto["installedAt"] = ""
        items.append(dto)
    return {"items": items}


@router.post("/{aid}/skills", status_code=201)
def install_skill(aid: str, payload: dict, db: Session = Depends(get_db),
                  _user: dict = Depends(require_operator)):
    """换底（2026-09-09）退役：Skill 实际挂载归 AgentScope Workspace（Session 级）。
    平台 agent_skill 关联表停写；请经 /api/v2/agents/{aid}/sessions/{sid}/skills/upload 装配。"""
    raise HTTPException(410, "Skill 挂载已迁移至 Session Workspace：请使用 /api/v2/agents/{agentId}/sessions/{sessionId}/skills/upload")


@router.delete("/{aid}/skills/{sid}")
def uninstall_skill(aid: str, sid: str, db: Session = Depends(get_db),
                    _user: dict = Depends(require_operator)):
    """换底退役：卸载请在 Session Workspace 内操作（/workspace/skill/{name}）。"""
    raise HTTPException(410, "Skill 卸载已迁移至 Session Workspace")


# ---------- 全局 Skill 挂载关系（资源壳消费） ----------

skills_router = APIRouter(prefix="/api/skills", tags=["skills"])


@skills_router.get("/mounts")
def skill_mount_map(db: Session = Depends(get_db)):
    """docs/v2-design/10 §4.1（09-11 修正）：skillId → 挂载 Agent 列表。
    真实源 = agent.config.skills 声明（发布时冻结进 release 由运行时装配）；
    遗留 AgentSkill 表 09-09 换底后停写，继续读它会展示假数据。"""
    mounts: dict[str, list[dict]] = {}
    for a in db.query(Agent).filter(Agent.status != "archived").all():
        for sid in (a.config or {}).get("skills") or []:
            mounts.setdefault(sid, []).append(
                {"agentId": a.id, "agentName": a.name, "avatar": a.avatar},
            )
    return {"mounts": mounts}


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
    """审核 P0-3 退役：自建对话 Session 不再是生产入口；对话归 AgentScope Session
    （/api/v2/agents/{aid}/sessions）。"""
    raise HTTPException(410, "自建对话已退役：请使用 /api/v2/agents/{agentId}/sessions（AgentScope Session）")


@router.get("/{aid}/chat/sessions/{sid}/messages")
def chat_messages(aid: str, sid: str, db: Session = Depends(get_db)):
    """审核 P0-3 退役：旧消息读取关闭；历史消息归 AgentScope 存储
    （/api/v2/agents/{aid}/sessions/{sid}/messages）。"""
    raise HTTPException(410, "自建对话消息已退役：请使用 /api/v2/agents/{agentId}/sessions/{sessionId}/messages")


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
    from ..agent_chat import LegacyChatRetiredError
    try:
        return start_chat_turn(db, a, s, text, payload.get("attachments") or [],
                               payload.get("modelId") or "")
    except LegacyChatRetiredError as exc:
        raise HTTPException(410, str(exc))


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


@skills_router.post("/upload", status_code=201)
async def upload_skill_file(file: UploadFile, agentIds: str = Form(""),
                            db: Session = Depends(get_db),
                            _user: dict = Depends(require_operator)):
    """09-08 原站对齐：文件驱动上传 Skill。
    支持单个 .md（YAML frontmatter 定义 name/description）或 .zip/.tgz/.tar.gz（含 SKILL.md）；
    agentIds 逗号分隔=上传即挂载目标 Agent（原站两步合一）。"""
    import io
    import re
    import tarfile
    import zipfile
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "文件上限 5MB")
    fn = (file.filename or "").lower()
    text = ""
    # 09-17 规则 Skill 化：zip/tgz 伴生结构化文件白名单（criteria.json/contract.json/
    # masterdata/*.json）入 extra.files；纯散文包不再能承载领域规则。
    companions: dict[str, str] = {}
    COMPANION_RE = re.compile(r"(^|/)(criteria\.json|contract\.json|masterdata/[^/]+\.json)$")

    def _take_companion(path: str, data: bytes) -> None:
        norm = path.lstrip("./")
        if not COMPANION_RE.search(norm):
            return
        if len(data) > 512 * 1024 or sum(len(v) for v in companions.values()) + len(data) > 1024 * 1024:
            raise HTTPException(413, "伴生结构化文件超限（单 512KB / 总 1MB）")
        parts = [p for p in norm.split("/") if p]
        key = "/".join(parts[-2:]) if len(parts) >= 2 and parts[-2] == "masterdata" else parts[-1]
        companions[key] = data.decode("utf-8", "replace")

    if fn.endswith(".md"):
        text = raw.decode("utf-8", "replace")
    elif fn.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            cand = [n for n in z.namelist() if n.rstrip("/").endswith("SKILL.md")]
            if not cand:
                raise HTTPException(422, {"code": "SKILL_MD_MISSING", "message": "压缩包必须包含 SKILL.md 文件"})
            text = z.read(cand[0]).decode("utf-8", "replace")
            for n in z.namelist():
                if z.getinfo(n).file_size:
                    _take_companion(n, z.read(n))
    elif fn.endswith((".tgz", ".tar.gz")):
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:*") as tz:
            cand = [m for m in tz.getmembers() if m.isfile() and m.name.rstrip("/").endswith("SKILL.md")]
            if not cand:
                raise HTTPException(422, {"code": "SKILL_MD_MISSING", "message": "压缩包必须包含 SKILL.md 文件"})
            f = tz.extractfile(cand[0])
            text = f.read().decode("utf-8", "replace") if f else ""
            for m in tz.getmembers():
                if m.isfile():
                    ef = tz.extractfile(m)
                    if ef is not None:
                        _take_companion(m.name, ef.read())
    else:
        raise HTTPException(422, {"code": "SKILL_FILE_TYPE", "message": "仅支持 .md 或 .zip/.tgz/.tar.gz"})
    name, desc, category = "", "", ""
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?", text, re.S)
    body = text
    if m:
        body = text[m.end():]
        for line in m.group(1).splitlines():
            km = re.match(r"^(\w[\w-]*)\s*:\s*(.*)$", line.strip())
            if not km:
                continue
            k, v = km.group(1).lower(), km.group(2).strip().strip("'\"")
            if k == "name":
                name = v
            elif k == "description":
                desc = v
            elif k == "category":
                category = v
    if not name:
        raise HTTPException(422, {"code": "FRONTMATTER_NAME", "message": ".md 需 YAML frontmatter 定义 name"})
    # 09-17：同名 Skill 再上传版本号递增（人读）；复现凭据仍以 content_digest 为准
    prev = (db.query(SkillResource).filter_by(name=name)
            .order_by(SkillResource.version.desc()).first())
    skill = SkillResource(name=name, description=desc, content=text, source="upload",
                          status="ready", category=category,
                          version=(prev.version if prev else 0) + 1,
                          extra={"files": companions} if companions else {})
    db.add(skill)
    db.flush()
    # 换底（2026-09-09）：上传只入平台 Skill 库；实际挂载归 AgentScope Workspace
    db.commit()
    dto = to_dto(db, "skill", skill)
    dto["mounted"] = []
    dto["mount_hint"] = ("挂载请在对话 Session 的 Workspace 内完成："
                         "/api/v2/agents/{agentId}/sessions/{sessionId}/skills/upload")
    return dto
