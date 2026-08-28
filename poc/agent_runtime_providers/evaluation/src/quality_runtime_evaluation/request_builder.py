"""Materialize the single Agent Spec into the shared Runtime contract."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator, FormatChecker

from quality_runtime_contract import (
    AgentExecutionSpec,
    ExecutionContext,
    MasterDataRef,
    ModelSpec,
    RuntimeExecuteRequest,
    ToolRef,
)

POC_ROOT = Path(__file__).resolve().parents[3]
AGENT_SPEC_PATH = POC_ROOT / "agent_specs" / "quality_agent_v0.1.yaml"
SMOKE_ROOT = POC_ROOT / "datasets" / "smoke"
MASTER_DATA_ROOT = POC_ROOT / "master_data"
SCHEMA_ROOT = POC_ROOT / "schemas"
NATIVE_WORKFLOW_ROOT = POC_ROOT / "datasets" / "native_workflow"


def _json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _agent_spec() -> dict[str, Any]:
    value = yaml.safe_load(AGENT_SPEC_PATH.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Agent Spec root must be an object")
    return value


def list_sample_ids() -> list[str]:
    return [row["sample_id"] for row in _jsonl(SMOKE_ROOT / "call_records_v0.1.jsonl")]


def _load_sample(sample_id: str) -> dict[str, Any]:
    matches = [row for row in _jsonl(SMOKE_ROOT / "call_records_v0.1.jsonl") if row["sample_id"] == sample_id]
    if not matches:
        raise KeyError(f"unknown sample_id: {sample_id}")
    if len(matches) > 1:
        raise ValueError(f"duplicate sample_id: {sample_id}")
    sample = matches[0]
    input_schema = _json(SCHEMA_ROOT / "call_record_input.schema.json")
    Draft202012Validator(input_schema, format_checker=FormatChecker()).validate(sample)
    return sample


def _master_data(spec: dict[str, Any]) -> list[dict[str, Any]]:
    materialized = []
    for ref in spec["master_data"]:
        path = MASTER_DATA_ROOT / f"{ref['name']}_v{ref['version']}.json"
        if not path.is_file():
            raise FileNotFoundError(f"missing Master Data: {path}")
        materialized.append(
            {
                "name": ref["name"],
                "version": str(ref["version"]),
                "value": _json(path),
            }
        )
    return materialized


def _instructions(spec: dict[str, Any]) -> str:
    criteria = json.dumps(spec["criteria"], ensure_ascii=False, separators=(",", ":"))
    return f"{spec['instructions'].rstrip()}\n\nCriteria configuration:\n{criteria}"


def build_request(
    sample_id: str,
    *,
    model: str,
    model_provider: str = "deepseek-compatible",
    model_parameters: dict[str, Any] | None = None,
    timeout_seconds: int = 120,
) -> RuntimeExecuteRequest:
    """Build one request body that can be posted unchanged to either provider."""

    spec = _agent_spec()
    manifest = _json(SMOKE_ROOT / "manifest_v0.1.json")
    output_schema = _json(SCHEMA_ROOT / "quality_output.schema.json")
    sample = _load_sample(sample_id)
    run_id = f"poc-{sample_id}"
    return RuntimeExecuteRequest(
        run_id=run_id,
        idempotency_key=f"{manifest['dataset_id']}:{sample_id}",
        agent=AgentExecutionSpec(
            id=spec["id"],
            version=str(spec["version"]),
            instructions=_instructions(spec),
            model=ModelSpec(
                provider=model_provider,
                model=model,
                parameters=model_parameters or {"max_tokens": 4096},
            ),
            tools=[ToolRef(name=item["name"], version=str(item["version"])) for item in spec["tools"]],
            master_data=[
                MasterDataRef(name=item["name"], version=str(item["version"]))
                for item in spec["master_data"]
            ],
            output_schema=output_schema,
        ),
        input=sample,
        context=ExecutionContext(
            task_instance_id=sample_id,
            trace_id=f"poc-{sample_id}",
            metadata={
                "dataset_id": manifest["dataset_id"],
                "dataset_kind": manifest["kind"],
                "master_data": _master_data(spec),
            },
        ),
        timeout_seconds=timeout_seconds,
    )


def request_fingerprint(request: RuntimeExecuteRequest) -> str:
    body = json.dumps(request.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()


def build_native_workflow_request(
    *,
    model: str,
    model_provider: str = "deepseek-compatible",
    model_parameters: dict[str, Any] | None = None,
    timeout_seconds: int = 600,
    run_suffix: str | None = None,
) -> RuntimeExecuteRequest:
    """Build the shared complex request for provider-native orchestration."""

    sample = _json(NATIVE_WORKFLOW_ROOT / "complex_call_v0.2.json")
    input_schema = _json(SCHEMA_ROOT / "call_record_input.schema.json")
    Draft202012Validator(input_schema, format_checker=FormatChecker()).validate(sample)
    output_schema = _json(SCHEMA_ROOT / "native_workflow_output.schema.json")
    tool_names = [
        "knowledge_search",
        "ticket_query",
        "sms_query",
        "appointment_query",
    ]
    suffix = f"-{run_suffix}" if run_suffix else ""
    run_id = f"poc-native-v02-001{suffix}"
    return RuntimeExecuteRequest(
        run_id=run_id,
        idempotency_key=f"quality-runtime-native-workflow-v0.2:NATIVE-V02-001{suffix}",
        agent=AgentExecutionSpec(
            id="quality-native-workflow",
            version="0.2.0",
            instructions=(
                "仅根据通话与企业工具事实执行质检。逐项保留多个消费者诉求、知识陈述和"
                "坐席承诺；证据不足时不得猜测。阶段顺序与工具权限由 Runtime 代码控制。"
            ),
            model=ModelSpec(
                provider=model_provider,
                model=model,
                parameters=model_parameters or {"max_tokens": 8192},
            ),
            tools=[ToolRef(name=name, version="1.0.0") for name in tool_names],
            output_schema=output_schema,
        ),
        input=sample,
        context=ExecutionContext(
            task_instance_id="NATIVE-V02-001",
            trace_id=run_id,
            metadata={
                "dataset_id": "quality-runtime-native-workflow-v0.2",
                "dataset_kind": "fully_synthetic",
                "workflow_mode": "native_quality_v0.2",
            },
        ),
        timeout_seconds=timeout_seconds,
    )
