# Runtime Provider full-batch POC results v0.1

Date: 2026-08-28

## Scope and evidence

- Model: `qwen3.8-max` through the same OpenAI-compatible endpoint
- Full batch: 15 fully synthetic samples, Agent Spec `0.1.1`
- Common provider deadline: 300 seconds
- Sample concurrency: 2
- Both providers received the same request body and request SHA-256 per sample
- Raw evidence: ignored local directory
  `poc/agent_runtime_providers/evaluation/results/full15-qwen38-spec011-c2/`
- Generated outputs and traces are not tracked by Git; no credential is stored
  in this report.

Runtime completion and Ground Truth quality are deliberately reported as two
different gates. A structurally valid answer can still be wrong, and a timeout
cannot be counted as a business-quality pass.

## Full 15-sample result

| Metric | AgentScope 2.0.7 | DeepSeek Harness 0.1.1rc1 |
| --- | ---: | ---: |
| Runtime succeeded | 14/15 (93.3%) | 13/15 (86.7%) |
| Ground Truth passed | 8/15 (53.3%) | 8/15 (53.3%) |
| Successful-run latency mean | 68.446 s | 78.458 s |
| Successful-run latency median | 50.705 s | 43.030 s |
| Successful-run latency p95/max | 174.000 s | 247.958 s |
| Tokens on successful runs | 92,715 | 106,958 |
| Model calls on successful runs | 25 | 21 |
| Enterprise Tool calls on successful runs | 11 | 10 |

Token totals exclude failed runs because the provider-neutral result does not
yet preserve partial usage at timeout. They therefore understate actual billed
usage and must not be used as a final cost comparison.

## Reliability failures

- `SMOKE-B02`: both providers reached the 300-second deadline in the concurrent
  batch. The raw AgentScope result was incorrectly labeled
  `output_schema_error` after its cancellation reply won a race; DSH reported
  `timeout`. The shared Runtime Service now makes the platform deadline
  authoritative even if an adapter suppresses task cancellation, with a direct
  regression test.
- `SMOKE-C04`: AgentScope completed; DSH reached the 300-second deadline.
- One explicitly labeled, concurrency-1 retry of `SMOKE-B02` under Spec `0.1.2`
  passed Ground Truth for both providers: AgentScope 45.792 seconds and 6,466
  tokens; DSH 61.120 seconds and 8,649 tokens. This shows a concurrency/model
  long tail, but does not erase the original full-batch timeout.

## Quality findings

The first evaluator incorrectly rejected valid DSH references such as
`knowledge_search -> KB-ID`. Evidence matching now recognizes a bounded KB ID
inside provider formatting without accepting prefix collisions such as
`KB-10` for expected `KB-1`. Re-evaluating the unchanged raw batch moved DSH
from 5/15 to the correct 8/15.

Five clear decision-boundary failures led to Agent Spec `0.1.2`:

- vague service statements such as “尽快处理”“持续关注”“马上帮您处理” are not
  concrete, case-specific, externally verifiable promises;
- a service-wide rule or time limit is knowledge, not an individual promise;
- if no agent channel exists, abusive-language evidence is insufficient while
  knowledge and promise criteria are not applicable.

The five affected samples (`A02`, `A05`, `B01`, `B04`, `C04`) were rerun with
the same Spec `0.1.2` request for both providers. Both providers passed 5/5.
Together with the explicit `B02` retry, a diagnostic merge reaches 13/15 for
both providers. This mixed-version diagnostic is not presented as a full
Spec-0.1.2 benchmark.

The two remaining failures require benchmark adjudication instead of prompt
overfitting:

- `SMOKE-A03`: “必须完成身份核对，否则无法继续办理” is a process/eligibility
  claim under the checked-in knowledge criterion, yet Ground Truth forbids
  `knowledge_search` and expects `not_applicable`.
- `SMOKE-C02`: “受理后可以通过工单编号查询” is also a standard-process claim,
  yet Ground Truth permits only `ticket_query` and forbids `knowledge_search`.

These samples should be relabeled with matching knowledge fixtures or rewritten
in a versioned dataset before another full quality score is treated as a gate.

## Trace, resume, and retry hardening

- The batch runner now supports bounded concurrency, atomic write after every
  completed sample, `--resume`, and explicit `--retry-failed`. A real interrupted
  run preserved successful DSH results and reran only the failed AgentScope
  provider.
- Token usage is extracted from native AgentScope `ModelCallEndEvent` fields and
  DSH `assistant/message.usage` fields.
- Token/chunk delta noise is removed while model, Tool, usage, lifecycle, and
  error evidence remains. The final `B02` retry contains 19 trace events per
  provider and the complete two-provider artifact is 36 KB. The original raw
  full batch remains unchanged at 19 MB as audit evidence.

## Decision after this phase

Keep AgentScope as the default candidate and DeepSeek Harness as the comparison
provider. AgentScope has the better full-batch completion rate and lower
successful-run mean/tail latency, plus native structured output. DSH has a
slightly faster median but a materially worse long tail. Business quality is a
tie under the same model and prompt after evaluator correction, so this batch
does not show a quality advantage attributable to either Runtime.

Before a production selection: publish a versioned adjudicated dataset, run at
least three repeated full batches, define partial-usage accounting on failure,
exercise explicit cancellation under load, and add a real sandbox boundary.
