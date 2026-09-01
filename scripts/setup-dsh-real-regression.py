#!/usr/bin/env python3
"""Maintain the real DSH regression control-plane objects through platform APIs.

No database row is written directly by this script.  Connections, resources,
immutable versions, releases, rules and tasks all go through the same HTTP API
used by the product UI.  Exact names make the operation idempotent.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import httpx


REPO_ROOT = Path(__file__).resolve().parents[1]
DATASET_DIR = (
    REPO_ROOT
    / "poc/agent_runtime_providers/.artifacts/real_datasets/dsh-independent-real-v1"
)

NAMES = {
    "connection": "DSH真实回归库",
    "datasource": "DSH真实回归数据源",
    "asset": "DSH真实回归集V1",
    "definition": "DSH真实回归输入V1",
    "consumer_agent": "DSH消费者分析",
    "quality_agent": "DSH规则质检",
    "rules": "DSH回归候选规则V1",
    "consumer_pilot": "DSH消费者试跑V1",
    "quality_pilot": "DSH质检试跑V1",
    "consumer_full": "DSH消费者全量V1",
    "quality_full": "DSH质检全量V1",
    "recording_tool": "lydaas_recording_lookup_v2",
}


class Platform:
    def __init__(self, base_url: str) -> None:
        self.client = httpx.Client(base_url=base_url.rstrip("/"), timeout=30)

    def request(self, method: str, path: str, **kwargs) -> Any:
        response = self.client.request(method, path, **kwargs)
        if response.is_error:
            # Platform responses contain configuration metadata, never local record
            # bodies on these endpoints.  Still bound the diagnostic.
            raise RuntimeError(
                f"{method} {path} -> HTTP {response.status_code}: {response.text[:1200]}"
            )
        return response.json()

    def exact(self, path: str, name: str) -> dict | None:
        payload = self.request("GET", path, params={"pageSize": 100, "search": name})
        items = payload.get("items", payload if isinstance(payload, list) else [])
        return next((row for row in items if row.get("name") == name), None)


def _ensure_connection(api: Platform) -> str:
    existing = api.exact("/api/connections", NAMES["connection"])
    expected_endpoint = {
        "host": "127.0.0.1",
        "port": 5432,
        "user": "rivers",
        "database": "wf_dev",
    }
    if existing:
        cid = existing["id"]
        if existing.get("protocol") != "postgresql" or existing.get("endpoint") != expected_endpoint:
            api.request(
                "PUT",
                f"/api/connections/{cid}",
                json={"kind": "none", "protocol": "postgresql", "endpoint": expected_endpoint},
            )
    else:
        created = api.request(
            "POST",
            "/api/connections",
            json={
                "name": NAMES["connection"],
                "kind": "none",
                "protocol": "postgresql",
                "endpoint": expected_endpoint,
            },
        )
        cid = created["id"]
    checked = api.request("POST", f"/api/connections/{cid}/test", json={})
    if checked.get("ok") is not True:
        raise RuntimeError("platform PostgreSQL Connection test failed")
    api.request("POST", f"/api/connections/{cid}:enable")
    return cid


def _ensure_resource(
    api: Platform,
    *,
    collection_path: str,
    name: str,
    create_payload: dict,
) -> tuple[str, dict]:
    existing = api.exact(collection_path, name)
    row = existing or api.request("POST", collection_path, json=create_payload)
    return row["id"], row


def _test_and_enable_resource(api: Platform, collection_path: str, rid: str) -> dict:
    checked = api.request("POST", f"{collection_path}/{rid}/test", json={})
    if checked.get("ok") is not True:
        raise RuntimeError(f"resource test failed for {collection_path}/{rid}")
    api.request("POST", f"{collection_path}/{rid}/toggle", json={"enabled": True})
    return checked


def _ensure_data_plane(api: Platform, connection_id: str) -> tuple[str, str, str, str]:
    ds_path = "/api/data-resources/datasources"
    datasource_id, _ = _ensure_resource(
        api,
        collection_path=ds_path,
        name=NAMES["datasource"],
        create_payload={
            "name": NAMES["datasource"],
            "description": "20通本地真实热线回归数据；personal-data-local-only。",
            "type": "postgresql",
            "connectionId": connection_id,
            "location": "wf_dev",
            "config": {"schema": "public"},
        },
    )
    _test_and_enable_resource(api, ds_path, datasource_id)

    asset_path = "/api/data-resources/assets"
    asset_id, _ = _ensure_resource(
        api,
        collection_path=asset_path,
        name=NAMES["asset"],
        create_payload={
            "name": NAMES["asset"],
            "description": "冻结数据集 dsh-independent-real-v1：20条/1413消息。",
            "datasourceId": datasource_id,
            "location": "dsh_real_regression_v1",
            "recordMeaning": "一通真实热线交互",
            "recordIdField": "sample_id",
            "timeField": "interaction_time",
        },
    )
    asset_check = _test_and_enable_resource(api, asset_path, asset_id)
    if (asset_check.get("output") or {}).get("sampled") != 20:
        raise RuntimeError("platform Data Asset count is not the frozen 20 cases")

    existing = api.exact(
        f"/api/data-definitions?assetId={asset_id}", NAMES["definition"]
    )
    fields = [
        {"key": "sample_id", "displayName": "样本ID", "type": "String", "required": True},
        {"key": "dataset_id", "displayName": "数据集ID", "type": "String", "required": True},
        {
            "key": "interaction_time",
            "displayName": "交互时间",
            "type": "DateTime",
            "required": True,
        },
        {
            "key": "canonical_call",
            "displayName": "标准热线输入",
            "type": "Object",
            "required": True,
        },
        {"key": "raw_sha256", "displayName": "原文哈希", "type": "String", "required": True},
        {
            "key": "canonical_sha256",
            "displayName": "标准输入哈希",
            "type": "String",
            "required": True,
        },
    ]
    if existing:
        definition_id = existing["id"]
        detail = api.request("GET", f"/api/data-definitions/{definition_id}")
        if detail.get("fieldSchema") != fields:
            api.request(
                "PUT",
                f"/api/data-definitions/{definition_id}",
                json={"fieldSchema": fields, "eligibility": []},
            )
            definition_version_id = api.request(
                "POST", f"/api/data-definitions/{definition_id}/publish"
            )["versionId"]
        elif detail.get("latestVersionId"):
            definition_version_id = detail["latestVersionId"]
        else:
            definition_version_id = api.request(
                "POST", f"/api/data-definitions/{definition_id}/publish"
            )["versionId"]
    else:
        created = api.request(
            "POST",
            "/api/data-definitions",
            json={
                "name": NAMES["definition"],
                "assetId": asset_id,
                "fieldSchema": fields,
                "eligibility": [],
            },
        )
        definition_id = created["id"]
        definition_version_id = api.request(
            "POST", f"/api/data-definitions/{definition_id}/publish"
        )["versionId"]
    return datasource_id, asset_id, definition_id, definition_version_id


def _ensure_recording_tool(api: Platform) -> tuple[str, str]:
    gateway = api.exact("/api/connections", "browser-accept-gw")
    if not gateway or not gateway.get("secretConfigured"):
        raise RuntimeError("browser-accept-gw Connection/credential is unavailable")
    path = "/api/ai-resources/tools"
    tool_id, _ = _ensure_resource(
        api,
        collection_path=path,
        name=NAMES["recording_tool"],
        create_payload={
            "name": NAMES["recording_tool"],
            "description": "按 acid 查询热线录音 OSS 临时地址；仅注册，不挂载本轮 no-tools Agent。",
            "kind": "http",
            "connectionId": gateway["id"],
            "inputSchema": {
                "type": "object",
                "additionalProperties": False,
                "required": ["arg0", "arg1"],
                "properties": {
                    "arg0": {"type": "string", "minLength": 1},
                    "arg1": {"type": "string", "minLength": 1, "description": "acid"},
                },
            },
            "outputSchema": {
                "type": "object",
                "required": ["success", "data"],
                "properties": {"success": {"type": "boolean"}, "data": {"type": "object"}},
            },
            "spec": {
                "request": {
                    "method": "POST",
                    "url": "https://gateway.lydaas.com/api/hsf/xspace-openapi-proxy/HotlineProxyService/listRecordV2",
                }
            },
        },
    )
    # Testing this Tool would transmit a real tenant_id + acid to an external
    # gateway.  Registration is in scope, but that external data transfer needs
    # separate explicit approval.  Keep it disabled/untested; neither no-tools
    # Agent mounts it in this regression.
    return tool_id, "not_run_external_data_approval_required"


def _runtime_provider(api: Platform) -> str:
    rows = api.request("GET", "/api/runtime-providers").get("items") or []
    candidates = [r for r in rows if r.get("kind") == "deepseek-harness"]
    if len(candidates) != 1:
        raise RuntimeError(f"expected exactly one deepseek-harness provider, found {len(candidates)}")
    provider = candidates[0]
    if provider.get("status") != "enabled":
        raise RuntimeError("deepseek-harness provider is not enabled")
    return provider["id"]


def _ensure_agent(api: Platform, name: str, module_key: str, provider_id: str) -> tuple[str, str]:
    quality_agent = module_key == "dsh-quality-rules-analysis"
    model_ref = {
        "modelId": "qwen3.8-max",
        "provider": "openai-compatible",
        # DSH adapter v0.3 explicitly disables qwen3.8-max thinking through
        # the DashScope compatibility bridge.  Quality needs room for ten
        # complete rule objects; consumer analysis already fits in 2048.
        "parameters": {"max_tokens": 4096 if quality_agent else 2048},
    }
    if quality_agent:
        purpose = (
            "这是结构化回归，思考模式已关闭。直接输出最终JSON；reason每项不超过60个汉字，"
            "summary不超过120个汉字，每项最多1条关键证据，excerpt不超过40个汉字。"
        )
    else:
        purpose = (
            "这是结构化回归，不展开思考过程。直接输出最终JSON；reason每项不超过80个汉字，"
            "summary不超过200个汉字，每项最多2条证据，excerpt不超过80个汉字。"
        )
    expected_config = {"spec": {}, "modelRef": model_ref, "purpose": purpose}
    existing = api.exact("/api/agents", name)
    if existing:
        if existing.get("moduleKey") != module_key:
            raise RuntimeError(f"Agent {name} exists with a different Module")
        agent_id = existing["id"]
    else:
        created = api.request(
            "POST",
            "/api/agents",
            json={
                "name": name,
                "description": "DSH真实数据回归专用；两个Agent相互独立、禁用工具。",
                "moduleKey": module_key,
                "moduleVersion": "1.0.0",
                "spec": {},
                "modelRef": model_ref,
            },
        )
        agent_id = created["id"]
    detail = api.request("GET", f"/api/agents/{agent_id}")
    config_changed = detail.get("config") != expected_config
    if config_changed:
        api.request(
            "PUT",
            f"/api/agents/{agent_id}",
            json={
                "expectedRevision": detail.get("configRevision"),
                "config": expected_config,
            },
        )
    versions = api.request("GET", f"/api/agents/{agent_id}/versions")
    if versions and not config_changed:
        version_id = versions[0]["versionId"]
        version_no = versions[0]["versionNo"]
    else:
        created_version = api.request(
            "POST",
            f"/api/agents/{agent_id}/versions",
            json={"note": "DSH真实数据回归V1；no-tools"},
        )
        version_id = created_version["versionId"]
        version_no = created_version["versionNo"]
    releases = api.request("GET", f"/api/agents/{agent_id}/releases")
    active = next(
        (
            row
            for row in releases
            if row.get("status") == "active"
            and row.get("environment") == "sandbox"
            and row.get("versionNo") == version_no
        ),
        None,
    )
    if not active:
        api.request(
            "POST",
            f"/api/agents/{agent_id}/releases",
            json={
                "environment": "sandbox",
                "versionId": version_id,
                "runtimeProviderId": provider_id,
                "runtimeProfile": "independent_no_tools_v1",
                "canaryPercent": 0,
            },
        )
    return agent_id, version_id


def _ensure_rules(api: Platform, quality_agent_id: str) -> tuple[str, str]:
    snapshot = json.loads((DATASET_DIR / "quality_rules_snapshot.json").read_text())
    # Preserve the evaluation/score/issue contract while making the platform field
    # spelling explicit.  This is a regression candidate, not approved policy.
    rules = {
        "schemaVersion": snapshot["schema_version"],
        "ruleSetId": snapshot["ruleSetId"],
        "readOnlyAtRuntime": True,
        "evaluationRules": snapshot["evaluationRules"],
        "scoreRules": snapshot["scoreRules"],
        "issueRules": snapshot["issueRules"],
    }
    existing = api.exact("/api/result-rules", NAMES["rules"])
    if existing:
        rule_set_id = existing["id"]
        detail = api.request("GET", f"/api/result-rules/{rule_set_id}")
        if detail.get("rules") != rules:
            api.request(
                "PUT",
                f"/api/result-rules/{rule_set_id}",
                json={"name": NAMES["rules"], "rules": rules},
            )
            detail = {"versions": []}
    else:
        created = api.request(
            "POST",
            "/api/result-rules",
            json={
                "name": NAMES["rules"],
                "description": "仅用于真实数据技术回归；POC候选规则，不代表已审批生产政策。",
                "agentId": quality_agent_id,
                "rules": rules,
            },
        )
        rule_set_id = created["id"]
        detail = {"versions": []}
    versions = detail.get("versions") or []
    if versions:
        rule_version_id = versions[0]["id"]
    else:
        rule_version_id = api.request(
            "POST", f"/api/result-rules/{rule_set_id}/publish"
        )["ruleVersionId"]
    return rule_set_id, rule_version_id


def _ensure_task(
    api: Platform,
    *,
    name: str,
    agent_id: str,
    agent_version_id: str,
    asset_id: str,
    definition_id: str,
    definition_version_id: str,
    sampling: dict,
    rule_set_id: str | None = None,
    rule_version_id: str | None = None,
) -> str:
    existing = api.exact("/api/tasks", name)
    if existing:
        task_id = existing["id"]
        detail = api.request("GET", f"/api/tasks/{task_id}")
        target = (detail.get("taskVersion") or {}).get("executionTarget") or {}
        if target.get("pinnedAgentVersionId") != agent_version_id:
            api.request(
                "PUT",
                f"/api/tasks/{task_id}",
                json={
                    "executionTarget": {
                        "type": "agent",
                        "agentId": agent_id,
                        "versionPolicy": "pinned",
                        "pinnedAgentVersionId": agent_version_id,
                    },
                    "note": "模型输出预算收敛后的不可变任务版本",
                },
            )
        return task_id
    payload = {
        "name": name,
        "description": "真实回归任务；输入固定到dsh-independent-real-v1。",
        "executionTarget": {
            "type": "agent",
            "agentId": agent_id,
            "versionPolicy": "pinned",
            "pinnedAgentVersionId": agent_version_id,
        },
        "dataAssetId": asset_id,
        "dataDefinitionId": definition_id,
        "dataDefinitionVersionId": definition_version_id,
        "inputMapping": {"$": "canonical_call"},
        "scope": {"op": "and", "conditions": []},
        "sampling": sampling,
        "dataWindow": {"mode": "all"},
        "rulePolicy": "pinned" if rule_version_id else "none",
    }
    if rule_version_id:
        payload["resultRuleSetId"] = rule_set_id
        payload["resultRuleVersionId"] = rule_version_id
    return api.request("POST", "/api/tasks", json=payload)["id"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8120")
    args = parser.parse_args()
    api = Platform(args.api)

    connection_id = _ensure_connection(api)
    datasource_id, asset_id, definition_id, definition_version_id = _ensure_data_plane(
        api, connection_id
    )
    recording_tool_id, recording_tool_test_status = _ensure_recording_tool(api)
    provider_id = _runtime_provider(api)
    consumer_agent_id, consumer_version_id = _ensure_agent(
        api, NAMES["consumer_agent"], "dsh-consumer-analysis", provider_id
    )
    quality_agent_id, quality_version_id = _ensure_agent(
        api, NAMES["quality_agent"], "dsh-quality-rules-analysis", provider_id
    )
    rule_set_id, rule_version_id = _ensure_rules(api, quality_agent_id)

    task_ids = {
        "consumer_pilot": _ensure_task(
            api,
            name=NAMES["consumer_pilot"],
            agent_id=consumer_agent_id,
            agent_version_id=consumer_version_id,
            asset_id=asset_id,
            definition_id=definition_id,
            definition_version_id=definition_version_id,
            sampling={"mode": "count", "count": 1},
        ),
        "quality_pilot": _ensure_task(
            api,
            name=NAMES["quality_pilot"],
            agent_id=quality_agent_id,
            agent_version_id=quality_version_id,
            asset_id=asset_id,
            definition_id=definition_id,
            definition_version_id=definition_version_id,
            sampling={"mode": "count", "count": 1},
            rule_set_id=rule_set_id,
            rule_version_id=rule_version_id,
        ),
        "consumer_full": _ensure_task(
            api,
            name=NAMES["consumer_full"],
            agent_id=consumer_agent_id,
            agent_version_id=consumer_version_id,
            asset_id=asset_id,
            definition_id=definition_id,
            definition_version_id=definition_version_id,
            sampling={"mode": "all"},
        ),
        "quality_full": _ensure_task(
            api,
            name=NAMES["quality_full"],
            agent_id=quality_agent_id,
            agent_version_id=quality_version_id,
            asset_id=asset_id,
            definition_id=definition_id,
            definition_version_id=definition_version_id,
            sampling={"mode": "all"},
            rule_set_id=rule_set_id,
            rule_version_id=rule_version_id,
        ),
    }
    print(
        json.dumps(
            {
                "connection_id": connection_id,
                "datasource_id": datasource_id,
                "asset_id": asset_id,
                "definition_version_id": definition_version_id,
                "recording_tool_id": recording_tool_id,
                "recording_tool_test_status": recording_tool_test_status,
                "runtime_provider_id": provider_id,
                "consumer_agent_id": consumer_agent_id,
                "quality_agent_id": quality_agent_id,
                "rule_version_id": rule_version_id,
                "task_ids": task_ids,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
