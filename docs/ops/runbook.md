# 运维 Runbook（09-SDD P1-12）

覆盖：部署、回滚、补偿/重放、死信处理、数据源故障、模型故障、Worker/Scheduler 重启。
> 演练记录：真实 Staging 演练需真实环境与时长（09 §14.1），本文提供步骤脚本化基线；
> 故障注入脚本见 `scripts/fault-drill.mjs`（可重复执行）。

## 1. 部署

```bash
alembic upgrade head                       # 迁移
docker run --env-file .env.prod morethancorn-api:<tag>   # 启动
curl -f http://host:8000/readyz            # 就绪探针（DB+迁移+队列）
```

## 2. 回滚

```bash
alembic downgrade -1                       # 回滚一级迁移
docker run morethancorn-api:<prev-tag>     # 回滚镜像
```
> 注意：含数据的迁移回滚前先备份（`pg_dump`）。不可逆变更走前向修复而非 downgrade。

## 3. 补偿 / 重放（09 §10.2 / P1-06）

- 单条失败交互重试：`POST /api/tasks/{tid}/runs/{trid}/retry-failed`（新 attempt + origin 谱系，不覆盖）。
- 整批重跑：`POST /api/tasks/{tid}/runs`（带 `Idempotency-Key` 防重复批次）。
- 历史窗口补数：`POST /api/tasks/{tid}/backfill` `{window:{start,end}}`。

## 4. 死信处理（09 P1-05）

```sql
-- 查死信
SELECT id, type, attempts, error FROM job_queue WHERE status='dead';
```
- 排查 `error` 后，将 `status` 置回 `pending` 并清零 `attempts` 重新入队；
- 或修复根因后 `POST /api/tasks/{tid}/runs/{trid}/retry-failed` 业务层重放。
- 观测：`GET /api/observability/queue-stats`（`dead` 计数）+ 告警指标 `dead_letter`。

## 5. 数据源故障（09 P0-03 / P1）

- 现象：`TaskRun` failed，`READER_ERROR`；`GET /api/observability/queue-stats` 正常但任务失败。
- 处置：恢复数据源连通 → `POST /api/tasks/{tid}/runs/{trid}/retry-failed` 重放；
  数据源不可用时系统失败关闭（不产替代数据，09 P0-03）。
- 告警：配置 `datasource` 类告警规则（`/api/alerts/rules`）。

## 6. 模型故障 / 超时（09 P0-01 / P1）

- 现象：Run failed `MODEL_UNAVAILABLE` 或超时；生产无 mock 回落。
- 处置：检查 `WF_LLM_BASE_URL`/Provider 连接 → 行级重试；持续故障切换 Provider。
- 告警：`run_error_rate` 指标阈值告警。

## 7. Worker / Scheduler 重启

- Worker 崩溃后任务不丢：`job_queue` 认领有租约，`recover_stale_jobs` 周期回收
  过期 `processing` 任务重新入队（09 P1-05）；重启 Worker 即自动续跑。
- Scheduler 重启：单实例运行；重启后按 `schedule.next_run_at` 继续，`schedule_fire_key`
  唯一约束防止重复触发（09 INV-11）。

## 8. 故障演练（fault drill）

`node scripts/fault-drill.mjs` 依次注入：数据源不可达、模型超时、死信、暂停任务触发，
并断言系统失败关闭、可重试、无重复批次。真实执行需运行环境；见脚本内说明。
