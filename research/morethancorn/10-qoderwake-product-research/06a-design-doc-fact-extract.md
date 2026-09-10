# 06a · 设计稿段落级事实抽取底稿（供 06 冲突矩阵使用）

> 日期：2026-09-08 · 性质：只读事实抽取，不含修订建议与结论评价（评价属后续 06 矩阵）
> 输入：docs/v2-design/ 下六份设计稿，全部存在、逐份通读（无缺失文件）
> 对照：research/morethancorn/10-qoderwake-product-research/01-qoderwake-product-observation.md（下称 01）
> 摘句规则：每条 ≤80 字，"…"表示中间省略；表格四列 | 文档 | 章节 | 原文摘句 | 主题标签 |
> 主题标签：T1 PipelineDefinition 内嵌/AgentFlow 一等表述 · T2 Agent/Module/Version/Release 模型与冻结字段 · T3 Trigger target union 成员 · T4 任务语义命名与分层 · T5 Run/Session/ChildInvocation/Event/Outbox 执行事实 · T6 AgentScope 版本表述 · T7 飞书/IM 范围 · T8 固定治理骨架 vs 固定业务 Agent 边界 · T9 mock/fixture/POC 被表述为产品能力 · T10 D01–D22 决策清单 · T11 工作空间/Workspace/Project · T12 安全边界（Bash/Write/Hook/嵌套/预算/CoT 展示）

全局检索事实（供矩阵直接引用）：
- 术语 "AgentFlow" 在六份文档中 **0 次出现**；最接近表述是 11 §9 的执行语义关键字 "flow：平台 WorkflowVersion 执行" 与各稿的 "WorkflowVersion"。
- "Bash"、"Hook"、"allowlist"、"工作空间隔离"（文件系统义）在六份文档中 **0 次出现**。
- "飞书" 仅 1 次（03 §1，调研口径引用）；"IM" 作为渠道概念 0 次。
- "工作空间/工作区" 在三处语义不同：08/11 指 Agent 管理 UI 工作区；HANDOFF §1 指 git 工作区（dirty path）；11 §3.1 的 Workspace 指 AgentScope App 组件名。无任何一稿定义文件系统/Project 型工作空间。

---

## 一、03-trigger-and-data-mapping.md

### 1. 文档定位

日期 2026-09-04，状态"设计稿，未动代码"。回答"问题 3"：是否引入在 Task 中绑定、触发产生 Run 的 Trigger，及三方数据格式/字段/定义转换映射；文内拍板为"引入 Trigger，绑定到 Task，触发产生 TaskRun（批次）"，且升级为"一等实体"。约束来源自述：SDD-13 §3（TaskRun 四源模型）、§17/§18、fire_key 幂等（INV-11）、生产触发闸门；02 审计 B14/B7。11 号稿 §9 与 12 号稿头部均确认本稿为"Trigger 与数据映射权威设计""入口权威"，且 12 号稿 §2.2 明确本稿全部能力"仍是设计，不得在界面和排期中写成现成"。本稿不含任何版本号（无 v 字段），是六档中唯一未随 09-08 回炉修订标版的文档。

### 2. 章节骨架（至二级标题）

- # 03 · Trigger 与数据接入设计（判断：引入）
- ## 1. 判断：引入，且应升级为一等实体
- ## 2. 概念模型
- ## 3. 三种新触发类型的行为规格
- ## 4. 过滤条件（"逻辑判断"）
- ## 5. 三方数据的格式/字段/定义转换
- ## 6. 观测与运维（事件级可查，对齐成熟产品）
- ## 7. 数据模型增量（摘要）
- ## 8. 实施依赖与顺序（建议）
- ## 9. 明确不做（边界）

### 3. 段落事实

| 文档 | 章节 | 原文摘句 | 主题标签 |
|---|---|---|---|
| 03 | §1 | "结论：引入 Trigger，绑定到 Task，触发产生 TaskRun（批次）" | T4 |
| 03 | §2 | "Trigger（新增一等实体，绑定 Task，1 个 Task 可挂多个 Trigger）" | T3 |
| 03 | §2 | "type: schedule（收编现有 Schedule）\| webhook \| mq \| api" | T3 |
| 03 | §2 | "TriggerEvent（新增：事件流水，不可变）…判定结果: accepted / rejected(filter) / rejected(mapping) / deduped / failed" | T5 |
| 03 | §2 | "既有链路：TaskRun(批次) → N × Run → ResultDelivery（完全复用，不新建）" | T5 |
| 03 | §2 | "Trigger 产生的批次 `trigger` 词表值用 `api`（填上空洞值），事件来源细节放 `trigger_ref`" | T3/T5 |
| 03 | §2 | "Schedule 收编为 Trigger 的一种类型，现有 Schedule+ScheduleOccurrence 机制原样保留（48h 物化、missed 判定…）" | T3/T4 |
| 03 | §2 | "生产触发闸门自动生效：webhook/mq/api 触发 trigger != "manual"，Task 必须已配置 target_table 输出才放行" | T12 |
| 03 | §3 | "MQ 就是一个 Connection（kind=mq，新增）…触发器只引用 connection_id + topic/consumer group 配置" | T3 |
| 03 | §3 | "Webhook 方向相反，不是 Connection…只有两样——我方接收地址（系统生成、只读展示+复制）与验签密钥" | T3/T12 |
| 03 | §3.1 | "鉴权（三选一，创建时生成）：HMAC 签名头（推荐…）；Bearer 令牌…；mTLS/IP 白名单（后续，先不做）" | T12 |
| 03 | §3.1 | "密钥走既有 KMS/secret_ref 体系，永不进快照/日志正文（全局约束）" | T12 |
| 03 | §3.1 | "只有鉴权失败与载荷超限（默认 1MB）返回 4xx…坏消息进事件流水的 failed，走死信查看而不是拒收" | T5/T12 |
| 03 | §3.4 | "每个 Trigger 端点独立速率限制（默认 10 req/s，可配），超限 429" | T12 |
| 03 | §3.4 | "TriggerEvent 原始载荷默认保留 30 天（可配 7/30/90），到期物理删除——原始载荷可能含三方 PII" | T12 |
| 03 | §3.4 | "事件载荷不进 TaskRun/Run 快照与 Trace（Secret/PII 全局约束同源）" | T12 |
| 03 | §3.2 | "先落事件再 ack…at-least-once 语义，与 SDD-13 §7.3 对外投递语义同口径" | T5 |
| 03 | §3.3 | "SDD-13 已有 /api/runs 工作流级触发，但那是 trigger=test 的测试通道，不进批次链路" | T9 |
| 03 | §1 依据4 | "Coze（扣子）：定时触发 + Webhook 触发 + 平台事件触发…早期调研（06-SDD 附录 C.4 飞书口径）已记录" | T7 |
| 03 | §4 | "首期不引入自然语言条件（Coze 的 AI 筛选规则）…违背"确定性派生"的平台原则；留作 Future" | T8 |
| 03 | §5.1 | "在此基础上新增（全部保持"受限"，不开放脚本/SQL/eval——与输出侧同等安全边界）" | T12 |
| 03 | §5.3 | "Trigger 必须绑定一个 DataDefinition 版本（正如 Task 绑定定义版本）" | T2 |
| 03 | §7 | "trigger 表：id, task_id(真 FK), type, status, config(JSONB…), secret_ref" | T3/T5 |
| 03 | §7 | "TaskRun.trigger_ref 现列扩展语义：存 trigger:{id}:{eventRange}（不改词表，填 api 值）" | T5 |
| 03 | §9 | "不做跨平台事件编排（多 Trigger 依赖链、事件驱动工作流互调）——V2 之后评估" | T3 |
| 03 | §9 | "不引入 Redis/Kafka 作为平台自身基建依赖（仅作为对接的外部系统；平台内部队列维持 PG）" | T12 |

注：本稿不含 T1（PipelineDefinition/AgentFlow）、T6（AgentScope 版本）、T10、T11 表述；Trigger 的绑定对象只有 Task，未出现 target union（workflow/agent）字样。

### 4. 本档未覆盖但 01 已证明存在的产品事实（候选）

1. 自动任务 API 触发鉴权 = `atk_` token 内嵌调用地址（01 QW-07）——03 设计 HMAC/Bearer/mTLS 三选，未记录目标产品实际形态。
2. 目标产品触发方式表单仅"定时|API"两卡；副标题称"事件"触发但表单层无入口（01 QW-06 差异记录）——03 假设 webhook/mq 为一等类型。
3. 自动任务 = Trigger+target+prompt+workspace+policy 五元组定义、运行历史另表；表单/详情均无任何批量字段（01 QW-06/07）——03 把 batching 设计为 Trigger 属性。
4. "一个 WakerFlow 只有一份自动运行配置，可添加多个触发方式"，上限 1/5（01 QW-15）——03 为"1 个 Task 可挂多个 Trigger"，无单份配置约束表述。
5. 手动运行 = 调试语义："不更新最近触发/不计入累计自动运行/不更新最近结果"（01 QW-07 tooltip）。
6. 任务看板 = 对话 session、flow run、automation run 三类执行事实混排的统一投影，行粒度 = run/session 级（01 QW-02）。
7. @Waker 一级入口 = IM 渠道管理页（聊天/IM 连接/工作目录/模型/启用）（01 QW-03）——IM 未入 03 范围。
8. 工作空间文件系统路径约定与 `_output/`、present_files 产物交付契约（01 跨域事实 3）。
9. CoT 外露、Bash/Write 默认开放（01 跨域事实 1/2）。
10. Credits 用量面板；模型 Auto 选择器与 Qwen 错峰折扣文案（01 跨域事实 4/6）。

---

## 二、05-agent-management-redesign.md

### 1. 文档定位

日期 2026-09-08，版本 v2.1（双向子运行与 PromptBundle 补充版），状态"设计稿；未实施"，上位方案 11 号稿 v5.1。自述"本稿取代旧版'Agent 只做批量分析、没有对话'的前提，也取代'Skill 等于工具包'的定义。前端 IA 见 08 号稿"。HANDOFF §2 确认其为"Agent/Module/Version/Release、PromptBundle、MountBinding、ChildInvocation、API 与迁移"的权威模型（阅读顺序第 3）。全文不提 qoderwake；含 M0–M4 迁移分期与 15 条验收、9 条"不做"。

### 2. 章节骨架（至二级标题）

- # 05 · Agent 管理、版本与发布模型
- ## 0. 结论
- ## 1. 当前模型的事实与缺口
- ## 2. 目标领域模型
- ## 3. 资源版本规则
- ## 4. AgentVersion 与 Release
- ## 5. Run、Session 与 Task
- ## 6. API 设计
- ## 7. 编译链
- ## 8. 迁移
- ## 9. 验收
- ## 10. 不做

### 3. 段落事实

| 文档 | 章节 | 原文摘句 | 主题标签 |
|---|---|---|---|
| 05 | §0 | "Agent 是用户可见的完整能力方案根资产，不是某个 Runtime 类，也不是一段 manifest" | T2 |
| 05 | §0 | "Module 是内置方案模板及受代码评审的核心实现来源。Agent 是某个 Module 的实例或从零创建的自定义方案" | T2 |
| 05 | §0 | "AgentVersion 冻结完整可执行闭包，Release 把该版本部署到环境并绑定 Runtime" | T2 |
| 05 | §1.1 | "当前 Agent 表有 id、name、description、avatar、status、archived、type、module_key/version、workflow_id、config JSON、config_revision、沙箱/生产版本指针" | T2 |
| 05 | §1.1 | "config.workflows 没有 Runtime 消费路径；Workflow 旧 agent 节点又已 deprecated 并被迁移为 workflow 节点，双向组合目前均未闭环" | T9 |
| 05 | §1.1 | "archived 与 type 被前端错误合并，导致 Custom 显示"已封存·只读"" | T9 |
| 05 | §1.2 | "已有 definition、common_config、dependency_snapshot、artifact_hash，是正确骨架；但闭包不完整" | T2 |
| 05 | §1.3 | "已有 environment、runtime_provider_id、runtime_profile、runtime_binding_snapshot、canary_percent" | T2 |
| 05 | §1.3 | "继续保留"Provider 属于 Release，不属于 AgentSpec"的边界" | T2 |
| 05 | §2.1 | "runner 与 planning 正交。不要再用 type=autonomous/dialogue/expert-group/custom/module 推导实际执行能力" | T2 |
| 05 | §2.2 | "ModuleVersion：不可变 Core，包括声明式 PipelineDefinition、角色、核心 mounts、Schema 和治理策略；具体阶段、角色和 SOP 不写死在通用控制器" | T1/T8 |
| 05 | §2.2 | "manifest 首期可继续作为受代码评审的来源，但导入后必须能形成同一版本快照，不能长期与数据库双主" | T2 |
| 05 | §2.3 | "dispatcher、executor、unit verifier、synthesizer、final verifier 默认是 AgentVersion 内的 RoleVersion，不是顶层 Agent 行" | T2 |
| 05 | §2.4 | "version_policy：草稿 latest 或 pinned；pinned_version_id：发布时必填或解析；scope：global、stage、role" | T2 |
| 05 | §2.4 | "Connection 不是自由挂载能力；它由 Tool、MCP、Knowledge、Model Provider 间接引用" | T2/T12 |
| 05 | §2.4 | "Workflow mount 表示 Agent/role 被授权调用某个 WorkflowVersion…它不是把 Workflow 定义复制进 Agent，也不是 AgentScope Pipeline 的 stage 定义" | T1 |
| 05 | §3 | "发布时禁止 latest 漂移；草稿预览可以 latest，但 UI 必须标注"未冻结"" | T2 |
| 05 | §4.1 | "AgentVersion 必须是完整、可校验、可重放的方案：AgentDefinition；ModuleVersion/Core；ExecutionSpec；PromptBundle 内容、来源顺序与 hash；Pipeline controller/version/state schema" | T1/T2 |
| 05 | §4.1 | "Runtime Contract 版本；AgentScope 精确 package/commit；artifact hash"（冻结清单末尾三项） | T2/T6 |
| 05 | §4.1 | "只要存在未解析 latest、缺失版本、disabled 依赖、无效 stage/slot 或越权 extension，创建版本就失败" | T2/T12 |
| 05 | §4.2 | "Release 只做部署期决策：AgentVersion；environment；Runtime Provider；runtime profile；Connection 环境引用；canary" | T2 |
| 05 | §4.2 | "回滚等于重新激活完整旧 AgentVersion 的依赖闭包。若 Skill/Knowledge 在旧版本中没有内容快照，不能声称支持完整回滚" | T2 |
| 05 | §5 | "Run：一次执行事实；Chat 每 turn 也是 Run"；"Task：重复运行某个 AgentVersion/WorkflowVersion 的业务定义"；"TaskRun：Task 的一次批次，包含 N 个 Run"；"Trigger：为 Task 产生 TaskRun" | T4/T5 |
| 05 | §5 | "无状态单次输入输出只创建 Run。自动任务可增加 batching，因此"批量分析"和"自动任务"共享 Task/Trigger/TaskRun，不建立两套内核" | T4 |
| 05 | §5.1 | "两个方向使用同一种 ChildInvocation 事实：Agent → Workflow…Workflow → Agent：agent-run 节点发起目标 AgentVersion 子 Run" | T5 |
| 05 | §5.1 | "ChildInvocation 记录 parent_run_id、child_run_id、target_type/version_id、mount/node 来源、mode、idempotency_key、budget 和状态" | T5 |
| 05 | §5.1 | "根 Run 投影 InvocationGraph，在活动祖先链上跨 Agent/Workflow 做环检测…不能把合法的重复兄弟调用误判成环" | T5/T12 |
| 05 | §5.1 | "子 Run 不继承更高权限，不自动创建 Chat Session，也不读取目标资源的可变草稿" | T12 |
| 05 | §6.3 | "Extension 不得扩大工具权限或数据级别"；"Core mount 不能从实例 API 删除"；"变更进入 AuditLog" | T12 |
| 05 | §7 | "Run 只读取 AgentVersion，不读取可变草稿"；"Chat 草稿预览…必须显式标记 definitionSource=draft" | T5/T12 |
| 05 | §9 验收2 | "同一个 Skill 在创建页、工作区、版本闭包和 Runtime 中身份一致"（"工作区"指 Agent 管理 UI） | T11 |
| 05 | §10 | "不把 AgentScope 内部 Task 合并为平台 Task" | T4 |
| 05 | §10 | "不把 Workflow、AgentScope Pipeline 和 Agent 三者合并为同一实体" | T1 |
| 05 | §10 | "不把 playbook/BIBLE 当成权限或状态机" | T8 |
| 05 | §10 | "不把"保存成功"当作"Runtime 已生效"" | T9 |

注：本稿不含 T3（Trigger target union 细节仅"为 Task 产生 TaskRun"一句）、T7、T10（决策编号在 11 号稿）、T11（文件系统义工作空间）表述。

### 4. 本档未覆盖但 01 已证明存在的产品事实（候选）

1. Waker 是混合体：用户可见资产根 + 运行实例（在线/本机徽标/主机名/工作日志/活跃度热力图）共存于一对象（01 QW-09）——05 的 Agent 模型无运行实例/在线维度。
2. 招聘市场 = 创建 Waker 页，预置角色模板卡（前端/后端/测试…+自定义模板+群聊答疑专员）（01 §4.4）——05 ModuleTemplate 无市场型创建入口表述。
3. Skill 市场生态数据：43648 个分类计数、2183 页分页、安装数/作者字段（01 QW-16）。
4. 知识库 = 共享资源 + "N 个 Waker 使用"反向绑定计数 + "设置可使用该知识库的 Waker"（01 QW-16）。
5. 公开项目 Project/Workspace = 本地目录或 Git 仓库，作用域两级（账号公开/Waker 私有），发起任务时可直接选择（01 QW-16）。
6. 自进化 Skill 与记忆学习时间线（"学到新技能 design-system"）（01 QW-09）——05 只有 memory policy。
7. Agent 运行内计划项以 TaskCreate/TaskUpdate 工具实证（taskId "1"），与看板任务、自动任务三者异质（01 QW-04）——05 有分层原则，无工具级实证对应。
8. 双向调用工具级证据：`mcp__plugin_wake_wakerflow__list_wakerflows`（响应含 wakerId）、flow 脚本 `resolve:{kind:'waker',wakerId}`（01 QW-04/QW-13）——05 §5.1 设计 ChildInvocation 但未引目标产品实证。
9. 工作空间文件系统路径约定、`_output/`、present_files 契约（目录不可作产物、非 git 仓不生成 codeChanges）（01 跨域事实 3）。
10. CoT 外露；Bash/Write 默认开放仅靠 prompt 自约束（01 跨域事实 1/2）——05 policies 有 permission/budget/data class，无 Bash/Write/工作空间隔离表述。
11. Credits 用量面板；模型 Auto 选择器与错峰折扣；Group 入口部分 disabled；@Waker IM 渠道页（01 跨域事实 4/5/6、QW-03）。

---

## 三、08-agent-pages-align-19830.md

### 1. 文档定位

日期 2026-09-08，版本 v2.1，状态"设计稿；当前页面已实测，目标改造未实施"，上位方案 11 号稿 v5.1、后端模型 05 号稿 v2.1。自述参考边界："qoderwake/原站只提供 IA、任务看板和交互参考，不是本项目领域模型或 Runtime 契约"。文内拍板："当前前端已经实现 Agent 卡片列表、九子页工作区和独立 Chat……旧 08 号稿主体已被代码事实推翻"；视觉实测证据存于 research/morethancorn/09-agentscope-plan-audit/screenshots/（01–06 六图）。§11 明确"这些是目标 API，不代表当前已实现"。

### 2. 章节骨架（至二级标题）

- # 08 · Agent 工作区现状审计与执行配置设计
- ## 0. 结论
- ## 1. 视觉实测
- ## 2. 当前页面、状态与 API
- ## 3. 页面级纠错
- ## 4. 目标工作区 IA
- ## 5. 执行页
- ## 6. 能力页与 Mount 表单
- ## 7. 工作看板与 Run 详情
- ## 8. Chat 工作区
- ## 9. 发布与评测
- ## 10. 保存状态与并发
- ## 11. 前端 API 映射
- ## 12. 逐页验收
- ## 13. 实施顺序
- ## 14. 明确不照搬

### 3. 段落事实

| 文档 | 章节 | 原文摘句 | 主题标签 |
|---|---|---|---|
| 08 | 头部 | "参考边界：qoderwake/原站只提供 IA、任务看板和交互参考，不是本项目领域模型或 Runtime 契约" | T1（边界） |
| 08 | §0 | "幽灵配置：Module 可安装 Skill，Connection、Workflow、Knowledge 可保存，但 Runtime/Release 不消费" | T9 |
| 08 | §0 | "执行缺页：没有 Pipeline、Planning、内部角色、stage scope、选择性重做、状态恢复和完整发布闭包" | T1 |
| 08 | §0 | "目标不是再增加几个下拉框，而是让页面只展示后端模型与 Runtime 真正支持的操作" | T9 |
| 08 | §1 | "Module Skill 页有上传/安装按钮，但后端发布和 Runtime 不消费" | T9 |
| 08 | §1 | "Module Config 仍显示 Provider 实现包含已退役的 deepseek-harness" | T9 |
| 08 | §1 | "Custom 详情顶栏显示"已封存·只读"，但 Config 有保存按钮" | T9 |
| 08 | §1 | "Chat 是独立二栏工作区，但只渲染文本增量" | T9/T12 |
| 08 | §2 表 | "任务看板｜最近 Run、Run detail｜GET /api/agents/{id}/runs｜平面 Run/Event，无 stage/unit" | T5 |
| 08 | §2 表 | "记忆｜…｜Chat 本地 prompt 消费；Module Runtime 不消费" | T9 |
| 08 | §2 表 | "Wakerflow｜…｜只写 config.workflows；Agent 无法真正枚举/调用 Workflow" | T9 |
| 08 | §2 表 | "发布治理｜…｜Module 部分成立；多 Provider 评测与单 Provider Release 文案混杂" | T2 |
| 08 | §2 表 | "Chat｜…｜本地模型旁路；附件只传名称；只展示 llm_delta" | T9 |
| 08 | §3.1 | ""运行时"筛选当前实际筛的是 Agent.type，不是 Runtime Provider，也不是执行形态" | T2 |
| 08 | §3.2 | "archived 只等于真实归档状态，不能用 agent.type != module 推导" | T2 |
| 08 | §4 | "原"Wakerflow"改名"流程/编排"。平台 WorkflowVersion 与 AgentScope Pipeline 是不同概念" | T1 |
| 08 | §4 | "参考产品的 WakerFlow 只是交互参考，不进入本项目数据模型" | T1 |
| 08 | §4 | "连接器不再作为 Agent 的通用安装页面。它是 Tool、MCP、Knowledge、Model Provider 的依赖" | T2/T12 |
| 08 | §5.2 | "核心拓扑来自当前 ModuleVersion 的声明式 PipelineDefinition，实例中只读展示" | T1 |
| 08 | §5.2 | 首个质检模板示例七阶段："1. classify；2. dispatch；3. execute units；4. unit verify；5. barrier；6. synthesize；7. final verify" | T1 |
| 08 | §5.2 | "不能删除 Core verifier、barrier、Schema 或必需工具"；"修改 Core 按钮应写"派生新方案"，而不是"解锁编辑"" | T8 |
| 08 | §5.2 | "不同 ModuleVersion 可声明不同 stages/edges/roles；通用 Runtime 只固定版本、权限、预算、checkpoint、幂等、环检测和终态等治理不变量" | T8 |
| 08 | §5.3 | "这里配置的是 AgentScope 一次执行内的 TaskContext，不是平台自动任务" | T4 |
| 08 | §5.5 | "Hard policy：只读展示，真正由权限/控制器强制，不允许用 Prompt 冒充" | T12/T8 |
| 08 | §5.5 | "Playbook：方案级工作手册，对应 BIBLE 的价值"；"发布预览展示最终编译顺序、token 估算、来源和 hash" | T2 |
| 08 | §6 | "没有版本的 Tool/Workflow 不能发布；Skill/Knowledge 没有可快照内容不能发布；Core 不可卸载；Extension 不能扩权超过 slot" | T2/T12 |
| 08 | §6 | "Runtime 尚未支持的资源不显示"安装"动作" | T9 |
| 08 | §7.1 | "TaskRun（可选，批量外层）└─ Run（一次输入，一条执行事实）├─ Stage └─ Unit └─ Attempt 1..N ├─ …ChildInvocation…└─ Events" | T5 |
| 08 | §7.1 | "NodeRun 继续服务平台 Workflow 图节点。AgentScope Pipeline stage 不强行伪装成 NodeRun" | T5 |
| 08 | §7.2 | "Pipeline 卡片要显示：当前 stage、完成 units/总 units、正在重做的 unit、剩余预算、等待原因。不能只给一个 running 圆点" | T5/T12 |
| 08 | §7.2 | "Run 详情另提供 InvocationGraph：父子 Run、调用方向、目标固定版本、耗时/预算、失败传播和被阻断的递归环" | T5/T12 |
| 08 | §7.3 | "首期重做由策略自动触发；手工"重做此 unit"是否开放另行拍板，不在本稿默认加入" | T1 |
| 08 | §8 | "消息块支持 text、thinking、data、tool call/result、hint" | T12（CoT 展示） |
| 08 | §8 | "工具调用经平台 Gateway；Workflow 工具只列出当前 AgentVersion 已授权并冻结的 Workflow mounts" | T12 |
| 08 | §8 | "草稿 Chat：可临时选模型，标记不进入 Release；发布环境 Chat：默认使用 Release 冻结的模型" | T2/T12 |
| 08 | §9 | "Golden Set 可以选择多个 Provider 做对比，但文案必须说明：这是评测，不是让同一个 active Release 同时绑定多个 Provider" | T2 |
| 08 | §10 | "禁止继续复制初始 agent.config 后整包 PUT；这会让另一个子页刚保存的字段消失" | T9/T12 |
| 08 | §12 工作区 | "不支持的栏目隐藏或显示明确"尚未接通"，不提供成功保存按钮" | T9 |
| 08 | §14 | "不照搬 qoderwake 的领域命名、后端实体和运行契约；不把参考产品的 Wakerflow 当成 AgentScope Pipeline" | T1 |
| 08 | §14 | "不用在线状态模拟非驻留 Agent"；"不把内部角色全部做成员工卡" | T2 |
| 08 | §14 | "不把无法生效的资源按钮保留为"先做 UI"" | T9 |

注：本稿不含 T3（Trigger 类型/target union）、T6（AgentScope 版本号）、T7、T10（决策编号）表述；T11 的"工作区"全部指 Agent 管理 UI，无文件系统/Project 义。

### 4. 本档未覆盖但 01 已证明存在的产品事实（候选）

1. CoT 外露红线：目标产品对话与 flow 生成会话均展示"深度思考"全文推理，01 裁定"我方禁抄"（01 跨域事实 1）——08 §8 设计 thinking 消息块与 §7 事件渲染，但未提及该红线及目标产品事实。
2. Bash/Write 默认开放（mkdir/npm install/Write×7 直接执行，仅靠 prompt 自约束），01 裁定"我方须工作空间隔离+allowlist+审批"（01 跨域事实 2、QW-04）——08 仅有"工具调用经平台 Gateway"。
3. 工作空间文件系统：workers/<wakerShortId>/workspace/<sidShort>_<MMDD>/、会话 `_output/`、present_files 产物契约、composer"选择工作目录"（01 跨域事实 3、QW-04/06）。
4. 看板统一投影：session/flow run/automation run 三类行混排、行粒度 = run/session 级、"需要操作/查收结果"是用户动作队列页签（01 QW-01/02）——08 §7 设计 TaskRun→Run 层级但未引该事实。
5. 自动任务表单事实：五元组定义、atk_ token 内嵌 URL、手动运行调试语义、表单无批量字段、触发仅"定时|API"（01 QW-06/07）。
6. Flow 对话式生成/编辑工具链：/wakerflow/new 对话生成页、workflow_get_script/workflow_upsert、upsert 响应契约（digest 64hex、callSites、scope.kind='global'、generationSessionId）、脚本为唯一事实源画布为投影、"基于此次运行优化工作流"（01 QW-15/16、flow-02）。
7. Flow DSL：meta{name,description,phases,outputSchema}、phase()+worker() 基本单位、resolve.kind='waker'、模板串传递上游输出（01 QW-13）。
8. Flow 版本历史 = 整数 version 列表（"版本1[当前版本]"），回滚/发布/草稿 UI 未见（01 QW-15）。
9. @Waker = IM 渠道管理页（01 QW-03）。
10. 资源市场生态：Skill 市场数据、连接器市场 11 分类 22 个（钉钉/企业微信/Linear/Notion/Canva 等，含"Waker 内置(全部 Waker 已安装)"）、知识库共享绑定、公开项目两级作用域（01 QW-16）。
11. 招聘市场创建入口、自进化 Skill、活跃度热力图、任务类型分布、记忆与学习时间线（01 QW-08/09）。
12. Credits 面板、模型 Auto 选择器与 Qwen 错峰折扣、"答疑场景的模型由群聊答疑专员工作流管理"tooltip、Group 部分 disabled、路由缺陷 /resources/connectors 被重写为 skills×~150（01 跨域事实 4/5/6、QW-03、§4.6）。

---

## 四、11-agentscope-full-integration.md

### 1. 文档定位

日期 2026-09-08，版本 v5.1（双向编排与声明式 Pipeline 补充版），状态"设计稿；本轮只改文档，不改业务代码"，审计依据 research/morethancorn/09-agentscope-plan-audit/AUDIT-REPORT.md。头部自述 AgentScope 基线："2.0.8-dev@ff8697ec4d59ee01f3766176e70cb24ee894d6c6；PyPI 尚无 2.0.8 发布物"。§0 拍板记录："开工状态：冻结。原 v4.1 的'15 点全部拍板、方案冻结'已经失效。P0 只做未提交工作区归属、AgentScope commit/lock 方案和跨边界合约测试设计；G0 通过前不得实施新配置页，也不得继续把现有 native_workflow.py POC 堆成生产骨架"。§11 决策表：已确定 D01–D22（22 条齐全，见下方 T10 专节），仍待决 U01/U02/U04/U05/U06（编号跳过 U03，文内无解释）。

### 2. 章节骨架（至二级标题）

- # 11 · AgentScope 全量接线总体方案
- ## 0. 结论与开工状态
- ## 0.1 北极星业务故事
- ## 1. 现状事实
- ## 2. 权威概念模型
- ## 3. AgentScope 2.0.8-dev 的采用边界
- ## 4. 方案 A：QualityPipeline
- ## 5. 方案 B：Planning Agent
- ## 6. Runtime Contract v1.2
- ## 7. 原子版本与 Release
- ## 8. Agent 工作区目标设计
- ## 9. Task、Trigger、Batch 和工单链路
- ## 10. 分期计划
- ## 11. 决策表
- ## 12. 明确不做
- ## 13. 证据索引

### 3. 段落事实

| 文档 | 章节 | 原文摘句 | 主题标签 |
|---|---|---|---|
| 11 | 头部 | "AgentScope 基线：2.0.8-dev@ff8697ec4d59ee01f3766176e70cb24ee894d6c6；PyPI 尚无 2.0.8 发布物" | T6 |
| 11 | §0 | "平台只有一个用户可见的 Agent 根资产、一个草稿模型、一个 AgentVersion、一个原子 Release 闭包" | T2 |
| 11 | §0 | "Task、Trigger、Batch 只负责何时、对哪些输入发起 Run，不再拥有第二套 Agent 执行逻辑" | T4 |
| 11 | §0 | "Skill、Tool、Knowledge、Workflow 只有挂载成功、版本冻结、Runtime 消费三者同时成立，UI 才能显示"已生效"" | T9/T2 |
| 11 | §0 | "声明式固定 Pipeline 必须支持失败子项选择性重做、独立核验、检查点、状态持久化与重启恢复" | T1 |
| 11 | §0 | "开工状态：冻结。原 v4.1 的"15 点全部拍板、方案冻结"已经失效" | T10 |
| 11 | §0.1 故事B | "AgentScope TaskContext 和 Planning tools 用于一次 Run 内的任务拆解与状态维护。平台 Task/TaskRun 仍是外层业务调度，不与 AgentScope 内部计划任务合表" | T4 |
| 11 | §0.1 故事D | "Trigger 可以即时、定时、事件触发或 API 触发；batching 可以逐条、窗口攒批或手动冲刷。一个 TaskRun 包含 N 个 Run" | T3/T4 |
| 11 | §1.1 | "当前已存在：Agent…AgentVersion：definition、common_config、dependency_snapshot、artifact_hash；Release…Run、NodeRun、RunEvent、CallRecord" | T2/T5 |
| 11 | §1.1 | "Runtime Contract v1.0 没有 roles、mounts、pipeline、planning、session_state 或 continuation_state" | T5 |
| 11 | §1.2 表 | "native quality workflow｜metadata 名称平台为 workflowMode、adapter 检查 workflow_mode｜真实请求不进入 POC 分支" | T9 |
| 11 | §1.2 表 | "Chat｜平台 agent_chat → 本地模型调用｜绕过 AgentScope Runtime"；"Skill｜Chat 只读 AgentSkill 名称；Module 不读页面 Skill｜假接线" | T9 |
| 11 | §1.3 | "但 UI 当前把"可以保存"错误地当成"运行会生效"。最明显的例子是 Module Skill 安装、Connection/Workflow/Knowledge 挂载" | T9 |
| 11 | §2.1 | "Agent 有两个正交维度：1. runner.kind：agent 或 pipeline；2. planning.enabled" | T2/T4 |
| 11 | §2.2 | "固定 Pipeline 内的 dispatcher、executor、unit verifier、synthesizer、final verifier 首期作为 AgentVersion 内嵌 RoleVersion…随 AgentVersion 原子冻结" | T2 |
| 11 | §2.2 | "只有当某个角色需要被多个方案复用、独立授权、独立评测、独立发布或被用户直接对话时，才提升为顶层 Agent 资产" | T2 |
| 11 | §2.3 | "内置方案包含不可变 Core：Pipeline 拓扑和控制器版本；核心角色及其职责边界；必需 Tool/Skill/Knowledge；输入/输出 Schema；barrier、retry、timeout、permission、final verification 策略" | T8/T2 |
| 11 | §2.4 | "Connection 不作为与 Skill 并列的自由能力…应通过依赖闭包间接进入 Release" | T2/T12 |
| 11 | §2.5 | "Run 是每一次执行事实，所有执行都有；Chat Session 只管理多轮对话身份、消息与 AgentState；Chat 每一 turn 是一个 Run" | T5/T4 |
| 11 | §2.5 | "Pipeline/HITL 暂停恢复使用 ExecutionState/Continuation，不伪装成 Chat Session；TaskRun 是批量/自动任务的一次外层调度，包含 N 个 Run" | T5 |
| 11 | §2.6 | "platform policy：安全、权限、数据边界；属于硬约束的提示说明，但真正强制仍在代码/网关" | T12 |
| 11 | §2.6 | "playbook/BIBLE 是 LLM 软约束，不能承担权限、版本固定、barrier、retry、幂等或最终状态" | T8 |
| 11 | §2.7 | "根 Run 维护跨 workflow/agent 的 InvocationGraph，在当前活动祖先链上以 (resource_type, version_id) 做环检测，并限制深度、总子 Run、模型/工具预算" | T5/T12 |
| 11 | §2.7 | "list 只返回当前 role/slot/环境有权调用的资源，不暴露全平台清单" | T12 |
| 11 | §2.7 | "子 Run 继承 trace、权限上限和取消信号，但有独立状态、事件和幂等键"；"默认不因子调用创建 Chat Session" | T5/T12 |
| 11 | §2.7 | "AgentScope Pipeline 是 AgentVersion 内部运行拓扑；平台 Workflow 是可独立版本、触发和组合的业务流程资产。二者允许互相调用，但不合表" | T1 |
| 11 | §3.1 | "AgentScope App：Storage、MessageBus、Workspace、ChatService、Skill/MCP/Knowledge、Scheduler 等完整应用层" | T11（仅组件名） |
| 11 | §3.2 | "GoalPipeline 有 verifier，不代表支持 dispatcher/fan-out/barrier"；"同一进程实例能恢复 HITL，不代表进程重启可恢复" | T6 |
| 11 | §3.3 | "2.0.8 正式发布前只做隔离 spike，固定完整 commit 和锁文件；正式发布后再过升级门" | T6 |
| 11 | §4.1 | "QualityPipeline 不是把 classify/dispatch/... 阶段名和 prompt 写死在 Python。ModuleVersion 冻结一个可校验的 PipelineDefinition，声明 stages、edges、roles、Schema、mount slots…" | T1 |
| 11 | §4.1 | "Runtime 中写死的是通用治理不变量，而不是具体业务 SOP"（清单：stage progression、bounded fan-out、barrier、timeout/cancel、retry budget、checkpoint、idempotency、permission enforcement、structured Schema validation、selective redo routing、terminal status synthesis） | T8 |
| 11 | §4.1 | "不要让 LLM 决定这些治理事实。PipelineDefinition 也不能覆盖平台的深度上限、权限上限、幂等、checkpoint 原子性和终态合法性" | T8/T12 |
| 11 | §4.2 | 角色阶段表：classify/dispatch/execute/unit_verify/barrier/synthesize/final_verify；"executor 不能兼任自己的 verifier" | T1/T8 |
| 11 | §4.3 | "pass 后结果冻结；fail 且 retryable 时，只给该 unit 新 attempt，并携带 verifier feedback；兄弟 unit 的结果、调用记录和预算不变" | T1/T5 |
| 11 | §4.4 | PipelineState 持久状态："pipeline_definition_version；current_stage；…每个 unit 的 attempts、状态、结果引用、verdict、feedback；…checkpoint sequence；…terminal reason" | T5 |
| 11 | §4.4 | "每次状态变更先落平台状态与事件，再进行下一外部调用。恢复必须幂等" | T5/T12 |
| 11 | §4.5 | "native_workflow.py 只证明：阶段推进；工具白名单；bounded parallel；barrier；结构化输出" | T9 |
| 11 | §4.5 | "它没有独立 verifier、选择性重做和可持久化 PipelineState，而且包含 fixture 专用检索轮数和路由器保修提示" | T9 |
| 11 | §4.5 | "处置为：冻结为 POC 证据；保留和改写行为测试；不作为生产类继承或继续叠补丁" | T9 |
| 11 | §5 | "AgentScope 内部 Task 不是平台 AnalysisTask，也不是自动任务。前者是一次推理过程状态，后者是可版本化、可触发、可批量的业务调度实体" | T4 |
| 11 | §6.1 | Contract v1.2 请求新增："execution…prompt_bundle…roles…mounts…invocation…policies…state…continuation…expected event schema version" | T5 |
| 11 | §6.2 | "根 Run 状态保留 queued、running、succeeded、failed、cancelled，并增加控制态 waiting_input、paused 的平台语义" | T5 |
| 11 | §6.3 | 事件前缀："run.started/…；invocation.started/…/blocked_cycle；reply.started/text.delta/thinking.delta/…；task.created/updated；pipeline.stage/unit/barrier/checkpoint/waiting/final_verdict" | T5/T12 |
| 11 | §6.3 | "每个事件必须有 sequence、channel、trace/span、stage_key、unit_key、attempt、payload schema version；前端对未知事件优雅忽略" | T5 |
| 11 | §6.4 | "Runtime capability 只能在真实跨端测试通过后声明"；"cancel：不是空方法"；"selective_retry：失败单元正向与兄弟不重跑负向测试通过" | T9 |
| 11 | §7 | "AgentVersion 必须冻结：1. AgentDefinition、ExecutionSpec 和 PromptBundle…3. PipelineDefinition、controller/version/state schema…15. artifact hash"（15 项清单） | T1/T2 |
| 11 | §7 | "13. Runtime Contract 版本；14. AgentScope 精确 package/commit"（冻结清单第 13/14 项） | T6/T2 |
| 11 | §7 | "评测可以跨多个 Provider 比较；同一有效 Release 仍可遵守"一 Agent 一 Provider"。前端不得把评测多 Provider 说成同一 Agent 可同时跨 Provider 灰度" | T2 |
| 11 | §9 | "03 号稿仍是 Trigger 与数据映射权威设计。12 号稿负责工单处理和 Outbox，但执行语义修正为：flow：平台 WorkflowVersion 执行；agent：对同一 AgentVersion 发起 Run" | T3/T4 |
| 11 | §9 | "batch：TaskRun 输入集合与并发/窗口策略；automation：Task + Trigger + budget" | T4 |
| 11 | §9 | "Chat：人机连续交互，不作为所有自动任务的默认执行分支；HITL：Pipeline/Run continuation，不要求先创建 Chat Session" | T4/T5 |
| 11 | §9 | "自动任务可直接以 WorkflowVersion 或 AgentVersion 为目标"；"三者共享版本解析、子 Run、InvocationGraph、预算、权限、取消和审计，不各造一套调用协议" | T3/T5 |
| 11 | §11.1 | 已确定决策表 D01–D22（完整清单见下方 T10 专节） | T10 |
| 11 | §11.2 | 仍待决："U01 SkillVersion 独立表还是内容快照；U02 KnowledgeSnapshot 冻结范围；U04 partial barrier；U05 2.0.8 正式版前是否允许生产；U06 高风险工单写 HITL 节奏"（无 U03） | T10 |
| 11 | §12 | "不把 AgentScope GoalPipeline 包装一下就宣称支持质检流水线" | T9 |
| 11 | §12 | "不让 LLM 决定 retry、barrier、权限或终态" | T8 |
| 11 | §12 | "不把参考产品的 Wakerflow 名称当成本项目实体" | T1 |
| 11 | §12 | "不在 2.0.8 尚未发布时写可直接安装的稳定依赖声明" | T6 |

注：本稿无 T7（飞书/IM）表述；T11 仅两处（AgentScope App 组件名 Workspace、§1.3 九子页工作区 UI），无文件系统/Project 义工作空间。

### 3a. T10 专节 · D01–D22 决策清单原文（来源：11 §11.1"已确定"表，编号+一句话+状态）

| 编号 | 决策原文（一句话） | 状态 |
|---|---|---|
| D01 | AgentScope 是唯一 Agent Runtime | 已确定（HANDOFF §5 列为不得回退） |
| D02 | 2.0.8 正式发布前以精确 Git commit 做隔离 spike，不假装已发布 | 已确定 |
| D03 | 方案 A 是声明式 Core 的 QualityPipeline；不直接使用 GoalPipeline，也不把业务阶段写死在控制器 | 已确定 |
| D04 | 方案 B 是 AgentScope Planning Agent | 已确定 |
| D05 | Pipeline 与 Planning 正交可组合 | 已确定 |
| D06 | 内部角色默认内嵌 AgentVersion，不全部升级为顶层 Agent | 已确定（HANDOFF §5 不得回退） |
| D07 | 控制器、barrier、retry、checkpoint、schema、permission 不是 Agent | 已确定 |
| D08 | unit verifier 与 final verifier 独立于 executor | 已确定（HANDOFF §5 不得回退） |
| D09 | 失败子项选择性重做是方案 A 必备验收项 | 已确定（HANDOFF §5 不得回退） |
| D10 | Core 冻结；改 Core 走派生或新版本 | 已确定（HANDOFF §5 不得回退） |
| D11 | Extension 可挂 Skill、Tool、Knowledge，并支持 global、stage、role scope | 已确定 |
| D12 | Release 原子冻结全部依赖闭包 | 已确定（HANDOFF §5 不得回退） |
| D13 | Chat 每 turn 是 Run；多轮才有 Session | 已确定（HANDOFF §5 不得回退） |
| D14 | 无状态单次任务不创建 Session | 已确定（HANDOFF §5 不得回退） |
| D15 | Pipeline 恢复状态叫 ExecutionState/Continuation，不冒充 Chat Session | 已确定 |
| D16 | 批量属于 TaskRun 调度策略；自动任务可配置 batching | 已确定（HANDOFF §5 不得回退） |
| D17 | native_workflow.py 只作 POC 证据，不作生产基类 | 已确定（HANDOFF §5 不得回退） |
| D18 | 前端必须改；不能维持"交互协议零改动" | 已确定（HANDOFF §5 不得回退） |
| D19 | WorkflowVersion 与 AgentVersion 支持双向组合，但不与 AgentScope Pipeline 合表 | 已确定 |
| D20 | Agent → Workflow 走授权 workflow mount/tool；Workflow → Agent 走通用 agent-run 子运行节点 | 已确定 |
| D21 | 跨 Agent/Workflow 子调用统一维护 InvocationGraph、版本 pin、预算、权限、取消、幂等与环检测 | 已确定 |
| D22 | IDENTITY/playbook/PERSONA 编译为版本化 PromptBundle；BIBLE 类内容是软约束，不替代硬治理 | 已确定（HANDOFF §5 不得回退） |

完整性核对：D01–D22 共 22 条，编号连续无缺；配套未决项 U01/U02/U04/U05/U06（U03 编号缺失，文内无解释）；12 号稿另有 N1–N6，HANDOFF §6 将 U06/N1、N3、N4、N6 与 P0（52 个 dirty path 归属）合并列为"仍未拍板"。

### 4. 本档未覆盖但 01 已证明存在的产品事实（候选）

1. CoT 外露红线：目标产品对话与 flow 生成会话展示"深度思考"全文，01 裁定"我方禁抄"（01 跨域事实 1）——11 §6.3 设计了 thinking.delta 事件，但未记录该红线与目标产品事实。
2. Bash/Write 默认开放、仅靠 prompt 自约束；须工作空间隔离+allowlist+审批（01 跨域事实 2）——11 的权限表述止于 Gateway/Permission Policy/permission enforcement。
3. 工作空间文件系统路径、`_output/`、present_files 产物交付契约（01 跨域事实 3）——11 的 Workspace 仅指 AgentScope App 组件名。
4. Credits 用量面板（2718/3000、91%、资源包、续期日）（01 跨域事实 4）。
5. Group 入口部分 disabled、无 Group 实体列表（01 跨域事实 5）。
6. 模型 Auto 选择器、Qwen 错峰折扣文案、"答疑场景的模型由群聊答疑专员工作流管理"tooltip（01 跨域事实 6、QW-03）——11 冻结"Model 及参数"但无模型市场/计价/按工作流管模型表述。
7. 自动任务表单事实：触发仅"定时|API"两卡且"事件"无表单入口；atk_ token 内嵌 URL 鉴权；手动运行=调试语义；表单/详情完全无批量字段；高级设置含最大运行次数/截止日期（01 QW-06/07、auto-02）——11 故事 D 设计"即时、定时、事件、API"四类触发与 batching，与目标产品表单事实不同。
8. "一个 WakerFlow 只有一份自动运行配置，可添加多个触发方式"（1/5）（01 QW-15）。
9. 看板统一投影三类执行事实 + "需要操作/查收结果"用户动作队列页签（01 QW-01/02）。
10. Flow DSL 与存储契约（meta/phases/outputSchema、phase()+worker()、digest、callSites、scope.kind='global'、整数 version、generationSessionId、脚本唯一事实源）；对话式生成/编辑（/wakerflow/new、workflow_get_script/upsert、"基于此次运行优化工作流"）；run 级路由与阶段/节点状态可见、attempt 概念未见（01 QW-12–16）。
11. Waker 混合体（资产根+在线/本机/主机名运行实例）、九子页分组（含自进化 Skill、项目、权限、Waker 档案）、招聘市场创建入口（01 QW-08/09）。
12. @Waker = IM 渠道管理页（01 QW-03）——IM 未入 11 范围。
13. 资源市场生态（Skill 市场 43648 个/连接器市场 22 个含钉钉、企业微信/知识库共享绑定/公开项目=本地目录或 Git 仓库两级作用域）（01 QW-16）。
14. 双向调用工具级证据：list_wakerflows 工具与 resolve.kind='waker'（01 QW-04/13）——11 §2.7 设计双向组合但未引目标产品实证。

---

## 五、12-event-driven-workorder-pipeline.md

### 1. 文档定位

日期 2026-09-08，版本 v2.1，状态"设计稿，未实施"，上位方案 11 号稿 v5.1。头部自述边界："入口权威：03 号稿；本稿不改变 Trigger、TriggerEvent、映射和攒批裁定"。文内拍板："工单链路不是第三套 Agent 运行机制"；"旧稿中的'flow / agent 批量 / agent 对话三选'不成立"。含 T0–T6 分期闸门、未决事项 N1–N6、13 条验收场景。§11 自述文档关系：SDD-12/13/14"不高于本轮修订后的 05/08/11/12"。

### 2. 章节骨架（至二级标题）

- # 12 · 事件驱动三方工单处理链路
- ## 0. 结论
- ## 1. 场景与边界
- ## 2. 当前事实
- ## 3. 处理目标如何选择
- ## 4. 质检/审计/工单核验 Pipeline
- ## 5. Session、Run、等待与恢复
- ## 6. 能力挂载与版本闭包
- ## 7. 出站写回治理
- ## 8. 分期与闸门
- ## 9. 未决事项
- ## 10. 验收场景
- ## 11. 文档关系

### 3. 段落事实

| 文档 | 章节 | 原文摘句 | 主题标签 |
|---|---|---|---|
| 12 | §0 | "平台负责 Trigger、映射、batching、TaskRun、版本解析、权限、副作用 Outbox、审计和对账；AgentScope 负责 AgentVersion 的实际运行" | T4/T5 |
| 12 | §0 | "一条输入对应一个 Run；批量只是一个 TaskRun 组织多个 Run；自动任务只是由 Trigger 启动 TaskRun" | T4 |
| 12 | §0 | "只有需要持续多轮人机对话时才创建 Chat Session。普通事件处理、等待确认和 Pipeline 恢复都不能为了"统一"伪造 Session" | T5/T4 |
| 12 | §0 | "旧稿中的"flow / agent 批量 / agent 对话三选"不成立。正确选择发生在两个正交层次：1. Task 的执行目标是 WorkflowVersion 或 AgentVersion" | T3 |
| 12 | §0 | "2. AgentVersion.runner 是 agent 或 pipeline，Planning 是 role 级能力，不是第三种 target" | T3/T4 |
| 12 | §1 | 场景图："Webhook / Kafka / API / Schedule Trigger └─ TriggerEvent → filter → mapping → batching └─ TaskRun ├─ target=WorkflowVersion ├─ target=AgentVersion" | T3/T5 |
| 12 | §1 | "本稿不解决：通用 iPaaS、跨系统双向同步、自由多 Agent 流程编辑器、所有高风险动作的统一 HITL 产品形态" | T8（边界） |
| 12 | §2.1 表 | "AnalysisTask / TaskVersion / TaskRun｜已有 workflow/agent 执行目标、manual/schedule/backfill/api 触发来源、幂等字段和 resolved version" | T3/T5 |
| 12 | §2.1 表 | "Workflow / NodeRun / batch｜平台确定性流程与节点执行事实已存在｜继续作为一种 Task target；不与 AgentScope Pipeline 合表" | T1/T5 |
| 12 | §2.1 表 | "AgentScope adapter｜可执行 Module；capability 和配置契约存在错配｜Runtime Contract v1.2 前不得宣称已支持 Pipeline/Planning/Session" | T9 |
| 12 | §2.1 表 | "native_workflow POC｜有固定阶段实验，但未支持生产级选择性重做、恢复和完整 verifier｜只作测试证据，不作为生产基类" | T9 |
| 12 | §2.1 表 | "ResultDelivery｜已有 Outbox 治理模式｜可复用模式，不等于 HTTP 动作已经实现" | T5 |
| 12 | §2.1 表 | "Agent Chat｜有 Session/Message/turn API，但本地直连模型并旁路 Runtime｜R1 后改走 AgentScope；多轮才用 Session" | T9/T5 |
| 12 | §2.1 补充 | "Workflow 旧 agent/agent-select/agent-exec 节点已经 deprecated，迁移器会把它们改写为 workflow 节点…双向控制关系，目前在本项目里两个方向都没有真正接通" | T5 |
| 12 | §2.2 | "03 号稿定义的下列能力仍是设计，不得在界面和排期中写成现成：Trigger 一等实体…immediate/window/manual_flush batching" | T9/T3 |
| 12 | §2.3 | "当前阻断：…5. 当前 POC 和官方 GoalPipeline 都不能直接满足"只重做失败 unit"；…7. Trigger/Kafka/映射/batching 尚未实施" | T9/T1 |
| 12 | §3 表 | "WorkflowVersion｜规则可枚举、步骤固定…｜TaskRun → Run → NodeRun"；"AgentVersion / runner=pipeline｜质检、审计、工单核验…｜TaskRun → Run → PipelineState/Stage/Unit/Attempt" | T3/T5 |
| 12 | §3 | "如果业务本质是固定质量治理骨架，应直接发布一个 runner=pipeline 的内置 Agent 方案；只有跨多个平台资产、确定性节点和人工步骤的业务流程才用 Workflow 作为外层" | T8 |
| 12 | §3.1 | "Agent → Workflow：授权 Workflow mount 被编译成 AgentScope tool…Workflow → Agent：通用 agent-run 节点创建固定 AgentVersion 的子 Run" | T5/T1 |
| 12 | §3.1 | "两者统一记录 ChildInvocation，继承 trace、取消和权限上限，并受根 Run 总预算约束" | T5/T12 |
| 12 | §3.1 | "不允许 Agent 通过 run-workflow 工具绕过外部写 Outbox，也不允许 Workflow 节点绕过 Agent Release 和 Runtime 权限" | T12 |
| 12 | §4.1 | "用户看到一个内置方案；内部 classifier/executor/unit_verifier/synthesizer/final_verifier 是 AgentVersion 内冻结的 role" | T2 |
| 12 | §4.1 | "该拓扑是首个质检 ModuleVersion 的声明式 PipelineDefinition，不是通用控制器里写死的唯一七段流程" | T1/T8 |
| 12 | §4.1 | "barrier、retry、schema、checkpoint、预算和权限的执行不变量属于代码控制面，不是 Agent" | T8 |
| 12 | §4.2 | "每个 unit 有稳定 unit_id、独立 input/result/verdict/attempt；…失败只重开指定 unit，已通过兄弟结果冻结复用" | T1/T5 |
| 12 | §4.2 | "官方 2.0.8-dev GoalPipeline 只有一个 executor 与一个 verifier；验证失败时会把反馈交回整个 executor…不能直接实现上述状态机" | T6/T1 |
| 12 | §4.3 | "修改 Core 不在原实例上解锁，必须派生新 Module/ModuleVersion。Extension 也必须进入下一 AgentVersion 的完整依赖闭包后才能发布" | T2/T8 |
| 12 | §5 表 | "Webhook/Kafka 单条无状态处理｜Session 无｜Run 1｜恢复载体 Run/ExecutionState"；"用户与 Agent 多轮协作处理｜Session 1｜每个 assistant turn 1 个 Run" | T5/T4 |
| 12 | §5 | ""事件触发 Agent 后自动创建对话"不再是默认方案。只有产品明确把任务升级为多人/多轮对话时，才新建或关联 Session" | T4/T5 |
| 12 | §6 | "任务只引用已发布 AgentVersion。运行时不能临时从可变 Agent.config 猜装配内容" | T2 |
| 12 | §7.1 | "创建、更新、留言、关闭工单是不同动作，必须各自声明：method/path/input/output schema；业务幂等键来源；风险等级和默认权限；是否可重放" | T12/T5 |
| 12 | §7.2 | "每个外部写动作至少记录：action kind、idempotency key、target connection/environment、脱敏请求快照、attempt、响应摘要、终态和审计信息" | T5/T12 |
| 12 | §7.2 | "exactly-once creation：平台用唯一幂等键只创建一条待投递记录；at-least-once delivery：失败按策略重试" | T5 |
| 12 | §7.2 | "Run 成功不能推导外部单据已写成功；动作终态独立聚合" | T5 |
| 12 | §7.2 | "HTTP 出站继续经过统一 egress policy，Agent 工具继续经过 Gateway" | T12 |
| 12 | §7.2 | "复用 ResultDelivery 表还是新建 EgressAction 尚未拍板" | T5/T10（未决，对应 N3） |
| 12 | §8 | "T5｜Workflow/Agent 两类 Task target 合流｜resolved version 冻结；同一事件不双跑"；"T5.1｜双向子运行：workflow mount/tool、agent-run 节点、ChildInvocation/InvocationGraph" | T3/T5 |
| 12 | §9 | 未决表 N1–N6："高风险创建/关闭动作是否首期加入 HITL…Kafka 首期协议范围…HTTP Outbox 新表还是扩 ResultDelivery…试点目标系统…partial barrier…任务升级为 Chat Session 的权限与归属" | T10（未决项）/T12 |
| 12 | §10 | "12. 构造 AgentVersion A → WorkflowVersion W → AgentVersion A 的环，在任何外部写动作前失败" | T12/T5 |
| 12 | §10 | "7. 无状态自动任务全程不创建 Chat Session"；"6. Run 成功、投递失败时，界面分别显示执行成功和写回失败" | T4/T5 |

注：本稿不含 T7（飞书/IM）、T11（工作空间/Project）表述；T6 仅 GoalPipeline/2.0.8-dev 一处。

### 4. 本档未覆盖但 01 已证明存在的产品事实（候选）

1. 自动任务表单事实：五元组定义（Trigger+target+prompt+workspace+policy）、atk_ token 内嵌 URL、手动运行=调试语义、表单/详情完全无批量字段、触发仅"定时|API"且"事件"无表单入口、高级设置最大运行次数/截止日期（01 QW-06/07、auto-02）——12 设计 automation=Task+Trigger+budget 与 Webhook/Kafka 入口，未记录目标产品表单事实。
2. "一个 WakerFlow 只有一份自动运行配置，可添加多个触发方式"（1/5）（01 QW-15）。
3. 看板统一投影：session/flow run/automation run 三类执行事实混排、行粒度=run/session 级、运行历史"查看任务"回链看板（01 QW-02/07）。
4. Flow 编排实体事实：DSL（meta/phases/outputSchema、phase()+worker()、resolve.kind='waker'、模板串传递上游输出）、脚本为唯一事实源+digest+callSites 投影、run 级路由、阶段/节点级状态、三次 run（已完成/已终止/失败）、整数 version 且回滚/发布/草稿 UI 未见、"基于此次运行优化工作流"入口（01 QW-12–16）。
5. 目标产品外部写形态：连接器市场（钉钉/企业微信/Linear/Notion/Canva 等 22 个）+ Waker 转录内 Bash/Write 直接执行（01 QW-16、QW-04、跨域事实 2）——12 设计 HTTP Outbox/egress/Gateway，未提目标产品形态。
6. 双向调用工具级证据：list_wakerflows 工具、resolve.kind='waker'（01 QW-04/13）——12 §2.1 仅泛称"目标产品展示的双向控制关系"。
7. @Waker = IM 渠道管理页（01 QW-03）。
8. 工作空间/项目：文件系统路径约定、`_output/`、present_files 契约、公开项目=本地目录或 Git 仓库两级作用域、composer 选择工作目录（01 跨域事实 3、QW-16）。
9. CoT 外露红线（01 跨域事实 1）。
10. Credits 面板、模型 Auto/错峰折扣、Group 部分 disabled（01 跨域事实 4/5/6）。
11. 选择性重做在目标产品无任何可见入口（01 QW-14 红线记录：唯一被点名"不成立"的宣称）——12 §4.2 将其设计为必须满足项，但未记录目标产品缺位这一对照事实。

---

## 六、AUDIT-HANDOFF-agentscope-plan.md

### 1. 文档定位

日期 2026-09-08，版本 v2.1，用途自述"后续审计者与实施者的唯一入口"，状态"方案已完成本轮代码/前端/官方源码审计并回炉；业务代码未因本轮审计修改，尚未进入 P0/G0 实施"。核心拍板："原 11 号稿 v4.1 不能直接开工。本轮审计结论是'回炉后有条件通过'，不是'原计划验证无误'"；"在 G0 与 M1 完成前，不应继续扩前端配置项，也不应把现有 native POC 提升为生产骨架"。§2 给定权威文档阅读顺序（AUDIT-REPORT → 11 v5.1 → 05 v2.1 → 08 v2.1 → 12 v2.1 → 03），并裁定"SDD-12/13/14、旧 00–10、历轮 research 与 qoderwake 调研仅作背景证据"。§5 声明"已确定的 D01–D22，完整表在 11 号稿 §11"，本档仅列 13 条不得回退要点（不带编号）。

### 2. 章节骨架（至二级标题）

- # 审计交接单 · AgentScope 统一运行方案
- ## 0. 先读结论
- ## 1. 工作区状态与边界
- ## 2. 权威文档
- ## 3. 必须独立复核的事实
- ## 4. AgentScope 2.0.8-dev 官方事实
- ## 5. 已确定的 D01–D22
- ## 6. 仍未拍板
- ## 7. 实施顺序
- ## 8. 硬闸门
- ## 9. 给下一位执行者的要求

### 3. 段落事实

| 文档 | 章节 | 原文摘句 | 主题标签 |
|---|---|---|---|
| HANDOFF | §0 | "原 11 号稿 v4.1 不能直接开工。本轮审计结论是"回炉后有条件通过"，不是"原计划验证无误"" | T10 |
| HANDOFF | §0 | "平台只有一个用户可见的 Agent 方案根；内置质检、审计、工单核验可以由多个 AgentScope 内部 role 组成，但这些 role 默认不是多个顶层平台 Agent" | T2 |
| HANDOFF | §0 | "方案 A 是我方实现 PipelineProtocol 的 QualityPipeline；具体 stages/roles/SOP 来自版本化 PipelineDefinition，不直接套官方 GoalPipeline，也不硬编码唯一业务流程" | T1/T8 |
| HANDOFF | §0 | "Release 必须原子冻结 Agent 定义、内部 role、Core/Extension mounts、模型、Schema、策略、Runtime/AgentScope 版本和依赖 hash" | T2 |
| HANDOFF | §0 | "一个输入产生一个 Run；Chat 的每个 assistant turn 是一个 Run；只有多轮对话才创建 Session；Pipeline 等待/恢复使用 ExecutionState/Continuation" | T4/T5 |
| HANDOFF | §0 | "批量是 TaskRun 的输入集合与调度策略，自动任务可以配置 batching，但两者不是两个执行内核" | T4 |
| HANDOFF | §0 | "WorkflowVersion 与 AgentVersion 支持双向组合：Agent 通过授权 mount/tool 调 Workflow，Workflow 通过通用 agent-run 节点调 Agent；两者不与 AgentScope Pipeline 合表" | T1/T5 |
| HANDOFF | §0 | "在 G0 与 M1 完成前，不应继续扩前端配置项，也不应把现有 native POC 提升为生产骨架" | T9 |
| HANDOFF | §1 | "Git HEAD 894245d；审计开始时 dirty path 数 51；本单更新时 dirty path 数 52…原有未提交文件归属仍未解决"（"工作区"=git 工作区） | T11（语义注记） |
| HANDOFF | §1 | "AgentScope 基线｜PyPI 仍为 2.0.7.post1；2.0.8 只存在于官方 Git main 源码，审计固定提交 ff8697ec…" | T6 |
| HANDOFF | §1 | ""业务代码未修改"只描述本轮审计动作，不等于工作区干净…P0 第一件事仍是做文件归属和基线封存" | T9/T11 |
| HANDOFF | §2 | "SDD-12/13/14、旧 00–10、历轮 research 与 qoderwake 调研仅作背景证据。它们与上述文档冲突时，不能倒过来覆盖本轮已纠正的结论" | T10（权威序） |
| HANDOFF | §3 A01 | "当前 Agent 定义存在 Agent.config、AgentSkill、Module manifest/spec 三套来源，编辑、发布和运行没有闭环" | T2/T9 |
| HANDOFF | §3 A02 | "Custom 创建时选择的 Skill 写进 config.skills，Chat 读取 AgentSkill，两条路径断裂" | T9 |
| HANDOFF | §3 A03 | "Custom 不能与 Module 一样构建 definition、版本、Release 和结构化 Run；当前主要只有本地 Chat" | T2/T9 |
| HANDOFF | §3 A04 | "Module 页允许安装 Skill、Connection、Workflow、Knowledge，但当前 Runtime/Release 不消费这些页面写入" | T9 |
| HANDOFF | §3 A05 | "平台发 metadata.workflowMode，AgentScope adapter 查 workflow_mode；现有测试分别验证各自拼写，没有端到端命中固定骨架" | T9 |
| HANDOFF | §3 A06 | "当前 native_workflow 不能选择性重做：并行失败会整体失败，重试只处理结构化输出缺失，没有 unit verifier/final verifier/checkpoint" | T9/T1 |
| HANDOFF | §3 A07 | "当前 Chat 旁路 Runtime，固定截取历史，只注入 Skill 名称，附件只传文件名，只展示 llm_delta" | T9/T12 |
| HANDOFF | §3 A08 | "Custom 在工作区壳被 agent.type !== module 误标只读，而 Config 又可保存" | T9 |
| HANDOFF | §3 A09 | "多个子页复制旧 agent.config 后全量 PUT，存在并发丢更新" | T9/T12 |
| HANDOFF | §3 A10 | "capability 声明包含尚未兑现的 Skill/session/cancel/streaming；cancel 当前近似 no-op" | T9 |
| HANDOFF | §3 A12 | "Module purpose 表单写 config.spec.purpose，builder 读取另一层级，保存成功不等于生效" | T9 |
| HANDOFF | §3 A13 | "Module manifest 仍暴露已退役 provider 元数据" | T9 |
| HANDOFF | §3 A14 | "Release 当前没有冻结 Skill/Knowledge 等完整可变依赖" | T2 |
| HANDOFF | §3 A15 | "Runtime Contract v1.0 只有简单 execute/status/trace，没有 pipeline/session/mount/state/continuation" | T5 |
| HANDOFF | §3 A16 | "Workflow 旧 agent 三类节点已 deprecated，迁移器会改写成 workflow 节点，不是新版 AgentVersion 调用" | T5 |
| HANDOFF | §3 A17 | "Agent 页的 Workflow 挂载目前只写 config.workflows，Runtime 没有 list/run workflow 工具" | T9/T5 |
| HANDOFF | §4 | "2.0.8 尚未在 PyPI 发布；不能写成普通稳定依赖已经可安装" | T6 |
| HANDOFF | §4 | "GoalPipeline 只有一个 executor 和一个 verifier，失败反馈回整个 executor，不提供 unit/stage 级选择性重做" | T6/T1 |
| HANDOFF | §4 | "GoalPipeline 的 _goal/_iters 是实例内存字段，不等于可跨进程恢复的 PipelineState" | T6/T5 |
| HANDOFF | §4 | "2.0.8 正式版前，只允许在隔离环境固定上述 commit 做 spike…不能把 main commit 永久当生产版本" | T6 |
| HANDOFF | §5 | "已确定的 D01–D22。完整表在 11 号稿 §11。复核时尤其不得回退以下决定"（后列 13 条不带编号要点） | T10 |
| HANDOFF | §5 | "PipelineDefinition 声明业务 stages/roles/SOP；引擎只固定版本、权限、预算、checkpoint、幂等、环检测和终态不变量" | T8/T1 |
| HANDOFF | §5 | "IDENTITY/playbook/PERSONA 编译为 PromptBundle；BIBLE 类工作手册是软约束，不能代替硬治理" | T8 |
| HANDOFF | §6 | 仍未拍板表："U01/U02/U04/U05、U06/N1（高风险工单写 HITL）、N3（Outbox 表）、N4（试点系统）、N6（任务升级 Session）、P0（52 个 dirty path 归属）"（无 U03） | T10 |
| HANDOFF | §7 M1 | "AgentDefinition、PromptBundle、ModuleVersion、PipelineDefinition、RoleVersion、MountBinding、SkillVersion、KnowledgeSnapshot"（M1 交付清单） | T1/T2 |
| HANDOFF | §8 闸门3 | "未冻结资源、缺失 Connection、Core 被修改或 Extension 越权均阻断发布" | T12/T2 |
| HANDOFF | §8 闸门8 | "前端不得展示 Runtime 未消费的"已安装/已启用"成功态" | T9 |
| HANDOFF | §8 闸门9 | "2.0.8 正式版发布后重新跑官方契约审计再决定生产 pin" | T6 |
| HANDOFF | §8 闸门10 | "Agent 调 Workflow、Workflow 调 Agent 均固定目标版本并产生子 Run；未授权目标不可枚举" | T12/T5 |
| HANDOFF | §8 闸门11 | "Agent→Workflow→Agent 的版本环在外部副作用前被阻断" | T12/T5 |
| HANDOFF | §9 | "不引用 qoderwake 页面作为后端领域模型证据；只可参考 IA、交互与信息密度" | T1（参考边界） |
| HANDOFF | §9 | "不把"有路由/有表/有测试"当成端到端可用；…不把保存成功当成 Runtime 生效" | T9 |
| HANDOFF | §9 | "不把官方示例能力外推为生产保证；以固定版本源码和故障测试为准" | T6/T9 |

注：本稿不含 T3（Trigger 类型/target union 仅经引用 11/12 号稿间接存在）、T7 表述；T11 仅 git 工作区语义一处。

### 4. 本档未覆盖但 01 已证明存在的产品事实（候选）

1. CoT 外露红线未列入 A01–A17 复核事实或 §8 硬闸门（01 跨域事实 1）。
2. Bash/Write 默认开放、工作空间隔离+allowlist+审批要求未出现在任何复核事实/闸门（01 跨域事实 2）。
3. 工作空间文件系统路径约定、`_output/`、present_files 产物契约未提及（01 跨域事实 3）——本档"工作区"仅 git 语义。
4. Credits 用量面板、模型 Auto 选择器/错峰折扣、Group 部分 disabled、@Waker IM 渠道页未提及（01 跨域事实 4/5/6、QW-03）。
5. 自动任务表单事实（atk_ URL 鉴权、触发仅定时|API、手动运行调试语义、无批量字段、最大运行次数/截止日期）未入复核清单（01 QW-06/07、auto-02）。
6. Flow DSL/对话式生成/upsert 存储契约（digest、callSites、generationSessionId）/整数版本无回滚发布草稿 UI 未提及（01 QW-13/15/16）。
7. 市场生态（Skill 市场数据、连接器市场含钉钉/企业微信、知识库共享绑定、公开项目=本地目录或 Git 仓库）、招聘市场、自进化 Skill、活跃度热力图未提及（01 QW-08/09/16）。
8. 看板统一投影三类执行事实与"需要操作/查收结果"动作队列页签未提及（01 QW-01/02）。
9. 目标产品路由缺陷（/resources/connectors 复数 slug 被重写为 skills×~150 且空白）未提及（01 §4.6）。
10. 选择性重做在目标产品页面无任何可见入口（01 QW-14）——本档 A06 只记录我方 native_workflow 不能选择性重做，未记录目标产品对照事实。

---

## 附 · 抽取完整性说明

- 文件缺失情况：六份输入文档全部存在，无缺失；01 对照文档存在。
- D01–D22 齐全性：齐全。22 条全部见于 11 号稿 §11.1"已确定"表（编号连续 D01–D22）；HANDOFF §5 为不带编号的 13 条"不得回退"要点摘录并声明"完整表在 11 号稿 §11"。未决项 U01/U02/U04/U05/U06 在 11 §11.2 与 HANDOFF §6 一致，两处均无 U03（编号跳空，文内无解释）；12 号稿另有 N1–N6，HANDOFF §6 合并列出 U06/N1、N3、N4、N6、P0。
- 事实条数：03 号稿 26 条；05 号稿 35 条；08 号稿 41 条；11 号稿 58 条（另含 T10 专节 D01–D22 共 22 行）；12 号稿 40 条；HANDOFF 45 条；合计 245 条。
- 本底稿只做事实抽取与 01 对照候选罗列，不含冲突判定、修订建议或结论评价。
