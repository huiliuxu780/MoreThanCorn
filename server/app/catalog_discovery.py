"""D5 目录发现（09-14 用户拍板连接统一）：一个 Connection 下多表/多日志库。

discover_catalog(conn) → [{name, kind, schema?, partitioned?, comment?}]
- maxcompute：pyodps list_tables（含分区标记/注释）；
- sls：list_logstore(endpoint.project)（RAM 缺 ListProject/ListLogStores 权限时
  失败关闭并给出明确错误，不 mock）；
- postgresql：information_schema.tables（排除系统 schema）；
- mysql：information_schema.tables（pymysql 缺失失败关闭）；
- 其余协议：返回空列表 + note（无目录语义）。
凭据一律取自 Connection.secret_ref 解密；出站过 enforce_egress。
"""
from __future__ import annotations

from typing import Any

from .egress import enforce_egress
from .secrets import decrypt_payload


class CatalogError(Exception):
    """目录发现失败（凭据/权限/驱动），失败关闭不 mock。"""


def _secret_of(conn) -> Any:
    return decrypt_payload(conn.secret_ref) if conn.secret_ref else {}


def discover_catalog(conn) -> list[dict]:
    proto = conn.protocol
    ep = conn.endpoint or {}
    secret = _secret_of(conn)

    if proto == "maxcompute":
        endpoint = str(ep.get("endpoint") or "")
        project = str(ep.get("project") or "")
        if not (endpoint and project):
            raise CatalogError("MaxCompute 连接需要 endpoint.endpoint 与 endpoint.project")
        from .source_adapters import SourceFetchError, _aksk
        try:
            ak, sk = _aksk(secret)
        except SourceFetchError as exc:
            raise CatalogError(str(exc)) from exc
        enforce_egress(endpoint)
        try:
            from odps import ODPS  # type: ignore
        except ImportError as exc:
            raise CatalogError("MaxCompute 目录发现需要 pyodps 驱动（未安装）") from exc
        try:
            o = ODPS(ak, sk, project, endpoint=endpoint)
            items = []
            for t in o.list_tables():
                items.append({
                    "name": t.name, "kind": "table",
                    "partitioned": bool(t.table_schema.partitions),
                    "comment": (t.comment or "")[:120],
                })
            return items
        except CatalogError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise CatalogError(f"MaxCompute 目录发现失败：{exc}") from exc

    if proto == "sls":
        endpoint = str(ep.get("endpoint") or "")
        project = str(ep.get("project") or "")
        if not (endpoint and project):
            raise CatalogError("SLS 连接需要 endpoint.endpoint 与 endpoint.project")
        from .source_adapters import SourceFetchError, _aksk
        try:
            ak, sk = _aksk(secret)
        except SourceFetchError as exc:
            raise CatalogError(str(exc)) from exc
        enforce_egress(endpoint)
        try:
            from aliyun.log import LogClient
            c = LogClient(endpoint, ak, sk)
            res = c.list_logstore(project)
            return [{"name": n, "kind": "logstore"} for n in res.get_logstores()]
        except CatalogError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise CatalogError(
                f"SLS 目录发现失败（若为 RAM 权限拒绝，需 log:ListLogStores/"
                f"ListProject 授权）：{exc}") from exc

    if proto in ("postgresql", "mysql"):
        host = str(ep.get("host") or "")
        port = int(ep.get("port") or (5432 if proto == "postgresql" else 3306))
        user = str(ep.get("user") or "")
        database = str(ep.get("database") or "")
        if not (host and database):
            raise CatalogError(f"{proto} 连接需要 endpoint.host 与 endpoint.database")
        password = ""
        if isinstance(secret, dict):
            password = str(secret.get("password") or "")
        elif isinstance(secret, str):
            password = secret
        enforce_egress(f"https://{host}:{port}")
        sql = ("SELECT table_schema, table_name FROM information_schema.tables "
               "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') "
               "ORDER BY table_schema, table_name")
        try:
            if proto == "postgresql":
                import psycopg
                with psycopg.connect(host=host, port=port, dbname=database,
                                     user=user, password=password,
                                     connect_timeout=5) as pg:
                    with pg.cursor() as cur:
                        cur.execute(sql)
                        return [{"name": r[1], "kind": "table", "schema": r[0]}
                                for r in cur.fetchall()]
            else:
                try:
                    import pymysql  # type: ignore
                except ImportError as exc:
                    raise CatalogError("MySQL 目录发现需要 pymysql 驱动（未安装）") from exc
                conn2 = pymysql.connect(host=host, port=port, user=user,
                                        password=password, database=database,
                                        connect_timeout=5)
                try:
                    with conn2.cursor() as cur:
                        cur.execute(sql)
                        return [{"name": r[1], "kind": "table", "schema": r[0]}
                                for r in cur.fetchall()]
                finally:
                    conn2.close()
        except CatalogError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise CatalogError(f"{proto} 目录发现失败：{exc}") from exc

    return []  # http-api/llm/mcp 等无目录语义
