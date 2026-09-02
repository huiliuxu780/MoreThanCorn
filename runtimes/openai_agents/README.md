# quality-runtime-openai-agents

第三个 Agent Runtime Provider：基于官方 **OpenAI Agents SDK**（钉扎 `openai-agents==0.22.0`）
实现 `quality-runtime-contract`，承载 `quality-analysis@1.0.0` 的 `native_quality_v0.2` 工作流。
设计依据：`docs/sdd/14-openai-agents-runtime-provider-poc-sdd.md`。

## 架构边界

- 只做 `quality_runtime_service.RuntimeAdapter` 的实现；`/v1/runs`、幂等、超时、
  `/health` 的 HTTP 生命周期全部复用 `packages/runtime_service`。
- 平台服务（`server/app`）不 import 本目录；平台只看到契约。
- 编排采用 **Python-controlled workflow + Agent-controlled stage**：
  阶段推进、动态 plan、并行、barrier 由本模块代码控制；单阶段内的
  reasoning + tool loop 交给 SDK `Runner.run`。不使用 Handoff 做主编排。

## 端口与启动

| Runtime | 端口 |
| --- | --- |
| AgentScope | 8301 |
| DeepSeek Harness | 8302 |
| OpenAI Agents（本目录） | 8303 |

```bash
cd runtimes/openai_agents
uv sync --all-extras
cp .env.example .env   # 填入真实凭据；.env 不进 git
uv run uvicorn app.main:app --port 8303
```

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `QUALITY_MODEL_API_KEY` | 模型凭据（仅来自环境，不进请求体/Trace）；缺失时 execute 失败关闭、/health 降级 |
| `QUALITY_MODEL_BASE_URL` | OpenAI-compatible 端点；缺省走 OpenAI 官方 |
| `QUALITY_MODEL_ID` | 仅当请求模型名为 `unset` 时的开发 fallback，不覆盖冻结版本配置 |
| `QUALITY_TOOL_MCP_URL` | 工具网关 MCP 端点（约定 `http://127.0.0.1:8200/mcp/`） |
| `OPENAI_AGENTS_REMOTE_TRACING` | 默认 `false`（SDK 远端 tracing 关闭）；显式 `true` 才启用，仅限开发调试 |

## 工具硬白名单（SDD 14 §15）

每个阶段暴露给模型的工具 = `request.agent.tools ∩ stage allowed_tools`
（请求工具即平台冻结的 Module logicalTools，第三层由平台侧保证）。
交集外的工具不存在于 Agent 工具集——不是 Prompt 禁止，而是物理不存在。
工具通过 MCP（`MCPServerStreamableHttp` + `tool_filter`）连接现有工具网关，
与 AgentScope/DSH 同构；工具本体仍是 `services/tool_service` 的只读查询。

## /health

真实检查，不固定返回 ok：`adapter`（SDK 可导入）、`model_credential`（凭据存在）、
`model_endpoint`（连通级探测，不发模型请求、不耗额度；仅配置了 BASE_URL 时检查）、
`tool_gateway`（工具服务 `/health` 连通探测）。任一 failed → 503 unavailable。

## 测试

```bash
cd runtimes/openai_agents
uv run pytest
```

- `test_contract.py`：HTTP 生命周期（health/submit/get/cancel/幂等复用/冲突/404/超时/输出校验错误）；
- `test_adapter.py`：凭据失败关闭、provider/参数校验、运行时元数据、health 降级；
- `test_tools.py`：三层白名单隔离（OAI-R1）；
- `test_native_workflow.py` / `test_trace_mapper.py` / `test_e2e.py`：五阶段工作流（OAI-R2）。

## 已知限制

- `InMemoryRunService`：进程内状态，定位于本地开发/契约测试/POC；
  生产恢复由平台 Gateway/Queue 负责。
- token usage 依赖端点在 chat completions 返回 usage；端点不返回时
  usage 记 0（不伪造），验收报告如实注明。
- 结构化输出依赖端点对 `response_format: json_schema` 的支持；
  现网 Qwen 兼容端点与 AgentScope runtime 共用，已在其 POC 验证过同路径。
