# WorkItemProjection —— 统一任务读模型

> MTC-002B（2026-09-05）。实现：`server/app/work_item_projection.py` +
> `server/app/routers/work_items.py`；前端 `workItemsApi` + `/tasks` 五泳道。
> 状态机权威来源：MTC-002A-R 验收报告 §5。

## 1. 对象关系

```text
AutomationDefinition（analysis_task，自主任务定义）
        │  手动 / Schedule / API / Backfill
        ▼
WorkItem（读模型，无表）←── TaskRun（一次批次） 或 未触发 ScheduleOccurrence（一次计划）
        │
        ▼
Run（单条交互执行） → QualityResult / ResultDelivery
```

- WorkItem **只是读取模型**：无 `work_item` 表、无双写、无回填、无 migration。
- 一个 WorkItem = 用户眼中的一件工作；来源二选一：
  - `kind=task_run`：手动/API/Backfill 触发的 TaskRun；
  - `kind=schedule_occurrence`：调度计划（未触发）或调度触发后的批次（沿用 occurrence ID）。

## 2. 数据来源（全部既有表，批量加载）

| 数据 | 表 | 用途 |
|---|---|---|
| 批次 | `task_run` | 主投影源（当日窗口：created/started/ended 命中或跨天活跃） |
| 计划 | `schedule_occurrence` | 未触发计划卡；触发后与 TaskRun 合并为同一卡 |
| 定义 | `analysis_task` | 标题/描述/数据范围归属（created_by） |
| 配置版本 | `analysis_task_version` | 执行目标（agent/workflow）与 has_target 判定 |
| Agent / Workflow | `agent` / `workflow` | assignee 名称 |
| 子 Run 统计 | `run` | 活跃数/总数（group by 批量），用于卡死冲突判定 |

禁止逐卡查询：task/version/agent/workflow/Run 统计均按 ID 集合批量 `IN` 加载。

## 3. 状态机（用户可见五组，固定顺序）

1. `needs_action` 需要操作　2. `running` 执行中　3. `completed` 已完成
4. `queued` 排队中　5. `failed_cancelled` 失败/取消

映射唯一入口：`work_item_projection.project_work_item_status(tr, occ, has_target,
child_active, child_total)`。路由、前端、看板组件不得各自映射；API 只返回稳定
enum，中文由前端 `UI_TERMS.workItemStatus` 映射。

### 优先级与规则

| 优先级 | 条件（raw） | 输出 status / phase |
|---|---|---|
| 1 | 缺 task / 缺配置版本（has_target=False） | needs_action / attention，code=`MISSING_EXECUTION_TARGET` |
| 2 | occurrence.status=missed 且无 TaskRun | needs_action / attention，code=`SCHEDULE_MISSED` |
| 3 | TaskRun.status 不在已知集合 | needs_action / attention，code=`UNKNOWN_EXECUTION_STATUS` |
| 4 | running 且 delivery=succeeded | needs_action / `EXECUTION_DELIVERY_CONFLICT`（critical） |
| 4 | 有 endedAt 但 status∈{queued,running} | needs_action / `LIFECYCLE_CONFLICT`（critical） |
| 4 | running 且子 Run 总数>0 且活跃=0 | needs_action / `RUNS_TERMINAL_TASKRUN_RUNNING`（critical） |
| 5 | 无 TaskRun 的 occurrence（planned/firing…） | queued / scheduled（“即将运行”并入此组） |
| 6 | TaskRun.status=queued | queued / queued |
| 7 | TaskRun.status=running | running / executing |
| 8 | TaskRun.status=partial | needs_action / `EXECUTION_PARTIAL`（warning） |
| 9 | TaskRun.status∈{failed,cancelled} | failed_cancelled / failed|cancelled |
| 10 | succeeded 且 delivery∈{pending,running,retrying} | running / result_processing（卡片不得显示“投递中”） |
| 11 | succeeded 且 delivery∈{succeeded,not_configured} | completed / done（`not_configured` 不展示） |
| 12 | succeeded 且 delivery∈{failed,partial,dead_letter} | needs_action / `DELIVERY_*`（dead_letter=critical） |
| 13 | succeeded 且 delivery 未知 | needs_action / `UNKNOWN_DELIVERY_STATUS` |

**矛盾数据禁止静默归入 completed**：开发数据中 `execution=running + delivery=succeeded`
的批次进入 needs_action（critical），保留原始状态于 `diagnostics`。

### Delivery 为什么不是一级状态

`delivery_status` / ResultDelivery 负责结果落目标表、失败恢复、幂等、dead letter 与
投递审计——是**结果处理的技术状态**。用户关心的是“这件工作是否需要我处理/是否在跑/
是否完成”，投递细节只在技术详情页（`/operations/task-runs/:id` 等）作为诊断信息存在。
后端能力全部保留，仅不再参与一级状态与泳道。

## 4. ID 稳定与去重

| 来源 | WorkItem ID | 说明 |
|---|---|---|
| 手动/API/Backfill TaskRun | `taskrun:{taskRunId}` | |
| 未触发 occurrence | `occurrence:{occurrenceId}` | scheduledAt=planned_at |
| 已触发 occurrence | `occurrence:{occurrenceId}` + `taskRunId` | 触发前后同一 ID，卡片不重建 |

- 关联依据 `schedule_occurrence.task_run_id`（确定性外键列）。
- 去重：每个 TaskRun 至多一张卡（被 occurrence 认领后不再单独出卡）；每个未触发
  occurrence 至多一张卡；`status=cancelled/skipped` 且无 TaskRun 的空 occurrence 不投影；
  同一 WorkItem 不会出现在两个泳道；分页基于服务端筛选后的完整列表切片，不重复。

## 5. 权限模型

继承自主任务数据范围（`auth.data_scope_members`）：列表在投影构建期按
`analysis_task.created_by ∈ 同队成员` 服务端过滤（非前端隐藏）；
`GET /api/work-items/{id}` 对存在但跨团队的 ID 返回 403，不存在返回 404，
WF_AUTH=on 匿名 401。ScheduleOccurrence 与 TaskRun 均通过所属 AutomationDefinition
的 owner 检查。

## 6. API

- `GET /api/work-items`：dateFrom/dateTo/timezone/status/automationId/agentId/q/origin/
  attentionOnly/page/pageSize；`counts` 基于筛选全集（非当前页）。
- `GET /api/work-items/{taskrun:id|occurrence:id}`：同一 DTO；404/403 如上。
- `GET /api/work-items/stream`：SSE 仅发 `refresh` 信号（sequence+serverTime），
  不下发状态（避免第二套状态逻辑）；前端收到后重拉列表；SSE 失败降级 5s 轮询，
  再失败仍可手动刷新，页面不因 SSE 报错。
- 旧 Operations API（today/history/stream/detail/deliveries）全部保留。

## 7. 非目标（MTC-003 及以后）

Awake 完整 Kanban 视觉、列表视图与 Toggle、拖拽改状态、Task Drawer、Detail 重做、
Avatar 体系、WorkItem 表、migration、删除 Delivery 后端能力、删除旧 Operations API。
