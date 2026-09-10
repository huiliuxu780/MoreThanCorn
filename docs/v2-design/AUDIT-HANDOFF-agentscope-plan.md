# 审计交接单 · AgentScope 原生接管与 QoderWake 产品复刻

> 日期：2026-09-08
> 版本：v3.0
> 状态：`DOCS_IN_REWRITE / CODE_FROZEN`
> 用途：后续审计者、调研者与文档修订者的唯一入口

## 0. 先读结论

旧“AgentScope 统一运行方案”不能继续实施。它虽然声明 AgentScope 是唯一底座，实际仍计划由平台拥有 Session、AgentState、消息、调度、事件投影、Checkpoint 和 Agent 观测，只把 AgentScope 当作通用 Provider 后面的执行库。

现行方向已经改为：

1. AgentScope app 是唯一 Agent 运行时和 Agent 应用服务底座。
2. AgentScope 已有的 Agent、Session、ChatService、AgentState、Schedule、Skill、MCP、Knowledge、Workspace、Team、Task tools、AgentEvent 和 tracing 直接采用。
3. 平台不再复制 AgentState、Session、消息、Agent scheduler 或完整 Agent trace。
4. 任务看板和自动任务的产品体验高保真复刻 QoderWake 已实测行为，不再自由设计。
5. 现有确定性 Workflow 保留；AgentFlow 产品面参考 WakerFlow，但运行时只采用 AgentScope 2.0.8 经验证的 Pipeline 能力。
6. MQ/API/Webhook/数据库轮询属于 AgentScope 未覆盖的数据接入缺口，独立调研和补充。
7. 代码继续冻结；当前只允许文档和证据工作。

## 1. 权威文档

按以下顺序阅读：

1. `research/morethancorn/10-qoderwake-product-research/10-agentscope-native-adoption-and-replica-decision.md`：本轮纠偏控制单。
2. `docs/v2-design/11-agentscope-full-integration.md` v6.0：总架构与分期。
3. `docs/v2-design/05-agent-management-redesign.md` v3.0：AgentScope 原生资源装配和版本发布边界。
4. `docs/v2-design/08-agent-pages-align-19830.md` v3.0：前端与 QoderWake 复刻边界。
5. `.replica/CODEBASE_CONTRACT.md`：代码库实现约束。
6. `.replica/DOMAIN_MAPPING.md`：目标产品到我方领域映射。
7. `.replica/research/` 与 `.replica/specs/`：任务/自动任务的证据、状态矩阵和页面规格。
8. `research/morethancorn/10-qoderwake-product-research/01-qoderwake-product-observation.md`：目标产品原始观察。
9. `research/morethancorn/10-qoderwake-product-research/11-task-automation-live-replay.md`：任务/自动任务 TEST 副作用、请求路径、Session 回链和 API 规则。
10. `research/morethancorn/10-qoderwake-product-research/02-current-platform-reality.md`：当前代码事实。
11. `research/morethancorn/10-qoderwake-product-research/03-agentscope-2.0.8-contract.md`：AgentScope 2.0.7/2.0.8-dev 源码事实。

`05-target-architecture-proposal.md` 与 `09-main-review-decision.md` 中的平台自建架构已经 superseded，只能用于追溯纠错历史。

## 2. 必须复核的 AgentScope 事实

| 编号 | 事实 | 本地复核入口 |
|---|---|---|
| AS-01 | 当前实际安装为 2.0.7 | `runtimes/agentscope/.venv/.../agentscope/_version.py` |
| AS-02 | AgentData 包含 system_prompt/context/react/invite，不包含 model | `agentscope/app/storage/_model/_agent.py` |
| AS-03 | Model、Knowledge、Workspace 绑定在 SessionConfig | `agentscope/app/storage/_model/_session.py` |
| AS-04 | SessionRecord.state 是 AgentState 唯一原生持久载体 | 同上 |
| AS-05 | ChatService 每回合临时装配 Agent，持久化消息/state，并使用 Session 锁和事件总线 | `agentscope/app/_service/_chat.py` |
| AS-06 | 非 stateful schedule 每次仍创建 fresh Session | `agentscope/app/_manager/_scheduler/_scheduler_manager.py` |
| AS-07 | stateful schedule 复用 `{schedule_id}_stateful` Session | 同上 |
| AS-08 | Schedule 有原生执行 Session 列表 API | `agentscope/app/_router/_schedule.py` |
| AS-09 | get_toolkit 统一装 Workspace/Task/Schedule/Team/extra/channel/Skill/MCP | `agentscope/app/_service/_toolkit.py` |
| AS-10 | Skill 先安装到用户 Library，再复制进 Workspace，运行时从 Workspace 读取 | `_router/_skill.py`、`_router/_workspace.py` |
| AS-11 | MCP 先进入 Library，再进入 Workspace；Workspace `.mcp` 是 actual state | `_router/_mcp.py`、`_model/_mcp.py` |
| AS-12 | Session SSE 只保证当前 replay log + live stream，replay 上限 1000 | `_router/_session.py`、`message_bus/_keys.py` |
| AS-13 | TracingMiddleware 产生 Agent/model/tool OTel span | `agentscope/middleware/_tracing/_trace.py` |
| AS-14 | 2.0.7 create_app 没有一等 observability 开关 | `_app.py` 与官方 discussion #1835 |
| AS-15 | 2.0.8-dev Pipeline 未进入 create_app/ChatService/Session storage | 研究 03 项10及固定提交源码 |

任何文档若写出相反结论，必须先修正文档，不能通过增加“平台兜底层”掩盖冲突。

## 3. QoderWake 可以直接复刻的范围

### 任务看板

- 周期指标；
- 需要操作/查收结果；
- 全部任务列表/泳道；
- 搜索、执行者、触发方式、状态、周期筛选；
- 对话 Session、Flow execution、Automation execution 混排；
- 跳转各自原生详情。

### 自动任务

- 列表指标、筛选、enabled switch；
- 名称、最多五个触发；
- 定时/API、定期/一次性；
- 执行目标 Agent/AgentFlow；
- 指令、Workspace、最大运行次数、截止日期；
- 详情概览、触发条件、响应对象、运行历史；
- 手动调试不计入自动运行统计。

这些结论有截图和 O1/O2 观察证据，可以直接进入页面规格。

## 4. 当前不能复制或不能声称已具备

- 自动任务 API 的实际 response/error schema、我方鉴权、幂等、签名、限流和重放保护。
- 删除历史、启停失败回滚和失败重试；暂停只阻止新自动触发、不取消已运行任务已经闭合。
- 事件/定时拉取按 capability 条件出现；当前实例无事件源，不得写死静态入口。
- 任务看板查收/关注状态的持久来源。
- 完整 loading/error/permission/partial 状态。
- QoderWake Flow 的选择性重做、跨进程恢复、嵌套与环限制。
- AgentScope Studio 与当前 2.0.7 app 已稳定接通。
- 永久完整 Agent trace、成本面板、跨引擎谱系。

以上必须保持 `EVIDENCE_GAP`，不得由现有 MoreThanCorn 行为或设计偏好补写。

## 5. 当前代码处置分类

### `REPLACE_BY_AGENTSCOPE`

- 自建 Agent Chat Session/message/state；
- Agent scheduler；
- Agent Skill/MCP runtime registry；
- Agent trace mapper 作为主观测源；
- 将 AgentScope 压成 execute/status/trace Provider 的主路径。

### `KEEP_AS_PLATFORM_GAP`

- 现有 Workflow；
- 外部数据接入；
- 业务结果写回与对账；
- 租户、平台权限和导航。

### `AUDIT_BEFORE_KEEP`

- Agent/Module/Version/Release；
- Run/RunEvent/TaskRun；
- Tool/Skill/Knowledge/MCP 等现有资源表；
- Runtime Provider Contract。

不能因为代码已存在就保留，也不能在迁移审计前删除。

## 6. 当前未决项

| 编号 | 问题 | 为什么不能猜 |
|---|---|---|
| O-01 | AgentVersion 如何物化为不可变 AgentRecord | AgentScope 没有 release，直接覆盖会破坏旧 Session 可复现性 |
| O-02 | Skill archive 如何随 Release 长期保全 | SkillRecord 只存摘要，Hub 下线后官方有已知缺口 |
| O-03 | MCP 凭据如何接平台 KMS | AgentScope client/values 与双写风险未审清 |
| O-04 | Pipeline 的 Session/State 如何托管 | 2.0.8-dev 尚未进入 app 层 |
| O-05 | AgentFlow 最小产品控制面 | 必须由 Pipeline spike 定义缺口 |
| O-06 | 现有 Run/TaskRun 哪些保留 | 需逐查询和业务职责审计 |
| O-07 | 任务看板查收/关注持久语义 | 目标网络行为未捕获 |
| O-08 | 自动任务删除、失败回滚、并发/重试、API 错误契约 | 创建、编辑、启停、手动运行已实调；其余未闭合 |
| O-09 | 数据接入首个真实场景 | 没有真实 MQ/API/DB 需求无法冻结通用模型 |
| O-10 | 2.0.7 tracing 到 Studio/OTLP 的实际接入 | 官方 v2 app 一键入口缺失 |

## 7. 下一步执行顺序

1. 完成 AgentScope 原生接管表：每个当前实体标记 `DIRECT_USE / THIN_PROXY / PLATFORM_GAP / RETIRE`。
2. 用独立测试环境跑 AgentScope app：Agent、Session、Schedule、Skill、MCP、Knowledge、HITL、SSE。
3. 做 OTel tracing spike；没有真实 trace 不设计观测页面。
4. TEST 实调已闭合创建、编辑、启停、手动运行与看板投影；继续补删除、关注动作和失败路径，并清理测试数据。
5. 完成 AgentFlow 2.0.8 固定版本 spike。
6. 再决定代码迁移和删除范围。

## 8. 文档门禁

- `git diff --check` 通过。
- 明文凭据扫描为零。
- “无状态不创建 Session”“平台存 AgentState”“平台拥有 Agent scheduler”等旧句只能出现在明确标注的撤回/反例段，不能出现在现行方案或验收项。
- 每个前端字段都有目标产品证据或 AgentScope schema。
- 每个新增平台能力都有 AgentScope 缺口证据。
- 观测项全部有实际 API/OTel 输出，不用 mock、表名或组件名代替。
- Pipeline 事实区分 2.0.7、2.0.8-dev 和未来正式版。

通过文档门禁只代表 `DOCS_ACCEPTED`，不等于代码开工。代码实施仍需独立 `IMPLEMENTATION_READY`。
