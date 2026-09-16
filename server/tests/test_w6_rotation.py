"""09-17 W6 签名密钥轮换双活回归（15 号稿 W6，Stripe 式滚动期）。"""
from __future__ import annotations

import hashlib as _hl
import hmac as _hmac
import time as _t
from datetime import timedelta

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import DataSource

client = TestClient(app)
TOKENS: dict[str, str] = {}


SID_CURRENT = ""


def _sign(secret: str, body: bytes) -> dict:
    ts = str(int(_t.time()))
    sig = _hmac.new(secret.encode(), f"{ts}.".encode() + body,
                    _hl.sha256).hexdigest()
    return {"Content-Type": "application/json",
            "x-source-token": TOKENS.get(SID_CURRENT, ""),
            "x-mtc-signature": f"t={ts},v1={sig}"}


def _mk_source(signing: str) -> str:
    r = client.post("/api/v2/data-sources", json={
        "name": f"w6-{_t.time_ns()}", "kind": "webhook",
        "config": {}, "signing_secret": signing})
    assert r.status_code in (200, 201), r.text
    TOKENS[r.json()["id"]] = r.json()["webhook_token"]
    return r.json()["id"]


def test_rotation_dual_active_window():
    global SID_CURRENT
    sid = _mk_source("secret-A-0123456789")
    SID_CURRENT = sid
    body = b'{"type":"t","id":"i"}'
    assert client.post(f"/api/v2/ingress/webhook/{sid}", content=body,
                       headers=_sign("secret-A-0123456789", body)).status_code == 200
    # 轮换到 B
    r = client.post(f"/api/v2/data-sources/{sid}/signing-secret",
                    json={"secret": "secret-B-0123456789"})
    assert r.status_code == 200, r.text
    assert r.json()["rotated"] is True and r.json()["prev_active_until"]
    # 窗口内：新签 OK、旧签仍 OK（双活）
    assert client.post(f"/api/v2/ingress/webhook/{sid}", content=body,
                       headers=_sign("secret-B-0123456789", body)).status_code == 200
    assert client.post(f"/api/v2/ingress/webhook/{sid}", content=body,
                       headers=_sign("secret-A-0123456789", body)).status_code == 200
    # 窗口外：旧签 401、新签 OK
    with SessionLocal() as db:
        src = db.get(DataSource, sid)
        src.signing_secret_rotated_at = (
            src.signing_secret_rotated_at - timedelta(hours=25))
        db.commit()
    assert client.post(f"/api/v2/ingress/webhook/{sid}", content=body,
                       headers=_sign("secret-A-0123456789", body)).status_code == 401
    assert client.post(f"/api/v2/ingress/webhook/{sid}", content=body,
                       headers=_sign("secret-B-0123456789", body)).status_code == 200
    # 短 secret 拒绝
    r2 = client.post(f"/api/v2/data-sources/{sid}/signing-secret",
                     json={"secret": "short"})
    assert r2.status_code == 422


def test_webhook_rate_limit_shared():
    """09-17：限速走 Redis 分钟桶（共享存储），超限 429。"""
    import hashlib as _hl
    sid = client.post("/api/v2/data-sources", json={
        "name": f"rate-{_t.time_ns()}", "kind": "webhook",
        "config": {"rate_limit_per_min": 2}}).json()["id"]
    TOKENS[sid] = "x"  # 未用签名；限速在 token 校验后——需真 token：重建
    r = client.post("/api/v2/data-sources", json={
        "name": f"rate2-{_t.time_ns()}", "kind": "webhook",
        "config": {"rate_limit_per_min": 2}})
    sid = r.json()["id"]
    tok = r.json()["webhook_token"]
    codes = []
    for _ in range(4):
        rr = client.post(f"/api/v2/ingress/webhook/{sid}", json={"a": 1},
                         headers={"x-source-token": tok})
        codes.append(rr.status_code)
    assert codes[:2] == [200, 200]
    assert 429 in codes[2:]
