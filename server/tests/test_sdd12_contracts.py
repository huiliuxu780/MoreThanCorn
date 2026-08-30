"""SDD-12 P0-06：冻结契约逐字断言。

本文件与 `server/app/contracts.py` 共同构成错误码/状态词表/API v2 面的机器门禁：
任何未登记于 SDD §20 的词表漂移都会在这里失败（验收 A-07 / H-12 基座）。
"""
from app import contracts


def test_error_codes_frozen_verbatim():
    assert contracts.ERROR_CODES == frozenset({
        "VALIDATION_FAILED",
        "REVISION_CONFLICT",
        "REFERENCE_CONFLICT",
        "SECRET_REVEAL_DISABLED",
        "SECRET_REQUIRED",
        "CONNECTION_NOT_FOUND",
        "CONNECTION_DISABLED",
        "CONNECTION_UNCHECKED",
        "CONNECTION_AUTH_FAILED",
        "CONNECTION_UNREACHABLE",
        "CONNECTOR_OPERATION_UNSUPPORTED",
        "RESOURCE_NOT_FOUND",
        "RESOURCE_VERSION_NOT_PUBLISHED",
        "RESOURCE_BINDING_INVALID",
        "RESOURCE_HEALTH_STALE",
        "MCP_DISCOVERY_FAILED",
        "MCP_TOOL_NOT_SELECTED",
        "MCP_TOOL_ERROR",
        "TOOL_INPUT_INVALID",
        "TOOL_OUTPUT_INVALID",
        "MODEL_PROVIDER_FAILED",
        "MODEL_INFERENCE_FAILED",
        "KNOWLEDGE_SYNC_FAILED",
        "KNOWLEDGE_QUERY_FAILED",
        "EGRESS_BLOCKED",
        "TIMEOUT",
        "RATE_LIMITED",
    })


def test_status_vocab_frozen_verbatim():
    # §11.1 生命周期
    assert contracts.CONNECTION_LIFECYCLE == ("draft", "active", "disabled", "archived")
    assert contracts.RESOURCE_LIFECYCLE == ("draft", "published", "disabled", "deprecated", "archived")
    assert contracts.RESOURCE_VERSION_STATUS == ("draft", "published", "deprecated")
    # §11.2 健康度（与生命周期分离，AR-07）
    assert contracts.HEALTH_STATES == ("untested", "healthy", "degraded", "failed", "stale")
    # §11.3 CheckRun
    assert contracts.CHECK_SCOPES == ("connection", "resource")
    assert contracts.CHECK_PURPOSES == ("connectivity", "auth", "discover", "inference", "query", "execute")
    assert contracts.CHECK_STATUSES == ("succeeded", "failed", "partial")
    # §5.3 SecretRevision
    assert contracts.SECRET_REVISION_STATUS == ("active", "retired", "compromised")
    # §13.5 OperationRun
    assert contracts.RUN_STATUSES == ("queued", "running", "succeeded", "partial", "failed", "cancelled")
    # §12 CallRecord.purpose
    assert contracts.CALL_PURPOSES == ("test", "runtime", "discover", "sync")


def test_api_v2_route_surface_frozen():
    routes = set(contracts.API_V2_ROUTES)
    # 关键路由抽样（§13.1–13.3/13.5）：缺失即说明契约面被改动
    for r in [("GET", "/api/v2/connector-definitions"),
              ("POST", "/api/v2/connections"),
              ("PATCH", "/api/v2/connections/{id}"),
              ("POST", "/api/v2/connections/{id}/environments/{code}/secret:rotate"),
              ("POST", "/api/v2/connections/{id}/environments/{code}/secret:clear"),
              ("POST", "/api/v2/connections/{id}/environments/{code}:check"),
              ("DELETE", "/api/v2/connections/{id}"),
              ("POST", "/api/v2/resources/{id}/versions/{versionId}:publish"),
              ("POST", "/api/v2/resources/{id}/versions/{versionId}/mcp:discover"),
              ("POST", "/api/v2/resources/{id}/versions/{versionId}/knowledge:sync"),
              ("POST", "/api/v2/resources/{id}/versions/{versionId}/model:inference-check"),
              ("GET", "/api/v2/operation-runs/{id}"),
              ("POST", "/api/v2/operation-runs/{id}:cancel")]:
        assert r in routes, r


def test_error_detail_envelope_shape():
    d = contracts.error_detail("CONNECTION_AUTH_FAILED", "鉴权失败", path="bindings[0]",
                               trace_id="t-1", details={"statusCode": 401})
    assert d == {"code": "CONNECTION_AUTH_FAILED", "message": "鉴权失败",
                 "path": "bindings[0]", "traceId": "t-1", "details": {"statusCode": 401}}
    # 未冻结码必须拒绝（防静默新增）
    try:
        contracts.error_detail("NOT_A_CODE", "x")
        raise AssertionError("应当拒绝未冻结错误码")
    except ValueError:
        pass
