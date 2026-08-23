"""质检业务层深化：Result Rules 引擎 / Review 流 / Data Asset 批量 / Task×Schedule。"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (AnalysisTask, DataAsset, QualityResult, ResultRuleSet,
                      Schedule)
from ..runner import create_run

router = APIRouter(tags=["business"])


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


def active_ruleset(db: Session) -> ResultRuleSet | None:
    return db.execute(
        select(ResultRuleSet).where(ResultRuleSet.status == "published")
        .order_by(ResultRuleSet.version.desc())).scalars().first()


def apply_rules_to_result(db: Session, qr: QualityResult) -> None:
    rs = active_ruleset(db)
    if not rs:
        return
    derived = evaluate_rules(rs.rules or {}, qr.structured_output or {})
    qr.score = derived["score"]
    qr.risk = derived["risk"]
    qr.issue_count = derived["issueCount"]
    qr.issue_summary = derived["issueSummary"]
    qr.rules_version = rs.version


@router.get("/api/result-rules")
def list_rules(db: Session = Depends(get_db)):
    rows = db.query(ResultRuleSet).order_by(ResultRuleSet.updated_at.desc()).all()
    return {"items": [{"id": r.id, "name": r.name, "description": r.description,
                       "agentId": r.agent_id, "currentVersion": f"V{r.version}",
                       "versionStatus": "Published" if r.status == "published" else "Draft",
                       "evaluationPriority": r.evaluation_priority,
                       "updatedAt": r.updated_at.isoformat()} for r in rows]}


@router.post("/api/result-rules", status_code=201)
def create_rules(payload: dict, db: Session = Depends(get_db)):
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
    return {"id": r.id, "name": r.name, "version": r.version, "status": r.status, "rules": r.rules}


@router.put("/api/result-rules/{rid}")
def update_rules(rid: str, payload: dict, db: Session = Depends(get_db)):
    r = db.get(ResultRuleSet, rid)
    if not r:
        raise HTTPException(404, "规则不存在")
    if payload.get("rules") is not None:
        r.rules = payload["rules"]
    if payload.get("name"):
        r.name = payload["name"]
    db.commit()
    return {"id": r.id, "version": r.version, "status": r.status}


@router.post("/api/result-rules/{rid}/publish")
def publish_rules(rid: str, db: Session = Depends(get_db)):
    r = db.get(ResultRuleSet, rid)
    if not r:
        raise HTTPException(404, "规则不存在")
    r.version += 1
    r.status = "published"
    db.commit()
    # 规则变更可重算：重算全部结果
    n = recalc_all(db)
    return {"id": r.id, "version": r.version, "recalculated": n}


def recalc_all(db: Session) -> int:
    rs = active_ruleset(db)
    if not rs:
        return 0
    n = 0
    for qr in db.query(QualityResult).all():
        apply_rules_to_result(db, qr)
        n += 1
    db.commit()
    return n


@router.post("/api/result-rules/{rid}/recalc")
def recalc(rid: str, db: Session = Depends(get_db)):
    return {"recalculated": recalc_all(db)}


# ---------- Review 流 ----------

@router.post("/api/quality-results/{rid}/review")
def review_result(rid: str, payload: dict, db: Session = Depends(get_db)):
    qr = db.get(QualityResult, rid)
    if not qr:
        raise HTTPException(404, "质检结果不存在")
    action = payload.get("action", "approve")
    note = payload.get("note", "")
    reviewer = payload.get("reviewer", "reviewer")
    before = {"status": qr.review_status, "score": qr.score, "risk": qr.risk}
    if action == "approve":
        qr.review_status = "REVIEWED"
    elif action == "effective":
        qr.review_status = "EFFECTIVE"
    elif action == "reopen":
        qr.review_status = "AI"
    elif action == "revise":
        qr.review_status = "REVIEWED"
        if payload.get("score") is not None:
            qr.score = float(payload["score"])
        if payload.get("risk"):
            qr.risk = payload["risk"]
    else:
        raise HTTPException(422, "未知复核动作")
    hist = list(qr.review_history or [])
    hist.append({"at": datetime.now(timezone.utc).isoformat(), "action": action,
                 "reviewer": reviewer, "note": note, "before": before,
                 "after": {"status": qr.review_status, "score": qr.score, "risk": qr.risk}})
    qr.review_history = hist
    db.commit()
    return {"id": qr.id, "review": qr.review_status, "history": qr.review_history}


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
def create_asset(payload: dict, db: Session = Depends(get_db)):
    a = DataAsset(name=payload["name"], description=payload.get("description", ""),
                  source=payload.get("source", "manual"), rows=payload.get("rows", []))
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
def append_rows(aid: str, payload: dict, db: Session = Depends(get_db)):
    a = db.get(DataAsset, aid)
    if not a:
        raise HTTPException(404, "数据资产不存在")
    rows = list(a.rows or []) + (payload.get("rows") or [])
    a.rows = rows
    a.revision += 1
    db.commit()
    return {"id": a.id, "rows": len(rows), "revision": a.revision}


# ---------- Analysis Task + 批量 + Schedule ----------

@router.get("/api/tasks")
def list_tasks(db: Session = Depends(get_db)):
    rows = db.query(AnalysisTask).all()
    return {"items": [{"id": t.id, "name": t.name, "description": t.description,
                       "agentId": t.workflow_id, "agentVersionPolicy": t.version_policy,
                       "dataAssetId": t.data_asset_id, "dataDefinitionId": t.data_definition_id,
                       "scope": t.scope,
                       "sampling": t.sampling, "schedule": t.data_window,
                       "dataWindow": t.data_window, "status": t.status} for t in rows]}


@router.post("/api/tasks", status_code=201)
def create_task(payload: dict, db: Session = Depends(get_db)):
    t = AnalysisTask(name=payload["name"], description=payload.get("description", ""),
                     workflow_id=payload["workflowId"], data_asset_id=payload["dataAssetId"],
                     data_definition_id=payload.get("dataDefinitionId"),
                     scope=payload.get("scope", "all"), sampling=payload.get("sampling", "all"),
                     data_window=payload.get("dataWindow", "last_7d"))
    db.add(t)
    db.commit()
    return {"id": t.id, "name": t.name}


def _resolve_rows(db: Session, task: AnalysisTask) -> list[dict]:
    """rows 解析：Definition→Asset；有 Datasource 且无内联 rows 时按 schema mock 抽样。"""
    from ..models import DataDefinition
    asset = db.get(DataAsset, task.data_asset_id)
    if not asset:
        raise HTTPException(404, "数据资产不存在")
    rows = list(asset.rows or [])
    if not rows and asset.datasource_id:
        defn = db.get(DataDefinition, task.data_definition_id) if task.data_definition_id else None
        schema = (defn.field_schema if defn and defn.field_schema else
                  [{"key": "interactionId"}, {"key": "interactionTime"}, {"key": "text"}])
        rows = [{f.get("key", f"col{i}"): f"mock-{i}" for i, f in enumerate(schema)}
                for _ in range(5)]
    return rows


def batch_run_task(db: Session, task: AnalysisTask, limit: int | None = None) -> list[str]:
    rows = _resolve_rows(db, task)
    if task.sampling.startswith("first_"):
        try:
            rows = rows[: int(task.sampling.split("_")[1])]
        except ValueError:
            pass
    if limit:
        rows = rows[: limit]
    run_ids = []
    for row in rows:
        run = create_run(db, task.workflow_id, "batch", row or {}, enqueue=False)
        from ..runner import execute_run
        execute_run(run.id)
        run_ids.append(run.id)
    return run_ids


@router.post("/api/tasks/{tid}/batch-run")
def batch_run(tid: str, payload: dict | None = None, db: Session = Depends(get_db)):
    t = db.get(AnalysisTask, tid)
    if not t:
        raise HTTPException(404, "任务不存在")
    ids = batch_run_task(db, t, (payload or {}).get("limit"))
    return {"runIds": ids}


@router.post("/api/tasks/{tid}/schedule")
def task_schedule(tid: str, payload: dict, db: Session = Depends(get_db)):
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
