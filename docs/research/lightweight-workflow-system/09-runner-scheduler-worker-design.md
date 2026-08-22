# 09 · Runner / Scheduler / Queue / Worker 设计（Designed）

> Sim 事实：`evidence/sim-part-b-runtime-infra.md`。核心互证：Sim 自托管默认即"PG 表队列 + 同进程 inline worker + 外部 cron 扫表"，无 BullMQ/Temporal/Convex——**证明我们 V1 单机架构可行**（Observed-Source）。
> 不引入 LangGraph；Runner 为自研 DAG 状态机（Reference and Rewrite Sim DAGExecutor 语义）。

## 1. Queue：PG 表队列（Reference and Rewrite Sim async_jobs）

```sql
job_queue(
  id ulid pk, type text,            -- workflow-execution | schedule-tick | tool-test
  payload jsonb, status text,       -- pending|processing|done|failed|cancelled
  run_at timestamptz, attempts int, max_attempts int default 3,
  idempotency_key text unique null, -- 确定性 jobId（Sim 幂等认领思想）
  locked_at timestamptz, locked_by text, error jsonb, created_at
)
-- 认领: UPDATE job_queue SET status='processing', locked_at=now(), locked_by=:w
--       WHERE id=(SELECT id FROM job_queue WHERE status='pending' AND run_at<=now()
--                 ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *;
```
- V1 worker=FastAPI 进程内 asyncio 任务池（并发上限=配置项，默认 8，Sim admission gate 简化版）；**拆独立 worker 进程时仅换消费循环，认领 SQL 不变**（Sim JobQueueBackend 抽象思想）。
- 悬挂回收：30s 扫 `processing 且 locked_at < now()-interval` 重置 pending（补 Sim 未确认项，Designed）。
- 队列层**不自动重试**（同 Sim DB 后端）；重试在节点级与调度级（下 §4/§6）。

## 2. Worker 与 Runner

```
worker 取 job(workflow-execution)
→ RunService.start(run_id): run=running, emit workflow_started
→ 加载 WorkflowVersion.definition（测试模式=draft）→ Validator 快检
→ Serializer: definition → RuntimeGraph（nodes map + adjacency + branches）
→ DAGRunner（asyncio）:
    ready=[start]; while ready or running:
      node=pop ready → node_run(running)+event node_started
      inputs=VariableResolver.resolve(node.inputs, ctx)   # fixed/upstream/input/state/system
      executor=EXECUTORS[node.type] (default→tool executor)
      output=await wait_for(executor.execute(...), node.execution.timeoutMs)
      成功: node_run succeeded + node_output/node_completed 事件 → EdgeRouter 激活后继
      失败: retries 内重试（指数退避 1s/3s）→ 仍败 node_failed + workflow 视 onError fail/skip
      取消: 每节点边界检查 run.cancel_requested → workflow_cancelled
    汇聚: 节点入队条件=所有存活入边已结算（Sim isNodeReady 语义）
    条件: condition 节点 output.selected_branch → 仅激活同 handle 出边，其余分支级联失活（Sim EdgeManager 语义）
→ 终端: 收集 structured outputs → run succeeded + workflow_completed；create-record Sink 幂等写入
→ 全程: run_event 落库（sequence 单调）+ SSE 广播
```

- V1 支持：单 Start、DAG、顺序+条件分支、LLM/Tool/Transform/End/Sink、超时、有限重试、取消、节点级 Logs。
- 后续评估：并行分支（asyncio.gather 已天然支持就绪队列并发，V1 不承诺）、Join 语义、循环、子 workflow、暂停恢复（Sim paused_executions=Future）。

## 3. Variable Resolver（Reference and Rewrite）

- 引用语法 `#{{node_name.outputs.path}}`（节点名归一+唯一性检查，Sim normalizeWorkflowBlockName 逻辑级 Direct Reuse）。
- 作用域：直接上游输出优先；state 仅跨节点共享场景；system={now, run_id, trigger, window}。
- 类型按 PortDef 校验；jsonpath 子集导航；异步无（V1 无远程 selector）。

## 4. 错误 / 超时 / 重试 / 取消

| 机制 | V1 设计 | Sim 对照 |
|---|---|---|
| 节点超时 | asyncio.wait_for + tool 层 aiohttp timeout 双保险 | createTimeoutAbortController |
| 节点重试 | node.execution.retries(0-3)，仅 retryable 错误（5xx/timeout/连接错误） | block.retry + 可重试判定 |
| error 边 | V1 **不做** error-handle 路由；onError=skip 语义保留 | Sim error 边=Future |
| 取消 | run.cancel_requested DB 标志 + worker 每节点边界检查 + asyncio task.cancel（正在等待的 IO） | Sim 三层（Redis+pubsub+轮询）简化为两层 |
| Run 总时限 | run.deadline_at（默认 10min，schedule 触发可配） | executionDeadlineAt |

## 5. Scheduler（Adapter Sim 外部 cron → 进程内 tick）

- 30s tick（asyncio，多实例时 PG advisory lock 单活）：
  `SELECT ... FROM schedule WHERE enabled AND next_run_at<=now() FOR UPDATE SKIP LOCKED`
  → 建 run(trigger=schedule, input=window params, [start,end) 企业时区计算) → 入队 → 用 **croniter+zoneinfo** 前滚 next_run_at（Sim croner 等价，Adapter）。
- 连续失败 ≥5 自动 disable + 通知（Sim failedCount 思想，Reference）。
- 保留 HTTP 端点 `POST /internal/schedules/tick`（CRON_SECRET）供系统 cron 外部驱动（部署可选，Adapter）。
- 抖动：入队 delay 0-5s 随机（Sim SCHEDULE_JITTER 思想，防整点尖峰）。

## 6. 幂等

- API 触发：`Idempotency-Key` header → job_queue.idempotency_key + run.idempotency_key 唯一；重复返回既有 run（Sim claimExecutionId 语义）。
- Schedule：jobId=`sched:{schedule_id}:{next_run_at}` 确定性（Sim 确定性 jobId，Direct Reuse 思想）。
- Sink create-record：键=`run_id+node_id`，重放安全（Master §8.9）。

## 7. 与 Sim 的差异声明

| 项 | Sim | 我们 | 理由 |
|---|---|---|---|
| Run/NodeRun 存储 | 单行 logs + executionData jsonb | 独立 run/node_run 表 | 质检需要按节点聚合/查询/证据回溯；数据量可控 |
| Scheduler | 外部 supercronic 容器 | 进程内 tick + 可选外部端点 | 单机少一个容器；接口等价 |
| 暂停/恢复 | 完整快照续跑 | V1 Omit | 复杂度/价值比低，Future |
| 并行 | 就绪队列并发 | 同机制但 V1 不承诺 SLA | 先保顺序语义可解释 |
