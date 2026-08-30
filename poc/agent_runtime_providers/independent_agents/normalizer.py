"""Normalize supported Lydaas transcript envelopes without masking their content."""

from __future__ import annotations

import copy
from datetime import datetime
from typing import Any


LEGACY_ROLE_BY_SENDER_TYPE = {
    1: "customer",
    2: "agent",
    4: "system",
}

LYDAAS_ROLE_BY_SENDER_TYPE = {
    "CUSTOMER": "customer",
    "SERVICER": "agent",
    "CHATBOT": "chatbot",
    "SYSTEM": "system",
}


def _timestamp_ms(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("boolean is not a timestamp")
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        raw = value.strip()
        if raw.isdigit():
            return int(raw)
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError(f"timestamp must include a timezone: {value}")
        return int(parsed.timestamp() * 1000)
    raise ValueError(f"unsupported timestamp: {value!r}")


def _single_or_none(values: list[Any]) -> str | None:
    normalized = {str(value) for value in values if value not in (None, "")}
    if len(normalized) > 1:
        raise ValueError(f"one call contains conflicting identifiers: {sorted(normalized)}")
    return next(iter(normalized), None)


def _normalize_modern(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data")
    messages = data.get("messages") if isinstance(data, dict) else None
    rows = messages.get("list") if isinstance(messages, dict) else None
    if not isinstance(rows, list) or not rows:
        raise ValueError("Lydaas message response must contain data.messages.list")

    normalized: list[dict[str, Any]] = []
    acids: list[Any] = []
    for source_position, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ValueError("message row must be an object")
        content = row.get("content") or {}
        header = row.get("header") or {}
        sender = header.get("sender") or {}
        start_ms = _timestamp_ms(content.get("startTime") or header.get("gmtCreate"))
        end_ms = _timestamp_ms(content.get("endTime") or content.get("startTime") or header.get("gmtCreate"))
        if end_ms < start_ms:
            raise ValueError(f"message {row.get('id')} ends before it starts")
        source_type = str(sender.get("type") or ("SYSTEM" if row.get("type") == "SYSTEM_MESSAGE" else "UNKNOWN"))
        acid = header.get("acId")
        acids.append(acid)
        normalized.append(
            {
                "_source_position": source_position,
                "message_id": str(row.get("id") or header.get("conversationId") or f"row-{source_position}"),
                "role": LYDAAS_ROLE_BY_SENDER_TYPE.get(source_type, "unknown"),
                "speaker": {
                    "id": str(sender["id"]) if sender.get("id") is not None else None,
                    "name": str(sender["name"]) if sender.get("name") is not None else None,
                    "source_type": source_type,
                },
                "text": str(content.get("content") or ""),
                "start_time_ms": start_ms,
                "end_time_ms": end_ms,
                "need_split": bool(content.get("needSplit")),
            }
        )

    acid = _single_or_none(acids)
    if not acid:
        raise ValueError("acid is required")
    return _finalize(
        normalized,
        acid=acid,
        connid=None,
        tenant_id=None,
        source_format="lydaas-message-v2",
        trace_id=str(data.get("traceId")) if data.get("traceId") is not None else None,
    )


def _normalize_legacy(payload: dict[str, Any]) -> dict[str, Any]:
    rows = payload.get("data")
    if not isinstance(rows, list) or not rows:
        raise ValueError("legacy response must contain a non-empty data array")
    normalized: list[dict[str, Any]] = []
    acids: list[Any] = []
    connids: list[Any] = []
    tenant_ids: list[Any] = []
    for source_position, row in enumerate(rows):
        start_ms = _timestamp_ms(row.get("startTime") or row.get("gmtCreate"))
        end_ms = _timestamp_ms(row.get("endTime") or row.get("startTime") or row.get("gmtCreate"))
        if end_ms < start_ms:
            raise ValueError(f"message {row.get('id')} ends before it starts")
        sender_type = int(row.get("senderType")) if row.get("senderType") is not None else -1
        acids.append(row.get("acid"))
        connids.append(row.get("connid"))
        tenant_ids.append(row.get("tenantId"))
        head = row.get("head")
        need_split = False
        if isinstance(head, str):
            need_split = '"needSplit":true' in head.replace(" ", "")
        elif isinstance(head, dict):
            need_split = bool(head.get("needSplit"))
        normalized.append(
            {
                "_source_position": source_position,
                "message_id": str(row.get("id") or row.get("mid") or f"row-{source_position}"),
                "role": LEGACY_ROLE_BY_SENDER_TYPE.get(sender_type, "unknown"),
                "speaker": {
                    "id": str(row["senderId"]) if row.get("senderId") is not None else None,
                    "name": str(row["senderName"]) if row.get("senderName") is not None else None,
                    "source_type": str(sender_type),
                },
                "text": str(row.get("content") or ""),
                "start_time_ms": start_ms,
                "end_time_ms": end_ms,
                "need_split": need_split,
            }
        )
    acid = _single_or_none(acids)
    if not acid:
        raise ValueError("acid is required")
    return _finalize(
        normalized,
        acid=acid,
        connid=_single_or_none(connids),
        tenant_id=_single_or_none(tenant_ids),
        source_format="legacy-sender-type",
        trace_id=None,
    )


def _finalize(
    messages: list[dict[str, Any]],
    *,
    acid: str,
    connid: str | None,
    tenant_id: str | None,
    source_format: str,
    trace_id: str | None,
) -> dict[str, Any]:
    ordered = sorted(messages, key=lambda row: (row["start_time_ms"], row["end_time_ms"], row["_source_position"]))
    call_start = min(row["start_time_ms"] for row in ordered)
    call_end = max(row["end_time_ms"] for row in ordered)
    for index, row in enumerate(ordered):
        row.pop("_source_position", None)
        row["index"] = index
        row["start_offset_ms"] = row["start_time_ms"] - call_start
        row["end_offset_ms"] = row["end_time_ms"] - call_start
    return {
        "schema_version": "1.0",
        "call": {
            "acid": acid,
            "connid": connid,
            "tenant_id": tenant_id,
            "started_at_ms": call_start,
            "ended_at_ms": call_end,
            "recording_lookup": {
                "provider": "lydaas-list-record-v2",
                "lookup_field": "acid",
            },
        },
        "messages": ordered,
        "source": {"format": source_format, "trace_id": trace_id},
    }


def normalize_hotline_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Return the canonical unmasked call format accepted by both independent Agents."""

    if not isinstance(payload, dict):
        raise TypeError("payload must be an object")
    if payload.get("schema_version") == "1.0" and payload.get("source", {}).get("format") == "canonical":
        return copy.deepcopy(payload)
    data = payload.get("data")
    if isinstance(data, list):
        return _normalize_legacy(payload)
    if isinstance(data, dict) and isinstance(data.get("messages"), dict):
        return _normalize_modern(payload)
    raise ValueError("unsupported hotline transcript envelope")
