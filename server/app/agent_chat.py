"""对话工作区运行时（09-07 Agent 能力重构）。

语义=角色对话 MVP：system prompt 由 Agent 身份（名称/描述/核心能力）+ 全局记忆文档
+ 已装 Skill 摘要组成，带会话历史流式直连模型（复用 agent_runtime._chat_completion
on_delta）；**不触发** Module 冻结 schema 的结构化执行（结构化干活走 run/测试面板）。
每个 assistant turn 落一条 Run(trigger="chat")，流式增量写 RunEvent(llm_delta)，
终态 emit agent_completed/agent_failed——前端 streamRunEvents 的 TERMINAL 集合直接可用。
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .agent_runtime import RunError, _chat_completion
from .db import SessionLocal
from .models import (Agent, AgentChatMessage, AgentChatSession, AgentMemory, AgentSkill,
                     Model, Run, SkillResource)
from .models import new_id
from .runner import emit

HISTORY_TURNS = 16  # 带入上下文的历史消息条数（MVP 固定窗口）
DELTA_BATCH = 64  # llm_delta 事件批量阈值：缓冲到该字符数才落一条 RunEvent


def _system_prompt(db: Session, agent: Agent) -> str:
    cfg = agent.config or {}
    parts = [f"你是数字员工「{agent.name}」。"]
    rp = (cfg.get("rolePrompt") or "").strip()
    if rp:
        parts.append(rp)
    if agent.description:
        parts.append(f"角色描述：{agent.description}")
    caps = cfg.get("capabilities") or []
    if caps:
        parts.append("核心能力：" + "；".join(
            f"{c.get('name', '')}（{c.get('description', '')}）" for c in caps if isinstance(c, dict)))
    mem = db.execute(select(AgentMemory).where(AgentMemory.agent_id == agent.id)).scalars().first()
    if mem and (mem.content or "").strip():
        parts.append(f"全局记忆：\n{mem.content}")
    skills = [db.get(SkillResource, l.skill_id) for l in
              db.execute(select(AgentSkill).where(AgentSkill.agent_id == agent.id)).scalars()]
    named = [s.name for s in skills if s]
    if named:
        parts.append("已安装 Skill：" + "、".join(named))
    parts.append("请以该角色身份与用户自然对话；如需结构化业务执行，请提示用户到任务看板或配置页发起运行。")
    return "\n\n".join(parts)


def resolve_model_key(db: Session, model_id: str, agent: Agent) -> str:
    """model_id 优先（对话页模型选择）；回落 Agent config.modelRef.modelId；再回落首个启用 Model。"""
    if model_id:
        m = db.get(Model, model_id)
        if m:
            return m.model_key
        m = db.execute(select(Model).where(Model.model_key == model_id)).scalars().first()
        if m:
            return m.model_key
    cfg_ref = ((agent.config or {}).get("modelRef") or {}).get("modelId") or ""
    if cfg_ref:
        m = db.get(Model, cfg_ref) or db.execute(
            select(Model).where(Model.model_key == cfg_ref)).scalars().first()
        if m:
            return m.model_key
    m = db.execute(select(Model).where(Model.enabled.is_(True))
                   .order_by(Model.model_key).limit(1)).scalars().first()
    if not m:
        raise RunError("MODEL_UNAVAILABLE：未配置可用模型，请先在资源中启用模型")
    return m.model_key


def start_chat_turn(db: Session, agent: Agent, session: AgentChatSession, text: str,
                    attachments: list[dict], model_id: str) -> dict:
    """创建 user/assistant 消息 + Run(trigger=chat) 并入队 chat-turn；立即返回。"""
    user_msg = AgentChatMessage(session_id=session.id, role="user", content=text,
                                attachments=attachments or [], model_id=model_id or "")
    db.add(user_msg)
    db.flush()
    asst_msg = AgentChatMessage(session_id=session.id, role="assistant", content="",
                                model_id=model_id or "", status="streaming")
    db.add(asst_msg)
    db.flush()
    run = Run(id=new_id(), agent_id=agent.id, trigger="chat",
              input={"sessionId": session.id, "text": text[:500],
                     "attachments": [a.get("name", "") for a in (attachments or [])]})
    db.add(run)
    db.flush()
    asst_msg.run_id = run.id
    if not session.title:
        session.title = text[:20] or "新对话"
    db.commit()
    emit(db, run.id, "agent_started", payload={"agentId": agent.id, "sessionId": session.id,
                                               "chat": True})
    from .models import JobQueue
    db.add(JobQueue(type="chat-turn", payload={"run_id": run.id, "message_id": asst_msg.id}))
    db.commit()
    return {"sessionId": session.id, "userMessageId": user_msg.id,
            "assistantMessageId": asst_msg.id, "runId": run.id}


def execute_chat_turn(payload: dict) -> None:
    """worker 分派入口：流式执行一个对话 turn 并落终态。"""
    run_id = payload["run_id"]
    message_id = payload["message_id"]
    db = SessionLocal()
    try:
        run = db.get(Run, run_id)
        msg = db.get(AgentChatMessage, message_id)
        if run is None or msg is None:
            return
        session = db.get(AgentChatSession, msg.session_id)
        agent = db.get(Agent, run.agent_id or "")
        if session is None or agent is None:
            run.status = "failed"
            run.error = {"message": "session/agent 缺失"}
            msg.status = "failed"
            db.commit()
            emit(db, run.id, "agent_failed", payload={"message": "session/agent 缺失"})
            return
        run.status = "running"
        db.commit()
        history = (db.execute(
            select(AgentChatMessage)
            .where(AgentChatMessage.session_id == session.id,
                   AgentChatMessage.status == "done", AgentChatMessage.id != msg.id)
            .order_by(AgentChatMessage.created_at.desc()).limit(HISTORY_TURNS))
            .scalars().all())
        history.reverse()
        messages = [{"role": "system", "content": _system_prompt(db, agent)}]
        for h in history:
            messages.append({"role": h.role, "content": h.content})
        user_msg = (db.execute(
            select(AgentChatMessage)
            .where(AgentChatMessage.session_id == session.id, AgentChatMessage.role == "user",
                   AgentChatMessage.created_at <= msg.created_at)
            .order_by(AgentChatMessage.created_at.desc()).limit(1)).scalars().first())
        user_text = user_msg.content if user_msg else ""
        atts = (user_msg.attachments or []) if user_msg else []
        if atts:
            user_text += "\n[附件] " + "、".join(a.get("name", "") for a in atts)
        messages.append({"role": "user", "content": user_text})
        model_key = resolve_model_key(db, msg.model_id, agent)

        buf: list[str] = []

        def on_delta(d: str) -> None:
            buf.append(d)
            if sum(len(x) for x in buf) >= DELTA_BATCH:
                emit(db, run.id, "llm_delta", payload={"delta": "".join(buf)})
                buf.clear()

        result = _chat_completion(db, model_key, messages, [], on_delta=on_delta)
        if buf:
            emit(db, run.id, "llm_delta", payload={"delta": "".join(buf)})
            buf.clear()
        content = result.get("content") or ""
        msg.content = content
        msg.status = "done"
        run.status = "succeeded"
        run.output = {"content": content[:2000]}
        db.commit()
        emit(db, run.id, "reply_sent", payload={"content": content})
        emit(db, run.id, "agent_completed", payload={"chat": True})
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        msg = db.get(AgentChatMessage, message_id)
        run = db.get(Run, run_id)
        if msg is not None:
            msg.status = "failed"
        if run is not None:
            run.status = "failed"
            run.error = {"message": str(exc)}
        db.commit()
        if run is not None:
            emit(db, run.id, "agent_failed", payload={"message": str(exc)})
    finally:
        db.close()
