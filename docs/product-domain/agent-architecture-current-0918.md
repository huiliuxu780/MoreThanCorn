# Agent 现状架构 + 缺口清单（09-18 实证据版）

> 用途：给用户看"我们还漏什么"。每层附活体证据指针；"脚本直连 LLM"质疑单独回应。

## 0. 进程拓扑（活体）

```
8120  platform (FastAPI, wf_dev PG)      ← 产品面/冻结/治理/提交端点
8301  AgentScope 2.0.8 runtime (独立 venv 独立进程)  ← ReAct 循环真身
  │            │
  │            └─► DashScope（外部 LLM，凭据=connection 加密 secret，平台代签）
  └──共享 PG──┘   sessions/messages 表 = 运行时 storage（官方 Storage 共库）
外部能力面：飞书 bitable（lark-cli 过渡适配器）/ 生产网关 gw.corn（AKSK）/ OAT（token 手工轮换）
```

证据：`lsof` 8120/8301 双进程独立 venv；TrueAsk 会话 trace 含 4 次 tool_call/tool_result 多轮环（非单次问答）；runtime openapi 含 /workspace/mcp|skill、/mcp、/hub/mcp 端点集。

## 1. 主链（数据→任务→agent→run→结束）

```
┌ 数据/事件层 ─────────────────────────────────────────────────────┐
│ feishu bitable / SLS / MaxCompute / webhook                      │
│   └─ poll/ingest → data_source_event（游标+dedup）                │
└───────────────┬──────────────────────────────────────────────────┘
                │ EventRoute：filter / mapping / dedup / completionPolicy
                ▼
┌ 任务层 ──────────────────────────────────────────────────────────┐
│ automation：四触发(schedule/manual/api/event) + max_runs 原子闸   │
│   └─ Invocation(automation_trigger_log) = 一触发一调用            │
└───────────────┬──────────────────────────────────────────────────┘
                │ start_session：release 冻结清单注入
                │   (prompt 编译 / skills / tools / mcp / kb / 模型参数+思考预算)
                ▼
┌ 平台 8120 agent_execution ──HTTP──► 运行时 8301 AgentScope ┐
│ release 冻结快照 _frozen_*              官方 get_model/get_toolkit/   │
│ session token + 来源溯源                 RAGMiddleware 装配            │
│ submit/acceptance 硬校验端点            ReAct 循环: model ↔ toolkit   │
│                                          ├ PlatformHttpTool ─callback─► 8120 run-platform-tool
│                                          │    └ connection 鉴权(aksk/script/bearer…)→ 外部 API
│                                          ├ workspace skill（SKILL.md 冻结上传）
│                                          ├ MCP http 插件（/workspace/mcp 挂载+发现）
│                                          └ KB RAG（fail-closed 注册）
│                                          storage=共享 PG(sessions/messages)
└──────────────────────────────────────────────────────────────────┘
                │ 结束结算：invocation 终态 + delivery 结算(terminal 策略 watcher)
                ▼
        结果面：acceptance 镜像 / 飞书结果表(agent 写工具) / 工作日志 / 看板
```

## 2. 能力两层分工（都实施着）

| 层 | 实体 | 执行 | 状态 |
|---|---|---|---|
| 工具层 | tool/tool_version + connection | 平台代签代执行（PlatformHttpTool 回调） | 全链通 |
| 插件层 | mcp_server + release 冻结 | 运行时 /workspace/mcp 挂载+协议发现 | http 通；**stdio 未支持** |

## 3. "脚本直连 LLM" 质疑回应

**Agent 主链不是脚本直连**：模型调用发生在 8301 独立进程的 AgentScope ReAct 循环内（model↔toolkit 多轮），平台只冻结清单+读回结果；证据=会话 trace 多轮 tool_call/tool_result 环 + 双进程拓扑 + runtime openapi。

**平台内确实存在单次直连 LLM 点位（诚实清单，均为平台工具级、无工具环、设计如此）**：
- runner.py ×5：Workflow LLM 节点 / 路由分类 / 条件判断
- as_flows_board.py：WakerFlow 自然语言→脚本生成
- workflows.py：LLM 节点
- resource_tests.py：连接 ping
这些是"平台替用户做一次单发问答"，不是 agent 执行路径；与 agent 主链不共用循环。

## 4. 缺口清单（按层）

| 层 | 缺口 | 级 |
|---|---|---|
| 观测 | run 列表/运行中心无 event 触发投影；trace/metrics UI 未实施（设计稿在） | P1 |
| 执行 | 运行时静默消失 watchdog（completed 零回复判 failed 可重试） | P0 |
| 执行 | 预算 token 级硬治理（max_runs 有；token 预算快照有、强制无） | P1 |
| 能力 | **memory 运行时未挂载**（MemoryRecord 仅凭据缓存用，agent 记忆没进运行时） | P1 |
| 能力 | stdio MCP transport | P2 |
| 能力 | token_exchange 两段式鉴权（OAT/xspace/飞书 app 凭据） | P1 |
| 能力 | lark-cli http MCP 插件化（过渡适配器退役路径） | P2 |
| 评测 | evolution 闭环自动化未开（补丁应用有人工步） | P2 |
| 分析质量 | TrueAsk 分段/质量 few-shot 调优轮 | P1 |

## 5. 已实施别漏看（防"以为没有"）

freeze 不可变发布 / 双环境+AkSk+script 鉴权 / HITL ApprovalCard+权限六开关 / group 多 agent / AgentFlow 脚本引擎+投影 / structured output / SSE 流式 / golden eval / 封存闸门 / 幂等 dedup / terminal 结算 watcher。

## 6. 装配实证（09-18 活体对账，用户质疑回应）
- 冻结快照（release 14d2ca61）：prompt_digest / _frozen_skills(trueask-taxonomy-v4 全文摘要) /
  _frozen_tools(3 个 tool_version_id) / frozen_model_id+key+params / frozen_tool_policy /
  frozen_permission_policy / frozen_exec_timeout 全在。
- 运行时工作区（探针会话 e5629715）：/workspace/skill 返回 trueask-taxonomy-v4 冻结全文；
  /workspace/mcp = []（本 agent 未配 MCP，装配路径在、零挂载）。
- 工具装配行为实证：探针回合自报 toolkit = 配置三工具（热线语音转文本记录查询 /
  submit_trueask_analysis_result / feishu_record_batch_create）+ Skill + 运行时内建 +
  run_workflow/run_agent_flow；批4 trace 含四工具真调用环。
- 诚实缺口：MCP/KB 装配路径已实施但**当前全平台零活体挂载**（mcps 挂载表空）；
  memory 运行时完全不挂载（表仅凭据缓存用）。
