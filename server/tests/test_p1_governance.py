"""09-SDD P1-B4 / P1-04：数据治理——Schema 演进校验 + Eligibility 过滤 + 水位/去重。

先红后绿：当前发布定义不校验破坏性 Schema 变更；task_runner 不消费 eligibility。
"""
import uuid

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import DataDefinition

client = TestClient(app)


def _mk_asset_with_rows(rows):
    return client.post("/api/data-assets", json={"name": f"P1G-{uuid.uuid4().hex[:6]}", "rows": rows}).json()


def test_definition_publish_rejects_required_field_removal():
    """已发布版本含必填字段 A；新版本删掉 A → 破坏性变更，发布应拒绝。"""
    asset = _mk_asset_with_rows([{"interactionId": "X", "fieldA": "v", "fieldB": "w"}])
    d = client.post("/api/data-definitions", json={
        "name": f"P1G-def-{uuid.uuid4().hex[:5]}", "assetId": asset["id"],
        "fieldSchema": [
            {"key": "interactionId", "type": "String", "required": True},
            {"key": "fieldA", "type": "String", "required": True},
        ]}).json()
    p1 = client.post(f"/api/data-definitions/{d['id']}/publish")
    assert p1.status_code == 200, p1.text
    # 删除必填 fieldA → 破坏性
    client.put(f"/api/data-definitions/{d['id']}", json={
        "fieldSchema": [{"key": "interactionId", "type": "String", "required": True}]})
    p2 = client.post(f"/api/data-definitions/{d['id']}/publish")
    assert p2.status_code == 409, f"删除必填字段应拒绝发布（实际 {p2.status_code}）"
    # 保留必填、仅新增可选字段 → 允许
    client.put(f"/api/data-definitions/{d['id']}", json={
        "fieldSchema": [
            {"key": "interactionId", "type": "String", "required": True},
            {"key": "fieldA", "type": "String", "required": True},
            {"key": "fieldC", "type": "String", "required": False},
        ]})
    p3 = client.post(f"/api/data-definitions/{d['id']}/publish")
    assert p3.status_code == 200, "新增可选字段应允许发布"


def test_definition_publish_rejects_required_type_change():
    asset = _mk_asset_with_rows([{"interactionId": "X", "num": "1"}])
    d = client.post("/api/data-definitions", json={
        "name": f"P1G-typ-{uuid.uuid4().hex[:5]}", "assetId": asset["id"],
        "fieldSchema": [{"key": "num", "type": "String", "required": True}]}).json()
    assert client.post(f"/api/data-definitions/{d['id']}/publish").status_code == 200
    # 必填字段类型 String→Number 属破坏性
    client.put(f"/api/data-definitions/{d['id']}", json={
        "fieldSchema": [{"key": "num", "type": "Number", "required": True}]})
    p = client.post(f"/api/data-definitions/{d['id']}/publish")
    assert p.status_code == 409, "必填字段类型变更应拒绝发布"
