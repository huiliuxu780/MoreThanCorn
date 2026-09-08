# Runtime Provider services

The Runtime Providers are separate services. The main FastAPI API and worker
must communicate with them through `quality-runtime-contract`; they must not
import the runtime frameworks directly.

| Service | Port | Status |
| --- | ---: | --- |
| AgentScope | 8301 | Sole runtime as of 2026-09-04 (user decision); upstream pinned to 2.0.7 |

DeepSeek Harness (8302) and the OpenAI Agents SDK runtime were retired on
2026-09-04 and moved to `archive/runtimes-retired-2026-09-04/`. The DSH
Cordis plugins archived there remain the behavioral reference for porting
the staged quality/business workflows into AgentScope
(`docs/v2-design/05-agent-management-redesign.md`, track B1/B2) until those
ports pass real-call regression.
