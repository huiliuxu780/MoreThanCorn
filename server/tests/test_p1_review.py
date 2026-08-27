"""09-SDD P1-B2 / P1-02：复核工作流——待复核队列 / 领取 / 分配 / 状态机（§11.4）。

先红后绿：当前仅有单条 review 端点，无队列/领取/分配/状态机。
"""
import uuid

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import QualityResult

client = TestClient(app)


def _mk_result(review_status="AI", claimed_by=None) -> str:
    db = SessionLocal()
    try:
        qr = QualityResult(interaction_ref=f"P1RV-{uuid.uuid4().hex[:8]}",
                           review_status=review_status, score=75)
        if claimed_by is not None:
            qr.review_claimed_by = claimed_by
        db.add(qr)
        db.commit()
        return qr.id
    finally:
        db.close()


def _cleanup(rid):
    db = SessionLocal()
    db.query(QualityResult).filter_by(id=rid).delete()
    db.commit()
    db.close()


def test_review_queue_lists_pending():
    rid = _mk_result("AI")
    try:
        r = client.get("/api/quality-results/review-queue", params={"pool": "pending", "pageSize": 200})
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()["items"]]
        assert rid in ids, "待复核队列应包含 AI 状态结果"
        # 已复核的不应出现在 pending 队列
        rid2 = _mk_result("EFFECTIVE")
        r2 = client.get("/api/quality-results/review-queue", params={"pool": "pending", "pageSize": 500})
        ids2 = [x["id"] for x in r2.json()["items"]]
        assert rid2 not in ids2
        _cleanup(rid2)
    finally:
        _cleanup(rid)


def test_claim_transitions_to_in_review():
    rid = _mk_result("AI")
    try:
        r = client.post(f"/api/quality-results/{rid}/claim", json={"reviewer": "qa-1"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["review"] == "IN_REVIEW"
        assert body["claimedBy"] == "qa-1"
        # 已被领取的不再出现在公共待复核队列
        q = client.get("/api/quality-results/review-queue", params={"pool": "pending", "pageSize": 500})
        assert rid not in [x["id"] for x in q.json()["items"]]
        # 出现在"我的"队列
        mine = client.get("/api/quality-results/review-queue",
                          params={"pool": "mine", "reviewer": "qa-1", "pageSize": 200})
        assert rid in [x["id"] for x in mine.json()["items"]]
    finally:
        _cleanup(rid)


def test_release_back_to_pool():
    rid = _mk_result("AI")
    try:
        client.post(f"/api/quality-results/{rid}/claim", json={"reviewer": "qa-2"})
        client.post(f"/api/quality-results/{rid}/release")
        q = client.get("/api/quality-results/review-queue", params={"pool": "pending", "pageSize": 500})
        assert rid in [x["id"] for x in q.json()["items"]], "释放后应回到待复核池"
    finally:
        _cleanup(rid)


def test_state_machine_full_cycle():
    """AI → IN_REVIEW(claim) → REVIEWED(approve) → EFFECTIVE(effective) → REOPENED(reopen)。"""
    rid = _mk_result("AI")
    try:
        client.post(f"/api/quality-results/{rid}/claim", json={"reviewer": "qa-3"})
        r1 = client.post(f"/api/quality-results/{rid}/review", json={"action": "approve", "reviewer": "qa-3"})
        assert r1.json()["review"] == "REVIEWED"
        r2 = client.post(f"/api/quality-results/{rid}/review", json={"action": "effective", "reviewer": "qa-3"})
        assert r2.json()["review"] == "EFFECTIVE"
        r3 = client.post(f"/api/quality-results/{rid}/review", json={"action": "reopen", "reviewer": "qa-3"})
        assert r3.json()["review"] == "REOPENED", "重开应进入 REOPENED 回到待复核池"
        # REOPENED 应可再次被领取
        q = client.get("/api/quality-results/review-queue", params={"pool": "pending", "pageSize": 500})
        assert rid in [x["id"] for x in q.json()["items"]]
    finally:
        _cleanup(rid)


def test_assign_to_specific_reviewer():
    rid = _mk_result("AI")
    try:
        r = client.post(f"/api/quality-results/{rid}/assign", json={"reviewer": "qa-lead"})
        assert r.status_code == 200
        assert r.json()["claimedBy"] == "qa-lead"
    finally:
        _cleanup(rid)
