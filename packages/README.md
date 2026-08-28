# Runtime Provider shared packages

These packages are provider-neutral and deliberately separate from the main
FastAPI application's dependency set.

- `runtime_contract`: strict request, lifecycle, result, trace, capability,
  and health schemas. It must not import platform Task/Result/Review models.
- `runtime_service`: a development/conformance HTTP lifecycle used by provider
  adapters. Its in-memory run store is not the production recovery mechanism.

Each package owns a `pyproject.toml` and `uv.lock`. Run tests with:

```bash
uv run --project packages/runtime_contract --frozen pytest
uv run --project packages/runtime_service --frozen pytest
```

Production persistence, polling, and recovery will be implemented in the
platform Runtime Provider Gateway during Phase R1.
