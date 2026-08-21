# AI Quality Intelligence Platform
# CODEX HANDOFF V1.0

> 目的：把已冻结产品方案转成可运行前端原型。  
> 本文不是新的产品设计文档，不允许 Codex 基于本文重新解释产品模型。

---

# 0. 唯一有效输入

开始编码前，必须完整阅读以下三份文件，优先级从高到低：

```text
1. AI_Quality_Intelligence_Platform_产品架构冻结文档_V1.38_FINAL_BASELINE.md
2. AI_Quality_Intelligence_Platform_DESIGN_SPEC_V1.18_FINAL_BASELINE.md
3. AI_Quality_Intelligence_Platform_IMPLEMENTATION_SPEC_V1.3_FINAL_BASELINE.md
```

冲突处理：

```text
产品对象 / 业务语义
→ Master 优先

页面布局 / 交互 / 组件
→ Design Spec 优先

Route / Status / RBAC / Query State / Time / Pagination
→ Implementation Spec 优先
```

不得使用旧版本文件覆盖这三份当前基线。

---

# 1. 开工原则

## 1.1 不重新做产品设计

已经冻结的内容直接实现。

禁止自行：

```text
新增一级导航
新增业务对象
新增 Dashboard
合并已解耦对象
恢复废弃对象
把 Result Rules 塞回 Agent
把 Connection 塞进 Tool
把 Run 做成一级导航
把 Human Review 做成独立中心
把 Trace 默认铺在业务页面
```

遇到文档未定义的小型视觉细节：

```text
优先 shadcn 官方成熟模式
→ 其次 React Flow UI 已有组件
→ 再次沿用当前项目既有组件
→ 最后才做最小自定义
```

不要创造新的产品概念来解决纯 UI 问题。

## 1.2 Design System

唯一 UI 基线：

```text
Application UI
→ shadcn/ui

Agent Workflow UI
→ React Flow UI + shadcn/ui
```

明确禁止：

```text
Linear 风格
第二套 Design System
彩虹低代码风格
大面积渐变
Card 套 Card
装饰性大色块
```

颜色只表达：

```text
状态
风险
执行语义
```

## 1.3 不迁移现有技术栈

先检查当前 repository：

```text
package.json
src/
app/ 或 routes/
现有 shadcn 配置
现有 React Flow 依赖
现有主题 / CSS variables
```

如果已有 React 工程：

```text
在现有工程内实现
不得为了原型重建一套框架
```

如果当前仓库没有可运行前端工程：

```text
先报告现状
再建立最小 React 前端骨架
```

除非仓库已经明确采用某框架，否则不要自行把项目迁移到另一框架。

---

# 2. 当前产品导航

核心业务导航固定为：

```text
智能质检
├─ 质量总览
├─ 质量结果
└─ 坐席分析

配置管理
├─ 分析任务
├─ Agents
├─ Tools
├─ 数据定义
└─ 结果规则
```

系统级：

```text
Settings
└─ Connections
```

Application Shell：

```text
shadcn sidebar-03
```

不得为了“更完整”继续增加入口。

---

# 3. 固定 Route Map

```text
/quality/overview
/quality/results
/quality/results/:interactionId
/quality/agent-analysis

/config/tasks
/config/tasks/new
/config/tasks/:taskId
/config/tasks/:taskId/edit
/config/tasks/:taskId/runs/:runId

/config/agents
/config/agents/:agentId

/config/tools
/config/tools/new
/config/tools/:toolId

/config/data-assets
/config/data-assets/new
/config/data-assets/:assetId

/config/result-rules
/config/result-rules/:ruleSetId

/settings/connections
```

Version / Revision History 默认使用 Sheet，不创建独立 route。

---

# 4. 第一阶段原型范围

第一阶段目标：

> **先做完整可导航、可点击、可理解产品结构的高保真前端原型，不等待真实后端。**

使用 mock data，但 mock data 必须与真实对象模型一致。

必须完成：

```text
Application Shell
8 个核心业务页面
Settings / Connections
核心 Detail / Editor
Agent Designer
Quality Result Evidence Workspace
Run Detail
Result Rules Editor
```

不要求第一阶段完成：

```text
真实 LLM 调用
真实 Agent Runtime
真实 Tool API
真实 Data Asset Query
真实音频播放后端
真实 Trace 后端
真实权限服务
```

这些能力必须留出 adapter / service 边界，不要把 mock 数据写死进 UI 组件。

---

# 5. 推荐代码分层

不要把业务对象、mock 数据、UI 状态混在页面文件里。

至少保持：

```text
src/
├─ app / routes
├─ components
│  ├─ ui
│  ├─ quality
│  ├─ agents
│  ├─ tools
│  ├─ data-assets
│  ├─ tasks
│  ├─ runs
│  └─ result-rules
│
├─ features
├─ domain
│  ├─ quality
│  ├─ evaluation-agent
│  ├─ analysis-task
│  ├─ run
│  ├─ tool
│  ├─ data-asset
│  ├─ result-rules
│  └─ connections
│
├─ services
└─ mocks
```

实际目录应服从当前仓库结构；不要仅为了匹配此树而大规模重构。

---

# 6. Mock Data 原则

Mock 必须覆盖关键状态，而不是只做“全成功”的漂亮 Demo。

至少准备：

```text
Quality Result
→ normal / high-risk / pending-review / reviewed

Run
→ SUCCESS / PARTIAL_SUCCESS / FAILED / BLOCKED / RUNNING

Execution
→ SUCCESS / ERROR / SKIPPED

Agent
→ Draft / Testing / Published / Deprecated

Tool
→ Draft / Published
→ Enabled / Disabled / Deprecated

Data Asset
→ Draft / Ready / Deprecated
→ Healthy / Degraded / Error

Connection
→ Connected / Failed / Not Tested

Result Rules
→ Draft / Published
```

必须包含真实感强的中文客服质检样例，但不要虚构新的产品字段。

---

# 7. 页面实现顺序

严格按以下顺序，避免同时铺开全部页面导致风格漂移。

## Phase A — Shell + Design Tokens

```text
1. shadcn sidebar-03 Application Shell
2. Header / Breadcrumb / Page Container
3. Status Badge tokens
4. Table / Card / Sheet / Dialog 统一封装
5. Route skeleton
```

验收：

```text
所有 route 可进入
sidebar active state 正确
无页面级视觉风格漂移
```

## Phase B — 质量业务主链

```text
1. 质量总览
2. 质量结果
3. Quality Result Detail
4. 坐席分析
```

优先把业务主链跑通：

```text
Overview
→ Results
→ Result Detail
→ Evidence / Review
```

## Phase C — 执行主链

```text
1. 分析任务
2. Task Create Wizard
3. Task Detail
4. Run Detail
```

跑通：

```text
Task
→ Run History
→ Run Detail
→ Success Result / Error Execution
```

## Phase D — 配置资产

```text
1. Agents
2. Agent Designer
3. Tools
4. Data Definition
5. Result Rules
6. Connections
```

## Phase E — Polish

```text
Empty
Loading
Error
403 / 404
Responsive
Keyboard / Focus
URL query restore
Skeleton
Tooltip
Toast
```

---

# 8. 重点页面实现要求

## 8.1 质量总览

基线：

```text
shadcn dashboard-01
```

但只复用结构和组件骨架，不复制 demo 业务。

固定五层：

```text
Global Filters
KPI ×5
Quality Trend + 需要关注
主要质量问题
场景质量
```

不要加 AI Summary、排名榜、雷达图、第二套 Dashboard。

## 8.2 质量结果

高密度 Interaction workbench。

```text
一通 Interaction 一行
```

不是 Criterion failure 一行。

不做 V1 bulk checkbox。

详情点击进入：

```text
/quality/results/:interactionId
```

## 8.3 Quality Result Detail

Desktop 三栏：

```text
Conversation         42%
Quality Evaluation   33%
Business Facts       25%
```

使用 ResizablePanelGroup。

ASR 不使用聊天气泡。

必须实现证据联动：

```text
Conversation
↔ Evaluation
↔ Business Facts
```

Human Review 嵌入中栏，不新建 Review Center。

## 8.4 Agent Designer

基线：

```text
React Flow UI AI Workflow Editor
```

必须优先复用：

```text
Base Node
Base Handle
Labeled Handle
Button Handle
Edge with Button
Status Indicator
Labeled Group
Node Search
Controls
MiniMap
Runner / Monitoring / Node Status
```

Inspector 按 Node Schema 动态生成。

禁止用户手写：

```text
state.xxx
```

变量用 Variable Picker。

Test Run：

```text
Input Schema Form
Advanced JSON
Runner
Approval Gate
```

Sink / Effect Node Test Run 强制 Approval。

## 8.5 Analysis Task

Create：

```text
4-step Guided Wizard
```

固定：

```text
1 基本设置
2 分析数据
3 执行策略
4 确认并创建
```

Step 2：

```text
Data Asset
Input Mapping
Data Scope
```

Edit：

```text
Single-page Form
```

不要把 Edit 也改成 Wizard。

## 8.6 Tools

List：

```text
4-column compact cards + pagination
```

Create API Tool：

```text
single-page editor
```

不做 Wizard。

Tool 只引用 Connection，不编辑 Secret。

## 8.7 Data Definition

核心对象只有：

```text
Data Asset
```

不要实现：

```text
ETL
Data Source Center
Data Quality Center
Semantic Model
Metric Center
Data Explorer
```

## 8.8 Result Rules

独立配置资产：

```text
/config/result-rules
```

不属于 Agent。

Editor 固定：

```text
基本信息
Evaluation Selection
Score / Weight
Overall / Critical
Risk / Level / Derived Labels
Version / Publish
```

不做 Rule Workflow / DSL / Script。

## 8.9 Run Detail

不是 Dashboard。

主结构：

```text
Run Header
Execution Summary
Frozen Snapshot
Interaction Executions
```

Error Row：

```text
Execution Detail Sheet
```

Success Row：

```text
Quality Result Detail
```

---

# 9. 组件行为不可自行改变

统一：

```text
Version / Revision History
→ Sheet

Tool Test
→ Sheet

Data Asset Validate
→ Sheet

Backfill
→ Sheet

更多筛选
→ Sheet

Create Agent
→ Dialog

Publish
→ Dialog

Rerun
→ Dialog
```

禁止再出现：

```text
Sheet / Popover
Sheet / Dialog
Sheet / Side Panel
```

这类让开发自行判断的二选一。

---

# 10. 交互与状态规范

必须直接实现 Implementation Spec 中的：

```text
Status Visual Mapping
RBAC UI Behavior
URL Query State
Server-side Pagination mental model
Enterprise Timezone
Loading / Empty / Error
Destructive Confirmation
```

对于 mock prototype：

```text
server-side
```

可以由 mock service 模拟，但页面 API 设计必须保持 server-side 参数形态。

---

# 11. Prototype 数据服务边界

页面组件不得直接 import 大型 fixture 后自行 filter/sort。

推荐 mock service 形态：

```text
listQualityResults(params)
getQualityResult(id)

listTasks(params)
getTask(id)
listRuns(taskId, params)
getRun(runId)

listAgents(params)
getAgent(id)

listTools(params)
getTool(id)

listDataAssets(params)
getDataAsset(id)

listResultRules(params)
getResultRule(id)

listConnections(params)
```

这样后续换真实 API 时无需重写页面。

---

# 12. Codex 工作纪律

每完成一个 Phase：

```text
1. 跑 lint / typecheck / build
2. 修复错误
3. 截图或运行页面进行视觉检查
4. 对照 Design Spec 做自检
5. 输出本 Phase 改动文件清单
6. 输出尚未实现项
```

不要：

```text
为了让 build 通过删除功能
用 any 大面积绕过类型
忽略 console error
用 TODO 代替核心页面
同时重构无关业务代码
```

---

# 13. 必须主动报告而不是自行发明的情况

只在以下情况停下并报告：

```text
冻结文档之间存在真正矛盾
当前 repo 技术栈无法使用要求组件
已有业务代码与固定 route 严重冲突
必须新增核心产品对象才能继续
必须改变已冻结数据关系才能实现
```

普通 spacing、组件摆放、样式细节：

```text
不要反复问产品
→ 按 shadcn 成熟模式做最小决策
```

---

# 14. 第一轮验收标准

第一轮原型至少做到：

```text
[ ] 8 个核心业务导航全部可用
[ ] Settings / Connections 可用
[ ] 所有固定 route 可访问
[ ] Overview → Results → Detail 链路打通
[ ] Task → Run Detail 链路打通
[ ] Agent Designer 可展示 Graph / Inspector / Runner
[ ] Task Create 4-step Wizard 可完整走完
[ ] Tool Create 单页 Editor 可操作
[ ] Data Asset Validate Sheet 可操作
[ ] Result Rules List / Editor 可操作
[ ] Status / Empty / Loading / Error 有统一表现
[ ] URL 查询条件返回详情后可恢复
[ ] 没有引入任何废弃对象
[ ] 没有 Linear 风格
[ ] 没有未经批准的新页面
```

---

# 15. 第一条 Codex 指令

执行前：

```text
阅读三份 FINAL BASELINE
↓
扫描当前 repo
↓
输出“现有工程与冻结方案的差异”
↓
直接开始 Phase A
```

不要再做产品架构 brainstorm。

目标是：

> **把冻结方案忠实地变成一个干净、克制、可运行、可继续接真实 API 的企业级前端原型。**
