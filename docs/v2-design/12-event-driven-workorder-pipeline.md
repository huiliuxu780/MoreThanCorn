# 12 · 事件驱动质检/工单处理方案

> 版本：v3.0
> 日期：2026-09-08
> 状态：`SCENARIO_DESIGN / PIPELINE_SPIKE_REQUIRED`
> 代码：未实施
> 上位方案：03 v3.0、05 v3.0、11 v6.0

## 0. 结论

工单场景不需要第三套 Agent 运行机制。正确链路是：

```text
工单源/API/MQ
→ 数据接入与确定性过滤映射
→ 自动任务
→ AgentScope 单 Agent Session
   | AgentScope AgentFlow/Pipeline
   | MoreThanCorn Workflow
→ 结构化结果
→ 必要时经平台 Outbox 写回外部系统
```

任务看板只投影上述原生执行事实，不再先创建平台 TaskRun/Run 包裹 AgentScope。

## 1. 两种 Agent 实现方式

### A · AgentFlow / Pipeline

适合固定治理骨架：

1. 分类 Agent 判断质检场景；
2. 若干专长 Agent 查询、核验和给出局部结论；
3. 汇总 Agent 形成结构化输出；
4. verifier 判断是否达标；
5. 未达标按官方 Pipeline 实际能力重跑。

这对应 AgentScope 2.0.8 Pipeline 方向，但当前 dev 版本没有 app registry、Session storage、HTTP、恢复和已证的“选择性只重做失败 unit”。因此：

- 可以把它作为 AgentFlow 产品方案；
- 不能把现有 `native_workflow/QualityPipeline` 测试骨架当生产底座；
- 不能承诺选择性重做；
- 不能把每个 mock 工具和角色都开发成顶层 Agent 后才允许平台开工。

AgentFlow 保存的是流程定义/版本/发布控制面；节点可以引用已发布 Agent，也可以在官方支持时采用内部模板。运行状态和 Session 归属由 2.0.8 app spike 决定。

### B · 单 Agent Planning

适合目标明确、步骤可动态决定的一次性分析：

```text
一个 AgentScope Session
→ Agent 使用 TaskCreate/Get/List/Update 维护本次执行计划
→ 按需调用 Skill/MCP/Knowledge/Tool
→ 输出结构化结果
```

计划项只存在于 AgentScope `tasks_context`，不是平台任务看板条目，也不是自动任务定义。此模式没有固定的多角色 barrier/verifier，质量主要由 Agent、工具和输出 schema 保证。

## 2. 如何选择

| 条件 | 选 AgentFlow | 选单 Agent Planning | 选 Workflow |
|---|---|---|---|
| 分工固定、多角色交叉核验 | 是 | 否 | 可作外层业务流程 |
| 步骤随输入动态变化 | 局部 | 是 | 否 |
| 必须确定性审批/等待/写回 | 仅官方证实后 | 不适合作硬控制 | 是 |
| 结构化终态 | output schema | structured output | 节点契约 |
| 选择性阶段重做 | 当前未证 | Agent 自主重试 | 按 Workflow 节点能力 |

不要把“质检/审计/工单”硬编码成三种运行时。它们可以是内置 Agent 或 AgentFlow 模板，用户仍可增加/修改 Skill、MCP 工具和 Knowledge；权限与版本约束由发布控制面决定。

## 3. 自动任务配置

自动任务只决定何时启动和目标是谁。

### Agent target

- 固定 Prompt；
- 模型；
- Workspace；
- trigger payload 可替换 Prompt 字段；
- 默认每次触发 fresh Session，显式 conversation key 才续用。

### AgentFlow target

- 引用已发布 AgentFlow 版本；
- 展示阶段和人工确认节点；
- Flow 参数取固定值或 trigger payload path；
- 不重复配置 Agent Prompt、模型和 Workspace；
- 保存后 target kind/id 锁定。

## 4. Session 与运行事实

- 单 Agent 无状态处理：每次一条 fresh AgentScope Session。
- 同一工单持续追问：业务 conversation key 映射同一 Session。
- `wakeSessionUniqueId` 类 key 只表示上下文连续性，不承担幂等。
- AgentFlow 内部一个还是多个 Session 不能猜，等 2.0.8 app spike。
- 任务看板记录执行事实；AgentScope 内部 Task 工具记录单次计划；自动任务记录可反复触发的定义。

## 5. Skill、Tool、Knowledge 与 Prompt 装配

Agent 不通过本场景另造配置：

- System Prompt：最终只写 `AgentData.system_prompt`；
- Skill：AgentScope Skill Library → Workspace → `get_toolkit()`；
- MCP：MCP Library → Workspace → MCPClient/Toolkit；
- Knowledge：SessionKnowledgeConfig + RAGMiddleware；
- 平台业务工具：`extra_agent_tools` 注册 AgentScope ToolBase；
- Workflow/AgentFlow：分别暴露 `run_workflow`/`run_agent_flow` ToolBase，供 Agent 主动调用。

固定质检模板可以声明需要哪些资源，但运行前必须解析到 AgentScope Workspace/Session 实际状态，不允许只把资源名称写进 Prompt。

## 6. 结构化输出与不合格处理

每个方案都必须有终态 schema，例如：

```json
{
  "decision": "pass | reject | needs_review",
  "findings": [],
  "evidence": [],
  "confidence": 0,
  "next_action": null
}
```

“不合格打回重做”要区分：

1. Agent 自主修正：同一 Session 内继续规划/重试；
2. 整个 Flow 重跑：创建新的 execution；
3. 选择性阶段/单元重做：只有官方 Pipeline 有可恢复 checkpoint、依赖失效和重放契约后才开放；
4. 人工退回：通过真实 HITL/外部执行事件恢复，不用字符串状态伪造。

当前只允许 1、2 进入 spike；3 保持 `EVIDENCE_GAP`。

## 7. 外部写回

AgentScope 负责 Agent 执行，不负责业务系统恰好一次写回。若质检结论要更新工单：

- Agent/Flow 只产生结构化“写回意图”；
- 平台权限策略检查目标、动作和数据；
- 需要人工确认时等待真实 HITL；
- Outbox 使用业务幂等键写入；
- 回执与失败对账独立于 Agent Session。

只读分析不需要 Outbox，不要为了架构完整性强制所有场景产生写回记录。

## 8. 任务和自动任务

- 任务看板：直接复刻 QoderWake 的统一执行视图；不是新的执行引擎。
- 自动任务：直接复刻 QoderWake 的列表、配置、详情和历史体验；Agent 定时执行映射 AgentScope Schedule。
- 复制的是产品交互和业务规则，不是 QoderWake 私有 API、凭据形态或内部数据库。

因此“直接抄”是正确的产品策略，但不能把 QoderWake backend 反向嫁接进 MoreThanCorn，也不能用现有 TaskRun 模型冒充 AgentScope 原生 Session。

## 9. Spike 门禁

### Agent Planning

1. fresh Session 完成一次工单核验。
2. Task tools 有真实计划状态。
3. Skill/MCP/Knowledge 从 Workspace 实际装配。
4. structured output 可校验，失败可在同一 Session 修正。

### AgentFlow

1. 固定 2.0.8 正式 tag 或开发提交。
2. Pipeline 定义可序列化并固定版本。
3. 明确 Agent/Session/State 的持久化归属。
4. 实测 stage/unit 事件、取消、HITL 和重启恢复。
5. 若无选择性重做原语，产品不显示该能力。

### 数据接入与写回

1. 使用一个真实工单源和安全测试 payload。
2. 明确 idempotency key、conversation key 和 cursor。
3. 验证重复消息、乱序、失败重试和死信。
4. 写回通过权限、HITL、Outbox 和对账。

全部 spike 通过前，本文件仍是场景方案，不是代码开工许可。
