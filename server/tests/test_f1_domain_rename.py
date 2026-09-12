"""F1 领域拆名回归（2026-09-12，Spec §12/§19 F1）。

- canonical `/api/analysis-tasks*` 与兼容 `/api/automations*` 同表同数据（互读写一致）；
- 旧路由响应带 `Deprecation` 头 + successor Link，canonical 不带；
- 旧路由调用计入 legacy_route_stats（进程内计数）；
- DTO 函数改名（analysis_task_dto）与弃用别名可用。
"""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app import legacy_route_stats
from app.main import app

client = TestClient(app)


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _payload(name: str) -> dict:
    from tests.test_mtc002a_automations import _create_payload

    return _create_payload(name)


def test_alias_and_legacy_read_same_data():
    payload = _payload(u("f1-read"))
    created = client.post("/api/analysis-tasks", json=payload)
    assert created.status_code == 201, created.text
    tid = created.json()["id"]

    a = client.get(f"/api/analysis-tasks/{tid}")
    b = client.get(f"/api/automations/{tid}")
    assert a.status_code == b.status_code == 200
    assert a.json() == b.json(), "canonical 与兼容路由必须同形状同数据"

    la = client.get("/api/analysis-tasks")
    lb = client.get("/api/automations")
    ids_a = {x["id"] for x in la.json()["items"]}
    ids_b = {x["id"] for x in lb.json()["items"]}
    assert tid in ids_a and tid in ids_b


def test_alias_write_visible_via_legacy_and_tasks():
    payload = _payload(u("f1-write"))
    tid = client.post("/api/analysis-tasks", json=payload).json()["id"]
    # 兼容路由可改
    new_name = u("f1-renamed")
    upd = client.put(f"/api/automations/{tid}", json={"name": new_name})
    assert upd.status_code == 200 and upd.json()["name"] == new_name
    # legacy /api/tasks 可见（同表同数据）
    t = client.get(f"/api/tasks/{tid}")
    assert t.status_code == 200 and t.json()["name"] == new_name


def test_legacy_routes_carry_deprecation_headers():
    r = client.get("/api/automations")
    assert r.status_code == 200
    assert r.headers.get("Deprecation") == "true"
    assert "/api/analysis-tasks" in r.headers.get("Link", "")

    t = client.get("/api/tasks")
    assert t.headers.get("Deprecation") == "true"

    c = client.get("/api/analysis-tasks")
    assert "Deprecation" not in c.headers, "canonical 路由不得带 Deprecation"


def test_legacy_call_counted_in_stats():
    before = legacy_route_stats.snapshot().get("/api/automations", 0)
    client.get("/api/automations")
    client.get("/api/automations")
    after = legacy_route_stats.snapshot().get("/api/automations", 0)
    assert after == before + 2


def test_dto_deprecated_alias_available():
    from app.automation_dtos import (analysis_task_dto,
                                     automation_definition_dto)

    assert automation_definition_dto is analysis_task_dto
