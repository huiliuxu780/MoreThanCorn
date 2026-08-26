# 09-SDD P0 实施计划（批次与映射）

> 状态：执行中
> 基线：`main@7e00f17`（09 审计基线 fd8fecb 之后 3 个 connections 修复提交，与 09 审计项无冲突）
> 规格依据：`09-production-readiness-and-end-to-end-sdd.md`（v0.1，用户指令 2026-08-27 起按冻结执行）

## 0. 冻结决策（09 §5.3 / §6.4 / §18.1）

| 决策 | 取值 | 依据 |
| --- | --- | --- |
| D09-1 Task 聚合关系 | **AnalysisTask 直接绑定 Workflow**；Agent 不参与质检 Task 主链 | 09 §5.3 推荐项；P0-02 |
| D09-2 执行模式 | **per-interaction**：TaskRun=批次，Run=单条 Interaction；批处理型 Workflow 为未来显式 mode | 09 §6.4；P0-05 |
| D09-3 QualityEvaluation Schema | 固定 JSON Schema `quality_evaluation` v1（score/risk/issues/summary），输出必须本地校验通过才允许落正式结果 | 09 §6.5/§18.1.3；P0-06 |
| D09-4 规则版本 | ResultRuleSet=身份，ResultRuleVersion=不可变版本；发布即冻结快照，**不再全库重算** | 09 §6.6；P0-07 |
| D09-5 复核模型 | AI 原始结果不可变（ai_result），人工调整走 ReviewRevision 只追加 | 09 §9.7/§11.4；INV-08 |
| D09-6 历史数据 | 不删除任何存量行；重复 run_id 的旧结果标记 `is_latest=false`，唯一约束只对 is_latest 生效 | 用户规则：不执行破坏性数据清理 |

## 1. P0–P3 总体依赖图（只展开 P0）

```
P0 正确性与安全止血（L1 内部 Alpha）
 ├─ 语义冻结：Task↔Workflow 绑定 / per-interaction / 版本与快照实体
 ├─ 真实数据读取与 N=N=N 执行基数
 ├─ 追踪链闭合（INV-01..12）
 └─ 安全止血（Production Profile / Auth / CodeNode / SSRF / Secret）
        │
        ▼
P1 业务可用与可运维（L2 灰度）
 ├─ 依赖 P0：TaskVersion/TaskRun/RuleVersion 追踪实体 → 复核工作流、质量聚合、部分成功
 ├─ 队列可靠性（retry/lease/dead letter）建立在 P0 的 TaskRun 入队路径上
 ├─ 可观测/告警依赖 P0 闭合的追踪字段
 └─ 门禁：同拓扑 Staging 7 天 + 故障演练 + 真实 Provider Smoke
        │
        ▼
P2 正式生产（L3）
 ├─ 依赖 P1 稳定运行数据；**SLO 数值、租户形态、SSO 方案必须用户冻结（不得由 Agent 发明）**
 └─ SSO/数据权限/HA/DR/合规/成本治理
        │
        ▼
P3 规模化能力（L4，逐项独立字段级 SDD + 独立验收）
   P3-01 评测集 → P3-02 A/B → P3-03 Evolution → P3-04 洞察 → P3-05 多模型路由
   P3-06 MCP/Knowledge → P3-07 报表订阅 → P3-08 血缘 → P3-09 协作审批 → P3-10 分析存储
```

跨阶段硬依赖：P1-05 队列可靠性复用 P0 的 task-run job 类型；P1-02 复核复用 P0 的 ReviewRevision；
P1-03 聚合复用 P0 的结构化追踪列；P2-09 性能验收前置用户冻结 10 项 SLO（09 §15.1）。

## 2. P0 Requirement → 代码映射

| Req | 后端 | 迁移 | API | 前端 | 测试 |
| --- | --- | --- | --- | --- | --- |
| P0-01 Production Profile | `config.py`（WF_ENV 扩展）、`main.py` lifespan、`runner._call_model`、`resource_tests.py` | — | `/readyz` | — | `test_p0_production.py` + `scripts/check-no-prod-mock.mjs` |
| P0-02 Task 绑定语义 | `models.AnalysisTask/Version`、`routers/business.py` | g032 | `/api/tasks*` DTO 去 agentId | task-wizard/tasks/task-detail/task-edit | `test_p0_semantics.py` |
| P0-03 真实 DataReader | 新增 `app/data_readers/`（base/postgres/inline） | — | task run 内部 | — | `test_p0_data_reader.py` |
| P0-04 TaskVersion/DataSnapshot/TaskRun | `models.py` 新实体 | g032 | `/api/tasks/{id}/runs`(202) | task-detail 展示版本 | `test_p0_semantics.py`、`test_p0_taskrun.py` |
| P0-05 N=N=N | 新增 `app/task_runner.py`；`runner.create_run/execute_run` 扩展 | g032（run 新列+唯一索引） | 同上 | — | `test_p0_taskrun.py` |
| P0-06 结构化输出 Schema | `app/output_schema.py` + `quality_output_schema` 表 | g032 | — | — | `test_p0_output_schema.py` |
| P0-07 RuleVersion | `models.ResultRuleVersion`、`business.py` 发布/求值 | g032 | `/api/result-rules/{id}/publish` | result-rule-editor（B4） | `test_p0_semantics.py` |
| P0-08 追踪完整 | `run`/`quality_result` 新列；`exec_create_record` 重写 | g032 | run/result 详情 traceability | run-detail/result-detail（B4） | `test_p0_taskrun.py` |
| P0-09 pause/Schedule | `runner.schedule_tick`、task 状态机 | g032（fire_key 唯一） | `/api/tasks/{id}/status` | — | `test_p0_schedule.py` |
| P0-10 Auth/RBAC | 新增 `app/auth.py` + `app_user` 表 | g033 | 登录 + 中间件 + 角色门禁 | `rbac.ts` 接服务端（B4） | `test_p0_auth.py` |
| P0-11 安全 | `runner.exec_code_write` 禁用开关、`app/egress.py`、`admin._decrypt` 强化 | — | — | — | `test_p0_security.py` |
| P0-12 前端契约 | DTO 对齐 | — | rules/task DTO | task-wizard/task-edit/result-rule-editor/详情页 | `npm test` 组件测试 + typecheck |
| P0-13 认证事件流 | `runs.py` SSE 鉴权 | — | `/api/runs/{id}/events` | `wf-api.ts` fetch-stream 带 token | `test_p0_auth.py` + 手工/脚本证据 |
| P0-14 真实核心 E2E | — | — | — | — | `scripts/e2e-production-core.mjs`（强断言，§13.1 数据集） |

## 3. P0 批次顺序（每批=完整垂直切片）

### B1 冻结语义与目标数据模型（P0-02 部分 / P0-04 / P0-06 schema / P0-07 模型）
1. 先写失败测试 `tests/test_p0_semantics.py`（契约+不变量，红）。
2. 迁移 `g032p0_task_domain.py`：
   - 新表：`analysis_task_version`、`data_definition_version`、`result_rule_version`、
     `quality_output_schema`（种 `quality_evaluation` v1）、`data_snapshot`、`task_run`、`review_revision`。
   - `analysis_task`：+current_version_id/created_by/updated_by/updated_at；status 归一 draft/active/paused/archived。
   - `run`：+task_run_id/task_id/task_version_id/interaction_ref/attempt/definition_version_id/rule_version_id/data_snapshot_id；
     partial unique `(task_run_id, interaction_ref, attempt) WHERE task_run_id IS NOT NULL`。
   - `quality_result`：+task_run_id/task_id/task_version_id/rule_version_id/output_schema_version_id/ai_result/derived_result/effective_review_revision_id/is_latest；
     partial unique `(run_id) WHERE is_latest`。
   - 非破坏回填：存量 task→v1 版本；存量 ruleset→版本快照；存量 definition→版本快照；重复 run_id 旧行 is_latest=false。
3. models.py 同步；`POST/PUT /api/tasks` 走 TaskVersion；rules publish 生成不可变版本且**停止全库重算**；
   review 写 ReviewRevision 并保全 AI 原始值。
4. 跑 `test_p0_semantics.py` 转绿 + 全量回归。

### B2 窄闭环：真实读取 + N=N=N + 规则冻结 + 输出校验（P0-03/05/06/07/08）
1. 失败测试 `test_p0_data_reader.py`、`test_p0_output_schema.py`、`test_p0_taskrun.py`（红）。
2. `app/data_readers/`：Protocol + Postgres 适配器（真连接、分页游标、窗口、断开即失败）+ inline 资产适配器。
3. `app/task_runner.py`：start_task_run → DataSnapshot → TaskRun 入队 → worker 分页读取 →
   每 Interaction 一个 Run（冻结 workflow_version/definition_version/rule_version/data_snapshot）→
   执行已发布 WorkflowVersion → 输出 Schema 校验（repair≤2）→ 每成功 Run 恰好一条 QualityResult（unique run_id）→
   按冻结 RuleVersion 派生 → TaskRun 统计（succeeded/partial/failed）。
4. `POST /api/tasks/{id}/runs`（202 + Idempotency-Key）；`batch-run` 过渡保留、内部改走新链路。
5. §13.1 数据集（10 条含故障注入）进测试；转绿 + 回归。

### B3 生产安全与调度可靠（P0-01/09/10/11）
1. 失败测试 `test_p0_production.py`、`test_p0_schedule.py`、`test_p0_auth.py`、`test_p0_security.py`（红）。
2. WF_ENV=production：禁注册 mock://；`_call_model`/路由/资源测试无真实配置即失败关闭；缺 WF_SECRET_KEY 拒启动；
   Code Node 默认禁用；`/readyz`。
3. Schedule：paused Task 不触发；触发用已解析 Published Version；`schedule_fire_key` 唯一（schedule:slot）；
   IdempotencyKey 重复返回原 TaskRun。
4. `app/auth.py`：app_user 表（角色）、登录签发、中间件强制、发布/复核/资源写操作服务端鉴权、actor 入审计。
5. `app/egress.py`：DNS 解析后拦截私网/链路本地/元数据/IPv6；禁自动重定向；`_decrypt` 生产强制密文。
6. `scripts/check-no-prod-mock.mjs`（静态扫描 mock://、`[mock:`、mock-* 行、固定 Schema 推断等生产路径可达性）。

### B4 前端契约 + 认证事件流 + 真实 E2E（P0-12/13/14）+ lint 清零 + 验收报告
1. task-wizard/task-edit：全字段受控提交（inputMapping/scope/sampling/dataWindow 结构化），确认页渲染服务端返回快照。
2. tasks/task-detail：去 agentId，展示 TaskVersion/运行历史。
3. result-rule-editor：与后端 DTO 对齐（显式转换函数），版本历史可见。
4. run-detail/quality-result-detail：占位 `-` 清零，展示完整 traceability（TaskRun/WorkflowVersion/RuleVersion/DataSnapshot）。
5. wf-api.ts：SSE fetch-stream 带 Authorization + Last-Event-ID 重连 + 终态；模块缓存失效。
6. `npm run lint` 0 error 0 warning；vitest 覆盖核心转换函数；浏览器验证关键页。
7. `scripts/e2e-production-core.mjs`：§13.1 数据集 + §13.1 断言（read/run/result=10、distinct ref=10、mock=0、
   追踪缺失=0、重复调度=0），全新数据库 3 连跑；失败非零退出。
8. `docs/sdd/acceptance/09-p0-acceptance.md` 逐项登记证据。

## 4. 机器门禁（P0 完成时全绿）

```
npm run lint && npm run typecheck && npm test -- --run && npm run build
server/.venv/bin/pytest server/tests -q
node scripts/check-no-prod-mock.mjs
node scripts/e2e-production-core.mjs
```

## 5. 风险与处置

- 存量 wf_dev 数据与新约束冲突 → is_latest 部分唯一索引 + 只标记不删除（D09-6）。
- 前端 117 lint errors → B4 专项清零，不以豁免换取通过。
- 旧 `batch_run_task` 被 schedule 与测试引用 → B2 内切新链路，保留入口兼容签名。
- 真实 LLM 未配置的测试 → deterministic fake 仅在测试库启用且带 `[fake:` 标记（09 §12 测试环境要求），生产路径不引用。
