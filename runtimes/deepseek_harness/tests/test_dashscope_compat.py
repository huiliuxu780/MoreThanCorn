from __future__ import annotations

import pytest

from app.dashscope_compat import translate_request, upstream_target


def test_translate_disabled_thinking_for_dashscope() -> None:
    source = {
        "model": "qwen3.8-max",
        "thinking": {"type": "disabled"},
        "reasoning_effort": "high",
        "stream": True,
    }

    translated = translate_request(source)

    assert translated == {
        "model": "qwen3.8-max",
        "enable_thinking": False,
        "stream": True,
    }
    assert source["thinking"] == {"type": "disabled"}


def test_translate_enabled_thinking_preserves_effort() -> None:
    translated = translate_request(
        {"thinking": {"type": "enabled"}, "reasoning_effort": "low"}
    )
    assert translated == {"enable_thinking": True, "reasoning_effort": "low"}


def test_translate_request_without_thinking_is_unchanged() -> None:
    assert translate_request({"model": "qwen3.8-max"}) == {"model": "qwen3.8-max"}


def test_upstream_target_accepts_only_fixed_aliyun_https_hosts() -> None:
    assert upstream_target(
        "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
    ) == (
        "https",
        "workspace.cn-beijing.maas.aliyuncs.com",
        443,
        "/compatible-mode/v1/chat/completions",
    )
    with pytest.raises(ValueError):
        upstream_target("http://workspace.cn-beijing.maas.aliyuncs.com/v1")
    with pytest.raises(ValueError):
        upstream_target("https://example.com/v1")
