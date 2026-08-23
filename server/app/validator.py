"""Validator — 07-workflow-dsl.md §5 七规则；issue kind 与产品 checkList 对齐
（nodeConnectIncomplete→unconnected / nodeUnconfigured→unconfigured）。"""
from __future__ import annotations

import re

from .registry import BY_TYPE, TERMINAL_TYPES, required_config_fields
from .schemas import ValidationIssue, ValidationReport, WorkflowDefinition

REF_PATTERN = re.compile(r"#\{\{\s*([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_.-]+)\s*\}\}")


def _ancestors(nodes, edges) -> dict[str, set[str]]:
    """node_id -> 全部拓扑前序节点 id 集合（累积继承，07 §6b）。"""
    parents: dict[str, set[str]] = {n.id: set() for n in nodes}
    for e in edges:
        parents.setdefault(e.target, set()).add(e.source)
    memo: dict[str, set[str]] = {}

    def reach(nid: str, seen: set[str]) -> set[str]:
        if nid in memo:
            return memo[nid]
        acc: set[str] = set()
        for p in parents.get(nid, ()):  # 防环死循环
            if p in seen:
                continue
            acc.add(p)
            acc |= reach(p, seen | {nid})
        memo[nid] = acc
        return acc

    return {n.id: reach(n.id, {n.id}) for n in nodes}


def _has_cycle(nodes, edges) -> bool:
    color: dict[str, int] = {n.id: 0 for n in nodes}
    adj: dict[str, list[str]] = {n.id: [] for n in nodes}
    for e in edges:
        adj.setdefault(e.source, []).append(e.target)

    def dfs(u: str) -> bool:
        color[u] = 1
        for v in adj.get(u, []):
            if color.get(v) == 1:
                return True
            if color.get(v) == 0 and dfs(v):
                return True
        color[u] = 2
        return False

    return any(color[n] == 0 and dfs(n) for n in [n.id for n in nodes])


def validate(defn: WorkflowDefinition) -> ValidationReport:
    issues: list[ValidationIssue] = []
    nodes = defn.graph.nodes
    edges = defn.graph.edges
    by_id = {n.id: n for n in nodes}

    # R1: 恰一个 input；≥1 终端
    starts = [n for n in nodes if n.type == "input"]
    if len(starts) != 1:
        for n in starts or [nodes[0] if nodes else None]:
            if n:
                issues.append(ValidationIssue(nodeId=n.id, kind="graph",
                                              message=f"必须恰有一个开始节点（当前 {len(starts)} 个）"))
    terminals = [n for n in nodes if n.type in TERMINAL_TYPES]
    if not terminals and nodes:
        issues.append(ValidationIssue(nodeId=starts[0].id if starts else nodes[0].id, kind="graph",
                                      message="缺少结束/副作用终端节点"))

    # R2: 无环；无孤儿
    if _has_cycle(nodes, edges):
        issues.append(ValidationIssue(nodeId=nodes[0].id, kind="graph", message="存在循环连接"))
    connected: set[str] = set()
    for e in edges:
        connected.add(e.source)
        connected.add(e.target)
    for n in nodes:
        if len(nodes) > 1 and n.id not in connected and n.type != "input":
            issues.append(ValidationIssue(nodeId=n.id, kind="unconnected", message="节点未连接完整"))

    anc = _ancestors(nodes, edges)

    # R3: 非 input 节点必填 config 完整；inputs 绑定存在
    for n in nodes:
        if n.type == "input":
            continue
        for f in required_config_fields(n.type):
            val = n.config.get(f)
            if val in (None, "", []):
                issues.append(ValidationIssue(nodeId=n.id, kind="unconfigured",
                                              message=f"节点未完整配置：{f}"))
        for b in n.inputs:
            if b.source.kind == "upstream" and b.source.nodeId not in anc.get(n.id, set()):
                issues.append(ValidationIssue(nodeId=n.id, kind="unconfigured",
                                              message=f"输入 {b.name} 引用了不可达的上游节点"))

    # R4: llm.prompt 引用可达
    for n in nodes:
        if n.type != "llm":
            continue
        prompt = str(n.config.get("prompt", ""))
        for m in REF_PATTERN.finditer(prompt):
            if m.group(1) not in anc.get(n.id, set()):
                issues.append(ValidationIssue(nodeId=n.id, kind="unconfigured",
                                              message=f"提示词引用了不可达节点 {m.group(1)}"))

    # R5: tool.toolVersionId 存在（P0：非空即视为存在；P1 查库 ready）
    for n in nodes:
        if n.type == "tool" and not n.config.get("toolVersionId"):
            issues.append(ValidationIssue(nodeId=n.id, kind="dependency", message="Tool 引用无效"))

    # R5b: knowledge-retrieval / mcp-call 资源存在且 Enabled
    from .db import SessionLocal
    from .models import KnowledgeSource, McpServer
    db = SessionLocal()
    try:
        for n in nodes:
            if n.type == "knowledge-retrieval":
                ks = db.get(KnowledgeSource, n.config.get("knowledgeSourceId", ""))
                if not ks or ks.status != "enabled":
                    issues.append(ValidationIssue(nodeId=n.id, kind="dependency",
                                                  message="Knowledge Source 不存在或已停用"))
            if n.type == "mcp-call":
                srv = db.get(McpServer, n.config.get("mcpServerId", ""))
                if not srv or srv.status != "enabled":
                    issues.append(ValidationIssue(nodeId=n.id, kind="dependency",
                                                  message="MCP Server 不存在或已停用"))
                elif n.config.get("toolName") and (srv.discovered_tools or []) and \
                        n.config["toolName"] not in [t.get("name") for t in srv.discovered_tools]:
                    issues.append(ValidationIssue(nodeId=n.id, kind="dependency",
                                                  message=f"MCP 工具 {n.config['toolName']} 不在已发现工具列表"))
    finally:
        db.close()

    # R6: structuredOutputs 每个 key 恰被一个节点产出
    producers: dict[str, int] = {}
    for n in nodes:
        key = n.config.get("outputKey")
        if key:
            producers[key] = producers.get(key, 0) + 1
    for so in defn.io.structuredOutputs:
        c = producers.get(so.key, 0)
        if c != 1:
            anchor = terminals[0].id if terminals else (nodes[0].id if nodes else "graph")
            issues.append(ValidationIssue(nodeId=anchor, kind="unconfigured",
                                          message=f"结构化输出 {so.key} 的产出节点数={c}（应=1）"))

    # R7: condition.branches 与出边 handle 一一对应
    for n in nodes:
        if n.type != "condition":
            continue
        out_handles = {e.sourceHandle for e in edges if e.source == n.id and e.sourceHandle}
        declared = set(n.branches)
        if declared and out_handles and declared != out_handles:
            issues.append(ValidationIssue(nodeId=n.id, kind="graph",
                                          message="条件分支与出边 handle 不一致"))
        if not n.config.get("branches"):
            issues.append(ValidationIssue(nodeId=n.id, kind="unconfigured", message="条件未配置"))

    return ValidationReport(ok=not issues, issues=issues)
