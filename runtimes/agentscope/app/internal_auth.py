"""Per-session/flow-run internal Tool token registry (P0-08).

The platform mints a scoped token when it creates a session (or a flow run)
and hands the raw value to this host exactly once.  Tool callbacks must
present it back; the platform verifies it against the stored hash and the
session's release manifest.

09-16 Group Spec 限制1 修复：长存群会话（D2）跨运行时重启仍须可拉 manifest，
故 registry 以 Redis（与 message bus 同信任域 db4）背书：内存优先、Redis 兜底；
Redis 不可达时降级为进程内存（原语义）。短命 session/flow-run 行为不变。
"""
from __future__ import annotations

import os
import threading

_LOCK = threading.Lock()
_TOKENS: dict[str, str] = {}
_REDIS_KEY = "mtc:internal_token:{session_id}"
_TTL_SECS = 30 * 24 * 3600

_redis_client = None
_redis_failed = False


def _redis():
    global _redis_client, _redis_failed
    if _redis_client is not None or _redis_failed:
        return _redis_client
    try:
        import redis as _redis_lib

        url = os.environ.get("MTC_REDIS_URL", "redis://127.0.0.1:6379/4")
        _redis_client = _redis_lib.Redis.from_url(url, socket_timeout=2)
        _redis_client.ping()
    except Exception:  # noqa: BLE001 —— Redis 不可达降级内存语义
        _redis_client = None
        _redis_failed = True
    return _redis_client


def register(session_id: str, token: str) -> None:
    if not session_id or not token:
        return
    with _LOCK:
        _TOKENS[session_id] = token
    r = _redis()
    if r is not None:
        try:
            r.setex(_REDIS_KEY.format(session_id=session_id), _TTL_SECS, token)
        except Exception:  # noqa: BLE001
            pass


def get(session_id: str) -> str | None:
    with _LOCK:
        hit = _TOKENS.get(session_id)
    if hit:
        return hit
    r = _redis()
    if r is None:
        return None
    try:
        raw = r.get(_REDIS_KEY.format(session_id=session_id))
    except Exception:  # noqa: BLE001
        return None
    if not raw:
        return None
    token = raw.decode() if isinstance(raw, bytes) else str(raw)
    with _LOCK:
        _TOKENS[session_id] = token
    return token


def forget(session_id: str) -> None:
    with _LOCK:
        _TOKENS.pop(session_id, None)
    r = _redis()
    if r is not None:
        try:
            r.delete(_REDIS_KEY.format(session_id=session_id))
        except Exception:  # noqa: BLE001
            pass
