"""Provider-neutral builders and validators for two independent Runtime runs."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Iterable

from jsonschema import Draft202012Validator, FormatChecker

from quality_runtime_contract import (
    AgentExecutionSpec,
    ExecutionContext,
    MasterDataRef,
    ModelSpec,
    RuntimeExecuteRequest,
    ToolRef,
)


ROOT = Path(__file__).resolve().parent
SCHEMA_ROOT = ROOT / "schemas"
SPEC_ROOT = ROOT / "agent_specs"
MASTER_DATA_ROOT = ROOT / "master_data"


def _json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON root must be an object: {path}")
    return value


def _validate(value: dict[str, Any], schema_name: str) -> None:
    schema = _json(SCHEMA_ROOT / schema_name)
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(value)


def validate_canonical_call(call: dict[str, Any]) -> None:
    _validate(call, "hotline_call_input.schema.json")
    indexes = [message["index"] for message in call["messages"]]
    if indexes != list(range(len(indexes))):
        raise ValueError("message indexes must be continuous, zero-based and ordered")
    call_start = call["call"]["started_at_ms"]
    call_end = call["call"]["ended_at_ms"]
    if call_end < call_start:
        raise ValueError("call ends before it starts")
    for message in call["messages"]:
        if message["end_time_ms"] < message["start_time_ms"]:
            raise ValueError(f"message {message['index']} ends before it starts")
        if message["start_offset_ms"] != message["start_time_ms"] - call_start:
            raise ValueError(f"message {message['index']} has an invalid start offset")
        if message["end_offset_ms"] != message["end_time_ms"] - call_start:
            raise ValueError(f"message {message['index']} has an invalid end offset")


def load_rule_snapshot(path: str | Path | None = None) -> dict[str, Any]:
    snapshot = _json(Path(path) if path else MASTER_DATA_ROOT / "quality_rules_seed_v1.json")
    _validate(snapshot, "quality_rule_snapshot.schema.json")
    ids = [rule["id"] for rule in snapshot["evaluationRules"]]
    if len(ids) != len(set(ids)):
        raise ValueError("evaluation rule ids must be unique")
    return snapshot


def _spec(name: str) -> dict[str, Any]:
    return _json(SPEC_ROOT / name)


def build_consumer_analysis_request(
    call: dict[str, Any],
    *,
    model: str,
    model_provider: str = "deepseek-compatible",
    model_parameters: dict[str, Any] | None = None,
    run_id: str | None = None,
    master_data: dict[str, Any] | None = None,
    timeout_seconds: int = 300,
) -> RuntimeExecuteRequest:
    """Build Agent 1. No Agent 2 result is accepted by this API."""

    validate_canonical_call(call)
    spec = _spec("consumer_analysis_agent_v1.json")
    taxonomy = _json(MASTER_DATA_ROOT / "conversation_taxonomy_v1.json")
    product_catalog = _json(MASTER_DATA_ROOT / "product_catalog_v1.json")
    acid = call["call"]["acid"]
    actual_run_id = run_id or f"consumer-analysis-{acid}"
    return RuntimeExecuteRequest(
        run_id=actual_run_id,
        idempotency_key=f"consumer-analysis:1.0.0:{actual_run_id}",
        agent=AgentExecutionSpec(
            id=spec["id"],
            version=spec["version"],
            instructions=spec["instructions"],
            model=ModelSpec(
                provider=model_provider,
                model=model,
                parameters=model_parameters or {"max_tokens": 8192},
            ),
            tools=[],
            master_data=[MasterDataRef(name=item["name"], version=item["version"])
                         for item in spec["master_data"]],
            output_schema=_json(SCHEMA_ROOT / "consumer_analysis_output.schema.json"),
        ),
        input=copy.deepcopy(call),
        context=ExecutionContext(
            task_instance_id=acid,
            trace_id=actual_run_id,
            metadata={
                "agent_kind": "consumer-analysis",
                "taxonomy": taxonomy,
                "master_data": copy.deepcopy(
                    master_data if master_data is not None else {"product_catalog": product_catalog}
                ),
            },
        ),
        timeout_seconds=timeout_seconds,
    )


def build_quality_rules_request(
    call: dict[str, Any],
    *,
    rule_snapshot: dict[str, Any],
    model: str,
    model_provider: str = "deepseek-compatible",
    model_parameters: dict[str, Any] | None = None,
    run_id: str | None = None,
    available_tools: Iterable[str] = (),
    timeout_seconds: int = 300,
) -> RuntimeExecuteRequest:
    """Build Agent 2 directly from the call and a frozen rule snapshot.

    There is intentionally no consumer-analysis output argument.
    """

    validate_canonical_call(call)
    _validate(rule_snapshot, "quality_rule_snapshot.schema.json")
    spec = _spec("quality_rules_agent_v1.json")
    acid = call["call"]["acid"]
    actual_run_id = run_id or f"quality-rules-{acid}"
    supported = {item["name"]: item for item in spec["tools"]}
    requested = set(available_tools)
    unknown = requested - set(supported)
    if unknown:
        raise ValueError(f"unsupported Agent 2 tools: {sorted(unknown)}")
    tools = [ToolRef(name=name, version=supported[name]["version"]) for name in sorted(requested)]
    return RuntimeExecuteRequest(
        run_id=actual_run_id,
        idempotency_key=(
            f"quality-rules:{rule_snapshot['ruleSetId']}:{rule_snapshot['ruleSetVersion']}:{actual_run_id}"
        ),
        agent=AgentExecutionSpec(
            id=spec["id"],
            version=spec["version"],
            instructions=spec["instructions"],
            model=ModelSpec(
                provider=model_provider,
                model=model,
                parameters=model_parameters or {"max_tokens": 8192},
            ),
            tools=tools,
            master_data=[],
            output_schema=_json(SCHEMA_ROOT / "quality_rules_output.schema.json"),
        ),
        input=copy.deepcopy(call),
        context=ExecutionContext(
            task_instance_id=acid,
            trace_id=actual_run_id,
            metadata={
                "agent_kind": "quality-rules-analysis",
                "rule_snapshot": copy.deepcopy(rule_snapshot),
                "available_tools": sorted(requested),
            },
        ),
        timeout_seconds=timeout_seconds,
    )


def _message_index_set(call: dict[str, Any]) -> set[int]:
    return {message["index"] for message in call["messages"]}


def validate_consumer_output(output: dict[str, Any], call: dict[str, Any]) -> None:
    _validate(output, "consumer_analysis_output.schema.json")
    if output["call_id"] != call["call"]["acid"]:
        raise ValueError("consumer output call_id does not match acid")
    known_indexes = _message_index_set(call)
    previous_end = -1
    for position, segment in enumerate(output["segments"], start=1):
        if segment["segment_id"] != f"segment-{position}":
            raise ValueError("segment ids must be continuous and ordered")
        if segment["start_index"] > segment["end_index"]:
            raise ValueError("segment starts after it ends")
        if segment["start_index"] <= previous_end:
            raise ValueError("segments must be ordered and non-overlapping")
        if segment["start_index"] not in known_indexes or segment["end_index"] not in known_indexes:
            raise ValueError("segment boundary references an unknown message")
        previous_end = segment["end_index"]
        for evidence_index in segment["evidence_message_indexes"]:
            if evidence_index not in known_indexes:
                raise ValueError("segment evidence references an unknown message")
        for entity in segment["entities"]:
            if not set(entity["evidence_message_indexes"]).issubset(known_indexes):
                raise ValueError("entity evidence references an unknown message")


def validate_quality_output(
    output: dict[str, Any],
    rule_snapshot: dict[str, Any],
    call: dict[str, Any],
) -> None:
    _validate(output, "quality_rules_output.schema.json")
    if output["call_id"] != call["call"]["acid"]:
        raise ValueError("quality output call_id does not match acid")
    if output["rule_set_id"] != rule_snapshot["ruleSetId"]:
        raise ValueError("quality output rule_set_id does not match the frozen snapshot")
    if output["rule_set_version"] != rule_snapshot["ruleSetVersion"]:
        raise ValueError("quality output rule_set_version does not match the frozen snapshot")
    expected = [rule["id"] for rule in rule_snapshot["evaluationRules"]]
    actual = [result["rule_id"] for result in output["results"]]
    if actual != expected:
        raise ValueError("quality results must cover every rule exactly once in snapshot order")
    projection = {result["rule_id"]: result["result"] for result in output["results"]}
    if output["result_by_rule"] != projection:
        raise ValueError("result_by_rule must exactly match results")
    known_indexes = _message_index_set(call)
    for result in output["results"]:
        for evidence in result["evidence"]:
            if not set(evidence["message_indexes"]).issubset(known_indexes):
                raise ValueError("quality evidence references an unknown message")
