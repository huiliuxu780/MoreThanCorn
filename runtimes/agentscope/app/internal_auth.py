"""Per-session/flow-run internal Tool token registry (P0-08).

The platform mints a scoped token when it creates a session (or a flow run)
and hands the raw value to this host exactly once.  Tool callbacks must
present it back; the platform verifies it against the stored hash and the
session's release manifest.

The registry is process memory only: after a runtime restart, sessions lose
their callback credential and internal Tool calls fail closed (the platform
rejects unbound calls) — this is intentional, sessions are re-created per
execution anyway.
"""
from __future__ import annotations

import threading

_LOCK = threading.Lock()
_TOKENS: dict[str, str] = {}


def register(session_id: str, token: str) -> None:
    if not session_id or not token:
        return
    with _LOCK:
        _TOKENS[session_id] = token


def get(session_id: str) -> str | None:
    with _LOCK:
        return _TOKENS.get(session_id)


def forget(session_id: str) -> None:
    with _LOCK:
        _TOKENS.pop(session_id, None)
