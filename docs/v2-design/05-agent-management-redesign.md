# 05 · Agent 管理、原生资源装配与版本发布

> 版本：v3.0
> 日期：2026-09-08
> 状态：`DOC_REWRITE / NOT_IMPLEMENTATION_READY`
> 权威前提：AgentScope app 是 Agent 运行时唯一真相源；本文件只定义必要产品控制面。

## 0. 纠偏结论

旧方案将 Agent、Module、Version、Release、MountBinding、Session、Runtime Provider 和 AgentState 全部建成平台模型，再把部分字段送给 AgentScope。这会形成两套 Agent 平台。

新方案不再建立平行运行时：

- Agent 运行配置使用 AgentScope `AgentRecord/AgentData`。
- System Prompt 使用 `AgentData.system_prompt`。
- Model、Knowledge、Workspace 等实际运行选择使用 `SessionConfig`。
- Skill/MCP 实际挂载使用 AgentScope Workspace。
- Toolkit 使用官方 `get_toolkit()`。
- Session、消息和 AgentState 使用 AgentScope storage/ChatService。
- AgentScope 没有版本/发布能力，因此平台只保留不可变的版本发布控制面。

## 1. Agent / Module / Version / Release

### 1.1 Agent

Agent 是产品身份和管理入口。运行时对应 AgentScope `AgentRecord`，核心 `AgentData` 已证字段为：`id`、`name`、`system_prompt`、`context_config`、`react_config`、`invite_config`。

头像、岗位说明、标签、所有者等纯产品展示字段可以作为平台扩展，但不得复制 AgentData 中的运行字段。

### 1.2 Module

Module 只表示可复用的创建模板/预置方案，不再是一条独立运行轨道。无论从预置 Module 还是自定义创建，最终都生成相同的 AgentScope AgentData。

禁止继续保留：

- Custom 和 Module 两套发布链；
- Module manifest/spec 与 Agent.config 同时影响运行；
- Module 专用 runtime builder。

### 1.3 AgentVersion

AgentScope 2.0.7 没有 Agent 版本发布模型，而产品已经要求版本化，因此平台可以保留不可变 AgentVersion，但内容必须使用 AgentScope-native schema：

```text
AgentVersion
├── AgentData snapshot
├── session-defaults snapshot
├── workspace-resource manifest
├── external-tool manifest
├── agentscope_version
└── content_digest
```

`session-defaults` 只是新建 Session 的默认值。运行中的 Model、Knowledge、Workspace 仍以 SessionConfig 为真相源。

### 1.4 AgentRelease

Release 只回答“允许创建新 Session 的发布版本是什么”，不参与每回合拼装另一套运行配置。

```text
AgentRelease
├── agent_version_id
├── environment/status
├── materialization_status
├── agentscope_agent_id
└── verification result
```

发布必须将 AgentVersion 确定性物化为 AgentScope AgentRecord 和对应 Workspace 资源。如何保证不可变 materialization 尚需 spike；未验证前不冻结表结构。

## 2. 唯一真相源

| 字段/能力 | 运行真相源 | 平台控制面 |
|---|---|---|
| 名称、System Prompt、ReAct、Context、Invite | AgentData | AgentVersion 冻结快照 |
| 默认模型 | 产品默认值 | 创建 Session 时写入 SessionConfig |
| 实际模型 | SessionConfig.chat_model_config | 不复制 |
| 默认知识库 | 产品默认值 | 创建 Session 时写入 SessionKnowledgeConfig |
| 实际知识库 | SessionKnowledgeConfig | 不复制 |
| 工作目录 | SessionConfig.workspace_id/cwd | 产品项目选择器只提供初值 |
| Session/AgentState | SessionRecord.state | 只保存 ID 引用 |
| Skill/MCP 实际挂载 | Workspace | Release 可冻结资源 manifest，不做 actual state |
| Toolkit | AgentScope get_toolkit() | extra tools 仅补平台独有能力 |

## 3. System Prompt

目标产品 BIBLE/IDENTITY/PERSONA 的编辑体验可以复刻，但它们不是三个运行时 Prompt。

```text
编辑态：IDENTITY + BIBLE/工作手册 + PERSONA
→ 确定性编译、预览、digest
→ AgentData.system_prompt
```

要求：

1. 编译顺序固定并可预览。
2. 保存到 AgentScope 的只有最终 system_prompt。
3. Prompt 不承担工具授权、路径隔离、凭据或预算。
4. 不将用户输入、外部事件 payload 或隐式思维链拼进系统提示词快照。

## 4. Skill 的安装、挂载和运行

AgentScope 已区分用户库和 Workspace，平台必须沿用。

### 4.1 安装到用户库

Hub 安装产生 SkillRecord，保存名称、描述、来源、Hub/Card、版本、SKILL.md 摘要和 enabled。此时 Skill 还没有进入某个 Agent 的 Workspace。

### 4.2 加入 Workspace

使用 AgentScope `/workspace/skill/from-library`，或 `/workspace/skill` 上传，将 Skill archive 安装进指定 Agent/Session Workspace。

### 4.3 运行装配

```text
workspace.list_skills(agent_id)
→ Toolkit(skills_or_loaders=...)
```

平台不再创建另一张 AgentSkill/MountBinding 作为实际挂载真相源。产品页面上的“已安装”和“此 Agent 可用”必须分别对应 Library 与 Workspace。

### 4.4 已知缺口

SkillRecord 当前不保存完整 archive，从 Library 加入 Workspace 时会回 Hub 下载；官方源码明确留有 Hub 消失后的保全 TODO。Release 的长期可复现性不能假装已解决。后续 spike 只比较固定 Hub artifact、最小 blob 保全或上游演进，不先造复杂 SkillVersion 体系。

## 5. MCP 的安装、挂载和运行

### 5.1 用户库

安装或手工添加产生 MCPRecord，其中 `client: MCPClient` 是可连接配置。

### 5.2 Workspace

使用 AgentScope `/workspace/mcp/from-library` 或 Workspace MCP API 加入。官方语义中 Workspace `.mcp` 是实际状态，MCPRecord 是来源/期望状态。

### 5.3 运行

```text
workspace.list_mcps(agent_id, session_id)
→ Toolkit(mcps=...)
```

平台不得建立第三份 MCP actual state，也不得把 MCP 简化成工具名数组和固定 env URL。

### 5.4 凭据

AgentScope 2.0.7 MCPRecord 的 values/client 配置可能含明文秘密。是否用平台 KMS 加密或替换存储必须单独做安全兼容审计，不能双写形成漂移。

## 6. Tool

AgentScope app 没有通用 ToolRecord 市场，但提供明确装配入口：

- Workspace built-ins：官方 Workspace 提供。
- Task/Schedule/Team/Background tools：官方 get_toolkit 提供。
- MCP tools：MCPClient 提供。
- Middleware tools：Middleware.list_tools 提供。
- 平台独有工具：`extra_agent_tools(user_id, agent_id, session_id)` 返回 AgentScope ToolBase。

因此平台可以保留 Tool Catalog 作为产品控制面，但每个可运行工具必须最终构造成 ToolBase，不能另建一套 Agent 工具协议。

一期 extra tools 只考虑已证缺口：`run_workflow`、2.0.8 app 集成验证后的 `run_agent_flow`、明确业务数据工具。是否通过外部执行事件 park/resume，要用 `RequireExternalExecutionEvent / ExternalExecutionResultEvent` 实测。

## 7. Knowledge、Workspace 与 Model

### 7.1 Knowledge

KnowledgeBase 由 AgentScope 管理；Session 通过 SessionKnowledgeConfig 保存 knowledge_base_ids 和 RAGMiddleware 参数。Agent 管理页只配置默认值，新 Session 创建时写入。

### 7.2 Workspace

Workspace 由 WorkspaceManager 分配，SessionConfig.workspace_id/cwd 指向。Skill、MCP、文件和内置工具均通过同一 Workspace 生效。

### 7.3 Model

模型不是 AgentData 字段。Agent 的“默认模型”只是 Session 创建默认值；实际执行由 SessionConfig.chat_model_config 或 ScheduleData.chat_model_config 决定。

## 8. Session 与执行

- 用户对话：复用长期 Session。
- 无状态 Schedule：每次 fire fresh Session。
- 有状态 Schedule：复用 schedule 固定 Session。
- 手动一次性 Agent 执行：若走 AgentScope app，同样使用独立 Session；产品上不必展示为对话。
- 平台不得复制 AgentState、消息或官方 AgentEvent。
- Pipeline 的 Session 托管等待 2.0.8 spike，不发明答案。

## 9. API 边界

### 9.1 直接代理或复用 AgentScope

- Agent CRUD；
- Session CRUD/status/messages/stream/interrupt；
- Schedule CRUD 与 schedule sessions；
- Skill/MCP library；
- Workspace skill/MCP/files/status；
- KnowledgeBase；
- Model/Credential（安全审计后）。

代理层只做租户认证、权限、字段脱敏和产品路由适配，不得把原生对象拆写进多套平台表。

### 9.2 平台补充

- AgentVersion/Release 控制面；
- Module 模板目录；
- Workflow 与数据接入；
- AgentFlow 产品控制面（2.0.8 spike 后）。

这些 API 不承担 AgentScope 已有运行生命周期。

## 9.3 Flow 与 Workflow 如何注册

两个 Flow 必须分开：

- `Workflow` 是现有确定性编排资产，继续注册在 MoreThanCorn Workflow 控制面；其中 Agent 节点调用 AgentScope Session/ChatService。
- `AgentFlow` 是 AgentScope Pipeline 的产品控制面。AgentScope 2.0.8-dev 目前只有 `PipelineProtocol/GoalPipeline`，没有 app 级 registry、storage 和 HTTP CRUD，所以不能谎称“已注册进 AgentScope”。

在正式 spike 闭合前只冻结两条调用边：

```text
自动任务 → 解析已发布 AgentFlow 版本 → 构造官方 Pipeline → 执行
Agent → extra_agent_tools 中的 run_agent_flow ToolBase → 同一入口
```

AgentFlow definition/version 若最终仍需由平台保存，只保存 AgentScope 没有的控制面事实；Pipeline 的运行状态、事件和 Session 归属必须等 2.0.8 app spike 后按官方能力决定，禁止先接回旧 Agent Runner。

## 10. 当前代码迁移审计

### 必须退出运行主链

- `agent_chat.py` 的自建 Session、截断历史和 llm_delta 旁路。
- `runtime_providers` 将 AgentScope 压成 execute/status/trace 的主路径。
- `adapter.py` 的固定 MCP URL、env model credential 和自建 trace mapper。
- `Agent.config.skills/workflows/connections` 作为运行配置。
- `AgentSkill` 作为 AgentScope 实际 Skill mount。
- 平台自建 Agent schedule。

### 可能保留但必须瘦身

- Agent/Version/Release：只作产品身份和不可变控制面。
- Tool/Skill/Knowledge/MCP 表：只有 AgentScope 没有的产品扩展字段才能保留。
- Run/RunEvent：只保留 Workflow、批量、业务写回等非 AgentScope 职责；Agent 观测不得双写。

## 11. 门禁

1. Agent CRUD 最终读写 AgentScope AgentRecord/AgentData。
2. IDENTITY/BIBLE/PERSONA 编译后只写一个 system_prompt。
3. 模型和知识库实际值来自 SessionConfig。
4. Skill/MCP 清楚区分 Library 与 Workspace。
5. Toolkit 由官方 get_toolkit 组装。
6. 平台 extra tool 是 ToolBase，不是第二套工具协议。
7. 无 AgentState、Message、Schedule、MCP actual state 双写。
8. Release 可复现性缺口有真实 spike 结果。
9. AgentScope app 通过真实模型、Skill、MCP、Knowledge 和重启恢复测试。

## 12. 开放问题

- AgentVersion 如何物化为不可变 AgentRecord，而不破坏可编辑 Agent 身份？
- Skill archive 保全采用上游能力还是最小平台 blob？
- MCP 凭据如何接入现有 KMS 且不形成双写？
- 默认模型/知识/Workspace 在 Agent、Schedule 和手动 Session 之间如何继承？
- 2.0.8 Pipeline 中各 Agent 的 Session/State 如何进入 app 层？

这些问题必须通过 spike 或上游契约回答，实施者不得自行拍板。
