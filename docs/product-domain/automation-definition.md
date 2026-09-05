# 自主任务（AutomationDefinition）领域定义

> MTC-002A（2026-09-05）。本文是产品语义与代码边界的单一事实源。
> 状态：语义收敛 + 兼容层已落地；**持久层未迁移**。

## 1. 产品定义

**自主任务（AutomationDefinition）** 定义一项长期、可重复执行的工作：

- 绑定 Agent 或 Workflow / WorkflowVersion（统一执行目标契约）；
- 配置输入（Data Asset / Data Definition / scope / sampling / dataWindow / inputMapping）；
- 配置调度（Schedule）与执行策略（输出绑定、失败策略）；
- 每次触发（手动 / Schedule / API / Backfill）产生一个 **TaskRun**。

```text
AutomationDefinition（自主任务定义）
             │
             │ 手动 / Schedule / API / Trigger
             ▼
TaskRun（一次批次执行）
             │
             ├── Run（单条交互执行）
             ├── Run
             └── Run
                   │
                   ▼
              Result / Delivery
```

- **TaskRun**：自主任务的一次批次执行；冻结一个 TaskVersion + DataSnapshot；
  包含一个或多个 Run；聚合出 execution 与 delivery 两组状态。
- **Run**：单条交互（interaction）的一次执行尝试（含 attempt 重试维度）。
- **Result / Delivery**：Run 产出的质量结果（QualityResult）与对外投递（ResultDelivery）。

## 2. 命名映射（产品 ↔ 代码 ↔ 数据库）

| 层 | 名称 | 说明 |
|---|---|---|
| 产品 | 自主任务 | UI 全触点统一文案（MTC-002A） |
| 领域（新代码） | `AutomationDefinition` / `AutomationDefinitionVersion` | 前端 TS 类型 + 后端 DTO |
| 持久化（现状） | `AnalysisTask` / `AnalysisTaskVersion` | ORM 类名保持不变 |
| 数据库（现状） | `analysis_task` / `analysis_task_version` | 表名保持不变 |
| 执行链（不变） | `TaskRun` / `Run` / `ScheduleOccurrence` / `QualityResult` / `ResultDelivery` | 不改名、不改机制 |

旧名称 `AnalysisTask` 在旧代码路径中继续合法；新代码应使用
`AutomationDefinition`（前端 `AutomationDefinitionDTO`、后端
`automation_dtos.automation_definition_dto`）。前端保留兼容别名：
`/** @deprecated Use AutomationDefinitionDTO */ type AnalysisTaskDTO = AutomationDefinitionDTO`。

## 3. 持久化对象 vs 读取模型

**持久化对象**（有表、有外键、有迁移历史）：

- `analysis_task`、`analysis_task_version`
- `task_run`、`run`、`schedule`、`schedule_occurrence`
- `data_snapshot`、`quality_result`、`result_delivery`、`job_queue`

**读取模型 / 投影**（无表，由查询构造）：

- `AutomationDefinitionDTO`（`/api/automations` canonical 形状）：
  `id, name, description, status, agentId, workflowId, workflowVersionId,
  inputConfig, scheduleConfig, executionConfig, createdAt, updatedAt, createdBy, version`。
  字段全部来自既有列；`workflowVersionId` 仅 pinned 策略有值，否则 `None`；
  `scheduleConfig` 取最近一条 Schedule，无调度为 `None`。**不编造字段。**
- `WorkItemProjection`（MTC-002B 规划）：任务看板的统一读模型，
  投影 TaskRun + 未触发的 ScheduleOccurrence + 异常状态；**不是新的执行实体，不建表**。

## 4. API 兼容策略（MTC-002A）

- Canonical：`GET/POST /api/automations`、`GET/PUT /api/automations/{id}`、
  `POST /api/automations/{id}/runs`、`GET /api/automations/{id}/runs`、
  `GET /api/automations/{id}/schedules`（`server/app/routers/automations.py`）。
- 旧接口 `/api/tasks*`、`/api/task-runs*`、`/api/operations/task-runs/today` 全部保留，
  ID、执行行为、写入路径不变。
- 新路由的写端点**直接调用** `routers/business.py` 的端点函数（同一代码路径），
  读端点以同一 ORM 行构建 DTO——因此新旧接口操作同一条 `analysis_task` 数据，
  不重复写入、不返回不同版本的数据。
- 幂等语义不变：`Idempotency-Key` 全局唯一（`task_run.idempotency_key` unique），
  新旧接口共享同一幂等空间。

## 5. 后续数据库迁移条件（何时才允许改表）

同时满足以下全部条件，才启动 `analysis_task → automation_definition` 的物理迁移：

1. MTC-002B 的 `WorkItemProjection` 读模型稳定并被看板消费；
2. 全部前端读写切到 `/api/automations`，`/api/tasks` 观察期内零流量；
3. 外部集成（脚本、导出、网关回调）清单确认完毕；
4. 迁移方案含双写/回填/回滚演练，并在 wf_test 全量回放历史 TaskRun；
5. 用户书面批准迁移窗口。

在此之前：禁止改表名、禁止改外键、禁止新增 `Task` 表、禁止批量改历史数据。

## 6. 当前非目标

- 不做物理迁移（见 §5）；
- 不重命名 `TaskRun` / `Run` / 执行链任何对象；
- 不重做任务看板（MTC-003）与自主任务新建/编辑界面；
- 不实现 `WorkItemProjection`（MTC-002B）；
- 不把代码中所有 `task` 标识符机械替换为 `automation`——旧标识符在旧路径继续有效。
