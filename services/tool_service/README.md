# Quality Enterprise Tool Service

One deterministic implementation is exposed through both plain HTTP and MCP
Streamable HTTP. It returns fixture facts only; quality decisions remain in
the Agent and scoring remains in the platform Scorecard.

```bash
uv venv --python 3.12 .venv
uv pip install -e '.[test]'
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8200
```

Endpoints:

- `GET /health`
- `GET /v1/tools`
- `POST /v1/tools/{tool_name}`
- `POST /v1/tools/{tool_name}:call`
- MCP Streamable HTTP: `/mcp/`

The default fixture file is
`poc/agent_runtime_providers/datasets/smoke/tool_fixtures_v0.1.json`.
Set `QUALITY_TOOL_FIXTURES` to an explicit local path to use another fixture.
