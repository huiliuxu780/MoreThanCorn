"""审计返工 P0-6 事故修复（2026-09-10 二轮）：Session 删除守卫。

背景：对话页自动挂载既有会话 + 脚本清理误删，曾把被 Run 引用的 Task E2E 证据
Session 删除，产生 run→session 孤儿引用（事故登记见验收报告）。修复：
DELETE /api/v2/agents/{aid}/sessions/{sid} 对被平台 Run 引用的 Session 一律 409
（SESSION_REFERENCED_BY_RUN），未被引用时维持原删除语义。
"""
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import Run

from ._legacy_agents import seed_agent, uniq

client = TestClient(app)


def test_delete_session_blocked_when_referenced_by_run():
    a = seed_agent(atype="custom")
    sid = uniq("sess-guard")
    db = SessionLocal()
    try:
        db.add(Run(agent_id=a["id"], trigger="manual", status="succeeded",
                   agentscope_session_id=sid))
        db.commit()
    finally:
        db.close()
    r = client.delete(f"/api/v2/agents/{a['id']}/sessions/{sid}")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "SESSION_REFERENCED_BY_RUN"
    # 索引/运行时未被触碰：再次调用仍 409（幂等拒绝）
    r2 = client.delete(f"/api/v2/agents/{a['id']}/sessions/{sid}")
    assert r2.status_code == 409


def test_delete_session_allowed_without_run_reference():
    a = seed_agent(atype="custom")
    sid = uniq("sess-free")
    r = client.delete(f"/api/v2/agents/{a['id']}/sessions/{sid}")
    assert r.status_code == 200
    assert r.json()["deleted"] is True
