# MTC-002B-R2 独立验收报告

- 验收提交：`be171f4`
- 结论：**不通过；退回 MTC-002B-R3，禁止进入 MTC-003。**
- 本轮边界：未修改产品代码；未运行会对开发库创建批次的浏览器门禁；未运行 seed 到 `wf_dev`。

## 1. 已通过的核心修复

1. **[健康] 五泳道状态模型。** 页面仍是“需要操作 / 执行中 / 已完成 / 排队中 / 失败/取消”，没有“已投递”一级状态。
2. **[健康] 读模型主修复。** 源码已将 scope 作为子查询下推到 occurrence/run 查询；`project_batch()` 取代逐条 `project_single()`；agent 跨版本、跨午夜的关键单测独立通过。
3. **[健康] SSE 基础机制。** 连接状态变为 connecting / sse / polling，前端会传 `dateFrom` 与时区；digest 事实集包含子 Run 聚合、生命周期、progress、任务、版本与 assignee 名称。
4. **[健康] 前端契约。** `truncated` 已进入 TypeScript；加载更多按 WorkItem ID 去重。
5. **[健康] 基础门禁。** `npm run typecheck` 通过，Vitest 34/34；后端相关套件收集数为 86；独立定点回归（agent 跨版本、跨午夜、日期校验）3/3 通过。

## 2. P1 阻断：已触发调度卡在“执行中”泳道仍显示“等待调度”

### 事实

后端为“已触发 occurrence + TaskRun”的稳定卡保留：

- `kind = schedule_occurrence`
- `taskRunId != null`
- `status = running/completed/failed_cancelled/...`

这是正确的稳定 ID 模型。但前端以 `w.kind === "task_run"` 判断是否展示执行信息，见 `src/pages/operations-today.tsx:224-230`。因此一张**实际上已有 TaskRun、处于执行中**的卡，会被渲染为“等待调度”，隐藏进度、启动时间和执行状态。

### 真实页面与 API 复现

当前页面中两张“执行中”卡 `R2-dbg2-3e35ce` / `R2-dbg-a63c36` 显示：

> 手动 · 计划于 09-06 12:00 · 等待调度

同一 API 数据显示它们实际是：

```text
kind=schedule_occurrence
status=running
taskRunId=<非空>
progress.total=4
```

这会直接误导用户：一件正在执行的工作被写成尚未开始。它违背本项目把 Task 设计成“工作对象”而不是后台配置记录的目标。

### R3 修复口径

- 卡片是否显示执行进度，必须由 `taskRunId !== null`（或新建明确字段 `hasExecution`）判断，而不是 `kind`。
- 有 TaskRun 的 occurrence 卡必须展示：触发方式、启动/结束时间、progress、当前状态；可以附带原计划时间，但不得出现“等待调度”。
- 只有 `taskRunId === null` 的未触发 occurrence 才显示“计划于 … / 等待调度”。
- 新增 API + React 测试，覆盖 occurrence 稳定 ID 在 queued、running、completed、failed/取消四种状态下的卡片文案。

## 3. P1 阻断：seed 的“目标数据库保护”仍可由环境变量任意绕过

### 事实

`scripts/seed_workitems_demo.py:43-49` 的 gate 逻辑是：

```python
expect = os.environ.get("MTC_SEED_EXPECT_DB", "wf_dev")
if db_name != expect: refuse
```

这不是“严格等于 wf_dev 或专用 fixture DB”的白名单。只要同时设置：

```text
WF_ENV=development
ALLOW_DEMO_SEED=1
MTC_SEED_EXPECT_DB=<任何当前数据库名>
```

脚本便允许在该任意数据库执行删除和重建。测试本身正是以 `wf_test` + 自定义 `MTC_SEED_EXPECT_DB=wf_test` 放行，证明该机制没有数据库 allowlist。

即使调用方错误地把生产连接标为 development，该变量也会把保护完全取消。由于脚本会删除所有 `DEMO002B-%` 根对象及其关联记录，不能接受这种安全模型。

### R3 修复口径

- 删除任意 `MTC_SEED_EXPECT_DB` 覆盖能力，或将允许库名硬编码为极小白名单，例如 `{wf_dev, wf_fixture}`。
- 专用 fixture DB 应由固定环境/配置识别，不能由一次运行的任意环境变量命名。
- 运行时必须打印实际 SQLAlchemy URL 的安全脱敏目标、白名单命中项和 namespace。
- 增加反例测试：`WF_DATABASE_URL=.../production_like` + `MTC_SEED_EXPECT_DB=production_like` 必须拒绝且零写入。
- 如需清理旧 `DEMO-002B-*`（带连字符）遗留夹具，先列出精确 root IDs，让负责人确认；不能把它重新加回通配清理。

## 4. P2：SSE 路由没有执行 dateFrom/dateTo 的范围校验

列表端点对 `dateFrom > dateTo` 返回 422；但 SSE 端点只分别校验日期格式，未比较二者，见 `server/app/routers/work_items.py:141-152`。

独立请求：

```text
GET /api/work-items/stream?dateFrom=2026-09-10&dateTo=2026-09-06
→ HTTP 200 + event: refresh
```

同参数的列表端点正确返回 422。这会造成同一 WorkItem 查询契约在 list 与 stream 之间不一致。

**R3 修复口径**：抽取统一的日期范围解析函数，让 list 与 stream 共享；补 stream 的格式、倒序和时区测试。

## 5. P2：开发页面仍被旧夹具污染

本轮现场页面混有旧 `DEMO-002B-*`（连字符）与新 `DEMO002B-*` 记录，导致任务看板出现大量非产品数据。新 seed 的 marker 改名后不会清理旧 marker，这本身比宽泛删除安全，但执行方“夹具已恢复”的表述不准确。

这不是让脚本自动删旧数据的授权。正确做法是产出一次**只读**清单，由负责人确认确切 ID 后再做单独、可回滚的清理。

## 6. 视觉与交互证据

![当前任务看板：两张“执行中”卡仍写“等待调度”](/Users/rivers/MoreThanCorn/research/morethancorn/mtc002br2-audit/01-live-board-state.png)

截图可见五泳道、实时状态和 toast 均存在，但第二泳道的前两张卡同时呈现“执行中”徽标与“等待调度”文案，这是 P1-01 的直接视觉证据。

## 7. 最终判定

R2 已实质修复上一轮的 digest、跨版本筛选、跨午夜和 N+1 主问题；这部分可以保留。可是当前看板仍会把正在执行的调度工作说成“等待调度”，而 seed 保护也仍可被任意数据库名环境变量绕过。

因此本轮不能验收通过。仅完成上述两项 P1 和 stream 日期一致性 P2 后，再进行 R3 独立验收。
