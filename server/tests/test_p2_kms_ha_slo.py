"""09-SDD P2 代码项：KMS 信封加密 / Scheduler 选主 / SLO 测量端点。"""
import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app

client = TestClient(app)


@pytest.fixture
def fernet_key(monkeypatch):
    from cryptography.fernet import Fernet
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("WF_SECRET_KEY", key)
    return key


# ---------- P2-06 KMS ----------

def test_envelope_roundtrip(fernet_key):
    from app.kms import kms_decrypt, kms_encrypt
    token = kms_encrypt("sk-envelope-123")
    assert token.startswith("env1:") and token != "sk-envelope-123"
    assert kms_decrypt(token) == "sk-envelope-123"


def test_legacy_fernet_ciphertext_still_decrypts(fernet_key):
    from cryptography.fernet import Fernet
    from app.kms import kms_decrypt
    legacy = Fernet(fernet_key.encode()).encrypt(b"sk-legacy-456").decode()
    assert kms_decrypt(legacy) == "sk-legacy-456"


def test_decrypt_fail_closed_without_key(fernet_key):
    from app.kms import kms_encrypt
    token = kms_encrypt("sk-x")
    import os
    os.environ.pop("WF_SECRET_KEY", None)
    from app.kms import kms_decrypt
    with pytest.raises(RuntimeError):
        kms_decrypt(token)


def test_production_encrypt_fail_closed(monkeypatch):
    monkeypatch.setenv("WF_ENV", "production")
    monkeypatch.delenv("WF_SECRET_KEY", raising=False)
    from app.secrets import encrypt_secret
    with pytest.raises(RuntimeError):
        encrypt_secret("sk-prod")


# ---------- P2-04 HA 选主 ----------

def test_scheduler_leader_election():
    # 独立锁域：全量跑时其他 TestClient 的 scheduler 线程持有生产 key
    from app.runner import (SCHEDULER_LEADER_LOCK_KEY, release_scheduler_leader_lock,
                            try_scheduler_leader_lock)
    key = SCHEDULER_LEADER_LOCK_KEY + 999
    s1, s2 = SessionLocal(), SessionLocal()
    try:
        assert try_scheduler_leader_lock(s1, key) is True
        assert try_scheduler_leader_lock(s2, key) is False  # 第二实例不得双跑
        release_scheduler_leader_lock(s1, key)
        assert try_scheduler_leader_lock(s2, key) is True   # leader 释放后可接管
        release_scheduler_leader_lock(s2, key)
    finally:
        s1.close()
        s2.close()


# ---------- P2-09 SLO ----------

def test_ops_slo_endpoint_shape():
    r = client.get("/api/ops/slo")
    assert r.status_code == 200
    body = r.json()
    assert "DRAFT" in body["note"]
    for k in ("apiP95Ms", "apiP99Ms", "queueWaitP95Sec", "taskRunDeadlineSec",
              "rpoSec", "rtoSec", "retentionDays", "costBudgetUsdPerDay"):
        assert k in body["targets"]
    assert body["measured"]["window"] == "last_24h"
    assert "apiAvailability" in body["measured"]["unmeasured"]
