# 05 · Agent 管理、版本与发布模型

> 日期：2026-09-08
> 版本：v2.1（双向子运行与 PromptBundle 补充版）
> 状态：设计稿；未实施
> 上位方案：11 号稿 v5.1
> 说明：本稿取代旧版“Agent 只做批量分析、没有对话”的前提，也取代“Skill 等于工具包”的定义。前端 IA 见 08 号稿。

## 0. 结论

Agent 是用户可见的**完整能力方案根资产**，不是某个 Runtime 类，也不是一段 manifest。它可同时具备：

- 多轮 Chat；
- 单次结构化执行；
- 由版本化定义固定的 Pipeline；
- Planning；
- Task/Trigger 驱动的批量或自动执行；
- Skill、Tool、Knowledge 和受控 Workflow 子调用。

Module 是内置方案模板及受代码评审的核心实现来源。Agent 是某个 Module 的实例或从零创建的自定义方案。AgentVersion 冻结完整可执行闭包，Release 把该版本部署到环境并绑定 Runtime。

## 1. 当前模型的事实与缺口

### 1.1 Agent

当前 Agent 表有 id、name、description、avatar、status、archived、type、module_key/version、workflow_id、config JSON、config_revision、沙箱/生产版本指针。

缺口：

1. type 同时承担历史类型、产品类型和前端可编辑判断，语义过载；
2. config 是无 Schema 的共享 JSON，各子页整包覆盖；
3. Custom 没有 module_key/workflow_id，现有发布编译器不能为它产生 definition；
4. Module 核心来自 manifest，页面扩展来自 config/AgentSkill，二者没有统一；
5. archived 与 type 被前端错误合并，导致 Custom 显示“已封存·只读”；
6. execution、planning、内部 roles、pipeline state schema 都没有模型落点；
7. `config.workflows` 没有 Runtime 消费路径；Workflow 旧 agent 节点又已 deprecated 并被迁移为 workflow 节点，双向组合目前均未闭环。

### 1.2 AgentVersion

已有 definition、common_config、dependency_snapshot、artifact_hash，是正确骨架；但闭包不完整：

- Module 只冻结 manifest 资源；
- Custom 无法创建版本；
- AgentSkill 不进入版本；
- Skill/Knowledge 没有版本；
- config.connections/workflows/knowledges 不进入 Module Runtime；
- Pipeline/Role/State Schema 不存在；
- Runtime package/commit 没有进入 artifact。

### 1.3 Release

已有 environment、runtime_provider_id、runtime_profile、runtime_binding_snapshot、canary_percent。继续保留“Provider 属于 Release，不属于 AgentSpec”的边界。

同一套 Golden Set 可以对多个 Provider 做评测，但不等于同一个有效 Release 可跨 Provider 分流。如果保留“一 Agent 一 Provider”，切换 Provider 必须结束现有 active Release 或走明确迁移操作。

## 2. 目标领域模型

### 2.1 AgentDefinition

Agent 草稿从任意 config JSON 收敛为有 Schema 的定义：

| 区域 | 关键字段 |
|---|---|
| identity | name、description、avatar、labels |
| capabilities | supports_chat、supports_structured_run、supports_batch、supports_hitl |
| runner | kind=agent 或 pipeline；implementation ref |
| planning | enabled、limits、task visibility |
| conversation | greeting、context policy、attachment policy、memory policy |
| prompt_bundle | identity、playbook、persona 及编译顺序/hash |
| input/output | schema refs、structured output policy |
| policies | permission、budget、timeout、retry、parallelism、data class |
| invocation | 可调用资源类型、深度、子 Run、总预算与环检测策略 |
| roles | 内嵌角色草稿 |
| mounts | 统一 MountBinding |
| template | module/template key、core version、derived_from |

runner 与 planning 正交。不要再用 type=autonomous/dialogue/expert-group/custom/module 推导实际执行能力。

### 2.2 ModuleTemplate 与 ModuleVersion

Module 是内置方案的模板，不是每次运行的对象。

- ModuleTemplate：稳定 key、展示信息、风险级、可用能力；
- ModuleVersion：不可变 Core，包括声明式 PipelineDefinition、角色、核心 mounts、Schema 和治理策略；具体阶段、角色和 SOP 不写死在通用控制器；
- Agent 引用一个 ModuleVersion 并保存实例扩展；
- 修改 Core 生成新 ModuleVersion 或派生模板，不原地改实例；
- manifest 首期可继续作为受代码评审的来源，但导入后必须能形成同一版本快照，不能长期与数据库双主。

### 2.3 Internal Role

dispatcher、executor、unit verifier、synthesizer、final verifier 默认是 AgentVersion 内的 RoleVersion，不是顶层 Agent 行。

RoleVersion 至少包含 role_key、instructions、model policy、planning policy、输入/输出 Schema、允许的 extension slots 和 mounts。只有需要独立复用、授权、评测、发布或直接对话时，才提升为顶层 Agent。

### 2.4 MountBinding

Skill、Tool、Knowledge、Workflow 使用同一挂载关系：

| 字段 | 说明 |
|---|---|
| agent_id | 所属 Agent 草稿 |
| resource_type/resource_id | 资源身份 |
| version_policy | 草稿 latest 或 pinned |
| pinned_version_id | 发布时必填或解析 |
| scope | global、stage、role |
| scope_key | stage_key 或 role_key |
| slot_key | 内置方案允许的扩展槽 |
| source | core、extension |
| enabled | 草稿状态 |
| config_revision | 并发控制 |

Connection 不是自由挂载能力；它由 Tool、MCP、Knowledge、Model Provider 间接引用。

Workflow mount 表示 Agent/role 被授权调用某个 WorkflowVersion。其配置还需声明同步/异步、输入输出映射、子 Run 预算和可见工具名。它不是把 Workflow 定义复制进 Agent，也不是 AgentScope Pipeline 的 stage 定义。

## 3. 资源版本规则

| 资源 | 当前 | 目标发布规则 |
|---|---|---|
| Skill | content 原地更新 | SkillVersion；AgentVersion 再保存 content hash |
| Tool | 已有 ToolVersion | Mount 必须固定 ToolVersion ID |
| Knowledge | source_config 原地更新 | KnowledgeSnapshot，包括文档集合与索引 revision |
| Workflow | 已有 WorkflowVersion | 作为受控 callable mount 时固定 WorkflowVersion；Workflow 内 agent-run 节点反向固定 AgentVersion |
| Model | 轻量 version | 冻结 model key、provider-neutral params、version |
| Connection | 环境/凭据治理 | Release 只冻结引用和环境，不复制 Secret |

发布时禁止 latest 漂移；草稿预览可以 latest，但 UI 必须标注“未冻结”。

## 4. AgentVersion 与 Release

### 4.1 AgentVersion

一个 AgentVersion 必须是完整、可校验、可重放的方案：

- AgentDefinition；
- ModuleVersion/Core；
- ExecutionSpec；
- PromptBundle 内容、来源顺序与 hash；
- Pipeline controller/version/state schema；
- 所有 RoleVersion；
- Core 与 Extension mounts；
- ToolVersion、SkillVersion、KnowledgeSnapshot、WorkflowVersion；
- 模型与参数；
- 输入、输出和中间 Schema；
- 权限、预算、超时、并发、重试和 barrier policy；
- InvocationGraph 深度、总子 Run、环检测、取消和幂等策略；
- Runtime Contract 版本；
- AgentScope 精确 package/commit；
- artifact hash。

只要存在未解析 latest、缺失版本、disabled 依赖、无效 stage/slot 或越权 extension，创建版本就失败。状态字段 ready/installed 不能替代依赖冻结。

### 4.2 Release

Release 只做部署期决策：

- AgentVersion；
- environment；
- Runtime Provider；
- runtime profile；
- Connection 环境引用；
- canary；
- active/rolled_back/offline。

回滚等于重新激活完整旧 AgentVersion 的依赖闭包。若 Skill/Knowledge 在旧版本中没有内容快照，不能声称支持完整回滚。

## 5. Run、Session 与 Task

| 概念 | 管理范围 |
|---|---|
| Run | 一次执行事实；Chat 每 turn 也是 Run |
| ChatSession | 多轮消息与 AgentState；不是所有执行的容器 |
| ExecutionState | Pipeline/Planning 单次 Run 的暂停、恢复、checkpoint |
| Task | 重复运行某个 AgentVersion/WorkflowVersion 的业务定义 |
| TaskRun | Task 的一次批次，包含 N 个 Run |
| Trigger | 为 Task 产生 TaskRun |

无状态单次输入输出只创建 Run。自动任务可增加 batching，因此“批量分析”和“自动任务”共享 Task/Trigger/TaskRun，不建立两套内核。

### 5.1 Agent / Workflow 子运行

两个方向使用同一种 ChildInvocation 事实：

- Agent → Workflow：AgentScope 工具调用经 Gateway 发起目标 WorkflowVersion 子 Run；
- Workflow → Agent：`agent-run` 节点发起目标 AgentVersion 子 Run；
- ChildInvocation 记录 parent_run_id、child_run_id、target_type/version_id、mount/node 来源、mode、idempotency_key、budget 和状态；
- 根 Run 投影 InvocationGraph，在活动祖先链上跨 Agent/Workflow 做环检测，不能只检查 workflow_id，也不能把合法的重复兄弟调用误判成环；
- 子 Run 不继承更高权限，不自动创建 Chat Session，也不读取目标资源的可变草稿。

## 6. API 设计

### 6.1 当前 API 的处置

| 当前 API | 问题 | 处置 |
|---|---|---|
| POST /api/agents | Custom/Module 两套 payload | 保留入口，统一写 AgentDefinition 草稿 |
| PUT /api/agents/{id} | 整包 config 覆盖；revision 可省略 | 退役为兼容层；新写入口必须 PATCH 且 revision 必填 |
| POST /api/agents/{id}/skills | 只写 AgentSkill | 迁移到 mounts |
| config.connections/workflows/knowledges | 不是独立 API | 迁移到 mounts |
| POST /api/agents/{id}/versions | 快照闭包不完整 | 改为完整编译、解析、校验、冻结 |
| POST /api/agents/{id}/releases | Module 特例过多 | 对所有新 Agent 统一 |
| POST /api/agents/{id}/run | Custom 不成立 | 对所有可执行 AgentVersion 统一 |
| Chat sessions/turns | 本地模型旁路 | 保留产品 API，后端转 Runtime chat contract |

### 6.2 新 API

建议端点：

- GET /api/agents/{id}/draft
- PATCH /api/agents/{id}/draft/identity
- PATCH /api/agents/{id}/draft/conversation
- PATCH /api/agents/{id}/draft/execution
- GET /api/agents/{id}/draft/roles
- PATCH /api/agents/{id}/draft/roles/{roleKey}
- GET /api/agents/{id}/mounts
- POST /api/agents/{id}/mounts
- PATCH /api/agents/{id}/mounts/{mountId}
- DELETE /api/agents/{id}/mounts/{mountId}
- POST /api/agents/{id}/draft/validate
- GET /api/agents/{id}/draft/dependency-closure
- POST /api/agents/{id}/versions
- GET /api/agents/{id}/versions/{versionId}/dependency-closure
- POST /api/agents/{id}/releases
- POST /api/agents/{id}/runs
- POST /api/runs/{runId}/continuations
- GET /api/runs/{runId}/pipeline-state
- GET /api/runs/{runId}/invocation-graph
- POST /api/runs/{parentRunId}/children（平台内部/Gateway；目标必须是已解析版本）

所有草稿写 API 必须携带 expectedRevision 或 If-Match。服务端对字段局部 merge，返回新 revision 和受影响的发布闭包；不能依赖前端复制旧 config。

### 6.3 Mount API 校验

创建或修改 Mount 时校验：

1. 资源存在且状态可用；
2. scope_key 对应当前 Pipeline/Role；
3. slot_key 允许该 resource type；
4. Core mount 不能从实例 API 删除；
5. Extension 不得扩大工具权限或数据级别；
6. Tool/Workflow 使用有效版本；
7. Skill/Knowledge 草稿可 latest，但发布前必须解析；
8. 变更进入 AuditLog。

## 7. 编译链

统一编译链：

1. 读取 AgentDefinition 草稿；
2. 合并 ModuleVersion Core 与实例 extension；
3. 校验 runner/planning/roles/slots；
4. 解析 MountBinding 版本；
5. 生成 provider-neutral ExecutionSpec；
6. 生成完整 dependency closure；
7. 计算 artifact hash；
8. 创建 AgentVersion；
9. Release 绑定 Runtime；
10. Run 只读取 AgentVersion，不读取可变草稿。

Chat 草稿预览可以读取草稿，但必须显式标记 definitionSource=draft；生产 Chat 绑定环境 Release 或指定 AgentVersion，不能悄悄跟随可变 config。

## 8. 迁移

### M0 · 盘点

- 标记 config.skills、AgentSkill、config.workflows、config.knowledges、config.connections 的真实使用者；
- 禁止新增第四套 execution config；
- 记录现有 Custom/Module 数据迁移规则。

### M1 · 新模型

- 新增 AgentDefinition Schema、ModuleVersion/RoleVersion/MountBinding；
- 增加 SkillVersion、KnowledgeSnapshot；
- 保持旧字段只读兼容。

### M2 · 双读单写

- 新 UI 只写新模型；
- 编译器优先读新模型，旧数据经迁移适配；
- 对同一实例比较旧/新 ExecutionSpec hash。

### M3 · 统一运行与发布

- Custom、Module 都走 AgentVersion/Release/Runtime；
- Chat 移除本地模型旁路；
- 旧 autonomous/dialogue/expert-group 保持历史只读。

### M4 · 退役

- 停止写 config.skills 和 AgentSkill；
- 停止把 Connection 当 Agent mount；
- manifest 从双主降为模板构建源或完全导入；
- 删除兼容 PUT 前先验证无调用者。

## 9. 验收

1. Custom 能创建版本、Release、Chat 和结构化 Run；
2. 同一个 Skill 在创建页、工作区、版本闭包和 Runtime 中身份一致；
3. 修改 Skill 后旧 AgentVersion 行为不变；
4. Module stage extension 只对目标 stage 生效；
5. 删除/替换 Core 被拒绝，派生后可改；
6. 发布闭包无 latest 漂移；
7. 不同子页并发编辑不会互相覆盖；
8. Chat turn 有 Run，Session 重启恢复 AgentState；
9. 无状态 Run 不创建 Session；
10. Provider capability 与真实合约测试一致；
11. 评测多 Provider 不改变 Release 的单 Provider 约束；
12. Agent 能通过授权 mount 调用固定 WorkflowVersion；未授权目标不可枚举、不可调用；
13. Workflow 的 agent-run 节点调用固定 AgentVersion，结果和失败映射可审计；
14. Agent→Workflow→Agent 形成版本环时在外部副作用前被阻断；
15. 全部资源变更和发布都有 AuditLog。

## 10. 不做

- 不把 Skill 定义成 Tool 的别名；
- 不把 AgentScope 内部 Task 合并为平台 Task；
- 不把每个内部角色建成顶层 Agent；
- 不把 playbook/BIBLE 当成权限或状态机；
- 不把 Workflow、AgentScope Pipeline 和 Agent 三者合并为同一实体；
- 不让草稿 latest 引用进入 Release；
- 不继续以任意 config JSON 作为长期权威模型；
- 不在新模型闭环前增加 Pipeline/Planning 表单；
- 不把“保存成功”当作“Runtime 已生效”。
