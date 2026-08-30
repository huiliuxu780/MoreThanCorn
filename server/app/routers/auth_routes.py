"""身份端点（09-SDD P0-10）：登录 / 当前身份 / 用户管理（admin）。"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..auth import ROLES, create_token, hash_password, login, require_admin
from ..db import get_db
from ..models import AppUser

router = APIRouter(tags=["auth"])


@router.post("/api/auth/login")
def login_endpoint(payload: dict, db: Session = Depends(get_db)):
    username = str((payload or {}).get("username") or "").strip()
    password = str((payload or {}).get("password") or "")
    if not username or not password:
        raise HTTPException(422, "用户名与密码必填")
    user = login(db, username, password)
    if not user:
        raise HTTPException(401, "用户名或密码错误")
    return {"token": create_token(user), "user": user}


@router.get("/api/auth/me")
def me(request: Request):
    from ..auth import auth_enforced_now, current_user
    user = current_user(request)
    if user is None:
        if auth_enforced_now():
            raise HTTPException(401, "未授权：缺少有效登录凭证")
        return {"username": "dev", "role": "admin", "displayName": "开发模式"}
    db_user = None
    from ..db import SessionLocal
    db = SessionLocal()
    try:
        db_user = db.get(AppUser, user["uid"])
    finally:
        db.close()
    return {"id": user["uid"], "username": user["username"], "role": user["role"],
            "displayName": db_user.display_name if db_user else user["username"]}


@router.post("/api/auth/users", status_code=201)
def create_user(payload: dict, db: Session = Depends(get_db),
                admin_user: dict = Depends(require_admin)):
    username = str((payload or {}).get("username") or "").strip()
    password = str((payload or {}).get("password") or "")
    role = str((payload or {}).get("role") or "viewer")
    if not username or len(password) < 8:
        raise HTTPException(422, "用户名必填；密码至少 8 位")
    if role not in ROLES:
        raise HTTPException(422, f"role 必须是 {'/'.join(ROLES)}")
    from ..auth import user_by_name
    if user_by_name(db, username):
        raise HTTPException(409, "用户名已存在")
    # P2-02：创建时可指定团队与数据范围（默认 all，存量行为不变）
    data_scope = str((payload or {}).get("dataScope") or "all")
    if data_scope not in ("all", "team"):
        raise HTTPException(422, "dataScope 必须是 all|team")
    u = AppUser(username=username, display_name=(payload or {}).get("displayName", username),
                password_hash=hash_password(password), role=role,
                team=str((payload or {}).get("team") or ""), data_scope=data_scope)
    db.add(u)
    db.commit()
    return {"id": u.id, "username": u.username, "role": u.role,
            "team": u.team, "dataScope": u.data_scope}


@router.get("/api/auth/users")
def list_users(db: Session = Depends(get_db), _admin: dict = Depends(require_admin)):
    rows = db.query(AppUser).order_by(AppUser.created_at.desc()).all()
    return {"items": [{"id": u.id, "username": u.username, "displayName": u.display_name,
                       "role": u.role, "status": u.status, "team": u.team or "",
                       "dataScope": u.data_scope or "all",
                       "createdAt": u.created_at.isoformat()} for u in rows]}


@router.post("/api/auth/users/{uid}/scope")
def set_user_scope(uid: str, payload: dict, db: Session = Depends(get_db),
                   admin_user: dict = Depends(require_admin)):
    """P2-02：设置用户团队与数据范围（admin；变更即时生效于后续请求）。"""
    u = db.get(AppUser, uid)
    if not u:
        raise HTTPException(404, "用户不存在")
    data_scope = str((payload or {}).get("dataScope") or u.data_scope or "all")
    if data_scope not in ("all", "team"):
        raise HTTPException(422, "dataScope 必须是 all|team")
    if "team" in (payload or {}):
        u.team = str((payload or {}).get("team") or "")
    u.data_scope = data_scope
    if u.data_scope == "team" and not u.team:
        raise HTTPException(422, "dataScope=team 时必须提供 team")
    db.commit()
    return {"id": u.id, "username": u.username, "team": u.team, "dataScope": u.data_scope}


@router.post("/api/auth/users/{uid}/status")
def set_user_status(uid: str, payload: dict, db: Session = Depends(get_db),
                    admin_user: dict = Depends(require_admin)):
    """09 P2-01：用户生命周期——启用/停用。停用用户无法登录。"""
    u = db.get(AppUser, uid)
    if not u:
        raise HTTPException(404, "用户不存在")
    status = str((payload or {}).get("status") or "")
    if status not in ("active", "disabled"):
        raise HTTPException(422, "status 必须是 active|disabled")
    if u.username == admin_user.get("username") and status == "disabled":
        raise HTTPException(422, "不能停用自己的账号")
    u.status = status
    db.commit()
    return {"id": u.id, "username": u.username, "status": u.status}


@router.post("/api/auth/users/{uid}/password")
def change_user_password(uid: str, payload: dict, db: Session = Depends(get_db),
                         admin_user: dict = Depends(require_admin)):
    """09 P2-01：用户生命周期——重置密码（admin）。"""
    u = db.get(AppUser, uid)
    if not u:
        raise HTTPException(404, "用户不存在")
    new_password = str((payload or {}).get("password") or "")
    if len(new_password) < 8:
        raise HTTPException(422, "密码至少 8 位")
    u.password_hash = hash_password(new_password)
    db.commit()
    return {"id": u.id, "username": u.username, "passwordChanged": True}
