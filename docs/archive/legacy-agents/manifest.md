# 旧三类 Agent 只读封存清单（R-A1）

- 封存对象：`Agent.type ∈ {autonomous, dialogue, expert-group}` 的全部旧 Agent 及其执行链。
- 封存语义（SDD 10 §3.3 / ADR-R09）：不新建、不复制、不编辑、不发布、不部署、不运行、
  不被 Schedule/AnalysisTask/Workflow 再调用；历史数据永久只读可查；源码经 Git ref 可恢复。
- 基线日期：2026-08-28。行号基于封存基线提交（见下），后续行号可能漂移，以函数/符号名为准。

## 1. 封存 Git 基线与恢复方式

| 项 | 值 |
| --- | --- |
| 封存基线 tag（本地） | `archive/legacy-agents-20260828` |
| 基线 commit | `43575ae`（= main `edc4cbc` + SDD 文档，业务源码与 `edc4cbc` 完全一致） |
| 基线所在分支 | `main` / 实施分支 `codex/domain-agent-runtime-provider` |
| 实施分支 | `codex/domain-agent-runtime-provider` |

恢复命令（源码级，只读恢复）：

```bash
git worktree add ../MoreThanCorn-legacy-agents archive/legacy-agents-20260828
# 或
git show archive/legacy-agents-20260828:server/app/agent_runtime.py
```

建议的远程封存（需要用户授权后执行，本阶段不执行）：

```bash
git push origin archive/legacy-agents-20260828
git push origin codex/domain-agent-runtime-provider
```

## 2. 数据模型字段（server/app/models.py）

| 模型 | 位置（基线） | 封存相关字段/说明 |
| --- | --- | --- |
| `Agent` | models.py:287-308 | `type`(autonomous\|dialogue\|expert-group, :297)、`workflow_id`(:300)、`config`(:302)、`config_revision`(:303)、`sandbox_version_id`/`prod_version_id`(:304-305)、`archived`(:306，E-2.1 已有字段，封存数据工具置 true) |
| `AgentVersion` | models.py:311-326 | `definition/common_config/dependency_snapshot/artifact_hash`（历史版本只读） |
| `Release` | models.py:329-340 | `status: active\|rolled_back\|offline`(:337)、`canary_percent`(:338)；封存数据工具把 active → offline |
| `Run` | models.py:182-215 | `agent_id`(:192)、`agent_version_id`(:198)、`definition_source`(:197)（历史 Run 只读） |
| `NodeRun` | models.py:218-234 | `node_type` 可为 agent/agent-select/agent-exec（历史节点运行只读） |
| `RunEvent` | models.py:237-255 | `agent_started/llm_delta/tool_call/agent_completed/agent_failed` 等历史事件只读 |
| `CallRecord` | models.py:270-284 | 旧 Agent 子 Run 的调用记录只读 |
| `Schedule` | models.py:145-162 | 仅挂 `workflow_id`/`task_id`，不直接挂 Agent；封存数据工具停用"引用旧 Agent 的工作流"上的 Schedule（`enabled=false`） |
| `AnalysisTask(Version)` | models.py:560-608 | 仅挂 Workflow；封存数据工具把引用旧 Agent 的任务 `status=paused` |
| `JobQueue` | models.py:165-179 | `type` 自由字符串；相关类型 `agent-execution`（见 §6） |
| `EvalSample` / `EvolutionPatch` | models.py:454-466 / 469-480 | `agent_id` 引用；封存后其写入口一并 410 |
| `AuditLog` | models.py:483-493 | 封存数据工具写入审计留痕 |

## 3. 后端 API（基线 server/app/routers/agents.py、admin.py）

写型入口（R-A2 起全部返回 `410 LEGACY_AGENT_ARCHIVED`）：

| 位置 | 端点 | 说明 |
| --- | --- | --- |
| agents.py:25 | `POST /api/agents` | 创建旧三类 Agent |
| agents.py:100 | `PUT /api/agents/{aid}` | 保存草稿（含 archived 开关） |
| agents.py:131 | `POST /api/agents/{aid}/duplicate` | 复制 |
| agents.py:180 | `POST /api/agents/{aid}/run` | 手动/API 运行 |
| agents.py:247 | `POST /api/agents/{aid}/versions` | 创建不可变版本 |
| agents.py:309 | `POST /api/agents/{aid}/releases` | 部署/回滚 |
| agents.py:355 | `POST /api/agents/{aid}/releases/{rid}/stop-canary` | 停灰度 |
| agents.py:422 | `POST /api/agents/{aid}/eval-run` | Agent 级评测运行 |
| agents.py:482 | `POST /api/agents/{aid}/eval-samples/{sid}/human-score` | 人评 |
| agents.py:581 | `POST /api/agents/{aid}/eval-samples` | 建评测样本 |
| agents.py:500/541/561 | `POST /api/agents/{aid}/evolution/...` | 进化候选/应用/拒绝 |
| admin.py:539 | `DELETE /api/agents/{aid}` | 删除（历史不可删，改为 410） |
| admin.py:420 | `POST /api/runs/{run_id}/retry`（agent 分支 :426-442） | 重放旧 Agent Run |

保留的只读查询入口：agents.py 全部 GET（list/get/definition-draft/runs/run detail/mounts-health/versions/version detail/releases/metrics/evolution 列表/eval-samples 列表）、admin.py:824（eval-samples 全局查）、runs.py 全部（list/get/SSE/events/trace，Agent Run 复用）、admin.py 大屏结果归属读取（:712-733）。

## 4. 旧执行器（server/app/agent_runtime.py）

| 符号 | 位置（基线） | 说明 |
| --- | --- | --- |
| `run_agent` | :529-582 | 三型统一入口；建 Run + 入队 `agent-execution`。R-A2 起入口处 `assert_agent_executable` 拦截 |
| `_execute_agent_inline` | :585-604 | autonomous 分支 :590-602；dialogue/expert-group → `execute_run` |
| `_autonomous_loop` | :233-321 | ReAct 循环（MAX_STEPS/MAX_SECONDS :22-23） |
| `_chat_completion` | :64-142 | LLM 调用（流式 :102-142） |
| `_build_tools` | :147-196 | 挂载 → tools schema |
| `exec_agent_select` / `exec_agent_exec` / `exec_agent_node` / `_run_member` | :406-518 | 专家组画布节点执行器；成员子 Run 经 `run_agent`(:503) |
| `execute_agent_job` | :607-631 | worker 侧执行入口 |

## 5. Runner / 工作流依赖（server/app/runner.py）

- `_agent_family_executor` :1008-1018：`agent→exec_agent_node`、`agent-select→exec_agent_select`、`agent-exec→exec_agent_exec` 注册。
- 执行点：主遍历 :916、:1176；loop 体 :916。
- `create_run` :1616-1663：workflow Run + `workflow-execution` 入队（不受封存影响）。
- Workflow 迁移工具 `migrate_definition`（runner.py:1415 起）把 agent 三键改写为 workflow 三连（07-SDD §5.3）。
- 节点注册：`server/app/registry.py:110-148` 三节点均已 `deprecated: True`（07-SDD D8），画布 palette 不再展示；`schemas.py:11` NodeType Literal 保留供历史画布解析。

## 6. JobQueue 类型

| type | 发起处（基线） | 封存处置 |
| --- | --- | --- |
| `agent-execution` | agent_runtime.py:578 | worker 分派表解除注册（runner.py `_dispatch_job` 改防呆：标失败 + Run 置 failed LEGACY_AGENT_ARCHIVED，不执行） |
| `workflow-execution` | runner.py:1661、runs.py:46 | 保留（独立 Workflow 能力） |
| `task-run` / `task-run-retry` | task_runner.py:162、business.py:837 | 保留（Workflow 任务链，不产生 Agent Run） |

## 7. Schedule / AnalysisTask / Workflow 引用关系

- Schedule、AnalysisTask 全部只挂 Workflow，不直接引用 Agent；"引用旧 Agent"的判定：
  1. Schedule.workflow_id 是某旧 Agent 的绑定工作流（`Agent.workflow_id`）；
  2. 工作流定义（draft 或 pinned/current version）内 `agent/agent-select/agent-exec` 节点引用旧 Agent
     （config.agentCode / primaryAgents / fallbackAgent）。
- 封存数据工具：上述 Schedule → `enabled=false`；AnalysisTask（active/draft）→ `status=paused`；
  Workflow **图不自动改写**，只输出引用节点清单。
- `publish_workflow`（workflows.py:175）新增校验：发布图中引用已封存 Agent → 409 拦截。

## 8. 历史查询与 Run Detail 路径（保留）

- Agent 列表/详情/版本/Release/Run/RunDetail：`GET /api/agents...`（agents.py）。
- 通用运行查询：`GET /api/runs`、`/api/runs/{id}`、SSE `/api/runs/{id}/events`、`/events-list`、`/trace`（runs.py）。
- 结果/复核：QualityResult/Evidence/ReviewRevision 链路不受影响。
- 前端：Agents 列表保留（含"已封存"筛选）、详情/运行/结果页只读。

## 9. 前端入口（src/，基线）

| 位置 | 内容 | 处置 |
| --- | --- | --- |
| pages/wf-agents-list.tsx:37-41,236-255 | 三类型创建卡片/Dialog | 移除创建入口 |
| pages/wf-agents-list.tsx:186-206 | 行菜单复制/归档/删除 | 移除（保留查看） |
| pages/wf-agent-editor.tsx:191-204,647-650,629-638,663 | 保存/发布/停灰度/发布弹窗 | 隐藏；详情显示"已封存，只读" |
| pages/wf-agent-editor.tsx:205-256 | 预览调试运行 | 移除 |
| pages/wf-designer.tsx:2377-2380,2417,2632 | Agent 发布链 | 隐藏 |
| pages/wf-designer.tsx:1558-1590 | 专家组成员池添加 | 移除 |
| components/agent-publish-dialog.tsx:57,72 | createVersion/release | 入口移除 |
| components/agent-ops-panels.tsx | evalRun/humanScore/evolution 动作 | 移除动作按钮，保留只读列表 |
| pages/run-detail.tsx:140-142 | 运行重试按钮 | Agent 运行隐藏 |
| services/wf-api.ts:394-486 | agentApi 写函数 | 写函数移除/仅保留只读 |
| app.tsx:82-83、app-sidebar.tsx:92-93 | 路由/导航 | 保留为只读列表入口 |

命名遗留（与旧三类 Agent 无关，勿误伤）：task-wizard 的 "Agent"（实为 Workflow，task-form-sections.tsx:135）、agent-analysis 页（坐席维度，analytics.py:89）、ResultRuleSet.agentId 字符串列（business.py:106）。

## 10. 相关测试（基线）

| 文件 | 覆盖点 | R-Archive 处置 |
| --- | --- | --- |
| server/tests/test_agent_runtime.py | 三型运行/挂载/护栏/发布同步 | 改写为封存契约测试 |
| server/tests/test_phase_a.py | A-01~A-17（含 Agent 乐观锁/路由/异步） | Agent 写路径测试改写为 410 断言；Workflow 部分保留 |
| server/tests/test_phase_b.py | 发布闭环/版本运行/成员冻结 | 改写为 410 断言 |
| server/tests/test_phase_d1.py | 指标/评测/generate-prompt | 改写为 410 断言（只读指标保留） |
| server/tests/test_phase_e.py | 复制/归档/灰度/流式/trace | 改写为 410 断言 |
| server/tests/test_p6_nodes.py | 节点迁移重写器（agent 三键→workflow 三连） | 保留（纯定义改写，不执行旧 Agent） |
| scripts/verify-fullstack.mjs S13(:218-241) | Agent 场景冒烟 | 改写为封存契约冒烟（创建→410、只读可查） |
| scripts/check-e1-acceptance.mjs / check-d1.mjs / check-p0-nodespec.mjs | 历史验收脚本 | 同步标注/改写为封存语义 |

新增：server/tests/test_legacy_agent_archive.py（封存契约全集 + 数据封存工具 + worker 防呆）。

## 11. 数据封存工具（R-A3）

- 模块：`server/app/legacy_agent_archive.py`；入口：`server/run_legacy_agent_archive.py`。
- 行为：默认 dry-run（只输出计划与数量，不改库）；`--apply` 单事务执行：
  旧 Agent `archived=true` → 活跃 Release（含灰度）`status=offline` → 引用旧 Agent 的 Schedule
  `enabled=false`、AnalysisTask `status=paused` → 输出 Workflow 引用节点清单（不改图）→ 写 AuditLog。
- 幂等可重复执行；本地开发只跑 dry-run；对真实数据 `--apply` 须用户显式授权。
