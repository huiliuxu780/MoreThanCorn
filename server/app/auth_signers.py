"""Connection 鉴权签名层：内置算法 + 自定义脚本（QuickJS 沙箱）。

kind 从"僵尸字段"变为真实枚举：none|api_key|bearer|basic|aksk|script。
- aksk：网关 AkSk 动态签名（Authorization: BasicAKSK …，HMAC-SHA1，每次请求重生成），
  移植自已验收的 Apifox 脚本，2026-08-30 对 gw.dev-corn.bshg.com.cn 实测 200；
- script：JS 源码存 connection.auth_script，沙箱执行产出请求头——换算法不发版。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import time
import uuid

KINDS = ("none", "api_key", "bearer", "basic", "aksk", "script")

# 历史前端写入过的人类可读串（connection-picker 旧枚举），入库/读取统一归一化
LEGACY_KIND_MAP = {
    "none": "none", "api_key": "api_key", "bearer": "bearer", "basic": "basic",
    "aksk": "aksk", "script": "script",
    "None": "none", "API Key": "api_key", "Bearer Token": "bearer",
    "Basic Auth": "basic", "AkSk": "aksk", "Custom Script": "script",
}


class AuthSignError(Exception):
    """鉴权签名失败（配置错误/脚本异常/沙箱超时）。"""


def normalize_kind(kind: str) -> str:
    k = LEGACY_KIND_MAP.get(kind or "", "")
    if not k:
        raise AuthSignError(f"不支持的鉴权方式：{kind!r}（可选：{', '.join(KINDS)}）")
    return k


def sign_aksk(access_key: str, secret_key: str, ts_ms: int | None = None,
              nonce: str | None = None) -> str:
    """网关 AkSk 签名头值。stringToSign={ak}:{tsMillis}:{nonce}:（content 固定空串，
    所有权威来源一致；非空 content 的真算法留脚本层）。"""
    if not access_key or not secret_key:
        raise AuthSignError("aksk 鉴权缺少 access_key/secret_key")
    ts = ts_ms if ts_ms is not None else int(time.time() * 1000)
    nonce = nonce or str(uuid.uuid4())
    string_to_sign = f"{access_key}:{ts}:{nonce}:"
    sig = base64.b64encode(
        hmac.new(secret_key.encode(), string_to_sign.encode(), hashlib.sha1).digest()
    ).decode()
    auth_value = base64.b64encode(f"{sig}:{string_to_sign}".encode()).decode()
    return f"BasicAKSK {auth_value}"


def _raw(payload: dict | str, *keys: str) -> str:
    if isinstance(payload, str):
        return payload
    for k in keys:
        if payload.get(k):
            return str(payload[k])
    return ""


def build_auth_headers(kind: str, secret_payload: dict | str, *,
                       script: str | None = None,
                       env_vars: dict | None = None) -> dict[str, str]:
    """按 kind 产出出站请求头。secret_payload 为解密后的 payload（裸串或 dict）。"""
    k = normalize_kind(kind)
    if k == "none":
        return {}
    if k == "bearer":
        token = _raw(secret_payload, "token", "api_key", "access_key") or (
            secret_payload if isinstance(secret_payload, str) else "")
        if not token:
            raise AuthSignError("bearer 鉴权缺少密钥")
        return {"Authorization": f"Bearer {token}"}
    if k == "api_key":
        key = _raw(secret_payload, "api_key", "token") or (
            secret_payload if isinstance(secret_payload, str) else "")
        if not key:
            raise AuthSignError("api_key 鉴权缺少密钥")
        return {"X-API-Key": key}
    if k == "basic":
        if not isinstance(secret_payload, dict):
            raise AuthSignError("basic 鉴权密钥须为 {username, password} 结构")
        user, pwd = secret_payload.get("username", ""), secret_payload.get("password", "")
        if not user:
            raise AuthSignError("basic 鉴权缺少 username")
        cred = base64.b64encode(f"{user}:{pwd}".encode()).decode()
        return {"Authorization": f"Basic {cred}"}
    if k == "aksk":
        if not isinstance(secret_payload, dict):
            raise AuthSignError("aksk 鉴权密钥须为 {access_key, secret_key} 结构")
        return {"Authorization": sign_aksk(str(secret_payload.get("access_key", "")),
                                           str(secret_payload.get("secret_key", "")))}
    if k == "script":
        if not script or not script.strip():
            raise AuthSignError("script 鉴权缺少脚本内容")
        from .auth_sandbox import run_auth_script
        env = env_vars if isinstance(env_vars, dict) else (
            secret_payload if isinstance(secret_payload, dict) else {})
        headers, _logs = run_auth_script(script, env)
        return headers
    raise AuthSignError(f"不支持的鉴权方式：{kind!r}")
