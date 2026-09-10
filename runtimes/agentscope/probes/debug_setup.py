"""Debug host: same app as probes.serve but prints the ORIGINAL setup
exception that ChatService swallows into a generic SETUP error.
Diagnostic only — never used as evidence of capability.
"""
from __future__ import annotations

import traceback

import uvicorn

from agentscope.app._service._chat import ChatService

from probes.serve import build_app

_orig = ChatService._report_failure


async def _patched(self, user_id, session_id, agent_id, error, *a, **k):
    print(f"ORIGINAL_SETUP_ERROR: {error!r}", flush=True)
    traceback.print_stack()
    traceback.print_exception(type(error), error, error.__traceback__)
    return await _orig(self, user_id, session_id, agent_id, error, *a, **k)


ChatService._report_failure = _patched

if __name__ == "__main__":
    uvicorn.run(build_app(), host="127.0.0.1", port=8402, log_level="info")
