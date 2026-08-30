from __future__ import annotations

import wave

import pytest

from independent_agents.recording import inspect_wav, parse_recording_response


def test_recording_response_selects_latest_matching_https_record() -> None:
    response = {
        "success": True,
        "data": {
            "list": [
                {"callId": "A-1", "recordCreatedTime": 1, "url": "https://oss.example/old.wav?q=1"},
                {"callId": "A-1", "recordCreatedTime": 2, "url": "https://oss.example/new.wav?q=2"},
                {"callId": "OTHER", "recordCreatedTime": 3, "url": "https://oss.example/no.wav"},
            ]
        },
    }

    record = parse_recording_response(response, "A-1")

    assert record.call_id == "A-1"
    assert record.record_created_time_ms == 2
    assert record.metadata()["url_path"] == "/new.wav"
    assert "url" not in record.metadata()


def test_recording_response_rejects_non_https_url() -> None:
    response = {
        "success": True,
        "data": {"list": [{"callId": "A-1", "recordCreatedTime": 1, "url": "http://bad/a.wav"}]},
    }
    with pytest.raises(ValueError, match="https"):
        parse_recording_response(response, "A-1")


def test_wav_inspection(tmp_path) -> None:
    path = tmp_path / "sample.wav"
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(8000)
        handle.writeframes(b"\x00\x00" * 8000)

    assert inspect_wav(path) == {
        "format": "wav",
        "channels": 1,
        "sample_rate_hz": 8000,
        "sample_width_bytes": 2,
        "duration_ms": 1000,
    }
