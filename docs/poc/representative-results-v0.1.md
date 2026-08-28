# Runtime Provider representative POC results v0.1

Date: 2026-08-28

## Fixed comparison inputs

- Model: `qwen3.8-max`
- Endpoint: DashScope OpenAI-compatible endpoint
- Agent Spec: `quality-agent` `0.1.1`
- Explicit model parameter: `max_tokens=4096`
- Shared Runtime request, schemas, Master Data, Tool Service, and synthetic data
- Runtime output and traces remain under ignored `evaluation/results/`

No credential value is stored in this report or tracked by Git.

## Representative outcome

| Case | Expected behavior | AgentScope | DeepSeek Harness |
| --- | --- | --- | --- |
| A / `SMOKE-A01` | detect abusive language; no enterprise Tool | Pass, 36.977 s, 1 model / 0 Tool | Pass, 24.747 s, 1 model / 0 Tool |
| B / `SMOKE-B01` | detect knowledge error; `knowledge_search` only | Pass at 180 s gate, 59.913 s, 2 model / 1 Tool | Timed out at 180.178 s |
| C / `SMOKE-C01` | detect unfulfilled SMS promise; `sms_query` only | Pass, 34.679 s, 2 model / 1 Tool | Pass, 43.308 s, 2 model / 1 Tool |

At the common 180-second gate, AgentScope passed `3/3`; DeepSeek Harness
passed `2/3`.

One explicitly labeled B retry used the same 300-second timeout for both
providers. AgentScope passed in 152.588 seconds; DeepSeek Harness passed in
235.044 seconds. Both called `knowledge_search` exactly once and passed every
Ground Truth check. The retry demonstrates functional closure, but it does not
erase the original timeout or the observed latency variance.

## Defects found and closed during real execution

1. DSH sent an invalid implicit `max_tokens` value to DashScope. The shared
   request now sets `4096`, and the adapter also has a safe default.
2. AgentScope correctly stopped for permission before calling an MCP Tool, but
   the Tool Service did not advertise that its fixture queries were read-only.
   All four MCP Tools now declare read-only, non-destructive, idempotent, and
   closed-world annotations.
3. Both agents initially treated a future SMS promise as a knowledge claim.
   Agent Spec `0.1.1` explicitly separates future commitments from policy or
   product knowledge; both providers then called only `sms_query` for Case C.
4. AgentScope's built-in structured-output submission Tool was initially
   counted as an enterprise Tool call. Usage now excludes it by name.
5. DSH `turn/end` provider errors are now classified as `model_error`, not as
   JSON parsing errors, with bounded protocol diagnostics.
6. Runtime timeout handling now asks the adapter to close the active provider
   execution before returning the standard timeout error.
7. Tool names, model-call counts, duplicate Tool calls, evidence references,
   and Ground Truth checks are normalized by the comparison evaluator.

## Preliminary decision

AgentScope is the stronger default candidate for the next POC phase because it
passed all three representative cases inside the 180-second gate and exposes
native structured output. DeepSeek Harness is functionally viable and kept as
the comparison provider, but its B-path tail latency needs investigation before
it can meet the same service-level gate.

This is not the final production selection. The 15-sample batch, concurrency,
rate limits, token usage extraction, retries, cancellation under load, and
production sandboxing remain required before that decision.
