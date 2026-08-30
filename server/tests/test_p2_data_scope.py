"""09-SDD P2-02：组织/团队/数据范围服务端强制执行（单租户内团队维度）。

越权矩阵：team 范围用户仅见本队成员创建的任务；详情越权 403；admin/scope=all 直通；
scope 管理端点校验（team 必填）。"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.auth import hash_password
from app.db import SessionLocal
from app.main import app
from app.models import AnalysisTask, AppUser

client = TestClient(app)


@pytest.fixture
def auth_on(monkeypatch):
    monkeypatch.setenv("WF_AUTH", "on")
    monkeypatch.setenv("WF_SECRET_KEY", "p2-scope-key-0123456789")
    yield


def _login(username: str, password: str = "pass12345"):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def _mk_user(role: str, team: str = "", scope: str = "all") -> str:
    name = f"{role}-{team or 'x'}-{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    try:
        u = AppUser(username=name, password_hash=hash_password("pass12345"),
                    role=role, team=team, data_scope=scope)
        db.add(u)
        db.commit()
        return name
    finally:
        db.close()


def _mk_task(created_by: str) -> str:
    db = SessionLocal()
    try:
        t = AnalysisTask(name=f"scope-t-{uuid.uuid4().hex[:6]}", created_by=created_by,
                         updated_by=created_by, data_asset_id="asset-scope-test",
                         workflow_id="wf-scope-test")
        db.add(t)
        db.commit()
        return t.id
    finally:
        db.close()


def _hdr(tok: str):
    return {"Authorization": f"Bearer {tok}"}


def test_team_scope_list_and_detail_403(auth_on):
    alice = _mk_user("operator", team="A", scope="team")
    bob = _mk_user("viewer", team="B", scope="team")
    t_alice = _mk_task(alice)
    t_admin = _mk_task("admin")

    tok_alice = _login(alice).json()["token"]
    tok_bob = _login(bob).json()["token"]
    tok_admin = _login("admin", "admin").json()["token"]

    # alice（team A）只见本队创建的任务
    ids = {t["id"] for t in client.get("/api/tasks", headers=_hdr(tok_alice)).json()["items"]}
    assert t_alice in ids and t_admin not in ids
    # bob（team B）两者都不可见
    ids_b = {t["id"] for t in client.get("/api/tasks", headers=_hdr(tok_bob)).json()["items"]}
    assert t_alice not in ids_b and t_admin not in ids_b
    # 详情越权 403
    assert client.get(f"/api/tasks/{t_alice}", headers=_hdr(tok_bob)).status_code == 403
    # 本队可见详情
    assert client.get(f"/api/tasks/{t_alice}", headers=_hdr(tok_alice)).status_code == 200
    # admin 直通
    ids_ad = {t["id"] for t in client.get("/api/tasks", headers=_hdr(tok_admin)).json()["items"]}
    assert {t_alice, t_admin} <= ids_ad


def test_default_scope_all_unchanged(auth_on):
    carol = _mk_user("viewer", team="A", scope="all")
    t_alice = _mk_task(_mk_user("operator", team="A", scope="team"))
    tok = _login(carol).json()["token"]
    ids = {t["id"] for t in client.get("/api/tasks", headers=_hdr(tok)).json()["items"]}
    assert t_alice in ids  # scope=all 存量行为不变


def test_scope_admin_endpoint_validation(auth_on):
    admin = _login("admin", "admin").json()["token"]
    u = _mk_user("viewer")
    db = SessionLocal()
    try:
        uid = db.query(AppUser).filter_by(username=u if isinstance(u, str) else u["username"]).first().id
    finally:
        db.close()
    # dataScope=team 但无 team → 422
    r = client.post(f"/api/auth/users/{uid}/scope", headers=_hdr(admin),
                    json={"dataScope": "team"})
    assert r.status_code == 422
    # 合法设置 → 200 且 list 反映
    r = client.post(f"/api/auth/users/{uid}/scope", headers=_hdr(admin),
                    json={"team": "C", "dataScope": "team"})
    assert r.status_code == 200 and r.json()["team"] == "C"
    row = next(x for x in client.get("/api/auth/users", headers=_hdr(admin)).json()["items"]
               if x["id"] == uid)
    assert row["dataScope"] == "team" and row["team"] == "C"
    # 非法 dataScope → 422
    assert client.post(f"/api/auth/users/{uid}/scope", headers=_hdr(admin),
                       json={"dataScope": "bogus"}).status_code == 422
    # 非 admin 不可设置
    viewer_tok = _login(_mk_user("viewer")).json()["token"]
    assert client.post(f"/api/auth/users/{uid}/scope", headers=_hdr(viewer_tok),
                       json={"team": "C", "dataScope": "team"}).status_code == 403
