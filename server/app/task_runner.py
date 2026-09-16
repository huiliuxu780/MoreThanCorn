"""TaskRunner（09-SDD §6.4 / P0-B2）：TaskRun=批次，Run=单条 Interaction。

职责：
- start_task_run：状态门（INV-10）、版本解析、数据源验证（P0-03）、
  DataSnapshot 形成、幂等（INV-11）、入队（不同步执行批次）。
- execute_task_run：分页读取 → 逐 Interaction 建 Run（冻结全部版本，INV-05）→
  执行已发布 WorkflowVersion → 每成功 Run 恰好一条 QualityResult（INV-03）。
"""
from __future__ import annotations

import hashlib
import threading
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .data_readers import ReaderError, get_reader
from .models import (Agent, AnalysisTask, AnalysisTaskVersion, AgentVersion,
                     DataAsset, DataSnapshot, JobQueue, Release, Run, TaskRun, Workflow,
                     WorkflowVersion, TaskRunErrorAgg,)


class TaskStartError(Exception):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


def _resolve_workflow_version(db: Session, tv: AnalysisTaskVersion) -> WorkflowVersion:
    if tv.workflow_version_policy == "pinned":
        if not tv.pinned_workflow_version_id:
            raise TaskStartError("pinned 策略缺少 pinnedWorkflowVersionId")
        wv = db.get(WorkflowVersion, tv.pinned_workflow_version_id)
        if not wv:
            raise TaskStartError(f"pinned 工作流版本 {tv.pinned_workflow_version_id} 不存在")
        return wv
    wf = db.get(Workflow, tv.workflow_id)
    if not wf or not wf.current_version_id:
        raise TaskStartError("NO_PUBLISHED_VERSION：工作流没有已发布版本，请先发布")
    wv = db.get(WorkflowVersion, wf.current_version_id)
    if not wv:
        raise TaskStartError(f"NO_PUBLISHED_VERSION：版本 {wf.current_version_id} 不存在")
    return wv


def _resolve_window_days(window: dict) -> int | None:
    """相对时间窗 → 天数（首发支持 last_24h/last_7d/last_30d；其余视为全量）。"""
    if (window or {}).get("mode") != "relative":
        return None
    return {"last_24h": 1, "last_7d": 7, "last_30d": 30}.get(window.get("value"))


def _resolve_rule_version(db: Session, tv: AnalysisTaskVersion) -> str:
    """09 P0 修复轮（审计反例 3/6）：批次启动时解析并冻结规则版本。

    - pinned：必须绑定存在的 result_rule_version_id。
    - follow_latest：解析最新已发布规则版本；无则失败关闭（不得静默跳过规则）。
    返回规则版本 ID（Run/Result 的 rule_version_id 来源，恒非空）。"""
    from .models import ResultRuleVersion
    if (tv.rule_policy or "pinned") == "pinned":
        if not tv.result_rule_version_id:
            raise TaskStartError("任务未绑定规则版本且未声明 follow_latest 策略", 422)
        if not db.get(ResultRuleVersion, tv.result_rule_version_id):
            raise TaskStartError(f"规则版本 {tv.result_rule_version_id} 不存在", 422)
        return tv.result_rule_version_id
    # 09 闭环验收修复（P1-3）：follow_latest 限定在任务声明的 RuleSet 内取最新
    # 已发布版本；未声明作用域则失败关闭，禁止全库取最新（防串用他集）。
    if not tv.result_rule_set_id:
        raise TaskStartError("follow_latest 策略必须声明 resultRuleSetId（RuleSet 作用域），"
                             "禁止全库取最新版本", 422)
    rv = db.execute(select(ResultRuleVersion)
                    .where(ResultRuleVersion.rule_set_id == tv.result_rule_set_id)
                    .order_by(ResultRuleVersion.version_no.desc(),
                              ResultRuleVersion.created_at.desc())).scalars().first()
    if not rv:
        raise TaskStartError(f"follow_latest：规则集 {tv.result_rule_set_id} 没有已发布版本"
                             "（失败关闭）", 422)
    return rv.id


def _build_locator(asset: DataAsset, tv: AnalysisTaskVersion) -> dict:
    """源定位（脱敏：不含密钥；凭证经 Connection.secret_ref 间接引用）。"""
    locator: dict = {"source": asset.source or "manual"}
    if asset.datasource_id:
        locator.update({"table": asset.location or "",
                        "idField": asset.record_id_field or "id",
                        "timeField": asset.time_field or ""})
        days = _resolve_window_days(tv.data_window)
        if days:
            locator["window_days"] = days
    return locator


def _resolve_agent_target(db: Session, tv: AnalysisTaskVersion) -> tuple:
    """R3-2：Agent 目标版本解析（pinned|latest_sandbox_release|latest_prod_release）。

    返回 (AgentVersion, Release)；Release 必须带 Runtime Provider 绑定（失败关闭）。"""
    from .models import Agent, AgentVersion, Release
    if tv.agent_version_policy == "pinned":
        if not tv.pinned_agent_version_id:
            raise TaskStartError("pinned 策略缺少 pinnedAgentVersionId")
        av = db.get(AgentVersion, tv.pinned_agent_version_id)
        if not av:
            raise TaskStartError(f"pinned Agent 版本 {tv.pinned_agent_version_id} 不存在")
        release = (db.query(Release)
                   .filter(Release.agent_version_id == av.id, Release.status == "active")
                   .order_by(Release.canary_percent.asc(), Release.created_at.desc())
                   .first())
    else:
        agent = db.get(Agent, tv.agent_id)
        if not agent:
            raise TaskStartError("执行目标 Agent 不存在", 404)
        env = "sandbox" if tv.agent_version_policy != "latest_prod_release" else "prod"
        vid = agent.sandbox_version_id if env == "sandbox" else agent.prod_version_id
        if not vid:
            raise TaskStartError(f"NO_RELEASED_VERSION：Agent 没有已发布到{env}的版本")
        av = db.get(AgentVersion, vid)
        if not av:
            raise TaskStartError("NO_RELEASED_VERSION：发布版本记录丢失")
        release = (db.query(Release)
                   .filter_by(agent_id=tv.agent_id, environment=env, status="active",
                              agent_version_id=vid)
                   .order_by(Release.canary_percent.asc(), Release.created_at.desc())
                   .first())
    if release is None:
        raise TaskStartError("NO_RELEASED_VERSION：Agent 没有符合版本策略的活跃 Release（AgentScope 换底后不再绑定 Provider）")
    return av, release


def start_task_run(db: Session, task_id: str, trigger: str = "manual",
                   idempotency_key: str | None = None,
                   schedule_fire_key: str | None = None,
                   window_override: dict | None = None) -> tuple[TaskRun, dict]:
    """启动批次。返回 (task_run, resolved)；幂等请求返回既有 TaskRun。

    window_override（09 P1-01 回填）：{{"mode":"fixed","start","end"}} 覆盖任务版本
    的 data_window，仅处理该历史窗口内的交互。"""
    t = db.get(AnalysisTask, task_id)
    if not t:
        raise TaskStartError("任务不存在", 404)
    if t.status == "paused":
        raise TaskStartError("任务已暂停，禁止启动新批次（INV-10）", 409)
    if t.status != "active":
        raise TaskStartError(f"任务状态 {t.status} 不可运行（需 active）")
    # 09-16 封存执行面闸门：批次启动拦 archived 绑定 Agent
    if t.execution_target_type == "agent" and t.agent_id:
        from .models import Agent as _Ag
        _ag = db.get(_Ag, t.agent_id)
        if _ag is not None and _ag.archived:
            raise TaskStartError(
                {"code": "AGENT_ARCHIVED",
                 "message": "任务绑定的 Agent 已封存，禁止启动新批次；先解封或改绑"}, 409)
    tv = db.get(AnalysisTaskVersion, t.current_version_id) if t.current_version_id else None
    if not tv:
        raise TaskStartError("任务缺少配置版本")

    # SDD 13 §6.2/§18：生产触发（schedule/backfill/api）强制 target_table（先于目标解析）
    if trigger != "manual" and (tv.output_mode or "platform_only") != "target_table":
        raise TaskStartError("生产触发（schedule/backfill/api）要求 outputBinding.mode="
                             "target_table（SDD 13 §18；sandbox/manual 可 platform_only）", 422)

    # R3：统一执行目标解析（启动时一次冻结，批次内不漂移）
    agent_version = release = None
    if tv.execution_target_type == "agent":
        agent_version, release = _resolve_agent_target(db, tv)
        wv = None
    else:
        wv = _resolve_workflow_version(db, tv)

    # 幂等：同一 fire key / idempotency key 只创建一个 TaskRun（INV-11）
    if schedule_fire_key:
        exist = db.query(TaskRun).filter_by(schedule_fire_key=schedule_fire_key).first()
        if exist:
            return exist, {"reused": True}
    if idempotency_key:
        exist = db.query(TaskRun).filter_by(idempotency_key=idempotency_key).first()
        if exist:
            return exist, {"reused": True}

    # 09 P0-08：追踪字段非空——定义版本必须存在（任务创建已校验，此处再防存量数据）
    if not tv.data_definition_version_id:
        raise TaskStartError("任务未绑定数据定义版本（P0-08 追踪字段非空），无法启动", 422)
    from .models import DataDefinitionVersion
    if not db.get(DataDefinitionVersion, tv.data_definition_version_id):
        raise TaskStartError("数据定义版本不存在", 422)
    # 09 P0：解析并冻结规则版本（失败关闭）
    resolved_rule_version_id = _resolve_rule_version(db, tv)
    # SDD 13 §6.2：启动时 fail-closed 探测目标表（连接/表/结构/权限/唯一键），
    # 失败不创建注定无法投递的生产 TaskRun；已启动批次的运行期故障走 Delivery 重试。
    from .output_binding import freeze_binding_snapshot
    from .output_binding_validator import validate_for_start
    contract = tv.output_contract_snapshot or {}
    binding_snapshot = freeze_binding_snapshot(
        db, tv, contract.get("ref") or "", contract.get("sha256") or "")
    if binding_snapshot:
        ok, issues = validate_for_start(db, binding_snapshot)
        if not ok:
            raise TaskStartError("目标表启动探测失败（fail-closed）：" +
                                 "；".join(i["message"] for i in issues), 502)
    asset = db.get(DataAsset, tv.data_asset_id)
    if not asset:
        raise TaskStartError("数据资产不存在")
    reader = get_reader(db, asset)
    v = reader.validate()
    if not v["ok"]:
        raise TaskStartError(f"数据源不可用：{v['detail']}（生产禁止生成替代数据）", 502)
    locator = _build_locator(asset, tv)
    try:
        expected = reader.count(locator)
    except ReaderError as exc:
        raise TaskStartError(f"数据源读取失败：{exc}", 502)
    if expected == 0:
        raise TaskStartError("数据集为空：按当前窗口/范围无可读数据")

    snap = DataSnapshot(asset_id=asset.id, asset_revision=asset.revision,
                        definition_version_id=tv.data_definition_version_id,
                        locator=locator,
                        resolved_window=window_override or tv.data_window or {},
                        resolved_scope=tv.scope or {},
                        resolved_sampling=tv.sampling or {},
                        expected_count=expected, read_count=0, checksum="")
    db.add(snap)
    db.flush()
    tr = TaskRun(task_id=t.id, task_version_id=tv.id, data_snapshot_id=snap.id,
                 trigger=trigger, schedule_fire_key=schedule_fire_key,
                 idempotency_key=idempotency_key, status="queued", total=expected,
                 output_binding_snapshot=binding_snapshot,
                 delivery_status="pending" if binding_snapshot else "not_configured",
                 resolved_rule_version_id=resolved_rule_version_id,
                 resolved_workflow_version_id=wv.id if wv else None,
                 resolved_agent_version_id=agent_version.id if agent_version else None,
                 resolved_release_id=release.id if release else None,
                 runtime_binding_snapshot=(release.runtime_binding_snapshot
                                           if release else None))
    db.add(tr)
    db.flush()
    db.add(JobQueue(type="task-run", payload={"task_run_id": tr.id},
                    idempotency_key=schedule_fire_key or idempotency_key))
    db.commit()
    resolved = {"taskVersionId": tv.id, "ruleVersionId": resolved_rule_version_id,
                "outputSchemaVersionId": tv.output_schema_version_id,
                "dataSnapshotId": snap.id, "executionTarget": tv.execution_target_type}
    if wv is not None:
        resolved["workflowVersionId"] = wv.id
    if agent_version is not None:
        resolved["agentVersionId"] = agent_version.id
        resolved["releaseId"] = release.id
        resolved["releaseId"] = release.id
    return tr, resolved


def _scope_hit(row: dict, scope: dict) -> bool:
    """结构化过滤：{op: and|or, conditions:[{field,op,value}]}；legacy 表达式视为通过。"""
    from .routers.business import _match
    conds = (scope or {}).get("conditions") or []
    if not conds:
        return True
    results = [_match({"field": c.get("field"), "op": c.get("op"),
                       "value": c.get("value")}, row) for c in conds]
    return all(results) if (scope.get("op") or "and") == "and" else any(results)


def _window_hit(row: dict, time_field: str, start: str | None, end: str | None) -> bool:
    """09 P1-01 回填窗口：行时间字段须落在 [start, end] 内（字符串比较；空窗=不过滤）。"""
    if not start and not end:
        return True
    v = str(row.get(time_field) or row.get("interactionTime") or "")
    if not v:
        return False
    if start and v < str(start):
        return False
    if end and v > str(end) + "T23:59:59":
        return False
    return True


def _eligibility_hit(row: dict, eligibility: list) -> bool:
    """09 P1-04：Eligibility 条件（AND 列表，元素 {field,op,value}）；空=通过。"""
    from .routers.business import _match
    if not eligibility:
        return True
    return all(_match({"field": c.get("field"), "op": c.get("op") or "eq",
                       "value": c.get("value")}, row)
               for c in eligibility if isinstance(c, dict))


def _apply_mapping(row: dict, mapping: dict) -> dict:
    """inputMapping：{工作流输入键: 资产字段名}；未映射时保留同名字段。"""
    if not mapping:
        return dict(row)
    out = {}
    for wf_key, asset_field in mapping.items():
        if asset_field:
            out[wf_key] = row.get(asset_field)
    return out


def _interaction_run(tr: TaskRun, tv: AnalysisTaskVersion, wv, agent_version, release,
                     *, status: str, input_payload: dict, ref: str, attempt: int,
                     error: dict | None = None) -> Run:
    """按执行目标构造 Interaction Run（R3：Agent 目标带冻结版本+Provider 绑定）。"""
    rule_vid = tr.resolved_rule_version_id or tv.result_rule_version_id
    common = dict(trigger=tr.trigger or "batch", status=status, input=input_payload,
                  definition_source="version", task_run_id=tr.id, task_id=tr.task_id,
                  task_version_id=tv.id, interaction_ref=ref, attempt=attempt,
                  definition_version_id=tv.data_definition_version_id,
                  rule_version_id=rule_vid, data_snapshot_id=tr.data_snapshot_id,
                  error=error)
    if agent_version is not None:
        return Run(agent_id=tv.agent_id, agent_version_id=agent_version.id,
                   runtime_snapshot={"runtimeBinding": tr.runtime_binding_snapshot,
                                     "releaseId": tr.resolved_release_id}, **common)
    return Run(workflow_id=tv.workflow_id, workflow_version_id=wv.id, **common)


def _dispatch_interaction_run(db: Session, run: Run, agent_version) -> None:
    """统一分派：Workflow → Runner；Agent → Module 同步执行（含结果事务）。"""
    if agent_version is not None:
        # 审核 P0-3：Agent 执行统一入口（AgentScope 唯一底座），不再经 Runtime Provider
        from . import agent_execution as _ae
        from .models import Agent as _Agent
        agent = db.get(_Agent, run.agent_id)
        _ae.run_into_existing_run(db, run, agent, run.input or {})
        db.expire(run)
    else:
        from .runner import execute_run
        execute_run(run.id)
        db.expire(run)


def _agg_error(db: Session, task_run_id: str, category: str, code: str,
               ref: str | None = None) -> None:
    """F3：批次错误聚合 upsert（summary topErrors 数据源）。"""
    now = datetime.now(timezone.utc)
    row = (db.query(TaskRunErrorAgg)
           .filter_by(task_run_id=task_run_id, category=category, code=code)
           .first())
    if row is None:
        db.add(TaskRunErrorAgg(task_run_id=task_run_id, category=category,
                               code=code, count=1,
                               sample_refs=[ref] if ref else [],
                               first_seen_at=now, last_seen_at=now))
    else:
        row.count += 1
        row.last_seen_at = now
        if ref and ref not in (row.sample_refs or []):
            row.sample_refs = (row.sample_refs or [])[:4] + [ref]
    db.commit()


def execute_task_run(task_run_id: str) -> None:
    """Worker 入口：分页读取 → 每 Interaction 一个 Run → 统计终态。"""
    from .db import SessionLocal
    from .runner import execute_run
    db = SessionLocal()
    try:
        tr = db.get(TaskRun, task_run_id)
        if not tr or tr.status != "queued":
            return
        tv = db.get(AnalysisTaskVersion, tr.task_version_id)
        if not tv:
            tr.status = "failed"
            tr.error_summary = {"errors": [{"error": "TASK_VERSION_MISSING"}]}
            tr.ended_at = datetime.now(timezone.utc)
            db.commit()
            return
        tr.status = "running"
        tr.started_at = datetime.now(timezone.utc)
        db.commit()
        # R3：执行目标与冻结快照（INV：分页/重启/重试不漂移）
        agent_target = tv.execution_target_type == "agent"
        agent_version = release = None
        if agent_target:
            agent_version = (db.get(AgentVersion, tr.resolved_agent_version_id)
                             if tr.resolved_agent_version_id else None)
            release = db.get(Release, tr.resolved_release_id) if tr.resolved_release_id else None
            if not agent_version or not release:
                tr.status = "failed"
                tr.error_summary = {"errors": [{"error": "AGENT_TARGET_UNRESOLVED：批次缺少冻结的 Agent 版本/Provider 绑定"}]}
                tr.ended_at = datetime.now(timezone.utc)
                db.commit()
                return
            target_agent = db.get(Agent, tv.agent_id)
            wv = None
        else:
            target_agent = None
            wv = _resolve_workflow_version(db, tv)
        asset = db.get(DataAsset, tv.data_asset_id)
        snap = db.get(DataSnapshot, tr.data_snapshot_id) if tr.data_snapshot_id else None
        locator = (snap.locator if snap else _build_locator(asset, tv)) or {}
        reader = get_reader(db, asset)

        sampling = tv.sampling or {}
        max_items = int(sampling.get("count") or 0) if sampling.get("mode") == "count" else 0
        # 随机抽样（percent）：按 ref 哈希确定性选择（同快照可复现，INV-12）
        random_percent = (float(sampling.get("percent") or 0)
                          if sampling.get("mode") == "random" else 0.0)
        scope = tv.scope or {}
        id_field = asset.record_id_field or "interactionId"
        # 09 P1-01 回填窗口 + P1-04 Eligibility（快照冻结，运行时消费）
        window = (snap.resolved_window if snap else None) or {}
        win_start, win_end = window.get("start"), window.get("end")
        time_field = asset.time_field or "interactionTime"
        eligibility_conds: list = []
        if tv.data_definition_version_id:
            from .models import DataDefinitionVersion
            ddv = db.get(DataDefinitionVersion, tv.data_definition_version_id)
            if ddv:
                eligibility_conds = ddv.eligibility or []

        ok = fail = skipped = cancelled = read_n = 0
        errors: list[dict] = []
        seen_refs: set[str] = set()
        checksum = hashlib.sha256()
        watermark: str | None = None
        cursor = None
        work: list[dict] = []
        while True:
            try:
                page = reader.read_page(locator, cursor, limit=50)
            except ReaderError as exc:
                tr.status = "failed"
                tr.error_summary = {"errors": errors + [{"error": f"READER_ERROR: {exc}"}]}
                tr.ended_at = datetime.now(timezone.utc)
                if snap:
                    snap.read_count = read_n
                    if watermark:
                        snap.checkpoint = watermark
                db.commit()
                return
            for row in page.rows:
                if not _window_hit(row, time_field, win_start, win_end):
                    continue
                if not _eligibility_hit(row, eligibility_conds):
                    continue
                read_n += 1
                ts = str(row.get(time_field) or row.get("interactionTime") or "")
                if ts and (watermark is None or ts > watermark):
                    watermark = ts
                if max_items and (ok + fail) >= max_items:
                    skipped += 1
                    continue
                if not _scope_hit(row, scope):
                    skipped += 1
                    continue
                ref = str(row.get(id_field) or "").strip()
                rule_vid = tr.resolved_rule_version_id or tv.result_rule_version_id
                if not ref:
                    placeholder = f"__missing_{read_n}__"
                    run = _interaction_run(tr, tv, wv, agent_version, release,
                                           status="failed",
                                           input_payload=_apply_mapping(row, tv.input_mapping or {}),
                                           ref=placeholder, attempt=1,
                                           error={"message": "EMPTY_INTERACTION_REF：缺少 " + id_field})
                    db.add(run)
                    db.commit()
                    fail += 1
                    errors.append({"row": read_n,
                                   "error": "EMPTY_INTERACTION_REF：缺少 " + id_field})
                    _agg_error(db, tr.id, "input", "EMPTY_INTERACTION_REF", placeholder)
                    continue
                if ref in seen_refs:
                    prior_attempt = db.execute(
                        select(func.max(Run.attempt)).where(
                            Run.task_run_id == tr.id, Run.interaction_ref == ref)).scalar() or 1
                    run = _interaction_run(tr, tv, wv, agent_version, release,
                                           status="failed",
                                           input_payload=_apply_mapping(row, tv.input_mapping or {}),
                                           ref=ref, attempt=prior_attempt + 1,
                                           error={"message": "DUPLICATE_INTERACTION_REF：重复输入"})
                    db.add(run)
                    db.commit()
                    fail += 1
                    errors.append({"interactionRef": ref,
                                   "error": "DUPLICATE_INTERACTION_REF：重复输入"})
                    _agg_error(db, tr.id, "input", "DUPLICATE_INTERACTION_REF", ref)
                    continue
                seen_refs.add(ref)
                checksum.update(ref.encode())
                if random_percent > 0:
                    bucket = int(hashlib.sha256(ref.encode()).hexdigest()[:8], 16) % 10000
                    if bucket >= int(random_percent * 100):
                        skipped += 1
                        continue
                input_payload = _apply_mapping(row, tv.input_mapping or {})
                input_payload["__rawRow"] = row
                if tv.output_schema_version_id:
                    input_payload["__outputSchemaVersionId"] = tv.output_schema_version_id
                work.append({"ref": ref, "input": input_payload})
            if not page.next_cursor or (max_items and (ok + fail) >= max_items):
                break
            cursor = page.next_cursor

        # F3（AC-030）：total 尽早落库且 total_state=exact；processed 单调递增
        tr.total = read_n
        tr.total_state = "exact"
        tr.processed_count = 0
        db.commit()

        # F3 崩溃恢复入口（AC-036）：租约回收后重入时，把陈旧 running 项重置重跑
        stale = (db.query(Run).filter(Run.task_run_id == tr.id, Run.status == "running")
                 .filter(Run.started_at < datetime.now(timezone.utc) - timedelta(minutes=10))
                 .all())
        for sr in stale:
            sr.status = "queued"
            sr.attempt = (sr.attempt or 1) + 1
        if stale:
            db.commit()

        # F3：Recovery 批次只执行预置的 queued Run（failed_items 作用域）
        if tr.run_scope == "failed_items":
            allowed = {r.interaction_ref for r in
                       db.query(Run).filter(Run.task_run_id == tr.id,
                                            Run.status == "queued").all()}
            work = [w for w in work if w["ref"] in allowed]

        concurrency = max(1, min(int((tv.sampling or {}).get("concurrency") or 4),
                                 max(len(work), 1)))
        item_timeout = float((tv.sampling or {}).get("item_timeout_seconds") or 600)
        from concurrent.futures import ThreadPoolExecutor
        from concurrent.futures import TimeoutError as FutTimeout
        from concurrent.futures import as_completed

        def _exec_one(item: dict):
            sdb = SessionLocal()
            try:
                fresh = sdb.get(TaskRun, tr.id)
                now = datetime.now(timezone.utc)
                if fresh is not None and fresh.cancel_requested_at is not None:
                    run = _interaction_run(fresh, tv, wv, agent_version, release,
                                           status="cancelled",
                                           input_payload=item["input"],
                                           ref=item["ref"], attempt=1,
                                           error={"message": "CANCELLED_BEFORE_DISPATCH"})
                    sdb.add(run)
                    sdb.commit()
                    return "cancelled", item["ref"]
                if fresh is not None and fresh.deadline_at and now > fresh.deadline_at:
                    run = _interaction_run(fresh, tv, wv, agent_version, release,
                                           status="cancelled",
                                           input_payload=item["input"],
                                           ref=item["ref"], attempt=1,
                                           error={"message": "DEADLINE_PASSED"})
                    sdb.add(run)
                    sdb.commit()
                    return "cancelled", item["ref"]
                run = _interaction_run(fresh, tv, wv, agent_version, release,
                                       status="queued", input_payload=item["input"],
                                       ref=item["ref"], attempt=1)
                sdb.add(run)
                sdb.commit()
                _dispatch_interaction_run(sdb, run, agent_version)
                if item["abandoned"].is_set():
                    # 项级超时后线程迟到：重放失败终态，覆盖迟到提交
                    run.status = "failed"
                    run.error = {"message": "ITEM_TIMEOUT"}
                    run.ended_at = datetime.now(timezone.utc)
                    sdb.commit()
                    return ("fail", item["ref"], "ITEM_TIMEOUT")
                if run.status == "succeeded":
                    return "ok", item["ref"]
                return ("fail", item["ref"],
                        (run.error or {}).get("message", run.status))
            finally:
                sdb.close()

        for it in work:
            it["abandoned"] = threading.Event()
        with ThreadPoolExecutor(max_workers=concurrency) as ex:
            futs = [ex.submit(_exec_one, it) for it in work]
            for fut in as_completed(futs):
                try:
                    res = fut.result(timeout=item_timeout)
                except FutTimeout:
                    work[futs.index(fut)]["abandoned"].set()
                    tdb = SessionLocal()
                    try:
                        tr_f = tdb.get(TaskRun, tr.id)
                        run = _interaction_run(tr_f, tv, wv, agent_version, release,
                                               status="failed", input_payload={},
                                               ref="__timeout__", attempt=1,
                                               error={"message": "ITEM_TIMEOUT"})
                        tdb.add(run)
                        tdb.commit()
                    finally:
                        tdb.close()
                    fail += 1
                    errors.append({"error": "ITEM_TIMEOUT"})
                    _agg_error(db, tr.id, "runtime", "ITEM_TIMEOUT", "__timeout__")
                    db.execute(update(TaskRun).where(TaskRun.id == tr.id).values(
                        processed_count=TaskRun.processed_count + 1))
                    db.commit()
                    continue
                if res[0] == "ok":
                    ok += 1
                elif res[0] == "cancelled":
                    cancelled += 1
                    _agg_error(db, tr.id, "lifecycle", "CANCELLED", res[1])
                else:
                    fail += 1
                    errors.append({"interactionRef": res[1], "error": res[2]})
                    _agg_error(db, tr.id, "execution",
                               str(res[2])[:64], res[1])
                db.execute(update(TaskRun).where(TaskRun.id == tr.id).values(
                    processed_count=TaskRun.processed_count + 1))
                db.commit()

        tr.succeeded_count = ok
        tr.failed_count = fail
        tr.skipped_count = skipped
        tr.cancelled_count = cancelled
        tr.processed_count = read_n
        agg = (db.query(TaskRunErrorAgg).filter_by(task_run_id=tr.id)
               .order_by(TaskRunErrorAgg.count.desc()).limit(10).all())
        tr.error_summary = ({
            "errors": errors[:20],
            "topErrors": [{"category": a.category, "code": a.code, "count": a.count}
                          for a in agg],
        } if errors else None)
        if tr.cancel_requested_at is not None and ok == 0 and fail == 0:
            tr.status = "cancelled"
        elif ok > 0 and fail == 0 and cancelled == 0:
            tr.status = "succeeded"
        elif ok > 0:
            tr.status = "partial"
        elif read_n == 0 or skipped == read_n:
            # F3（AC-038）：空数据集=成功结束+业务终态码，不显示系统失败
            tr.status = "succeeded"
            tr.outcome_code = "NO_ELIGIBLE_ITEMS"
        else:
            tr.status = "failed"
        tr.ended_at = datetime.now(timezone.utc)
        if snap:
            snap.read_count = read_n
            snap.checksum = checksum.hexdigest()
            if watermark:
                snap.checkpoint = watermark
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        tr = db.get(TaskRun, task_run_id)
        if tr and tr.status in ("queued", "running"):
            tr.status = "failed"
            tr.error_summary = {"errors": [{"error": f"TASK_RUNNER_ERROR: {exc}"}]}
            tr.ended_at = datetime.now(timezone.utc)
            db.commit()
    finally:
        db.close()


def reaggregate_task_run(db: Session, tr: TaskRun) -> None:
    """09 P1-06（审计：父批次永久 partial）：按每 Interaction 的最新 attempt 重汇
    TaskRun 的 succeeded/failed 与终态。"""
    runs = db.query(Run).filter(Run.task_run_id == tr.id).all()
    latest_by_ref: dict[str, Run] = {}
    for r in runs:
        cur = latest_by_ref.get(r.interaction_ref)
        if cur is None or (r.attempt or 1) > (cur.attempt or 1):
            latest_by_ref[r.interaction_ref] = r
    ok = fail = 0
    errors: list[dict] = []
    for ref, r in latest_by_ref.items():
        # SDD 13 PR6：重汇只认 Run 终态，不假设 QualityResult（领域结果归领域层）
        if r.status == "succeeded":
            ok += 1
        elif r.status in ("failed", "cancelled"):
            fail += 1
            errors.append({"interactionRef": ref,
                           "error": (r.error or {}).get("message", r.status)})
    tr.succeeded_count = ok
    tr.failed_count = fail
    if ok > 0 and fail == 0:
        tr.status = "succeeded"
    elif ok > 0:
        tr.status = "partial"
    else:
        tr.status = "failed"
    tr.error_summary = {"errors": errors[:20]} if errors else None
    if tr.status in ("succeeded", "partial", "failed"):
        tr.ended_at = datetime.now(timezone.utc)


def retry_failed_in_taskrun(task_run_id: str) -> TaskRun | None:
    """F3（AC-035A）：失败重试 = 新建 Recovery TaskRun，原批次保持终态。

    冻结版本/快照从原批次复制（AC-035）；仅重试「最新 attempt 仍失败」的交互；
    Recovery 批次 run_scope=failed_items、retry_round+1、retry_of_task_run_id 血缘。
    """
    from .db import SessionLocal
    db = SessionLocal()
    try:
        tr = db.get(TaskRun, task_run_id)
        if not tr or tr.status not in ("partial", "failed"):
            return None
        latest: dict[str, Run] = {}
        for r in db.query(Run).filter(Run.task_run_id == task_run_id).all():
            cur = latest.get(r.interaction_ref)
            if cur is None or (r.attempt or 1) > (cur.attempt or 1):
                latest[r.interaction_ref] = r
        to_retry = [r for r in latest.values() if r.status == "failed"]
        if not to_retry:
            return None
        rec = TaskRun(
            task_id=tr.task_id, task_version_id=tr.task_version_id,
            data_snapshot_id=tr.data_snapshot_id,
            resolved_rule_version_id=tr.resolved_rule_version_id,
            resolved_workflow_version_id=tr.resolved_workflow_version_id,
            resolved_agent_version_id=tr.resolved_agent_version_id,
            resolved_release_id=tr.resolved_release_id,
            runtime_binding_snapshot=tr.runtime_binding_snapshot,
            trigger=tr.trigger, status="queued",
            total=len(to_retry), total_state="exact",
            retry_of_task_run_id=tr.id, run_scope="failed_items",
            retry_round=(tr.retry_round or 0) + 1)
        db.add(rec)
        db.flush()
        for fr in to_retry:
            nr = Run(workflow_id=fr.workflow_id,
                     workflow_version_id=fr.workflow_version_id,
                     trigger="batch", status="queued", input=fr.input,
                     definition_source="version", task_run_id=rec.id,
                     task_id=tr.task_id, task_version_id=fr.task_version_id,
                     interaction_ref=fr.interaction_ref,
                     attempt=(fr.attempt or 1) + 1, origin_run_id=fr.id,
                     definition_version_id=fr.definition_version_id,
                     rule_version_id=fr.rule_version_id,
                     data_snapshot_id=fr.data_snapshot_id)
            db.add(nr)
        db.add(JobQueue(type="task-run", payload={"task_run_id": rec.id},
                        run_at=datetime.now(timezone.utc)))
        db.commit()
        db.refresh(rec)
        return rec
    except Exception:  # noqa: BLE001
        db.rollback()
        return None
    finally:
        db.close()
        db.close()
