# 10 · Logs / Events / 可观测性（Designed）

> Sim 事实：`evidence/sim-part-b-runtime-infra.md`（SSE execution:/block: 事件+eventId 重放；Logs 页 10s/3s 轮询；Run=单行+executionData jsonb；usage_log 账本）。
> 我们的事件 schema：`contracts/run-event.schema.json`（type 命名按任务书 §10.8 清单）。

## 1. 状态机

- Run：queued → running → succeeded | failed | cancelled | timed_out。
- NodeRun：pending → running → succeeded | failed | skipped | cancelled | timed_out。
- 每次重试=新 attempt 行（node_run.attempt），不原地覆盖（保证"历史 Run 永远可解释"，Master §6.1）。

## 2. 事件协议

- 传输：SSE `GET /api/runs/{id}/events`，`id:` 行=sequence；断线重连带 `Last-Event-ID`，服务端从 run_event 表重放（Sim from=<eventId> 重放思想，Reference and Rewrite）。
- 页面刷新恢复：先 `GET /runs/{id}`（状态+节点摘要快照）渲染，再 SSE 续接（Designed，与 06 §4 一致）。
- 事件类型（17 种，见 schema）：workflow_queued/started/completed/failed/cancelled/timed_out；node_started/output/completed/failed/skipped；tool_call_*、model_call_*（started/completed/failed）。
- 字段：eventId(ULID)/sequence/timestamp(UTC)/runId/nodeRunId/nodeId/type/payload{status,attempt,durationMs,tokenUsage,output(截断),error{code,message,retryable}}。
- **乱序不允许**：sequence 由 PG 每 run 单调分配（INSERT ... RETURNING）；消费方发现缺口=触发重拉。
- live-only 与持久化：V1 全部事件既推送又落库（model 流式 token V1 不推流式 chunk，只推 model_call_completed+tokenUsage；stream chunk=Future）。

## 3. 日志面板（前端消费策略）

- Run Detail（编辑器外独立页，路由冻结 `/config/tasks/:taskId/runs/:runId`）：
  - 执行中：SSE 实时；节点时间线（顺序+耗时条），点击节点→输入/输出/错误/Tool Call/Model Call 明细（node_run+call_record）。
  - 列表/统计：**轮询兜底** 10s（列表）/3s（运行中详情），Sim 节奏 Direct Reuse。
- 日志复制/下载：节点输出 JSON 复制 + Run 级 JSON 下载（quickservice 未验证项，我们 Designed 补齐）。
- 从失败定位：node_failed 事件带 nodeId → "在 Designer 中查看"按钮（`/config/agents/:agentId?node=<id>&version=<v>` 高亮节点，06 §1）。
- 筛选：按节点类型/状态/耗时阈值；搜索节点名。

## 4. 存储与保留

- run_event：按 run 分区索引；保留 30 天（配置项）；归档 V2。
- call_record：请求/响应**脱敏后**存储（12 §1 管道）；大 payload（>64KB）V1 截断+`truncated:true` 标记，外置存储=Future（Sim execution_large_values 思想记录不采用）。
- token/成本：node_run.token_usage + run.token_usage 汇总；V1 不做独立 usage_log 账本（Sim 账本=Future，若需对账再引入 eventKey 幂等模式）。

## 5. 工具调用日志（Tool 级，独立于 Run）

- `GET /tools/{id}/calls?start&end&status`：跨 Run 的工具视角（quickservice 调用日志页借鉴，01 §4）：时间/状态/耗时/归属 Run/错误。
- 与 node_run 关系：call_record.node_run_id 反向可跳 Run Detail。

## 6. 可观测性

- structlog 结构化日志，contextvars 注入 run_id/node_run_id/job_id；
- /metrics（prometheus-client，可选开）：queue 深度、run 状态计数、节点耗时 p95、scheduler tick 延迟；
- 审计日志（12）独立表；
- 不接厂商遥测（Sim PostHog/默认 OTLP=Do Not Adopt）。
