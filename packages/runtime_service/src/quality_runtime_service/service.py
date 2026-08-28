"""Reusable development HTTP lifecycle for Runtime Provider adapters.

The in-memory implementation is intentionally limited to local development,
contract tests, and provider conformance. Production recovery is owned by the
platform gateway/queue and must not depend on this process surviving.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timezone
from typing import Protocol

from fastapi import FastAPI, HTTPException, Response, status

from quality_runtime_contract import (
    ErrorCode,
    HealthStatus,
    ProviderCapabilities,
    RunAccepted,
    RunStatus,
    RuntimeError,
    RuntimeExecuteRequest,
    RuntimeInfo,
    RuntimeRun,
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AdapterExecutionError(Exception):
    """Expected provider failure that can cross the runtime boundary."""

    def __init__(self, error: RuntimeError):
        super().__init__(error.message)
        self.error = error


class RuntimeAdapter(Protocol):
    runtime: RuntimeInfo
    capabilities: ProviderCapabilities

    async def execute(self, request: RuntimeExecuteRequest) -> RuntimeRun: ...

    async def cancel(self, run_id: str) -> None: ...

    async def health_checks(self) -> dict[str, str]: ...


class InMemoryRunService:
    """POC state store.

    This intentionally stays process-local. Production persistence and queue
    recovery belong to the Quality Platform and are deferred until the
    provider comparison proves the contract.
    """

    def __init__(self, adapter: RuntimeAdapter):
        self.adapter = adapter
        self.runs: dict[str, RuntimeRun] = {}
        self.idempotency: dict[str, tuple[str, str]] = {}
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.lock = asyncio.Lock()

    @staticmethod
    def fingerprint(request: RuntimeExecuteRequest) -> str:
        body = json.dumps(request.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(body.encode()).hexdigest()

    async def submit(self, request: RuntimeExecuteRequest) -> RunAccepted:
        fingerprint = self.fingerprint(request)
        async with self.lock:
            existing_key = self.idempotency.get(request.idempotency_key)
            if existing_key:
                known_fingerprint, known_run_id = existing_key
                if known_fingerprint != fingerprint:
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        detail={"code": "idempotency_conflict", "run_id": known_run_id},
                    )
                known = self.runs[known_run_id]
                return RunAccepted(run_id=known.run_id, status=known.status, runtime=known.runtime)

            if request.run_id in self.runs:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    detail={"code": "run_id_conflict", "run_id": request.run_id},
                )

            self.runs[request.run_id] = RuntimeRun(
                run_id=request.run_id,
                status=RunStatus.QUEUED,
                runtime=self.adapter.runtime,
            )
            self.idempotency[request.idempotency_key] = (fingerprint, request.run_id)
            self.tasks[request.run_id] = asyncio.create_task(self._execute(request))

        return RunAccepted(
            run_id=request.run_id,
            status=RunStatus.QUEUED,
            runtime=self.adapter.runtime,
        )

    async def _execute(self, request: RuntimeExecuteRequest) -> None:
        started_at = utcnow()
        adapter_task: asyncio.Task[RuntimeRun] | None = None
        self.runs[request.run_id] = RuntimeRun(
            run_id=request.run_id,
            status=RunStatus.RUNNING,
            runtime=self.adapter.runtime,
            started_at=started_at,
        )
        try:
            adapter_task = asyncio.create_task(self.adapter.execute(request))
            done, _ = await asyncio.wait({adapter_task}, timeout=request.timeout_seconds)
            if not done:
                adapter_task.cancel()
                adapter_task.add_done_callback(self._consume_task_result)
                cleanup_details: dict[str, str] = {}
                try:
                    await self.adapter.cancel(request.run_id)
                except Exception as exc:  # noqa: BLE001 - timeout must remain the primary error
                    cleanup_details["cancel_exception_type"] = type(exc).__name__
                self.runs[request.run_id] = self._failed(
                    request.run_id,
                    started_at,
                    RuntimeError(
                        code=ErrorCode.TIMEOUT,
                        message="runtime execution timed out",
                        retryable=True,
                        details=cleanup_details,
                    ),
                )
                return
            result = adapter_task.result()
            if result.run_id != request.run_id:
                raise ValueError("adapter returned a different run_id")
            if not result.status.terminal:
                raise ValueError("adapter returned a non-terminal result")
            if result.runtime != self.adapter.runtime:
                raise ValueError("adapter returned inconsistent runtime metadata")
            self.runs[request.run_id] = result
        except asyncio.CancelledError:
            if adapter_task is not None and not adapter_task.done():
                adapter_task.cancel()
                adapter_task.add_done_callback(self._consume_task_result)
            self.runs[request.run_id] = self._cancelled(request.run_id, started_at)
        except AdapterExecutionError as exc:
            self.runs[request.run_id] = self._failed(request.run_id, started_at, exc.error)
        except Exception as exc:  # noqa: BLE001 - provider boundary must never leak exceptions
            self.runs[request.run_id] = self._failed(
                request.run_id,
                started_at,
                RuntimeError(
                    code=ErrorCode.INTERNAL_ERROR,
                    message="runtime adapter failed unexpectedly",
                    details={"exception_type": type(exc).__name__},
                ),
            )

    @staticmethod
    def _consume_task_result(task: asyncio.Task[RuntimeRun]) -> None:
        """Retrieve ignored adapter outcomes after a deadline or cancellation."""

        try:
            task.exception()
        except asyncio.CancelledError:
            pass

    def _failed(self, run_id: str, started_at: datetime, error: RuntimeError) -> RuntimeRun:
        return RuntimeRun(
            run_id=run_id,
            status=RunStatus.FAILED,
            runtime=self.adapter.runtime,
            started_at=started_at,
            finished_at=utcnow(),
            error=error,
        )

    def _cancelled(self, run_id: str, started_at: datetime | None) -> RuntimeRun:
        return RuntimeRun(
            run_id=run_id,
            status=RunStatus.CANCELLED,
            runtime=self.adapter.runtime,
            started_at=started_at,
            finished_at=utcnow(),
            error=RuntimeError(code=ErrorCode.CANCELLED, message="runtime execution cancelled"),
        )

    def get(self, run_id: str) -> RuntimeRun:
        run = self.runs.get(run_id)
        if run is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="run not found")
        return run

    async def cancel(self, run_id: str) -> RuntimeRun:
        current = self.get(run_id)
        if current.status.terminal:
            return current

        task = self.tasks.get(run_id)
        if task:
            task.cancel()
        try:
            await self.adapter.cancel(run_id)
        finally:
            self.runs[run_id] = self._cancelled(run_id, current.started_at)
        return self.runs[run_id]


def create_runtime_app(adapter: RuntimeAdapter) -> FastAPI:
    service = InMemoryRunService(adapter)
    app = FastAPI(title=f"Quality Runtime Provider: {adapter.runtime.provider}", version="0.1.0")
    app.state.run_service = service

    @app.post("/v1/runs", response_model=RunAccepted, status_code=status.HTTP_202_ACCEPTED)
    async def create_run(request: RuntimeExecuteRequest) -> RunAccepted:
        return await service.submit(request)

    @app.get("/v1/runs/{run_id}", response_model=RuntimeRun)
    async def get_run(run_id: str) -> RuntimeRun:
        return service.get(run_id)

    @app.post("/v1/runs/{run_id}/cancel", response_model=RuntimeRun)
    async def cancel_run(run_id: str) -> RuntimeRun:
        return await service.cancel(run_id)

    @app.get("/health", response_model=HealthStatus)
    async def health(response: Response) -> HealthStatus:
        try:
            checks = await adapter.health_checks()
        except Exception:  # noqa: BLE001 - health endpoint must remain serializable
            checks = {"adapter": "failed"}
        if not checks or any(value == "failed" for value in checks.values()):
            overall = "unavailable"
        elif any(value == "degraded" for value in checks.values()):
            overall = "degraded"
        else:
            overall = "ok"
        if overall != "ok":
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthStatus(
            status=overall,
            runtime=adapter.runtime,
            capabilities=adapter.capabilities,
            checks=checks,
        )

    return app
