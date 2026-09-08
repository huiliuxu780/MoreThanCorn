# 11 · AgentScope 全量接线总体方案

> 日期：2026-09-08
> 版本：v5.1（双向编排与声明式 Pipeline 补充版）
> 状态：设计稿；本轮只改文档，不改业务代码
> 审计依据：research/morethancorn/09-agentscope-plan-audit/AUDIT-REPORT.md
> AgentScope 基线：**2.0.8-dev@ff8697ec4d59ee01f3766176e70cb24ee894d6c6**；PyPI 尚无 2.0.8 发布物

## 0. 结论与开工状态

项目继续以 AgentScope 作为唯一 Agent 运行底座，但“全面拥抱 AgentScope”不等于把 AgentScope App 服务器原样搬进平台，也不等于把现有三套配置源继续转译下去。

目标是：

1. 平台只有一个用户可见的 Agent 根资产、一个草稿模型、一个 AgentVersion、一个原子 Release 闭包；
2. Chat、单次结构化执行、声明式固定 Pipeline、Planning 都经 AgentScope Runtime；
3. Task、Trigger、Batch 只负责何时、对哪些输入发起 Run，不再拥有第二套 Agent 执行逻辑；
4. Skill、Tool、Knowledge、Workflow 只有挂载成功、版本冻结、Runtime 消费三者同时成立，UI 才能显示“已生效”；
5. 内部 Agent 角色默认属于一个方案版本，不要求每个角色都成为平台顶层 Agent；
6. 声明式固定 Pipeline 必须支持失败子项选择性重做、独立核验、检查点、状态持久化与重启恢复。

**开工状态：冻结。** 原 v4.1 的“15 点全部拍板、方案冻结”已经失效。P0 只做未提交工作区归属、AgentScope commit/lock 方案和跨边界合约测试设计；G0 通过前不得实施新配置页，也不得继续把现有 native_workflow.py POC 堆成生产骨架。

## 0.1 北极星业务故事

### 故事 A：固定质量流水线

用户选择一个内置质检、审计或工单核验方案。平台展示其固定核心拓扑和可扩展槽位。一个根 Run 内完成场景识别、子项分派、并行核验、逐项独立验证、失败子项选择性重做、汇总和最终核验。用户只看到一个 Agent 方案，不需要管理一堆顶层 Agent。

### 故事 B：计划型 Agent

用户创建或派生一个 Agent，配置角色、模型、Skill、Tool、Knowledge 和治理限制。AgentScope TaskContext 和 Planning tools 用于一次 Run 内的任务拆解与状态维护。平台 Task/TaskRun 仍是外层业务调度，不与 AgentScope 内部计划任务合表。

### 故事 C：连续对话

用户在一个 Session 中与同一个 AgentVersion 多轮对话；每一轮产生一个 Run。AgentScope AgentState 被持久化并可恢复，Skill 正文、工具、知识和附件内容真正进入上下文与工具链，而不是只展示名称。

### 故事 D：批量与自动任务

用户把 AgentVersion 绑定到 Task。Trigger 可以即时、定时、事件触发或 API 触发；batching 可以逐条、窗口攒批或手动冲刷。一个 TaskRun 包含 N 个 Run。批量只是调度和输入集合，不是另一种 Agent。

## 1. 现状事实

### 1.1 后端实体

当前已存在：

- Agent：type、module_key/version、workflow_id、任意 JSON config、config_revision、沙箱/生产版本指针；
- AgentVersion：definition、common_config、dependency_snapshot、artifact_hash；
- Release：AgentVersion 到环境的部署，并绑定 Runtime Provider/Profile/Snapshot；
- Run、NodeRun、RunEvent、CallRecord；
- AgentChatSession、AgentChatMessage；
- SkillResource、AgentSkill、AgentMemory/Revision；
- Tool/ToolVersion、Workflow/WorkflowVersion、KnowledgeSource。

问题不在“没有表”，而在边界：

- Custom、Module、旧 Agent 的 definition 组装规则不同；
- Skill 同时存在 config.skills 和 AgentSkill 两条写路径；
- Workflow、Knowledge、Connection 工作区挂载只写 config；
- Module 的核心资源由 manifest 冻结，页面扩展不进入 Runtime 或 Release；
- Skill 与 Knowledge 原地可变，没有可冻结版本；
- Runtime Contract v1.0 没有 roles、mounts、pipeline、planning、session_state 或 continuation_state。

### 1.2 当前执行路径

| 入口 | 当前路径 | 结论 |
|---|---|---|
| Module 结构化 Run | AgentVersion/草稿 → dispatcher → Runtime Provider | 主链存在，但只带核心 AgentSpec |
| Custom 结构化 Run | 无可发布 definition | 不成立 |
| Chat | 平台 agent_chat → 本地模型调用 | 绕过 AgentScope Runtime |
| Skill | Chat 只读 AgentSkill 名称；Module 不读页面 Skill | 假接线 |
| Knowledge/Workflow/Connection 挂载 | 只写 config | Module/Custom 新主链不消费 |
| Workflow → Agent | 旧 agent 三类节点已 deprecated，并迁移为 workflow 三类节点 | 不能代表 Workflow 已可调度新版 AgentVersion |
| Agent → Workflow | 工作区只保存 Workflow ID；Runtime 无 list/run workflow 工具 | 尚未接通 |
| native quality workflow | metadata 名称平台为 workflowMode、adapter 检查 workflow_mode | 真实请求不进入 POC 分支 |

### 1.3 当前前端

前端已经不是 05/08 号稿描述的旧页面，而是：

- Agent 卡片列表；
- 内置 Module 模板和 Custom 创建；
- 九子页工作区：概览、任务看板、记忆、Skill、连接器、Wakerflow、知识库、配置、发布治理；
- 独立 Chat 工作区；
- Module 配置与试跑；
- 版本、Release、评测和 Golden Set。

但 UI 当前把“可以保存”错误地当成“运行会生效”。最明显的例子是 Module Skill 安装、Connection/Workflow/Knowledge 挂载，以及 Custom 创建时的 Skill 选择。

## 2. 权威概念模型

### 2.1 Agent 是方案根，不是某个 Python 对象

Agent 表示用户可识别、可配置、可评测、可发布、可触发的完整能力方案。AgentVersion 是其不可变可执行版本，Release 是某一版本在某环境上的运行绑定。

Agent 有两个正交维度：

1. runner.kind：agent 或 pipeline；
2. planning.enabled：是否允许某个 Agent/内部角色使用 AgentScope Planning。

因此不存在“Pipeline 与 Planning 永远二选一”的数据约束：

- 方案 A：runner.kind=pipeline；其某个执行角色可 planning.enabled=true；
- 方案 B：runner.kind=agent；planning.enabled=true；
- 普通对话 Agent：runner.kind=agent；planning.enabled 可开可关。

### 2.2 内部角色

固定 Pipeline 内的 dispatcher、executor、unit verifier、synthesizer、final verifier 首期作为 AgentVersion 内嵌 RoleVersion：

- 有稳定 role_key；
- 有 system prompt/instructions；
- 有 model policy；
- 有 tool/skill/knowledge slots；
- 有 planning policy；
- 有输出 Schema；
- 随 AgentVersion 原子冻结。

只有当某个角色需要被多个方案复用、独立授权、独立评测、独立发布或被用户直接对话时，才提升为顶层 Agent 资产。不能为了“多 Agent”把每个内部角色都做成平台员工卡。

### 2.3 Core 与 Extension

内置方案包含不可变 Core：

- Pipeline 拓扑和控制器版本；
- 核心角色及其职责边界；
- 必需 Tool/Skill/Knowledge；
- 输入/输出 Schema；
- barrier、retry、timeout、permission、final verification 策略。

实例只在声明的 extension slots 中增加或替换资源。修改 Core 不允许原地覆盖，而是：

1. Fork/派生方案；
2. 生成新的 Module/Template 版本；
3. 重新评测；
4. 生成新的 AgentVersion 和 Release。

### 2.4 MountBinding

Skill、Tool、Knowledge、Workflow 统一为 MountBinding 草稿记录，字段至少包括：

| 字段 | 含义 |
|---|---|
| resource_type/id | 资源身份 |
| version_policy | 草稿可 latest；发布必须 pinned/snapshot |
| pinned_version_id | ToolVersion、WorkflowVersion、SkillVersion、KnowledgeSnapshot |
| scope | global、stage 或 role |
| scope_key | stage_key/role_key |
| slot_key | 内置方案允许扩展的位置 |
| source | core 或 extension |
| enabled | 草稿启停 |

Connection 不作为与 Skill 并列的自由能力。它是 Tool、MCP、Knowledge、Model Provider 的凭据和环境依赖，应通过依赖闭包间接进入 Release。

### 2.5 Session、Run 与 Continuation

- Run 是每一次执行事实，所有执行都有；
- Chat Session 只管理多轮对话身份、消息与 AgentState；
- Chat 每一 turn 是一个 Run；
- 无状态单次任务只有 Run，不创建 Session；
- Pipeline/HITL 暂停恢复使用 ExecutionState/Continuation，不伪装成 Chat Session；
- TaskRun 是批量/自动任务的一次外层调度，包含 N 个 Run。

### 2.6 PromptBundle：借鉴 BIBLE / IDENTITY / PERSONA，但不照搬文件名

AgentVersion 的提示上下文拆为有顺序、有来源、有 hash 的 PromptBundle：

1. platform policy：安全、权限、数据边界；属于硬约束的提示说明，但真正强制仍在代码/网关；
2. identity：这个 Agent 是谁、负责什么、不负责什么；
3. playbook：工作手册/方法论，对应目标产品 BIBLE 的价值；
4. persona：面向用户的语言、格式和交互风格；
5. runtime context：本次输入、Session 摘要、Knowledge、Skill 和 Tool 描述。

playbook/BIBLE 是 LLM 软约束，不能承担权限、版本固定、barrier、retry、幂等或最终状态。专项方法优先成为可复用 Skill；只有方案级、始终生效的工作手册才进入 playbook，避免所有知识都堆进 system prompt。

### 2.7 Workflow 与 Agent 双向组合

平台支持两个方向，但使用同一子运行与依赖治理：

1. **Agent → WorkflowVersion**：AgentScope Agent 只看到授权 MountBinding 暴露的 `list_workflows/run_workflow` 工具；调用后平台创建子 Run，固定 WorkflowVersion、输入/输出 Schema、预算和 trace；
2. **WorkflowVersion → AgentVersion**：平台 Workflow 提供通用 `agent-run` 节点，调用已发布 AgentVersion 并等待或异步接收结构化结果；不再把 Agent 暗中改写成底层 Workflow。

双向组合不表示无条件互调：

- 草稿可以选择 latest 预览，发布/运行必须解析到不可变版本；
- list 只返回当前 role/slot/环境有权调用的资源，不暴露全平台清单；
- 根 Run 维护跨 `workflow/agent` 的 InvocationGraph，在当前活动祖先链上以 `(resource_type, version_id)` 做环检测，并限制深度、总子 Run、模型/工具预算；同一资源的合法串行/兄弟调用不能被误判为递归；
- 子 Run 继承 trace、权限上限和取消信号，但有独立状态、事件和幂等键；
- Agent 调 Workflow 不绕过 Workflow 节点治理，Workflow 调 Agent 不绕过 Agent Release/Runtime；
- 默认不因子调用创建 Chat Session。

AgentScope Pipeline 是 AgentVersion 内部运行拓扑；平台 Workflow 是可独立版本、触发和组合的业务流程资产。二者允许互相调用，但不合表。

## 3. AgentScope 2.0.8-dev 的采用边界

### 3.1 已证实

官方当前提供：

- PipelineProtocol：用 reply_stream 接收 Msg、确认结果、中断、外部执行结果并产生 AgentEvent 或 Msg；
- GoalPipeline：一个 executor 与一个 verifier 循环；
- AgentState：session_id、summary、context、reply_context、permission_context、tool_context、tasks_context、middle_context；
- AgentScope App：Storage、MessageBus、Workspace、ChatService、Skill/MCP/Knowledge、Scheduler 等完整应用层。

### 3.2 不能错误推导

- PipelineProtocol 能传给 console，不代表 create_app/ChatService 已经原生持久化任意 Pipeline；
- GoalPipeline 有 verifier，不代表支持 dispatcher/fan-out/barrier；
- 同一进程实例能恢复 HITL，不代表进程重启可恢复；
- 2.0.8-dev 文件中的构造参数不代表全部实现完成；
- AgentScope App 有 Skill/Knowledge/Scheduler，不代表平台必须把应用层控制面和数据模型整体替换掉。

### 3.3 本项目的采用方式

1. Runtime 独立进程继续是边界；平台进程不 import AgentScope；
2. 使用 AgentScope Agent、AgentState、TaskContext、Skill、Toolkit、事件与模型适配；
3. 方案 A 的 QualityPipeline 实现 PipelineProtocol；
4. 不直接采用 GoalPipeline 作为质检骨架；
5. 不直接挂载完整 create_app 取代平台 API；可以复用其实现思想和必要组件；
6. 2.0.8 正式发布前只做隔离 spike，固定完整 commit 和锁文件；正式发布后再过升级门。

官方证据：

- https://pypi.org/project/agentscope/
- https://github.com/agentscope-ai/agentscope/blob/ff8697ec4d59ee01f3766176e70cb24ee894d6c6/src/agentscope/pipeline/_base.py
- https://github.com/agentscope-ai/agentscope/blob/ff8697ec4d59ee01f3766176e70cb24ee894d6c6/src/agentscope/pipeline/_goal_pipeline.py
- https://github.com/agentscope-ai/agentscope/tree/ff8697ec4d59ee01f3766176e70cb24ee894d6c6/examples/pipeline/goal

## 4. 方案 A：QualityPipeline

### 4.1 声明式 Core 与固定治理内核

QualityPipeline 不是把 `classify/dispatch/...` 阶段名和 prompt 写死在 Python。ModuleVersion 冻结一个可校验的 PipelineDefinition，声明 stages、edges、roles、Schema、mount slots、并发、retry/barrier 和 final verification policy。首个质检模板采用 §4.2 的阶段，但其他审计/工单方案可用不同声明或派生版本。

Runtime 中写死的是通用治理不变量，而不是具体业务 SOP：

以下属于代码控制器，不是 Agent：

- stage progression；
- bounded fan-out；
- barrier；
- timeout/cancel；
- retry budget；
- checkpoint；
- idempotency；
- permission enforcement；
- structured Schema validation；
- selective redo routing；
- terminal status synthesis。

不要让 LLM 决定这些治理事实。PipelineDefinition 也不能覆盖平台的深度上限、权限上限、幂等、checkpoint 原子性和终态合法性。

### 4.2 角色与阶段

| 阶段 | 角色 | 输出 | 是否可 Planning |
|---|---|---|---|
| classify | classifier/dispatcher | 场景、units、所需核验类型 | 否 |
| dispatch | 控制器 | 固定 unit IDs、角色/工具策略 | 不适用 |
| execute | N 个 unit executor | UnitResult | 可按 role 开启 |
| unit_verify | 独立 verifier | pass/fail/retryable/feedback | 否 |
| barrier | 控制器 | 完整性与失败策略 | 不适用 |
| synthesize | synthesizer | 结构化汇总 | 否 |
| final_verify | 独立 final verifier | pass/failedUnitIds/synthesisError | 否 |

executor 不能兼任自己的 verifier；首个 dispatcher 也不应无条件成为最终 verifier。

### 4.3 选择性重做

每个 unit 有稳定 unit_key 和独立 attempt：

1. unit executor 产生结构化结果；
2. unit verifier 独立核验；
3. pass 后结果冻结；
4. fail 且 retryable 时，只给该 unit 新 attempt，并携带 verifier feedback；
5. 兄弟 unit 的结果、调用记录和预算不变；
6. 达到上限则标记 exhausted，由 barrier 决定整体失败或部分结果；
7. final verifier 必须返回失败 unit keys 或 synthesisError；
8. 前者只重开指定 units，后者只重做 synthesize；
9. 不允许 final verifier 用一句模糊 fail 导致整条流水线重跑。

### 4.4 PipelineState

持久状态至少包含：

- pipeline_definition_version；
- current_stage；
- input_snapshot_ref；
- units 及依赖；
- 每个 unit 的 attempts、状态、结果引用、verdict、feedback；
- frozen passed results；
- remaining model/tool/retry/time budgets；
- parked reply_id 与等待类型；
- checkpoint sequence；
- synthesis/final verification 尝试；
- terminal reason。

每次状态变更先落平台状态与事件，再进行下一外部调用。恢复必须幂等。

### 4.5 当前 POC 的处置

runtimes/agentscope/app/native_workflow.py 只证明：

- 阶段推进；
- 工具白名单；
- bounded parallel；
- barrier；
- 结构化输出。

它没有独立 verifier、选择性重做和可持久化 PipelineState，而且包含 fixture 专用检索轮数和路由器保修提示。处置为：

- 冻结为 POC 证据；
- 保留和改写行为测试；
- 不作为生产类继承或继续叠补丁；
- metadata camelCase/snake_case 断链单独由 G0 修复和集成测试覆盖。

## 5. 方案 B：Planning Agent

方案 B 是 runner.kind=agent 且 planning.enabled=true：

1. Runtime 从已发布 AgentVersion 构造 AgentScope Agent；
2. TaskContext 与 Planning tools 管理一次 Run 内的内部任务；
3. Tool、Skill、Knowledge 按 MountBinding 装配；
4. 工具副作用仍经平台 Gateway 和 Permission Policy；
5. state_updated 等 AgentScope 事件映射为平台 RunEvent；
6. Run 完成后保留计划快照用于审计；
7. 若需要跨 turn 继续，由 Chat Session/AgentState 承接；
8. 若是无状态一次性任务，Run 结束即终止，不额外创建 Session。

AgentScope 内部 Task 不是平台 AnalysisTask，也不是自动任务。前者是一次推理过程状态，后者是可版本化、可触发、可批量的业务调度实体。

## 6. Runtime Contract v1.2

### 6.1 请求

在 v1.0 的 agent、model、tools、master_data、output_schema 基础上增加：

- execution：runner kind、pipeline definition ref、planning policy；
- prompt_bundle：identity、playbook、persona 的已编译内容、来源和 hash；
- roles：内嵌 RoleVersion；
- mounts：已解析并冻结的 Skill、Tool、Knowledge、Workflow；
- invocation：parent/root run、目标版本、调用来源、模式、幂等键和剩余总预算；
- policies：权限、预算、超时、并发、retry、barrier；
- state：chat AgentState 或 PipelineState 的版本化引用/载荷；
- continuation：确认、外部执行结果、中断；
- expected event schema version。

### 6.2 状态

根 Run 状态保留 queued、running、succeeded、failed、cancelled，并增加控制态 waiting_input、paused 的平台语义。Runtime Provider 的内部状态不能只存在内存。

### 6.3 事件

统一事件前缀：

- run.started/completed/failed/cancelled；
- invocation.started/completed/failed/blocked_cycle；
- reply.started/text.delta/thinking.delta/completed；
- tool.started/completed/failed/waiting_confirmation；
- task.created/updated；
- pipeline.stage.started/completed/failed；
- pipeline.unit.started/completed/verification_failed/retrying/exhausted；
- pipeline.barrier.passed/blocked；
- pipeline.checkpoint.saved/restored；
- pipeline.waiting/resumed；
- pipeline.final_verdict。

每个事件必须有 sequence、channel、trace/span、stage_key、unit_key、attempt、payload schema version；前端对未知事件优雅忽略。

### 6.4 能力真值

Runtime capability 只能在真实跨端测试通过后声明：

- skills：请求包含 Skill 且正文被 AgentScope Skill 消费；
- session：AgentState 可持久化并跨进程恢复；
- cancel：不是空方法；
- streaming：平台能在运行中收到增量；
- pipeline：状态、事件、恢复和终态都通过；
- selective_retry：失败单元正向与兄弟不重跑负向测试通过。
- workflow_call：只可枚举/调用授权 WorkflowVersion，产生受治理子 Run；
- agent_node：Workflow agent-run 节点固定 AgentVersion，父子状态和取消传播通过。

## 7. 原子版本与 Release

AgentVersion 必须冻结：

1. AgentDefinition、ExecutionSpec 和 PromptBundle；
2. 内部 RoleVersion；
3. PipelineDefinition、controller/version/state schema；
4. Core/Extension MountBinding；
5. ToolVersion；
6. SkillVersion 或完整 content hash；
7. KnowledgeSnapshot/index revision；
8. WorkflowVersion；
9. Model 及参数；
10. 输入、输出和中间 Schema；
11. permission、budget、retry、barrier policies；
12. InvocationGraph 深度、环检测、子 Run、取消和幂等策略；
13. Runtime Contract 版本；
14. AgentScope 精确 package/commit；
15. artifact hash。

Release 再绑定：

- environment；
- Runtime Provider；
- runtime profile；
- 凭据/Connection 环境引用；
- canary policy。

评测可以跨多个 Provider 比较；同一有效 Release 仍可遵守“一 Agent 一 Provider”。前端不得把评测多 Provider 说成同一 Agent 可同时跨 Provider 灰度。

## 8. Agent 工作区目标设计

权威细节见 08 号稿 v2.1。总原则：

- 栏目按 capability 渲染，不再所有 Agent 固定九页；
- lifecycle 与 Agent type 分离；
- 新增“执行”页；
- Pipeline 展示核心拓扑、角色、stage、retry/barrier 和可扩展槽；
- Planning 展示任务策略、限制和运行时计划投影；
- Skill、Tool、Knowledge 页面显示 scope、slot、source、版本和发布状态；
- Workflow 不再叫 Wakerflow，避免与 AgentScope Pipeline 和参考产品混淆；
- Workflow 页与 Agent 能力页都展示双向调用关系：谁调用谁、固定版本、同步/异步、输入输出Schema、权限和递归风险；
- Chat 是否可用由 supports_chat capability 决定；
- 保存使用专用 PATCH/Mount API，不整包覆盖 config；
- 发布前展示完整依赖闭包与未版本化阻断项；
- Run 看板展示 stage、unit、attempt，而不是平面事件列表。

## 9. Task、Trigger、Batch 和工单链路

03 号稿仍是 Trigger 与数据映射权威设计。12 号稿负责工单处理和 Outbox，但执行语义修正为：

- flow：平台 WorkflowVersion 执行；
- agent：对同一 AgentVersion 发起 Run；该 AgentVersion 内部可以是 Pipeline 或 Planning；
- batch：TaskRun 输入集合与并发/窗口策略；
- automation：Task + Trigger + budget；
- Chat：人机连续交互，不作为所有自动任务的默认执行分支；
- HITL：Pipeline/Run continuation，不要求先创建 Chat Session。

平台同时支持：

- Agent 在对话或无状态 Run 中，通过受权工具调用 WorkflowVersion；
- Workflow 通过 `agent-run` 节点调用 AgentVersion；
- 自动任务可直接以 WorkflowVersion 或 AgentVersion 为目标。

三者共享版本解析、子 Run、InvocationGraph、预算、权限、取消和审计，不各造一套调用协议。

## 10. 分期计划

| 阶段 | 内容 | 验收闸门 |
|---|---|---|
| P0 | 未提交文件归属、文档封版、2.0.8-dev commit/lock、POC 标记 | 无归属冲突；不改业务代码 |
| G0 | 平台→adapter 集成测试、capability 真值、Contract v1.2 与事件 ADR | workflowMode 分支真实命中；分立单测不能替代集成 |
| M1 | 统一 AgentDefinition、RoleVersion、MountBinding、SkillVersion、KnowledgeSnapshot | 编辑、预览、版本、Release、Runtime 五处同一资源 |
| R1 | AgentScope Chat、AgentState、Skill 正文、附件、工具/知识、事件流 | 重启恢复；无本地模型旁路；能力正负向测试 |
| P1 | QualityPipeline、选择性重做、checkpoint、独立 verifier | 单 unit 故障只重做该 unit；重启可恢复 |
| P2 | Planning Agent 与事件投影 | 内部计划不污染平台 Task；副作用受控 |
| F1 | 工作区执行配置、mount scope、发布闭包、层级 Run 看板 | UI 无幽灵配置 |
| B1 | 质检、审计、工单核验内置方案产品化 | 真实样本、失败路径、恢复、回滚通过 |
| T1 | Trigger、Batch、自动任务合流与 Outbox | 即时、窗口、手动批只改变调度语义 |
| C1 | 正式版 2.0.8 升级审查 | API diff、回归、lock 更新、回滚完成 |

P0 之后的先后约束：G0 → M1 → R1；P1 与 P2 可在 M1/R1 契约稳定后并行；F1 依赖 M1/P1/P2 的配置真值；T1 不得绕过 Release 和 Run 语义。

## 11. 决策表

### 11.1 已确定

| 编号 | 决策 |
|---|---|
| D01 | AgentScope 是唯一 Agent Runtime |
| D02 | 2.0.8 正式发布前以精确 Git commit 做隔离 spike，不假装已发布 |
| D03 | 方案 A 是声明式 Core 的 QualityPipeline；不直接使用 GoalPipeline，也不把业务阶段写死在控制器 |
| D04 | 方案 B 是 AgentScope Planning Agent |
| D05 | Pipeline 与 Planning 正交可组合 |
| D06 | 内部角色默认内嵌 AgentVersion，不全部升级为顶层 Agent |
| D07 | 控制器、barrier、retry、checkpoint、schema、permission 不是 Agent |
| D08 | unit verifier 与 final verifier 独立于 executor |
| D09 | 失败子项选择性重做是方案 A 必备验收项 |
| D10 | Core 冻结；改 Core 走派生或新版本 |
| D11 | Extension 可挂 Skill、Tool、Knowledge，并支持 global、stage、role scope |
| D12 | Release 原子冻结全部依赖闭包 |
| D13 | Chat 每 turn 是 Run；多轮才有 Session |
| D14 | 无状态单次任务不创建 Session |
| D15 | Pipeline 恢复状态叫 ExecutionState/Continuation，不冒充 Chat Session |
| D16 | 批量属于 TaskRun 调度策略；自动任务可配置 batching |
| D17 | native_workflow.py 只作 POC 证据，不作生产基类 |
| D18 | 前端必须改；不能维持“交互协议零改动” |
| D19 | WorkflowVersion 与 AgentVersion 支持双向组合，但不与 AgentScope Pipeline 合表 |
| D20 | Agent → Workflow 走授权 workflow mount/tool；Workflow → Agent 走通用 agent-run 子运行节点 |
| D21 | 跨 Agent/Workflow 子调用统一维护 InvocationGraph、版本 pin、预算、权限、取消、幂等与环检测 |
| D22 | IDENTITY/playbook/PERSONA 编译为版本化 PromptBundle；BIBLE 类内容是软约束，不替代硬治理 |

### 11.2 仍待用户或实施 spike 决定

| 编号 | 未决项 | 默认建议 |
|---|---|---|
| U01 | SkillVersion 是独立表还是 AgentVersion 内完整内容快照 | 独立版本表，同时在依赖闭包存 hash |
| U02 | KnowledgeSnapshot 首期冻结索引 revision 还是文档集合清单 | 冻结文档集合和索引 revision；缺任一阻断发布 |
| U04 | partial barrier 的业务策略 | 内置方案逐一配置；质检默认关键 unit 失败则整体 failed |
| U05 | 2.0.8 正式版之前是否允许生产 | 不允许，只做沙箱 spike |
| U06 | 高风险工单写操作 HITL 节奏 | 沿 12 号稿保留未决，不在本稿偷拍 |

## 12. 明确不做

- 不把每个内部角色都做成顶层 Agent；
- 不把 AgentScope GoalPipeline 包装一下就宣称支持质检流水线；
- 不把 AgentScope 内部 Task 合并为平台 AnalysisTask；
- 不让 LLM 决定 retry、barrier、权限或终态；
- 不继续维护 config.skills 与 AgentSkill 双写；
- 不允许未版本化 Skill/Knowledge 被称为可回滚 Release；
- 不把 Connection 当普通 Skill 自由挂载；
- 不保留绕过 Runtime 的生产 Chat；
- 不把参考产品的 Wakerflow 名称当成本项目实体；
- 不在 2.0.8 尚未发布时写可直接安装的稳定依赖声明；
- 不修改 03 号稿的 Trigger/Data Mapping 责任边界；
- 不在审计结论确认前改业务代码。

## 13. 证据索引

- 详细代码、前端、数据结构、AgentScope Pipeline、冲突和逐步闸门：research/morethancorn/09-agentscope-plan-audit/AUDIT-REPORT.md
- 前端视觉证据：research/morethancorn/09-agentscope-plan-audit/screenshots/
- Trigger 与数据映射：docs/v2-design/03-trigger-and-data-mapping.md
- Agent 管理模型：docs/v2-design/05-agent-management-redesign.md
- Agent 工作区与配置：docs/v2-design/08-agent-pages-align-19830.md
- 工单与 Outbox：docs/v2-design/12-event-driven-workorder-pipeline.md
