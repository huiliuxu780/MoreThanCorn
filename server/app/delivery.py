"""SDD 13 §7：ResultDelivery Outbox 与 Delivery Worker。

一致性语义（§7.3）：平台 Outbox exactly-once creation；外部投递 at-least-once attempt；
目标表效果靠唯一键+upsert 幂等。不得宣称跨库 exactly-once。

- settle_run_success：Run 成功事务内创建唯一 Delivery + JobQueue（同一平台事务）；
- process_result_delivery：JobQueue type=result-delivery 的 worker 入口；
  条件 UPDATE 原子认领（并发只有一个写入）；可重试指数退避；永久错误 dead-letter；
  每次尝试结构化审计；
- retry_delivery / retry_failed_deliveries：重新投递（不调用模型，payload 不改写）。"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .data_writers import WriterError, get_writer
from .models import AuditLog, DataDefinitionVersion, Datasource, JobQueue, ResultDelivery, Run, TaskRun
from .output_binding import (MappingExpressionError, build_ctx, build_record_payload,
                             payload_sha256)

log = logging.getLogger("delivery_worker")

def _nonce() -> str:
    import uuid
    return uuid.uuid4().hex[:8]


BACKOFF_BASE_SECONDS = 5.0
BACKOFF_MAX_SECONDS = 300.0

DELIVERY_TERMINAL = ("succeeded", "failed", "dead_letter")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _audit(db: Session, actor: str, action: str, delivery: ResultDelivery, detail: dict) -> None:
    db.add(AuditLog(actor=actor or "system", action=action, target_type="result_delivery",
                    target_id=delivery.id,
                    detail={"taskRunId": delivery.task_run_id, "runId": delivery.run_id,
                            **detail}))


def _record_validation_issues(record: dict, dv: DataDefinitionVersion | None) -> list[str]:
    """record_payload 对目标 DataDefinitionVersion 的确定性校验（必填列齐备）。"""
    if dv is None:
        return []
    issues = []
    fields = {f.get("key"): f for f in (dv.field_schema or []) if isinstance(f, dict)}
    for key, f in fields.items():
        if f.get("required") and key not in record:
            issues.append(f"目标定义必填列 {key} 无映射值")
    return issues


def settle_run_success(db: Session, run: Run) -> None:
    """§7.1 步骤 4-6：与 Run.output 同一事务创建唯一 Delivery；调用方负责 commit。

    mapping/定义校验错误使 Run 明确失败（可操作错误）；此处不访问目标数据库。"""
    if run.status != "succeeded" or not run.task_run_id:
        return
    tr = db.get(TaskRun, run.task_run_id)
    snap = tr.output_binding_snapshot if tr else None
    if not snap or snap.get("mode") != "target_table":
        return
    if db.execute(select(ResultDelivery.id).where(
            ResultDelivery.run_id == run.id)).first() is not None:
        return  # exactly-once creation（重试/重复轮询安全）
    try:
        record = build_record_payload(snap.get("mapping") or {}, build_ctx(run, snap))
    except MappingExpressionError as exc:
        run.status = "failed"
        run.error = {"code": exc.code, "message": f"OutputBinding mapping 错误：{exc.message}"}
        run.ended_at = run.ended_at or _now()
        return
    dv = db.get(DataDefinitionVersion, snap.get("definitionVersionId") or "")
    problems = _record_validation_issues(record, dv)
    if problems:
        run.status = "failed"
        run.error = {"code": "DELIVERY_RECORD_INVALID",
                     "message": "映射记录未通过目标定义校验：" + "；".join(problems)}
        return
    sha = payload_sha256(record)
    delivery = ResultDelivery(
        run_id=run.id, task_run_id=tr.id, task_id=run.task_id,
        task_version_id=run.task_version_id, interaction_ref=run.interaction_ref or "",
        output_asset_id=snap.get("assetId"),
        output_definition_version_id=snap.get("definitionVersionId"),
        status="pending", write_mode=snap.get("writeMode") or "upsert",
        idempotency_key=f"result-delivery:{run.id}",
        record_payload=record, payload_sha256=sha)
    db.add(delivery)
    db.flush()
    db.add(JobQueue(type="result-delivery", payload={"delivery_id": delivery.id},
                    idempotency_key=f"result-delivery:{run.id}"))
    tr.delivery_status = "pending"
    tr.delivery_pending_count = (tr.delivery_pending_count or 0) + 1
    _audit(db, "system", "delivery.created", delivery, {"sha256": sha})


def reaggregate_delivery(db: Session, tr: TaskRun) -> None:
    """§4.3：delivery_status 单独聚合；not_configured/pending/failed 不得混同。"""
    snap = tr.output_binding_snapshot
    if not snap or snap.get("mode") != "target_table":
        tr.delivery_status = "not_configured"
        tr.delivery_pending_count = 0
        tr.delivery_succeeded_count = 0
        tr.delivery_failed_count = 0
        return
    rows = db.execute(select(ResultDelivery.status).where(
        ResultDelivery.task_run_id == tr.id)).scalars().all()
    pend = sum(1 for s in rows if s in ("pending", "running", "retrying"))
    succ = sum(1 for s in rows if s == "succeeded")
    fail = sum(1 for s in rows if s in ("failed", "dead_letter"))
    tr.delivery_pending_count = pend
    tr.delivery_succeeded_count = succ
    tr.delivery_failed_count = fail
    if fail and succ:
        tr.delivery_status = "partial"
    elif fail:
        tr.delivery_status = "failed"
    elif succ and not pend:
        tr.delivery_status = "succeeded"
    elif any(s == "running" for s in rows):
        tr.delivery_status = "running"
    else:
        tr.delivery_status = "pending"


def _schedule_attempt(db: Session, delivery: ResultDelivery) -> None:
    delay = min(BACKOFF_BASE_SECONDS * (2 ** max(delivery.attempts - 1, 0)), BACKOFF_MAX_SECONDS)
    delivery.next_attempt_at = _now() + timedelta(seconds=delay)
    db.add(JobQueue(type="result-delivery", payload={"delivery_id": delivery.id},
                    run_at=delivery.next_attempt_at,
                    idempotency_key=f"result-delivery:{delivery.run_id}:attempt:{delivery.attempts}"))


def process_result_delivery(payload: dict) -> None:
    """Worker 入口：原子认领 → 写目标表 → 结算/退避/dead-letter。任何失败不抛异常。"""
    from .db import SessionLocal
    db = SessionLocal()
    try:
        did = (payload or {}).get("delivery_id") or ""
        delivery = db.get(ResultDelivery, did)
        if delivery is None or delivery.status in DELIVERY_TERMINAL:
            return
        # 并发认领：条件 UPDATE 只有一个 worker 能拿到 rowcount=1（§14.5 D 组）
        claimed = db.execute(update(ResultDelivery).where(
            ResultDelivery.id == did,
            ResultDelivery.status.in_(("pending", "retrying"))).values(
            status="running", started_at=_now(),
            attempts=ResultDelivery.attempts + 1))
        db.commit()
        if claimed.rowcount == 0:
            return
        db.refresh(delivery)
        tr = db.get(TaskRun, delivery.task_run_id) if delivery.task_run_id else None
        snap = tr.output_binding_snapshot if tr else None
        if not snap:
            delivery.status = "failed"
            delivery.error = {"code": "BINDING_SNAPSHOT_MISSING",
                              "message": "批次缺少冻结 OutputBinding 快照"}
            delivery.ended_at = _now()
            db.flush()
            if tr:
                reaggregate_delivery(db, tr)
            _audit(db, "system", "delivery.failed", delivery,
                   {"code": "BINDING_SNAPSHOT_MISSING"})
            db.commit()
            return
        datasource = db.get(Datasource, snap.get("datasourceId") or "")
        try:
            writer = get_writer(db, datasource)
            ref = writer.write_record(snap, delivery.record_payload or {},
                                      idempotency_key=delivery.idempotency_key)
        except WriterError as exc:
            delivery.attempts = delivery.attempts or 1
            if exc.retryable and delivery.attempts < (delivery.max_attempts or 5):
                delivery.status = "retrying"
                delivery.error = {"code": exc.code, "message": exc.message}
                _schedule_attempt(db, delivery)
                db.flush()
                if tr:
                    reaggregate_delivery(db, tr)
                _audit(db, "system", "delivery.retry_scheduled", delivery,
                       {"code": exc.code, "attempts": delivery.attempts,
                        "nextAttemptAt": delivery.next_attempt_at.isoformat()})
            else:
                delivery.status = ("dead_letter"
                                   if delivery.attempts >= (delivery.max_attempts or 5)
                                   else "failed")
                delivery.error = {"code": exc.code, "message": exc.message}
                delivery.ended_at = _now()
                db.flush()
                if tr:
                    reaggregate_delivery(db, tr)
                _audit(db, "system",
                       "delivery.dead_letter" if delivery.status == "dead_letter"
                       else "delivery.failed",
                       delivery, {"code": exc.code, "attempts": delivery.attempts})
            db.commit()
            return
        delivery.status = "succeeded"
        delivery.error = None
        delivery.ended_at = _now()
        delivery.target_reference = {"assetId": ref.asset_id, "schema": ref.schema_name,
                                     "table": ref.table, "key": ref.key}
        db.flush()
        if tr:
            reaggregate_delivery(db, tr)
        _audit(db, "system", "delivery.succeeded", delivery,
               {"attempts": delivery.attempts, "target": delivery.target_reference})
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.exception("delivery worker error: %s", exc)
        delivery = db.get(ResultDelivery, (payload or {}).get("delivery_id") or "")
        if delivery and delivery.status not in DELIVERY_TERMINAL:
            delivery.status = "retrying"
            delivery.error = {"code": "DELIVERY_WORKER_ERROR", "message": str(exc)[:500]}
            _schedule_attempt(db, delivery)
            db.commit()
    finally:
        db.close()


def retry_delivery(db: Session, delivery_id: str, actor: str) -> dict:
    """§7.4/§8.6 重新投递：不调用模型；payload hash 必须与初次一致。"""
    delivery = db.get(ResultDelivery, delivery_id)
    if not delivery:
        raise LookupError("delivery not found")
    if delivery.status not in ("failed", "dead_letter"):
        return {"accepted": 0, "skipped": 1,
                "reason": f"状态 {delivery.status} 不允许重试投递（仅 failed/dead_letter）"}
    if payload_sha256(delivery.record_payload or {}) != delivery.payload_sha256:
        raise ValueError("DELIVERY_PAYLOAD_DRIFT：record_payload 与冻结哈希不一致，禁止重试")
    delivery.status = "pending"
    delivery.error = None
    delivery.next_attempt_at = None
    delivery.ended_at = None
    db.add(JobQueue(type="result-delivery", payload={"delivery_id": delivery.id},
                    idempotency_key=f"result-delivery:{delivery.run_id}:retry:{delivery.attempts}:{_nonce()}"))
    tr = db.get(TaskRun, delivery.task_run_id) if delivery.task_run_id else None
    _audit(db, actor, "delivery.retry", delivery, {"attempts": delivery.attempts})
    db.flush()
    if tr:
        reaggregate_delivery(db, tr)
    db.commit()
    return {"accepted": 1, "skipped": 0}


def retry_failed_deliveries(db: Session, task_run_id: str, actor: str) -> dict:
    rows = db.execute(select(ResultDelivery).where(
        ResultDelivery.task_run_id == task_run_id,
        ResultDelivery.status.in_(("failed", "dead_letter")))).scalars().all()
    accepted = skipped = 0
    reasons: list[dict] = []
    for d in rows:
        if payload_sha256(d.record_payload or {}) != d.payload_sha256:
            skipped += 1
            reasons.append({"deliveryId": d.id, "reason": "DELIVERY_PAYLOAD_DRIFT"})
            continue
        d.status = "pending"
        d.error = None
        d.next_attempt_at = None
        d.ended_at = None
        db.add(JobQueue(type="result-delivery", payload={"delivery_id": d.id},
                        idempotency_key=f"result-delivery:{d.run_id}:retry:{d.attempts}:{_nonce()}"))
        accepted += 1
        _audit(db, actor, "delivery.retry", d, {"batch": True})
    skipped_other = db.execute(select(ResultDelivery.id).where(
        ResultDelivery.task_run_id == task_run_id,
        ResultDelivery.status.notin_(("failed", "dead_letter")))).scalars().all()
    tr = db.get(TaskRun, task_run_id)
    db.flush()  # 先 flush 再聚合（skipped_other 查询必须在 flush 前）
    if tr:
        reaggregate_delivery(db, tr)
    db.commit()
    return {"accepted": accepted, "skipped": skipped + len(skipped_other), "reasons": reasons}
