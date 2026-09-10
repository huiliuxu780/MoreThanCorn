# 03 · 数据接入、触发与映射边界

> 版本：v3.0
> 日期：2026-09-08
> 状态：`BOUNDARY_FROZEN / SCHEMA_OPEN`
> 代码：未实施
> 原则：AgentScope 已有的 Schedule/Session 不重造；平台只补外部数据接入缺口。

## 0. 纠偏结论

旧稿把 Trigger、TriggerEvent、Batch、TaskRun 和 Run 预先冻结成一条平台主链，再让 AgentScope 只执行其中一段。这仍然是在 AgentScope 外面造第二套 Agent 调度与执行事实，现撤回。

本稿只冻结职责：

```text
数据源 capability
→ 接收或拉取
→ 鉴权/游标/去重/过滤/映射
→ 自动任务触发准入
→ AgentScope Session | AgentFlow | Workflow
```

具体表名、状态机和批次模型必须等首个真实 MQ/API/数据库场景后再定。

## 1. 三层对象必须解耦

### 1.1 数据源

回答“数据从哪里来、怎么连、怎么持续取得”：

- Webhook/API receiver；
- Kafka/RabbitMQ 等 MQ consumer；
- 数据库或 SaaS 定时拉取；
- 已安装 connector/plugin 提供的事件源。

数据源负责连接、授权、订阅、游标、限流和健康状态，不决定由哪个 Agent 执行。

### 1.2 触发规则

回答“什么变化值得启动工作”：过滤、字段映射、去重、可选攒批和失败处置。它引用数据源 capability，不复制连接凭据。

### 1.3 自动任务

回答“触发后交给谁、用什么固定输入、运行到什么时候”：

- target：Agent / AgentFlow / Workflow；
- trigger methods：定时、API、已注册事件源、条件可用的定时拉取；
- fixed prompt 或 Flow 参数映射；
- Workspace/运行限制；
- enabled/max-runs/deadline。

自动任务不是消费者进程，也不是每次执行记录。

## 2. 从 QoderWake 复刻的产品规则

本地实例和官方说明已经证明：

1. 一个自动任务最多五个触发方式。
2. 事件与定时拉取按已注册 capability 条件展示，不是固定写死的卡片。
3. API body 可以向 Prompt/Flow 参数映射。
4. Agent 与 AgentFlow 的 target 表单不同；保存后 target kind/id 不可变。
5. max-runs/deadline/paused 控制新触发准入，不取消已运行执行。
6. 连续 API 调用可以用业务 conversation key 复用上下文，但该 key 不是幂等键。

因此产品体验可复刻，QoderWake 私有 endpoint、`atk_` invoke key 和内部 Trigger schema 不复制。

## 3. 与 AgentScope 的边界

### 3.1 定时 Agent

直接使用 AgentScope `ScheduleRecord/SchedulerManager`：

- `stateful=false`：每次 fire 创建 fresh Session；
- `stateful=true`：复用 schedule 固定 Session；
- 历史直接查询 schedule sessions。

平台不能再建另一套 Agent cron、TaskRun 或 Session 镜像。

### 3.2 API/Event/MQ

AgentScope 当前没有通用外部数据入口。平台完成接入治理后：

- 默认创建 fresh AgentScope Session；
- 只有显式业务 conversation key 才解析到既有 Session；
- 幂等 key 与 conversation key 分离；
- 消息、AgentState、状态和 AgentEvent 仍由 AgentScope 保存。

### 3.3 AgentFlow/Workflow

- AgentFlow：分派给 AgentScope 2.0.8 Pipeline 的已发布版本；app 托管方式待 spike。
- Workflow：调用现有确定性 Workflow 引擎；其中 Agent 节点进入 AgentScope Session/ChatService。

数据入口不实现第三套 runner。

## 4. Push、MQ 与 Poll 的最小契约

### 4.1 Webhook/API Push

必须有：认证、payload 大小限制、schema 校验、幂等、重放窗口、速率限制、accepted response、异步状态查询和脱敏日志。接收成功只表示进入处理，不表示业务执行完成。

### 4.2 MQ

必须有：topic/subscription、consumer group、offset、ack 时点、重试、死信、背压和租户隔离。默认“先完成接收侧持久确认，再 ack”，但具体存储与一次/至少一次语义必须随首个 Broker 实测，不在本文造表。

### 4.3 定时拉取

必须有：数据源授权、对象范围、轮询频率、增量游标、首次起点、去重字段、限流和失败后游标推进规则。轮询调度与 Agent 执行调度是两个职责：前者取得变化，后者启动工作。

## 5. 过滤、映射、去重与批量

这些能力属于数据接入层，不属于 Agent Prompt：

- filter：确定是否触发；
- mapping：形成目标输入；
- dedupe：阻止重复业务执行；
- batching：多个已接收对象如何组成一次业务处理。

批量不是自动任务的同义词。自动任务可以一次处理一个事件，也可以接收一个已经形成的 batch；是否有 batch 必须由业务吞吐、时效、错误隔离和下游限额决定。

一期只允许确定性、可预览、可测试的表达式。是否需要 JSONPath/JMESPath/模板语言随真实 payload 决定，不先发明通用 DSL。

## 6. 连接器必须分两类

| 类型 | 用途 | 运行位置 |
|---|---|---|
| Tool/MCP connector | Agent 主动查询或执行外部动作 | AgentScope Toolkit/MCPClient |
| Data source connector | 持续接收、订阅或拉取外部变化 | 平台数据接入服务 |

同一个外部系统可以同时提供两类 capability，但凭据、权限、生命周期和 UI 不得混成一个“连接成功”开关。

## 7. 失败与观测

只展示真实证据：接收状态、过滤/映射结果、去重命中、目标 dispatch id、AgentScope session id 或 Flow/Workflow execution id。

禁止：

- 把 AgentScope AgentEvent 复制成平台自创完整 trace；
- 用自动任务 enabled 代替数据源健康；
- 用“HTTP 202”显示业务完成；
- 用 mock 消息或静态计数显示已消费。

## 8. 首个场景前不得冻结的内容

- 通用 `TriggerEvent/Batch/TaskRun` 表结构；
- 所有 MQ 的统一 ack/重试状态机；
- 任意来源共用的映射 DSL；
- 原始 payload 永久留存；
- 自动把每次入口事件复制为平台 Run。

## 9. 开工门禁

1. 选定一个真实数据源、真实 payload、真实吞吐和失败要求。
2. 确认 push、MQ 或 poll 中的一种主接入方式。
3. 区分 conversation key、idempotency key 和 source cursor。
4. 写出认证、过滤、映射、去重、ack、重试和死信验收样本。
5. target 为 Agent 时证明最终只创建/唤醒 AgentScope Session。
6. 页面 capability 来自真实注册与健康检查，不写死。
7. 任何新增表都证明 AgentScope 与现有 Workflow 为什么不能承担该职责。

未通过以上门禁，不得开数据接入代码。
