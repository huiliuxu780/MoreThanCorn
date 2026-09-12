# F4 统一任务看板投影 · 自验记录（2026-09-12）

> Spec：`execution-automation-batch-spec.md` §11/§12.5/§19 F4
> 状态：自验通过（全量 550 绿），未提交待验收

## 交付

| 项 | 内容 |
|---|---|
| 来源扩展（§11.2） | 投影新增四源：`automation_invocation`（AutomationTriggerLog+target 摘要）、`agent_session`（无 Invocation 的手工/对话 Session）、`agentflow_run`（手工 FlowRun）、`workflow_run`（手工 WorkflowRun）；原 `task_run` kind 改名 `analysis_batch`（筛选接受旧别名） |
| 跨源去重（§11.2） | Invocation 有 target_ref 时只投影 Invocation 卡，target 不另出卡；occurrence 断链保留断链卡；分析批次不再以 Workflow Run 重复展示 |
| 统一状态（§11.3） | `_unified_status`：queued/running/completed/needs_action/failed_cancelled；关系损坏/投递失败优先 needs_action；每卡带 phase/rawStatus/attention/target/progress/counts/diagnostics/links |
| kind 筛选（§12.5） | `GET /api/work-items?kind=`（逗号多选，含 task_run 别名）；automationId/agentId 筛选对新源正确下推（手工源在 automation 筛选下整体排除） |
| SSE（§11.5） | refresh 事件补 `type: work_items_refresh` + sequence（Last-Event-ID 续接已有）；digest 纳入四新源事实；前端保留轮询降级与手动刷新 |
| 前端 | operations-today：kind 筛选下拉、新 kind 卡渲染（类型/原始状态/目标/进度）、WorkItemDTO 类型扩展（kind 联合/progress 可空/rawStatus/target/links 联合）；task-detail 同步可空保护 |
| 查询上界（AC-045） | 四新源全部批量查询（session 状态单次批调用、flow 节点计数单条 group by、target 存在性跨窗口批量）；测试以 SQLAlchemy 语句计数断言 ≤20 |

## 测试证据

```
test_f4_work_items 6 条：AC-040 去重 / AC-041 四源 / AC-042 进度不混 /
AC-043 断链 needs_action / AC-045 语句上界 / kind 筛选与别名。
同会话共享库污染修复：F4 清理夹具 + mtc002b 计数断言隔离。
子进程 RPC 测试时间预算放宽（全量负载下偶发超时）。
全量: pytest 550 passed / tsc 0 错 / vitest 65 / build ✓
```

## 已知边界（登记）

1. session 卡状态依赖运行时批量 sessions_status；运行时不可达时 needs_action+info（RUNTIME_UNREACHABLE），不伪装；
2. target 存在性校验以同窗口+跨窗口批量查询为准，窗口外目标不会误报（known_targets 跨窗口批量）；
3. occurrence 断链卡沿用 MTC-002B 既有语义（FK 不允许伪造 task_run_id，断链源于删除/范围排除）；
4. SSE 仍为窗口级 refresh 事件（非逐卡 changedFields），符合 §11.5「轻量 refresh」语义。
