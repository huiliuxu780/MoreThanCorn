"""HTTPS recording lookup and local WAV inspection for the Lydaas acid contract."""

from __future__ import annotations

import json
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


DEFAULT_RECORDING_ENDPOINT = (
    "https://gateway.lydaas.com/api/hsf/xspace-openapi-proxy/"
    "HotlineProxyService/listRecordV2"
)


class RecordingLookupError(RuntimeError):
    """Recording control-plane lookup failed without exposing a signed URL."""


@dataclass(frozen=True)
class RecordingRecord:
    call_id: str
    record_created_time_ms: int
    url: str

    def metadata(self) -> dict[str, Any]:
        parsed = urlparse(self.url)
        return {
            "call_id": self.call_id,
            "record_created_time_ms": self.record_created_time_ms,
            "url_origin": f"{parsed.scheme}://{parsed.netloc}",
            "url_path": parsed.path,
        }


def build_recording_payload(arg0: str, acid: str) -> dict[str, str]:
    if not arg0.strip():
        raise ValueError("recording arg0 is required")
    if not acid.strip():
        raise ValueError("acid is required")
    return {"arg0": arg0, "arg1": acid}


def parse_recording_response(payload: dict[str, Any], acid: str) -> RecordingRecord:
    if payload.get("success") is not True:
        raise ValueError("recording API did not return success=true")
    data = payload.get("data")
    rows = data.get("list") if isinstance(data, dict) else None
    if not isinstance(rows, list) or not rows:
        raise ValueError("recording API returned no records")
    matches: list[RecordingRecord] = []
    for row in rows:
        if not isinstance(row, dict) or str(row.get("callId") or "") != acid:
            continue
        url = str(row.get("url") or "")
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("recording URL must be a valid https URL")
        matches.append(
            RecordingRecord(
                call_id=acid,
                record_created_time_ms=int(row.get("recordCreatedTime") or 0),
                url=url,
            )
        )
    if not matches:
        raise ValueError(f"recording API returned no record for acid={acid}")
    return max(matches, key=lambda item: item.record_created_time_ms)


def resolve_recording(
    acid: str,
    *,
    arg0: str,
    endpoint: str = DEFAULT_RECORDING_ENDPOINT,
    headers: Mapping[str, str] | None = None,
    timeout_seconds: float = 20.0,
) -> RecordingRecord:
    body = json.dumps(build_recording_payload(arg0, acid), ensure_ascii=False).encode("utf-8")
    request_headers = {"Content-Type": "application/json", "Accept": "application/json"}
    request_headers.update(dict(headers or {}))
    request = Request(endpoint, data=body, headers=request_headers, method="POST")
    try:
        with urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310 - explicit endpoint
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise RecordingLookupError(f"recording API returned HTTP {exc.code}") from exc
    except URLError as exc:
        raise RecordingLookupError("recording API connection failed") from exc
    return parse_recording_response(payload, acid)


def inspect_wav(path: str | Path) -> dict[str, Any]:
    source = Path(path)
    with wave.open(str(source), "rb") as handle:
        frames = handle.getnframes()
        rate = handle.getframerate()
        if rate <= 0 or frames <= 0:
            raise ValueError("WAV must contain audio frames with a valid sample rate")
        return {
            "format": "wav",
            "channels": handle.getnchannels(),
            "sample_rate_hz": rate,
            "sample_width_bytes": handle.getsampwidth(),
            "duration_ms": round(frames * 1000 / rate),
        }
