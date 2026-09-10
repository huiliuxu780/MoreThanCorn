"""AgentScope 换底单元测试（G9 门禁）：状态映射/Prompt 编译/触发模板渲染。"""
from __future__ import annotations

from app.agent_execution import compile_system_prompt, render_prompt
from app.board_projection import (
    ENDED,
    is_ended,
    map_agentflow_lane,
    map_session_lane,
    map_workflow_lane,
)


def test_prompt_compile_order_and_digest():
    cfg = {"persona": "P", "identity": "I", "bible": "B"}
    prompt, digest, frozen_model = compile_system_prompt(cfg)
    assert prompt.index("<identity>") < prompt.index("<bible") < prompt.index("<persona")
    assert prompt.count("<identity>") == 1
    assert frozen_model is None  # no agentSpec.model in plain config
    again, digest2, _ = compile_system_prompt(cfg)
    assert again == prompt and digest == digest2
    _, other, _ = compile_system_prompt({**cfg, "identity": "I2"})
    assert other != digest


def test_prompt_compile_legacy_fallback():
    prompt, _, _ = compile_system_prompt({"rolePrompt": "legacy"})
    assert prompt == "legacy"
    prompt, _, _ = compile_system_prompt({})
    assert prompt == "You are a helpful assistant."


def test_render_prompt_placeholders():
    payload = {"topic": "billing", "nested": {"field": "x"}, "items": [{"name": "n0"}]}
    out = render_prompt("{{topic}} {{nested.field}} {{items[0].name}} {{missing}}", payload)
    assert out == "billing x n0 {{missing}}"


def test_render_prompt_no_placeholder_keeps_fixed_prompt():
    assert render_prompt("fixed prompt", {"a": 1}) == "fixed prompt"


def test_session_lane_mapping():
    assert map_session_lane("running", None, 2) == "running"
    assert map_session_lane("waiting", None, 2) == "waiting"
    assert map_session_lane("idle", "error", 2) == "failed"
    assert map_session_lane("idle", "interrupted", 2) == "cancelled"
    assert map_session_lane("idle", "completed", 2) == "done"
    assert map_session_lane("idle", None, 0) == "pending"


def test_workflow_and_flow_lane_mapping():
    assert map_workflow_lane("queued") == "pending"
    assert map_workflow_lane("succeeded") == "done"
    assert map_workflow_lane("failed") == "failed"
    assert map_workflow_lane("cancelled") == "cancelled"
    assert map_agentflow_lane("running") == "running"
    assert map_agentflow_lane("succeeded") == "done"


def test_ended_aggregate():
    assert is_ended("done") and is_ended("failed") and is_ended("cancelled")
    assert not is_ended("running") and not is_ended("waiting") and not is_ended("pending")
    assert ENDED == {"done", "failed", "cancelled"}
