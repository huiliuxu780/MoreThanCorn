"""SDD-12 §5.3（P0 止血形态）：Secret 轮换账本。

设计取舍（与 check_runs 同理）：legacy `connection.secret_ref` /
`environments[].secret_ref` 仍是运行时读取的"活引用"，本账本在其旁维护
版本/退役/审计语义，不改动运行时解析路径（P1 规范化表落地后再切换事实源）。

安全不变量（§15.2.4 / B-04）：
- encrypted_payload 与明文一律不出现在本模块返回值之外的任何 API/日志/审计；
- payload_fingerprint 为 SHA-256 不可逆指纹，仅用于判断"是否变化"，不得用于恢复。
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import Connection, ConnectionSecretRevision
from .secrets import serialize_secret


def secret_fingerprint(secret: str | dict) -> str:
    """不可逆指纹：判断 Secret 是否变化（不用于恢复）。"""
    return hashlib.sha256(serialize_secret(secret).encode()).hexdigest()


def _env_rows(conn) -> list[dict]:
    return list(conn.environments or [])


def _set_env_secret_ref(conn, env_code: str, ref: str | None) -> bool:
    """把某环境的 secret_ref 置为 ref（None=清除）。返回是否命中该环境。"""
    rows = _env_rows(conn)
    hit = False
    for e in rows:
        if e.get("code") == env_code:
            e["secret_ref"] = ref
            hit = True
    conn.environments = rows
    return hit


def current_revision(db: Session, conn_id: str, env_code: str) -> ConnectionSecretRevision | None:
    return db.query(ConnectionSecretRevision).filter_by(
        connection_id=conn_id, env_code=env_code, status="active")\
        .order_by(ConnectionSecretRevision.version_no.desc()).first()


def revision_info(db: Session, conn_id: str, env_code: str) -> dict:
    """对外只暴露版本号与轮换时间（B-01/§5.3：不回明文）。"""
    rev = current_revision(db, conn_id, env_code)
    if not rev:
        return {"configured": False}
    return {"configured": True, "versionNo": rev.version_no,
            "rotatedAt": rev.created_at.isoformat(), "rotatedBy": rev.created_by}


def record_initial(db: Session, conn, env_code: str, encrypted_ref: str,
                   secret: str | dict, actor: str) -> ConnectionSecretRevision:
    """创建连接时登记首个 revision（v1）。"""
    rev = ConnectionSecretRevision(
        connection_id=conn.id, env_code=env_code, version_no=1,
        encrypted_payload=encrypted_ref, payload_fingerprint=secret_fingerprint(secret),
        status="active", created_by=actor)
    db.add(rev)
    return rev


def rotate(db: Session, conn, env_code: str, new_encrypted_ref: str,
           new_secret: str | dict, actor: str) -> ConnectionSecretRevision:
    """轮换：退役旧 active，新增 version+1。返回新 revision。"""
    now = datetime.now(timezone.utc)
    for old in db.query(ConnectionSecretRevision).filter_by(
            connection_id=conn.id, env_code=env_code, status="active").all():
        old.status = "retired"
        old.retired_at = now
        old.retired_by = actor
    max_no = db.query(func.max(ConnectionSecretRevision.version_no)).filter_by(
        connection_id=conn.id, env_code=env_code).scalar() or 0
    rev = ConnectionSecretRevision(
        connection_id=conn.id, env_code=env_code, version_no=max_no + 1,
        encrypted_payload=new_encrypted_ref, payload_fingerprint=secret_fingerprint(new_secret),
        status="active", created_by=actor)
    db.add(rev)
    return rev


def clear(db: Session, conn, env_code: str, actor: str) -> int:
    """清除：退役全部 active（不新增）。返回退役条数。"""
    now = datetime.now(timezone.utc)
    n = 0
    for old in db.query(ConnectionSecretRevision).filter_by(
            connection_id=conn.id, env_code=env_code, status="active").all():
        old.status = "retired"
        old.retired_at = now
        old.retired_by = actor
        n += 1
    return n
