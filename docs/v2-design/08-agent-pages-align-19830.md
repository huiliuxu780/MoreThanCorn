# 08 · Agent 工作区现状审计与执行配置设计

> 日期：2026-09-08
> 版本：v2.1
> 状态：设计稿；当前页面已实测，目标改造未实施
> 上位方案：11 号稿 v5.1；后端模型：05 号稿 v2.1
> 参考边界：qoderwake/原站只提供 IA、任务看板和交互参考，不是本项目领域模型或 Runtime 契约

## 0. 结论

当前前端已经实现 Agent 卡片列表、九子页工作区和独立 Chat，不再是旧版“三 tab、无对话”的页面。旧 08 号稿主体已被代码事实推翻。

视觉结构可以保留，但配置语义不能直接沿用。当前页面有三类问题：

1. **状态错误**：Custom 被工作区壳误判为已封存，只读子页与可编辑 Config 同时出现；
2. **幽灵配置**：Module 可安装 Skill，Connection、Workflow、Knowledge 可保存，但 Runtime/Release 不消费；
3. **执行缺页**：没有 Pipeline、Planning、内部角色、stage scope、选择性重做、状态恢复和完整发布闭包。

目标不是再增加几个下拉框，而是让页面只展示后端模型与 Runtime 真正支持的操作。

## 1. 视觉实测

实测地址：当前本地运行前端的 Agent 页面。证据保存于：

- research/morethancorn/09-agentscope-plan-audit/screenshots/01-agent-list.png
- research/morethancorn/09-agentscope-plan-audit/screenshots/02-custom-home.png
- research/morethancorn/09-agentscope-plan-audit/screenshots/03-custom-config.png
- research/morethancorn/09-agentscope-plan-audit/screenshots/04-custom-skills.png
- research/morethancorn/09-agentscope-plan-audit/screenshots/05-module-skills.png
- research/morethancorn/09-agentscope-plan-audit/screenshots/06-module-config.png

已确认：

- 列表同时有 Custom 和 Module 卡片，并提供对话动作；
- Custom 详情顶栏显示“已封存·只读”，但 Config 有保存按钮；
- Custom Skill 页因只读无安装按钮；
- Module Skill 页有上传/安装按钮，但后端发布和 Runtime 不消费；
- Module Config 仍显示 Provider 实现包含已退役的 deepseek-harness；
- Module 核心资源只读，实例可编辑身份、展示能力、模型和业务定位；
- Chat 是独立二栏工作区，但只渲染文本增量。

视觉证据位于 research/morethancorn/09-agentscope-plan-audit/screenshots/：

- 01-agent-list.png
- 02-custom-home.png
- 03-custom-config.png
- 04-custom-skills.png
- 05-module-skills.png
- 06-module-config.png

## 2. 当前页面、状态与 API

| 页面 | 表单/本地状态 | API | 当前真实结果 |
|---|---|---|---|
| Agent 列表 | search、status、type、sort、pagination | GET /api/agents；GET /api/agents/modules | search/pagination 服务端；type/sort 只作用当前页；type 下拉无 Custom |
| 新建内置方案 | module、name、description、avatar、model | POST /api/agents | 创建 Module 实例 |
| 新建 Custom | name、description、avatar、prompt、skill IDs、model | POST /api/agents | Skill IDs 只进 config.skills；不进 AgentSkill |
| 概览 | Agent、run stats、能力、记忆摘要 | Agent/capability APIs | 展示为主 |
| 任务看板 | 最近 Run、Run detail | GET /api/agents/{id}/runs | 平面 Run/Event，无 stage/unit |
| 记忆 | content、revision、timeline | GET/PUT /memory | Chat 本地 prompt 消费；Module Runtime 不消费 |
| Skill | market/mine、upload dialog | resource API；AgentSkill API | Custom 被只读；Module 可安装但运行不生效 |
| 连接器 | market/installed、mounted IDs | 全量 PUT Agent config | 只写 config.connections |
| Wakerflow | option、mounted IDs | Workflow list；全量 PUT config | 只写 config.workflows；Agent 无法真正枚举/调用 Workflow |
| Workflow 设计器 Agent 节点 | 旧 agent/agent-select/agent-exec | 节点注册表与迁移器 | 已 deprecated，并被改写为 workflow 节点；不是新版 AgentVersion 子运行 |
| 知识库 | option、mounted IDs | Knowledge list；全量 PUT config | 只写 config.knowledges |
| Custom Config | prompt、capabilities、skills、model、revision | 全量 PUT Agent config | 人设可影响本地 Chat；Skill 仍走错误路径 |
| Module Config | identity、caps、model、purpose、sample、provider | PUT Agent；versions/releases/run | purpose 写入 config.spec.purpose，但 Module 编译读取顶层 purpose；该字段实际不生效 |
| 发布治理 | provider select、Golden limit、versions、eval | versions/releases/eval APIs | Module 部分成立；多 Provider 评测与单 Provider Release 文案混杂 |
| Chat | sessions、messages、draft、attachments、model | sessions/messages/turns/uploads；Run SSE | 本地模型旁路；附件只传名称；只展示 llm_delta |

## 3. 页面级纠错

### 3.1 列表

“运行时”筛选当前实际筛的是 Agent.type，不是 Runtime Provider，也不是执行形态。目标拆为：

- 方案：内置、派生、自定义；
- 执行：单 Agent、Pipeline；
- 能力：Chat、Planning、Batch、HITL；
- Runtime：AgentScope；
- 生命周期：草稿、沙箱、生产、已封存。

筛选和排序必须进 GET /api/agents 查询参数，total 返回过滤后的总数。动作由 capability 决定：supports_chat 才显示对话，supports_structured_run 才显示运行。

### 3.2 生命周期

archived 只等于真实归档状态，不能用 agent.type != module 推导。Custom 和 Module 都可以有 draft/published/released/archived 生命周期。

只读原因要明确显示：

- archived；
- core asset；
- permission denied；
- viewing released version；
- resource unavailable。

不要把这些都叫“已封存”。

### 3.3 新建

首屏保留两条路径：

1. 选择内置方案：质检、审计、工单核验等；
2. 自定义 Agent。

内置方案卡展示：

- runner 类型；
- 是否支持 Chat/Batch/HITL；
- 核心 Pipeline 阶段摘要；
- Core 资源数；
- 可扩展 Skill/Tool/Knowledge 槽；
- 风险级；
- 当前模板版本。

Custom 创建首期默认 runner=agent。用户可开启 Planning；不要在创建对话框内一次塞完 Pipeline 设计。创建后进入工作区的“执行”页完善。

Skill 选择必须创建 MountBinding 草稿，不能再写 config.skills。

## 4. 目标工作区 IA

栏目不再全量固定，而按 Agent capabilities 和 runner 渲染：

| 栏目 | 显示条件 | 职责 |
|---|---|---|
| 概览 | 全部 | 身份、执行形态、版本、环境、健康、最近工作 |
| 工作 | supports_run | Run/TaskRun、stage/unit attempt、等待项 |
| 对话 | supports_chat | Session 与 turn Run |
| 执行 | supports_run | Pipeline/Planning/单 Agent 配置 |
| 能力 | 有可扩展 slot | Skill、Tool、Knowledge、Workflow mounts |
| 记忆 | memory policy 可用 | 长期记忆；不混 AgentState/PipelineState |
| 评测 | 可版本化 | 样本、Golden Set、回归、Provider 对比 |
| 发布 | 可发布 | 版本、依赖闭包、Release、回滚、审计 |
| 设置 | 全部 | 身份、标签、归档 |

连接器不再作为 Agent 的通用安装页面。它是 Tool、MCP、Knowledge、Model Provider 的依赖；只有明确的 connection slot 才显示。

原“Wakerflow”改名“流程/编排”。平台 WorkflowVersion 与 AgentScope Pipeline 是不同概念：

- Workflow 是平台可视化流程资产；Agent 可将授权 WorkflowVersion 作为工具调用，Workflow 也可通过通用 agent-run 节点调用 AgentVersion；
- Pipeline 是 AgentVersion 内的 Runtime 执行拓扑；
- 参考产品的 WakerFlow 只是交互参考，不进入本项目数据模型。

“流程/编排”页要分两个关系区：

- 本 Agent 可调用：来源于 Workflow MountBinding，显示固定版本、工具名、scope、同步/异步和权限；
- 谁在调用本 Agent：只读反向引用，显示 WorkflowVersion、agent-run 节点和版本策略。

不能只显示一个“已安装”标签，也不能把双向引用合成无方向的关联。

## 5. 执行页

### 5.1 顶部摘要

显示：

- runner：单 Agent 或由 ModuleVersion 声明固定的 Pipeline；
- Planning：开/关，以及在哪些 role 中开启；
- Core template/version；
- Draft revision；
- 最近发布 AgentVersion；
- Runtime Provider 只在 Release 区显示，不作为 runner 类型；
- 变更影响：是否需要重新评测、重新发布。

### 5.2 Pipeline 模式

核心拓扑来自当前 ModuleVersion 的声明式 PipelineDefinition，实例中只读展示。首个质检模板示例为：

1. classify；
2. dispatch；
3. execute units；
4. unit verify；
5. barrier；
6. synthesize；
7. final verify。

每个 stage 卡片展示：

- stage_key、role；
- 输入/输出 Schema；
- Core mounts；
- Extension slots；
- Tool permission；
- Planning 开关；
- timeout、retry、parallelism；
- 失败去向。

可编辑内容只在 extension slot：

- 添加或替换允许的 Skill、Tool、Knowledge；
- 配置业务定位和非核心参数；
- 在模板允许范围内收紧权限/预算；
- 不能删除 Core verifier、barrier、Schema 或必需工具。

选择性重做配置不是自由流程编辑器。内置质检方案展示只读策略：

- unit retry max；
- retryable error classes；
- verifier feedback mapping；
- final verifier failedUnitIds；
- exhausted unit 的 barrier policy。

修改 Core 按钮应写“派生新方案”，而不是“解锁编辑”。

这里的“只读”不是说所有方案都写死成七个阶段。不同 ModuleVersion 可声明不同 stages/edges/roles；通用 Runtime 只固定版本、权限、预算、checkpoint、幂等、环检测和终态等治理不变量。

### 5.3 Planning 模式

显示：

- planning enabled；
- max tasks/depth/iterations；
- 是否允许动态新增 task；
- 可用 Tool/Skill/Knowledge；
- 副作用工具确认策略；
- 计划是否对用户可见；
- Run 结束时的计划快照策略。

这里配置的是 AgentScope 一次执行内的 TaskContext，不是平台自动任务。

### 5.4 混合模式

Pipeline stage 可单独启用 Planning。UI 在对应 role card 内显示 Planning 配置，不能把整个方案强制标成“Pipeline 或 Planning 二选一”。

### 5.5 身份与工作手册

配置页不照搬三个文件编辑器，但要把 PromptBundle 的来源说清：

- Identity：身份、职责和边界；
- Playbook：方案级工作手册，对应 BIBLE 的价值；
- Persona：交互语气、格式和风格；
- Skill：可复用专项方法，不重复塞入 Playbook；
- Hard policy：只读展示，真正由权限/控制器强制，不允许用 Prompt 冒充。

发布预览展示最终编译顺序、token 估算、来源和 hash，避免用户不知道哪段覆盖哪段。

## 6. 能力页与 Mount 表单

能力页按资源类型分 tab，但底层使用同一 MountBinding。

每一行必须展示：

- 名称与资源类型；
- pinned version 或“草稿未冻结”；
- scope：全局、stage、role；
- scope key；
- slot；
- Core/Extension；
- 状态与最近检查；
- 是否已包含在最近发布版本；
- 权限/数据级变化提示。

新增挂载流程：

1. 选择资源；
2. 选择允许的 slot；
3. 选择 scope；
4. 选择版本策略；草稿可以 latest，生产必须 pinned；
5. 预览权限、依赖与发布影响；
6. 保存 MountBinding；
7. 页面重新读取服务端返回的草稿，不直接修改 agent.config 对象。

当资源类型是 Workflow 时额外配置：调用工具名、同步/异步、输入/输出映射、子 Run 预算。资源选择器只显示当前用户、环境和 slot 有权调用的 WorkflowVersion。

阻断规则：

- 没有版本的 Tool/Workflow 不能发布；
- Skill/Knowledge 没有可快照内容不能发布；
- Core 不可卸载；
- Extension 不能扩权超过 slot；
- Module/Custom 使用同一表单和 API；
- Runtime 尚未支持的资源不显示“安装”动作。

## 7. 工作看板与 Run 详情

### 7.1 层级

    TaskRun（可选，批量外层）
      └─ Run（一次输入，一条执行事实）
           ├─ Stage
           │    └─ Unit
           │         └─ Attempt 1..N
           ├─ Tool/Model/Knowledge calls
           ├─ ChildInvocation
           │    └─ WorkflowVersion / AgentVersion 子 Run
           └─ Events

NodeRun 继续服务平台 Workflow 图节点。AgentScope Pipeline stage 不强行伪装成 NodeRun；新增专用 PipelineState/StageAttempt/UnitAttempt 投影或使用结构化事件+状态快照。

### 7.2 看板状态

至少区分：

- queued；
- running；
- waiting input/confirmation/external result；
- paused；
- succeeded；
- partial；
- failed；
- cancelled。

Pipeline 卡片要显示：当前 stage、完成 units/总 units、正在重做的 unit、剩余预算、等待原因。不能只给一个 running 圆点。

Run 详情另提供 InvocationGraph：父子 Run、调用方向、目标固定版本、耗时/预算、失败传播和被阻断的递归环。不能只把子调用埋在 Tool call 文本中。

### 7.3 选择性重做可视化

用户应看到：

- 哪个 unit 失败；
- verifier 的结构化原因；
- 是否 retryable；
- 当前是第几个 attempt；
- 兄弟 units 是否复用已冻结结果；
- final verifier 要求重开的 unit IDs；
- 是否因 exhausted 导致 barrier blocked。

首期重做由策略自动触发；手工“重做此 unit”是否开放另行拍板，不在本稿默认加入。

## 8. Chat 工作区

保留左 Session、右消息和 composer 的现有布局，但语义改为 AgentScope Runtime Chat：

- 一个 Session 保存 N 个 turn；
- 每个 assistant turn 绑定一个 Run；
- AgentScope AgentState 持久化并可跨进程恢复；
- 消息块支持 text、thinking、data、tool call/result、hint；
- task.updated 驱动计划面板；
- Pipeline 事件若由 Chat 发起，显示 stage/unit 状态；
- 附件必须解析内容或构造 AgentScope 支持的多模态 source，不能只传文件名；
- Skill 必须装配正文/loader；
- 工具调用经平台 Gateway；
- Workflow 工具只列出当前 AgentVersion 已授权并冻结的 Workflow mounts；
- 用户确认和 external execution result 走 continuation。

模型选择要明确作用域：

- 草稿 Chat：可临时选模型，标记不进入 Release；
- 发布环境 Chat：默认使用 Release 冻结的模型；临时 override 是否允许需权限；
- 不能让页面选择任意模型而破坏已发布版本可重放性。

## 9. 发布与评测

发布页在创建版本前展示依赖闭包：

- Core template/version；
- runner/Pipeline controller；
- RoleVersions；
- mounts 与 pinned versions；
- model/schema/policy；
- AgentScope/runtime contract version；
- 未冻结、disabled、missing、越权项目。

版本对比不能只 diff definition，还要覆盖 common config、roles、mounts、policies 和 dependency snapshot。

Golden Set 可以选择多个 Provider 做对比，但文案必须说明：这是评测，不是让同一个 active Release 同时绑定多个 Provider。Release 操作遵守后端约束。

## 10. 保存状态与并发

所有编辑页共享一个服务端 draft revision：

- 首次加载得到 revision；
- 修改产生 dirty section；
- PATCH 携带 expectedRevision；
- 冲突时展示服务端变更区和本地变更区，不静默覆盖；
- 成功后用服务端返回草稿刷新；
- 切页时 dirty 状态需要确认；
- 发布成功后仍保留可继续编辑的草稿，但页面明确最近发布版本。

禁止继续复制初始 agent.config 后整包 PUT；这会让另一个子页刚保存的字段消失。

## 11. 前端 API 映射

| UI 动作 | 目标 API |
|---|---|
| 加载工作区 | GET /api/agents/{id}/draft |
| 改身份 | PATCH /api/agents/{id}/draft/identity |
| 改对话 | PATCH /api/agents/{id}/draft/conversation |
| 改执行 | PATCH /api/agents/{id}/draft/execution |
| 改内部角色 | PATCH /api/agents/{id}/draft/roles/{roleKey} |
| 查询挂载 | GET /api/agents/{id}/mounts |
| 安装/绑定 | POST /api/agents/{id}/mounts |
| 改 scope/版本/启停 | PATCH /api/agents/{id}/mounts/{mountId} |
| 卸载 | DELETE /api/agents/{id}/mounts/{mountId} |
| 校验草稿 | POST /api/agents/{id}/draft/validate |
| 预览发布闭包 | GET /api/agents/{id}/draft/dependency-closure |
| 创建版本 | POST /api/agents/{id}/versions |
| 发布 | POST /api/agents/{id}/releases |
| 运行 | POST /api/agents/{id}/runs |
| 恢复/确认 | POST /api/runs/{runId}/continuations |
| Pipeline 状态 | GET /api/runs/{runId}/pipeline-state |
| 子运行关系图 | GET /api/runs/{runId}/invocation-graph |
| Chat Session | 继续使用 /api/agents/{id}/chat/sessions |
| Chat turn | 继续使用产品端点，服务端内部改走 Runtime Chat |

这些是目标 API，不代表当前已实现。

## 12. 逐页验收

### 列表

- 服务端支持 lifecycle、template、runner、planning、supports_chat、provider 筛选；
- sort 与 pagination 作用于完整集合；
- Custom 不再遗漏；
- “运行时”只指 Runtime Provider，不能过滤 Agent type；
- card 动作由 capability 决定。

### 新建

- 内置方案卡显示 Core 与扩展边界；
- Custom 创建后可发布和运行；
- Skill 选择产生 MountBinding；
- 不允许创建只有 UI 配置、没有编译路径的 Agent。

### 工作区

- Custom 不再被误标归档；
- 不支持的栏目隐藏或显示明确“尚未接通”，不提供成功保存按钮；
- Execution 页可区分 Pipeline、Planning 与混合模式；
- Module Core 只读，extension slot 可编辑；
- 所有保存经过 revision。

### 能力

- 同一 Skill 在创建页、能力页、版本闭包和 Runtime 中 ID 一致；
- stage scope 可验证；
- 修改资源不影响旧版本；
- Core 不能卸载；
- Connection 不作为普通能力自由挂载。
- Workflow mount 能显示版本、调用方向、输入输出映射和子 Run 预算；未授权 Workflow 不可枚举；
- Workflow 的 agent-run 反向引用可追到固定 AgentVersion。

### Chat

- Skill 正文可导致可观察行为变化；
- 附件内容而非文件名可被回答；
- tool/thinking/task events 可见；
- 每 turn 有 Run；
- 重启后 Session 上下文恢复；
- 发布环境不被任意模型 override。

### Pipeline

- 能看拓扑、unit、attempt、verifier feedback；
- 故意让一个 unit 失败，只重做它；
- 兄弟 unit 的调用次数不变；
- waiting/resume 与 checkpoint 可见；
- final verdict 有结构化原因。

### 发布

- 未版本化 Skill/Knowledge 阻断；
- dependency closure 可审阅；
- diff 包含 roles/mounts/policies；
- Provider 评测与 Release 绑定文案不混淆；
- 回滚恢复完整旧行为。

### 双向编排

- Agent 在 Chat 或无状态 Run 中调用 WorkflowVersion，产生可追踪子 Run；
- Workflow 的 agent-run 节点调用 AgentVersion，不再退化为底层 workflow；
- Agent→Workflow→Agent 的版本环在外部副作用前被阻断；
- 子调用继承 trace、取消和权限上限，但不自动创建 Chat Session；
- 草稿 latest 预览与生产 pinned 状态在页面上明显区分。

## 13. 实施顺序

1. 不先画新表单；先完成 05 号稿目标模型和 Runtime Contract v1.2；
2. 用只读数据适配器让现有页面展示真实 capability 与挂载状态；
3. 建统一 draft/mount API；
4. 修 lifecycle/type 分离和列表服务端筛选；
5. 新增 Execution 页；
6. 改能力页为 MountBinding；
7. 改 Run 看板为 Pipeline 层级；
8. 最后切 Chat Runtime 与完整事件渲染；
9. 删除旧 config 写路径前做调用扫描和数据迁移。

## 14. 明确不照搬

- 不照搬 qoderwake 的领域命名、后端实体和运行契约；
- 不把参考产品的 Wakerflow 当成 AgentScope Pipeline；
- 不因为参考产品有对话就让所有自动任务创建 Session；
- 不用在线状态模拟非驻留 Agent；
- 不把内部角色全部做成员工卡；
- 不把无法生效的资源按钮保留为“先做 UI”；
- 不用颜色或“已安装”文案代替版本、作用域和依赖闭包事实。
