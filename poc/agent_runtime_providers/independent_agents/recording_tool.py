"""Platform Tool/Connection contract for the Lydaas recording lookup.

The Tool contains the HTTP recipe and schemas. Credentials stay in the bound
Connection; the platform's connection signer generates a fresh auth header for
every request.
"""

from __future__ import annotations

import json
from typing import Any

from .recording import DEFAULT_RECORDING_ENDPOINT, RecordingRecord, parse_recording_response


RECORDING_TOOL_NAME = "lydaas_recording_lookup_v2"


def build_recording_tool_create_payload(
    *,
    connection_id: str,
    endpoint: str = DEFAULT_RECORDING_ENDPOINT,
) -> dict[str, Any]:
    if not connection_id.strip():
        raise ValueError("connection_id is required")
    return {
        "name": RECORDING_TOOL_NAME,
        "description": "按 acid 查询热线录音 OSS 临时地址；鉴权由绑定 Connection 动态生成。",
        "kind": "http",
        "connectionId": connection_id,
        "inputSchema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["arg0", "arg1"],
            "properties": {
                "arg0": {"type": "string", "minLength": 1},
                "arg1": {"type": "string", "minLength": 1, "description": "acid"},
            },
        },
        "outputSchema": {
            "type": "object",
            "required": ["success", "data"],
            "properties": {
                "success": {"type": "boolean"},
                "data": {
                    "type": "object",
                    "properties": {
                        "list": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "required": ["callId", "recordCreatedTime", "url"],
                                "properties": {
                                    "callId": {"type": "string"},
                                    "recordCreatedTime": {"type": "integer"},
                                    "url": {"type": "string", "format": "uri"},
                                },
                            },
                        }
                    },
                },
            },
        },
        "spec": {"request": {"method": "POST", "url": endpoint}},
    }


def parse_platform_tool_result(payload: dict[str, Any], acid: str) -> RecordingRecord:
    """Parse `/api/tools/{id}/test` without leaking its signed URL to logs."""

    if payload.get("ok") is not True:
        raise ValueError(str(payload.get("error") or "recording Tool failed"))
    output = payload.get("output")
    if not isinstance(output, dict) or int(output.get("status") or 0) != 200:
        raise ValueError("recording Tool did not return HTTP 200")
    body = output.get("body")
    value = json.loads(body) if isinstance(body, str) else body
    if not isinstance(value, dict):
        raise ValueError("recording Tool body must be an object")
    return parse_recording_response(value, acid)
