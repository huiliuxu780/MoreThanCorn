# 03 · Sim 源码架构研究（Observed-Source 汇总）

> 基线：/Users/rivers/ZCodeProject/sim @ main 2d2b8a5930，git status 干净。全程只读。
> 完整证据：`evidence/sim-part-a-editor-registry.md`（编辑器/DSL/Registry）、`evidence/sim-part-b-runtime-infra.md`（Runtime/Schedule/Queue/Logs）。本文为汇总与取舍，引用以 Part A/B 为准。

## 1. 总体架构（Observed-Source）

- bun+turbo monorepo：apps/sim（Next.js：API+前端+执行器同仓）、apps/realtime（Socket.IO 协作）、apps/pii、packages/{db,workflow-types,workflow-persistence,deployment-config,...}。
- 持久层单一 PostgreSQL（Drizzle，schema.ts 4979 行）：草稿规范化三表、部署版本 JSON 快照、async_jobs 队列、workflow_execution_logs、workflow_schedule、paused_executions、credential、usage_log。
- **不使用** Convex/Inngest/Temporal/BullMQ；Convex 仅是被集成的工具。自托管默认全 built-in：DatabaseJobQueue + 进程内联 worker + 外部 supercronic cron；Trigger.dev/Redis/E2B 均可选且有内建回退。

## 2. 三态数据形状（Part A 核心发现）

1. 编辑器态：Zustand `WorkflowState{blocks: Record<id,BlockState>, edges, loops, parallels, variables}`；subblock 值独立 store。
2. 运行时态：`SerializedWorkflow{blocks: SerializedBlock[], connections[]}`；`SerializedBlock.config={tool, params}`——**所有节点坍缩为"tool id + 参数"**；条件挂在 connection.condition / sourceHandle。
3. DB 态：草稿=workflow_blocks/edges/subflows 三表；版本=workflow_deployment_version.state 整包 JSON 快照（(workflowId,version) 唯一+isActive）；**schedule/webhook 绑定 deploymentVersionId（触发绑版本不绑草稿）**。

## 3. Registry 体系（Part A）

- Block：`BLOCK_REGISTRY: Record<type, BlockConfig>` 静态 map + overlay（custom block）；BlockMeta 目录与执行分离（"Never read by the executor"）。
- 画布 nodeTypes 仅 4 个——**所有业务节点共用一个通用组件**，完全声明式驱动。
- Handler：canHandle 谓词数组+Generic 兜底（线性 first-match）。
- Tool：扁平 `Record<toolId, ToolConfig>`（params schema + request 配方 + transformResponse）；**Block≠Tool**，一对多，序列化时 selectToolId 坍缩。
- Model：目录层 PROVIDER_DEFINITIONS + 执行层 providerRegistry；引用=内联 model id 字符串。
- Connection：OAUTH_PROVIDERS 静态目录 + credential 表实例；引用=credential id。
- Trigger：TRIGGER_REGISTRY（74 服务，自带 subBlocks+outputs）+ webhook/schedule 实例表。
- 关联键**全部字符串**；环检测/边去重/名字归一为共享包纯函数（client+realtime 共用）。

## 4. 执行内核（Part B）

- 调用链：v2 execute 路由 → executeWorkflowService(sync|async|stream) → [async: JobQueue] → executeWorkflowCore → Serializer → DAGExecutor（ExecutionEngine 就绪队列并发 + EdgeManager 边激活/级联失活 + BlockExecutor + VariableResolver）→ tools/providers → LoggingSession 单行落库。
- 条件路由=上游输出 selectedOption/selectedRoute + sourceHandle；汇聚=入边全完成。
- 错误：error 边路由；重试：块级 retry（队列层不重试）；超时：AbortController 统一；取消：持久标记+pub/sub+500ms 轮询 backstop 三层。
- 暂停/恢复：paused_executions 快照+resume_queue 续跑（Wait/Human-in-the-loop）。
- 子 workflow：进程内嵌套 Executor + callChain 防递归。

## 5. Schedule / Queue / Logs（Part B）

- Scheduler=外部 cron（supercronic 容器/K8s CronJob）每分钟打 `GET /api/schedules/execute`（CRON_SECRET）→ 扫 workflow_schedule（nextRunAt<=now，SKIP LOCKED 语义认领）→ 入队；croner 算下次时间（时区感知）；连续失败自动 disable。
- Queue=async_jobs 表+确定性 jobId+onConflictDoNothing 幂等；自托管无独立 worker（inline IIFE）。
- Logs：Run=workflow_execution_logs 单行，NodeRun/ToolCall 折叠进 executionData jsonb（大值外挂 traceStoreRef）；成本=usage_log 账本（eventKey 幂等）。
- 实时：执行流 SSE（execution:/block:/stream: 事件+eventId 重放）；Logs 页轮询 10s/3s；Socket.IO 仅协作。

## 6. 对我们最有价值的 10 个机制（取舍总表，详见 04/08/09/10）

| # | 机制 | 标签 |
|---|---|---|
| 1 | type 字符串贯穿三态 + 单一通用节点组件 + 声明式 BlockConfig | Reference and Rewrite |
| 2 | 编辑态/运行态分离 + `config.tool+params` 扁平运行时形状 | Reference and Rewrite |
| 3 | 环检测/边去重/名字归一纯函数 | Direct Reuse（逻辑级） |
| 4 | DAG 就绪队列 + 边激活/汇聚 + 条件=输出语义+sourceHandle | Reference and Rewrite |
| 5 | async_jobs PG 队列 + 确定性 jobId + 幂等认领 | Reference and Rewrite |
| 6 | 外部 cron→HTTP 扫表调度 + 时区 nextRunAt 前滚 + 失败自动 disable | Adapter |
| 7 | SSE 事件+seq 重放；Logs 轮询节奏 | Reference and Rewrite / Direct Reuse |
| 8 | 块级重试 + error 边 + 三层取消 | 重试/取消 Rewrite；error 边 Future |
| 9 | 触发绑定部署版本快照（不绑草稿） | Reference |
| 10 | 大值外挂 + usage 账本 | Future |

**Do Not Adopt**：realtime 协作、custom block overlay、BlockMeta 目录、sim-auto/mothership（云端）、Trigger.dev、数百 SaaS 工具、计费准入、PostHog/默认遥测、basic/advanced 双模式、block 版本后缀治理。

## 7. Sim 真正支撑闭环的核心模块（回答任务书 §15）

executor/（DAG 内核）+ serializer/ + tools/registry+executeTool + providers/ + lib/core/async-jobs（DB 队列）+ lib/workflows/schedules + lib/logs（LoggingSession）+ packages/db schema。其余（协作/计费/云端路由/沙箱增强）均为外围。
