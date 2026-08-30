"""Build an administrator-reviewed ResultRuleSet create payload.

This module deliberately does not call the platform API. Publishing a rule set is
an administrative control-plane action; Agent 2 only receives its immutable
ResultRuleVersion snapshot at run time.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


def build_result_rule_set_create_payload(
    snapshot: dict[str, Any],
    *,
    agent_id: str,
    name: str = "DSH 热线质检规则 v1",
    description: str = "10 条候选质检规则；管理员审核发布后供 Agent 2 只读执行。",
) -> dict[str, Any]:
    if not agent_id.strip():
        raise ValueError("agent_id is required")
    if snapshot.get("readOnlyAtRuntime") is not True:
        raise ValueError("rule snapshot must set readOnlyAtRuntime=true")
    evaluation_rules = snapshot.get("evaluationRules")
    if not isinstance(evaluation_rules, list) or not evaluation_rules:
        raise ValueError("rule snapshot must contain evaluationRules")

    return {
        "name": name,
        "description": description,
        "agentId": agent_id,
        "rules": {
            "schemaVersion": snapshot.get("schema_version", "1.0"),
            "ruleSetId": snapshot["ruleSetId"],
            "readOnlyAtRuntime": True,
            "evaluationRules": deepcopy(evaluation_rules),
            "scoreRules": deepcopy(snapshot.get("scoreRules", [])),
            "issueRules": deepcopy(snapshot.get("issueRules", [])),
        },
    }
