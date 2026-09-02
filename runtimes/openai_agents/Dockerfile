# syntax=docker/dockerfile:1.7
FROM ghcr.io/astral-sh/uv:0.12.3 AS uv
FROM python:3.12-slim

COPY --from=uv /uv /uvx /bin/
WORKDIR /app

COPY packages/runtime_contract packages/runtime_contract
COPY packages/runtime_service packages/runtime_service
COPY runtimes/openai_agents runtimes/openai_agents

WORKDIR /app/runtimes/openai_agents
RUN uv sync --frozen --no-dev

RUN useradd --create-home --uid 10001 runtime
USER runtime
ENV PATH="/app/runtimes/openai_agents/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1
EXPOSE 8303
CMD ["uvicorn", "app.main:app", "--app-dir", "/app/runtimes/openai_agents", "--host", "0.0.0.0", "--port", "8303"]
