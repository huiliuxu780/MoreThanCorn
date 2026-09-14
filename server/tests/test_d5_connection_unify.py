"""D5 连接统一回归（09-14 用户拍板：凭据归 Connection、目录发现→数据资产、接入引用）。

- catalog 端点：maxcompute 走 mock odps（凭据取自 Connection.secret_ref）；
  postgresql 走真实测试库 information_schema（系统 schema 排除）；
- tick 经 connection_id 解析凭据/端点（mock odps 断言 AK 来自 Connection）；
- 校验：maxcompute/sls 无 connection_id 且无 endpoint/project → 422；
- 兼容模式（config.endpoint+secret_ref，无 connection_id）仍然可用。
"""
from __future__ import annotations

import sys
import types

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import Connection, DataAsset, DataSource, Datasource
from app.secrets import encrypt_secret, serialize_secret

client = TestClient(app)


class _FakeTable:
    def __init__(self, name, partitioned=False, comment=""):
        self.name = name
        self.comment = comment
        self.table_schema = types.SimpleNamespace(partitions=[1] if partitioned else [])


class _FakeODPS:
    last_creds: dict = {}

    def __init__(self, ak, sk, project, endpoint=None):
        _FakeODPS.last_creds = {"ak": ak, "sk": sk, "project": project,
                                "endpoint": endpoint}

    def list_tables(self):
        return [_FakeTable("tbl_a", True), _FakeTable("tbl_b")]


def _mk_conn(secret: dict) -> str:
    r = client.post("/api/connections", json={
        "name": "d5-mc-conn", "kind": "aksk", "protocol": "maxcompute",
        "endpoint": {"endpoint": "https://odps.example.com/api",
                     "project": "proj_d5"},
        "secret": secret})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _cleanup(*conn_ids: str):
    db = SessionLocal()
    try:
        src_ids = [r[0] for r in db.query(DataSource.id).filter(
            DataSource.connection_id.in_(conn_ids or ("-",))).all()]
        if src_ids:
            db.query(DataSource).filter(DataSource.id.in_(src_ids)).delete(
                synchronize_session=False)
        ds_ids = [r[0] for r in db.query(Datasource.id).filter(
            Datasource.connection_id.in_(conn_ids or ("-",))).all()]
        if ds_ids:
            db.query(DataAsset).filter(
                DataAsset.datasource_id.in_(ds_ids)).delete(
                synchronize_session=False)
            db.query(Datasource).filter(
                Datasource.id.in_(ds_ids)).delete(synchronize_session=False)
        from app.models import ConnectionSecretRevision
        db.query(ConnectionSecretRevision).filter(
            ConnectionSecretRevision.connection_id.in_(conn_ids or ("-",))).delete(
            synchronize_session=False)
        db.query(Connection).filter(
            Connection.id.in_(conn_ids or ("-",))).delete(
            synchronize_session=False)
        db.commit()
    finally:
        db.close()


def test_catalog_maxcompute_uses_connection_creds(monkeypatch):
    fake_mod = types.ModuleType("odps")
    fake_mod.ODPS = _FakeODPS
    monkeypatch.setitem(sys.modules, "odps", fake_mod)
    cid = _mk_conn({"access_key": "AK_CONN", "secret_key": "SK_CONN"})
    try:
        r = client.get(f"/api/connections/{cid}/catalog")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["protocol"] == "maxcompute" and d["total"] == 2
        names = [i["name"] for i in d["items"]]
        assert names == ["tbl_a", "tbl_b"]
        assert d["items"][0]["partitioned"] is True
        # 凭据来自 Connection（不是源自带）
        assert _FakeODPS.last_creds["ak"] == "AK_CONN"
        assert _FakeODPS.last_creds["project"] == "proj_d5"
    finally:
        _cleanup(cid)


def test_catalog_postgresql_real_information_schema():
    cid = None
    r = client.post("/api/connections", json={
        "name": "d5-pg-conn", "kind": "none", "protocol": "postgresql",
        "endpoint": {"host": "127.0.0.1", "port": 5432, "user": "rivers",
                     "database": __import__("tests.conftest", fromlist=["x"]).TEST_DB_NAME},
        "secret": None})
    assert r.status_code in (200, 201), r.text
    cid = r.json()["id"]
    try:
        r2 = client.get(f"/api/connections/{cid}/catalog")
        assert r2.status_code == 200, r2.text
        names = [i["name"] for i in r2.json()["items"]]
        assert "connection" in names and "task_run" in names
        assert not any(n in names for n in
                       ("pg_stat_activity", "pg_tables")), "系统 schema 须排除"
    finally:
        _cleanup(cid)


def test_tick_resolves_creds_from_connection(monkeypatch):
    fake_mod = types.ModuleType("odps")
    fake_mod.ODPS = _FakeODPS
    monkeypatch.setitem(sys.modules, "odps", fake_mod)
    cid = _mk_conn({"access_key": "AK_TICK", "secret_key": "SK_TICK"})
    db = SessionLocal()
    try:
        src = DataSource(name="d5-tick-src", kind="maxcompute",
                         config={"table": "tbl_a", "page_size": 10},
                         connection_id=cid)
        db.add(src)
        db.commit()
        sid = src.id
    finally:
        db.close()
    try:
        # mock fetch_page 层验证 config/secret 注入（tick 内部解析 connection）
        import app.source_adapters as sa_mod
        captured = {}

        def fake_fetch(kind, config, secret_ref, cursor):
            captured["config"] = config
            captured["secret_ref"] = secret_ref
            return [{"id": "x1"}], None

        monkeypatch.setattr(sa_mod, "fetch_page", fake_fetch)
        r = client.post(f"/api/v2/data-sources/{sid}/poll")
        assert r.status_code == 200, r.text
        assert captured["config"]["endpoint"] == "https://odps.example.com/api"
        assert captured["config"]["project"] == "proj_d5"
        assert captured["config"]["table"] == "tbl_a"
        from app.secrets import decrypt_payload
        sec = decrypt_payload(captured["secret_ref"])
        # 凭据来自 Connection（aksk 约定 {access_key, secret_key}）
        assert sec.get("access_key") == "AK_TICK"
    finally:
        _cleanup(cid)


def test_validation_requires_connection_or_endpoint():
    r = client.post("/api/v2/data-sources", json={
        "name": "d5-bad-mc", "kind": "maxcompute", "config": {"table": "t"}})
    assert r.status_code == 422
    r = client.post("/api/v2/data-sources", json={
        "name": "d5-bad-sls", "kind": "sls", "config": {"logstore": "ls"}})
    assert r.status_code == 422
    # 兼容模式仍可用
    r = client.post("/api/v2/data-sources", json={
        "name": "d5-compat-mc", "kind": "maxcompute",
        "config": {"endpoint": "https://odps.example.com/api",
                   "project": "p", "table": "t"}})
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    _cleanup_direct(sid)


def _cleanup_direct(sid: str):
    db = SessionLocal()
    try:
        db.query(DataSource).filter(DataSource.id == sid).delete()
        db.commit()
    finally:
        db.close()
