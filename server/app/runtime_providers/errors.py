"""Runtime Provider 错误映射（SDD 10 §12.2）。

平台错误码与默认可重试性集中在此；Gateway 与 worker 都只消费 RuntimeProviderError。
"""
from __future__ import annotations

from quality_runtime_contract import ErrorCode as ContractErrorCode
from quality_runtime_contract import RuntimeError as ContractRuntimeError


class RuntimeProviderError(Exception):
    """平台侧 Provider 调用异常：携带平台错误码 + 可重试标记。"""

    def __init__(self, code: str, message: str, *, retryable: bool = False,
                 details: dict | None = None):
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details or {}
        super().__init__(f"{code}: {message}")


# contract ErrorCode → (平台错误码, 默认可重试)（SDD 10 §12.2 原表）
CONTRACT_ERROR_MAP: dict[str, tuple[str, bool]] = {
    ContractErrorCode.INVALID_REQUEST: ("RUNTIME_INVALID_REQUEST", False),
    ContractErrorCode.AGENT_SPEC_INVALID: ("AGENT_SPEC_INVALID", False),
    ContractErrorCode.PROVIDER_UNAVAILABLE: ("RUNTIME_PROVIDER_UNAVAILABLE", True),
    ContractErrorCode.MODEL_ERROR: ("MODEL_ERROR", False),
    ContractErrorCode.TOOL_ERROR: ("TOOL_ERROR", False),
    ContractErrorCode.OUTPUT_SCHEMA_ERROR: ("OUTPUT_SCHEMA_ERROR", False),
    ContractErrorCode.TIMEOUT: ("RUNTIME_TIMEOUT", False),
    ContractErrorCode.CANCELLED: ("RUN_CANCELLED", False),
    ContractErrorCode.INTERNAL_ERROR: ("RUNTIME_INTERNAL_ERROR", True),
}

# 非 2xx 且无 contract 错误体时的 HTTP 状态兜底映射
HTTP_STATUS_MAP: dict[int, tuple[str, bool]] = {
    400: ("RUNTIME_INVALID_REQUEST", False),
    401: ("RUNTIME_PROVIDER_UNAVAILABLE", False),
    403: ("RUNTIME_PROVIDER_UNAVAILABLE", False),
    404: ("PROVIDER_RUN_NOT_FOUND", False),
    409: ("RUNTIME_IDEMPOTENCY_CONFLICT", False),
    408: ("RUNTIME_TIMEOUT", False),
}


def map_contract_error(err: ContractRuntimeError) -> RuntimeProviderError:
    platform_code, retryable = CONTRACT_ERROR_MAP.get(
        str(err.code), ("RUNTIME_INTERNAL_ERROR", True))
    return RuntimeProviderError(platform_code, err.message,
                                retryable=retryable or err.retryable, details=err.details)


class ProviderErrorBody(dict):
    """宽容解析 Provider 结构化错误体（contract 严格模型之外的容错层）。"""

    @classmethod
    def parse(cls, raw) -> "ContractRuntimeError | None":
        if not isinstance(raw, dict) or not raw.get("code"):
            return None
        try:
            return ContractRuntimeError(
                code=str(raw["code"]), message=str(raw.get("message") or "provider error"),
                retryable=bool(raw.get("retryable", False)),
                details=raw.get("details") or {})
        except Exception:  # noqa: BLE001 —— 非法错误体返回 None，走 HTTP 兜底映射
            return None


def map_http_status(status: int, raw: str) -> RuntimeProviderError:
    platform_code, retryable = HTTP_STATUS_MAP.get(
        status, ("RUNTIME_PROVIDER_UNAVAILABLE" if status >= 500 else "RUNTIME_INTERNAL_ERROR",
                 status >= 500))
    return RuntimeProviderError(platform_code, f"provider http {status}", retryable=retryable,
                                details={"body": raw[:200]})


def map_error_response(resp) -> RuntimeProviderError:
    """非预期 HTTP 状态：优先按 Contract 错误体映射，否则按状态码兜底。"""
    try:
        body = resp.json()
    except ValueError:
        return map_http_status(resp.status_code, resp.text)
    err = ProviderErrorBody.parse((body or {}).get("error"))
    if err is not None:
        return map_contract_error(err)
    return map_http_status(resp.status_code, resp.text)
