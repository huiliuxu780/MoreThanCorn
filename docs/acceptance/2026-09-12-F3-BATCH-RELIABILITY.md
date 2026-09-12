# F3 分析批跑可靠性 · 自验记录（2026-09-12）

> Spec：`execution-automation-batch-spec.md` §9/§9.2.1/§9.2.2/§12.4/§19 F3
> 状态：自验通过（全量 544 绿），未提交待验收

## 交付

| 项 | 内容 |
|---|---|
| 迁移 g056batchrl0001 | task_run：processed_count/total_state/cancel_requested_at/deadline_at/outcome_code/retry_of_task_run_id/run_scope/retry_round；job_queue：lease_expires_at/heartbeat_at/owner_run_id/cancel_requested_at；新表 task_run_error_agg（UNIQUE(run,category,code)） |
| 增量计数（AC-030/031） | 读取阶段结束即落 total+total_state=exact；每完成一项原子 `processed_count+1`；终态 processed=total；计数恒等 processed=succ+fail+skip+cancel |
| 有界并发（AC-032） | `sampling.concurrency`（默认 4）ThreadPoolExecutor；测试断言峰值≤上限 |
| 取消（AC-033） | `POST /api/task-runs|analysis-task-runs/{id}/cancel`（202，终态 409）；未派发项落 cancelled Run；批次 cancelled；活动项自然结算 |
| 超时 | 批次 deadline_at + 项级 item_timeout（sampling.item_timeout_seconds，默认 600）→ ITEM_TIMEOUT |
| 崩溃恢复（AC-036） | claim 写 lease_expires_at/owner_run_id，心跳续租；recover 按 lease_expires_at 回收（旧行回退 locked_at）；重入时陈旧 running 项（started_at>10min）重置重跑 |
| Recovery 重试（AC-034/035/035A） | retry-failed = 新建 Recovery TaskRun（retry_of/run_scope=failed_items/retry_round+1，冻结版本复制），原批次保持终态；仅预置失败项；无失败项幂等空操作 |
| 错误聚合 | TaskRunErrorAgg upsert（category/code/count/sample_refs）；summary topErrors 数据源 |
| summary（§12.4） | `GET /api/task-runs|analysis-task-runs/{id}/summary`：totalState/total/processed/active/counts/ratePerSecond/etaSeconds/topErrors/executionStatus/deliveryStatus |
| 空数据集（AC-038） | read_n=0 或全 skipped → status=succeeded + outcome_code=NO_ELIGIBLE_ITEMS（不再显示系统失败） |
| DTO | task-run DTO 增 processedCount/totalState/outcomeCode/cancelRequestedAt/retryOfTaskRunId/runScope/retryRound |

## 测试证据

```
test_f3_batch_reliability 6 条：AC-030/031 计数恒等、AC-033 取消全 cancelled+终态409、
AC-035A Recovery 血缘/作用域/轮次+原批次终态+幂等空操作、AC-038 outcome_code、
summary 形状、并发上限峰值断言。
旧语义测试同步迁移：test_p1_partial（Recovery attempt=2+谱系）、
test_r3_task_agent_target（冻结快照复制+原批次 attempt 不变）、清理夹具防看板污染。
全量: pytest 544 passed / tsc 0 错 / vitest 65 / build ✓
```

## 已知边界（登记）

1. 项级超时：future.result(timeout) 触发后设 abandoned 标记，迟到线程自查并重放 ITEM_TIMEOUT 失败终态（覆盖迟到提交，不产生双写）；
2. 并发上限为进程内 ThreadPool（单机）；跨进程配额属后续切片；
3. Recovery 批次不支持嵌套 Recovery 的 UI 展示（数据血缘已具备）；
4. summary 的 rate/eta 基于 processed_count/elapsed 的粗估。
