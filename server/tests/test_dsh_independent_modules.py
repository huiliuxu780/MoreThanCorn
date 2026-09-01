"""Contract tests for the two real-data DSH regression Modules."""
from pathlib import Path
from types import SimpleNamespace

from app.agent_modules import registry as module_registry
from app.models import Agent, AgentVersion, ResultRuleVersion, Run
from app.runtime_providers.dispatcher import build_rule_snapshot, build_runtime_request
from app.task_runner import _apply_mapping, _resolve_rule_version


def canonical_call() -> dict:
    return {
        "schema_version": "1.0",
        "call": {
            "acid": "acid-1", "connid": None, "tenant_id": None,
            "started_at_ms": 1000, "ended_at_ms": 2000,
            "recording_lookup": {"provider": "lydaas-list-record-v2", "lookup_field": "acid"},
        },
        "messages": [{
            "index": 0, "message_id": "m-1", "role": "customer",
            "speaker": {"id": None, "name": None, "source_type": "consumer"},
            "text": "我要转人工", "start_time_ms": 1000, "end_time_ms": 1200,
            "start_offset_ms": 0, "end_offset_ms": 200, "need_split": False,
        }],
        "source": {"format": "canonical", "trace_id": None},
    }


def frozen_rules() -> SimpleNamespace:
    return SimpleNamespace(
        id="rv-1", rule_set_id="rules-1", version_no=7,
        rules={
            "schemaVersion": "1.0", "ruleSetId": "dsh-hotline-quality-v1",
            "readOnlyAtRuntime": True,
            "evaluationRules": [{"id": "QA-001"}, {"id": "QA-002"}],
            "scoreRules": [], "issueRules": [],
        },
    )


def test_registry_exposes_two_independent_modules_and_code_owned_context():
    consumer = module_registry.get("dsh-consumer-analysis", "1.0.0")
    quality = module_registry.get("dsh-quality-rules-analysis", "1.0.0")
    assert consumer.requires_rule_version is False
    assert consumer.produces_quality_result is False
    assert consumer.build_agent_spec({"modelRef": {"modelId": "qwen3.8-max"}})["tools"] == []
    assert consumer.runtime_context["taxonomy"]["taxonomy_version"] == "dsh-consumer-taxonomy-v1"
    assert consumer.runtime_context["product_catalog"]["catalog_version"] == "product-catalog-v1"
    assert quality.requires_rule_version is True
    assert quality.produces_quality_result is True
    assert quality.build_agent_spec({"modelRef": {"modelId": "qwen3.8-max"}})["tools"] == []


def test_root_jsonb_mapping_produces_exact_runtime_document():
    call = canonical_call()
    row = {"sample_id": "sample-1", "canonical_call": call}
    assert _apply_mapping(row, {"$": "canonical_call"}) == call
    assert _apply_mapping(row, {"acid": "canonical_call.call.acid"}) == {"acid": "acid-1"}


def test_frozen_rule_snapshot_and_request_injection_are_exact_and_no_tools():
    consumer = module_registry.get("dsh-consumer-analysis", "1.0.0")
    quality = module_registry.get("dsh-quality-rules-analysis", "1.0.0")
    agent = Agent(id="agent-quality", name="quality", type="module",
                  module_key=quality.key, module_version=quality.version)
    version = AgentVersion(
        id="version-quality", agent_id=agent.id, version_no=1, artifact_hash="a" * 64,
        definition={
            "module": {"key": quality.key, "version": quality.version},
            "agentSpec": quality.build_agent_spec({"modelRef": {
                "modelId": "qwen3.8-max", "provider": "openai-compatible"}}),
        },
    )
    rv = frozen_rules()
    run = Run(id="run-quality", agent_id=agent.id, agent_version_id=version.id,
              rule_version_id=rv.id, input={**canonical_call(), "__rawRow": {"secret": "not-sent"}})

    class FakeDb:
        def get(self, model, key):
            return {Agent: agent, AgentVersion: version, ResultRuleVersion: rv}.get(model)

    db = FakeDb()
    snapshot = build_rule_snapshot(db, rv.id)
    assert snapshot["ruleSetVersion"] == 7
    assert [r["id"] for r in snapshot["evaluationRules"]] == ["QA-001", "QA-002"]
    request = build_runtime_request(db, run)
    assert request.agent.tools == []
    assert request.context.metadata["rule_snapshot"] == snapshot
    assert "__rawRow" not in request.input
    assert request.context.metadata["workflowMode"] == "independent_no_tools_v1"
    assert consumer.workflow_mode == quality.workflow_mode


def test_output_semantics_reject_missing_rule_and_model_score():
    quality = module_registry.get("dsh-quality-rules-analysis", "1.0.0")
    snapshot = build_rule_snapshot(type("Db", (), {"get": lambda *_: frozen_rules()})(), "rv-1")
    good = {
        "call_id": "acid-1", "rule_set_id": snapshot["ruleSetId"],
        "rule_set_version": snapshot["ruleSetVersion"],
        "results": [
            {"rule_id": rid, "result": "passed", "confidence": 1.0, "reason": "有文本证据",
             "evidence": [{"source": "transcript", "message_indexes": [0],
                            "start_ms": None, "end_ms": None, "reference": None,
                            "excerpt": "我要转人工"}]}
            for rid in ("QA-001", "QA-002")
        ],
        "result_by_rule": {"QA-001": "passed", "QA-002": "passed"}, "summary": "ok",
    }
    context = {"input": canonical_call(), "rule_snapshot": snapshot}
    assert quality.validate_output_semantics(good, context) == []
    bad = {**good, "results": good["results"][:1],
           "result_by_rule": {"QA-001": "passed"}}
    assert {i["code"] for i in quality.validate_output_semantics(bad, context)} >= {
        "RULE_COVERAGE_MISMATCH"
    }
    # JSON Schema is the hard guard that prevents Agent-side scoring.
    from jsonschema import Draft202012Validator
    assert list(Draft202012Validator(quality.output_schema).iter_errors({**good, "score": 100}))


def test_consumer_semantics_enforce_call_and_segment_evidence():
    consumer = module_registry.get("dsh-consumer-analysis", "1.0.0")
    output = {
        "call_id": "acid-1", "analysis_status": "in-scope", "title": "转人工", "summary": "客户要求人工",
        "segments": [{
            "segment_id": "segment-1", "start_index": 0, "end_index": 0,
            "scenario_id": "human-handoff", "intention": "转人工",
            "usefulness_id": "guidance-channel-handoff", "usefulness_reason": "已识别诉求",
            "evidence_message_indexes": [0], "entities": [],
        }],
    }
    assert consumer.validate_output_semantics(output, {"input": canonical_call()}) == []
    output["segments"][0]["evidence_message_indexes"] = [99]
    assert "EVIDENCE_INDEX_INVALID" in {
        i["code"] for i in consumer.validate_output_semantics(output, {"input": canonical_call()})
    }


def test_no_tools_cordis_has_no_execution_or_gateway_plugins():
    config = (Path(__file__).resolve().parents[2] / "runtimes" / "deepseek_harness" /
              "config" / "no_tools.cordis.yml").read_text(encoding="utf-8")
    for forbidden in ("mcp-client", "bash-local", "fs-local", "subprocess-local"):
        assert forbidden not in config
