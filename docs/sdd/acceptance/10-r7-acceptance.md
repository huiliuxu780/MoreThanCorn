# Domain Agent Runtime Provider — Phase R7（Data→Task→Agent→Run 产品闭环）验收记录

日期：2026-08-29｜分支 `codex/domain-agent-runtime-provider`｜状态：完成（待用户验收）

## 1. 交付内容
- **R7-1 统一执行目标契约**：create/list/detail/edit 均返回 `executionTarget`（agent|workflow）；
  编辑保真（`_update_agent_task`：Agent 任务不被误改 Workflow）；校验 pinned AgentVersion 属于
  所选 Agent、输入映射必填覆盖 Module inputSchema（`INPUT_MAPPING_INCOMPLETE`）。
- **R7-2 Module Catalog 暴露**：`/api/agents/modules` 增 `inputSchema`/`outputSchema`/
  `resultProjection`/`producesQualityResult`（任务映射目标不再写死）。
- **R7-4/5 列表与详情**：任务列表增执行目标类型/Agent 名/Module/最近批次；TaskRun DTO 增
  冻结 AgentVersion/Release/runtimeBinding；`/api/task-runs/{id}/runs` 增 total 与 Run 行
  Agent/Provider/originRunId，供 TaskRun→Run 跳转。
- **R7-3/5/6 前端**：任务向导默认 Module Agent（catalog 加载 Module Agent+inputSchema 驱动映射）、
  buildTaskPayload 发 executionTarget；任务列表「执行目标」列；TaskRun 明细展示冻结
  AgentVersion/Provider 并「查看 Run」跳转 `/config/tasks/:taskId/runs/:runId`。
- **R7-7 结果路由**：quality→QualityResult（exactly-once）；business/ticket 不写 QualityResult
  （R5/R6 已分流）；ticket 不接真实写操作。
- **R7-8 重试**：沿用冻结 TaskVersion/AgentVersion/Release/Provider；只为失败数据建新 attempt；
  成功项不重复；新 Run 以 origin_run_id 关联。

## 2. 测试证据
| 门禁 | 结果 |
| --- | --- |
| 后端 `pytest tests -q` | **280 passed**（含 test_r7_loop 全链路：5 数据→5 Run→4 成功各 1 条 QualityResult→1 失败有明确错误→重试不重复成功项→旧批次绑定不漂移→新批次解析新版本） |
| 前端 typecheck / lint / build | 全绿 |
| verify-fullstack | 38/49（=存量基线；S13 过） |
| `git diff --check` | 干净 |

## 3. 偏差/风险
1. 前端 TaskRun→Run 跳转复用现有 run-detail 路由；Run 详情字段（阶段/调用/Token/领域结果）后端已备（R4），前端 run-detail 展示增强可继续。
2. ticket/business 领域结果页（ActionLedger/BusinessAnalysis）未做，仅保证不写 QualityResult 与原始输出可查看。
3. 未执行 legacy `--apply`、未接真实写操作、未 push、未改 main。
