"""身份与 RBAC（09-SDD P0-10）。

- 用户表 app_user（迁移 g033 种子 admin）；PBKDF2 口令哈希。
- 令牌：base64url(payload).HMAC-SHA256(WF_SECRET_KEY)，12h 过期。
- auth_enforced()（生产恒开 / WF_AUTH=on）时：未登录 401、无权限 403。
- 开发默认（未开鉴权）：匿名透传，身份记为 dev（保持现状不破坏）。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timezone

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

ROLES = ("admin", "operator", "viewer")
TOKEN_TTL_SECONDS = 12 * 3600


def _secret_key() -> str:
    key = os.environ.get("WF_SECRET_KEY", "")
    if not key:
        raise RuntimeError("WF_SECRET_KEY 未配置：鉴权需要签名密钥")
    return key


# ---------- 口令 ----------

def hash_password(password: str, salt_hex: str = "") -> str:
    salt = bytes.fromhex(salt_hex) if salt_hex else os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return salt.hex() + "$" + dk.hex()


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split("$", 1)
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 120_000)
    return hmac.compare_digest(dk.hex(), dk_hex)


# ---------- 令牌 ----------

def create_token(user: dict) -> str:
    payload = {"uid": user["id"], "username": user["username"], "role": user["role"],
               "exp": int(time.time()) + TOKEN_TTL_SECONDS}
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    sig = hmac.new(_secret_key().encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def verify_token(token: str) -> dict | None:
    try:
        body, sig = token.rsplit(".", 1)
    except ValueError:
        return None
    expect = hmac.new(_secret_key().encode(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expect):
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except Exception:  # noqa: BLE001
        return None
    if int(payload.get("exp") or 0) < time.time():
        return None
    return payload


# ---------- 请求身份 ----------

DEV_USER = {"id": "dev", "username": "dev", "role": "admin",
            "team": "", "data_scope": "all"}


def current_user(request: Request) -> dict | None:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return None
    user = verify_token(auth[7:])
    if not user:
        return None
    # 09 P2-01：已停用用户的既有令牌立即失效（生命周期）
    if auth_enforced_now():
        db = get_db_for(request)
        try:
            u = db.get(_app_user_cls(), user.get("uid"))
            if u and u.status != "active":
                return None
            # P2-02：数据范围随请求解析（scope 变更无需重新登录）
            if u:
                user["team"] = u.team or ""
                user["data_scope"] = u.data_scope or "all"
        finally:
            db.close()
    return user


def _app_user_cls():
    from .models import AppUser
    return AppUser


def resolve_actor(request: Request | None) -> str:
    """审计 actor：有身份取 username；开发匿名环境记 dev。"""
    if request is None:
        return "system"
    user = current_user(request)
    return user["username"] if user else ("dev" if not auth_enforced_now() else "")


def actor_of(user: dict | None) -> str:
    """从依赖注入的用户字典取审计行为人（SDD-12 §15.3 审计基座；开发透传=dev）。"""
    return (user or {}).get("username") or "质量管理员"


def auth_enforced_now() -> bool:
    from .config import auth_enforced
    return auth_enforced()


def get_db_for(request: Request) -> Session:
    from .db import SessionLocal
    return SessionLocal()


def require_role(*roles: str):
    """端点依赖：返回当前用户（开发模式返回 DEV_USER）。

    auth_enforced 时：无/无效令牌 → 401；角色不符 → 403。"""
    def _dep(request: Request) -> dict:
        user = current_user(request)
        if auth_enforced_now():
            if user is None:
                raise HTTPException(401, "未授权：缺少有效登录凭证")
            if roles and user.get("role") not in roles:
                raise HTTPException(403, f"权限不足：需要 {'/'.join(roles)} 角色")
            return user
        return user or DEV_USER
    return _dep


# 常用门禁（端点签名引用）。09 P0：viewer 为只读角色，复核是写操作需 operator+。
require_admin = require_role("admin")
require_operator = require_role("admin", "operator")
# 复核/证据等质量写操作：viewer 只读不可写（修复审计反例：viewer 可复核/读密钥）。
require_reviewer = require_role("admin", "operator")


def user_by_name(db: Session, username: str):
    from .models import AppUser
    return db.execute(select(AppUser).where(AppUser.username == username)).scalars().first()


def login(db: Session, username: str, password: str) -> dict | None:
    u = user_by_name(db, username)
    if not u or u.status != "active" or not verify_password(password, u.password_hash):
        return None
    return {"id": u.id, "username": u.username, "role": u.role,
            "displayName": u.display_name, "team": u.team or "",
            "dataScope": u.data_scope or "all"}


# ---------- P2-02：组织/团队/数据范围服务端强制 ----------

def _team_members(db: Session, team: str) -> set[str]:
    from .models import AppUser
    return {r[0] for r in db.query(AppUser.username).filter_by(team=team).all()}


def data_scope_members(db: Session, user: dict) -> set[str] | None:
    """P2-02：返回 None=不限制（admin/data_scope=all/无团队）；否则同队成员 username 集合。"""
    if (user.get("role") or "") == "admin":
        return None
    if (user.get("data_scope") or "all") != "team" or not (user.get("team") or ""):
        return None
    return _team_members(db, user["team"]) or {user.get("username") or ""}


def apply_data_scope(db: Session, q, user: dict, owner_col):
    """P2-02 数据范围强制：按 owner_col ∈ 同队成员过滤（不限制时原样返回）。"""
    members = data_scope_members(db, user)
    if members is None:
        return q
    return q.filter(owner_col.in_(members))


def assert_task_readable(db: Session, user: dict, task) -> None:
    """P2-02：team 范围用户仅可访问本队成员创建的任务，越权 403。"""
    members = data_scope_members(db, user)
    if members is not None and (task.created_by or "") not in members:
        raise HTTPException(403, "权限不足：数据范围限定为本团队")
