# QoderWake 本机产品拆解与 AgentScope 目标架构研究任务书

> 日期：2026-09-08  
> 状态：`RESEARCH_ONLY`  
> 对象：下一位执行调研的 Agent；后续由当前主审计者复核  
> 调研目标：把本机正在运行的 QoderWake 当作可操作的产品参考，形成可复核的产品事实、交互契约、领域映射与冲突清单  
> 明确禁止：修改产品代码、修改数据库、保存/发布/启停目标产品中的实体、直接改写 `docs/v2-design/` 主设计稿

## 0. 可直接交给执行 Agent 的任务

请完整执行本任务书，不要从“我们想抄 QoderWake”直接跳到架构结论。

你需要同时核验四套真值：

1. 本机 QoderWake 当前可见、可操作的产品行为；
2. MoreThanCorn 当前前后端代码、数据模型与 API 的真实实现；
3. AgentScope **当前明确采用的 2.0.8 版本**的官方源码、示例和状态/事件契约；
4. `docs/v2-design/03/05/08/11/12` 与审计交接单中的既有裁定。

最终回答的不是“QoderWake 看起来不错”，而是：

- 哪些产品概念可以高保真借鉴；
- 哪些只是 UI 文案，不能推导为后端模型；
- 我们的 `Workflow`、候选 `AgentFlow`、`Agent`、任务看板、自主任务、`Run`、`Session`、资源和工作空间应如何分层；
- 双向调用如何进入统一运行事实、版本、权限、预算、取消、恢复和审计体系；
- 新方案与现有代码、doc03/doc05/doc08/doc11/doc12 各冲突在哪里；
- 哪些结论仍需用户拍板，不能由执行者偷偷决定。

本轮只交研究材料和修订建议。不要改业务代码，也不要直接改主设计稿。

## 1. 先纠正三个容易带偏调研的前提

### 1.1 “直接抄”不是“看到什么就建什么表”

允许高保真借鉴：

- 信息架构；
- 页面分区；
- 创建/编辑流程；
- 状态表达；
- 任务、Agent 和 Flow 的可见关系；
- 运行记录、人工介入、恢复和查收体验；
- 资源挂载与工作空间选择体验。

不允许直接复制：

- QoderWake/Waker/WakerFlow 品牌名；
- 专有文案、图标、图片和不可确认来源的资产；
- 仅凭 UI 猜测的表结构、内部接口或安全模型；
- 与本项目无关的 IM 渠道能力；
- 目标产品可能存在但页面没有证明的运行保证。

### 1.2 “两个 Flow”不等于两个运行事实体系

本轮需要验证的候选结构是：

- `Workflow`：现有通用业务/DAG 编排产品；
- `AgentFlow`：候选的 AgentScope Pipeline 产品化层，对标 WakerFlow 的产品职责；
- 二者允许分别拥有定义、版本、编辑器和发布生命周期；
- 二者若成立，仍必须共用 `Run / ChildInvocation / Event / Policy / Release / Outbox` 等执行事实。

执行者不得预先把这一候选结构写成既定事实。必须通过原站行为、AgentScope 2.0.8 契约和我方代码约束给出接受、修正或否决结论。

### 1.3 任务有三种相似但不同的含义

必须独立判断并统一命名：

- 平台任务：用户看到的任务/工作项/执行入口；
- 自动任务：触发、调度、执行目标和生命周期的定义；
- Agent 内部计划项：Planning Agent 在一次 Run 内拆出的 todo/plan item。

不得因目标产品运行时出现 `TaskCreate/TaskUpdate/TaskList`，就把三者合并成同一张 `Task` 表。

## 2. 环境、证据目录与禁止动作

### 2.1 已知入口

- QoderWake 本机入口：`http://127.0.0.1:19830/`
- MoreThanCorn 当前前端：`http://127.0.0.1:5199/`
- 工作区：`/Users/rivers/MoreThanCorn`
- 本轮证据目录：`research/morethancorn/10-qoderwake-product-research/`
- 截图目录：`research/morethancorn/10-qoderwake-product-research/screenshots/`

端口和页面可能变化。执行者必须先通过只读方式验证，不得把“能打开 URL”写成应用健康结论。

### 2.2 允许的动作

- 浏览目标产品已有页面；
- 展开折叠区、切换 tab、打开下拉框或创建/编辑弹窗；
- 在不提交的前提下切换表单选项以观察字段联动；
- 打开已有详情和运行记录；
- 截图、读取可访问 DOM、记录当前 URL；
- 只读检查 MoreThanCorn 源码、测试和数据库迁移；
- 查询 AgentScope 官方文档、官方仓库、官方发布信息；
- 运行只读或无副作用的测试/探针，但要记录命令与结果。

### 2.3 禁止的动作

- 点击保存、发布、启用、停用、运行、重跑、打回、删除、邀请、授权等会改变状态的操作；
- 创建真实 Agent/Waker、Flow、任务、自动任务、连接器、项目或资源；
- 发送真实消息、调用真实外部系统、触发 webhook 或 IM；
- 读取或记录 Cookie、token、localStorage、凭据、真实业务数据；
- 安装/升级依赖，尤其不得为了“符合 2.0.8”直接改 lockfile；
- 修改 `server/`、`src/`、`runtimes/`、`poc/`、迁移和测试；
- 修改 `docs/v2-design/` 中任何主文档；
- 把目标产品页面文案当成其后端真实结构的唯一证据。

如果一个页面只能通过提交或真实执行才能继续，记录为 `BLOCKED_BY_SIDE_EFFECT`，不要越过边界。

## 3. 证据等级与记录格式

每条结论必须标注一种证据等级：

| 等级 | 含义 | 可支持的结论 |
|---|---|---|
| `O1` | 当前本机目标产品页面的截图 + URL + DOM/可见文案 | 页面、字段、状态、可见交互事实 |
| `O2` | 同一行为在列表、详情、编辑/运行记录中交叉印证 | 产品对象关系和生命周期的较强证据 |
| `C1` | MoreThanCorn 当前代码调用链、模型、路由、测试 | 我方当前实现事实 |
| `A1` | AgentScope 2.0.8 官方 tag/包源码/官方示例 | AgentScope 能力和契约事实 |
| `I1` | 由 O/C/A 证据推导出的解释 | 必须明确写“推断”，不能冒充事实 |
| `D1` | 面向我方目标架构的设计建议 | 必须列替代方案、成本和未决项 |

每个页面步骤使用以下固定格式：

```text
步骤 ID：QW-xx
入口 URL：
前置状态：
用户动作：
可见结果：
对象/字段/状态：
截图：
DOM 或可访问名称摘要：
证据等级：O1/O2
确认的事实：
不能由此确认：
与我方候选概念的映射：
风险/疑问：
```

截图必须包含足以定位页面的侧栏/标题/面包屑或 URL 记录。不要只截孤立弹窗局部。

## 4. 第一阶段：目标产品逐页拆解

### G1 · 页面与路由清点闸门

先输出 `00-route-and-object-inventory.md`，至少包含：

- 可见全局导航与二级导航；
- 当前可到达路由；
- 列表、详情、创建、编辑、运行记录页面；
- 页面主对象、关联对象和主要动作；
- 无法安全进入的页面与原因；
- 同一名词是否在不同页面表达不同对象。

未完成路由清点，不得开始写目标架构。

### 4.1 任务看板

至少核验：

1. 总览指标；
2. “需要操作”和“查收结果”是否是状态、过滤器还是用户动作队列；
3. 列表/泳道切换；
4. 搜索、Waker、触发来源、状态、时间过滤；
5. 一条现有任务的详情；
6. 详情中的输入、输出、执行者、来源、运行记录、人工操作和终态；
7. 任务与 Run 是一对一、一对多还是无法确认；
8. Chat 产生的工作与自动任务产生的工作是否进入同一看板。

必须回答：目标产品的“任务看板”更像创作实体列表，还是 `Run/WorkItem` 的统一投影视图？

### 4.2 @Waker / 对话

至少核验：

1. 新建对话和已有对话的入口；
2. Waker 选择、Group 选择和会话导航；
3. 消息输入、附件、工作空间、工具/能力入口；
4. 一轮回复可见的阶段、工具事件、任务更新和终态；
5. 对话是否自动创建任务看板条目；
6. 多轮对话的 session 连续性；
7. 是否能从对话主动调用 WakerFlow；
8. 如果能调用，界面如何呈现父子关系、等待、失败和返回结果。

不得为了验证而发送真实消息。若没有安全的既有会话可看，明确写 `EVIDENCE_GAP`。

必须回答：`chat turn = run` 是否符合目标产品的可观察行为；若无法确认，不得借 UI 猜后端。

### 4.3 自主工作/自动任务

至少核验：

1. 列表指标、筛选、状态和累计运行；
2. 新建弹窗的名称、触发方式、调度类型、条件；
3. 是否允许一个自动任务配置多个触发方式，上限如何显示；
4. 执行目标是否明确区分 Waker 与 WakerFlow；
5. 执行指令的含义和长度限制；
6. 工作空间的默认、本地目录、项目三态；
7. 高级设置中的最大运行次数和截止日期；
8. API 触发时出现的鉴权、请求样例、幂等或回调字段；
9. 现有自动任务详情、编辑和运行历史；
10. 运行失败、停用、截止、次数耗尽后的状态表达。

必须回答：自动任务是执行实体，还是“Trigger + target + prompt + workspace + policy”的定义？批量能力是否出现在这里，若没有则不能声称二者等价。

### 4.4 Waker 管理

至少核验：

1. Waker 列表、创建入口和分类；
2. 基本资料、身份、角色、人设、工作手册/BIBLE 类配置；
3. 模型与推理设置；
4. Skills、MCP/Tools、Knowledge、Memory、Projects/Workspace 的挂载方式；
5. 每种挂载是引用、复制、版本 pin 还是无法确认；
6. 可见的版本、发布、草稿、启停和权限状态；
7. Waker 的运行记录和统计；
8. Waker 是否能调用 WakerFlow；
9. WakerFlow 是否能反向选择 Waker；
10. 内部子代理/role 是否都要求注册成顶层 Waker。

必须回答：目标产品把 Waker 设计成用户可见资产根、运行实例，还是二者混合；我方是否应照搬这一混合。

### 4.5 WakerFlow

这是本轮的最高优先级，至少核验：

1. WakerFlow 的列表/入口在哪里；
2. 新建、编辑、运行和版本/发布页面；
3. 画布或阶段编排的基本单位；
4. 可用节点类型；
5. Waker 节点如何选择目标；
6. 输入/输出映射；
7. 串行、并行、条件、聚合、循环/重试能力；
8. 失败时能否选择性重做单个阶段/节点；
9. 人工确认、暂停、恢复和取消；
10. WakerFlow 运行记录中的阶段、attempt、父子执行和事件；
11. 自动任务触发 WakerFlow 的路径；
12. Waker 主动调用 WakerFlow 的路径；
13. 嵌套 Flow、环和最大深度的可见限制；
14. 工作空间与资源如何传递；
15. Flow 的草稿、版本、发布和回滚语义。

必须明确区分：

- 页面明确证明的能力；
- 只能从按钮/文案推断的能力；
- 必须真实运行才可验证但本轮被副作用边界阻断的能力。

“WakerFlow 支持选择性重做”只有在已有运行记录或明确的无副作用 UI 证据下才能成立。

### 4.6 能力与资源

至少核验：

1. Skills；
2. MCP Server/Tools；
3. Knowledge；
4. Memory；
5. Connectors/Connections；
6. Projects/Workspace；
7. 每类对象的列表、创建/编辑表单、状态、版本和被谁引用；
8. 删除/禁用被引用资源时的可见约束；
9. 工具权限、危险级别、作用域和凭据边界；
10. 是否有运行前的 schema snapshot、健康检查或授权提示。

不得把“页面上能添加资源”写成“运行时已真实注入资源”。目标产品内部实现不可见时，只能记为产品契约。

### G2 · 目标产品证据完整性闸门

满足以下条件才可进入架构映射：

- 六类核心区域均有当前截图或明确的阻断记录；
- 每张截图已经人工/视觉检查，不是空白、黑屏、裁切或遮挡；
- 关键表单同时记录上半段和下半段；
- 每个核心对象至少有列表 + 详情/编辑两个视角，确实不存在时写证据缺口；
- 没有通过保存、运行或启停来换取证据；
- 报告明确列出“页面证明不了的内容”。

## 5. 第二阶段：MoreThanCorn 当前实现审计

输出 `02-current-platform-reality.md`。不得只搜索类名；必须沿“UI 写入 → API → 持久化 → Release → Runtime 读取 → Run/Event 返回”追调用链。

### 5.1 Agent / Module / Version / Release

逐项回答：

- `Agent` 当前是定义根、版本、实例还是混合体；
- Custom 与 Module 的创建、编辑、发布、运行链是否一致；
- `AgentVersion` 和 `AgentRelease` 实际冻结哪些字段；
- Module manifest/spec、`Agent.config`、关联表是否存在多事实源；
- 发布后 Skill、Knowledge、Workflow、Connection 是否真的被 Runtime 消费；
- 生命周期与 Agent 类型是否被前端混用；
- 当前 Runtime capability 声明是否被端到端测试证明。

优先入口包括但不限于：

- `server/app/models.py`
- `server/app/routers/agents.py`
- `server/app/agent_release.py`
- `server/app/agent_runtime.py`
- `server/app/agent_chat.py`
- `server/app/agent_modules/`
- `server/app/runtime_providers/`
- `src/pages/agent-create.tsx`
- `src/pages/agent-chat.tsx`
- `src/pages/agent-workspace/`
- `src/features/agents/AgentWorkspaceShell.tsx`
- `src/components/agent-common-config.tsx`

### 5.2 Skill / Tool / Knowledge / Workflow 的真实挂载

为每类资源绘制一条字段级链路：

```text
页面字段 → 前端 payload → API schema → DB 字段/关联 → Release snapshot → Runtime request → AgentScope 构造/注入
```

如链路中断，标明断点，不得写成“已挂载”。特别复核：

- `config.skills` 与 `AgentSkill`；
- 页面显示的 Workflow 与 Runtime 是否有 `list/run workflow` 工具；
- MCP registry、tool discovery 与测试 fixture/mock 的边界；
- Knowledge 是文档引用、索引 revision 还是提示词描述；
- Connection 的 credential ref 是否进入运行时；
- 当前资源页面保存成功是否等于 Release/Runtime 生效。

### 5.3 Workflow、Task、Trigger、Run 和工作项

逐项回答：

- 现有 Workflow 是否能真正调用新版 AgentVersion；
- 旧 `agent/agent-select/agent-exec` 节点是否已经 deprecated 或被迁移器改写；
- Workflow 子流程、递归检测、最大深度和版本 pin 的现状；
- Agent 页面中的 Workflow 挂载是否只停留在 config；
- `AnalysisTask / TaskVersion / TaskRun / Run / WorkItemProjection` 的职责是否重叠；
- manual/schedule/backfill/api 触发的真实状态机；
- 自动任务、批量和一次性执行是否共享事实层；
- 外部写回是否有独立 Outbox、幂等、重试和对账。

### 5.4 工作空间、内置工具、Hook、CLI 和 Channel

不要因 QoderWake 有这些概念就假定我方已有。分别验证：

- 是否存在一等 `Project/Workspace/WorkspaceBinding` 模型；
- Bash/Read/Write/Edit/Grep/Glob 是否是可治理的真实工具；
- subprocess 是否只存在于受限节点/测试中；
- 是否存在 RunStart/SessionStart/BeforeTool/AfterTool/RunEnd Hook 引擎；
- 是否存在平台 CLI，而非依赖包自带 CLI；
- 是否存在通用 IM Channel Gateway；
- 本项目当前是否有任何飞书产品需求。

若不存在，写“当前未实现”；不要写“应该顺便做”。是否进入目标架构是后续设计选择。

### G3 · 当前实现事实闸门

- 每条“已实现/未实现/旁路/断链”都有文件和行号；
- 至少给出 Agent、Skill、Workflow、TaskRun 四条端到端调用链；
- mock、fixture、POC、生产路径分开标注；
- 没有改代码或运行会改数据库的测试；
- 未提交工作区变更没有被当成稳定 HEAD 事实。

## 6. 第三阶段：AgentScope 2.0.8 官方契约审计

输出 `03-agentscope-2.0.8-contract.md`。

先核对版本事实：

- 当前安装的包版本、安装来源和 commit/tag；
- PyPI 是否已有 2.0.8 正式版；
- 官方 Git tag/changelog；
- 本项目 lockfile 当前 pin；
- 文档中写的“2.0.8-dev”与当前事实是否已变化。

只使用官方文档、官方仓库、官方包源码和官方示例作为 `A1` 证据。技术结论不得依赖二手博客。

必须复核：

1. `PipelineProtocol` 的输入、输出和事件 union；
2. `GoalPipeline` 的 executor/verifier/iteration/state；
3. 是否原生支持多 stage、多 role、并行、barrier、选择性重做；
4. pipeline state 是否可跨进程持久化/恢复；
5. `AgentState`、session 和 Chat service 的边界；
6. Planning Agent 如何创建/更新内部计划项；
7. tool/MCP/skill/knowledge 的装配方式；
8. pause/resume、interrupt、external result 和 cancel；
9. event schema、streaming 和 structured output；
10. pipeline/agent 如何接入 `create_app` 或服务层；
11. 官方示例提供的是教学样例还是生产治理保证；
12. 版本升级时必须冻结/迁移哪些 state schema。

必须输出一个“官方提供 / 平台必须补齐 / 不能确认”的三列表。

### G4 · AgentScope 证据闸门

- 所有版本和能力结论可定位到 tag/commit 和源码行；
- 没有把 main 分支能力冒充已发布 2.0.8；
- 没有把 GoalPipeline 外推成完整 WakerFlow 产品；
- 没有把 Planning 内部任务项外推成平台任务；
- 没有把内存字段外推成持久化恢复保证。

## 7. 第四阶段：参考产品到我方架构的映射

输出 `04-reference-to-mtc-mapping.md`，使用下面的表头逐项填写：

| 目标产品概念/交互 | 原站证据 | 我方现有对应物 | AgentScope 对应物 | 结论 | 复用/新增/重构 | 风险 | 未决 |
|---|---|---|---|---|---|---|---|

至少覆盖：

- Waker；
- WakerFlow；
- 任务看板；
- 自主工作；
- Chat/Group；
- Skills；
- MCP Server/Tools；
- Knowledge；
- Memory；
- Projects/Workspace；
- 运行记录；
- 子代理；
- 内部任务管理；
- Hook；
- CLI；
- IM Channel。

每项结论只能是：

- `ADOPT`：产品职责和语义可以直接采用；
- `ADAPT`：采用交互，但后端必须重构映射；
- `DEFER`：有价值但非当前闭环必要；
- `REJECT`：与我方边界、安全或已有产品职责冲突；
- `OPEN`：证据不足或需要用户拍板。

不得使用含糊的“参考一下”“基本复用”。

## 8. 第五阶段：目标架构候选与强制对比

输出 `05-target-architecture-proposal.md`。至少比较以下三案，不得只写偏好的方案：

### 案 A：AgentScope Pipeline 仅是 AgentVersion 内部配置

- Agent 是唯一顶层资产；
- PipelineDefinition 跟随 AgentVersion；
- 自动任务只能选择 Agent/Workflow；
- Agent 内部决定是否走 Pipeline。

### 案 B：AgentFlow 是一等版本化资产

- `Workflow` 与 `AgentFlow` 是两个独立 Flow 产品；
- AgentFlow 由 AgentScope PipelineProtocol 驱动；
- Automation 可直接指向 Agent、AgentFlow 或 Workflow；
- Agent 可把 AgentFlow 当受治理工具调用；
- AgentFlow 可把 Agent/内部 role 当节点调用。

### 案 C：统一 FlowDefinition，用不同执行器类型区分

- 一个 Flow 产品；
- workflow/pipeline 只是 engine type；
- 共用编辑器和版本模型。

比较维度至少包括：

- 用户心智；
- 与 QoderWake 的高保真程度；
- 与现有 Workflow 的兼容；
- AgentScope 2.0.8 的映射自然度；
- 版本和 Release；
- 双向调用；
- 父子 Run 与事件；
- 选择性重做；
- 权限/预算/环检测；
- 前端复杂度；
- 数据迁移；
- 未来扩展；
- 锁定成本和回滚。

如果推荐案 B，至少给出以下候选模型，不要求最终命名，但必须说明职责：

```text
AgentDefinition / AgentVersion / AgentRelease
AgentFlowDefinition / AgentFlowVersion / AgentFlowRelease
Workflow / WorkflowVersion
AutomationDefinition / TriggerBinding / ExecutionTarget
Run / ChildInvocation / RunEvent / ExecutionState / Continuation
Session / AgentState
MountBinding / SkillVersion / ToolRef / MCPServerVersion
KnowledgeSnapshot / MemoryPolicy / WorkspaceBinding
PolicySnapshot / ModelRef / OutputSchemaRef
CommandOutbox / ResultDelivery
```

同时给出四条完整时序：

1. 用户 Chat → Agent → AgentFlow → 多 Agent/role → 返回 Chat；
2. 自动任务 → AgentFlow → Agent → 选择性重做 → 结构化终态；
3. Workflow → Agent → Workflow 子调用；
4. 单次无状态任务 → Agent Planning → 内部 plan items → Run 结束。

时序必须说明 `Session` 在哪里存在、`Run` 在哪里创建、子调用如何关联、取消和预算如何传播。

### 强制安全纠错

不得直接照搬以下高风险表象：

- 展示模型私有 chain-of-thought；应展示可审计的进度、工具事件、决策摘要和结构化依据；
- 默认开放 Bash/Write/Edit；应有工作空间隔离、allowlist、配额、超时和审批；
- SessionStart 任意 shell Hook；应先建版本化 Hook、权限、沙箱、幂等和超时；
- Agent 可枚举/调用任意 Flow；必须经过 mount、版本 pin、Policy 和预算；
- Flow 之间无限嵌套；必须有 InvocationGraph、环检测和最大深度；
- 自动任务成功等于外部写回成功；Run 与 Outbox/Delivery 终态必须分离。

### G5 · 架构建议闸门

- 三案已公平比较；
- 推荐结论同时有 O1/O2、C1、A1 三类证据；
- 所有“双向”调用落到同一父子运行事实和治理规则；
- Workflow 与 AgentFlow 的职责不靠一句“一个硬一个软”区分；
- 内部 role 不被强制注册成完整顶层 Agent；
- Chat、多轮 Session、单次任务和批量没有混成一层；
- 资源、工作空间和高风险工具有明确权限边界；
- 未决项仍是未决，没有伪装成拍板。

## 9. 第六阶段：与现有设计稿的冲突审计

输出 `06-design-conflict-matrix.md`，逐段检查：

- `docs/v2-design/03-trigger-and-data-mapping.md`
- `docs/v2-design/05-agent-management-redesign.md`
- `docs/v2-design/08-agent-pages-align-19830.md`
- `docs/v2-design/11-agentscope-full-integration.md`
- `docs/v2-design/12-event-driven-workorder-pipeline.md`
- `docs/v2-design/AUDIT-HANDOFF-agentscope-plan.md`

表格字段：

| 冲突 ID | 文档与段落 | 当前表述 | 新证据 | 问题类型 | 建议动作 | 是否需用户拍板 |
|---|---|---|---|---|---|---|

问题类型只允许：

- `FACT_ERROR`
- `STALE_VERSION`
- `MODEL_CONFLICT`
- `UI_CONFLICT`
- `SECURITY_GAP`
- `UNDECIDED_AS_DECIDED`
- `MISSING_CONTRACT`
- `TERMINOLOGY_COLLISION`
- `DUPLICATE_CAPABILITY`

必须重点查：

- doc11 当前将 PipelineDefinition 内嵌在 AgentVersion，是否与一等 AgentFlow 冲突；
- doc05 的 Agent/Module/Version/Release 是否能冻结 AgentFlow 引用；
- doc08 的 Agent 工作区是否缺 Execution、Flow、工作空间或双向关系；
- doc12 是否仍把 T1 当唯一工单流水线实现；
- doc03 的 Trigger target union 是否需要增加 AgentFlow；
- 交接单 D01–D22 哪些需废止、修订或新增决定，而不是静默覆盖；
- 旧“2.0.8-dev/PyPI 未发布”事实是否过期；
- 飞书/IM 是否被误写成项目当前范围；
- “固定治理骨架”是否又被写成固定业务 Agent；
- mock 工具是否被误写成完整产品能力。

本轮只给逐段修订建议和建议新文本，不直接修改这些文件。

## 10. 最终交付物

执行者只允许在本目录新增或更新以下研究产物：

```text
research/morethancorn/10-qoderwake-product-research/
├── 00-route-and-object-inventory.md
├── 01-qoderwake-product-observation.md
├── 02-current-platform-reality.md
├── 03-agentscope-2.0.8-contract.md
├── 04-reference-to-mtc-mapping.md
├── 05-target-architecture-proposal.md
├── 06-design-conflict-matrix.md
├── 07-open-decisions.md
├── EVIDENCE-INDEX.md
└── screenshots/
```

`07-open-decisions.md` 至少为每个未决项写：

- 问题；
- 为什么现有证据不能决定；
- 选项；
- 默认建议；
- 代价；
- 推迟决定的影响；
- 需要用户回答的最小问题。

`EVIDENCE-INDEX.md` 必须能从任何架构结论反查到：

- 原站步骤与截图；
- 我方代码文件/行号；
- AgentScope 官方链接/tag/行号；
- 推断与设计建议。

## 11. 已有种子证据：只能复核，不能直接继承结论

当前已经留下五张初步截图：

- `screenshots/01-task-board.png`
- `screenshots/02-autonomous-work-list.png`
- `screenshots/03-autonomous-task-create.png`
- `screenshots/04-autonomous-task-create-lower.png`
- `screenshots/05-autonomous-task-advanced.png`

初步可见但仍需独立复核的观察：

- 任务看板聚合任务数量、进行中、需操作、已完成，并提供多维过滤；
- 自主工作明确写有定时、事件或 API 触发，以及 Waker/WakerFlow 两类响应者；
- 新建自动任务把触发条件、执行方式、执行指令和工作空间放在同一表单；
- 一个自动任务界面显示最多可添加 5 个触发方式；
- 执行方式明确区分“交给 Waker”和“运行 WakerFlow”；
- 工作空间有默认、本地目录、项目三种可见选项；
- 高级设置目前可见最大运行次数和截止日期。

这些截图不能证明：

- API 的真实 schema；
- target 是否 pin 到发布版本；
- WakerFlow 的内部状态机；
- 选择性重做；
- 工作空间隔离；
- 自动任务的幂等和并发；
- Waker 与 WakerFlow 双向调用的治理实现。

## 12. 主审计者的验收方式

执行者提交后，主审计者按以下顺序检查：

### R1 · 证据可重放

- 随机抽 10 条 O1/O2 结论，能按 URL、前置状态和截图复现；
- 随机抽 10 条 C1 结论，行号和调用链正确；
- 随机抽 8 条 A1 结论，官方版本和源码位置正确；
- 截图没有空白、黑屏、敏感数据或误导性裁切。

### R2 · 半截调查检查

重点找以下失败模式：

- 只看创建页没看详情/运行页；
- 只看 UI 没追 Runtime；
- 只看到类名没追实例化和调用；
- 只看成功路径没查失败、取消、恢复和幂等；
- 只看官方示例没看 Protocol；
- 只看到“支持”按钮就声称生产可用；
- 把 mock/fixture/POC 写成平台现状；
- 把原站概念直接翻译成我方表名。

任一核心结论命中上述模式，退回补证。

### R3 · 架构闭合

使用四条时序逐事件审：

- 每一步谁是控制者；
- 创建哪个 Run；
- 是否创建 Session；
- 版本与资源快照从哪里来；
- 权限、预算、取消和 deadline 如何传播；
- 状态在哪里持久化；
- 副作用如何幂等；
- 前端显示什么；
- 失败后重做谁，不重做谁。

任何一步出现“平台自动处理”“AgentScope 自带”“后面补”而没有契约，视为未闭合。

### R4 · 冲突与决策纪律

- 未决项没有被写成 DECIDED；
- 新决定有明确 supersede 对象；
- 旧 D01–D22 不被静默覆盖；
- 不因追求像 QoderWake 而重复建设我方已有 Workflow/Task/Resource 能力；
- 不因复用旧代码而保留已经证明断链的双事实源。

### R5 · 最终状态

主审计者只给以下三种结果：

- `ACCEPTED_FOR_DOC_REVISION`：允许统一修订交接单、总计划和前端配置设计；
- `REWORK_REQUIRED`：列出缺失证据和具体返工步骤；
- `BLOCKED_FOR_USER_DECISION`：仅当真实产品选择会改变领域模型或权限边界时使用。

在收到 `ACCEPTED_FOR_DOC_REVISION` 前，任何人不得把本轮提案写成实施基线，也不得启动 P0 代码工作。

## 13. 完成定义

本任务完成不是“看完页面”，而是同时满足：

- 目标产品核心路径被当前证据覆盖；
- 我方现有代码链路被独立核验；
- AgentScope 2.0.8 版本事实与契约被官方证据固定；
- 三种架构案被公平比较；
- 推荐方案能解释双 Flow、双向调用、Task/Automation、Run/Session、资源、工作空间和安全边界；
- 与六份现有设计文档的冲突逐段列出；
- 开放问题没有被偷偷拍板；
- 主设计稿和产品代码保持未修改。

