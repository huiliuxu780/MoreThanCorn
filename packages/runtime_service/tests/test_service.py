import asyncio
import time
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from quality_runtime_contract import (
    AgentExecutionSpec,
    ModelSpec,
    ProviderCapabilities,
    RunStatus,
    RuntimeExecuteRequest,
    RuntimeInfo,
    RuntimeRun,
)
from quality_runtime_service import create_runtime_app


class FakeAdapter:
    runtime = RuntimeInfo(provider="fake", runtime_version="1.0.0", adapter_version="0.1.0")
    capabilities = ProviderCapabilities(
        tools=True,
        skills=False,
        structured_output=True,
        trace=True,
        session=False,
        cancel=True,
        streaming=False,
        sandbox=False,
    )

    def __init__(self, delay: float = 0):
        self.delay = delay
        self.cancelled: list[str] = []

    async def execute(self, request: RuntimeExecuteRequest) -> RuntimeRun:
        if self.delay:
            await asyncio.sleep(self.delay)
        now = datetime.now(timezone.utc)
        return RuntimeRun(
            run_id=request.run_id,
            status=RunStatus.SUCCEEDED,
            output={"findings": []},
            runtime=self.runtime,
            started_at=now,
            finished_at=now,
        )

    async def cancel(self, run_id: str) -> None:
        self.cancelled.append(run_id)

    async def health_checks(self) -> dict[str, str]:
        return {"adapter": "ok", "runtime": "ok"}


class CancellationSuppressingAdapter(FakeAdapter):
    async def execute(self, request: RuntimeExecuteRequest) -> RuntimeRun:
        try:
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            now = datetime.now(timezone.utc)
            return RuntimeRun(
                run_id=request.run_id,
                status=RunStatus.FAILED,
                runtime=self.runtime,
                started_at=now,
                finished_at=now,
                error={
                    "code": "output_schema_error",
                    "message": "adapter produced an interruption reply after cancellation",
                },
            )
        raise AssertionError("sleep should be cancelled by the service deadline")


class UnhealthyAdapter(FakeAdapter):
    async def health_checks(self) -> dict[str, str]:
        return {"adapter": "ok", "runtime": "failed"}


class DegradedAdapter(FakeAdapter):
    async def health_checks(self) -> dict[str, str]:
        return {"adapter": "ok", "model_credential": "degraded"}


def request(
    run_id: str = "run-001",
    key: str = "sample-001:fake:v1",
    timeout_seconds: int = 120,
) -> dict:
    return RuntimeExecuteRequest(
        run_id=run_id,
        idempotency_key=key,
        agent=AgentExecutionSpec(
            id="quality-agent",
            version="0.1.0",
            instructions="Use evidence only.",
            model=ModelSpec(provider="test", model="test-model"),
            output_schema={"type": "object"},
        ),
        input={"call_id": "CALL001"},
        timeout_seconds=timeout_seconds,
    ).model_dump(mode="json")


def wait_terminal(client: TestClient, run_id: str) -> dict:
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        body = client.get(f"/v1/runs/{run_id}").json()
        if body["status"] in {"succeeded", "failed", "cancelled"}:
            return body
        time.sleep(0.01)
    raise AssertionError(f"run {run_id} did not finish")


def test_submit_and_get_terminal_result():
    with TestClient(create_runtime_app(FakeAdapter())) as client:
        accepted = client.post("/v1/runs", json=request())
        assert accepted.status_code == 202
        assert accepted.json()["run_id"] == "run-001"

        result = wait_terminal(client, "run-001")
        assert result["status"] == "succeeded"
        assert result["output"] == {"findings": []}


def test_idempotent_repeat_and_conflict():
    with TestClient(create_runtime_app(FakeAdapter())) as client:
        assert client.post("/v1/runs", json=request()).status_code == 202
        assert client.post("/v1/runs", json=request()).status_code == 202

        changed = request()
        changed["input"] = {"call_id": "DIFFERENT"}
        conflict = client.post("/v1/runs", json=changed)
        assert conflict.status_code == 409
        assert conflict.json()["detail"]["code"] == "idempotency_conflict"


def test_cancel_is_cooperative_and_terminal():
    adapter = FakeAdapter(delay=1)
    with TestClient(create_runtime_app(adapter)) as client:
        assert client.post("/v1/runs", json=request()).status_code == 202
        result = client.post("/v1/runs/run-001/cancel")
        assert result.status_code == 200
        assert result.json()["status"] == "cancelled"
        assert adapter.cancelled == ["run-001"]


def test_health_exposes_provider_capabilities():
    with TestClient(create_runtime_app(FakeAdapter())) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["runtime"]["provider"] == "fake"
        assert response.json()["capabilities"]["structured_output"] is True


def test_health_distinguishes_degraded_from_unavailable():
    with TestClient(create_runtime_app(DegradedAdapter())) as client:
        degraded = client.get("/health")
        assert degraded.status_code == 503
        assert degraded.json()["status"] == "degraded"

    with TestClient(create_runtime_app(UnhealthyAdapter())) as client:
        unavailable = client.get("/health")
        assert unavailable.status_code == 503
        assert unavailable.json()["status"] == "unavailable"


def test_timeout_cleans_up_provider_before_failing():
    adapter = FakeAdapter(delay=5)
    with TestClient(create_runtime_app(adapter)) as client:
        assert client.post("/v1/runs", json=request(timeout_seconds=1)).status_code == 202
        result = wait_terminal(client, "run-001")
        assert result["status"] == "failed"
        assert result["error"]["code"] == "timeout"
        assert adapter.cancelled == ["run-001"]


def test_timeout_wins_when_adapter_suppresses_task_cancellation():
    adapter = CancellationSuppressingAdapter()
    with TestClient(create_runtime_app(adapter)) as client:
        assert client.post("/v1/runs", json=request(timeout_seconds=1)).status_code == 202
        result = wait_terminal(client, "run-001")
        assert result["status"] == "failed"
        assert result["error"]["code"] == "timeout"
        assert adapter.cancelled == ["run-001"]
