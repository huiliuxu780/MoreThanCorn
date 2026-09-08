# MTC-002B 独立验收报告

验收日期：2026-09-05  
验收 Commit：`1db28a2e4e8e4d2b9ec4606fe747fbf7309b00e0`  
结论：**不通过，退回 MTC-002B-R；暂不进入 MTC-003。**

本轮只做独立验收，没有修改产品代码、数据库或既有文档。工作区原有 `runtimes/`、`archive/` 等未提交内容未触碰。

## 1. 结论摘要

五状态产品决策已经正确落地：任务看板使用“需要操作 / 执行中 / 已完成 / 排队中 / 失败/取消”，并移除了“结果投递 / 已投递 / 投递中”作为一级状态。WorkItem 也确实是无新表、无双写的读模型。

但当前提交存在四个会破坏运行可靠性、历史真值或大数据量完整性的缺陷：

1. SSE 在开发态首次发事件即异常退出，页面实际始终降级轮询；鉴权开启后原生 EventSource 也无法携带 Bearer Token。
2. 历史 TaskRun 的 assignee 与 hasTarget 使用 AutomationDefinition 的当前版本，而不是 TaskRun 冻结的 `task_version_id`，编辑自主任务后历史卡片会漂移。
3. 已标记 `started` 但缺少 TaskRun 的 ScheduleOccurrence 被静默丢弃，详情还会把同团队数据误报成 403。
4. 服务端在过滤/分页前构建整个日期窗口，Run 聚合扫描全表；前端又固定只取第一页 200 条，超过 200 条时看板会静默漏卡且低优先级泳道最先消失。

上述均属于 MTC-002B 读模型本身，不是 MTC-003 的视觉工作，必须先返工。

## 2. 已通过项

- [PASS] 五个主状态及顺序与产品决策一致。
- [PASS] `/tasks`、自主任务详情不再把 Delivery 作为主状态或主列表列；技术批次详情仍保留投递诊断能力，边界正确。
- [PASS] 状态映射集中在 `project_work_item_status()`，前端没有复制 raw execution/delivery 映射。
- [PASS] 未触发 ScheduleOccurrence 与触发后的 TaskRun 使用同一个 `occurrence:{id}`；普通批次使用 `taskrun:{id}`。
- [PASS] 基本去重、列表/详情的团队数据范围、404/403 语义已有测试。
- [PASS] 无数据库 migration、无 WorkItem 表、无双写、旧 Operations API 保留。
- [PASS] Light/Dark 下五泳道、冲突卡、筛选、卡片跳转和自主任务详情均可浏览。

## 3. 阻断问题

### P1-01 SSE 实际不可用，且鉴权链路不成立

**事实证据**

- 浏览器实测 `/tasks` 稳定显示“降级轮询 5s”，未进入“实时（SSE）”。
- `curl /api/work-items/stream` 返回 200 但立即结束，未收到首个 `refresh` 事件。
- `server/app/routers/work_items.py:66-67` 的参数名 `timezone` 遮蔽了导入的 `datetime.timezone`；`server/app/routers/work_items.py:99` 执行 `timezone.utc` 时实际访问字符串属性，生成器首次发送前即失败。
- `src/pages/operations-today.tsx:74` 使用原生 `EventSource`，而系统身份是 `Authorization: Bearer ...`。原生 EventSource 不能设置该 header；鉴权开启时中间件会返回 401。仓库已有 `streamRunEvents()` 的 fetch + ReadableStream 授权实现，说明正确模式已存在。
- 即使未来改成 cookie，stream 内部仍在 `server/app/routers/work_items.py:84-87` 硬编码 admin/all digest，没有继承当前用户 data scope。
- 新增测试没有任何 stream 用例；14/14 浏览器门禁只验证页面可降级，不验证实时通道真的工作。

**影响**

交付报告关于“SSE refresh→重拉”的结论不成立。开发态每个页面都变成 5 秒轮询；生产鉴权态也只能轮询。并且每次轮询会触发当前昂贵的全窗口投影。

**返工要求**

- 消除参数遮蔽并增加首事件、后续 refresh、断开清理测试。
- 使用可携带 Bearer Token 的 fetch stream，或改成受支持的同源 cookie 认证；不能继续用当前原生 EventSource。
- stream 必须使用当前用户数据范围生成 digest，不得硬编码 admin/all。
- 验收脚本必须断言页面进入“实时（SSE）”，再主动制造一次允许范围内的变化并观察 refresh；另测 401/跨团队不泄漏。

### P1-02 历史 WorkItem 的执行目标会随当前配置漂移

**事实证据**

- `TaskRun.task_version_id` 是不可变执行快照关系；模型注释明确“TaskRun 只绑定一个 TaskVersion”。
- 投影只在 `server/app/work_item_projection.py:197-200` 加载 `AnalysisTask.current_version_id`。
- `_assignee()` 与 `has_target` 在 `server/app/work_item_projection.py:217-230` 继续使用 current version，完全没有读取 `TaskRun.task_version_id`。
- 开发库已有 5 个 TaskRun 的冻结版本与当前版本不同，证明这不是理论上不存在的状态。
- 当前测试只验证 ID 稳定，没有构造“V1=Workflow、运行、V2=Agent”后复查旧 WorkItem 的场景。

**影响**

自主任务编辑后，旧批次卡片可能从原 Workflow 漂移成新 Agent，或反向漂移；历史详情、筛选 `agentId` 和审计语义均不可信。这违反项目既有冻结版本原则。

**返工要求**

- 对有 TaskRun 的 WorkItem，assignee/target 完整从 `tr.task_version_id` 对应版本读取。
- 只有尚未触发的 ScheduleOccurrence 才使用 AutomationDefinition 当前版本（如产品另有 schedule snapshot 规则，应以冻结事实为准并写入文档）。
- 增加跨版本、跨 target type 的回归：V1 Workflow 运行后将定义编辑为 V2 Agent，旧卡仍必须显示 V1 Workflow，新计划显示 V2 Agent。

### P1-03 异常 ScheduleOccurrence 被静默丢卡并误报权限错误

**事实证据**

- `server/app/work_item_projection.py:291-292` 对 `occ.status == "started"` 且找不到 TaskRun 直接 `continue`。
- 这种状态没有进入 `needs_action`，也没有 `MISSING_TASK_RUN` 诊断；用户无法在看板发现调度事实已经进入 started 但批次丢失。
- `GET /api/work-items/occurrence:{id}` 先确认 occurrence 存在，随后因投影中没有该 item，在 `server/app/routers/work_items.py:138-139` 一律返回 403。对本团队的坏数据也会伪装成越权。

**影响**

最需要人工介入的调度断链反而从看板消失，诊断入口还给出错误原因。

**返工要求**

- `started/firing` 与 `task_run_id`/TaskRun 不一致时投影为 `needs_action`，给稳定 code、message、severity、conflictCodes。
- 详情必须区分“不属于投影”“关系损坏”“跨团队”，不得用统一 403 掩盖。
- 增加列表、详情、权限三组反例测试。

### P1-04 筛选/分页只是响应层分页，超过 200 条会静默漏卡

**代码事实**

- `build_work_items()` 先读取整个日期范围，再在 Python 中应用 status/automation/agent/q/origin 条件；见 `server/app/routers/work_items.py:54-60` 与 `server/app/work_item_projection.py:311` 以后。
- 子 Run 的两个 group-by 在 `server/app/work_item_projection.py:207-211` 没有限定当前 `task_run_id` 集合，会扫描并聚合 Run 全表。
- 自主任务详情在 `src/pages/task-detail.tsx:50-55` 为最近 5 个批次状态拉取整整 90 天、最多 200 条投影。
- 看板在 `src/pages/operations-today.tsx:48-50` 固定请求第一页 200 条，并在 `:148` 只对这一页分泳道，没有分页、续载或 truncated 提示。
- API 先按固定状态顺序排序再切第一页，因此数据量超过 200 时，排在后面的 `queued` 和 `failed_cancelled` 会优先被全部隐藏；顶部 `counts` 与泳道内数量会不一致。

**影响（规模性推断）**

开发库只有 27 个 TaskRun，因此当前 15 张卡未触发问题；但企业日运行量超过 200 后会出现用户不可见的工作项。90 天详情查询与每 5 秒轮询叠加后，成本随历史数据、在线人数和长时间 active 数据增长。

**返工要求**

- 把可下推的日期、automationId、agentId、origin、status 与 data scope 尽量放入 SQL；Run 聚合只针对本次候选 TaskRun IDs。
- 看板采用按泳道分页/续载，或后端返回每泳道独立的受控集合与明确 `truncated/nextCursor`；不得默默展示前 200 条。
- 自主任务详情不要拉 90 天全投影来映射 5 条 run；提供按 taskRunIds 批量取 WorkItem，或在批次摘要端复用同一映射服务。
- 增加 201+ WorkItem 的完整性测试，证明五泳道都不会因全局第一页而消失。

## 4. 非阻断但应同轮修复

### P2-01 查询参数未校验

- `dateFrom=not-a-date` 实测返回 HTTP 500。
- `timezone=Not/AZone` 实测内部回退上海时区，却在响应中原样声称 `timezone=Not/AZone`。
- 无效 status/origin 当前返回空集合而非 422。

建议用 FastAPI/Pydantic 的 date/enum 校验，并对 IANA timezone 显式 422；不要静默回退后返回假元数据。

### P2-02 日期筛选缺少可访问名称

浏览器 accessibility snapshot 中日期控件仅显示匿名 `textbox`；`src/pages/operations-today.tsx:115-117` 只有装饰性图标，没有 `<label>` 或 `aria-label`。MTC-003 做视觉时应补齐，但修复不依赖视觉重做。

### P2-03 验收夹具污染可读性

当前开发页“需要操作”主要由 5500+ 分钟的旧冲突批次占据。它证明冲突映射生效，但不应长期作为产品演示数据。应为视觉验收建立可重置 seed/profile，避免真实开发库越跑越脏。

## 5. 页面步骤与健康度

| Step | 页面/动作 | 健康度 | 结论 |
|---|---|---|---|
| 1 | `/tasks` 加载五泳道 | 部分通过 | 五状态、顺序、中文和 Delivery 收敛正确；实时通道实际失败，降级轮询。 |
| 2 | 点击 WorkItem 卡片 | 通过 | 已触发批次进入技术 TaskRun 详情；Delivery 只在技术层出现，符合边界。 |
| 3 | 自主任务详情最近批次 | 部分通过 | “任务状态”列正确显示；实现依赖 90 天全投影，且历史 assignee 仍可能漂移。 |
| 4 | “仅看需要操作”筛选 | 通过（小数据） | 五泳道保留，其余泳道为空；按钮有 active 状态。 |
| 5 | 权限/异常/大数据 | 不通过 | stream 未继承可用认证链；started 断链消失；200 条后静默漏卡。 |

## 6. 当前运行截图

1. `01-tasks-five-lanes.jpg`：五泳道及“降级轮询 5s”现状。
2. `02-autonomous-task-detail.jpg`：最近批次已使用五状态，无投递主列。
3. `03-needs-action-filter-viewport.jpg`：需要操作筛选的当前视口。

这些截图来自本次验收的当前浏览器会话，不复用开发者提交截图。截图只能证明当前可见状态，不能替代实时通道、权限、历史版本和大数据完整性测试。

## 7. 机器复验

- 后端指定回归：**68 passed**，1 个第三方弃用 warning，耗时 226.18s。
- Vitest：**34/34**。
- TypeScript typecheck：通过。
- 改动前端文件 ESLint：0 error。
- `verify-mtc001.mjs`：**27/27**。
- `verify-mtc002a.mjs`：**18/18**。
- `verify-mtc002b.mjs`：**14/14**。
- `git diff --check 03a402f..1db28a2`：通过。

测试全绿只证明现有断言成立；P1-01/P1-02/P1-03 均是缺失反例，P1-04 是当前小数据门禁无法暴露的规模问题。

## 8. 返工边界

建议建立单独提交 `MTC-002B-R`，只修上述投影/stream/分页与参数契约；继续禁止数据库 migration、新 WorkItem 表、删除旧 API 或进入 Awake 视觉重做。修复通过后再进入 MTC-003。
