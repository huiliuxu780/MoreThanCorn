# 12 · 事件驱动三方工单处理链路

> 日期：2026-09-08
> 版本：v2.1
> 状态：设计稿，未实施
> 上位方案：11 号稿 v5.1
> 入口权威：03 号稿；本稿不改变 Trigger、TriggerEvent、映射和攒批裁定

## 0. 结论

工单链路不是第三套 Agent 运行机制。它由平台控制面和 AgentScope Runtime 两层组成：

- 平台负责 Trigger、映射、batching、TaskRun、版本解析、权限、副作用 Outbox、审计和对账；
- AgentScope 负责 AgentVersion 的实际运行，runner 可以是单 Agent 或由版本化定义固定的 Pipeline；任一内部 role 可以按模板允许范围启用 Planning；
- 一条输入对应一个 Run；批量只是一个 TaskRun 组织多个 Run；自动任务只是由 Trigger 启动 TaskRun；
- 只有需要持续多轮人机对话时才创建 Chat Session。普通事件处理、等待确认和 Pipeline 恢复都不能为了“统一”伪造 Session。

旧稿中的“flow / agent 批量 / agent 对话三选”不成立。正确选择发生在两个正交层次：

1. Task 的执行目标是 `WorkflowVersion` 或 `AgentVersion`；
2. `AgentVersion.runner` 是 `agent` 或 `pipeline`，Planning 是 role 级能力，不是第三种 target。

## 1. 场景与边界

```text
外部工单源
  └─ Webhook / Kafka / API / Schedule Trigger
      └─ TriggerEvent → filter → mapping → batching
          └─ TaskRun
              ├─ target=WorkflowVersion → N 个 Run
              └─ target=AgentVersion    → N 个 Run
                    ├─ runner=agent
                    └─ runner=pipeline
                         └─ role 可选择启用 Planning
                  └─ 外部写动作 → Policy/Gateway → Outbox → 目标系统
```

本稿解决：入口事件如何成为可追踪批次，如何选择 Workflow 或 Agent 方案，如何让固定质检/审计/工单 Pipeline 运行，如何治理外部写操作。

本稿不解决：通用 iPaaS、跨系统双向同步、自由多 Agent 流程编辑器、所有高风险动作的统一 HITL 产品形态。

## 2. 当前事实

### 2.1 已存在

| 能力 | 当前事实 | 本稿处置 |
|---|---|---|
| AnalysisTask / TaskVersion / TaskRun | 已有 workflow/agent 执行目标、manual/schedule/backfill/api 触发来源、幂等字段和 resolved version | 保留为调度外层；后续目标引用统一到 WorkflowVersion/AgentVersion |
| Workflow / NodeRun / batch | 平台确定性流程与节点执行事实已存在 | 继续作为一种 Task target；不与 AgentScope Pipeline 合表 |
| Agent / AgentVersion / Release | Module 路径部分可版本发布；Custom 尚未闭环 | 按 05/11 号稿统一 AgentDefinition 与完整 Release 闭包 |
| AgentScope adapter | 可执行 Module；capability 和配置契约存在错配 | Runtime Contract v1.2 前不得宣称已支持 Pipeline/Planning/Session |
| native_workflow POC | 有固定阶段实验，但未支持生产级选择性重做、恢复和完整 verifier | 只作测试证据，不作为生产基类 |
| Connection / egress / MCP Gateway | 已有凭据、出站策略和工具闸门能力 | 外部动作复用，不建立第二套凭据或 SSRF 策略 |
| ResultDelivery | 已有 Outbox 治理模式 | 可复用模式，不等于 HTTP 动作已经实现 |
| Agent Chat | 有 Session/Message/turn API，但本地直连模型并旁路 Runtime | R1 后改走 AgentScope；多轮才用 Session |

补充现状：Workflow 旧 `agent/agent-select/agent-exec` 节点已经 deprecated，迁移器会把它们改写为 workflow 节点；Agent 页保存的 `config.workflows` 又没有 Runtime 消费路径。因此目标产品展示的双向控制关系，目前在本项目里两个方向都没有真正接通。

### 2.2 已设计未实施

03 号稿定义的下列能力仍是设计，不得在界面和排期中写成现成：

- Trigger 一等实体与一 Task 多 Trigger；
- TriggerEvent 原始事件流水、去重、过滤、映射失败和留存；
- Webhook HMAC/Bearer、重放防护、限流和 202 接收；
- Kafka consumer、先落库再 ack、毒消息和背压；
- 统一字段/码值映射与 DataDefinition 校验；
- immediate/window/manual_flush batching。

### 2.3 当前阻断

1. Runtime 尚未消费统一的 roles、mounts、pipeline spec 和 planning spec；
2. Custom Agent 还不能与 Module 一样版本化、发布和结构化运行；
3. Skill/Tool/Knowledge/Workflow 挂载没有统一 MountBinding；
4. Release 未冻结完整依赖闭包；
5. 当前 POC 和官方 GoalPipeline 都不能直接满足“只重做失败 unit”；
6. HTTP 外部写还没有动作级契约与可靠 Outbox；
7. Trigger/Kafka/映射/batching 尚未实施。

## 3. 处理目标如何选择

| 目标 | 适用 | 不适用 | 执行事实 |
|---|---|---|---|
| WorkflowVersion | 规则可枚举、步骤固定、每个节点需显式审计；可调用受控 Agent 节点 | 复杂语义判断主导且需要动态规划 | TaskRun → Run → NodeRun |
| AgentVersion / runner=agent | 一次输入输出的分类、抽取、判断、生成；可启用 Planning | 必须固定分派、多专家并行、独立复核 | TaskRun → Run |
| AgentVersion / runner=pipeline | 质检、审计、工单核验；固定分类、分派、并行执行、逐项验证、汇总和终检 | 用户自由拼接任意 DAG | TaskRun → Run → PipelineState/Stage/Unit/Attempt |

Planning 与表中三行不是同一维度：

- runner=agent 可以启用 Planning；
- runner=pipeline 的某个 executor role 也可以启用 Planning；
- 分类、barrier、retry、checkpoint、权限和 verifier 判定仍由确定性控制器负责。

推荐不是无条件“Workflow 套 Agent”。如果业务本质是固定质量治理骨架，应直接发布一个 `runner=pipeline` 的内置 Agent 方案；只有跨多个平台资产、确定性节点和人工步骤的业务流程才用 Workflow 作为外层。

### 3.1 双向组合契约

两种方向都允许，但不能各写一套调用协议：

- Agent → Workflow：授权 Workflow mount 被编译成 AgentScope tool；调用时平台创建固定 WorkflowVersion 的子 Run；
- Workflow → Agent：通用 `agent-run` 节点创建固定 AgentVersion 的子 Run，并接收结构化结果；
- 两者统一记录 ChildInvocation，继承 trace、取消和权限上限，并受根 Run 总预算约束；
- 根 Run 维护跨资源 InvocationGraph，在活动祖先链上以资源类型+版本 ID 做环检测和最大深度控制；合法的串行/兄弟重复调用另受总子 Run 与预算限制；
- 子调用默认无 Session；只有显式升级到多轮协作时才建立 Chat Session；
- 自动任务仍只负责启动顶层 WorkflowVersion 或 AgentVersion，不参与运行时“谁控制谁”的定义。

这使 SOP 可以双向复用，但不允许 Agent 通过 run-workflow 工具绕过外部写 Outbox，也不允许 Workflow 节点绕过 Agent Release 和 Runtime 权限。

## 4. 质检/审计/工单核验 Pipeline

### 4.1 首个固定拓扑示例

```text
classify
  → dispatch units
  → execute units in parallel
  → verify each unit
  → retry failed unit only
  → barrier
  → synthesize
  → independent final verify
  → terminal result
```

这不是把每个节点注册成一个顶层平台 Agent。用户看到一个内置方案；内部 `classifier/executor/unit_verifier/synthesizer/final_verifier` 是 AgentVersion 内冻结的 role。该拓扑是首个质检 ModuleVersion 的声明式 PipelineDefinition，不是通用控制器里写死的唯一七段流程。barrier、retry、schema、checkpoint、预算和权限的执行不变量属于代码控制面，不是 Agent。

### 4.2 选择性重做

必须满足：

- 每个 unit 有稳定 `unit_id`、独立 input/result/verdict/attempt；
- verifier 返回结构化 `passed/retryable/reasons/feedback`；
- 失败只重开指定 unit，已通过兄弟结果冻结复用；
- final verifier 可以返回 `failedUnitIds`，但不能让 executor 自己兼任最终裁判；
- 达到上限后由 barrier policy 决定 failed 或 partial；默认质检关键 unit 失败则整体 failed；
- 每次状态变化写 checkpoint 和事件，进程重启可恢复。

官方 2.0.8-dev `GoalPipeline` 只有一个 executor 与一个 verifier；验证失败时会把反馈交回整个 executor。它可借鉴 `PipelineProtocol.reply_stream` 和事件流写法，但不能直接实现上述状态机。

### 4.3 Core 与 Extension

每个内置方案版本声明的拓扑、必需 verifier、Schema、权限上限和恢复策略属于 Core。用户可在模板声明的 slot 中挂载或替换 Skill、Tool、Knowledge；挂载可限定 global、stage 或 role scope。

修改 Core 不在原实例上解锁，必须派生新 Module/ModuleVersion。Extension 也必须进入下一 AgentVersion 的完整依赖闭包后才能发布。

## 5. Session、Run、等待与恢复

| 场景 | Session | Run | 恢复载体 |
|---|---:|---:|---|
| Webhook/Kafka 单条无状态处理 | 无 | 1 | Run/ExecutionState |
| 一个批次 100 条工单 | 无 | 100，外加 1 个 TaskRun | TaskRun + 各 Run 状态 |
| Pipeline 等待用户确认 | 默认无 | 原 Run 继续 | Continuation |
| Agent 需要外部异步工具结果 | 默认无 | 原 Run 继续 | Continuation |
| 用户与 Agent 多轮协作处理 | 1 | 每个 assistant turn 1 个 | Chat Session + AgentState |

“事件触发 Agent 后自动创建对话”不再是默认方案。只有产品明确把任务升级为多人/多轮对话时，才新建或关联 Session；该升级需要单独的权限、归属和消息策略。

## 6. 能力挂载与版本闭包

任务只引用已发布 AgentVersion。运行时不能临时从可变 Agent.config 猜装配内容。

每个 MountBinding 至少冻结：

- resource type/id；
- pinned resource version 或 snapshot hash；
- global/stage/role scope 与 scope key；
- Core/Extension 来源及 slot key；
- 权限和连接依赖；
- enabled 状态。

Skill、Tool、Knowledge、Workflow 的详细版本规则见 05 号稿。Workflow 作为受控 callable mount 进入 Agent 或 role，并编译为明确的 tool-like 子调用；不能把平台 WorkflowVersion 与 AgentScope Pipeline 当成同一资源。

## 7. 出站写回治理

### 7.1 动作定义

创建、更新、留言、关闭工单是不同动作，必须各自声明：

- method/path/input/output schema；
- 业务幂等键来源；
- 风险等级和默认权限；
- 是否可重放；
- Connection 和环境；
- 可选回读/对账契约。

Workflow 外部动作节点和 Agent Tool/MCP 暴露应引用同一动作定义，避免两套语义。

### 7.2 Outbox

每个外部写动作至少记录：action kind、idempotency key、target connection/environment、脱敏请求快照、attempt、响应摘要、终态和审计信息。

约束：

- exactly-once creation：平台用唯一幂等键只创建一条待投递记录；
- at-least-once delivery：失败按策略重试，目标端必须支持幂等或由适配层去重；
- Run 成功不能推导外部单据已写成功；动作终态独立聚合；
- 重试耗尽进入死信，可授权重放；
- HTTP 出站继续经过统一 egress policy，Agent 工具继续经过 Gateway。

复用 ResultDelivery 表还是新建 EgressAction 尚未拍板。不能仅凭“少建一张表”决定；两者的状态机、查询负载、留存和业务语义需要先比较。

## 8. 分期与闸门

| 阶段 | 内容 | 出口闸门 |
|---|---|---|
| T0 | 完成 11 号稿 G0/M1：统一 AgentDefinition、MountBinding、Runtime Contract v1.2 | 编辑、发布、运行读取同一 ID 与版本 |
| T1 | 实施 03 号稿 Webhook/API Trigger、TriggerEvent、映射和基础 batching | 重推去重；坏映射可查；批次可重放 |
| T2 | 动作定义、HTTP Outbox、死信和沙箱对账 | Run 与动作终态分离；重复投递不重复建单 |
| T3 | 在 11 号稿 P1 QualityPipeline 上产品化 ticket 方案 | 单 unit 失败只重做该 unit；进程重启恢复 |
| T4 | Kafka consumer、背压和毒消息 | 先落库再 ack；毒消息不阻塞分区 |
| T5 | Workflow/Agent 两类 Task target 合流 | resolved version 冻结；同一事件不双跑 |
| T5.1 | 双向子运行：workflow mount/tool、agent-run 节点、ChildInvocation/InvocationGraph | 两个方向共用版本、权限、预算、取消和环检测 |
| T6 | 可选的多轮协作升级 | 仅此路径创建 Session；每 turn 有 Run |

T1/T2 的平台侧工作可在 G0/M1 Schema 稳定后与 R1/P1 并行；T3 必须复用已通过 11 号稿 P1 闸门的 QualityPipeline。任何阶段都不能以旧 Agent.config 作为临时接口，否则会把挂载和版本债务带入 Trigger 链路。

## 9. 未决事项

| 编号 | 未决项 | 当前建议 |
|---|---|---|
| N1 | 高风险创建/关闭动作是否首期加入 HITL | 沙箱默认 deny，生产白名单；HITL 形态单独拍板 |
| N2 | Kafka 首期协议范围 | 仅 Kafka，其他 MQ 保留连接器扩展位 |
| N3 | HTTP Outbox 新表还是扩 ResultDelivery | 先做状态机与迁移对比，不预设扩表一定更省 |
| N4 | 试点目标系统与动作 | 选单动作、支持幂等/回读、低流量沙箱 |
| N5 | partial barrier 的工单策略 | 逐内置方案定义；关键 unit 失败默认整体失败 |
| N6 | 任务升级为 Chat Session 的权限与归属 | 不随 T1–T5 默认实现 |

## 10. 验收场景

1. 同一 Webhook 事件重推三次，只产生一个有效处理 Run；
2. 100 条批次中 1 条映射失败，不阻塞其余输入，失败可定位和重放；
3. 固定工单 Pipeline 中一个 unit 验证失败，只重做该 unit，兄弟调用次数不变；
4. worker 在 retry 前重启，恢复后不重复已通过 unit；
5. 外部创建接口超时后重试，目标系统只有一个单据；
6. Run 成功、投递失败时，界面分别显示执行成功和写回失败；
7. 无状态自动任务全程不创建 Chat Session；
8. 真正的多轮协作中，一个 Session 包含多个 turn Run，重启后上下文恢复；
9. 修改 Extension 后旧 Release 行为不变，新 Release 可审阅完整依赖 diff；
10. 未冻结 Skill/Knowledge、越权 Tool 或缺失 Connection 阻断发布。
11. Agent 调 Workflow 和 Workflow 调 Agent 都产生固定版本子 Run；
12. 构造 AgentVersion A → WorkflowVersion W → AgentVersion A 的环，在任何外部写动作前失败；
13. Agent 可见的 workflow list 只含已授权 mounts，不能枚举全平台流程。

## 11. 文档关系

- 03 号稿：Trigger、TriggerEvent、Webhook/Kafka、mapping、batching 的权威入口设计；
- 05 号稿：Agent/Module/Version/Release、MountBinding 与 API 的权威模型；
- 08 号稿：Agent 工作区和 Pipeline 可视化的前端设计；
- 11 号稿：AgentScope Runtime、QualityPipeline、Planning、Session/Run 和分期总计划；
- SDD-12/13/14：Connection、ResultDelivery 与旧 POC 的背景证据，不高于本轮修订后的 05/08/11/12。
