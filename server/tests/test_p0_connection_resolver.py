"""P0-1 连接解析双轨收口（2026-09-13 外部审计返工·批1）。

外部审计发现：连接测试走 resolve_for_request()（环境合并+结构化凭据取
password），而 DataReader/DataWriter 直读 conn.endpoint + runner._decrypt
（= decrypt_secret 裸串）——结构化 Basic 凭据会把整个 JSON 当密码、
环境覆盖完全失效，产生"测试通过但任务连不上/连错环境"的假阳性。

修复：三方（探测/Reader/Writer）统一走 connection_runtime.resolve_db_target。

测试分层（本机 PG 为 trust 认证，密码值无法在连接层区分对错——诚实拆分）：
- 单元层：resolve_db_target 对结构化/裸串/环境覆盖/database 优先级的
  **精确字符串断言**（正确性证据）；
- 集成层：PostgresReader/Writer/探测经结构化凭据+环境覆盖真实读写测试库
  （管线接通证据，keyset 分页真数据）。
"""
from __future__ import annotations

from datetime import datetime, timezone

import psycopg
import pytest

from app.connection_runtime import resolve_db_target
from app.db import SessionLocal
from app.models import Connection, Datasource
from app.secrets import encrypt_secret, serialize_secret
from tests.conftest import TEST_DB_NAME, pg_dsn

# postgresql://user@host:port/db → user（含 :password 形态时取冒号前段）
PG_USER = (pg_dsn().split("://", 1)[1].split("@", 1)[0].split(":", 1)[0]
           if "@" in pg_dsn() else "rivers")
_TABLE = "audit_p0_conn_probe"


def _mk_conn(endpoint: dict, secret, environments=None,
             default_env=None) -> Connection:
    """纯内存 Connection（resolve_db_target 只读属性，不落库）。"""
    ref = encrypt_secret(serialize_secret(secret)) if secret is not None else ""
    return Connection(name="p0-resolver-unit", kind="basic", protocol="postgresql",
                      endpoint=endpoint, secret_ref=ref,
                      environments=environments or [], default_env=default_env,
                      lifecycle="active", status="active")


# ---------- 单元层：解析语义精确断言 ----------

def test_structured_basic_credential_extraction():
    """结构化 {username,password}：password 精确取出，username 优先于 endpoint.user。"""
    c = _mk_conn({"host": "db.internal", "port": "5433", "user": "ep-user",
                  "database": "ep-db"},
                 {"username": "sec-user", "password": "sec-pw"})
    t = resolve_db_target(c)
    assert t["host"] == "db.internal" and t["port"] == 5433
    assert t["user"] == "sec-user", "凭据侧 username 必须优先于端点 user"
    assert t["password"] == "sec-pw", "不得把 JSON 整串当密码（原 P0-1 病灶）"
    assert t["database"] == "ep-db"


def test_legacy_raw_string_secret():
    """历史裸串 secret：整串即密码，user 回落 endpoint。"""
    c = _mk_conn({"host": "h", "user": "ep-user"}, "plain-pw")
    t = resolve_db_target(c)
    assert t["password"] == "plain-pw" and t["user"] == "ep-user"


def test_env_override_and_default_env():
    """环境覆盖：default_env 生效；显式 env_code 覆盖 default。"""
    c = _mk_conn(
        {"host": "base-host"}, {"username": "u0", "password": "p0"},
        environments=[
            {"code": "dev", "endpoint": {"host": "dev-host", "port": "5432"},
             "secret_ref": encrypt_secret(serialize_secret(
                 {"username": "dev-u", "password": "dev-p"}))},
            {"code": "prod", "endpoint": {"host": "prod-host"},
             "secret_ref": encrypt_secret(serialize_secret(
                 {"username": "prod-u", "password": "prod-p"}))},
        ],
        default_env="dev")
    t = resolve_db_target(c)
    assert (t["host"], t["user"], t["password"], t["env_code"]) == \
        ("dev-host", "dev-u", "dev-p", "dev")
    t2 = resolve_db_target(c, "prod")
    assert (t2["host"], t2["user"], t2["password"], t2["env_code"]) == \
        ("prod-host", "prod-u", "prod-p", "prod")


def test_database_default_priority_and_none_conn():
    """Datasource.location 优先于 endpoint.database；无 Connection 不炸。"""
    c = _mk_conn({"host": "h", "database": "ep-db"}, None)
    assert resolve_db_target(c, database_default="loc-db")["database"] == "loc-db"
    t = resolve_db_target(None)
    assert t["host"] == "127.0.0.1" and t["password"] == ""


# ---------- 集成层：真实 PG 读写（结构化凭据 + 环境覆盖全链路） ----------

@pytest.fixture()
def _probe_table():
    dsn = pg_dsn()
    with psycopg.connect(dsn) as pg:
        pg.execute(f"DROP TABLE IF EXISTS {_TABLE}")
        pg.execute(f"CREATE TABLE {_TABLE} (id serial primary key, note text)")
        with pg.cursor() as cur:  # psycopg3：executemany 在 cursor 上
            cur.executemany(f"INSERT INTO {_TABLE} (note) VALUES (%s)",
                            [("n1",), ("n2",), ("n3",)])
        pg.commit()
    yield
    with psycopg.connect(dsn) as pg:
        pg.execute(f"DROP TABLE IF EXISTS {_TABLE}")
        pg.commit()


def test_reader_writer_probe_share_resolution(_probe_table):
    """Reader 分页读 + Writer 元数据探测 + admin 连接探测，三方同参连通。"""
    from app.data_readers.postgres import PostgresReader
    from app.data_writers.postgres import PostgresWriter
    from app.routers.admin import _probe_connection

    db = SessionLocal()
    try:
        secret = {"username": PG_USER, "password": "trust-auth-ignores-this"}
        conn = Connection(
            name="audit-p0-conn-e2e", kind="basic", protocol="postgresql",
            endpoint={"host": "127.0.0.1", "port": "5432", "user": "wrong-user",
                      "database": TEST_DB_NAME},
            secret_ref=encrypt_secret(serialize_secret(secret)),
            environments=[{"code": "prod",
                           "endpoint": {"host": "127.0.0.1", "port": "5432",
                                        "user": "wrong-user",
                                        "database": TEST_DB_NAME},
                           "secret_ref": encrypt_secret(serialize_secret(secret))}],
            default_env="prod", lifecycle="active", status="active")
        db.add(conn)
        db.flush()
        ds = Datasource(name="audit-p0-ds-e2e", type="postgresql",
                        connection_id=conn.id, location=TEST_DB_NAME,
                        status="enabled")
        db.add(ds)
        db.commit()

        # 1) 连接探测（测试路径）
        ok, err, diag = _probe_connection(conn, "prod")
        assert ok, f"探测应成功：{err} {diag}"

        # 2) Reader（运行时路径）——结构化凭据 username 覆盖 endpoint 的 wrong-user
        reader = PostgresReader(db, ds)
        assert reader.user == PG_USER and reader.env_code == "prod"
        v = reader.validate()
        assert v["ok"], v
        page1 = reader.read_page({"table": _TABLE, "idField": "id"}, None, 2)
        assert len(page1.rows) == 2 and page1.next_cursor
        page2 = reader.read_page({"table": _TABLE, "idField": "id"},
                                 page1.next_cursor, 2)
        assert len(page2.rows) == 1 and page2.next_cursor is None
        assert reader.count({"table": _TABLE}) == 3

        # 3) Writer（投递路径）同一解析
        writer = PostgresWriter(db, ds)
        assert writer.user == PG_USER and writer.database == TEST_DB_NAME
        meta = writer.inspect_target({"table": _TABLE})
        assert meta.columns, "writer 应能取到目标表列元数据"
    finally:
        # marker 精确清理
        db2 = SessionLocal()
        try:
            db2.query(Datasource).filter(
                Datasource.name == "audit-p0-ds-e2e").delete()
            db2.query(Connection).filter(
                Connection.name == "audit-p0-conn-e2e").delete()
            db2.commit()
        finally:
            db2.close()
        db.close()
