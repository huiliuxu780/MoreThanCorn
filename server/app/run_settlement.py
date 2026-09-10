"""中立的业务结算服务（P0-07 返工：从 runtime_providers.worker 迁出）。

Module Run 成功后的领域结果事务与 Runtime Provider 无关——它只消费
Run.output/Run.runtime_snapshot 与平台模型（QualityResult/Evidence/CallRecord/
Delivery），因此属于平台业务结算层，不得继续寄居在已退役的旧 Runtime worker 内。
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .models import Run
from .runner import emit


def _now() -> datetime:
    return datetime.now(timezone.utc)


def settle_module_result(db: Session, run: Run, state) -> None:
    """R3-4 结果事务（仅 Module Run）：Schema 二次校验 → CallRecord（脱敏元数据）→
    QualityResult/Evidence → 冻结 ResultRuleVersion 派生评分（Agent 不算分）。

    exactly-once：同一 Run 已有 is_latest 结果时跳过（重复轮询/批次重汇不产生第二条）。"""
    from jsonschema import Draft202012Validator

    from .agent_modules import registry as module_registry
    from .models import (Agent, AgentVersion, CallRecord, Evidence, QualityResult)

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
    if mod.key != "quality-analysis":
        from .delivery import settle_run_success
        settle_run_success(db, run)  # SDD 13 §7.1：与 Run.output 同事务创建 Delivery
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
            db.add(Evidence(result_id=qr.id, kind="field",
                            locator={"criterionId": criterion.get("id"),
                                     "status": criterion.get("status")},
                            text=str(criterion.get("reason") or "")[:500]))
        # 评分由平台冻结规则派生（SDD §9.1：不由 Agent 计算质检分数）
        from .routers.business import apply_rules_to_result
        apply_rules_to_result(db, qr, run.rule_version_id)
    from .delivery import settle_run_success
    settle_run_success(db, run)  # SDD 13 §7.1：与 Run.output 同事务创建 Delivery
    db.commit()
