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


class ToolUrlError(Exception):
    """工具 URL 解析失败（相对路径缺 Connection / 缺 base_url）。"""


def resolve_tool_url(url: str, conn) -> str:
    """工具 request.url 唯一解析实现（09-14 OpenAPI 初始化轮）。

    绝对 URL 原样返回（向后兼容存量工具）；以 / 开头的相对路径拼接绑定
    Connection 的 endpoint.base_url——端点单点归 Connection（D5 原则），
    多环境切 env 即切域名，工具配方不再硬编码 host。
    """
    u = (url or "").strip()
    if not u:
        raise ToolUrlError("工具配方缺少 request.url")
    if not u.startswith("/"):
        return u
    if conn is None:
        raise ToolUrlError("相对 URL 工具必须绑定提供 base_url 的 Connection")
    ep, _payload, _code = resolve_for_request(conn)
    base = str((ep or {}).get("base_url") or "").rstrip("/")
    if not base:
        raise ToolUrlError(
            f"Connection「{getattr(conn, 'name', conn)}」endpoint 未配置 base_url，"
            "相对 URL 无法解析（请先在 设置 → 连接 补齐端点）")
    return base + u


def resolve_db_target(conn, env_code: str | None = None,
                      database_default: str = "",
                      default_port: int = 5432) -> dict:
    """DB 类连接参数唯一解析实现（09-13 审计 P0-1 收口）。

    Reader/Writer/连接探测三方共用，终结"测试走 resolve_for_request、
    运行时直读 endpoint+secret_ref"的双轨：
    - 环境合并：endpoint/secret_ref 按 env（显式 → default_env → 首个）覆盖；
    - 结构化 Basic 凭据：payload 为 dict 时取 password/username（username
      优先于 endpoint.user——凭据与端点分置时以凭据侧为准）；
    - 历史裸串 secret：整串即密码；
    - database：调用方显式值（如 Datasource.location）优先，回落 endpoint.database。
    """
    ep, payload, code = resolve_for_request(conn, env_code) if conn is not None \
        else ({}, {}, None)
    if isinstance(payload, str):
        password, secret_user = payload, None
    else:
        payload = payload or {}
        password = str(payload.get("password", ""))
        secret_user = payload.get("username") or payload.get("user")
    return {
        "host": ep.get("host") or "127.0.0.1",
        "port": int(ep.get("port") or default_port),
        "user": secret_user or ep.get("user") or "postgres",
        "password": password,
        "database": database_default or ep.get("database") or "",
        "env_code": code,
    }
