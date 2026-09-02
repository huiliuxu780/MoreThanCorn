# OpenAI Agents SDK Runtime Provider 接入与端到端 POC SDD

**状态：已批准，实施中**
**版本：v0.1**
**日期：2026-09-02**
**实施仓库：`huiliuxu780/MoreThanCorn`**
**实施分支：`feat/sdd14-openai-agents-runtime`**

**变更记录**

- 2026-09-02 v0.1：用户批准实施。相对候选稿两处编辑：§38 补充 SDD-13 已验收通过的事实；§70 执行顺序更新——SDD-13 已于 2026-09-02 验收通过并合入 main，14 直接基于含 13 成果的 main 实施，不存在"先 14 后 13"的顺序问题。其余内容与候选稿一致。

---

# 0. 文档目的

本文定义 MoreThanCorn 接入 **OpenAI Agents SDK** 作为第三个 Agent Runtime Provider 的技术方案，并定义一个必须从平台业务入口完整跑通的端到端 POC。

本次 POC 不以"写一个 Python Demo 能调用 OpenAI Agents SDK"为完成标准。

完整 POC 必须从 MoreThanCorn 平台现有能力开始：

```text
现有用例库
    ↓
配置 Agent
    ↓
发布 Agent Version
    ↓
绑定 OpenAI Agents Runtime Provider
    ↓
配置完整 Analysis Task
    ↓
手工 Run Task
    ↓
TaskRun
    ↓
按用例产生 Interaction Run
    ↓
OpenAI Agents Runtime 执行
    ↓
Tools / Model / Structured Output
    ↓
Run.output
    ↓
Run Detail
    ↓
查看真实运行结果、阶段、Tool Call、Usage、错误与证据
```

只有上述链路真实跑通，才认为 OpenAI Agents SDK 已经成功接入 MoreThanCorn。

---

# 1. 核心结论

## 1.1 OpenAI Agents SDK 的定位

OpenAI Agents SDK **不是新的平台执行层，也不替换 MoreThanCorn 的 Task / Run / Runtime Contract。**

它只作为新的 Runtime Provider 实现存在。

目标架构：

```text
                       MoreThanCorn Platform
                               │
                               │
                    quality-runtime-contract
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
        AgentScope         DeepSeek         OpenAI Agents
         Runtime           Harness             Runtime
                                                │
                                                ▼
                                      OpenAI Agents SDK
```

当前仓库已经要求 Runtime Provider 独立运行，平台主服务不能直接 import AgentScope 或 DeepSeek Harness，而是通过统一 Runtime Contract 调用。

因此 OpenAI Agents SDK 必须遵守同样边界。

---

## 1.2 本次不新增 Agent Executor

当前 MoreThanCorn 已经存在完整 Runtime Gateway：

```text
POST /v1/runs
GET  /v1/runs/{run_id}
POST /v1/runs/{run_id}/cancel
GET  /health
```

并已有：

* Runtime request hash；
* 幂等键；
* retry；
* timeout；
* Provider error mapping；
* Contract 强校验；
* Egress Policy；
* Runtime Trace；
* Provider health probe。

因此本 SDD 禁止新增第二套：

```text
AgentExecutor
AgentRunnerService
OpenAIRunManager
OpenAITaskExecutor
```

之类的平台级执行抽象。

OpenAI Runtime 直接实现现有 `RuntimeAdapter`。

当前公共 Runtime Service 已定义：

```python
class RuntimeAdapter(Protocol):
    runtime: RuntimeInfo
    capabilities: ProviderCapabilities

    async def execute(
        self,
        request: RuntimeExecuteRequest
    ) -> RuntimeRun: ...

    async def cancel(self, run_id: str) -> None: ...

    async def health_checks(
        self
    ) -> dict[str, str]: ...
```

并已经负责 Runtime HTTP 生命周期、超时、幂等、Run 状态管理以及 `/health`。

OpenAI Runtime 必须直接复用此服务。

---

# 2. 当前代码基线

以下属于现有代码事实，不属于本次新设计。

## 2.1 Runtime Contract 已存在

`quality-runtime-contract` 当前已经定义：

```text
RuntimeExecuteRequest
AgentExecutionSpec
ModelSpec
ToolRef
MasterDataRef
ExecutionContext

RuntimeRun
RuntimeUsage
RuntimeError
TraceEvent
RuntimeInfo
ProviderCapabilities
HealthStatus
```

Contract 明确不包含：

```text
AnalysisTask
TaskRun
QualityResult
Scorecard
Review
```

Runtime 只负责 Agent 执行，不理解平台业务对象。

本次 **不得修改这一原则**。

原则上，本 POC 不需要 Runtime Contract v1 Breaking Change。

---

## 2.2 Agent Task 已经进入主执行链

当前 `AnalysisTask` 已支持：

```text
execution_target_type =
    workflow
    |
    agent
```

Agent Task 启动时会解析：

```text
AgentVersion
Release
Runtime Provider Binding
```

并冻结到 TaskRun：

```text
resolved_agent_version_id
resolved_release_id
runtime_binding_snapshot
```

后续 retry 不重新选择 Provider。

因此 OpenAI Agents SDK 不需要特殊 Task 类型。

它就是：

```text
AnalysisTask
executionTarget = agent
```

然后通过 Release Binding 选择 OpenAI Runtime。

---

## 2.3 Run 已经支持 Provider Runtime 结果

现有 R3 已完成：

```text
AnalysisTask
    ↓
TaskRun
    ↓
Interaction Run
    ↓
execute_module_run_sync
    ↓
Runtime Provider
    ↓
RuntimeRun
    ↓
输出 Schema 二次校验
    ↓
平台结果事务
```

并具有 exactly-once 结果约束。

现有 Run Detail 后端还已经支持：

```text
runtime
stages
calls
usage
evidence
```

所以本次 POC 的目标不是开发新的 Result Viewer。

目标是让 **OpenAI Runtime 产生的数据进入现有 Run Detail 数据结构。**

---

# 3. POC 范围

## 3.1 本次必须完成

本次范围：

1. 新增 `openai-agents` Runtime Provider；
2. Runtime 使用官方 OpenAI Agents SDK；
3. Provider 实现现有 `quality-runtime-contract`；
4. Provider 可注册、健康检查、启用；
5. `quality-analysis` Module 增加 `openai-agents` Implementation；
6. Agent Version 可发布并绑定该 Runtime Provider；
7. 复用现有用例库；
8. 从现有用例库选择一组 POC 用例；
9. 配置一条完整 Analysis Task；
10. Task 使用 Agent 作为 execution target；
11. 手工执行 Task；
12. 生成真实 TaskRun；
13. 每个用例生成真实 Interaction Run；
14. OpenAI Agents SDK 真正调用模型；
15. 需要工具的场景真正调用现有 Tool；
16. 返回结构化结果；
17. 结果写入 `Run.output`；
18. Run Detail 能看到完整运行信息；
19. 失败用例能看到真实失败原因；
20. 不能使用 Fake Provider 作为最终验收。

---

# 4. 明确不做的内容

本 POC 不包含以下项目。

### 不重做用例库

当前用例库已经存在。

仓库目前也已有 `EvalSample`，语义是：

> 固定输入 + 可选期望输出，并可挂 Agent / Workflow。

本阶段禁止为了 OpenAI POC 再创建：

```text
OpenAITestCase
AgentPOCSample
OpenAIDataset
RuntimeTestData
```

等第二套样本系统。

---

### 不做新的 Task 系统

继续使用：

```text
AnalysisTask
AnalysisTaskVersion
TaskRun
Run
```

---

### 不做新的 Result 模型

POC 核心验收对象：

```text
Run.output
```

9 月 2 日 Task Output SDD 已明确 `Run.output` 是经过 Output Schema 校验后的不可变执行事实，用于审计、排障、重试、投递和版本比较。

因此本 POC 不要求先完成目标表 ResultDelivery。

---

### 不要求生产级异步 Runtime 存储

当前公共 `quality_runtime_service` 的 InMemoryRunService 已明确定位于：

```text
local development
contract tests
provider conformance
POC
```

生产恢复由平台 Gateway / Queue 负责。

所以 POC 可以复用现有 Runtime Service 生命周期。

---

### 不做 OpenAI 专属 Task 页面

Task 页面不出现：

```text
OpenAI Task
OpenAI Run
OpenAI Dataset
```

Runtime Provider 对 Task 是透明的。

---

# 5. POC 选择的领域 Agent

首个完整 POC 固定使用：

```text
quality-analysis@1.0.0
```

原因不是 OpenAI SDK 只能运行该 Agent，而是该 Module 当前已经具有完整领域执行语义：

```text
identify
→ plan
→ execute
→ barrier
→ synthesize
```

并已经在 AgentScope / DeepSeek Harness 上形成 Provider 实现。

因此它最适合作为 OpenAI Runtime 的 Conformance + E2E POC。

---

# 6. 保持现有 Quality Workflow 语义不变

OpenAI Runtime 不允许重新发明一套质检算法。

现有 `native_quality_v0.2` 的领域执行语义必须保持：

```text
                  Canonical Call
                        │
                        ▼
                     identify
                        │
       ┌────────────────┼─────────────────┐
       ▼                ▼                 ▼
consumer_needs   knowledge_claims     promises
                        │
                        ▼
                      plan
                        │
            根据实际内容生成 0..N Plan
                        │
                        ▼
                     execute
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
 knowledge-1       promise-1        promise-N
       │                │                │
       ▼                ▼                ▼
knowledge_search   ticket_query      sms_query...
       │                │                │
       └────────────────┼────────────────┘
                        │
                   并行等待
                        │
                        ▼
                     barrier
                        │
                        ▼
                    synthesize
                        │
                        ▼
              Quality Structured Output
```

现有 AgentScope 实现已经使用动态 Plan + `asyncio.gather()` 处理一通电话里的多个 knowledge claim 和 promise。

OpenAI Agents SDK POC 必须证明同样能力。

---

# 7. OpenAI Agents SDK 版本

POC 固定：

```text
openai-agents == 0.22.0
```

并进入：

```text
pyproject.toml
uv.lock
```

禁止：

```text
openai-agents >= 0.22
openai-agents = *
```

截至 2026-09-02，PyPI 最新发布版本为 `0.22.0`，发布日期 2026-08-19。

后续升级必须通过 Provider Conformance Test 后单独升级。

---

# 8. 新增目录结构

新增：

```text
runtimes/
└── openai_agents/
    ├── app/
    │   ├── __init__.py
    │   ├── main.py
    │   ├── adapter.py
    │   ├── model_adapter.py
    │   ├── tool_adapter.py
    │   ├── trace_mapper.py
    │   ├── schemas.py
    │   └── native_workflow.py
    │
    ├── tests/
    │   ├── test_contract.py
    │   ├── test_adapter.py
    │   ├── test_tools.py
    │   ├── test_native_workflow.py
    │   ├── test_trace_mapper.py
    │   └── test_e2e.py
    │
    ├── .env.example
    ├── pyproject.toml
    ├── uv.lock
    ├── Dockerfile
    └── README.md
```

不得将 OpenAI SDK import 到：

```text
server/app/
```

平台服务只能看到：

```text
quality-runtime-contract
```

---

# 9. Runtime Service 实现

## 9.1 main.py

`main.py` 仅负责：

```python
adapter = OpenAIAgentsRuntimeAdapter()

app = create_runtime_app(adapter)
```

必须复用：

```text
packages/runtime_service/
```

不得复制：

```text
/v1/runs
/v1/runs/{id}
/cancel
/health
```

的 HTTP 生命周期。

---

# 10. Runtime Metadata

OpenAI Runtime 返回：

```text
RuntimeInfo.provider        = "openai-agents"
RuntimeInfo.runtime_version = "0.22.0"
RuntimeInfo.adapter_version = "0.1.0"
```

Provider Capability 首版：

```json
{
  "tools": true,
  "skills": false,
  "structured_output": true,
  "trace": true,
  "session": false,
  "cancel": true,
  "streaming": false,
  "sandbox": false
}
```

说明：

`session=false`：

本 POC 是：

```text
one Interaction
=
one isolated Run
```

不存在跨热线 Session 记忆。

`streaming=false`：

平台当前使用异步：

```text
submit
→ poll
→ terminal result
```

不需要为 POC 增加流式 Contract。

`sandbox=false`：

本次质量分析不需要代码工作区 Sandbox。

---

# 11. OpenAI Agent 基础执行模型

官方 Agents SDK 的核心执行模式是：

```python
Agent(...)
Runner.run(...)
```

`Runner` 会自动处理：

```text
模型调用
工具调用
handoff
继续下一轮
最终输出
```

直到获得 final output 或达到运行限制。

POC 不使用 Handoff 作为 Quality Workflow 主编排机制。

原因：

当前 Quality Workflow 是平台确定的：

```text
identify
plan
execute
barrier
synthesize
```

而不是 Agent 自己任意决定下一位 Agent。

因此采用：

```text
Python-controlled workflow
+
OpenAI Agent-controlled stage
```

即：

```text
Runtime Workflow
    控制阶段/并行/Barrier

OpenAI Agent
    控制单阶段 reasoning + tool loop
```

---

# 12. StageRunner 抽象

保留现有 AgentScope 方案里已经形成的 StageRunner 思路。

定义：

```python
class StageRunner(Protocol):

    async def run(
        self,
        *,
        stage: str,
        instructions: str,
        payload: dict,
        schema: type[BaseModel],
        allowed_tools: list[str],
        tasks: list[Any],
    ) -> StageResult:
        ...
```

新增：

```text
OpenAIAgentsStageRunner
```

职责：

```text
stage definition
        ↓
resolve model
        ↓
resolve allowed tools
        ↓
create Agent
        ↓
Runner.run()
        ↓
structured output
        ↓
trace mapping
        ↓
StageResult
```

---

# 13. OpenAI Agent 创建规则

每一个 bounded stage 创建自己的 Agent。

示例语义：

```python
agent = Agent(
    name=f"quality-{stage}",
    instructions=instructions,
    model=model,
    tools=resolved_tools,
    output_type=schema,
)
```

Agents SDK 原生支持：

```text
instructions
model
tools
output_type / structured output
```

所以现有 Pydantic Stage Schema 可以直接作为结构化输出边界。

---

# 14. Model Adapter

## 14.1 保持当前 Provider POC 的模型配置方式

现有 AgentScope / DSH POC 已统一使用：

```text
QUALITY_MODEL_API_KEY
QUALITY_MODEL_BASE_URL
QUALITY_MODEL_ID
```

OpenAI Runtime 第一版继续使用相同环境变量。

`.env.example`：

```text
QUALITY_MODEL_API_KEY=
QUALITY_MODEL_BASE_URL=
QUALITY_MODEL_ID=
QUALITY_TOOL_MCP_URL=http://127.0.0.1:8200/mcp/

OPENAI_AGENTS_REMOTE_TRACING=false
```

真实 Secret 禁止进入 Git。

---

## 14.2 模型来源

真正使用哪个 Model 必须以：

```text
request.agent.model.model
```

为准。

环境变量 `QUALITY_MODEL_ID` 只能作为开发 fallback，不得覆盖冻结 AgentVersion 的模型配置。

优先级：

```text
RuntimeExecuteRequest.agent.model
        >
Runtime local fallback
```

---

## 14.3 OpenAI-Compatible Endpoint

Agents SDK 官方支持通过：

```text
AsyncOpenAI
+
base_url
+
api_key
```

连接 OpenAI-compatible Provider，也支持 per-run / per-Agent Model Provider。

因此 POC 不要求一定使用 OpenAI 官方模型。

如果当前 MoreThanCorn POC 已经使用统一兼容模型，例如现有 Qwen endpoint，可继续使用同一 Model：

```text
AgentScope
DSH
OpenAI Agents SDK
```

尽量保持：

```text
same model
same input
same tools
same output schema
```

方便 Runtime 横向比较。

---

# 15. Tool Adapter

这是本 POC 最重要的安全边界之一。

## 15.1 禁止暴露全部 Tools

现有 DSH POC 已经真实证明：

即使请求声明：

```text
agent.tools=[]
```

如果 Runtime Profile 自动加载全局 MCP Tools，模型仍可能调用未声明工具。

真实实验出现过未声明 Tool Call，因此当前代码已经明确：

> Prompt 约束不能作为权限控制，Runtime 必须实现请求级工具硬白名单。

OpenAI Runtime 必须遵守相同原则。

---

## 15.2 三层白名单

真正暴露给一个 Stage Agent 的工具集合：

```text
Runtime Request ToolRef
        ∩
Module Logical Tools
        ∩
Current Stage allowed_tools
        =
Actual Agent Tools
```

例如：

```text
request.agent.tools
=
knowledge_search
ticket_query
sms_query
appointment_query
```

某个 Knowledge Plan：

```text
allowed_tools
=
knowledge_search
```

最终这个 Agent 只可以看到：

```text
knowledge_search
```

不是靠 Prompt 告诉模型不要使用其他 Tool。

而是其他 Tool 根本不存在于：

```text
Agent.tools
```

---

# 16. Function Tool 实现

OpenAI Agents SDK 支持将 Python 函数包装成 Function Tool。

但 Runtime 不直接实现企业业务逻辑。

正确路径：

```text
OpenAI Agent
     ↓
FunctionTool Adapter
     ↓
MoreThanCorn Tool Gateway / MCP
     ↓
enterprise tool
     ↓
knowledge / ticket / sms / appointment
```

例如：

```python
async def knowledge_search(...):
    return await platform_tool_client.invoke(
        tool="knowledge_search",
        ...
    )
```

工具实现仍属于现有 Tool 层。

OpenAI Runtime 只是：

```text
ToolRef
→ SDK FunctionTool
```

适配器。

---

# 17. POC 必须接入的 Tools

针对 `quality-analysis@1.0.0`：

```text
knowledge_search
ticket_query
sms_query
appointment_query
```

来源于现有 Module manifest。

至少需要真实验证：

```text
一个不需要 Tool 的用例
一个 knowledge_search 用例
一个承诺类 Tool 用例
一个一通电话包含多个待核验事项的用例
```

不允许只挑"没有 Tool 的简单问题"宣布 POC 成功。

---

# 18. Quality Native Workflow

## 18.1 identify

输入：

```text
request.input
```

输出：

```python
Identification:
    consumer_needs[]
    knowledge_claims[]
    promises[]
```

Agent：

```text
tools = []
```

identify 阶段不访问业务工具。

---

## 18.2 plan

Plan 不交给 LLM 自由创造 Workflow。

由 Runtime 根据 identify 结构化结果确定性生成：

```text
knowledge_claim
    → Knowledge Evaluation Plan

promise(ticket)
    → Ticket Evaluation Plan

promise(sms)
    → SMS Evaluation Plan

promise(appointment)
    → Appointment Evaluation Plan
```

这是业务执行策略，不属于语言模型自由决策。

---

# 19. Dynamic Fan-out

假设一通电话：

```text
knowledge_claims = 2
promises = 3
```

则产生：

```text
5 个 execution plans
```

运行：

```python
await asyncio.gather(...)
```

并受：

```text
maxParallelPlans
```

限制。

沿用当前 Module policy：

```text
maxParallelPlans = 2
```

当前 `AgentModule` 已定义包括：

```text
timeoutSeconds
maxModelCalls
maxToolCalls
maxKnowledgeRounds
maxParallelPlans
```

等执行策略。

这些限制应由 Runtime 代码执行，不允许只写进 Prompt。

---

# 20. Knowledge Evaluation

Knowledge Plan：

```text
Agent
    ↓
knowledge_search
    ↓
必要时改写 query
    ↓
knowledge_search
    ↓
证据充分
    ↓
structured result
```

输出保持现有：

```text
accurate
inaccurate
insufficient_evidence
```

以及：

```text
search_rounds
evidence_refs
reason
```

现有 native workflow 的多轮 Knowledge Search 语义必须保持。

---

# 21. Promise Evaluation

根据 Promise 类型严格绑定工具：

```text
ticket
    → ticket_query

sms
    → sms_query

appointment
    → appointment_query
```

输出：

```text
fulfilled
unfulfilled
mismatched
insufficient_evidence
```

不能允许模型自己决定：

```text
"我觉得无需查系统"
```

只要进入 Promise Evaluation Plan，规定工具必须被真正调用。

---

# 22. Barrier

所有 Plan 必须进入终态：

```text
completed
failed
```

之后才能进入：

```text
synthesize
```

不存在：

```text
部分执行还未完成
→ 提前生成最终质检结果
```

如果 Barrier 不满足：

```text
Runtime Run = failed
```

不得生成伪 succeeded。

---

# 23. Synthesize

Synthesize Agent：

```text
tools=[]
```

只读取前面已经完成的：

```text
consumer_needs
knowledge_results
promise_results
```

它不得：

```text
重新查询事实
新增事实
修改前序状态
把 insufficient_evidence 改成 passed
```

最终领域输出必须符合现有：

```text
quality_output.schema.json
```

---

# 24. Structured Output 双层校验

第一层：

```text
OpenAI Agents SDK output_type / Pydantic
```

第二层：

```text
Runtime
jsonschema validate
request.agent.output_schema
```

第三层仍保留平台已有校验：

```text
MoreThanCorn Platform
Output Schema Validation
```

原因：

```text
Provider saying valid
≠
Platform blindly trusting Provider
```

当前平台已经要求 Runtime output 回平台后再次进行 Schema 校验。

---

# 25. Trace 设计

## 25.1 平台 Trace 是唯一业务审计事实

OpenAI Agents SDK 自带 tracing，而且 SDK 默认开启 tracing。

但是消费者热线、工单、知识检索等信息可能属于企业受限数据。

因此：

```text
OpenAI SDK Remote Tracing
默认关闭
```

POC 默认执行：

```python
set_tracing_disabled(True)
```

禁止默认把：

```text
call transcript
tool input
tool output
consumer data
```

发送到外部 Trace Backend。

---

## 25.2 平台本地 Trace

OpenAI Runtime 自己把执行过程映射成现有：

```text
TraceEvent
```

至少需要：

```text
workflow/stage_started
workflow/stage_completed

agent/start
agent/end

model/start
model/end

tool/start
tool/end

workflow/stage_retry

error
```

---

# 26. Trace Event Metadata

每条 Tool Call 至少记录：

```text
sequence
timestamp
type
name
call_id
parent_call_id
metadata.workflow_stage
```

允许保存脱敏后的：

```text
input summary
output summary
```

禁止保存：

```text
API KEY
Authorization
Connection Secret
完整签名 URL
```

---

# 27. Usage

RuntimeRun 必须返回：

```text
input_tokens
output_tokens
total_tokens
model_calls
tool_calls
```

满足现有：

```text
RuntimeUsage
```

Contract。

最终 Run Detail 可以直接使用现有 `usage` 展示。

如果某个 OpenAI-compatible Provider 无法返回 token usage：

不能伪造。

应：

```text
token = 0
+
runtime metadata 标明 unavailable
```

并在 POC 验收报告中注明。

---

# 28. Error Mapping

SDK / Model / Tool 错误必须转换成现有 Runtime ErrorCode。

推荐映射：

```text
bad request
→ INVALID_REQUEST

Agent spec/schema 无法构造
→ AGENT_SPEC_INVALID

model endpoint unavailable
→ PROVIDER_UNAVAILABLE

LLM failure
→ MODEL_ERROR

tool failure
→ TOOL_ERROR

structured output invalid
→ OUTPUT_SCHEMA_ERROR

runtime deadline
→ TIMEOUT

cancelled
→ CANCELLED

unknown adapter exception
→ INTERNAL_ERROR
```

禁止：

```text
except Exception:
    return succeeded
```

禁止模型失败后使用硬编码业务回答兜底。

---

# 29. Provider Registry 接入

当前：

```python
PROVIDER_KINDS = (
    "agentscope",
    "deepseek-harness",
    "external",
)
```

修改为：

```python
PROVIDER_KINDS = (
    "agentscope",
    "deepseek-harness",
    "openai-agents",
    "external",
)
```

---

# 30. Provider 注册

POC 注册实例，例如：

```text
Name:
OpenAI Agents POC

Kind:
openai-agents

Base URL:
http://127.0.0.1:8303

Status:
enabled
```

建议端口：

```text
8301 AgentScope
8302 DeepSeek Harness
8303 OpenAI Agents
```

---

# 31. /health 验收

`GET /health` 必须真实检查：

```text
adapter
model credential
model endpoint
tool gateway
```

不能固定：

```json
{"status":"ok"}
```

示例：

```json
{
  "status": "ok",
  "runtime": {
    "provider": "openai-agents",
    "runtime_version": "0.22.0",
    "adapter_version": "0.1.0"
  },
  "capabilities": {
    "tools": true,
    "skills": false,
    "structured_output": true,
    "trace": true,
    "session": false,
    "cancel": true,
    "streaming": false,
    "sandbox": false
  },
  "checks": {
    "adapter": "ok",
    "model": "ok",
    "tool_gateway": "ok"
  }
}
```

没有模型凭据时：

```text
status = unavailable / degraded
```

不得显示正常。

实施注记（2026-09-02 批准时确认）：`model endpoint` 检查只做连通级探测（HTTP 可达性），不发送真实模型请求，避免健康探测消耗模型额度；tool gateway 检查为 `GET /health` 连通探测。

---

# 32. Module Manifest 接入

修改：

```text
server/app/agent_modules/
quality_analysis/manifest.yaml
```

当前：

```yaml
implementations:
  agentscope:
    version: 0.2.0
    entry: native_quality_v0.2

  deepseek-harness:
    version: 0.2.0
    bundle: morethancorn-dsh-native-quality-workflow
```

增加：

```yaml
  openai-agents:
    version: 0.1.0
    entry: native_quality_v0.2
```

最后：

```yaml
implementations:

  agentscope:
    version: 0.2.0
    entry: native_quality_v0.2

  deepseek-harness:
    version: 0.2.0
    bundle: morethancorn-dsh-native-quality-workflow

  openai-agents:
    version: 0.1.0
    entry: native_quality_v0.2
```

---

# 33. Agent 配置与发布

完整 POC 必须经过平台 Agent 生命周期。

不能后台手工构造 Runtime Request 替代。

步骤：

```text
Agent Catalog
    ↓
创建/选择 quality-analysis Agent
    ↓
配置模型
    ↓
生成 Agent Version
    ↓
发布 sandbox
    ↓
选择 Runtime Provider:
OpenAI Agents POC
    ↓
Release active
```

最终：

```text
Release.runtime_provider_id
```

必须指向：

```text
openai-agents
```

Provider 选择仍属于 Release Binding，不进入 AgentSpec。

---

# 34. 用例库接入原则

用户现有用例库是本次唯一 POC 数据来源。

禁止生成假的：

```text
demo hello world
test prompt
fake hotline transcript
```

代替真实 POC 用例。

---

# 35. 用例库与 Task 输入的适配

这里分两种情况实施，但只能复用当前已有实现，不允许复制数据。

## 情况 A：当前用例库已经对应 DataAsset

直接使用：

```text
DataAsset
+
DataDefinitionVersion
```

作为 AnalysisTask 输入。

无需开发。

---

## 情况 B：当前用例库实体仍是 EvalSample

则增加**读取适配**，不要创建新表。

逻辑：

```text
EvalSample
    ↓
UseCase/EvalSample Reader
    ↓
Task DataSnapshot
    ↓
Interaction Run
```

每条：

```text
EvalSample.input
```

作为：

```text
Run.input
```

来源。

`EvalSample.expected` 属于 POC Evaluation 对照数据：

```text
不能传给 Agent
```

否则构成答案泄漏。

实施注记（2026-09-02）：现状任务输入链路为 `DataAsset → get_reader → DataSnapshot`，EvalSample 不是 DataAsset。情况 B 若命中，优先评估把目标 EvalSample 集合经 Reader 通道接入（不复制数据、不建新表），具体桥接方式在 OAI-R4 阶段按用例库实际形态确定并记录。

---

# 36. 严禁 expected 泄漏

POC 用例：

```text
input
expected
```

真正运行时 Runtime 只能收到：

```text
input
```

不能收到：

```text
expected
label
golden_answer
expected_status
review_result
```

Expected 只能在 Run 完成之后用于：

```text
offline compare
POC acceptance
```

---

# 37. Task 配置

POC 必须在平台正常创建一个 Analysis Task。

建议：

```text
Task Name:
OpenAI Agents - Quality POC

Status:
active

Execution Target:
agent

Agent:
<quality-analysis agent>

Agent Version Policy:
pinned

Pinned Agent Version:
<本次 POC 发布版本>

Input:
现有用例库

Sampling:
all / 用户选定 POC 用例集合

Schedule:
none

Trigger:
manual

Rule Policy:
pinned

Result Rule Version:
现有对应发布版本

Output Mode:
platform_only
```

---

# 38. 为什么 POC 使用 platform_only

9 月 2 日 Task Output SDD 已明确：

```text
platform_only
```

允许用于：

```text
sandbox manual testing
Agent evaluation
```

当前 POC 目的就是证明：

```text
Task
→ Agent
→ Runtime
→ Run.output
```

完整闭环。

所以本次不应强制先实现：

```text
Target Table
ResultDelivery
Output Mapping
Domain API
```

这些属于独立 SDD 13 范围（SDD-13 已于 2026-09-02 实施并验收通过，本 POC 直接复用其 Run.output / Run Detail 能力）。

否则会把两个项目耦合，导致无法判断失败来自：

```text
OpenAI Runtime
还是
Output Delivery
```

---

# 39. Task 启动行为

用户点击：

```text
运行
```

必须进入当前真实：

```text
start_task_run()
```

流程。

当前 Task Runner 会：

```text
验证 Task active
→ 读取 TaskVersion
→ resolve AgentVersion
→ resolve Release
→ resolve Runtime Provider
→ resolve RuleVersion
→ validate Data Source
→ count dataset
→ create DataSnapshot
→ create TaskRun
→ enqueue task-run
```

OpenAI POC 不允许绕过此链路。

---

# 40. TaskRun 冻结要求

启动后 TaskRun 必须冻结：

```text
taskVersionId
agentVersionId
releaseId
runtimeProviderId
ruleVersionId
dataSnapshotId
runtimeBindingSnapshot
```

运行中即使：

```text
Agent 再发布
Provider 配置改变
Task 被修改
```

本次 TaskRun 也不得漂移。

---

# 41. TaskRun → Interaction Run

POC 保持现有系统定义：

```text
TaskRun = 一个批次
Run = 一条用例 / 一条 Interaction
```

现有 TaskRunner 本身就是：

> TaskRun=批次，Run=单条 Interaction。

例如选择 20 条用例：

```text
TaskRun
   │
   ├── Run 01
   ├── Run 02
   ├── Run 03
   ├── ...
   └── Run 20
```

不是：

```text
20 条用例
→ 塞给一个 Agent Run
```

---

# 42. Runtime Request

每个 Interaction Run 继续通过：

```text
server/app/runtime_providers/dispatcher.py
```

构建：

```text
RuntimeExecuteRequest
```

对于 Module Agent，Spec 必须来自冻结 AgentVersion：

```text
instructions
model
tools
master_data
output_schema
```

当前 dispatcher 已经保证同一个 AgentVersion 发给不同 Provider 的 Contract Spec 一致。

因此不得做：

```text
OpenAI Provider 特殊改 Prompt
OpenAI Provider 特殊换 Tool
OpenAI Provider 特殊换 Output Schema
```

否则 Provider 比较失去意义。

---

# 43. 完整执行链

最终真实链路：

```text
用户点击运行
      │
      ▼
AnalysisTask
      │
      ▼
TaskVersion
      │
      ▼
TaskRun
      │
      ▼
DataSnapshot
      │
      ▼
Existing Use Cases
      │
      ▼
Interaction Run
      │
      ▼
build_runtime_request()
      │
      ▼
RuntimeGatewayClient
      │
POST /v1/runs
      │
      ▼
OpenAI Agents Runtime :8303
      │
      ▼
native_quality_v0.2
      │
      ├── identify Agent
      │
      ├── dynamic plan
      │
      ├── N evaluator Agents
      │      │
      │      └── Tool Gateway
      │
      ├── barrier
      │
      └── synthesize Agent
      │
      ▼
RuntimeRun
      │
GET /v1/runs/{id}
      │
      ▼
MoreThanCorn Worker
      │
      ▼
Schema Validation
      │
      ▼
Run.output
      │
      ▼
Run Detail
```

---

# 44. Run 状态

至少支持：

```text
queued
running
succeeded
failed
cancelled
```

对应现有 Contract。

不得出现 OpenAI 专属状态：

```text
thinking
reasoning
tool_wait
agent_done
```

作为平台 Run.status。

这些细节属于：

```text
TraceEvent
```

---

# 45. Run.output

POC 成功 Run 必须：

```text
Run.status = succeeded
Run.output != null
```

并且：

```text
Run.output
```

通过当前 `quality_output.schema.json`。

不能只把 final text：

```text
"坐席总体表现良好"
```

写入 output。

必须返回结构化领域结果。

---

# 46. Run Detail 是本次 POC 的最终验收页面

用户最终必须能通过：

```text
Task
→ TaskRun
→ Interaction Run
→ Run Detail
```

看到一个真实 OpenAI Agent Run。

至少需要展示：

### 基本信息

```text
Run ID
Task ID
TaskRun ID
Interaction Ref
Status
Started At
Finished At
Duration
```

### 冻结版本

```text
Agent
Agent Version
Module
Module Version
Rule Version
```

### Runtime

```text
Provider = openai-agents
Runtime Version = 0.22.0
Adapter Version = 0.1.0
```

### Input

```text
本条用例实际输入
```

### Output

```text
完整结构化 Run.output
```

### Stages

```text
identify
plan
execute/*
barrier
synthesize
```

### Calls

```text
Model Calls
Tool Calls
```

### Usage

```text
input tokens
output tokens
total tokens
model calls
tool calls
```

### Evidence

如存在：

```text
knowledge evidence
ticket evidence
sms evidence
appointment evidence
```

### Error

失败时：

```text
error.code
error.message
retryable
```

---

# 47. Run Detail 不依赖 OpenAI Dashboard

POC 验收不得要求用户：

```text
打开 OpenAI Dashboard
才能知道 Agent 做了什么
```

OpenAI Dashboard tracing 可以作为开发调试辅助，但：

```text
MoreThanCorn Run Detail
```

必须独立完成平台可观测。

---

# 48. 前端 POC 要求

本次原则是**最小修改**。

如果当前 Task Wizard 已经支持：

```text
Agent Target
Data Asset
Version Policy
Rule
```

则只需确认 OpenAI Provider Release 可正常被选择。

Provider 不应该直接出现在 Task 创建步骤。

正确关系：

```text
Task
    → Agent

Agent Release
    → Runtime Provider
```

---

# 49. Task Detail

任务详情至少显示：

```text
Execution Target
Agent
Agent Version Policy
Input
Rule
Output Mode
```

以及 TaskRun 列表。

点击 TaskRun 后进入批次详情。

---

# 50. TaskRun Detail

至少显示：

```text
total
queued
running
succeeded
failed

resolved AgentVersion
resolved Release
resolved Runtime Provider
```

以及 Interaction Run 分页列表。

---

# 51. POC 最低真实用例覆盖

从已有用例库选取 POC Set。

必须包含下列行为类别，而不是按固定数量凑样本：

### Case A：纯理解

不需要 Tool。

验证：

```text
Agent basic structured output
```

### Case B：知识核验

必须产生：

```text
knowledge_search
```

### Case C：承诺履约

必须产生至少一种：

```text
ticket_query
sms_query
appointment_query
```

### Case D：多事项电话

同一 Interaction 中存在多个：

```text
knowledge claims
and/or
promises
```

必须形成动态 fan-out。

### Case E：证据不足

必须允许：

```text
insufficient_evidence
```

而不是强制猜答案。

### Case F：错误场景

人为制造：

```text
模型错误
Tool 错误
或 Schema 错误
```

验证 Run 真实进入 failed。

---

# 52. 用例库 expected 的使用

完成所有 Runs 后才执行：

```text
Actual
vs
Expected
```

如果现有用例库已有 Expected：

POC 验收可以生成：

```text
caseId
expected
actual
matched
difference
runId
```

但这属于：

```text
POC evaluation report
```

而不是 Runtime 输入。

---

# 53. POC 的两个验收维度

必须区分：

## A. 工程链路成功

验证：

```text
平台是否真的完整跑通
```

## B. 业务效果

验证：

```text
OpenAI Agents SDK 跑出来的结果是否合理
```

不能混为一谈。

例如：

```text
20 条全部 succeeded
```

只能证明链路成功。

不能证明：

```text
20 条判断全正确
```

---

# 54. 工程 POC 验收门禁

以下全部满足才为 PASS。

### POC-G01 Provider

平台能够创建：

```text
kind=openai-agents
```

Provider。

---

### POC-G02 Health

Provider health 为真实检查。

---

### POC-G03 Module Compatibility

`quality-analysis` 显示支持：

```text
openai-agents
```

---

### POC-G04 Agent Release

Agent 可以发布 sandbox Release，并绑定 OpenAI Runtime。

---

### POC-G05 Existing Use Case

POC 数据来自已有用例库。

禁止 Fake Dataset 替代。

---

### POC-G06 Task

从平台正常创建一条：

```text
executionTarget=agent
```

Analysis Task。

---

### POC-G07 TaskRun

用户点击运行后真实产生：

```text
TaskRun
```

---

### POC-G08 Interaction Runs

TaskRun 根据选择的用例真实生成 N 条：

```text
Run
```

---

### POC-G09 Runtime

这些 Runs 的：

```text
runtimeProviderId
```

实际指向 OpenAI Agents Provider。

---

### POC-G10 Real Model

至少一次真实模型请求成功。

Fake model 不算最终验收。

---

### POC-G11 Tool

需要 Tool 的 Case 发生真实 Tool Call。

---

### POC-G12 Hard Allowlist

未声明的 Tool 不能被 OpenAI Agent 调用。

必须有自动测试证明。

---

### POC-G13 Dynamic Fan-out

多事项 Case 产生多个 evaluation execution plan。

---

### POC-G14 Structured Output

所有 succeeded Run：

```text
output != null
```

且 Schema 合法。

---

### POC-G15 Trace

Run Detail 能看到真实 Stage / Model / Tool Trace。

---

### POC-G16 Usage

Run Detail 能看到 Provider 实际可获得的 Usage。

---

### POC-G17 Error

至少验证一次失败 Run，错误码和错误原因正确。

---

### POC-G18 Isolation

用例 expected 不进入 Runtime Request。

---

### POC-G19 Security

Secret 不出现在：

```text
Run.input
Run.output
Trace
日志
API DTO
```

---

### POC-G20 UI

完整链路必须可通过正常平台页面完成：

```text
配置 Task
→ Run
→ 看 Run Result
```

不允许最终验收依赖：

```text
curl
直接 SQL
单独 Python Script
```

这些只能作为开发调试手段。

---

# 55. Contract Tests

新增 OpenAI Runtime Contract 测试。

必须覆盖：

```text
GET /health

POST /v1/runs

GET /v1/runs/{id}

POST /v1/runs/{id}/cancel
```

以及：

```text
same idempotency key + same body
→ reuse

same idempotency key + different body
→ conflict

wrong run_id
→ reject

timeout
→ TIMEOUT

invalid final output
→ OUTPUT_SCHEMA_ERROR
```

---

# 56. Tool Tests

必须覆盖：

```text
request tools=[]
→ Agent tools=[]

request tools=[knowledge_search]
stage allowed=[knowledge_search]
→ knowledge_search only

request tools=[knowledge_search,ticket_query]
stage allowed=[knowledge_search]
→ knowledge_search only
```

以及反例：

```text
Agent 尝试 ticket_query
但 current stage 未授权
→ impossible / rejected
```

不能只测试 Prompt 文本。

---

# 57. Workflow Tests

必须至少验证：

```text
0 knowledge + 0 promise

1 knowledge

N knowledge

1 promise

N promise

knowledge + promise mixed

tool error

missing structured output

barrier failure

successful synthesis
```

---

# 58. Platform Integration Test

后端集成测试至少创建：

```text
RuntimeProvider
Agent
AgentVersion
Release
DataAsset / Use Case Binding
AnalysisTask
TaskVersion
TaskRun
Run
```

然后验证：

```text
Run.runtime_provider_id == openai provider
```

以及：

```text
Run.status == succeeded
Run.output != null
```

---

# 59. Real E2E POC

自动测试全部通过后，执行真实 E2E。

必须使用：

```text
真实 MoreThanCorn API
真实数据库
真实 OpenAI Agents Runtime
真实模型 endpoint
真实 Tool Service
已有用例库
```

整个流程：

```text
1. 启动 platform backend
2. 启动 worker
3. 启动 tool service
4. 启动 openai-agents runtime :8303
5. Provider health probe
6. 创建/确认 Agent Version
7. 发布 sandbox Release
8. 创建 POC Task
9. 选择已有用例
10. 点击 Run
11. 等待 TaskRun terminal
12. 打开 TaskRun
13. 打开 Interaction Run
14. 检查 output
15. 检查 stages
16. 检查 calls
17. 检查 usage
18. 检查 evidence
19. 检查失败用例
20. 输出 POC 验收报告
```

---

# 60. POC 验收报告

最终新增：

```text
docs/sdd/acceptance/
14-openai-agents-runtime-poc-acceptance.md
```

报告至少包含：

```text
Commit SHA

OpenAI Agents SDK Version

Runtime Adapter Version

Model Endpoint
Model ID
不记录 API Key

Provider ID

Agent ID
Agent Version ID
Release ID

Task ID
Task Version ID
TaskRun ID

Selected Use Case Count

Succeeded
Failed

Model Calls
Tool Calls

Token Usage

每条 Use Case:
    Use Case ID
    Run ID
    Status
    Expected
    Actual
    Match / Difference

失败列表

已知限制
```

---

# 61. 安全要求

## 61.1 Secret

Secret 只能来自：

```text
env
secret manager
Connection
```

禁止进入 Git。

---

## 61.2 Remote Trace

默认：

```text
OpenAI SDK remote tracing = disabled
```

因为 SDK tracing 默认开启，而且可以携带模型与 Tool 输入输出。

未来若要启用必须单独设计：

```text
脱敏
数据分类
trace export policy
```

不属于本 POC。

---

## 61.3 Egress

继续遵守现有 MoreThanCorn Egress Policy。

OpenAI Runtime 不得因为接入模型：

```text
关闭 SSRF 防护
允许任意 URL
```

---

## 61.4 Tool Side Effect

当前 `quality-analysis` 为：

```text
riskClass: read-only
```

所以 POC 只能使用查询工具。

不得在本次 POC 中增加：

```text
真正创建工单
真正发短信
真正改预约
```

Tool 是：

```text
query / verify
```

不是：

```text
execute business action
```

---

# 62. 性能边界

POC 不做正式容量承诺。

但记录：

```text
每 Run 总耗时
每 Stage 耗时
model_calls
tool_calls
tokens
```

必须能观察：

```text
P50
P95
```

现有 Runtime Provider metrics 已经有聚合端点，可继续复用。

---

# 63. Timeout

继续使用：

```text
RuntimeExecuteRequest.timeout_seconds
```

当前 Module 默认：

```text
300 秒
```

如果实际真实 POC 证明质量 Workflow 稳定超过 300 秒：

不能悄悄改成无限。

需在验收报告中给出：

```text
哪个 Stage
哪个 Tool
为什么慢
```

再决定是否提高 Module policy。

---

# 64. Retry

允许：

```text
Provider 网络错误
502
503
504
```

沿用 Gateway 有界 retry。

不得对一个：

```text
已经成功执行 Tool 的业务 Run
```

无脑重新运行整个 Agent。

本 POC 的 Tool 均为 read-only，因此风险有限，但幂等语义仍保持。

---

# 65. Cancellation

公共 Runtime Service 已实现：

```text
POST /v1/runs/{id}/cancel
```

OpenAI Adapter：

```text
cancel()
```

需要取消当前 asyncio Runner Task。

POC 不要求：

```text
进程重启后恢复被取消中的 Agent
```

这属于生产 Durable Runtime 后续范围。

---

# 66. 代码修改清单

## 新增

```text
runtimes/openai_agents/
```

完整 Runtime。

---

## 修改

```text
server/app/runtime_providers/registry.py
```

增加：

```text
openai-agents
```

---

## 修改

```text
server/app/agent_modules/
quality_analysis/manifest.yaml
```

增加 OpenAI implementation。

---

## 可能新增

如果现有用例库不是 DataAsset：

```text
server/app/data_readers/eval_samples.py
```

仅增加 Reader Adapter。

不得新增数据库表。

---

## 修改测试

增加：

```text
Provider Registry
Module Compatibility
Release Binding
Task E2E
Run Detail
```

相关测试。

---

## 不修改

原则上不要为了本次 POC 修改：

```text
packages/runtime_contract/
```

除非实现过程中发现现有 Contract 无法表达一个所有 Provider 都需要的通用能力。

任何 Contract 修改必须单独说明原因。

---

# 67. 禁止实现

开发过程中明确禁止以下捷径。

禁止：

```text
OpenAI SDK 直接写在 server/app
```

禁止：

```text
TaskRunner if provider == openai
```

禁止：

```text
OpenAI 专属 Run 表
```

禁止：

```text
OpenAI 专属 Result 表
```

禁止：

```text
OpenAI 专属 Tool Registry
```

禁止：

```text
为 OpenAI 修改 quality output schema
```

禁止：

```text
为跑通测试使用固定假答案
```

禁止：

```text
expected 注入 Agent prompt
```

禁止：

```text
没有 Tool Call 却伪造 Tool Trace
```

禁止：

```text
Runtime 失败后硬编码返回 succeeded
```

禁止：

```text
只跑独立 Python Script 即宣布 POC 完成
```

---

# 68. 推荐实施顺序

## Phase OAI-R0：SDK Adapter

完成：

```text
runtimes/openai_agents
RuntimeAdapter
model adapter
health
basic Agent
structured output
```

门禁：

```text
Provider Contract tests PASS
```

---

## Phase OAI-R1：Tools

完成：

```text
ToolRef
→ hard allowlist
→ FunctionTool
→ existing Tool Gateway
```

门禁：

```text
Tool isolation tests PASS
```

---

## Phase OAI-R2：Quality Native Workflow

完成：

```text
identify
plan
dynamic fan-out
execute
barrier
synthesize
```

门禁：

```text
native workflow tests PASS
```

---

## Phase OAI-R3：Platform Binding

完成：

```text
Provider Registry
Module Manifest
Agent Release
Provider Binding
```

门禁：

```text
Module Agent → OpenAI Provider Run PASS
```

---

## Phase OAI-R4：Task E2E

完成：

```text
Existing Use Case Library
→ Analysis Task
→ TaskRun
→ Interaction Runs
→ OpenAI Runtime
→ Run.output
```

门禁：

```text
完整 Task 链路 PASS
```

---

## Phase OAI-R5：UI Acceptance

完成：

```text
Task 页面
→ 手工 Run
→ TaskRun
→ Run Detail
```

最终由用户从浏览器完成验收。

---

# 69. POC 最终 Definition of Done

本 POC 的 DoD 只有一句话：

> 用户能够在 MoreThanCorn 中使用已有用例库配置一个完整的 Agent Analysis Task；该 Task 绑定一个发布到 OpenAI Agents Runtime Provider 的 `quality-analysis` Agent；用户点击运行后系统创建真实 TaskRun，并为选择的每条用例创建真实 Interaction Run；这些 Run 由 OpenAI Agents SDK 使用真实模型与受控企业 Tools 完成动态多事项质检，并将符合现有 Output Schema 的结果写入 `Run.output`；用户最终可以从 MoreThanCorn 的 TaskRun / Run Detail 页面查看每条 Run 的结构化结果、执行阶段、Model Calls、Tool Calls、Usage、Evidence 和真实错误信息。

以下情况均不算完成：

```text
SDK Hello World 成功
Provider /health 成功
直接 POST /v1/runs 成功
单独 Python POC 成功
Agent 配置页 Test 成功
Fake Provider 成功
后台接口能拿到 output 但平台页面看不到
```

最终验收路径必须是：

```text
已有用例库
    ↓
配置完整 Task
    ↓
点击 Run
    ↓
看到 TaskRun
    ↓
看到 Interaction Runs
    ↓
进入某条 Run
    ↓
看到 OpenAI Agents SDK 真正跑出来的完整结果
```

---

# 70. 本 SDD 与现有 SDD 的关系

本 SDD 不替代现有：

```text
09 Production Readiness
10 Domain Agent Runtime Provider
13 Task Output Delivery & Run Center
```

关系为：

```text
09
定义平台生产级总体门禁

10
定义 Module Agent + Runtime Provider 总体架构

14（本文）
定义 OpenAI Agents SDK 第三个 Provider
以及完整端到端 POC

13
定义 POC 之后的
Run.output → ResultDelivery → Target Table
与运行中心产品化
```

执行顺序说明（2026-09-02 更新）：SDD-13 已于 2026-09-02 验收通过并合入 main，因此本 SDD（14）直接基于含 13 成果的 main 实施，与 13 不存在先后阻塞关系；本 POC 以 `platform_only` 模式复用 13 已交付的 `Run.output` / Run Detail / 运行中心能力。后续若需要把 OpenAI Runtime 的结果投递到目标表，继续沿用 13 的 ResultDelivery 机制，不在本 POC 范围内。

---

# 71. 最终架构冻结

本次完成后 MoreThanCorn 应达到：

```text
                           MoreThanCorn
                                │
                         Analysis Task
                                │
                             TaskRun
                                │
                     N × Interaction Run
                                │
                         Agent Version
                                │
                            Release
                                │
                       Runtime Provider
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
             ▼                  ▼                  ▼
        AgentScope           DSH             OpenAI Agents
             │                  │                  │
             │                  │             Agents SDK
             │                  │                  │
             └──────────────────┼──────────────────┘
                                │
                    quality-runtime-contract
                                │
                    ┌───────────┴────────────┐
                    │                        │
                    ▼                        ▼
                  Tools                Structured Output
                    │                        │
                    └───────────┬────────────┘
                                │
                                ▼
                            Run.output
                                │
                                ▼
                           Run Detail
```

**平台拥有 Task、Run、Version、Evidence、Result。**

**Runtime Provider 拥有执行框架。**

**OpenAI Agents SDK 只是 Runtime 实现之一。**

这个边界不得因为 POC 方便而破坏。
