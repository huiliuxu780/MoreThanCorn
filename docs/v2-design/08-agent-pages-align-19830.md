# 08 · AgentScope 原生前端与 QoderWake 产品体验复刻

> 版本：v3.0
> 日期：2026-09-08
> 状态：`DOC_REWRITE / UI_NOT_IMPLEMENTATION_READY`
> 目标：Agent/任务/自动任务/AgentFlow 的产品体验以 QoderWake 实测为准，所有运行状态以 AgentScope 原生 API 为准。

## 0. 纠偏

旧前端稿把大量当前 mock、旧平台表和未来推测写成配置页与观测页。现在统一改为：

1. 已观察到的 QoderWake 页面结构和交互可以直接复刻。
2. 自动任务创建、编辑、启停和手动运行已用 TEST 数据闭合；删除、关注动作、失败回滚和 Flow 重跑仍保持 `EVIDENCE_GAP`。
3. Agent 页面不展示平台自创 Session、AgentState、Plan Event、Trace 或 Pipeline 状态。
4. AgentScope API 返回什么状态，页面才展示什么状态。
5. 没有真实 API 的页面不得以 mock 数据伪装完成。

## 1. 信息架构

```text
工作
├── 任务看板
└── 自动任务

资源与员工
├── Agent
├── AgentFlow
├── Workflow
└── 资源
    ├── Skills
    ├── MCP/连接器
    ├── 知识库
    ├── 模型/凭据
    └── 工作空间/项目

数据接入
└── 外部事件与数据源（AgentScope 缺口，规格待真实场景）
```

不加入当前范围：IM/@Agent、市场规模复刻、Group 管理、CLI、Hook 配置。

## 2. Agent 列表

目标体验复刻 QoderWake 管理页已证结构：

- 搜索名称或角色；
- 运行状态、角色、环境、排序筛选；
- Agent 卡：状态、环境、头像、名称、角色、描述、执行数量、最近运行；
- 管理、分享、对话；
- 新建 Agent 入口。

数据边界：

- 名称/system prompt/context/react/invite 来自 AgentScope AgentData。
- 头像、岗位、标签等只作为产品扩展。
- “在线”“运行数量”“最近运行”只有真实 AgentScope/OTel 查询能够支撑后才显示；当前目标页面样本不能证明我们的计算口径。

## 3. Agent 工作区

目标产品已观察到的二级导航可以复刻为页面壳，但每页必须绑定真实 AgentScope 能力。

| 子页 | 数据来源 | 处置 |
|---|---|---|
| 概览 | AgentData + 已证原生执行数据 | 保留；指标不足时隐藏，不造数 |
| 任务看板 | 该 Agent 相关 Session/Schedule Sessions | 复用任务看板投影 |
| 自动任务 | AgentScope ScheduleRecord | 直接采用 |
| 对话 | Session/messages/status/SSE | 直接采用 |
| Skill | Skill library + Workspace skills | 明确安装与加入 Workspace 两态 |
| 连接器 | MCP library + Workspace MCPs | 明确安装与加入 Workspace 两态 |
| 知识库 | KnowledgeBase + SessionKnowledgeConfig 默认 | 真实接入后开放 |
| 项目/工作目录 | WorkspaceManager + SessionConfig | 直接采用 |
| 权限 | ResourceAccess + PermissionContext | 只展示已证规则 |
| WakerFlow | AgentFlow 可调用关系 | 2.0.8 app 集成后开放 |
| 记忆 | AgentScope long-term-memory 实际配置 | 未接通前不展示成功态 |
| 自进化 Skill | 目标产品可见但 AgentScope/我方契约未证 | 延后，不用 mock |
| Agent 档案 | AgentData + 产品扩展 | 保留 |

## 4. Agent 配置页

### 4.1 身份与工作手册

可以使用 IDENTITY、BIBLE/工作手册、PERSONA 的编辑分区，但保存前必须显示编译预览；最终只写 AgentScope `AgentData.system_prompt`。

页面不得宣称 Prompt 可以限制工具权限、文件范围或副作用。

### 4.2 ReAct 与 Context

字段直接由 AgentData 的 react_config/context_config schema 渲染。不能继续维护一套平台同名 config，再由 adapter 翻译。

### 4.3 默认模型

页面文案必须是“新 Session 默认模型”，因为 AgentScope 实际模型在 SessionConfig 或 ScheduleData，不属于 AgentData。

### 4.4 默认 Knowledge/Workspace

同样是新建 Session 时的默认值。Session 详情显示并允许按官方权限修改实际 SessionConfig。

## 5. Skill 页面

Skill 页面必须展示两个不同状态：

```text
我的 Skill 库
└── AgentScope SkillRecord

当前 Agent/Workspace 可用
└── workspace.list_skills(agent_id)
```

### 5.1 用户库

- 列表、详情、来源、版本、enabled、卸载。
- Hub 市场或上传入口按实际可用 Hub 决定。
- 不照搬 QoderWake 数万条市场规模和分类数字。

### 5.2 加入 Agent Workspace

- 从 Library 选择并调用 `/workspace/skill/from-library`。
- 也可以走 Workspace Skill 上传。
- UI 必须展示 partial success：官方批量加入返回 `added` 和 `failed`。
- 从 Library 删除不会移除 Workspace 副本，删除确认必须解释这一点。

### 5.3 禁止

- 不再用平台 AgentSkill 关系冒充 AgentScope mount。
- 不把 Skill 名称写进 Prompt 当作“已注入”。
- 不在 Runtime 未加载 SKILL.md 时显示“已生效”。

## 6. MCP/连接器页面

同样分为 MCP Library 与 Workspace MCP：

- Library：MCPRecord，支持重命名、enabled、重新填写 values、卸载。
- Workspace：通过官方 Workspace API 加入/移除。
- 实际运行：Toolkit.mcps。
- 凭据字段必须 write-only；AgentScope 当前存储语义与平台 KMS 的兼容方案未通过前，不上线编辑。

“连接成功”“工具数”“可用”只能由真实连接和工具发现结果得出。

## 7. Knowledge 与 Workspace

### Knowledge

- 列表/详情以 AgentScope KnowledgeBase API 为准。
- Agent 默认知识库在创建 Session 时写入 SessionKnowledgeConfig。
- Session 中显示实际 knowledge_base_ids 和 RAG 参数。
- 索引未完成、失败或依赖不可达必须显示真实状态。

### Workspace

- 页面使用 Workspace status/directories/files API。
- SessionConfig.cwd 是当前聚焦目录；文案不能误导为 Bash 一定在该目录执行。
- Skill/MCP 的实际挂载结果和文件工作目录在同一 Workspace 页面可追踪。

## 8. 对话页面

### 数据和动作

- 新建 Session：AgentScope Session API。
- 消息历史：`/{session_id}/messages` 游标分页。
- 发送：ChatService chat API。
- 实时输出：`/{session_id}/stream` SSE，消费原生 AgentEvent。
- 状态：Session status。
- 中断：Session interrupt。
- HITL：按官方确认/外部执行事件交互。

### 不再做

- 不走当前 `agent_chat.py` 的自建 session 和固定历史截断。
- 不把事件压成只有 `llm_delta`。
- 不将 ThinkingBlock 解释为可展示隐式推理；产品默认不显示隐式思维链。
- 不为每个 assistant turn 再造平台 Run，除非跨产品业务需求有独立证据。

## 9. 任务看板

我方 `/tasks` 页面直接采用 `.replica/specs/QW-001-task-board.md`，不再继续自行设计。

### 已证布局

- 周期指标；
- 需要操作/查收结果；
- 全部任务；
- 列表/泳道；
- 搜索、Agent/Team、触发方式、状态、周期；
- 任务、执行者、来源、状态、最近更新。
- 五泳道：需要操作、执行中、已完成、排队中、失败/取消。
- 已结束聚合包含成功、失败、取消。
- 触发来源筛选：手动、定时、事件、API、@Agent、对话。

### 数据策略

任务看板是联合只读视图，候选来源包括 AgentScope user/channel Session、Schedule Session、AgentFlow execution 和 Workflow execution。不同来源保留原生详情页。

不能预设：统一 WorkItem 表、查收持久字段、重跑/取消写语义。搜索和泳道已证为服务端查询；补证见 `.replica/research/QW-001-task-board-state-matrix.md`。

## 10. 自动任务

我方 `/autonomous-tasks` 页面直接采用 `.replica/specs/QW-003-005-automation.md`。

### 列表和详情

直接复刻已证指标、筛选、表列、enabled switch、详情概览、触发条件、响应对象、高级设置和运行历史。

### 创建/编辑

直接复刻已证字段：名称、最多五个触发、定时/API、定期/一次性、Agent/AgentFlow、执行对象、最大运行次数、截止日期。事件和定时拉取按数据源 capability 条件出现。

Agent 与 AgentFlow 使用分支表单：

- Agent：Prompt、模型、默认/本地/项目 Workspace；
- AgentFlow：阶段和人工确认节点概览、固定值或 trigger payload 输入映射；
- 保存后 target kind 与 target id 均锁定，切换目标需要新建定义。

### AgentScope 映射

- 定时 Agent → AgentScope ScheduleRecord。
- stateful=false → 每次 fresh Session。
- stateful=true → 多次复用 Session。
- 执行历史 → schedule sessions。
- 手动调试 → 独立 Session，产品统计按目标已证规则排除。
- API → 默认 fresh Session；只有显式 conversation key 才复用 Session，该 key 不承担幂等。
- MQ/Event → 平台外部入口后触发 AgentScope；不另建 Agent scheduler。

### 已闭合与仍阻断

已闭合：创建必填校验、默认启用、编辑、即时启停、手动运行 `running → success`、同一 Session 进入历史和任务看板、手动运行不计自动统计。暂停/max-runs/deadline 只阻止新自动触发，不取消已经运行中的任务。

仍阻断：删除和历史保留、启停失败回滚、运行中取消、API response/error schema、我方鉴权/幂等/限流/重放保护、AgentFlow target 的正式运行方式。

## 11. AgentFlow

产品面可直接复刻 QoderWake 已证内容：

- 列表和新建卡；
- 详情头部；
- 画布/脚本切换；
- 阶段和 Agent 节点；
- 输入参数；
- 版本历史；
- 运行记录；
- 触发配置；
- 对话式创建/修改。

但前端不得在 2.0.8 Pipeline app spike 前实现或宣称：选择性重做、跨进程恢复、任意 DAG、Flow 嵌套、完整运行 trace。QoderWake 页面没有证明这些能力，AgentScope dev 也没有提供 app 层保证。

## 12. Workflow

Workflow 保留现有产品和编辑器。Agent 节点必须调用 AgentScope Session/ChatService；Agent 调 Workflow 的入口未来作为 AgentScope ToolBase。前端不把 Workflow 与 AgentFlow 合并成一个编辑器。

## 13. 观测展示

### 当前允许展示

- Session messages；
- Session status；
- 原生 AgentEvent 实时流；
- Schedule sessions；
- 经过实测接通后由 OTel backend 返回的 Agent/model/tool spans。

### 当前禁止展示为已完成

- 永久完整 Trace；
- 成本与 Token 趋势；
- AgentFlow 阶段 trace；
- 跨 Workflow/Agent/Flow 谱系；
- 自创 plan_progress、decision summary、checkpoint timeline。

现有 `trace-view.tsx` 和 RunEvent API 只能代表旧平台能力，不得默认用于 AgentScope 页面。

## 14. API 适配原则

前端可以继续使用 `/api/*` 同源路径，但后端薄代理必须保持 AgentScope 原生对象语义：

| 产品页面 | 原生能力 |
|---|---|
| Agent | Agent router/storage |
| Chat | Session + Chat routers |
| 自动任务 | Schedule router |
| 自动任务历史 | Schedule sessions |
| Skill 库 | Skill router |
| Agent Skill | Workspace skill router |
| MCP 库 | MCP router |
| Agent MCP | Workspace MCP router |
| Knowledge | KnowledgeBase router |
| Workspace | Workspace router |

薄代理只加租户认证、脱敏和路由适配，不将一次请求拆成 AgentScope 与平台两处可变写入。

## 15. 页面状态要求

每个页面必须真实实现：loading、empty、error、permission denied、partial success、disabled reason。状态文案来自真实 API；不得使用静态“可用/已连接/已生效”。

高风险动作必须有确认和失败回滚：删除 Skill/MCP、移出 Workspace、中断 Session、启停 Schedule、删除自动任务、运行 AgentFlow。

## 16. 实施顺序

1. AgentScope app 原生 API spike。
2. Agent 配置、Session/Chat、Workspace。
3. Skill Library/Workspace 与 MCP Library/Workspace。
4. Knowledge 与真实模型配置。
5. 固化已证任务/自动任务网络契约，继续补删除、关注动作和失败路径。
6. 高保真实现任务看板和自动任务。
7. 2.0.8 Pipeline app spike 后实现 AgentFlow 页面真实状态。
8. 最后接外部数据入口。

## 17. 前端验收门禁

1. 每个“保存成功”都能追到 AgentScope 原生对象变化。
2. 每个“已生效”都能通过下一次 Agent assembly 验证。
3. Skill/MCP Library 与 Workspace 两态不混。
4. 默认模型/知识与 Session 实际配置不混。
5. 无状态自动任务的 fresh Session 可从 schedule sessions 看到。
6. 页面不展示未经验证的 Trace、Token、成本或 Pipeline 状态。
7. 任务/自动任务布局和交互通过目标截图与状态矩阵复核。
8. 自动任务创建/编辑/启停/手动运行按已证矩阵实施；删除、关注动作、失败回滚等未证副作用保持不可实施。

## 18. 证据

- `.replica/CODEBASE_CONTRACT.md`
- `.replica/DOMAIN_MAPPING.md`
- `.replica/research/page-inventory.md`
- `.replica/research/QW-001-task-board-state-matrix.md`
- `.replica/research/QW-003-005-automation-state-matrix.md`
- `.replica/research/network-contracts.md`
- `.replica/specs/QW-001-task-board.md`
- `.replica/specs/QW-003-005-automation.md`
- `research/morethancorn/10-qoderwake-product-research/01-qoderwake-product-observation.md`
- `research/morethancorn/10-qoderwake-product-research/03-agentscope-2.0.8-contract.md`
