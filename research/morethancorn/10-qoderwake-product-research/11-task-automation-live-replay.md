# 11 · 任务看板与自主工作副作用实调

> 日期：2026-09-08
> 实例：`http://127.0.0.1:19830`（QoderWake CN）
> 状态：`OBSERVED / DOCS_ONLY`
> 测试对象：`TEST-CODEX-AUTOMATION-20260908-EDITED`
> 凭据纪律：API invoke key 和 Bearer PAT 均只记掩码，不保存、不输出原值。
> 清理状态：定义仍保留在本地实例；删除属于不可撤销动作，待用户即时确认后执行。删除确认文案已观察，尚未提交。

## 1. 调研边界与证据分级

本轮撤销 01 号报告的“全程只读”限制，实际执行了新建、编辑、启停和手动运行。证据来源分三类：

- `O1`：浏览器可见 DOM、路由、状态变化；
- `N1`：浏览器 page-assets 记录到的真实 fetch/XHR URL；
- `B1`：当前实例实际加载的前端 bundle 中的 method/path/payload 代码。

`B1` 只用于理解目标产品行为，不作为 MoreThanCorn 调用 QoderWake 私有 API 的依据。

## 2. 创建与编辑

### 2.1 表单校验（O1）

空表单点击“保存”不会提交，出现：

- toast：`请检查并填写表单中的必填项`；
- 名称错误：`请填写名称`；
- 执行指令错误：`请填写执行指令`。

### 2.2 创建（O1/N1/B1）

创建一个 API 触发、Waker 执行的 TEST 自动任务后：

- 列表总数 `1 → 2`，已启用 `1 → 2`；
- 新定义默认启用；
- 创建命中 `POST /api/agents/{workerId}/triggers`；
- 列表仍通过 `GET /api/triggers?targetType=agent|workflow&page=...` 聚合 Waker 与 WakerFlow 两类目标；
- Waker payload 的目标 bundle 映射字段包含：`triggerName`、`taskDescription`、`model`、`reasoningEffort`、`contextWindow`、`workspaceSource`、`triggers`、`enabled`、`maxRuns`、`endDate`、`behavior`、`permissions` 等。

这证明“页面定义”与“每次执行”是两层对象；也证明不能把 QoderWake 的字段名直接当成 AgentScope Schedule schema。

### 2.3 编辑（O1/N1/B1）

编辑表单明确提示：

> 已保存自动任务的执行方式和执行对象不能修改。如需调整，请新建自动任务。

当前 Waker 目标使用 `PUT /api/agents/{workerId}/triggers/{triggerId}` 更新定义；全局详情使用 `GET/PATCH /api/triggers/{triggerId}` 读取和切换状态。保存改名后详情标题立即更新。

## 3. Waker 与 WakerFlow 配置差异（O1）

### Waker 目标

- 选择 Waker；
- 执行指令（Prompt，10000 字上限）；
- 模型（Auto/明确模型）；
- Workspace：默认工作空间、本地目录、项目；
- 高级限制。

### WakerFlow 目标

- 选择 WakerFlow；
- 展示流程节点数、人工确认节点数和阶段名称；
- 有输入参数时配置固定值或“从触发数据按字段路径取值”；
- 不再显示 Waker 专属 Prompt、模型和 Workspace 表单；
- 高级限制仍保留。

当前实例唯一可选 Flow 为 `text-only-review`，显示“2 个节点 · 包含 0 个人工确认节点”，阶段为“确认/复核”。

因此，Agent 与 AgentFlow 不是在同一张表单里只换一个 target id；它们的运行参数契约不同。保存后 target kind 与 target id 都不可变。

## 4. 启停（O1/N1/B1）

详情页切换 enabled：

- `启用 → 停用 → 启用` 均即时生效；
- 标题区 switch 和“运行概览/当前状态”同步变化；
- 命中 `PATCH /api/triggers/{triggerId}`，body 为 `{enabled: boolean}`；
- bundle 另有管理契约 `PATCH .../triggers/{id}/enabled`，但本轮全局自主工作详情实际走前一个 endpoint，不能混写为一个 API。

官方说明补充：暂停只阻止新的自动触发，不会停止已经运行中的任务。最大运行次数和截止日期也是**新触发准入门**，不是运行中取消器。

失败时 switch 是否乐观回滚，本轮没有制造网络故障，仍为 `EVIDENCE_GAP`。

## 5. 手动运行、Session 与统计口径（O1/N1/B1）

点击“运行”后：

1. toast：`已发起运行`；
2. `POST /api/triggers/{triggerId}/run-now`；
3. 运行历史立即出现 `手动 / 运行中 / 运行中`；
4. 约 7 秒后变为 `手动 / 成功 / 成功`；
5. “查看任务”跳到 `/conversations/{conversationId}?sidePanel=history&historyTab=trigger&sid={sessionId}`；
6. 页面通过 `GET /api/sessions/{sessionId}`、`.../events/turn-page`、`.../artifacts` 加载输入、Agent 回复和产物；
7. 本次测试回复为 `TEST_OK`。

详情四指标保持：最近自动触发 `—`、累计自动运行 `0`、最近自动结果 `—`。因此已实证：手动运行创建真实执行 Session，但被自动统计明确排除。

这也直接纠正“无状态任务不需要 Session”：产品可以不向用户暴露长期对话，但一次执行仍需要可查询的 Session/执行容器。MoreThanCorn 采用 AgentScope 后应直接使用其 fresh Session，而不是另造 Run 来补观测。

## 6. 任务看板投影与查询（O1/N1）

手动运行成功后：

- 总数 `8 → 9`，已结束 `8 → 9`；
- 新行名为 `{automationName} #1`；
- 执行者为目标 Waker；
- 来源显示“手动触发”；
- 状态显示“已完成”；
- 点击行回到同一 conversation/session。

真实接口：

- `GET /api/board/summary?period=30d`；
- `GET /api/board/tasks?period=30d&offset=0&limit=10`；
- `GET /api/board/filter-options`。

泳道实际为五组查询：

- `pending` → 需要操作；
- `running` → 执行中；
- `done` → 已完成；
- `waiting` → 排队中；
- `failed,cancelled` → 失败/取消。

当时泳道为已完成 7、失败/取消 2、其余 0，合计 9，与顶部“已结束 9”一致；所以“已结束”确实包含成功、失败、取消三类终态。

搜索 `TEST-CODEX` 后，各泳道和列表请求都增加 `keyword=TEST-CODEX`，证明搜索为服务端查询，不是纯前端过滤。触发方式筛选可见枚举为：手动、定时、事件、API、`@Waker`、对话。

“需要操作/查收结果”当时均为 0，本轮没有伪造 HITL 或查收事件，二者持久化契约仍为 `EVIDENCE_GAP`。

## 7. API 触发契约（目标官方文档 + O1）

来源：[QoderWake 自主工作官方说明](https://docs.qoder.cn/qoderwake/automated-tasks#%E9%85%8D%E7%BD%AE-api-%E8%A7%A6%E5%8F%91)。

详情展示生成的 POST invoke URL；该 URL 本身含生成 key，同时调用还要求独立 Bearer PAT。两者都属于凭据，不进入仓库。

官方规则：

- body 为结构化 JSON；
- Prompt 可用 `{{field}}`、`{{nested.field}}`、`{{items[0].name}}` 取值；
- 无占位符时固定 Prompt 保留，完整 body 作为本次输入附加；
- 相同用户、自动任务与顶层字符串 `wakeSessionUniqueId` 会复用同一聊天并顺序处理；
- 不传或更换该值会创建新聊天；
- `wakeSessionUniqueId` **不是幂等键**，调用方仍须去重；
- 接口返回“已接受”不等于业务完成，必须从运行记录/Session 查终态与产物。

目标文档没有给出可直接照搬的签名、限流、重放保护和异步回调协议。MoreThanCorn 只能复刻产品能力，必须自行设计安全鉴权与幂等，不能复制 `atk_` URL 形态。

## 8. 事件与定时拉取的纠错

“当前表单只见定时/API”不等于“产品不支持事件”。当前页面实际请求 `/api/plugins/capabilities/trigger/event-sources`；官方文档说明事件入口依赖已安装并授权的事件源，部分页面还会条件展示“定时拉取”。

正确结论是：

- 事件/定时拉取是 capability-gated；
- 当前实例没有可用 event source，所以创建卡未出现；
- MoreThanCorn 应把数据源、过滤、去重和触发器解耦，按实际已注册 capability 展示，不写死入口。

## 9. 仍未闭合

- 删除确认弹窗已观察：`删除这个自动任务？`，说明“删除后将停止触发，此操作不可撤销”。最终删除未执行；软删/硬删、历史保留、invoke URL 失效时点待证。
- 启停失败时 UI 回滚。
- 并发触发、错过调度、连续失败、重试和限流。
- “需要操作/查收结果”的持久化写契约。
- API 实际 accepted response schema、错误 schema 与认证失败样本。

这些未证项继续保持 `EVIDENCE_GAP`，不能用目标 bundle 或 MoreThanCorn 现有实现补猜。
