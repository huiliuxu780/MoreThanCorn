# AI Quality Intelligence Platform
# 产品架构冻结文档 V1.38 FINAL BASELINE

> 状态：V1 当前有效产品架构唯一基线  
> 范围：首期聚焦“智能质检 → 坐席质检”  
> 用途：产品原型、Design Spec、数据模型、技术方案与 Codex 实现的共同输入  
> 清理原则：正文只保留当前有效结论；历史已废弃概念仅在“已废弃概念”章节保留名称，防止重新引入。

---

# 0. 文档阅读规则

本文只区分三种状态：

- **已冻结**：后续默认沿用，除非明确重新挑战并修改。
- **V1 暂不建设**：长期可能需要，但当前不得因此扩大第一期。
- **待验证**：尚未获得真实业务或技术验证，不视为冻结。

工作规则：

> **每完成并确认一项产品方案，先写入 Master，再进入下一步。**

设计规则：

> **已有成熟交互优先直接复用；没有成熟方案时再做平台自研。**

具体优先级：

```text
React Flow UI 已有
→ 直接复用

React Flow UI 未覆盖
→ 查成熟 Agent / Workflow / QM 产品

仍无成熟答案
→ 最后才自研
```

## 0.1 示例与事实边界

本文中的品牌、产品、服务类型、时间、任务名称、分值、数量、接口字段等示例，除非明确标记为“已确认业务规则”，均只用于说明产品模型与交互，不代表生产真实值。

正式实施必须以以下内容为准：

- 企业真实业务主数据
- 组织人员主数据
- 已发布 Evaluation Agent 的当前有效 Structured Output Schema
- 已确认业务 SLA / 规则
- 实际 Data Asset 定义
- 实际 Tool / Connection 配置

---

# 1. 项目定位

中文工作名：

**企业智能质量与洞察平台**

英文工作名：

**AI Quality Intelligence Platform**

长期愿景：

**Interaction Quality Intelligence**

产品定位：

> **企业内部使用的 AI 驱动质量评价与业务洞察平台。**

首个商业切入点：

> **消费者服务质量智能化。**

长期可覆盖：

- 人工坐席
- 工单
- AI Agent
- 在线文本
- VOC
- 视频 / 直播等多模态交互

本项目不是：

- 传统客服抽检系统
- 单纯 Scorecard / 质检表工具
- 通用 Workflow / n8n 平台
- 数据治理平台
- 纯 AI Observability 产品
- 新建一套客服工单系统

---

# 2. 战略设计原则

## 2.1 Evaluation 与 Discovery 分离

### Evaluation / 智能质检

回答：

> 已知标准下，这次服务或业务过程做得对不对？

例如：

- 坐席是否准确理解消费者诉求
- 是否正确创建服务请求
- 是否执行催促
- 是否存在违规承诺
- AI Agent 是否正确调用 Tool
- 工单过程是否符合企业规则

### Discovery / 智能洞察

回答：

> 有没有出现新的、未知的、异常的业务问题？

例如：

- 新主题
- 异常增长
- 趋势变化
- 消费者声音
- 根因分析

### 共享底座，但不强行统一业务逻辑

共享：

- Data Asset
- Task / Run
- Evidence
- Version / Revision
- 权限与运行底座

不强行统一：

- 业务逻辑
- 输出语义
- 用户入口

---

# 3. 一级产品架构

```text
企业智能质量与洞察平台

01 智能质检
   ├─ 坐席质检
   ├─ 工单质检
   └─ AI Agent 质检

02 智能洞察
   ├─ 消费者声音
   └─ 业务问题发现

03 AI 观测
   ├─ Agent 运行
   ├─ Trace / Tool Call
   └─ 异常与失败分析

04 配置管理
   ├─ 分析任务
   ├─ Evaluation Agents
   ├─ Tools
   └─ 数据定义
```

## 3.1 AI Agent 质检 ≠ AI 观测

AI Agent 质检关注：

> **业务上做得对不对？**

AI 观测关注：

> **Agent 是怎么运行的、为什么失败？**

两者可以共享运行数据与 Trace，但用户问题不同，不合并成一个入口。

---

# 4. V1 实施边界

V1 首期只优先验证：

> **智能质检 → 坐席质检**

完整闭环：

```text
企业生产数据
→ Data Asset
→ Analysis Task
→ Run
→ Evaluation Agent
→ Structured Outputs
→ Create Quality Record
→ Quality Result
→ Human Review（按需）
→ Effective Result
→ Result Rules
→ Derived Result
→ 质量运营 / 业务处置
```

V1 明确不建设：

- Enterprise Quality Model
- 通用 Workflow 平台
- 完整数据治理平台
- 独立 Evaluator Marketplace
- 独立 Prompt / Model 管理中心
- 完整 AI Observability 产品
- 完整智能洞察产品
- 完整工单质检产品
- 完整 AI Agent 质检产品
- Coaching / 培训任务管理
- 绩效奖金自动计算
- 自动生成完整培训方案
- 万能 BI / 自定义 SQL
- 多模态直播质检完整产品

原则：

> **新的平台级概念只有在真实 V1 场景无法解决时才引入。**

---

# 5. V1 已确认业务约束

1. 首期热线样数据暂未完整获得，但预期具备 ASR / 文本、坐席、时间、交互等基本信息。
2. 目标产出：
   - 每天每通电话的质检结果
   - 每天每通电话的数据标记，例如意图
3. 未接通电话不进入正式质检；每一次进入 IVR 的 Interaction 仍需保留基础状态 / 标记。
4. 同一 Interaction 可能存在多意图，虽然属于少量场景，但系统不得假设永远只有单意图。
5. 评价可能需要关联：
   - 产品信息
   - 知识库
   - 工单 / 服务请求
6. 当前没有稳定的直接工单 ID，可通过电话号码、时间等业务上下文查询相关业务事实。
7. “正确创建”不能只看后续是否有动作，还需要判断前置消费者意图 / 诉求是否识别正确。
8. 如果评价所要求的关键后续节点没有有效输出，不能将该评价保存为成功执行。
9. 日常存在：
   - Daily 全量任务
   - 周期性专项
   - 人工转复核
   - 普通 / 低技能坐席抽检
10. 结果需要同时支持总体与明细。
11. 当前传统质检覆盖约 10%，主要依赖正则 / 规则 True / False。
12. 坐席质量目标优先级：
    1. 服务改进
    2. 发现业务流程问题
    3. 风险监管
    4. 绩效辅助
13. 坐席可以看到自己的 AI 质检结果。
14. V1 暂不做自动辅导 / 培训方案。
15. 严重规则可直接导致 0 分，并标记 High Risk / Critical。
16. 人工复核后的业务处置可继续由客服平台现有工单承载，本平台不重建复杂人工工单系统。

---

# 6. 当前核心对象模型

当前唯一有效的执行链：

```text
Enterprise Data
      ↓
Data Asset
      ↓
Analysis Task
      ↓
Run
      ↓
Evaluation Agent Version
      ├─ Inputs
      ├─ Workflow
      ├─ Tool References（锁定具体 Tool Version）
      └─ Structured Outputs 1..N
              ↓
      Sink / Action Nodes
              ↓
      Create Quality Record
              ↓
        AI Structured Result
              ↓
        Human Review（可选）
              ↓
         Effective Result
              ↓
      Result Rules（可选）
              ↓
         Derived Result
```

核心职责：

```text
Data Asset
= 什么持续生产数据具备被分析的资格，以及字段语义是什么

Tool
= Agent 可以调用什么可复用、可治理的能力

Evaluation Agent
= 如何理解、判断、调用 Tool，并产生 Structured Outputs

Structured Output
= Agent 原生结构化输出契约

Sink / Action Node
= 将结果持久化或触发外部副作用

Result Rules
= 企业如何解释和计算 Effective Result

Analysis Task
= Which Agent + Which Asset + Scope + Sampling + Schedule + Agent Version Policy

Run
= Task 的一次真实执行，并冻结当次实际依赖

Quality Result
= 面向业务消费、证据、复核与运营的质量记录
```

## 6.1 关键版本 / Revision 关系

```text
Evaluation Agent
→ Agent Version

Tool
→ Tool Version

Data Asset
→ Data Asset Revision

Result Rules
→ Rules Version

Human Review
→ Review Revision

Run
→ 不变的执行 Snapshot
```

原则：

> **Published / Ready 的历史定义不原地覆盖；历史 Run 永远可解释当时使用了什么。**

---

# 7. Agents

左侧导航名称固定使用：

```text
Agents
```

但页面标题、按钮、字段、状态说明保持中文。

## 7.1 页面范围

```text
Agents
│
├─ Agent 列表
│
└─ Agent Designer
    ├─ 当前 Draft
    ├─ Run / Inspect
    ├─ 发布检查
    ├─ 二次发布确认
    └─ Version History（Sheet）
```

Agent 是通用产品对象；Evaluation 是 Agent 的一种用途，不再以 Evaluation Agent 限制 Builder 的能力边界。

不新增：

- Agent Overview
- Agent Settings 独立页面
- Structured Outputs 独立导航
- Statistics
- 多余 Designer Tabs

## 7.2 列表页

列表页只解决：

- 找到 Agent
- 判断当前状态
- 创建 Agent
- 进入 Agent Designer

核心字段：

```text
名称
当前版本
状态
最近更新
```

不堆叠：

- 调用量
- 成功率
- Token
- 延迟
- 运行监控指标

## 7.3 创建 Agent

创建只填写：

```text
名称
描述
```

创建后直接进入 Agent Designer。

## 7.4 Agent 生命周期

```text
Draft
→ Testing
→ Published
→ Deprecated
```

Published Version 不允许原地修改。

修改 Published Agent：

```text
Published V7
     ↓
Draft V8
     ↓
Test
     ↓
Publish V8
```

同一 Agent 默认只维护一个活动 Draft；若已经存在 Draft，从历史版本创建草稿时必须提示，不静默创建第二个 Draft。

## 7.5 Agent Version 冻结内容

Agent Version 至少冻结：

- Graph Definition
- Node Configuration
- Prompt / Instructions
- Model Configuration（影响结果时）
- Input Schema
- Structured Output Schema
- 具体 Tool Version References
- 影响运行的其他配置

Connection / Credential 的 Secret 不复制进 Agent Version。

## 7.6 发布流程

```text
点击发布
→ Dependency Check
→ 继续发布
→ 二次发布确认 + Version Note
→ Publish
```

Dependency Check 至少检查：

- Graph 合法
- 必填 Node 配置完整
- Tool Reference 有效
- Input Schema 有效
- Structured Output Schema 有效
- 最近一次成功运行
- 其他阻断依赖

并展示使用 `Latest Published` 的周期 Task 及预计下一次生效 Run。

二次确认必须说明：

- 新版本成为当前 Published
- Published 不可原地修改
- `Latest Published` Task 从下一次尚未创建的 Run 使用新版本
- 已创建或运行中的 Run 不受影响
- 必须填写 Version Note

不采用输入 Agent 名称等重型确认。

## 7.7 Version History

从 Designer 顶部版本号进入，使用 shadcn Sheet。

Published 历史版本：

- 只读
- 可“基于此版本创建草稿”

Version History 不做独立页面。

---

# 8. Agent Designer

## 8.1 技术与视觉基线

```text
CORNplus Product Shell
+ CORNplus Agent List / Lifecycle
+ CORNplus Agent Builder
+ CORNplus Agent Flow Definition / Runtime
```

Agents 的新建、编辑、节点配置、保存、测试和运行使用已一次性导入的 CORNplus Agent Platform 源码与能力，不再继续扩建旧 Workflow Editor、Graph Definition Compiler 和平行 Runtime，也不再与 upstream 同步。

来源代码已纳入 CORNplus 一方代码库和交付链路，必须保留 MIT License、原始版权声明和源码来源。Agent、Tool、Connection、LLM API、Analysis Task、Run、Quality Result 与权限均使用 CORNplus 产品对象；用户不得看到独立 Langflow 产品、导航或管理后台。

## 8.2 Designer 壳层

保持极简：

```text
返回
Agent 名称
版本 / 状态
保存状态
Run
Publish
```

基础 Canvas / Node / Edge / Handle / Inspector 优先继承 React Flow UI。

## 8.3 通用 Node 模型

画布不预设“理解节点”“评价节点”“质检节点”等业务专用 Node Type。

通用 Node 家族：

```text
Input / Output

LLM
Tool
Code / Transform

Condition
Router
Loop

Subgraph
Parallel
Merge

Human Interrupt
Retry / Error Handler

Terminal / Effect
- Create Record
- Update Record
- Emit Event
- Notification
- Trigger
```

原则：

> **Node Type 通用化，Node Instance 业务化。**

例如：

```text
LLM Node
实例名称：识别消费者诉求

LLM Node
实例名称：判断是否违规承诺

Tool Node
实例名称：查询服务请求

Create Record Node
实例名称：Create Quality Record
```

## 8.4 React Flow UI 直接复用

优先直接采用官方已有能力：

- Base Node
- Base Handle
- Labeled Handle
- Button Handle
- Edge with Button
- Status Indicator
- Labeled Group
- Node Search
- Controls / MiniMap / Zoom
- Workflow Editor / AI Workflow Editor 基础布局
- Runner / Node Monitoring / Node Status
- Canvas 基础交互

原则：

> **不重新设计一套“像 React Flow UI”的基础组件。**

## 8.5 Node Visual Direction

目标：

- 黑 / 白 / 灰中性基底
- 节点轻、薄、精密
- Node Type 通过 icon、label、port 形态区分
- 不依赖大面积彩色背景
- Selected / Running / Error 才出现明显状态强调
- 详细配置进入右侧 Inspector
- 连线与 Port 保持低噪声
- 支持连线上快速插入节点
- 支持 Group / Subgraph
- 运行时通过路径高亮表达执行状态

禁止“彩虹式低代码画布”。

## 8.6 Inspector

不预设所有 Node 都拥有固定的 `General / Input / Output / Execution / Test` Tab。

冻结模型：

```text
选中 Node
    ↓
React Flow UI Inspector 骨架
    ↓
Node Schema 决定具体配置字段
    ↓
shadcn/ui 渲染表单控件
```

例如：

```text
LLM Node
- Model
- Prompt
- Variables
- Structured Output

Tool Node
- Tool Reference
- Input Mapping
- Output Mapping
- Error Handling

Condition Node
- Expression
- Branches

Action / Sink Node
- Action Type
- Input Mapping
- Retry / Idempotency
```

## 8.7 Variable Picker 与数据传递

普通业务用户不要求手写：

```text
state.xxx
{{ complex.path }}
```

Node Input 支持：

```text
Variable
Fixed Value
Expression（高级）
```

Variable 来源：

```text
Input
Upstream Outputs
State
System
```

Typed Input / Output：

```text
String
Number
Boolean
Object
Array
DateTime
Custom Schema
```

Graph / State 职责：

> **Graph 决定执行关系与可达上游；Typed Output 决定可引用的数据；State 只用于跨节点长期共享、Checkpoint / Resume、跨 Subgraph 等场景。**

直接上游输出可直接引用，不要求先写入 State。

Prompt 出现变量占位符时，系统可自动生成变量绑定区。

## 8.8 Structured Outputs

Agent 原生输出统一为：

```text
Structured Outputs / Output Schemas
```

一个 Agent 支持 `1..N` 个 Structured Outputs。

例如：

```text
quality_result
interaction_labels
consumer_request
```

这些名称是结构化数据契约，不是独立产品对象。

业务层消费方式：

```text
Structured Output
→ Quality Result
→ Label Result
→ 其他业务结果
```

不新增全局 Structured Output 管理页；优先通过 Node Schema / Workflow 配置。

## 8.9 Sink / Action Node

Structured Output 负责描述结果；Sink / Action Node 负责持久化或触发副作用。

```text
Structured Output
= 数据结构

Sink / Action
= 使用结果执行动作
```

V1 质量领域化 Sink：

```text
Create Quality Record
```

典型：

```text
Workflow
   ↓
Structured Output
   ↓
Create Quality Record
   ↓
END
```

`Create Quality Record` 不是技术 Graph END。

后续可扩展：

- Create Record
- Update Record
- Emit Event
- Send Notification
- Push Card
- Trigger Workflow
- Create Review

同一 Structured Output 可以被多个 Action 消费。

所有外部副作用 Node 必须考虑：

- Idempotency
- Retry Safety
- Duplicate Protection

## 8.10 调试

不创造 Design / Test / Trace 三套割裂模式。

统一心智：

```text
选中 Node
→ Run Node
→ Inspect Output

整图
→ Run Flow
→ 查看执行路径与 Structured Outputs

历史执行
→ Run / Trace
```

React Flow UI 已覆盖的 Runner / Monitoring 优先复用；缺失细节参考 Langflow 的成熟 Run Node / Inspect Output / Playground / Trace 心智。

---

# 9. Interaction Understanding 业务语义

本章定义“理解什么”，**不是固定 Node Type**。

实现时可以由一个或多个通用 LLM / Tool / Transform Node 完成。

最小回答：

1. 这通 Interaction 在讲什么？
2. 消费者想做什么？

## 9.1 Business Context

V1 最小字段：

- Brand
- Product Category
- Service Type
- Issue / Topic

底层保持独立字段，不合并为一个字符串。

## 9.2 Consumer Request

与 Business Context 分开：

- Request Type
- Request Summary

## 9.3 不属于全局 Understanding 的内容

不固定输出：

- 是否已有服务单
- 当前服务状态
- 是否允许催促
- 是否执行催促
- 是否当天创建单据
- 是否存在违规承诺

这些应由 Agent Workflow 按需查询或判断。

## 9.4 LLM Prompt 治理

若业务语义抽取由 LLM Node 实现，其 Prompt 必须可追溯，并在 Agent Version / Run 中冻结。

建议分层：

```text
Platform Guardrails
+ Business Instruction
+ Runtime Context
+ Structured Output Schema
```

Platform Guardrails：

- 只能从允许值中选择正式枚举
- 无法可靠判断时返回 Unknown / Other
- 不创造不存在的生产分类值
- 必须按 Schema 返回
- 按需输出 Evidence / Confidence

Business Instruction：

> 表达业务识别规则，而不是要求普通业务用户维护完整 System Prompt。

Runtime Context 由系统注入：

- Conversation / ASR
- Interaction Metadata
- 允许使用的上下文
- 标准枚举 / Taxonomy
- 必要业务主数据

---

# 10. 两类主数据

## 10.1 业务语义主数据

回答：

> 这通 Interaction 在讲什么？

包括：

- Brand
- Product Category
- Service Type
- Issue / Topic

原则：

> **标准体系定义允许值；AI 负责判断 Interaction 属于哪个标准值。**

不允许 LLM 自由创造正式生产统计值。

## 10.2 组织人员主数据

回答：

> 谁处理的、当时属于哪个组织？

包括：

### Department

- department_id
- department_name

### Team

- team_id
- team_name
- department_id
- manager_id（如已有）

### Agent

- agent_id / resource_id
- agent_name
- status
- team_id
- department_id
- skill_level（如已有）

来源：

- HR
- 客服组织
- 企业人员主数据系统

平台不建设 HR 系统。

## 10.3 历史组织快照

Interaction / Quality Result 至少保留：

- agent_id
- team_id_at_interaction
- department_id_at_interaction

避免人员转组后历史质量统计漂移。

---

# 11. Structured Result 与 Result Rules

## 11.1 Agent 原生输出

Evaluation Agent 只负责产生 Structured Outputs。

质量类 Structured Output 可以包含：

```text
Section / Dimension
Criterion / Field
Result Type
Reason
Evidence
Confidence
Severity / Critical Metadata
```

但这些属于结构化结果字段，不建立独立“评价表”产品对象。

## 11.2 Result Type

至少支持：

```text
Boolean
Pass / Fail / N/A
Score
Level
Enum
Risk
Label
Number
Text
```

Score 只是结果类型之一。

## 11.3 Applicability

必须区分：

```text
NOT_APPLICABLE
UNABLE_TO_EVALUATE
```

Required 字段没有产生有效结果时，可将当前业务结果标记为 `INCOMPLETE`，不能伪装成成功评价。

## 11.4 Result Rules

Result Rules 与 Agent Workflow 解耦，用于业务解释和派生计算，例如：

- Score / Weight
- Overall Pass / Fail
- Risk Mapping
- Critical
- Level
- Derived Labels

生命周期：

```text
Structured Output
→ Create Quality Record
→ AI Structured Result
→ Human Review（可选）
→ Effective Result
→ Result Rules
→ Derived Result
```

Result Rules 可独立版本化。

修改权重、合格线、Risk Mapping、Critical 等业务管理口径时，不要求机械升级 Agent Version。

对历史 Effective Result 使用新 Rules 回算：

> **生成新的 Derived Result Revision，不覆盖历史 Derived Result。**

---

# 12. Quality Result / Evidence / Human Review

## 12.1 Quality Result 层级

```text
Execution Status
→ 本次执行是否技术成功

AI Raw Output
→ Agent 原始运行输出

AI Structured Result
→ 根据 Structured Output 持久化的 AI 业务结果

Human Review
→ 对结构化业务字段的人工校正（可选）

Effective Result
→ 当前有效业务结果

Derived Result
→ Result Rules 计算出的 Score / Risk / Level / Overall 等
```

原则：

> **Quality FAIL 不等于 Execution ERROR。**

## 12.2 Evidence

至少支持：

- Conversation Evidence
- Business Evidence
- Knowledge Evidence
- Tool Call / Agent Evidence
- Technical Trace（高级）

Evidence 尽量保存可定位引用。

## 12.3 Human Review

Human Review：

> **修正结构化业务结果，不覆盖 AI Raw Output，不直接手改 Derived Score / Risk。**

Review 数据至少保存：

- Interaction / Execution
- Agent Version
- AI Structured Result
- Human Corrections
- Human Evidence
- Review Comment
- Reviewer
- Review Status
- Review Time
- Review Revision

状态：

```text
PENDING
→ IN_REVIEW
→ COMPLETED

Quality Admin：
COMPLETED → REOPENED → COMPLETED
```

人工只修正有异议的字段；未修正字段继续沿用 AI 结果。

权限：

- Viewer
- Reviewer
- Quality Admin

Reviewer 不获得 Agent / Tool / Data Asset 编辑权限。

## 12.4 Rerun 与 Review

Rerun 产生新的 Execution / AI Structured Result，不删除历史执行。

已有人工复核结果不得被新 Rerun 静默覆盖。

## 12.5 Review ≠ Business Action

Review 负责校正结果。

业务处置：

- 继续由客服平台承担
- 或由独立 Action / Tool 触发

Appeal / Arbitration / 独立 Calibration Center 暂不进入 V1。

---

# 13. Analysis Task

Analysis Task 已冻结，不再重新设计。

核心：

```text
Analysis Task
├─ Evaluation Agent
├─ Agent Version Policy
├─ Data Asset
├─ Data Scope
├─ Sampling
└─ Schedule
```

## 13.1 Agent Version Policy

支持：

```text
Latest Published
Fixed Published Version
```

周期 Task 保存的是 Policy，不提前复制 Agent Definition。

Run 创建时解析实际 Agent Version 并冻结。

规则：

```text
Tool / Agent 新版本发布
→ 不影响已经创建或运行中的 Run
→ Latest Published Task 的下一次新 Run 才使用新 Agent Version
```

## 13.2 Data Asset

Task 选择 Data Asset。

不要求用户日常手选 Data Asset Revision。

Run 创建时：

```text
resolve 当前 Ready Revision
→ 冻结进 Run Snapshot
```

## 13.3 Data Scope

Task 只限定本次运行范围。

可包含：

- 时间
- Department / Team / Agent
- Brand / Product Category / Service Type / Issue / Topic
- Data Asset 可筛选字段

Data Asset 的长期业务 Eligibility 不在 Task 中重复配置。

## 13.4 Sampling

V1：

- 全量
- 随机抽样
- 固定数量

## 13.5 Schedule

支持：

- 一次性
- 每日
- 每周
- 每月

Schedule 与 Data Window 分离。

## 13.6 页面

### Task List

核心展示：

```text
任务名称
Evaluation Agent
Data Asset
Schedule
状态
最近运行
```

### Create Task

配置：

```text
任务名称
Evaluation Agent
Agent Version Policy
Data Asset
Data Scope
Sampling
Schedule
```

### Task Detail

展示：

- 当前 Agent Version Policy
- 当前 Published Agent
- Data Asset
- Schedule
- Data Window
- 运行记录
- Backfill 入口

Task Detail 为下钻页面，不新增导航。

---

# 14. Run

Run 是 Analysis Task 的一次真实执行。

## 14.1 Run Snapshot

至少冻结：

- Task Snapshot
- 实际 Evaluation Agent Version
- 实际 Tool Versions（由 Agent Version 引用）
- 实际 Data Asset Revision
- Result Rules Version（如适用）
- Data Scope
- Sampling
- Data Window
- Runtime Environment
- 开始 / 结束时间

Agent Version 内已经冻结的 Graph、Prompt、Model、Structured Output Schema 等，不再在产品层重复创造独立“Contract Version”对象。

## 14.2 Run Status

```text
PENDING
RUNNING
SUCCESS
PARTIAL_SUCCESS
FAILED
CANCELLED
BLOCKED
```

关键依赖不可用时可进入 `BLOCKED`。

## 14.3 Interaction Execution

```text
Execution Status
SUCCESS / ERROR / SKIPPED

Business Result
结构化质量 / 标签等结果
```

业务 FAIL 与执行 ERROR 分离。

## 14.4 Attempt / Backfill / Rerun / Retry

```text
Backfill
= 为历史缺失窗口补建新的 Run

Rerun
= 重新执行并产生新的 Run

Retry
= 同一 Run / Execution 内针对瞬时错误再次尝试
```

历史 Attempt 不删除。

## 14.5 Run Detail

展示：

- Agent Version
- Data Asset Revision
- 输入数量
- Completed / Skipped / Error
- 主要执行异常
- 进入异常 Interaction
- Advanced Trace

Run 不作为一级导航页面。

---

# 15. 坐席质检 V1 页面清单

## 15.1 7 个核心导航页面

智能质检 → 坐席质检：

1. 质量总览
2. 质量结果
3. 坐席分析

配置管理：

4. 分析任务
5. Agents
6. Tools
7. 数据定义

**V1 核心导航共 7 个。**

注意：

> `Agents` 为统一导航标签；进入页面后标题、字段、按钮仍以中文为主。

## 15.2 下钻 / Designer，不计入导航

- Quality Result Detail
- Task Detail
- Run Detail
- Agent Designer
- Tool Detail
- Data Asset Detail / Editor
- Human Review Workspace（复用 Quality Result Detail）
- Version / Revision History Sheet

## 15.3 明确不新增的一级页面

- Workflow Center
- Evaluator Center
- Prompt Center
- Structured Output Center
- Review Center
- Run Center
- Tool Monitoring Center
- Tool Permission Center
- Data Quality Center
- Data Explorer
- Metric Center
- Semantic Model Center

---

# 16. 质量总览

定位：

> **Quality Operations 页面，其次才是统计 Dashboard。**

回答：

1. 当前质量怎么样？
2. 主要问题在哪里？
3. 当前需要关注什么？

## 16.1 顶部 KPI

- 有效质检覆盖率
- 平均质量得分
- 问题交互率
- Critical
- 待复核

## 16.2 主要质量问题

来源必须是当前正式 Quality Result Schema / Criterion，不允许 AI 在首页自由创造生产问题分类。

默认聚合：

```text
Section / Dimension
→ Criterion
→ Interaction
→ Evidence
```

## 16.3 统计口径

默认：

- 影响 Interaction 数
- 影响 Interaction 率
- 相比历史周期变化

不默认展示简单 Failure Count，避免同一 Interaction 多 Criterion 重复放大。

## 16.4 需要关注

V1 由确定性规则 / 统计异常产生：

- 某 Criterion 失败率明显上升
- 某场景问题集中
- 某班组明显偏离
- Critical 未处理
- 同类问题持续出现
- 待复核积压

AI 负责解释已识别异常，不自由决定“什么值得关注”。

## 16.5 场景与趋势

支持按：

- Business Context
- Service Type
- 7 日 / 30 日
- Section / Criterion

观察质量。

## 16.6 首页不放

- Top / Bottom 坐席榜
- 大量雷达图
- AI 自由大段总结
- Prompt / Model
- Token 成本
- Tool Call 工程指标
- 完整 VOC
- 工单全生命周期
- 所有 Criterion 明细

---

# 17. 质量结果

定位：

> **带业务语境的全量 Interaction 质量工作台。**

默认：

> **一通 Interaction 一行。**

不按 Criterion Failure 拆成多行。

## 17.1 核心字段

- 时间
- 坐席 / 班组
- Business Context
- Consumer Request Summary
- Quality Score
- Risk / Critical
- 问题摘要
- Review Status

消费者诉求摘要必须直接可见。

## 17.2 筛选

质量：

- 有问题
- Critical
- High Risk
- Section
- Criterion
- 分数范围

业务：

- Brand
- Product Category
- Service Type
- Issue / Topic
- Request Type
- Department / Team / Agent

运营：

- 待复核
- 已复核
- AI / 人工不一致
- 已触发处理

可保存常用筛选视图。

V1 不做：

- SQL
- 万能自定义列
- BI 建模

---

# 18. Quality Result Detail / Evidence Chain

核心：

> **Conversation Evidence + Business Facts → Criterion Result**

## 18.1 顶部 Context

显示：

- Brand
- Product Category
- Service Type
- Issue / Topic
- Request Type
- Request Summary
- Agent / Team
- Interaction 时间
- Interaction ID
- Quality Summary

## 18.2 三栏结构

```text
Conversation
│
├──────────────
Quality Evaluation
│
├──────────────
Business Facts
```

三栏核心同时可见，不做互斥主 Tab。

### Conversation

- 录音
- ASR
- 消费者 / 坐席角色
- 时间戳
- 证据高亮
- Criterion 标记

### Quality Evaluation

- Score
- Risk
- Critical
- Section
- Criterion
- PASS / FAIL / N/A
- Severity
- Evidence

### Business Facts

- 关联服务单
- 服务单状态
- 创建时间
- 当前节点
- 催促记录
- 业务动作
- 时间线
- Tool 查询得到的事实

## 18.3 双向定位

- 点击 Criterion → 对话跳转并高亮
- 点击对话旁 Criterion 标记 → 返回对应评价项

## 18.4 技术 Trace

默认不占核心界面。

通过高级入口查看：

- LLM
- Tool
- Prompt
- Model
- Node
- Trace

## 18.5 Human Review

Human Review 内嵌在 Quality Result Detail，不建立独立 Review Center。

质量结果列表可提供：

```text
全部结果
待复核
已复核
```

---

# 19. 坐席分析

定位：

> **组织维度的质量问题定位页，不是绩效成绩单。**

支持：

```text
[班组] [坐席]
```

分析路径：

```text
质量总览
→ 班组
→ 坐席
→ Section / Criterion
→ Interaction
→ Evidence
```

班组视角：

- 有效质检
- 平均分
- 问题交互率
- Critical
- 主要质量问题
- 问题集中场景
- 需要关注坐席
- 趋势

坐席视角：

- Agent / Team
- 有效质检
- 平均分
- 问题交互率
- Critical
- 主要质量问题
- 问题集中场景
- 7 / 30 日趋势
- 相关 Interaction

不创建 AI 能力雷达，不额外发明：

- 沟通能力
- 专业能力
- 服务能力
- 同理心

只复用正式 Quality Result 中已经定义的 Section / Dimension / Criterion。

---

# 20. Tools V1

## 20.1 Tool Registry

Tool 是 Agent 可消费的能力资产。

统一关系：

```text
Connection / Credential / Provider
                ↓
              Tool
                ↓
       Evaluation Agent
```

冻结：

- Tool 是主能力资产
- Connection / Credential 是基础设施配置
- Agent 引用 Tool，不直接消费 Credential
- 一个 Connection 可供多个 API Tool 复用
- Connections / Credentials 不混入 Tool 资产卡片列表
- Connections 属于基础配置层，不计入当前 7 个核心导航；具体入口在基础配置阶段再定

Tool 能力属性：

```text
READ
WRITE
ACTION
```

它们是治理属性，不拆成三套产品。

## 20.2 V1 Tool 来源

V1 只保留：

```text
API Tool
Built-in Tool
```

### API Tool

由用户创建，用于调用已有企业 HTTP / API 能力。

### Built-in Tool

由平台随产品版本提供。

用户可以：

- 查看 Contract
- Enabled / Disabled
- Permission
- Requires Approval

定义与版本由平台管理。

## 20.3 V1 暂不支持

- MCP Tool Import
- OpenAPI 批量 Import
- Custom Code Tool
- 用户在 Tools 中直接编写 Python / JavaScript
- Tool Monitoring Center
- 独立 Tool Permission Center
- 复杂 Tool Retry Policy

流程内简单计算使用：

```text
Code / Transform Node
```

不进入 Tool Registry。

## 20.4 Tool List

采用：

> **4 列紧凑卡片 + 分页**

响应式：

```text
≥ 1440px      4 列
1024–1439px   3 列
更窄          2 / 1 列
```

卡片高度尽量统一，描述最多两行，不做瀑布流。

单卡片只展示：

- 名称
- 描述
- 来源
- Capability：READ / WRITE / ACTION
- 状态
- 版本
- 最近更新时间

不展示：

- 调用次数
- 成功率
- 平均耗时
- Token
- Agent 引用数
- 运行监控指标

支持：

- Search
- Filter
- Pagination
- 创建时间 / 更新时间排序
- 最新优先 / 最早优先

默认：

```text
更新时间 · 最新优先
```

列表状态应保留在 URL / Query 中，进入 Tool Detail 后返回不丢失。

## 20.5 Create API Tool

采用单页编辑器，不使用 Wizard。

```text
基本信息
- 名称
- 描述
- Capability

请求
- Connection
- HTTP Method
- Path
- Headers
- Query Parameters
- Body

Contract
- Input Contract / Request Mapping
- Output Contract / Response Mapping

治理
- Requires Approval
- Permission
- Status

Test
```

### Connection

Tool 只引用已有 Connection。

Credential / Secret 不在 Create Tool 页面重复维护。

### Input Contract

不维护一套 Tool Schema + 一套 HTTP 参数的双份定义。

统一：

```text
Agent-facing Input Contract
        ↓
Request Mapping
```

例如：

```text
consumer_id : String
       ↓
query.consumerId
```

字段至少支持：

- Name
- Type
- Required
- Location：Path / Query / Header / Body
- Request Key / Mapping

### Output Contract

Tool Test 获得真实 Response 后支持：

```text
从测试响应生成 Output Schema
```

用户可以在生成结果基础上确认和调整。

### Test

使用当前页 Sheet：

```text
Input
→ Run
→ Status
→ Duration
→ Response / Error
```

Draft 可保存。

规则：

> **没有一次成功 Test 的 Draft 不允许 Publish。**

## 20.6 Tool Version

```text
Tool
├─ V1 Published
├─ V2 Published
└─ V3 Draft
```

Published Tool Version 永远不可原地修改。

首次：

```text
Draft V1
→ Test
→ Publish V1
```

修改：

```text
Published V1
→ Draft V2
→ Test
→ Publish V2
```

Publish 采用轻量 Dialog：

- 配置完整
- Connection 可用
- Test 成功
- Input Schema 有效
- Output Schema 有效
- Version Note

## 20.7 Tool Status

Version Status：

```text
Draft
Published
```

Tool 治理状态：

```text
Enabled
Disabled
Deprecated
```

语义：

```text
Enabled
= 正常使用

Disabled
= 紧急阻断新调用

Deprecated
= 不推荐继续使用；历史与既有引用保留，新引用提示迁移
```

## 20.8 Agent 锁定具体 Tool Version

Agent Definition 保存：

```text
tool_id
tool_version
```

Published Agent 永远锁定具体 Tool Version。

Tool 发布新版本：

```text
Agent V7 → 仍使用 Tool V2

Agent Draft V8
→ 提示 Tool V3 可升级
→ 用户主动升级
→ Test
→ Publish
```

禁止 Tool 新版本静默改变已发布 Agent 行为。

## 20.9 哪些修改必须升 Tool Version

影响 Agent 行为、Contract 或执行结果的修改必须升版：

- Tool Callable Name
- LLM-facing Description
- Connection Reference
- HTTP Method
- Path
- Input Contract
- Request Mapping
- Output Contract
- Response Mapping
- Execution Configuration

纯展示 / 后台备注可不升版。

以下治理属性独立于 Version，可即时生效：

- Enabled / Disabled / Deprecated
- Permission
- Requires Approval

## 20.10 Requires Approval

Tool Registry 定义最低治理要求。

Agent 只能保持或提高，不能放松。

例如：

```text
Tool Requires Approval = ON

Agent Designer
Requires Approval = ON  [Locked]
```

不机械规定 WRITE / ACTION 必须审批，由 Tool 管理员按风险配置。

## 20.11 Permission

V1 只解决：

```text
谁能管理 Tool
谁能让 Agent 使用 Tool
```

复用平台 RBAC。

不做字段级、参数级权限与复杂 Policy DSL。

## 20.12 Retry / Error

Tool 负责：

- 调用
- 返回结果
- 标准化 Error
- Duration

流程控制交给 Agent Graph：

- Retry
- Fallback
- Error Branch
- Degradation

尤其 WRITE / ACTION Tool 不隐藏自动重试，避免重复副作用。

## 20.13 Tool Call Trace

每次 Tool Call 记录：

- Tool
- Tool Version
- Input
- Output
- Status
- Error
- Duration
- Timestamp

不新增 Tool Monitoring 产品。

排查路径：

```text
Quality Result
→ Run
→ Trace
→ Tool Call
```

## 20.14 删除 / 停用 / 弃用

```text
未发布 Draft 且无人引用
→ 可 Delete

Published Version
→ 不允许物理删除

Disabled
→ 阻断新调用

Deprecated
→ 保留历史 / 既有引用，提示迁移
```

## 20.15 Tool Detail

单页配置，不强行拆多个 Tabs：

```text
Identity
Source / Connection
Input / Output Contract
Governance
Test
Version History
```

Version History 使用 Sheet，不新增页面。

---

# 21. Data Definition / Data Asset V1

## 21.1 核心对象

Data Definition 只管理：

```text
Data Asset
```

定义：

> **什么持续生产数据可以被 Agent / Analysis Task 当作分析对象，以及这些数据字段是什么意思。**

典型：

- 热线通话
- 在线会话
- 消费者工单
- AI Agent 执行记录
- VOC 原声
- IVR 进入记录

Data Asset 不等同于实验 Dataset。

## 21.2 与数据接入分离

```text
数据库 / 数仓 / 日志 / API
          ↓
    Source Binding
          ↓
      Data Asset
          ↓
   Analysis Task
```

Data Definition 不负责：

- ETL
- 同步任务
- 数据开发
- 复杂 Join
- 数仓建模
- 血缘平台
- 完整数据治理

复杂加工优先在企业已有数据平台完成，再由 Data Asset 引用 Table / View。

Data Asset 仅支持轻量定义：

- 字段选择
- 字段重命名
- 类型定义
- JSON Path / 简单字段提取
- 简单表达式
- 基础过滤

## 21.3 Data Asset List

使用紧凑表格，不使用 Tool Marketplace 式卡片。

核心列：

- 名称
- 来源
- 一条数据代表什么
- 时间字段
- Lifecycle
- Health
- 最近更新

支持：

- Search
- Filter
- Sort
- Pagination

默认：

```text
最近更新 · 最新优先
```

不展示日记录量、调用量、Agent 引用数、成功率等运营指标。

## 21.4 Data Asset Editor

采用单页编辑器：

```text
Identity
Source Binding
Record Definition
Schema
Eligibility
Health
Preview / Validate
Revision History
```

不使用复杂 Wizard。

## 21.5 Record Definition

必须显式回答：

```text
一条数据代表什么？
```

例如：

- 一通电话
- 一次在线会话
- 一张工单
- 一次 Agent 执行
- 一条消费者原声

同时定义：

```text
Record ID
Time Field
```

UI 优先使用业务语言，不要求用户理解 `Grain`。

## 21.6 Schema

V1 字段只定义必要分析语义：

- Source Field
- Business / Display Name
- Data Type
- Description
- Required

不提前建设：

- Dimension
- Measure
- Metric
- Ontology
- Business Entity
- Semantic Relationship

## 21.7 Eligibility 与 Task Scope

Data Asset Eligibility：

> **哪些记录从长期业务定义上就有资格进入分析。**

例如：

```text
connected = true
transcript IS NOT NULL
duration > 0
```

Analysis Task Scope：

> **这一次从 Eligible Data 中选哪些运行。**

链路：

```text
Source Data
→ Asset Eligibility
→ Eligible Data
→ Task Scope / Sampling
→ Run
```

两者不得混为一套过滤条件。

## 21.8 Lifecycle 与 Health

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

`Ready + Error` 合法：

> 资产定义已可用，但当前上游运行异常。

V1 Health 只覆盖：

- Connectivity
- Schema
- Freshness

不建设完整 Data Quality 产品。

## 21.9 Validate / Preview

进入 Ready 前必须 Validate：

- Source 可访问
- Record ID 有效
- Time Field 有效
- Required Field 存在
- Schema 有效
- Eligibility 可执行
- Preview 成功

使用右侧 Sheet，不新增页面。

Preview 只显示少量真实样本，用于确认资产定义。

不扩展为：

- SQL IDE
- 拖拽分析
- Pivot
- Chart
- Data Explorer

## 21.10 Data Asset Revision

采用轻量 Revision：

```text
Ready Revision 12
       ↓ 编辑
Draft Revision 13
       ↓ Validate
Ready Revision 13
```

影响以下定义的修改产生新 Revision：

- Source Binding
- Record Definition
- Schema
- Eligibility

历史 Ready Revision 不覆盖。

Task 只选择 Data Asset。

Run 创建时：

```text
resolve 当前 Ready Revision
→ 冻结进 Run Snapshot
```

Revision History 用 Sheet，不新增页面。

## 21.11 人员组织与业务主数据边界

```text
人员 / 组织主数据
≠
业务语义主数据
≠
Data Asset
```

Data Asset 可引用：

- agent_id
- team_id
- product_code
- service_type

但 Data Definition 不负责维护员工、组织树、技能、产品主数据。

组织映射必须确定性，不由 AI 猜测。

## 21.12 明确不新增

- Data Source 页面
- Data Quality 页面
- Data Contract 页面
- Semantic Model 页面
- Metric 页面
- Mapping Center
- Data Lineage 页面
- Data Explorer
- ETL Designer

Connections / Credentials 属于基础配置层。

---

# 22. V1 横向权限

采用：

> **业务角色 + 对象操作权限**

不为每个对象建立一套独立角色体系。

基线：

| 对象 | 查看 | 配置 / 管理 | 发布 / 执行 / 复核 |
|---|---|---|---|
| Data Asset | Viewer | Asset Admin | Ready / Deprecate |
| Tool | Viewer / Test（按授权） | Tool Admin | Publish / Disable / Deprecate |
| Evaluation Agent | Viewer | Agent Editor | Agent Publisher |
| Analysis Task | Viewer | Task Manager | Enable / Disable / Backfill / Rerun |
| Quality Result | 按数据权限 | — | Reviewer / Quality Admin |
| Result Rules | Viewer | 具备业务规则配置权限 | Agent Publisher / Quality Admin |

约束：

- Secret / Credential 不向普通 Viewer、Reviewer、Agent Editor 展示。
- Reviewer 不获得 Agent / Tool / Data Asset 编辑权限。
- Agent Editor 可以引用 Published + Enabled Tool，但不能修改 Tool Definition。
- 数据可见范围继续受 Department / Team / Agent 等业务数据权限控制。
- V1 不建设独立权限中心。

---

# 23. Quick Service 真实页面带来的设计校准

吸收：

- 会话与评价项并排
- 录音 / ASR 时间轴
- 评价项与会话证据定位
- AI 与人工复核结果并存
- 评价项逐项展开

不直接照搬：

- 只停留在规则命中 / 未命中
- 只展示扣分，不展示业务事实
- 把详情做成传统 QA 表单

本项目继续强化：

> **Conversation Evidence + Business Facts → Criterion Result**

---

# 24. 竞品参考原则

传统 QM：

- NICE
- Sprinklr
- Quick Service

参考：

- 质检业务流程
- 企业治理
- 人工复核
- 质量运营

AI-native CX / Quality：

- Observe.AI
- Cresta
- Level AI
- MaestroQA
- CallMiner

参考：

- 全量 Interaction Intelligence
- AI Scoring
- Evidence
- Quality Operations
- Human Governance

AI / Agent Evaluation：

- LangSmith
- Braintrust
- Humanloop
- Parloa / Decagon 等

参考：

- Trace / Evidence
- Continuous Evaluation
- AI / Human Calibration

Agent / Workflow Builder：

- React Flow UI
- Langflow
- Flowise
- Dify
- n8n

参考：

- Canvas
- Node / Variable Mapping
- Tool / Credential 分层
- Run / Inspect
- Version / Compatibility
- Human Approval

原则：

> **参考成熟交互，不照抄某一家，也不为了“平台感”创造中间对象。**

---

# 25. 已废弃 / 不再作为 V1 产品对象

以下名称仅为防止后续重新引入，**不属于当前正文对象模型**：

- Analysis Template
- Analysis Plan / 分析方案
- Evaluation Template / 评价模板（作为顶层对象）
- Evaluation Expert / 评价专家
- Analysis Agent（作为 V1 业务对象）
- Enterprise Quality Model
- Data Capability
- Search Capability
- Data Tool
- Evaluation Pack
- Criterion Binding
- Pack Workflow
- Pack-level Applicability
- Pack Version / Stable / Published
- Plan Main Analysis Flow
- Quality Model Library
- Strategy Group
- Evaluator Chain
- Segment / Audience
- Workflow Center
- Evaluator Center
- Prompt Center
- Model Center
- 独立 Review Center
- Criterion 独立管理页
- Output Form（作为 Agent 原生输出契约）
- Output Form 独立一级页面
- Run 一级页面
- 班组质量独立页面
- Plan Flow Designer
- Strategy 独立页面
- Tool Contract Version
- Data Asset Contract Version

仍可作为内部技术能力存在，但不升级为当前产品对象：

- Agent Definition / Agent Runtime
- Workflow Runtime
- Prompt Version
- Model Configuration
- Input / Output Schema
- Tool Connection
- Execution Trace
- Calibration
- Interaction Adapter
- Multi-modal Quality
- Appeal / Arbitration

---

# 26. 当前 V1 完成状态

已冻结：

- 产品定位与一级架构
- Evaluation / Discovery 分离
- 坐席质检 V1 业务闭环
- 7 个核心导航页面
- Evaluation Agent 对象、版本与发布机制
- React Flow UI + shadcn Agent Designer 基线
- 通用 Node Model
- Variable Picker + Typed Input / Output
- Structured Outputs
- Sink / Action Node 与 Create Quality Record
- Tool Registry V1
- API Tool / Built-in Tool
- Tool Version / Status / Approval / Permission / Test / Trace
- Data Asset 对象与页面
- Eligibility / Task Scope 分离
- Data Asset Lifecycle / Health / Revision
- Analysis Task
- Run / Snapshot / Backfill / Rerun / Retry
- Quality Result / Evidence
- Human Review
- 质量总览
- 坐席分析
- 两类主数据边界

下一阶段重点：

```text
产品原型
→ Design Spec
→ 技术实现拆分
```

不再回到已冻结对象模型循环讨论，除非原型或技术实现暴露真实冲突。

---

# 27. 总冻结原则

1. **Data Asset 定义什么持续生产数据具备被分析资格，以及字段语义是什么。**
2. **Tool 是 Agent 的一等能力资产；Connection / Credential 是基础设施配置。**
3. **V1 核心执行对象为 Evaluation Agent；底层采用 Agent Definition + Agent Runtime。**
4. **Evaluation Agent = Inputs + Workflow + Tool Version References + Structured Outputs。**
5. **Agent 原生输出统一为 Structured Outputs / Output Schemas。**
6. **Quality / Label / Consumer Request 等是业务消费语义，不是 Agent 原生产品对象。**
7. **Result Rules 与 Agent Workflow 解耦。**
8. **Score 只是 Result Type / Derived Result 的一种。**
9. **Human Review 修正结构化业务结果，不覆盖 AI Raw Output，不直接手改 Derived Score / Risk。**
10. **Analysis Task 直接绑定 Evaluation Agent 与 Data Asset。**
11. **周期 Task 保存 Agent Version Policy；Run 创建时解析并冻结实际 Agent Version。**
12. **Published Agent 锁定具体 Tool Version。**
13. **Run 冻结实际 Agent Version、Tool Versions、Data Asset Revision 与其他影响结果的 Snapshot。**
14. **Quality FAIL 与 Execution Error 严格分离。**
15. **Lifecycle、Runtime Health、Execution Status、Business Result 分离。**
16. **Evidence 必须可解释、可复核、可追溯。**
17. **业务语义主数据与组织人员主数据严格分开。**
18. **Interaction 是首期最小评价对象；坐席 / 班组是聚合分析对象。**
19. **跨记录 Discovery 不塞进单 Interaction Evaluation Agent。**
20. **AI Agent Quality 与 AI Observability 分入口。**
21. **V1 不为“平台感”额外创造无业务意义的中间对象。**
22. **基础 UI 优先复用 shadcn/ui 与 React Flow UI，不重新发明成熟基础交互。**
23. **Agents 当前工程基线为 CORNplus 一方 Agent Builder 与 Runtime；来源代码一次性纳入、不再同步 upstream，不再扩建平行 Workflow Compiler。**
24. **Master 正文只保留当前有效结论；废弃概念只在第 25 章保留名称。**

# 28. Design Spec 基线（最新冻结）

本节只冻结 UI / 交互实现基线，不改变前述产品对象与页面架构。

## 28.1 唯一设计基线

```text
Application UI
→ shadcn/ui

Agent Workflow UI
→ React Flow UI
  + shadcn/ui
```

不再引入 Linear 或其他产品作为视觉基线。

设计原则：

1. 全局产品 UI 优先使用 shadcn/ui 已有组件。
2. Agent Designer 优先使用 React Flow UI 已有 Workflow / Node / Edge / Handle / Runner / Monitoring 能力。
3. React Flow UI 未覆盖的普通 UI，优先使用 shadcn/ui 组合完成。
4. 两者均无成熟能力时，才允许自研交互与组件。
5. 不建设第二套 Design System。
6. 不使用彩色低代码平台风，不以渐变、大面积色块、装饰性卡片制造“高级感”。
7. 颜色只承担状态、风险、执行态等明确语义。

## 28.2 shadcn/ui 负责的通用产品组件

包括但不限于：

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

具体页面优先复用这些组件，不重新绘制同类基础控件。

## 28.3 React Flow UI 负责的 Agent Designer 基础能力

优先复用：

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
Inspector 基础结构
```

Agent Designer 的节点、连线、画布、运行态、节点搜索等基础交互不得另起炉灶。

## 28.4 Design Spec 后续工作顺序

```text
Foundation
→ 通用 App Shell / Page Header / Toolbar
→ 通用 Table / Card / Sheet / Dialog / Status / Empty State
→ 7 个核心页面
→ Agent Designer 专项
→ Detail / Review / Run 等下钻页面
```

后续页面设计必须以本节为最高 UI 基线。

## 28.5 Dashboard / Shell 官方基座（最新冻结）

全平台普通应用 Shell 与质量总览优先直接复用 shadcn 官方现成 Block，不从空白设计。

冻结组合：

```text
Application Shell
→ shadcn sidebar-03

质量总览
→ shadcn dashboard-01

Agent Designer
→ Langflow-derived Agent Builder
```

### sidebar-03

用于承载当前分层导航：

```text
智能质检
└─ 坐席质检
   ├─ 质量总览
   ├─ 质量结果
   └─ 坐席分析

配置管理
├─ 分析任务
├─ Evaluation Agents
├─ Tools
└─ 数据定义
```

采用其“Sidebar with submenus”的成熟结构，不另造一套导航 Shell。

### dashboard-01

质量总览复用其成熟的页面骨架与组件组合：

```text
SectionCards
Chart
DataTable
SiteHeader / Content Container
Responsive Layout
```

只复用结构与基础交互，不照搬 Demo 业务逻辑。

明确删除 / 不采用其 Demo 中与本产品无关的能力：

- Revenue / Visitors 等示例指标
- Documents 示例数据
- Reviewer 分配
- 可拖拽 DataTable
- Demo 内复杂内联编辑

原则：

> **用 dashboard-01 做代码与布局基座，不把官方 Demo 当作最终产品页面。**

## 28.6 Result Rules 解耦（最新冻结）

Result Rules 正式冻结为独立的一等业务配置对象。

它不属于：

```text
Evaluation Agent
Create Quality Record Node
Agent Workflow
Tool
```

职责边界：

```text
Evaluation Agent
= 怎么判断、输出什么结构化事实

Create Quality Record
= 把 Structured Output 持久化为业务 Quality Record

Result Rules
= 基于 Effective Result 计算 Score / Risk / Level / Overall 等 Derived Result
```

最终链路：

```text
Evaluation Agent
      ↓
Structured Outputs
      ↓
Create Quality Record
      ↓
AI Structured Result
      ↓
Human Review（可选）
      ↓
Effective Result
      +
Result Rules
      ↓
Derived Result
```

版本规则：

```text
改 Prompt / Workflow / Tool / Structured Output Schema
→ Agent 新版本

改 Weight / Critical / Risk Mapping / Overall Rule
→ Result Rules 新版本
→ 不要求 Agent 发新版本
```

Run Snapshot 需要冻结当次实际使用的：

```text
Agent Version
Tool Versions
Data Asset Revision
Result Rules Version
```

历史 Run / Derived Result 不因新 Rules 发布而被覆盖。

如果未来使用新 Result Rules 对历史 Effective Result 重新计算：

```text
旧 Effective Result
+ 新 Result Rules Version
→ 新 Derived Result Revision
```

不覆盖旧 Derived Result。

当前仅冻结其独立对象地位与版本语义。

**Result Rules 的具体 UI Home 尚未冻结，需在后续审计决策中单独确定。**

## 28.7 Connections / Credentials（最新冻结）

V1 提供系统级基础配置入口：

```text
Settings
└─ Connections
```

该入口不计入当前已冻结的 7 个核心业务导航页面。

对象关系：

```text
Connection / Credential
        ↓
API Tool
        ↓
Evaluation Agent
```

### Connection 职责

Connection 只负责定义：

```text
Name
Base URL / Endpoint
Authentication Type
Credential / Secret
Required Headers
Connection Status
Test Connection
```

它回答：

> **这个企业外部系统怎么连接、以什么身份连接。**

### API Tool 职责

API Tool 继续负责：

```text
Method
Path
Input Contract
Request Mapping
Output Contract
Response Mapping
Capability
Permission
Requires Approval
Version
Status
```

它回答：

> **连接之后，具体调用哪个企业能力以及 Agent 如何消费该能力。**

因此：

```text
Connection
= endpoint + auth

API Tool
= method + path + contract + governance
```

两者不得合并为一个产品对象，也不得在每个 Tool 中重复维护 Secret。

### Secret 规则

Credential / Secret：

- 仅在创建 / 更新时录入
- 保存后不向普通用户回显明文
- 前端仅显示 masked value / configured state
- 实际 Secret 只在服务端运行时使用
- Agent Definition / Tool Version / Run Snapshot 不复制 Secret 明文

### V1 页面边界

Connections 只做轻量基础配置，不扩展为：

```text
API Gateway
OpenAPI Operation Browser
API Lifecycle Management
Traffic Monitoring
Rate Limit Center
复杂 Secret Center
调用统计
```

### 最终原则

> **Connection 是系统级基础设施资产；Tool 是 Agent 可消费的能力资产。V1 提供 Settings → Connections 以保证 Create API Tool 流程闭环，但 Connections 不扩大为第 8 个核心业务导航。**

## 28.8 Evaluation Agent Input ↔ Data Asset Input Mapping（最新冻结）

Evaluation Agent 与 Data Asset 保持解耦。

对象关系：

```text
Evaluation Agent
→ Input Schema

Data Asset
→ Schema

Analysis Task
→ Input Mapping

Run
→ Input Mapping Snapshot
```

### Agent Input Schema

Evaluation Agent 只声明自己需要什么输入，例如：

```text
interaction_id    String    Required
transcript        String    Required
agent_id          String    Required
start_time        DateTime  Required
phone_number      String    Optional
```

### Data Asset Schema

Data Asset 只声明自己有什么字段，例如：

```text
call_id
asr_text
servicer_id
call_start_time
consumer_phone
```

字段至少包含：

```text
Field Key
Display Name
Type
Description
Required
```

其中 `Field Key` 是稳定执行契约；Display Name 可以调整，但不得替代 Field Key。

### Input Mapping 归属

Input Mapping 属于 `Analysis Task`，因为只有 Task 同时知道：

```text
Which Evaluation Agent
+
Which Data Asset
```

Task 创建时：

```text
Agent Input
interaction_id
transcript
agent_id
start_time
phone_number

        ↓

Data Asset Fields
call_id
asr_text
servicer_id
call_start_time
consumer_phone
```

Mapping 示例：

```text
interaction_id ← call_id
transcript     ← asr_text
agent_id       ← servicer_id
start_time     ← call_start_time
phone_number   ← consumer_phone
```

### 自动匹配规则

优先自动匹配：

```text
1. Exact Field Key Match
2. Compatible Type
```

无法匹配时由用户手工选择。

禁止使用 AI 猜测生产字段映射。

### 校验

创建 / 启用 Task 前：

```text
Required Agent Input
→ 必须全部完成 Mapping

Mapped Field Type
→ 必须与 Agent Input Type 兼容

Optional Input
→ 允许不 Mapping
```

Required Input 缺失或类型不兼容时，禁止创建 / 启用 Task。

### Task Wizard

Step 2 正式调整为：

```text
② 分析数据
├─ Data Asset
├─ Input Mapping
└─ Data Scope
```

先选 Data Asset，再进行 Input Mapping，最后配置 Scope。

Input Mapping 的字段选择交互复用平台已有的 Variable Picker / Field Picker 心智，不另造新控件。

### Run Snapshot

Run 必须冻结：

```text
Agent Version
Data Asset Revision
Input Mapping Snapshot
```

例如：

```text
Run #1001

Agent V7
Data Asset R13

Input Mapping
transcript ← asr_text
agent_id   ← servicer_id
```

如果后续 Data Asset Revision 删除或改变已映射字段：

```text
历史 Run
→ 不受影响

新 Run
→ Compatibility Check 失败
→ BLOCKED
```

并返回确定性错误，不静默传 null。

最终原则：

> **Agent 定义需要什么，Data Asset 定义拥有什么，Analysis Task 负责二者的确定性 Input Mapping，Run 冻结 Mapping Snapshot。**

## 28.9 Interaction 与多次 Evaluation / Re-evaluation（最新冻结）

本节修正此前尚未冻结的“Evaluation Slot / Effective Result 自动切换”设想。

当前正式模型直接采用成熟 QM 产品已验证的基本关系：

```text
Interaction
    │
    ├─ Evaluation 1
    ├─ Evaluation 2
    └─ Re-evaluation
```

即：

> **一通 Interaction 可以存在多条 Evaluation。**

### 质量结果列表的一通一行

当前仍保留：

```text
质量结果列表
→ 一通 Interaction 一行
```

但必须明确：

> **这只是业务聚合视图，不代表底层 Interaction 只能存在一条 Evaluation。**

底层模型必须允许：

```text
Interaction 1 : N Evaluation
```

### Rerun / Re-evaluation

Rerun / Re-evaluation：

```text
→ 产生新的 Evaluation / 评价事实
→ 保留原始 Evaluation
→ 不物理覆盖历史
```

历史 Evaluation 必须可追溯。

### 当前正式删除 / 暂不引入

当前不引入：

```text
Evaluation Slot
Latest AI Result 自动切换机制
Human Result 永久压制后续 AI Result
自动 Current / Effective Revision 切换规则
```

这些不是当前 V1 已确认的成熟产品模式，不进入正式对象模型。

### 尚待下一步冻结

当同一 Interaction 存在多条 Evaluation 时，业务聚合视图需要明确：

```text
Evaluation Selection / Priority Rule
```

用于决定质量结果列表及派生业务结果默认消费哪一条 / 哪一组 Evaluation。

当前仅冻结：

```text
Interaction 1 : N Evaluation
Rerun / Re-evaluation 保留历史
质量结果列表继续一通 Interaction 一行
聚合视图必须拥有明确 Selection / Priority Rule
```

Selection / Priority Rule 的具体规则下一步单独确定。

## 28.10 Evaluation Selection / Priority Rule（最新冻结）

当同一 Interaction 存在多条 Evaluation 时，业务聚合视图采用两阶段确定性选择机制：

```text
Interaction
   ↓
Evaluation Filter
   ↓
Candidate Evaluations
   ↓
Evaluation Priority
   ↓
Selected Evaluation
   ↓
Effective Result
   ↓
Result Rules
   ↓
Derived Result
```

### Evaluation Filter

V1 至少按以下条件限定候选评价：

```text
Evaluation Agent
Evaluation Status
```

默认只允许完成态 Evaluation 进入候选集合。

不同 Evaluation Agent 的结果不得直接互相争抢“最新评价”，必须先按对应 Evaluation Agent / 评价来源过滤。

### Evaluation Priority

V1 仅支持两种成熟优先规则：

```text
Most Recent Completed
最新完成的评价
```

以及：

```text
Initial Completed
首次完成的评价
```

默认值：

```text
Most Recent Completed
```

V1 不支持：

```text
最高分优先
最低风险优先
人工永远优先
AI 永远优先
复杂权重
自定义脚本
```

### Failed / Incomplete Evaluation

未完成或执行失败的 Evaluation 不进入 Completed 候选集合。

例如：

```text
Evaluation 1 = Completed
Evaluation 2 = Error

Priority = Most Recent Completed
→ Selected Evaluation = Evaluation 1
```

### Human Review

Human Review 属于具体 Evaluation，不参与 Evaluation Priority。

关系：

```text
Selected Evaluation
       ↓
AI Result
       ↓
Human Review（可选）
       ↓
Effective Result
```

如果后续产生新的 Completed Evaluation，Selection Rule 可选择新的 Evaluation；旧 Evaluation 及其 Human Review 历史继续保留，不物理覆盖。

### 对质量结果列表的意义

```text
质量结果列表
= Interaction 聚合视图
```

列表默认消费：

```text
Selected Evaluation
→ Effective Result
→ Result Rules
→ Derived Result
```

底层仍保留全部 Evaluation 历史。

### 产品边界

Evaluation Selection / Priority Rule：

- 不新增独立导航
- 不新增独立产品中心
- 不引入 Evaluation Slot
- 具体 UI Home 与 Result Rules 的 UI Home 一并确定

最终原则：

> **一通 Interaction 可以有多次 Evaluation；先 Filter，再 Priority；V1 默认选择最新完成评价，Human Review 属于具体 Evaluation，不参与评价优先级。**

## 28.11 Evaluation Agent Test Run（最新冻结）

Evaluation Agent 的测试在 Agent Designer 内完成，不新增独立测试页面。

### Test Input

Test Run 的输入由当前 Evaluation Agent 的 Input Schema 自动生成。

默认交互：

```text
Agent Designer
      ↓
[Run]
      ↓
Test Run Panel
      ↓
Input Schema Form
      ↓
Start Run
```

例如：

```text
interaction_id    String
transcript        String
agent_id          String
start_time        DateTime
```

Test Run 默认生成 Schema Form。

V1 允许提供：

```text
Advanced JSON Input
```

但 JSON 不是默认交互。

Test Run 不绑定：

```text
Data Asset
Analysis Task
Data Window
```

其测试对象是当前 Agent Draft 的执行契约本身。

### Test Run Side-effect Policy

节点按执行语义分为：

```text
Pure Node
LLM / Condition / Transform / Router
→ 直接执行

READ Tool
→ 直接执行

WRITE / ACTION Tool
→ 遵循 Tool 自身 Requires Approval

Sink / Effect Node
→ Test Run 强制 Approval
```

Sink / Effect Node 包括但不限于：

```text
Create Quality Record
Update Record
Emit Event
Notification
Trigger
```

当 Test Run 运行到需要 Approval 的 Tool / Effect Node 时：

```text
Pause
→ 展示即将执行的输入 / Payload
→ Reject / Approve & Continue
```

Test Runner 不建设 Universal Dry Run、Mock Engine 或独立 Sandbox 产品。

### Runner / Inspect

继续采用 Agent Designer 已冻结的 Runner / Monitoring / Node Status 心智：

```text
Idle
Running
Success
Error
Waiting Approval
```

节点 Inspect 至少允许查看：

```text
Input
Output
Duration
Error
Tool Calls
```

### Publish Check

发布前要求：

```text
当前 Draft
→ 最近一次成功 Test Run
```

不再使用含糊的“最近一次成功 Run”。

如果成功 Test Run 后，当前 Draft 发生会改变执行语义的修改：

```text
Graph
Prompt
Tool Reference / Tool Version
Input Schema
Structured Output Schema
Node Execution Configuration
```

则此前 Test Run 结果失效，发布前必须重新 Test Run。

最终原则：

> **Agent Designer 内完成基于 Input Schema 的 Test Run；测试不绑定生产 Data Asset / Task；副作用通过 Approval Gate 控制；当前 Draft 必须在最新执行语义下有成功 Test Run 才能发布。**

## 28.12 P1 文档一致性清理

本版本仅做已确认结论的一致性清理，不改变产品模型。

已修复：

```text
Master 正文版本标题
Version / Revision History → Sheet
Tool Test → Sheet
Data Asset Validate → Sheet
```

交互容器统一原则：

```text
History / Validate / Test / Backfill / More Filters
→ Sheet

Create Agent / Publish / Delete / Rerun 等确认型动作
→ Dialog
```

本节不新增产品对象。

## 28.13 Result Rules UI Home（最新冻结）

Result Rules 继续保持独立一等业务配置对象，并正式获得独立 UI Home。

导航：

```text
配置管理
├─ 分析任务
├─ Evaluation Agents
├─ Tools
├─ 数据定义
└─ 结果规则
```

路由：

```text
/config/result-rules
/config/result-rules/:ruleSetId
```

对象边界保持不变：

```text
Evaluation Agent
≠
Result Rules

Create Quality Record
≠
Result Rules

Connection
≠
Result Rules
```

其中：

```text
Result Rules
= 质量业务配置资产

Connections
= 系统基础设施配置
```

因此 Connections 继续保留：

```text
Settings
└─ Connections
```

不进入业务配置导航。

### 当前核心业务导航数量

此前“7 个核心业务导航页面”的结论由本节更新为：

```text
智能质检
├─ 质量总览
├─ 质量结果
└─ 坐席分析

配置管理
├─ 分析任务
├─ Evaluation Agents
├─ Tools
├─ 数据定义
└─ 结果规则
```

合计：

```text
8 个核心业务导航页面
```

`Settings / Connections` 仍属于系统级基础配置，不计入上述 8 个业务导航页面。

### 当前冻结范围

本节只冻结：

```text
Result Rules 独立 UI Home
导航归属
Route
```

Result Rules List / Detail / Editor 的具体页面 Design Spec 需单独补齐后再交付 Codex 全量实现。

最终原则：

> **Result Rules 是独立质量业务配置资产，位于“配置管理 → 结果规则”，不嵌入 Agent Workflow，也不放入 Settings。**

## 28.14 Result Rules 页面级 Design Spec 完成

Result Rules 的产品模型不变，本节仅记录页面设计已按既有冻结结论完成。

页面范围：

```text
Result Rules List
Result Rules Detail / Editor
Evaluation Selection
Score / Weight
Overall / Critical
Risk / Level / Derived Labels
Validate
Publish
Version History
```

对应 Design Spec：

```text
AI_Quality_Intelligence_Platform_DESIGN_SPEC_V1.17_RESULT_RULES_PAGE.md
```

未新增：

```text
新的 Result Rules 产品对象
Rule Workflow
Criterion Library
复杂 DSL
独立 Scorecard 产品
```

至此当前 8 个核心业务导航页面均已有页面级 Design Spec。


---

# 29. 当前交付基线

本版本不新增产品结论，仅统一交付基线。

Codex / 原型实现以以下三份文件为唯一当前输入：

```text
Master
→ AI_Quality_Intelligence_Platform_产品架构冻结文档_V1.38_FINAL_BASELINE.md

Design Spec
→ AI_Quality_Intelligence_Platform_DESIGN_SPEC_V1.18_FINAL_BASELINE.md

Implementation Spec
→ AI_Quality_Intelligence_Platform_IMPLEMENTATION_SPEC_V1.3_FINAL_BASELINE.md
```

任何更早版本仅作为历史，不得用于覆盖当前结论。

---

# 30. Agents 一方平台基线（最新确认）

Agents 整体采用：

```text
CORNplus Agent List / Lifecycle
→ CORNplus Agent Builder New / Edit / Run / Inspect
→ CORNplus Agent Flow Definition / Runtime
→ CORNplus Tool / Task / Quality Result Integration
```

当前自研通话质检 Workflow POC 只作为历史技术验证，不再作为 Agents 的编辑器与 Runtime 基线；其数据契约、质检验收场景和业务结果语义可迁移复用，但自研 `WorkflowDefinition → Compiler → LangGraph StateGraph` 链路停止扩建并退出活动产品路由。

Agent Platform 来源基线采用 MIT License。代码一次性纳入 CORNplus 一方仓库，不再同步 upstream；仍必须保留 MIT License、原始版权声明、第三方许可证与来源记录，并对 Secret、默认集成和供应链依赖单独审计。

`Agent` 为 CORNplus 通用产品对象，`Evaluation` 是 Agent 的一种用途。列表、名称、描述、生命周期、版本、发布、权限以及与 Tool、Connection、LLM API、Analysis Task、Run、Quality Result 的关系继续遵循本文冻结语义。Flow 是 Agent Version 的内部技术定义，不升级为新的顶层产品对象。
