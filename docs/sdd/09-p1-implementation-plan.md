# 09-SDD P1 实施计划（业务可用与可运维）

> 状态：执行中
> 前置：P0 自验通过（`4756bac`；见 `acceptance/09-p0-acceptance.md`）
> 规格依据：09 §14（P1-01～P1-12）与 §14.1（通过声明）

## 0. 现状勘察结论（2026-08-27）

- 队列：`runner.claim_and_run` 用 `FOR UPDATE SKIP LOCKED` 认领，但失败仅置 `failed`——**无重试/退避、无租约回收、无死信、无取消传播**；`job_queue.attempts/max_attempts/locked_at` 字段未被消费。
- 查询性能：`admin.list_quality_results` 的业务维度筛选 `dim_filters` 走 `db.query(QualityResult).all()` **全表载入 Python**；质量总览前端取 200 条自算。
- 复核：P0 已有 `ReviewRevision` 只追加；**缺待复核队列/领取/分配/状态机（09 §11.4）**。
- 聚合：**无服务端按日趋势/团队/坐席聚合端点**；总览/坐席分析为前端半聚合+空态。
- 任务管理：结构化创建/编辑/批次/幂等/暂停已在 P0 落地；**回填（历史窗口）、任务级调度管理、行级重试入口**待补。
- 数据治理：Definition 版本化/Eligibility/去重（interaction_ref）/DataSnapshot 水位已有；**Schema 演进校验、保留删除策略**待补。
- 告警：**无**告警规则/通知模型。
- 前端质量：核心页已有；**组件级测试少、无浏览器 E2E、无 a11y 覆盖**。
- 发布：`requirements.txt` 已有（P0 生成）；**缺 Dockerfile、env schema、feature flag**。

## 1. P1 Requirement → 代码映射

| Req | 后端 | 迁移 | API | 前端 | 测试 |
| --- | --- | --- | --- | --- | --- |
| P1-01 完整任务管理 | `task_runner.py`(backfill), `routers/business.py` | — | `/api/tasks/{id}/backfill`, 任务调度管理 | task-detail 回填/调度 | `test_p1_task.py` |
| P1-02 复核工作流 | `routers/business.py`(review queue/claim), `models.ReviewRevision` | g034（review 状态机字段） | `/api/quality-results/review-queue`, claim/assign | quality-results 复核台 | `test_p1_review.py` |
| P1-03 真实质量分析 | 新 `routers/analytics.py`（服务端聚合） | g034（聚合索引） | `/api/quality/analytics/*` | quality-overview/agent-analysis 接真聚合 | `test_p1_analytics.py` |
| P1-04 数据治理基础 | `task_runner.py`(eligibility/watermark), Definition 演进校验 | — | definition 校验 | data-definitions | `test_p1_governance.py` |
| P1-05 队列可靠性 | `runner.claim_and_run`(retry/backoff/lease/dead-letter/cancel) | g034（job 可靠性字段消费） | `/api/jobs`（死信/重放） | — | `test_p1_queue.py` |
| P1-06 错误与部分成功 | `task_runner.py`(行级错误/重试入口) | — | `/api/tasks/{id}/runs/{rid}/retry-failed` | task-detail 行级错误 | `test_p1_partial.py` |
| P1-07 全链路可观测 | 新指标端点（延迟/成功率/成本/积压） | — | `/api/metrics/*`, `/metrics`(Prometheus) | 观测面板 | `test_p1_observability.py` |
| P1-08 告警 | 新 `models.AlertRule/AlertEvent` + 评估 | g034 | `/api/alerts/*` | 告警配置页 | `test_p1_alerts.py` |
| P1-09 前端工程质量 | — | — | — | 组件测试+浏览器 E2E+a11y | vitest + `scripts/e2e-browser.mjs` |
| P1-10 查询性能 | `admin.list_quality_results`(聚合下推/索引) | g034（索引） | 列表全服务端分页 | — | `test_p1_perf.py`+explain |
| P1-11 可复现发布包 | `Dockerfile`, env schema, feature flag | — | — | — | `scripts/check-release.mjs` |
| P1-12 运维 Runbook | `docs/ops/runbook.md` + 演练脚本 | — | — | — | 演练记录（需真 Staging） |

## 2. P1 批次顺序（每批=完整垂直切片）

- **P1-B1 地基：P1-10 查询性能 + P1-05 队列可靠性**（其余批次依赖索引与可靠队列）。
- **P1-B2：P1-02 复核工作流 + P1-06 部分成功与行级重试**。
- **P1-B3：P1-03 服务端质量聚合 + P1-07 全链路可观测**。
- **P1-B4：P1-01 任务管理补全（回填/调度） + P1-04 数据治理 + P1-08 告警**。
- **P1-B5：P1-09 前端质量 + P1-11 发布包 + P1-12 Runbook**。

## 3. §14.1 通过声明中"非纯代码"项（诚实标注）

以下需真实时间/基础设施，非本会话代码可闭环，将实现代码与脚本侧、并把"运行证据"标注为待真实环境：
- **生产同拓扑 Staging 连续运行 7 天**（需真实部署与时长）。
- **真实 Provider 每日 Smoke**（Provider 已配，见 [[real-llm-configured]]；需运行环境）。
- **数据源故障/模型超时/Worker 重启/Scheduler 重启/回滚演练**（提供故障注入脚本+演练手册，真实执行需环境）。
- **业务代表按固定脚本端到端验收签字**（需人）。

这些不阻塞代码实现推进；但在 `09-p1-acceptance.md` 中相应项记为"代码就绪，运行证据待真实 Staging"，**不得**写"已闭环"。

## 4. 机器门禁（P1 在 P0 门禁上新增）

```
npm run lint && npm run typecheck && npm test -- --run && npm run build
server/.venv/bin/pytest server/tests -q
node scripts/check-no-prod-mock.mjs
node scripts/e2e-production-core.mjs
node scripts/e2e-browser.mjs          # P1-09 浏览器 E2E
node scripts/check-release.mjs        # P1-11 发布包完整性
```
