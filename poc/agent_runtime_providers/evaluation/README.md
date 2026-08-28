# Provider comparison runner

This package materializes the one checked-in Agent Spec into the shared Runtime
contract. The resulting JSON body, including `run_id` and `idempotency_key`, is
posted unchanged to the AgentScope and DeepSeek Harness providers. Each sample
records the SHA-256 of that request body in the raw comparison artifact.

Generated output under `results/` is local evidence and is not committed.

Example after Tool Service and both providers are running:

```bash
export QUALITY_MODEL_API_KEY='...'
export QUALITY_MODEL_ID='...'
uv run --project poc/agent_runtime_providers/evaluation \
  python -m quality_runtime_evaluation.run_comparison \
  --sample-id SMOKE-A01
```

Evaluate one raw comparison against the checked-in Ground Truth:

```bash
uv run --project poc/agent_runtime_providers/evaluation \
  python -m quality_runtime_evaluation.evaluate_results \
  poc/agent_runtime_providers/evaluation/results/<run>/comparison.json
```
