"""Provider Registry：Provider 行 ↔ Gateway 构建、健康探测（SDD 10 R1-1/R1-2）。

本模块不做 Provider 选择决策（选择属于 Release Binding，R2 落地）；
只负责按已注册的 Provider 行构建 Gateway 客户端与执行健康探测。
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from ..models import AgentRuntimeProvider
from .client import RuntimeGatewayClient
from .errors import RuntimeProviderError

PROVIDER_KINDS = ("agentscope", "deepseek-harness", "external")
PROVIDER_STATUSES = ("draft", "enabled", "disabled")


def build_gateway(provider: AgentRuntimeProvider, *,
                  transport: httpx.BaseTransport | None = None) -> RuntimeGatewayClient:
    """按 Provider 行构建 Gateway；测试可注入 transport（进程内 fake provider）。"""
    return RuntimeGatewayClient(provider.base_url, transport=transport,
                                check_egress=transport is None)


def probe_provider(db: Session, provider: AgentRuntimeProvider, *,
                   transport: httpx.BaseTransport | None = None) -> dict:
    """主动健康与 capability 验证：写回 health_status/last_health_at，返回探测报告。

    失败也返回报告（ok=false），不抛异常——probe 是观测动作，结果本身即交付物。"""
    try:
        health = build_gateway(provider, transport=transport).health()
    except RuntimeProviderError as exc:
        provider.health_status = "error"
        provider.last_health_at = datetime.now(timezone.utc)
        return {"ok": False, "code": exc.code, "error": exc.message}
    provider.health_status = health.status
    provider.last_health_at = datetime.now(timezone.utc)
    caps = health.capabilities.model_dump()
    if provider.capabilities != caps:
        # capabilities 以 Provider 实测为准（R1 无兼容认证，仅登记事实）
        provider.capabilities = caps
    return {"ok": True, "health": health.model_dump(mode="json")}
