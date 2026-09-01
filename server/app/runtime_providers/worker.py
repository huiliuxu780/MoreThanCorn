"""异步 worker 任务（SDD 10 R1-4 / §8.2 / §16）。

JobQueue 类型：
- agent-runtime-submit：提交 Run 到 Provider。幂等：Run 已带 runtime_provider_run_id 时
  只恢复轮询，**不得重新 submit**（worker 重启恢复语义，§16.1）；
- agent-runtime-poll：单次轮询 tick。未终态时把下次检查写入 JobQueue.run_at（有界退避）
  并立即释放 worker，绝不在 worker 内 sleep 等待；超过 deadline 转入 cancel；
- agent-runtime-cancel：请求 Provider 取消，并按 Provider 实际终态收尾（副作用真实即认账）。

轮询默认值（SDD §21-4 首期冻结）：初始 2s、×2 退避、上限 30s；cancel 宽限 60s。
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from quality_runtime_contract import RuntimeRun, RunStatus

from ..db import SessionLocal
from ..models import AgentRuntimeProvider, JobQueue, Run
from ..runner import emit
from .client import RuntimeGatewayClient
from .dispatcher import build_runtime_request
from .errors import RuntimeProviderError, map_contract_error
from .registry import build_gateway
from .trace_mapper import append_provider_events

POLL_INITIAL_SECONDS = 2.0
POLL_FACTOR = 2.0
POLL_MAX_SECONDS = 30.0
CANCEL_GRACE_SECONDS = 60.0

TERMINAL_RUN_STATUS = {"succeeded", "failed", "cancelled"}

log = logging.getLogger("runtime_worker")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _terminal(run: Run) -> bool:
    return run.status in TERMINAL_RUN_STATUS


def _past_deadline(run: Run) -> bool:
    deadline = (run.runtime_snapshot or {}).get("deadlineAt")
    if not deadline:
        return False
    try:
        return _now() > datetime.fromisoformat(str(deadline))
    except ValueError:
        return False


def _usage_map(state: RuntimeRun) -> dict:
    u = state.usage
    return {"prompt": u.input_tokens, "completion": u.output_tokens, "total": u.total_tokens,
            "modelCalls": u.model_calls, "toolCalls": u.tool_calls}


def _gateway_for(db: Session, run: Run, payload: dict):
    provider = db.get(AgentRuntimeProvider,
                      (payload or {}).get("provider_id") or run.runtime_provider_id or "")
    if provider is None:
        raise RuntimeProviderError("RUNTIME_PROVIDER_UNAVAILABLE",
                                   f"runtime provider {(payload or {}).get('provider_id')} not found")
    return provider, build_gateway(provider)


def _finalize_failure(db: Session, run: Run, code: str, message: str) -> None:
    run.status = "failed"
    run.error = {"code": code, "message": message}
    run.ended_at = _now()
    if run.started_at:
        run.duration_ms = int((run.ended_at - run.started_at).total_seconds() * 1000)
    emit(db, run.id, "runtime_finished", payload={"status": "failed", "code": code})
    db.commit()


def _finalize_from_contract(db: Session, run: Run, state: RuntimeRun) -> None:
    if state.status == RunStatus.SUCCEEDED:
        run.status = "succeeded"
        run.output = state.output
        run.error = None
    elif state.status == RunStatus.FAILED:
        mapped = map_contract_error(state.error) if state.error else None
        run.status = "failed"
        run.error = {"code": mapped.code if mapped else "RUNTIME_INTERNAL_ERROR",
                     "message": mapped.message if mapped else "provider failed"}
    else:
        run.status = "cancelled"
    run.ended_at = state.finished_at or _now()
    if run.started_at and run.ended_at:
        run.duration_ms = int((run.ended_at - run.started_at).total_seconds() * 1000)
    snapshot = run.runtime_snapshot or {}
    emit(db, run.id, "runtime_finished",
         payload={"status": run.status, "provider": snapshot.get("provider"),
                  "runtimeVersion": snapshot.get("runtimeVersion")})
    db.commit()


def _apply_state(db: Session, run: Run, state: RuntimeRun) -> None:
    snapshot = dict(run.runtime_snapshot or {})
    snapshot.update({"runtimeVersion": state.runtime.runtime_version,
                     "adapterVersion": state.runtime.adapter_version,
                     "providerRunStatus": str(state.status)})
    append_provider_events(db, run, state.trace, snapshot)
    if state.usage.total_tokens or state.usage.model_calls:
        run.token_usage = _usage_map(state)
    if state.status == RunStatus.RUNNING and run.status == "queued":
        run.status = "running"
        run.started_at = state.started_at or run.started_at or _now()
    run.runtime_snapshot = snapshot


def _schedule_poll(db: Session, run: Run, tick: int | None = None) -> None:
    """登记下一次检查时间并立即释放 worker；已有在途 poll 任务时不重复堆积。"""
    snapshot = run.runtime_snapshot or {}
    if tick is None:
        tick = int(snapshot.get("pollTick", 0) or 0)
    delay = min(POLL_INITIAL_SECONDS * (POLL_FACTOR ** tick), POLL_MAX_SECONDS)
    existing = (db.query(JobQueue)
                .filter(JobQueue.type == "agent-runtime-poll",
                        JobQueue.status.in_(("pending", "processing")),
                        JobQueue.payload["run_id"].astext == run.id)
                .first())
    if existing:
        return
    db.add(JobQueue(type="agent-runtime-poll",
                    payload={"run_id": run.id, "provider_id": run.runtime_provider_id},
                    run_at=_now() + timedelta(seconds=delay)))


def _bump_tick_and_reschedule(db: Session, run: Run) -> None:
    snapshot = dict(run.runtime_snapshot or {})
    snapshot["pollTick"] = int(snapshot.get("pollTick", 0) or 0) + 1
    run.runtime_snapshot = snapshot
    db.commit()
    _schedule_poll(db, run)
    db.commit()


# ---------- JobQueue 任务入口 ----------

def submit_agent_runtime(payload: dict) -> None:
    """提交 Run 到 Runtime Provider（幂等；恢复时不重新 submit）。"""
    db = SessionLocal()
    try:
        run = db.get(Run, (payload or {}).get("run_id") or "")
        if run is None or run.status != "queued":
            return
        if run.runtime_provider_run_id:
            # worker 重启/重复投递恢复（SDD 16.1）：只恢复查询，绝不重新 submit
            log.info("runtime submit recovery: run %s already accepted as %s",
                     run.id, run.runtime_provider_run_id)
            _schedule_poll(db, run)
            db.commit()
            return
        try:
            provider, gateway = _gateway_for(db, run, payload or {})
        except RuntimeProviderError as exc:
            _finalize_failure(db, run, exc.code, exc.message)
            return
        if provider.status != "enabled":
            _finalize_failure(db, run, "RUNTIME_PROVIDER_UNAVAILABLE",
                              f"provider {provider.id} is {provider.status}（未启用）")
            return
        request = build_runtime_request(db, run)
        fingerprint = RuntimeGatewayClient.request_fingerprint(request)
        try:
            accepted = gateway.submit(request)
        except RuntimeProviderError as exc:
            if exc.retryable:
                raise  # 可重试：交给 JobQueue 既有 attempts/退避/死信机制
            _finalize_failure(db, run, exc.code, exc.message)
            return
        snapshot = dict(run.runtime_snapshot or {})
        snapshot.update({
            "provider": provider.id,
            "providerKind": provider.kind,
            "runtimeVersion": accepted.runtime.runtime_version,
            "adapterVersion": accepted.runtime.adapter_version,
            "contractVersion": provider.contract_version,
            "timeoutSeconds": request.timeout_seconds,
            "deadlineAt": (_now() + timedelta(seconds=request.timeout_seconds)).isoformat(),
            "pollTick": 0,
            "lastTraceSequence": -1,
        })
        run.runtime_provider_id = provider.id
        run.runtime_provider_run_id = accepted.run_id
        run.runtime_request_hash = fingerprint
        run.runtime_snapshot = snapshot
        emit(db, run.id, "runtime_submitted", payload={
            "provider": provider.id, "providerKind": provider.kind,
            "runtime": accepted.runtime.model_dump(),
            "idempotencyKey": request.idempotency_key, "requestHash": fingerprint})
        db.commit()
        _schedule_poll(db, run)
        db.commit()
    finally:
        db.close()


def poll_agent_runtime(payload: dict) -> None:
    """单次轮询 tick：终态收尾；未终态排下次检查并立即返回（不占 worker 等待）。"""
    db = SessionLocal()
    try:
        run = db.get(Run, (payload or {}).get("run_id") or "")
        if run is None or _terminal(run):
            return
        if not run.runtime_provider_run_id:
            # 乱序/恢复中间态：尚无 Provider run 可查，回到 submit 幂等恢复路径
            _schedule_poll(db, run)
            db.commit()
            return
        try:
            provider, gateway = _gateway_for(db, run, payload or {})
        except RuntimeProviderError as exc:
            _finalize_failure(db, run, exc.code, exc.message)
            return
        try:
            state = gateway.get_run(run.runtime_provider_run_id)
        except RuntimeProviderError as exc:
            if exc.retryable and not _past_deadline(run):
                _bump_tick_and_reschedule(db, run)
                return
            if exc.retryable:  # 超过 deadline 仍连不上 → 走取消收尾
                _request_cancel(db, run)
                return
            _finalize_failure(db, run, exc.code, exc.message)
            return
        _apply_state(db, run, state)
        if state.status.terminal:
            db.commit()
            _finalize_from_contract(db, run, state)
            _settle_module_result(db, run, state)
            return
        db.commit()
        if _past_deadline(run):
            _handle_deadline(db, run)
            return
        _bump_tick_and_reschedule(db, run)
    finally:
        db.close()


def cancel_agent_runtime(payload: dict) -> None:
    """请求 Provider 取消；按 Provider 实际状态收尾（不抢跑声明平台终态）。"""
    db = SessionLocal()
    try:
        run = db.get(Run, (payload or {}).get("run_id") or "")
        if run is None or _terminal(run):
            return
        if not run.runtime_provider_run_id:
            # 尚未提交：直接取消排队 Run
            run.status = "cancelled"
            run.ended_at = _now()
            emit(db, run.id, "runtime_finished", payload={"status": "cancelled"})
            db.commit()
            return
        try:
            provider, gateway = _gateway_for(db, run, payload or {})
        except RuntimeProviderError as exc:
            _finalize_failure(db, run, exc.code, exc.message)
            return
        snapshot = dict(run.runtime_snapshot or {})
        snapshot["cancelRequestedAt"] = snapshot.get("cancelRequestedAt") or _now().isoformat()
        run.runtime_snapshot = snapshot
        db.commit()
        try:
            state = gateway.cancel(run.runtime_provider_run_id)
        except RuntimeProviderError as exc:
            if exc.retryable:
                raise  # 交给 JobQueue 重试
            # Provider 拒绝取消（如已完成）：以 Provider 状态为准，回到轮询收尾
            _schedule_poll(db, run, tick=0)
            db.commit()
            return
        _apply_state(db, run, state)
        if state.status.terminal:
            db.commit()
            _finalize_from_contract(db, run, state)
            return
        db.commit()
        _schedule_poll(db, run, tick=0)
        db.commit()
    finally:
        db.close()


def _request_cancel(db: Session, run: Run) -> None:
    snapshot = dict(run.runtime_snapshot or {})
    snapshot["cancelRequestedAt"] = snapshot.get("cancelRequestedAt") or _now().isoformat()
    run.runtime_snapshot = snapshot
    db.add(JobQueue(type="agent-runtime-cancel",
                    payload={"run_id": run.id, "provider_id": run.runtime_provider_id}))
    db.commit()


def _handle_deadline(db: Session, run: Run) -> None:
    """deadline 后的收敛：先取消，宽限内继续轮询，超宽限仍无终态则判超时失败。"""
    snapshot = run.runtime_snapshot or {}
    requested = snapshot.get("cancelRequestedAt")
    if not requested:
        _request_cancel(db, run)
        return
    try:
        age = (_now() - datetime.fromisoformat(str(requested))).total_seconds()
    except ValueError:
        age = CANCEL_GRACE_SECONDS + 1
    if age < CANCEL_GRACE_SECONDS:
        _bump_tick_and_reschedule(db, run)
        return
    _finalize_failure(db, run, "RUNTIME_TIMEOUT",
                      "provider did not reach terminal state before deadline")


# ---------- 同步执行（R3：批次内联 / Workflow agent-exec 嵌套） ----------

def execute_module_run_sync(db: Session, run: Run, provider) -> None:
    """同步执行一条 Module Run 到终态（与 workflow execute_run 的批次内联语义一致）。

    提交 → 有界轮询（批次 worker 阻塞与既有 workflow 批次相同）→ 终态收尾 →
    Module 结果事务（输出 Schema 平台二次校验 + CallRecord + QualityResult/Evidence +
    冻结规则派生，exactly-once）。任何失败都以 Run 终态表达，不抛异常。"""
    import time as _time

    from jsonschema import Draft202012Validator

    from .dispatcher import build_runtime_request
    from .registry import build_gateway

    request = build_runtime_request(db, run)
    snapshot = dict(run.runtime_snapshot or {})
    snapshot.update({"provider": provider.id, "providerKind": provider.kind,
                     "contractVersion": provider.contract_version,
                     "timeoutSeconds": request.timeout_seconds,
                     "lastTraceSequence": -1, "lastCallRecordSequence": -1})
    run.runtime_provider_id = provider.id
    run.runtime_request_hash = RuntimeGatewayClient.request_fingerprint(request)
    run.runtime_snapshot = snapshot
    run.started_at = run.started_at or _now()
    emit(db, run.id, "runtime_submitted", payload={"provider": provider.id,
                                                   "sync": True})
    db.commit()
    try:
        gateway = build_gateway(provider)
        accepted = gateway.submit(request)
    except RuntimeProviderError as exc:
        _finalize_failure(db, run, exc.code, exc.message)
        return
    if accepted.run_id != run.id:
        _finalize_failure(db, run, "RUNTIME_INTERNAL_ERROR",
                          f"provider run_id mismatch: {accepted.run_id}")
        return
    run.runtime_provider_run_id = accepted.run_id
    snapshot = dict(run.runtime_snapshot or {})
    snapshot.update({"runtimeVersion": accepted.runtime.runtime_version,
                     "adapterVersion": accepted.runtime.adapter_version})
    run.runtime_snapshot = snapshot
    db.commit()

    deadline = _time.monotonic() + request.timeout_seconds
    state = None
    while True:
        try:
            state = gateway.get_run(accepted.run_id)
        except RuntimeProviderError as exc:
            _finalize_failure(db, run, exc.code, exc.message)
            return
        _apply_state(db, run, state)
        if state.status.terminal:
            break
        if _time.monotonic() > deadline:
            try:
                state = gateway.cancel(accepted.run_id)
            except RuntimeProviderError:
                pass
            if state is not None and state.status.terminal:
                break
            _finalize_failure(db, run, "RUNTIME_TIMEOUT",
                              "provider did not reach terminal state before deadline")
            return
        db.commit()
        _time.sleep(0.3)
    db.commit()
    _finalize_from_contract(db, run, state)
    _settle_module_result(db, run, state)


def _settle_module_result(db: Session, run: Run, state) -> None:
    """R3-4 结果事务（仅 Module Run）：Schema 二次校验 → CallRecord（脱敏元数据）→
    QualityResult/Evidence → 冻结 ResultRuleVersion 派生评分（Agent 不算分）。

    exactly-once：同一 Run 已有 is_latest 结果时跳过（重复轮询/批次重汇不产生第二条）。"""
    from jsonschema import Draft202012Validator

    from ..agent_modules import registry as module_registry
    from ..models import (Agent, AgentVersion, CallRecord, Evidence, QualityResult)

    if run.status != "succeeded":
        return
    agent = db.get(Agent, run.agent_id) if run.agent_id else None
    version = db.get(AgentVersion, run.agent_version_id) if run.agent_version_id else None
    if agent is None or not agent.module_key or version is None:
        return  # 非模块 Run：无领域结果事务
    mod = module_registry.get(agent.module_key, agent.module_version)
    # 平台二次校验（不信任 Provider 的校验结果，SDD §7.3）
    errors = sorted(Draft202012Validator(mod.output_schema).iter_errors(run.output or {}),
                    key=lambda e: list(e.absolute_path))
    if errors:
        run.status = "failed"
        first = errors[0]
        run.error = {"code": "OUTPUT_SCHEMA_ERROR",
                     "message": f"输出未通过 Module Output Schema 校验：{first.message}"}
        run.ended_at = _now()
        emit(db, run.id, "runtime_finished", payload={"status": "failed",
                                                      "code": "OUTPUT_SCHEMA_ERROR"})
        db.commit()
        return
    from .dispatcher import _runtime_input
    runtime_context = {"input": _runtime_input(run.input or {})}
    if mod.manifest.get("injectRuleSnapshot"):
        from .dispatcher import build_rule_snapshot
        runtime_context["rule_snapshot"] = build_rule_snapshot(db, run.rule_version_id)
    semantic_errors = mod.validate_output_semantics(run.output or {}, runtime_context)
    if semantic_errors:
        run.status = "failed"
        first = semantic_errors[0]
        run.error = {"code": first["code"], "message": first["message"]}
        run.ended_at = _now()
        emit(db, run.id, "runtime_finished", payload={"status": "failed",
                                                      "code": first["code"]})
        db.commit()
        return
    snapshot = dict(run.runtime_snapshot or {})
    # runtime metadata 事实必须留痕（版本全链路可追溯）
    snapshot.update({"moduleKey": mod.key, "moduleVersion": mod.version,
                     "agentVersionId": version.id,
                     "moduleImplementationVersion":
                         (snapshot.get("runtimeBinding") or {}).get("moduleImplementation", {}).get("version")
                         or snapshot.get("moduleImplementationVersion")})
    # Trace → CallRecord（脱敏：仅 kind/target/序列/token 元数据，正文不落普通记录）
    last_seq = int(snapshot.get("lastCallRecordSequence", -1) or -1)
    for event in sorted(state.trace or [], key=lambda e: e.sequence):
        if event.sequence <= last_seq:
            continue
        kind = ("model" if "ModelCall" in event.type
                else "tool" if "ToolCall" in event.type else None)
        if kind and event.type.endswith("EndEvent"):
            tokens = (event.metadata or {}) if kind == "model" else {}
            db.add(CallRecord(run_id=run.id, kind=kind, target_type=kind,
                              target_id=event.name or event.type,
                              request={"providerSequence": event.sequence},
                              status="success",
                              token_usage={"input": tokens.get("input_tokens", 0),
                                           "output": tokens.get("output_tokens", 0)}
                              if tokens else {}))
        snapshot["lastCallRecordSequence"] = event.sequence
    run.runtime_snapshot = snapshot
    db.flush()
    # SDD 10 §5.9：仅 quality-analysis 映射到 QualityResult；其余 Module 的领域结果
    # （ticket/business）走各自 Result Mapper，R5+ 落地，此处不落 QualityResult。
    if not mod.produces_quality_result:
        db.commit()
        return
    # QualityResult 恰好一条（INV-03；重复轮询安全）
    existing = (db.query(QualityResult)
                .filter(QualityResult.run_id == run.id, QualityResult.is_latest.is_(True))
                .first())
    if existing is None:
        projection = mod.map_result(version, state)
        qr = QualityResult(
            run_id=run.id,
            interaction_ref=run.interaction_ref
            or str((run.input or {}).get("interactionId") or (run.input or {}).get("sample_id") or ""),
            agent_version_id=version.id,
            structured_output=run.output or {},
            ai_result={"output": run.output, "provider": snapshot.get("provider"),
                       "runtimeVersion": snapshot.get("runtimeVersion"),
                       "adapterVersion": snapshot.get("adapterVersion"),
                       "module": {"key": mod.key, "version": mod.version}},
            transcript=[],
            task_run_id=run.task_run_id, task_id=run.task_id,
            task_version_id=run.task_version_id,
            output_schema_version_id=(run.input or {}).get("__outputSchemaVersionId"))
        db.add(qr)
        db.flush()
        for criterion in projection.get("criteria", []):
            evidence = criterion.get("evidence") or []
            if not evidence:
                evidence = [{}]
            for item in evidence:
                item = item if isinstance(item, dict) else {}
                source = str(item.get("source") or "field")
                locator = {"criterionId": criterion.get("id"),
                           "status": criterion.get("status")}
                for key in ("message_indexes", "start_ms", "end_ms", "reference"):
                    if item.get(key) is not None:
                        locator[key] = item[key]
                db.add(Evidence(result_id=qr.id,
                                kind="transcript_span" if source == "transcript" else
                                "tool_call" if source in {"knowledge", "appointment", "ticket"}
                                else "field",
                                locator=locator,
                                source_ref=str(item.get("reference") or ""),
                                text=str(item.get("excerpt") or criterion.get("reason") or "")[:500]))
        # 评分由平台冻结规则派生（SDD §9.1：不由 Agent 计算质检分数）
        from ..routers.business import apply_rules_to_result
        apply_rules_to_result(db, qr, run.rule_version_id)
    db.commit()
