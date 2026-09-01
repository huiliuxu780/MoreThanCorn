# SDD 13 自验报告（Task 输出解耦、目标表投递与运行中心）

- 分支：`feat/sdd13-task-output-delivery`（基线 main @ 90d2b27）
- 提交：aa9e588（PR1）→ d31d341（PR2）→ bedb879（PR3）→ 8c63552（PR4）→ 56772e1（PR5）→ e463642（PR6）→ 修复提交
- 日期：2026-09-02
- 口径：本报告为开发者自验；最终验收由独立验收者按 SDD 13 §15 复现。

---

## 0. §18 开工前问题回答（无额外产品决定，采用本文默认值）

1. 首期目标数据库只支持 PostgreSQL table sink（`data_writers/registry.py` 对非 postgresql 抛 `UNSUPPORTED_SINK`）。
2. 验收表 DDL 由开发者提交（`scripts/sdd13-acceptance-tables.sql`），业务方确认后方可用于生产；测试/回归在 wf_test/wf_dev 显式执行。
3. 新建 active/schedule/backfill/API Task 强制 `target_table`；sandbox/manual 可 `platform_only`。
   落地细则：创建/编辑允许显式 `platform_only`（存量兼容，Phase A 口径）；**启动闸门**对
   schedule/backfill/api 触发强制 target_table（422），manual 放行；**激活闸门**对 draft→active 强制 target_table。
4. Delivery 默认最多 5 次指数退避（5s×2^n，上限 300s），耗尽进 `dead_letter`；每次尝试写 `audit_log`。
5. QualityResult 领域迁移：Task 新页面不依赖 businessResult（main 基线本无该投影）；质检页面继续读 `/api/quality-results` 领域 API。
6. occurrence 提前物化未来 48h；计划时间后 5 分钟未关联 TaskRun 标记 `missed`。
7. SSE 为运行中心目标门槛；开发联调允许 5s 轮询降级（前端 EventSource 断线自动降级并在页头明示"降级轮询 5s"，恢复焦点立即刷新）。

## 1. 基线差异说明（SDD 以 codex 分支为现状，实施以 main 为准）

- main 不存在 `server/app/business_results.py`、`BusinessResultDTO`、`business-result-view.tsx`；
  §2 耦合表在 main 的对应面为：`task_runner` 的 enforce_qr 假设、`runs.get_run` 的 quality 内嵌块、
  `/api/task-runs/{id}/results` 查 QualityResult、task-detail 的 Interaction Runs Sheet。PR6 已全部处置。
- 不存在性证明（§14.2 A 组）：
  `grep -rn "businessResult|BusinessResult|project_business_result" server/app src` → 空。

## 2. §14 分组证据

### A 组 解耦
- 上述 grep 为空；`src/pages/task-detail.tsx` 不再 import Sheet 明细/结果投影，只保留最近 5 批摘要 + 跳运行中心。
- 两个不同 Output Schema（consumer/quality）的投递见 §C；Task/Run 页面不写 moduleKey 专用分支
  （run-detail 原始输出为通用 JSON viewer）。
- 非质检 Agent 不再显示 quality_evaluation：`taskVersionSummary` 读 `outputSchema.ref`（task-mapper.ts）。
- 旧质量页面正常：`/api/quality-results` 未改动，test_business/test_p0_semantics 全绿。

### B 组 目标表配置
- 自动化：`tests/test_sdd13_delivery.py::test_validator_edit_full_issues`（ASSET_MISSING/TARGET_COLUMN_MISSING/
  KEY_FIELDS_MISSING/KEY_NO_UNIQUE_CONSTRAINT/MAPPING_SOURCE_MISSING/INPUT_EQUALS_OUTPUT 全路径）。
- 目标表不存在启动失败：`test_permanent_error_failed_and_retry_guard`（validate_for_start fail-closed）。
- 生产触发闸门：`tests/test_sdd13_operations.py::test_start_gate_requires_target_table_for_production_triggers`。
- 版本不可变：编辑生成新 TaskVersion（既有 09 语义保留）；历史批次读冻结快照（`TaskRun.output_binding_snapshot`，
  详情页"配置快照"Tab 只读冻结值）。
- 浏览器：`assets/sdd13-output-binding-form.png`（可写资产下拉/定义版本/唯一约束提示/mapping grid/预检按钮）。

### C 组 真实投递（真实 PostgreSQL，wf_dev）
- 脚本：`scripts/verify-sdd13-delivery.py`；报告：`13-delivery-report.md`。
- 结果：Consumer 20/20、Quality 20/20 写入；谱系列正确；JSONB 不双重编码；payload hash 一致；
  重复投递 3 次单行；重跑新增谱系不覆盖；TARGET_TABLE_MISSING 永久错误码；重试不改 payload。

### D 组 并发与一致性
- `test_concurrent_workers_single_write`：两线程并发 worker，条件 UPDATE 认领，目标表单行。
- `test_mapping_error_fails_run_not_half_delivery`：mapping 错 → Run failed 且无半条 Delivery（同事务回滚语义）。
- Outbox 与 Run.output 同事务：`delivery.settle_run_success` 挂接于 `runner.execute_run` 成功提交前与
  `runtime_providers/worker._settle_module_result` 终态提交前。
- retry 不改 record_payload/payload_sha256：`test_permanent_error_failed_and_retry_guard` + 回归脚本。
- dead-letter 人工重试：`retry_delivery` 接受 dead_letter 并审计（audit_log action=delivery.retry）。

### E 组 安全
- 写入 SQL 全参数化；表/列名经 `data_readers.base.safe_ident` 白名单引号化（writer 复用）。
- 表达式注入负向：`test_mapping_rejects_forbidden_syntax`（$eval/分号/比较式/非法根全拒）。
- Secret 不进入快照：`freeze_binding_snapshot` 只存 connection_id，writer 运行时经 `secret_ref` 解密。
- 权限探测用 `has_table_privilege`，不写测试行（§6.3）。
- RBAC：retry/配置类端点 `require_operator`；查看类默认角色可读。

### F 组 运行中心/看板/批次子页面
- Sidebar：运行中心（今日运行/批次历史）+ 配置管理含分析任务（app-sidebar.tsx）。
- canonical 路由直达与旧路由 replace redirect：app.tsx（`/config/tasks/:taskId/runs/:runId`、
  `/config/tasks/:taskId/batches/:taskRunId` → redirect）。
- 六列与优先级：`test_today_board_columns_and_priority`（running/delivering/attention/completed 分列正确，
  attention>delivering 等）；浏览器 `assets/sdd13-today-board.png`（occurrence 计划卡/missed 原因/汇总徽章）。
- occurrence：`test_occurrence_materialize_missed_and_associate`（48h 物化/missed/触发关联/停用 cancelled）。
- 历史页服务端分页+URL Query：`test_history_pagination_and_filters` + `assets/sdd13-history.png`
  （status=succeeded 写在 URL，前进后退可恢复）。
- Interaction Runs 服务端分页：`test_runs_pagination_filters` + `assets/sdd13-run-detail.png`（20 条·1/1 页，
  行点击 `/operations/runs/:runId`）。
- "重试执行"与"重试投递"两个独立动作：详情页双按钮 + 两个 API。
- 1000 条不生成看板卡：看板以 TaskRun 为卡（§10.3），Interaction 只在详情分页。
- SSE/降级：stream 端点存在（`/api/operations/task-runs/stream`，Last-Event-ID 续接/回拉 snapshot）；
  前端断线降级 5s 轮询并在页头明示。

### G 组 自动化门槛
- `cd server && .venv/bin/python -m pytest tests -q` → 见本次运行输出（含 SDD13 新增 16 用例）。
- `npm run typecheck` / `npm run lint` / `npm run build` → 0 错误（构建产物 dist/）。
- 真实 PG 集成：`tests/test_sdd13_delivery.py` 9/9（wf_test）+ `scripts/verify-sdd13-delivery.py`（wf_dev）。

## 3. 存量测试对新品类闸门的适配（有意行为变更）

- `test_p0_schedule.py`：schedule 触发按 §18 强制 target_table——用例预置真实验收表绑定
  （`_mk_output_binding`），映射源遵守冻结 Output Schema（$run/$system/$constant 根）；
  occurrence 物化与 scheduler 线程并发安全（ON CONFLICT DO NOTHING）。
- `test_p0_taskrun.py::test_backfill_processes_window_subset`：backfill 属生产触发，platform_only
  现返回 422（新闸门负向断言）；窗口子集语义改经 manual + window_override 验证。
- `test_business.py::test_rules_engine_derives_and_recalc`：共享测试库下不再依赖
  active_rule_version 全局回退（并发发布竞态），改经 Task 钉住 resultRuleVersionId
  （09-SDD 冻结语义正道），断言不变（risk=High/ruleVersionId 明确）。
- `test_p0_taskrun.py` 其余 /results 断言迁移为领域层直查 QualityResult（/results 已 deprecated）。

## 4. 已知限制与迁移说明

- SSE 在 IAB/部分代理环境会断流，前端自动降级 5s 轮询（页头明示）；生产部署需保证 SSE 直通（§18-7 门槛）。
- 投递回归使用确定性 fixture 输出；真实 LLM 联调消耗额度，需另行批准后执行。
- `/api/task-runs/{id}/results` 保留为 deprecated 通用 deliveries 面（返回 `deprecated:true`），
  领域结果请查 `/api/quality-results`；下一 Phase 可下线。
- 激活闸门仅覆盖 draft→active；存量 active 任务 pause→active 沿用启动时 fail-closed 探测。
- migration 只增不删（g046sdd13pr10001 含 downgrade）；旧列保留至确认无旧客户端后单独清理。
