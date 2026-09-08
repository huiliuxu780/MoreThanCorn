# 审计交接单 · AgentScope 统一运行方案

> 日期：2026-09-08
> 版本：v2.1
> 用途：后续审计者与实施者的唯一入口
> 状态：方案已完成本轮代码/前端/官方源码审计并回炉；业务代码未因本轮审计修改，尚未进入 P0/G0 实施

## 0. 先读结论

原 11 号稿 v4.1 不能直接开工。本轮审计结论是“回炉后有条件通过”，不是“原计划验证无误”。

回炉后的核心模型：

- 平台只有一个用户可见的 Agent 方案根；内置质检、审计、工单核验可以由多个 AgentScope 内部 role 组成，但这些 role 默认不是多个顶层平台 Agent；
- 方案 A 是我方实现 `PipelineProtocol` 的 `QualityPipeline`；具体 stages/roles/SOP 来自版本化 PipelineDefinition，不直接套官方 `GoalPipeline`，也不硬编码唯一业务流程；
- 方案 B 是 AgentScope Planning Agent；Planning 与 Pipeline 正交，Pipeline 的 executor role 可选择启用 Planning；
- AgentScope 负责 Agent、内部 role、Planning、Pipeline 和 Chat 的运行语义；平台继续负责定义、版本、Release、Task/Trigger/Batch、权限、副作用、审计和业务结果；
- Skill、Tool、Knowledge、Workflow 统一经 MountBinding 装配，支持 global/stage/role scope；Core 冻结，Extension 受 slot 和权限上限约束；
- Release 必须原子冻结 Agent 定义、内部 role、Core/Extension mounts、模型、Schema、策略、Runtime/AgentScope 版本和依赖 hash；
- 一个输入产生一个 Run；Chat 的每个 assistant turn 是一个 Run；只有多轮对话才创建 Session；Pipeline 等待/恢复使用 ExecutionState/Continuation；
- 批量是 TaskRun 的输入集合与调度策略，自动任务可以配置 batching，但两者不是两个执行内核。
- WorkflowVersion 与 AgentVersion 支持双向组合：Agent 通过授权 mount/tool 调 Workflow，Workflow 通过通用 agent-run 节点调 Agent；两者不与 AgentScope Pipeline 合表。

在 G0 与 M1 完成前，不应继续扩前端配置项，也不应把现有 native POC 提升为生产骨架。

## 1. 工作区状态与边界

| 项 | 当前状态 |
|---|---|
| Git HEAD | `894245d` |
| 审计开始时 dirty path 数 | 51 |
| 本单更新时 dirty path 数 | 52；新增审计目录使计数增加，原有未提交文件归属仍未解决 |
| 业务代码 | 本轮只读，未修改 |
| 设计文档 | 05/08/11/12 与本交接单已统一修订 |
| 审计证据 | `research/morethancorn/09-agentscope-plan-audit/` |
| AgentScope 基线 | PyPI 仍为 2.0.7.post1；2.0.8 只存在于官方 Git main 源码，审计固定提交 `ff8697ec4d59ee01f3766176e70cb24ee894d6c6` |

“业务代码未修改”只描述本轮审计动作，不等于工作区干净，也不等于 52 个路径都是本轮产物。P0 第一件事仍是做文件归属和基线封存。

## 2. 权威文档

按以下顺序阅读：

1. `research/morethancorn/09-agentscope-plan-audit/AUDIT-REPORT.md`：事实审计、F01–F15、官方 2.0.8-dev 源码核验、冲突矩阵与修订闸门；
2. `docs/v2-design/11-agentscope-full-integration.md` v5.1：运行时、声明式 QualityPipeline、Planning、双向编排、Session/Run 和总分期；
3. `docs/v2-design/05-agent-management-redesign.md` v2.1：Agent/Module/Version/Release、PromptBundle、MountBinding、ChildInvocation、API 与迁移；
4. `docs/v2-design/08-agent-pages-align-19830.md` v2.1：当前页面实测、表单/API 真值、目标工作区、双向关系和 Pipeline 看板；
5. `docs/v2-design/12-event-driven-workorder-pipeline.md` v2.1：Trigger→TaskRun→Run→双向子运行→外部写回；
6. `docs/v2-design/03-trigger-and-data-mapping.md`：入口层既有权威设计，仍未实施。

SDD-12/13/14、旧 00–10、历轮 research 与 qoderwake 调研仅作背景证据。它们与上述文档冲突时，不能倒过来覆盖本轮已纠正的结论。

## 3. 必须独立复核的事实

| 编号 | 事实 | 复核入口 |
|---|---|---|
| A01 | 当前 Agent 定义存在 `Agent.config`、`AgentSkill`、Module manifest/spec 三套来源，编辑、发布和运行没有闭环 | 审计报告 F01；Agent/Skill 模型、agents routes、module loader/builder |
| A02 | Custom 创建时选择的 Skill 写进 `config.skills`，Chat 读取 `AgentSkill`，两条路径断裂 | 审计报告 F03；新建 API 与 `agent_chat.py` |
| A03 | Custom 不能与 Module 一样构建 definition、版本、Release 和结构化 Run；当前主要只有本地 Chat | 审计报告 F02 |
| A04 | Module 页允许安装 Skill、Connection、Workflow、Knowledge，但当前 Runtime/Release 不消费这些页面写入 | 审计报告 F04/F15 |
| A05 | 平台发 `metadata.workflowMode`，AgentScope adapter 查 `workflow_mode`；现有测试分别验证各自拼写，没有端到端命中固定骨架 | 审计报告 F05；dispatcher、adapter 及其测试 |
| A06 | 当前 `native_workflow` 不能选择性重做：并行失败会整体失败，重试只处理结构化输出缺失，没有 unit verifier/final verifier/checkpoint | 审计报告 F06 |
| A07 | 当前 Chat 旁路 Runtime，固定截取历史，只注入 Skill 名称，附件只传文件名，只展示 `llm_delta` | 审计报告 F08；`agent_chat.py` 与 `agent-chat.tsx` |
| A08 | Custom 在工作区壳被 `agent.type !== module` 误标只读，而 Config 又可保存 | 审计报告 F10；前端 workspace shell |
| A09 | 多个子页复制旧 `agent.config` 后全量 PUT，存在并发丢更新 | 审计报告 F11 |
| A10 | capability 声明包含尚未兑现的 Skill/session/cancel/streaming；cancel 当前近似 no-op | 审计报告 F12 |
| A11 | Agent 列表 type/sort 只处理当前页，Runtime 筛选实际混用 type，Custom 选项缺失 | 审计报告 F14 |
| A12 | Module purpose 表单写 `config.spec.purpose`，builder 读取另一层级，保存成功不等于生效 | 审计报告前端矩阵 |
| A13 | Module manifest 仍暴露已退役 provider 元数据 | 审计报告前端矩阵与截图 |
| A14 | Release 当前没有冻结 Skill/Knowledge 等完整可变依赖 | 审计报告 F09 |
| A15 | Runtime Contract v1.0 只有简单 execute/status/trace，没有 pipeline/session/mount/state/continuation | 审计报告 F09 与 11 号稿 §6 |
| A16 | Workflow 旧 agent 三类节点已 deprecated，迁移器会改写成 workflow 节点，不是新版 AgentVersion 调用 | `server/app/registry.py`、`server/app/runner.py:migrate_definition` |
| A17 | Agent 页的 Workflow 挂载目前只写 `config.workflows`，Runtime 没有 list/run workflow 工具 | 审计报告 F15；Agent mounts 前端与 Runtime Contract |

复核者若推翻任一事实，必须给出实际调用链和可复现证据，不能只引用接口名称、UI 文案或单元测试名称。

## 4. AgentScope 2.0.8-dev 官方事实

外部复核入口：

- PyPI：`https://pypi.org/project/agentscope/`
- 固定提交版本：`https://github.com/agentscope-ai/agentscope/blob/ff8697ec4d59ee01f3766176e70cb24ee894d6c6/src/agentscope/_version.py`
- PipelineProtocol：`https://github.com/agentscope-ai/agentscope/blob/ff8697ec4d59ee01f3766176e70cb24ee894d6c6/src/agentscope/pipeline/_base.py`
- GoalPipeline：`https://github.com/agentscope-ai/agentscope/blob/ff8697ec4d59ee01f3766176e70cb24ee894d6c6/src/agentscope/pipeline/_goal_pipeline.py`
- 官方示例：`https://github.com/agentscope-ai/agentscope/tree/ff8697ec4d59ee01f3766176e70cb24ee894d6c6/examples/pipeline/goal`

已验证结论：

1. 2.0.8 尚未在 PyPI 发布；不能写成普通稳定依赖已经可安装；
2. pipeline 包当前公开 `PipelineProtocol` 与 `GoalPipeline`；
3. Protocol 核心是 `reply_stream` 接收 Msg/确认/中断/外部结果并产出 AgentEvent 或 Msg；
4. GoalPipeline 只有一个 executor 和一个 verifier，失败反馈回整个 executor，不提供 unit/stage 级选择性重做；
5. GoalPipeline 的 `_goal/_iters` 是实例内存字段，不等于可跨进程恢复的 PipelineState；
6. `create_app(custom_agent_cls)` 面向 Agent，ChatService 的 AgentState 持久化不能自动推导为任意 Pipeline 的应用接入；
7. 因此方案 A 应实现自有 QualityPipeline 状态机并遵守 PipelineProtocol，而不是声称 GoalPipeline 已覆盖需求。

2.0.8 正式版前，只允许在隔离环境固定上述 commit 做 spike。正式发布后必须重新对照 tag 和 changelog，不能把 main commit 永久当生产版本。

## 5. 已确定的 D01–D22

完整表在 11 号稿 §11。复核时尤其不得回退以下决定：

- AgentScope 是唯一 Agent Runtime；
- QualityPipeline 与 Planning 是两种运行模式且可组合；
- 内部 role 默认内嵌，不要求每个都开发成完整平台 Agent；
- verifier 与 executor 分离，选择性重做是方案 A 的硬验收；
- Core 冻结，Extension 通过受控 slot 挂载；
- Release 冻结完整依赖；
- Chat turn=Run，多轮才有 Session，无状态任务无 Session；
- 批量属于 TaskRun，自动任务可配置 batching；
- native POC 不是生产基类；
- 前端必须随真实模型修改，不能继续宣称“零改动”。
- PipelineDefinition 声明业务 stages/roles/SOP；引擎只固定版本、权限、预算、checkpoint、幂等、环检测和终态不变量；
- Agent→Workflow 与 Workflow→Agent 共用 ChildInvocation/InvocationGraph、版本 pin、权限、预算、取消和环检测；
- IDENTITY/playbook/PERSONA 编译为 PromptBundle；BIBLE 类工作手册是软约束，不能代替硬治理。

## 6. 仍未拍板

这些不能由实施者偷偷定成既定事实：

| 编号 | 未决项 | 当前默认建议 |
|---|---|---|
| U01 | SkillVersion 独立表还是 AgentVersion 内容快照 | 独立版本并在闭包保存 hash |
| U02 | KnowledgeSnapshot 冻结文档集合、索引 revision 或两者 | 两者都冻结，缺任一阻断生产发布 |
| U04 | partial barrier 业务策略 | 逐方案配置；质检关键 unit 失败则整体失败 |
| U05 | 2.0.8 正式版前是否允许生产 | 不允许，只做沙箱 spike |
| U06/N1 | 高风险工单写的 HITL 产品节奏 | 默认 deny/白名单，HITL 单独拍板 |
| N3 | HTTP Outbox 新表还是扩 ResultDelivery | 先比较状态机、迁移、查询和留存 |
| N4 | 首个工单目标系统与动作 | 需真实系统、沙箱、幂等和回读条件 |
| N6 | 自动任务升级为 Chat Session 的权限/归属 | 不随基础 Trigger 默认实现 |
| P0 | 52 个 dirty path 的归属与提交拆分 | 开工前逐路径确认 |

## 7. 实施顺序

### P0 · 基线与归属

- 盘点全部 dirty path 的来源、依赖和是否仍在被其他任务修改；
- 形成可复现审计基线和提交拆分；
- 不在未知变更上直接做模型迁移。

### G0 · 合约正确性

- 先修订并测试 metadata/config 命名与路由契约；
- 定 Runtime Contract v1.2：definition、roles、mounts、pipeline/planning spec、state、continuation、events；
- capability 必须由端到端测试证明，不能人工填大于实现的布尔值。

### M1 · 统一定义与版本

- AgentDefinition、PromptBundle、ModuleVersion、PipelineDefinition、RoleVersion、MountBinding、SkillVersion、KnowledgeSnapshot；
- Custom 与 Module 走同一编译、版本、发布和运行主链；
- 迁移三套旧配置来源，采用双读单写，不继续增加旧写入口。

### R1 · Runtime 与 Chat

- AgentScope 统一执行单次 Run 和 Chat turn；
- Session 持久化 AgentState；附件内容、Skill 正文、Tool、Knowledge 真装配；
- continuation/cancel/stream 以真实验收后再声明 capability。

### P1 · QualityPipeline

- 实现 PipelineProtocol 适配和声明式 PipelineDefinition 解释器，以及 unit 级状态、独立 verifier、选择性重做、barrier、checkpoint、恢复和终态；
- 故障注入证明一个 unit 失败不会重跑已通过兄弟；
- 将 native POC 保留为历史测试或删除需另行授权。

### P2 · Planning

- 单 Agent 与指定 Pipeline role 可启用；
- TaskContext、工具权限、预算和状态事件可观测；
- 副作用不由计划文本绕过平台 Gateway/Policy。

### F1 · 前端

- 生命周期与 type 分离；列表筛选服务端化；
- 新增 Execution 页；能力页统一 MountBinding；
- 工作看板展示 stage/unit/attempt/verifier/retry/waiting；
- 子页 PATCH + revision，禁止旧 config 全量覆盖；
- Chat 渲染真实 AgentScope 事件并保持每 turn 一个 Run。
- 能力页展示可调用 Workflow 与调用本 Agent 的 Workflow；Run 详情展示 InvocationGraph。

### T1 · Trigger/Batch/Outbox

- 实施 03 号稿入口链路；
- Task target 统一引用已发布 WorkflowVersion 或 AgentVersion；
- 自动/批量默认不创建 Session；
- 外部写动作独立 Outbox、幂等、重试、死信和对账。

## 8. 硬闸门

1. 同一 Skill 从创建、编辑、版本、Release 到 Runtime 使用同一 ID/版本，并且正文能造成可观察行为变化；
2. Custom 与内置方案都能生成 AgentVersion、Release 和结构化 Run；
3. 未冻结资源、缺失 Connection、Core 被修改或 Extension 越权均阻断发布；
4. Chat 重启可恢复 AgentState，每个 assistant turn 有 Run，无状态执行不产生 Session；
5. Pipeline 单 unit 失败只重做该 unit，兄弟结果不重复调用；
6. worker 在重试前重启后可恢复，不重复已完成副作用；
7. Run 成功与外部写回成功分别展示和聚合；
8. 前端不得展示 Runtime 未消费的“已安装/已启用”成功态；
9. 2.0.8 正式版发布后重新跑官方契约审计再决定生产 pin。
10. Agent 调 Workflow、Workflow 调 Agent 均固定目标版本并产生子 Run；未授权目标不可枚举；
11. Agent→Workflow→Agent 的版本环在外部副作用前被阻断。

## 9. 给下一位执行者的要求

- 先复核事实，再提实现；不要直接按旧 v4.1 的轨道编号开工；
- 不引用 qoderwake 页面作为后端领域模型证据；只可参考 IA、交互与信息密度；
- 不把“有路由/有表/有测试”当成端到端可用；沿真实读写调用链验证；
- 不把保存成功当成 Runtime 生效；必须从 UI 写入追到 Release 快照和实际 AgentScope 构造参数；
- 不把官方示例能力外推为生产保证；以固定版本源码和故障测试为准；
- 若未决项会改变表结构、权限边界或生产可恢复性，停下请求拍板；
- 审计产出继续落 `research/morethancorn/<round>-audit/`，包含命令、文件行号、事件样例和失败证据。
