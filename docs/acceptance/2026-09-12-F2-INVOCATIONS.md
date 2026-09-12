# F2 AutomationInvocation 补全 · 自验记录（2026-09-12）

> Spec：`execution-automation-batch-spec.md` §19 F2 / §7 / §12.3 / §13.1
> 状态：自验通过（全量 533 绿），未提交待验收

## 交付

| 项 | 内容 |
|---|---|
| 迁移 g055invoc0001 | trigger_log 补 §7.2 全部字段：conversation_key/budget_snapshot/usage_summary/target_kind/target_ref/attempt/retry_of_id/queued_at/started_at/ended_at/error_code/error_detail/cancel_requested_at/input（retry 依据）；**partial unique index `uq_triggerlog_idem(automation_id, idempotency_key)`** 幂等原子化 |
| dispatch 重写（§7.4） | 接收事实(RECEIVED)→幂等（预检+IntegrityError 兜底；同 key 同 payload 返回原 Invocation，异 payload `[IDEMPOTENCY_PAYLOAD_MISMATCH]`）→P0-5 原子门（REJECTED 带码：AUTOMATION_DISABLED/MAX_RUNS_REACHED/DEADLINE_PASSED，**并释放幂等键**）→accepted→target 占位（target_kind/ref 写入）→queued→（agent 派发成功即 RUNNING+started_at） |
| 端点族 | run-now **202+Invocation DTO+Location/statusUrl**；`GET/POST /api/v2/invocations/{id}`（详情/取消）；`POST /api/v2/invocations/{id}/retry`（终态后新 Invocation：retry_of_id+attempt+1+同冻结 input）；`GET /api/v2/automations/{aid}/invocations`（Invocation DTO 历史，旧 history 保留）；外部 invoke 迁新契约（202） |
| 取消矩阵（§12.3） | agent_session=中断 Session（尽力）；agentflow_run=queued 直取/running 中断节点 Session；workflow_run=queued 直取、**运行中 409（runner 无运行中取消能力，登记）**；`cancel_requested_at` 记录取消意图 |
| watcher 对账升级 | queued→RUNNING 翻转（带 started_at）；终态映射修正（**cancelled 不再误判 failed**；cancel_requested 优先→cancelled）；目标缺失→`FAILED/TARGET_EXECUTION_MISSING`；settle 带 ended_at/error_code |

## 测试证据

```
定向: pytest tests/test_f2_invocations.py → 6 passed
相关: F0 13 + F1 5 + mtc002a 8（旧契约断言同步 202 新形状）全部绿
全量: pytest tests/ → 533 passed（527 + 6 新增）
```

新增断言：AC-010（同 key 同 payload 同 Invocation）；AC-011（异 payload 409，经外部
invoke 端点真打）；AC-006（暂停→REJECTED/AUTOMATION_DISABLED+释放幂等键）；取消流
（中断调用发生+cancel_requested_at+watcher 结算 cancelled）；QUEUED→RUNNING 翻转
（started_at）；agentflow cancelled 映射；retry 血缘（retry_of_id/attempt+1）+非终态 409。

## 已知边界（登记）

1. workflow 运行中取消 409——runner 无运行中取消能力（§12.3 "复用既有 cancel" 实际不存在）；
2. TIMED_OUT 终态未实现（deadline 目前只在准入拦截，运行中超时属 F3 批次超时范畴）；
3. budget_snapshot/usage_summary 列已就位但预算策略本身属 §6.5 后续切片；
4. watcher 对账仍为 30s 周期轮询（事件驱动回写属后续切片）。
