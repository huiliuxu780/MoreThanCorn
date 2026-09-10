# 13 · AgentScope 2.0.8 实证探针与迁移矩阵（G1/G2 证据）

> 日期：2026-09-09
> 状态：`PROBES_GREEN / MATRIX_APPROVED_FOR_IMPLEMENTATION`
> 上位：任务书（2026-09-09 开工令）、docs/v2-design/11 v6.0、05 v3.0、03 v3.0、08 v3.0、12 v3.0、AUDIT-HANDOFF v3.0
> 证据原件：`runtimes/agentscope/probes/evidence/*.jsonl`、`openapi-2.0.8.json`、`p09-pipeline-boundary.txt`、`serve.log`

## 1. 版本门禁（G1-1）

| 项 | 值 |
|---|---|
| 目标 | AgentScope 2.0.8 系列 |
| PyPI 正式release | `agentscope-2.0.8-py3-none-any.whl`，上传 2026-09-08T13:12:52Z（PyPI JSON API 实测） |
| 项目锁定 | `runtimes/agentscope/pyproject.toml`：`agentscope[service,storage-sql,storage-redis,rag]==2.0.8`；`uv.lock` 已重锁（Resolved 110 packages） |
| 实际安装 | `2.0.8`，源码 `runtimes/agentscope/.venv/lib/python3.11/site-packages/agentscope/`（`_version.py:4`） |
| 复现命令 | `cd runtimes/agentscope && uv lock && uv sync --extra test` |
| 依赖事实 | service→fastapi/uvicorn/apscheduler；storage-sql→sqlalchemy[asyncio]+alembic；storage-redis→redis；rag→pypdf/pptx/docx/openpyxl/pandas |

## 2. 探针结果（G1-2，全部真实模型/真实存储/真实进程）

探针宿主：`probes/serve.py` = 官方 `create_app(storage=AsyncSQLAlchemyStorage(postgres wf_as_probe), message_bus=RedisMessageBus(db3), workspace_manager=LocalWorkspaceManager(PER_SESSION), knowledge_base_manager=CollectionPerKbManager, enable_scheduler=True, extra_agent_tools=[ProbeEchoTool])`，端口 8401。模型凭据来自平台库 `connection(protocol='llm')`（DashScope OpenAI 兼容），进程内解析、全程掩码。

| 探针 | 结论 | 关键证据 |
|---|---|---|
| p01 session/chat | Agent/Session 创建、多轮复用、原生 AgentEvent 流（REPLY/MODEL_CALL/TEXT_BLOCK/TOOL_CALL/TOOL_RESULT/HINT）、消息 PG 持久化、`extra_agent_tools` ToolBase 被真实调用（`PROBE_ECHO::ZULU-7741`） | p01.jsonl turn1/turn2/persistence |
| p02 隔离 | 同 Agent 两 Session 互不泄漏（他会话答 NO），同会话跨轮记忆命中 | p02.jsonl isolation |
| p03 Schedule | 原生 SchedulerManager：stateful=false 每次 fire 新建 Session（2 fire→2 session）；pause 75s 窗口零新 fire；resume 复燃；stateful=true 复用 `{schedule_id}_stateful` 单 Session；`GET /schedule/{id}/sessions` 即执行历史；prompt 来自 `ScheduleData.description`（HintBlock `<scheduled-task>`） | p03.jsonl 全键 |
| p04 中断/错误 | `POST /sessions/{id}/interrupt` → REPLY_END `finished_reason=interrupted`、状态回 idle；假模型名 → REPLY_END error `{type: invalid_request}` 分类真实 | p04.jsonl |
| p05 structured output | 库层 `Agent.reply_stream(structured_schema=QcVerdict)` 真模型校验通过；对抗输入仍收敛到 schema | p05.jsonl |
| p06 Skill | `/workspace/skill/upload`（manifest+multipart，单一顶层目录+SKILL.md 校验）→ workspace 列表可见 → Agent 真实加载并按 Skill 指令回复 `VAULT-4242`（TOOL_CALL/TOOL_RESULT 事件） | p06.jsonl |
| p07 MCP | `/workspace/mcp` 加入真实 MCP server（repo 自带 tool_service，streamable HTTP，initialize 握手真）→ `is_healthy=true`、4 工具以 `mcp__quality-tools__*` 进 Toolkit → Agent 真实调用 knowledge_search | p07.jsonl |
| p08 Knowledge | KB 创建（EmbeddingModelConfig.dimensions 一等字段）→ 文档上传 → 索引状态 `ready`（真 embedding text-embedding-v3）→ `/search` 命中 0.83 → SessionKnowledgeConfig 挂会话后 RAG 进真实回合（回复含 480 CNY / MGR-REFUND-9） | p08.jsonl |
| p09 Pipeline | 官方 `PipelineProtocol` 上实现 dispatch→并行 checker→aggregate(structured) 全阶段事件流；节点失败（真 404）可观测、平台层节点重跑决策恢复；官方 `GoalPipeline` executor/verifier 真跑通；**上游边界**：pipeline 模块仅 `_base.py/_goal_pipeline.py`，无 def 级 checkpoint/resume/redo、无 Checkpoint 类、app 层无 pipeline 路由、`create_app` 参数无 pipeline | p09.jsonl + p09-pipeline-boundary.txt |
| p10 恢复 | 杀进程重启后消息/状态/Agent 记录全存活（PG storage + Redis bus） | p10.jsonl |

### 2.1 上游缺口登记（只补产品控制面，不造运行时）

1. app 层 chat 面（`POST /chat/`）不暴露 structured_schema（`ChatRequest` 无 schema 字段；`_chat.py:369` 仅自动命名内部使用）→ 平台结构化单次执行以"官方原语薄宿主"补齐（见 §4 GAP-1）。
2. Schedule 无 max_runs 字段（`ScheduleData` 仅 ended_at）→ 平台准入门 watcher 达限停表（反应式准入，见 §4 GAP-2）。
3. Pipeline 无 app 注册/存储/HTTP/恢复/选择性重做 → AgentFlow 控制面 + 节点重跑决策/输入版本/结果关联（§4 GAP-3）。
4. `ChatService._report_failure` 不记录原始装配异常（仅泛化 SETUP 文案）→ 运行时宿主侧加诊断钩子（探针期已用运行时 patch 实证根因：ToolBase 抽象方法 `check_permissions` 未实现）。
5. 无通用 MQ/Webhook/轮询数据入口 → 平台数据接入层（§4 GAP-4）。
6. Skill/MCP Hub 未配置时 library 仅手工/工作区回流登记 → 一期不接 Hub 市场（产品决策，非能力缺失）。

## 3. 逐对象归属裁决（G2-1，对照任务书表落到当前代码）

| 对象 | 唯一职责归属 | 当前代码事实 | 裁决 |
|---|---|---|---|
| Agent 配置/版本/发布/权限 | MTC 控制面 | `models.py:354/381/399` Agent/AgentVersion/Release | 保留瘦身：Release 物化为运行时 AgentRecord 快照引用 |
| Agent 实例与推理 | AgentScope | adapter.py 无状态 Agent | 改运行时宿主 AgentRecord |
| Session/消息/AgentState | AgentScope | `agent_chat_session/agent_chat_message`（models.py:473/484） | 停写→兼容读→删除 |
| System Prompt 编辑/编译 | MTC 控制面 | `Agent.config`/draftRole | 保留：IDENTITY/BIBLE/PERSONA 编译单 prompt |
| 编译后 prompt 使用 | AgentScope AgentData.system_prompt | 无 | 发布物化写入 |
| Skill/MCP/Knowledge 目录 | MTC 控制面 | skill/mcp_server/knowledge_source 表 | 保留为产品目录+展示扩展 |
| Skill/MCP/Tool/Knowledge 挂载 | AgentScope Workspace/SessionConfig | `agent_skill`（models.py:437）、config.connections | 停写挂载表→运行时 Workspace 为真相 |
| 自动任务定义/产品规则 | MTC 控制面 | `analysis_task`（models.py:740）+ automations facade | 保留改造：target 三型+session 策略+统计 |
| Agent 定时执行 | AgentScope Schedule | `schedule` 表（models.py:202）+ runner scheduler | Agent 目标停写平台 schedule→AgentScope ScheduleRecord；Workflow/AgentFlow 目标保留平台触发器（非 Agent 调度器） |
| 外部事件/MQ/Webhook/轮询 | MTC 数据接入层 | 无 | 新建 |
| AgentFlow 定义/版本/发布 | MTC 控制面 | 无 | 新建 |
| AgentFlow 运行 | AgentScope Pipeline（官方 Protocol/Agent） | 无 | 新建执行器（官方原语组合） |
| 确定性 Workflow | MTC Workflow 引擎 | runner.py DAG | 保留 |
| 任务看板 | 只读投影 | work_items 投影（TaskRun+Occurrence） | 重写投影源：Session 索引+WorkflowRun+AgentFlowRun |
| Agent 执行事实 | AgentScope Session/运行记录 | Run/RunEvent/TaskRun | Run 降级为 Workflow/批量业务记录；Agent 观测停写 RunEvent runtime_trace |

## 4. 迁移矩阵（G2-2，每项含动作与回滚）

| 旧对象 | 当前用途 | 新事实源 | 动作 | 回滚 |
|---|---|---|---|---|
| `agent_chat.py` 自建 session/消息/llm_delta | 对话执行 | 运行时 Session/ChatService/SSE | 停写+重写为代理；表保留兼容读（历史会话只读展示一期内） | 还原路由指向旧实现（代码保留至验收后删） |
| `agent_runtime.py` legacy ReAct | 已归档禁用 | — | 删除执行循环体，保留归档 CLI | git revert |
| `runtime_providers/` gateway+worker jobs+trace_mapper | Module Agent 执行主链 | 运行时原生 API | 删除 submit/poll/cancel job 类型与 trace_mapper；Run.runtime_* 列停写 | 迁移开关 `WF_LEGACY_PROVIDER=1` 一期保留代码不接线 |
| `native_workflow.py` v0.2 骨架 | POC 质检流 | AgentFlow（官方 Pipeline 组合） | 删除（能力由 AgentFlow 模板承接） | git revert |
| `server/tools/fake_provider_8301.py` + dev-stack 假 provider | 开发替身 | 真运行时 8401/8301→新端口 | 删除启动项与脚本引用 | 脚本保留注释 |
| `agent_skill` 挂载表 | UI 挂载真相 | Workspace skills | 停写；读改为运行时列表 | 双读开关一期 |
| `Run/RunEvent`(runtime_trace) | Agent 观测 | Session 事件/OTel | Agent 路径停写；Workflow 路径保留 Run/RunEvent（自有事件） | 列保留 |
| `TaskRun/WorkItem` 投影 | 看板 | Session 索引+WorkflowRun+AgentFlowRun | 投影重写；TaskRun 保留为批量业务执行记录（SDD-13 投递链） | 投影函数可切回 |
| 平台 `schedule`（Agent 目标） | 定时 | AgentScope ScheduleRecord | 停写新建；存量迁移脚本生成 ScheduleRecord 并映射 automation | 迁移表记录双向 id |
| analytics `estimatedCostUsd`  invented 单价 | 成本展示 | 真实 usage 或隐藏 | 删除 invented 单价字段展示 | UI 开关 |
| runner `exec_llm` "thought" 空字段 | 节点 IO 声明 | 删除空 thinking 声明 | 修改 registry IO schema | git revert |

### 平台缺口补齐登记（§2.1 对应实现）

- GAP-1 `structured-run` 薄宿主：运行时服务新增 `/mtc/structured-run`，用官方 `get_model/get_toolkit/storage.upsert_message/bus publish` 组装并持久化，仅补 schema 入参；不复制 ChatService 状态机。
- GAP-2 max_runs/deadline 准入 watcher：平台周期任务读 schedule sessions 计数，达限 `PATCH enabled=false`；deadline 直接映射 `ScheduleData.ended_at`（原生）。
- GAP-3 AgentFlow 控制面 + 节点运行表（node session_id/input_version/status），选择性重做=产品层节点重跑决策，不宣称 checkpoint。
- GAP-4 数据接入：data_source/data_source_event 表 + webhook/polling/test-event 三类一期能力 + 去重/游标/死信。

## 5. 门禁对照

- G1：版本可复现（§1）+ 探针全绿（§2）+ 边界结论准确（§2.1/ p09）。
- G2：本文件 §3/§4 即逐表逐接口裁决；不存在第二 Agent Runtime（adapter 删除中）、第二 Session 真相（停写中）、第二 Agent 调度状态机（Agent 目标归 AgentScope Schedule）。
