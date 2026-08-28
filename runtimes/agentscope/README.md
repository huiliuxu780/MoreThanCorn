# AgentScope Runtime Provider

Independent AgentScope 2.0.7 service implementing Runtime Contract v1.

Local conformance test:

```bash
uv run --project runtimes/agentscope --frozen pytest
```

Local service (requires credentials only for real execution):

```bash
uv run --project runtimes/agentscope --frozen \
  uvicorn app.main:app --app-dir runtimes/agentscope --host 127.0.0.1 --port 8301
```

Missing model credentials are reported as degraded health and execution fails
closed with `provider_unavailable`; no mock model is used.
