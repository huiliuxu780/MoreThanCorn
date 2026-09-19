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
import time
from typing import Any

import httpx

from .egress import enforce_egress

PULL_KINDS = ("api_pull", "feishu_bitable", "maxcompute", "sls")
SOURCE_KINDS = ("webhook", "api_pull", "maxcompute", "feishu_bitable", "sls",
                "test_event")
MAX_PAGE_SIZE = 200


class SourceFetchError(Exception):
    """拉取失败（配置/凭据/远端错误），任务链失败关闭。"""


class SourceDriverMissing(SourceFetchError):
    """驱动未安装（失败关闭，不 mock）。"""


def _aksk(secret: Any) -> tuple[str, str]:
    """AkSk 双约定兼容：Connection aksk 形 {access_key, secret_key}；
    源级旧约定 {access_key_id, access_key_secret}。"""
    if not isinstance(secret, dict):
        raise SourceFetchError("需要 AkSk 凭据对象")
    ak = str(secret.get("access_key_id") or secret.get("access_key") or "")
    sk = str(secret.get("access_key_secret") or secret.get("secret_key") or "")
    if not ak:
        raise SourceFetchError(
            "需要 AkSk 凭据：{access_key, secret_key} 或 {access_key_id, access_key_secret}")
    return ak, sk


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


def _fetch_feishu_bitable_cli(config: dict, app_token: str, table_id: str,
                              cursor: str | None) -> tuple[list[dict], str | None]:
    """09-18 dev 后端（用户拍板）：subprocess exec lark-cli，借本机已登录 profile，
    凭据不复制进平台；cursor=offset 字符串。生产 fail-closed 禁走本路径。"""
    import subprocess

    from .config import is_production
    if is_production():
        raise SourceFetchError(
            "飞书 bitable cli 后端仅 dev；生产须配置 OpenAPI 凭据（secret={app_id, app_secret}）")
    offset = int(cursor or 0)
    limit = min(int(config.get("page_size") or 100), MAX_PAGE_SIZE)
    argv = ["lark-cli", "base", "+record-list", "--base-token", app_token,
            "--table-id", table_id, "--limit", str(limit),
            "--offset", str(offset), "--as", "user", "--json"]
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=90)  # noqa: S603
    except subprocess.TimeoutExpired as exc:
        raise SourceFetchError(f"lark-cli 拉取超时：{exc}") from exc
    if proc.returncode != 0:
        raise SourceFetchError(
            f"lark-cli 拉取失败：{(proc.stderr or proc.stdout)[:400]}")
    try:
        body = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise SourceFetchError(f"lark-cli 输出非 JSON：{exc}") from exc
    # lark-cli +record-list --json 形态：data.fields 列名 + data.data 行矩阵 +
    # data.record_id_list 并行；全空行跳过，不造空事件
    d = (body.get("data") or {}) if isinstance(body, dict) else {}
    fields = d.get("fields") or []
    matrix = d.get("data") or []
    rec_ids = d.get("record_id_list") or []
    rows: list[dict] = []
    for i, raw in enumerate(matrix):
        if not isinstance(raw, list) or not any(
                v not in (None, "") for v in raw):
            continue
        row = {"record_id": rec_ids[i] if i < len(rec_ids) else None}
        row.update({f: _jsonable(raw[j]) for j, f in enumerate(fields)
                    if j < len(raw)})
        rows.append(row)
    next_cursor = (str(offset + len(matrix))
                   if d.get("has_more") and matrix else None)
    return rows, next_cursor


def fetch_feishu_bitable(config: dict, secret: Any,
                         cursor: str | None) -> tuple[list[dict], str | None]:
    app_token = str(config.get("app_token") or "")
    table_id = str(config.get("table_id") or "")
    if not app_token or not table_id:
        raise SourceFetchError(
            "飞书多维表格源需要 config.app_token 与 config.table_id")
    if str(config.get("backend") or "") == "cli":
        return _fetch_feishu_bitable_cli(config, app_token, table_id, cursor)
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


def _sls_client(secret: Any, endpoint: str):
    """SLS LogClient 构造（测试可 monkeypatch 本函数）。"""
    ak, sk = _aksk(secret)
    from aliyun.log import LogClient
    return LogClient(endpoint, ak, sk)


def fetch_sls(config: dict, secret: Any,
              cursor: str | None) -> tuple[list[dict], str | None]:
    """SLS 日志拉取：时间+偏移游标（ts:offset）。

    cursor 语义：from=ts（含）+ offset 起 line=page_size 条；满页则 offset 递增，
    不满页则 offset 累加已取数（同秒后到日志靠 offset 续取，不重不漏同秒序）。
    初始游标 = now - from_window_seconds（默认 3600）。
    """
    endpoint = str(config.get("endpoint") or "")
    project = str(config.get("project") or "")
    logstore = str(config.get("logstore") or "")
    if not (endpoint and project and logstore):
        raise SourceFetchError("SLS 源需要 config.endpoint/project/logstore")
    enforce_egress(endpoint)
    page_size = min(int(config.get("page_size") or 100), MAX_PAGE_SIZE)
    ts, off = 0, 0
    if cursor:
        try:
            ts_s, off_s = cursor.split(":", 1)
            ts, off = int(ts_s), int(off_s)
        except ValueError as exc:
            raise SourceFetchError(f"SLS 游标格式非法：{cursor}") from exc
    if not ts:
        ts = int(time.time()) - int(config.get("from_window_seconds") or 3600)
    client = _sls_client(secret, endpoint)
    from aliyun.log import GetLogsRequest
    import time as _t
    now_ts = int(_t.time()) + 5
    try:
        req = GetLogsRequest(project, logstore, ts, now_ts,
                             query=str(config.get("query") or ""),
                             line=page_size, offset=off)
        resp = client.get_logs(req)
        logs = resp.get_logs()
    except Exception as exc:  # noqa: BLE001
        raise SourceFetchError(f"SLS 拉取失败：{exc}") from exc
    rows = []
    for lg in logs:
        row = dict(lg.get_contents())
        row.setdefault("__time__", lg.get_time())
        rows.append({k: _jsonable(v) for k, v in row.items()})
    taken = len(rows)
    if taken == 0:
        next_cursor = f"{ts}:{off}"
    else:
        next_cursor = f"{ts}:{off + taken}"
    return rows, next_cursor


def fetch_maxcompute(config: dict, secret: Any,
                     cursor: str | None) -> tuple[list[dict], str | None]:
    endpoint = str(config.get("endpoint") or "")
    project = str(config.get("project") or "")
    table = str(config.get("table") or "")
    sql = str(config.get("sql") or "").strip()
    if sql and not sql.lower().startswith("select"):
        raise SourceFetchError("config.sql 仅支持 SELECT（只读拉取）")
    if not (endpoint and project and (table or sql)):
        raise SourceFetchError(
            "MaxCompute 源需要 config.endpoint/project + (table 或 sql)")
    ak, sk = _aksk(secret)
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
        o = ODPS(ak, sk, project, endpoint=endpoint)
        if sql:
            # SQL 查询拉取模式（QuickBI 数据集/函数背后的 SQL 可直接贴入）；
            # offset 分页每页重跑查询（v1 成本可接受，文档注明）
            import itertools
            inst = o.execute_sql(sql)
            with inst.open_reader() as reader:
                total = reader.count
                cols = list(reader.schema.names)
                slice_ = list(itertools.islice(reader, offset, offset + page_size))
                rows = [{c: _jsonable(rec[c]) for c in cols} for rec in slice_]
            next_cursor = (str(offset + page_size)
                           if offset + page_size < total else None)
            return rows, next_cursor
        t = o.get_table(table)
        part = None
        if t.table_schema.partitions:
            part = str(config.get("partition") or "")
            if not part:
                # 未显式指定分区：取最新创建分区（数据拉取源的合理默认）
                parts = sorted(t.partitions, key=lambda p: p.creation_time)
                if not parts:
                    raise SourceFetchError(
                        f"分区表 {table} 暂无分区；可用 config.partition 显式指定")
                part = str(parts[-1].partition_spec)
        with t.open_reader(partition=part) as reader:
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
    "sls": fetch_sls,
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
