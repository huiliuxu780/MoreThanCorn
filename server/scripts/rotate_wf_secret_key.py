"""WF_SECRET_KEY 轮换（AUD-SEC-001/CFG-003，09-17 用户「做吧」）。

三态重加密：历史明文→env1 信封（新钥）；env1→re-wrap（旧→新）；gAAAAA→新钥直密。
扫描列：connection.secret_ref / data_source.secret_ref /
data_source.signing_secret_enc / data_source.signing_secret_prev_enc。
用法：WF_SECRET_KEY=<新钥> [WF_SECRET_KEY_OLD=<旧钥>] .venv/bin/python scripts/rotate_wf_secret_key.py [--apply]
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sqlalchemy import text  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.kms import ENV_PREFIX, kms_encrypt  # noqa: E402

COLS = [
    ("connection", "secret_ref"),
    ("data_source", "secret_ref"),
    ("data_source", "signing_secret_enc"),
    ("data_source", "signing_secret_prev_enc"),
]


def _rewrap(token: str) -> str | None:
    """旧信封→新信封；明文→新信封；已是新钥信封则 None。"""
    from cryptography.fernet import Fernet
    old = os.environ.get("WF_SECRET_KEY_OLD")
    if token.startswith(ENV_PREFIX):
        if not old:
            return None  # 假设已是新钥信封
        wrapped, _, ct = token[len(ENV_PREFIX):].partition(".")
        data_key = Fernet(old.encode()).decrypt(wrapped.encode())
        new_wrapped = Fernet(os.environ["WF_SECRET_KEY"].encode()).encrypt(data_key)
        return f"{ENV_PREFIX}{new_wrapped.decode()}.{ct}"
    if token.startswith("gAAAAA"):
        from app.kms import kms_decrypt
        return kms_encrypt(kms_decrypt(token))
    if token:
        return kms_encrypt(token)  # 历史明文→信封
    return None


def main() -> None:
    apply = "--apply" in sys.argv
    if not os.environ.get("WF_SECRET_KEY"):
        raise SystemExit("WF_SECRET_KEY（新钥）必须经环境变量提供")
    total = 0
    with SessionLocal() as db:
        for table, col in COLS:
            rows = db.execute(text(
                f"select id, {col} from {table} where {col} is not null"
                f" and {col} <> ''")).fetchall()
            for rid, val in rows:
                new = _rewrap(val)
                if new is None or new == val:
                    continue
                total += 1
                print(f"  {table}.{col} id={rid[:8]} {val[:10]}… -> {new[:14]}…")
                if apply:
                    db.execute(text(f"update {table} set {col}=:v where id=:id"),
                               {"v": new, "id": rid})
        if apply:
            db.commit()
    print(f"{'[apply]' if apply else '[dry-run]'} rewrote={total}")


if __name__ == "__main__":
    main()
