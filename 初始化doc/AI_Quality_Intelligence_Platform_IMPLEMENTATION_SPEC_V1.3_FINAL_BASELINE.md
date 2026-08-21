# AI Quality Intelligence Platform
# IMPLEMENTATION SPEC V1.3 — FINAL BASELINE

> 基线：
> - Master：`AI_Quality_Intelligence_Platform_产品架构冻结文档_V1.38_FINAL_BASELINE.md`
> - Design Spec：`AI_Quality_Intelligence_Platform_DESIGN_SPEC_V1.18_FINAL_BASELINE.md`
>
> 状态：**FROZEN**
>
> 说明：P2 仅定义实现约束，不重新设计已冻结页面。`Result Rules UI Home` 已确认，Route Map 正式冻结。

---

# 1. Route Map

## 1.1 Core Navigation

```text
智能质检
├─ 质量总览
│  /quality/overview
│
├─ 质量结果
│  /quality/results
│
└─ 坐席分析
   /quality/agent-analysis

配置管理
├─ 分析任务
│  /config/tasks
│
├─ Agents
│  /config/agents
│
├─ Tools
│  /config/tools
│
└─ 数据定义
   /config/data-assets
```

系统级设置：

```text
Settings
└─ Connections
   /settings/connections
```

## 1.2 Detail / Editor Routes

```text
Quality Result Detail
/quality/results/:interactionId

Task Create
/config/tasks/new

Task Detail
/config/tasks/:taskId

Task Edit
/config/tasks/:taskId/edit

Run Detail
/config/tasks/:taskId/runs/:runId

Agent Designer
/config/agents/:agentId

Tool Create
/config/tools/new

Tool Detail
/config/tools/:toolId

Data Asset Create
/config/data-assets/new

Data Asset Detail / Editor
/config/data-assets/:assetId

Result Rules Detail / Editor
/config/result-rules/:ruleSetId
```

Version / Revision 默认不通过独立 route 建页：

```text
Agent Version
→ 当前 Agent Designer + version query/state

Tool Version
→ Tool Detail + Version History Sheet

Data Asset Revision
→ Data Asset Detail + Revision History Sheet
```

Connections 的 Create / Edit 维持轻量二级交互，不额外占用一级页面 route。

## 1.3 Route Blocker

`Result Rules` 已冻结为独立一等业务配置对象，但 UI Home 尚未冻结。

因此以下 route 当前不得由 Codex 自行创建：

```text
/config/result-rules
/settings/result-rules
/config/evaluation-rules
```

待产品确认后补入正式 Route Map。

---

# 2. Status Visual Mapping

## 2.1 Global Rule

统一使用：

```text
Badge
Status Indicator
Icon + Label
```

颜色只能作为辅助语义，状态文字必须始终存在。

全局状态语义 token：

```text
neutral
info
success
warning
danger
```

具体颜色由 shadcn theme / CSS variables 管理，不在页面组件内硬编码 hex。

## 2.2 Agent

```text
Draft       → neutral
Testing     → info
Published   → success
Deprecated  → neutral
```

## 2.3 Tool

Version：

```text
Draft       → neutral
Published   → success
```

Governance：

```text
Enabled     → success
Disabled    → neutral
Deprecated  → neutral
```

## 2.4 Data Asset

Lifecycle：

```text
Draft       → neutral
Ready       → success
Deprecated  → neutral
```

Health：

```text
Healthy     → success
Degraded    → warning
Error       → danger
```

Lifecycle 与 Health 必须分别显示，不能合并为一个 Badge。

## 2.5 Run

```text
PENDING          → neutral
RUNNING          → info
SUCCESS          → success
PARTIAL_SUCCESS  → warning
FAILED           → danger
CANCELLED        → neutral
BLOCKED          → danger
```

## 2.6 Interaction Execution

```text
SUCCESS  → success
ERROR    → danger
SKIPPED  → neutral
```

业务质量 FAIL / High Risk 不得复用 Execution Error 状态。

## 2.7 Review

```text
PENDING     → warning
IN_REVIEW   → info
COMPLETED   → success
REOPENED    → warning
```

## 2.8 Connection

```text
Connected      → success
Failed         → danger
Not Tested     → neutral
Testing        → info
```

---

# 3. RBAC UI Behavior

## 3.1 View Permission

无 View 权限：

```text
隐藏对应 Navigation Item
直接访问 route → 403
```

不得只依赖前端隐藏，后端仍做最终授权。

## 3.2 Action Permission

用户有 View、但无 Create / Edit / Publish / Delete / Review 等权限：

```text
权限不足导致不可执行的 Action
→ 默认隐藏
```

避免页面充满永久 Disabled 按钮。

## 3.3 State Constraint

用户有权限，但因当前对象状态暂不可执行：

```text
→ 显示 Disabled
→ Tooltip 解释原因
```

例如：

```text
Published Agent 无法直接编辑
→ Edit Disabled / 或仅提供“基于此版本创建 Draft”
```

这与“无权限隐藏”必须区分。

## 3.4 Read-only Object

只读状态：

```text
字段保持正常可读
不切换为大量 disabled input
```

使用静态 text / definition row 表达。

## 3.5 Secret

Credential / Secret：

```text
任何 UI 均不回显明文
```

即使拥有 Connection 编辑权限，也只显示：

```text
••••••••
已配置
```

---

# 4. Query-state / Pagination

## 4.1 Common Query Keys

列表页统一使用：

```text
search
page
pageSize
sort
```

按页面需要增加：

```text
filters
tab
view
```

禁止为同类功能在不同页面分别使用：

```text
q / keyword / searchText
p / pageNo / currentPage
```

## 4.2 URL Source of Truth

可分享 / 可恢复的列表状态必须进入 URL Query。

包括：

```text
Search
Filter
Sort
Page
Page Size
Tab
```

临时 UI 状态不进入 URL：

```text
Dropdown Open
Hover
Tooltip
未提交表单输入
```

## 4.3 Reset Rule

当以下条件变化时：

```text
search
filters
sort
tab
```

自动：

```text
page = 1
```

仅改变 pageSize 时同样返回第一页，避免当前页越界。

## 4.4 Detail Return

列表页本身完整保存 query state。

从列表进入 Detail，再使用浏览器 Back 或页面 Back：

```text
→ 恢复原 query URL
→ 恢复筛选 / 排序 / 分页
```

不在全局 store 再复制一份列表状态。

## 4.5 Server-side

以下大列表使用 Server-side Pagination / Filter / Sort：

```text
Quality Results
Interaction Executions
Analysis Tasks
Tools
Data Assets
Agents
Connections
```

---

# 5. Date / Time / Timezone

## 5.1 Storage

后端持久化时间统一使用：

```text
UTC timestamp
```

页面显示转换为：

```text
Enterprise Timezone
```

企业时区由部署 / 系统设置提供，不在页面组件内硬编码。

## 5.2 Display

普通业务页面：

```text
YYYY-MM-DD HH:mm
```

只有需要秒级排障时：

```text
YYYY-MM-DD HH:mm:ss
```

例如：

```text
Trace
Tool Call
Execution Attempt
```

## 5.3 Duration

统一使用紧凑 duration：

```text
850ms
2.1s
1m 08s
42m 18s
1h 12m
```

## 5.4 Data Window

Task / Run 中 Data Window 必须显式展示开始与结束。

执行与后端 Contract 统一采用：

```text
[start, end)
```

即开始时间包含、结束时间不包含。

前端对用户仍使用自然语言日期窗口，例如：

```text
2026-08-17 全天
```

技术详情可展示实际：

```text
2026-08-17 00:00
→
2026-08-18 00:00
```

## 5.5 Schedule

Schedule 按 Enterprise Timezone 解释。

DST / timezone conversion 由 runtime 处理，前端不得自行通过浏览器本地时区推断周期任务。

---

# 6. List pageSize

## 6.1 High-density Operational Lists

```text
Quality Results
→ default 50
→ options 20 / 50 / 100

Run Interaction Executions
→ default 50
→ options 20 / 50 / 100
```

## 6.2 Standard Tables

```text
Analysis Tasks
Data Assets
Agents
Connections

→ default 20
→ options 20 / 50 / 100
```

## 6.3 Tools Card Grid

Tools 为 4 列紧凑卡片：

```text
default 24
options 12 / 24 / 48
```

24 可在 4 / 3 / 2 列响应式布局下保持相对完整的分页网格。

## 6.4 Analytics Tables

质量总览 / 坐席分析中的分析表不是资产管理列表。

默认：

```text
20 rows
```

如果数据超出，使用 Pagination 或“查看全部”进入既有结果页，不把分析页扩展成无限滚动数据表。

---

# 7. Loading / Empty / Error

统一实现：

```text
Loading
→ Skeleton

No Data
→ Empty State + 下一步动作

Filter No Result
→ 保留 Toolbar + 清除筛选

Request Error
→ Inline Error + Retry

Permission Error
→ 403

Not Found
→ 404
```

不得用 Toast 替代完整页面加载失败状态。

Mutation 成功可以 Toast；关键失败必须保留可见错误上下文。

---

# 8. Destructive / Confirmation Actions

统一使用 Dialog：

```text
Publish
Delete
Disable（有明显影响时）
Rerun
Complete Review
Cancel Running Run
Approve Side Effect
```

Dialog 必须说明：

```text
对象
影响
是否可逆
```

不使用浏览器原生 confirm。

---

# 9. P2 Frozen Decision

`Result Rules UI Home` 已冻结：

```text
配置管理
└─ 结果规则
```

路由：

```text
/config/result-rules
/config/result-rules/:ruleSetId
```

它是独立质量业务配置资产，不属于 Agent Designer，也不属于 Settings。

`Settings / Connections` 保持系统级基础配置。

P2 Implementation Spec 至此不再有 Route Map 阻塞项。

注意：

> Result Rules 页面级 Design Spec 已在 `AI_Quality_Intelligence_Platform_DESIGN_SPEC_V1.18_FINAL_BASELINE.md` 补齐；当前核心页面不存在页面级设计缺口。

---

# 10. Page Spec Completion

Result Rules 页面级 Design Spec 已完成。

当前可作为实现基线的三份文档：

```text
Master
→ AI_Quality_Intelligence_Platform_产品架构冻结文档_V1.38_FINAL_BASELINE.md

Design Spec
→ AI_Quality_Intelligence_Platform_DESIGN_SPEC_V1.18_FINAL_BASELINE.md

Implementation Spec
→ AI_Quality_Intelligence_Platform_IMPLEMENTATION_SPEC_V1.3_FINAL_BASELINE.md
```

当前状态：

```text
Core Product Model      ✅
Core Navigation         ✅
Core Page Design Spec   ✅
Route Map               ✅
Status Mapping          ✅
RBAC UI Behavior        ✅
Query State             ✅
Timezone                ✅
Pagination              ✅
```

下一阶段不再补页面，进入原型实现准备与 Codex Handoff。
