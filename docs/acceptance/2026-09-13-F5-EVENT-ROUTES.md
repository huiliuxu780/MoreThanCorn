# F5 验收：第一个真实数据源闭环（EventRoute / EventDelivery）

- 日期：2026-09-13（四层审计 96dcd1c 之后接续）
- Spec 依据：`docs/product-domain/execution-automation-batch-spec.md` §10（唯一事件契约）/ §12.6（API）/ §19 F5
- 场景拍板依据：09-12 五路调研（15 号稿）——对接面=阿里云产品+已有系统接口，**webhook 加固 P0 主线**；本切片交付 webhook 场景的平台侧全闭环（外部真实系统接入的 EventBridge/CloudEvents 转换层属 P0.5，D1–D7 仍待用户拍板）。
- 判定：**READY_FOR_ACCEPTANCE**（本地提交，未推送）

## 1. 交付范围

### 1.1 EventRoute 一等实体（§10.0）
- 新表 `event_route`（迁移 `g057eventrt0001`，已应用 wf_dev）：source/eventType/destination(XOR)/filter/mapping/dedupe/completionPolicy/retryPolicy/enabled/archived/revision。
- 版本规则落地：PUT 递增 revision；EventDelivery 创建时冻结 `route_id + route_revision + mapped_input`；retry 用冻结值不随编辑漂移；禁用只挡新派发；**DELETE=归档语义**（enabled=false+archived，不物理删）。
- 兼容条款（§10.0 持久化兼容）：`automation_trigger(kind=event|polling)` 保留为 destination=automation 的 AS-IS 存储，统一 DTO 视图只读投影（`origin=automation_trigger`），改动仍走 automations trigger API——`PUT/DELETE` 对其返回 409 `LEGACY_TRIGGER_READONLY`，杜绝双写漂移。

### 1.2 §12.6 八端点（消除四层审计层2 P1×8）
```
GET/POST   /api/v2/event-routes
GET/PUT/DELETE /api/v2/event-routes/{id}
GET        /api/v2/event-deliveries?sourceEventId=&status=&destinationKind=&dateFrom=&dateTo=
GET        /api/v2/event-deliveries/{id}
POST       /api/v2/event-deliveries/{id}/retry
```
- destination 强一致校验（automation→AutomationDefinition / analysis_task→AnalysisTask，422 `DESTINATION_NOT_FOUND`）；
- delivery DTO 暴露 §10.2 状态机 + `routeId/routeRevision/destinationKind/invocationId/taskRunId` + `completionPolicy` 及人话 `completionMeaning`（不让用户猜 completed 语义）；
- `sourceEventId` 过滤时附 `sourceEvent.routeOutcomes` 流水证据块（AC-023/024：filtered/deduped/dead 可区分——filtered/deduped 不产生 delivery 行，证据只在事件上）；
- retry 只接受 FAILED/DEAD（409 `RETRY_STATUS_INVALID`），目标缺失/停用 409（`DESTINATION_MISSING`/`AUTOMATION_DISABLED`，§13.1 不可重试语义）。
- 安全门禁继承：读 `require_role()`，写 `require_operator`（canonical API 继承安全门禁规约）。

### 1.3 ingest 管线扩展（§10.1 一事件一目的地）
- `ingest()` 在 legacy trigger 匹配后并行匹配 EventRoute（同一事件可命中多条显式 route = N delivery；单 route 不双发）；
- **XOR 派发**：automation→`dispatch()` 恰 1 Invocation（`invocation_id` 反链）；analysis_task→`start_task_run(trigger="event")` 恰 1 TaskRun，**不创建无业务价值的 Invocation 包裹**；TaskRun 落 `source_event_id/event_delivery_id` 全链路反链，冻结 TaskVersion/DataSnapshot 走既有路径（含 SDD13 §18 生产触发 target_table 门槛——platform_only 任务被诚实拒发：delivery FAILED+退避+事件 status=failed，不冒充 filtered）；
- route 级去重：`dedupe.keyPath` 提取 + `windowSeconds` 窗口（`dedupe_scope` 索引列），命中出 deduped 证据并指向首张 delivery；
- 目标缺失/停用 = 不可重试 → 直接 dead 带原因码（`TARGET_NOT_FOUND`/`AUTOMATION_DISABLED`/`TASK_PAUSED`），不进退避循环；
- eventType 匹配约定：payload `type`/`eventType` 字段；route eventType 为空 = 匹配该源全部事件（代码内文档化）。

### 1.4 审计实抓的两个可靠性缺陷（本轮修复）
1. **`_retry_dead_deliveries` 自 P0-6 引入后从未被调用**——failed 投递的退避重试永不触发（死代码路径）。已接线进 watcher tick（步骤 6）。
2. **陈旧 pending 无恢复轨道**——ingest 派发半途进程死亡留下的 pending 行永不结算（活体 wf_dev 实抓 09-09 遗留行 `db6faa52…`，积压 74 小时，目标 automation 已删除）。修复：>10 分钟的 pending 纳入到期重发；重试额度耗尽 → dead（`stale pending, attempts exhausted`）。**活体实证**：8120 重启后一个 watcher tick（30s）内该行自动结算为 `dead | automation deleted or disabled`。

### 1.5 completion_policy=terminal 结算
- accepted（默认）：Invocation 受理/TaskRun queued 即 COMPLETED；
- terminal：delivery 停 RUNNING，watcher `reconcile_terminal_deliveries` 按目标终态结算（Invocation completed|failed|cancelled / TaskRun succeeded|failed|cancelled|partial）；目标反链缺失 → dead（需人工）。目标业务失败仍算派发契约结算完成（COMPLETED），业务结果以目标侧为准——不在 delivery 上伪造错误。

### 1.6 层3 审计脚本扩展
`scripts/audit_layer3_runtime.py` 新增第五执行体 **delivery**：状态枚举/双快照禁止转移（终态仅 COMPLETED|DEAD，FAILED→PENDING 为合法重试）/COMPLETED⇒XOR 反链/FAILED 可重试⇒nextRetryAt 非空/PENDING·RUNNING 积压>1h 报警。

## 2. 验收证据（可复现）

```
cd server && .venv/bin/python -m pytest tests/test_f5_event_routes.py -q   → 11 passed
.venv/bin/python -m pytest tests/ -q                                        → 567 passed
WF_DATABASE_URL=…wf_dev .venv/bin/python ../scripts/audit_layer2_contract.py → P0=0 P1=0（allowlist 清零）
python3 scripts/audit_layer3_runtime.py --interval 5                         → P0=0 P1=3（仅 09-10 pre-F0 历史行）
迁移：alembic upgrade head → g057eventrt0001（wf_dev 已应用；trigger_id/automation_id 改可空兼容列）
活体：POST /api/v2/event-routes→201；GET /api/v2/event-deliveries→200；
     8120 重启后 watcher 30s 内结算 74h 陈旧 pending → dead（psql 复核）
```

test_f5_event_routes.py 11 用例：route CRUD/revision/归档/destination 强一致；legacy 只读投影 409；webhook→automation XOR（Invocation input=映射产物 + route_outcomes delivered 证据）；analysis 分支（TaskRun trigger=event+双反链，无 Invocation 包裹）；§18 拒发诚实 FAILED；filter/dedupe 证据链；retry 守卫+冻结 revision/mapping 实证（route 改 rev2 后 retry 仍用 rev1+OLD 输入）；dead 复活；watcher route 分支到期重发；terminal 策略 RUNNING→结算→反链缺失 dead；陈旧 pending 恢复+新鲜 pending 不误伤。

前端零改动（本切片纯后端；数据源管理页属 §14.1 建议一级对象，新屏基线须先过用户拍板闸门，未擅自开工）。tsc/vitest/build 沿用导航修复后绿值（无 src/ 变更）。

## 3. 决策记录

| # | 决策 | 依据 |
|---|---|---|
| D-F5-1 | 新建 `event_route` 物理表而非改造 automation_trigger | §10.0 允许单表或双 owner 表；analysis_task 目的地需要 route 级 revision/dedupe/completionPolicy，塞进 trigger.config 会破坏「配置不可版本化」现状；legacy 行零迁移（§10.0 明令禁止仅因命名统一迁移历史） |
| D-F5-2 | retry 冻结 `mapped_input`（JSONB 快照）而非 route 配置历史表 | §10.0 要求 retry 不随编辑漂移；输入快照是最小实现且对 legacy 行可回退重算（诚实标注） |
| D-F5-3 | attempts 语义 = 失败尝试计数 | 与既有 `_schedule_retry` 退避表（30/120/600s）和 `attempts < max_attempts` 门一致 |
| D-F5-4 | eventType 匹配读 payload `type`/`eventType` | 一期 webhook 场景无信封标准；CloudEvents 转换层（P0.5，D1–D7 待拍板）落地后由转换层归一 |
| D-F5-5 | 陈旧 pending 10 分钟阈值 + 额度耗尽转 dead | 派发在 ingest 内同步执行，正常 pending 生存期≈0；10min 远大于进程重启窗口 |

## 4. 遗留与移交

- **P1×3（不变）**：09-10 pre-F0 历史 Run 缺时间戳——登记不回填（seed 安全门）。
- **F6（入口攒批）**：§10.3 门槛未满足，明确不立项；F5 实测数据（单事件同步派发）可作为未来门槛评估基线。
- **外部真实系统接入**：EventBridge 订阅 + CloudEvents 转换层 = 调研拍板的 P0.5 主线，属 F5 之后的独立切片，且 D1–D7 拍板项仍待用户（15 号稿）。
- **数据源管理 UI**（§14.1）：新屏，须先过组件基线 AskUserQuestion 闸门。
- 活体 Invocation 冒烟覆盖仍为 0 样本（wf_dev 无自动任务行）——现在可用 F5 webhook 链路造真数据补覆盖（耗 LLM 额度，须用户点头）。
