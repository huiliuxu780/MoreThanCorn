"""质检业务层深化：Result Rules 引擎 / Review 流 / Data Asset 批量 / Task×Schedule。

09-SDD P0-B1：Task 版本化（TaskVersion 不可变）、ResultRuleVersion 不可变、
发布不全库重算（P0-07）、ReviewRevision 只追加（INV-08）。"""
import copy
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import (apply_data_scope, assert_task_readable, data_scope_members,
                    require_admin, require_operator, require_reviewer, require_role)
from ..db import get_db
from ..models import (AgentVersion, AnalysisTask, AnalysisTaskVersion, DataAsset,
                      DataDefinitionVersion, QualityResult, ResultDelivery,
                      ResultRuleSet, ResultRuleVersion, ReviewRevision, Schedule,
                      Workflow, WorkflowVersion)
from ..output_binding import MappingExpressionError, normalize_binding
from ..output_binding_validator import validate_for_edit
from ..output_schema import latest_quality_schema

router = APIRouter(tags=["business"])


def _sha256_of(obj) -> str:
    import hashlib
    import json
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False,
                                     default=str).encode()).hexdigest()


def _resolve_output_contract(db: Session, target_type: str, agent_id: str | None,
                             workflow_id: str | None, policy: str | None,
                             pinned: str | None) -> tuple[dict, str, str, str]:
    """SDD 13 §5.1：Output Schema 来自冻结执行目标（Agent Module / WorkflowVersion），
    TaskVersion 只冻结本体+ref+sha256，不由前端重造。返回 (schema, ref, sha256, source)。"""
    if target_type == "agent" and agent_id:
        from ..models import Agent
        from ..agent_modules import registry as module_registry
        agent = db.get(Agent, agent_id)
        if agent and agent.module_key:
            mod = module_registry.get(agent.module_key, agent.module_version)
            ref = f"{mod.output_schema_ref['id']}@{mod.version}"
            return mod.output_schema, ref, _sha256_of(mod.output_schema), "module"
    wf = db.get(Workflow, workflow_id) if workflow_id else None
    wv = None
    if wf:
        if policy == "pinned" and pinned:
            wv = db.get(WorkflowVersion, pinned)
        elif wf.current_version_id:
            wv = db.get(WorkflowVersion, wf.current_version_id)
    schemas = (wv.structured_output_schemas if wv else None) or []
    if schemas and isinstance(schemas, list) and schemas[0]:
        first = schemas[0]
        schema = first.get("schema") or first
        ref = first.get("ref") or f"workflow-output@{wv.version_no}"
        return schema, ref, _sha256_of(schema), "workflow"
    osrow = latest_quality_schema(db)
    if osrow:
        return osrow.schema_, f"{osrow.key}@v{osrow.version_no}", \
            _sha256_of(osrow.schema_), "legacy_quality"
    return {}, "unknown@0", _sha256_of({}), "none"


def _apply_output_binding(db: Session, payload: dict, target_type: str,
                          agent_id: str | None, workflow_id: str | None,
                          policy: str | None, pinned: str | None) -> dict:
    """解析+校验 outputBinding；返回要写入 TaskVersion 的字段 dict（422 带完整 issues）。"""
    raw = payload.get("outputBinding")
    if raw in (None, {}):
        return {"output_mode": "platform_only"}
    try:
        binding = normalize_binding(raw)
    except MappingExpressionError as exc:
        raise HTTPException(422, {"code": exc.code, "message": exc.message,
                                  "path": "outputBinding"})
    if binding["mode"] != "target_table":
        return {"output_mode": "platform_only"}
    schema, ref, sha, source = _resolve_output_contract(
        db, target_type, agent_id, workflow_id, policy, pinned)
    rep = validate_for_edit(db, binding, output_schema=schema, output_schema_ref=ref,
                            input_asset_id=payload.get("dataAssetId"))
    if not rep["valid"]:
        raise HTTPException(422, {"code": "OUTPUT_BINDING_INVALID",
                                  "message": "OutputBinding 校验失败",
                                  "issues": rep["issues"]})
    from datetime import datetime as _dt, timezone as _tz
    return {"output_mode": "target_table",
            "output_asset_id": binding["assetId"],
            "output_definition_version_id": binding["definitionVersionId"],
            "output_write_mode": binding["writeMode"],
            "output_key_fields": binding["keyFields"],
            "output_mapping": binding["mapping"],
            "output_failure_policy": binding["failurePolicy"],
            "output_contract_snapshot": {
                "schema": schema, "ref": ref, "sha256": sha, "source": source,
                "constants": binding["constants"],
                "validatedAt": _dt.now(_tz.utc).isoformat(),
                "schemaFingerprint": (rep["resolved"] or {}).get("schemaFingerprint")}}

# 09 §11.1：Task 状态机取值
TASK_STATUSES = ("draft", "active", "paused", "archived")


# ---------- 规则引擎 ----------

def _match(rule: dict, output: dict) -> bool:
    field, op, value = rule.get("field", ""), rule.get("op", "eq"), rule.get("value")
    cur = output
    for part in field.split("."):
        cur = cur.get(part) if isinstance(cur, dict) else None
    if op == "eq":
        return cur == value
    if op == "neq":
        return cur != value
    if op == "contains":
        return str(value) in str(cur or "")
    if op == "gt":
        return float(cur or 0) > float(value)
    if op == "lt":
        return float(cur or 0) < float(value)
    if op == "exists":
        return cur is not None
    return False


def evaluate_rules(rules: dict, output: dict) -> dict:
    score = 100
    issues = []
    for r in rules.get("scoreRules", []):
        if not _match(r, output):
            score -= int(r.get("weight", 10))
    for r in rules.get("issueRules", []):
        if _match(r, output):
            issues.append(r)
    sev_order = {"Critical": 3, "High": 2, "Medium": 1, "Low": 0}
    risk = max((r.get("severity", "Low") for r in issues), key=lambda s: sev_order.get(s, 0), default=None)
    return {"score": max(0, score), "risk": risk, "issueCount": len(issues),
            "issueSummary": "；".join(r.get("criterion", "") for r in issues) or None}


def active_rule_version(db: Session) -> ResultRuleVersion | None:
    """最近发布的冻结规则版本（ResultRuleVersion 由发布动作创建，天然已发布）。"""
    return db.execute(
        select(ResultRuleVersion).order_by(ResultRuleVersion.created_at.desc(),
                                           ResultRuleVersion.id.desc())).scalars().first()


def apply_rules_to_result(db: Session, qr: QualityResult,
                          rule_version_id: str | None = None) -> None:
    """按冻结 RuleVersion 派生（09 §6.6）。未指定版本时取最近发布版本；
    结果记录明确 rule_version_id（P0-07/P0-08）。"""
    rv = (db.get(ResultRuleVersion, rule_version_id) if rule_version_id
          else active_rule_version(db))
    if not rv:
        return
    derived = evaluate_rules(rv.rules or {}, qr.structured_output or {})
    qr.score = derived["score"]
    qr.risk = derived["risk"]
    qr.issue_count = derived["issueCount"]
    qr.issue_summary = derived["issueSummary"]
    qr.rules_version = rv.version_no
    qr.rule_version_id = rv.id
    qr.derived_result = derived


@router.get("/api/result-rules")
def list_rules(page: int = 1, pageSize: int = 50, db: Session = Depends(get_db)):
    """09 P1-10：真分页（服务端 offset/limit + total），不再全量载入。"""
    q = db.query(ResultRuleSet).order_by(ResultRuleSet.updated_at.desc())
    total = q.count()
    rows = q.offset((page - 1) * pageSize).limit(pageSize).all()
    return {"items": [{"id": r.id, "name": r.name, "description": r.description,
                       "agentId": r.agent_id, "currentVersion": f"V{r.version}",
                       "versionStatus": "Published" if r.status == "published" else "Draft",
                       "evaluationPriority": r.evaluation_priority,
                       "updatedAt": r.updated_at.isoformat()} for r in rows],
            "total": total, "page": page, "pageSize": pageSize}


@router.post("/api/result-rules", status_code=201)
def create_rules(payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    r = ResultRuleSet(name=payload["name"], description=payload.get("description", ""),
                      agent_id=payload.get("agentId", ""), rules=payload.get("rules", {}))
    db.add(r)
    db.commit()
    return {"id": r.id, "version": r.version}


@router.get("/api/result-rules/{rid}")
def get_rules(rid: str, db: Session = Depends(get_db)):
    r = db.get(ResultRuleSet, rid)
    if not r:
        raise HTTPException(404, "规则不存在")
    vs = db.execute(select(ResultRuleVersion)
                    .where(ResultRuleVersion.rule_set_id == rid)
                    .order_by(ResultRuleVersion.version_no.desc())).scalars().all()
    return {"id": r.id, "name": r.name, "description": r.description,
            "version": r.version, "status": r.status, "rules": r.rules,
            "versions": [{"id": v.id, "versionNo": v.version_no, "rules": v.rules,
                          "createdAt": v.created_at.isoformat()} for v in vs]}


@router.put("/api/result-rules/{rid}")
def update_rules(rid: str, payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """草稿编辑：只改草稿内容；已发布版本不受影响（下次发布生成新版本）。"""
    r = db.get(ResultRuleSet, rid)
    if not r:
        raise HTTPException(404, "规则不存在")
    if payload.get("rules") is not None:
        r.rules = payload["rules"]
    if payload.get("name"):
        r.name = payload["name"]
    db.commit()
    return {"id": r.id, "version": r.version, "status": r.status}


@router.get("/api/result-rules/{rid}/versions")
def list_rule_versions(rid: str, db: Session = Depends(get_db)):
    r = db.get(ResultRuleSet, rid)
    if not r:
        raise HTTPException(404, "规则不存在")
    vs = db.execute(select(ResultRuleVersion)
                    .where(ResultRuleVersion.rule_set_id == rid)
                    .order_by(ResultRuleVersion.version_no.desc())).scalars().all()
    return {"items": [{"id": v.id, "versionNo": v.version_no, "rules": v.rules,
                       "evaluationPriority": v.evaluation_priority,
                       "createdBy": v.created_by,
                       "createdAt": v.created_at.isoformat()} for v in vs]}


@router.post("/api/result-rules/{rid}/publish")
def publish_rules(rid: str, db: Session = Depends(get_db),
                  user: dict = Depends(require_operator)):
    """09-P0-07：发布=冻结不可变 ResultRuleVersion。
    禁止全库重算（原 recalc_all 已废止）；存量结果保留各自冻结版本。"""
    from sqlalchemy import func
    r = db.get(ResultRuleSet, rid)
    if not r:
        raise HTTPException(404, "规则不存在")
    max_no = db.query(func.max(ResultRuleVersion.version_no))\
        .filter_by(rule_set_id=rid).scalar() or 0
    version_no = max_no + 1
    actor = user.get("username", "system")
    rv = ResultRuleVersion(rule_set_id=rid, version_no=version_no,
                           rules=copy.deepcopy(r.rules or {}),
                           evaluation_priority=r.evaluation_priority,
                           created_by=actor)
    db.add(rv)
    r.status = "published"
    r.version = version_no
    db.flush()
    from .admin import audit
    audit(db, actor, "rules.publish", "result_rule_set", rid,
          {"ruleVersionId": rv.id, "version": version_no})
    db.commit()
    return {"id": r.id, "version": version_no, "ruleVersionId": rv.id}


# ---------- Review 流 ----------

def _qr_by_any(db, rid: str):
    """复核审计修复：前端按 interaction_ref 跳转/调用，后端主键是随机 id；
    两者都允许定位（先主键，后 interaction_ref）。"""
    qr = db.get(QualityResult, rid)
    if qr:
        return qr
    return db.query(QualityResult).filter(QualityResult.interaction_ref == rid).first()


@router.post("/api/quality-results/{rid}/review")
def review_result(rid: str, payload: dict, db: Session = Depends(get_db),
                  user: dict = Depends(require_reviewer)):
    """09 §9.7/INV-08：复核只追加 ReviewRevision；ai_result 不可变。
    顶层 score/risk 为生效值（人工修订后更新），AI 原始值恒在 ai_result。"""
    qr = _qr_by_any(db, rid)
    if not qr:
        raise HTTPException(404, "质检结果不存在")
    action = payload.get("action", "approve")
    if action not in ("approve", "revise", "effective", "reopen"):
        raise HTTPException(422, "未知复核动作")
    note = payload.get("note", "")
    # 09 P0-10（审计：reviewer 可伪造）：复核人来自鉴权身份，忽略请求体
    reviewer = user.get("username", "reviewer")
    before = {"status": qr.review_status, "score": qr.score, "risk": qr.risk}
    if action == "approve":
        qr.review_status = "REVIEWED"
    elif action == "effective":
        qr.review_status = "EFFECTIVE"
    elif action == "reopen":
        # 09 §11.4：REOPENED 回到待复核池
        qr.review_status = "REOPENED"
    elif action == "revise":
        qr.review_status = "REVIEWED"
        if payload.get("score") is not None:
            qr.score = float(payload["score"])
        if payload.get("risk"):
            qr.risk = payload["risk"]
    # 终态（REVIEWED/EFFECTIVE）释放领取；REOPENED 清空领取人回池
    if qr.review_status in ("REVIEWED", "EFFECTIVE", "REOPENED"):
        qr.review_claimed_by = None
        qr.review_claimed_at = None
    after = {"status": qr.review_status, "score": qr.score, "risk": qr.risk}
    rev_no = db.query(ReviewRevision).filter_by(quality_result_id=qr.id).count() + 1
    rev = ReviewRevision(quality_result_id=qr.id, revision_no=rev_no, action=action,
                         reason=note, reviewer_id=reviewer, before=before, after=after)
    db.add(rev)
    db.flush()
    qr.effective_review_revision_id = rev.id
    hist = list(qr.review_history or [])
    hist.append({"at": datetime.now(timezone.utc).isoformat(), "action": action,
                 "reviewer": reviewer, "note": note, "before": before, "after": after})
    qr.review_history = hist
    db.commit()
    return {"id": qr.id, "review": qr.review_status, "history": qr.review_history,
            "revisionId": rev.id, "revisionNo": rev.revision_no}


# ---------- 09 P1-02：复核工作流（待复核队列 / 领取 / 分配，§11.4） ----------

_REVIEW_PENDING = ("AI", "REOPENED")


def _review_item(qr) -> dict:
    return {"id": qr.id, "interactionId": qr.interaction_ref,
            "interactionTime": qr.interaction_time.isoformat() if qr.interaction_time else None,
            "review": qr.review_status, "score": qr.score, "risk": qr.risk,
            "claimedBy": qr.review_claimed_by,
            "claimedAt": qr.review_claimed_at.isoformat() if qr.review_claimed_at else None,
            "taskRunId": qr.task_run_id, "taskId": qr.task_id}


@router.get("/api/quality-results/review-queue")
def review_queue(pool: str = "pending", reviewer: str = "", page: int = 1,
                 pageSize: int = 50, db: Session = Depends(get_db),
                 _user: dict = Depends(require_reviewer)):
    """pool=pending：待复核池（AI/REOPENED 且未被领取）；pool=mine：指定复核人已领取。
    P2-02：team 数据范围按任务创建者归属强制（无任务归属的行对 team 范围不可见）。"""
    q = db.query(QualityResult)
    members = data_scope_members(db, _user)
    if members is not None:
        from ..models import AnalysisTask as _AT
        q = q.join(_AT, QualityResult.task_id == _AT.id).filter(_AT.created_by.in_(members))
    if pool == "mine":
        if not reviewer:
            reviewer = _user.get("username", "")
        q = q.filter(QualityResult.review_claimed_by == reviewer,
                     QualityResult.review_status.in_(_REVIEW_PENDING + ("IN_REVIEW",)))
    else:
        q = q.filter(QualityResult.review_status.in_(_REVIEW_PENDING),
                     QualityResult.review_claimed_by.is_(None))
    total = q.count()
    rows = q.order_by(QualityResult.interaction_time.desc())\
        .offset((page - 1) * pageSize).limit(pageSize).all()
    return {"items": [_review_item(r) for r in rows], "total": total,
            "page": page, "pageSize": pageSize}


@router.post("/api/quality-results/{rid}/claim")
def claim_review(rid: str, payload: dict, db: Session = Depends(get_db),
                 user: dict = Depends(require_reviewer)):
    qr = _qr_by_any(db, rid)
    if not qr:
        raise HTTPException(404, "质检结果不存在")
    # 09 P0-10：reviewer 来自身份，不得由请求体伪造
    reviewer = user.get("username", "reviewer")
    # 09 P1-02（审计：并发领取）：原子条件更新，防止两复核人同时领取
    from sqlalchemy import update
    res = db.execute(update(QualityResult).where(
        QualityResult.id == qr.id,
        QualityResult.review_status.in_(_REVIEW_PENDING),
        QualityResult.review_claimed_by.is_(None)).values(
        review_status="IN_REVIEW", review_claimed_by=reviewer,
        review_claimed_at=datetime.now(timezone.utc)))
    db.commit()
    if res.rowcount == 0:
        db.refresh(qr)
        if qr.review_claimed_by:
            raise HTTPException(409, f"已被 {qr.review_claimed_by} 领取")
        raise HTTPException(409, f"当前状态 {qr.review_status} 不可领取")
    db.refresh(qr)
    return {"id": qr.id, "review": qr.review_status, "claimedBy": qr.review_claimed_by}


@router.post("/api/quality-results/{rid}/release")
def release_review(rid: str, db: Session = Depends(get_db),
                   user: dict = Depends(require_reviewer)):
    qr = _qr_by_any(db, rid)
    if not qr:
        raise HTTPException(404, "质检结果不存在")
    if qr.review_status == "IN_REVIEW":
        qr.review_status = "AI"
    qr.review_claimed_by = None
    qr.review_claimed_at = None
    db.commit()
    return {"id": qr.id, "review": qr.review_status, "claimedBy": None}


@router.post("/api/quality-results/{rid}/assign")
def assign_review(rid: str, payload: dict, db: Session = Depends(get_db),
                  user: dict = Depends(require_operator)):
    qr = _qr_by_any(db, rid)
    if not qr:
        raise HTTPException(404, "质检结果不存在")
    reviewer = (payload or {}).get("reviewer")
    if not reviewer:
        raise HTTPException(422, "reviewer 必填")
    qr.review_claimed_by = reviewer
    qr.review_claimed_at = datetime.now(timezone.utc)
    if qr.review_status in _REVIEW_PENDING:
        qr.review_status = "IN_REVIEW"
    db.commit()
    return {"id": qr.id, "review": qr.review_status, "claimedBy": qr.review_claimed_by}


@router.post("/api/quality-results/{rid}/evidence", status_code=201)
def add_manual_evidence(rid: str, payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """R2：人工添加证据（此前前端只 toast 占位）。"""
    from ..models import Evidence
    qr = _qr_by_any(db, rid)
    if not qr:
        raise HTTPException(404, "质检结果不存在")
    text = (payload or {}).get("text", "")
    if not str(text).strip():
        raise HTTPException(422, "证据内容不能为空")
    ev = Evidence(result_id=qr.id, kind=str((payload or {}).get("kind", "manual")),
                  locator=(payload or {}).get("locator") if isinstance((payload or {}).get("locator"), dict) else {},
                  text=str(text), source_ref=str((payload or {}).get("sourceRef", "manual")))
    db.add(ev)
    db.commit()
    return {"id": ev.id, "kind": ev.kind}


# ---------- Data Asset ----------

@router.get("/api/data-assets")
def list_assets(page: int = 1, pageSize: int = 50, db: Session = Depends(get_db)):
    """09 P1-10：真分页。"""
    q = db.query(DataAsset).order_by(DataAsset.updated_at.desc())
    total = q.count()
    rows = q.offset((page - 1) * pageSize).limit(pageSize).all()
    return {"items": [{"id": a.id, "name": a.name, "description": a.description,
                       "source": a.source, "recordMeaning": a.record_meaning,
                       "recordIdField": a.record_id_field, "timeField": a.time_field,
                       "timeFieldLabel": a.time_field, "lifecycle": a.lifecycle,
                       "health": a.health, "currentRevision": a.revision,
                       "updatedAt": a.updated_at.isoformat()} for a in rows],
            "total": total, "page": page, "pageSize": pageSize}


@router.post("/api/data-assets", status_code=201)
def create_asset(payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    from ..models import Datasource
    ds_id = payload.get("datasourceId")
    if ds_id and not db.get(Datasource, ds_id):
        raise HTTPException(422, "datasourceId 不存在")
    a = DataAsset(name=payload["name"], description=payload.get("description", ""),
                  source=payload.get("source", "manual"), rows=payload.get("rows", []),
                  datasource_id=ds_id,
                  location=payload.get("location", ""),
                  record_id_field=payload.get("recordIdField", "interactionId"),
                  time_field=payload.get("timeField", "interactionTime"))
    db.add(a)
    db.commit()
    return {"id": a.id, "name": a.name}


@router.get("/api/data-assets/writable")
def list_writable_assets(db: Session = Depends(get_db)):
    """SDD 13 §9.1：目标表只列出可写 table asset（已连接+Ready+postgresql）。"""
    from ..models import Connection, Datasource
    rows = db.query(DataAsset).order_by(DataAsset.updated_at.desc()).all()
    items = []
    for a in rows:
        ds = db.get(Datasource, a.datasource_id) if a.datasource_id else None
        if not ds or (ds.type or "") != "postgresql" or (ds.status or "") != "enabled":
            continue
        conn = db.get(Connection, ds.connection_id) if ds.connection_id else None
        if not conn or (conn.lifecycle or "") not in ("active",):
            continue
        if (a.lifecycle or "") != "Ready" or not (a.location or "").strip():
            continue
        items.append({"id": a.id, "name": a.name, "location": a.location,
                      "datasourceName": ds.name, "connectionName": conn.name,
                      "lifecycle": a.lifecycle})
    return {"items": items}


@router.get("/api/data-assets/{aid}/target-meta")
def get_target_meta(aid: str, db: Session = Depends(get_db)):
    """SDD 13 §9.1：mapping grid 所需的目标列/唯一约束/定义版本（服务端探测）。"""
    from ..data_writers import WriterError, get_writer
    from ..models import DataDefinition, DataDefinitionVersion, Datasource
    a = db.get(DataAsset, aid)
    if not a:
        raise HTTPException(404, "数据资产不存在")
    ds = db.get(Datasource, a.datasource_id) if a.datasource_id else None
    if not ds:
        raise HTTPException(422, "目标 DataAsset 未绑定 DataSource")
    schema_name, table = "public", (a.location or "").strip()
    if "." in table:
        s, t = table.split(".", 1)
        schema_name, table = s, t
    snap = {"schemaName": schema_name, "table": table}
    try:
        writer = get_writer(db, ds)
        meta = writer.inspect_target(snap)
    except WriterError as exc:
        raise HTTPException(422, {"code": exc.code, "message": exc.message})
    defs = db.query(DataDefinition).filter_by(data_asset_id=aid).all()
    def_versions = []
    for d in defs:
        vs = db.query(DataDefinitionVersion).filter_by(definition_id=d.id)\
            .order_by(DataDefinitionVersion.version_no.desc()).all()
        for v in vs:
            def_versions.append({"id": v.id, "definitionId": d.id, "name": d.name,
                                 "versionNo": v.version_no})
    return {"columns": [{"name": c.name, "type": c.pg_type, "nullable": c.nullable,
                         "hasDefault": c.has_default} for c in meta.columns.values()],
            "uniqueConstraints": [list(u) for u in meta.unique_constraints],
            "definitions": def_versions}


@router.get("/api/data-assets/{aid}")
def get_asset(aid: str, db: Session = Depends(get_db)):
    a = db.get(DataAsset, aid)
    if not a:
        raise HTTPException(404, "数据资产不存在")
    return {"id": a.id, "name": a.name, "rows": a.rows, "revision": a.revision}


@router.post("/api/data-assets/{aid}/rows")
def append_rows(aid: str, payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    a = db.get(DataAsset, aid)
    if not a:
        raise HTTPException(404, "数据资产不存在")
    rows = list(a.rows or []) + (payload.get("rows") or [])
    a.rows = rows
    a.revision += 1
    db.commit()
    return {"id": a.id, "rows": len(rows), "revision": a.revision}


# ---------- Analysis Task + 批量 + Schedule ----------

def _norm_sampling(v) -> dict:
    """09 §9.2：sampling 结构化。兼容旧扁平值（确定性转换，不静默丢弃）。"""
    if isinstance(v, dict):
        return v
    if v in (None, "", "all"):
        return {"mode": "all"}
    if isinstance(v, str) and v.startswith("first_"):
        try:
            return {"mode": "count", "count": int(v.split("_")[1])}
        except ValueError:
            pass
    return {"mode": "legacy", "expr": str(v)}


def _norm_window(v) -> dict:
    if isinstance(v, dict):
        return v
    if v in (None, "", "all"):
        return {"mode": "all"}
    if v in ("last_24h", "last_7d", "last_30d"):
        return {"mode": "relative", "value": v, "timezone": "Asia/Shanghai"}
    return {"mode": "legacy", "expr": str(v)}


def _norm_scope(v) -> dict:
    if isinstance(v, dict):
        return v
    if v in (None, "", "all"):
        return {"op": "and", "conditions": []}
    return {"mode": "legacy", "expr": str(v)}


def _denorm_sampling(s: dict) -> str:
    if s.get("mode") == "count":
        return f"first_{s.get('count', 0)}"
    if s.get("mode") == "all":
        return "all"
    return "all"


def _denorm_window(w: dict) -> str:
    if w.get("mode") == "relative":
        return w.get("value", "all")
    if w.get("mode") == "all":
        return "all"
    return w.get("expr", "all")


def _denorm_scope(s: dict) -> str:
    """legacy 扁平列（只读兼容）：结构化条件无法用字符串表达时记 all。"""
    if s.get("mode") == "legacy":
        return s.get("expr", "all")
    return "all"


def _execution_target_dto(v: AnalysisTaskVersion) -> dict:
    """R7-1：统一执行目标契约。agent → {type,agentId,versionPolicy,pinnedAgentVersionId}；
    workflow → {type,workflowId,versionPolicy,pinnedWorkflowVersionId}。"""
    if v.execution_target_type == "agent":
        return {"type": "agent", "agentId": v.agent_id,
                "versionPolicy": v.agent_version_policy,
                "pinnedAgentVersionId": v.pinned_agent_version_id}
    return {"type": "workflow", "workflowId": v.workflow_id,
            "versionPolicy": v.workflow_version_policy,
            "pinnedWorkflowVersionId": v.pinned_workflow_version_id}


def _validate_input_mapping(module_key: str | None, mapping: dict) -> None:
    """R7-3：字段映射目标来自 Module inputSchema。必填输入必须全部被映射
    （mapping = {agent输入键: 数据字段}），否则任务无法构造合法 Agent 输入。"""
    if not module_key:
        return
    from ..agent_modules import registry as module_registry
    try:
        mod = module_registry.get(module_key)
    except Exception:
        return
    required = (mod.input_schema or {}).get("required") or []
    missing = [k for k in required if k not in (mapping or {})]
    if missing:
        raise HTTPException(422, {"code": "INPUT_MAPPING_INCOMPLETE",
                                  "message": f"Module 必填输入未映射：{', '.join(missing)}",
                                  "path": "inputMapping"})


def _carry_binding(cur) -> dict:
    """编辑未显式提供 outputBinding 时沿用当前版本冻结值（TaskVersion 不可变语义）。"""
    if cur is None or (cur.output_mode or "platform_only") != "target_table":
        return {"output_mode": "platform_only"}
    return {"output_mode": cur.output_mode, "output_asset_id": cur.output_asset_id,
            "output_definition_version_id": cur.output_definition_version_id,
            "output_write_mode": cur.output_write_mode,
            "output_key_fields": cur.output_key_fields or [],
            "output_mapping": cur.output_mapping or {},
            "output_failure_policy": cur.output_failure_policy,
            "output_contract_snapshot": cur.output_contract_snapshot}


def _task_version_dto(db: Session, v: AnalysisTaskVersion) -> dict:
    os_label = ""
    if v.output_schema_version_id:
        from ..models import QualityOutputSchema
        row = db.get(QualityOutputSchema, v.output_schema_version_id)
        if row:
            os_label = f"{row.key}@v{row.version_no}"
    # SDD 13 §8.1：outputSchema + outputBinding 通用呈现（legacy 质检引用只作兼容字段）
    contract = v.output_contract_snapshot or {}
    asset_name = None
    if v.output_asset_id:
        from ..models import DataAsset as _DA
        oa = db.get(_DA, v.output_asset_id)
        asset_name = oa.name if oa else None
    output_schema = {"ref": contract.get("ref") or os_label,
                     "sha256": contract.get("sha256")}
    output_binding = {"mode": v.output_mode or "platform_only",
                      "assetId": v.output_asset_id, "assetName": asset_name,
                      "definitionVersionId": v.output_definition_version_id,
                      "writeMode": v.output_write_mode,
                      "keyFields": v.output_key_fields or [],
                      "mapping": v.output_mapping or {},
                      "failurePolicy": v.output_failure_policy,
                      "validatedAt": contract.get("validatedAt"),
                      "schemaFingerprint": contract.get("schemaFingerprint")}
    return {"id": v.id, "versionNo": v.version_no,
            "workflowId": v.workflow_id,
            "workflowVersionPolicy": v.workflow_version_policy,
            "pinnedWorkflowVersionId": v.pinned_workflow_version_id,
            # R7-1：统一执行目标契约（agent|workflow）
            "executionTarget": _execution_target_dto(v),
            "dataAssetId": v.data_asset_id,
            "dataDefinitionVersionId": v.data_definition_version_id,
            "resultRuleVersionId": v.result_rule_version_id,
            "rulePolicy": v.rule_policy,
            "resultRuleSetId": v.result_rule_set_id,
            "inputMapping": v.input_mapping or {},
            "scope": v.scope or {},
            "sampling": v.sampling or {},
            "dataWindow": v.data_window or {},
            "outputSchemaVersion": os_label,
            "outputSchemaVersionId": v.output_schema_version_id,
            "outputSchema": output_schema,
            "outputBinding": output_binding,
            "note": v.note, "createdBy": v.created_by,
            "createdAt": v.created_at.isoformat()}


def _validate_task_config(db: Session, workflow_id: str, policy: str,
                          pinned: str | None, asset_id: str | None,
                          rule_version_id: str | None, definition_version_id: str | None,
                          rule_policy: str = "pinned", rule_set_id: str | None = None):
    """09 P0 修复轮（审计反例 3/6）：任务创建强制校验。

    - dataDefinitionVersionId 必填（P0-08：追踪字段全部非空）。
    - 规则绑定：pinned 必须给 resultRuleVersionId；follow_latest 必须显式声明，
      且批次启动时解析（无已发布版本则启动失败）。
    - 工作流必须包含 create-record 节点（能产出合规质检结果），
      否则业务"成功"却 0 QualityResult（审计反例 3）。
    """
    if not workflow_id:
        raise HTTPException(422, "workflowId 必填")
    wf = db.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "工作流不存在")
    # 解析将执行的工作流版本（pinned=钉住版本；latest=当前发布版本），校验其产出质检结果
    if policy == "pinned":
        if not pinned:
            raise HTTPException(422, "pinned 策略必须提供 pinnedWorkflowVersionId")
        wv = db.get(WorkflowVersion, pinned)
        if not wv or wv.workflow_id != workflow_id:
            raise HTTPException(422, "pinnedWorkflowVersionId 不存在或不属于该工作流")
    else:
        if not wf.current_version_id:
            raise HTTPException(422, "工作流没有已发布版本（latest_published 策略需要先发布）")
        wv = db.get(WorkflowVersion, wf.current_version_id)
        if not wv:
            raise HTTPException(422, "工作流发布版本不存在")
    defn = (wv.definition or {}) if wv else {}
    nodes = ((defn.get("graph") or {}).get("nodes")) or []
    if not any(n.get("type") == "create-record" for n in nodes if isinstance(n, dict)):
        raise HTTPException(422, "工作流必须包含「落质检结果（create-record）」节点才能绑定质检任务："
                                "当前工作流不产出质检结果，执行将无法生成 QualityResult")
    if not asset_id or not db.get(DataAsset, asset_id):
        raise HTTPException(422, "dataAssetId 必填且必须存在")
    # 09 P0-08：定义版本必填（追踪字段非空）
    if not definition_version_id:
        raise HTTPException(422, "dataDefinitionVersionId 必填（P0-08 追踪字段非空）")
    if not db.get(DataDefinitionVersion, definition_version_id):
        raise HTTPException(422, "dataDefinitionVersionId 不存在")
    # 规则绑定：pinned 需显式版本；follow_latest 需显式声明
    if rule_policy not in ("pinned", "follow_latest"):
        raise HTTPException(422, "rulePolicy 必须是 pinned|follow_latest")
    if rule_policy == "pinned":
        if not rule_version_id:
            raise HTTPException(422, "pinned 规则策略必须提供 resultRuleVersionId"
                                    "（或显式 rulePolicy=follow_latest）")
        if not db.get(ResultRuleVersion, rule_version_id):
            raise HTTPException(422, "resultRuleVersionId 不存在")
    else:
        if rule_version_id:
            raise HTTPException(422, "follow_latest 策略不应同时提供 resultRuleVersionId")
        # 09 闭环验收修复（P1-3）：follow_latest 必须显式声明 RuleSet 作用域
        if not rule_set_id:
            raise HTTPException(422, "follow_latest 策略必须提供 resultRuleSetId（RuleSet 作用域）")
        if not db.get(ResultRuleSet, rule_set_id):
            raise HTTPException(422, "resultRuleSetId 不存在")
    return wf


@router.post("/api/quality-results/retention-purge", status_code=200)
def retention_purge(payload: dict, db: Session = Depends(get_db),
                    _user: dict = Depends(require_admin)):
    """09 P1-04：数据保留/删除策略——删除超过保留期的质检结果（admin、显式、留痕）。

    需显式传 retentionDays（不做隐式删除）；返回删除条数。属破坏性操作，
    生产使用须经审批；此处仅提供受控能力。"""
    from datetime import timedelta
    from .admin import audit
    retention_days = (payload or {}).get("retentionDays")
    if not retention_days or int(retention_days) <= 0:
        raise HTTPException(422, "必须显式提供正整数 retentionDays（禁止隐式删除）")
    cutoff = datetime.now(timezone.utc) - timedelta(days=int(retention_days))
    from ..models import QualityResult
    q = db.query(QualityResult).filter(QualityResult.created_at < cutoff)
    n = q.count()
    q.delete(synchronize_session=False)
    audit(db, "admin", "retention.purge", "quality_result", "-",
          {"deleted": n, "retentionDays": int(retention_days)})
    db.commit()
    return {"deleted": n, "retentionDays": int(retention_days)}


@router.get("/api/tasks")
def list_tasks(page: int = 1, pageSize: int = 50, db: Session = Depends(get_db),
               user: dict = Depends(require_role())):
    """09 P1-10：真分页。P2-02：team 数据范围服务端强制。"""
    q = apply_data_scope(db, db.query(AnalysisTask), user, AnalysisTask.created_by) \
        .order_by(AnalysisTask.created_at.desc())
    total = q.count()
    rows = q.offset((page - 1) * pageSize).limit(pageSize).all()
    from ..models import Agent, TaskRun
    items = []
    for t in rows:
        v = db.get(AnalysisTaskVersion, t.current_version_id) if t.current_version_id else None
        agent = None
        if v is not None and v.execution_target_type == "agent" and v.agent_id:
            agent = db.get(Agent, v.agent_id)
        last = (db.query(TaskRun).filter_by(task_id=t.id)
                .order_by(TaskRun.created_at.desc()).first())
        items.append({"id": t.id, "name": t.name, "description": t.description,
                      "workflowId": t.workflow_id,
                      "workflowVersionPolicy": (v.workflow_version_policy if v else t.version_policy),
                      # R7-4：执行目标类型 + Agent/Module + 最近批次
                      "executionTarget": _execution_target_dto(v) if v else
                      {"type": "workflow", "workflowId": t.workflow_id,
                       "versionPolicy": t.version_policy, "pinnedWorkflowVersionId": None},
                      "executionTargetType": (v.execution_target_type if v else "workflow"),
                      "agentName": agent.name if agent else None,
                      "moduleKey": agent.module_key if agent else None,
                      "dataAssetId": t.data_asset_id,
                      "dataDefinitionId": t.data_definition_id,
                      "scope": v.scope if v else t.scope,
                      "sampling": v.sampling if v else t.sampling,
                      "schedule": v.data_window if v else t.data_window,
                      "dataWindow": v.data_window if v else t.data_window,
                      "status": t.status,
                      "currentVersionNo": v.version_no if v else None,
                      "lastTaskRun": {"id": last.id, "status": last.status,
                                      "createdAt": last.created_at.isoformat()} if last else None})
    return {"items": items, "total": total, "page": page, "pageSize": pageSize}


@router.post("/api/tasks", status_code=201)
def create_task(payload: dict, db: Session = Depends(get_db),
                user: dict = Depends(require_operator)):
    """09 §10.1：创建即生成 TaskVersion v1；返回已解析快照（确认页必须用它渲染）。"""
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "任务名称必填")
    # SDD 10 §15.3（R3）：统一执行目标 workflow|agent；旧 workflow payload 兼容转换
    target = payload.get("executionTarget") or {}
    target_type = target.get("type") or "workflow"
    if target_type not in ("workflow", "agent"):
        raise HTTPException(422, "executionTarget.type 必须是 workflow|agent")
    agent_id = agent_version_policy = pinned_agent = None
    if target_type == "agent":
        from ..models import Agent
        agent_id = target.get("agentId")
        agent = db.get(Agent, agent_id) if agent_id else None
        if not agent:
            raise HTTPException(422, "executionTarget.agentId 必填且必须存在")
        if not agent.module_key:
            raise HTTPException(422, "仅领域 Module Agent 可作为执行目标（旧三类已封存）")
        agent_version_policy = target.get("versionPolicy") or "latest_sandbox_release"
        if agent_version_policy not in ("pinned", "latest_sandbox_release", "latest_prod_release"):
            raise HTTPException(422, "versionPolicy 必须是 pinned|latest_sandbox_release|latest_prod_release")
        pinned_agent = target.get("pinnedAgentVersionId")
        if agent_version_policy == "pinned" and not pinned_agent:
            raise HTTPException(422, "pinned 策略必须提供 pinnedAgentVersionId")
        if pinned_agent:
            pav = db.get(AgentVersion, pinned_agent)
            if not pav:
                raise HTTPException(422, "pinnedAgentVersionId 不存在")
            if pav.agent_id != agent_id:
                raise HTTPException(422, "pinnedAgentVersionId 必须属于所选 Agent")
        workflow_id = None
        policy = None
        pinned = None
        if not payload.get("dataAssetId") or not db.get(DataAsset, payload["dataAssetId"]):
            raise HTTPException(422, "dataAssetId 必填且必须存在")
        if not payload.get("dataDefinitionVersionId") or \
                not db.get(DataDefinitionVersion, payload["dataDefinitionVersionId"]):
            raise HTTPException(422, "dataDefinitionVersionId 必填且必须存在")
        # R7-3：字段映射目标来自 Module inputSchema，必填输入必须全部映射
        _validate_input_mapping(agent.module_key, payload.get("inputMapping") or {})
        rule_policy = payload.get("rulePolicy") or ("pinned" if payload.get("resultRuleVersionId") else "pinned")
        if rule_policy not in ("pinned", "follow_latest"):
            raise HTTPException(422, "rulePolicy 必须是 pinned|follow_latest")
        if rule_policy == "pinned":
            if not payload.get("resultRuleVersionId") or not db.get(ResultRuleVersion, payload["resultRuleVersionId"]):
                raise HTTPException(422, "pinned 规则策略必须提供有效 resultRuleVersionId")
        elif not payload.get("resultRuleSetId") or not db.get(ResultRuleSet, payload["resultRuleSetId"]):
            raise HTTPException(422, "follow_latest 策略必须提供 resultRuleSetId")
    else:
        workflow_id = payload.get("workflowId")
        policy = payload.get("workflowVersionPolicy") or "latest_published"
        if policy == "Latest Published":  # legacy 别名
            policy = "latest_published"
        if policy not in ("pinned", "latest_published"):
            raise HTTPException(422, "workflowVersionPolicy 必须是 pinned|latest_published")
        pinned = payload.get("pinnedWorkflowVersionId")
        rule_policy = payload.get("rulePolicy") or ("pinned" if payload.get("resultRuleVersionId") else "pinned")
        wf = _validate_task_config(db, workflow_id, policy, pinned, payload.get("dataAssetId"),
                                   payload.get("resultRuleVersionId"),
                                   payload.get("dataDefinitionVersionId"),
                                   rule_policy=rule_policy,
                                   rule_set_id=payload.get("resultRuleSetId"))
    osrow = latest_quality_schema(db)
    if not osrow:
        raise HTTPException(500, "quality_evaluation 输出 Schema 未配置")
    # SDD 13 PR3：OutputBinding（target_table 时服务端完整预检；缺省 platform_only 兼容存量）
    ob_fields = _apply_output_binding(db, payload, target_type, agent_id,
                                      workflow_id, policy, pinned)
    scope = _norm_scope(payload.get("scope"))
    sampling = _norm_sampling(payload.get("sampling"))
    window = _norm_window(payload.get("dataWindow", "all"))
    mapping = payload.get("inputMapping") or {}
    if not isinstance(mapping, dict):
        raise HTTPException(422, "inputMapping 必须是对象")
    # §11.1：配置校验通过且版本就绪才可 active
    status = "active"
    t = AnalysisTask(name=name, description=payload.get("description", ""),
                     execution_target_type=target_type, agent_id=agent_id,
                     workflow_id=workflow_id, version_policy=policy or "",
                     data_asset_id=payload["dataAssetId"],
                     data_definition_id=payload.get("dataDefinitionId"),
                     scope=_denorm_scope(scope),
                     sampling=_denorm_sampling(sampling),
                     data_window=_denorm_window(window),
                     status=status, created_by=user.get("username", "system"),
                     updated_by=user.get("username", "system"))
    db.add(t)
    db.flush()
    v = AnalysisTaskVersion(task_id=t.id, version_no=1,
                            execution_target_type=target_type, agent_id=agent_id,
                            agent_version_policy=agent_version_policy,
                            pinned_agent_version_id=pinned_agent,
                            workflow_id=workflow_id,
                            workflow_version_policy=policy,
                            pinned_workflow_version_id=pinned,
                            data_asset_id=payload["dataAssetId"],
                            data_definition_version_id=payload.get("dataDefinitionVersionId"),
                            result_rule_version_id=payload.get("resultRuleVersionId"),
                            rule_policy=rule_policy,
                            result_rule_set_id=payload.get("resultRuleSetId"),
                            input_mapping=mapping, scope=scope, sampling=sampling,
                            data_window=window,
                            output_schema_version_id=osrow.id,
                            output_contract_snapshot=ob_fields.get("output_contract_snapshot"),
                            output_mode=ob_fields.get("output_mode", "platform_only"),
                            output_asset_id=ob_fields.get("output_asset_id"),
                            output_definition_version_id=ob_fields.get("output_definition_version_id"),
                            output_write_mode=ob_fields.get("output_write_mode", "upsert"),
                            output_key_fields=ob_fields.get("output_key_fields") or [],
                            output_mapping=ob_fields.get("output_mapping") or {},
                            output_failure_policy=ob_fields.get("output_failure_policy",
                                                                "separate_delivery_status"),
                            created_by=user.get("username", "system"))
    db.add(v)
    db.flush()
    t.current_version_id = v.id
    db.commit()
    return {"id": t.id, "name": t.name, "workflowId": workflow_id, "status": t.status,
            "executionTarget": {"type": target_type, **({"agentId": agent_id,
                                                         "versionPolicy": agent_version_policy,
                                                         "pinnedAgentVersionId": pinned_agent}
                                                        if agent_id else {})},
            "taskVersion": _task_version_dto(db, v)}


def _task_run_dto(tr) -> dict:
    # SDD 13 §8.3：execution 与 delivery 两块；迁移期保留旧平铺计数。
    return {"id": tr.id, "taskId": tr.task_id, "taskVersionId": tr.task_version_id,
            "dataSnapshotId": tr.data_snapshot_id, "trigger": tr.trigger,
            "scheduleFireKey": tr.schedule_fire_key, "idempotencyKey": tr.idempotency_key,
            "status": tr.status, "total": tr.total,
            "succeeded": tr.succeeded_count, "failed": tr.failed_count,
            "skipped": tr.skipped_count, "cancelled": tr.cancelled_count,
            "execution": {"status": tr.status, "total": tr.total,
                          "succeeded": tr.succeeded_count, "failed": tr.failed_count,
                          "skipped": tr.skipped_count, "cancelled": tr.cancelled_count},
            "delivery": {"status": tr.delivery_status,
                         "pending": tr.delivery_pending_count,
                         "succeeded": tr.delivery_succeeded_count,
                         "failed": tr.delivery_failed_count,
                         "targetAssetId": (tr.output_binding_snapshot or {}).get("assetId")},
            # R7-5：冻结快照（AgentVersion/Release/Provider）
            "resolvedAgentVersionId": tr.resolved_agent_version_id,
            "resolvedReleaseId": tr.resolved_release_id,
            "runtimeBinding": tr.runtime_binding_snapshot,
            "errorSummary": tr.error_summary,
            "startedAt": tr.started_at.isoformat() if tr.started_at else None,
            "endedAt": tr.ended_at.isoformat() if tr.ended_at else None,
            "createdAt": tr.created_at.isoformat()}


def _start_or_409(db: Session, tid: str, trigger: str,
                  idempotency_key: str | None = None,
                  schedule_fire_key: str | None = None,
                  window_override: dict | None = None):
    from ..task_runner import TaskStartError, start_task_run
    try:
        return start_task_run(db, tid, trigger=trigger,
                              idempotency_key=idempotency_key,
                              schedule_fire_key=schedule_fire_key,
                              window_override=window_override)
    except TaskStartError as exc:
        raise HTTPException(exc.status_code, exc.args[0])


@router.post("/api/tasks/{tid}/runs", status_code=202)
def start_task_run_api(tid: str, payload: dict | None = None,
                       idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
                       db: Session = Depends(get_db),
                       user: dict = Depends(require_operator)):
    """09 §10.2：启动批次。202 + 异步执行；Idempotency-Key 重复返回原 TaskRun。"""
    tr, resolved = _start_or_409(db, tid, "manual",
                                 idempotency_key=idempotency_key or (payload or {}).get("idempotencyKey"))
    return {"taskRunId": tr.id, "status": tr.status,
            "resolvedVersions": {"taskVersionId": resolved.get("taskVersionId") or tr.task_version_id,
                                 "workflowVersionId": resolved.get("workflowVersionId"),
                                 "ruleVersionId": resolved.get("ruleVersionId"),
                                 "outputSchemaVersionId": resolved.get("outputSchemaVersionId")},
            "dataSnapshotId": resolved.get("dataSnapshotId") or tr.data_snapshot_id}


@router.post("/api/tasks/{tid}/batch-run", status_code=202)
def batch_run(tid: str, payload: dict | None = None, db: Session = Depends(get_db),
              user: dict = Depends(require_operator)):
    """过渡入口（09-P0 前契约）：内部改走 TaskRun 新链路；B4 前端切到 /runs。"""
    tr, resolved = _start_or_409(db, tid, "manual",
                                 idempotency_key=(payload or {}).get("idempotencyKey"))
    return {"taskRunId": tr.id, "status": tr.status}


@router.post("/api/tasks/{tid}/backfill", status_code=202)
def backfill_task(tid: str, payload: dict, db: Session = Depends(get_db),
                  user: dict = Depends(require_operator)):
    """09 P1-01：历史窗口回填——按指定 [start, end] 窗口补跑批次，不影响常规窗口。"""
    window = (payload or {}).get("window") or {}
    if not (window.get("start") or window.get("end")):
        raise HTTPException(422, "回填需提供 window.start / window.end")
    tr, resolved = _start_or_409(db, tid, "backfill",
                                 window_override={"mode": "fixed",
                                                  "start": window.get("start"),
                                                  "end": window.get("end")})
    return {"taskRunId": tr.id, "status": tr.status,
            "window": {"start": window.get("start"), "end": window.get("end")},
            "dataSnapshotId": resolved.get("dataSnapshotId") or tr.data_snapshot_id}


@router.get("/api/tasks/{tid}/schedules")
def list_task_schedules(tid: str, db: Session = Depends(get_db)):
    """09 P1-01：任务级调度列表。"""
    t = db.get(AnalysisTask, tid)
    if not t:
        raise HTTPException(404, "任务不存在")
    rows = db.query(Schedule).filter_by(task_id=tid).order_by(Schedule.created_at.desc()).all()
    return {"items": [{"id": s.id, "name": s.name, "cron": s.cron_expr, "timezone": s.timezone,
                       "enabled": s.enabled,
                       "nextRunAt": s.next_run_at.isoformat() if s.next_run_at else None,
                       "lastRanAt": s.last_ran_at.isoformat() if s.last_ran_at else None,
                       "failedCount": s.failed_count} for s in rows]}


@router.get("/api/tasks/{tid}/runs")
def list_task_runs(tid: str, page: int = 1, pageSize: int = 50, db: Session = Depends(get_db)):
    """09 P1-10：真分页。"""
    from ..models import TaskRun
    t = db.get(AnalysisTask, tid)
    if not t:
        raise HTTPException(404, "任务不存在")
    q = db.query(TaskRun).filter_by(task_id=tid).order_by(TaskRun.created_at.desc())
    total = q.count()
    rows = q.offset((page - 1) * pageSize).limit(pageSize).all()
    return {"items": [_task_run_dto(x) for x in rows],
            "total": total, "page": page, "pageSize": pageSize}


@router.get("/api/task-runs/{trid}")
def get_task_run(trid: str, db: Session = Depends(get_db)):
    from ..models import TaskRun
    tr = db.get(TaskRun, trid)
    if not tr:
        raise HTTPException(404, "TaskRun 不存在")
    return _task_run_dto(tr)


def _run_dto(r, delivery=None) -> dict:
    # SDD 13 §8.4：通用 Run 项 + delivery 摘要；禁止返回业务专用投影。
    return {"id": r.id, "status": r.status, "interactionRef": r.interaction_ref,
            "attempt": r.attempt, "workflowVersionId": r.workflow_version_id,
            "taskRunId": r.task_run_id, "taskId": r.task_id,
            # R7-6：Run 行携带 Agent/Provider 冻结信息，供详情与跳转
            "agentId": r.agent_id, "agentVersionId": r.agent_version_id,
            "runtimeProviderId": r.runtime_provider_id,
            "originRunId": r.origin_run_id,
            "outputAvailable": r.output is not None,
            "error": r.error,
            "startedAt": r.started_at.isoformat() if r.started_at else None,
            "endedAt": r.ended_at.isoformat() if r.ended_at else None,
            "durationMs": r.duration_ms,
            "delivery": {"id": delivery.id, "status": delivery.status,
                         "attempts": delivery.attempts,
                         "targetReference": delivery.target_reference,
                         "error": delivery.error} if delivery else None}


_RUN_SORT_WHITELIST = {"createdAt", "-createdAt", "durationMs", "-durationMs"}


@router.get("/api/task-runs/{trid}/runs")
def list_task_run_runs(trid: str, page: int = 1, pageSize: int = 50, status: str = "",
                       deliveryStatus: str = "", q: str = "", attempt: int | None = None,
                       sort: str = "createdAt", db: Session = Depends(get_db)):
    """SDD 13 §8.4：服务端分页+筛选；1000 条批次不得一次性加载。"""
    from ..models import Run, TaskRun
    tr = db.get(TaskRun, trid)
    if not tr:
        raise HTTPException(404, "TaskRun 不存在")
    pageSize = min(max(pageSize, 1), 200)
    if sort not in _RUN_SORT_WHITELIST:
        raise HTTPException(422, f"sort 必须是 {sorted(_RUN_SORT_WHITELIST)} 之一")
    query = db.query(Run).filter(Run.task_run_id == trid)
    if status:
        query = query.filter(Run.status == status)
    if deliveryStatus:
        query = query.filter(Run.id.in_(
            db.query(ResultDelivery.run_id).filter(
                ResultDelivery.status == deliveryStatus)))
    if q:
        query = query.filter(Run.interaction_ref.ilike(f"%{q}%"))
    if attempt is not None:
        query = query.filter(Run.attempt == attempt)
    order = {"createdAt": Run.created_at.asc(), "-createdAt": Run.created_at.desc(),
             "durationMs": Run.duration_ms.asc(), "-durationMs": Run.duration_ms.desc()}[sort]
    total = query.count()
    rows = query.order_by(order).offset((page - 1) * pageSize).limit(pageSize).all()
    dels = {d.run_id: d for d in db.query(ResultDelivery).filter(
        ResultDelivery.run_id.in_([r.id for r in rows] or ["-"])).all()}
    schema_ref = (tr.output_binding_snapshot or {}).get("outputSchemaRef")
    items = []
    for r in rows:
        dto = _run_dto(r, dels.get(r.id))
        dto["outputSchemaRef"] = schema_ref
        items.append(dto)
    return {"items": items, "total": total, "page": page, "pageSize": pageSize}


@router.get("/api/task-runs/{trid}/snapshot")
def get_task_run_snapshot(trid: str, db: Session = Depends(get_db)):
    """09 §9.3：批次数据快照（源/窗口/范围/抽样/水位/行数/指纹）。"""
    from ..models import DataSnapshot, TaskRun
    tr = db.get(TaskRun, trid)
    if not tr:
        raise HTTPException(404, "TaskRun 不存在")
    snap = db.get(DataSnapshot, tr.data_snapshot_id) if tr.data_snapshot_id else None
    return {"taskRunId": tr.id, "taskId": tr.task_id,
            "dataSnapshot": None if not snap else {
                "id": snap.id, "assetId": snap.asset_id, "assetRevision": snap.asset_revision,
                "definitionVersionId": snap.definition_version_id,
                "locator": snap.locator, "resolvedWindow": snap.resolved_window,
                "resolvedScope": snap.resolved_scope, "resolvedSampling": snap.resolved_sampling,
                "checkpoint": snap.checkpoint, "expectedCount": snap.expected_count,
                "readCount": snap.read_count, "checksum": snap.checksum,
                "createdAt": snap.created_at.isoformat()}}


@router.get("/api/task-runs/{trid}/results")
def list_task_run_results(trid: str, db: Session = Depends(get_db)):
    """SDD 13 PR6（Phase C）：Task 批次 API 不再查询 QualityResult 判断输出情况；
    本端点迁移为通用 deliveries 兼容面（deprecated），领域结果走 /api/quality-results。"""
    if not db.get(TaskRun, trid):
        raise HTTPException(404, "TaskRun 不存在")
    rows = db.query(ResultDelivery).filter_by(task_run_id=trid)\
        .order_by(ResultDelivery.created_at.asc()).all()
    return {"deprecated": True,
            "hint": "领域结果请查询 /api/quality-results 等领域 API",
            "items": [{"id": d.id, "runId": d.run_id, "interactionRef": d.interaction_ref,
                       "taskId": d.task_id, "taskRunId": d.task_run_id,
                       "status": d.status, "attempts": d.attempts,
                       "targetReference": d.target_reference,
                       "error": d.error} for d in rows]}


@router.post("/api/tasks/{tid}/runs/{trid}/retry-failed", status_code=202)
def retry_failed_interactions(tid: str, trid: str, db: Session = Depends(get_db),
                              _user: dict = Depends(require_operator)):
    """09 P1-06：失败交互行级重试——为每条失败 Run 建新 attempt（谱系=origin_run_id，
    INV-07 不覆盖原记录），异步入队。无失败项时幂等返回 0。"""
    from ..models import JobQueue, Run, TaskRun
    tr = db.get(TaskRun, trid)
    if not tr or tr.task_id != tid:
        raise HTTPException(404, "TaskRun 不存在")
    if tr.status not in ("partial", "failed"):
        raise HTTPException(409, f"仅 partial/failed 批次可重试（当前 {tr.status}）")
    n_failed = db.query(Run).filter(Run.task_run_id == trid, Run.status == "failed").count()
    if n_failed == 0:
        return {"retried": 0, "taskRunId": trid}  # 幂等：无失败项不入队
    # 09 P1-06（审计：父批次永久 partial）：入队统一重试任务，
    # 重跑失败交互后重汇父批次终态
    db.add(JobQueue(type="task-run-retry", payload={"task_run_id": trid}))
    db.commit()
    return {"retried": n_failed, "taskRunId": trid}


@router.post("/api/result-deliveries/{did}/retry", status_code=202)
def retry_delivery_api(did: str, db: Session = Depends(get_db),
                       user: dict = Depends(require_operator)):
    """SDD 13 §8.6 重新投递：不调用模型；仅 failed/dead_letter；payload 哈希不变。"""
    from ..delivery import retry_delivery
    try:
        return retry_delivery(db, did, user.get("username", "operator"))
    except LookupError:
        raise HTTPException(404, "ResultDelivery 不存在")
    except ValueError as exc:
        raise HTTPException(409, str(exc))


@router.post("/api/task-runs/{trid}/retry-failed-deliveries", status_code=202)
def retry_failed_deliveries_api(trid: str, db: Session = Depends(get_db),
                                user: dict = Depends(require_operator)):
    """SDD 13 §8.6 批量重试投递：返回 accepted/skipped 数量与原因。"""
    from ..delivery import retry_failed_deliveries
    from ..models import TaskRun
    if not db.get(TaskRun, trid):
        raise HTTPException(404, "TaskRun 不存在")
    return retry_failed_deliveries(db, trid, user.get("username", "operator"))


@router.get("/api/tasks/{tid}")
def get_task(tid: str, db: Session = Depends(get_db),
             user: dict = Depends(require_role())):
    """D-5 + 09 §10.1：任务详情含当前 TaskVersion 快照。P2-02：team 范围越权 403。"""
    t = db.get(AnalysisTask, tid)
    if not t:
        raise HTTPException(404, "任务不存在")
    assert_task_readable(db, user, t)
    v = db.get(AnalysisTaskVersion, t.current_version_id) if t.current_version_id else None
    return {"id": t.id, "name": t.name, "description": t.description,
            "workflowId": t.workflow_id,
            "workflowVersionPolicy": (v.workflow_version_policy if v else t.version_policy),
            "dataAssetId": t.data_asset_id, "dataDefinitionId": t.data_definition_id,
            "scope": v.scope if v else t.scope,
            "sampling": v.sampling if v else t.sampling,
            "dataWindow": v.data_window if v else t.data_window,
            "status": t.status,
            "taskVersion": _task_version_dto(db, v) if v else None}


@router.get("/api/tasks/{tid}/versions")
def list_task_versions(tid: str, db: Session = Depends(get_db)):
    t = db.get(AnalysisTask, tid)
    if not t:
        raise HTTPException(404, "任务不存在")
    vs = db.execute(select(AnalysisTaskVersion)
                    .where(AnalysisTaskVersion.task_id == tid)
                    .order_by(AnalysisTaskVersion.version_no.desc())).scalars().all()
    return {"items": [_task_version_dto(db, v) for v in vs]}


def _update_agent_task(db: Session, t: AnalysisTask, cur, payload: dict, user: dict):
    """R7-1：编辑 Agent 任务=生成新 TaskVersion，保留 Agent 执行目标（不误改 Workflow）。"""
    from ..models import Agent, AgentVersion
    from sqlalchemy import func
    tgt = payload.get("executionTarget") or {}
    agent_id = tgt.get("agentId") or (cur.agent_id if cur else t.agent_id)
    agent = db.get(Agent, agent_id) if agent_id else None
    if not agent or not agent.module_key:
        raise HTTPException(422, "executionTarget.agentId 必须指向领域 Module Agent")
    version_policy = (tgt.get("versionPolicy")
                      or (cur.agent_version_policy if cur else "latest_sandbox_release"))
    if version_policy not in ("pinned", "latest_sandbox_release", "latest_prod_release"):
        raise HTTPException(422, "versionPolicy 必须是 pinned|latest_sandbox_release|latest_prod_release")
    pinned = (tgt.get("pinnedAgentVersionId") if "pinnedAgentVersionId" in tgt
              else (cur.pinned_agent_version_id if cur else None))
    if version_policy == "pinned" and not pinned:
        raise HTTPException(422, "pinned 策略必须提供 pinnedAgentVersionId")
    if pinned:
        pav = db.get(AgentVersion, pinned)
        if not pav or pav.agent_id != agent_id:
            raise HTTPException(422, "pinnedAgentVersionId 必须属于所选 Agent")
    if payload.get("name") is not None:
        t.name = str(payload["name"]).strip() or t.name
    if payload.get("description") is not None:
        t.description = payload["description"]
    asset_id = payload.get("dataAssetId") or (cur.data_asset_id if cur else t.data_asset_id)
    if not db.get(DataAsset, asset_id):
        raise HTTPException(422, "dataAssetId 必填且必须存在")
    def_version_id = (payload.get("dataDefinitionVersionId")
                      if "dataDefinitionVersionId" in payload else (cur.data_definition_version_id if cur else None))
    if not db.get(DataDefinitionVersion, def_version_id):
        raise HTTPException(422, "dataDefinitionVersionId 必填且必须存在")
    rule_policy = (payload.get("rulePolicy") if "rulePolicy" in payload
                   else (cur.rule_policy if cur else "pinned"))
    rule_version_id = (payload.get("resultRuleVersionId") if "resultRuleVersionId" in payload
                       else (cur.result_rule_version_id if cur else None))
    rule_set_id = (payload.get("resultRuleSetId") if "resultRuleSetId" in payload
                   else (cur.result_rule_set_id if cur else None))
    if rule_policy == "pinned" and not (rule_version_id and db.get(ResultRuleVersion, rule_version_id)):
        raise HTTPException(422, "pinned 规则策略必须提供有效 resultRuleVersionId")
    mapping = (payload.get("inputMapping") if payload.get("inputMapping") is not None
               else ((cur.input_mapping or {}) if cur else {}))
    if not isinstance(mapping, dict):
        raise HTTPException(422, "inputMapping 必须是对象")
    _validate_input_mapping(agent.module_key, mapping)
    scope = _norm_scope(payload.get("scope")) if payload.get("scope") is not None else ((cur.scope if cur else None) or {"op": "and", "conditions": []})
    sampling = _norm_sampling(payload.get("sampling")) if payload.get("sampling") is not None else ((cur.sampling if cur else None) or {"mode": "all"})
    window = _norm_window(payload.get("dataWindow")) if payload.get("dataWindow") is not None else ((cur.data_window if cur else None) or {"mode": "all"})
    if "outputBinding" in payload:
        ob_fields = _apply_output_binding(db, {"outputBinding": payload["outputBinding"],
                                               "dataAssetId": asset_id},
                                          "agent", agent_id, None, version_policy, pinned)
    else:
        ob_fields = _carry_binding(cur)
    version_no = (db.query(func.max(AnalysisTaskVersion.version_no))
                  .filter_by(task_id=t.id).scalar() or 0) + 1
    v = AnalysisTaskVersion(task_id=t.id, version_no=version_no,
                            execution_target_type="agent", agent_id=agent_id,
                            agent_version_policy=version_policy,
                            pinned_agent_version_id=pinned, workflow_id=None,
                            data_asset_id=asset_id,
                            data_definition_version_id=def_version_id,
                            result_rule_version_id=rule_version_id, rule_policy=rule_policy,
                            result_rule_set_id=rule_set_id, input_mapping=mapping,
                            scope=scope, sampling=sampling, data_window=window,
                            output_schema_version_id=(cur.output_schema_version_id if cur else None)
                            or (latest_quality_schema(db).id if latest_quality_schema(db) else None),
                            output_contract_snapshot=ob_fields.get("output_contract_snapshot"),
                            output_mode=ob_fields.get("output_mode", "platform_only"),
                            output_asset_id=ob_fields.get("output_asset_id"),
                            output_definition_version_id=ob_fields.get("output_definition_version_id"),
                            output_write_mode=ob_fields.get("output_write_mode", "upsert"),
                            output_key_fields=ob_fields.get("output_key_fields") or [],
                            output_mapping=ob_fields.get("output_mapping") or {},
                            output_failure_policy=ob_fields.get("output_failure_policy",
                                                                "separate_delivery_status"),
                            note=payload.get("note", ""), created_by=user.get("username", "system"))
    db.add(v)
    db.flush()
    t.current_version_id = v.id
    t.execution_target_type = "agent"
    t.agent_id = agent_id
    t.workflow_id = None
    t.data_asset_id = asset_id
    t.scope = _denorm_scope(scope)
    t.sampling = _denorm_sampling(sampling)
    t.data_window = _denorm_window(window)
    t.updated_by = user.get("username", "system")
    db.commit()
    return {"id": t.id, "name": t.name, "status": t.status,
            "taskVersion": _task_version_dto(db, v)}


@router.put("/api/tasks/{tid}")
def update_task(tid: str, payload: dict, db: Session = Depends(get_db),
                user: dict = Depends(require_operator)):
    """09 §9.2：编辑=生成新的不可变 TaskVersion（历史版本不受影响）。"""
    t = db.get(AnalysisTask, tid)
    if not t:
        raise HTTPException(404, "任务不存在")
    if t.status == "archived":
        raise HTTPException(422, "已归档任务不可编辑")
    cur = db.get(AnalysisTaskVersion, t.current_version_id) if t.current_version_id else None

    def _cur(attr: str, default=None):
        return (getattr(cur, attr) if cur is not None else default)

    # R7-1：编辑保真——Agent 任务不能被误改成 Workflow；沿用当前执行目标除非显式提供。
    target_type = ((payload.get("executionTarget") or {}).get("type")
                   or (cur.execution_target_type if cur else None)
                   or t.execution_target_type or "workflow")
    if target_type == "agent":
        return _update_agent_task(db, t, cur, payload, user)

    if payload.get("name") is not None:
        t.name = str(payload["name"]).strip() or t.name
    if payload.get("description") is not None:
        t.description = payload["description"]
    workflow_id = payload.get("workflowId") or (cur.workflow_id if cur else t.workflow_id)
    policy = payload.get("workflowVersionPolicy") or _cur("workflow_version_policy", "latest_published")
    pinned = (payload.get("pinnedWorkflowVersionId")
              if "pinnedWorkflowVersionId" in payload else _cur("pinned_workflow_version_id"))
    asset_id = payload.get("dataAssetId") or _cur("data_asset_id", t.data_asset_id)
    rule_version_id = (payload.get("resultRuleVersionId")
                       if "resultRuleVersionId" in payload else _cur("result_rule_version_id"))
    def_version_id = (payload.get("dataDefinitionVersionId")
                      if "dataDefinitionVersionId" in payload else _cur("data_definition_version_id"))
    rule_policy = (payload.get("rulePolicy")
                   if "rulePolicy" in payload else _cur("rule_policy", "pinned"))
    rule_set_id = (payload.get("resultRuleSetId")
                   if "resultRuleSetId" in payload else _cur("result_rule_set_id"))
    _validate_task_config(db, workflow_id, policy, pinned, asset_id, rule_version_id,
                          def_version_id, rule_policy=rule_policy, rule_set_id=rule_set_id)
    scope = _norm_scope(payload.get("scope")) if payload.get("scope") is not None else (_cur("scope") or {"op": "and", "conditions": []})
    sampling = _norm_sampling(payload.get("sampling")) if payload.get("sampling") is not None else (_cur("sampling") or {"mode": "all"})
    window = _norm_window(payload.get("dataWindow")) if payload.get("dataWindow") is not None else (_cur("data_window") or {"mode": "all"})
    mapping = payload.get("inputMapping") if payload.get("inputMapping") is not None else (_cur("input_mapping") or {})
    if not isinstance(mapping, dict):
        raise HTTPException(422, "inputMapping 必须是对象")
    if "outputBinding" in payload:
        ob_fields = _apply_output_binding(db, {"outputBinding": payload["outputBinding"],
                                               "dataAssetId": asset_id},
                                          "workflow", None, workflow_id, policy, pinned)
    else:
        ob_fields = _carry_binding(cur)
    from sqlalchemy import func
    version_no = (db.query(func.max(AnalysisTaskVersion.version_no))
                  .filter_by(task_id=tid).scalar() or 0) + 1
    v = AnalysisTaskVersion(task_id=tid, version_no=version_no, workflow_id=workflow_id,
                            workflow_version_policy=policy,
                            pinned_workflow_version_id=pinned,
                            data_asset_id=asset_id,
                            data_definition_version_id=def_version_id,
                            result_rule_version_id=rule_version_id,
                            rule_policy=rule_policy,
                            result_rule_set_id=rule_set_id,
                            input_mapping=mapping, scope=scope, sampling=sampling,
                            data_window=window,
                            output_schema_version_id=_cur("output_schema_version_id") or (latest_quality_schema(db).id if latest_quality_schema(db) else None),
                            output_contract_snapshot=ob_fields.get("output_contract_snapshot"),
                            output_mode=ob_fields.get("output_mode", "platform_only"),
                            output_asset_id=ob_fields.get("output_asset_id"),
                            output_definition_version_id=ob_fields.get("output_definition_version_id"),
                            output_write_mode=ob_fields.get("output_write_mode", "upsert"),
                            output_key_fields=ob_fields.get("output_key_fields") or [],
                            output_mapping=ob_fields.get("output_mapping") or {},
                            output_failure_policy=ob_fields.get("output_failure_policy",
                                                                "separate_delivery_status"),
                            note=payload.get("note", ""), created_by=user.get("username", "system"))
    db.add(v)
    db.flush()
    t.current_version_id = v.id
    t.workflow_id = workflow_id
    t.version_policy = policy
    t.data_asset_id = asset_id
    t.scope = _denorm_scope(scope)
    t.sampling = _denorm_sampling(sampling)
    t.data_window = _denorm_window(window)
    t.updated_by = user.get("username", "system")
    db.commit()
    return {"id": t.id, "name": t.name, "status": t.status,
            "taskVersion": _task_version_dto(db, v)}


@router.post("/api/tasks/output-binding/validate")
def validate_output_binding(payload: dict, db: Session = Depends(get_db),
                            _user: dict = Depends(require_operator)):
    """SDD 13 §8.2：OutputBinding 预检——返回完整问题列表与 resolved 摘要。"""
    target = payload.get("executionTarget") or {}
    target_type = target.get("type") or "workflow"
    try:
        binding = normalize_binding(payload.get("outputBinding") or {})
    except MappingExpressionError as exc:
        return {"valid": False,
                "issues": [{"code": exc.code, "path": ["outputBinding"], "message": exc.message}],
                "resolved": None}
    if binding["mode"] != "target_table":
        return {"valid": True, "issues": [], "resolved": None}
    schema, ref, sha, _src = _resolve_output_contract(
        db, target_type, target.get("agentId"), target.get("workflowId"),
        target.get("versionPolicy"), target.get("pinnedAgentVersionId")
        or target.get("pinnedWorkflowVersionId"))
    rep = validate_for_edit(db, binding, output_schema=schema, output_schema_ref=ref,
                            input_asset_id=payload.get("inputAssetId"))
    return rep


@router.post("/api/tasks/{tid}/status")
def set_task_status(tid: str, payload: dict, db: Session = Depends(get_db),
                    user: dict = Depends(require_operator)):
    """09 §11.1：draft->active<->paused->archived。兼容旧大小写取值。"""
    t = db.get(AnalysisTask, tid)
    if not t:
        raise HTTPException(404, "任务不存在")
    status = str((payload or {}).get("status") or "").lower()
    aliases = {"active": "active", "paused": "paused", "draft": "draft",
               "archived": "archived"}
    if status not in aliases:
        raise HTTPException(422, "status 必须是 active|paused|draft|archived")
    if t.status == "archived":
        raise HTTPException(422, "已归档任务不可变更状态")
    # SDD 13 §6.2/§18：首次激活（draft→active）fail-closed 要求 target_table 绑定；
    # paused→active 为恢复语义，沿用启动时探测（start_task_run 闸门）。
    if status == "active" and t.status == "draft":
        tv = db.get(AnalysisTaskVersion, t.current_version_id) if t.current_version_id else None
        if tv is None or (tv.output_mode or "platform_only") != "target_table":
            raise HTTPException(422, "生产任务激活要求 outputBinding.mode=target_table"
                                     "（sandbox/manual 可 platform_only；SDD 13 §18）")
    t.status = aliases[status]
    db.commit()
    return {"id": t.id, "status": t.status}


@router.post("/api/tasks/{tid}/schedule")
def task_schedule(tid: str, payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    from ..runner import compute_next
    t = db.get(AnalysisTask, tid)
    if not t:
        raise HTTPException(404, "任务不存在")
    s = Schedule(name=f"{t.name}-schedule", task_id=t.id, workflow_id=t.workflow_id,
                 cron_expr=payload["cron"], timezone=payload.get("timezone", "Asia/Shanghai"),
                 enabled=payload.get("enabled", True))
    s.next_run_at = compute_next(s.cron_expr, s.timezone)
    db.add(s)
    db.commit()
    return {"id": s.id, "nextRunAt": s.next_run_at.isoformat()}
