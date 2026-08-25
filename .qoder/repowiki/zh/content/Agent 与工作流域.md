# Agent 与工作流域

<cite>
**本文引用的文件**
- [wf-designer.tsx](file://src/pages/wf-designer.tsx)
- [wf-agent-editor.tsx](file://src/pages/wf-agent-editor.tsx)
- [agent-common-config.tsx](file://src/components/agent-common-config.tsx)
- [agent-ops-panels.tsx](file://src/components/agent-ops-panels.tsx)
- [wf-agents-list.tsx](file://src/pages/wf-agents-list.tsx)
- [agent-publish-dialog.tsx](file://src/components/agent-publish-dialog.tsx)
- [wf-api.ts](file://src/services/wf-api.ts)
- [agents.py](file://server/app/routers/agents.py)
- [models.py](file://server/app/models.py)
- [schemas.py](file://server/app/schemas.py)
- [validator.py](file://server/app/validator.py)
- [runner.py](file://server/app/runner.py)
- [registry.py](file://server/app/routers/registry.py)
- [agent_runtime.py](file://server/app/agent_runtime.py)
- [b026phaseb0001_agent_version_release.py](file://server/alembic/versions/b026phaseb0001_agent_version_release.py)
- [c027phasec0001_event_channels_memory.py](file://server/alembic/versions/c027phasec0001_event_channels_memory.py)
- [d028phased1001_eval_sample_agent.py](file://server/alembic/versions/d028phased1001_eval_sample_agent.py)
- [d029phased1002_eval_sample_workflow_nullable.py](file://server/alembic/versions/d029phased1002_eval_sample_workflow_nullable.py)
- [d029phased3001_judge_evolution.py](file://server/alembic/versions/d029phased3001_judge_evolution.py)
- [test_phase_b.py](file://server/tests/test_phase_b.py)
- [test_phase_c.py](file://server/tests/test_phase_c.py)
- [test_phase_d1.py](file://server/tests/test_phase_d1.py)
- [check-history.mjs](file://scripts/check-history.mjs)
- [check-minimap.mjs](file://scripts/check-minimap.mjs)
- [verify-fullstack.mjs](file://scripts/verify-fullstack.mjs)
</cite>

## 更新摘要
**变更内容**
- **新增** Phase D-3 增强评估系统：支持规则判定、模型判定、人工评审三种评判模式
- **新增** 进化补丁管理系统：基于失败运行归因自动生成候选补丁，支持审批工作流和提示词改进
- **增强** 评估样本数据库模型：新增 judge_result 字段存储评判结果，支持 evolution_patch 表管理进化历史
- **新增** 人评覆盖机制：允许人工评分覆盖或补充机器评判结果
- **重大改进** 评估闭环：从样本管理到真实运行评测再到结果分析的完整流程

## 产品概述
本工作流聚焦于"Agent 编辑器（节点图/Inspector/变量选择器/测试运行）""工作流设计器""Agent 版本管理与发布流程"。平台以可视化节点图编排 AI 能力，支持对话编排、自主规划与专家组协作三类 Agent；通过工作流定义、校验、发布与版本快照，形成从编辑到上线的闭环。前端基于 React + @xyflow/react 实现画布与 Inspector，后端 FastAPI 提供工作流与 Agent 的 CRUD、校验、发布与运行接口，数据库使用 SQLAlchemy/Alembic。

**更新** 已集成 Phase B 的 Agent 版本发布系统与 Phase C 的事件通道、跟踪基础设施及新节点类型，并新增 Phase D-1 的四标签 Agent 编辑器界面、Agent 级评估系统、专家组增强功能和综合操作仪表板，形成完整的 Agent 全生命周期管理能力。同时对工作流设计器进行了重大改进，包括LLM节点配置优化、transform节点schema统一、agent-select查询参数改进和内存描述正确注入等。**最新增强** 包括模型语义参数控制（温度调节、历史轮次管理、工具调用辅助模型）、预览模型对比功能、语音合成集成以及增强的聊天历史上下文管理。**新增 Phase D-3** 增强了评估系统，支持三种评判模式和进化补丁管理，形成了从问题发现到自动修复的完整闭环。

## 核心业务流程
- 创建工作流：创建默认包含"开始/结束"的工作流草稿，返回工作流 ID 与初始状态。
- 编辑工作流：在画布中拖拽节点、连线、配置节点参数；右侧 Inspector 按节点类型展示专属配置区；变量级联选择器仅暴露可达上游输出；保存草稿带乐观锁 revision。
- 校验与发布：调用服务端校验规则（图结构、依赖、资源存在性），通过后发布为版本快照并同步关联 Agent 状态。
- **新增** Agent 版本管理：发布生成不可变 AgentVersion 快照，记录 dependency_snapshot 冻结依赖；Release 表管理沙箱/生产环境部署；运行认版本而非活动草稿。
- **新增** 事件通道与跟踪：RunEvent 支持 CONTROL/CONTENT 双通道，自动分配 trace_id/span_id/parent_span_id，支持 token 用量与耗时统计。
- **新增** 新节点类型：exec_reply（回复节点）、exec_memory_variable（记忆读写）、exec_workflow_select（工作流语义选择）、exec_workflow_fixed（固定工作流子执行）。
- 运行与调试：支持单节点试运行、整工作流测试运行；Agent 层提供异步入队与轮询终态；运行事件与结果可观测。
- Agent 三型编辑：对话编排走工作流画布；自主规划提供角色提示词、模型、技能/工具/工作流/知识挂载与预览调试；专家组维护成员池与试运行。
- **新增** 四标签 Agent 编辑器：自主规划 Agent 提供搭建/运行观测/效果评测/版本指标四个标签页，统一入口管理不同形态的 Agent。
- **新增** 评估闭环流程：样本管理 → 真实运行评测 → 多模式评判 → 结果分析 → 进化补丁生成 → 审批应用。

```mermaid
sequenceDiagram
participant U as "用户"
participant FE as "Agent编辑器(wf-agent-editor.tsx)"
participant API as "后端(agents.py)"
participant DB as "数据库(models.py)"
participant RUN as "运行层(runner.py)"
U->>FE : 打开效果评测标签
FE->>FE : 选择评判模式：规则/模型/人工
U->>FE : 添加评估样本并配置输入期望
FE->>API : POST /api/agents/{id}/eval-samples
U->>FE : 启动批量评测运行
FE->>API : POST /api/agents/{id}/eval-run
API->>RUN : 逐个样本真实运行
RUN->>DB : 记录运行结果和事件
API->>DB : 计算评判结果并存储judge_result
FE->>FE : 显示评测结果和成功率
U->>FE : 查看失败原因并生成进化补丁
FE->>API : POST /api/agents/{id}/evolution/candidates
API->>API : LLM生成改进提示词
FE->>FE : 展示候选补丁供审批
U->>FE : 批准应用到草稿
FE->>API : POST /api/agents/{id}/evolution/{pid}/apply
```

**图表来源**
- [wf-agent-editor.tsx:363-422](file://src/pages/wf-agent-editor.tsx#L363-L422)
- [agents.py:303-377](file://server/app/routers/agents.py#L303-L377)
- [agents.py:379-446](file://server/app/routers/agents.py#L379-L446)
- [agent-ops-panels.tsx:171-240](file://src/components/agent-ops-panels.tsx#L171-L240)

**章节来源**
- [wf-agent-editor.tsx:1-422](file://src/pages/wf-agent-editor.tsx#L1-L422)
- [agents.py:200-483](file://server/app/routers/agents.py#L200-L483)
- [agent-ops-panels.tsx:1-286](file://src/components/agent-ops-panels.tsx#L1-L286)

## 功能模块清单
- 工作流设计器（画布与 Inspector）
  - 职责：节点家族渲染、连线、属性配置、变量级联选择、调试配置、运行入口。
  - 用户价值：低代码编排 AI 流程，所见即所得。
  - 验收要点：新增/删除节点、连线合法性、变量引用可见性、保存冲突提示、运行反馈。
  - **重大改进** LLM节点配置优化：移除了虚假的单批处理切换开关，该功能在后端无实际语义且未实现，避免误导用户。
  - **重大改进** transform节点schema统一：现在统一使用template字段而非expression，简化了配置结构。
  - **重大改进** agent-select查询参数改进：移除了query参数，改用决策类查询绑定，提升了查询准确性。
- Agent 编辑器（三型分发）
  - 职责：对话编排（复用工作流画布）、自主规划（角色/模型/技能/工具/工作流/知识挂载+预览）、专家组（成员池+试运行）。
  - 用户价值：统一入口管理不同形态的 Agent。
  - 验收要点：类型路由正确、配置保存带乐观锁、挂载项来自注册表、预览调试可用。
  - **新增** 记忆 Schema 声明：支持 STRING/NUMBER/BOOLEAN/JSON 类型，运行时校验写入键。
  - **新增** 四标签界面：自主规划 Agent 提供搭建/运行观测/效果评测/版本指标四个标签页。
  - **重大改进** 内存描述正确注入：现在在提示词中正确注入memory变量的description字段，提升AI对记忆变量的理解。
  - **新增** 模型语义参数控制：支持温度调节（严谨/平衡/创意）、历史轮次管理、工具调用辅助模型配置。
  - **新增** 预览模型对比：支持主模型与对比模型的实时对比调试。
  - **新增** 语音合成集成：基于浏览器SpeechSynthesis API的语音播报功能。
- 变量选择器与资源选择器
  - 职责：根据拓扑可达性计算祖先集合，仅暴露上游输出；资源选择器拉取注册表 Enabled 项。
  - 用户价值：避免无效绑定，提升配置效率。
  - 验收要点：变量路径格式 {{node.outputs.field}}；资源列表过滤 Enabled。
  - **新增** 系统变量支持：通过 `/api/registry/system-variables` 获取 14 个系统变量（tenantId、userId、sysTime 等）。
- 校验与发布
  - 职责：七条校验规则（开始/终端、无环/孤儿、必填配置、可达引用、依赖存在、结构化产出唯一、分支与出边一致）；发布生成不可变版本快照并收集引用。
  - 用户价值：保障工作流质量与可追溯性。
  - 验收要点：错误定位到节点与问题类型；发布后状态同步。
  - **新增** Agent 版本发布：生成 AgentVersion 快照，冻结依赖（dependency_snapshot），创建 Release 记录。
- 运行与观测
  - 职责：工作流运行、Agent 运行（异步入队+轮询）、事件流、重试/导出。
  - 用户价值：快速验证与排障。
  - 验收要点：运行状态流转、事件明细、超时处理。
  - **新增** 事件通道：CONTROL 控制面事件（node_completed、memory_read/write）与 CONTENT 内容面事件（llm_delta、reply_sent）分离。
  - **新增** Trace 基础设施：每个事件携带 trace_id/span_id/parent_span_id，支持分布式追踪。
  - **新增** 新节点执行器：reply（回复）、memory-variable（记忆读写）、workflow-select（工作流选择）、workflow-fixed（固定工作流执行）。
- **新增** 增强评估系统（Phase D-3）
  - 职责：样本管理、真实运行评测、三种评判模式（规则/模型/人工）、结果统计、进化补丁生成。
  - 用户价值：量化评估 Agent 表现，支持持续优化和问题自动修复。
  - 验收要点：样本增删改查、批量评测运行、多模式评判、成功率计算、结果详情展示、进化补丁审批。
  - **规则评判**：基于期望文本匹配，简单高效但不够灵活。
  - **模型评判**：使用LLM进行智能打分（1-5分），支持失败回退到规则评判。
  - **人工评判**：允许人工评分覆盖或补充机器评判结果，支持备注说明。
- **新增** 进化补丁管理系统（Phase D-3）
  - 职责：失败运行归因、候选补丁生成、审批工作流、提示词改进应用。
  - 用户价值：自动化问题诊断和改进建议，减少人工干预成本。
  - 验收要点：失败归因准确性、候选补丁质量、审批流程完整性、应用安全性。
  - **失败归因**：自动识别超时、工具失败、幻觉等问题类型。
  - **候选生成**：基于LLM分析失败原因并生成改进后的提示词。
  - **审批流程**：支持应用和拒绝两种操作，保留完整历史记录。
  - **安全应用**：仅应用到草稿版本，不影响已发布版本。
- **新增** 专家组成员池管理
  - 职责：成员 Agent 选择、成员池配置、成员冻结版本摘要。
  - 用户价值：灵活组合多个 Agent 形成专家组，支持版本化成员管理。
  - 验收要点：成员选择器、画布节点联动、版本冻结信息展示。
- **新增** 高级知识检索配置
  - 职责：TopK 数量、匹配分阈值、检索模式（混合/语义/全文）配置。
  - 用户价值：精细化控制知识检索效果，平衡性能与准确性。
  - 验收要点：配置项生效、检索模式切换、阈值过滤效果。

**章节来源**
- [wf-designer.tsx:161-657](file://src/pages/wf-designer.tsx#L161-L657)
- [wf-agent-editor.tsx:127-344](file://src/pages/wf-agent-editor.tsx#L127-L344)
- [agent-ops-panels.tsx:84-286](file://src/components/agent-ops-panels.tsx#L84-L286)
- [agents.py:303-483](file://server/app/routers/agents.py#L303-L483)
- [validator.py:54-163](file://server/app/validator.py#L54-L163)
- [workflows.py:101-162](file://server/app/routers/workflows.py#L101-L162)
- [wf-api.ts:315-350](file://src/services/wf-api.ts#L315-L350)

## 数据与状态
- 核心数据模型
  - 工作流与工作流版本：Workflow 存储草稿与当前版本指针；WorkflowVersion 存储不可变定义与引用快照。
  - 节点定义：NodeDefinition 描述节点族、IO、执行器等元信息。
  - **新增** Agent 版本系统：AgentVersion 存储不可变版本快照（definition、common_config、dependency_snapshot、artifact_hash）；Release 管理环境部署（sandbox/prod）。
  - **新增** 运行增强：Run 表增加 agent_version_id、definition_source、parent_run_id（嵌套调用树）；RunEvent 增加 channel、trace_id、span_id、duration_ms、tokens。
  - **新增** 记忆持久化：MemoryRecord 表支持 agent:{agentId} 或 wf:{workflowId} 作用域内的键值存储。
  - Agent：三型 Agent（autonomous/dialogue/expert-group），含配置与乐观锁 revision，以及环境版本指针。
  - 运行相关：Run、NodeRun、RunEvent、CallRecord 记录运行轨迹与外部调用。
  - 资源：Tool/Model/McpServer/KnowledgeSource 等供节点引用。
  - **新增** 评估样本：EvalSample 表支持 agent_id 关联，存储样本名称、输入和期望输出，新增 judge_result 字段存储评判结果。
  - **新增** 进化补丁：EvolutionPatch 表管理失败归因、候选补丁、审批状态和应用历史。
- 关键状态流转
  - 工作流状态：draft → testing → published → deprecated（由业务操作驱动，发布时置 published）。
  - Agent 状态：随其绑定的工作流发布而同步为 published；支持 sandbox_version_id/prod_version_id 环境隔离。
  - **新增** 版本状态：AgentVersion 不可变；Release 状态 active|rolled_back|offline。
  - 运行状态：queued → running → succeeded/failed/cancelled（前端轮询至终态）。
  - **新增** 事件通道：CONTROL（控制面）与 CONTENT（内容面）双通道事件。
  - **新增** 评估状态：样本独立管理，评测运行实时返回结果，评判结果持久化存储。
  - **新增** 进化状态：补丁状态 pending|applied|rejected，支持完整的审批工作流。
- 数据所有权边界
  - 前端负责画布交互与本地状态，后端负责持久化、校验与执行。
  - 资源引用以 ID 形式存储，运行时解析；发布快照固化引用关系。
  - **新增** 版本解析：运行阶段优先使用指定版本或环境解析的版本快照，而非活动草稿。
  - **新增** 样本作用域：评估样本按 Agent 维度隔离，支持跨运行持久化。
  - **新增** 评判结果继承：人工评判可覆盖机器评判结果，形成评判历史。

```mermaid
classDiagram
class Workflow {
+string id
+string name
+string status
+string current_version_id
+jsonb draft_definition
+int draft_revision
+datetime created_at
+datetime updated_at
}
class WorkflowVersion {
+string id
+string workflow_id
+int version_no
+jsonb definition
+jsonb tool_version_refs
+jsonb model_refs
+jsonb mcp_refs
+jsonb knowledge_refs
+string note
+datetime published_at
}
class Agent {
+string id
+string name
+string type
+string status
+string workflow_id
+jsonb config
+int config_revision
+string sandbox_version_id
+string prod_version_id
}
class AgentVersion {
+string id
+string agent_id
+int version_no
+jsonb definition
+jsonb common_config
+jsonb dependency_snapshot
+string artifact_hash
+string note
+datetime created_at
}
class Release {
+string id
+string agent_id
+string agent_version_id
+string environment
+string status
+datetime created_at
}
class EvalSample {
+string id
+string agent_id
+string name
+jsonb input
+jsonb expected
+jsonb judge_result
+datetime created_at
}
class EvolutionPatch {
+string id
+string agent_id
+string attribution
+string reason
+string base_prompt
+string proposed_prompt
+string status
+datetime created_at
}
class Run {
+string id
+string workflow_version_id
+string agent_id
+string trigger
+string status
+jsonb input
+jsonb output
+jsonb error
+datetime started_at
+datetime ended_at
+int duration_ms
+string parent_run_id
+string agent_version_id
+string definition_source
}
class RunEvent {
+string id
+string run_id
+int sequence
+string type
+string node_id
+string node_run_id
+string channel
+string trace_id
+string span_id
+string parent_span_id
+int duration_ms
+jsonb tokens
+jsonb payload
+datetime created_at
}
Workflow "1" -- "0..*" WorkflowVersion : "versions"
Agent "0..1" --> Workflow : "workflow_id"
Agent "1" -- "0..*" AgentVersion : "versions"
AgentVersion "1" -- "0..*" Release : "deployments"
Agent "1" -- "0..*" EvalSample : "samples"
Agent "1" -- "0..*" EvolutionPatch : "patches"
Run "0..*" --> WorkflowVersion : "workflow_version_id"
Run "0..*" --> Agent : "agent_id"
Run "1" -- "0..*" RunEvent : "events"
```

**图表来源**
- [models.py:31-62](file://server/app/models.py#L31-62)
- [models.py:271-323](file://server/app/models.py#L271-323)
- [models.py:221-251](file://server/app/models.py#L221-L251)
- [models.py:371-398](file://server/app/models.py#L371-L398)
- [d028phased1001_eval_sample_agent.py:21-24](file://server/alembic/versions/d028phased1001_eval_sample_agent.py#L21-L24)
- [d029phased3001_judge_evolution.py:24-35](file://server/alembic/versions/d029phased3001_judge_evolution.py#L24-L35)

**章节来源**
- [models.py:31-62](file://server/app/models.py#L31-62)
- [models.py:271-323](file://server/app/models.py#L271-323)
- [models.py:221-251](file://server/app/models.py#L221-L251)
- [models.py:371-398](file://server/app/models.py#L371-L398)
- [b026phaseb0001_agent_version_release.py:1-21](file://server/alembic/versions/b026phaseb0001_agent_version_release.py#L1-L21)
- [c027phasec0001_event_channels_memory.py:22-38](file://server/alembic/versions/c027phasec0001_event_channels_memory.py#L22-L38)
- [d028phased1001_eval_sample_agent.py:1-31](file://server/alembic/versions/d028phased1001_eval_sample_agent.py#L1-L31)
- [d029phased1002_eval_sample_workflow_nullable.py:1-29](file://server/alembic/versions/d029phased1002_eval_sample_workflow_nullable.py#L1-L29)
- [d029phased3001_judge_evolution.py:1-41](file://server/alembic/versions/d029phased3001_judge_evolution.py#L1-L41)

## 关键约束与边界
- 非功能性需求
  - 并发安全：工作流草稿保存与 Agent 配置更新均使用乐观锁（baseRevision/expectedRevision），冲突返回 409。
  - 鉴权与跨域：WF_API_TOKEN 启用后要求 Bearer token；CORS 仅允许 localhost:5173。
  - 性能：变量选择器基于拓扑祖先集缓存；资源选择器按需加载注册表；运行采用异步入队与轮询。
  - **新增** 版本一致性：Agent 运行强制使用版本快照，确保行为可重现；依赖冻结防止运行时漂移。
  - **新增** 事件完整性：所有事件必须携带 trace_id/span_id，支持端到端追踪；token 用量记录用于成本分析。
  - **新增** 评估性能：评测运行同步等待终态，支持批量样本处理，限制单次评测样本数量。
  - **新增** 语音合成兼容性：语音播报功能仅在支持 SpeechSynthesis API 的浏览器中可用，不支持时自动降级。
  - **新增** 评判可靠性：模型评判失败时自动回退到规则评判，确保评估结果可用性。
  - **新增** 补丁安全性：进化补丁仅应用到草稿版本，需要人工审批才能生效，防止自动修改风险。
- 依赖与集成边界
  - 节点 IO 与执行器由 NodeDefinition 与 registry 决定；LLM/Tool/MCP/Knowledge 引用需处于 enabled/ready 状态。
  - 发布流程会收集节点对资源的引用，用于删除防护与审计。
  - **新增** 记忆 Schema 约束：写入记忆前必须验证键是否在 Agent 配置的 memoriesSchema 中声明。
  - **新增** 系统变量规范：14 个系统变量（tenantId、userId、userName、sysTime、language、memberId、formId、robotCode、nick、serviceId、serviceName、phoneNum、onlineChannelSource、initContext）通过注册表暴露。
  - **新增** 知识检索约束：TopK 范围 1-20，匹配分阈值 0-1，检索模式限定 HYBRID/SEMANTIC/TEXT。
  - **新增** 模型参数约束：多样性参数限定 rigorous/balanced/creative，历史轮次范围 1-15，温度值映射为 0.2/0.7/1.1。
  - **新增** 评判模式约束：judge 参数限定 rule/model/human，评分范围 0-5 分。
  - **新增** 进化归因约束：attribution 限定 timeout/tool_failed/hallucination/other，status 限定 pending/applied/rejected。
- 业务约束
  - 工作流必须恰有一个开始节点与至少一个终端节点；条件分支与出边 handle 需一致；结构化输出键需被唯一节点产出。
  - Agent 名称长度上限为 20，前后端共用同一常量。
  - **新增** 版本发布约束：同一 Agent 在同一环境（sandbox/prod）只能有一个 active 的 Release；回滚通过重新部署旧版本实现。
  - **新增** 工作流选择约束：workflow-select 节点必须配置有效候选工作流；未命中时走 miss 分支。
  - **新增** 评估样本约束：样本输入必须符合 Agent 配置的结构化输入；样本名称唯一性不强制但建议有意义。
  - **新增** 进化补丁约束：只有 pending 状态的补丁可被应用或拒绝；应用成功后原提示词被替换，新版本号递增。

```mermaid
flowchart TD
Start(["进入校验"]) --> R1["R1: 检查开始/终端"]
R1 --> R2["R2: 检测环路与孤儿节点"]
R2 --> R3["R3: 必填配置与输入可达性"]
R3 --> R4["R4: LLM 提示词引用可达"]
R4 --> R5["R5: Tool/Knowledge/MCP 依赖存在且启用"]
R5 --> R6["R6: 结构化输出键唯一产出"]
R6 --> R7["R7: 条件分支与出边一致"]
R7 --> R8["R8: Agent 版本依赖冻结"]
R8 --> R9["R9: 评估样本输入校验"]
R9 --> R10["R10: 评判模式有效性检查"]
R10 --> R11["R11: 进化补丁状态约束"]
R11 --> End(["返回 ValidationReport"])
```

**图表来源**
- [validator.py:54-163](file://server/app/validator.py#L54-L163)
- [agents.py:297-321](file://server/app/routers/agents.py#L297-L321)
- [agents.py:303-377](file://server/app/routers/agents.py#L303-L377)
- [agents.py:379-446](file://server/app/routers/agents.py#L379-L446)

**章节来源**
- [validator.py:54-163](file://server/app/validator.py#L54-L163)
- [agents.py:17-22](file://server/app/routers/agents.py#L17-22)
- [workflows.py:84-134](file://server/app/routers/workflows.py#L84-L134)
- [runner.py:38-50](file://server/app/runner.py#L38-50)
- [runner.py:435-469](file://server/app/runner.py#L435-L469)
- [agents.py:297-321](file://server/app/routers/agents.py#L297-L321)
- [agents.py:303-377](file://server/app/routers/agents.py#L303-L377)
- [agents.py:379-446](file://server/app/routers/agents.py#L379-L446)

## 新增特性详解

### Phase D-3 增强评估系统
- **三种评判模式**：支持规则评判（rule）、模型评判（model）、人工评判（human）三种模式
- **规则评判**：基于期望文本匹配，简单高效，适用于确定性场景
- **模型评判**：使用LLM进行智能打分（1-5分），支持失败回退到规则评判
- **人工评判**：允许人工评分覆盖或补充机器评判结果，支持备注说明
- **评判结果存储**：judge_result 字段存储评判模式、分数和相关信息
- **批量评测**：支持一次性对多个样本进行评测，返回详细结果统计
- **用户体验**：评测过程中显示进度，完成后展示成功率和详细结果列表

**章节来源**
- [agents.py:303-377](file://server/app/routers/agents.py#L303-L377)
- [test_phase_d1.py:48-67](file://server/tests/test_phase_d1.py#L48-L67)
- [models.py:371-384](file://server/app/models.py#L371-L384)

### 进化补丁管理系统（Phase D-3）
- **失败归因分析**：自动分析近期失败运行，识别超时、工具失败、幻觉等问题类型
- **候选补丁生成**：基于LLM分析失败原因并生成改进后的提示词，保持原有结构
- **审批工作流**：支持应用和拒绝两种操作，保留完整的历史记录
- **安全应用**：仅应用到草稿版本，不影响已发布版本，支持撤销和再次编辑
- **补丁历史**：记录所有补丁的归因、原因、状态和时间戳
- **用户体验**：候选补丁展示与原提示词对比，便于人工审核

**章节来源**
- [agents.py:379-446](file://server/app/routers/agents.py#L379-L446)
- [agent-ops-panels.tsx:171-240](file://src/components/agent-ops-panels.tsx#L171-L240)
- [models.py:386-398](file://server/app/models.py#L386-L398)
- [d029phased3001_judge_evolution.py:25-35](file://server/alembic/versions/d029phased3001_judge_evolution.py#L25-L35)

### Phase D-1 四标签 Agent 编辑器界面
- **四标签架构**：自主规划 Agent 编辑器提供 Agent搭建/运行观测/效果评测/版本指标四个标签页
- **标签导航**：顶部导航栏显示当前 Agent 基本信息、版本状态和环境徽章，标签切换流畅
- **构建标签**：完整的 Agent 配置界面，包括角色提示词、模型选择、技能/工具/工作流/知识挂载、记忆 Schema 配置
- **运行观测标签**：显示 Agent 级运行指标（总运行、成功、失败、成功率、平均时长、最长时长）和运行记录列表
- **效果评测标签**：样本管理、批量评测运行、结果统计和详情展示
- **版本指标标签**：版本历史、部署状态、成员冻结版本摘要可视化

**章节来源**
- [wf-agent-editor.tsx:363-422](file://src/pages/wf-agent-editor.tsx#L363-L422)
- [agent-ops-panels.tsx:13-190](file://src/components/agent-ops-panels.tsx#L13-L190)

### 专家组成员池增强
- **成员池选择器**：在 Agent 编辑器中提供成员 Agent 选择界面，排除自身 Agent
- **画布联动**：成员池配置后，画布中的 Agent 选择/执行节点可从成员池中选择目标 Agent
- **成员冻结版本**：发布版本时记录成员的冻结版本信息，确保运行期成员版本稳定性
- **版本摘要展示**：版本指标标签中显示每个版本的成员冻结信息，包括成员 ID 和目标版本
- **降级策略**：如果成员未发布版本，运行时回退到草稿并留痕

**章节来源**
- [wf-designer.tsx:431-441](file://src/pages/wf-designer.tsx#L431-L441)
- [wf-designer.tsx:1011-1031](file://src/pages/wf-designer.tsx#L1011-L1031)
- [agents.py:218-231](file://server/app/routers/agents.py#L218-L231)
- [agent-ops-panels.tsx:147-189](file://src/components/agent-ops-panels.tsx#L147-L189)
- [test_phase_d1.py:75-101](file://server/tests/test_phase_d1.py#L75-L101)

### 综合操作仪表板
- **运行指标面板**：展示 Agent 级别的运行统计数据，包括总数、成功数、失败数、成功率、平均时长、最长时长
- **运行记录列表**：显示最近 30 条运行记录，支持点击查看详情和事件时间线
- **事件时间线**：按 run 聚合的事件列表，区分 CONTROL 和 CONTENT 通道事件
- **版本部署状态**：显示各版本的部署环境和生效状态，支持线上/沙箱环境标识
- **实时刷新**：支持手动刷新数据，确保仪表板信息最新

**章节来源**
- [agent-ops-panels.tsx:13-82](file://src/components/agent-ops-panels.tsx#L13-L82)
- [agents.py:283-294](file://server/app/routers/agents.py#L283-L294)
- [test_phase_d1.py:27-46](file://server/tests/test_phase_d1.py#L27-L46)

### 高级知识检索配置
- **TopK 配置**：设置检索返回的最大文档数量，范围 1-20，默认值 3
- **匹配分阈值**：设置文档匹配的最低分数阈值，范围 0-1，默认值 0.5
- **检索模式**：支持混合（HYBRID）、语义（SEMANTIC）、全文（TEXT）三种检索模式
- **配置界面**：在知识挂载处提供高级配置按钮，展开后显示完整配置选项
- **真消费**：配置项在后端实际生效，影响知识检索行为和性能

**章节来源**
- [wf-agent-editor.tsx:98-121](file://src/pages/wf-agent-editor.tsx#L98-L121)
- [wf-agent-editor.tsx:281-293](file://src/pages/wf-agent-editor.tsx#L281-L293)

### AI Prompt 生成
- **智能生成**：基于 Agent 名称和角色描述，使用 LLM 生成中文角色提示词
- **模板库**：提供通用、客户服务、活动咨询、商品导购、销售分析等预设模板
- **生成接口**：POST /api/agents/generate-prompt 接收名称和提示，返回生成的 prompt
- **错误处理**：生成失败时返回明确的错误信息，便于用户排查问题
- **用户体验**：生成过程中显示加载状态，完成后自动填充到角色提示词区域

**章节来源**
- [wf-agent-editor.tsx:235-251](file://src/pages/wf-agent-editor.tsx#L235-L251)
- [agents.py:469-483](file://server/app/routers/agents.py#L469-L483)
- [test_phase_d1.py:69-73](file://server/tests/test_phase_d1.py#L69-L73)

### 运行观测增强
- **指标卡片**：以卡片形式展示关键运行指标，支持百分比和数值格式化
- **运行记录表格**：显示运行 ID、触发方式、状态、耗时、错误信息和时间戳
- **事件详情**：点击运行记录可查看该运行的事件时间线，区分控制面和内容面事件
- **状态标识**：使用颜色标识运行状态（绿色成功、红色失败、黄色进行中）
- **性能统计**：计算平均时长和最长时长，帮助识别性能瓶颈

**章节来源**
- [agent-ops-panels.tsx:13-82](file://src/components/agent-ops-panels.tsx#L13-L82)
- [agents.py:283-294](file://server/app/routers/agents.py#L283-L294)

### 版本指标增强
- **版本历史**：显示所有版本的历史记录，包括版本号、备注、创建时间和 artifact hash
- **部署状态**：显示每个版本的部署环境（线上/沙箱）和生效状态
- **成员冻结**：显示版本发布时冻结的成员信息，包括成员 ID 和目标版本
- **版本对比**：支持查看不同版本的差异，辅助版本管理和回滚决策
- **环境徽章**：使用不同颜色标识线上和沙箱环境的部署状态

**章节来源**
- [agent-ops-panels.tsx:147-189](file://src/components/agent-ops-panels.tsx#L147-L189)
- [agents.py:218-231](file://server/app/routers/agents.py#L218-L231)
- [test_phase_d1.py:75-101](file://server/tests/test_phase_d1.py#L75-L101)

### 工作流设计器重大改进

#### LLM节点配置优化
- **移除虚假开关**：移除了LLM节点的"单次/批处理"切换开关，因为该功能在后端无实际语义且未实现
- **简化配置**：现在LLM节点只保留真实的配置项，避免误导用户
- **用户体验**：减少了不必要的配置选项，使界面更加简洁直观

**章节来源**
- [wf-designer.tsx:476-565](file://src/pages/wf-designer.tsx#L476-L565)

#### transform节点schema统一
- **统一字段**：transform节点现在统一使用template字段而非expression
- **简化配置**：消除了配置歧义，所有转换逻辑都通过template字段表达
- **向后兼容**：保持了与现有工作流的兼容性

**章节来源**
- [wf-designer.tsx:725-757](file://src/pages/wf-designer.tsx#L725-L757)

#### agent-select查询参数改进
- **移除query参数**：agent-select节点不再使用query参数进行查询
- **决策类绑定**：改用决策类查询绑定，提升了查询的准确性和灵活性
- **更好的路由**：改进了Agent选择的路由逻辑，支持更复杂的决策场景

**章节来源**
- [wf-designer.tsx:779-813](file://src/pages/wf-designer.tsx#L779-L813)

#### 内存描述正确注入
- **description注入**：现在在提示词中正确注入memory变量的description字段
- **完整信息**：包含name、dataType、description和defaultValue等完整信息
- **AI理解**：提升了AI对记忆变量的理解和正确使用能力

**章节来源**
- [agent_runtime.py:199-206](file://server/app/agent_runtime.py#L199-L206)
- [runner.py:438-463](file://server/app/runner.py#L438-L463)

### 模型语义参数控制（新增）
- **温度调节**：支持严谨（rigorous=0.2）、平衡（balanced=0.7）、创意（creative=1.1）三种温度模式
- **历史轮次管理**：配置历史对话轮次（1/5/15），控制上下文窗口大小
- **工具调用辅助模型**：可为工具调用单独配置专用模型，提升工具调用的准确性
- **后端真消费**：所有参数在后端实际生效，影响模型调用行为和响应质量
- **配置界面**：在模型配置区域提供直观的三列布局配置界面

**章节来源**
- [wf-agent-editor.tsx:297-330](file://src/pages/wf-agent-editor.tsx#L297-L330)
- [agent_runtime.py:220-240](file://server/app/agent_runtime.py#L220-L240)

### 预览模型对比功能（新增）
- **实时对比**：支持同时运行主模型和对比模型，并排显示结果
- **会话级配置**：对比模型配置仅在当前会话有效，不影响版本配置
- **独立会话流**：对比模型拥有独立的聊天历史和消息流
- **动态切换**：可随时添加或移除对比模型，支持多模型对比
- **用户体验**：对比模式下界面自动扩展为双列布局，清晰区分两个模型的响应

**章节来源**
- [wf-agent-editor.tsx:368-394](file://src/pages/wf-agent-editor.tsx#L368-L394)
- [wf-agent-editor.tsx:141-143](file://src/pages/wf-agent-editor.tsx#L141-L143)

### 语音合成集成（新增）
- **浏览器原生API**：基于Web Speech Synthesis API实现语音播报
- **智能播报**：自动播报最新的AI回复内容，限制最大500字符
- **开关控制**：提供语音播报开关，用户可自由控制是否启用
- **兼容性处理**：在不支持语音合成的环境中自动降级，不影响正常使用
- **无障碍支持**：为视障用户提供语音反馈，提升可访问性

**章节来源**
- [wf-agent-editor.tsx:382-383](file://src/pages/wf-agent-editor.tsx#L382-L383)
- [wf-agent-editor.tsx:414-423](file://src/pages/wf-agent-editor.tsx#L414-L423)

### 增强的聊天历史上下文管理（增强）
- **智能裁剪**：根据historyTurns配置自动裁剪历史对话，控制上下文大小
- **格式转换**：将前端聊天历史转换为后端期望的{user, ai}格式
- **内容限制**：每条消息限制最大2000字符，防止上下文过大
- **双向支持**：同时支持用户消息和AI回复的历史传递
- **性能优化**：仅传递必要的历史轮次，减少网络传输和模型处理开销

**章节来源**
- [wf-agent-editor.tsx:180-186](file://src/pages/wf-agent-editor.tsx#L180-L186)
- [agent_runtime.py:220-233](file://server/app/agent_runtime.py#L220-L233)