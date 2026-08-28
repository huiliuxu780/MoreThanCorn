# DeepSeek Harness Runtime Provider

Independent, experimental DSH service implementing Runtime Contract v1.

The committed lockfile intentionally captures the official PyPI baseline
`0.1.1rc1`. The native quality bundle was validated with matching source-built
`0.1.2a1` SDK/runtime wheels; those artifacts must be supplied by an approved
internal artifact pipeline before native mode is promoted.

Local adapter tests:

```bash
uv run --project runtimes/deepseek_harness --frozen pytest tests/test_adapter.py
```

The adapter does not enable `danger-full-access`. A permission override is
accepted only through `QUALITY_DSH_PERMISSION_MODE`; the unsafe mode is rejected
unless `QUALITY_RUNTIME_ENV` is explicitly `development` or `test`.

No platform traffic is routed here in Phase R0.
