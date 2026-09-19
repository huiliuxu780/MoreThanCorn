"""TrueAsk 消费者通话语义分析提交端点（09-18 场景拍板 D2/D5/D7）。

submit_trueask_analysis_result 的平台落点：
- 硬校验 taxonomy 稳定 ID / 闭区间 / 不重叠 / 状态条件空片段 / 实体类型组合 /
  品类枚举（机检子集；逐字证据与覆盖规则由分析器提示词负责，无法机检不伪称）；
- 落 consumer_analysis_result_acceptance 本地审计镜像（孤儿表复活）；
- 主落=飞书目标表：env TRUEASK_FEISHU_TARGET="base_token:table_id" 配置时经
  lark-cli 包装层写回（dev-only；未配置/生产=skipped 如实回执）；
- 422=无回执（参考件语义：没有成功回执本次 Response 失败）。
"""
from __future__ import annotations

import hashlib
import json
import os
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AgentSessionIndex, ConsumerAnalysisResultAcceptance

router = APIRouter(prefix="/api/v2/trueask", tags=["trueask"])

SCHEMA_REF = "trueask-profile-v4/trueask-taxonomy-v4@schema-2.0"

ANALYSIS_STATUSES = {
    "in-scope", "partially-in-scope", "out-of-scope", "insufficient-content"}
SCENARIOS = {
    "fault-consultation", "repair-and-appointment", "human-handoff",
    "service-progress-and-logistics", "installation-consultation",
    "policy-and-invoice-consultation", "product-consultation",
    "price-and-store-consultation", "purchase-recommendation",
    "model-comparison", "usage-guidance", "accessory-and-consumable",
    "routine-maintenance"}
QUALITY_IDS = {
    "useful-basic", "useful-high-quality", "useless-off-topic",
    "useless-wrong-or-harmful", "useless-system-error", "useless-unresolved",
    "guidance-channel-handoff", "guidance-clarification"}
ENTITY_SUBTYPES: dict[str, set[str]] = {
    "product-identity": {"appliance-category", "series", "model"},
    "brand-and-competition": {"brand", "competitor-brand"},
    "product-attribute": {"color", "capacity", "dimensions",
                          "energy-consumption", "feature-or-mode",
                          "selling-point", "other-parameter"},
    "part-accessory-consumable": {"component", "accessory", "consumable"},
    "fault-signal": {"symptom", "fault-code"},
    "service-and-support": {"installation-condition", "environment-parameter",
                            "reference-material", "repair",
                            "installation-service", "logistics",
                            "work-order-status"},
    "marketing-factor": {"price", "subsidy", "promotion", "invoice",
                         "trade-in"}}
APPLIANCE_CATEGORIES = {
    "冰箱", "洗衣机", "干衣机", "洗干一体机", "洗碗机", "蒸箱", "烤箱", "蒸烤箱",
    "烟机", "灶具", "嵌饮机", "消毒柜", "咖啡机", "料理机", "暖碟抽屉",
    "生活电器", "多功能烹饪机", "微波炉", "其他"}
EMPTY_SEGMENT_STATUSES = {"out-of-scope", "insufficient-content"}


def validate_trueask(p: dict) -> list[str]:
    issues: list[str] = []
    status = p.get("analysis_status")
    if status not in ANALYSIS_STATUSES:
        issues.append(f"analysis_status 非法：{status!r}")
    if not isinstance(p.get("title"), str) or not p["title"].strip():
        issues.append("title 必须是非空字符串")
    elif len(p["title"]) > 200:
        issues.append("title 超 200 字")
    if not isinstance(p.get("summary"), str):
        issues.append("summary 必须是字符串")
    elif len(p["summary"]) > 2000:
        issues.append("summary 超 2000 字")
    segs = p.get("segments")
    if not isinstance(segs, list):
        issues.append("segments 必须是数组")
        segs = []
    if status in EMPTY_SEGMENT_STATUSES and segs:
        issues.append(f"{status} 状态必须提交空 segments")
    prev_end = -1
    for i, s in enumerate(segs):
        if not isinstance(s, dict):
            issues.append(f"segments[{i}] 必须是对象")
            continue
        st, en = s.get("start_index"), s.get("end_index")
        if not isinstance(st, int) or not isinstance(en, int) or st > en or st < 0:
            issues.append(f"segments[{i}] 闭区间非法：{st!r}..{en!r}")
        elif st <= prev_end:
            issues.append(f"segments[{i}] 与前一片段重叠或乱序（start={st} <= 前 end={prev_end}）")
        if isinstance(en, int):
            prev_end = en
        if s.get("scenario_id") not in SCENARIOS:
            issues.append(f"segments[{i}].scenario_id 非法：{s.get('scenario_id')!r}")
        if s.get("quality_id") not in QUALITY_IDS:
            issues.append(f"segments[{i}].quality_id 非法：{s.get('quality_id')!r}")
        if not isinstance(s.get("intention"), str) or not s["intention"].strip():
            issues.append(f"segments[{i}].intention 必须是非空字符串")
        if not isinstance(s.get("quality_reason"), str) or not s["quality_reason"].strip():
            issues.append(f"segments[{i}].quality_reason 必须是非空字符串")
        ents = s.get("entities") or []
        if not isinstance(ents, list):
            issues.append(f"segments[{i}].entities 必须是数组")
            ents = []
        for j, e in enumerate(ents):
            if not isinstance(e, dict):
                issues.append(f"segments[{i}].entities[{j}] 必须是对象")
                continue
            tid, sid = e.get("type_id"), e.get("subtype_id")
            if tid not in ENTITY_SUBTYPES or sid not in ENTITY_SUBTYPES.get(tid, set()):
                issues.append(
                    f"segments[{i}].entities[{j}] 类型组合非法：{tid!r}/{sid!r}")
            if not isinstance(e.get("value"), str) or not e["value"].strip():
                issues.append(f"segments[{i}].entities[{j}].value 必须是非空字符串")
            elif sid == "appliance-category" and e["value"] not in APPLIANCE_CATEGORIES:
                issues.append(
                    f"segments[{i}].entities[{j}].value 不在品类枚举：{e['value']!r}")
    return issues


def _session_of_token(db: Session, token: str) -> AgentSessionIndex | None:
    if not token:
        return None
    digest = hashlib.sha256(token.encode()).hexdigest()
    return (db.query(AgentSessionIndex)
            .filter_by(session_token_hash=digest).first())


def _write_feishu(row: ConsumerAnalysisResultAcceptance) -> dict:
    target = os.environ.get("TRUEASK_FEISHU_TARGET", "")
    if not target or ":" not in target:
        return {"written": False, "reason": "未配置 TRUEASK_FEISHU_TARGET"}
    from ..config import is_production
    if is_production():
        return {"written": False, "reason": "生产环境禁走 lark-cli 包装层"}
    from .feishu_tools import _run
    base_token, table_id = target.split(":", 1)
    res = _run(["base", "+record-batch-create", "--base-token", base_token,
                "--table-id", table_id, "--json", json.dumps({
                    "fields": ["call_id", "analysis_status", "title", "summary",
                               "segments", "full_output"],
                    "rows": [[row.call_id, row.analysis_status, row.title,
                              row.summary, json.dumps(row.segments, ensure_ascii=False),
                              json.dumps(row.full_output, ensure_ascii=False)]],
                }, ensure_ascii=False)])
    if res.get("ok"):
        return {"written": True, "target": target}
    return {"written": False, "reason": str(res.get("error"))[:300]}


@router.post("/submit")
def submit_trueask_analysis_result(
    payload: dict,
    db: Session = Depends(get_db),
    x_mtc_session_token: str = Header(default="", alias="X-MTC-Session-Token"),
) -> dict:
    issues = validate_trueask(payload or {})
    if issues:
        raise HTTPException(422, {"code": "TRUEASK_VALIDATION", "issues": issues})
    idx = _session_of_token(db, x_mtc_session_token)
    run_ref = (idx.trigger_log_id if idx and idx.trigger_log_id
               else idx.session_id if idx else f"local-{uuid4().hex}")
    row = ConsumerAnalysisResultAcceptance(
        _run_id=run_ref,
        _task_run_id="", _task_id="", _task_version_id="",
        _interaction_ref=idx.session_id if idx else "",
        _output_schema_ref=SCHEMA_REF,
        call_id=str(payload.get("call_id") or ""),
        analysis_status=payload["analysis_status"],
        title=payload["title"],
        summary=payload["summary"],
        segments={"items": payload["segments"]},
        full_output=payload,
    )
    db.add(row)
    db.commit()
    feishu = _write_feishu(row)
    return {"ok": True, "result_id": row._run_id,
            "written": {"acceptance": True, "feishu": feishu}}
