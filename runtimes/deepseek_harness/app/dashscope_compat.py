"""Loopback-only DashScope compatibility bridge for the DSH LLM adapter.

The bundled DSH DeepSeek adapter expresses thinking mode as ``thinking.type``.
DashScope's OpenAI-compatible API expects ``enable_thinking`` instead.  This
bridge performs only that protocol translation and streams the upstream SSE
response unchanged.  The upstream URL is fixed by the launcher; request data
cannot select an arbitrary destination.
"""
from __future__ import annotations

import http.client
import json
import os
from collections.abc import Iterator
from typing import Any
from urllib.parse import urlsplit

import anyio
from fastapi import FastAPI, HTTPException, Request
from starlette.responses import StreamingResponse


_REQUEST_HEADERS = ("authorization", "accept", "user-agent")
_RESPONSE_HEADERS = (
    "cache-control",
    "content-type",
    "x-request-id",
    "x-dashscope-request-id",
)


def translate_request(payload: dict[str, Any]) -> dict[str, Any]:
    """Translate DSH's thinking control without mutating the caller's value."""

    translated = dict(payload)
    thinking = translated.pop("thinking", None)
    if isinstance(thinking, dict):
        thinking_type = thinking.get("type")
        if thinking_type == "disabled":
            translated["enable_thinking"] = False
            translated.pop("reasoning_effort", None)
        elif thinking_type == "enabled":
            translated["enable_thinking"] = True
    if translated.get("reasoning_effort") == "off":
        translated.pop("reasoning_effort")
        translated["enable_thinking"] = False
    return translated


def upstream_target(base_url: str) -> tuple[str, str, int, str]:
    """Return a validated, fixed HTTPS target for ``chat/completions``."""

    parsed = urlsplit(base_url.rstrip("/"))
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("DashScope upstream must be an HTTPS URL")
    host = parsed.hostname.lower()
    if not (host == "dashscope.aliyuncs.com" or host.endswith(".aliyuncs.com")):
        raise ValueError("DashScope upstream host is not allowlisted")
    path = f"{parsed.path.rstrip('/')}/chat/completions"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    return parsed.scheme, parsed.hostname, parsed.port or 443, path


def _open_upstream(
    base_url: str,
    payload: dict[str, Any],
    request_headers: dict[str, str],
) -> tuple[http.client.HTTPSConnection, http.client.HTTPResponse]:
    _scheme, host, port, path = upstream_target(base_url)
    connection = http.client.HTTPSConnection(host, port, timeout=330)
    headers = {"content-type": "application/json"}
    headers.update({name: value for name, value in request_headers.items() if name in _REQUEST_HEADERS})
    try:
        connection.request(
            "POST",
            path,
            body=json.dumps(translate_request(payload), ensure_ascii=False).encode("utf-8"),
            headers=headers,
        )
        return connection, connection.getresponse()
    except BaseException:
        connection.close()
        raise


def _stream_response(
    connection: http.client.HTTPSConnection,
    response: http.client.HTTPResponse,
) -> Iterator[bytes]:
    try:
        # SSE is line-oriented.  Yielding each line keeps DSH's idle watchdog
        # fed instead of buffering a whole model response into a large read.
        while line := response.readline():
            yield line
    finally:
        response.close()
        connection.close()


def install_dashscope_compat_route(app: FastAPI) -> None:
    """Install the bridge only when the launcher configured a fixed upstream."""

    upstream = os.environ.get("QUALITY_MODEL_UPSTREAM_BASE_URL", "").strip()
    if not upstream:
        return
    upstream_target(upstream)

    @app.post("/_dashscope_compat/chat/completions", include_in_schema=False)
    async def dashscope_chat_completions(request: Request) -> StreamingResponse:
        try:
            raw = await request.json()
        except (json.JSONDecodeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="request body must be JSON") from exc
        if not isinstance(raw, dict):
            raise HTTPException(status_code=400, detail="request body must be an object")
        request_headers = {name.lower(): value for name, value in request.headers.items()}
        try:
            connection, response = await anyio.to_thread.run_sync(
                _open_upstream,
                upstream,
                raw,
                request_headers,
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail="DashScope upstream unavailable") from exc
        response_headers = {
            name.lower(): value
            for name, value in response.getheaders()
            if name.lower() in _RESPONSE_HEADERS
        }
        return StreamingResponse(
            _stream_response(connection, response),
            status_code=response.status,
            headers=response_headers,
            media_type=None,
        )
