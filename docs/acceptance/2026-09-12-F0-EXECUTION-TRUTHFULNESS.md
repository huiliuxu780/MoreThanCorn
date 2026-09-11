# F0 执行真实性修复 · 自验报告（2026-09-12）

> Spec：`docs/product-domain/execution-automation-batch-spec.md` §19 F0（完成标准 §18 AC-001～007）
> 状态：自验通过，**未提交待验收**；真实运行时（8301）E2E 冒烟待用户批准（涉及真实 LLM 额度）
> 证据可复现：下述命令均在 `server/`（pytest）与仓库根（vitest/tsc/build）执行

## 1. 修复范围与落点

| F0 项 | AS-IS 问题 | 修复 | 落点 |
|---|---|---|---|
| ① NodeRun 反链字段 | `_authorized_session` 兜底分支引用不存在的 `agentflow_run_id` 列（实为 `run_id`），触发即 500；且无索引行节点 Session 在 L553 提前 401，运行中回调全挂 | 兜底改 `run_id=fr.id` 且可达；无索引行按运行中 flow-run 令牌放行（`_UnindexedFlowSession` 占位，白名单空集→403，不放大权限） | `server/app/routers/as_flows_board.py` |
| ② FlowRun queued→async | `start_run` 在 HTTP 请求内同步调 `rt.flow_run`（阻塞至 600s） | `start_run` 只落 `queued` 行 + 入 `agentflow-execution` job 即返；worker 消费 | `agentflow_executor.py` / `runner.py` `_dispatch_job` |
| ③ NodeRun 增量落库 | `_record_nodes` 跑完后一次性补写，`started_at=ended_at=now` 假时间戳 | 平台消费运行时 SSE（`/mtc/flows/run/stream`），`stage:{nid}` start→NodeRun(running)+SessionIndex、end→终态、`flow:complete`→run 终态；每事件独立 commit | `agentflow_executor.py`（`execute_agentflow_run`/`_handle_flow_event`） |
| ④ SessionIndex 及时登记 | 节点 Session 索引在 flow 完成后才写 | 运行时改为 session 先建、`stage:start` 事件携带 `session_id`（执行前可鉴权，AC-002）；平台在 start 事件即登记索引行 | `runtimes/agentscope/app/flow_runner.py` + `agentflow_executor.py` |
| ⑤ 回调 token 生命周期 | 会话令牌/flow-run 令牌不限终态，终态后仍可回调 | `_ensure_execution_active`：agentflow 链查 run≠running、workflow 链查 Run 终态、automation 链查无 active 触发日志→401；手工/对话 Session 不设终态；flow-run 令牌维持仅 running 有效 | `as_flows_board.py` |
| ⑥ Invocation 终态结算 | watcher 30s 对账已按真实终态（AS-IS 达标）；agentflow 同步执行使 running 形同虚设 | 异步化后语义归正：queued/running 期间 log=running，真实终态后由 watcher 结算（不回归） | `automation_watcher.py`（无改动） |
| ⑦ Flow SSE/轮询代理 | 无 | 新增 `GET /api/v2/agentflows/runs/{rid}/events`（SSE，只读平台 NodeRun/Run 增量事实）；前端运行视图对活跃 run 2.5s 轮询 | `as_flows_board.py` + `src/pages/agentflow-detail.tsx` |

配套：`AgentFlowRun.status` 增 `queued`（注释与默认值）；`board_projection.map_agentflow_lane` 映射 queued→pending。

## 2. AC 覆盖（§18.1）

| AC | 结论 | 证据 |
|---|---|---|
| AC-001 | ✅ | `test_run_now_agent_returns_invocation_and_settles_terminal`：run-now 返回 trigger_log_id+session_id，watcher 对账后 completed（响应 202 化属 F2，本切片保持既有 DTO） |
| AC-002 | ✅ | agent 链：SessionIndex 先登记后触发（AS-IS 达标，run-now 响应立含 session_id）；flow 链：`test_execute_records_nodes_incrementally` 探针在 start/end 事件之间查得索引行 |
| AC-003 | ✅ | `test_flow_node_session_token_running_vs_terminal` + `test_automation_session_token_terminal_invalidation`（schedule 复用由新 active 日志恢复，手工对话不受限） |
| AC-004 | ✅ | `test_flow_run_now_returns_queued_without_executing`（运行时零调用+job 入队）+ `test_execute_records_nodes_incrementally`（执行中节点事实可查）+ 前端活跃 run 轮询 |
| AC-005 | ✅（存量） | dispatch workflow 分支未动；`Run(task_run_id=NULL)` 语义由既有套件覆盖，全量回归无破坏 |
| AC-006 | ✅ | `test_dispatch_rejects_paused_definition`；无任何代码路径因暂停取消已运行执行 |
| AC-007 | ✅（存量） | P0-5 原子门未动（`test_p0_e2e_live_stack::test_p0_6_max_runs_atomic_gate` 等） |

§21.2 事实核验（本切片相关）：watcher 多进程锁=P0-9 专用连接 advisory lock ✓；JobQueue 具备租约回收+心跳（`recover_stale_jobs`/`_heartbeat`）✓。

## 3. 门禁证据

```
server: .venv/bin/python -m pytest tests/ -q
  → 504 passed（495 存量 + 9 新增 test_f0_execution_truthfulness.py）in 50.9s
前端: npx tsc -p tsconfig.app.json --noEmit → 0 错
      npx vitest run → 65/65
      npm run build → ✓ built in 3.59s
运行时: flow_runner.py 语法校验 OK（runtimes/agentscope 无 pytest 套件）
```

## 4. 已知边界（诚实交底）

1. **真实运行时 E2E 未跑**：SSE 增量链路仅 hermetic 验证；live 栈套件（`test_p0_e2e_live_stack`，live_runtime 标记）不含真实 flow 执行。真实冒烟需 8301 运行时+真实 LLM 额度，待用户点头。
2. **前端用轮询而非 SSE**：`GET /runs/{rid}/events` 已就绪，页面暂以 2.5s 轮询驱动（spec 允许「SSE/轮询」二选一）；SSE 接线可在后续切片替换。
3. **rerun_node 保持同步**：单节点操作员动作，不在 AC-004 范围；仍走 `rt.flow_run` + `_record_nodes`（conftest 对其的 hermetic 假件保留）。
4. **worker 崩溃恢复语义**：flow 整体重跑（节点 attempt 递增），非断点续跑；F3 批次恢复不适用此语义。
