# Runtime Provider services

The Runtime Providers are separate services. The main FastAPI API and worker
must communicate with them through `quality-runtime-contract`; they must not
import AgentScope or DeepSeek Harness directly.

| Service | Port | R0 status |
| --- | ---: | --- |
| AgentScope | 8301 | Offline/conformance candidate; upstream pinned to 2.0.7 |
| DeepSeek Harness | 8302 | Experimental; PyPI baseline locked to 0.1.1rc1 |

The DSH quality workflow validated by the POC used source-built 0.1.2a1
SDK/runtime wheels and a provisioned profile. Those binary artifacts are not
committed. Rebuild them with the script under `poc/agent_runtime_providers`
and publish them to an approved internal artifact registry before production.

Neither provider is connected to platform traffic in Phase R0.
