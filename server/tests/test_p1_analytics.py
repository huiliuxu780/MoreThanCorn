"""09-SDD P1-B3 / P1-03：真实质量分析——服务端全量聚合（KPI/趋势/Top问题/维度下钻）。

先红后绿：当前无服务端聚合端点（前端取 200 条自算）。所有聚合必须 SQL 完成。
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import QualityResult

client = TestClient(app)

_TAG = f"P1ANA-{uuid.uuid4().hex[:6]}"
_SEEDED = []


def _seed(results):
    """results: [(score, risk, issueCount, issueSummary, days_ago, team)]"""
    db = SessionLocal()
    try:
        for score, risk, ic, isum, days_ago, team in results:
            qr = QualityResult(
                interaction_ref=f"{_TAG}-{uuid.uuid4().hex[:6]}",
                score=score, risk=risk, issue_count=ic, issue_summary=isum,
                critical=(risk == "Critical"),
                interaction_time=datetime.now(timezone.utc) - timedelta(days=days_ago),
                structured_output={"org": {"teamName": team}} if team else {})
            db.add(qr)
            db.flush()
            _SEEDED.append(qr.id)
        db.commit()
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def seed_and_cleanup():
    # 4 条今天（2 条有问题，1 条 Critical）+ 2 条 3 天前（1 条有问题）
    _seed([
        (90, "Low", 0, None, 0, "teamA"),
        (70, "Medium", 1, "承诺未兑现", 0, "teamA"),
        (40, "Critical", 2, "辱骂用户;承诺未兑现", 0, "teamB"),
        (85, "Low", 0, None, 0, "teamB"),
        (60, "High", 1, "承诺未兑现", 3, "teamA"),
        (95, "Low", 0, None, 3, "teamA"),
    ])
    yield
    db = SessionLocal()
    db.query(QualityResult).filter(QualityResult.id.in_(_SEEDED)).delete(synchronize_session=False)
    db.commit()
    db.close()


def test_kpi_server_side_aggregation():
    r = client.get("/api/quality/analytics/kpi", params={"search": _TAG})
    assert r.status_code == 200, r.text
    k = r.json()
    assert k["total"] == 6
    assert k["critical"] == 1
    # 平均分 = (90+70+40+85+60+95)/6 = 73.33
    assert abs(k["avgScore"] - 73.33) < 0.5
    # 有问题（issueCount>0）= 3 条 → 50%
    assert abs(k["issueRate"] - 0.5) < 0.01


def test_trend_daily_grouping():
    r = client.get("/api/quality/analytics/trend", params={"days": 7, "search": _TAG})
    assert r.status_code == 200, r.text
    rows = r.json()["items"]
    # 应有两天分组（今天 4 条 + 3 天前 2 条）
    assert len(rows) >= 2
    counts = {row["date"]: row["count"] for row in rows}
    assert 4 in counts.values() and 2 in counts.values(), f"按日分组计数错误：{counts}"


def test_top_issues_aggregation():
    r = client.get("/api/quality/analytics/top-issues", params={"search": _TAG})
    assert r.status_code == 200, r.text
    issues = r.json()["items"]
    # "承诺未兑现" 出现在 3 条结果中，应为最高频
    assert issues, "应聚合出问题列表"
    top = issues[0]
    assert top["criterion"] == "承诺未兑现"
    assert top["affected"] == 3


def test_dimension_breakdown_by_team():
    r = client.get("/api/quality/analytics/by-dimension",
                   params={"dim": "team", "search": _TAG})
    assert r.status_code == 200, r.text
    rows = {x["value"]: x for x in r.json()["items"]}
    assert "teamA" in rows and "teamB" in rows
    assert rows["teamA"]["count"] == 4
    assert rows["teamB"]["count"] == 2
    # teamA 平均分 = (90+70+60+95)/4 = 78.75
    assert abs(rows["teamA"]["avgScore"] - 78.75) < 0.5
