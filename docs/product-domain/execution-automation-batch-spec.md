# MoreThanCorn 运行、自动任务与分析批跑领域 Spec

> 文档版本：v1.0  
> 日期：2026-09-11  
> 状态：`REVIEW / IMPLEMENTATION_SOURCE_OF_TRUTH`  
> 适用范围：Agent、AgentFlow、Workflow、自动任务、事件触发、分析任务、批次运行、统一任务看板  
> 不包含：用户登录、RBAC、团队数据范围、权限管理页面  
> 实施原则：先打通真实功能闭环，再增加安全治理；但不得删除机器调用所必需的 API key、数据源 token、内部回调 token 与幂等约束。

---

## 0. 决策摘要

本 Spec 冻结以下产品与架构决策。

1. **通用自动任务不是批次。** 一次手动、定时、API 或事件触发，默认产生一次 `AutomationInvocation`，再派发到一个真实执行体：`Agent Session`、`AgentFlowRun` 或 `Workflow Run`。
2. **分析任务才是当前确定需要的批跑场景。** 一次 `AnalysisTask` 运行产生一个 `TaskRun`，批次内包含 N 个可独立成功、失败、取消和重试的 `Run`。
3. **入口攒批不是一期基础设施。** 数据源事件默认一事件一派发；只有真实吞吐、成本、延迟或下游限流证明有必要时，才增加 `IngressBatch`。它不能复用或冒充 `TaskRun`。
4. **任务看板是统一读取投影，不是执行引擎。** 看板聚合真实 Session、FlowRun、Workflow Run、AutomationInvocation 和 TaskRun，不新建第二套运行状态。
5. **定义、触发事实、真实执行必须分离。** `AutomationDefinition` 说明“以后如何重复运行”，`AutomationInvocation` 说明“某次触发发生了什么”，执行体说明“实际工作如何运行”。
6. **会话连续性与请求幂等必须分离。** `conversation_key` 决定是否复用上下文；`idempotency_key` 决定同一个业务请求是否重复受理。
7. **暂停、截止时间和最大运行次数只阻止新触发。** 不隐式终止已开始的 Session、FlowRun、Workflow Run 或 TaskRun。
8. **功能优先阶段不建设人类用户鉴权。** 登录、角色和团队数据范围后置；自动任务 API key、数据源入口凭据和内部工具回调 token 属于执行协议，继续保留。

一句话定义：

```text
MoreThanCorn = 单次 Agent/Flow 自动化 + 专用分析批跑 + 统一执行看板
```

而不是：

```text
所有触发 → 通用 BatchGroup → 通用 BatchItem → 所有执行
```

---

## 1. 背景与问题陈述

### 1.1 当前存在的概念冲突

仓库当前存在两套不同对象，但都使用了 “Automation/自主任务” 名称：

| 实际对象 | 当前持久化 | 当前 API | 实际语义 |
|---|---|---|---|
| 分析任务 | `analysis_task` | `/api/tasks`、兼容层 `/api/automations` | 对一个数据集执行 N 条分析，天然是批次 |
| 通用自动任务 | `automation_definition` | `/api/v2/automations` | 定时、API、事件触发一个 Agent/Flow，默认是单次运行 |

这不是单纯的命名瑕疵。若继续混用，会造成以下错误：

- 把所有自动任务强制包装成 `TaskRun`；
- 把 Agent Session 和分析单条 `Run` 当成同一种运行；
- 看板无法判断一行表示“触发”“会话”“流程”还是“批次”；
- API `/api/automations/{id}/runs` 在不同调用方中表达不同含义；
- 为了统一表面模型，制造一套与 AgentScope Session、AgentFlowRun、Workflow Run 并行的第二执行真源。

### 1.2 本 Spec 要解决的问题

本 Spec 必须回答：

1. 什么是自动任务，什么是一次执行；
2. 哪些场景是批跑，哪些不是；
3. Agent、AgentFlow、Workflow 三类执行体如何接入；
4. 事件、定时、API 和手动触发如何统一；
5. 同一会话续跑与重复请求如何区分；
6. 批次如何并发、取消、超时、重试、恢复和观测；
7. 任务看板如何统一展示而不复制执行状态；
8. 当前已有表和 API 如何渐进迁移；
9. 在暂缓登录和权限建设的前提下，哪些最小执行边界仍必须保留。

### 1.3 依据

本决策基于三类证据：

- QoderWake 官方产品说明：Autonomous Work 通过定时、事件或 API 启动 Waker/WakerFlow；统一任务面板展示对话、Flow 与自动任务运行；推荐先在对话中验证，再固化 Flow，最后自动化。  
  <https://docs.qoder.com/qoderwake/overview>
- QoderWake 官方发布说明：相同 `wakeSessionUniqueId` 的调用进入同一会话并顺序执行，不同会话可以并发；这属于会话连续性，而不是通用批次。  
  <https://docs.qoder.com/release-notes/qoderwake>
- 仓库本地实机观察与抓包：  
  `research/morethancorn/10-qoderwake-product-research/01-qoderwake-product-observation.md`  
  `research/morethancorn/10-qoderwake-product-research/11-task-automation-live-replay.md`

本 Spec 复制成熟产品的产品语义，不推断或复制 QoderWake 私有数据库、私有 API 和内部调度实现。

---

## 2. 文档优先级与废止范围

本 Spec 经确认后，是运行与批次领域的最高优先级文档。

下列既有结论被本 Spec **替代或收窄**：

1. `docs/product-domain/automation-definition.md` 中“每个 AutomationDefinition 触发都产生 TaskRun”的结论，只保留给 `AnalysisTask`，不适用于 `/api/v2/automations`。
2. `docs/v2-design/13-data-trigger-batch-plan.md` 中“平台生产闭环已完整、唯一缺口是攒批”的结论撤回。现阶段更优先的缺口是执行真实性、异步状态、Session 登记与 Flow 增量观测。
3. `docs/product-domain/work-item-projection.md` 当前实现只投影分析 `TaskRun` 与 `ScheduleOccurrence`，应称为“分析任务工作项投影”；它不是最终统一任务看板的完整范围。
4. `docs/v2-design/06-batch-observability.md` 继续有效，但只适用于 `AnalysisTask → TaskRun → Run` 分析批次，不得推广为所有自动任务的运行模型。
5. `docs/v2-design/03-trigger-and-data-mapping.md` 关于“批量不是自动任务同义词”和“首个真实场景前不冻结通用 Batch”的边界继续有效。
6. `docs/v2-design/11-agentscope-full-integration.md` 只保留 AgentScope 真源、Session、Schedule、Toolkit 和三执行体适配的上位架构；触发字段、Invocation、幂等、预算产品语义和事件分流以本 Spec §6、§7、§10 为准。
7. `docs/v2-design/12-event-driven-workorder-pipeline.md` 收窄为场景方案：单工单默认走 AutomationInvocation；只有事件明确启动一个含 N 个独立数据项的分析任务时才创建 TaskRun，且不再额外包一层 Invocation。

若代码、原型、验收报告与本 Spec 冲突：

- 已发生的代码行为记为 `AS-IS`；
- 本 Spec 记为 `TO-BE`；
- 不得用“代码现在就是这样”反向修改领域定义；
- 实施任务必须显式列出从 AS-IS 到 TO-BE 的迁移步骤。

---

## 3. 领域词汇与命名规范

### 3.1 产品词汇

| 中文产品名 | 领域名 | 当前持久化 | 含义 |
|---|---|---|---|
| 自动任务 | `AutomationDefinition` | `automation_definition` | 可重复触发 Agent、AgentFlow 或 Workflow 的定义 |
| 触发方式 | `AutomationTrigger` | `automation_trigger` | 配置型只有 schedule、api、event；manual 是动作，polling 是事件源采集模式 |
| 一次执行请求 | `AutomationInvocation` | 暂复用 `automation_trigger_log` | 一次触发的准入与派发事实 |
| Agent 会话 | `AgentSession` | AgentScope 真源；平台 `agent_session_index` 只建索引 | 单 Agent 的真实执行容器 |
| AgentFlow 运行 | `AgentFlowRun` | `agentflow_run` | 一个已发布 AgentFlow 的一次运行 |
| Workflow 运行 | `WorkflowRun` | 当前 `run`，但必须满足 `task_run_id IS NULL` | 确定性 Workflow 的一次运行 |
| 分析任务 | `AnalysisTask` | `analysis_task` | 针对一组数据记录的分析定义 |
| 分析批次 | `TaskRun` | `task_run` | 一次分析任务批量运行 |
| 单条分析 | `AnalysisItemRun` | 当前 `run`，且 `task_run_id IS NOT NULL` | 批次内一条 Interaction 的独立尝试 |
| 任务工作项 | `WorkItemProjection` | 无表 | 面向用户的统一执行读模型 |
| 入口事件 | `SourceEvent` | `data_source_event` | 外部数据源接收的一条事实 |
| 事件派发 | `EventDelivery` | `event_delivery` | 一条事件向一个触发规则的独立派发 |
| 入口攒批 | `IngressBatch` | 一期不存在 | 多个 SourceEvent 的可选接入层聚合 |

### 3.2 禁止混用

- 不再把 `AnalysisTask` DTO 命名为 `AutomationDefinitionDTO`。
- 不再把 `TaskRun` 称为“自动任务的一次运行”，应称为“分析批次”。
- 不再把 AgentFlow 的多个 NodeRun 称为“批次项”。
- 不再把 `AutomationTriggerLog` 仅称为“日志”；它承担一次 Invocation 的持久化事实，应逐步升级命名。
- 不再把看板卡片称为数据库实体；`WorkItem` 是投影。
- 不再把 `conversation_key`、`idempotency_key`、`source dedupe_key`、`poll cursor` 合并成同一个 key。

### 3.3 `run` 表的现实债务

当前 `run` 同时承担：

- 独立 Workflow Run；
- 分析 TaskRun 下的 Interaction Run；
- 部分 Agent 运行关联信息。

一期不要求立即拆表，但所有新查询必须用明确判定：

```text
AnalysisItemRun: run.task_run_id IS NOT NULL
WorkflowRun:     run.task_run_id IS NULL AND workflow_id IS NOT NULL
```

若一行既没有 `task_run_id`，也没有明确 workflow/agent 执行目标，应投影为诊断异常，不得猜测类型。

---

## 4. 总体领域模型

### 4.1 通用自动任务链

```text
AutomationDefinition
        │
        ├── Manual Trigger
        ├── Schedule Trigger
        ├── API Trigger
        ├── Event Trigger
        └── Polling Trigger
                 │
                 ▼
        AutomationInvocation
                 │
       admission / dedupe / mapping
                 │
        ┌────────┼─────────┐
        ▼        ▼         ▼
 AgentSession  AgentFlowRun  WorkflowRun
```

默认基数：

```text
1 Trigger Occurrence : 1 AutomationInvocation : 1 Target Execution
```

允许的例外只有：

- 幂等命中：多个重复请求返回同一个 Invocation；
- 事件过滤：产生 `filtered/deduped` 接收事实，但不创建 Invocation；
- 会话连续：不同 Invocation 可以指向同一个 Agent Session，但每次 Invocation 仍是独立事实；
- 入口攒批：未来多个 SourceEvent 先组成一个 IngressBatch，再产生一个或多个 Invocation。

### 4.2 分析批次链

```text
AnalysisTask
     │
     ▼
AnalysisTaskVersion ── 冻结配置
     │
     ▼
TaskRun ────────────── 一次分析批次
     │
     ├── AnalysisItemRun(interaction A, attempt 1)
     ├── AnalysisItemRun(interaction B, attempt 1)
     ├── AnalysisItemRun(interaction C, attempt 1)
     └── ...
               │
               ▼
      QualityResult / ResultDelivery
```

一个 `TaskRun` 被称为批次，必须同时满足：

1. 输入包含零到 N 个可枚举业务项；
2. 每个业务项有稳定 `interaction_ref`；
3. 每项有独立执行状态；
4. 每项可以独立失败；
5. 失败项可以独立重试并增加 attempt；
6. 批次能聚合 total/succeeded/failed/skipped/cancelled；
7. 取消批次时能停止未开始项，并尽力取消已运行项。

### 4.3 入口攒批链（未来可选）

```text
DataSourceEvent × N
        │
        ▼
IngressBatch
        │
        ├── one invocation with items[]
        └── N invocations with bounded fan-out
```

`IngressBatch` 与 `TaskRun` 的区别：

| 维度 | IngressBatch | TaskRun |
|---|---|---|
| 所属层 | 数据接入 | 分析执行 |
| 输入 | 外部事件 | DataSnapshot 中的分析记录 |
| 目的 | 限流、降调用成本、微批 | 完成一批独立分析 |
| 下游 | Agent/Flow/Workflow 任一种 | N 个 AnalysisItemRun |
| 是否一期建设 | 否 | 是 |

---

## 5. 核心不变量

### 5.1 定义与执行

- `INV-001`：`AutomationDefinition` 不保存实时运行状态；`last_auto_status` 只能作为缓存摘要，不能作为执行真相。
- `INV-002`：每次被接受的触发必须有稳定 Invocation ID。
- `INV-003`：每个 Invocation 最多关联一个顶层执行体。
- `INV-004`：一个 Invocation 不得同时填写 `session_id`、`workflow_run_id` 和 `agentflow_run_id` 中的多个。
- `INV-005`：Invocation 完成状态必须由真实执行体终态对账得出，不能在“派发成功”时写 completed。
- `INV-006`：HTTP 202 只表示请求已接受，不表示已开始或已完成。
- `INV-007`：删除或暂停定义不得删除历史 Invocation 和执行记录。

### 5.2 Session

- `INV-010`：Agent 执行必须以 AgentScope Session 为运行真源；平台只保存索引和业务关联。
- `INV-011`：fresh 策略每次 Invocation 创建新 Session。
- `INV-012`：conversation 策略只有显式 `conversation_key` 才允许复用 Session。
- `INV-013`：同一 `automation_id + conversation_key` 的输入顺序执行；不同 conversation 可以并发。
- `INV-014`：`conversation_key` 不参与幂等判断。
- `INV-015`：SessionIndex 必须在向运行时派发输入前持久化，避免执行中回调找不到 Session。

### 5.3 幂等与去重

- `INV-020`：API 幂等作用域为 `automation_id + idempotency_key`。
- `INV-021`：相同幂等键和相同请求摘要返回原 Invocation；不得重复派发。
- `INV-022`：相同幂等键但请求摘要不同返回 `409 IDEMPOTENCY_CONFLICT`。
- `INV-023`：事件去重作用域为 `source_id + dedupe_key`。
- `INV-024`：Schedule 使用稳定 `schedule_fire_key`，同一计划时点只接受一次。
- `INV-025`：运行重试使用新的 attempt/Invocation，不复写原失败执行事实。
- `INV-026`：每条 EventDelivery 只能产生一种顶层结果：AutomationInvocation、TaskRun、filtered、deduped 或 dead，不能同时创建 Invocation 和 TaskRun。

### 5.4 分析批次

- `INV-030`：TaskRun 启动时冻结 TaskVersion、数据快照、执行版本和规则版本。
- `INV-031`：同一 `task_run_id + interaction_ref + attempt` 唯一。
- `INV-032`：`processed_count = succeeded_count + failed_count + skipped_count + cancelled_count`。
- `INV-033`：任何时刻 `processed_count <= total`；若 total 尚未精确确定，必须返回 `total_state=estimating`，不得显示伪精确百分比。
- `INV-034`：缓存计数与子 Run 不一致时，以子 Run 聚合为修复来源，并产生诊断事件。
- `INV-035`：取消只影响本 TaskRun，不修改 AnalysisTask 定义，也不影响其他批次。
- `INV-036`：重试失败项创建新的 Recovery TaskRun，并在其中为失败项创建新 attempt；原 TaskRun 和原失败 Run 保持终态不变。
- `INV-037`：批次执行终态与结果投递终态分离。

### 5.5 任务看板

- `INV-040`：WorkItem 无数据库表，不双写。
- `INV-041`：同一真实工作在看板最多出现一次。
- `INV-042`：Invocation 已关联目标执行体时，以 Invocation 作为卡片稳定 ID，目标作为详情链接，不再单独投影一张重复卡。
- `INV-043`：没有 Invocation 的手工 Session、FlowRun、WorkflowRun 可以直接投影。
- `INV-044`：未知或矛盾状态进入 `needs_action`，不得静默归为 completed。
- `INV-045`：看板状态是映射结果，不能通过拖拽直接修改。

---

## 6. 自动任务定义 Spec

### 6.1 字段

```json
{
  "id": "auto_xxx",
  "name": "每日投诉摘要",
  "description": "汇总当天投诉并输出摘要",
  "target": {
    "kind": "agent | agentflow | workflow",
    "definitionId": "...",
    "releasePolicy": "pinned | latest_prod",
    "releaseId": "..."
  },
  "sessionPolicy": "fresh | conversation | stateful_schedule",
  "promptTemplate": "...",
  "inputMapping": {},
  "triggers": [],
  "admission": {
    "enabled": true,
    "maxRuns": null,
    "deadline": null,
    "maxConcurrentRuns": 1
  },
  "budget": {
    "maxDurationSeconds": null,
    "maxInputTokens": null,
    "maxOutputTokens": null,
    "maxToolCalls": null,
    "maxChildExecutions": null,
    "maxEstimatedCost": null,
    "currency": null,
    "enforcement": "hard | soft"
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

### 6.2 目标约束

- `target.kind=agent`：必须解析到可执行 Agent Release。
- `target.kind=agentflow`：必须解析到 active AgentFlowRelease。
- `target.kind=workflow`：必须解析到可运行的 WorkflowVersion。
- 保存后一期不允许原地修改 target kind；用户需要更换执行体类型时复制为新定义。
- pinned 目标必须冻结 release/version ID。
- latest 策略只在 Invocation 准入时解析一次，结果写入执行快照；运行中不得漂移。

### 6.3 Session 策略

| 策略 | 行为 | 适用场景 |
|---|---|---|
| `fresh` | 每次触发新建 Session | 独立事件、独立日报、无上下文任务 |
| `conversation` | 按 conversation_key 复用，并在同 key 内串行 | 同一工单持续处理、同一客户连续事件 |
| `stateful_schedule` | 定时任务复用固定 Session | 明确需要跨周期记忆的日常任务 |

约束：

- API 请求未提供 conversation_key 时，即使定义策略为 conversation，也应返回 422 或按明确配置回退 fresh；不得默认使用字符串 `default` 让所有调用共享一个 Session。
- AgentFlow 和 Workflow 一期不支持 conversation 复用，除非其运行契约显式定义 parent session。

### 6.4 触发方式

每个 AutomationDefinition 最多配置五个 trigger，但 trigger 的顶层类型只有三种：

```text
schedule | api | event
```

- manual/run-now 是即时操作，不占五个配置槽位；
- polling、webhook、MQ 是 event 所引用 DataSource 的采集模式，不应继续作为第四种产品触发类型；
- 当前数据库 `AutomationTrigger.kind=polling` 作为 AS-IS 兼容值保留，canonical DTO 归一为
  `kind=event, sourceMode=polling`；
- 同一自动任务可以配置多个同类型 trigger，例如两个 schedule + 一个 API + 两个 event，
  但总数不得超过五个。

#### Manual

- 用户在详情页点击“立即运行”；
- 创建 source=`manual` 的 Invocation；
- 不计入自动触发频次统计，但计入总运行历史。

#### Schedule

- 字段：cron、timezone、startAt、endAt；
- 使用稳定 fire key：`schedule:{trigger_id}:{planned_at_utc}`；
- 错过触发是否补跑由 misfire policy 决定，默认不补跑并记录 skipped；
- 禁用触发器只阻止未来 fire。

#### API

- 接收 JSON body；
- 先 schema 校验、幂等校验，再映射目标输入；
- 返回 202 与 Invocation 定位信息；
- API key 属于触发协议，即使人类登录后置也不能删除。

#### Event

- 引用一个 DataSource capability；
- 配置必须投影为 §10.0 的统一 `EventRoute`，不得在 AutomationDefinition 内另造一套事件字段；
- 顺序：接收 → 去重 → filter → mapping → EventDelivery → Invocation；
- 一条 SourceEvent 可命中多个 trigger，每个 trigger 使用独立 EventDelivery；
- 单个目标失败不能污染其他目标。

#### Event source mode: Polling

- polling 只负责获取变化和推进 cursor；
- 获取到的每个变化进入与 Event 相同的接收链；
- cursor 只有在接收事实持久化成功后才能推进；
- polling 调度不是 Agent 运行调度。

### 6.5 预算治理边界

预算属于自动执行的功能性运行策略，不属于人类用户 RBAC，因此不随登录/权限一起后置。

预算分两层：

| 层 | 字段示例 | 作用时点 |
|---|---|---|
| 准入预算 | maxRuns、maxConcurrentRuns、周期累计费用上限 | 创建 Invocation 前 |
| 单次执行预算 | duration、input/output tokens、tool calls、child executions、estimated cost | Invocation 运行中 |

规则：

- Invocation accepted 时冻结 `budget_snapshot`，后续修改定义不影响已开始执行；
- target adapter 只承诺其真实能测量和中断的维度；不支持硬限制时必须标记 `enforcement=soft`，不得显示“已受保护”；
- hard budget 命中后停止派发新的工具/子执行，尽力取消活动调用，Invocation 以 `FAILED/BUDGET_EXCEEDED` 结算；
- maxDuration 命中使用 `TIMED_OUT/EXECUTION_TIMED_OUT`，不与费用超限混为一类；
- soft budget 只产生告警与 needs_action，不伪造取消成功；
- 手动运行是否计入周期累计预算必须由定义字段明确，默认计入费用、但不计入 QoderWake 式自动运行次数；
- 预算使用量来自实际 target usage 汇总，不从 Prompt 或预估数字伪造；
- 分析 TaskRun 的总预算与 item 预算属于 §9 批次策略，不复用单 Invocation 计数器。

---

## 7. AutomationInvocation Spec

### 7.1 定位

`AutomationInvocation` 是一次触发的权威业务事实，当前复用 `automation_trigger_log` 持久化，后续可做无损表名迁移。

它负责：

- 保存触发来源与幂等事实；
- 保存准入结果；
- 关联唯一顶层执行体；
- 对账真实执行状态；
- 为自动任务历史和统一看板提供稳定 ID。

它不负责：

- 保存 Agent 消息全文；
- 保存 Flow 节点 trace；
- 保存 Workflow NodeRun；
- 保存分析批次子项；
- 代替目标执行体状态机。

### 7.2 目标字段

在现有 `AutomationTriggerLog` 基础上，目标模型补齐：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | Invocation ID |
| `automation_id` | string | 所属定义 |
| `trigger_id` | string? | 触发器；manual 可空 |
| `source` | enum | canonical 为 manual/schedule/api/event/test；AS-IS polling 归一为 event + sourceMode=polling |
| `idempotency_key` | string? | API 或 schedule fire key |
| `payload_sha` | string | 规范化输入摘要 |
| `conversation_key` | string? | 仅会话连续性 |
| `budget_snapshot` | json? | 准入时冻结的执行预算 |
| `usage_summary` | json? | 目标执行体回传的实际使用量摘要 |
| `status` | enum | 见状态机 |
| `target_kind` | enum? | agent_session/agentflow_run/workflow_run |
| `target_ref` | string? | 规范化目标 ID |
| `attempt` | int | 默认 1 |
| `retry_of_id` | string? | 重试来源 |
| `queued_at` | datetime? | 接受并入队时间 |
| `started_at` | datetime? | 真实目标开始时间 |
| `ended_at` | datetime? | 目标终态时间 |
| `error_code` | string? | 结构化错误码 |
| `error_detail` | json? | 脱敏诊断信息 |
| `created_at` | datetime | 接收时间 |
| `updated_at` | datetime | 最近对账时间 |

兼容期可以继续保留 `session_id/workflow_run_id/agentflow_run_id` 三列，但 DTO 只暴露：

```json
{"target":{"kind":"agent_session","id":"session_xxx"}}
```

### 7.3 状态机

```text
RECEIVED
   ├── DEDUPED
   ├── REJECTED
   └── ACCEPTED
          └── QUEUED
                 └── RUNNING
                        ├── SUCCEEDED
                        ├── FAILED
                        ├── CANCELLED
                        └── TIMED_OUT
```

规则：

- `RECEIVED`：入口事实已建立，尚未完成准入。
- `DEDUPED`：命中已有请求，不创建目标执行体，并返回原 Invocation 引用。
- `REJECTED`：定义禁用、过截止时间、达到 maxRuns、映射失败或目标不可执行。
- `ACCEPTED`：通过准入；必须最终进入 QUEUED 或失败终态。
- `QUEUED`：已创建平台作业/目标占位，但尚未获得执行资源。
- `RUNNING`：真实目标已经开始，而不是仅调用创建接口成功。
- `SUCCEEDED/FAILED/CANCELLED/TIMED_OUT`：由真实目标终态映射。

禁止状态：

- 不允许 `ACCEPTED → SUCCEEDED`，除非目标契约本身是同步且有真实终态证据；
- 不允许没有 target_ref 的 `RUNNING`；
- 不允许 target 仍 running 时 Invocation completed；
- 对账找不到目标时进入 `FAILED`，code=`TARGET_EXECUTION_MISSING`，同时在看板 needs_action。

### 7.4 准入顺序

一次触发必须按固定顺序处理：

1. 建立接收事实；
2. 校验定义和触发器存在；
3. 计算规范化 payload hash；
4. 校验幂等/去重；
5. 校验 enabled、deadline、maxRuns；
6. 校验 target release/version；
7. 执行 filter 与 input mapping；
8. 原子占用并发/运行次数；
9. 创建 Invocation accepted/queued；
10. 创建目标执行占位并写入 target_ref；
11. 异步启动真实执行；
12. watcher/event 回写 running 与终态。

任何步骤失败必须保留明确错误码；不得只把 Python `repr(exc)` 作为产品错误。

---

## 8. 三执行体适配契约

### 8.1 Agent Session Adapter

输入：

```json
{
  "automationId": "auto_xxx",
  "invocationId": "inv_xxx",
  "agentId": "agent_xxx",
  "releaseId": "rel_xxx",
  "prompt": "...",
  "conversationKey": null,
  "sessionPolicy": "fresh"
}
```

执行顺序：

1. 解析 release；
2. 根据策略创建或查找 Session；
3. 在平台写入 `AgentSessionIndex`，绑定 automation/invocation/release；
4. 生成仅用于该 Session 的内部工具回调令牌；
5. commit；
6. 再向 AgentScope 派发 prompt；
7. 运行时事件/轮询将 Invocation 更新为 running/terminal。

关键要求：

- 平台索引必须先于 chat trigger 可见；
- 运行时 Session 是消息、AgentState 和 AgentEvent 真源；
- 平台不得复制消息作为另一份会话真源；
- 内部回调令牌只在该 Session/Invocation 非终态期间有效；
- Session 终态后拒绝继续使用执行令牌。

### 8.2 AgentFlow Adapter

执行顺序：

1. 解析 active/pinned release；
2. 创建 `AgentFlowRun(status=queued)`；
3. 写入 Invocation.target_ref；
4. 提交事务并异步入队；
5. worker 将 FlowRun 置 running；
6. 每个节点开始前建立 `AgentFlowNodeRun`；
7. Agent 节点创建 Session 后立即登记 `session_id` 和 SessionIndex；
8. 节点输入、输出、错误与时间增量落库；
9. FlowRun 聚合终态；
10. Invocation 跟随 FlowRun 终态。

要求：

- `AgentFlowNodeRun.run_id` 是所属 FlowRun 的唯一反向字段；不得引用不存在的 `agentflow_run_id`；
- 前端必须能在运行中看到已开始和已结束节点；
- Flow SSE 读取平台 NodeRun 增量事实，Agent 消息下钻到 AgentScope Session；
- 一个 FlowRun 有多个节点，不等于批次；
- 只有 Flow 输入本身包含 N 个独立业务项，且产品明确提供逐项状态时，才可在 Flow 内部增加业务批量节点。

#### 8.2.1 脚本形态（16号稿）

AgentFlow 版本支持两种形态（`definition.kind` 判别，设计见
`docs/v2-design/16-wakerflow-script-agentflow.md`，2026-09-12 拍板 D1=子进程沙箱/D2=DAG 冻结共存/D3=NL 生成后置）：

- `dag`（现状）：节点/边表，拓扑顺序执行；
- `script`：Python 脚本为唯一事实源，五原语 `phase/log/worker/parallel/askUser` 在沙箱子进程内执行（响应走 127.0.0.1 一次性 TCP+令牌通道）；Canvas 降为 ast 投影（只读+跳行）。

脚本形态的执行事实模型与本节完全一致：仍产生 `AgentFlowRun`/`AgentFlowNodeRun`/SessionIndex，
事件沿用 `stage:{label}`+`flow:complete` 形状（另含 `phase/log/needs_input` 观测事件）；
`parallel` 是控制流并行，不是业务批次——不产生 TaskRun/AnalysisItemRun 语义。
askUser 挂起落 NodeRun(waiting)，经 `/mtc/script-resume` 恢复；waiting 不跨进程持久（已知边界）。

### 8.3 Workflow Adapter

执行顺序：

1. 解析并冻结 WorkflowVersion；
2. 创建 `Run(task_run_id=NULL)`；
3. 写入 Invocation.target_ref；
4. 进入现有 Workflow job queue；
5. NodeRun/RunEvent 增量记录；
6. Run 终态回写 Invocation。

要求：

- 自动任务只关联顶层 Workflow Run；
- Workflow 内 Agent 节点产生的 Session 通过 `workflow_run_id` 反链；
- Workflow Run 不得被包装进无数据项语义的 TaskRun。

---

## 9. 分析任务与 TaskRun Spec

### 9.1 AnalysisTask 定义

AnalysisTask 只面向批量分析，不承担通用 Autonomous Work。

定义至少包含：

- 数据资产与 DataDefinition；
- scope、sampling、dataWindow；
- 输入映射；
- Agent 或 Workflow 分析目标；
- 目标版本策略；
- 结果规则版本；
- 输出 schema；
- 结果投递配置。

### 9.2 TaskRun 创建

启动一次批次时必须原子冻结：

- `task_version_id`；
- `data_snapshot_id`；
- `resolved_agent_version_id` 或 `resolved_workflow_version_id`；
- `resolved_rule_version_id`；
- `runtime_binding_snapshot`；
- `output_binding_snapshot`；
- `idempotency_key/schedule_fire_key`。

创建接口返回 202：

```json
{
  "taskRunId": "tr_xxx",
  "status": "queued",
  "statusUrl": "/api/analysis-task-runs/tr_xxx"
}
```

#### 9.2.1 TaskRun 持久化增量

现有 `task_run` 已有冻结版本、total、成功/失败/跳过/取消计数和投递聚合，继续复用。
为满足本 Spec，目标迁移至少增加：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `processed_count` | int | 0 | 终态业务项缓存计数 |
| `total_state` | enum | estimating | estimating/exact |
| `cancel_requested_at` | datetime? | null | 取消请求时间 |
| `deadline_at` | datetime? | null | 批次硬截止时间 |
| `heartbeat_at` | datetime? | null | coordinator 最近心跳 |
| `retry_of_task_run_id` | string? | null | Recovery TaskRun 的来源批次 |
| `run_scope` | enum | all | all/failed_items/backfill |
| `retry_round` | int | 0 | 失败重试轮次 |
| `outcome_code` | string? | null | NO_ELIGIBLE_ITEMS 等终态说明 |
| `trigger` | enum | manual | 既有 manual/schedule/api/backfill 基础上扩展 `event`（§10.1.1 分支 B）；不得由此新增通用自动任务触发类型 |
| `source_event_id` | string? | null | 分支 B 时指向 `data_source_event.id`，否则 null |
| `event_delivery_id` | string? | null | 分支 B 时指向 `event_delivery.id`，与 §10.2.1 对账字段一致 |

约束与索引：

- `processed_count >= 0 AND processed_count <= total`（total_state=exact 时强校验）；
- `retry_of_task_run_id` 外键指向 `task_run.id`，删除时 restrict；
- `event_delivery_id` 非空时全表唯一（partial unique index），外键指向 `event_delivery.id`——一条 EventDelivery 在分支 B 最多产生一个 TaskRun；
- `source_event_id` 外键指向 `data_source_event.id`；
- `retry_of_task_run_id + retry_round` 唯一；
- `status + created_at`、`task_id + created_at` 保持索引；
- Recovery TaskRun 的 TaskVersion/DataSnapshot/解析版本必须与来源批次相同。

`task_run_error_agg` 建议独立表：

```text
task_run_id, category, code, count, sample_refs, first_seen_at, last_seen_at
UNIQUE(task_run_id, category, code)
```

`sample_refs` 只保留有限数量的 interaction_ref/run_id，不保存大段日志。

#### 9.2.2 JobQueue 增量

现有 `job_queue` 已有 `locked_at/locked_by/attempts/max_attempts`，但仅有锁字段不等于可靠租约。
目标契约增加或等价提供：

| 字段 | 说明 |
|---|---|
| `lease_expires_at` | 到期后允许其他 worker reclaim |
| `heartbeat_at` | 长任务延长租约 |
| `owner_run_id` | 关联 AnalysisItemRun/FlowRun 等执行占位 |
| `cancel_requested_at` | worker 的协作式取消信号 |

claim 必须是数据库原子操作；PostgreSQL 部署可使用
`SELECT ... FOR UPDATE SKIP LOCKED`，但测试必须覆盖 worker 崩溃、租约到期、重复 claim
和幂等完成，不能把 SQL 语句本身当作可靠性证明。

### 9.3 批次状态机

```text
QUEUED
  ├── FAILED              初始化失败
  └── RUNNING
        ├── SUCCEEDED     全部应处理项成功，无失败/取消
        ├── PARTIAL       至少一项成功，且存在失败/取消
        ├── FAILED        无成功项，或批次级致命错误
        ├── CANCELLING
        │      └── CANCELLED
        └── TIMED_OUT
```

空数据集不是失败：

```text
total=0 → SUCCEEDED + outcome_code=NO_ELIGIBLE_ITEMS
```

但数据源读取失败、定义解析失败、快照不一致属于 FAILED。

### 9.4 计数定义

| 字段 | 含义 |
|---|---|
| `total` | 快照中最终纳入批次的业务项数量 |
| `processed_count` | 已进入终态的业务项数量 |
| `succeeded_count` | 最新有效 attempt 成功的业务项 |
| `failed_count` | 最新有效 attempt 失败的业务项 |
| `skipped_count` | 因 eligibility/dedupe/sampling 等未执行项 |
| `cancelled_count` | 因批次取消未完成的项 |
| `active_count` | 当前 queued/running 的项，查询或缓存值 |

重试后的计数按 `interaction_ref` 最新 attempt 计算，不能把历史失败 attempt 与成功 attempt 同时计入批次失败总数。

历史失败仍保留在 attempt 详情与错误趋势中。

### 9.5 调度与并发

一期采用现有 PostgreSQL `job_queue` 和有界 worker，不建设通用分布式调度平台。

建议流程：

1. TaskRun coordinator 读取并冻结 DataSnapshot；
2. 尽早写入精确 total；
3. 按 chunk 创建/入队 AnalysisItemRun；
4. worker 通过带租约的原子 claim 获取工作；
5. 每个 worker 只处理一个 item attempt；
6. 完成后原子更新 Run，并增量刷新 TaskRun 计数；
7. coordinator/watcher 负责聚合终态与崩溃恢复。

并发必须至少分三层：

| 层 | 配置 | 目的 |
|---|---|---|
| 系统 worker 并发 | 全局配置 | 保护服务与数据库 |
| 分析任务并发 | `maxConcurrentItems` | 控制单任务占用 |
| 模型/资源并发 | resource limit | 遵守 Provider QPS/并发限制 |

禁止让一个大 TaskRun 长时间独占唯一 worker；禁止一次性把百万条 Run 全部加载到内存。

### 9.6 租约与恢复

每个可执行 job 需要：

- `locked_at`；
- `locked_by`；
- `heartbeat_at` 或可推导心跳；
- `lease_expires_at`；
- `attempts/max_attempts`。

恢复规则：

- lease 过期且目标 Run 非终态：重新入队相同 attempt 或按错误类型创建新 attempt；策略必须固定；
- 已产生外部副作用时不得盲目重跑，必须使用幂等输出键；
- TaskRun running 但所有子项终态：watcher 重算并关闭 TaskRun；
- TaskRun running 且无活跃子项、仍有未派发项：恢复 coordinator；
- 缓存计数不一致：从子 Run 修复并记录 `COUNTER_RECONCILED`。

### 9.7 取消

`POST /api/analysis-task-runs/{id}/cancel` 语义：

1. TaskRun 置 `cancelling`，写 `cancel_requested_at`；
2. coordinator 停止创建新 item job；
3. queued item 标记 cancelled；
4. running item 发出尽力取消；不支持中断的执行允许自然结束；
5. 所有 item 终态后 TaskRun 置 cancelled；
6. 已产生的成功结果保留；
7. 结果投递默认停止创建新投递，但已在途投递按自身幂等策略结算。

重复 cancel 返回同一状态，不报错。

### 9.8 超时

区分：

- item timeout：单条分析超过限制，当前 attempt failed/code=`ITEM_TIMEOUT`；
- batch deadline：整个 TaskRun 超过 deadline，转 `timed_out` 并执行取消流程；
- provider timeout：外部模型调用超时，按 retry policy 决定同 attempt 内重试还是新 attempt。

任何 timeout 都必须有开始、截止和最终结算证据，不能只在 UI 计算“疑似超时”。

### 9.9 重试失败项

`POST /api/analysis-task-runs/{id}/retry-failed`：

- 只选择最新 attempt 为 failed 的 interaction_ref；
- 创建一个新的 `TaskRun`，通过 `retry_of_task_run_id` 指向原批次；
- 新批次标记 `run_scope=failed_items`，只包含被选择的失败项；
- 为每项创建 `attempt + 1`，并把 attempt 链关联回原 AnalysisItemRun；
- 继续绑定原 TaskVersion、DataSnapshot、规则版本与执行版本；
- 不随当前 AnalysisTask 编辑结果漂移；
- 接口支持 Idempotency-Key；
- 原 TaskRun 保持原终态，状态机不发生 terminal → running 反转；
- 新 TaskRun 是普通批次实体，不另造 RecoveryRun 表；UI 显示“失败重试 #1”及来源批次链接；
- 多次点击在同一 Idempotency-Key 下返回同一个 Recovery TaskRun。

响应：

```http
HTTP/1.1 202 Accepted
Location: /api/analysis-task-runs/tr_recovery_xxx
```

```json
{
  "taskRunId": "tr_recovery_xxx",
  "retryOfTaskRunId": "tr_original_xxx",
  "selectedItems": 20,
  "status": "queued"
}
```

### 9.10 执行与投递双状态

执行状态回答“分析完成了吗”；投递状态回答“结果写到目标了吗”。

```text
executionStatus: queued/running/partial/succeeded/failed/cancelled/timed_out
deliveryStatus:  not_configured/pending/running/succeeded/partial/failed/dead_letter
```

禁止：

- `execution=succeeded` 推导 `delivery=succeeded`；
- 因投递失败把已成功的分析 Run 改成 failed；
- 看板只显示 completed 而隐藏投递失败。

---

## 10. 数据接入与 EventDelivery Spec

### 10.0 唯一事件路由契约

`EventRoute` 是“某类来源事件满足什么条件后送往哪里”的逻辑契约。11 号总体架构、
12 号工单场景、自动任务事件触发 UI 和分析任务事件触发 UI 都必须使用这一形状。

```json
{
  "id": "route_xxx",
  "sourceId": "source_xxx",
  "eventType": "ticket.created",
  "destination": {
    "kind": "automation | analysis_task",
    "id": "auto_xxx"
  },
  "filter": {
    "version": 1,
    "expression": {}
  },
  "mapping": {
    "version": 1,
    "fields": {}
  },
  "dedupe": {
    "keyPath": "event.id",
    "windowSeconds": 86400
  },
  "completionPolicy": "accepted | terminal",
  "retryPolicy": {
    "maxAttempts": 3,
    "backoff": "exponential",
    "maxDelaySeconds": 300
  },
  "enabled": true,
  "revision": 1
}
```

字段所有权：

| 字段 | 所有者 | 说明 |
|---|---|---|
| sourceId/eventType | 数据接入层 | 从哪里接收哪类事件 |
| filter/mapping/dedupe | EventRoute | 入站确定性治理，不进入 Prompt 临时判断 |
| destination | EventRoute | 每条 route 只能选 automation 或 analysis_task |
| target Agent/Flow/Workflow | AutomationDefinition | route 不重复保存执行者 |
| DataSnapshot/sampling/rules | AnalysisTaskVersion | route 不重复保存分析配置 |
| retry/completionPolicy | EventRoute/EventDelivery | 控制派发，不改目标执行体内部重试 |

版本规则：

- 修改 route 递增 revision；
- EventDelivery 创建时冻结 `route_id + route_revision` 及 filter/mapping 摘要；
- retry 使用原 revision，不随当前 route 编辑漂移；
- 禁用 route 只阻止新 EventDelivery，不取消已创建的目标执行；
- 删除 route 采用归档语义，历史 delivery 仍可追踪。

持久化兼容：

- 当前 `automation_trigger(kind=event|polling)` 可以作为
  `destination=automation` 的 AS-IS 存储与兼容 API；
- `destination=analysis_task` 的物理表或通用迁移，必须在首个真实场景中根据查询、
  版本和外键要求决定；不得仅为统一命名就迁移全部历史触发器；
- 无论最终使用一张 `event_route` 表还是两个 owner-specific 表，对外 DTO、状态语义和
  EventDelivery 关联都必须遵循上述唯一契约。

### 10.1 默认一事件一目的地派发

一期默认：

```text
1 DataSourceEvent
  → N EventDelivery（每个命中 trigger 一条）
  → 每个 EventDelivery 恰好选择一种目的地
       ├── destination=automation    → 最多 1 AutomationInvocation
       └── destination=analysis_task → 最多 1 TaskRun
```

这里的 N 表示同一事件可以命中多条显式 route，不表示一条 route 可以双发。

#### 10.1.1 目的地选择

| 业务语义 | destination | 顶层执行事实 | 判断依据 |
|---|---|---|---|
| 一条事件启动一次 Agent/Flow 工作 | automation | AutomationInvocation | 单个工作目标，不需要 N 项独立状态 |
| 一条事件继续同一工单上下文 | automation | AutomationInvocation → existing Session | 显式 conversation_key |
| 一条事件通知“对某个数据窗口跑一次分析” | analysis_task | TaskRun | 映射结果能形成 DataSnapshot 和 N 个独立项 |
| 高频单事件希望合并后再跑 | 暂不支持 | 未来 IngressBatch | 必须通过 §10.3 门槛 |

事件路由到 AnalysisTask 时：

- EventDelivery 直接关联 `task_run_id`；
- TaskRun.trigger 扩展为 `event`；
- TaskRun 保存 `source_event_id/event_delivery_id` 或等价可追踪引用；
- 仍然冻结 TaskVersion、DataSnapshot、执行版本、规则版本和输出配置；
- 不创建一个没有独立业务价值的 AutomationInvocation 包裹 TaskRun；
- 如果 payload 只代表一条工单且不需要逐项批次语义，必须走 automation 分支，不能为了复用 TaskRunner 强塞 AnalysisTask。

处理步骤：

1. 校验入口凭据和 payload 大小；
2. 建立 SourceEvent；
3. 用 `source_id + dedupe_key` 去重；
4. 匹配 trigger；
5. 确定性 filter；
6. 确定性 mapping；
7. 为每个目标 route 建立 EventDelivery；
8. 按 destination 派发 Invocation 或创建 TaskRun；
9. 记录 retry/dead letter；
10. 保留 source event → delivery → invocation 或 task run → execution 全链路引用。

### 10.2 EventDelivery 状态

```text
PENDING → RUNNING → COMPLETED
                  ├→ FAILED → PENDING（可重试）
                  └→ DEAD
```

`COMPLETED` 表示成功建立或结算目标派发契约，是否要求等待目标执行完成由字段 `completion_policy` 决定：

- `accepted`：Invocation accepted 即完成 delivery；默认；
- `terminal`：目标执行终态后才完成；仅业务明确要求端到端确认时使用。

当 destination=analysis_task 时，上述 Invocation 分别替换为 TaskRun queued 与 TaskRun terminal。

#### 10.2.1 EventDelivery 目标字段

为支持唯一目的地，EventDelivery 目标模型至少需要：

| 字段 | 说明 |
|---|---|
| `route_id` | 命中的 EventRoute |
| `route_revision` | 创建时冻结的 route 版本 |
| `destination_kind` | automation/analysis_task |
| `destination_id` | AutomationDefinition 或 AnalysisTask ID |
| `invocation_id` | automation 分支结果，可空 |
| `task_run_id` | analysis_task 分支结果，可空 |
| `completion_policy` | accepted/terminal |

数据库约束：

```text
(destination_kind='automation' AND invocation_id IS NOT NULL AND task_run_id IS NULL)
OR
(destination_kind='analysis_task' AND task_run_id IS NOT NULL AND invocation_id IS NULL)
```

在派发尚未创建目标的 pending/running 阶段，两种结果引用都可为空；进入 completed 后必须
满足上述 XOR。当前 `trigger_id/automation_id/trigger_log_id` 作为兼容列保留至旧 API 零流量。

状态语义必须在 API 中暴露，不能让用户猜 completed 指“已派发”还是“业务已完成”。

### 10.3 入口攒批启用门槛

只有满足至少一项且给出实测数据，才允许设计 `IngressBatch`：

- 稳态事件吞吐超过当前单事件派发能力；
- p95 排队延迟超过业务 SLO；
- 下游明确提供 bulk API；
- 单次模型调用固定成本显著，合并后可量化节省；
- 下游 QPS/并发限制导致单事件模式持续退避；
- 业务天然按窗口结算，例如每 5 分钟一组告警。

同时必须明确：

- 最大等待时间；
- 最大条数或字节数；
- group key；
- flush 原子性；
- 单项错误如何返回；
- 整批失败如何重试；
- 是否允许乱序；
- 重放是否重复产生外部副作用。

在这些数据缺失时，禁止新增通用 `batch_group` 表和“批次 lane”。

---

## 11. 统一 WorkItemProjection Spec

### 11.1 定位

统一任务看板回答：

> 现在有哪些工作在等待、运行、完成或需要处理？

它不回答完整配置，也不替代各执行体详情。

### 11.2 来源

| kind | 来源 | 稳定 ID |
|---|---|---|
| `automation_invocation` | Invocation + target 摘要 | `invocation:{id}` |
| `agent_session` | 无 Invocation 的手工 Session | `session:{id}` |
| `agentflow_run` | 无 Invocation 的手工 FlowRun | `agentflow:{id}` |
| `workflow_run` | 无 Invocation 的手工 WorkflowRun | `workflow:{id}` |
| `analysis_batch` | TaskRun | `taskrun:{id}` |
| `schedule_occurrence` | 尚未触发的计划 | `occurrence:{id}` |

去重规则：

- Invocation 有 target_ref：只投影 Invocation 卡片；
- target 详情从卡片链接进入；
- 没有 Invocation 的手工执行直接投影；
- occurrence 触发并关联 Invocation/TaskRun 后，保持 occurrence 稳定 ID或使用 alias，前端不得闪现双卡；
- 分析 TaskRun 不再同时以 Workflow Run 展示。

### 11.3 统一状态

产品一级状态固定为：

```text
queued
running
completed
needs_action
failed_cancelled
```

映射：

| 原始状态 | WorkItem 状态 |
|---|---|
| received/accepted/queued/planned | queued |
| running/cancelling/result_processing | running |
| succeeded 且无后续失败 | completed |
| partial、投递失败、状态矛盾、关系缺失 | needs_action |
| failed/cancelled/timed_out/dead | failed_cancelled |

每条 WorkItem 必须同时返回：

- `status`：一级状态；
- `phase`：细分阶段；
- `rawStatus`：来源对象原状态；
- `attention`：严重度、错误码、摘要；
- `target`：真实执行体链接；
- `progress`：仅对有可信 total 的批次返回百分比；
- `diagnostics`：仅开发/运维视图使用。

### 11.4 DTO

```json
{
  "id": "invocation:inv_xxx",
  "kind": "automation_invocation",
  "title": "每日投诉摘要",
  "status": "running",
  "phase": "agent_working",
  "rawStatus": "running",
  "origin": "schedule",
  "startedAt": "...",
  "endedAt": null,
  "durationMs": 18342,
  "definition": {"kind":"automation","id":"auto_xxx"},
  "target": {"kind":"agent_session","id":"session_xxx"},
  "progress": null,
  "counts": null,
  "attention": null,
  "links": {
    "detail": "/tasks/invocation:inv_xxx",
    "target": "/sessions/session_xxx"
  }
}
```

批次 WorkItem 的 `progress/counts`：

```json
{
  "progress": {"processed": 820, "total": 1000, "percent": 82},
  "counts": {"succeeded": 790, "failed": 20, "skipped": 10, "cancelled": 0}
}
```

### 11.5 实时更新

一期使用 SSE 发送轻量 refresh/event：

```json
{
  "sequence": 1842,
  "type": "work_item_changed",
  "workItemId": "taskrun:tr_xxx",
  "changedFields": ["status", "progress"],
  "serverTime": "..."
}
```

- SSE 不是第二状态源；收到后可增量拉详情或刷新当前窗口；
- 断线使用 Last-Event-ID/sequence 续接；
- 无法续接时重新拉当前列表；
- SSE 不可用时退化到 5 秒轮询；
- 页面必须有手动刷新；
- 不允许每 2 秒对每张卡执行独立 COUNT 查询。

---

## 12. API Spec

### 12.1 命名迁移原则

目标 API 命名：

| 领域 | Canonical API | 当前兼容 API |
|---|---|---|
| 通用自动任务 | `/api/v2/automations` | 保持 |
| Invocation | `/api/v2/invocations` | `/api/v2/automations/{id}/history` |
| 分析任务 | `/api/analysis-tasks` | `/api/tasks`、旧 `/api/automations` |
| 分析批次 | `/api/analysis-task-runs` | `/api/task-runs`、Operations 旧接口 |
| 统一任务看板 | `/api/v2/work-items` | `/api/work-items` |
| 事件路由 | `/api/v2/event-routes` | AS-IS `automation_trigger(kind=event|polling)` |
| 事件派发 | `/api/v2/event-deliveries` | 无独立旧端点，现内嵌于数据源详情 |

迁移要求：

- 一期新增 canonical alias，旧 API 不删除；
- 新前端停止调用旧 `/api/automations` 表示 AnalysisTask；
- 响应增加 `Deprecation`/文档提示，但不影响现有客户端；
- 观察期内记录旧 API 调用量；
- 无外部调用后再安排删除，删除不属于本 Spec 首批实施。

### 12.2 自动任务

```http
GET    /api/v2/automations
POST   /api/v2/automations
GET    /api/v2/automations/{id}
PUT    /api/v2/automations/{id}
DELETE /api/v2/automations/{id}
POST   /api/v2/automations/{id}/run-now
POST   /api/v2/automations/{id}/enable
POST   /api/v2/automations/{id}/disable
GET    /api/v2/automations/{id}/invocations
```

`run-now`：

```http
POST /api/v2/automations/auto_xxx/run-now
Idempotency-Key: user-defined-key
Content-Type: application/json
```

```json
{
  "input": {},
  "conversationKey": null
}
```

响应：

```http
HTTP/1.1 202 Accepted
Location: /api/v2/invocations/inv_xxx
```

```json
{
  "invocationId": "inv_xxx",
  "status": "accepted",
  "statusUrl": "/api/v2/invocations/inv_xxx"
}
```

### 12.3 Invocation

```http
GET  /api/v2/invocations/{id}
POST /api/v2/invocations/{id}/cancel
POST /api/v2/invocations/{id}/retry
GET  /api/v2/invocations/{id}/events
```

取消支持矩阵：

| Target | 一期语义 |
|---|---|
| Agent Session | 调用运行时取消；不支持时标记 cancel_requested，等待终态 |
| AgentFlowRun | 停止未开始节点，尽力取消活动 Session |
| WorkflowRun | 复用现有 Run cancel |

重试：

- 新建 Invocation；
- `retry_of_id` 指向原记录；
- 默认使用原冻结 target release 和规范化输入；
- 用户若修改输入，应视为新 run-now，不是 retry。

### 12.4 分析任务与批次

```http
GET    /api/analysis-tasks
POST   /api/analysis-tasks
GET    /api/analysis-tasks/{id}
PUT    /api/analysis-tasks/{id}
POST   /api/analysis-tasks/{id}/runs
GET    /api/analysis-tasks/{id}/runs

GET    /api/analysis-task-runs/{id}
GET    /api/analysis-task-runs/{id}/summary
GET    /api/analysis-task-runs/{id}/items
POST   /api/analysis-task-runs/{id}/cancel
POST   /api/analysis-task-runs/{id}/retry-failed
GET    /api/analysis-task-runs/{id}/events
```

summary 响应至少包含：

```json
{
  "id": "tr_xxx",
  "status": "running",
  "totalState": "exact",
  "total": 1000,
  "processed": 820,
  "active": 30,
  "counts": {
    "succeeded": 790,
    "failed": 20,
    "skipped": 10,
    "cancelled": 0
  },
  "ratePerSecond": 4.7,
  "etaSeconds": 38,
  "topErrors": [
    {"category":"provider","code":"LLM_TIMEOUT","count":14}
  ],
  "executionStatus": "running",
  "deliveryStatus": "not_configured"
}
```

### 12.5 统一看板

```http
GET /api/v2/work-items
GET /api/v2/work-items/{id}
GET /api/v2/work-items/stream
```

筛选：

- `dateFrom/dateTo/timezone`；
- `status`；
- `kind`；
- `origin`；
- `definitionId`；
- `targetId`；
- `attentionOnly`；
- `q`；
- cursor/pageSize。

counts 必须基于筛选后的完整事实集，不是当前页。

### 12.6 事件路由与派发

EventRoute/EventDelivery 是 §10 唯一事件契约的 API 面。`destination=automation` 的
AS-IS 存储为 `automation_trigger(kind=event|polling)`，继续通过
`/api/v2/automations/{id}` 的 trigger DTO 暴露，同时提供本节的统一 DTO 视图。

```http
GET    /api/v2/event-routes?sourceId=&destinationKind=&enabled=
POST   /api/v2/event-routes
GET    /api/v2/event-routes/{id}
PUT    /api/v2/event-routes/{id}
DELETE /api/v2/event-routes/{id}

GET    /api/v2/event-deliveries?sourceEventId=&status=&destinationKind=&dateFrom=&dateTo=
GET    /api/v2/event-deliveries/{id}
POST   /api/v2/event-deliveries/{id}/retry
```

要求：

- route 的 POST/PUT 返回递增后的 `revision`；`destination.kind` 只允许 `automation|analysis_task`，且与 `destination.id` 指向的实体类型强一致；
- DELETE 采用 §10.0 归档语义（enabled=false + archived 标记），不物理删除；
- delivery 列表/详情必须暴露 §10.2 状态机字段与 `route_id/route_revision/destination_kind/invocation_id/task_run_id` 关联；`completion_policy` 语义必须在响应中可读，不得让用户猜 completed 指“已派发”还是“业务已完成”；
- `retry` 只接受 FAILED/DEAD，并使用创建时冻结的 `route_revision`；
- SourceEvent → delivery 流水查询必须能区分 filtered、deduped、dead 证据（AC-023/AC-024）。

---

## 13. 错误码

### 13.1 Invocation

| code | 含义 | 是否可重试 |
|---|---|---:|
| `AUTOMATION_DISABLED` | 定义已暂停 | 否，先启用 |
| `AUTOMATION_DEADLINE_PASSED` | 已过截止时间 | 否 |
| `AUTOMATION_MAX_RUNS_REACHED` | 达到最大运行次数 | 否，先改配置 |
| `TARGET_NOT_FOUND` | 目标定义不存在 | 否 |
| `TARGET_NOT_EXECUTABLE` | 无 active release/version | 否 |
| `INPUT_MAPPING_FAILED` | 输入映射失败 | 修改配置后可重发 |
| `IDEMPOTENCY_CONFLICT` | 同 key 不同 payload | 否，换 key |
| `CONCURRENCY_LIMIT_REACHED` | 并发达到上限 | 是，可排队 |
| `TARGET_EXECUTION_MISSING` | Invocation 目标反链损坏 | 需人工处理 |
| `DISPATCH_FAILED` | 派发失败 | 按错误分类 |
| `EXECUTION_TIMED_OUT` | 执行超时 | 是 |

### 13.2 分析批次

| category | 示例 code |
|---|---|
| 数据 | `DATA_SOURCE_UNAVAILABLE`、`SNAPSHOT_MISMATCH`、`INVALID_RECORD` |
| 映射 | `INPUT_MAPPING_FAILED`、`OUTPUT_SCHEMA_MISMATCH` |
| 运行时 | `AGENT_SESSION_FAILED`、`WORKFLOW_FAILED`、`ITEM_TIMEOUT` |
| Provider | `LLM_TIMEOUT`、`RATE_LIMITED`、`MODEL_UNAVAILABLE` |
| 工具 | `TOOL_FAILED`、`MCP_UNAVAILABLE`、`KNOWLEDGE_LOOKUP_FAILED` |
| 投递 | `DELIVERY_FAILED`、`DELIVERY_DEAD_LETTER` |
| 平台 | `LEASE_EXPIRED`、`COUNTER_RECONCILED`、`INTERNAL_ERROR` |

错误聚合保存 category/code/count 与有限代表样本，不在聚合表复制全部错误正文。

---

## 14. 前端产品 Spec

### 14.1 导航与页面职责

建议一级产品对象：

- **任务**：统一 WorkItem 看板/列表；
- **自动任务**：QoderWake 式定义列表、编辑、详情与运行历史；
- **分析任务**：数据集批量分析定义；
- **运行详情**：按 Session、Flow、Workflow、Batch 类型下钻；
- **数据源**：Webhook/Polling/Event 接入与健康状态。

不建议继续把分析任务和通用自动任务放在同一个“自主任务”列表中。

### 14.2 自动任务列表

每行显示：

- 名称；
- 目标类型与目标名称；
- 触发方式；
- enabled/paused；
- 最近一次 Invocation 状态；
- 最近执行时间；
- 运行次数；
- 下次计划时间；
- 快捷操作：立即运行、暂停/启用、查看详情。

列表不显示批次成功率，因为单次自动任务不是批次。

### 14.3 自动任务详情

分区：

1. 定义摘要；
2. 执行目标；
3. 触发方式；
4. 输入与 mapping 预览；
5. Session 策略；
6. 准入限制；
7. Invocation 历史；
8. 最近一次执行详情入口。

运行历史每行是一条 Invocation：

- source；
- status；
- target execution；
- 开始/结束/耗时；
- conversation key（脱敏展示）；
- retry relation；
- error code。

### 14.4 分析批次详情

头部必须在 5 秒内回答：

- 这批是什么；
- 是否还在运行；
- 处理了多少；
- 成功/失败/跳过/取消多少；
- 当前速度和预计剩余；
- 错误主要集中在哪里；
- 结果是否已经投递；
- 能否取消或重试失败项。

页面结构：

```text
批次标题 + execution/delivery 双状态
分段进度条 + processed/total
四类计数 + rate/ETA
Top errors
操作：取消 / 重试失败项

Tabs:
  Items | Error analysis | Delivery | Frozen config | Events
```

### 14.5 统一任务看板

- 看板与列表可切换；
- 支持 kind 筛选，而不是增加“批次专属 lane”；
- lane 按状态，不按执行类型；
- 卡片用类型图标区分 Session/Flow/Workflow/Batch；
- 进度条只对 Analysis Batch 展示；
- Flow 卡片展示阶段/节点摘要，不伪装成 processed/total；
- 状态颜色必须配文字和图标，不用颜色作为唯一信息；
- 不允许拖拽修改系统状态。

---

## 15. 可观测性

### 15.1 关联字段

全链路至少能从以下任一 ID 追踪：

```text
source_event_id
event_delivery_id
automation_id
invocation_id
session_id / agentflow_run_id / workflow_run_id
task_run_id
analysis_item_run_id
trace_id
```

### 15.2 事件

关键事件：

- invocation.received/accepted/queued/running/succeeded/failed/cancelled/timed_out；
- session.created/started/terminal；
- flow.node.started/terminal；
- task_run.snapshot.created；
- task_run.progress.updated；
- task_run.cancel.requested/completed；
- task_run.retry.started/completed；
- event_delivery.retry/dead；
- counter.reconciled。

### 15.3 指标

自动任务：

- invocation accepted/rejected/deduped 数；
- queue wait p50/p95；
- execution duration p50/p95；
- success/failure/timeout rate；
- 按 target kind 分组；
- conversation queue depth。

分析批次：

- batch duration；
- item throughput；
- item success/failure rate；
- active/queued jobs；
- lease expiry/recovery 数；
- token/cost 聚合；
- delivery failure/dead letter 数。

一期可以先落结构化事件和数据库聚合；OTel/外部指标平台属于后续增强，但字段不能被日志字符串替代。

---

## 16. 功能优先阶段的安全边界

本阶段明确不做：

- 用户注册和登录页；
- 人类用户 Session；
- viewer/operator/admin RBAC；
- 团队数据范围；
- 权限管理 UI；
- OIDC/SSO。

但以下不是“后台权限功能”，而是执行正确性的一部分，必须保留：

1. 自动任务 API trigger key：避免任何调用者随意触发付费执行；
2. webhook/data source token 或签名：避免伪造外部事件；
3. Agent Session/Flow 内部工具回调 token：确保工具调用关联真实活动执行；
4. 幂等键：避免网络重试造成重复执行和重复费用；
5. 出站目标 allowlist/SSRF 防护：避免 Agent 或配置访问平台内网；
6. payload 大小限制与敏感字段脱敏：避免事故和日志泄露。

开发模式可以使用固定本地身份，但必须显式标记 `DEV_IDENTITY`；不能声称可直接公开部署。

---

## 17. 非功能要求

### 17.1 一致性

- 创建 Invocation 与占用幂等键必须在同一事务；
- 创建目标占位与写 target_ref 应避免出现不可恢复半状态；无法同事务时使用 outbox/job 补偿；
- 所有终态更新幂等；
- watcher 重复执行不得重复创建目标。

### 17.2 性能

- 列表查询禁止逐卡 N+1；
- 批次详情计数使用聚合/缓存，但可从子 Run 重建；
- 分析 items 使用 cursor 分页；
- 大 payload 不重复存储在 Invocation、EventDelivery 和 target run 多处；保存引用和摘要；
- SSE 不进行每连接全量高频投影。

### 17.3 数据保留

- 定义长期保留；
- Invocation 元数据长期保留或按产品周期归档；
- 原始 SourceEvent payload 设置可配置 TTL；
- Session 消息遵循 AgentScope 保留策略；
- 批次结果和投递证据遵循业务数据周期；
- 删除定义不级联删除历史运行。

### 17.4 时间

- 数据库存 UTC；
- API 使用 RFC 3339；
- schedule 保存 IANA timezone；
- UI 按用户选择时区显示；
- DST 场景必须有调度测试。

---

## 18. 验收标准

### 18.1 自动任务核心闭环

- `AC-001`：手动运行 Agent 自动任务返回 202 和 Invocation ID；随后可查询到 Session ID、running、terminal。
- `AC-002`：Agent SessionIndex 在首个工具回调前已存在。
- `AC-003`：运行中 Session 的回调成功；终态后的回调 token 失效。
- `AC-004`：AgentFlow run-now 不阻塞 HTTP；Flow 节点状态逐步出现，不在结束后一次性补写。
- `AC-005`：Workflow 自动任务产生独立 Workflow Run，不产生 TaskRun。
- `AC-006`：暂停定义后新触发 rejected，已运行执行不被取消。
- `AC-007`：maxRuns 并发触发下不超发。

### 18.2 幂等和会话

- `AC-010`：相同 automation + idempotency key + payload 重复请求返回同一 Invocation。
- `AC-011`：相同 key 不同 payload 返回 409。
- `AC-012`：相同 conversation key 的两个 Invocation 复用同一 Session 并顺序执行。
- `AC-013`：不同 conversation key 可以并发。
- `AC-014`：没有 conversation key 的 fresh 触发创建不同 Session。

### 18.3 事件链

- `AC-020`：同一 source + dedupe key 只派发一次。
- `AC-021`：一条事件命中两个 trigger 时产生两个独立 EventDelivery。
- `AC-022`：一个 delivery 失败不影响另一个完成。
- `AC-023`：filter 未命中有明确 filtered 证据，不创建 Invocation。
- `AC-024`：mapping 失败有结构化错误和有限重试，最终可进入 dead。
- `AC-025`：destination=automation 的 EventDelivery 只创建 Invocation，不创建 TaskRun。
- `AC-026`：destination=analysis_task 的 EventDelivery 只创建一个冻结完成的 TaskRun，不创建 Invocation 包装层。
- `AC-027`：同一 SourceEvent 命中两条不同 route 时允许分别产生 Invocation 和 TaskRun，但两者来自不同 EventDelivery，链路可区分。

### 18.4 分析批次

- `AC-030`：100 条样本启动后尽早显示 total=100，运行中 processed 单调递增。
- `AC-031`：计数满足 processed=success+failed+skipped+cancelled。
- `AC-032`：并发不超过 task/resource 配额。
- `AC-033`：取消后不再派发新项，活动项最终结算，批次进入 cancelled。
- `AC-034`：retry-failed 只为失败 interaction 创建下一 attempt，成功项不重跑。
- `AC-035`：重试仍使用原冻结版本。
- `AC-035A`：retry-failed 创建新的 Recovery TaskRun；原批次保持终态，重复请求不会创建多个恢复批次。
- `AC-036`：worker 崩溃后 lease 到期可恢复，不重复产生已幂等的结果投递。
- `AC-037`：执行成功但投递失败时，UI 同时展示两个真实状态。
- `AC-038`：空数据集成功结束并显示“无符合条件数据”，不显示系统失败。

### 18.5 统一看板

- `AC-040`：自动 Invocation 及其目标只出现一张卡。
- `AC-041`：手工 Session、FlowRun、WorkflowRun 和 TaskRun 都能出现。
- `AC-042`：Flow 显示阶段/节点摘要，TaskRun 显示计数进度，两者不混用。
- `AC-043`：关系损坏或状态矛盾进入 needs_action。
- `AC-044`：SSE 断开后自动轮询，页面仍可手动刷新。
- `AC-045`：列表规模测试中无逐卡查询。

### 18.6 回归门禁

每一实施切片必须至少通过：

- 后端单元测试与数据库集成测试；
- Agent/AgentFlow/Workflow 各一条真实运行回放；
- 幂等、取消、超时、崩溃恢复测试；
- 前端 vitest/typecheck/build；
- 看板和详情页视觉回归；
- 旧 API 兼容测试；
- 工作区无非预期改动。

---

## 19. 实施切片与顺序

### F0：执行真实性修复

目标：现有三执行体先真实可跑、可观测。

- 修正 Flow NodeRun 反链字段；
- FlowRun 改 queued → async running；
- NodeRun 增量落库；
- Agent 节点及时登记 SessionIndex；
- 修正运行中/终态回调 token 生命周期；
- Invocation 只在目标真实终态后结算；
- 增加 Flow SSE/轮询代理。

完成标准：AC-001～007。

### F1：领域拆名与 API 兼容

- UI/DTO 将旧 AnalysisTask 从 `AutomationDefinitionDTO` 改名；
- 新增 `/api/analysis-tasks` alias；
- `/api/v2/automations` 保持通用自动任务 canonical；
- 文档、类型和页面文案消除冲突；
- 旧 API 保留并统计流量。

### F2：AutomationInvocation 补全

- 以 AutomationTriggerLog 为持久化基础补时间、target、attempt、错误字段；
- 原子幂等；
- run-now 统一返回 202；
- 状态对账 watcher；
- cancel/retry；
- history 改为 Invocation DTO。

### F3：分析 TaskRun 最小可靠批跑

- total/processed 增量可信；
- 有界 item 并发；
- lease 与恢复；
- 取消；
- timeout；
- retry failed；
- 错误聚合；
- summary API。

### F4：统一任务投影

- 扩展 WorkItemProjection 来源；
- 实现跨来源去重；
- 稳定状态映射；
- 任务看板 kind 筛选；
- SSE refresh 与轮询降级。

### F5：第一个真实数据源闭环

- 只选一个真实 webhook、polling 或 MQ 场景；
- 写出 payload、吞吐、SLO、dedupe、cursor、retry、dead letter 契约；
- 默认每条 EventDelivery 只选择一个目的地：AutomationInvocation 或 TaskRun；
- 通过实测决定是否需要 F6。

### F6：可选入口攒批

只有 §10.3 门槛满足才立项。未满足则明确关闭，不以“以后可能需要”为由提前建设。

### S：人类鉴权与权限治理

在核心功能稳定后统一实施：

- login/SSO；
- user/session；
- RBAC；
- team data scope；
- 操作审计；
- 权限 UI；
- SSE/详情/附件等入口的数据范围检查。

F0～F5 不依赖 S 才能进行，但所有 API 需保留统一依赖注入点，避免未来逐端点重写。

---

## 20. 明确非目标

- 不建立所有执行共用的 `BatchGroup/BatchItem`。
- 不把 AgentScope Session 内容复制到平台数据库。
- 不把 AgentFlow 节点数当成批次 total。
- 不实现没有真实输入场景支撑的通用 MQ 抽象。
- 不预先支持所有映射 DSL。
- 不建设 Kubernetes/Temporal 级分布式调度平台。
- 不删除旧 API 或立即做物理表重命名。
- 不在本阶段实现登录、RBAC 和团队权限。
- 不因为鉴权后置而移除 API key、幂等、回调 token、SSRF 防护。
- 不允许看板拖拽修改运行状态。

---

## 21. 风险与待验证项

### 21.1 已知风险

| 风险 | 影响 | 处理 |
|---|---|---|
| 两套 Automation 命名继续共存 | API/前端持续误接 | F1 优先拆名，旧路由只兼容 |
| Flow 同步阻塞 | 请求超时、运行不可观测 | F0 异步化 |
| SessionIndex 晚于真实执行 | 工具回调 401、追踪断链 | 先登记再触发 |
| TaskRun 单 worker 串行 | 大批次堵塞全部任务 | 有界 fan-out + lease |
| 计数是缓存且可能漂移 | UI 进度不可信 | 子 Run 可重建 + reconcile |
| 重试产生重复副作用 | 外部数据重复写 | 输出幂等键 + Outbox |
| 无登录时误公开服务 | 数据和费用风险 | 明确 dev/internal 部署，不宣称公网可用 |

### 21.2 实施前必须验证

1. AgentScope 当前正式版本对 Session cancel、terminal event、schedule stateful 的真实契约；
2. AgentFlow executor 是否支持中断运行中 Agent 节点；
3. Workflow Run 与分析 ItemRun 共表时的所有查询判定；
4. 当前 `automation_watcher` 在多进程部署中的锁与恢复行为；
5. `JobQueue` 是否已有可靠 lease reclaim，而不只是 locked_at 字段；
6. 第一个真实数据源的吞吐、乱序、重放和延迟要求；
7. 分析批次最大规模与允许创建的 Run 行数量；
8. Session/事件/原始 payload 的保留周期。

这些属于事实缺口，未验证前不得在验收报告中写“生产级完整闭环”。

---

## 22. 最终判断原则

新增任何“批次”需求时，必须依次回答：

1. 是否有 N 个可枚举的独立业务输入？
2. 每项是否需要独立状态？
3. 每项是否需要独立失败和重试？
4. 用户是否需要看到 total 和逐项进度？
5. 取消时是否要停止剩余项？

五项大部分为“是”，使用 `TaskRun/批次`；否则使用普通 Invocation + Session/FlowRun/WorkflowRun。

新增入口攒批时，还必须回答：

1. 单事件模式的实测瓶颈是什么？
2. 合并能节省多少成本或提高多少吞吐？
3. 可以接受多长等待时间？
4. 批内部分失败如何表达？
5. 下游是否真正支持批量输入？

没有数据就不建攒批层。

本 Spec 的最终边界是：

```text
自动任务解决“何时自动启动一次工作”
Invocation 解决“这一次触发发生了什么”
Session/FlowRun/WorkflowRun 解决“真实工作如何执行”
TaskRun 解决“同一分析定义如何处理 N 条独立数据”
WorkItemProjection 解决“用户如何在一个地方看见这些工作”
```
