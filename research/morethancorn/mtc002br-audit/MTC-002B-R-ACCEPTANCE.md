# MTC-002B-R 独立验收报告

- 验收对象：`26379a1b1e912c3c2c9d7ba98707b23300295f07`
- 结论：**不通过，退回 MTC-002B-R2；不得进入 MTC-003**
- 验收方式：源码审查、真实浏览器检查、真实 SSE 连接、自动化回归、事务回滚式边界探针
- 边界：未修改产品代码，未执行会写入开发库的 `verify-mtc002b.mjs`，未执行有删除风险的 `seed_workitems_demo.py`

## 一、通过项

1. **[健康] 五泳道及主状态语义通过。** 顺序为“需要操作 / 执行中 / 已完成 / 排队中 / 失败/取消”，没有把“已投递”作为一级状态。
2. **[健康] SSE 基础连接通过。** `WF_AUTH=on` 下匿名请求为 401，Bearer 请求为 200，并收到 `event: refresh`；当前页面显示“实时（SSE）”。
3. **[健康] 历史 TaskRun 的展示目标改读冻结 `task_version_id`。** 基本用例通过。
4. **[健康] `started/firing` occurrence 丢失 TaskRun 时映射为 `needs_action`。** 不再静默隐藏。
5. **[健康] 页面基本可访问性修复通过。** 日期和搜索输入有可访问名称；键盘/读屏完整路径尚未验证。
6. **[健康] 自动化回归通过。** 后端选定套件 76/76；Vitest 34/34；typecheck、lint、`git diff --check` 通过；MTC-001R 27/27；MTC-002A 18/18。

## 二、阻断问题

### P1-01 SSE 摘要不覆盖 WorkItem 的真实状态依赖

**事实**：`compute_stream_digest()` 仅纳入 TaskRun 的少数字段和 occurrence 的四个字段，见 `server/app/routers/work_items.py:117-142`。但 WorkItem 状态还依赖子 Run 聚合、`ended_at`、完整进度字段、冻结版本/assignee、occurrence error 等，见 `server/app/work_item_projection.py:90-108`、`:163-220`。

**独立复现**：父 TaskRun 保持 `running`，唯一子 Run 从 `running` 改为 `succeeded` 后，投影从 `running` 变为 `needs_action`，并产生 `RUNS_TERMINAL_TASKRUN_RUNNING`；但 digest 前后完全一致。因此页面不会收到 refresh。

**附加错误**：前端事件流始终请求默认“今天”，没有携带当前选择的 `date/dateTo/timezone`。`streamWorkItems()` 在 `src/services/wf-api.ts:1231-1239` 固定请求 `/api/work-items/stream`；页面在 `src/pages/operations-today.tsx:94-102` 未传筛选日期。查看历史/未来日期时，该日期的变化不会触发刷新。

**R2 验收口径**：

- digest 必须与 WorkItem 投影使用同一份“会影响 DTO/状态的事实集合”，或完整包含所有依赖字段与子 Run 聚合。
- 增加至少 5 个 digest 变化测试：子 Run 终态、`ended_at` 生命周期冲突、进度字段、occurrence error、冻结版本/assignee 变化。
- SSE 接口参数与当前页面日期/时区同步，日期变化时中止旧连接并重连。

### P1-02 `agentId` 筛选破坏筛选正确性和 WorkItem 稳定 ID

**事实**：TaskRun 查询按冻结版本筛选 agent；occurrence 查询按自主任务当前版本筛选 agent，见 `server/app/work_item_projection.py:280-288`。随后 occurrence 若关联的 run 不在候选集合，又会被无条件补拉，见 `:294-298`。

**独立复现**：同一已触发 occurrence 的冻结版本为 Agent A，任务当前版本已改为 Agent B：

- 查询 Agent A 返回 `taskrun:{id}`（丢失 occurrence 稳定 ID）。
- 查询 Agent B 返回 `occurrence:{id}`，但卡片 assignee 仍为 Agent A（筛选结果错误）。

**正确语义**：已触发 occurrence 必须按关联 TaskRun 的冻结版本筛选；未触发 occurrence 才按当前版本筛选。查询 Agent A 应返回 `occurrence:{occurrenceId}`；查询 Agent B 不应返回该历史执行。

**R2 验收口径**：新增“关联 occurrence + 跨版本 agent 变更”测试，同时断言筛选结果、assignee 和稳定 ID。

### P1-03 跨午夜的 queued TaskRun 会从看板消失

**事实**：活动批次跨日条件只写了 `started_at < start`，见 `server/app/work_item_projection.py:266-270`。queued TaskRun 通常 `started_at = NULL`，若昨日创建、今日仍排队，所有日期条件均为 false。

**独立复现**：存在一个昨日 23:30 创建、`status=queued`、`started_at=NULL` 的 TaskRun；查询今日 WorkItem 时该卡片缺失。

**R2 验收口径**：queued 应按 `created_at < end` 纳入仍活动的跨日卡；running 使用 `started_at/created_at` 处理跨日。增加 23:59 创建、00:01 查询的边界测试，并明确长期 queued 的保留策略。

### P1-04 所谓批量详情接口仍是 N+1，且“数据范围已下推 SQL”与源码不符

**事实**：`/by-task-runs` 虽先批量读取 run/task，却逐条调用 `project_single()`，见 `server/app/routers/work_items.py:87-114`。`project_single()` 每条再读 task/version、执行两次子 Run count、解析名称，见 `server/app/work_item_projection.py:360-380`。

**独立计数**：请求 5 个 ID 执行 **27 条 SQL**。接口允许 200 个 ID，最坏会膨胀为约千条 SQL，不能称为真正批量优化。

**事实纠正**：提交说明及模块注释声称数据范围已下推 SQL，但列表实现先加载 occurrence/run/task，再在 Python 中根据 `created_by` 过滤，见 `server/app/work_item_projection.py:300-309`。

**R2 验收口径**：

- by-task-runs 使用一次批量投影路径，批量读版本、子 Run 聚合、Agent/Workflow 名称。
- 增加 SQL query budget 测试；5 与 200 个 ID 的查询数量不得线性增长。
- 数据范围应真正进入 occurrence/run 的 SQL 条件；若暂不做，不得在文档、注释和验收报告中宣称已完成。

### P1-05 新增 seed 脚本具有误删真实数据的风险

**事实**：脚本自称“仅开发库 wf_dev”，但没有检查环境或数据库名；`SessionLocal` 可被 `WF_DATABASE_URL` 改写。脚本还会：

- 删除所有 `fire_key LIKE 'seed-%'` 的 occurrence，见 `scripts/seed_workitems_demo.py:40-45`。
- 删除固定时间窗内所有满足泛化状态/trigger 条件的 TaskRun，与 DEMO marker 无关，见 `:52-62`。
- `_cleanup()` 在新夹具创建成功前独立 `commit()`，见 `:84-92`。
- 本地 Session 使用配置数据库，但资源创建硬编码调用 8120 API，存在两个目标数据库不一致的可能，见 `:109-137`。

这不是“测试卫生”问题，而是可误删业务开发数据的工具缺陷。报告中已经出现 cleanup 成功、后续 seed 失败的过程，说明风险路径真实可达。

**R2 验收口径**：

- 默认拒绝运行；必须同时具备明确开发环境、显式 opt-in、数据库名严格等于 `wf_dev`（更推荐独立临时库）。
- 只能删除从精确 marker 根对象可追溯出的夹具记录，禁止时间窗和通用 `seed-%` 清理。
- DB 与 API 目标必须一致；seed 失败不得先提交 destructive cleanup，或提供完整补偿。
- 为“错误 DB 拒绝运行”和“不会删除非 marker 行”增加自动化测试。

## 三、非阻断但必须随 R2 修正

1. **日期校验不严格**：`datetime.fromisoformat()` 接受 `2026-09-06T10:00:00`，与“YYYY-MM-DD”契约不符；`dateFrom > dateTo` 仍返回 200。应使用严格 date-only 解析并校验范围顺序。
2. **前端契约遗漏**：后端返回 `truncated`，但 `WorkItemListResponse` 未声明，见 `src/services/api-types.ts:393-401`。
3. **连接状态提前显示成功**：页面初值就是 `sse`，见 `src/pages/operations-today.tsx:45`；首帧到达前也显示“实时（SSE）”。应使用 `connecting | sse | polling`，收到首帧后才标 sse。
4. **验收断言偏弱**：现脚本等待“实时（SSE）”会被上述初始状态立即满足，不能证明握手成功。应等待真实首帧序号或最近刷新证据。
5. **分页一致性**：offset + load more 在并发新增记录时可能重复/漏项；SSE refresh 又会把已加载页重置为第一页。可在 R2 先去重并给出明确刷新行为，后续再升级 cursor。
6. **异步流内同步 DB**：每个 SSE 客户端每 2 秒执行同步查询，规模化后会阻塞事件循环。当前可作为架构债登记，但需给容量边界。

## 四、当前视觉证据

### 1. 今日任务看板 — 部分健康

五泳道、80px 导航和 SSE 状态均已呈现；但当前开发数据出现大量 DEMO 小时计划卡，且这张截图本身不能证明 digest 覆盖完整。

![今日任务看板](/Users/rivers/MoreThanCorn/research/morethancorn/mtc002br-audit/01-tasks-live-sse.jpg)

### 2. 自主任务详情 — 健康

最近运行记录已用 WorkItem 语义展示，主列没有“已投递”。

![自主任务详情](/Users/rivers/MoreThanCorn/research/morethancorn/mtc002br-audit/02-autonomous-task-detail.jpg)

### 3. 仅看需要操作 — 视觉健康、数据链仍阻断

筛选选中态和空泳道反馈清楚；P1-01 会导致真实冲突产生时页面不一定收到刷新。

![仅看需要操作](/Users/rivers/MoreThanCorn/research/morethancorn/mtc002br-audit/03-needs-action-filter.jpg)

## 五、最终判定

MTC-002B-R 修复了上一轮的表层阻断，并通过现有测试，但没有保证“看板是一份实时、稳定、不会漏卡的工作读模型”。P1-01、P1-02、P1-03 都会让用户看到错误或过期的卡片；P1-04 会造成明显扩展性问题；P1-05 有实际数据删除风险。

因此本轮 **不通过**。下一步只能进入 **MTC-002B-R2**，修完并独立验收后，才允许开始 MTC-003。
