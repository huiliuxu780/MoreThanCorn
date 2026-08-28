"""R1（SDD 10）：Runtime Provider Registry / Gateway / worker 生命周期验收。

fake provider = 进程内 uvicorn 服务（127.0.0.1 随机端口）实现 Contract v1 端点，
支持故障注入（503/坏响应/幂等冲突/run_id 不符/拒绝取消），不依赖外部网络与真实模型。
覆盖：queued→running→terminal、幂等、超时→取消、恢复不重发、poll 不占 worker。
"""
import hashlib
import json
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app as platform_app
from app.models import AgentRuntimeProvider, JobQueue, Run, RunEvent, new_id
from app.runner import claim_and_run
from app.runtime_providers import registry as rt_registry
from app.runtime_providers import worker as rt_worker
from app.runtime_providers.client import RuntimeGatewayClient
from app.runtime_providers.errors import RuntimeProviderError
from quality_runtime_contract import (
    HealthStatus,
    ProviderCapabilities,
    RunAccepted,
    RuntimeExecuteRequest,
    RuntimeInfo,
    RuntimeError as ContractRuntimeError,
    RuntimeRun,
    RuntimeUsage,
    TraceEvent,
)

client = TestClient(platform_app)

RUNTIME_INFO = RuntimeInfo(provider="fake", runtime_version="9.9.test", adapter_version="test")
CAPABILITIES = ProviderCapabilities(tools=True, skills=True, structured_output=True, trace=True,
                                    session=True, cancel=True, streaming=False, sandbox=False)


class FakeProvider:
    """Contract v1 fake：测试直接操纵 runs[run_id]["status"] 驱动生命周期。"""

    def __init__(self):
        self.runs: dict[str, dict] = {}
        self.idempotency: dict[str, tuple[str, str]] = {}  # key -> (run_id, body_hash)
        self.submit_count = 0
        self.fail_status: int | None = None        # 注入下一次提交失败
        self.corrupt_next = False                  # 注入坏响应（严格校验）
        self.mismatch_next = False                 # 注入 run_id 不一致
        self.stay_running_on_cancel = False        # 拒绝取消（返回非终态）
        self.auto_succeed = False                  # 提交即置 succeeded（批次同步链路用）
        self.output_builder = None                 # (run_id, entry) -> output（默认 answer）

    def app(self) -> FastAPI:
        fake = self
        app = FastAPI()

        @app.post("/v1/runs", status_code=202)
        def submit(payload: dict):
            fake.submit_count += 1
            if fake.fail_status:
                status = fake.fail_status
                fake.fail_status = None
                return JSONResponse(status_code=status, content={
                    "error": {"code": "agent_spec_invalid" if status == 400 else "internal_error",
                              "message": "injected failure"}})
            if fake.mismatch_next:
                fake.mismatch_next = False
                return RunAccepted(schema_version="1.0", run_id="other-run",
                                   status="queued", runtime=RUNTIME_INFO).model_dump(mode="json")
            key = payload["idempotency_key"]
            body_hash = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
            if key in fake.idempotency:
                prev_id, prev_hash = fake.idempotency[key]
                if prev_hash != body_hash:
                    # 裸 409（无 contract 错误体）：平台按状态映射 idempotency_conflict
                    return JSONResponse(status_code=409, content={"detail": "conflict"})
                entry = fake.runs[prev_id]
                return RunAccepted(schema_version="1.0", run_id=prev_id,
                                   status=entry["status"], runtime=RUNTIME_INFO).model_dump(mode="json")
            run_id = payload["run_id"]
            fake.idempotency[key] = (run_id, body_hash)
            fake.runs[run_id] = {"status": "succeeded" if fake.auto_succeed else "queued",
                                 "request": payload, "cancel_requested": False}
            return RunAccepted(schema_version="1.0", run_id=run_id,
                               status="queued", runtime=RUNTIME_INFO).model_dump(mode="json")

        @app.get("/v1/runs/{run_id}")
        def get_run(run_id: str):
            if fake.corrupt_next:
                fake.corrupt_next = False
                return {"unexpected": "shape"}
            entry = fake.runs.get(run_id)
            if entry is None:
                return JSONResponse(status_code=404, content={
                    "error": {"code": "internal_error", "message": "no such run"}})
            status = entry["status"]
            now = datetime.now(timezone.utc)
            kwargs: dict = {}
            if status == "succeeded":
                output = (self.output_builder(run_id, entry) if self.output_builder
                          else {"answer": "fake-ok"})
                kwargs = {"output": output, "finished_at": now}
            elif status == "failed":
                kwargs = {"error": ContractRuntimeError(code="tool_error", message="injected"),
                          "finished_at": now}
            elif status == "cancelled":
                kwargs = {"finished_at": now}
            return RuntimeRun(
                schema_version="1.0", run_id=run_id, status=status,
                usage=RuntimeUsage(input_tokens=10, output_tokens=5, total_tokens=15,
                                   model_calls=1, tool_calls=2),
                trace=[TraceEvent(sequence=0, timestamp=now, type="stage_start", name="identify"),
                       TraceEvent(sequence=1, timestamp=now, type="stage_end", name="identify")],
                runtime=RUNTIME_INFO,
                started_at=now - timedelta(seconds=2) if status != "queued" else None,
                **kwargs).model_dump(mode="json")

        @app.post("/v1/runs/{run_id}/cancel")
        def cancel(run_id: str):
            entry = fake.runs.get(run_id)
            if entry is None:
                return JSONResponse(status_code=404, content={
                    "error": {"code": "internal_error", "message": "no such run"}})
            entry["cancel_requested"] = True
            if fake.stay_running_on_cancel:
                return RuntimeRun(schema_version="1.0", run_id=run_id, status="running",
                                  runtime=RUNTIME_INFO,
                                  started_at=datetime.now(timezone.utc)).model_dump(mode="json")
            entry["status"] = "cancelled"
            return RuntimeRun(schema_version="1.0", run_id=run_id, status="cancelled",
                              runtime=RUNTIME_INFO,
                              started_at=datetime.now(timezone.utc),
                              finished_at=datetime.now(timezone.utc)).model_dump(mode="json")

        @app.get("/health")
        def health():
            return HealthStatus(status="ok", runtime=RUNTIME_INFO, capabilities=CAPABILITIES,
                                checks={"adapter": "ok"}).model_dump(mode="json")

        return app


class QualityFake(FakeProvider):
    """提交即 succeeded 且输出符合 quality_output Schema（R3 结果事务 happy path）。"""

    def __init__(self):
        super().__init__()
        self.auto_succeed = True
        self.output_builder = lambda run_id, entry: {
            "sample_id": str((entry.get("request", {}).get("input") or {}).get("sample_id") or run_id),
            "findings": [{"criterion": "promise_fulfillment", "status": "passed",
                          "confidence": 0.9, "reason": "工单已创建",
                          "evidence": [{"source": "tool", "reference": "ticket:T-1:event:3",
                                        "summary": "工单 T-1 已创建"}]}],
            "labels": {"service_type_code": "consult", "issue_codes": ["promise_fulfilled"]},
            "summary": "承诺已履约，无违规"}


@pytest.fixture(scope="module")
def fake_server():
    """进程内 uvicorn：127.0.0.1 随机端口，模块级共享（测试只操纵内存状态）。"""
    fake = FakeProvider()
    server = uvicorn.Server(uvicorn.Config(fake.app(), host="127.0.0.1", port=0,
                                           log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    assert server.started, "fake runtime server failed to start"
    port = server.servers[0].sockets[0].getsockname()[1]
    yield fake, f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=5)


def patch_gateway(monkeypatch, base_url: str) -> None:
    """worker 与 registry 的 build_gateway 全部指向 fake server（进程内回环）。"""
    def builder(provider, transport=None):
        return RuntimeGatewayClient(base_url, check_egress=False)
    monkeypatch.setattr(rt_worker, "build_gateway", builder)
    monkeypatch.setattr(rt_registry, "build_gateway", builder)


# ---------- 种子构件 ----------

def make_provider(status: str = "enabled", base_url: str = "http://fake-runtime") -> dict:
    payload = {"id": f"rp-test-{uuid.uuid4().hex[:8]}", "name": "R1 测试 Provider",
               "kind": "external", "baseUrl": base_url}
    r = client.post("/api/runtime-providers", json=payload)
    assert r.status_code == 201, r.text
    if status != "draft":
        r2 = client.put(f"/api/runtime-providers/{payload['id']}", json={"status": status})
        assert r2.status_code == 200, r2.text
    return r.json()


def make_run(**run_kwargs) -> str:
    db = SessionLocal()
    try:
        run = Run(id=new_id(), trigger="api", status="queued",
                  input={"userQuery": "hi"}, **run_kwargs)
        db.add(run)
        db.commit()
        return run.id
    finally:
        db.close()


def get_run_row(run_id: str) -> Run:
    db = SessionLocal()
    try:
        db.expire_all()
        return db.get(Run, run_id)
    finally:
        db.close()


def pending_poll_jobs(run_id: str) -> list:
    db = SessionLocal()
    try:
        return (db.query(JobQueue)
                .filter(JobQueue.type == "agent-runtime-poll",
                        JobQueue.status.in_(("pending", "processing")),
                        JobQueue.payload["run_id"].astext == run_id).all())
    finally:
        db.close()


def events_of(run_id: str, type_: str) -> list:
    db = SessionLocal()
    try:
        return (db.query(RunEvent).filter_by(run_id=run_id, type=type_)
                .order_by(RunEvent.sequence).all())
    finally:
        db.close()


# ---------- Provider API（R1-2） ----------

def test_provider_api_crud_validation_and_audit():
    r = client.post("/api/runtime-providers", json={
        "id": f"rp-crud-{uuid.uuid4().hex[:6]}", "name": "CRUD", "kind": "agentscope",
        "baseUrl": "http://127.0.0.1:8301"})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    assert r.json()["status"] == "draft"
    # 校验：kind/baseUrl/重复 id/config 混入密钥/connectionId 不存在
    assert client.post("/api/runtime-providers", json={
        "name": "x", "kind": "nope", "baseUrl": "http://x"}).status_code == 422
    assert client.post("/api/runtime-providers", json={
        "name": "x", "kind": "external", "baseUrl": "ftp://x"}).status_code == 422
    assert client.post("/api/runtime-providers", json={
        "id": pid, "name": "x", "kind": "external", "baseUrl": "http://x"}).status_code == 409
    assert client.post("/api/runtime-providers", json={
        "name": "x", "kind": "external", "baseUrl": "http://x",
        "config": {"apiKey": "sk-xxx"}}).status_code == 422
    assert client.post("/api/runtime-providers", json={
        "name": "x", "kind": "external", "baseUrl": "http://x",
        "connectionId": "nope"}).status_code == 422
    # 读 + 改 + 审计
    assert client.get("/api/runtime-providers").status_code == 200
    assert client.get(f"/api/runtime-providers/{pid}").json()["config"] == {}
    assert client.put(f"/api/runtime-providers/{pid}",
                      json={"status": "enabled"}).json()["status"] == "enabled"
    assert client.put(f"/api/runtime-providers/{pid}",
                      json={"status": "bogus"}).status_code == 422
    d = client.post(f"/api/runtime-providers/{pid}/disable")
    assert d.status_code == 200 and d.json()["status"] == "disabled"
    audits = client.get("/api/audit", params={"limit": 50}).json()["items"]
    actions = {a["action"] for a in audits if a["targetId"] == pid}
    assert {"runtime_provider.create", "runtime_provider.update",
            "runtime_provider.disable"} <= actions
    # 404 面
    assert client.get("/api/runtime-providers/nope").status_code == 404
    assert client.post("/api/runtime-providers/nope/probe").status_code == 404
    assert client.post("/api/runtime-providers/nope/disable").status_code == 404
    assert client.put("/api/runtime-providers/nope", json={}).status_code == 404


def test_probe_reports_real_health(monkeypatch, fake_server):
    _, base_url = fake_server
    row = make_provider(base_url=base_url)
    patch_gateway(monkeypatch, base_url)
    r = client.post(f"/api/runtime-providers/{row['id']}/probe")
    assert r.status_code == 200 and r.json()["ok"] is True
    assert r.json()["health"]["status"] == "ok"
    detail = client.get(f"/api/runtime-providers/{row['id']}").json()
    assert detail["healthStatus"] == "ok" and detail["capabilities"]["tools"] is True
    assert detail["lastHealthAt"]

    # 不可达 → error（probe 是观测动作，返回报告而不抛异常）
    def broken(provider, transport=None):
        def handler(request):
            raise httpx.ConnectError("boom", request=request)
        return RuntimeGatewayClient(provider.base_url,
                                    transport=httpx.MockTransport(handler), check_egress=False)
    monkeypatch.setattr(rt_registry, "build_gateway", broken)
    r2 = client.post(f"/api/runtime-providers/{row['id']}/probe")
    assert r2.json()["ok"] is False and r2.json()["code"] == "RUNTIME_PROVIDER_UNAVAILABLE"
    assert client.get(f"/api/runtime-providers/{row['id']}").json()["healthStatus"] == "error"


# ---------- Gateway Client（R1-3） ----------

def _sample_request(run_id: str, key_suffix: str = "a") -> RuntimeExecuteRequest:
    from quality_runtime_contract import AgentExecutionSpec, ExecutionContext, ModelSpec
    return RuntimeExecuteRequest(
        run_id=run_id, idempotency_key=f"runtime:{run_id}:1:{key_suffix}",
        agent=AgentExecutionSpec(id="agent-x", version="1", instructions="do",
                                 model=ModelSpec(provider="platform", model="m"),
                                 output_schema={}),
        input={"q": 1}, context=ExecutionContext(trace_id=run_id))


def test_gateway_lifecycle_fingerprint_and_idempotency(fake_server):
    fake, base_url = fake_server
    gw = RuntimeGatewayClient(base_url, check_egress=False)
    req = _sample_request("run-gw-1")
    assert RuntimeGatewayClient.request_fingerprint(req) == \
        RuntimeGatewayClient.request_fingerprint(_sample_request("run-gw-1"))
    base = fake.submit_count
    accepted = gw.submit(req)
    assert accepted.run_id == "run-gw-1" and accepted.status == "queued"
    assert fake.submit_count == base + 1
    # 同幂等键同体重发 → Provider 依键去重：请求到达但不新建 run（SDD 7.4）
    gw.submit(_sample_request("run-gw-1"))
    assert fake.submit_count == base + 2
    assert list(fake.runs.keys()) == ["run-gw-1"]
    # 同键异体 → 409 映射 RUNTIME_IDEMPOTENCY_CONFLICT（不可重试）
    conflict_req = req.model_copy(update={"input": {"q": 999}})
    try:
        gw.submit(conflict_req)
        raise AssertionError("should conflict")
    except RuntimeProviderError as e:
        assert e.code == "RUNTIME_IDEMPOTENCY_CONFLICT" and not e.retryable
    # 轮询生命周期 queued → succeeded
    run = gw.get_run("run-gw-1")
    assert run.status == "queued" and run.output is None
    fake.runs["run-gw-1"]["status"] = "succeeded"
    run = gw.get_run("run-gw-1")
    assert run.status == "succeeded" and run.output == {"answer": "fake-ok"}
    assert run.usage.total_tokens == 15 and len(run.trace) == 2
    assert run.finished_at is not None


def test_gateway_maps_provider_errors_and_validates_responses(fake_server):
    fake, base_url = fake_server
    gw = RuntimeGatewayClient(base_url, check_egress=False)
    # 注入 503 一次 → 有界重试后成功（同幂等键安全重试）
    fake.fail_status = 503
    accepted = gw.submit(_sample_request("run-err-1"))
    assert accepted.run_id == "run-err-1"
    # 注入 400 + contract 错误体 agent_spec_invalid → 平台码 AGENT_SPEC_INVALID
    fake.fail_status = 400
    try:
        gw.submit(_sample_request("run-err-2"))
        raise AssertionError("should fail")
    except RuntimeProviderError as e:
        assert e.code == "AGENT_SPEC_INVALID" and not e.retryable
    # 坏响应（schema 不合）→ RUNTIME_PROVIDER_UNAVAILABLE 可重试
    fake.corrupt_next = True
    try:
        gw.get_run("run-err-1")
        raise AssertionError("should fail")
    except RuntimeProviderError as e:
        assert e.code == "RUNTIME_PROVIDER_UNAVAILABLE" and e.retryable
    # run_id 不一致 → 平台不得接受（SDD §5.7：Provider 不得另立 Run）
    fake.mismatch_next = True
    try:
        gw.submit(_sample_request("run-err-3"))
        raise AssertionError("should fail")
    except RuntimeProviderError as e:
        assert e.code == "RUNTIME_INTERNAL_ERROR" and not e.retryable


# ---------- Worker 生命周期（R1-4） ----------

def test_worker_submit_poll_reaches_terminal(monkeypatch, fake_server):
    fake, base_url = fake_server
    row = make_provider(base_url=base_url)
    patch_gateway(monkeypatch, base_url)
    run_id = make_run()

    rt_worker.submit_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    run = get_run_row(run_id)
    assert run.runtime_provider_id == row["id"]
    assert run.runtime_provider_run_id == run_id  # 平台 run.id 即 Provider run_id（SDD §5.7）
    assert len(run.runtime_request_hash) == 64
    snap = run.runtime_snapshot
    assert snap["provider"] == row["id"] and snap["contractVersion"] == "1.0"
    assert snap["deadlineAt"] and snap["pollTick"] == 0
    assert events_of(run_id, "runtime_submitted")
    polls = pending_poll_jobs(run_id)
    assert len(polls) == 1 and polls[0].run_at > datetime.now(timezone.utc)

    # queued → running：状态映射 + usage + trace 事件（按 providerSequence 去重）
    fake.runs[run_id]["status"] = "running"
    rt_worker.poll_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    run = get_run_row(run_id)
    assert run.status == "running" and run.started_at is not None
    assert run.token_usage["total"] == 15 and run.token_usage["modelCalls"] == 1
    traces = events_of(run_id, "runtime_trace")
    assert [e.payload["providerSequence"] for e in traces] == [0, 1]
    assert get_run_row(run_id).runtime_snapshot["lastTraceSequence"] == 1

    # running → succeeded：终态收尾 + 结果落 Run.output
    fake.runs[run_id]["status"] = "succeeded"
    rt_worker.poll_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    run = get_run_row(run_id)
    assert run.status == "succeeded" and run.output == {"answer": "fake-ok"}
    assert run.error is None and run.ended_at is not None and run.duration_ms is not None
    finished = events_of(run_id, "runtime_finished")
    assert finished and finished[-1].payload["status"] == "succeeded"

    # 终态后的重复 poll：幂等无副作用，不产生重复事件
    before = len(events_of(run_id, "runtime_trace"))
    rt_worker.poll_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    assert len(events_of(run_id, "runtime_trace")) == before
    assert get_run_row(run_id).status == "succeeded"


def test_worker_recovery_does_not_resubmit(monkeypatch, fake_server):
    fake, base_url = fake_server
    row = make_provider(base_url=base_url)
    patch_gateway(monkeypatch, base_url)
    db = SessionLocal()
    try:
        run = Run(id=new_id(), trigger="api", status="queued", input={},
                  runtime_provider_id=row["id"], runtime_provider_run_id="ext-123")
        db.add(run)
        db.commit()
        run_id = run.id
    finally:
        db.close()
    # 恢复路径：已受理的 Run 再次投递 submit → 只恢复轮询，不重新 submit（SDD §16.1）
    base = fake.submit_count
    rt_worker.submit_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    assert fake.submit_count == base
    assert get_run_row(run_id).runtime_provider_run_id == "ext-123"
    assert len(pending_poll_jobs(run_id)) == 1


def test_worker_cancel_adopts_provider_terminal_state(monkeypatch, fake_server):
    fake, base_url = fake_server
    row = make_provider(base_url=base_url)
    patch_gateway(monkeypatch, base_url)
    run_id = make_run()
    rt_worker.submit_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    fake.runs[run_id]["status"] = "running"
    rt_worker.poll_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    assert get_run_row(run_id).status == "running"

    rt_worker.cancel_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    run = get_run_row(run_id)
    assert run.status == "cancelled" and run.ended_at is not None
    assert fake.runs[run_id]["cancel_requested"] is True
    assert events_of(run_id, "runtime_finished")[-1].payload["status"] == "cancelled"


def test_worker_cancel_pending_run_without_submit(fake_server):
    row = make_provider()
    run_id = make_run()
    rt_worker.cancel_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    assert get_run_row(run_id).status == "cancelled"


def test_worker_timeout_deadline_forces_cancel(monkeypatch, fake_server):
    fake, base_url = fake_server
    row = make_provider(base_url=base_url)
    patch_gateway(monkeypatch, base_url)
    run_id = make_run()
    rt_worker.submit_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    # Provider 停在 running 且 deadline 已过 → poll 转入取消路径
    fake.runs[run_id]["status"] = "running"
    db = SessionLocal()
    try:
        run = db.get(Run, run_id)
        snap = dict(run.runtime_snapshot)
        snap["deadlineAt"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        run.runtime_snapshot = snap
        db.commit()
    finally:
        db.close()
    rt_worker.poll_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    db = SessionLocal()
    try:
        cancels = (db.query(JobQueue)
                   .filter(JobQueue.type == "agent-runtime-cancel",
                           JobQueue.payload["run_id"].astext == run_id).all())
    finally:
        db.close()
    assert len(cancels) == 1
    # cancel job 执行 → Provider 返回 cancelled 终态 → 平台收尾 cancelled
    rt_worker.cancel_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    assert get_run_row(run_id).status == "cancelled"


def test_worker_timeout_beyond_grace_fails_run(monkeypatch, fake_server):
    fake, base_url = fake_server
    fake.stay_running_on_cancel = True  # Provider 拒绝取消、永不给终态
    row = make_provider(base_url=base_url)
    patch_gateway(monkeypatch, base_url)
    run_id = make_run()
    rt_worker.submit_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    fake.runs[run_id]["status"] = "running"
    db = SessionLocal()
    try:
        run = db.get(Run, run_id)
        snap = dict(run.runtime_snapshot)
        snap["deadlineAt"] = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
        snap["cancelRequestedAt"] = (datetime.now(timezone.utc) - timedelta(seconds=120)).isoformat()
        run.runtime_snapshot = snap
        db.commit()
    finally:
        db.close()
    rt_worker.poll_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    run = get_run_row(run_id)
    assert run.status == "failed" and run.error["code"] == "RUNTIME_TIMEOUT"


def test_poll_reschedules_with_backoff_without_sleep(monkeypatch, fake_server):
    fake, base_url = fake_server
    row = make_provider(base_url=base_url)
    patch_gateway(monkeypatch, base_url)
    run_id = make_run()
    rt_worker.submit_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    fake.runs[run_id]["status"] = "running"
    t0 = time.monotonic()
    rt_worker.poll_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    elapsed = time.monotonic() - t0
    assert elapsed < 1.5, "poll tick 必须立即释放 worker（禁止 sleep 等待）"
    jobs = pending_poll_jobs(run_id)
    assert len(jobs) == 1
    delay = (jobs[0].run_at - datetime.now(timezone.utc)).total_seconds()
    assert 0 < delay <= rt_worker.POLL_MAX_SECONDS + 1
    # 重复 poll：在途 poll 任务存在时不重复堆积
    rt_worker.poll_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    assert len(pending_poll_jobs(run_id)) == 1


def test_jobqueue_dispatch_wiring_end_to_end(monkeypatch, fake_server):
    """claim_and_run 认领 agent-runtime-submit → worker 真实执行（分派表接线）。"""
    _, base_url = fake_server
    row = make_provider(base_url=base_url)
    patch_gateway(monkeypatch, base_url)
    run_id = make_run()
    db = SessionLocal()
    try:
        db.add(JobQueue(type="agent-runtime-submit",
                        payload={"run_id": run_id, "provider_id": row["id"]}))
        db.commit()
    finally:
        db.close()
    deadline = time.time() + 15
    while time.time() < deadline:
        if get_run_row(run_id).runtime_provider_run_id:
            break
        claim_and_run(SessionLocal())
        time.sleep(0.2)
    assert get_run_row(run_id).runtime_provider_run_id == run_id


def test_worker_rejects_disabled_provider(monkeypatch, fake_server):
    fake, base_url = fake_server
    row = make_provider(status="disabled")
    patch_gateway(monkeypatch, base_url)
    run_id = make_run()
    base = fake.submit_count
    rt_worker.submit_agent_runtime({"run_id": run_id, "provider_id": row["id"]})
    run = get_run_row(run_id)
    assert run.status == "failed"
    assert run.error["code"] == "RUNTIME_PROVIDER_UNAVAILABLE"
    assert fake.submit_count == base
