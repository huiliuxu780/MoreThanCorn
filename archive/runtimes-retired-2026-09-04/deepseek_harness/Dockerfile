# syntax=docker/dockerfile:1.7
FROM ghcr.io/astral-sh/uv:0.12.3 AS uv
FROM python:3.12-slim

COPY --from=uv /uv /uvx /bin/
WORKDIR /app

COPY packages/runtime_contract packages/runtime_contract
COPY packages/runtime_service packages/runtime_service
COPY runtimes/deepseek_harness runtimes/deepseek_harness

WORKDIR /app/runtimes/deepseek_harness
RUN uv sync --frozen --no-dev

RUN useradd --create-home --uid 10001 runtime
USER runtime
ENV PATH="/app/runtimes/deepseek_harness/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    QUALITY_RUNTIME_ENV=production
EXPOSE 8302
CMD ["uvicorn", "app.main:app", "--app-dir", "/app/runtimes/deepseek_harness", "--host", "0.0.0.0", "--port", "8302"]
