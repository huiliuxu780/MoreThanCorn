"""质检业务层深化：Result Rules 引擎 / Review 流 / Data Asset 批量 / Task×Schedule。

09-SDD P0-B1：Task 版本化（TaskVersion 不可变）、ResultRuleVersion 不可变、
发布不全库重算（P0-07）、ReviewRevision 只追加（INV-08）。"""
import copy
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import require_operator, require_reviewer
from ..db import get_db
from ..models import (AnalysisTask, AnalysisTaskVersion, DataAsset,
                      DataDefinitionVersion, QualityResult, ResultRuleSet,
                      ResultRuleVersion, ReviewRevision, Schedule, Workflow,
                      WorkflowVersion)
from ..output_schema import latest_quality_schema

router = APIRouter(tags=["business"])

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
def list_rules(db: Session = Depends(get_db)):
    rows = db.query(ResultRuleSet).order_by(ResultRuleSet.updated_at.desc()).all()
    return {"items": [{"id": r.id, "name": r.name, "description": r.description,
                       "agentId": r.agent_id, "currentVersion": f"V{r.version}",
                       "versionStatus": "Published" if r.status == "published" else "Draft",
                       "evaluationPriority": r.evaluation_priority,
                       "updatedAt": r.updated_at.isoformat()} for r in rows]}


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
    reviewer = payload.get("reviewer") or user.get("username", "reviewer")
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
    """pool=pending：待复核池（AI/REOPENED 且未被领取）；pool=mine：指定复核人已领取。"""
    q = db.query(QualityResult)
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
    if qr.review_status not in _REVIEW_PENDING:
        raise HTTPException(409, f"当前状态 {qr.review_status} 不可领取")
    if qr.review_claimed_by and qr.review_claimed_by != (payload.get("reviewer") or user.get("username")):
        raise HTTPException(409, f"已被 {qr.review_claimed_by} 领取")
    reviewer = payload.get("reviewer") or user.get("username", "reviewer")
    qr.review_status = "IN_REVIEW"
    qr.review_claimed_by = reviewer
    qr.review_claimed_at = datetime.now(timezone.utc)
    db.commit()
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
def list_assets(db: Session = Depends(get_db)):
    rows = db.query(DataAsset).all()
    return {"items": [{"id": a.id, "name": a.name, "description": a.description,
                       "source": a.source, "recordMeaning": a.record_meaning,
                       "recordIdField": a.record_id_field, "timeField": a.time_field,
                       "timeFieldLabel": a.time_field, "lifecycle": a.lifecycle,
                       "health": a.health, "currentRevision": a.revision,
                       "updatedAt": a.updated_at.isoformat()} for a in rows]}


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


def _task_version_dto(db: Session, v: AnalysisTaskVersion) -> dict:
    os_label = ""
    if v.output_schema_version_id:
        from ..models import QualityOutputSchema
        row = db.get(QualityOutputSchema, v.output_schema_version_id)
        if row:
            os_label = f"{row.key}@v{row.version_no}"
    return {"id": v.id, "versionNo": v.version_no,
            "workflowId": v.workflow_id,
            "workflowVersionPolicy": v.workflow_version_policy,
            "pinnedWorkflowVersionId": v.pinned_workflow_version_id,
            "dataAssetId": v.data_asset_id,
            "dataDefinitionVersionId": v.data_definition_version_id,
            "resultRuleVersionId": v.result_rule_version_id,
            "rulePolicy": v.rule_policy,
            "inputMapping": v.input_mapping or {},
            "scope": v.scope or {},
            "sampling": v.sampling or {},
            "dataWindow": v.data_window or {},
            "outputSchemaVersion": os_label,
            "outputSchemaVersionId": v.output_schema_version_id,
            "note": v.note, "createdBy": v.created_by,
            "createdAt": v.created_at.isoformat()}


def _validate_task_config(db: Session, workflow_id: str, policy: str,
                          pinned: str | None, asset_id: str | None,
                          rule_version_id: str | None, definition_version_id: str | None,
                          rule_policy: str = "pinned"):
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
    return wf


@router.get("/api/tasks")
def list_tasks(db: Session = Depends(get_db)):
    rows = db.query(AnalysisTask).all()
    items = []
    for t in rows:
        v = db.get(AnalysisTaskVersion, t.current_version_id) if t.current_version_id else None
        items.append({"id": t.id, "name": t.name, "description": t.description,
                      "workflowId": t.workflow_id,
                      "workflowVersionPolicy": (v.workflow_version_policy if v else t.version_policy),
                      "dataAssetId": t.data_asset_id,
                      "dataDefinitionId": t.data_definition_id,
                      "scope": v.scope if v else t.scope,
                      "sampling": v.sampling if v else t.sampling,
                      "schedule": v.data_window if v else t.data_window,
                      "dataWindow": v.data_window if v else t.data_window,
                      "status": t.status,
                      "currentVersionNo": v.version_no if v else None})
    return {"items": items}


@router.post("/api/tasks", status_code=201)
def create_task(payload: dict, db: Session = Depends(get_db),
                user: dict = Depends(require_operator)):
    """09 §10.1：创建即生成 TaskVersion v1；返回已解析快照（确认页必须用它渲染）。"""
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "任务名称必填")
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
                               rule_policy=rule_policy)
    osrow = latest_quality_schema(db)
    if not osrow:
        raise HTTPException(500, "quality_evaluation 输出 Schema 未配置")
    scope = _norm_scope(payload.get("scope"))
    sampling = _norm_sampling(payload.get("sampling"))
    window = _norm_window(payload.get("dataWindow", "all"))
    mapping = payload.get("inputMapping") or {}
    if not isinstance(mapping, dict):
        raise HTTPException(422, "inputMapping 必须是对象")
    # §11.1：配置校验通过且版本就绪才可 active
    status = "active"
    t = AnalysisTask(name=name, description=payload.get("description", ""),
                     workflow_id=workflow_id, version_policy=policy,
                     data_asset_id=payload["dataAssetId"],
                     data_definition_id=payload.get("dataDefinitionId"),
                     scope=_denorm_scope(scope),
                     sampling=_denorm_sampling(sampling),
                     data_window=_denorm_window(window),
                     status=status, created_by=user.get("username", "system"),
                     updated_by=user.get("username", "system"))
    db.add(t)
    db.flush()
    v = AnalysisTaskVersion(task_id=t.id, version_no=1, workflow_id=workflow_id,
                            workflow_version_policy=policy,
                            pinned_workflow_version_id=pinned,
                            data_asset_id=payload["dataAssetId"],
                            data_definition_version_id=payload.get("dataDefinitionVersionId"),
                            result_rule_version_id=payload.get("resultRuleVersionId"),
                            rule_policy=rule_policy,
                            input_mapping=mapping, scope=scope, sampling=sampling,
                            data_window=window,
                            output_schema_version_id=osrow.id,
                            created_by=user.get("username", "system"))
    db.add(v)
    db.flush()
    t.current_version_id = v.id
    db.commit()
    return {"id": t.id, "name": t.name, "workflowId": workflow_id, "status": t.status,
            "taskVersion": _task_version_dto(db, v)}


def _task_run_dto(tr) -> dict:
    return {"id": tr.id, "taskId": tr.task_id, "taskVersionId": tr.task_version_id,
            "dataSnapshotId": tr.data_snapshot_id, "trigger": tr.trigger,
            "scheduleFireKey": tr.schedule_fire_key, "idempotencyKey": tr.idempotency_key,
            "status": tr.status, "total": tr.total,
            "succeeded": tr.succeeded_count, "failed": tr.failed_count,
            "skipped": tr.skipped_count, "cancelled": tr.cancelled_count,
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
def list_task_runs(tid: str, db: Session = Depends(get_db)):
    from ..models import TaskRun
    t = db.get(AnalysisTask, tid)
    if not t:
        raise HTTPException(404, "任务不存在")
    rows = db.query(TaskRun).filter_by(task_id=tid)\
        .order_by(TaskRun.created_at.desc()).all()
    return {"items": [_task_run_dto(x) for x in rows]}


@router.get("/api/task-runs/{trid}")
def get_task_run(trid: str, db: Session = Depends(get_db)):
    from ..models import TaskRun
    tr = db.get(TaskRun, trid)
    if not tr:
        raise HTTPException(404, "TaskRun 不存在")
    return _task_run_dto(tr)


def _run_dto(r) -> dict:
    return {"id": r.id, "status": r.status, "interactionRef": r.interaction_ref,
            "attempt": r.attempt, "workflowVersionId": r.workflow_version_id,
            "taskRunId": r.task_run_id, "taskId": r.task_id,
            "error": r.error,
            "startedAt": r.started_at.isoformat() if r.started_at else None,
            "endedAt": r.ended_at.isoformat() if r.ended_at else None,
            "durationMs": r.duration_ms}


@router.get("/api/task-runs/{trid}/runs")
def list_task_run_runs(trid: str, db: Session = Depends(get_db)):
    from ..models import Run, TaskRun
    if not db.get(TaskRun, trid):
        raise HTTPException(404, "TaskRun 不存在")
    rows = db.query(Run).filter_by(task_run_id=trid).order_by(Run.created_at.asc()).all()
    return {"items": [_run_dto(r) for r in rows]}


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
    from ..models import QualityResult, TaskRun
    if not db.get(TaskRun, trid):
        raise HTTPException(404, "TaskRun 不存在")
    rows = db.query(QualityResult).filter_by(task_run_id=trid)\
        .order_by(QualityResult.created_at.asc()).all()
    return {"items": [{"id": q.id, "runId": q.run_id, "interactionRef": q.interaction_ref,
                       "taskId": q.task_id, "taskRunId": q.task_run_id,
                       "workflowVersionId": q.workflow_version_id,
                       "ruleVersionId": q.rule_version_id,
                       "outputSchemaVersionId": q.output_schema_version_id,
                       "score": q.score, "risk": q.risk, "review": q.review_status,
                       "isLatest": q.is_latest} for q in rows]}


@router.post("/api/tasks/{tid}/runs/{trid}/retry-failed", status_code=202)
def retry_failed_interactions(tid: str, trid: str, db: Session = Depends(get_db),
                              _user: dict = Depends(require_operator)):
    """09 P1-06：失败交互行级重试——为每条失败 Run 建新 attempt（谱系=origin_run_id，
    INV-07 不覆盖原记录），异步入队。无失败项时幂等返回 0。"""
    from ..models import JobQueue, Run, TaskRun
    tr = db.get(TaskRun, trid)
    if not tr or tr.task_id != tid:
        raise HTTPException(404, "TaskRun 不存在")
    failed = db.query(Run).filter(Run.task_run_id == trid, Run.status == "failed").all()
    new_ids = []
    for fr in failed:
        nr = Run(workflow_id=fr.workflow_id, workflow_version_id=fr.workflow_version_id,
                 trigger="batch", status="queued", input=fr.input,
                 task_run_id=trid, task_id=tid, task_version_id=fr.task_version_id,
                 interaction_ref=fr.interaction_ref, attempt=(fr.attempt or 1) + 1,
                 origin_run_id=fr.id, definition_version_id=fr.definition_version_id,
                 rule_version_id=fr.rule_version_id, data_snapshot_id=fr.data_snapshot_id)
        db.add(nr)
        db.flush()
        db.add(JobQueue(type="workflow-execution", payload={"run_id": nr.id}))
        new_ids.append(nr.id)
    db.commit()
    return {"retried": len(new_ids), "newRunIds": new_ids}


@router.get("/api/tasks/{tid}")
def get_task(tid: str, db: Session = Depends(get_db)):
    """D-5 + 09 §10.1：任务详情含当前 TaskVersion 快照。"""
    t = db.get(AnalysisTask, tid)
    if not t:
        raise HTTPException(404, "任务不存在")
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
    _validate_task_config(db, workflow_id, policy, pinned, asset_id, rule_version_id,
                          def_version_id, rule_policy=rule_policy)
    scope = _norm_scope(payload.get("scope")) if payload.get("scope") is not None else (_cur("scope") or {"op": "and", "conditions": []})
    sampling = _norm_sampling(payload.get("sampling")) if payload.get("sampling") is not None else (_cur("sampling") or {"mode": "all"})
    window = _norm_window(payload.get("dataWindow")) if payload.get("dataWindow") is not None else (_cur("data_window") or {"mode": "all"})
    mapping = payload.get("inputMapping") if payload.get("inputMapping") is not None else (_cur("input_mapping") or {})
    if not isinstance(mapping, dict):
        raise HTTPException(422, "inputMapping 必须是对象")
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
                            input_mapping=mapping, scope=scope, sampling=sampling,
                            data_window=window,
                            output_schema_version_id=_cur("output_schema_version_id") or (latest_quality_schema(db).id if latest_quality_schema(db) else None),
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
