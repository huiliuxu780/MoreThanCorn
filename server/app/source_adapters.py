"""数据源拉取适配器（09-14 用户拍板类型体系：maxcompute / api_pull / webhook / 飞书多维表格）。

契约：``fetch_page(kind, config, secret, cursor) -> (rows, next_cursor)``
- 所有出站一律过 ``enforce_egress``（SSRF 闸；生产拦私网/元数据）；
- 凭据只来自 secret_ref 解密后的 payload（config 只放非敏感参数）；
- 驱动缺失（pyodps）失败关闭并给明确错误，**不 mock 回落**；
- 飞书走开放平台 tenant_access_token + bitable records 分页（page_token 游标）；
- MaxCompute 走 pyodps reader 切片（offset 游标）；API 拉取走 cursor 参数递增。
"""
from __future__ import annotations

import json
from typing import Any

import httpx

from .egress import enforce_egress

PULL_KINDS = ("api_pull", "feishu_bitable", "maxcompute")
SOURCE_KINDS = ("webhook", "api_pull", "maxcompute", "feishu_bitable", "test_event")
MAX_PAGE_SIZE = 200


class SourceFetchError(Exception):
    """拉取失败（配置/凭据/远端错误），任务链失败关闭。"""


class SourceDriverMissing(SourceFetchError):
    """驱动未安装（失败关闭，不 mock）。"""


def _jsonable(v: Any) -> Any:
    from datetime import date, datetime, time
    from decimal import Decimal
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (bytes, bytearray)):
        return v.decode("utf-8", "replace")
    return v


def _api_auth_headers(config: dict, secret: Any) -> dict:
    """API 拉取鉴权：secret 裸串=Bearer；dict 支持 bearer/api_key/basic 三形。"""
    headers: dict[str, str] = {}
    if isinstance(secret, str) and secret:
        headers["Authorization"] = f"Bearer {secret}"
    elif isinstance(secret, dict):
        kind = (secret.get("type") or "bearer").lower()
        if kind == "bearer" and secret.get("token"):
            headers["Authorization"] = f"Bearer {secret['token']}"
        elif kind == "api_key" and secret.get("value"):
            headers[secret.get("header") or "X-Api-Key"] = str(secret["value"])
        elif kind == "basic" and (secret.get("username") or secret.get("password")):
            import base64
            raw = f"{secret.get('username', '')}:{secret.get('password', '')}"
            headers["Authorization"] = "Basic " + base64.b64encode(
                raw.encode()).decode()
    # 无凭据/空凭据 → 匿名拉取（不挂空 Authorization 头，httpx 拒非法头值）
    return headers


def fetch_api_pull(config: dict, secret: Any,
                   cursor: str | None) -> tuple[list[dict], str | None]:
    url = str(config.get("url") or "")
    if not url.startswith(("http://", "https://")):
        raise SourceFetchError("api_pull 源缺少 config.url（http(s)）")
    enforce_egress(url)
    cursor_param = str(config.get("cursor_param") or "after")
    cursor_field = str(config.get("cursor_field") or "id")
    page_size = min(int(config.get("page_size") or 100), MAX_PAGE_SIZE)
    params: dict[str, Any] = {cursor_param: cursor} if cursor else {}
    params.setdefault("limit", page_size)
    try:
        resp = httpx.get(url, params=params, timeout=30,
                         headers=_api_auth_headers(config, secret),
                         follow_redirects=False)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as exc:
        raise SourceFetchError(f"API 拉取失败：{exc}") from exc
    rows = data if isinstance(data, list) else (data.get("items")
                                               or data.get("rows") or [data])
    rows = [{k: _jsonable(v) for k, v in (r or {}).items()} for r in rows]
    next_cursor = str(rows[-1][cursor_field]) if (
        rows and cursor_field in rows[-1]) else None
    if len(rows) < page_size:
        next_cursor = None
    return rows, next_cursor


def _feishu_tenant_token(secret: Any) -> str:
    if not isinstance(secret, dict) or not secret.get("app_id"):
        raise SourceFetchError(
            "飞书多维表格源需要 secret={app_id, app_secret}（自建应用凭据）")
    url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    enforce_egress(url)
    try:
        resp = httpx.post(url, json={"app_id": secret["app_id"],
                                     "app_secret": secret.get("app_secret", "")},
                          timeout=15)
        resp.raise_for_status()
        body = resp.json()
    except httpx.HTTPError as exc:
        raise SourceFetchError(f"飞书 tenant_token 请求失败：{exc}") from exc
    if body.get("code") != 0:
        raise SourceFetchError(
            f"飞书 tenant_token 错误 code={body.get('code')} msg={body.get('msg')}")
    return str(body["tenant_access_token"])


def fetch_feishu_bitable(config: dict, secret: Any,
                         cursor: str | None) -> tuple[list[dict], str | None]:
    app_token = str(config.get("app_token") or "")
    table_id = str(config.get("table_id") or "")
    if not app_token or not table_id:
        raise SourceFetchError(
            "飞书多维表格源需要 config.app_token 与 config.table_id")
    token = _feishu_tenant_token(secret)
    page_size = min(int(config.get("page_size") or 100), MAX_PAGE_SIZE)
    url = (f"https://open.feishu.cn/open-apis/bitable/v1"
           f"/apps/{app_token}/tables/{table_id}/records")
    enforce_egress(url)
    params: dict[str, Any] = {"page_size": page_size}
    if cursor:
        params["page_token"] = cursor
    if config.get("view_id"):
        params["view_id"] = str(config["view_id"])
    try:
        resp = httpx.get(url, params=params, timeout=30,
                         headers={"Authorization": f"Bearer {token}"},
                         follow_redirects=False)
        resp.raise_for_status()
        body = resp.json()
    except httpx.HTTPError as exc:
        raise SourceFetchError(f"飞书 bitable 拉取失败：{exc}") from exc
    if body.get("code") != 0:
        raise SourceFetchError(
            f"飞书 bitable 错误 code={body.get('code')} msg={body.get('msg')}")
    items = (body.get("data") or {}).get("items") or []
    rows = [{"record_id": r.get("record_id"), **(r.get("fields") or {})}
            for r in items]
    rows = [{k: _jsonable(v) for k, v in r.items()} for r in rows]
    data = body.get("data") or {}
    next_cursor = data.get("page_token") if data.get("has_more") else None
    return rows, next_cursor


def fetch_maxcompute(config: dict, secret: Any,
                     cursor: str | None) -> tuple[list[dict], str | None]:
    endpoint = str(config.get("endpoint") or "")
    project = str(config.get("project") or "")
    table = str(config.get("table") or "")
    if not (endpoint and project and table):
        raise SourceFetchError(
            "MaxCompute 源需要 config.endpoint/project/table")
    if not isinstance(secret, dict) or not secret.get("access_key_id"):
        raise SourceFetchError(
            "MaxCompute 源需要 secret={access_key_id, access_key_secret}")
    enforce_egress(endpoint)
    try:
        from odps import ODPS  # type: ignore
    except ImportError as exc:
        raise SourceDriverMissing(
            "MaxCompute 需要 pyodps 驱动（pip install pyodps）；当前环境未安装，"
            "失败关闭不 mock") from exc
    page_size = min(int(config.get("page_size") or 100), MAX_PAGE_SIZE)
    offset = int(cursor) if cursor else 0
    try:
        o = ODPS(secret["access_key_id"], secret.get("access_key_secret", ""),
                 project, endpoint=endpoint)
        t = o.get_table(table)
        with t.open_reader() as reader:
            total = reader.count
            slice_ = reader[offset:offset + page_size]
            cols = [c.name for c in t.table_schema.columns]
            rows = [{c: _jsonable(rec[c]) for c in cols} for rec in slice_]
        next_cursor = str(offset + page_size) if offset + page_size < total else None
        return rows, next_cursor
    except SourceFetchError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise SourceFetchError(f"MaxCompute 拉取失败：{exc}") from exc


_FETCHERS = {
    "api_pull": fetch_api_pull,
    "feishu_bitable": fetch_feishu_bitable,
    "maxcompute": fetch_maxcompute,
}


def fetch_page(kind: str, config: dict, secret_ref: str | None,
               cursor: str | None) -> tuple[list[dict], str | None]:
    """secret_ref 在适配器层解密（路由层不接触明文凭据，secret-leak 门禁）。"""
    from .secrets import decrypt_payload
    fn = _FETCHERS.get(kind)
    if fn is None:
        raise SourceFetchError(f"类型 {kind} 不支持拉取（push 类型用 webhook 入口）")
    secret = decrypt_payload(secret_ref) if secret_ref else {}
    return fn(config or {}, secret, cursor)


def row_dedupe_key(row: dict, config: dict) -> str:
    field = str(config.get("cursor_field") or "id")
    val = row.get(field) or row.get("record_id") or row.get("id")
    if val not in (None, ""):
        return str(val)
    import hashlib
    return hashlib.sha256(
        json.dumps(row, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
