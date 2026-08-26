"""09-SDD P0-B2：真实 DataReader（P0-03）。

要求（09 §6.2）：
- 每类 DataSource 独立 Adapter；连接测试执行真实最小操作；
- 读取支持分页/游标；外部源不可用必须失败（不得生成替代 rows，M-11）。

先红后绿：实现前 ImportError / 断言失败。
"""
import time

import pytest
from sqlalchemy import text

from app.db import SessionLocal, engine


# ---------- Postgres Adapter：真读 wf_test 探针表 ----------

@pytest.fixture(scope="module")
def probe_env():
    """在测试库建 25 行探针表（隔离、可重置；生产验收另用独立库）。"""
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS p0_reader_probe"))
        conn.execute(text(
            "CREATE TABLE p0_reader_probe ("
            " id int, interaction_id text, interaction_time timestamptz, content text)"))
        for i in range(25):
            conn.execute(text(
                "INSERT INTO p0_reader_probe VALUES "
                f"({i}, 'PB-{i:03d}', now() - make_interval(days => {25 - i}), 'text-{i}')"))
    yield
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS p0_reader_probe"))


def _mk_pg_datasource(db, name, port=5432):
    from app.models import Connection, Datasource
    conn = Connection(name=f"{name}-conn", kind="basic", protocol="postgresql",
                      endpoint={"host": "127.0.0.1", "port": port, "user": "rivers"},
                      secret_ref="")
    db.add(conn)
    db.flush()
    ds = Datasource(name=name, type="postgresql", connection_id=conn.id,
                    location="wf_test")
    db.add(ds)
    db.flush()
    return ds


def test_postgres_reader_validate_and_paginated_read(probe_env):
    from app.data_readers import PostgresReader
    db = SessionLocal()
    try:
        ds = _mk_pg_datasource(db, "probe-pg")
        reader = PostgresReader(db, ds)
        v = reader.validate()
        assert v["ok"] is True, v
        locator = {"table": "p0_reader_probe", "idField": "interaction_id",
                   "timeField": "interaction_time"}
        assert reader.count(locator) == 25
        # 分页游标：3 页读完 25 行，无重复无遗漏
        seen, cursor, pages = [], None, 0
        while True:
            page = reader.read_page(locator, cursor, limit=10)
            pages += 1
            seen.extend(r["interaction_id"] for r in page.rows)
            if not page.next_cursor:
                break
            cursor = page.next_cursor
            assert pages < 10, "游标未收敛"
        assert pages == 3
        assert len(seen) == 25 and len(set(seen)) == 25
        # 时间窗：最近 7 天的行（id 19..24 共 6 行，允许跨天边界 ±1）
        loc_w = dict(locator, window_days=7)
        n = reader.count(loc_w)
        assert 5 <= n <= 7, n
    finally:
        db.rollback()
        db.close()


def test_postgres_reader_fails_closed_when_unreachable(probe_env):
    """数据源断开：连接测试失败、读取必须抛错（不得产生替代数据，M-11）。"""
    from app.data_readers import PostgresReader, ReaderError
    db = SessionLocal()
    try:
        ds = _mk_pg_datasource(db, "probe-dead", port=59999)
        reader = PostgresReader(db, ds)
        v = reader.validate()
        assert v["ok"] is False and v["detail"]
        with pytest.raises(ReaderError):
            reader.read_page({"table": "p0_reader_probe"}, None, limit=10)
    finally:
        db.rollback()
        db.close()


def test_inline_asset_reader_pagination():
    from app.data_readers import InlineAssetReader, ReaderError
    from app.models import DataAsset
    db = SessionLocal()
    try:
        rows = [{"interactionId": f"IN-{i}", "text": f"t{i}"} for i in range(7)]
        a = DataAsset(name="inline-probe", rows=rows)
        db.add(a)
        db.flush()
        reader = InlineAssetReader(db, a)
        assert reader.validate()["ok"] is True
        assert reader.count({}) == 7
        page1 = reader.read_page({}, None, limit=3)
        assert [r["interactionId"] for r in page1.rows] == ["IN-0", "IN-1", "IN-2"]
        page2 = reader.read_page({}, page1.next_cursor, limit=3)
        assert page2.rows[0]["interactionId"] == "IN-3"
        # 缺失资产 → 失败关闭
        ghost = InlineAssetReader(db, DataAsset(id="no-such", name="x", rows=[]))
        assert ghost.validate()["ok"] is False
        with pytest.raises(ReaderError):
            ghost.read_page({}, None, limit=3)
    finally:
        db.rollback()
        db.close()


def test_registry_selects_adapter_by_asset_source():
    """get_reader：内联 rows → Inline；datasource 绑定 → 对应类型 Adapter。"""
    from app.data_readers import InlineAssetReader, PostgresReader, get_reader
    db = SessionLocal()
    try:
        from app.models import DataAsset
        inline = DataAsset(name="reg-inline", rows=[{"interactionId": "X"}])
        db.add(inline)
        db.flush()
        assert isinstance(get_reader(db, inline), InlineAssetReader)
        ds = _mk_pg_datasource(db, "reg-pg")
        bound = DataAsset(name="reg-bound", source="datasource",
                          datasource_id=ds.id, location="p0_reader_probe", rows=[])
        db.add(bound)
        db.flush()
        assert isinstance(get_reader(db, bound), PostgresReader)
    finally:
        db.rollback()
        db.close()
