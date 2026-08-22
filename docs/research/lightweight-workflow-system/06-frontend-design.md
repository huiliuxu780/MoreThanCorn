# 06 · 前端架构设计（Designed，对齐冻结基线）

> 基线：`初始化doc/` V1.38 Master §8、Design Spec V1.18 §4、Implementation Spec V1.3 §1/§4；现状代码 `src/components/agents/*`、`src/pages/agent-designer.tsx`。
> 视觉方向冻结：黑白灰中性、节点轻薄精密、禁止彩虹画布（Master §8.5）。现状 `flow-node.tsx` 的 sim 风格节点已符合，保留。

## 1. 路由（冻结，不新增一级入口）

沿用 Implementation Spec Route Map：`/config/agents`（列表）、`/config/agents/:agentId`（Designer）、`/config/tasks/:taskId/runs/:runId`（Run Detail）、`/config/tools`、`/settings/connections`。
新增（Kernel 需要、且属既有对象的下钻，不占一级导航）：
- `/config/agents/:agentId?version=<v>&sheet=history` — Version History Sheet（Master §7.7，不建独立页）。
- Run Detail 内 `?node=<nodeRunId>` — 从日志定位节点（回 Designer 高亮）。
- Schedule 不建独立页：入口在 **分析任务**（Task=Which Agent+Asset+Scope+Sampling+Schedule，Master §6），Task Detail 内 Schedule 区块 + 执行历史 Tab。

## 2. 组件清单（现有 → 增强）

| 组件 | 现状 | 本轮设计增量（借 quickservice，Observed-UI 借鉴） |
|---|---|---|
| `flow-node.tsx` | sim 风格中性卡+runStatus 环 | 增加**配置摘要行**（输入/输出/模型/未配置灰字，quickservice 节点卡语法）；摘要由 Node Schema 声明，不硬编码 |
| `node-inspector.tsx` | 右 Inspector 骨架 | **schema 驱动表单**（Master §8.6）：Node Definition 提供 fields[]→shadcn 控件；分区折叠；头部=图标+可编辑名称+…+× |
| `variable-picker.tsx` | 变量选择 | 来源四组：Input/Upstream Outputs/State/System（Master §8.7）；级联 Popover；类型过滤（Typed I/O）；提示词内 `#` 唤起（quickservice） |
| `test-run-panel.tsx` | 测试运行 | 增加：前置校验清单（红点=问题数，点击逐条定位，quickservice 检查(9)）；运行中节点状态经 SSE 更新；节点输入/输出 Inspect（Langflow 心智，Master §8.10） |
| 新增 `publish-flow.tsx` | — | Dependency Check 结果面板 + 二次确认（Version Note 必填，Master §7.6）+ 展示使用 Latest Published 的周期 Task |
| 新增 `autosave-indicator.tsx` | — | 顶栏"自动保存于 <t>" + 手动保存（quickservice）；debounce 2s PUT draft |
| 新增 `version-history-sheet.tsx` | — | Sheet 只读历史 + "基于此版本创建草稿"（存在 Draft 时提示，Master §7.4/7.7） |
| 新增 `logs-panel.tsx` | — | Run Detail：节点执行序、NodeRun、Tool Call/Model Call、错误、耗时、token；SSE 实时追加；筛选+复制 |
| 新增 `schedule-section.tsx` | — | Task 内：cron 预设+企业时区说明、启停、下次执行时间、执行历史（跳转 Run） |

## 3. 状态管理

- 列表状态唯一事实来源=URL query（Implementation Spec §4，useListQuery 已有）。
- Designer 状态分三层：① 画布 UI 状态（xyflow viewport/selection，不入服务端）；② Draft 业务状态（nodes/edges/config，单一 reducer，debounce 保存）；③ Run 实时状态（SSE 事件流→nodeRunStatus map，与 Draft 分离，刷新后由 `GET /runs/{id}/events?after=` 重放恢复）。
- Undo/Redo：V1 做画布级（节点/边增删移动）内存栈，**不**做配置字段级（Omit 字段级，成本过高）。

## 4. 实时 Run 事件消费

- `EventSource(/api/runs/{runId}/events)`，Last-Event-ID 断线重放；事件 schema 见 `contracts/run-event.schema.json`。
- 事件→UI：node_started=running 环；node_completed=success+摘要行刷新；node_failed=error+Inspector 定位按钮；workflow_completed=Test Panel 输出 Structured Outputs。
- 页面刷新：先 `GET /runs/{id}` 快照渲染，再 SSE `after=lastSequence` 续接。

## 5. Picker 族（Tool/Model/Connection）

- Tool Picker：列 Tool（锁 Tool Version，Master §6.1）；显示输入/输出 schema；"测试"按钮跳 Tool Detail 的试运行。
- Model Picker：平台模型目录（Provider+模型+能力标签）；默认模型由 Settings 提供；**Model 是节点配置，不是独立节点**（任务书 §11 判断）。
- Connection Picker：仅 Settings/Connections 管理；Picker 只读引用 ID；Secret 永不入 Draft JSON（Master §7.5）。

## 6. 页面与 Kernel 对应

| 页面 | 消费 API 组 |
|---|---|
| Agents 列表 | Workflow CRUD |
| Agent Designer | Draft/Validation/Registry/Runs(test)/Publish/Versions/Events |
| Tools | Tool Registry + Tool 试运行 + 调用日志 |
| Connections | Connection CRUD + 连接测试 |
| Task Detail | Schedule CRUD + Task Runs |
| Run Detail | Run/NodeRun/Events/Result/Evidence |

## 7. 不做（V1）

多选批量编辑、节点收藏/最近使用、画布内搜索节点（Node Search 官方组件可后置）、Group/Subgraph 编辑 UI（Kernel 先不支持）、聊天 Playground。
