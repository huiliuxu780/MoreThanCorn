# Quality Runtime Service

Shared FastAPI lifecycle for local provider development and provider
conformance tests:

```text
POST /v1/runs
GET  /v1/runs/{run_id}
POST /v1/runs/{run_id}/cancel
GET  /health
```

`InMemoryRunService` is intentionally process-local. It is not a production
queue, database, checkpoint store, or crash-recovery mechanism. In production,
the platform owns the durable Run and repeatedly queries the provider using the
same idempotency key and run ID.
