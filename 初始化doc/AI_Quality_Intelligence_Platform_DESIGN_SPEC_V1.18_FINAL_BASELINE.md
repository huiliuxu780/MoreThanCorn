# AI Quality Intelligence Platform
# DESIGN SPEC V1.18 — FINAL BASELINE

> 产品基线：`AI_Quality_Intelligence_Platform_产品架构冻结文档_V1.38_FINAL_BASELINE.md`
> 状态：Design Spec 当前有效基线
> 目标：统一当前 V1 全平台 UI / 交互与下钻页面规范，作为原型实现与后续 Implementation Spec 的当前设计基线。

---

# 1. Design System Boundary

唯一设计基线：

```text
AI Quality Intelligence Platform
│
├─ Application UI
│   └─ shadcn/ui
│
└─ Agent Workflow UI
    └─ React Flow UI
       + shadcn/ui
```

明确不采用其他产品作为视觉基线。

原则：

- shadcn/ui 负责普通产品 UI
- React Flow UI 负责 Workflow / Agent Designer
- React Flow UI 缺失的普通表单与浮层继续用 shadcn/ui
- 两者都不存在成熟组件时才自研
- 不建立第二套 Design System
- 不做彩色低代码风格
- 不使用大量渐变、装饰色块、厚重卡片制造视觉效果

---

# 2. Application UI Component Baseline

全局产品 UI 优先使用 shadcn/ui：

```text
Sidebar
Button
Input
Select
Tabs
Table
Card
Sheet
Dialog
Popover
Dropdown Menu
Badge
Tooltip
Command
Skeleton
Empty State
Form
```

## 2.1 使用原则

### Sidebar

用于一级 / 二级导航。

当前 V1 导航：

```text
智能质检
└─ 坐席质检
   ├─ 质量总览
   ├─ 质量结果
   └─ 坐席分析

配置管理
├─ 分析任务
├─ Agents
├─ Tools
└─ 数据定义
```

不额外设计第二套左侧局部导航。

### Page Header

统一结构：

```text
Page Title
Optional Description / Status
Primary Action
```

页面级搜索、筛选、排序、视图切换进入内容区 Toolbar，不把 Header 做成操作堆积区。

### Toolbar

用于：

- Search
- Filter
- Sort
- View Switch（确有需要时）
- Secondary Actions

不将所有页面强行统一成同样数量的控件。

### Table

适用于：

- 质量结果
- 坐席分析
- 分析任务
- Data Asset

Table 强调信息比较与快速扫描。

### Card

只用于真正适合资产卡片浏览的对象。

当前已冻结：

```text
Tools
→ 4 列紧凑卡片
```

不为了统一视觉把所有列表改成 Card。

### Sheet

优先承载轻量二级任务：

- Tool Test
- Data Asset Validate
- Version History
- Revision History
- 轻量 Preview / Inspect

### Dialog

只用于明确确认：

- Publish
- Disable
- Delete
- Destructive Action

复杂编辑不塞入 Dialog。

### Popover / Dropdown Menu

用于：

- 版本切换入口
- Row / Card Actions
- 小型筛选与上下文操作

### Badge

只表达明确状态：

- Draft
- Published
- Ready
- Deprecated
- Disabled
- Critical
- Review Status

Badge 不作为装饰元素。

### Empty State

说明：

1. 当前为什么没有内容
2. 用户下一步可以做什么

避免纯插画占位。

---

# 3. Visual Semantics

## 3.1 Color

默认界面保持 neutral。

颜色只用于：

```text
Critical / Error
Warning
Success
Running
Selected
Disabled / Deprecated
```

禁止：

- 用不同大色块区分模块
- 为每类 Node / Card 配随机背景色
- 大面积渐变背景
- 用装饰性色彩替代信息层级

## 3.2 Card Density

平台整体采用中高信息密度。

原则：

- 避免 Card inside Card
- Section 优先用 spacing / divider / heading 分区
- Card 只用于真正独立的资产 / 摘要对象

## 3.3 Status

统一使用：

```text
Badge
Status Indicator
Icon + Label
```

状态颜色必须有文字，不依赖颜色本身传递全部含义。

---

# 4. Agent Designer Baseline

Agent Designer 基础能力优先直接采用 React Flow UI：

```text
Workflow Editor
AI Workflow Editor
Base Node
Base Handle
Labeled Handle
Button Handle
Edge with Button
Node Search
Status Indicator
Controls
MiniMap
Runner / Monitoring
Inspector Skeleton
```

## 4.1 Node

基础视觉不得另起炉灶。

节点保持：

- 中性背景
- 轻边框
- 清晰标题
- 明确 Port
- 少量状态反馈
- 详细配置进入 Inspector

## 4.2 Inspector

Inspector 只提供容器与布局骨架。

真实配置由 Node Schema 决定，再由 shadcn/ui 渲染：

```text
Input
Select
Textarea
Switch
Tabs（只有节点确实需要时）
Command / Variable Picker
```

不人为规定所有节点都拥有相同 Tab。

## 4.3 Runner / Monitoring

优先使用 React Flow UI 现有 Runner / Monitoring / Node Status 交互。

不额外创建 Design / Test / Trace 三套独立模式。

---

# 5. Responsive Baseline

V1 首要目标是桌面企业应用。

建议基线：

```text
Desktop First
≥ 1440px：完整体验
1024–1439px：保持主要功能
< 1024px：可访问，但不以复杂 Designer 的完整移动体验为 V1 目标
```

Tools 已冻结：

```text
≥ 1440px      4 列
1024–1439px   3 列
更窄          2 / 1 列
```

复杂 Table 优先保持可读性，而不是强制压缩所有列。

---

# 6. Page-Type Mapping

当前 V1：

| 页面 | 主要展示模式 |
|---|---|
| 质量总览 | KPI + Section + Table/List |
| 质量结果 | Table |
| 坐席分析 | Table + Summary |
| 分析任务 | Table |
| Agents | 轻量资产列表 |
| Tools | 4 列紧凑 Card Grid |
| 数据定义 | Table |
| Agent Designer | React Flow UI Canvas |

下钻页：

| 页面 | 主要结构 |
|---|---|
| Quality Result Detail | 三栏业务证据工作区 |
| Task Detail | 单页详情 + Runs |
| Run Detail | Summary + Execution / Trace |
| Tool Detail | 单页配置 |
| Data Asset Detail | 单页 Editor |
| Version / Revision History | Sheet |

---

# 7. Design Spec 工作顺序

从现在开始按以下顺序推进：

```text
1. Foundation（本文件）
2. 质量总览
3. 质量结果
4. 坐席分析
5. 分析任务
6. Agents
7. Tools
8. 数据定义
9. Agent Designer
10. 下钻页面
```

每一项确认后：

```text
先写入 Design Spec
→ 再进入下一项
```

如果某一页面与 MASTER 冲突：

> 以 MASTER 的产品对象和业务规则为准，Design Spec 不得擅自改变产品架构。

---

# 8. Official Block Baseline

本平台普通应用 Shell 与质量总览不从空白搭建，直接以 shadcn 官方 Block 为代码与交互起点。

## 8.1 Application Shell

冻结：

```text
shadcn sidebar-03
```

用途：

- 一级 / 二级导航
- 支持当前“智能质检 → 坐席质检 → 页面”的层级
- 支持“配置管理 → 页面”的并列入口

不得为了视觉差异重新设计另一套 Sidebar。

## 8.2 Quality Overview

冻结：

```text
shadcn dashboard-01
```

保留：

```text
SectionCards
Chart Area / Interactive Chart 的布局骨架
DataTable
SiteHeader / Content Container
Spacing / Responsive 结构
```

不照搬：

```text
Revenue / Visitors 示例业务
Documents 示例
Reviewer 分配
Drag & Drop Table
Demo 内联编辑能力
```

质量总览只使用 dashboard-01 的成熟结构和组件组合，再替换为本平台已冻结的质量业务内容。

## 8.3 Agent Designer

继续冻结：

```text
React Flow UI AI Workflow Editor
```

因此三类核心 UI 基座明确为：

```text
Shell
→ shadcn sidebar-03

Quality Overview / Dashboard-like Pages
→ shadcn dashboard-01

Agent Designer
→ React Flow UI AI Workflow Editor
```

原则：

> **优先复用官方现成 Block / Template 的布局、组件和交互，不重新设计相同基础能力。**

---

# 9. 质量总览 / Quality Overview

状态：**已冻结**

基础实现：

```text
Application Shell
→ shadcn sidebar-03

质量总览页面骨架
→ shadcn dashboard-01
```

只复用其成熟结构与组件组合，不照搬 Demo 业务。

## 9.1 页面目标

质量总览是 **Quality Operations 首页**，不是 BI 驾驶舱。

页面回答四个问题：

```text
第一眼
→ 当前质量怎么样？

第二眼
→ 哪里正在变坏？

第三眼
→ 到底是什么质量问题？

第四眼
→ 问题集中在哪些业务场景？
```

所有问题项最终应可继续下钻：

```text
质量结果
→ Interaction
→ Evidence
```

## 9.2 最终信息结构

```text
质量总览
│
├─ ① Global Filters
├─ ② KPI × 5
├─ ③ Quality Trend + 需要关注
├─ ④ 主要质量问题
└─ ⑤ 场景质量
```

不新增其他首页模块。

---

## 9.3 Page Header

```text
质量总览
查看坐席服务质量、主要问题与异常变化
```

Header 保持普通 shadcn Page Header，不做大屏式 Dashboard 标题。

---

## 9.4 Global Filters

位于 Page Header 下方，并作用于整页。

默认直接显示：

```text
时间范围
Department
Team
Service Type
```

其余条件进入：

```text
[更多筛选]
```

更多筛选包括：

```text
Agent
Brand
Product Category
Issue / Topic
Request Type
```

组件：

```text
Select
Sheet
Button
```

原则：

> **整页共用一套筛选，不让每个图表重复生长独立 Filter。**

---

## 9.5 KPI

使用 shadcn `dashboard-01` 的 `SectionCards` 结构。

冻结 5 个指标：

```text
有效质检覆盖率
平均质量得分
问题交互率
Critical
待复核
```

单卡结构：

```text
Label
Current Value
Compared Period
```

示例：

```text
问题交互率
8.4%
↓ 1.4% 较上周期
```

不增加：

```text
Mini Chart
目标完成率
Progress Bar
AI Summary
装饰性大图标 / 大色块
```

Critical / Review 等仅通过状态语义强调，Card 本身仍保持 neutral。

---

## 9.6 Quality Trend + 需要关注

布局：

```text
┌────────────────────────────────────┬──────────────────┐
│ Quality Trend                      │ 需要关注          │
│                                    │                  │
│                                    │                  │
└────────────────────────────────────┴──────────────────┘
            约 2/3                           约 1/3
```

### Quality Trend

使用 shadcn Chart / Recharts。

单图单指标，通过顶部切换：

```text
[平均质量得分] [问题交互率] [Critical]
```

不同时绘制 3～5 条指标曲线。

时间范围继承 Global Filters，不增加重复的局部 7 日 / 30 日筛选。

### 需要关注

这是确定性异常 / 运营关注列表，不是 AI Chat 或 AI Summary。

来源：

```text
Critical 增长
Criterion 失败率明显上升
Team 明显偏离
待复核积压
同类问题持续出现
```

展示示例：

```text
● 违规承诺问题明显上升
  影响率较上周期 +1.8 pct
  影响 73 条 Interaction

● 某班组问题交互率明显偏高
  高于整体 4.1 pct

● Critical 待复核积压
  当前 7 条
```

点击后：

```text
质量结果
→ 自动携带对应 Filter
```

---

## 9.7 主要质量问题

这是质量总览最重要的数据区。

标题：

```text
主要质量问题
按受影响 Interaction 统计
```

使用 shadcn Table / Data Table。

冻结列：

```text
质量问题
影响 Interaction
影响率
较上周期
风险
主要场景
```

示例：

```text
未确认消费者真实诉求 | 182 | 6.2% | +1.3 pct | High     | 维修服务
服务请求创建错误       | 96  | 3.3% | -0.4 pct | Medium   | 安装服务
违规承诺               | 73  | 2.5% | +1.1 pct | Critical | 技术咨询
未执行必要催促         | 51  | 1.7% | —        | Medium   | 维修服务
```

### 问题来源

第一列必须来自当前正式：

```text
Section / Criterion
```

禁止 AI 自由生成新的生产问题分类。

### 趋势表达

不用含糊的：

```text
↑1.3%
```

统一使用：

```text
+1.3 pct
-0.4 pct
```

数量类指标使用：

```text
+12
-8
```

### Drill-down

点击整行：

```text
质量结果
→ criterion filter
```

点击主要场景：

```text
质量结果
→ criterion + business context filter
```

---

## 9.8 场景质量

位于页面底部。

目标：

> **快速判断哪些业务场景的整体质量更差。**

使用 Horizontal Bar Chart。

默认维度：

```text
Service Type
```

允许切换：

```text
Service Type
Product Category
Issue / Topic
Brand
```

默认指标：

```text
平均质量得分
```

V1 不再增加指标切换，不把该模块扩成小型 BI。

点击条目：

```text
质量结果
→ 携带当前 Business Context Filter
```

---

## 9.9 最终页面骨架

```text
┌───────────────────────────────────────────────────────────────┐
│ 质量总览                                                       │
│ 查看坐席服务质量、主要问题与异常变化                            │
│                                                               │
│ [时间] [部门] [班组] [服务类型] [更多筛选]                     │
│                                                               │
│ [覆盖率] [平均分] [问题交互率] [Critical] [待复核]             │
│                                                               │
│ ┌────────────────────────────────┬──────────────────────┐      │
│ │ 质量趋势                        │ 需要关注             │      │
│ │ [平均分][问题率][Critical]      │ ● ...               │      │
│ │                                │ ● ...               │      │
│ │             Chart              │ ● ...               │      │
│ └────────────────────────────────┴──────────────────────┘      │
│                                                               │
│ 主要质量问题                                                   │
│ ┌─────────────────────────────────────────────────────────┐   │
│ │ Criterion | 影响交互 | 影响率 | 较上周期 | 风险 | 场景 │   │
│ └─────────────────────────────────────────────────────────┘   │
│                                                               │
│ 场景质量                                      [Service Type]  │
│ ┌─────────────────────────────────────────────────────────┐   │
│ │ Horizontal Bar Chart                                    │   │
│ └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

---

## 9.10 明确不做

质量总览 V1 不增加：

```text
AI Chat Card
AI 自由大段总结
Top / Bottom 坐席榜
能力雷达图
第二套 Dashboard
万能 BI
多图联动分析工作台
每个图单独一套筛选器
彩色业务模块卡片
```

最终原则：

> **质量总览以 shadcn dashboard-01 为实现基座，但产品目标是 Quality Operations：少量关键指标、明确异常、正式质量问题和业务场景下钻。**

---

# 10. 质量结果 / Quality Results

状态：**已冻结**

基础实现：

```text
shadcn Tabs
+ Data Table
+ Select / Popover / Sheet
+ Badge
+ Pagination
```

本页定位：

> **带业务语境的全量 Interaction 质量工作台。**

页面不重复承担 Dashboard 职责，不增加 KPI / Chart。

## 10.1 页面目标

```text
找出有问题的 Interaction
→ 快速理解问题发生在什么业务语境
→ 进入 Quality Result Detail
→ 查看 Evidence / Human Review
```

质量结果同时承担整个平台统一的业务 Drill-down Hub：

```text
质量总览
坐席分析
需要关注
场景质量
→ 统一下钻到质量结果
```

## 10.2 Page Header

```text
质量结果
查看每次服务交互的质检结果、问题与复核状态
```

不增加 KPI Cards 或图表。

## 10.3 Tabs

只保留：

```text
全部结果
待复核
已复核
```

使用 shadcn `Tabs`，可显示数量。

以下内容不作为 Tab：

```text
Critical
有问题
低分
AI / Human 不一致
```

这些统一由 Filter 承载。

## 10.4 Toolbar

默认直接显示：

```text
Search
时间
质量问题
风险
Team
Service Type
更多筛选
```

Search 支持：

```text
Interaction ID
Agent
Consumer Request Summary
```

Placeholder：

```text
搜索 Interaction、坐席或消费者诉求
```

更多筛选使用 `Sheet`，包含：

```text
Department
Agent
Brand
Product Category
Issue / Topic
Request Type
Section
Criterion
Score Range
Review Status
AI / Human 不一致
已触发处理
```

不将全部筛选字段铺在 Toolbar。

## 10.5 Visible Filter Chips

当前生效条件必须显式可见，例如：

```text
[维修服务 ×]
[High Risk ×]
[违规承诺 ×]
[上海热线组 ×]
```

从其他页面 Drill-down 进入时，自动转换为可见 Filter Chips。

## 10.6 Data Table

默认：

> **一通 Interaction 一行。**

禁止按 Criterion Failure 拆为多行。

主表只保留 7 个视觉列：

```text
时间
坐席
业务场景
消费者诉求
质量结果
风险
复核
```

底层字段仍保持独立，不因 UI 合并展示改变数据模型。

### 时间

建议：

```text
08-18 10:32
12m 48s
```

第二行时长仅在有稳定字段时展示。

### 坐席

两行：

```text
张三
上海热线一组
```

不额外拆 Agent / Team / Department 三列。

### 业务场景

合并 Business Context：

```text
维修服务
洗碗机 · 排水异常
```

底层仍来自：

```text
Service Type
Product Category
Issue / Topic
```

Brand 默认不单独占主列。

### 消费者诉求

必须直接展示并使用较宽列，最多两行：

```text
line-clamp-2
```

不得隐藏到 Detail 才可见。

### 质量结果

推荐：

```text
78 分
3 个问题
```

如果该评价没有 Score：

```text
—
3 个问题
```

不强制所有 Agent 输出 Score。

### 风险

使用 shadcn `Badge`：

```text
Critical
High
Medium
—
```

不再增加重复 PASS / FAIL Badge。

### 复核

显示：

```text
待复核
已复核
—
```

Reviewer 等辅助信息进入 Detail / Hover。

## 10.7 Row Interaction

整行点击进入：

```text
Quality Result Detail
```

Hover：

```text
background-muted
cursor-pointer
```

最右侧可保留 `···` Dropdown：

```text
查看详情
进入复核
复制 Interaction ID
```

不增加大型“查看详情”按钮。

## 10.8 Bulk Action

V1 不显示 Checkbox。

当前没有冻结有效的批量通过、批量复核、批量处罚、批量修改操作，避免产生错误预期。

## 10.9 Sorting

默认：

```text
Interaction Time
Newest First
```

只开放：

```text
时间
Quality Score
Risk
```

等有业务价值的排序。

## 10.10 Pagination

采用 Server-side Pagination。

默认：

```text
50 / page
```

可选：

```text
20
50
100
```

以下状态写入 URL Query：

```text
page
pageSize
sort
filters
tab
search
```

保证进入 Detail 后返回不丢失当前页、筛选、排序和 Tab。

## 10.11 Cross-page Drill-down

从质量总览主要质量问题进入：

```text
Criterion = 对应质量问题
```

从“需要关注”进入：

```text
Criterion / Team / Review Status / 时间范围
```

从场景质量进入：

```text
Service Type / Product Category / Issue / Brand
```

从坐席分析进入：

```text
Agent
+ 可选 Criterion
```

进入质量结果后统一呈现为 Filter Chips。

## 10.12 Saved View

可轻量支持：

```text
[视图 ▾]

全部结果
我的待复核
Critical
────────
已保存
  低技能坐席专项
  维修问题
```

使用 `Dropdown / Command`，不新增 View Management 页面。

Saved View 保留为 V1 轻量能力，不新增 View Management 页面。

## 10.13 Loading / Empty / Error

Loading：

```text
Data Table Skeleton
```

Empty：

```text
没有找到符合条件的质量结果

尝试调整筛选条件
[清除筛选]
```

Error：

```text
质量结果加载失败
[重新加载]
```

## 10.14 Final Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 质量结果                                                                     │
│ 查看每次服务交互的质检结果、问题与复核状态                                  │
│                                                                              │
│ [全部结果 12,482] [待复核 37] [已复核 826]                                  │
│                                                                              │
│ [搜索................] [时间] [质量问题] [风险] [班组] [服务类型] [更多]    │
│                                                                              │
│ [维修服务 ×] [High Risk ×] [违规承诺 ×]                                     │
│                                                                              │
│ 时间       坐席             业务场景          消费者诉求       质量结果 风险 复核 │
│ ─────────────────────────────────────────────────────────────────────────── │
│ 10:32      张三             维修服务          希望尽快安排...    78     High 待复核│
│ 08-18      上海热线一组     洗碗机·排水异常   工程师上门...      3问题          │
│                                                                              │
│ 1–50 / 12,482                                      20 / 50 / 100   ‹ 1 2 3 › │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 10.15 明确不做

```text
KPI Cards
Charts
复杂 Summary
AI 大段分析
Criterion 一条失败一行
Checkbox / Bulk Actions
20+ 数据库字段直接铺平
所有列可排序
独立 Review 页面
```

最终原则：

> **质量结果是统一 Interaction 质量工作台：主列表保持高密度、业务可扫描，并承接全平台质量问题、业务场景和坐席分析的下钻。**

---

# 11. Quality Result Detail / 质量结果详情

状态：**已冻结**

本页定位：

> **整个平台最核心的证据工作区。**

核心结构：

```text
Conversation
+
Quality Evaluation
+
Business Facts
```

本页不是普通详情页，而是围绕 Evidence、Criterion、业务事实和 Human Review 的专业质检工作台。

## 11.1 基础组件

优先使用 shadcn：

```text
ResizablePanelGroup
ScrollArea
Sheet
Badge
Button
Slider
Dialog
Dropdown Menu
```

Tabs 只在局部确有需要时使用。

## 11.2 Desktop Layout

≥ 1440px 默认：

```text
Conversation        42%
Quality Evaluation  33%
Business Facts      25%
```

采用三栏可拖拽 Resizable Workspace：

```text
┌──────────────────────────────┬──────────────────────┬───────────────────────┐
│ Conversation                 │ Quality Evaluation   │ Business Facts        │
│                              │                      │                       │
└──────────────────────────────┴──────────────────────┴───────────────────────┘
```

允许用户拖动三栏宽度。

V1 不增加复杂 Layout Preset。

## 11.3 Header / Context

第一行：

```text
← 质量结果

Interaction #...
                                  [待复核] [进入复核] [···]
```

第二行：

```text
Agent · Team
Service Type · Product Category · Issue / Topic
Interaction Time · Duration
```

随后直接展示 Consumer Request Summary：

```text
消费者诉求
...
```

顶部不增加 KPI Cards。

## 11.4 Conversation Panel

Conversation 是页面证据主轴。

### Audio

有录音时：

```text
[▶] 03:24 / 12:48
──────────────●────────
[1x] [↺10] [10↻]
```

使用普通 shadcn Button / Slider 组合。

无录音时从 ASR 开始。

### ASR

采用：

```text
Speaker Label
Timestamp
Text
```

不使用聊天气泡式布局。

### Evidence Highlight

Criterion 引用的 Conversation 片段使用轻量背景和 Evidence 标记。

点击后：

```text
→ Quality Evaluation 定位对应 Criterion
```

## 11.5 Quality Evaluation Panel

顶部 Summary：

```text
78 分
High Risk

3 个问题 · 1 个 Critical
```

若无 Score：

```text
3 个问题
High Risk
```

不强迫所有结果显示分数。

按照：

```text
Section
└─ Criterion
```

折叠组织。

默认展开：

```text
FAIL
Critical
```

默认折叠：

```text
PASS
```

Criterion 展开内容：

```text
Result
Reason
Evidence
Business Evidence（如有）
Confidence（如有）
```

Criterion Detail 不再开新页面。

## 11.6 Panel Linking

三栏必须双向联动。

Evaluation → Conversation：

```text
点击 Evidence
→ 左栏自动滚动
→ 高亮对应 ASR
→ 有录音时同步定位时间点
```

Conversation → Evaluation：

```text
Conversation 片段旁显示关联 Criterion
→ 点击定位中栏 Criterion
```

Evaluation → Business Facts：

```text
点击 Business Evidence
→ 右栏定位对应业务对象 / 时间线事件
```

Business Facts → Evaluation：

```text
业务事实可显示 Used by N evaluations
→ 点击回到对应 Criterion
```

最终关系：

```text
Conversation
      ↕
Evaluation
      ↕
Business Facts
```

## 11.7 Business Facts Panel

Business Facts 不展示为原始 JSON。

按业务对象组织，例如：

```text
服务请求
#SR...
类型
状态
创建时间
当前节点
```

再展示：

```text
催促记录
业务动作
业务时间线
```

无业务事实时：

```text
暂无关联业务记录
```

不为填满页面展示大量空字段。

## 11.8 Human Review Mode

Human Review 直接在当前 Result Detail 内完成，不建立独立 Review 页面。

点击：

```text
[进入复核]
```

后进入 Review Mode。

顶部：

```text
复核中
                         [取消] [完成复核]
```

中栏 Criterion 进入可编辑状态。

单项：

```text
AI Result
FAIL

人工结果
[PASS ▼]

人工说明
[...]

人工 Evidence
[+ 添加当前对话片段]
[+ 添加业务事实]
```

未修改 Criterion：

```text
继续沿用 AI Result
```

完成复核时使用 Dialog：

```text
确认完成复核？

已修改 N 个评价项
未修改项继续沿用 AI 结果

[取消] [完成复核]
```

完成后：

```text
Effective Result
→ Result Rules
→ Derived Result
```

人工不得直接修改 Derived Score / Risk / Overall。

## 11.9 AI / Human Difference

已修改 Criterion：

```text
AI        FAIL
Human     PASS
Effective PASS

已复核
Reviewer · Time
```

未修改：

```text
AI        PASS
Effective PASS
```

## 11.10 Technical Trace

默认业务工作区不展示 Prompt / Model / Token / Trace。

通过：

```text
···
→ 查看运行详情
```

或 Criterion 高级入口打开 shadcn Sheet。

内容：

```text
Execution
Agent Version
Tool Calls
Tool Versions
Structured Output
Node / Trace
Prompt / Model（高级）
Error（如有）
```

Technical Trace 是高级排查入口，不占主界面。

## 11.11 Previous / Next

Header 支持：

```text
‹ 上一条
下一条 ›
```

必须遵循进入 Detail 前质量结果列表的：

```text
Filter
Sort
Tab
```

不得跳出当前结果集。

## 11.12 URL / Return State

详情路由：

```text
/results/{result_id}
```

返回质量结果时恢复：

```text
Filter
Tab
Search
Page
Sort
```

## 11.13 Responsive

≥ 1440px：

```text
三栏 42 / 33 / 25
```

1024–1439px：

```text
仍保持三栏
允许拖动比例
```

更窄：

```text
Conversation | Evaluation
Business Facts → Sheet
```

V1 不为手机端重做完整质检工作台。

## 11.14 Final Structure

```text
Quality Result Detail
│
├─ Header / Context
│
├─ Conversation
│   ├─ Audio
│   ├─ ASR
│   └─ Evidence Highlight
│
├─ Quality Evaluation
│   ├─ Summary
│   ├─ Section
│   ├─ Criterion
│   ├─ Result
│   ├─ Reason
│   └─ Evidence
│
├─ Business Facts
│   ├─ Service Request
│   ├─ Business Actions
│   └─ Timeline
│
├─ Human Review Mode
│
└─ Technical Trace Sheet
```

## 11.15 明确不做

```text
Conversation / Evaluation / Business Facts 三个互斥 Tab
聊天气泡式 ASR
独立 Review Center
独立 Review Page
主界面展示 Prompt / Token / Model
直接修改总分
原始 JSON 占据 Business Facts
Criterion 独立详情页
复杂 Layout Preset
```

最终原则：

> **Quality Result Detail 是 Evidence Workspace：让 Conversation、Evaluation 和 Business Facts 双向定位，并在同一工作区完成 Human Review；技术 Trace 作为高级 Sheet 保持隔离。**

---

# 12. 坐席分析 / Agent Analysis

状态：**已冻结**

本页定位：

> **组织维度的质量问题定位页，而不是绩效排行榜。**

核心分析链路：

```text
整体
→ 班组
→ 坐席
→ Section / Criterion
→ Interaction
→ Evidence
```

页面目标：

```text
哪个组织异常
→ 异常在哪里
→ 集中在什么问题 / 场景
→ 哪些坐席需要关注
→ 对应哪些 Interaction
```

## 12.1 基础组件

优先使用 shadcn：

```text
Tabs
Section Cards
Chart
Data Table
Badge
Select / Popover
```

## 12.2 页面结构

```text
坐席分析
│
├─ View：班组 / 坐席
├─ Global Filters
├─ Scope Summary
├─ Quality Trend + 需要关注
├─ 班组 / 坐席 Data Table
└─ 主要质量问题 + 问题集中场景
```

## 12.3 Page Header

```text
坐席分析
从组织和坐席维度定位服务质量问题
```

不增加未冻结的创建、导出等操作。

## 12.4 View Tabs

一级只保留：

```text
班组
坐席
```

默认：

```text
班组
```

不新增：

```text
排行榜
绩效
能力分析
质量画像
```

## 12.5 Global Filters

保持全平台统一 Filter 心智：

```text
时间
Department
Team
Service Type
更多筛选
```

更多筛选：

```text
Agent
Brand
Product Category
Issue / Topic
Request Type
```

从 Team / Agent 下钻进入时必须显式显示当前 Filter Chip。

## 12.6 Scope Summary

只保留 4 个核心指标：

```text
有效质检
平均质量得分
问题交互率
Critical
```

不增加：

```text
名次
超过多少坐席
Top %
Bottom %
```

避免页面演化为绩效排行榜。

## 12.7 Quality Trend

沿用质量总览相同组件心智：

```text
[平均质量得分]
[问题交互率]
[Critical]

Line Chart
```

单图单指标。

Chart 只展示当前 Scope，不同时绘制大量 Team / Agent 曲线。

## 12.8 班组视图 Data Table

冻结列：

```text
班组
有效质检
平均分
问题交互率
Critical
主要质量问题
问题集中场景
趋势
```

其中：

```text
主要质量问题
→ 正式 Section / Criterion

问题集中场景
→ Business Context

趋势
→ 当前质量变化，不表达排名
```

点击班组：

```text
坐席分析 / Team
→ 自动切换坐席视图
→ Team 作为可见 Filter Chip
```

不新建班组详情页。

## 12.9 坐席视图 Data Table

冻结列：

```text
坐席
班组
有效质检
平均分
问题交互率
Critical
主要质量问题
问题集中场景
```

明确不显示：

```text
Rank
Top
Bottom
倒数名次
```

## 12.10 需要关注

“需要关注坐席”采用异常原因列表，不做排行榜。

示例语义：

```text
某坐席问题交互率明显高于班组
某坐席连续出现 Critical
某坐席同类 Criterion 问题持续出现
```

每条必须展示：

```text
谁需要关注
为什么需要关注
对应什么正式 Criterion / 指标异常
```

来源：

```text
确定性指标
统计异常
正式 Criterion
```

不允许 AI 自由主观判断“坐席优秀 / 较差”。

## 12.11 主要质量问题

选择 Team / Agent Scope 后，展示：

```text
Section / Criterion
影响率 / 问题率
```

可使用：

```text
Horizontal Bar
或轻量 List + Progress
```

点击：

```text
质量结果
→ Team / Agent
→ Criterion
```

## 12.12 问题集中场景

支持 Business Context 维度：

```text
Service Type
Product Category
Issue / Topic
Brand
```

点击：

```text
质量结果
→ Team / Agent
→ Business Context
```

不做复杂多维 BI。

## 12.13 坐席 Scope

点击坐席后，仍在当前页面进入：

```text
坐席分析 / Agent
```

顶部 Scope 显示：

```text
Agent
Team
```

展示：

```text
有效质检
平均质量得分
问题交互率
Critical

质量趋势
主要质量问题
问题集中场景
相关 Interaction
```

不新建“坐席画像”独立页面。

## 12.14 相关 Interaction

仅展示轻量最近问题列表：

```text
时间
业务场景
消费者诉求
质量结果
风险
```

底部：

```text
[查看全部质量结果]
```

点击进入统一的质量结果页：

```text
质量结果
→ Agent Filter
```

不复制第二套完整质量结果 Data Table。

## 12.15 Drill-down

最终心智：

```text
坐席分析
→ Team
→ Agent
→ Criterion / Business Context
→ 质量结果
→ Interaction
→ Quality Result Detail
→ Evidence
```

## 12.16 Final Layout

```text
┌────────────────────────────────────────────────────────────────────┐
│ 坐席分析                                                           │
│ 从组织和坐席维度定位服务质量问题                                  │
│                                                                    │
│ [班组] [坐席]                                                      │
│                                                                    │
│ [时间] [部门] [班组] [服务类型] [更多筛选]                        │
│                                                                    │
│ [有效质检] [平均分] [问题交互率] [Critical]                       │
│                                                                    │
│ ┌────────────────────────────────────┬───────────────────────┐     │
│ │ 质量趋势                            │ 需要关注              │     │
│ │                                    │ ...                   │     │
│ │             Chart                  │ ...                   │     │
│ └────────────────────────────────────┴───────────────────────┘     │
│                                                                    │
│ 班组 / 坐席                                                        │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ Scope │ 有效质检 │ 平均分 │ 问题率 │ Critical │ 问题 │ 场景 │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                                                    │
│ ┌───────────────────────────────┬──────────────────────────────┐   │
│ │ 主要质量问题                  │ 问题集中场景                 │   │
│ │ ...                           │ ...                          │   │
│ └───────────────────────────────┴──────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

## 12.17 明确不做

```text
Top 坐席
Bottom 坐席
名次
排行榜
绩效榜
能力雷达
AI 能力画像
AI 主观评价“优秀 / 较差”
班组独立详情页
坐席独立详情页
复制一套质量结果列表
```

最终原则：

> **坐席分析用于定位组织和人员维度的问题集中在哪里，再下钻到统一质量结果和 Evidence；不承担绩效排名和 AI 人才画像。**

---

# 13. 分析任务 / Analysis Task

状态：**已冻结**

说明：

> 本节只定义 Analysis Task 的页面与交互，不重新讨论 Analysis Task 的产品模型。

核心对象继续沿用 Master 已冻结关系：

```text
Analysis Task
├─ Agent
├─ Agent Version Policy
├─ Data Asset
├─ Data Scope
├─ Sampling
└─ Schedule / Data Window
```

## 13.1 页面范围

```text
分析任务
│
├─ Task List
├─ Create Task
│   └─ Guided Wizard
├─ Edit Task
│   └─ Single-page Form
└─ Task Detail
    ├─ Task Configuration
    ├─ Next Run
    ├─ Run History
    ├─ Backfill
    └─ Enable / Disable
```

`Run Detail` 为进一步下钻页面，不计入分析任务主页面范围。

---

## 13.2 Task List

使用 shadcn Data Table，不使用卡片。

Page Header：

```text
分析任务
管理质检任务的数据范围、执行周期和评价 Agent
```

Toolbar：

```text
[搜索任务...]
[状态]
[Agent]
[Data Asset]
                              [+ 新建任务]
```

主列：

```text
任务名称
Agent
Data Asset
调度
状态
最近运行
```

示例：

```text
每日热线全量质检
服务质量评价 V7
热线通话
每日 02:00
启用
成功 · 08-18
```

默认排序：

```text
最近更新 · 最新优先
```

最近运行可显示：

```text
成功
运行中
部分成功
失败
阻塞
—
```

整行点击进入 Task Detail。

列表不展示：

```text
Prompt
Tool
Data Asset Revision
详细 Sampling 参数
Run 趋势
Token
耗时图
```

---

## 13.3 Create Task：Guided Wizard

创建任务采用 **4 步向导**。

原因：

```text
Agent
        ↓
Version Policy
        ↓
Data Asset
        ↓
Data Asset 决定可用 Scope 字段
        ↓
Scope / Sampling
        ↓
Schedule + Data Window
        ↓
最终任务执行语义
```

创建阶段需要帮助用户按依赖顺序完成配置，并明确区分：

```text
Eligibility
≠ Task Scope

Schedule
≠ Data Window
```

因此冻结为：

```text
Create = Guided Wizard
Edit   = Single-page Form
```

### Step 1 — 基本设置

```text
任务名称
描述

Agent
Agent Version Policy
```

Version Policy：

```text
Latest Published
Fixed Published Version
```

选择 `Latest Published` 时显示解释：

> 每次创建新 Run 时使用当时最新的 Published Version；已经创建或运行中的 Run 不受后续 Agent 发布影响。

选择 `Fixed Published Version` 时才显示：

```text
固定版本
[V7 ▼]
```

### Step 2 — 分析数据

```text
Data Asset
Data Scope
```

Data Asset 只允许选择：

```text
Ready
```

选中后显示轻量说明：

```text
一条数据代表什么
Time Field
当前 Ready Revision
```

用户不手工选择 Data Asset Revision。

Data Scope 使用结构化条件构建器：

```text
[字段 ▼] [操作符 ▼] [值 ........] [×]
```

字段来源：

```text
Data Asset Schema
+
允许作为 Scope 的确定性业务字段
```

不支持 SQL。

页面明确提示：

> 数据资产自身的 Eligibility 已自动生效，此处仅限定本任务的执行范围。

### Step 3 — 执行策略

包含：

```text
Sampling
Schedule
Data Window
```

Sampling 只支持：

```text
全量

随机抽样
[20] %

固定数量
[1000] 条
```

V1 不增加：

```text
分层采样
Weighted Sampling
Random Seed
复杂 Sampling Strategy
```

Schedule 支持：

```text
一次性
每日
每周
每月
```

Data Window 与 Schedule 分开配置。

示例：

```text
Schedule
每天 02:00 执行

Data Window
分析上一自然日数据
```

周期任务可提供业务语言模板：

```text
每日
→ 上一自然日

每周
→ 上一自然周

每月
→ 上一自然月
```

一次性任务直接选择绝对时间范围。

### Step 4 — 确认并创建

保留独立 Review Step。

展示最终自然语言摘要：

```text
该任务将：

使用
服务质量评价 · Latest Published

分析
热线通话中符合 Eligibility 的数据

范围
维修服务 · 上海热线一组/二组

采样
全量

执行
每天 02:00

数据窗口
上一自然日
```

底部：

```text
[返回修改]                  [创建并启用]
```

此步骤用于让用户确认长期任务真正会“用什么、分析什么、什么时候跑、分析哪段数据”。

不再额外增加第五步或重型确认流程。

---

## 13.4 Wizard Layout

桌面端推荐结构：

```text
┌────────────────────────────────────────────────────────────┐
│ ← 分析任务                                                 │
│                                                            │
│ 新建分析任务                                               │
│                                                            │
│ ① 基本设置  ─  ② 分析数据  ─  ③ 执行策略  ─  ④ 确认      │
│                                                            │
│                 Current Step Content                       │
│                                                            │
│ [上一步]                                      [下一步]     │
└────────────────────────────────────────────────────────────┘
```

使用 shadcn：

```text
Form
Select
Radio Group
Popover
Command
Separator
Button
```

Step Indicator 保持简单，不设计复杂流程图。

---

## 13.5 Edit Task：Single-page Form

已有 Task 编辑不再走 Wizard。

入口：

```text
Task Detail
→ 编辑
```

单页结构：

```text
基本信息
Agent / Version Policy
Data Asset / Data Scope
Sampling
Schedule / Data Window
```

原因：

> 对已理解任务结构的用户，修改某一项配置时单页效率更高，不强迫重复走 4 步流程。

编辑页面继续遵守：

```text
Data Asset Revision 不手选
Eligibility 不重复配置
Schedule 与 Data Window 分开
```

---

## 13.6 Task Detail

Header：

```text
← 分析任务

每日热线全量质检
[启用] [编辑] [回填数据] [···]
```

摘要：

```text
Agent
版本策略
Data Asset
Schedule
```

正文使用 Definition List / Section，不用 KPI Cards。

任务配置：

```text
Agent
服务质量评价

版本策略
Latest Published

当前 Published
V7

Data Asset
热线通话

Data Scope
...

Sampling
全量

Schedule
每日 02:00

Data Window
上一自然日
```

如果 Disabled：

```text
已停用
下次运行：—
```

---

## 13.7 Run History

Task Detail 的核心区域之一。

使用 shadcn Data Table：

```text
运行时间
数据窗口
Agent Version
Asset Revision
输入数量
状态
耗时
```

示例：

```text
08-18 02:00
08-17
V7
R13
12,482
成功
42m
```

Run History 必须直观体现：

```text
同一个 Task
→ 不同 Run
→ 可能冻结不同 Agent Version
→ 可能冻结不同 Data Asset Revision
```

点击：

```text
Run Row
→ Run Detail
```

---

## 13.8 Backfill

`回填数据` 使用 shadcn Sheet。

```text
回填历史数据

时间范围
[08-01] → [08-07]

当前 Task 配置
Agent
Data Asset
Sampling

说明
回填将创建新的 Run，不覆盖历史 Run。

[取消] [开始回填]
```

真正执行前可使用轻量 Confirm Dialog。

---

## 13.9 Rerun

Run Row 的 `···`：

```text
查看详情
重新运行
```

Rerun 使用 Dialog：

```text
确认重新运行？

将基于该 Run 的数据窗口重新创建一个新的 Run。
历史 Run 和结果不会被覆盖。

[取消] [重新运行]
```

---

## 13.10 Enable / Disable

Task 只使用：

```text
Enabled
Disabled
```

周期任务 Disable：

```text
不再创建新的 Scheduled Run
已创建 / 已运行 Run 不受影响
```

启停入口放在 Task Detail Header。

不新增独立 Status 页面。

---

## 13.11 URL / Return State

Task List 保留：

```text
page
pageSize
sort
filters
search
```

进入 Task Detail / Create / Edit 后返回列表时恢复当前状态。

---

## 13.12 Loading / Empty / Error

Task List：

```text
Loading
→ Table Skeleton

Empty
→ 暂无分析任务
  [新建任务]

Filtered Empty
→ 没有符合当前条件的分析任务
  [清除筛选]

Error
→ 分析任务加载失败
  [重新加载]
```

---

## 13.13 Final Structure

```text
分析任务
│
├─ Task List
│   └─ Data Table
│
├─ Create Task
│   └─ 4-step Guided Wizard
│       ├─ ① 基本设置
│       ├─ ② 分析数据
│       ├─ ③ 执行策略
│       └─ ④ 确认并创建
│
├─ Edit Task
│   └─ Single-page Form
│
└─ Task Detail
    ├─ Task Configuration
    ├─ Run History
    ├─ Backfill Sheet
    ├─ Rerun Dialog
    └─ Enable / Disable
```

## 13.14 明确不做

```text
Task Card Marketplace
Create 单页大表单
Edit Wizard
SQL Scope
复杂 Sampling Strategy
独立 Schedule Center
独立 Run Center
Task Dashboard
Task Token / Cost Dashboard
在 Task 中配置 Prompt
在 Task 中配置 Tool
手工选择 Data Asset Revision
Schedule 与 Data Window 混为一个字段
Eligibility 与 Task Scope 混为一个字段
```

最终原则：

> **Create Task 用 Guided Wizard 帮助用户按依赖顺序完成配置；Edit Task 用 Single-page Form 提高已有任务的修改效率。Task Detail 负责配置说明与 Run History，不重新制造任务 Dashboard。**

---

# 14. Agents

状态：**已冻结；本节仅将既有产品结论落成页面 Design Spec，不重新讨论 Agent 产品模型。**

## 14.1 页面范围

```text
Agents
│
├─ Agent List
├─ Create Agent
└─ Agent Designer
    ├─ React Flow UI Canvas
    ├─ Node Search
    ├─ Inspector
    ├─ Variable Picker
    ├─ Run / Inspect
    ├─ Publish Check
    ├─ Publish Confirm
    └─ Version History
```

不新增：

```text
Agent Overview
Agent Settings 独立页面
Agent Statistics
Structured Output 管理页
Prompt Center
Run 独立页面
Designer 多 Tab 导航
```

## 14.2 Agent List

使用 shadcn Data Table / 轻量资产列表，不使用 Tools 的 4 列卡片。

Page Header：

```text
Agents
管理用于质量评价的 Agent
```

Toolbar：

```text
[搜索 Agent...]
[状态]
                         [+ 新建 Agent]
```

核心列：

```text
名称 + 描述
当前版本
状态
最近更新
```

默认：

```text
最近更新 · 最新优先
```

支持：

```text
Search
Status Filter
Sort
Pagination
```

不展示：

```text
调用量
成功率
Token
耗时
质检数量
Tool 数
节点数
平均得分
```

整行点击：

```text
→ Agent Designer
```

## 14.3 Create Agent

创建仅填写：

```text
名称
描述
```

使用轻量 shadcn Dialog Form。

创建成功：

```text
Draft V1
→ 直接进入 Agent Designer
```

创建阶段不询问：

```text
Model
Prompt
Data Asset
Tool
Structured Output
```

这些进入 Designer 后配置。

## 14.4 Agent Designer 基座

严格使用：

```text
React Flow UI AI Workflow Editor
+
shadcn/ui
```

不另起炉灶重新设计 Workflow Editor。

页面顶栏只保留：

```text
返回
Agent 名称
版本 + 状态
保存状态
Run
Publish
```

示意：

```text
← Agents

服务质量评价     V8 · Draft        已保存           [Run] [Publish]
```

不新增：

```text
Overview
Settings
Statistics
Output
Monitoring
Logs
```

等页面级 Tabs。

## 14.5 Node Search

优先继承 React Flow UI 官方 Workflow / AI Workflow Editor 的 Node Search / Drag Sidebar 交互。

是否常驻由官方基础模式决定，不强行固定为永久左栏。

Node Type 继续使用 Master 已冻结的通用节点模型。

## 14.6 Inspector

选中 Node 后打开右侧 Inspector。

字段由 Node Schema 决定。

示例：

```text
LLM
- Model
- Prompt
- Variables
- Structured Output

Tool
- Tool Reference
- Tool Version
- Input Mapping
- Output Mapping
- Error Handling

Condition
- Expression
- Branches

Create Quality Record
- Input Mapping
- Idempotency
- Execution Configuration
```

不强迫所有 Node 使用统一的：

```text
General
Input
Output
Execution
Test
```

Tabs。

## 14.7 Variable Picker

Node Input 选择变量时使用结构化 Variable Picker：

```text
INPUT
UPSTREAM
STATE
SYSTEM
```

普通用户不手写：

```text
state.xxx
```

选择后显示明确绑定关系。

## 14.8 Run / Inspect

点击顶部：

```text
Run
```

直接使用 React Flow UI Runner / Monitoring / Node Status 心智。

Canvas 运行状态：

```text
Pending
Running
Success
Error
```

执行后可 Inspect：

```text
Input
Output
Duration
Error
Structured Output
```

不创建独立“测试页面”。

## 14.9 Version History

点击：

```text
V8 · Draft
```

使用 shadcn Sheet 展示历史版本。

例如：

```text
V8    Draft        当前
V7    Published
V6    Deprecated
```

点击 Published 历史版本：

```text
Designer
→ Read-only Mode
```

顶部可提供：

```text
[基于此版本创建草稿]
```

如果当前已有活动 Draft，必须提示，不静默创建第二个 Draft。

## 14.10 Publish

两阶段：

### Dependency Check

检查：

```text
Graph 合法
必填 Node 配置完整
Tool Version 可用
Input Schema 有效
Structured Output Schema 有效
最近 Run 成功
其他阻断依赖
```

并展示受影响的 `Latest Published` 周期 Task。

### Publish Confirm

说明：

```text
新 Published Version 不可原地修改
Latest Published Task 从下一次新 Run 使用新版本
已创建 / 运行中的 Run 不受影响
```

必须填写：

```text
Version Note
```

不采用输入 Agent 名称等重型确认。

## 14.11 Draft / Published UX

Draft：

```text
可编辑
可 Run
可 Publish
```

Published：

```text
只读
可 Run / Inspect
可基于此版本创建 Draft
```

UI 直接进入只读状态，不允许“看似可编辑，保存时报错”。

---

# 15. Tools

状态：**已冻结；本节只做 UI 落盘，不重新讨论 Tool Registry。**

## 15.1 页面范围

```text
Tools
│
├─ Tool List
├─ Create API Tool
└─ Tool Detail
    ├─ Identity
    ├─ Source / Connection
    ├─ Contract
    ├─ Governance
    ├─ Test
    └─ Version History
```

V1 不新增：

```text
MCP Tool Import
OpenAPI 批量 Import
Custom Code Tool
Tool Monitoring Center
独立 Tool Permission Center
复杂 Retry Policy
```

## 15.2 Tool List

采用已冻结的：

> **4 列紧凑卡片 + 分页**

响应式：

```text
≥ 1440px      4 列
1024–1439px   3 列
更窄          2 / 1 列
```

卡片高度尽量统一，描述最多两行，不做瀑布流。

单卡片只展示：

```text
名称
描述
来源
Capability：READ / WRITE / ACTION
状态
版本
最近更新时间
```

不展示：

```text
调用次数
成功率
平均耗时
Token
Agent 引用数
运行监控指标
```

Toolbar：

```text
Search
Filter
Sort
                         [+ 创建 Tool]
```

排序支持：

```text
创建时间 / 更新时间
×
最新优先 / 最早优先
```

默认：

```text
更新时间 · 最新优先
```

列表状态：

```text
page
pageSize
sort
filters
search
```

进入 Tool Detail 返回时恢复。

## 15.3 Create API Tool

当前 `+ 创建 Tool` 的 V1 语义：

```text
创建 API Tool
```

采用单页编辑器，不使用 Wizard。

页面结构：

```text
基本信息
请求
Contract
治理
Test
```

### 基本信息

```text
名称
描述
Capability
```

### 请求

```text
Connection
HTTP Method
Path
Headers
Query Parameters
Body
```

Connection 只引用已有 Connection，不在 Tool 页面重复维护 Credential / Secret。

### Input Contract / Request Mapping

统一模型：

```text
Agent-facing Input Contract
        ↓
Request Mapping
```

单字段至少支持：

```text
Name
Type
Required
Location：Path / Query / Header / Body
Request Key / Mapping
```

### Output Contract

Tool Test 得到真实 Response 后支持：

```text
[从测试响应生成 Output Schema]
```

用户可确认 / 调整。

## 15.4 Tool Test

Test 不新增独立页面。

使用 shadcn Sheet：

```text
测试 Tool

Input
→ Run
→ Status
→ Duration
→ Response / Error
```

规则：

```text
Draft 可保存
Successful Test 之前不能 Publish
```

## 15.5 Tool Detail

使用单页配置，不拆复杂 Tabs。

结构：

```text
Identity
Source / Connection
Input / Output Contract
Governance
Test
Version History
```

不新增：

```text
Overview
Usage
Monitoring
Statistics
```

## 15.6 Tool Version

展示：

```text
Tool
├─ V1 Published
├─ V2 Published
└─ V3 Draft
```

Published Version 只读。

编辑 Published：

```text
→ 创建下一 Draft Version
```

Version History 使用 Sheet，不做独立页面。

Publish 采用轻量 Dialog，检查：

```text
配置完整
Connection 可用
Test 成功
Input Schema 有效
Output Schema 有效
Version Note
```

## 15.7 Tool Status / Governance

Version Status：

```text
Draft
Published
```

Tool Status：

```text
Enabled
Disabled
Deprecated
```

治理字段：

```text
Capability
Permission
Requires Approval
```

`Requires Approval` 作为 Tool 最低治理要求；Agent 不能放松。

Permission 复用平台 RBAC，不建设独立权限中心。

## 15.8 Built-in Tool

复用 Tool Detail，但平台定义部分只读：

```text
Definition        只读
Contract          只读
Version           平台管理

Enabled           可配置
Permission        可配置
Requires Approval 可配置
```

## 15.9 Tool Call Trace

Tool List / Detail 不建设 Monitoring 页面。

运行排查统一：

```text
Quality Result
→ Run
→ Trace
→ Tool Call
```

---

# 16. 数据定义 / Data Definition

状态：**已冻结；本节只将 Data Asset 已冻结模型落成页面。**

## 16.1 页面范围

```text
数据定义
│
├─ Data Asset List
└─ Data Asset Detail / Editor
    ├─ Identity
    ├─ Source Binding
    ├─ Record Definition
    ├─ Schema
    ├─ Eligibility
    ├─ Health
    ├─ Preview / Validate
    └─ Revision History
```

不新增：

```text
Data Source 页面
Data Quality 页面
Data Contract 页面
Semantic Model 页面
Metric 页面
Mapping Center
Data Lineage 页面
Data Explorer
ETL Designer
```

## 16.2 Data Asset List

使用 shadcn Data Table，不使用卡片。

核心列：

```text
名称
来源
一条数据代表什么
时间字段
Lifecycle
Health
最近更新
```

Toolbar：

```text
Search
Lifecycle Filter
Health Filter
Sort
                      [+ 创建数据资产]
```

支持：

```text
Pagination
```

默认：

```text
最近更新 · 最新优先
```

不展示：

```text
每日记录量
分析调用次数
Agent 引用次数
运行成功率
运营分析指标
```

整行点击进入 Data Asset Detail / Editor。

## 16.3 Create / Edit Data Asset

采用单页编辑器，不使用 Wizard。

结构：

```text
基本信息
Source Binding
Record Definition
Schema
Eligibility
Health
Preview / Validate
```

### 基本信息

```text
名称
描述
```

### Source Binding

只选择 / 引用已有企业数据资源，例如：

```text
Table
View
Resource
```

Data Definition 不负责 ETL / Join / 数据开发。

### Record Definition

必须明确：

```text
一条数据代表什么？
Record ID
Time Field
```

UI 使用业务语言“一条数据代表什么”，不要求普通用户理解 `Grain`。

### Schema

字段只定义：

```text
Source Field
Business / Display Name
Data Type
Description
Required
```

不扩展成完整 Semantic Layer。

## 16.4 Eligibility

使用结构化条件构建方式表达资产长期分析资格。

例如：

```text
connected = true
transcript IS NOT NULL
duration > 0
```

UI 必须明确：

> Eligibility 是资产级长期业务口径，不等同于 Task Scope。

不支持 SQL IDE。

## 16.5 Health

Lifecycle：

```text
Draft
Ready
Deprecated
```

Health：

```text
Healthy
Degraded
Error
```

两者独立展示。

V1 Health 只覆盖：

```text
Connectivity
Schema
Freshness
```

不建设完整 Data Quality 产品。

## 16.6 Preview / Validate

Preview：

```text
显示少量真实样本
用于确认资产定义是否正确
```

不扩展为：

```text
Data Explorer
Pivot
Chart
SQL IDE
```

进入 Ready 前必须 Validate。

Validate 检查：

```text
Source 可访问
Record ID 有效
Time Field 有效
Required Field 存在
Schema 有效
Eligibility 可执行
Preview 成功
```

Validate 使用 shadcn Sheet。

成功后提供：

```text
[设为 Ready]
```

## 16.7 Revision

Ready Asset 修改关键定义时：

```text
Ready Revision 12
→ Draft Revision 13
→ Validate
→ Ready Revision 13
```

历史 Ready Revision 只读。

Revision History 使用 Sheet。

Task 不手工选择 Revision；Run 创建时 resolve 当前 Ready Revision 并冻结。

## 16.8 Data Asset Detail

Detail 与 Editor 使用同一页面骨架。

Draft：

```text
可编辑
可 Validate
```

Ready Current Revision：

```text
默认只读查看
编辑时创建下一 Draft Revision
```

Deprecated：

```text
只读为主
保留历史引用
```

页面不增加独立 Overview / Monitoring / Quality Tabs。

---

# 17. 当前页面设计完成度审计

截至 V1.16，原 7 个核心业务导航页面均已具备页面级 Design Spec；新增的 `结果规则` 已冻结 UI Home，但页面级 Design Spec 尚待补齐：

```text
01 质量总览           ✅
02 质量结果           ✅
03 坐席分析           ✅
04 分析任务           ✅
05 Agents ✅
06 Tools              ✅
07 数据定义           ✅
08 结果规则           ✅
```

系统级基础配置：

```text
Settings / Connections ✅
```

核心下钻页面 / 工作区：

```text
Quality Result Detail ✅
Task Detail           ✅
Run Detail            ✅
Tool Detail           ✅
Data Asset Detail     ✅
Agent Designer        ✅
Human Review          ✅（嵌入 Quality Result Detail）
Technical Trace       ✅（高级 Sheet / Run Trace 下钻）
```

已冻结轻量二级交互：

```text
Version / Revision History → Sheet
Tool Test                  → Sheet
Data Asset Validate        → Sheet
Backfill                   → Sheet
Rerun                      → Dialog
Create Agent               → Dialog
更多筛选                   → Sheet
```

Run Detail 与结果规则页面级 Design Spec 均已完成；当前核心业务页面已全部具备页面级 Design Spec。

后续工作不再新增页面，而进入：

```text
P2 Implementation Spec
→ Route Map
→ Status Visual Mapping
→ RBAC UI Behavior
→ Query-state / Pagination
→ Date / Time / Timezone
→ List pageSize
```

原则：

> **除非后续实现发现真实产品矛盾，不重新拆分或重复讨论已冻结页面。**

---

# 18. Run Detail

状态：**已冻结**

本页定位：

> **解释这一次任务实际跑了什么、冻结了什么版本、执行成什么样、哪里失败。**

Run Detail 是运行排查页，不重复承担 Quality Result / Evidence / Human Review 的业务职责。

## 18.1 页面结构

```text
Run Detail
├─ Run Header
├─ Execution Summary
├─ Frozen Snapshot
└─ Interaction Executions
```

基础组件优先使用 shadcn：

```text
Page Header
Badge
Definition List
Card / Statistic Block
Data Table
Sheet
Dialog
Dropdown Menu
Pagination
```

不建设 Run Dashboard。

## 18.2 Run Header

示意：

```text
← 每日热线全量质检

Run #20260818-020001

SUCCESS
2026-08-18 02:00 → 02:42
```

右侧动作：

```text
[重新运行] [···]
```

`···` 可包含：

```text
复制 Run ID
查看 Task
查看运行 Trace
```

状态相关动作：

```text
RUNNING
→ [取消运行]

FAILED / PARTIAL_SUCCESS
→ [重新运行]
```

Run 为不可变执行事实，不提供：

```text
编辑 Run
修改 Snapshot
```

## 18.3 Execution Summary

只表达本次运行结果：

```text
输入
成功
跳过
错误
耗时
```

例如：

```text
输入     12,482
成功     12,410
跳过     32
错误     40
耗时     42m 18s
```

必须保持：

```text
Execution Status
≠
Business Quality Result
```

业务存在 FAIL / High Risk 不代表 Run 失败。

## 18.4 Run Error Summary

仅在异常时显示。

例如：

```text
运行异常

40 个 Interaction 执行失败

主要错误
Tool timeout                 23
Structured output invalid    12
Missing required input        5

[查看失败 Interaction]
```

BLOCKED 时优先显示阻塞原因：

```text
运行被阻塞

原因
Data Asset 当前不可用

热线通话 · Revision 13
Health: Error

Schema missing: transcript
```

原则：

> **先告诉运营用户发生了什么，再允许进入技术 Trace。**

## 18.5 Frozen Snapshot

使用 Definition List，不做卡片墙。

展示：

```text
Analysis Task
Agent + Version
Data Asset + Revision
Data Window
Data Scope
Sampling
Result Rules Version（如适用）
Runtime Environment
```

Tool Versions 不在主页面铺开：

```text
Tools
3 个固定版本                         [查看]
```

点击后使用 Sheet：

```text
Tool Versions

查询服务请求       V2
搜索知识           V4
查询产品信息       V1
```

## 18.6 Interaction Executions

这是 Run Detail 的核心 Data Table。

Toolbar：

```text
[搜索 Interaction...]
[执行状态]
[错误类型]
```

主列：

```text
Interaction
坐席
业务场景
执行状态
质量结果
耗时
```

示例：

```text
I-001   张三   维修服务   SUCCESS   High   2.1s
I-002   李四   技术咨询   SUCCESS   —      1.7s
I-003   王五   维修服务   ERROR     —      5.0s
I-004   张三   安装服务   SKIPPED   —      —
```

必须同时保留：

```text
执行状态
质量结果
```

`SUCCESS + High Risk` 合法；`ERROR` 表示没有成功产生有效业务结果。

## 18.7 Row Drill-down

SUCCESS Row：

```text
→ Quality Result Detail
```

不复制 Conversation / Criterion / Business Facts / Human Review。

ERROR Row：

```text
→ Execution Detail Sheet
```

Sheet 展示：

```text
Interaction
Status
Attempt
Error Type
Failed Node
Duration
Input
Node Output
Error Detail
Tool Calls
[查看完整 Trace]
```

## 18.8 Attempt / Retry

保留历史 Attempt。

例如：

```text
Attempts
1  Error · Tool timeout
2  Success
```

最终 Execution Status 为 SUCCESS。

如果所有 Attempt 失败：

```text
ERROR
Attempts: 2
```

主表不展开所有 Attempt。

## 18.9 Run-level Trace

高级入口：

```text
[查看运行 Trace]
```

用于查看：

```text
Run Timeline
Agent Runtime
Node Execution
Tool Calls
Structured Outputs
Errors
```

V1 默认页面不直接展示完整 LangGraph Trace 树。

## 18.10 Rerun

Run Detail 只提供重新运行，不提供 Backfill。

Rerun：

```text
基于当前 Run 的 Data Window
创建新的 Run
```

使用 Dialog：

```text
重新运行此 Run？

数据窗口
2026-08-17

将创建新的 Run。
当前 Run 和历史结果不会被覆盖。

[取消] [重新运行]
```

Backfill 继续保留在 Task Detail。

## 18.11 Pagination / Filter

Interaction Executions 使用 Server-side Pagination。

默认：

```text
50 / page
```

基础过滤：

```text
Execution Status
Error Type
Agent
Service Type
```

URL 保留：

```text
executionStatus
errorType
page
pageSize
search
```

## 18.12 页面边界

```text
Task Detail
→ 为什么 / 什么时候要跑

Run Detail
→ 这一次实际上跑成什么样

Quality Result
→ 业务评价结果是什么

Quality Result Detail
→ 为什么得到这个业务结果

Trace
→ 技术上到底怎么执行
```

## 18.13 明确不做

```text
Run Dashboard
质量趋势 Chart
业务 Criterion 分析
Conversation / Evidence 副本
Human Review
编辑 Run
编辑 Snapshot
Run 内 Backfill
默认展示完整 LangGraph Trace
每个 Execution 独立详情页
Token / Cost 大盘
```

最终原则：

> **Run Detail 只解释一次不可变执行事实：输入、状态、冻结依赖、Interaction Execution 与异常；业务结果继续下钻 Quality Result，技术细节继续下钻 Trace。**

---

# 19. Result Rules 解耦约束

状态：**已冻结**

Result Rules 不嵌入 Agent Designer，也不嵌入 Create Quality Record Node。

Designer 中：

```text
Agent
→ Structured Outputs
→ Create Quality Record
```

到持久化业务结果为止。

Result Rules 独立处理：

```text
Effective Result
→ Result Rules
→ Derived Result
```

因此 UI 禁止出现：

```text
Agent Designer
→ Create Quality Record
→ [配置结果规则]
```

Result Rules 需要独立的业务配置入口 / Editor，但其具体 UI Home 当前仍为待决项。

实现约束：

- Agent Version 不包含 Result Rules 定义
- Result Rules 独立版本化
- Run 冻结 Result Rules Version
- Human Review 后默认使用该结果冻结的 Rules Version 重新计算 Derived Result
- 历史结果使用新 Rules 回算时生成新的 Derived Result Revision
- 不直接覆盖历史 Derived Result

---

# 20. Settings / Connections

状态：**已冻结**

定位：

> **管理 API Tool 所依赖的外部系统连接与凭证。**

Connections 属于系统级基础配置，不计入 7 个核心业务导航页面。

## 20.1 页面关系

```text
Settings
└─ Connections
     ↓
API Tool
     ↓
Agent
```

## 20.2 Connection List

使用 shadcn Data Table。

建议核心列：

```text
名称
Endpoint / Host
Authentication
状态
最近更新
```

Toolbar：

```text
Search
Status Filter
                         [+ 新建 Connection]
```

不展示：

```text
调用量
API Operation 数
流量统计
Token / Cost
Agent 引用统计
```

## 20.3 Create / Edit Connection

使用单页或 Sheet 级轻量配置，不建立复杂 Wizard。

字段：

```text
名称
Base URL / Endpoint
Authentication Type
Credential / Secret
Required Headers
```

常见认证方式可先覆盖：

```text
None
API Key
Bearer Token
Basic Auth
```

具体枚举以后端实际支持为准。

## 20.4 Secret UX

保存后：

```text
Secret
••••••••••
已配置
```

不回显真实 Secret。

更新 Secret 时用户重新输入新值。

普通 Viewer / Agent Editor / Reviewer 不显示 Secret 明文。

## 20.5 Test Connection

提供：

```text
[Test Connection]
```

反馈：

```text
Connected
Failed
```

失败时展示可操作错误摘要：

```text
Authentication failed
Timeout
DNS / Endpoint unreachable
TLS error
```

不直接暴露不必要的底层 Secret。

## 20.6 Tool 中的 Connection

Create / Edit API Tool：

```text
Connection
[选择已有 Connection]
```

Tool 页面不重复编辑：

```text
Endpoint
Credential
Secret
```

如果当前用户没有 Connection 管理权限，只能选择自己被授权使用的 Connection。

## 20.7 页面边界

V1 Connections 不扩展为：

```text
API Gateway
OpenAPI Browser
API Operation 管理
API Lifecycle
Traffic Monitoring
Rate Limit Center
复杂 Secret Center
调用统计
```

最终原则：

> **Connections 负责 endpoint + auth；API Tool 负责 method + path + contract + governance。**

---

# 21. Analysis Task Input Mapping

状态：**已冻结**

Analysis Task Wizard Step 2 调整为：

```text
② 分析数据
├─ Data Asset
├─ Input Mapping
└─ Data Scope
```

## 21.1 Input Mapping UI

选中 Data Asset 后显示：

```text
输入映射
────────────────────────────────────────
Agent Input       Data Asset Field

interaction_id    [call_id ▼]             ✓
transcript        [asr_text ▼]            ✓
agent_id          [servicer_id ▼]         ✓
start_time        [call_start_time ▼]      ✓
phone_number      [consumer_phone ▼]       ✓
```

字段选择器复用 Variable Picker / Command 的交互心智。

## 21.2 Auto Mapping

系统先尝试：

```text
Exact Field Key Match
+
Compatible Type
```

成功则自动填充。

未匹配 Required Input：

```text
→ 用户手工选择
```

禁止使用 AI 模糊猜测字段映射。

## 21.3 Validation

Required Input：

```text
必须有 Mapping
类型必须兼容
```

Optional Input：

```text
允许未 Mapping
```

错误示例：

```text
start_time: DateTime
← call_start_time: String

类型不兼容
```

存在未解决 Required Mapping 时：

```text
[下一步]
→ Disabled
```

或显示阻断性 Validation Error。

## 21.4 Data Scope Relation

Input Mapping 与 Data Scope 分开。

```text
Input Mapping
= Data Asset Record 如何进入 Agent Input

Data Scope
= 这次执行从 Eligible Data 中选择哪些记录
```

两者不得混在一个条件构建器里。

## 21.5 Run Compatibility

Run 创建前进行 Compatibility Check：

```text
Agent Required Inputs
vs
Task Input Mapping
vs
当前 Data Asset Ready Revision
```

若映射字段不存在或类型不兼容：

```text
Run
→ BLOCKED
```

错误信息必须明确指出：

```text
Required input unavailable
Agent Input: transcript
Mapped Field: asr_text
Data Asset Revision: R14
Reason: field no longer exists
```

## 21.6 Run Snapshot

Run Detail / Snapshot 增加：

```text
Input Mapping Snapshot
```

默认主页面可显示：

```text
Input Mapping
5 个字段                         [查看]
```

点击后使用 Sheet 查看完整 Mapping。

最终原则：

> **Input Mapping 是 Task 的绑定契约，不是 Agent 或 Data Asset 的属性。**

---

# 22. Interaction 多 Evaluation / Re-evaluation

状态：**已冻结**

质量结果页面继续保持：

```text
一通 Interaction 一行
```

但该页面是业务聚合视图。

底层允许：

```text
Interaction
├─ Evaluation 1
├─ Evaluation 2
└─ Re-evaluation
```

## 22.1 历史保留

Rerun / Re-evaluation：

```text
→ 新增 Evaluation
→ 原 Evaluation 保留
→ 不覆盖历史
```

Quality Result Detail / Run Detail 的高级信息必须能够追溯具体 Evaluation / Run / Agent Version。

## 22.2 UI 不引入 Evaluation Slot

当前不新增：

```text
Evaluation Slot 页面
Evaluation Slot 配置
Evaluation Slot Tab
```

也不在业务页面暴露该术语。

## 22.3 聚合视图待补规则

一通 Interaction 有多条 Evaluation 时，质量结果列表必须基于确定性的：

```text
Evaluation Selection / Priority Rule
```

决定默认消费结果。

该规则尚未冻结，下一步单独确定。

在 Selection Rule 未确认前，Codex 不得自行实现：

```text
永远取最新 Evaluation
永远取首次 Evaluation
人工结果永远优先
最新 AI 自动覆盖人工结果
```

最终原则：

> **一通一行属于业务聚合视图；多次 Evaluation 属于底层历史事实。历史必须保留，默认选择规则必须显式定义。**

---

# 23. Evaluation Selection / Priority Rule

状态：**已冻结**

质量结果业务聚合采用：

```text
Evaluation Filter
→ Evaluation Priority
→ Selected Evaluation
```

## 23.1 Filter

V1 候选 Evaluation 至少基于：

```text
Agent
Evaluation Status
```

默认只让完成态 Evaluation 参与选择。

不同 Agent 的 Evaluation 不直接互相按时间竞争。

## 23.2 Priority

V1 仅支持：

```text
Most Recent Completed
最新完成的评价
```

以及：

```text
Initial Completed
首次完成的评价
```

默认：

```text
Most Recent Completed
```

不提供：

```text
最高分优先
最低风险优先
人工优先
AI 优先
复杂权重
自定义表达式
```

## 23.3 Human Review Relation

Human Review 属于具体 Evaluation：

```text
Evaluation
→ AI Result
→ Human Review
→ Effective Result
```

Review 不参加 Evaluation Priority。

新 Completed Evaluation 可以按 Selection Rule 成为新的 Selected Evaluation；历史 Review 仍保留在原 Evaluation 下。

## 23.4 Quality Result Aggregation

质量结果列表的一通一行默认消费：

```text
Selected Evaluation
→ Effective Result
→ Result Rules
→ Derived Result
```

失败 / 未完成 Evaluation 不进入 Completed 候选集合。

## 23.5 UI Boundary

Selection / Priority Rule：

- 不新增独立页面
- 不新增独立导航
- 不使用 Evaluation Slot 概念
- 具体配置入口待与 Result Rules UI Home 一并冻结

Codex 不得自行增加额外优先级类型。

最终原则：

> **先 Filter，再 Priority；V1 默认 Most Recent Completed。**

---

# 24. Agent Test Run

状态：**已冻结**

## 24.1 Entry

Agent Designer 顶部：

```text
[Run]
```

点击后在 Designer 内打开 Test Run Panel / Runner，不跳转到独立测试页面。

## 24.2 Test Input

根据当前 Agent Input Schema 自动生成表单。

例如：

```text
Test Input
────────────────────────

interaction_id
[ I-TEST-001 ]

transcript
[ 消费者反馈洗碗机无法启动... ]

agent_id
[ A001 ]

start_time
[ 2026-08-18 15:30 ]

[JSON]                         [Start Run]
```

默认使用 Schema Form。

`JSON` 仅作为 Advanced Input。

Test Run 不要求用户选择：

```text
Data Asset
Analysis Task
Data Window
```

## 24.3 Side-effect Gate

Test Runner 执行规则：

```text
Pure Node
→ Direct Run

READ Tool
→ Direct Run

WRITE / ACTION Tool
→ Follow Tool Requires Approval

Sink / Effect Node
→ Force Approval in Test Run
```

Approval UI：

```text
Action requires approval

Node / Tool
更新服务请求

Capability
WRITE

Input / Payload
...

此操作可能修改外部系统或创建业务记录。

[Reject] [Approve & Continue]
```

## 24.4 Effect Nodes

至少包括：

```text
Create Quality Record
Update Record
Emit Event
Notification
Trigger
```

这些节点不转换为 Tool，只共享 Test Run 的 Approval Gate 规则。

## 24.5 Runner Status

节点状态：

```text
Idle
Running
Success
Error
Waiting Approval
```

点击节点 Inspect：

```text
Input
Output
Duration
Error
Tool Calls
```

不新增 Test Center / Sandbox Center。

## 24.6 Publish Check

Publish Check 改为：

```text
当前 Draft 存在成功 Test Run
```

如果成功测试后发生以下执行语义变更：

```text
Graph
Prompt
Tool Reference / Tool Version
Input Schema
Structured Output Schema
Node Execution Configuration
```

则 Test 状态失效。

UI 应明确提示：

```text
Agent changed since last successful test.
Run a new test before publishing.
```

Publish 按钮继续走既有：

```text
Dependency Check
→ Secondary Confirmation
→ Required Version Note
→ Publish
```

最终原则：

> **Test Run 属于 Agent Designer；输入来自 Agent Input Schema；副作用必须经过 Approval Gate；发布只能基于当前 Draft 的有效成功测试。**

---

# 25. P1 文档一致性清理

状态：**已完成**

本轮仅清理确定性冲突，不修改已冻结产品模型。

已完成：

```text
Run Detail Tool Versions
→ 删除 Create Quality Record
→ Create Quality Record 继续保持 Sink / Effect Node

Design Spec Header
→ V1.15
→ Master 基线更新为 V1.35

§17 页面完成度
→ Run Detail 改为已完成

Saved View
→ 按 Master 保留为 V1 轻量能力

Version / Revision History
→ Sheet

Tool Test
→ Sheet

Data Asset Validate
→ Sheet

Create Agent
→ Dialog

更多筛选
→ Sheet
```

下一阶段：

```text
P2 Implementation Spec
```

---

# 26. Result Rules UI Home

状态：**入口与路由已冻结；页面细节见 §27**

导航：

```text
配置管理
└─ 结果规则
```

路由：

```text
Result Rules List
/config/result-rules

Result Rules Detail / Editor
/config/result-rules/:ruleSetId
```

明确禁止：

```text
Agent Designer
→ Create Quality Record
→ 配置 Result Rules
```

也不放入：

```text
Settings
```

因为：

```text
Result Rules
= 质量业务配置资产

Connections
= 系统基础设施配置
```

当前业务导航由原 7 个更新为 8 个。

本节仅冻结 Result Rules 的 UI Home 和 Route。

以下仍需单独形成页面级 Design Spec：

```text
Result Rules List
Result Rules Detail / Editor
Version History
Validate / Publish
```

在页面级 Design Spec 补齐前，Codex 不得自行设计 Result Rules 页面结构。

---

# 27. Result Rules — List + Detail / Editor

状态：**页面级 Design Spec 已补齐**

说明：

> 本节不重新定义 Result Rules 产品模型，只把已经冻结的 Result Rules、Evaluation Selection、版本与 Derived Result 关系翻译成可实现页面。

## 27.1 页面职责

```text
结果规则
= 管理 Effective Result 如何被解释与计算为 Derived Result
```

负责：

```text
Evaluation Selection / Priority
Score / Weight
Overall Pass / Fail
Critical
Risk Mapping
Level
Derived Labels
Rules Version
```

不负责：

```text
Agent Prompt
Agent Workflow
Structured Output 定义
Tool
Data Asset
Human Review 内容
```

最终边界：

```text
Agent
→ 产生结构化业务事实

Human Review
→ 修正业务事实

Result Rules
→ 计算派生业务结果
```

## 27.2 Result Rules List

路由：

```text
/config/result-rules
```

基础组件：

```text
Page Header
Input
Data Table
Badge
Button
Dropdown Menu
Pagination
```

页面结构：

```text
结果规则
定义质量结果的评分、风险和业务解释规则

[搜索结果规则...]                               [+ 新建结果规则]

名称
Agent
当前版本
Evaluation Priority
最近更新
```

列表只解决：

```text
找到 Rule Set
确认它服务于哪个 Agent
查看当前 Rules Version
查看 Selection Priority
进入 Editor
```

不展示：

```text
运行次数
命中次数
平均分
风险趋势
Agent 调用量
Derived Result 统计
```

这些属于质量分析 / 结果消费，不属于配置资产列表。

分页遵循 Implementation Spec 的标准资产表：

```text
default 20
options 20 / 50 / 100
```

排序默认：

```text
最近更新 desc
```

URL Query：

```text
search
page
pageSize
sort
```

## 27.3 Create Result Rules

使用 shadcn Dialog。

只创建最小身份信息：

```text
名称
描述
Agent
```

操作：

```text
[取消]
[创建并编辑]
```

创建后进入：

```text
/config/result-rules/:ruleSetId
```

不做 Wizard。

## 27.4 Detail / Editor Shell

路由：

```text
/config/result-rules/:ruleSetId
```

Header：

```text
← 结果规则

服务质量结果规则
Rules Version / 状态
保存状态

[版本历史] [验证] [发布]
```

Published 历史 Rules Version：

```text
只读
```

需要修改：

```text
基于当前版本创建 Draft
```

不允许原地覆盖已发布历史版本。

## 27.5 Editor 页面结构

单页编辑，不做拖拽 Workflow，也不做多层 Wizard。

```text
Result Rules Editor
│
├─ 基本信息
├─ Evaluation Selection
├─ Score / Weight
├─ Overall / Critical
├─ Risk / Level / Derived Labels
└─ Version / Publish
```

各区块使用：

```text
Section Heading
Form
Data Table
Select
Input
Switch / Checkbox（仅在确实为布尔开关时）
```

避免 Card 套 Card。

## 27.6 基本信息

```text
名称
描述
Agent
```

Agent 是 Selection Filter 的评价来源，不表示 Result Rules 属于 Agent。

关系仍然是：

```text
Result Rules
≠
Agent
```

改变 Agent 不在当前 Published Version 原地修改，而进入新的 Rules Draft。

## 27.7 Evaluation Selection

直接落实已冻结的两阶段规则：

```text
Evaluation Filter
→ Evaluation Priority
→ Selected Evaluation
```

V1 UI：

```text
Agent
服务质量评价 Agent

候选状态
Completed
```

候选状态在 V1 按冻结规则只消费完成态 Evaluation，不提供复杂状态表达式。

Priority：

```text
[最新完成的评价 ▼]
```

仅两个选项：

```text
Most Recent Completed
最新完成的评价

Initial Completed
首次完成的评价
```

默认：

```text
Most Recent Completed
```

禁止增加：

```text
最高分优先
最低风险优先
人工优先
AI 优先
自定义表达式
```

Human Review 不进入 Selection Priority。

## 27.8 Score / Weight

本区只配置已经冻结的：

```text
Score
Weight
```

规则源来自 `Effective Result` 中可用于业务解释的 Criterion / Field。

页面采用 Data Table：

```text
评价项 / 字段
结果类型
评分规则
权重
```

示意：

```text
服务请求创建正确性
Pass / Fail
PASS → 20
FAIL → 0
20

消费者诉求识别
Pass / Fail
PASS → 15
FAIL → 0
15
```

此处仅表达规则配置，不在页面内重新定义 Criterion / Structured Output。

不建设：

```text
Criterion Library
Scorecard Builder
复杂公式 DSL
JavaScript / Python
拖拽规则节点
```

## 27.9 Overall / Critical

独立 Section：

```text
Overall
Critical
```

支持已经冻结的业务含义：

```text
Overall Pass / Fail
合格线 / Overall Rule
Critical 命中后的派生结果
```

Critical 示例语义：

```text
违规承诺 = FAIL
→ Overall Score = 0
→ Risk = Critical
```

Critical 是 Result Rules 的业务派生规则，不回写 AI Structured Result。

人工复核修改 Effective Result 后：

```text
Effective Result
→ 当前 Rules Version
→ 重新计算 Derived Result
```

人工不得直接编辑：

```text
Derived Score
Risk
Overall
```

## 27.10 Risk / Level / Derived Labels

分别使用轻量 Mapping Table。

### Risk Mapping

```text
条件 / 结果
→ Risk
```

### Level

```text
Derived Result
→ Level
```

### Derived Labels

```text
条件 / 结果
→ Label
```

这些都属于：

```text
Effective Result
→ Result Rules
→ Derived Result
```

不进入 Agent Prompt / Workflow。

V1 不做通用规则引擎或任意脚本。

## 27.11 Validate

点击：

```text
[验证]
```

使用 shadcn Sheet。

Validate 只做规则完整性与可执行性检查，例如：

```text
Evaluation Selection 完整
规则引用有效
必填配置完整
Mapping 可执行
不存在明显冲突 / 无效规则
```

成功：

```text
Validation passed
```

失败：

```text
Blocking Issues
Warnings
```

不在 Validate 中运行生产 Analysis Task。

## 27.12 Publish

发布使用 Dialog。

流程：

```text
Save Draft
→ Validate
→ Publish
```

发布确认至少展示：

```text
新 Rules Version
Agent
Evaluation Priority
规则变更摘要
Version Note
```

发布后：

```text
Published Rules Version
→ 不允许原地修改
```

新 Rules Version 不覆盖历史 Run / Derived Result。

历史 Effective Result 如未来使用新规则回算：

```text
→ 新 Derived Result Revision
```

不覆盖旧 Derived Result。

## 27.13 Version History

入口：

```text
[版本历史]
```

使用 shadcn Sheet。

展示：

```text
Rules Version
状态
发布时间
发布人
Version Note
```

历史 Published Version：

```text
只读
可查看
可基于此版本创建 Draft
```

不新建 Version History 页面。

## 27.14 与 Run 的关系

Run Snapshot 继续冻结：

```text
Result Rules Version
```

Run Detail 只展示当次冻结版本：

```text
Result Rules
V4
```

可点击查看对应只读版本，但不从 Run Detail 修改规则。

## 27.15 与 Quality Result 的关系

质量结果聚合链：

```text
Interaction
→ Evaluation Filter
→ Evaluation Priority
→ Selected Evaluation
→ Human Review（可选）
→ Effective Result
→ Result Rules
→ Derived Result
```

Result Rules Editor 不承担 Quality Result 浏览和 Human Review。

## 27.16 Empty / Loading / Error

遵循全局 Implementation Spec：

```text
Loading
→ Skeleton

No Rules
→ Empty State + 新建结果规则

Filter No Result
→ 保留 Search + 清除筛选

Request Error
→ Inline Error + Retry
```

## 27.17 明确不做

```text
Result Rules Workflow Designer
复杂 DSL
自定义脚本
Criterion Library
Scorecard Marketplace
Result Rules Dashboard
Derived Result BI
规则命中统计
Prompt / Model 配置
Human Review 编辑
Agent Workflow 编辑
Data Asset Mapping
```

最终原则：

> **结果规则页面只管理“如何从已确定的 Effective Result 得到业务派生结果”，不重新承担评价、证据、人工复核或 Agent 编排。**


---

# 28. 当前实现交付状态

当前 8 个核心业务导航页面及核心下钻工作区均已有页面级 Design Spec。

本文件作为当前唯一 Design Spec 基线：

```text
AI_Quality_Intelligence_Platform_DESIGN_SPEC_V1.18_FINAL_BASELINE.md
```

Codex 不得回退引用旧版 Design Spec 中已废弃或被后续章节覆盖的结论。
