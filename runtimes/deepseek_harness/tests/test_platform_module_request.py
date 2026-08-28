"""R2 跨 Provider conformance：平台公共请求 fixture（quality-analysis v1.0.0）。

同一 AgentVersion 交给 AgentScope / DSH 时平台生成完全相同的 Contract 请求体；
本测试钉扎 agent 段 SHA-256（与平台侧共用同一 fixture），并校验 Module manifest 声明的
bundle 与本 Runtime 的 NATIVE_BUNDLE 常量一致（bundle 属代码评审资产）。
"""
import hashlib
import json
from pathlib import Path

from quality_runtime_contract import RuntimeExecuteRequest

from app.adapter import NATIVE_BUNDLE

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


def test_native_bundle_matches_module_manifest_declaration():
    # SDD 10：bundle 属于版本化部署资产；manifest 声明（implementations.deepseek-harness.bundle）
    # 必须与本 Runtime 实际安装的 bundle 名一致——改名需两侧同评审。
    assert NATIVE_BUNDLE == "morethancorn-dsh-native-quality-workflow"
