# 12 · 换底前端复刻调研记录（2026-09-09 实地，127.0.0.1:19830）

> 证据：浏览器实地操作 + DOM snapshot + 对照截图 `screenshots/cutover-*.png`
> 纪律：只复刻行为与视觉语言；不复制品牌/私有 API/凭据；Group 能力不引入。

## 1. 页面 → 我方页面 → 数据来源 映射

| QoderWake 页面/区块 | 我方页面 | 数据来源（真实） |
|---|---|---|
| 侧边导航壳（品牌行/折叠按钮/分组 heading/链接/员工列表/底部用户区） | `app-sidebar.tsx` 重做 | 静态结构 + 路由；员工列表区**不引入**（改为我方模块链接）；Group tablist **移除** |
| /work-management 任务看板（指标带/需要关注/列表+泳道/五筛选/表列） | `/tasks` | `/api/board/summary|tasks|filter-options`（Session 索引+Workflow Run+AgentFlow Run 投影） |
| /autonomous-work 列表（四指标/四筛选/七列表/启用 switch/分页） | `/autonomous-tasks` | `/api/v2/automations`（AutomationDefinition + 运行时 Schedule sessions 统计） |
| 自动任务详情/运行历史/手动运行 | `/autonomous-tasks/:id` | `/api/v2/automations/{id}` + `/history`（trigger log + schedule sessions） |
| 对话/运行界面（消息流/思考块/回复操作/右侧历史面板/composer） | `/agents/:id/chat` | 运行时 `/sessions/{id}/messages|stream|status`（SSE 原生 AgentEvent） |
| /management Waker 管理 | `/agents` | 平台 Agent 控制面 + `/api/v2/agents/{id}/runtime-view` |
| /resources 能力与资源 | `/resources/*` | 运行时 library/workspace 两态代理（`/api/v2/agents/.../skills|mcps`、`/api/v2/knowledge-bases`） |
| （QoderWake 无） | `/agentflows`、`/data-sources` | 我方控制面（AgentFlow 定义/版本/发布/运行；DataSource/Event） |

## 2. 导航壳实测事实（snapshot）

- 结构：`complementary "Chat 对话"` 内含：品牌 `strong`、`button 折叠侧边栏 [expanded]`、`navigation 工作台导航`（heading 工作管理 → 任务看板/@Waker/自主工作；heading 员工资源 → Waker 管理/能力与资源）、`tablist 员工与群组`（Waker(n)/Group(n)）、新建按钮、搜索框、员工卡片列表（avatar+名称+描述）、底部 `strong 用户名 + 团队版 + 用量/设置按钮`。
- 折叠后仅图标轨（截图 cutover-nav-collapsed.png）。
- 我方复刻：分组 heading  Work（任务看板/自动任务）与 Resources（Agent/Workflow/AgentFlow/资源/数据接入）；移除 Group tablist 与员工列表区；底部保留用户+设置；折叠行为同构。

## 3. 运行界面实测事实（snapshot + cutover-waker-run-ui.png）

- 主列：任务标题头 + `当前任务` 按钮；用户消息（文本+time+复制）；助手消息（avatar+名称+`深度思考` 折叠块+段落+`回复操作`(复制)+time）；composer（textbox `输入消息，@ 选择当前工作区上下文...` + 选择工作目录 + 添加文件或图片 + Auto + 发送[disabled]）。
- 右栏 `complementary`：Waker 身份链接、`管理`、tablist 对话历史（对话任务/自动任务）、任务条目（`暂无待关注结果` chip+名称+日期）、`打开自动任务详情`、可拖宽 separator。
- 我方映射：思考块**仅**当运行时推送 ThinkingBlock 事件时渲染并标注事件类型；工具调用渲染 TOOL_CALL_*/TOOL_RESULT_* 事件（参数/结果脱敏）；历史面板=Session 索引（对话/自动两 tab）；composer 去掉 @/工作目录（无真实能力不伪造），保留模型选择（Session 默认模型）与附件占位禁用态。

## 4. 自动任务页实测事实（snapshot + cutover-autonomous-work.png）

- 指标带：总数/已启用/Waker 执行/WakerFlow 执行（strong+label+说明三行式）。
- 筛选：执行者/触发类型/自动任务状态/排序 四 combobox。
- 表列：自动任务/触发来源/触发条件/执行者(avatar+名+类型)/最近触发/累计自动运行/状态(switch+label)。
- 分页：`共 N 条` + 上一页/下一页 list。
- 新建按钮在标题行右侧。

## 5. 不复制/不引入清单

- Group 数据模型/页面/权限/URL/切换器（任务书 §十三C）。
- `atk_` invoke key 形态、私有 endpoint、品牌素材。
- "深度思考"若无真实 ThinkingBlock 事件不渲染；`暂无待关注结果` chip 仅当 HITL/查收真实状态存在时渲染（一期无 → 不显示该 chip，不伪造）。
