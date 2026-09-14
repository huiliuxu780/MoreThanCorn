"""D3 数据源治理端点回归（09-14 用户拍板：独立详情页 + 治理闭环）。

覆盖：
- GET /api/v2/data-sources/{id} 单源读取；
- PATCH：名称/config（polling url 校验+保存时过 egress）/status 暂停恢复/
  archived=true 经 PATCH 拒绝（归档只走 DELETE）；
- DELETE 归档语义：被路由/事件引用 → 409 + references 清单；无引用 → archived，
  列表默认隐藏、includeArchived=yes 可见、PATCH archived=false 可恢复；
- POST /{id}/regenerate-token：旧 token 即刻失效（webhook 401）、新 token 可用；
- GET /api/v2/event-deliveries?sourceId= 只返回该源流水。
"""
from __future__ import annotations

import hashlib

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import DataSource, DataSourceEvent, EventDelivery, EventRoute

client = TestClient(app)


def _mk_source(kind: str = "webhook", name: str = "d3-gov-src") -> dict:
    cfg = ({"url": "https://example.internal/items", "interval_seconds": 60}
           if kind == "api_pull" else {})
    r = client.post("/api/v2/data-sources",
                    json={"name": name, "kind": kind, "config": cfg})
    assert r.status_code == 200, r.text
    return r.json()


def _cleanup(*ids: str):
    db = SessionLocal()
    try:
        ev_ids = [r[0] for r in db.query(DataSourceEvent.id).filter(
            DataSourceEvent.source_id.in_(ids or ("-",)) ).all()]
        if ev_ids:
            db.query(EventDelivery).filter(
                EventDelivery.event_id.in_(ev_ids)).delete(synchronize_session=False)
            db.query(DataSourceEvent).filter(
                DataSourceEvent.id.in_(ev_ids)).delete(synchronize_session=False)
        db.query(EventRoute).filter(
            EventRoute.source_id.in_(ids or ("-",))).delete(synchronize_session=False)
        db.query(DataSource).filter(
            DataSource.id.in_(ids or ("-",))).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def test_get_single_source():
    src = _mk_source(name="d3-get-src")
    try:
        r = client.get(f"/api/v2/data-sources/{src['id']}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["kind"] == "webhook" and d["archived"] is False
        assert d["has_token"] is True  # create 时已发 token
        assert client.get("/api/v2/data-sources/nope").status_code == 404
    finally:
        _cleanup(src["id"])


def test_patch_name_config_status():
    src = _mk_source(kind="api_pull", name="d3-patch-src")
    try:
        # polling url 校验 + 保存时 egress（私网地址在非生产放行、格式仍校验）
        r = client.patch(f"/api/v2/data-sources/{src['id']}",
                         json={"config": {"url": "ftp://bad"}})
        assert r.status_code == 422, r.text
        r = client.patch(f"/api/v2/data-sources/{src['id']}",
                         json={"name": "d3-patch-renamed",
                               "config": {"url": "https://example.internal/t",
                                          "interval_seconds": 120},
                               "status": "paused"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == "d3-patch-renamed" and d["status"] == "paused"
        assert d["config"]["interval_seconds"] == 120
        # 归档只走 DELETE
        r = client.patch(f"/api/v2/data-sources/{src['id']}",
                         json={"archived": True})
        assert r.status_code == 422, r.text
        # 恢复
        r = client.patch(f"/api/v2/data-sources/{src['id']}",
                         json={"status": "active"})
        assert r.json()["status"] == "active"
    finally:
        _cleanup(src["id"])


def test_delete_archive_semantics_and_references():
    src = _mk_source(name="d3-del-src")
    try:
        db = SessionLocal()
        try:
            db.add(EventRoute(source_id=src["id"], destination_kind="automation",
                              destination_id="auto-x", revision=1))
            db.commit()
        finally:
            db.close()
        r = client.delete(f"/api/v2/data-sources/{src['id']}")
        assert r.status_code == 409, r.text
        detail = r.json()["detail"]
        assert detail["code"] == "SOURCE_REFERENCED"
        assert any(x["kind"] == "event_route" for x in detail["references"])
        # 清掉引用后归档成功
        db = SessionLocal()
        try:
            db.query(EventRoute).filter(
                EventRoute.source_id == src["id"]).delete()
            db.commit()
        finally:
            db.close()
        r = client.delete(f"/api/v2/data-sources/{src['id']}")
        assert r.status_code == 200 and r.json()["archived"] is True
        # 列表默认隐藏 / includeArchived 可见 / PATCH 恢复
        items = client.get("/api/v2/data-sources").json()["items"]
        assert src["id"] not in [x["id"] for x in items]
        items = client.get("/api/v2/data-sources?includeArchived=yes").json()["items"]
        assert src["id"] in [x["id"] for x in items]
        r = client.patch(f"/api/v2/data-sources/{src['id']}",
                         json={"archived": False})
        assert r.status_code == 200 and r.json()["archived"] is False
    finally:
        _cleanup(src["id"])


def test_regenerate_token_invalidates_old():
    src = _mk_source(name="d3-token-src")
    try:
        old_token = src["webhook_token"]
        r = client.post(f"/api/v2/data-sources/{src['id']}/regenerate-token")
        assert r.status_code == 200, r.text
        new_token = r.json()["webhook_token"]
        assert new_token != old_token and r.json()["note"]
        # 旧 token 即刻失效
        r = client.post(f"/api/v2/ingress/webhook/{src['id']}",
                        json={"id": "evt-old"},
                        headers={"X-Source-Token": old_token})
        assert r.status_code == 401, r.text
        # 新 token 可用
        r = client.post(f"/api/v2/ingress/webhook/{src['id']}",
                        json={"id": "evt-new"},
                        headers={"X-Source-Token": new_token})
        assert r.status_code == 200, r.text
        # 非 webhook 源 404
        p = _mk_source(kind="api_pull", name="d3-token-poll")
        assert client.post(
            f"/api/v2/data-sources/{p['id']}/regenerate-token").status_code == 404
        _cleanup(p["id"])
    finally:
        _cleanup(src["id"])


def test_deliveries_sourceId_filter():
    a = _mk_source(name="d3-flow-a")
    b = _mk_source(name="d3-flow-b")
    try:
        db = SessionLocal()
        try:
            for src, n in ((a, 2), (b, 1)):
                for i in range(n):
                    ev = DataSourceEvent(source_id=src["id"],
                                         dedupe_key=f"k{i}", payload={})
                    db.add(ev)
                    db.flush()
                    db.add(EventDelivery(event_id=ev.id, source="event",
                                         status="completed",
                                         destination_kind="automation",
                                         destination_id="auto-x",
                                         invocation_id=f"inv-{src['id'][:4]}-{i}"))
            db.commit()
        finally:
            db.close()
        items = client.get(f"/api/v2/event-deliveries?sourceId={a['id']}").json()["items"]
        assert len(items) == 2 and all(
            i["invocationId"].startswith(f"inv-{a['id'][:4]}") for i in items)
        items = client.get(f"/api/v2/event-deliveries?sourceId={b['id']}").json()["items"]
        assert len(items) == 1
    finally:
        _cleanup(a["id"], b["id"])
