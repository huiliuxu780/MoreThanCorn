# 09-SDD P0 验收报告（正确性与安全止血）

- 验收版本：`fdc0458`（B1 `f50d4d4` / B2 `116e868` / B3 `b942829` / B4 `fdc0458`）
- 环境：后端 164 pytest（`wf_test` 隔离库）；核心 E2E 在全新 `wf_e2e` 库 Production Profile 下 3 连跑
- 数据集版本：`scripts/e2e-production-core.mjs` 内置固定数据集（10 合法 + 故障注入）
- 验收日期：2026-08-27
- 验收人：待用户最终确认（当前为 Agent 自验）

> 依据 09 §21 报告模板与用户验收规则（逐项：Requirement / 修改文件 / 迁移 / 测试 / 命令 / 结果 / 不变量 / 未关闭问题 / PASS-FAIL）。

---

## 1. P0-01 ～ P0-14 逐项

| Req | 修改文件（关键） | 迁移 | 测试 | 执行命令 | 实际结果 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| P0-01 Production Profile/no-mock | `app/config.py`, `app/main.py`(bootstrap_models/check_production_ready), `app/runner.py`(_call_model 等), `app/agent_runtime.py`, `app/resource_tests.py`, `scripts/check-no-prod-mock.mjs` | — | `tests/test_p0_production.py`(7) | `pytest tests/test_p0_production.py -q`；`node scripts/check-no-prod-mock.mjs` | 7 passed；静态门禁：植入违规→exit1，清洁→exit0 | PASS |
| P0-02 冻结 Task↔Workflow 语义 | `app/models.py`, `app/routers/business.py`, `src/services/api-types.ts`, `src/domain/task-mapper.ts`, 任务页面 | g032 | `test_p0_semantics.py`、`src/domain/task-mapper.test.ts`(10) | `pytest tests/test_p0_semantics.py -q`；`npm test` | 12 passed；10 vitest 通过；契约无 `agentId` 承载 workflowId | PASS |
| P0-03 真实 DataReader | `app/data_readers/{base,inline,postgres,__init__}.py` | — | `tests/test_p0_data_reader.py`(4) | `pytest tests/test_p0_data_reader.py -q` | 4 passed：Postgres 真连接/键集分页/时间窗/断开失败关闭；内联分页 | PASS |
| P0-04 TaskVersion/DataSnapshot/TaskRun | `app/models.py`, `app/task_runner.py`, `app/routers/business.py` | g032 | `test_p0_semantics.py`、`test_p0_taskrun.py` | `pytest tests/test_p0_taskrun.py -q` | 7 passed；任一 Run 可反查 TaskVersion+DataSnapshot | PASS |
| P0-05 N 输入=N Run=N Result | `app/task_runner.py`, `app/runner.py`(exec_create_record) | g032 | `test_p0_taskrun.py::test_taskrun_n_equals_n...`、E2E 场景 A | `pytest tests/test_p0_taskrun.py`；`node scripts/e2e-production-core.mjs` | 10=10=10，distinct=10，无重复无遗漏 | PASS |
| P0-06 结构化输出 Schema 强制 | `app/output_schema.py`, `app/runner.py`(exec_create_record), g032 种子 | g032 | `test_p0_taskrun.py::test_taskrun_invalid_schema...`、E2E 场景 B | `pytest tests/test_p0_taskrun.py` | 非法 risk/缺字段 → Run failed，不落正式结果 | PASS |
| P0-07 Rules 不可变版本与作用域 | `app/models.py`(ResultRuleVersion), `app/routers/business.py` | g032 | `test_p0_semantics.py::test_rule_publish...` | `pytest tests/test_p0_semantics.py -q` | 发布=冻结版本；发布 A 不影响 B；存量结果保留各自版本 | PASS |
| P0-08 结果追踪完整 | `app/runner.py`, `app/task_runner.py`, `src/pages/quality-result-detail.tsx` | g032 | E2E 场景 A（追踪断言）、`test_p0_taskrun.py` | `node scripts/e2e-production-core.mjs` | missing_traceability_count=0；版本链全非空 | PASS |
| P0-09 Task pause/Schedule | `app/task_runner.py`, `app/runner.py`(schedule_tick), `app/routers/business.py` | g032 | `test_p0_schedule.py`(4)、E2E 场景 E | `pytest tests/test_p0_schedule.py -q` | 4 passed；paused 拒绝新批次(409)；fire-key 去重；调度用已发布版本 | PASS |
| P0-10 后端身份与 RBAC | `app/auth.py`, `app/routers/auth_routes.py`, `app/main.py`(中间件), `app/routers/*`(角色门禁), `src/services/rbac.ts` | g033 | `test_p0_auth.py`(6)、E2E 场景 F | `pytest tests/test_p0_auth.py -q` | 6 passed；未登录 401/越权 403；actor 来自身份 | PASS |
| P0-11 高危执行封堵 | `app/egress.py`, `app/runner.py`(exec_code_write/_decrypt/exec_tool), `app/config.py` | — | `test_p0_security.py`(7) | `pytest tests/test_p0_security.py -q` | 7 passed：CodeNode 默认禁；SSRF 私网/元数据/环回拦；无密钥不解密 | PASS |
| P0-12 关键前端契约 | `src/services/{api-types.ts,wf-api.ts}`, 任务/规则/结果页面, `src/domain/task-mapper.ts` | — | `npm run lint`；`npm test`；`src/domain/task-mapper.test.ts` | `npm run lint && npm test` | lint 0错0警（117错8警→0）；17 vitest 通过 | PASS |
| P0-13 认证事件流 | `src/services/wf-api.ts`(streamRunEvents), `app/main.py`(中间件覆盖 /api) | — | E2E（鉴权下 API 全通）；手工：事件流带 Authorization | `node scripts/e2e-production-core.mjs` | SSE 带 token；断线按 Last-Event-ID 重连；401 明确终态 | PASS |
| P0-14 真实核心 E2E | `scripts/e2e-production-core.mjs` | — | 该脚本自身（38 断言） | `node scripts/e2e-production-core.mjs` ×3 | 38/38 ×3 连跑一致；发布→任务→执行→结果→复核全覆盖 | PASS |

---

## 2. 核心不变量（INV-01 ～ INV-12）数据库查询

对全新 `wf_e2e` 库（22 条结果，来自 E2E Production 全链路）执行：

| 不变量 | 查询语义 | 期望 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| INV-01 TaskRun 绑定唯一 TaskVersion | `task_run.task_version_id NOT NULL` 约束 | 0 违例 | 0 | PASS |
| INV-02 每 Run 一个 Interaction | `(task_run_id, interaction_ref, attempt)` 唯一约束 + E2E runs=10 | 0 违例 | 0 | PASS |
| INV-03 每成功 Run 一个生效结果 | `GROUP BY run_id HAVING count(*)>1`（is_latest） | 0 | 0 | PASS |
| INV-04 interaction_ref 非空 | `task_run_id NOT NULL AND interaction_ref=''` | 0 | 0 | PASS |
| INV-05 Run 冻结版本/快照 | 任务链 Run 均有 workflow_version_id+data_snapshot_id；绑规则则有 rule_version_id | 0 | 0（见注） | PASS |
| INV-06 非法输出不落结果 | E2E 场景 B：非法 risk → 无结果 | 0 假结果 | 0 | PASS |
| INV-07 重试新谱系 | `run.origin_run_id` 谱系（test_p2 retry） | 不覆盖 | 通过 | PASS |
| INV-08 复核只追加 | `ai_result` 不可变 + `review_revision` 追加（22/22 有 aiResult） | 不可变 | 22/22 | PASS |
| INV-09 生产无 mock 结果 | `structured_output LIKE '%[mock%'` | 0 | 0 | PASS |
| INV-10 paused 不新批次 | E2E 场景 E：409 | 拒 | 拒 | PASS |
| INV-11 fire-key 唯一 | `GROUP BY schedule_fire_key HAVING count(*)>1` | 0 | 0 | PASS |
| INV-12 可重放不依赖草稿 | `run.definition_source='version'` + `__rawRow` 输入快照 | 版本化 | 通过 | PASS |

> INV-05 注：E2E 场景 B 任务**有意未绑规则**（规则可选），其 3 条 Run `rule_version_id` 为 NULL 属合法；
> 所有任务链 Run 的 `workflow_version_id` 与 `data_snapshot_id` 均非空，绑规则任务的 `rule_version_id` 均非空（细化查询全 0）。

---

## 3. 机器门禁结果（全绿）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 前端 lint | `npm run lint` | 0 错 0 警（此前 117 错 8 警） |
| 前端 typecheck | `npm run typecheck` | 0 错 |
| 前端单测 | `npm test -- --run` | 17 passed（3 文件） |
| 前端构建 | `npm run build` | 通过 |
| 后端测试 | `server/.venv/bin/pytest server/tests -q` | 164 passed |
| 生产无 mock 静态扫描 | `node scripts/check-no-prod-mock.mjs` | 通过（植入违规→exit1 验证有效） |
| 核心 E2E | `node scripts/e2e-production-core.mjs` | 38/38，3 连跑一致 |

后端 164 套件 3 连跑稳定（修复了此前多 worker/多 scheduler 串扰与 POST+手动 execute_run 双跑竞态）。

---

## 4. 数据库迁移

| 迁移 | 内容 | 升级/回滚 |
| --- | --- | --- |
| `g032p0taskdom01` | TaskVersion/DataSnapshot/TaskRun/ResultRuleVersion/ReviewRevision/QualityOutputSchema；Run/QualityResult 追踪列；INV 唯一约束；非破坏回填 | `alembic upgrade head` 通过；含 `downgrade()` |
| `g033p0auth0001` | app_user 身份表 + admin 种子 | 同上 |

迁移链唯一 head；`wf_test`/`wf_e2e` 均在 head。

---

## 5. 已登记豁免与诚实空态

- **节点配置 JSONB 松散类型**（09 §5.7 允许登记豁免）：`wf-designer.tsx`/`wf/sections.tsx`/`wf/controls.tsx` 使用统一 `NodeCfgLoose` 别名（各 1 处 `eslint-disable` 注释，可审计），替代散落 `any`；API 边界契约类型在 `services/api-types.ts` 强制。
- **质量总览/坐席分析细分板块**：真实聚合未覆盖的板块返回空态（不造假数），属 P1-03 范围。
- **E2E 未走真实模型**：核心断言用确定性质检流（create-record 合法输出）保证可复现；真实模型的"非法 JSON"路径由后端 `test_p0_taskrun` Schema 强制用例覆盖。真实 Provider 全链路联调属 P1 Smoke。

## 6. 未关闭问题

| 严重度 | 问题 | 归属 | 发布决定 |
| --- | --- | --- | --- |
| Low | 质量总览趋势/坐席细分聚合为真实空态 | P1-03 | 不阻塞 L1 |
| Low | E2E 未含真实模型调用 | P1 Smoke | 不阻塞 L1 |
| Info | `test_agent_runtime` 曾偶发（已修复为单例 worker + 去双跑，3 连绿） | 已解决 | — |

---

## 7. 结论

**P0 自验通过，达到 L1 内部 Alpha 条件**（P0-01 ～ P0-14 全部有证据打勾；INV-01 ～ INV-12 自动化通过；机器门禁全绿；Production Profile 无可达 mock）。

> 依 09 与用户规则：此为 **Agent 自验通过**，尚未经用户最终确认，不记为"用户已接受"。
