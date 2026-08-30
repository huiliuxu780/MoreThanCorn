from __future__ import annotations

from inspect import signature

import pytest

from independent_agents.normalizer import normalize_hotline_payload
from independent_agents.request_builder import (
    build_consumer_analysis_request,
    build_quality_rules_request,
    load_rule_snapshot,
    validate_consumer_output,
    validate_quality_output,
)
from independent_agents.rule_import import build_result_rule_set_create_payload


def _call() -> dict:
    return normalize_hotline_payload(
        {
            "success": True,
            "data": [
                {
                    "id": 1,
                    "acid": "A-1",
                    "connid": "C-1",
                    "tenantId": 1,
                    "senderType": 1,
                    "senderId": 1,
                    "senderName": "客户姓名",
                    "content": "转人工",
                    "startTime": 1000,
                    "endTime": 1100,
                },
                {
                    "id": 2,
                    "acid": "A-1",
                    "connid": "C-1",
                    "tenantId": 1,
                    "senderType": 2,
                    "senderId": 2,
                    "senderName": "坐席姓名",
                    "content": "已经为您转接",
                    "startTime": 1200,
                    "endTime": 1300,
                },
            ],
        }
    )


def test_two_builders_are_independent_and_share_only_the_call_contract() -> None:
    call = _call()
    rules = load_rule_snapshot()
    consumer = build_consumer_analysis_request(call, model="model-a")
    quality = build_quality_rules_request(call, rule_snapshot=rules, model="model-b")

    assert "consumer" not in signature(build_quality_rules_request).parameters
    assert consumer.run_id != quality.run_id
    assert consumer.input == quality.input == call
    assert consumer.context.metadata["agent_kind"] == "consumer-analysis"
    assert quality.context.metadata["agent_kind"] == "quality-rules-analysis"
    catalog = consumer.context.metadata["master_data"]["product_catalog"]
    assert next(item for item in catalog["brands"] if item["name_zh"] == "西门子")["code"] == "A02"
    assert next(item for item in catalog["product_groups"] if item["group_name"] == "洗碗机")["group_code"] == "1201"
    assert "rule_snapshot" not in consumer.context.metadata
    assert "taxonomy" not in quality.context.metadata
    assert quality.agent.tools == []


def test_rule_seed_has_ten_items_and_is_compatible_with_system_scoring_projection() -> None:
    rules = load_rule_snapshot()
    ids = [rule["id"] for rule in rules["evaluationRules"]]

    assert ids == [f"QA-{index:03d}" for index in range(1, 11)]
    assert sum(rule["weight"] for rule in rules["scoreRules"]) == 100
    assert {rule["field"] for rule in rules["scoreRules"]} == {
        f"result_by_rule.{rule_id}" for rule_id in ids
    }


def test_rule_seed_builds_admin_import_payload_without_publishing() -> None:
    rules = load_rule_snapshot()

    payload = build_result_rule_set_create_payload(rules, agent_id="quality-agent-id")

    assert payload["agentId"] == "quality-agent-id"
    assert payload["rules"]["readOnlyAtRuntime"] is True
    assert len(payload["rules"]["evaluationRules"]) == 10
    assert "ruleSetVersion" not in payload["rules"]


def test_consumer_output_validation_checks_non_overlapping_segments() -> None:
    call = _call()
    output = {
        "call_id": "A-1",
        "analysis_status": "in-scope",
        "title": "转人工",
        "summary": "客户要求转人工，得到回应。",
        "segments": [
            {
                "segment_id": "segment-1",
                "start_index": 0,
                "end_index": 1,
                "scenario_id": "human-handoff",
                "intention": "转接人工",
                "usefulness_id": "guidance-channel-handoff",
                "usefulness_reason": "给出了明确转接路径。",
                "evidence_message_indexes": [0, 1],
                "entities": [],
            }
        ],
    }
    validate_consumer_output(output, call)
    output["segments"].append({**output["segments"][0], "segment_id": "segment-2"})
    with pytest.raises(ValueError, match="non-overlapping"):
        validate_consumer_output(output, call)


def test_quality_output_must_cover_frozen_rules_exactly_once() -> None:
    call = _call()
    rules = load_rule_snapshot()
    results = [
        {
            "rule_id": rule["id"],
            "result": "not_applicable",
            "confidence": 1,
            "reason": "此最小样本不适用。",
            "evidence": [],
        }
        for rule in rules["evaluationRules"]
    ]
    output = {
        "call_id": "A-1",
        "rule_set_id": rules["ruleSetId"],
        "rule_set_version": rules["ruleSetVersion"],
        "results": results,
        "result_by_rule": {result["rule_id"]: result["result"] for result in results},
        "summary": "完成固定规则覆盖。",
    }

    validate_quality_output(output, rules, call)
    output["results"] = output["results"][:-1]
    with pytest.raises(ValueError, match="every rule"):
        validate_quality_output(output, rules, call)
