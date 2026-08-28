# Agent Runtime Provider POC environment baseline

Captured: 2026-08-28

## Local host

- Architecture: Apple Silicon (`arm64`)
- macOS: `26.5.2`
- System Python: `3.9.6` (not used by the POC)
- POC Python: Homebrew CPython `3.12.13`
- Environment manager: `uv 0.12.3`
- Docker/Podman: not detected

Each package/runtime uses its own `.venv`. The existing `server/.venv` is not
modified.

## Pinned upstream versions

| Provider | Pin | Status |
| --- | --- | --- |
| AgentScope | `2.0.7` | installed in isolated Python 3.12 environment |
| DeepSeek Harness SDK/runtime | `0.1.1rc1` | installed; pre-release; SDK and runtime versions match |
| MCP Tool Service | `2.1.1` | installed in its own environment; serves earlier protocol clients |

Primary references:

- https://pypi.org/project/agentscope/2.0.7/
- https://github.com/agentscope-ai/agentscope/blob/main/pyproject.toml
- https://pypi.org/project/deepseek-harness-sdk/0.1.1rc1/
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/python-sdk.md

## Current verification

- Runtime Contract and shared service tests: `9 passed`.
- Tool Service tests: `6 passed`, including an in-process MCP client call.
- AgentScope adapter tests: `2 passed`.
- DSH adapter tests: `2 passed`.
- Provider-neutral comparison builder tests: `3 passed`; all 15 samples
  materialize into the shared request contract.
- Tool Service Streamable HTTP was probed on `127.0.0.1:8200`.
- AgentScope's MCP `1.29.1` client discovered all four tools from the MCP
  `2.1.1` server.
- DSH `0.1.1rc1` bundled runtime initialized the custom Cordis composition and
  connected its first-party MCP client plugin to the same Tool Service. The
  MCP plugin closure bug reported for `0.1.0rc6` did not reproduce.
- Model credentials were supplied only through a Git-ignored local file. Both
  providers executed real `qwen3.8-max` model and MCP Tool calls against the
  same synthetic requests.
- A no-credential HTTP exercise posted the exact same request body to both
  providers. Both accepted it asynchronously and terminated with the same
  `provider_unavailable` contract error; neither made a model or tool call.
- Local POC currently reports `sandbox=false`; per-run temporary workspaces are
  mandatory, but production-grade container sandboxing remains a deferred gate.

Representative Case A/B/C execution is complete. Credential values remain
local and are not tracked. See `representative-results-v0.1.md` for outcomes
and the remaining production gates.
