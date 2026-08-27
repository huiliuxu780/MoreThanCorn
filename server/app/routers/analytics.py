"""09-SDD P1-B3：真实质量分析（P1-03）+ 全链路可观测（P1-07）。

所有聚合在数据库侧完成（SQL GROUP BY / FILTER / regexp_split_to_table），
不再"前端取 200 条自算"，也不把全表载入 Python。
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db

router = APIRouter(tags=["analytics"])

# 基础过滤：仅生效结果（is_latest），可选时间窗与 interaction_ref 检索
def _clauses(search: str, days: int | None) -> tuple[list, dict]:
    clauses, params = ["is_latest = TRUE"], {}
    if days:
        clauses.append("interaction_time >= now() - make_interval(days => :days)")
        params["days"] = days
    if search:
        clauses.append("interaction_ref ILIKE :search")
        params["search"] = f"%{search}%"
    return clauses, params


def _where(search: str, days: int | None) -> tuple[str, dict]:
    clauses, params = _clauses(search, days)
    return "FROM quality_result WHERE " + " AND ".join(clauses), params


@router.get("/api/quality/analytics/kpi")
def quality_kpi(search: str = "", days: int | None = None, db: Session = Depends(get_db)):
    where, params = _where(search, days)
    row = db.execute(text(f"""
        SELECT count(*) AS total,
               coalesce(avg(score), 0) AS avg_score,
               count(*) FILTER (WHERE issue_count > 0) AS with_issues,
               count(*) FILTER (WHERE critical) AS critical,
               count(*) FILTER (WHERE review_status IN ('REVIEWED','EFFECTIVE')) AS reviewed,
               count(*) FILTER (WHERE review_status = 'AI') AS pending
        {where}
    """), params).mappings().one()
    total = row["total"] or 0
    return {"total": total,
            "avgScore": round(float(row["avg_score"] or 0), 2),
            "issueRate": round((row["with_issues"] or 0) / total, 4) if total else 0,
            "withIssues": row["with_issues"] or 0,
            "critical": row["critical"] or 0,
            "reviewed": row["reviewed"] or 0,
            "pending": row["pending"] or 0}


@router.get("/api/quality/analytics/trend")
def quality_trend(search: str = "", days: int = 30, db: Session = Depends(get_db)):
    where, params = _where(search, days)
    rows = db.execute(text(f"""
        SELECT to_char(date_trunc('day', interaction_time), 'YYYY-MM-DD') AS date,
               count(*) AS count,
               coalesce(avg(score), 0) AS avg_score,
               count(*) FILTER (WHERE issue_count > 0) AS with_issues,
               count(*) FILTER (WHERE critical) AS critical
        {where}
        GROUP BY 1 ORDER BY 1 ASC
    """), params).mappings().all()
    return {"items": [{"date": r["date"], "count": r["count"],
                       "avgScore": round(float(r["avg_score"] or 0), 2),
                       "issueRate": round((r["with_issues"] or 0) / r["count"], 4) if r["count"] else 0,
                       "critical": r["critical"] or 0} for r in rows]}


@router.get("/api/quality/analytics/top-issues")
def quality_top_issues(search: str = "", days: int | None = None,
                       limit: int = 20, db: Session = Depends(get_db)):
    clauses, params = _clauses(search, days)
    params["limit"] = limit
    clauses += ["issue_summary IS NOT NULL", "issue_summary <> ''"]
    rows = db.execute(text(f"""
        SELECT trim(issue) AS criterion, count(*) AS affected
        FROM quality_result, LATERAL regexp_split_to_table(issue_summary, ';') AS issue
        WHERE {" AND ".join(clauses)}
        GROUP BY trim(issue) HAVING trim(issue) <> ''
        ORDER BY affected DESC LIMIT :limit
    """), params).mappings().all()
    return {"items": [{"criterion": r["criterion"], "affected": r["affected"]} for r in rows]}


_DIM_PATH = {
    "team": "structured_output->'org'->>'teamName'",
    "agent": "structured_output->'org'->>'agentName'",
    "department": "structured_output->'org'->>'departmentName'",
    "serviceType": "structured_output->'businessContext'->>'serviceType'",
    "brand": "structured_output->'businessContext'->>'brand'",
    "productCategory": "structured_output->'businessContext'->>'productCategory'",
    "issueTopic": "structured_output->'businessContext'->>'issueTopic'",
    "requestType": "structured_output->>'requestType'",
}

# 09 P1（审计：SQL 注入）：维度仅允许白名单键，或严格标识符（防注入）。
import re as _re
_IDENT = _re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@router.get("/api/quality/analytics/by-dimension")
def quality_by_dimension(dim: str = "team", search: str = "", days: int | None = None,
                         db: Session = Depends(get_db)):
    if dim not in _DIM_PATH and not _IDENT.match(dim or ""):
        raise HTTPException(422, f"非法维度名：{dim!r}")
    expr = _DIM_PATH.get(dim) or f"structured_output->>'{dim}'"
    where, params = _where(search, days)
    rows = db.execute(text(f"""
        SELECT {expr} AS value,
               count(*) AS count,
               coalesce(avg(score), 0) AS avg_score,
               count(*) FILTER (WHERE issue_count > 0) AS with_issues,
               count(*) FILTER (WHERE critical) AS critical
        {where}
        GROUP BY {expr} HAVING {expr} IS NOT NULL AND {expr} <> '' AND {expr} <> '-'
        ORDER BY count DESC
    """), params).mappings().all()
    return {"dim": dim, "items": [
        {"value": r["value"], "count": r["count"],
         "avgScore": round(float(r["avg_score"] or 0), 2),
         "issueRate": round((r["with_issues"] or 0) / r["count"], 4) if r["count"] else 0,
         "critical": r["critical"] or 0} for r in rows]}


# ---------- P1-07 全链路可观测 ----------

@router.get("/api/observability/run-stats")
def run_stats(db: Session = Depends(get_db)):
    rows = db.execute(text(
        "SELECT status, count(*) AS n, coalesce(avg(duration_ms), 0) AS avg_ms "
        "FROM run GROUP BY status")).mappings().all()
    by_status = {r["status"]: r["n"] for r in rows}
    total = sum(by_status.values())
    avg_ms = db.execute(text("SELECT coalesce(avg(duration_ms),0) FROM run")).scalar()
    return {"total": total, "byStatus": by_status,
            "avgDurationMs": int(avg_ms or 0),
            "byStatusDuration": {r["status"]: int(r["avg_ms"] or 0) for r in rows}}


@router.get("/api/observability/queue-stats")
def queue_stats(db: Session = Depends(get_db)):
    rows = db.execute(text(
        "SELECT status, count(*) AS n FROM job_queue GROUP BY status")).mappings().all()
    stats = {r["status"]: r["n"] for r in rows}
    return {"pending": stats.get("pending", 0),
            "processing": stats.get("processing", 0),
            "dead": stats.get("dead", 0),
            "done": stats.get("done", 0)}


@router.get("/api/observability/schedule-stats")
def schedule_stats(db: Session = Depends(get_db)):
    enabled = db.execute(text("SELECT count(*) FROM schedule WHERE enabled")).scalar() or 0
    overdue = db.execute(text(
        "SELECT count(*) FROM schedule WHERE enabled AND next_run_at IS NOT NULL "
        "AND next_run_at < now()")).scalar() or 0
    return {"enabled": enabled, "overdue": overdue}


@router.get("/api/observability/cost-stats")
def cost_stats(db: Session = Depends(get_db)):
    """09 P1（审计：成本恒 0）：从 CallRecord 模型调用聚合（真实调用源），
    而非读从不写入的 Run.token_usage。"""
    row = db.execute(text("""
        SELECT coalesce(sum((token_usage->>'promptTokens')::int), 0) AS prompt,
               coalesce(sum((token_usage->>'completionTokens')::int), 0) AS completion,
               count(*) AS calls
        FROM call_record
        WHERE kind = 'model' AND token_usage IS NOT NULL
    """)).mappings().one()
    return {"totalPromptTokens": int(row["prompt"] or 0),
            "totalCompletionTokens": int(row["completion"] or 0),
            "totalTokens": int(row["prompt"] or 0) + int(row["completion"] or 0),
            "modelCalls": int(row["calls"] or 0)}
