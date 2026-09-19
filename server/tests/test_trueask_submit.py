"""09-18 TrueAsk submit 端点：硬校验 + acceptance 镜像 + 飞书未配置如实 skipped。

负向对照齐备：非法 ID / 区间重叠 / 状态条件空片段 / 品类枚举 / 飞书包装层参数闸。
飞书 exec 路径不在单测触发（避免测试外呼真实飞书），仅测参数闸与门控前置校验。
"""
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import ConsumerAnalysisResultAcceptance
from tests.conftest import pg_dsn

client = TestClient(app)


@pytest.fixture(scope="module", autouse=True)
def _target_table():
    ddl = (Path(__file__).resolve().parents[2] / "scripts" /
           "sdd13-acceptance-tables.sql").read_text()
    with psycopg.connect(pg_dsn()) as pg:
        pg.execute(ddl)
        pg.commit()
    yield


def _seg(**kw):
    base = dict(start_index=0, end_index=1, scenario_id="fault-consultation",
                intention="冰箱不制冷咨询", quality_id="useful-basic",
                quality_reason="给出了可执行排查步骤", entities=[])
    base.update(kw)
    return base


def _payload(**kw):
    p = dict(analysis_status="in-scope", title="冰箱故障咨询",
             summary="用户咨询冰箱不制冷，Buddy 给出排查方法",
             segments=[_seg()], call_id="acid-test-1")
    p.update(kw)
    return p


def _drop(result_id: str) -> None:
    db = SessionLocal()
    try:
        row = db.get(ConsumerAnalysisResultAcceptance, result_id)
        if row:
            db.delete(row)
            db.commit()
    finally:
        db.close()


def test_submit_ok_and_acceptance_mirror():
    r = client.post("/api/v2/trueask/submit", json=_payload())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] and body["written"]["acceptance"]
    # 未配置 TRUEASK_FEISHU_TARGET = 如实 skipped，不伪造写入
    assert body["written"]["feishu"]["written"] is False
    db = SessionLocal()
    try:
        row = db.get(ConsumerAnalysisResultAcceptance, body["result_id"])
        assert row is not None and row.call_id == "acid-test-1"
        assert row.segments == {"items": [_seg()]}
        assert row.full_output["analysis_status"] == "in-scope"
    finally:
        db.close()
    _drop(body["result_id"])


def test_submit_rejects_bad_ids():
    r = client.post("/api/v2/trueask/submit", json=_payload(
        segments=[_seg(scenario_id="no-such-scenario", quality_id="nope")]))
    assert r.status_code == 422
    issues = " ".join(r.json()["detail"]["issues"])
    assert "scenario_id" in issues and "quality_id" in issues


def test_submit_rejects_overlap():
    r = client.post("/api/v2/trueask/submit", json=_payload(
        segments=[_seg(), _seg(start_index=1, end_index=2)]))
    assert r.status_code == 422
    assert "重叠" in " ".join(r.json()["detail"]["issues"])


def test_submit_status_conditional_empty_segments():
    r = client.post("/api/v2/trueask/submit",
                    json=_payload(analysis_status="out-of-scope"))
    assert r.status_code == 422
    r2 = client.post("/api/v2/trueask/submit", json=_payload(
        analysis_status="insufficient-content", segments=[]))
    assert r2.status_code == 200, r2.text
    _drop(r2.json()["result_id"])


def test_submit_appliance_category_enum():
    r = client.post("/api/v2/trueask/submit", json=_payload(segments=[_seg(entities=[
        {"type_id": "product-identity", "subtype_id": "appliance-category",
         "value": "飞机"}])]))
    assert r.status_code == 422
    assert "品类枚举" in " ".join(r.json()["detail"]["issues"])


def test_feishu_wrapper_param_gates():
    r = client.post("/api/feishu-tools/record_list", json={})
    assert r.status_code == 422
    r2 = client.post("/api/feishu-tools/record_batch_create", json={
        "base_token": "b", "table_id": "t",
        "fields": ["a", "b"], "rows": [["only-one"]]})
    assert r2.status_code == 422
