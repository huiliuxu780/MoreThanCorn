"""09-11 权限策略运行时层：按平台冻结策略在装配后摘除被关工具。

机制：包装官方 ``get_toolkit``——装配完成后读平台 session-manifest 的
``tool_policy``（release 冻结快照下发），用官方 ``Toolkit.remove_tool`` 摘除
被关工具族（模型感知为「没有该能力」）。必须在 ``agentscope.app._service._chat``
导入前完成包装（_chat 以 from-import 绑定 get_toolkit）。

策略键与工具族映射与平台侧 ``agent_execution.TOOL_POLICY_KEYS`` 对齐；
缺省键视为开启；平台不可达时 fail-open 保持默认能力面（与 manifest 既有语义一致）。
"""
from __future__ import annotations

import os
import time

import httpx

from agentscope.app._service import _toolkit as _tk

SERVER_URL = os.environ.get("MTC_SERVER_URL", "http://127.0.0.1:8120")
TOKEN = os.environ.get("MTC_INTERNAL_TOKEN", "")

POLICY_TOOL_NAMES: dict[str, tuple[str, ...]] = {
    "shell": ("Bash",),
    "file_write": ("Write", "Edit"),
    "file_read": ("Read", "Grep", "Glob"),
    "schedule": ("ScheduleCreate", "ScheduleView", "ScheduleDelete", "ScheduleList"),
    "subagent": ("AgentCreate", "AgentInvite", "TeamCreate", "TeamDelete", "TeamSay"),
}

# Group Spec 不变量 4 / D1：团队组成平台所有——群会话（session.team_id 非空）
# 恒摘四建团工具；manifest 拉取失败 fail-closed 连 TeamSay 一并 deny
# （安全降级：成员仍可对用户应答，只是不能群内协调）。
GROUP_CREATE_TOOLS: tuple[str, ...] = (
    "AgentCreate", "AgentInvite", "TeamCreate", "TeamDelete")


def group_denied_tools(is_group: bool, manifest: dict | None) -> list[str]:
    """纯决策函数（probes/p1x_team 断言源）：群会话工具门禁。"""
    if not is_group:
        return []
    denied = list(GROUP_CREATE_TOOLS)
    if not manifest:
        denied.extend(POLICY_TOOL_NAMES["subagent"])
    return sorted(set(denied))

_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_TTL = 60.0


async def _fetch_manifest(session_id: str) -> dict:
    now = time.time()
    hit = _CACHE.get(session_id)
    if hit and now - hit[0] < _CACHE_TTL:
        return hit[1]
    manifest: dict = {}
    if TOKEN:
        # 会话令牌绑定门（P0-08）：与 extra_factory 同款双头，缺会话令牌会 401
        from .platform_tools import _session_token

        headers = {"X-MTC-Internal": TOKEN}
        sess_token = _session_token(session_id)
        if sess_token:
            headers["X-MTC-Session-Token"] = sess_token
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{SERVER_URL}/api/internal/agent-tools/session-manifest",
                    params={"session_id": session_id},
                    headers=headers,
                )
                if r.status_code == 200:
                    manifest = r.json() or {}
        except Exception:  # noqa: BLE001 —— 平台不可达 fail-open
            manifest = {}
    _CACHE[session_id] = (now, manifest)
    return manifest


_orig_get_toolkit = _tk.get_toolkit


def _apply_permission_context(sess, spec: dict) -> None:
    """14 号稿 P1：把冻结执行规格注入会话 permission_context（内存态，每回合）。"""
    from agentscope.permission import PermissionMode, PermissionRule

    state = getattr(sess, "state", None)
    ctx = getattr(state, "permission_context", None)
    if ctx is None:
        return
    mode = spec.get("mode") or "bypass"
    try:
        ctx.mode = PermissionMode(mode)
    except ValueError:
        ctx.mode = PermissionMode.BYPASS
    for tool in spec.get("ask_tools") or []:
        ctx.ask_rules.setdefault(tool, []).append(
            PermissionRule(tool_name=tool, rule_content="", behavior="ask", source="platform"),
        )
    for pat in spec.get("bash_ask_patterns") or []:
        ctx.ask_rules.setdefault("Bash", []).append(
            PermissionRule(tool_name="Bash", rule_content=pat, behavior="ask", source="platform"),
        )
    for pat in spec.get("bash_deny_patterns") or []:
        ctx.deny_rules.setdefault("Bash", []).append(
            PermissionRule(tool_name="Bash", rule_content=pat, behavior="deny", source="platform"),
        )
    for glob in spec.get("sensitive_globs") or []:
        for tool in ("Write", "Read", "Edit"):
            ctx.ask_rules.setdefault(tool, []).append(
                PermissionRule(tool_name=tool, rule_content=glob, behavior="ask", source="platform"),
            )


async def get_toolkit_with_policy(**kw):
    toolkit = await _orig_get_toolkit(**kw)
    sess = kw.get("session_record")
    sid = getattr(sess, "id", None) or getattr(sess, "session_id", None)
    if not sid:
        return toolkit
    manifest = await _fetch_manifest(str(sid))
    is_group = getattr(sess, "team_id", None) is not None
    denied: list[str] = group_denied_tools(is_group, manifest)
    if not manifest and not is_group:
        return toolkit
    # 旧六开关 tool_policy（deny 族摘除）
    policy = (manifest or {}).get("tool_policy") or {}
    for key, names in POLICY_TOOL_NAMES.items():
        if policy.get(key, True) is False:
            denied.extend(names)
    # 新 v2 执行规格：三态 deny 摘除 + permission_context 注入
    spec = (manifest or {}).get("permission_policy") or {}
    denied.extend(spec.get("deny_tools") or [])
    if spec:
        _apply_permission_context(sess, spec)
    denied = sorted(set(denied))
    if not denied:
        return toolkit
    existing: set[str] = set()
    for group in getattr(toolkit, "tool_groups", []):
        for tool in getattr(group, "tools", []):
            existing.add(getattr(tool, "name", ""))
    targets = [n for n in denied if n in existing]
    if targets:
        await toolkit.remove_tool(targets)
    return toolkit


_tk.get_toolkit = get_toolkit_with_policy
# _chat 以 from-import 在 _service/__init__ 阶段绑定了原函数；同步替换其模块引用，
# 否则 chat 回合绕过包装（flow 路径导入晚于包装，天然生效）。
from agentscope.app._service import _chat as _chat_mod  # noqa: E402

_chat_mod.get_toolkit = get_toolkit_with_policy
# _service 包体自身也 from-import 了 get_toolkit，一并替换防内部调用绕过
import agentscope.app._service as _svc  # noqa: E402

_svc.get_toolkit = get_toolkit_with_policy
