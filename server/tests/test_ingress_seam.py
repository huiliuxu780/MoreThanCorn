"""09-15 接缝（IA 原则 P1/P2 合并案）：建源即链接连接与资产，杜绝两视角分叉。

- create_source 应用 connection_id/asset_id（原仅 PATCH 应用= D5 契约缺口）；
- 目录型源（maxcompute/sls）未指定资产时自动落 DataAsset（同 connection+location 复用）；
- 资产 references 含 ingress_source（资产卡「被 N 处引用」与删除守卫可见）。
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app as fastapi_app
from app.models import DataAsset, DataSource
from app.resource_registry import references

client = TestClient(fastapi_app)
_MARK = "seam-t"


def _mk_conn() -> str:
    r = client.post("/api/connections", json={
        "name": f"{_MARK}-mc-conn", "kind": "aksk", "protocol": "maxcompute",
        "endpoint": {"endpoint": "https://odps.example.com/api", "project": "proj_seam"},
        "secret": {"access_key": "ak", "secret_key": "sk"}})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _cleanup():
    db = SessionLocal()
    try:
        sids = [r[0] for r in db.query(DataSource.id).filter(
            DataSource.name.like(f"{_MARK}%")).all()]
        if sids:
            db.query(DataSource).filter(DataSource.id.in_(sids)).delete(
                synchronize_session=False)
        aids = [r[0] for r in db.query(DataAsset.id).filter(
            DataAsset.name.like(f"{_MARK}%")).all()]
        if aids:
            db.query(DataAsset).filter(DataAsset.id.in_(aids)).delete(
                synchronize_session=False)
        from app.models import Connection, ConnectionSecretRevision
        cids = [r[0] for r in db.query(Connection.id).filter(
            Connection.name.like(f"{_MARK}%")).all()]
        if cids:
            db.query(ConnectionSecretRevision).filter(
                ConnectionSecretRevision.connection_id.in_(cids)).delete(
                synchronize_session=False)
            db.query(Connection).filter(Connection.id.in_(cids)).delete(
                synchronize_session=False)
        db.commit()
    finally:
        db.close()


class TestIngressSeam:
    def setup_method(self):
        _cleanup()

    def teardown_method(self):
        _cleanup()

    def test_create_links_connection_and_auto_asset(self):
        cid = _mk_conn()
        r = client.post("/api/v2/data-sources", json={
            "name": f"{_MARK}-src-1", "kind": "maxcompute",
            "connection_id": cid,
            "config": {"table": f"{_MARK}_tbl", "page_size": 50}})
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        db = SessionLocal()
        try:
            src = db.get(DataSource, sid)
            assert src.connection_id == cid, "connection_id 创建时被静默丢弃（D5 缺口回归）"
            assert src.asset_id, "目录型源未自动落资产"
            asset = db.get(DataAsset, src.asset_id)
            assert asset.location == f"{_MARK}_tbl"
            assert (asset.config or {}).get("connection_id") == cid
            # references 含 ingress_source（资产卡被消费可见）
            kinds = [x["kind"] for x in references(db, "asset", asset.id)]
            assert "ingress_source" in kinds
        finally:
            db.close()

    def test_auto_asset_reused_not_duplicated(self):
        cid = _mk_conn()
        for i in (1, 2):
            r = client.post("/api/v2/data-sources", json={
                "name": f"{_MARK}-src-{i}", "kind": "maxcompute",
                "connection_id": cid,
                "config": {"table": f"{_MARK}_tbl_shared"}})
            assert r.status_code == 200, r.text
        db = SessionLocal()
        try:
            assets = db.query(DataAsset).filter(
                DataAsset.location == f"{_MARK}_tbl_shared").all()
            assert len(assets) == 1, f"同 connection+location 应复用资产，实际 {len(assets)}"
            srcs = db.query(DataSource).filter(
                DataSource.name.like(f"{_MARK}-src-%")).all()
            assert {s.asset_id for s in srcs} == {assets[0].id}
            kinds = [x["kind"] for x in references(db, "asset", assets[0].id)]
            assert kinds.count("ingress_source") == 2
        finally:
            db.close()
