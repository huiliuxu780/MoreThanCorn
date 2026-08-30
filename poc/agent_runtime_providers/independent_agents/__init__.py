"""Independent consumer-analysis and quality-rule Agent POC.

The two request builders deliberately do not depend on each other's output.
"""

from .normalizer import normalize_hotline_payload
from .recording import RecordingRecord, inspect_wav, parse_recording_response
from .recording_tool import build_recording_tool_create_payload, parse_platform_tool_result
from .request_builder import (
    build_consumer_analysis_request,
    build_quality_rules_request,
    load_rule_snapshot,
    validate_consumer_output,
    validate_quality_output,
)

__all__ = [
    "RecordingRecord",
    "build_consumer_analysis_request",
    "build_quality_rules_request",
    "build_recording_tool_create_payload",
    "inspect_wav",
    "load_rule_snapshot",
    "normalize_hotline_payload",
    "parse_recording_response",
    "parse_platform_tool_result",
    "validate_consumer_output",
    "validate_quality_output",
]
