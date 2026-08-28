# Quality Runtime Contract

Provider-neutral schemas shared by the Quality Platform gateway and every
Runtime Provider adapter.

The contract owns only one Agent execution lifecycle:

```text
POST /v1/runs                 -> 202 RunAccepted
GET  /v1/runs/{run_id}        -> RuntimeRun
POST /v1/runs/{run_id}/cancel -> RuntimeRun
GET  /health                  -> HealthStatus
```

It intentionally does not own Task, Task Instance, Scorecard, Review,
Master Data storage, or business Result persistence.

Run the locked contract suite in its isolated environment:

```bash
uv run --project packages/runtime_contract --frozen pytest
```
