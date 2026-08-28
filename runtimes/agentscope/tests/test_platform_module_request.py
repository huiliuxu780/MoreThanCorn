"""R2 跨 Provider conformance：平台公共请求 fixture（quality-analysis v1.0.0）。

同一 AgentVersion 交给 AgentScope / DSH 时，平台生成完全相同的 Contract 请求体；
本测试钉扎该请求的 agent 段 SHA-256（与平台侧 test_r2_agent_modules 共用同一 fixture），
证明公共 request hash 跨 Provider 一致（SDD 10 §10.3 / R2 验收）。
"""
import hashlib
import json
from pathlib import Path

from quality_runtime_contract import RuntimeExecuteRequest

FIXTURE = (Path(__file__).resolve().parents[3]
           / "server" / "app" / "agent_modules" / "quality_analysis" / "fixtures"
           / "platform_request_v1.json")


def test_platform_fixture_parses_and_agent_hash_pinned():
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    request = RuntimeExecuteRequest.model_validate(payload)  # 严格契约（extra=forbid）
    agent_hash = hashlib.sha256(
        json.dumps(payload["agent"], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    pinned = (FIXTURE.parent / "platform_request_v1.agent_sha256").read_text(encoding="utf-8").strip()
    assert agent_hash == pinned, "公共请求 agent 段哈希必须与平台钉扎值一致"
    assert request.context.metadata.get("workflowMode") == "native_quality_v0.2"
    assert {t.name for t in request.agent.tools} == {
        "knowledge_search", "ticket_query", "sms_query", "appointment_query"}
    assert [m.name for m in request.agent.master_data] == ["service_type", "issue_taxonomy"]
    assert "insufficient_evidence" in request.agent.instructions
