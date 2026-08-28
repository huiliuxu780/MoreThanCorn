# Agent Runtime Contract v0.1

Status: POC draft

## Boundary

The Quality Platform owns Agent definitions and versions, Tasks, Runs,
business Results, Scorecards, Review, and Insight. A Runtime Provider owns
only execution of one immutable Agent snapshot.

The same request must be accepted by the AgentScope and DeepSeek Harness
adapters. Provider-specific configuration is intentionally forbidden from
the request schema. An adapter may read deployment configuration from its own
environment, but it may not require a second provider-specific Agent spec.

## Lifecycle

`POST /v1/runs` is asynchronous and idempotent. A repeated request with the
same `idempotency_key` and identical body resolves to the same provider run.
A repeated key with a different body is a conflict.

Valid transitions are:

```text
queued -> running -> succeeded
                  -> failed
       -> cancelled
running -> cancelled
```

Only terminal states may contain `output`, `error`, or `finished_at`.

## Trace

Trace events are ordered by `sequence`. Tool and model operations should set
`call_id`; nested operations should set `parent_call_id`. Request and response
payloads must be redacted before they cross the provider boundary.

## Version snapshot

Every response records three independent versions:

- Runtime Provider name
- upstream runtime version
- adapter version

POC candidate pins as of 2026-08-28:

- AgentScope: `2.0.7`
- DeepSeek Harness SDK/runtime: `0.1.1rc1`

The DSH version is a pre-release and is not a production recommendation.

## Deferred decisions

- Streaming transport and event replay cursor
- callback/webhook delivery
- provider registry persistence
- platform database migration
- production sandbox backend
