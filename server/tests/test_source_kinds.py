"""09-14 数据源类型体系回归（maxcompute / api_pull / webhook / 飞书多维表格）。

- kind 校验：未知 kind 422；分类型必填保存即拒；polling 存量迁移 api_pull（g059）；
- api_pull 适配器：鉴权头三形（bearer 裸串/dict api_key/basic）+ cursor 递增 + 尾页停；
- 飞书适配器：tenant_access_token → bitable records 分页（mock httpx，全链路含 fields 展平）；
- maxcompute：pyodps 缺失失败关闭（SourceDriverMissing，不 mock 回落）；
- /secret 端点：加密存储不回显、clear 语义；create 带 secret 落 secret_ref；
- /poll：推送型 kind 409、拉取型走适配器（mock）+ 游标落 src.cursor + ingest 去重键带源前缀。
"""
from __future__ import annotations

import json

import os

import pytest
from fastapi.testclient import TestClient

import app.source_adapters as sa
from app.secrets import encrypt_secret, serialize_secret


def _ref(secret) -> str:
    """凭据→加密 ref（fetch_page 只收 ref，明文不进路由层）。"""
    return encrypt_secret(serialize_secret(secret))
from app.db import SessionLocal
from app.main import app
from app.models import DataSource, DataSourceEvent, EventDelivery

client = TestClient(app)


class _Resp:
    def __init__(self, payload, status=200):
        self._p = payload
        self.status_code = status

    def json(self):
        return self._p

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")


def _cleanup(*ids: str):
    db = SessionLocal()
    try:
        ev_ids = [r[0] for r in db.query(DataSourceEvent.id).filter(
            DataSourceEvent.source_id.in_(ids or ("-",))).all()]
        if ev_ids:
            db.query(EventDelivery).filter(
                EventDelivery.event_id.in_(ev_ids)).delete(synchronize_session=False)
            db.query(DataSourceEvent).filter(
                DataSourceEvent.id.in_(ev_ids)).delete(synchronize_session=False)
        db.query(DataSource).filter(
            DataSource.id.in_(ids or ("-",))).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


# ---------- kind 校验与迁移 ----------

def test_kind_validation_and_migration():
    r = client.post("/api/v2/data-sources",
                    json={"name": "k-bad", "kind": "polling", "config": {}})
    assert r.status_code == 422, "polling 已迁移为 api_pull，旧值应拒"
    r = client.post("/api/v2/data-sources",
                    json={"name": "k-bad2", "kind": "nope", "config": {}})
    assert r.status_code == 422
    r = client.post("/api/v2/data-sources",
                    json={"name": "k-feishu-missing", "kind": "feishu_bitable",
                          "config": {"app_token": "x"}})
    assert r.status_code == 422 and "table_id" in r.json()["detail"]
    r = client.post("/api/v2/data-sources",
                    json={"name": "k-mc-missing", "kind": "maxcompute",
                          "config": {"endpoint": "https://odps.example.com"}})
    assert r.status_code == 422
    # 存量迁移：库内不应再有 polling 行
    db = SessionLocal()
    try:
        assert db.query(DataSource).filter_by(kind="polling").count() == 0
    finally:
        db.close()


@pytest.fixture()
def _secret_key():
    """函数级启用真信封加密：不依赖 import 顺序（test_skill_shell 的模块级
    env 操作会在其 teardown 清掉 WF_SECRET_KEY，import 期 setdefault 会被踩）。"""
    from cryptography.fernet import Fernet
    old = os.environ.get("WF_SECRET_KEY")
    os.environ["WF_SECRET_KEY"] = Fernet.generate_key().decode()
    yield
    if old is None:
        os.environ.pop("WF_SECRET_KEY", None)
    else:
        os.environ["WF_SECRET_KEY"] = old


def test_create_with_secret_stores_encrypted(_secret_key):
    r = client.post("/api/v2/data-sources", json={
        "name": "k-feishu-ok", "kind": "feishu_bitable",
        "config": {"app_token": "bascnXXXX", "table_id": "tblYYY"},
        "secret": {"app_id": "cli_a", "app_secret": "sec_b"}})
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    try:
        d = client.get(f"/api/v2/data-sources/{sid}").json()
        assert d["has_secret"] is True
        db = SessionLocal()
        try:
            row = db.get(DataSource, sid)
            raw = row.secret_ref or ""
            assert "cli_a" not in raw and "sec_b" not in raw, "凭据不得明文落库"
        finally:
            db.close()
        # /secret 更新与 clear
        r2 = client.post(f"/api/v2/data-sources/{sid}/secret",
                         json={"secret": {"app_id": "cli_c", "app_secret": "sec_d"}})
        assert r2.status_code == 200 and r2.json()["has_secret"] is True
        r3 = client.post(f"/api/v2/data-sources/{sid}/secret",
                         json={"secret": {"clear": True}})
        assert r3.status_code == 200 and r3.json()["has_secret"] is False
    finally:
        _cleanup(sid)


# ---------- api_pull 适配器 ----------

def test_api_pull_auth_forms_and_cursor(monkeypatch):
    calls = []

    def fake_get(url, params=None, timeout=None, headers=None, follow_redirects=None):
        calls.append({"url": url, "params": params, "headers": headers or {}})
        if not params or not params.get("after"):
            return _Resp([{"id": "1", "v": "a"}, {"id": "2", "v": "b"}])
        return _Resp([{"id": "3", "v": "c"}])

    monkeypatch.setattr(sa.httpx, "get", fake_get)
    cfg = {"url": "https://api.example.com/items", "cursor_field": "id",
           "page_size": 2}
    rows, nxt = sa.fetch_page("api_pull", cfg, _ref("tok123"), None)
    assert len(rows) == 2 and nxt == "2", "满页应给出下一页游标"
    assert calls[0]["headers"]["Authorization"] == "Bearer tok123"
    rows2, nxt2 = sa.fetch_page("api_pull", cfg,
                                _ref({"type": "api_key", "header": "X-Key", "value": "k9"}), "2")
    assert calls[1]["headers"]["X-Key"] == "k9"
    assert calls[1]["params"]["after"] == "2"
    assert len(rows2) == 1 and nxt2 is None, "尾页（不足 page_size）应停游标"
    # basic 形
    import base64
    sa.fetch_page("api_pull", {"url": "https://api.example.com/items"},
                  _ref({"type": "basic", "username": "u", "password": "p"}), None)
    expect = "Basic " + base64.b64encode(b"u:p").decode()
    assert calls[2]["headers"]["Authorization"] == expect


# ---------- 飞书适配器 ----------

def test_feishu_bitable_flow(monkeypatch):
    seen = {}

    def fake_post(url, json=None, timeout=None):
        seen["token_url"] = url
        seen["creds"] = json
        return _Resp({"code": 0, "tenant_access_token": "t-tenant-1"})

    def fake_get(url, params=None, timeout=None, headers=None, follow_redirects=None):
        seen["records_url"] = url
        seen["auth"] = headers.get("Authorization")
        seen["params"] = params
        if not params.get("page_token"):
            return _Resp({"code": 0, "data": {
                "items": [{"record_id": "rec1",
                           "fields": {"标题": "工单A", "状态": "新"}},
                          {"record_id": "rec2",
                           "fields": {"标题": "工单B", "状态": "处理中"}}],
                "has_more": True, "page_token": "pg2"}})
        return _Resp({"code": 0, "data": {
            "items": [{"record_id": "rec3", "fields": {"标题": "工单C"}}],
            "has_more": False}})

    monkeypatch.setattr(sa.httpx, "post", fake_post)
    monkeypatch.setattr(sa.httpx, "get", fake_get)
    rows, nxt = sa.fetch_page("feishu_bitable",
                              {"app_token": "bascnX", "table_id": "tblY"},
                              _ref({"app_id": "cli_a", "app_secret": "sec_b"}), None)
    assert seen["creds"] == {"app_id": "cli_a", "app_secret": "sec_b"}
    assert seen["auth"] == "Bearer t-tenant-1"
    assert "bitable/v1/apps/bascnX/tables/tblY/records" in seen["records_url"]
    assert rows[0]["record_id"] == "rec1" and rows[0]["标题"] == "工单A"
    assert nxt == "pg2"
    rows2, nxt2 = sa.fetch_page("feishu_bitable",
                                {"app_token": "bascnX", "table_id": "tblY"},
                                _ref({"app_id": "cli_a", "app_secret": "sec_b"}), "pg2")
    assert len(rows2) == 1 and nxt2 is None
    # 凭据缺失失败关闭
    with pytest.raises(sa.SourceFetchError):
        sa.fetch_page("feishu_bitable", {"app_token": "x", "table_id": "y"}, "", None)
    # 飞书业务错误码透传
    monkeypatch.setattr(sa.httpx, "get",
                        lambda *a, **k: _Resp({"code": 91403, "msg": "forbidden"}))
    with pytest.raises(sa.SourceFetchError, match="91403"):
        sa.fetch_page("feishu_bitable", {"app_token": "x", "table_id": "y"},
                      _ref({"app_id": "a", "app_secret": "b"}), None)


# ---------- maxcompute 失败关闭 ----------

def test_maxcompute_driver_missing_fail_closed(monkeypatch):
    """pyodps 已安装后仍须验证失败关闭路径：模拟驱动缺失（import 阻断）。"""
    import sys
    monkeypatch.setitem(sys.modules, "odps", None)
    with pytest.raises(sa.SourceDriverMissing, match="pyodps"):
        sa.fetch_page("maxcompute",
                      {"endpoint": "https://odps.example.com", "project": "p",
                       "table": "t"},
                      _ref({"access_key_id": "ak", "access_key_secret": "sk"}), None)


# ---------- /poll 端点 ----------

def test_poll_endpoint_kinds_and_cursor(monkeypatch):
    wh = client.post("/api/v2/data-sources",
                     json={"name": "p-webhook", "kind": "webhook", "config": {}})
    sid_wh = wh.json()["id"]
    ap = client.post("/api/v2/data-sources", json={
        "name": "p-api", "kind": "api_pull",
        "config": {"url": "https://api.example.com/items", "cursor_field": "id"}})
    sid_ap = ap.json()["id"]
    try:
        assert client.post(f"/api/v2/data-sources/{sid_wh}/poll").status_code == 409

        def fake_get(url, params=None, timeout=None, headers=None, follow_redirects=None):
            return _Resp([{"id": "r1", "v": "x"}, {"id": "r2", "v": "y"}])

        monkeypatch.setattr(sa.httpx, "get", fake_get)
        r = client.post(f"/api/v2/data-sources/{sid_ap}/poll")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["polled"] == 2 and body["pages"] == 1
        db = SessionLocal()
        try:
            src = db.get(DataSource, sid_ap)
            assert src.status == "active" and src.last_poll_at is not None
            keys = [r[0] for r in db.query(DataSourceEvent.dedupe_key).filter(
                DataSourceEvent.source_id == sid_ap).all()]
            assert all(k.startswith(f"{sid_ap}:") for k in keys), "去重键带源前缀"
            assert sorted(keys) == sorted([f"{sid_ap}:r1", f"{sid_ap}:r2"])
        finally:
            db.close()
        # 再拉一次：同去重键 → 不新增事件（ingest 去重）
        r2 = client.post(f"/api/v2/data-sources/{sid_ap}/poll")
        assert r2.json()["dispatched"] == 0
        db = SessionLocal()
        try:
            n = db.query(DataSourceEvent).filter(
                DataSourceEvent.source_id == sid_ap).count()
            assert n == 2
        finally:
            db.close()
    finally:
        _cleanup(sid_wh, sid_ap)


# ---------- SLS 适配器 ----------

class _FakeLog:
    def __init__(self, contents, t):
        self._c, self._t = contents, t

    def get_contents(self):
        return self._c

    def get_time(self):
        return self._t


class _FakeResp:
    def __init__(self, logs):
        self._logs = logs

    def get_logs(self):
        return self._logs


def test_sls_cursor_semantics(monkeypatch):
    calls = []

    def fake_client(secret, endpoint):
        class C:
            def get_logs(self, req):
                calls.append({"offset": req.offset, "line": req.line,
                              "query": req.query})
                if req.offset == 0:
                    return _FakeResp([_FakeLog({"msg": "a", "level": "ERROR"}, 1000),
                                      _FakeLog({"msg": "b"}, 1000)])
                return _FakeResp([])
        return C()

    monkeypatch.setattr(sa, "_sls_client", fake_client)
    cfg = {"endpoint": "cn-shanghai.log.aliyuncs.com", "project": "p",
           "logstore": "ls", "page_size": 2}
    rows, nxt = sa.fetch_page("sls", cfg,
                              _ref({"access_key_id": "ak", "access_key_secret": "sk"}),
                              None)
    assert len(rows) == 2 and rows[0]["msg"] == "a" and rows[0]["__time__"] == 1000
    assert nxt.endswith(":2"), "满页 offset 递增"
    rows2, nxt2 = sa.fetch_page("sls", cfg,
                                _ref({"access_key_id": "ak", "access_key_secret": "sk"}),
                                nxt)
    assert calls[1]["offset"] == 2
    assert rows2 == [] and nxt2 == nxt, "空页游标保持（同秒后到日志靠 offset 续取）"
    with pytest.raises(sa.SourceFetchError):
        sa.fetch_page("sls", {"endpoint": "e", "project": "p"}, "", None)


def test_sls_missing_secret_fail_closed():
    """凭据缺失失败关闭（不 monkeypatch _sls_client，走真实校验）。"""
    with pytest.raises(sa.SourceFetchError, match="access_key"):
        sa.fetch_page("sls", {"endpoint": "e", "project": "p", "logstore": "l"},
                      "", None)
