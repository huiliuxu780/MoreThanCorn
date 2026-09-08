# AgentScope 全量接线方案审计报告

> 日期：2026-09-08
> 审计对象：`docs/v2-design/11-agentscope-full-integration.md`、`12-event-driven-workorder-pipeline.md`、`03-trigger-and-data-mapping.md`，以及与之直接冲突的 `05-agent-management-redesign.md`、`08-agent-pages-align-19830.md`
> 审计方法：读取当前未提交工作区中的后端模型、路由、Runtime Contract、AgentScope adapter、Module manifest/实现、全部 Agent 工作区前端；在正在运行的前端做页面实测；以 AgentScope 官方仓库固定提交与 PyPI 为外部证据
> 代码变更：本轮没有修改业务代码；只修订设计与交接文档

## 0. 审计结论

**原 v4.1 总计划不能直接进入 P0 实施，结论为“回炉后有条件通过”。**

问题不是 AgentScope 选错了，而是平台当前同时存在三套互不闭合的 Agent 定义与能力挂载路径：

1. `Agent.config`：自定义角色、旧自主 Agent、前端连接器/Workflow/Knowledge 挂载都写这里；
2. `AgentSkill`：工作区 Skill 页使用独立关系表；
3. Module manifest + `defaultSpec`：Module 的核心指令、工具、主数据、Schema 来自代码资产。

三套路径在“编辑、发布冻结、聊天、结构化运行”四个环节的消费规则不同。继续只增加 Pipeline/Planning 表单，会产生第四套只在 UI 中存在的配置，并不能得到一个真正可发布、可运行、可恢复的 Agent。

本报告给出的修正结论：

- Agent 仍是用户看到、版本化和发布的根资产；内部分派者、核验者、执行者默认是该 AgentVersion 内的**角色定义**，不要求每个都开发成顶层 Agent；
- 方案 A 是固定质量 Pipeline，采用 AgentScope 2.0.8-dev 的 `PipelineProtocol`/事件模型，但需自研薄的 `QualityPipeline` 控制器以实现选择性重做、状态持久化和平台事件契约；不能直接套 `GoalPipeline`；
- 方案 B 是一个 Agent 的 Planning 能力；Planning 与 Pipeline 不是互斥类型，Pipeline 的某个执行角色也可以启用 Planning；
- Chat 的每一轮是一个 Run；多轮关系由 Session 管理。无状态单次任务只创建 Run，不应为了“统一”伪造 Session；需要暂停/恢复的 Pipeline 使用 `ExecutionState/Continuation`，不要冒充聊天 Session；
- 批量分析不是另一种 Agent 执行模式，而是 Task/Trigger 对同一 AgentVersion 发起 N 个 Run 的调度策略；“自动任务”可包含批量策略，两者不是两套执行内核；
- Skill/Tool/Knowledge/Workflow 必须归一成有作用域、有版本或快照、有发布闭包的 Mount，而不是继续散落在 JSON 和关系表中；
- 原 `native_workflow.py` 是行为 POC，只保留测试意图与样本，不作为生产骨架增量修补。

## 1. 审计范围与证据边界

### 1.1 工作区状态

- 审计开始时 `git status --short` 有 51 个路径项；其中包含大量未提交前端、服务端、Runtime 和文档修改。
- 因此“代码零改动”只能解释为“原计划作者没有为该计划另改代码”，不能解释为“审计对象建立在干净或已提交代码上”。
- 本报告把事实分为：已提交基线、当前未提交可见实现、未来设计。后两者不得互相冒充。

### 1.2 AgentScope 基线

- PyPI 当前最新为 `2.0.7.post1`，没有 `2.0.8` 发布物；
- 官方仓库主干提交 `ff8697ec4d59ee01f3766176e70cb24ee894d6c6` 的 `_version.py` 声明 `2.0.8`；
- 因此本文统一称 **AgentScope 2.0.8-dev@ff8697e**。开工时应固定完整 commit 与 lock/hash，不能写成 `pip install agentscope==2.0.8`，也不能把主干 API 当成稳定承诺。

官方复核入口：

- PyPI：<https://pypi.org/project/agentscope/>
- 版本文件：<https://github.com/agentscope-ai/agentscope/blob/ff8697ec4d59ee01f3766176e70cb24ee894d6c6/src/agentscope/_version.py>
- PipelineProtocol：<https://github.com/agentscope-ai/agentscope/blob/ff8697ec4d59ee01f3766176e70cb24ee894d6c6/src/agentscope/pipeline/_base.py>
- GoalPipeline：<https://github.com/agentscope-ai/agentscope/blob/ff8697ec4d59ee01f3766176e70cb24ee894d6c6/src/agentscope/pipeline/_goal_pipeline.py>
- 官方示例：<https://github.com/agentscope-ai/agentscope/tree/ff8697ec4d59ee01f3766176e70cb24ee894d6c6/examples/pipeline/goal>

## 2. 阻断性发现

### F01 · 三套定义源没有统一发布闭包（阻断）

证据：

- `Agent.config` 是任意 JSON：`server/app/models.py:354-376`；
- Module 创建仅写 `config={spec,modelRef}`：`server/app/routers/agents.py:54-78`；
- 自定义角色把 Skill ID 写进 `config.skills`：`server/app/routers/agents.py:35-44`；
- Skill 工作区另写 `AgentSkill`：`server/app/models.py:437-445`、`server/app/routers/agent_caps.py:97-125`；
- Module 版本快照在 `freeze_dependencies()` 的 Module 分支提前返回，只冻结 manifest 内工具/模型/主数据/Schema，不读取 `AgentSkill` 或前端挂载：`server/app/agent_release.py:112-144`。

影响：同一个页面显示“已安装”并不代表聊天生效、结构化 Run 生效或 Release 已冻结。发布后改 Skill/Knowledge 还可能使运行语义漂移。

修正：新增统一 MountBinding 草稿模型，至少包含 `resource_type/resource_id/version_policy/pinned_version_id/scope/stage_key/slot_key/source(core|extension)`；AgentVersion 必须冻结完整闭包。

### F02 · Custom Agent 当前不可结构化运行、不可发布（阻断）

证据：

- Custom 创建时 `type=custom`、无 `module_key`、无 `workflow_id`：`server/app/routers/agents.py:35-53`；
- `build_definition()` 只认识 Module、`autonomous`，其余类型都要求 Workflow；Custom 因无 Workflow 会报错：`server/app/agent_release.py:19-56`；
- `/run` 最终走 `run_agent()`，非 Module 的新 Custom 没有完整执行分支；
- Chat 是另一条本地 `_chat_completion` 路径，不经 Runtime：`server/app/agent_chat.py:100-162`。

影响：前端把 Custom 表现为可创建、可聊天、可编辑的 Agent，但它不是与 Module 同等的可版本化执行资产。

修正：Custom 不能继续作为特殊类型旁路。它应编译为同一 AgentDefinition，选择 `runner=agent`，可启用 Planning，并走同一 AgentVersion/Release/Runtime。

### F03 · Custom 的 Skill 创建表单与 Skill 工作区不是同一挂载（阻断）

证据：

- 创建页选择的是资源 ID并提交 `skills`：`src/pages/agent-create.tsx:83-95,253-268`；
- 服务端只把这些 ID 保存到 `Agent.config.skills`，不创建 `AgentSkill`：`server/app/routers/agents.py:39-49`；
- Chat 只查询 `AgentSkill`，并且只把 Skill 名称放进 Prompt，不使用正文：`server/app/agent_chat.py:40-45`；
- Skill 子页查询与安装也只使用 `AgentSkill`：`src/pages/agent-workspace/skills.tsx:24-48`。

影响：用户在“创建角色”时选中的 Skill 对 Chat 不生效，进入 Skill 页还可能显示未安装。

修正：删除 `config.skills` 作为新体系写入口，全部走 MountBinding；Skill 正文在 Runtime 由 AgentScope Skill/loader 消费。

### F04 · Module 页面允许安装扩展，但 Runtime 和 Release 不消费（阻断）

证据：

- `wf-agent-editor.tsx` 只把非 Module 设为只读，因此 Module Skill 页可安装/上传：`src/pages/wf-agent-editor.tsx:87-98`；
- 安装仅产生 `AgentSkill`：`server/app/routers/agent_caps.py:97-125`；
- RuntimeExecuteRequest 的 AgentExecutionSpec 只有 instructions/model/tools/master_data/output_schema：`packages/runtime_contract/src/quality_runtime_contract/models.py:66-89`；
- dispatcher 也只组装上述字段：`server/app/runtime_providers/dispatcher.py:33-95`。

影响：UI 提供了成功反馈，但运行结果没有任何变化，是“幽灵配置”。

修正：在 Runtime Contract v1.2 与 AgentVersion 中增加规范化 mount/role/pipeline spec；在完成端到端测试前，前端不得把无消费路径的挂载显示为可用。

### F05 · 现有固定骨架在真实请求中不会被选中（阻断）

证据：

- Module 生成 `metadata.workflowMode`：`server/app/agent_modules/base.py:139-150`；
- dispatcher 草稿/版本请求继续使用 camelCase：`server/app/runtime_providers/dispatcher.py:50-71`；
- adapter 检查的是 `metadata.workflow_mode`：`runtimes/agentscope/app/adapter.py:201`；
- 平台 fixture 测试只断言 camelCase，native workflow 测试又手工构造 snake_case，二者都能各自通过，却没有平台→adapter 集成测试。

2026-09-08 复跑证据：

- `server/.venv/bin/pytest -q server/tests/test_r2_agent_modules.py::test_module_run_dispatch_same_agent_hash_across_providers server/tests/test_r2_agent_modules.py::test_platform_fixture_hash_drift_guard`：2 passed；
- `runtimes/agentscope/.venv/bin/pytest -q runtimes/agentscope/tests/test_platform_module_request.py runtimes/agentscope/tests/test_native_workflow.py`：2 passed。

这四个测试全绿恰好证明问题：平台测试接受 camelCase，Runtime 测试手工输入 snake_case，没有一个测试把平台实际请求交给 adapter 并断言进入 native workflow 分支。

影响：真实平台请求会落到普通单 Agent 分支，`native_workflow.py` 不会执行。

修正：这不是文档命名问题，而是必须放在实施 G0 的跨边界合约测试。修复前不得把 native workflow 写为“已接通”。

### F06 · 当前 POC 不支持选择性重做（阻断）

证据：

- `native_workflow.py` 只有 identify→plan→execute→barrier→synthesize：`runtimes/agentscope/app/native_workflow.py:169-221`；
- 执行项以 `asyncio.gather(*pending)` 汇合，任一异常使整组失败：同文件 `369-384`；
- 仅对结构化输出缺失进行固定两次重试：同文件 `199-219`；
- 没有独立最终 verifier，也没有把“失败的 unit IDs + 反馈”路由回指定执行项；
- 第一条知识声明至少两轮检索、路由器保修查询等是验收 fixture 特例：同文件 `292-321`。

影响：它能证明扇出、工具白名单和屏障，但不能证明生产质检治理骨架，更不能通过用户要求的“只重做失败子项”。

修正：保留行为测试，重写生产 `QualityPipeline`；不要继续给该 POC 叠功能。

### F07 · 官方 GoalPipeline 不是方案 A 的直接实现（阻断）

官方 2.0.8-dev 当前 pipeline 包只导出 `PipelineProtocol` 与 `GoalPipeline`。`GoalPipeline` 的语义是：一个 executor 给出 report，一个 verifier 给出 pass/fail/impossible；fail 时把反馈发回同一个 executor，整个 executor 再跑。

具体限制：

- 没有 dispatcher、fan-out、barrier、stage/unit 概念；
- 没有选择性重做；
- `_iters` 与 `_goal` 存在 Python 实例字段，不在 `AgentState`；进程重启后无法仅凭持久化 AgentState 恢复 Pipeline；
- `verifier_reset_context` 与 `max_retries` 在构造函数中保存，但当前实现没有实际使用；
- pass/impossible/max-iterations 结束时没有独立 Pipeline 终态事件，verifier 的最终 Msg 也不会作为最终结果向外输出；
- `create_app(custom_agent_cls=...)` 接受的是 `type[Agent]`，ChatService 也围绕 AgentState 持久化；不能据“Pipeline 能交给 launch_console”推导“Pipeline 已接入 app/session 服务”。

修正：采用 `PipelineProtocol.reply_stream()` 的可替换形态和 AgentEvent/Msg 流，但由平台 Runtime adapter 构造 `QualityPipeline`，并显式实现序列化 PipelineState、终态、选择性重做和事件映射。

### F08 · Chat 并没有“全面拥抱 AgentScope”（阻断）

证据：

- 每轮 Chat 确实创建 `Run(trigger=chat)`：`server/app/agent_chat.py:71-97`；
- 但执行直接调用 `_chat_completion`，工具列表为空：同文件 `121-162`；
- 历史固定 16 条：同文件 `21,121-130`；
- 附件只拼文件名：同文件 `136-140`；
- Skill 只注入名称，不加载正文：同文件 `40-45`；
- 当前 `AgentChatSession` 没有 runtime state：`server/app/models.py:473-496`。

影响：对话、计划、Skill、工具、AgentScope session 状态彼此割裂。

修正：Chat 走同一 Runtime chat contract；平台 Session 保存产品身份与消息索引，AgentScope AgentState 作为版本化 runtime state blob/引用持久化。每个 turn 仍是 Run。

### F09 · Release 不是完整原子方案发布（阻断）

证据：

- AgentVersion 有 definition/common_config/dependency_snapshot/hash：`server/app/models.py:381-396`；
- Release 绑定 AgentVersion 与 Runtime Provider：同文件 `399-415`；
- Tool 有 ToolVersion，但 Skill 与 Knowledge 都是原地可变：同文件 `154-176,421-445,1039-1054`；
- Knowledge 的“FROZEN”只表示当前 enabled，不包含版本或内容 hash：`server/app/agent_release.py:104-109`；
- Module 分支不冻结页面扩展挂载，Custom 又无法发布；
- Pipeline 实现版本、角色定义、stage mount、重试策略、pipeline state schema 均不在快照。

影响：同一 Release 不能保证重放得到同样的行为，回滚也不是完整回滚。

修正：发布必须冻结 Agent Definition、ExecutionSpec、所有内部角色、核心与扩展 mounts、ToolVersion、SkillVersion/内容 hash、KnowledgeSnapshot、WorkflowVersion、模型、Runtime 包/commit、Pipeline implementation version、Schema 和治理策略。

## 3. 重要但非阻断的实现问题

### F10 · Custom 被前端误标为“已封存·只读”

`const archived = Boolean(agent.archived) || agent.type !== "module"` 使 Custom 永远进入只读壳：`src/pages/wf-agent-editor.tsx:87-100`。于是：

- 顶部对话入口被隐藏；
- Skill、Memory、Connector、Mount 页面变只读；
- 但 Custom Config 又仍然可保存；
- Agent 列表仍给未归档 Custom 展示“对话”。

这不是视觉小瑕疵，而是 lifecycle 与 type 混用。

### F11 · 全量 PUT JSON 有丢更新风险

连接器、Workflow、Knowledge、Custom Config 都复制页面初始 `agent.config` 后整包 PUT：

- 服务端：`server/app/routers/agents.py:196-225`；
- Custom：`src/pages/agent-workspace/custom-config.tsx:36-44`；
- Connector：`src/pages/agent-workspace/connectors.tsx:20-28`；
- Workflow/Knowledge：`src/pages/agent-workspace/mounts.tsx:33-41`。

虽然可携带 revision，但不同子页持有的旧 config 仍可互相覆盖；且服务端允许不带 revision 的旧调用直接放行。

修正：能力挂载、执行配置、身份配置分别使用 PATCH/专用资源端点与统一草稿 revision。

### F12 · Runtime capability 声明大于真实能力

adapter 声明 `skills=True/session=True/streaming=True/cancel=True`：`runtimes/agentscope/app/adapter.py:128-143`，但 execute contract 没有 skills/session，`cancel()` 是空实现，结构化执行只在返回时给完整 RuntimeRun。Capabilities 应由端到端合约测试产生或至少与真实路径一致。

### F13 · 前端没有执行形态配置与 Pipeline 运行可视化

当前工作区固定显示九个栏目：`src/features/agents/AgentWorkspaceShell.tsx:17-30`；Module 配置只允许名称、描述、展示用能力、模型、业务定位，核心资源只读：`src/pages/module-agent-config.tsx:81-90,158-220`。没有：

- runner/Pipeline/Planning 配置；
- 内部角色和 stage 拓扑；
- stage 级 Skill/Tool/Knowledge；
- 选择性重做与尝试预算；
- PipelineState/暂停恢复；
- stage/unit attempt 看板。

Chat UI 只消费 `llm_delta`：`src/pages/agent-chat.tsx:77-109`，不能展示 thinking/tool/task/pipeline 事件。

### F14 · Agent 列表筛选与分页不一致

服务端先分页，前端只对当前页做 type filter/sort：`src/pages/wf-agents-list.tsx:158-173`。筛选标签写“运行时”，实际过滤 `Agent.type`，且没有 Custom 选项：同文件 `210-219`。用户看到的 total 也不是过滤后总数。

### F15 · `Wakerflow` 挂载目前只有存储，没有执行语义

Workflow/Knowledge 页只把 ID 写入 `config.workflows/config.knowledges`：`src/pages/agent-workspace/mounts.tsx:13-44`。Module Runtime 不消费；Custom 不能结构化运行。这里既不能代表 AgentScope Pipeline，也不能代表嵌入式 AgentScope stage。

修正：UI 名称改为“流程/编排”。目标采用双向组合：Agent 通过授权 mount/tool 调用 WorkflowVersion，Workflow 通过通用 agent-run 节点调用 AgentVersion；两者都创建固定版本子 Run，并共用 InvocationGraph 治理。平台 Workflow 仍不是 AgentScope Pipeline。

## 4. 当前前端逐页审计矩阵

| 页面/状态 | 当前数据与 API | 真实作用 | 修订结论 |
|---|---|---|---|
| Agent 列表 | `GET /api/agents`、`GET /api/agents/modules` | 卡片/分页真实；type 筛选和排序只作用当前页 | 服务端化筛选排序；按 capability 展示 Chat/Run，不按 type 猜 |
| 新建 Module | modules/models → `POST /api/agents` | 创建 manifest 实例 | 模板卡保留；改名“内置方案”；展示 runner、核心拓扑、可扩展槽位 |
| 新建 Custom | skills/models → `POST /api/agents` | Skill 只写 config，无法发布/结构化运行 | 改为统一 Definition 草稿；可选单 Agent+Planning，不直接写孤立 Skill ID |
| 概览 | Agent + run stats/memory/capabilities | 主要为展示 | 增加执行形态、版本闭包、核心/扩展区分 |
| 任务看板 | `/agents/{id}/runs` + detail | 只有平面 Run/Event | 增加 root Run→stage→unit attempt 层级与选择性重做记录 |
| 记忆 | `/memory` + revisions | Chat 本地 prompt 使用；Module Runtime 不用 | 区分产品长期记忆、Session AgentState、Run/PipelineState |
| Skill | `/skills` + AgentSkill | Custom 只读错误；Module 可安装但运行不生效 | 改为 MountBinding；显示作用域、版本、核心/扩展、发布状态 |
| 连接器 | 全量 config PUT | Runtime 不消费 | Connection 是 Tool/MCP/Knowledge 的凭据依赖，通常不应作为 Agent 自由挂载 |
| Wakerflow | config.workflows | Runtime 不消费 | 改为“流程/编排”；展示 Agent 可调用的 Workflow mounts 与调用该 Agent 的 Workflow 反向引用 |
| 知识库 | config.knowledges | Runtime 不消费 | MountBinding + KnowledgeSnapshot；支持 global/stage scope |
| Config/Module | whole config PUT | 核心 Module 只读；业务定位字段存在路径错误风险（页面写 `spec.purpose`，Module 读取 `cfg.purpose`） | 统一 Execution/Identity/Capabilities 草稿 API；核心不可改，扩展槽可改 |
| Config/Custom | whole config PUT | Chat 人设可生效；发布/Run 不成立 | 归一成同一 AgentDefinition |
| 发布治理 | versions/releases/eval/golden | Module 部分成立；双 Provider 评测与“一 Agent 一 Provider”发布约束概念混杂 | 评测 provider 可多选，Release 仍单 provider；文案明确 |
| Chat | session/message/turn/upload | 本地模型旁路；附件与 Skill 假接线 | 改走 AgentScope chat contract；渲染 AgentEvent/Task/Pipeline 事件 |

视觉实测证据：

- `screenshots/01-agent-list.png`
- `screenshots/02-custom-home.png`
- `screenshots/03-custom-config.png`
- `screenshots/04-custom-skills.png`
- `screenshots/05-module-skills.png`
- `screenshots/06-module-config.png`

## 5. Skill / Tool / Knowledge / Workflow 的真实结构

| 资源 | 当前版本性 | 当前 Agent 挂载 | Chat 消费 | Module Run 消费 | Release 冻结 | 结论 |
|---|---|---|---|---|---|---|
| Skill | 无版本，content 原地更新 | `AgentSkill` 与 `config.skills` 双轨 | 仅 AgentSkill 名称 | 否 | 否 | 必须 SkillVersion 或内容快照+hash |
| Tool | ToolVersion | legacy `config.tools`；Module manifest 逻辑名 | 否 | manifest 工具名经 gateway | Module 发布解析最新 ready 版本 | 需 mount 固定 ToolVersion ID，不能仅靠同名最新 |
| Knowledge | 无版本，source_config 原地更新 | `config.knowledges` | 否 | 否 | 只冻结 enabled 状态 | 需 KnowledgeSnapshot/IndexRevision |
| Workflow | WorkflowVersion | `config.workflows` | 否 | 否 | legacy Agent 可冻结 current version | 目标为双向子运行：Agent mount/tool → WorkflowVersion；Workflow agent-run → AgentVersion |
| Connection | 本身有凭据/环境治理 | `config.connections` | 否 | 间接经 Tool/MCP | 非 Agent 依赖闭包 | 不应作为普通能力与 Skill 并列自由挂载 |

目标 MountBinding 至少为：

```json
{
  "resourceType": "skill|tool|knowledge|workflow",
  "resourceId": "...",
  "versionPolicy": "pinned|latest_draft",
  "pinnedVersionId": "...",
  "scope": "global|stage|role",
  "scopeKey": "execute.claim-checker",
  "slotKey": "evidence_methods",
  "source": "core|extension",
  "enabled": true
}
```

`latest_draft` 只能用于草稿预览；生成 AgentVersion 时必须解析为不可变版本或内容快照。

## 6. AgentScope 2.0.8-dev Pipeline 契约审计

### 6.1 官方已提供的事实

`PipelineProtocol` 只要求：

```python
reply_stream(
    Msg | list[Msg] |
    UserConfirmResultEvent | UserInterruptEvent | ExternalExecutionResultEvent
) -> AsyncGenerator[AgentEvent | Msg, None]
```

这说明 Pipeline 可以在 console 等只依赖 `reply_stream` 的调用点替代 Agent。它没有定义：

- Pipeline 配置 Schema；
- PipelineState 的 dump/load；
- stage/unit/run 状态机；
- retry/selective redo；
- 发布版本；
- app ChatService 集成；
- 平台级 terminal result。

这些必须由我方 Runtime Contract 和实现补齐。

### 6.2 GoalPipeline 可复用与不可复用部分

可复用思想：

- executor 与 verifier 分离；
- verifier 使用结构化 verdict；
- verifier feedback 回流；
- HITL/外部执行事件通过 reply_id 返回停住的子 Agent；
- 同一内存实例内恢复时尝试预算不会重置。

不可直接复用：

- 单 executor，不是多 stage；
- fail 重跑整个 executor；
- 没有 checkpoint/持久化 PipelineState；
- 无显式 Pipeline 终态；
- dev 参数存在未实现；
- 不满足质检“失败子项选择性重做”。

### 6.3 方案 A 的生产状态机

```text
accepted
  -> classify/discover
  -> dispatch(units[])
  -> execute(unit attempts in bounded parallel)
  -> verify(each unit independently)
       -> pass: freeze unit result
       -> fail(retryable): only that unit -> next attempt with verifier feedback
       -> fail(non-retryable/exhausted): retain failed unit, do not erase siblings
  -> barrier(policy decides partial/fail)
  -> synthesize(structured result)
  -> final_verify(independent; returns failedUnitIds or synthesis error)
       -> failedUnitIds: reopen only named units, then re-synthesize
       -> synthesis error: redo synthesis only
       -> pass: succeeded
```

必须持久化：`pipeline_version/current_stage/unit states/attempts/inputs or refs/results or refs/verdicts/reply routing/remaining budgets/checkpoint sequence`。进程重启、HITL、外部工具回调都从该状态恢复。

## 7. 统一语义：Agent、Session、Run、Task、Batch

| 概念 | 定义 | 是否总存在 |
|---|---|---|
| Agent | 用户可见、可版本化、可发布的能力方案根资产 | 是 |
| Internal Role | Pipeline 内的 dispatcher/executor/verifier 等角色定义 | Pipeline 才有；默认不是顶层 Agent |
| Session | 多轮对话的连续上下文与参与关系 | 只有多轮交互需要 |
| Run | 一次被接受的执行事实 | 每次执行都有；Chat 每个 turn 也是 Run |
| PipelineState/Continuation | 单次 Run 暂停、恢复和选择性重做所需状态 | 长流程/HITL 才有 |
| Task | 重复执行某 AgentVersion/WorkflowVersion 的业务计划和治理容器 | 自动或批量场景需要 |
| TaskRun | Task 的一次批次执行 | 批量/自动任务触发时存在 |
| Trigger | 何时为 Task 产生 TaskRun | 自动化场景需要 |

因此：

- 无状态一次性输入输出：一个 Run，无 Session；
- 多轮对话：一个 Session，N 个 turn Run；
- 批量质检：一个 TaskRun，N 个 root Run，每个 Run 内可有 Pipeline unit attempts；
- 自动任务：Task + Trigger；其 batching 策略可以 immediate/window/manual flush，不需要另一套“批量分析”执行器。

## 8. 与 11 / 05 / 08 的冲突矩阵

| 原文结论 | 审计结果 | 处置 |
|---|---|---|
| 11：2.0.7 没有 Pipeline，所以 Runtime 内编排明确不做 | 2.0.8-dev 已有 PipelineProtocol/GoalPipeline；用户选择方案 A | 改为引入自有 QualityPipeline，实现 PipelineProtocol |
| 11：15 决策全部冻结 | 后续决定推翻多 Agent/Pipeline/P5 结论，并新增核心/扩展、stage mount、选择性重做及 Workflow/Agent 双向组合 | 旧 15 点降为历史；建立 D01-D22 新决策表 |
| 11：前端交互协议零改动 | 当前 UI 无执行形态、stage mount、Pipeline state/事件 | 必须改前端配置与事件展示 |
| 11：所有能力 1:1 接线即可 | Skill/Knowledge 无版本，Module mounts 不进 contract/release | 先归一数据和发布闭包，再接线 |
| 11：native_workflow 是 B2 生产化起点 | 当前含 fixture 特例且无 verifier/选择性重做 | 行为 POC 存档，生产骨架重写 |
| 05：Agent 是非对话批量对象、没有对话预览 | 当前产品已实现 Chat，用户明确要对话与触发 | 删除该前提，Chat 与 structured run 并列 |
| 05：Skill 首期是工具打包型 | 当前 SkillResource 是 SKILL.md；AgentScope Skill 也是过程知识 | Skill 与 Tool 分离；可另有 CapabilityBundle，但不冒充 Skill |
| 05：多 Agent V2 不做 | 方案 A 明确包含内部分派/执行/核验角色 | 改为“内部角色进入 V2；顶层多 Agent 市场化不做” |
| 08：详情三 tab、无侧栏、无对话 | 当前已经九子页侧栏与独立 Chat | 将 08 改为现状审计+目标 IA，而非未实施稿 |
| 08：按运行时过滤 | `type` 不等于 Runtime Provider/执行形态 | 拆分方案类型、执行器、Provider 三种标签 |

### 8.1 用户补充的目标产品关系模型

用户在审计完成后补充了目标产品的观察：对话中的 Waker 可主动列出/调用 WakerFlow；自动任务也可先启动 WakerFlow，再由流程节点调度 Waker。该描述在本轮没有作为目标产品官方契约重新验证，因此这里只把它作为产品设计输入，不冒充外部事实证据。

这个输入值得采用的不是名称，而是双向组合和分层：

| 目标产品概念 | 本项目映射 | 必须保留的差异 |
|---|---|---|
| Waker 管理 | AgentDefinition/AgentVersion/Release | Agent 是版本化方案根，不等于 Runtime 对象 |
| WakerFlow 引擎 | 平台 WorkflowVersion/Run/NodeRun | 不等于 AgentScope Pipeline |
| Waker 调 WakerFlow | Workflow MountBinding → AgentScope tool → WorkflowVersion 子 Run | 只能枚举授权资源，生产固定版本 |
| WakerFlow 调 Waker | `agent-run` 节点 → AgentVersion 子 Run | 当前旧 agent 节点已退役，需新实现 |
| 自主任务 | Task + Trigger + TaskRun | 不创造另一套执行内核 |
| BIBLE | PromptBundle.playbook 或可复用 Skill | 只是软约束，不承担权限/状态机 |
| IDENTITY | PromptBundle.identity | 与 lifecycle/authorization 分离 |
| PERSONA | PromptBundle.persona | 只控制交互风格 |
| 子代理调度 | AgentVersion 内部 roles / Planning / Pipeline | 默认不升级为多个顶层 Agent |

相应架构修正：Pipeline 的业务 stages/roles/SOP 改为 ModuleVersion 内声明式 PipelineDefinition；通用控制器只固定版本解析、权限上限、预算、checkpoint、幂等、选择性重做、终态和跨 Agent/Workflow 环检测。双向调用统一为 ChildInvocation/InvocationGraph；环检测只看活动祖先链，合法兄弟重复调用另受总量/预算约束。两个方向不能各自实现递归、取消和副作用规则。

当前代码仍不具备该能力：`server/app/registry.py` 将旧 agent 三类节点标为 deprecated，`server/app/runner.py:migrate_definition` 会把它们改写成 workflow 节点；反方向只有 `config.workflows` 存储，没有 Runtime list/run workflow 工具。这是新目标，不是现状翻案。

## 9. 修订后的实施顺序与闸门

### P0 · 只做归属与证据封版

- 盘点 51 个未提交路径归属，避免覆盖并行工作；
- 固定 AgentScope 2.0.8-dev commit 与依赖 lock 方案；
- 将现有 POC 标记为 POC；
- 不改运行代码。

闸门：工作区归属清楚；本报告与修订文档通过人工审阅。

### G0 · 合约正确性

- 建平台 request→adapter 分支的真实集成测试；
- 校正 capability 真值；
- 定 Runtime Contract v1.2 和事件词表；
- 验证 2.0.8-dev API 固定提交。

闸门：camel/snake、Skill/session/cancel/streaming 等不可再由分立单测各自证明。

### M1 · 统一 AgentDefinition 与 MountBinding

- Custom/Module 同一草稿与版本模型；
- PromptBundle 与声明式 PipelineDefinition；
- Core/Extension、global/stage/role scope；
- SkillVersion、KnowledgeSnapshot、ToolVersion、WorkflowVersion；
- Internal Role 嵌入 AgentVersion；
- PATCH/专用 API，统一 revision。

闸门：同一挂载在编辑、预览、版本、Release、Runtime 五处一致。

### R1 · Runtime Contract v1.2 + Chat

- AgentScope Chat 接管本地 `_chat_completion`；
- Session 保存 AgentState；每 turn 产生 Run；
- Skill 正文、Tool、Knowledge 真正装配；
- Workflow MountBinding 编译为受权 list/run workflow 工具；
- 附件解析与内容进入消息；
- AgentEvent 双通道映射。

闸门：重启后多轮上下文恢复；Skill 正文正负向测试；附件内容可被回答；无旁路模型调用。

### P1 · QualityPipeline 生产骨架

- 实现 PipelineProtocol 和声明式 PipelineDefinition 解释器；
- stage/unit/attempt 状态、bounded fan-out、barrier、独立 verifier；
- 失败 unit 选择性重做；
- checkpoint/HITL/external-result 恢复；
- 结构化终态与平台事件。

闸门：故意让一个子项失败，只重做该子项；兄弟结果和调用次数不变；进程重启可恢复。

### P2 · Planning 模式

- 单 Agent runner 启用 AgentScope TaskContext/Planning tools；
- 计划状态投影到平台事件；
- 工具和副作用仍经平台 Gateway/权限策略；
- 支持 Pipeline 某一 role 内启用 Planning。

闸门：计划不是第二套 Task/TaskRun；内部 task state 不被误当平台自动任务。

### F1 · Agent 工作区改造

- 按 capability 渲染栏目；
- 新增“执行”页；
- Pipeline 只读核心拓扑+可编辑 extension slots；
- Planning 配置与过程面板；
- 发布闭包预览；
- Run 层级事件和选择性重做可视化。
- 双向调用关系与 InvocationGraph 可视化。

闸门：页面不再提供任何 Runtime/Release 不消费的成功操作。

### T1 · Task/Trigger/Batch 合流

- 保留 03 号 Trigger 权威设计；
- 自动任务统一为 Task+Trigger+batching；
- TaskRun 调度固定 AgentVersion/WorkflowVersion；
- Workflow 新增 agent-run 子运行节点，两个调用方向共用 ChildInvocation、版本、预算、取消和环检测；
- 工单 Outbox 单独治理。

闸门：即时一条、窗口攒批、手动批次只改变调度，不改变 Agent 定义和 Run 语义。

## 10. 尚未拍板、不得偷偷写成既定的事项

1. 2.0.8-dev 固定多久后切正式 PyPI 版；建议开发固定 commit，生产发布必须再做升级审计。
2. Skill 采用完整 SkillVersion 表，还是 AgentVersion 内嵌 content+hash；建议完整版本表。
3. Knowledge 的最小可重放单元是配置快照、索引 revision 还是数据快照；需按真实知识服务确定。
4. Pipeline 的最终 verifier 是一票否决还是允许 partial success；质检建议：必检项失败则 Run failed，可选项失败则 succeeded_with_warnings（需要扩状态或结果字段）。
5. 双向子运行首期是否同时支持同步和异步，以及父子失败/取消传播矩阵；方向已经确定，细节仍需 ADR 和故障测试。
6. 高风险工单写操作是否提前引入 HITL；仍属于 12 号稿 N1，不能被 AgentScope 的 RequireUserConfirmEvent 自动替用户拍板。

## 11. 最终判断

“全面拥抱 AgentScope”应解释为：Agent 的对话、单次执行、Planning、Pipeline 内部角色都由 AgentScope 运行；不应解释为把 AgentScope app 的 Session、Scheduler、Storage、Knowledge 管理全部照搬进平台，也不应把所有平台资源硬塞进一个 `Agent.config`。

平台仍负责身份、版本、Release、Task/Trigger/Batch、权限、外部副作用、业务结果与审计；AgentScope 负责 Agent/Pipeline 的运行语义。二者通过可验证的 Runtime Contract 相接。

在完成 G0 与 M1 以前，不建议进入功能开发；否则前端每增加一个选项，都会继续扩大“看起来能配置、实际不生效”的范围。
