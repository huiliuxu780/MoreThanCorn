# 10 · AgentScope 原生接管与 QoderWake 产品复刻纠偏决定

> 日期：2026-09-08
> 状态：`AUTHORITATIVE_CORRECTION / DOCS_ONLY`
> 代码：零修改；P0 继续禁止
> 替代范围：本文件替代 05 的平台自建运行时建议，以及 09 的 MRD-02/MRD-03；研究观察和源码证据不被替代。

## 0. 纠偏结论

此前方案把“AgentScope 是唯一底座”解释成“AgentScope 是平台 Provider 之一”，再由平台自建 Session、RunEvent、AgentState checkpoint、调度和观测。这不叫全面拥抱 AgentScope，而是用旧平台模型包裹并削弱 AgentScope。

立即撤回以下建议：

1. 平台拥有或复制 AgentScope Session。
2. 无状态 Agent 执行绕开 Session 并自存 AgentState。
3. 创建 `RuntimeCheckpoint.agent_state` 作为第二真相源。
4. 将 AgentScope 事件转换为平台自创事件词表，再以此定义 Agent 观测能力。
5. 以现有 Run/RunEvent 表存在为依据，预设所有 AgentScope 执行必须复制成平台 Run。
6. 一期只使用 AgentScope 库层并关闭 ChatService/storage/scheduler/knowledge app 服务。
7. 通过通用 Runtime Provider Contract 只取回 output/trace，从而丢失原生 Session、HITL、Team、Schedule、Workspace 和 message bus 语义。

新原则只有两条：

> AgentScope 已有的能力直接采用，以原生对象和服务为唯一真相源。
> AgentScope 没有的能力先登记为缺口，只有明确产品需求和证据后才由平台补充。

## 1. 已证 AgentScope 2.0.7 原生能力

| 能力 | 已证原生对象/入口 | 采用决定 | 禁止事项 |
|---|---|---|---|
| Agent 定义 | `AgentRecord / AgentData`，含 `system_prompt` | 运行时直接采用 | 不再维护另一份运行时 Agent config |
| Session 与状态 | `SessionRecord / SessionConfig / AgentState` | Agent 执行状态唯一真相源 | 不建平台 Session/AgentState 镜像 |
| 执行编排 | `ChatService` 每回合装配 Agent、持久化输入/回复/state | 作为 Agent app 主执行路径 | 不用 adapter 抽成只有 output 的黑盒 |
| 消息 | storage 的 message 持久化和分页 API | 直接采用 | 不复制 chat message 表 |
| 流式事件 | `/{session_id}/stream` SSE | 原样消费官方 AgentEvent | 不捏造平台事件完整性 |
| 断线重放 | message bus session replay log | 只按官方临时重放语义使用 | 不称为永久审计；当前上限 1000 条 |
| 状态/中断/HITL | Session status、interrupt、确认/外部执行事件 | 直接采用 | 不重写 continuation 协议 |
| 定时任务 | `ScheduleRecord / SchedulerManager` | 定时自动任务优先直接映射 | 不再平行实现 Agent cron scheduler |
| 定时执行历史 | `GET /schedules/{id}/sessions` | Agent 目标的运行历史直接采用 | 不先复制为平台 Run 历史 |
| 无状态定时 | 每次 fire 创建 fresh Session | 采用官方语义 | “无状态=无 Session”禁用 |
| 有状态定时 | 多次 fire 复用固定 Session | 采用官方语义 | 不另建跨次记忆容器 |
| Skill | `SkillRecord`、Skill Hub、workspace-discovered skills | 直接采用 | 不创建运行时 Skill 双写 |
| MCP | `MCPRecord`、MCP Hub、`MCPClient` | 直接采用 | 不把 MCP 只降级成工具名列表 |
| Knowledge | KnowledgeBase、Session knowledge config、RAGMiddleware | 原生优先，部署须验证 | 不默认保留外部检索端点替代方案 |
| Workspace | WorkspaceManager、Session workspace binding | 直接采用 | 不另造 Agent 工作目录状态 |
| Team/Sub-agent | Team、SubAgentTemplate、原生 team tools | 直接采用已证能力 | 不先设计另一套 role 消息总线 |
| Agent 内计划 | TaskCreate/Get/List/Update、`tasks_context` | 直接采用 | 不与平台任务或自动任务合并 |
| 追踪原语 | `TracingMiddleware` + OpenTelemetry | 只按实测结果声明 | 不承诺尚未接通的 Trace 页面 |

### 1.1 观测的真实边界

目前只允许声明：

- Session 消息可以查询；
- Session 是否运行/等待可以查询；
- AgentEvent 可以通过 Session SSE 实时接收；
- 当前运行的 replay log 最多保留 1000 条；
- Schedule 可以列出其触发产生的 Sessions；
- `TracingMiddleware` 能为 Agent reply、模型调用和工具执行创建 OpenTelemetry spans。

目前不允许声明：

- 已经有永久完整的 Agent 执行审计；
- 已经有可用的成本面板、Trace 树、阶段画布或跨引擎谱系；
- 现有 `RunEvent` 已完整承接 AgentScope 事件；
- AgentScope Studio 已与当前 2.0.7 app 服务完成兼容接入。

2.0.7 的 `create_app()` 没有一等 observability 参数。正式采用 Studio/OTLP 前必须实测 OpenTelemetry Provider/Exporter 配置和 `extra_agent_middlewares` 注入；测试结果是什么，产品才展示什么。

## 2. 平台只补明确缺口

以下能力当前没有证据表明 AgentScope app 已完整提供，因此可以进入“补缺口”候选，但不能直接展开成实现：

1. MQ、Webhook、API、数据库轮询等外部数据入口。
2. 入站数据过滤、映射、去重、攒批和死信处理。
3. 现有确定性 Workflow。
4. 2.0.8 Pipeline 的产品注册、版本、发布、服务化与持久化。
5. 外部系统写回、业务幂等和对账。
6. 不同原生执行记录之间的产品导航和查询。

第 2 项的正式术语、表结构和状态机必须由真实数据接入需求决定；本文件故意不沿用此前已经过度设计的六实体链作为既定事实。

## 3. 任务模块：直接复刻 QoderWake 产品体验

### 3.1 已证、可直接复刻

目标产品的任务看板不是任务定义列表，而是对话 Session、Flow run、自动任务执行的统一工作视图。以下体验已有 O1/O2 证据，可以直接作为页面规格输入：

- 顶部周期指标：总数、进行中、需要操作、已结束。
- “需要关注”区域：需要操作、查收结果两个动作队列。
- “全部任务”区域：列表/泳道切换。
- 搜索、执行者、触发方式、状态、周期筛选。
- 列表字段：任务、执行者、来源、状态、最近更新。
- 详情跳转到对应原生对象：对话 Session、AgentFlow 执行或自动任务执行。
- 同一底层状态允许在不同产品视图使用不同展示词，但必须有显式映射。
- 列表与五泳道通过服务端查询；泳道为 pending/running/done/waiting/failed+cancelled。
- “已结束”包含成功、失败、取消；触发筛选包含手动、定时、事件、API、@Waker、对话。
- 自动任务手动运行产生的 Session 以 run/session 粒度进入看板。

### 3.2 复刻方式

任务看板首先是**只读联合查询/投影视图**，不是新的执行引擎，也不应先创建新的 canonical Task/WorkItem 状态表。

候选来源：

```text
AgentScope user/channel Session
AgentScope schedule execution Session
AgentFlow native execution record（待 2.0.8 服务化方案确认）
Workflow native execution record
```

看板只保存产品偏好时才允许有附属状态，例如“已查收”；该状态必须先通过目标产品网络行为确认，不能从按钮文案推断。

### 3.3 尚不能抄

- 查收结果的持久字段和状态转换。
- “需要操作”的完整类型集合。
- Group 筛选与权限语义。
- 重跑、取消、删除等副作用按钮行为。
- Loading、权限不足、网络错误和部分失败状态。

这些必须继续做真实交互和网络捕获。

## 4. 自动任务模块：复制产品壳，执行映射 AgentScope

### 4.1 已证、可直接复刻

- 自动任务是定义，不是一次执行记录。
- 列表：总数、已启用、Agent 执行、AgentFlow 执行；执行者/触发类型/状态/排序筛选。
- 创建表单：名称；一个定义可配置最多五个触发方式；定时/API；定期/一次性；执行方式 Agent/AgentFlow；执行对象；每次触发发送的指令；Workspace；最大运行次数；截止日期。
- 详情：启用、编辑、删除、手动运行；运行概览；触发条件；响应对象；高级设置；运行历史。
- 手动运行用于调试，不更新最近自动触发、不计入累计自动运行、不覆盖最近自动结果。
- 新建定义默认启用；enabled switch 即时写入，暂停只阻止新自动触发，不取消已经运行中的执行。
- 保存后响应类型和执行对象锁定；要换 Agent/AgentFlow 必须新建。
- Agent 与 AgentFlow 表单不是同构 target：Agent 配 Prompt/模型/Workspace，Flow 配阶段概览和输入映射。
- 手动运行从 running 到 success，并产生可查询 Session；历史和任务看板都进入同一 Session。

### 4.2 运行映射

| 自动任务能力 | 采用方案 |
|---|---|
| 定时触发 Agent | 直接使用 AgentScope `ScheduleRecord/SchedulerManager` |
| 每次独立执行 | AgentScope `stateful=false`，每次创建 fresh Session |
| 跨触发记忆 | AgentScope `stateful=true`，复用固定 Session |
| 执行历史 | AgentScope schedule sessions |
| 执行 AgentFlow | 待 AgentScope 2.0.8 Pipeline 服务化边界确认后接入 |
| API 触发 | 平台仅补 AgentScope 未提供的鉴权入口，然后唤醒/创建原生 Session |
| MQ/Event 触发 | 平台数据入口负责接收和过滤，再触发原生目标；不并入 Agent scheduler |
| 手动调试 | 创建独立原生执行 Session；产品统计按已证规则排除 |

### 4.3 不能直接复制或尚未证实

- 目标产品 `atk_` URL token 形态：存在泄露和轮换风险，不复制。
- API 已证 POST JSON、Prompt 字段替换和 `wakeSessionUniqueId` 连续聊天；该字段不是幂等键。实际 response/error schema、签名、限流和重放保护仍未证。
- 事件与定时拉取按已注册 capability 条件展示；当前实例没有可用 event source，不能把隐藏入口误判为产品没有事件能力。
- 删除是软删、硬删还是保留历史。
- 失败后的重试、连续失败停用、并发触发和错过调度语义。
- AgentFlow 目标如何固定版本。

因此“直接抄自动任务”的准确含义是：**已观察到的产品体验直接复刻；运行能力优先映射 AgentScope Schedule/Session；未观察到的后台规则不猜。**

## 5. 当前代码的处置原则

本轮不删除代码，但后续审计必须把现有能力分成三类：

1. `REPLACE_BY_AGENTSCOPE`：自建 Agent chat Session、消息、AgentState、Agent scheduler、Skill/MCP runtime registry、Agent trace mapper。
2. `KEEP_AS_PRODUCT_GAP`：数据入口、Workflow、业务写回、租户权限。
3. `REVIEW_BEFORE_KEEP`：Run/RunEvent/TaskRun、Release、资源表、通用 Runtime Provider Contract。

第三类不能因“已经写了很多”自动保留，也不能未经迁移审计直接删除。判断标准只有：它是否承担 AgentScope 明确不承担的产品职责。

## 6. 文档修订门禁

### G0 · 原生接管表

- AgentScope 每个原生实体、API、存储和生命周期都有源码入口。
- 当前平台同义实体全部列出双写风险。
- 每项给出 `DIRECT_USE / THIN_PROXY / PLATFORM_GAP / RETIRE`，不允许“暂时两边都写”。

### G1 · 任务复刻证据

- 任务看板页面 inventory、状态矩阵、详情跳转和筛选行为完整。
- 查收/关注/重跑/取消的副作用通过 TEST 数据或网络证据确认。
- 未证状态保持 `EVIDENCE_GAP`。

### G2 · 自动任务复刻证据

- 创建、编辑、启停、手动运行已完成网络捕获；删除仍须闭合。
- stateful/stateless 明确映射 AgentScope Schedule。
- API invoke URL + Bearer PAT、JSON 模板和 conversation key 已由官方说明固定；我方认证/幂等/限流/重放契约另审。
- “事件”入口确认为 capability-gated，不再按静态固定卡实现。

### G3 · AgentScope 观测实测

- 2.0.7 `TracingMiddleware` 在 app assembly 中真实注入。
- OTLP trace 成功进入选定后端；实际字段和保留策略被记录。
- UI 只展示实测拿到的数据。
- Session SSE replay 与永久 tracing 的职责明确分开。

### G4 · 主设计稿收敛

- 03/05/08/11/12/HANDOFF 清除平台 Session、RuntimeCheckpoint、Agent event projection 和 library-only 接入建议。
- Task/Automation 采用本文件复刻边界。
- 通过术语、双写、未证能力和凭据扫描后，才可申请 `DOCS_ACCEPTED`。

## 7. 立即执行顺序

1. 以本文件为纠偏控制单，先停止旧方案继续扩写。
2. 建立 AgentScope 原生接管表，逐项落到当前代码的读写链。
3. 将已有 QoderWake 观察资料整理为 `.replica` page inventory、状态矩阵和网络契约。
4. 已完成任务/自动任务最小 TEST 数据实调；删除、关注动作和失败路径继续补证。
5. 根据证据重写 03/05/08/11/12/HANDOFF，而不是在旧架构上追加注释。
