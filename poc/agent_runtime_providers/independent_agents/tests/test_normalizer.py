from __future__ import annotations

from independent_agents.normalizer import normalize_hotline_payload


def test_modern_lydaas_response_is_sorted_and_keeps_raw_identity() -> None:
    payload = {
        "success": True,
        "data": {
            "traceId": "trace-1",
            "messages": {
                "list": [
                    {
                        "id": "m2",
                        "type": "CHAT_MESSAGE",
                        "content": {
                            "content": "您好，云女士",
                            "startTime": "2026-02-28T15:00:01+08:00",
                            "endTime": "2026-02-28T15:00:02+08:00",
                        },
                        "header": {
                            "acId": "A-1",
                            "sender": {"id": "agent-1", "name": "米昔", "type": "SERVICER"},
                        },
                    },
                    {
                        "id": "m1",
                        "type": "CHAT_MESSAGE",
                        "content": {
                            "content": "我姓云",
                            "startTime": "2026-02-28T15:00:00+08:00",
                            "endTime": "2026-02-28T15:00:01+08:00",
                        },
                        "header": {
                            "acId": "A-1",
                            "sender": {"id": "customer-1", "name": "完整客户名", "type": "CUSTOMER"},
                        },
                    },
                ],
                "page": {},
            },
        },
    }

    call = normalize_hotline_payload(payload)

    assert call["call"]["acid"] == "A-1"
    assert [message["message_id"] for message in call["messages"]] == ["m1", "m2"]
    assert [message["role"] for message in call["messages"]] == ["customer", "agent"]
    assert call["messages"][0]["speaker"]["name"] == "完整客户名"
    assert call["messages"][0]["index"] == 0
    assert call["messages"][0]["start_offset_ms"] == 0
    assert call["source"] == {"format": "lydaas-message-v2", "trace_id": "trace-1"}


def test_legacy_sender_type_mapping_matches_confirmed_contract() -> None:
    payload = {
        "success": True,
        "data": [
            {
                "id": 1,
                "acid": "A-2",
                "connid": "C-2",
                "tenantId": 9,
                "senderType": 1,
                "senderId": 11,
                "senderName": "customer",
                "content": "客户",
                "startTime": 1000,
                "endTime": 1100,
            },
            {
                "id": 2,
                "acid": "A-2",
                "connid": "C-2",
                "tenantId": 9,
                "senderType": 2,
                "senderId": 22,
                "senderName": "agent",
                "content": "坐席",
                "startTime": 1200,
                "endTime": 1300,
            },
            {
                "id": 3,
                "acid": "A-2",
                "connid": "C-2",
                "tenantId": 9,
                "senderType": 4,
                "senderId": -1,
                "senderName": "System",
                "content": "结束",
                "startTime": 1400,
                "endTime": 1400,
                "head": "{\"needSplit\":true}",
            },
        ],
    }

    call = normalize_hotline_payload(payload)

    assert [message["role"] for message in call["messages"]] == ["customer", "agent", "system"]
    assert call["messages"][2]["need_split"] is True
    assert call["call"]["connid"] == "C-2"
    assert call["call"]["tenant_id"] == "9"
