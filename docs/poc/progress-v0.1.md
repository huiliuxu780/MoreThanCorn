# Runtime Provider POC progress v0.1

Date: 2026-08-28

## Completed

- Provider-neutral Runtime Contract with asynchronous lifecycle, idempotency,
  standard usage/trace/error shapes, cancellation, and health capabilities.
- Shared single-process Provider HTTP lifecycle used by both adapters.
- AgentScope `2.0.7` adapter:
  - OpenAI-compatible model construction from deployment environment;
  - JSON Schema to Pydantic structured-output conversion;
  - AgentScope native event stream to contract trace;
  - AgentScope native MCP client to the shared Tool Service;
  - missing credentials fail closed.
- DeepSeek Harness `0.1.1rc1` adapter:
  - exact-version bundled runtime;
  - one temporary workspace and session root per Run;
  - custom Cordis composition with the first-party MCP client;
  - strict JSON extraction followed by Draft 2020-12 validation;
  - notifications/events mapped to contract trace;
  - missing credentials fail closed.
- Shared Tool Service:
  - HTTP debug API and MCP Streamable HTTP at `/mcp/`;
  - one implementation for `knowledge_search`, `ticket_query`, `sms_query`,
    and `appointment_query`;
  - deterministic fixture responses with evidence references;
  - MCP v2 server tested with MCP v2, AgentScope MCP v1, and DSH clients.
- Fifteen fully synthetic, PII-free smoke records, Ground Truth, Tool policies,
  and fixtures.
- Provider-neutral comparison runner:
  - materializes criteria, Master Data, schemas, and one input into the shared
    Runtime request;
  - posts that exact body unchanged to both providers;
  - records one SHA-256 request fingerprint and both raw Runtime results;
  - keeps generated model output and traces out of Git by default.
- No-credential end-to-end HTTP path verified: both providers accepted the
  same request and returned the standard `provider_unavailable` failure with
  zero model and tool calls.
- Real representative Case A/B/C completed with `qwen3.8-max`, shared Agent
  Spec `0.1.1`, and explicit `max_tokens=4096`.
- Ground Truth evaluator reports `3/3` for both providers after one explicitly
  recorded 300-second B retry. At the original 180-second gate, AgentScope was
  `3/3` and DeepSeek Harness was `2/3` because B timed out.
- Full 15-sample real batch completed with concurrency 2 and a common
  300-second deadline. Runtime completion was AgentScope `14/15` and DSH
  `13/15`; corrected Ground Truth was `8/15` for both.
- Usage extraction is verified on real results for both native event formats.
- The runner now writes atomically after each sample and supports bounded
  concurrency, resume, and explicit failed-provider retry. An interrupted real
  run exercised the resume path without repeating successful provider work.
- Runtime timeout classification is deadline-authoritative even when an adapter
  suppresses cancellation and returns an interruption response.
- Trace output now drops token/chunk wrappers while retaining lifecycle, Tool,
  usage, and error evidence; a two-provider B retry reduced to 36 KB with 19
  trace events per provider.
- Agent Spec `0.1.2` passed five targeted decision-boundary samples `5/5` on
  both providers. A separate B02 retry also passed both providers. The resulting
  mixed-version diagnostic is `13/15` for both and is not represented as a
  full Spec-0.1.2 batch.
- Full evidence and interpretation are documented in
  `docs/poc/full-batch-results-v0.1.md`.

## Current gate

The full functional and concurrency POC is complete. AgentScope remains the
default candidate; DSH remains the comparison provider because its median is
competitive but its tail is materially worse. The next gate is benchmark
adjudication and repeated runs: fix or relabel the two Ground Truth conflicts,
version the dataset, run at least three full repetitions, preserve partial
usage on failure, exercise cancellation under load, and add a real sandbox.
The POC must retain both the original 180-second representative timeout and the
300-second full-batch timeouts as evidence.

Local execution environment:

```text
QUALITY_MODEL_API_KEY
QUALITY_MODEL_ID
QUALITY_MODEL_BASE_URL   # optional for the provider's default endpoint
```

The same endpoint, model id, and model parameters are used for both providers.
