"""Business-result read model and independent-Agent correlation regression tests."""
from uuid import uuid4

from app.business_results import consumer_business_dimensions, project_business_result
from app.db import SessionLocal
from app.models import Agent, DataSnapshot, QualityResult, Run
from app.routers.admin import _correlated_consumer_results
from app.routers.business import _run_dto


def _id() -> str:
    return uuid4().hex


def _consumer_output(call_id: str = "sample-001") -> dict:
    return {
        "call_id": call_id,
        "analysis_status": "in-scope",
        "title": "洗衣机甩干晃动故障报修预约",
        "summary": "消费者反馈洗衣机甩干时晃动并要求预约维修。",
        "segments": [{
            "segment_id": "segment-1",
            "start_index": 0,
            "end_index": 3,
            "scenario_id": "repair-and-appointment",
            "intention": "预约上门维修洗衣机晃动故障",
            "usefulness_id": "useful-basic",
            "usefulness_reason": "坐席完成信息确认并推进预约。",
            "evidence_message_indexes": [0, 3],
            "entities": [{
                "type_id": "product",
                "subtype_id": "category",
                "mention": "洗衣机",
                "normalized_name": "洗衣机",
                "master_code": "1001",
                "resolution_status": "exact",
                "confidence": 1.0,
            }],
        }],
    }


def test_consumer_output_projects_to_business_read_model():
    output = _consumer_output()
    result = project_business_result(output, "dsh-consumer-analysis")
    assert result is not None
    assert result["kind"] == "consumer-analysis"
    assert result["title"] == "洗衣机甩干晃动故障报修预约"
    assert result["scenarios"] == [{"id": "repair-and-appointment", "label": "报修与预约"}]
    assert result["segments"][0]["usefulnessLabel"] == "有用·基础回应"
    assert result["output"] == output
    dims = consumer_business_dimensions(result)
    assert dims["serviceType"] == "报修与预约"
    assert dims["productCategory"] == "洗衣机"
    assert dims["requestType"] == "预约上门维修洗衣机晃动故障"


def test_task_run_dto_contains_persisted_business_result():
    run = Run(id=_id(), status="succeeded", interaction_ref="sample-001", attempt=1,
              output=_consumer_output(), runtime_snapshot={"moduleKey": "dsh-consumer-analysis"})
    dto = _run_dto(run)
    assert dto["businessResult"]["title"] == "洗衣机甩干晃动故障报修预约"
    assert dto["businessResult"]["output"] == run.output


def test_quality_correlation_requires_exact_snapshot_fingerprint():
    db = SessionLocal()
    try:
        agent = Agent(id=_id(), name="消费者回归", type="module", status="active",
                      module_key="dsh-consumer-analysis", module_version="1.0.0")
        match_snapshot = DataSnapshot(
            id=_id(), asset_id=_id(), asset_revision=7, definition_version_id=_id(),
            checksum="a" * 64, expected_count=20, read_count=20,
        )
        wrong_snapshot = DataSnapshot(
            id=_id(), asset_id=match_snapshot.asset_id, asset_revision=8,
            definition_version_id=match_snapshot.definition_version_id,
            checksum="b" * 64, expected_count=20, read_count=20,
        )
        consumer_match = Run(
            id=_id(), agent_id=agent.id, status="succeeded", interaction_ref="same-ref",
            data_snapshot_id=match_snapshot.id, output=_consumer_output("same-ref"),
        )
        consumer_wrong = Run(
            id=_id(), agent_id=agent.id, status="succeeded", interaction_ref="same-ref",
            data_snapshot_id=wrong_snapshot.id,
            output={**_consumer_output("same-ref"), "title": "错误快照结果"},
        )
        quality_run = Run(
            id=_id(), status="succeeded", interaction_ref="same-ref",
            data_snapshot_id=match_snapshot.id, output={"summary": "quality"},
        )
        quality = QualityResult(
            id=_id(), run_id=quality_run.id, interaction_ref="same-ref",
            structured_output={"summary": "quality"}, is_latest=True,
        )
        db.add_all([agent, match_snapshot, wrong_snapshot, consumer_match,
                    consumer_wrong, quality_run])
        db.flush()
        db.add(quality)
        db.flush()

        correlated = _correlated_consumer_results(db, [quality])
        assert correlated[quality.id]["runId"] == consumer_match.id
        assert correlated[quality.id]["title"] != "错误快照结果"
    finally:
        db.rollback()
        db.close()
