# Sim 开源仓库调研报告 Part B：运行时基础设施（Runner / Schedule / Queue / Runs-Logs-Events）

调研对象：开源 Sim（Sim Studio），monorepo
调研方式：只读静态追踪（rg + 源码阅读），未运行、未构建、未改任何文件
证据标记：`[Observed-Source]` = 仓库源码直接可见；`[Inferred]` = 由源码结构推断
五类归属：`[仓库真实包含]` / `[需第三方服务]` / `[需 Sim 云端]` / `[本地无法完整运行]` / `[当前无法确认]`

---

## 仓库基线

- 路径：`/Users/rivers/ZCodeProject/sim`，branch=`main`，commit=`2d2b8a5930`（"chore(slim): remove docs site & ollama setup, relocate v2 openapi specs"），git status 干净。[Observed-Source]
- 顶层结构：`apps/`、`packages/`、`openapi/`、`docker/`、`helm/`、`docker-compose.local.yml`、`docker-compose.prod.yml`。[Observed-Source]
- 关键 apps：
  - `apps/sim`：Next.js 主应用（API + 前端 + 执行器 + 后台任务定义），TS 路径别名 `@/` 指向 `apps/sim/`。
  - `apps/realtime`：独立 Socket.IO 实时服务（协作/presence，不是 run 事件流）。
  - `apps/pii`：PII 脱敏服务（企业向）。`apps/desktop`：桌面端。
- 关键 packages：`packages/db`（Drizzle ORM + PostgreSQL schema，单文件 `schema.ts` 4979 行，pg17 + pgvector）、`packages/auth`（better-auth 1.6.23）、`packages/logger`、`packages/realtime-protocol`、`packages/workflow-types`、`packages/workflow-persistence`、`packages/deployment-config`（能力/Provider 定义）、`packages/security`、`packages/runtime-secrets`。[Observed-Source]
- 运行时技术栈：Next.js（App Router，Node runtime）、Drizzle ORM + `postgres`（postgres.js）驱动、Trigger.dev v3（可选后台任务云）、Redis（可选）、Socket.IO（realtime app）、supercronic cron 容器。[Observed-Source]
- 重要澄清：**仓库不使用 Convex/Inngest/Temporal/BullMQ**。`convex` 只是作为一个"集成工具/Block"（`apps/sim/tools/convex/*`、`apps/sim/blocks/blocks/convex.ts`）存在，即 Sim 可以调用用户的 Convex 项目，与 Sim 自身基础设施无关。[Observed-Source]

---

## Runner 真实调用链

### 1. 调用链总览（v2 公开 API，async 模式）

每一跳：文件路径 + 入口符号。[Observed-Source]

```
POST /api/v2/workflows/[id]/execute
  apps/sim/app/api/v2/workflows/[id]/execute/route.ts            → export const POST (withRouteHandler)
    鉴权: v2ApiKeyAuth / 匿名 public-API (isPublicApi && isDeployed)
    递归防护: parseCallChain/validateCallChain/buildNextCallChain (apps/sim/lib/execution/call-chain.ts)
    准入: tryAdmit() (apps/sim/lib/core/admission/gate.ts) — 进程级 in-flight 闸门
  ↓
  apps/sim/lib/workflows/application/execute-workflow.ts         → workflowOperations.execute (API-key 主路径)
  或 apps/sim/lib/workflows/executor/execute-service.ts          → executeWorkflowService()（session/匿名主路径；也是 v2 的服务层）
    - claimExecutionId()          lib/workflows/executor/execution-id-claim.ts（幂等 runId 占用）
    - new LoggingSession()        lib/logs/execution/logging-session.ts
    - preprocessExecution()       lib/execution/preprocessing（限流/部署校验/配额/计费归属/超时策略）
    - mode==='async' → enqueueWorkflowExecution()  lib/workflows/executor/enqueue-execution.ts
  ↓
  apps/sim/lib/core/async-jobs/config.ts                         → getJobQueue()
    - 'trigger-dev' → backends/trigger-dev.ts TriggerDevJobQueue（Trigger.dev 云任务）
    - 'database'    → backends/database.ts   DatabaseJobQueue（Postgres async_jobs 表 + 进程内联执行，默认）
  ↓ （worker 侧）
  apps/sim/background/workflow-execution.ts                      → executeWorkflowJob() / workflowExecutionTask (Trigger.dev task id 'workflow-execution')
    - createTimeoutAbortController (lib/core/execution-limits)
    - preprocessExecution（复核）
    - new ExecutionSnapshot (executor/execution/snapshot.ts)
    - executeWorkflowCore()
  ↓
  apps/sim/lib/workflows/executor/execution-core.ts              → executeWorkflowCore()（自注释 "SINGLE source of truth"）
    - loadDeployedWorkflowState()      lib/workflows/persistence/utils.ts
    - TriggerUtils.findStartBlock()    lib/workflows/triggers/triggers.ts（按 api/chat/webhook/schedule/manual 选 Start block）
    - new Serializer().serializeWorkflow()  apps/sim/serializer/
    - 解密环境变量 envVarValues（lib/environment/utils + lib/core/security/encryption）
    - new Executor({ workflow, envVarValues, workflowInput, workflowVariables, contextExtensions })
  ↓
  apps/sim/executor/index.ts → export { DAGExecutor as Executor }
  apps/sim/executor/execution/executor.ts                        → DAGExecutor.execute(workflowId, triggerBlockId)
    - DAGBuilder.build()                 executor/dag/builder.ts
    - buildExecutionPipeline() → ExecutionEngine / EdgeManager / BlockExecutor / 三个 Orchestrator
  ↓
  apps/sim/executor/execution/engine.ts                          → ExecutionEngine.run(triggerBlockId)
    while(hasWork()) processQueue()
    processQueue() → dequeue → executeNodeAsync(nodeId) → trackExecution(promise)（就绪节点并行）
  ↓
  apps/sim/executor/orchestrators/node.ts                        → NodeExecutionOrchestrator.executeNode()
    - loop 哨兵节点 → LoopOrchestrator (executor/orchestrators/loop.ts)
    - parallel 哨兵节点 → ParallelOrchestrator (executor/orchestrators/parallel.ts)
    - 普通节点 → BlockExecutor.execute()
  ↓
  apps/sim/executor/execution/block-executor.ts                  → BlockExecutor.execute()
    - findHandler(block)：handler 集合来自 executor/handlers/registry.ts createBlockHandlers()
      （Trigger/Function/Api/Condition/Router/Response/HumanInTheLoop/Agent/Mothership/Pi/Variables/Workflow/Wait/Evaluator/CredentialGroup/Credential/Generic）
    - VariableResolver.resolveInputs()   executor/variables/resolver.ts（解析 <blockId.output> 引用、变量、环境变量）
    - runHandlerWithRetry(...)           （块级重试，见下）
  ↓（工具型块）
  apps/sim/executor/handlers/generic/generic-handler.ts          → GenericBlockHandler.execute
    - getTool(block.config.tool)  apps/sim/tools/utils.ts
    - executeTool(toolId, inputs, { executionContext })   apps/sim/tools（tools/registry.ts 注册表 → HTTP/SDK 调用外部服务）
  ↓（模型/Agent 块）
  apps/sim/executor/handlers/agent/agent-handler.ts              → AgentBlockHandler
    - lib/model-router/resolve.ts（sim-auto 分层路由，需 Sim 云端 mothership）或直接指定模型
    - apps/sim/providers/*（anthropic/openai/gemini/... registry.ts，SDK 直连模型厂商）
  ↓（节点完成后）
  executor/execution/engine.ts → handleNodeCompletion()
    - nodeOrchestrator.handleNodeCompletion()（setBlockOutput、作用域记账）
    - EdgeManager.processOutgoingEdges(node, output)  executor/execution/edge-manager.ts
      shouldActivateEdge：按 output.selectedOption / selectedRoute / sourceHandle（含 error 边）决定后继
      isNodeReady：入边全部完成才入队（汇聚语义）
    - addMultipleToQueue(readyNodes) → 回到 processQueue 循环
  ↓（持久化，贯穿全程）
  lib/workflows/executor/execution-core.ts 的 wrappedOnBlockStart/wrappedOnBlockComplete
    → LoggingSession.onBlockStart/onBlockComplete（lib/logs/execution/logging-session.ts）
    → 更新 workflow_execution_logs 单行（executionData jsonb 折叠写入 traceSpans/blockLogs 等）
  ↓（收尾）
  execution-core.ts → finalizeExecutionOutcome() + updateWorkflowRunCounts()
  返回 ExecutionResult { success, output, logs, executionState, metadata, status? }
```

### 2. 三种执行模式

`executeWorkflowService` 支持 `mode: 'sync' | 'async' | 'stream'`（`lib/workflows/executor/execute-service.ts`）：[Observed-Source]

- **sync**：进程内直接 `executeWorkflowCore`（`ExecutionSnapshot` → `new Executor`），带 `createTimeoutAbortController(sync 超时)`；结果 JSON 返回。
- **stream**：`createStreamingResponse()`（`lib/workflows/streaming/streaming.ts`）返回 SSE Response；内部 `executeFn` 调 `executeWorkflow()`（`lib/workflows/executor/execute-workflow.ts`，带 onStream/onBlockComplete 回调）。
- **async**：`enqueueWorkflowExecution()` 入队后立即 202 返回 `{ runId, statusUrl }`；由 worker 执行，客户端轮询 `GET /api/v2/workflows/[id]/runs/[runId]`。
- **builder 手跑**（草稿态）：前端 `app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution.ts` + `hooks/use-execution-stream.ts` → `POST /api/workflows/[id]/execute`（`app/api/workflows/[id]/execute/route.ts`，`useDraftState=true`，session 鉴权），同样返回 SSE。[Observed-Source]

### 3. 后继节点确定 / 条件路由

- DAG 由 `DAGBuilder.build(workflow, { triggerBlockId, ... })` 构建（节点=block，边=reactflow edges）。[Observed-Source]
- 条件路由不靠"条件求值器"，而靠**上游块的输出语义 + 边的 sourceHandle**：`EdgeManager.shouldActivateEdge(edge, output)` 检查 `output.selectedOption`（Condition 块）/`output.selectedRoute`（Router 块、循环/并行哨兵的 `EDGE.LOOP_CONTINUE`/`EDGE.PARALLEL_CONTINUE`、错误边 `EDGE.ERROR`）。未激活的边级联失活（`deactivateEdgeAndDescendants`）。[Observed-Source]
- 汇聚：`isNodeReady` 要求所有存活入边完成（`incomingEdges` 逐一删除）。[Observed-Source]

### 4. 输入解析 / 变量作用域

- `VariableResolver.resolveInputs(ctx, nodeId, params, block)`（`executor/variables/resolver.ts`）：解析 `<blockId.field>` 引用（异步导航 `navigatePathAsync`）、workflow variables、environment variables（个人/工作区两级，AES 加密存储，`lib/environment/utils.ts` + `lib/core/security/encryption`）。[Observed-Source]
- 作用域：`NodeExecutionOrchestrator.handleNodeCompletion` 经 `state.setBlockOutput` 写入 `ExecutionContext.blockStates`；loop/parallel 有独立 scope（`getLoopScope`/`getParallelScope`）与克隆子流 ID 体系（`executor/utils/subflow-utils.ts`）。[Observed-Source]
- Function 块有专用解析 `resolveInputsForFunctionBlock`（携带 context 变量注入代码沙箱）。[Observed-Source]

### 5. Executor/Handler 查找与 Tool/Model 调用

- Block handler 注册表：`executor/handlers/registry.ts createBlockHandlers()`（硬编码 new 列表，非插件发现）。找不到 handler 抛 `No handler found for block type`。[Observed-Source]
- Tool：`tools/` 目录下每个工具一个目录 + `tools/registry.ts` 汇总；`executeTool()`（`tools/index.ts`）统一入口，注入 `_context`（workflowId/workspaceId/executionId/userId）。工具基本是对外部 SaaS 的 HTTP/SDK 封装（数百个）。[Observed-Source]
- Model：`providers/registry.ts` 聚合 30+ provider（anthropic、openai、gemini、bedrock、ollama、openrouter、litellm、vllm 等），每个 provider `executeRequest(request)` 用**调用方解析出的 apiKey**（BYOK：从工作区/个人环境变量解密；或 Sim hosted key）直连厂商 SDK。[Observed-Source]
- `lib/model-router/resolve.ts` 的 `sim-auto` 自动模型路由：调用 Sim 云端 mothership 分类器（`fetchGo` → `getMothershipBaseURL()`），并依赖托管计费模型池 → **需要 Sim 云端**，自托管不使用 sim-auto 即可绕开。[Observed-Source][需 Sim 云端]

### 6. 错误 / 超时 / 重试 / 取消 / 循环 / 并行 / 暂停恢复 / 子 workflow 支持现状

| 机制 | 现状 | 关键证据 |
|---|---|---|
| 错误 | 块级 try/catch → `handleBlockError`；支持 **error 边**（sourceHandle=`error`）路由到备用分支；错误分类 `classifyExecutionError`（`executor/utils/errors.ts`） | block-executor.ts、edge-manager.ts [Observed-Source] |
| 超时 | sync：preprocessing 给 sync 超时；async：按计费归属取上限并可被 `executionTimeoutSeconds`（仅 async）收紧；统一 `createTimeoutAbortController`（`lib/core/execution-limits`），超时→AbortSignal→运行标记 failed/TIMEOUT | workflow-execution.ts、execute-service.ts [Observed-Source] |
| 重试 | **块级重试**：block 配置 `retry`（`resolveBlockRetryPolicy` `executor/execution/block-retry.ts`，`runHandlerWithRetry`）；**调度基础设施重试**：schedule 的 `infraRetryCount`（`SCHEDULE_INFRA_RETRY_MAX_ATTEMPTS`）；Trigger.dev 重试在 trigger.config 里默认关闭（`maxAttempts: 1`）；**队列层（DB 后端）无失败自动重试**（inline 失败直接 markJobFailed） | 各文件 [Observed-Source] |
| 取消 | `POST /api/v2/workflows/[id]/runs/[runId]/cancel` → `cancelWorkflowRun`（`lib/workflows/application/cancel-run.ts`）→ `cancelWorkflowExecution`（`lib/execution/cancel-workflow-execution.ts`）→ `markExecutionCancelled`（`lib/execution/cancellation.ts`：Redis 持久 key `execution:cancel:<id>` + pub/sub 广播；无 Redis 则仅进程内 EventEmitter）→ `ExecutionEngine` 订阅频道 + 每 500ms 轮询持久标记（backstop）→ abort；DB 队列另 abort 内存中 AbortController；客户端断连经 `req.signal` 级联 abort | engine.ts、cancellation.ts [Observed-Source] |
| 循环 | Loop 容器序列化为哨兵节点 + 回边（`EDGE.LOOP_CONTINUE`），`LoopOrchestrator` 管理迭代作用域与计数 | orchestrators/loop.ts、subflow-utils.ts [Observed-Source] |
| 并行 | Parallel 容器：`ParallelExpander`（`executor/utils/parallel-expansion.ts`）克隆分支子流，引擎就绪队列天然并发执行各分支（`trackExecution` Promise 集合）；**同进程并发**，非分布式 | orchestrators/parallel.ts、engine.ts [Observed-Source] |
| 暂停/恢复 | Wait 块（time pause，`resumeAt`，上限 30 天）与 Human-in-the-loop 块返回 `PauseMetadata` → 引擎 `buildPausedResult` 序列化快照 → `handlePostExecutionPauseState`（`lib/workflows/executor/pause-persistence.ts`）写 `paused_executions` 表；恢复：v2 resume 路由 / webhook resume → `PauseResumeManager`（`lib/workflows/executor/human-in-the-loop-manager.ts`）→ `resume_queue` 表 → `resumeExecutionTask`（background/resume-execution.ts）→ `executeWorkflowCore(resumeFromSnapshot)`（pendingQueue/remainingEdges 续跑）；时间到点恢复由 `/api/resume/poll`（cron 每分钟）扫描 `nextResumeAt` | wait-handler.ts、schema.ts、resume/poll [Observed-Source] |
| 子 workflow | WorkflowBlockHandler（`executor/handlers/workflow/workflow-handler.ts`）**进程内嵌套** new Executor 执行子 workflow（自定义块场景），独立 LoggingSession/日志行；调用链深度防护 `validateCallChain`（`lib/execution/call-chain.ts`，防递归） | workflow-handler.ts [Observed-Source] |

---

## Schedule 与 Trigger

### 触发入口一览 [Observed-Source]

| 触发方式 | 入口 | 说明 |
|---|---|---|
| 手动（builder） | `POST /api/workflows/[id]/execute`（`app/api/workflows/[id]/execute/route.ts`） | session 鉴权，`useDraftState`，SSE 流回前端 |
| API（v1/v2） | `POST /api/v2/workflows/[id]/execute`、`/api/v1/workflows/execute` 等 | API-key 或公开部署匿名（仅 sync/stream） |
| Webhook | `POST/GET /api/webhooks/trigger/[path]`（`app/api/webhooks/trigger/[path]/route.ts`）→ `lib/webhooks/processor.ts` | path 查 `webhook` 表 → provider 验签/验证 → enqueue `'webhook-execution'` |
| Webhook（共享端点） | Slack/TikTok 等走 `app/api/webhooks/slack|tiktok` + `routingKey` 路由 | `webhook.routingKey` 列 |
| Cron/Schedule | 外部 cron（见下）→ `GET /api/schedules/execute`（`app/api/schedules/execute/route.ts`，CRON_SECRET bearer） | 扫描到期 schedule 入队 |
| 轮询型触发器 | cron → `GET /api/webhooks/poll/[provider]`（gmail/outlook/imap/rss/google-sheets/google-drive/google-calendar/hubspot） | 定时拉第三方 |
| 恢复轮询 | cron → `GET /api/resume/poll` | 时间到点的 paused run |
| 工作区事件 | cron → `GET /api/workspace-events/poll`（15min） | workflow_created 等内部事件触发 |

### Scheduler 组件是什么

- **不是 Convex cron，不是应用内自研常驻轮询器**。调度器是**外部 cron 进程**：
  - Docker Compose：`docker/cron.Dockerfile` + `docker/cron-entrypoint.sh` 运行 **supercronic**，读 `docker/crontab`（每分钟 curl 各 `/api/...` 端点，CRON_SECRET bearer 鉴权）。[Observed-Source]
  - Kubernetes：`helm/sim/values.yaml` 的 CronJobs 做同样的事（crontab 注释明确说两者一一对应）。[Observed-Source]
- 应用侧：`/api/schedules/execute` 每次 tick 扫描 `workflow_schedule` 表（`dueFilter`: `nextRunAt <= queuedAt` 且 status 非 disabled/completed 且未被认领），按 `WORKFLOW_CHUNK_SIZE=100` 分批，认领（`lastQueuedAt` CAS + 陈旧认领回收）后入队 `schedule-execution` 任务。并发防重靠应用自身（advisory lock / SKIP LOCKED 语义由查询条件实现）。[Observed-Source]
- cron 解析与下次时间计算：**croner**（`import { Cron } from 'croner'`，schedule-execution.ts / schedules/execute/route.ts / `lib/workflows/schedules/utils.ts calculateNextRunTime`）。[Observed-Source]

### Schedule 数据模型（`workflow_schedule` 表，packages/db/schema.ts:861）[Observed-Source]

- `cronExpression`（text，可空——非 cron 型触发如 webhook/manual 复用该表）、`timezone`（默认 'UTC'）、`nextRunAt`、`lastRanAt`、`lastQueuedAt`、`triggerType`（manual/webhook/schedule）、`status`（active/disabled/completed）、`failedCount`（连续失败 ≥ `MAX_CONSECUTIVE_FAILURES` 自动 disable 并通知）、`infraRetryCount`、`maxRuns`/`runCount`/`lifecycle`(persistent/until_complete)/`endsAt`/`excludedDates`（EXDATE）、`deploymentVersionId`（绑定部署版本）。
- 有针对到期扫描的部分索引 `workflow_schedule_due_workflow_idx`。
- **启停**：status 字段 + archivedAt；UI/API 路由 `app/api/schedules/[id]/route.ts`、`app/api/v2` 相应资源。

### Schedule 执行链

```
supercronic/helm CronJob → GET /api/schedules/execute (CRON_SECRET)
  → app/api/schedules/execute/route.ts（扫描/认领/限流 SCHEDULE_WORKFLOW_ENQUEUE_LIMIT、抖动 SCHEDULE_JITTER_MAX_MS）
  → getJobQueue().enqueue('schedule-execution', payload, { jobId: 确定性 id, delayMs })
    - Trigger.dev 后端: background/schedule-execution.ts scheduleExecution task
    - DB 后端: 同请求内 executeDatabaseScheduleJob()（sleep(delayMs) → startJob CAS 认领 → 内联执行 executeScheduleJob）
  → executeScheduleJob → preprocessExecution → executeWorkflowCore → LoggingSession 落 workflow_execution_logs
  → 成功: lastRanAt/nextRunAt 前滚（croner 计算，带时区）；失败: buildScheduleFailureUpdate（failedCount+1，超限自动 disable）
```
[Observed-Source]

---

## Queue 与 Worker

### 用什么 Queue

- **抽象层**：`lib/core/async-jobs/`（`types.ts` 定义 `JobQueueBackend` 接口：enqueue/batchEnqueue/batchEnqueueAndWait/getJob/startJob/completeJob/markJobFailed/cancelJob/cancelByExecution/cancelByKey）。[Observed-Source]
- **后端选择**：`lib/core/async-jobs/config.ts getAsyncBackendType()` → `getConfiguredAsyncJobsProvider()`（`packages/deployment-config/src/env-capabilities.ts ASYNC_JOBS_CAPABILITY`）：
  - `trigger-dev`：需要 `TRIGGER_DEV_ENABLED=TRUE` + `TRIGGER_PROJECT_ID` + `TRIGGER_SECRET_KEY`（Trigger.dev v3 云）。
  - `database`（**默认 provider，built-in "Database queue"**）：Postgres `async_jobs` 表。
  - 特例：进程本身在 Trigger.dev task 内（`taskContext.isInsideTask`）则强制 trigger-dev。[Observed-Source]
- **没有 BullMQ、没有 Convex、没有内存队列库**；Redis 不做队列（仅 pub/sub + 缓存 + 取消标记）。[Observed-Source]

### Worker 形态

- **Trigger.dev 后端**：worker 是 Trigger.dev 云托管的独立运行环境（`trigger.config.ts`：`runtime node-24`、`dirs: ['./background']`、每 task `queue.concurrencyLimit`、`machine: 'medium-2x'`、maxDuration 5400s）。`background/*.ts` 中每个文件用 `task()` 定义：workflow-execution、schedule-execution、webhook-execution、resume-execution、cleanup-logs、table-* 等约 20 个任务。[Observed-Source][需第三方服务（Trigger.dev SaaS，或自建 Trigger.dev 开源服务端——仓库未包含自建配置）]
- **database 后端（自托管默认）**：**没有独立 worker 进程**。`DatabaseJobQueue.enqueue` 写 `async_jobs` 行后，若提供 `runner` 回调（`enqueue-execution.ts` 在 `shouldExecuteInline()` 为 true 时总是附带 runner），立即 `runInline()`——fire-and-forget IIFE 在 **Next.js 服务进程内**异步执行：`startJob`（`UPDATE ... SET status='processing' WHERE status='pending'` 原子认领）→ `runner(payload, signal)` → `completeJob`/`markJobFailed`。[Observed-Source]
- 因此自托管时"worker"与 Web 服务同进程；重启 Next.js 会中断正在跑的 inline run（`async_jobs` 行会停在 processing——未观察到自动回收 processing 行的 poller；schedules 有陈旧认领回收逻辑）。[Inferred]

### 并发 / 重试 / 超时 / 取消 / 幂等

- **并发**：
  - Trigger.dev：task 级 `concurrencyLimit`（`background/concurrency-limits.ts`：workflow=75、webhook=75、resume=50，可 env 覆盖）。
  - DB 后端：`acquireSlot/releaseSlot` 进程内信号量（按 `concurrencyKey`）；另进程级准入闸门 `tryAdmit`（`lib/core/admission/gate.ts`，compose 默认 `ADMISSION_GATE_MAX_INFLIGHT=500`）。[Observed-Source]
- **重试**：`async_jobs.maxAttempts` 默认 3、`attempts` 计数存在，但 DB 后端 inline 路径失败只 `markJobFailed`，**未观察到重新派发逻辑**（无 poller drain pending/failed 行）→ 实质上队列层不重试；重试责任在块级（block retry）与调度 infra-retry。[Observed-Source + Inferred]
- **超时**：job 元数据 `maxDurationSeconds`；真正生效的是执行侧 `createTimeoutAbortController`（async 上限按计费归属，可被调用方 `executionTimeoutSeconds` 收紧）。[Observed-Source]
- **取消**：`cancelByExecution(binding, scope)`——DB 后端 abort 内存 controller + 按 payload/metadata 中 executionId 批量 `UPDATE status='cancelled'`；Trigger.dev 后端走其 cancel API（`backends/trigger-dev.ts`）。[Observed-Source]
- **幂等**：确定性 jobId（`WORKFLOW_EXECUTION_JOB_ID_PREFIX + executionId`，`execution-job-ids.ts`）+ `onConflictDoNothing`；调用方可自带 `X-Run-Id`，`claimExecutionId` 保证 runId 唯一占用，冲突返回 `EXECUTION_ID_CONFLICT/RUN_ID_CONFLICT`。[Observed-Source]

### 本地自托管能否完整运行

**能（核心执行链）**。`ASYNC_JOBS_CAPABILITY` 默认 provider 就是 built-in database 队列；`docker-compose.prod.yml` 的完整服务集合为：`simstudio`（Next.js 主应用）、`realtime`（Socket.IO）、`migrations`（drizzle migrate）、`redis`（pub/sub+缓存）、`cron`（supercronic）、`db`（pgvector/pg17）。不需要 Trigger.dev、不需要 Sim 云端即可跑通：手动/API/webhook/cron 触发 → 执行 → 日志 → 暂停恢复 → 取消。[Observed-Source]
注意 compose 注释：不设置 REDIS_URL 时存储/缓存回退 Postgres，但 pub/sub 频道无跨进程回退——无 Redis 时"live status"不能跨进程流送（单进程内 EventEmitter 回退仍可用）。[Observed-Source]

---

## Runs-Logs-Events 与实时订阅

### 数据模型（packages/db/schema.ts，Drizzle/pg）[Observed-Source]

| 概念 | Sim 实现 | 表 |
|---|---|---|
| Run | **没有独立 `runs` 表**；一次 run = `workflow_execution_logs` 一行（`executionId` 唯一索引） | `workflow_execution_logs`（schema.ts:418） |
| Run 快照 | workflow 定义快照按 hash 去重，run 行引用 `stateSnapshotId` | `workflow_execution_snapshots`（schema.ts:398） |
| NodeRun / ToolCall / ModelCall | **没有独立表**。节点级信息以 traceSpans/blockLogs 形式存于 run 行的 `executionData` jsonb（重负载可外挂对象存储，列内留 `traceStoreRef` 指针，读经 `materializeExecutionData`） | 同 run 行 |
| Log（运行日志） | 同上，`level`(info/error)、`status`（running/pending/paused/completed/failed/cancelled 等，见 `lib/logs/types.ts PERSISTED_WORKFLOW_EXECUTION_STATUSES`）、`trigger`(api/webhook/schedule/manual/chat)、`startedAt/endedAt/totalDurationMs/executionDeadlineAt`、`costTotal`（usage_log 投影）、`modelsUsed[]`、`files` | `workflow_execution_logs` |
| Job 日志 | 定时"job"型 schedule 的执行日志 | `job_execution_logs`（schema.ts:940） |
| Token/成本 | `usage_log` 账本（category: model/fixed/tool；source: workflow/copilot/...；`cost` decimal；`executionId` 关联；`eventKey` 唯一键防重）；token 数在 provider usage 统计（如 `providers/anthropic/usage.ts`、`providers/stream-pump.ts` 经 `calculateCost`）写入 trace/usage；run 行 `cost` 列已弃用，改用 `costTotal` 投影 | `usage_log`（schema.ts:3745） |
| 队列记账 | `async_jobs`（schema.ts:4235）：type/payload/status/runAt/attempts/maxAttempts/error/output/metadata | `async_jobs` |
| 暂停/恢复关联 | `paused_executions`（snapshot jsonb、pausePoints、nextResumeAt、automaticResumeRetryCount）；`resume_queue`（parentExecutionId → newExecutionId → contextId、resumeInput、status、failureReason）——**取消/重试/恢复的 run 关联靠 executionId 链** | schema.ts:606/637 |
| 大值外挂 | `execution_large_values` / `execution_large_value_references` / `execution_large_value_dependencies`（payload 超限外置存储） | schema.ts:529-605 |
| 内部事件 outbox | `outbox_event`（事务 outbox，处理 billing/deployment/knowledge/file-cleanup 等域事件，`/api/webhooks/outbox/process` cron 消费）——**不是 run 事件流** | schema.ts:3345 |

### 前端实时订阅方式 [Observed-Source]

**四种并存**：

1. **轮询（Logs/Runs 列表页）**：`app/workspace/[workspaceId]/logs/logs.tsx` 用 React Query `refetchInterval`：列表/统计 `LIVE_REFRESH_INTERVAL_MS = 10_000`（10s），运行中 run 详情 `ACTIVE_RUN_DETAIL_REFRESH_MS = 3_000`（3s，仅 status 为 running/pending/redacting 时）。数据源 `GET /api/logs`（`app/api/logs/route.ts` → `lib/logs/list-logs.ts`）与 `/api/logs/execution/[executionId]`。
2. **SSE（执行流）**：`POST /api/workflows/[id]/execute`（builder 手跑）与 v2 `stream:true` 返回 SSE；事件协议 `lib/workflows/executor/execution-events.ts`；客户端 `hooks/use-execution-stream.ts`（fetch + ReadableStream 解析，非 EventSource）。
3. **SSE 重连重放**：`GET /api/workflows/[id]/executions/[executionId]/stream?from=<eventId>` 从缓冲按 `eventId`（seq）重放（live-only 事件类型除外）。
4. **Socket.IO（apps/realtime）**：仅用于 **builder 协作**（presence/cursor/selection/subblock 更新/部署广播/表协作，见 `packages/realtime-protocol/src/events.ts`），**不承载 run/log 事件**。
5. 另有工作区级 SSE 工厂 `lib/events/sse-endpoint.ts`（`createWorkspaceSSE`）用于 MCP events / mothership events 等特定端点。

### 事件名清单与字段（SSE ExecutionEvent，`lib/workflows/executor/execution-events.ts`）[Observed-Source]

基础字段：`type`、`timestamp`、`executionId`、`eventId?`（递增 seq，重放用）。

| type | 关键字段（data） |
|---|---|
| `execution:started` | workflowId, data.startTime |
| `execution:completed` | output（含最终结果）、duration 类元数据 |
| `execution:paused` | pausePoints/contextId 等 |
| `execution:error` | error 信息 |
| `execution:cancelled` | — |
| `block:started` | blockId/blockName/blockType/executionOrder（+iterationContext/childWorkflowContext） |
| `block:completed` | blockId + input/output（display 数据） |
| `block:error` | blockId + error |
| `block:childWorkflowStarted` | 子 workflow 关联 |
| `stream:chunk` / `stream:chunk_reset` / `stream:done` / `stream:thinking` / `stream:tool` | 模型流式 token/工具生命周期（live-only，不进重放缓冲） |

token/成本不入 SSE 事件，落 `usage_log` + trace spans；前端成本展示来自 run 行 `costTotal` 与 usage 聚合。[Observed-Source]

---

## 依赖地图表

（我们目标栈：FastAPI + Pydantic + PostgreSQL + SQLAlchemy + Alembic；前端 Vite + React19 + xyflow + shadcn；不用 LangGraph；V1 单机可跑）

| 领域 | Sim 的实现 | 用途/核心度 | 自托管要求 | 我们是否需要 | 替代方案（对我们） |
|---|---|---|---|---|---|
| 数据库/ORM | PostgreSQL(pg17+pgvector) + Drizzle ORM + postgres.js（`packages/db`，单文件 schema 4979 行） | 核心。一切状态（workflow/部署/run 日志/队列/暂停/凭据）都在 PG | 仅需 PG | 需要（目标栈一致：PG+SQLAlchemy+Alembic） | 直接同构：SQLAlchemy 模型 + Alembic 迁移 |
| Queue | 抽象 `JobQueueBackend`：默认 `DatabaseJobQueue`（async_jobs 表 + 进程内联执行），可选 `TriggerDevJobQueue`（SaaS） | 核心（async 触发/解耦） | 默认零额外依赖（PG 即可） | V1 需要轻量版 | PG 表队列 + FastAPI 进程内 worker（或 asyncio task）；未来可换 Celery/Arq |
| Worker | Trigger.dev 云 worker，或自托管时的 Next.js 进程内 inline IIFE（无独立进程） | 核心 | 自托管=与 Web 同进程 | V1 同进程即可；后续独立 worker | asyncio worker 进程（同一代码库） |
| Scheduler | 外部 cron（supercronic 容器 / K8s CronJob）→ HTTP 端点 → 扫 `workflow_schedule` 表；cron 解析用 croner | 核心（定时触发） | 需要 cron 容器或系统 crontab | 需要 | APScheduler（进程内）或系统 cron 调内部端点；croniter 解析 |
| EventStream（对客户端） | SSE（执行流 + 重放）+ Logs 页轮询（10s/3s）；Socket.IO 仅协作 | 核心（运行可视化） | 无额外依赖 | 需要 SSE（FastAPI StreamingResponse 天然支持） | SSE + 轮询兜底；不上 WebSocket 亦可 |
| Pub/Sub（进程间） | Redis pub/sub（取消广播、缓存），无 Redis 回退进程内 EventEmitter / PG | 外围（单机可省） | Redis 可选 | V1 不需要跨进程 | 进程内 asyncio 事件；取消用 DB 标记轮询 |
| RCE/代码执行 | Function 块：isolated-vm（Node 隔离 VM，`lib/execution/isolated-vm-worker.cjs`）；可选 E2B/Daytona 远程沙箱（SaaS） | 核心（若保留代码块） | 默认可本地 | 需要（Python 侧） | Python `RestrictedPython`/subprocess 沙箱或 Docker 沙箱；V1 可先只给受限内置 API |
| Secrets/凭据 | AES 加密环境变量（`ENCRYPTION_KEY`，`lib/core/security/encryption`）、credential 表、OAuth 凭据 | 核心 | 无外部依赖 | 需要 | SQLAlchemy 模型 + Fernet/AES-GCM 加密列 |
| Auth | better-auth（session+API key+OAuth），`packages/auth` | 核心 | 无外部依赖 | 需要（简化版） | FastAPI 自建 JWT/API-key 中间件 |
| Model Gateway | `providers/` 30+ provider 直连 SDK；`lib/model-router` sim-auto 需 Sim 云端；BYOK 从环境变量解密 | 核心 | 用户自带 key 即可本地跑 | 需要（收敛到少数 provider） | LiteLLM 或自建薄 gateway（OpenAI 兼容） |
| Tool 调用 | `tools/` 数百个 SaaS 工具封装 + `executeTool` 注册表；MCP 客户端支持 | 外围（数量庞大） | 各工具需各自 SaaS 凭据 | V1 只留少量通用工具（HTTP/函数/模型） | 自建精简 tool 注册表；MCP 可后置 |
| FileStorage | `STORAGE_CAPABILITY`：默认 local disk，可选 S3/Azure/GCS | 外围 | 本地磁盘即可 | 需要（大 payload 外置思路值得借鉴） | 本地磁盘 + 可选 S3 |
| Observability | pino 风格 `@sim/logger` + OTLP（默认发 telemetry.simstudio.ai，可关/可改端点）+ PostHog（可选）+ Grafana OTLP（Trigger worker） | 外围 | 无强制 | 需要（结构化日志 + 可选 OTLP） | structlog/loguru + OpenTelemetry 自选后端 |
| 实时协作 | apps/realtime（Socket.IO，presence/协同编辑） | 外围 | 独立容器 | V1 不需要 | Omit |
| 计费/配额 | billing/usage-reservation/admission gate | 外围（SaaS 向） | 无 | V1 不需要（保留简单限流即可） | Omit，保留并发上限 |

---

## 机制处理建议表

| 机制 | 建议标签 | 一句话理由 |
|---|---|---|
| DAGExecutor/ExecutionEngine（就绪队列 + 并发节点执行 + 边激活/汇聚） | **Reference and Rewrite** | 执行内核设计优秀（队列/边/哨兵分离），但 TS 深耦合 Sim 序列化格式，按语义用 Python 重写 |
| 条件路由（output.selectedRoute + sourceHandle 边激活） | **Reference and Rewrite** | 语义简洁有效，直接移植概念到 xyflow 边模型 |
| 变量解析 `<nodeId.output.path>` + 两级 env 作用域 | **Reference and Rewrite** | 核心交互范式必须保留；实现换成 Pydantic + 自写 resolver |
| 块级重试策略（block.retry + 可重试错误判定） | **Reference and Rewrite** | 小而有价值；重试配置模型可直接借鉴 |
| Error 边（失败分支路由） | **Reference and Rewrite** | 低成本高价值的容错表达 |
| Loop/Parallel 哨兵 + 子流克隆 | **Reference and Rewrite（简化）** | 概念好但实现重；V1 先做顺序循环 + 受限并行（asyncio.gather） |
| 暂停/恢复（paused_executions + resume_queue + 快照续跑） | **Future** | 人审/等待是差异化能力，但快照续跑复杂；V1 先 Omit，V2 引入 |
| 子 workflow（WorkflowBlockHandler 进程内嵌套 + 调用链深度防护） | **Future** | 有价值；V1 先不做，注意保留 callChain 防递归思路 |
| async_jobs 数据库队列 + 确定性 jobId + 幂等认领 | **Reference and Rewrite** | 与 PG+SQLAlchemy 栈天然契合，是我们 V1 队列的模板 |
| Trigger.dev 集成（task 定义、trigger.config） | **Do Not Adopt** | SaaS 依赖且我们用 Python 栈；仅借鉴"任务定义与 Web 分离"的结构思想 |
| 外部 cron（supercronic/K8s CronJob）→ HTTP 扫描端点 | **Adapter** | 思路保留（HTTP 触发 + 表扫描 + 认领），V1 用 APScheduler 或系统 cron 适配 |
| croner cron 解析 + 时区 + nextRunAt 前滚 | **Adapter** | 用 croniter/zoneinfo 等价实现 |
| 取消（持久标记 + pub/sub + 轮询 backstop + AbortSignal 级联） | **Reference and Rewrite** | 三层兜底设计值得抄；V1 单机可用 DB 标记 + asyncio cancel 简化 |
| SSE 执行事件协议（execution:/block:/stream: + eventId 重放） | **Reference and Rewrite** | 事件命名与 seq 重放值得借鉴；FastAPI SSE 直接实现 |
| Logs 页轮询（10s/3s 分级） | **Direct Reuse（策略）** | 简单可靠，V1 前端照搬轮询节奏即可 |
| Socket.IO realtime（协作/presence） | **Omit in V1** | 与运行时无关，属编辑器协作层 |
| Run=单行 + executionData jsonb + traceSpans（无 NodeRun 表） | **Reference and Rewrite** | 我们可能更愿意给 NodeRun 独立表（便于查询/聚合），但"重 payload 外挂 + 引用指针"值得借鉴 |
| usage_log 成本账本（eventKey 幂等 + costTotal 投影） | **Reference and Rewrite** | token/成本记录范式成熟；V1 简化为单表账本 |
| 大值外置（execution_large_values + traceStoreRef） | **Future** | V1 单机数据量小；先内联 jsonb，留好引用结构 |
| 事务 outbox（outbox_event + cron 处理） | **Future** | 域事件解耦好模式；V1 无跨域事件需求 |
| Sim model-router（sim-auto）/ mothership / hosted key 池 | **Do Not Adopt** | 强依赖 Sim 云端 |
| PostHog / 默认 OTLP 上报 telemetry.simstudio.ai | **Do Not Adopt** | 第三方/厂商遥测；换自建可观测 |
| isolated-vm / E2B / Daytona 沙箱 | **Omit in V1（Python 等价 Future）** | V1 代码块可用受限 exec/子进程替代，远程沙箱后置 |
| 数百个 SaaS 工具封装（tools/） | **Omit in V1** | 维护成本巨大；V1 只保留 HTTP 请求 + 函数 + 模型三类通用块 |
| 计费/准入闸门（admission gate、usage reservation） | **Omit in V1** | SaaS 运营能力；V1 仅保留简单并发上限 |

---

## 云端依赖与本地自托管结论

### 五类归属清单

**A. Sim 开源仓库真实包含、本地可完整运行** [仓库真实包含]
- DAG 执行内核（executor/）、块 handler、变量解析、序列化器（serializer/）
- 同步/流式/异步三种执行模式与 v1/v2 API 路由
- DatabaseJobQueue（async_jobs 表 + 进程内联 worker）——默认异步后端
- 调度数据模型与扫描执行端点（/api/schedules/execute）+ croner 计算
- Webhook 触发全链路（processor → 入队 → 执行）
- Runs/Logs 持久化（workflow_execution_logs + LoggingSession）、usage_log 成本账本
- 暂停/恢复（paused_executions/resume_queue/resume poll）、取消（无 Redis 时进程内 pub/sub 回退）
- better-auth 认证、AES secrets、local disk 文件存储、PG 缓存（无 Redis 回退）
- Function 块的 isolated-vm 本地沙箱
- docker-compose.prod.yml 全套（app/realtime/migrations/redis/cron/db）

**B. 需要第三方服务（可绕过）** [需第三方服务]
- Trigger.dev v3（云任务后端；仓库仅有客户端集成，无自建服务端配置）→ 用 database 后端绕过
- Redis（pub/sub/缓存/取消持久标记）→ 单进程可用 EventEmitter/PG 回退，跨进程 live 状态需要
- E2B / Daytona（远程代码沙箱）→ 用本地 isolated-vm 绕过
- 各模型厂商 API（Anthropic/OpenAI/…）→ 用户 BYOK，属正常外部依赖
- supercronic 镜像（cron 容器）→ 任意 cron 实现可替代

**C. 需要 Sim 云端（自托管不可用/不应采用）** [需 Sim 云端]
- `sim-auto` 模型路由（mothership 分类器 + 托管模型池）（`lib/model-router/resolve.ts`）
- hosted LLM key 池 / 托管计费（`isHosted()`、`lib/core/config/api-keys.ts` 轮换池）
- 遥测默认端点 telemetry.simstudio.ai（可关：NEXT_TELEMETRY_DISABLED / 改端点）
- mothership 相关块/能力（MothershipBlockHandler、copilot 云端 agent）
- billing/企业能力（席位、组织计费、数据 drains）

**D. 本地无法完整运行（在自托管语境下）** [本地无法完整运行]
- Trigger.dev worker 路径（无 TRIGGER_SECRET_KEY 时自动切 database 后端，故"无法运行"被优雅降级覆盖）
- mothership/copilot 云端 agent 功能
- 需要 OAuth 集成凭据的第三方触发器（Gmail/Outlook/HubSpot 轮询等——机制能跑，但缺凭据无意义）

**E. 当前无法确认** [当前无法确认]
- DB 后端 `async_jobs` 失败/延迟任务是否有隐藏 poller 回收（静态检索只见 schedules 路由内联驱动与清理任务；未做运行时验证）
- Next.js 进程重启后处于 processing 的 inline job 的恢复行为（schedules 有陈旧认领回收，通用 workflow job 未观察到等价逻辑）
- Trigger.dev 后端在自托管 Trigger.dev 开源服务端上的兼容性（仓库无此配置与文档）

### 结论

Sim 的运行时在自托管模式下是**单机可完整运行的**：PG 一个持久层 + 进程内队列/worker + 外部 cron 即构成闭环；Redis/Trigger.dev/E2B 都是可选增强，且每一项都有代码内建的回退路径（`env-capabilities.ts` 的 defaultProvider 全部是 built-in）。这与我们"V1 单机可跑、FastAPI+PG"的目标高度吻合——**Sim 证明了"PG 表队列 + 同进程 worker + cron 扫描"足以支撑一个带 async/pause/resume/cancel 的工作流系统**，无需 BullMQ/Temporal/Convex。

---

## 未确认事项

1. `async_jobs` 在 database 后端是否存在独立 drain/回收进程：静态搜索仅见 `background/cleanup-tasks.ts`（清理旧行）与 schedules 路由的内联驱动；未确认 processing 悬挂行的恢复策略。[当前无法确认]
2. `ACTIVE_RUN_DETAIL_REFRESH_MS`/`LIVE_REFRESH_INTERVAL_MS` 数值来自 logs.tsx 常量（3_000/10_000），但部分前端常量在 slim 化提交后名称显示异常，数值以源码 `const ... = 3_000 as const` 形式确认。[Observed-Source，注记]
3. v1 API（`app/api/v1/...`）与 v2 的执行差异未逐条比对（v2 为主路径，v1 保留兼容层）。
4. isolated-vm 沙箱的资源限制参数（内存/超时）未逐项核对（位于 `lib/execution/sandbox/` 与 isolated-vm-worker.cjs）。
5. Helm 侧 CronJobs 与 docker/crontab 的逐条等价性仅依据 crontab 头注释，未逐行比对 helm/sim/values.yaml。
6. 前端 Run 详情面板的 traceSpans 渲染（时间线瀑布图）组件未深入，仅确认数据来源为 `executionData.traceSpans`。
7. `workflowCheckpoint`/copilot 运行态与主执行引擎的边界未展开（属 Copilot 子系统，非工作流运行时）。

---

### 附录：本报告引用的关键文件（相对 `/Users/rivers/ZCodeProject/sim`）

- `apps/sim/app/api/v2/workflows/[id]/execute/route.ts`（v2 执行入口）
- `apps/sim/lib/workflows/executor/execute-service.ts`（sync/async/stream 编排）
- `apps/sim/lib/workflows/executor/enqueue-execution.ts`（异步入队 + 幂等语义）
- `apps/sim/lib/workflows/executor/execution-core.ts`（执行核心，Executor 装配）
- `apps/sim/executor/execution/{executor,engine,block-executor,edge-manager,state,snapshot}.ts`（DAG 内核）
- `apps/sim/executor/orchestrators/{node,loop,parallel}.ts`、`apps/sim/executor/handlers/*`
- `apps/sim/executor/variables/resolver.ts`、`apps/sim/executor/execution/block-retry.ts`
- `apps/sim/lib/core/async-jobs/{config.ts,backends/database.ts,backends/trigger-dev.ts,types.ts}`
- `apps/sim/background/{workflow-execution,schedule-execution,webhook-execution,resume-execution,concurrency-limits}.ts`、`apps/sim/trigger.config.ts`
- `apps/sim/app/api/schedules/execute/route.ts`、`docker/crontab`、`docker/cron-entrypoint.sh`、`docker/cron.Dockerfile`
- `apps/sim/app/api/webhooks/trigger/[path]/route.ts`、`apps/sim/lib/webhooks/processor.ts`
- `apps/sim/lib/execution/cancellation.ts`、`apps/sim/lib/events/pubsub.ts`
- `apps/sim/lib/logs/execution/logging-session.ts`、`apps/sim/lib/logs/list-logs.ts`、`apps/sim/app/api/logs/route.ts`
- `apps/sim/lib/workflows/executor/execution-events.ts`、`apps/sim/hooks/use-execution-stream.ts`
- `apps/sim/app/workspace/[workspaceId]/logs/logs.tsx`（轮询节奏）
- `apps/sim/lib/model-router/resolve.ts`、`apps/sim/providers/*`、`apps/sim/lib/core/config/api-keys.ts`
- `packages/db/schema.ts`（workflow_schedule:861 / workflow_execution_logs:418 / paused_executions:606 / resume_queue:637 / async_jobs:4235 / usage_log:3745 / outbox_event:3345）
- `packages/deployment-config/src/env-capabilities.ts`（storage/sandbox/jobs/cache 能力与默认 provider）
- `docker-compose.prod.yml`（自托管服务拓扑）
