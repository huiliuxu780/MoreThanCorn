"""SDD-12 P0-06 冻结契约层——错误码、状态词表、API v2 面、错误信封。

本模块是规格 §13.4（错误契约）、§11（生命周期/健康词表）、§13.1–13.3（API v2 面）
在代码中的唯一冻结事实源：

- 任何增删改必须先在 SDD-12 §20 登记变更原因与影响，再同步本模块与
  `server/tests/test_sdd12_contracts.py`（逐字断言，防静默漂移）。
- P1/P2 实现 v2 路由与 Catalog 时必须从这里导入词表，不得另行定义。
- 明文 Secret 永远不得进入 message/details（安全不变量 §15.2.4 / 验收 B-04）。
"""
from __future__ import annotations

# ---------- §13.4 最小错误码表（冻结） ----------

ERROR_CODES = frozenset({
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

# ---------- §11 生命周期与健康词表（冻结） ----------

CONNECTION_LIFECYCLE = ("draft", "active", "disabled", "archived")
RESOURCE_LIFECYCLE = ("draft", "published", "disabled", "deprecated", "archived")
RESOURCE_VERSION_STATUS = ("draft", "published", "deprecated")

# §11.2 健康度：生命周期与健康分离（AR-07），untested 不得显示为 healthy
HEALTH_STATES = ("untested", "healthy", "degraded", "failed", "stale")

# §11.3 CheckRun
CHECK_SCOPES = ("connection", "resource")
CHECK_PURPOSES = ("connectivity", "auth", "discover", "inference", "query", "execute")
CHECK_STATUSES = ("succeeded", "failed", "partial")

# §5.3 SecretRevision
SECRET_REVISION_STATUS = ("active", "retired", "compromised")

# §13.5 OperationRun / §9.3 SyncRun
RUN_STATUSES = ("queued", "running", "succeeded", "partial", "failed", "cancelled")

# §12 CallRecord.purpose
CALL_PURPOSES = ("test", "runtime", "discover", "sync")


def error_detail(code: str, message: str, *, path: str | None = None,
                 trace_id: str | None = None, details: dict | None = None) -> dict:
    """构造规格 §13.4 的统一错误信封（作为 HTTPException(status, detail) 的 detail）。"""
    if code not in ERROR_CODES:
        raise ValueError(f"未冻结的错误码：{code}（新增须先登记 SDD-12 §20）")
    d: dict = {"code": code, "message": message}
    if path:
        d["path"] = path
    if trace_id:
        d["traceId"] = trace_id
    if details:
        d["details"] = details
    return d


# ---------- §13.1–13.3 API v2 路由面（冻结；P1 起实现必须逐条对齐） ----------

API_V2_ROUTES = (
    # 13.1 Connector Definitions
    ("GET", "/api/v2/connector-definitions"),
    ("GET", "/api/v2/connector-definitions/{key}/{version}"),
    # 13.2 Connections
    ("GET", "/api/v2/connections"),
    ("POST", "/api/v2/connections"),
    ("GET", "/api/v2/connections/{id}"),
    ("PATCH", "/api/v2/connections/{id}"),
    ("POST", "/api/v2/connections/{id}/environments"),
    ("PATCH", "/api/v2/connections/{id}/environments/{code}"),
    ("POST", "/api/v2/connections/{id}/environments/{code}/secret:rotate"),
    ("POST", "/api/v2/connections/{id}/environments/{code}/secret:clear"),
    ("POST", "/api/v2/connections/{id}/environments/{code}:check"),
    ("GET", "/api/v2/connections/{id}/usage"),
    ("POST", "/api/v2/connections/{id}:disable"),
    ("DELETE", "/api/v2/connections/{id}"),
    # 13.3 Resources
    ("GET", "/api/v2/resources"),
    ("POST", "/api/v2/resources"),
    ("GET", "/api/v2/resources/{id}"),
    ("PATCH", "/api/v2/resources/{id}"),
    ("POST", "/api/v2/resources/{id}/versions"),
    ("GET", "/api/v2/resources/{id}/versions/{versionId}"),
    ("PATCH", "/api/v2/resources/{id}/versions/{versionId}"),
    ("POST", "/api/v2/resources/{id}/versions/{versionId}:check"),
    ("POST", "/api/v2/resources/{id}/versions/{versionId}:discover"),
    ("POST", "/api/v2/resources/{id}/versions/{versionId}:publish"),
    ("POST", "/api/v2/resources/{id}:disable"),
    ("GET", "/api/v2/resources/{id}/usage"),
    ("DELETE", "/api/v2/resources/{id}"),
    ("POST", "/api/v2/resources/{id}/versions/{versionId}/mcp:discover"),
    ("POST", "/api/v2/resources/{id}/versions/{versionId}/mcp:call"),
    ("POST", "/api/v2/resources/{id}/versions/{versionId}/knowledge:sync"),
    ("POST", "/api/v2/resources/{id}/versions/{versionId}/knowledge:query"),
    ("POST", "/api/v2/resources/{id}/versions/{versionId}/model:inference-check"),
    # 13.5 OperationRun
    ("GET", "/api/v2/operation-runs/{id}"),
    ("POST", "/api/v2/operation-runs/{id}:cancel"),
)
