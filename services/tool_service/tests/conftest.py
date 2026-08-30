"""Ensure `app` is importable regardless of pytest rootdir.

The acceptance gate runs `services/tool_service/.venv/bin/pytest services/tool_service/tests -q`
from the repository root; without this, `from app.main import ...` fails because the
service package root is not on sys.path. Inserting it here makes the documented
command work from any cwd without altering runtime packaging.
"""
import sys
from pathlib import Path

_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVICE_ROOT))
