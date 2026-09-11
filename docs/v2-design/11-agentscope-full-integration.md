# 11 · AgentScope 原生运行平台总体方案

> 版本：v6.1
> 日期：2026-09-12
> 状态：`ARCHITECTURE_PARENT / EXECUTION_DETAILS_DELEGATED`
> 代码状态：本轮零修改
> 核心原则：AgentScope 已有的直接采用；QoderWake 只复制已实测产品行为；平台只补明确缺口。

> **权威边界（2026-09-12）**：本文只负责 AgentScope 真源、Session/Schedule、
> Toolkit 与三执行体的上位架构。触发字段、Invocation 状态机、事件目的地、幂等、
> 预算和分析批次语义统一由
> `docs/product-domain/execution-automation-batch-spec.md` §6/§7/§9/§10 定义；
> 本文不得再发展平行的 T 轨模型。

## 0. 本轮纠偏

旧 v5.1 把 AgentScope 放在通用 Runtime Provider 后面，同时计划由平台继续拥有 Session、AgentState、事件投影、调度、Checkpoint 和 Agent 观测。这与“全面采用 AgentScope”冲突，现整体撤回。

以下旧结论不再有效：

- 只有用户多轮对话才创建 AgentScope Session；
- 无状态任务绕开 Session，由平台保存 AgentState；
- Flow role 使用平台 `ExecutionState` 复制 AgentState；
- AgentScope 只提供 Agent/Toolkit 库层，app 服务层默认关闭；
- AgentScope Event 必须先转写成平台 RunEvent 才能展示；
- 所有 Agent 执行都必须复制为平台 Run；
- 自建 QualityPipeline 是已经批准的生产方向。

研究中的源码事实、当前代码断链和 QoderWake 页面观察仍然有效；被撤回的是由这些事实推导出的平台自建架构。

## 1. 已确定的产品方向

1. AgentScope 是唯一 Agent 运行时和 Agent 应用服务底座。
2. 保留 MoreThanCorn 自有确定性 Workflow。
3. 新增 AgentFlow 产品面，对齐 QoderWake WakerFlow 的已证体验；运行时只采用 AgentScope 2.0.8 正式能力，不把自建 runner 冒充官方能力。
4. 任务看板和自动任务产品体验高保真复刻 QoderWake，不再自由设计。
5. Skill、MCP、Knowledge、Workspace、Schedule、Session、AgentState、消息和 AgentEvent 优先采用 AgentScope 原生对象。
6. 外部数据连接、MQ/API/Webhook/数据库轮询和数据过滤是 AgentScope 当前未覆盖的产品缺口，独立补充。
7. 不复制 QoderWake 品牌、源码、私有 API、长期 token URL 和未观测行为。

## 2. 总体架构

```text
MoreThanCorn 产品层
├── 任务看板（QoderWake 行为复刻；只读联合视图）
├── 自动任务（QoderWake 行为复刻）
├── Agent 管理与发布治理
├── AgentFlow 产品管理
├── 现有 Workflow
├── 数据接入与触发（平台缺口）
├── 租户、权限与业务写回
└── 薄集成边界
    │
    ▼
AgentScope app 运行层
├── AgentRecord / AgentData
├── SessionRecord / SessionConfig / AgentState
├── ChatService / message storage / message bus
├── ScheduleRecord / SchedulerManager
├── SkillRecord / Skill Hub / Workspace skills
├── MCPRecord / MCP Hub / Workspace MCPs
├── KnowledgeBase / RAGMiddleware
├── WorkspaceManager
├── Team / SubAgentTemplate / Task tools
├── AgentEvent / Session SSE / HITL
└── TracingMiddleware / OpenTelemetry
    │
    ▼
AgentScope Agent / Model / Toolkit / Pipeline（2.0.8 发布后）
```

AgentScope 不再作为只返回 `output + trace` 的黑盒 Provider。产品层可以代理其 API、增加租户校验和产品展示，但不能复制其运行状态。

## 3. 唯一真相源

| 领域 | 唯一运行时真相源 | 平台允许保存 | 平台禁止保存 |
|---|---|---|---|
| Agent 运行配置 | AgentScope `AgentRecord/AgentData` | 版本/发布所需不可变控制面文档 | 第二份可变 system prompt、react/context 配置 |
| System Prompt | `AgentData.system_prompt` | 发布快照 | 运行时并行 prompt 字段 |
| Model | `SessionConfig.chat_model_config`、ScheduleData model config | Agent 默认选择偏好；创建 Session 时写入 | 运行中另一路模型配置 |
| Session | `SessionRecord` | `agent_id/session_id` 产品引用与权限映射 | 平台 Session 镜像 |
| AgentState | `SessionRecord.state` | schema/version 兼容审计元数据 | AgentState blob 双写、RuntimeCheckpoint |
| Messages | AgentScope storage | 产品索引、脱敏搜索方案需另审 | 复制完整消息历史 |
| Live events | AgentScope AgentEvent + Session SSE | 必要的协议版本/消费游标 | 自创 Agent 事件语义替代官方事件 |
| Schedule | AgentScope ScheduleRecord | QoderWake 风格的产品表单映射 | 第二套 Agent cron 调度器 |
| Skill library | AgentScope SkillRecord | 产品展示扩展字段 | 第二份运行时 Skill registry |
| Skill mount | AgentScope Workspace 中的 skill 文件 | 发布附件引用/摘要 | 独立 mount 表作为实际运行状态 |
| MCP library | AgentScope MCPRecord | 产品展示扩展字段、凭据外部托管方案 | 第二份运行时 MCP config |
| MCP mount | Workspace `.mcp` 实际状态 | 发布附件引用/摘要 | 平行 MCP mount 状态 |
| Knowledge | AgentScope KnowledgeBase + Session knowledge config | 产品目录扩展 | 外部检索和官方 RAG 双运行真相源 |
| Workspace | WorkspaceManager + Session workspace_id/cwd | 产品项目目录引用 | 第二套 Agent 工作目录状态 |
| Agent tracing | AgentScope TracingMiddleware/OTel | trace backend 的链接或索引 | 将 RunEvent 宣称为完整 Agent trace |

平台版本/发布不是 AgentScope 已有能力，可以保留为控制面。但发布产物必须编译成 AgentScope 原生对象，运行时只能读取 AgentScope 一侧，不能两边动态取值。

## 4. Session 的权威语义

AgentScope app 把 Session 同时作为消息、状态、Workspace、模型配置、锁、事件扇出和恢复的容器。它不等于产品上的“聊天窗口”。

### 4.1 用户对话

```text
一个产品 Conversation
→ 一个长期 AgentScope Session
→ 多次 ChatService.run
```

### 4.2 无状态自动执行

AgentScope 2.0.7 官方 Scheduler 的 `stateful=false` 仍在每次 fire 创建 fresh Session。该 Session 不复用、不出现在产品对话列表，但必须保留官方运行语义。

```text
Schedule fire #1 → Session S1
Schedule fire #2 → Session S2
```

### 4.3 有状态自动执行

`stateful=true` 复用 `{schedule_id}_stateful` Session，多次触发继承 AgentState。

### 4.4 API/Event 触发

AgentScope 当前没有我方所需的通用 MQ/API 数据入口。平台入口完成鉴权、过滤和映射后，应创建或唤醒 AgentScope Session；是否复用 Session 必须是显式产品选项，不得由平台另存 AgentState。

### 4.5 Pipeline

2.0.8-dev Pipeline 尚未进入 ChatService、Session storage 和 app 路由。Pipeline 各 Agent 的 Session/State 如何托管仍是正式 spike 的开放项，不能沿用旧 `FLOW_EPHEMERAL` 设计作为答案。

## 5. AgentScope 原生装配

### 5.1 每回合 Toolkit

官方 `get_toolkit()` 在每次 Agent assembly 中组合：Workspace 内置工具、Task 工具、Background Task 工具、Schedule 工具组、Team/Sub-agent 工具、`extra_agent_tools`、Channel tools、Middleware tools，以及 Workspace Skills 与 MCPs。MoreThanCorn 不再自建另一套 Toolkit 装配顺序。

### 5.2 Skill

```text
安装到用户库：SkillRecord
加入 Agent/Session Workspace：/workspace/skill/from-library 或上传
运行：workspace.list_skills(agent_id) → Toolkit.skills_or_loaders
```

删除用户库 Skill 不会删除已进入 Workspace 的副本。SkillRecord 当前不保存完整 archive，加入 Workspace 时需要从 Hub 重新下载；官方源码已有 Hub 下线后不可恢复的 TODO。发布可复现性因此是明确缺口，必须验证后再决定最小补充方案。

### 5.3 MCP

```text
安装到用户库：MCPRecord
加入 Workspace：/workspace/mcp/from-library 或手工添加
运行：workspace.list_mcps(agent_id, session_id) → Toolkit.mcps
```

Workspace `.mcp` 是实际状态，MCPRecord 是期望/来源状态，两者由 AgentScope 收敛。平台不得再建立第三份实际状态。

### 5.4 System Prompt

System Prompt 写入 `AgentData.system_prompt`，由 ChatService 每回合装配 Agent。若产品保留 IDENTITY/BIBLE/PERSONA 编辑体验，它们只能是发布前的编辑分区，保存/发布时确定性编译为一个 `system_prompt`；运行时不得同时注入多份相互覆盖的 prompt。

权限、工具可见性、文件范围和预算不能只靠 Prompt，使用 AgentScope PermissionContext、Workspace 和 Middleware 硬约束。

### 5.5 Tool

- Workspace Bash/Read/Write/Grep 等来自 `workspace.list_tools()`。
- Task、Schedule、Team 工具由 `get_toolkit()` 加入。
- MCP 工具通过 `MCPClient` 加入。
- MoreThanCorn 独有的 `run_workflow`、未来 `run_agent_flow` 和业务工具，只能通过 `extra_agent_tools` 以 AgentScope `ToolBase` 注入。
- 平台可以保留工具目录作为产品控制面，但不得实现独立 Agent 工具循环。

### 5.6 Knowledge 与 Model

Knowledge 通过 `SessionKnowledgeConfig` 选择 knowledge_base_ids 和 RAGMiddleware 参数。Agent 级默认知识库、默认模型只是创建 Session 的产品默认值；实际运行值以 SessionConfig 为准。

## 6. 任务看板：直接复刻，禁止再设计

目标产品已证实任务看板是对话 Session、AgentFlow execution 和 Automation execution 的统一工作视图，不是任务定义列表。

一期直接采用：周期指标；需要操作/查收结果；列表/泳道；搜索、执行者、触发方式、状态、周期筛选；任务、执行者、来源、状态、最近更新；点击进入对应原生详情。

看板首先通过查询不同原生记录形成只读视图。是否需要额外持久状态，只能由“查收”等真实网络行为证明；不得预建新的统一 WorkItem 状态机。已证规格见 `.replica/specs/QW-001-task-board.md`。

## 7. 自动任务：上位产品壳与 AgentScope 映射

本节只保留产品外形与 AgentScope 能力映射，不再定义独立触发状态机。
本节所述 AutomationDefinition 的所有触发先建立 `AutomationInvocation`，再派发真实执行体；具体准入、幂等、
conversation key、预算快照和终态对账以新领域 Spec 为准。

### 7.1 直接复刻

- 定义列表、指标、筛选和 enabled switch；
- 名称、每个 AutomationDefinition 最多五个触发方式；该限制不表示平台存在一个
  所有业务共用的通用 Trigger/Batch 实体；
- 顶层配置型 trigger 统一为 schedule/API/event；manual 是 run-now 动作，polling/MQ/webhook
  是 event 的 DataSource 采集模式；当前 `kind=polling` 仅作兼容值；
- 定时任务支持定期/一次性；
- QoderWake 已观察到的执行目标为 Agent/AgentFlow；MoreThanCorn 基于自身已有
  确定性 Workflow，目标 union 明确为 Agent/AgentFlow/Workflow 三型。第三型是我方
  产品决策，不得写成 QoderWake 原站事实；
- 执行指令和 Workspace；
- 最大运行次数和截止日期；
- 详情页运行概览、触发条件、响应对象、高级设置和运行历史；
- 手动运行只作调试，不计自动运行统计。
- 保存后执行类型与目标锁定；切换目标必须新建定义。
- Agent 表单配置 Prompt/模型/Workspace；AgentFlow 表单配置流程阶段和输入映射，二者不能共用同一 target payload。

### 7.2 运行映射

| 场景 | 运行方式 |
|---|---|
| 定时执行 Agent | Schedule fire → Invocation → AgentScope Schedule/Session 对账 |
| 每次独立 | `stateful=false`，每次 fresh Session |
| 跨次继承 | `stateful=true`，复用固定 Session |
| 执行历史 | `GET /schedules/{id}/sessions` |
| API 触发 Agent | 平台入口 → Invocation → 默认 fresh Session；显式 conversation key 才复用 |
| Event/MQ 触发 Agent | EventDelivery(destination=automation) → Invocation → Session |
| AgentFlow target | Invocation → AgentFlowRun；Pipeline app 集成经验证后接入 |
| Workflow target | Invocation → 现有 WorkflowRun，不包装为 TaskRun |

### 7.3 不复制与未证项

不复制 `atk_` URL 凭据形态。目标产品请求体的 `wakeSessionUniqueId` 负责聊天续用而不负责幂等；MoreThanCorn 必须自行设计鉴权、幂等、限流和重放保护。事件/定时拉取按数据源 capability 条件展示，不写死为永远可见或永远不存在。暂停/max-runs/deadline 只阻止新自动触发，不取消已运行执行；删除历史、失败重试、并发和错过调度仍未闭合。规格见 `.replica/specs/QW-003-005-automation.md`。

### 7.4 预算职责

本文只规定 AgentScope adapter/Middleware 必须回传真实 usage，并在其实际支持时执行
duration/token/tool/child-execution 限制。预算字段、hard/soft 语义、冻结时点和错误码
由新领域 Spec §6.5/§7 定义。预算不能只写入 Prompt，也不能在运行时不支持中断时
声称“硬限制已生效”。

## 8. Workflow 与 AgentFlow

### 8.1 Workflow

保留现有确定性 Workflow。Workflow 调 Agent 时必须进入 AgentScope Session/ChatService；Agent 调 Workflow 时以 `extra_agent_tools` 注入 AgentScope ToolBase。等待和回注优先验证 `RequireExternalExecutionEvent / ExternalExecutionResultEvent`，验证前不写成已完成能力。

### 8.2 AgentFlow

AgentFlow 产品面参考 QoderWake 已证体验：列表、详情、画布/脚本、版本历史、运行记录、触发配置和对话式创建。

2.0.8-dev 已有 `PipelineProtocol` 和 `GoalPipeline`，但没有 create_app、ChatService、Session storage、HTTP、恢复和产品注册。GoalPipeline 也不是任意 WakerFlow DSL，没有已证选择性阶段重做。因此一期只能做固定版本 spike，不能先自建完整 Runner 再称为全面采用 AgentScope。

AgentFlow 不注册成 Agent，也不塞进 Workflow 表。若 2.0.8 正式版仍没有 Pipeline registry，平台只补 definition/version/release 控制面；执行时构造官方 Pipeline。自动任务直接引用已发布 AgentFlow，Agent 则通过 `extra_agent_tools` 注册的 `run_agent_flow` ToolBase 调用同一执行入口。Pipeline 的 Session/State/事件如何持久化仍以 spike 结果为准。

## 9. 数据接入

AgentScope Schedule 解决到点唤醒 Agent，不解决 Kafka/RabbitMQ 消费、Webhook、数据库轮询和入站数据治理。

```text
外部数据源
→ 平台连接/订阅/过滤映射（具体模型待真实场景）
→ EventDelivery
   ├── destination=automation → AutomationInvocation
   │      → AgentScope Session | AgentFlowRun | WorkflowRun
   └── destination=analysis_task → TaskRun → N × AnalysisItemRun
```

默认单工单/单事件走 automation 分支。只有事件明确表示“对一个可形成 DataSnapshot 的
数据窗口执行 N 项独立分析”时才走 analysis_task 分支。每条 EventDelivery 只能选择
一个目的地，不得同时创建 Invocation 和 TaskRun。当前只冻结职责，不冻结入口攒批；
事件字段统一使用新领域 Spec §10.0 的 `EventRoute`，详细派发契约以该 Spec §10 为准。

## 10. 观测边界

已证：Session messages、Session status、Session SSE AgentEvent、当前运行最多 1000 条 replay、Schedule sessions、TracingMiddleware 的 Agent/model/tool OTel spans。

未证：AgentScope Studio 与当前 2.0.7 app 的稳定接入、永久 trace 保留、成本面板、Trace 树、跨 Flow/Workflow 谱系。前端只能展示真实 API 或 OTel backend 已返回的数据；现有 RunEvent 和 trace-view 不是 AgentScope 观测证据。

## 11. 当前代码处置分类

### `REPLACE_BY_AGENTSCOPE`

- 平台自建 Agent chat Session/message/state；
- Agent scheduler；
- Agent Skill/MCP 运行时 registry；
- Agent event/trace mapper 作为主观测源；
- 只返回 output 的通用 Agent Provider 主路径。

### `KEEP_AS_PRODUCT_GAP`

- 现有 Workflow；
- 外部数据入口；
- 业务结果写回与对账；
- 租户、平台权限和产品导航。

### `REVIEW_BEFORE_KEEP`

- AgentDefinition/Version/Release；
- Run/RunEvent/TaskRun；
- Tool/Knowledge/Skill 等现有资源表；
- Runtime Provider Contract。

审计必须逐项证明它承担 AgentScope 不承担的职责；沉没成本不是保留理由。

## 12. 分期与门禁

### R0 · 文档与证据

- 完成 `.replica` 代码库契约、领域映射、页面 inventory、状态矩阵、网络契约和页面规格。
- 清除 03/05/08/11/12/HANDOFF 的旧 Session/State/trace 假设。

### R1 · AgentScope app 原生 spike

- 使用官方 storage、message bus、WorkspaceManager 和 ChatService 跑通 Agent、Session、多轮对话、fresh schedule session 和 stateful schedule session。
- Skill/MCP 从 Library 加入 Workspace，并在 Toolkit 中真实生效。
- KnowledgeBase/RAGMiddleware、HITL、interrupt、SSE reconnect 实测。

### R2 · 观测 spike

- 配置 OTel Provider/Exporter，通过 `extra_agent_middlewares` 注入 TracingMiddleware。
- 将真实 trace 送入候选后端/AgentScope Studio，固定实际字段、敏感信息、保留和权限结论。

### R3 · Agent 产品迁移

- Agent 工作区改用 AgentScope 原生 API。
- 只保留经证明必要的版本/发布控制面。
- 停止旧 Provider 双写和旧 Chat 旁路。

### R4 · 任务/自动任务复刻

- 已补创建、编辑、启停、手动运行和看板投影证据；继续补删除、关注动作与失败路径。
- 高保真实现任务看板与自动任务壳。
- 定时 Agent 直接采用 AgentScope Schedule。
- Invocation、预算和事件目的地按新领域 Spec 实现，不再恢复旧 T 轨状态机。

### R5 · AgentFlow spike

- 固定 2.0.8 正式 tag，或隔离固定开发提交。
- 验证 Pipeline 事件、Session/State、HITL、取消和 app 托管缺口，只补实测存在的最小缺口。

### R6 · 数据接入

- 根据首个真实 MQ/API/DB 场景定模型，与 AgentScope Schedule 解耦。

## 13. 实施前硬门禁

1. 每个 Agent 运行能力有 AgentScope 源码和真实调用证据。
2. 不存在 Session、AgentState、Message、Schedule、Skill、MCP、Knowledge 双写。
3. Skill/MCP 的“安装到库”和“加入 Workspace”在 UI/API 中分开。
4. System Prompt 最终只进入 `AgentData.system_prompt`。
5. 定时 Agent 不进入平台自建 scheduler。
6. 无状态 schedule 每次 fresh Session；有状态 schedule 复用 Session。
7. 观测页面只显示实测得到的 AgentScope/OTel 数据。
8. QoderWake 未观测行为保留 `EVIDENCE_GAP`。
9. Pipeline app 集成未通过前，不开发生产 AgentFlow Runner。
10. 任何保留的平台运行实体都证明 AgentScope 没有承担其职责。

## 14. 明确不做

- 不复刻 QoderWake 源码、品牌名和私有 API。
- 不复制长期 token URL，不展示隐式思维链。
- 不自建 Agent Session、AgentState、消息总线、Agent cron 或完整 Agent trace。
- 不因现有代码沉没成本保留双事实源。
- 不把 2.0.8-dev 写成稳定发布事实。

## 15. 证据入口

- `research/morethancorn/10-qoderwake-product-research/01-qoderwake-product-observation.md`
- `research/morethancorn/10-qoderwake-product-research/02-current-platform-reality.md`
- `research/morethancorn/10-qoderwake-product-research/03-agentscope-2.0.8-contract.md`
- `research/morethancorn/10-qoderwake-product-research/10-agentscope-native-adoption-and-replica-decision.md`
- `.replica/CODEBASE_CONTRACT.md`
- `.replica/DOMAIN_MAPPING.md`
- `.replica/specs/QW-001-task-board.md`
- `.replica/specs/QW-003-005-automation.md`
