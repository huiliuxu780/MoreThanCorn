"""对话任务标题 = 首条用户消息的 LLM 短总结（09-16 用户指认 f：「对话」式命名体验差）。

fire-and-forget 后台线程：首轮 turn 触发；失败/无模型回落原文截断，绝不阻塞回合。
同 session 并发去重（_INFLIGHT），重复触发只生成一次。
"""
from __future__ import annotations

import threading

from sqlalchemy import select

_INFLIGHT: set[str] = set()
_LOCK = threading.Lock()

_SYSTEM = ("你是会话标题生成器。用 4-12 个字总结用户消息的主题，"
           "只输出总结本身，不要标点、引号或解释。")


def summarize_title(db, text: str) -> str:
    """同步生成短标题；任何失败回落 text 截断（调用方保证 db 会话独立）。
    逐 enabled 模型尝试：个别模型行被提供商拒绝（如 401）时换下一个。"""
    from .agent_runtime import _chat_completion
    from .models import Model

    fallback = (text or "").strip().replace("\n", " ")[:12] or "对话"
    models = db.execute(select(Model).where(Model.enabled.is_(True))
                        .order_by(Model.model_key)).scalars().all()
    if not models:
        return fallback
    msgs = [{"role": "system", "content": _SYSTEM},
            {"role": "user", "content": (text or "")[:800]}]
    for m in models:
        try:
            out = _chat_completion(db, m.model_key, msgs, [])
        except Exception:  # noqa: BLE001 —— 含 RunError/凭据 401/网络；换下一个模型
            continue
        title = (out.get("content") or "").strip().replace("\n", "")[:16]
        if title:
            return title
    return fallback


def spawn_agent_session_title(session_id: str, text: str) -> None:
    """agent 对话：首轮后写 agent_session_index.title（仅当仍为空）。"""
    _spawn(f"agent:{session_id}", lambda db: _apply_agent(db, session_id, text))


def spawn_group_session_title(gsid: str, text: str) -> None:
    """群对话：首轮后写 agent_group_session.title（仅当仍为默认「任务 N」/空）。"""
    _spawn(f"group:{gsid}", lambda db: _apply_group(db, gsid, text))


def _spawn(key: str, apply) -> None:
    with _LOCK:
        if key in _INFLIGHT:
            return
        _INFLIGHT.add(key)

    def _run() -> None:
        from .db import SessionLocal
        db = SessionLocal()
        try:
            apply(db)
            db.commit()
        except Exception:  # noqa: BLE001 —— 标题生成失败不影响主链路
            db.rollback()
        finally:
            db.close()
            with _LOCK:
                _INFLIGHT.discard(key)

    threading.Thread(target=_run, daemon=True, name=f"title-{key}").start()


def _apply_agent(db, session_id: str, text: str) -> None:
    from .models import AgentSessionIndex
    row = db.query(AgentSessionIndex).filter_by(session_id=session_id).first()
    if row is None or row.title:
        return
    row.title = summarize_title(db, text)


def _apply_group(db, gsid: str, text: str) -> None:
    from .models import AgentGroupSession
    gs = db.get(AgentGroupSession, gsid)
    if gs is None or (gs.title and not gs.title.startswith("任务 ")):
        return
    gs.title = summarize_title(db, text)
