"""Connection 运行时视图解析：环境选择 + 按环境覆盖 endpoint/凭据。

environments 条目形如 {code, label, endpoint?, secret_ref?}；条目字段缺省时
回落 connection 级 endpoint/secret_ref。environments 为空的存量连接视为单环境。
"""
from __future__ import annotations

from .secrets import decrypt_payload

# 前端环境槽预设（可自定义扩展）
ENV_PRESETS = (
    ("dev", "日常"),
    ("test", "测试"),
    ("pre", "预发"),
    ("prod", "生产"),
)


def resolve_for_request(conn, env_code: str | None = None) -> tuple[dict, dict | str, str | None]:
    """返回 (endpoint, 解密后凭据 payload, 生效环境码)。"""
    envs = conn.environments or []
    code = env_code or conn.default_env or (envs[0].get("code") if envs else None)
    entry = next((e for e in envs if e.get("code") == code), None) if code else None
    if entry and entry.get("endpoint"):
        endpoint = dict(entry["endpoint"])
    else:
        endpoint = dict(conn.endpoint or {})
    ref = (entry.get("secret_ref") if entry else None) or conn.secret_ref
    payload = decrypt_payload(ref) if ref else {}
    return endpoint, payload, code
