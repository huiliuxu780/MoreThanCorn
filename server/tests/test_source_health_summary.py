"""16 号稿 B1：拉取健康三列（g061）+ health-summary 聚合端点。

- tick 双路写：失败留 last_poll_error/ok=False；成功清零+count；
- health-summary：events24h / deliveries24h（filtered=事件证据）/ routeCount 聚合正确；
- 常数条查询（4 条 group by），不进 N+1 白名单。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import app.source_adapters as adapters
from app.db import SessionLocal
from app.main import app as fastapi_app
from app.models import DataSource, DataSourceEvent, EventRoute
from app.routers.as_automations import tick_pull_source

client = TestClient(fastapi_app)
_MARK = "hs-t"


def _mk_source(kind: str = "sls", cfg: dict | None = None) -> str:
    db = SessionLocal()
    try:
        s = DataSource(name=f"{_MARK}-{kind}", kind=kind, config=cfg or {},
                       status="active")
        db.add(s)
        db.commit()
        return s.id
    finally:
        db.close()


def _cleanup():
    db = SessionLocal()
    try:
        sids = [r[0] for r in db.query(DataSource.id).filter(
            DataSource.name.like(f"{_MARK}%")).all()]
        if sids:
            db.query(DataSourceEvent).filter(
                DataSourceEvent.source_id.in_(sids)).delete(synchronize_session=False)
            db.query(EventRoute).filter(
                EventRoute.source_id.in_(sids)).delete(synchronize_session=False)
            db.query(DataSource).filter(DataSource.id.in_(sids)).delete(
                synchronize_session=False)
        db.commit()
    finally:
        db.close()


class TestTickHealthColumns:
    def setup_method(self):
        _cleanup()

    def teardown_method(self):
        _cleanup()

    def test_failure_persists_error(self):
        sid = _mk_source("sls", {"endpoint": "cn-x.log.aliyuncs.com", "project": "p"})
        db = SessionLocal()
        try:
            from fastapi import HTTPException
            with pytest.raises(HTTPException) as ei:
                tick_pull_source(db, db.get(DataSource, sid))
            assert ei.value.status_code == 502
            db.expire_all()
            s = db.get(DataSource, sid)
            assert s.status == "error"
            assert s.last_poll_ok is False
            assert "logstore" in s.last_poll_error or "SLS" in s.last_poll_error
        finally:
            db.close()

    def test_success_clears_and_counts(self, monkeypatch):
        sid = _mk_source("sls", {"endpoint": "e", "project": "p", "logstore": "l"})

        def _fake_fetch(kind, cfg, secret_ref, cursor):
            return ([{"content": "x1"}, {"content": "x2"}], None)

        monkeypatch.setattr(adapters, "fetch_page", _fake_fetch)
        db = SessionLocal()
        try:
            out = tick_pull_source(db, db.get(DataSource, sid))
            assert out["polled"] == 2
            db.expire_all()
            s = db.get(DataSource, sid)
            assert s.last_poll_ok is True
            assert s.last_poll_error == ""
            assert s.last_poll_count == 2
            assert s.last_poll_at is not None
        finally:
            db.close()


class TestHealthSummary:
    def setup_method(self):
        _cleanup()

    def teardown_method(self):
        _cleanup()

    def test_aggregation(self):
        sid = _mk_source("webhook")
        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            for i, status in enumerate(["filtered", "filtered", "dispatched"]):
                db.add(DataSourceEvent(
                    source_id=sid, dedupe_key=f"{_MARK}-k{i}", payload={},
                    status=status, created_at=now - timedelta(hours=1)))
            db.add(EventRoute(source_id=sid, destination_kind="automation",
                              destination_id="a1"))
            db.commit()
        finally:
            db.close()
        r = client.get("/api/v2/data-sources/health-summary")
        assert r.status_code == 200, r.text
        row = next(i for i in r.json()["items"] if i["sourceId"] == sid)
        assert row["events24h"] == 3
        assert row["deliveries24h"]["filtered"] == 2
        assert row["deliveries24h"]["completed"] == 0
        assert row["routeCount"] == 1
        assert row["lastPollOk"] is True  # 默认值：从未拉取≠失败

    def test_constant_query_count(self):
        """N+1 门禁文化：源行数增长时 SELECT 条数恒定（4 group by + 源列表）。"""
        for k in ("webhook", "sls", "test_event"):
            _mk_source(k)
        from sqlalchemy import event
        from app.db import engine
        counter = {"n": 0}

        def _count(conn, cursor, statement, parameters, context, execmany):
            if statement.strip().upper().startswith("SELECT"):
                counter["n"] += 1

        event.listen(engine, "before_cursor_execute", _count)
        try:
            r = client.get("/api/v2/data-sources/health-summary")
            assert r.status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", _count)
        assert counter["n"] <= 6, f"health-summary SELECT 条数非常数：{counter['n']}"

    def test_old_events_excluded(self):
        sid = _mk_source("webhook")
        db = SessionLocal()
        try:
            db.add(DataSourceEvent(
                source_id=sid, dedupe_key=f"{_MARK}-old", payload={},
                status="filtered",
                created_at=datetime.now(timezone.utc) - timedelta(hours=30)))
            db.commit()
        finally:
            db.close()
        r = client.get("/api/v2/data-sources/health-summary")
        row = next(i for i in r.json()["items"] if i["sourceId"] == sid)
        assert row["events24h"] == 0
