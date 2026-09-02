"""OAI-R0 契约测试（SDD 14 §55）：/health、/v1/runs 生命周期、幂等、超时、输出校验。

通过 create_runtime_app 起真实 HTTP 生命周期（ASGI 内进程），用受控桩替换
adapter 的执行核心，验证服务边界行为；不触网、不耗模型额度。
"""

import asyncio
import time

import httpx
import pytest
from quality_runtime_contract import RuntimeUsage
from quality_runtime_service import AdapterExecutionError, create_runtime_app

from app.adapter import OpenAIAgentsRuntimeAdapter

MINIMAL_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "sample_id": {"type": "string"},
        "summary": {"type": "string"},
    },
    "required": ["sample_id", "summary"],
    "additionalProperties": False,
}


def make_payload(run_id="run-1", idem=None, timeout=10, **agent_overrides):
    agent = {
        "id": "quality-agent",
        "version": "0.1.0",
        "instructions": "Use evidence only.",
        "model": {"provider": "openai-compatible", "model": "test-model"},
        "tools": [],
        "master_data": [],
        "output_schema": MINIMAL_SCHEMA,
    }
    agent.update(agent_overrides)
    return {
        "schema_version": "1.0",
        "run_id": run_id,
        "idempotency_key": idem or run_id,
        "agent": agent,
        "input": {"sample_id": "SMOKE-1"},
        "context": {"metadata": {}},
        "timeout_seconds": timeout,
    }


def run_app(scenario):
    async def main():
        adapter = OpenAIAgentsRuntimeAdapter()
        app = create_runtime_app(adapter)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://runtime.test") as client:
            await scenario(adapter, client)

    asyncio.run(main())


async def wait_terminal(client, run_id, timeout=8.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = (await client.get(f"/v1/runs/{run_id}")).json()
        if state["status"] in {"succeeded", "failed", "cancelled"}:
            return state
        await asyncio.sleep(0.02)
    raise AssertionError("run did not reach terminal state in time")


def stub_core(adapter, output=None, delay=0.0, trace=None):
    async def core(request):
        if delay:
            await asyncio.sleep(delay)
        return (output if output is not None else {"sample_id": "S1", "summary": "ok"},
                trace or [], RuntimeUsage())

    adapter._execute_generic = core


def test_health_reports_runtime_metadata_and_capabilities(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_API_KEY", "test-key")

    async def scenario(adapter, client):
        async def probe(url):
            return "ok"

        adapter._probe = probe
        response = await client.get("/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["runtime"] == {
            "provider": "openai-agents",
            "runtime_version": "0.22.0",
            "adapter_version": "0.1.0",
        }
        assert body["capabilities"] == {
            "tools": True,
            "skills": False,
            "structured_output": True,
            "trace": True,
            "session": False,
            "cancel": True,
            "streaming": False,
            "sandbox": False,
        }
        assert body["checks"]["adapter"] == "ok"
        assert body["checks"]["model_credential"] == "ok"
        assert body["checks"]["tool_gateway"] == "ok"

    run_app(scenario)


def test_health_degrades_without_model_credential(monkeypatch):
    monkeypatch.delenv("QUALITY_MODEL_API_KEY", raising=False)

    async def scenario(adapter, client):
        async def probe(url):
            return "ok"

        adapter._probe = probe
        response = await client.get("/health")
        assert response.status_code == 503
        body = response.json()
        assert body["status"] == "degraded"
        assert body["checks"]["model_credential"] == "degraded"

    run_app(scenario)


def test_submit_and_terminal_success(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_API_KEY", "test-key")

    async def scenario(adapter, client):
        stub_core(adapter)
        accepted = await client.post("/v1/runs", json=make_payload())
        assert accepted.status_code == 202
        assert accepted.json()["status"] == "queued"
        state = await wait_terminal(client, "run-1")
        assert state["status"] == "succeeded"
        assert state["output"] == {"sample_id": "S1", "summary": "ok"}
        assert state["runtime"]["provider"] == "openai-agents"
        assert state["started_at"] and state["finished_at"]

    run_app(scenario)


def test_idempotency_same_body_reuses_run(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_API_KEY", "test-key")

    async def scenario(adapter, client):
        stub_core(adapter)
        first = await client.post("/v1/runs", json=make_payload(idem="key-1"))
        second = await client.post("/v1/runs", json=make_payload(idem="key-1"))
        assert first.status_code == 202
        assert second.status_code == 202
        assert first.json()["run_id"] == second.json()["run_id"] == "run-1"

    run_app(scenario)


def test_idempotency_conflict_on_different_body(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_API_KEY", "test-key")

    async def scenario(adapter, client):
        stub_core(adapter)
        await client.post("/v1/runs", json=make_payload(idem="key-1"))
        conflict = await client.post(
            "/v1/runs", json=make_payload(run_id="run-2", idem="key-1", timeout=9)
        )
        assert conflict.status_code == 409
        assert conflict.json()["detail"]["code"] == "idempotency_conflict"

    run_app(scenario)


def test_run_id_conflict_rejected(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_API_KEY", "test-key")

    async def scenario(adapter, client):
        stub_core(adapter)
        await client.post("/v1/runs", json=make_payload(idem="key-1"))
        conflict = await client.post("/v1/runs", json=make_payload(idem="key-2"))
        assert conflict.status_code == 409
        assert conflict.json()["detail"]["code"] == "run_id_conflict"

    run_app(scenario)


def test_unknown_run_id_returns_404(monkeypatch):
    async def scenario(adapter, client):
        response = await client.get("/v1/runs/missing")
        assert response.status_code == 404

    run_app(scenario)


def test_timeout_maps_to_timeout_error(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_API_KEY", "test-key")

    async def scenario(adapter, client):
        stub_core(adapter, delay=5.0)
        await client.post("/v1/runs", json=make_payload(timeout=1))
        state = await wait_terminal(client, "run-1")
        assert state["status"] == "failed"
        assert state["error"]["code"] == "timeout"
        assert state["error"]["retryable"] is True

    run_app(scenario)


def test_invalid_final_output_maps_to_schema_error(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_API_KEY", "test-key")

    async def scenario(adapter, client):
        stub_core(adapter, output={"summary": "missing required sample_id"})
        await client.post("/v1/runs", json=make_payload())
        state = await wait_terminal(client, "run-1")
        assert state["status"] == "failed"
        assert state["error"]["code"] == "output_schema_error"

    run_app(scenario)


def test_adapter_error_crosses_boundary(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_API_KEY", "test-key")

    async def scenario(adapter, client):
        from quality_runtime_contract import ErrorCode, RuntimeError

        async def core(request):
            raise AdapterExecutionError(
                RuntimeError(code=ErrorCode.MODEL_ERROR, message="stub model failure")
            )

        adapter._execute_generic = core
        await client.post("/v1/runs", json=make_payload())
        state = await wait_terminal(client, "run-1")
        assert state["status"] == "failed"
        assert state["error"]["code"] == "model_error"
        assert state["error"]["message"] == "stub model failure"

    run_app(scenario)


def test_cancel_running_run(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_API_KEY", "test-key")

    async def scenario(adapter, client):
        stub_core(adapter, delay=10.0)
        await client.post("/v1/runs", json=make_payload())
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            state = (await client.get("/v1/runs/run-1")).json()
            if state["status"] == "running":
                break
            await asyncio.sleep(0.02)
        cancelled = await client.post("/v1/runs/run-1/cancel")
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"
        state = await wait_terminal(client, "run-1")
        assert state["status"] == "cancelled"
        assert state["error"]["code"] == "cancelled"

    run_app(scenario)
