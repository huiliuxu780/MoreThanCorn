"""Run.output -> user-facing business result projections.

The persisted Run output remains the source of truth.  These helpers only build a
stable read model for the UI; they never rewrite or reinterpret the stored result.
"""
from __future__ import annotations

from typing import Any


SCENARIO_LABELS = {
    "fault-consultation": "故障咨询",
    "repair-and-appointment": "报修与预约",
    "human-handoff": "转人工",
    "service-progress-and-logistics": "服务进度与物流",
    "installation-consultation": "安装咨询",
    "policy-and-invoice-consultation": "政策与发票咨询",
    "product-consultation": "产品咨询",
    "price-and-store-consultation": "价格与门店咨询",
    "purchase-recommendation": "选购推荐",
    "model-comparison": "型号对比",
    "usage-guidance": "使用指导",
    "accessory-and-consumable": "配件与耗材咨询",
    "routine-maintenance": "日常维护保养",
}

USEFULNESS_LABELS = {
    "useful-basic": "有用·基础回应",
    "useful-high-quality": "有用·高质量回应",
    "useless-off-topic": "无用·答非所问",
    "useless-wrong-or-harmful": "无用·错误或有害",
    "useless-system-error": "无用·系统异常",
    "useless-unresolved": "无用·未解决",
    "guidance-channel-handoff": "引导·渠道转接",
    "guidance-clarification": "引导·需求澄清",
}


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _unique_text(values: list[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        item = _text(value)
        if item and item not in seen:
            result.append(item)
            seen.add(item)
    return result


def is_consumer_analysis_output(output: Any) -> bool:
    """Recognise the published consumer-analysis-v1 output contract."""
    return (
        isinstance(output, dict)
        and isinstance(output.get("segments"), list)
        and bool(_text(output.get("call_id")))
        and "analysis_status" in output
        and "title" in output
        and "summary" in output
    )


def project_business_result(output: Any, module_key: str | None = None) -> dict | None:
    """Build a stable, presentation-oriented DTO from a persisted Run.output."""
    if not isinstance(output, dict) or not output:
        return None

    if module_key == "dsh-consumer-analysis" or is_consumer_analysis_output(output):
        segments = [row for row in output.get("segments", []) if isinstance(row, dict)]
        scenario_ids = _unique_text([row.get("scenario_id") for row in segments])
        intentions = _unique_text([row.get("intention") for row in segments])
        entities: list[dict] = []
        seen_entities: set[tuple[str, str, str]] = set()
        for segment in segments:
            for raw in segment.get("entities", []):
                if not isinstance(raw, dict):
                    continue
                entity = {
                    "typeId": _text(raw.get("type_id")),
                    "subtypeId": _text(raw.get("subtype_id")),
                    "mention": _text(raw.get("mention")),
                    "normalizedName": _text(raw.get("normalized_name")),
                    "masterCode": _text(raw.get("master_code")),
                    "resolutionStatus": _text(raw.get("resolution_status")),
                    "confidence": raw.get("confidence"),
                }
                key = (entity["typeId"], entity["subtypeId"], entity["mention"])
                if key not in seen_entities:
                    entities.append(entity)
                    seen_entities.add(key)
        projected_segments = [{
            "id": _text(row.get("segment_id")),
            "startIndex": row.get("start_index"),
            "endIndex": row.get("end_index"),
            "scenarioId": _text(row.get("scenario_id")),
            "scenarioLabel": SCENARIO_LABELS.get(_text(row.get("scenario_id")), _text(row.get("scenario_id"))),
            "intention": _text(row.get("intention")),
            "usefulnessId": _text(row.get("usefulness_id")),
            "usefulnessLabel": USEFULNESS_LABELS.get(_text(row.get("usefulness_id")), _text(row.get("usefulness_id"))),
            "usefulnessReason": _text(row.get("usefulness_reason")),
            "evidenceMessageIndexes": row.get("evidence_message_indexes") or [],
            "entities": [e for e in entities if any(
                isinstance(raw, dict)
                and _text(raw.get("type_id")) == e["typeId"]
                and _text(raw.get("subtype_id")) == e["subtypeId"]
                and _text(raw.get("mention")) == e["mention"]
                for raw in row.get("entities", [])
            )],
        } for row in segments]
        return {
            "kind": "consumer-analysis",
            "contract": "consumer-analysis-v1",
            "callId": _text(output.get("call_id")),
            "status": _text(output.get("analysis_status")),
            "title": _text(output.get("title")) or "消费者诉求分析",
            "summary": _text(output.get("summary")),
            "scenarios": [{"id": sid, "label": SCENARIO_LABELS.get(sid, sid)} for sid in scenario_ids],
            "intentions": intentions,
            "entities": entities,
            "segments": projected_segments,
            "output": output,
        }

    return {
        "kind": "structured-output",
        "contract": module_key or "run-output",
        "callId": _text(output.get("call_id") or output.get("interactionId")),
        "status": _text(output.get("status") or output.get("analysis_status")) or "available",
        "title": _text(output.get("title")) or "结构化业务结果",
        "summary": _text(output.get("summary") or output.get("issueSummary")),
        "scenarios": [],
        "intentions": [],
        "entities": [],
        "segments": [],
        "output": output,
    }


def consumer_business_dimensions(projection: dict | None) -> dict[str, str]:
    """Flatten a consumer projection into the quality-list business columns."""
    if not projection or projection.get("kind") != "consumer-analysis":
        return {}
    scenarios = projection.get("scenarios") or []
    intentions = projection.get("intentions") or []
    entities = projection.get("entities") or []

    def entity_name(*needles: str) -> str:
        for entity in entities:
            haystack = f"{entity.get('typeId', '')} {entity.get('subtypeId', '')}".lower()
            if any(needle in haystack for needle in needles):
                return _text(entity.get("normalizedName") or entity.get("mention"))
        return ""

    return {
        "serviceType": " / ".join(_text(x.get("label")) for x in scenarios if isinstance(x, dict)),
        "productCategory": entity_name("product", "appliance", "category", "产品", "品类"),
        "brand": entity_name("brand", "品牌"),
        "issueTopic": intentions[0] if intentions else "",
        "requestType": "；".join(intentions),
        "requestSummary": _text(projection.get("summary") or projection.get("title")),
    }
