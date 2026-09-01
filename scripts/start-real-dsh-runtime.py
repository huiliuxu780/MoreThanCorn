#!/usr/bin/env python3
"""Start the real DSH Runtime from platform-maintained LLM resources.

The decrypted credential is passed only in the exec'd child environment.  It is
never printed, written to disk, placed in argv, or returned by an API.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import select


REPO_ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = REPO_ROOT / "server"
RUNTIME_ROOT = REPO_ROOT / "runtimes" / "deepseek_harness"


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="qwen3.8-max")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8302)
    p.add_argument("--check", action="store_true", help="validate resolution without starting")
    return p


def main() -> int:
    args = parser().parse_args()
    sys.path.insert(0, str(SERVER_ROOT))
    from app.db import SessionLocal
    from app.models import Connection, Model, ModelProvider
    from app.runner import RunError, llm_auth_headers

    db = SessionLocal()
    try:
        model = db.execute(select(Model).where(Model.model_key == args.model,
                                               Model.enabled.is_(True))).scalars().first()
        if model is None:
            raise RuntimeError(f"enabled model not found: {args.model}")
        provider = db.get(ModelProvider, model.provider_id)
        if provider is None or provider.status != "active":
            raise RuntimeError(f"active ModelProvider not found for: {args.model}")
        connection = db.get(Connection, provider.auth_connection_id or "")
        if connection is None or connection.lifecycle != "active":
            raise RuntimeError(f"active LLM Connection not found for: {args.model}")
        headers = llm_auth_headers(connection)
        auth = headers.get("Authorization", "")
        if not auth.startswith("Bearer ") or len(auth) <= len("Bearer "):
            raise RuntimeError("DSH launcher requires an OpenAI-compatible Bearer credential")
        api_key = auth[len("Bearer "):]
        base_url = str(provider.base_url or (connection.endpoint or {}).get("base_url") or "")
        if not base_url.startswith(("http://", "https://")):
            raise RuntimeError("ModelProvider base_url is invalid")
        hostname = (urlsplit(base_url).hostname or "").lower()
        dashscope_compat = (
            hostname == "dashscope.aliyuncs.com" or hostname.endswith(".aliyuncs.com")
        )
        safe = {"model": model.model_key, "provider": provider.name,
                "connection": connection.name, "base_url": base_url,
                "credential": "configured",
                "compatibility": "dashscope" if dashscope_compat else "direct"}
    except RunError as exc:
        raise RuntimeError(str(exc)) from exc
    finally:
        db.close()

    print("DSH runtime resource resolution:", safe, flush=True)
    if args.check:
        return 0

    python = RUNTIME_ROOT / ".venv" / "bin" / "python"
    if not python.is_file():
        raise RuntimeError(f"DSH runtime interpreter not found: {python}")
    env = dict(os.environ)
    runtime_base_url = base_url
    if dashscope_compat:
        runtime_base_url = f"http://{args.host}:{args.port}/_dashscope_compat"
    env.update({
        "QUALITY_MODEL_API_KEY": api_key,
        "QUALITY_MODEL_BASE_URL": runtime_base_url,
        "QUALITY_RUNTIME_ENV": env.get("QUALITY_RUNTIME_ENV", "development"),
        "QUALITY_DSH_WORK_ROOT": env.get("QUALITY_DSH_WORK_ROOT", "/tmp"),
    })
    if dashscope_compat:
        env["QUALITY_MODEL_UPSTREAM_BASE_URL"] = base_url
    else:
        env.pop("QUALITY_MODEL_UPSTREAM_BASE_URL", None)
    os.chdir(RUNTIME_ROOT)
    argv = [str(python), "-m", "uvicorn", "app.main:app",
            "--host", args.host, "--port", str(args.port)]
    os.execve(str(python), argv, env)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
