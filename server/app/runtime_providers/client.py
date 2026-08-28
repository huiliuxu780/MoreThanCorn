"""Provider-neutral Runtime Gateway Client（SDD 10 R1-3 / §8）。

- 连接/读取超时分离；有界重试：仅连接类错误与 502/503/504，submit 以同一幂等键重试；
- request hash：sha256(规范化 JSON)，落 Run.runtime_request_hash；
- 响应一律经 Contract 严格校验（extra=forbid），坏响应视为 Provider 不可用；
- Provider 错误体 → §12.2 平台错误码映射；
- 日志只记录元数据（方法/路径/状态/耗时），禁止 body、Secret、PII；
- 出站统一过 Egress（非生产放行本地，生产强制拦截私网/元数据，与 LLM 路径同规则）。
"""
from __future__ import annotations

import hashlib
import json
import logging
import time

import httpx
from pydantic import ValidationError
from quality_runtime_contract import (
    HealthStatus,
    RunAccepted,
    RuntimeExecuteRequest,
    RuntimeRun,
)

from ..egress import EgressError, enforce_egress
from .errors import RuntimeProviderError, map_error_response

logger = logging.getLogger("runtime_gateway")

_RETRYABLE_STATUS = {502, 503, 504}


class RuntimeGatewayClient:
    """一个 Provider endpoint 对应一个 client 实例；每次请求使用独立短连接。"""

    def __init__(self, base_url: str, *, connect_timeout: float = 3.0,
                 read_timeout: float = 30.0, max_retries: int = 2,
                 transport: httpx.BaseTransport | None = None,
                 check_egress: bool = True):
        self.base_url = (base_url or "").rstrip("/")
        self._timeout = httpx.Timeout(connect=connect_timeout, read=read_timeout,
                                      write=10.0, pool=connect_timeout)
        self._max_retries = max(0, max_retries)
        self._transport = transport
        if check_egress and transport is None:
            try:
                enforce_egress(self.base_url)
            except EgressError as exc:
                raise RuntimeProviderError("RUNTIME_PROVIDER_UNAVAILABLE", str(exc),
                                           retryable=False) from exc

    # ---------- 基础 ----------

    @staticmethod
    def request_fingerprint(request: RuntimeExecuteRequest) -> str:
        payload = request.model_dump(mode="json")
        canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(canonical.encode()).hexdigest()

    def _log(self, method: str, path: str, status: int | None, attempt: int, ms: int) -> None:
        # PII/Secret 日志过滤：只允许元数据字段（SDD 10 §11.5 / 09 §6.9）
        logger.info("gateway %s %s -> %s (attempt=%s, %sms)", method, path, status,
                    attempt, ms)

    def _do(self, method: str, path: str, *, json_body: dict | None = None,
            expected: tuple[int, ...] = (200,), validate=None, retry: bool = True):
        last_error: RuntimeProviderError | None = None
        for attempt in range(self._max_retries + 1):
            t0 = time.monotonic()
            try:
                with httpx.Client(base_url=self.base_url, timeout=self._timeout,
                                  transport=self._transport) as client:
                    resp = client.request(method, path, json=json_body)
                self._log(method, path, resp.status_code, attempt,
                          int((time.monotonic() - t0) * 1000))
                if resp.status_code in expected:
                    return self._parse(resp, validate)
                if resp.status_code in _RETRYABLE_STATUS and retry and attempt < self._max_retries:
                    last_error = map_error_response(resp)
                    continue
                raise map_error_response(resp)
            except (httpx.TimeoutException, httpx.HTTPError) as exc:
                self._log(method, path, None, attempt, int((time.monotonic() - t0) * 1000))
                # 提交类超时状态未知：以同一幂等键重试是安全的（SDD 16.3）
                last_error = RuntimeProviderError("RUNTIME_PROVIDER_UNAVAILABLE",
                                                  f"provider {type(exc).__name__}",
                                                  retryable=True)
                if retry and attempt < self._max_retries:
                    continue
                raise last_error from exc
        raise last_error or RuntimeProviderError("RUNTIME_PROVIDER_UNAVAILABLE",
                                                 "provider unreachable", retryable=True)

    @staticmethod
    def _parse(resp: httpx.Response, validate):
        try:
            body = resp.json()
        except ValueError as exc:
            raise RuntimeProviderError("RUNTIME_PROVIDER_UNAVAILABLE",
                                       "provider returned non-JSON body", retryable=True) from exc
        if validate is None:
            return body
        try:
            return validate.model_validate(body)
        except ValidationError as exc:
            # 坏响应=Provider 实现缺陷：按不可用处理（可重试，由轮询恢复）
            raise RuntimeProviderError(
                "RUNTIME_PROVIDER_UNAVAILABLE",
                f"provider response failed contract validation ({exc.error_count()} error(s))",
                retryable=True) from exc

    # ---------- Contract 端点 ----------

    def submit(self, request: RuntimeExecuteRequest) -> RunAccepted:
        accepted = self._do(
            "POST", "/v1/runs", json_body=request.model_dump(mode="json"),
            expected=(200, 202), validate=RunAccepted, retry=True)
        # SDD 10 §5.7：平台 run.id 即发送给 Provider 的 run_id，Provider 不得另立
        if accepted.run_id != request.run_id:
            raise RuntimeProviderError("RUNTIME_INTERNAL_ERROR",
                                       f"provider run_id mismatch: {accepted.run_id}",
                                       retryable=False)
        return accepted

    def get_run(self, run_id: str) -> RuntimeRun:
        return self._do("GET", f"/v1/runs/{run_id}", expected=(200,),
                        validate=RuntimeRun, retry=True)

    def cancel(self, run_id: str) -> RuntimeRun:
        return self._do("POST", f"/v1/runs/{run_id}/cancel", json_body={},
                        expected=(200, 202), validate=RuntimeRun, retry=False)

    def health(self) -> HealthStatus:
        # 未配置凭据等降级场景返回 503 + 合法 HealthStatus（真实检查，非固定 ok）
        return self._do("GET", "/health", expected=(200, 503),
                        validate=HealthStatus, retry=False)
