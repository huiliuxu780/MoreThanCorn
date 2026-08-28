# Domain Agent Runtime Provider — Phase R1 验收记录

日期：2026-08-29
分支：`codex/domain-agent-runtime-provider`
阶段状态：完成（待用户验收）

## 1. 本阶段范围

Phase R1 落地 Runtime Provider Registry 与 Gateway（SDD 10 §5.3–5.8 / §8.2 / §15.1 / R1-1～R1-4），
使用 fake provider 完成生命周期闭环；不接业务流量，不恢复已封存的旧 Agent 执行入口。

- 数据模型（migration `g040r1prov0001`）：
  - 新表 `agent_runtime_provider`（与 `model_provider` 禁止合表；Secret 仅经 `connection_id`
    引用现有 Connection/Secret 管理；`config` 禁止保存 API Key/Secret/Token——API 层负校验）；
  - `release`：`runtime_provider_id`（FK）+ `runtime_profile` + `runtime_binding_snapshot`；
  - `run`：`runtime_provider_id`（FK）+ `runtime_provider_run_id` + `runtime_request_hash`
    + `runtime_snapshot`（实际执行事实，非期望配置）；
  - `call_record.run_id`：先可空 + 经 `node_run` 回填 + 孤儿显式报告（见 §4 偏差 1）。
- Provider 管理 API（`/api/runtime-providers`）：POST/GET list/GET/PUT/probe/disable 六端点；
  统一错误结构；RBAC（写=operator，disable=admin）；AuditLog（create/update/probe/disable）。
- Gateway Client（`server/app/runtime_providers/client.py`）：连接/读取超时分离；有界重试
  （连接类错误与 502/503/504；submit 以同一幂等键重试）；request hash（sha256 规范化 JSON）；
  响应一律 Contract 严格校验；§12.2 错误映射（contract 错误体优先，HTTP 状态兜底）；
  日志只记元数据（方法/路径/状态/耗时，无 body/Secret/PII）；出站过 Egress（生产强制）。
- Worker（`agent-runtime-submit` / `agent-runtime-poll` / `agent-runtime-cancel`）：
  - submit 幂等；Run 已带 `runtime_provider_run_id` 时只恢复轮询，**不重新 submit**（§16.1）；
  - poll 为单次 tick：未终态把下次检查写入 `JobQueue.run_at`（2s 起 ×2 退避、上限 30s）并立即
    释放 worker，绝不在 worker 内 sleep；deadline 已过先请求 cancel，60s 宽限后仍无终态判
    `RUNTIME_TIMEOUT` 失败；Provider 实际终态优先（副作用真实即认账，§16.2）；
  - cancel 未提交 Run 直接取消排队；已提交按 Provider 状态收尾；
  - TraceEvent → RunEvent 最小映射（`runtime_trace`，按 providerSequence 去重，不落正文）。
- 平台 run.id 即发送给 Provider 的 run_id；Gateway 校验 Provider 不得另立 Run（§5.7）。

## 2. 测试证据（全部可复现）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 后端全量（含 R1 新增 13 项） | `server/.venv/bin/python -m pytest tests -q` | **258 passed, 0 failed**（连续两轮） |
| R0 边界回归 | `python3 scripts/verify-runtime-r0.py` | PASS（R1 未破坏边界） |
| 迁移升级/降级/再升级 | `WF_DATABASE_URL=…wf_test alembic upgrade head / downgrade -1 / upgrade head` | 全部成功，head=`g040r1prov0001` |
| 迁移应用到开发库 | wf_dev `alembic upgrade head` | head=`g040r1prov0001` |
| 前端三件套 | `npm run typecheck / lint / build` | 全绿（R1 未触碰 src/） |
| `git diff --check` | — | 干净 |
| verify-fullstack | `node scripts/verify-fullstack.mjs` | 38/49，失败集与 main 对照基线完全一致（11 项存量，见 R-Archive 记录）；S13 封存契约全过 |

R1 新增测试（`server/tests/test_r1_runtime_providers.py`，13 项，fake provider 为进程内
uvicorn 真实 HTTP 服务，故障注入可控）：

1. Provider API CRUD/校验（kind/baseUrl/重复 id/config 混密钥/connectionId）/审计/404 面；
2. probe 真实健康（ok→写回 health_status/capabilities；不可达→error 报告不抛异常）；
3. Gateway 生命周期 + 指纹稳定 + 同键同体去重 + 同键异体 409→`RUNTIME_IDEMPOTENCY_CONFLICT`；
4. Gateway 错误映射：503 有界重试后成功；400+`agent_spec_invalid`→`AGENT_SPEC_INVALID`；
   坏响应→`RUNTIME_PROVIDER_UNAVAILABLE`（可重试）；run_id 不符→`RUNTIME_INTERNAL_ERROR`；
5. worker queued→running→succeeded 全程（状态/usage/trace 去重/终态收尾/重复 poll 幂等）；
6. worker 恢复：已受理 Run 重投 submit → 不重发、只恢复轮询；
7. cancel：采纳 Provider 终态（cancelled）；未提交 Run 直接取消；
8. 超时：deadline 过→自动入队 cancel→Provider 确认→收尾 cancelled；
9. 超时且 Provider 拒绝取消：宽限（60s）后判 `RUNTIME_TIMEOUT` 失败；
10. poll 立即释放 worker（<1.5s 断言）+ run_at 有界退避 + 在途任务不重复堆积；
11. JobQueue 分派表接线：`claim_and_run` 认领 `agent-runtime-submit` 真实执行；
12. disabled Provider 提交 → Run 失败 `RUNTIME_PROVIDER_UNAVAILABLE`，不外发请求；
13. probe 404 面与 CRUD 合并覆盖。

## 3. 关键文件

- `server/alembic/versions/g040r1prov0001_runtime_providers.py`
- `server/app/runtime_providers/{client,registry,dispatcher,worker,trace_mapper,errors}.py`
- `server/app/routers/runtime_providers.py`（+ main.py 挂载、runner.py 分派表三分支）
- `server/app/models.py`（AgentRuntimeProvider / Release / Run / CallRecord 新列）
- `server/requirements.txt`（+`../packages/runtime_contract`，editable 路径依赖）
- `server/tests/test_r1_runtime_providers.py`

## 4. 已登记偏差与决策

1. **`call_record.run_id` 的 NOT NULL 暂缓**（安全迁移第 3/4 步）：历史 Agent 运行的
   CallRecord 生成时未挂 node_run（旧执行器 `_Ctx.call` 行为），存在无法回填的孤儿——
   wf_test 537/1333 条、wf_dev 272/736 条。迁移已显式报告（不静默丢弃）；处置孤儿等于处置
   历史数据，禁止静默删除（SDD 不可违反项），**须用户决定**（保留为 null / 归档标记 / 批准清理）。
   NOT NULL 收紧将在孤儿处置后的后续迁移执行；downgrade 已做兼容（先放开再删）。
2. **轮询默认值首期冻结**：初始 2s、×2 退避、上限 30s；cancel 宽限 60s（SDD §21-4 待评审项，
   后续可按用户决定调整，改动点集中在 `runtime_providers/worker.py` 常量）。
3. **新增 RunEvent 类型登记**（00-index §5.2 规则）：`runtime_submitted` / `runtime_trace` /
   `runtime_finished`（均 CONTROL 通道），前端事件流按未知类型透传，不影响现有消费。
4. **R1 请求组装为最小形态**：RuntimeExecuteRequest 从 Run 输入 + AgentVersion 冻结事实组装；
   无版本的 Run（R1 测试构造）使用占位 instructions。Module AgentSpec 冻结与 Provider 实现兼容
   校验属 R2；Release Runtime Binding 消费属 R2/R3。
5. **无生产分派路径**：三个 worker job 目前仅由显式入队触发（测试/后续阶段），业务流量接入
   （AnalysisTask→Agent target）按计划在 R3。

## 5. 环境与限制

- 本阶段未运行真实 Provider（AgentScope 8301 / DSH 8302 联调属 R2 conformance）；
  未读取任何 `.env.local`；fake provider 为进程内回环服务。
- 开发后端（8100）已重启为分支代码，`/api/runtime-providers` 可用（当前空列表）；
  用户验收栈（5173→8120/wf_accept）未触碰。
- 未 push、无远程 tag/PR；未执行数据封存 `--apply`。
