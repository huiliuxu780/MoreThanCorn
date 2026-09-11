"""权限策略种子目录与冻结解析（14 号稿 P1）。

UI 存 config.permissions v2（意图）；发布时 materialize 调 resolve_permission_policy
解析成运行时执行规格 frozen_permission_policy（事实）：mode + deny/ask 工具名 +
Bash 子串模式 + 敏感 glob。子串模式为 P1 保真度（规避可能），解析器级规则 P2。
pattern=None 的规则（解析器层）P1 不进入执行规格，UI 标「规划」。
"""
from __future__ import annotations

# rule_id -> (bash 子串模式 | None, 默认处理方式, 风险)
GUARD_RULES: dict[str, tuple[str | None, str, str]] = {
    "TOOL_CMD_FS_DESTRUCTION": ("mkfs", "ask", "crit"),
    "TOOL_CMD_DANGEROUS_RM": ("rm -rf", "ask", "high"),
    "TOOL_CMD_DANGEROUS_MV": (None, "ask", "high"),
    "TOOL_CMD_DOS_FORK_BOMB": (":():", "deny", "crit"),
    "TOOL_CMD_SYSTEM_REBOOT": ("reboot", "deny", "crit"),
    "TOOL_CMD_SERVICE_RESTART": ("systemctl", "ask", "high"),
    "TOOL_CMD_PROCESS_KILL": ("kill -9", "ask", "high"),
    "TOOL_CMD_PIPE_TO_SHELL": ("| bash", "deny", "crit"),
    "TOOL_CMD_CONTROL_CHARS": (None, "deny", "crit"),
    "TOOL_CMD_OBFUSCATED_EXEC": ("base64", "ask", "high"),
    "TOOL_CMD_IFS_INJECTION": ("$IFS", "ask", "high"),
    "TOOL_CMD_UNICODE_WHITESPACE": (None, "ask", "high"),
    "TOOL_CMD_JQ_SYSTEM": (None, "ask", "high"),
    "TOOL_CMD_JQ_FILE_FLAGS": (None, "ask", "high"),
    "TOOL_CMD_ZSH_DANGEROUS": ("zsh -c", "ask", "high"),
    "TOOL_CMD_REVERSE_SHELL": ("/dev/tcp", "deny", "crit"),
    "TOOL_WEBFETCH_LOCAL_LOOPBACK": (None, "ask", "high"),
    "TOOL_CMD_SYSTEM_TAMPERING": (".ssh", "ask", "high"),
    "TOOL_CMD_PROC_ENVIRON": ("/proc/", "ask", "high"),
    "TOOL_WEBFETCH_FILE_SCHEME": ("file://", "ask", "high"),
    "TOOL_CMD_PRIVILEGE_ESCALATION": ("sudo", "ask", "crit"),
    "TOOL_CMD_UNSAFE_PERMISSIONS": ("chmod 777", "ask", "high"),
}

GUARD_CATEGORIES: dict[str, list[str]] = {
    "cmd_injection": ["TOOL_CMD_FS_DESTRUCTION", "TOOL_CMD_DANGEROUS_RM", "TOOL_CMD_DANGEROUS_MV"],
    "resource_abuse": ["TOOL_CMD_DOS_FORK_BOMB", "TOOL_CMD_SYSTEM_REBOOT", "TOOL_CMD_SERVICE_RESTART", "TOOL_CMD_PROCESS_KILL"],
    "code_exec": ["TOOL_CMD_PIPE_TO_SHELL", "TOOL_CMD_CONTROL_CHARS", "TOOL_CMD_OBFUSCATED_EXEC", "TOOL_CMD_IFS_INJECTION", "TOOL_CMD_UNICODE_WHITESPACE", "TOOL_CMD_JQ_SYSTEM", "TOOL_CMD_JQ_FILE_FLAGS", "TOOL_CMD_ZSH_DANGEROUS"],
    "network_abuse": ["TOOL_CMD_REVERSE_SHELL", "TOOL_WEBFETCH_LOCAL_LOOPBACK"],
    "sensitive_access": ["TOOL_CMD_SYSTEM_TAMPERING", "TOOL_CMD_PROC_ENVIRON", "TOOL_WEBFETCH_FILE_SCHEME"],
    "priv_esc": ["TOOL_CMD_PRIVILEGE_ESCALATION", "TOOL_CMD_UNSAFE_PERMISSIONS"],
}

STATIC_TOOL_NAMES: tuple[str, ...] = (
    "Bash", "Write", "Edit", "Read", "Grep", "Glob",
    "TaskCreate", "TaskList", "TaskGet", "TaskUpdate", "ToolStop",
    "ScheduleCreate", "ScheduleView", "ScheduleList", "ScheduleDelete",
    "run_workflow", "run_agent_flow",
)


def resolve_permission_policy(raw: dict | None) -> dict:
    """config.permissions v2（意图）→ 运行时执行规格（事实）。缺省=现状行为。"""
    r = raw or {}
    master = r.get("master") is True
    tools = r.get("tools") or {}
    deny_tools = [n for n in STATIC_TOOL_NAMES if tools.get(n) == "deny"]
    ask_tools = [n for n in STATIC_TOOL_NAMES if tools.get(n) == "ask"]
    guards = r.get("guards") or {}
    bash_ask: list[str] = []
    bash_deny: list[str] = []
    for cat_id, rule_ids in GUARD_CATEGORIES.items():
        cat = guards.get(cat_id) or {}
        if cat.get("enabled", True) is False:
            continue
        rule_over = cat.get("rules") or {}
        for rid in rule_ids:
            pattern, default_handling, _risk = GUARD_RULES[rid]
            if pattern is None:
                continue  # 解析器层规则 P2 前不进入执行规格
            handling = rule_over.get(rid) or default_handling
            (bash_deny if handling == "deny" else bash_ask).append(pattern)
    sensitive_globs: list[str] = []
    if r.get("sensitive_enabled") is True:
        sensitive_globs = [g for g in (r.get("sensitive_paths") or []) if isinstance(g, str) and g]
    return {
        "version": 2,
        "mode": "accept_edits" if master else "bypass",
        "master": master,
        "deny_tools": deny_tools,
        "ask_tools": ask_tools,
        "bash_ask_patterns": sorted(set(bash_ask)),
        "bash_deny_patterns": sorted(set(bash_deny)),
        "sensitive_globs": sensitive_globs,
        "enterprise": r.get("enterprise") is True,
    }
