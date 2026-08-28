"""R-Archive 测试公共构件：旧三类 Agent 的历史数据经 DB 直接播种。

API 创建入口已封存（410），历史数据模拟采用 DB 播种；名称带随机尾避免持久库撞名。
"""
import uuid

from app.db import SessionLocal
from app.models import Agent, AgentVersion, Release

TYPES = ("autonomous", "dialogue", "expert-group")


def uniq(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def seed_agent(name: str | None = None, atype: str = "autonomous", config: dict | None = None,
               archived: bool = False, workflow_id: str | None = None) -> dict:
    db = SessionLocal()
    try:
        a = Agent(name=name or uniq(atype), type=atype, config=config or {},
                  archived=archived, workflow_id=workflow_id)
        db.add(a)
        db.commit()
        return {"id": a.id, "name": a.name, "type": a.type}
    finally:
        db.close()


def seed_version(agent_id: str, definition: dict | None = None,
                 dependency_snapshot: dict | None = None) -> dict:
    db = SessionLocal()
    try:
        last = (db.query(AgentVersion).filter_by(agent_id=agent_id)
                .order_by(AgentVersion.version_no.desc()).first())
        v = AgentVersion(agent_id=agent_id, version_no=(last.version_no + 1) if last else 1,
                         definition=definition or {"rolePrompt": "seeded"},
                         dependency_snapshot=dependency_snapshot or {"items": []},
                         artifact_hash="0" * 64)
        db.add(v)
        db.commit()
        return {"id": v.id, "versionNo": v.version_no}
    finally:
        db.close()


def seed_release(agent_id: str, version_id: str, environment: str = "sandbox",
                 status: str = "active", canary_percent: int = 0) -> dict:
    db = SessionLocal()
    try:
        r = Release(agent_id=agent_id, agent_version_id=version_id, environment=environment,
                    status=status, canary_percent=canary_percent)
        db.add(r)
        db.commit()
        return {"id": r.id}
    finally:
        db.close()
