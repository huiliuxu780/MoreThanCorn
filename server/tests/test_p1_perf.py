"""09-SDD P1-B1 / P1-10：查询性能——关键索引 + 列表服务端过滤（不全表进 Python）。

先红后绿：当前 quality_result 缺常用筛选索引，且业务维度筛选全表载入 Python。
"""
from sqlalchemy import text

from app.db import SessionLocal


def _index_names(db, table: str) -> set[str]:
    rows = db.execute(text(
        "SELECT indexname FROM pg_indexes WHERE tablename=:t"), {"t": table}).all()
    return {r[0] for r in rows}


def test_quality_result_has_filter_indexes():
    db = SessionLocal()
    try:
        idx = _index_names(db, "quality_result")
        # 常用筛选/追踪维度必须有索引（09 §6.10：常用维度结构化并建索引）
        need_substr = ["interaction_ref", "task_run_id", "task_id",
                       "interaction_time", "score", "rule_version_id"]
        joined = " ".join(sorted(idx))
        for col in need_substr:
            assert any(col in name for name in idx), \
                f"quality_result 缺少 {col} 索引（现有：{joined}）"
    finally:
        db.close()


def test_run_and_taskrun_have_lookup_indexes():
    db = SessionLocal()
    try:
        run_idx = _index_names(db, "run")
        assert any("task_run_id" in n for n in run_idx), "run 缺 task_run_id 索引"
        assert any("interaction_ref" in n for n in run_idx), "run 缺 interaction_ref 索引"
        tr_idx = _index_names(db, "task_run")
        assert any("task_id" in n for n in tr_idx), "task_run 缺 task_id 索引"
    finally:
        db.close()


def test_quality_results_dim_filter_server_side():
    """业务维度筛选必须由 SQL 完成且结果正确（不以全表载入 Python 冒充）。"""
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    # 用不可能命中的维度值过滤：应返回 0 且不走全表
    r = client.get("/api/quality-results", params={"team": "__no_such_team__", "pageSize": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 0, "不可能命中的维度应返回 0"
    assert body["items"] == []


def test_quality_results_dim_filter_positive_match():
    """有真实维度数据时，SQL 下推筛选必须命中对应结果（而非只会返回空）。"""
    from fastapi.testclient import TestClient
    from app.db import SessionLocal
    from app.main import app
    from app.models import QualityResult, Run
    db = SessionLocal()
    try:
        run = Run(workflow_id=None, trigger="test", status="succeeded",
                  input={"team": "p1-perf-team", "serviceType": "p1-perf-svc"})
        db.add(run)
        db.flush()
        qr = QualityResult(run_id=run.id, interaction_ref="P1-PERF-1",
                           structured_output={"businessContext": {"brand": "p1-perf-brand"}},
                           score=80)
        db.add(qr)
        db.commit()
        qr_id, run_id = qr.id, run.id
    finally:
        db.close()
    client = TestClient(app)
    try:
        # 命中：按 run.input 的 team
        hit = client.get("/api/quality-results", params={"team": "p1-perf-team", "pageSize": 50})
        assert hit.status_code == 200 and hit.json()["total"] >= 1
        assert any(i["id"] == qr_id for i in hit.json()["items"])
        # 命中：按 structured_output.businessContext 的 brand
        hit2 = client.get("/api/quality-results", params={"brand": "p1-perf-brand", "pageSize": 50})
        assert any(i["id"] == qr_id for i in hit2.json()["items"])
        # 不命中的组合
        miss = client.get("/api/quality-results", params={"team": "other-team", "pageSize": 5})
        assert not any(i["id"] == qr_id for i in miss.json()["items"])
    finally:
        db = SessionLocal()
        db.query(QualityResult).filter_by(id=qr_id).delete()
        db.query(Run).filter_by(id=run_id).delete()
        db.commit()
        db.close()
