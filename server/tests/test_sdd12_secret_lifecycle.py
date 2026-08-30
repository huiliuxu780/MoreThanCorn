"""SDD-12 P0-01/P0-02：Secret 生命周期——掩码保留合并、禁回显、轮换/清除账本、零泄漏。

验收映射：A-03、B-01、B-02、B-03、B-04（动态部分）。
运行前置：本文件显式设置合法 WF_SECRET_KEY，确保测试期间真实加密（非明文回落）。
"""
import json
import uuid

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import AuditLog, CallRecord, CheckRun, Connection, ConnectionSecretRevision

client = TestClient(app)

CANARY = f"CANARY-{uuid.uuid4().hex}"  # 任何响应/日志/审计出现该串即泄漏
NEW_SECRET = f"ROTATED-{uuid.uuid4().hex}"


@pytest.fixture(scope="module", autouse=True)
def _real_encryption():
    import os
    old = os.environ.get("WF_SECRET_KEY")
    os.environ["WF_SECRET_KEY"] = Fernet.generate_key().decode()
    yield
    if old is None:
        os.environ.pop("WF_SECRET_KEY", None)
    else:
        os.environ["WF_SECRET_KEY"] = old


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def _mk_conn(**extra) -> dict:
    body = {"name": u("sec"), "kind": "api_key", "protocol": "http-api",
            "endpoint": {"base_url": "https://gw.example.com/"},
            "environments": [
                {"code": "dev", "label": "日常", "endpoint": {"base_url": "https://dev.example.com/"}},
                {"code": "prod", "label": "生产", "endpoint": {"base_url": "https://prod.example.com/"},
                 "secret": f"ENV-{uuid.uuid4().hex}"},
            ],
            "default_env": "dev", "secret": CANARY}
    body.update(extra)
    r = client.post("/api/connections", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _db_secret_refs(cid: str) -> tuple[str, dict]:
    db = SessionLocal()
    try:
        c = db.get(Connection, cid)
        return c.secret_ref, {e["code"]: e.get("secret_ref") for e in (c.environments or [])}
    finally:
        db.close()


def test_a03_update_without_secret_preserves_all_refs():
    """A-03/P0-01：只改 label/endpoint 的普通更新不创建、不替换、不清空密钥。"""
    c = _mk_conn()
    root0, envs0 = _db_secret_refs(c["id"])
    assert root0 and envs0["prod"], "前置：根与 prod 环境均已配置密钥"

    r = client.put(f"/api/connections/{c['id']}", json={
        "endpoint": {"base_url": "https://gw2.example.com/"},
        "environments": [
            {"code": "dev", "label": "日常-改名", "endpoint": {"base_url": "https://dev2.example.com/"}},
            {"code": "prod", "label": "生产"},  # 未提交 secret：必须保留
        ], "default_env": "dev"})
    assert r.status_code == 200, r.text

    root1, envs1 = _db_secret_refs(c["id"])
    assert root1 == root0, "根密钥不得被普通更新替换"
    assert envs1["prod"] == envs0["prod"], "未提交环境密钥不得丢失（P0-01 止血）"
    assert envs1["dev"] == envs0.get("dev"), "无密钥环境保持无密钥"

    # 账本：普通更新不产生新 revision（B-02）
    db = SessionLocal()
    try:
        n = db.query(ConnectionSecretRevision).filter_by(connection_id=c["id"]).count()
        assert n == 2, f"仅创建时的根+prod 两条 revision，实际 {n}"
    finally:
        db.close()

    # 响应掩码：只有 configured 布尔，无明文
    row = client.get("/api/connections", params={"search": c["name"]}).json()["items"][0]
    assert CANARY not in json.dumps(row, ensure_ascii=False)
    assert row["secretConfigured"] is True
    assert row["environments"][1]["secretConfigured"] is True


def test_update_masked_variants_preserve():
    """§5.4：secret 缺省 / 空串 / '******' 均视为保留。"""
    c = _mk_conn()
    _, envs0 = _db_secret_refs(c["id"])
    for masked in (None, "", "******"):
        r = client.put(f"/api/connections/{c['id']}", json={
            "environments": [
                {"code": "dev", "label": "日常"},
                {"code": "prod", "label": "生产", "secret": masked},
            ], "default_env": "dev"})
        assert r.status_code == 200, r.text
        _, envs = _db_secret_refs(c["id"])
        assert envs["prod"] == envs0["prod"], f"掩码 {masked!r} 必须保留旧密钥"


def test_update_clear_secret_flag_only_way_to_clear():
    """§5.4：仅显式 clearSecret=true 清除环境密钥。"""
    c = _mk_conn()
    r = client.put(f"/api/connections/{c['id']}", json={
        "environments": [
            {"code": "dev", "label": "日常"},
            {"code": "prod", "label": "生产", "clearSecret": True},
        ], "default_env": "dev"})
    assert r.status_code == 200, r.text
    _, envs = _db_secret_refs(c["id"])
    assert envs["prod"] is None
    db = SessionLocal()
    try:
        active = db.query(ConnectionSecretRevision).filter_by(
            connection_id=c["id"], env_code="prod", status="active").count()
        retired = db.query(ConnectionSecretRevision).filter_by(
            connection_id=c["id"], env_code="prod", status="retired").count()
        assert active == 0 and retired == 1, "clearSecret 应退役旧 revision 且无新增"
    finally:
        db.close()


def test_put_root_secret_rejected_use_rotate():
    """§5.3：PUT 不再接受根级 secret；轮换必须走专用接口。"""
    c = _mk_conn()
    r = client.put(f"/api/connections/{c['id']}", json={"secret": "sneaky"})
    assert r.status_code == 422
    assert "secret:rotate" in json.dumps(r.json(), ensure_ascii=False)
    root_after, _ = _db_secret_refs(c["id"])
    assert "sneaky" not in root_after


def test_b01_reveal_disabled_410():
    c = _mk_conn()
    r = client.get(f"/api/connections/{c['id']}/reveal")
    assert r.status_code == 410
    assert r.json()["detail"]["code"] == "SECRET_REVEAL_DISABLED"
    # GET 详情同样不回明文，只回配置状态/版本
    g = client.get(f"/api/connections/{c['id']}").json()
    assert CANARY not in json.dumps(g, ensure_ascii=False)
    assert g["secretRevision"] == {
        "configured": True, "versionNo": 1,
        "rotatedAt": g["secretRevision"]["rotatedAt"], "rotatedBy": g["secretRevision"]["rotatedBy"]}


def test_b02_rotate_creates_new_revision_retires_old():
    c = _mk_conn()
    root0, _ = _db_secret_refs(c["id"])
    r = client.post(f"/api/connections/{c['id']}/secret:rotate", json={"secret": NEW_SECRET})
    assert r.status_code == 200, r.text
    assert r.json()["versionNo"] == 2
    root1, _ = _db_secret_refs(c["id"])
    assert root1 != root0, "轮换必须替换活引用密文"

    db = SessionLocal()
    try:
        rows = db.query(ConnectionSecretRevision).filter_by(
            connection_id=c["id"], env_code="").order_by(
            ConnectionSecretRevision.version_no).all()
        assert [x.status for x in rows] == ["retired", "active"]
        assert rows[0].retired_at is not None and rows[1].retired_at is None
        assert rows[0].payload_fingerprint != rows[1].payload_fingerprint
        assert NEW_SECRET not in json.dumps(
            {"e": r.json()}, ensure_ascii=False), "响应不得回显新密钥明文"
    finally:
        db.close()

    # 掩码轮换（空值）拒绝
    r2 = client.post(f"/api/connections/{c['id']}/secret:rotate", json={"secret": ""})
    assert r2.status_code == 422 and r2.json()["detail"]["code"] == "SECRET_REQUIRED"


def test_rotate_env_scoped():
    c = _mk_conn()
    r = client.post(f"/api/connections/{c['id']}/secret:rotate",
                    json={"secret": "env-new", "envCode": "prod"})
    assert r.status_code == 200 and r.json()["envCode"] == "prod"
    root, envs = _db_secret_refs(c["id"])
    db = SessionLocal()
    try:
        prod_active = db.query(ConnectionSecretRevision).filter_by(
            connection_id=c["id"], env_code="prod", status="active").first()
        assert prod_active.version_no == 2
        # 根级 revision 不受影响
        root_active = db.query(ConnectionSecretRevision).filter_by(
            connection_id=c["id"], env_code="", status="active").first()
        assert root_active.version_no == 1
    finally:
        db.close()
    assert root and envs["prod"], "根与 prod 均保持已配置"


def test_b03_clear_requires_admin_confirm_and_refs_check():
    c = _mk_conn()
    # 造引用：Tool 绑定该连接
    t = client.post("/api/tools", json={"name": u("tool"), "connectionId": c["id"],
                                        "spec": {"kind": "echo", "fixture": True}})
    assert t.status_code == 201, t.text

    # 缺确认口令 → 422
    r = client.post(f"/api/connections/{c['id']}/secret:clear", json={"confirm": "wrong"})
    assert r.status_code == 422
    # 有引用且未强制 → 409 + refs
    r = client.post(f"/api/connections/{c['id']}/secret:clear", json={"confirm": "CLEAR_SECRET"})
    assert r.status_code == 409
    assert any(ref["kind"] == "tool" for ref in r.json()["detail"]["refs"])
    # 确认+强制 → 清除成功并审计
    r = client.post(f"/api/connections/{c['id']}/secret:clear",
                    json={"confirm": "CLEAR_SECRET", "force": True})
    assert r.status_code == 200 and r.json()["retired"] == 1
    root, _ = _db_secret_refs(c["id"])
    assert root in ("", None)
    g = client.get(f"/api/connections/{c['id']}").json()
    assert g["secretConfigured"] is False and g["secretRevision"]["configured"] is False


def test_b04_no_plaintext_leak_in_api_audit_callrecord_checkrun():
    c = _mk_conn()
    # 触发各类写入：测试/轮换/清除/审计
    client.post(f"/api/connections/{c['id']}/test", json={})
    client.post(f"/api/connections/{c['id']}/secret:rotate", json={"secret": NEW_SECRET})
    client.post(f"/api/connections/{c['id']}/secret:clear",
                json={"confirm": "CLEAR_SECRET", "force": True})

    surfaces = []
    surfaces.append(client.get("/api/connections", params={"search": c["name"]}).text)
    surfaces.append(client.get(f"/api/connections/{c['id']}").text)
    surfaces.append(client.get(f"/api/connections/{c['id']}/usage").text)
    surfaces.append(client.get("/api/audit", params={"limit": 200}).text)

    db = SessionLocal()
    try:
        for a in db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(200).all():
            surfaces.append(json.dumps(a.detail or {}, ensure_ascii=False))
            surfaces.append(a.action)
        for cr in db.query(CallRecord).all():
            surfaces.append(json.dumps({"req": cr.request, "resp": cr.response,
                                        "err": cr.error}, ensure_ascii=False, default=str))
        for ck in db.query(CheckRun).filter_by(target_id=c["id"]).all():
            surfaces.append(json.dumps({"err": ck.error, "diag": ck.diagnostics},
                                       ensure_ascii=False, default=str))
        blob = "\n".join(surfaces)
        assert CANARY not in blob, "根密钥明文泄漏到 API/审计/调用记录"
        assert NEW_SECRET not in blob, "轮换密钥明文泄漏"
        # DB 侧：密文不含明文（合法 WF_SECRET_KEY 下真实加密）
        conn = db.get(Connection, c["id"])
        for e in conn.environments or []:
            ref = e.get("secret_ref")
            assert not ref or CANARY not in ref
        for rev in db.query(ConnectionSecretRevision).filter_by(connection_id=c["id"]).all():
            assert CANARY not in rev.encrypted_payload
            assert NEW_SECRET not in rev.encrypted_payload
    finally:
        db.close()
