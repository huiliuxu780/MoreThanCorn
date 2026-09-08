# MTC-002A-R 正式验收报告

验收日期：2026-09-05  
验收 Commit：`03a402f3f3b1eb37626ab7cd8c715ee0b4e67586`  
结论：**通过，可以进入 MTC-002B。**

## 1. 验收范围

本轮只验收：canonical/legacy DTO 拆分、runs/schedules 团队数据范围、列表配置版本、验收证据修复及 MTC-001R/MTC-002A 回归。

新增产品决策“任务主状态不出现结果投递/已投递，采用 Awake 五组工作状态”不倒灌到本提交，作为 MTC-002B 与 MTC-003 的强制输入。

## 2. 已通过项

- [PASS] `AutomationDefinitionDTO` 与 `LegacyAnalysisTaskDTO` 已拆分；deprecated `AnalysisTaskDTO` 指向 legacy 类型。
- [PASS] Agent target 的 `workflowId` 正确声明为 `string | null`，canonical DTO 不再混入 legacy-only 字段。
- [PASS] legacy/canonical 的 runs 与 schedules 共用 `_load_task_scoped`，不存在返回 404、跨团队返回 403。
- [PASS] 权限矩阵覆盖匿名、跨团队、同团队、scope=all、admin。
- [PASS] 自主任务列表使用 `currentVersionNo`，真实显示 V1/V2/V3；确无版本的旧数据仍显示 `—`。
- [PASS] 无数据库 migration、表名/外键修改或新表。
- [PASS] 五张开发者证据截图实际 SHA-1 各不相同。

复验结果：

- 后端：45 passed，1 个第三方弃用 warning。
- Vitest：34/34。
- TypeScript typecheck：通过。
- 改动前端文件 ESLint：0 error。
- MTC-001R：27/27。
- MTC-002A-R 浏览器门禁：18/18。
- `git diff --check 69d7599..03a402f`：通过。

## 3. 页面步骤健康度

| Step | 页面/动作 | 健康度 | 结论 |
|---|---|---|---|
| 1 | 自主任务列表 | 通过 | 有版本数据正确显示 V1/V2/V3；旧无版本数据保留 `—`。 |
| 2 | 自主任务详情与最近批次 | 通过（002A-R 范围） | 配置版本和运行记录同屏，数据可见。 |
| 3 | 自主任务编辑 | 通过（002A-R 范围） | Workflow target 的 nullable 修复未破坏表单回填。未提交保存以避免改变用户数据。 |
| 4 | 当前任务看板状态表达 | 待 MTC-002B/MTC-003 改造 | 当前仍有“结果投递”泳道及卡片投递状态，不符合新增产品决策。 |

## 4. 非阻断问题

### P2-01 截图唯一性断言写法无效

`scripts/verify-mtc002a.mjs` 将集合元素拼成 `文件名:大小` 后再判断唯一；因为文件名天然不同，即使两个文件大小相同也会通过。

本次五张实际截图的 SHA-1 不同，所以证据本身有效。后续应改为比较纯文件大小，最好直接比较 SHA-256。

## 5. 新增状态决策（后续强制）

### 用户可见主状态

任务 Kanban 与列表严格收敛为：

1. 需要操作
2. 执行中
3. 已完成
4. 排队中
5. 失败/取消

不再出现：

- 结果投递泳道
- 已投递主状态
- 投递中主状态
- 卡片底部的 `投递 x/y` 和 raw delivery status

### Delivery 的正确位置

后端 `delivery_status`、ResultDelivery、重试与审计能力继续保留；不能删除，因为它们负责结果落目标表、失败恢复和幂等。

但它们不再决定一级工作状态，只作为详情页的“结果去向/技术信息”存在。推荐映射：

| 原始执行/投递情况 | 工作状态 |
|---|---|
| 未触发的 ScheduleOccurrence、queued | 排队中 |
| execution running | 执行中 |
| execution succeeded，delivery pending/retrying | 执行中；phase 可显示“结果处理中” |
| execution succeeded，delivery succeeded 或 not_configured | 已完成 |
| delivery failed/dead_letter、partial、状态冲突或长期卡住 | 需要操作 |
| execution failed/cancelled | 失败/取消 |

“即将运行”也不再单列泳道；并入排队中，通过 `scheduledAt`/“计划于…”元数据区分。

## 6. 可访问性与证据边界

- DOM 可确认页面标题、表格、按钮、输入框和单选组具有可识别语义。
- 本轮没有执行保存或运行操作；写入和权限行为由自动化测试验证。
- 截图不能证明完整键盘顺序、焦点可见性或屏幕阅读器播报，后续视觉重做需单独验收。

## 7. 下一步

进入 `MTC-002B — WorkItemProjection 统一任务读模型`。其状态机必须使用本报告第 5 节，不得把 delivery 建成 WorkItem 主状态或单独泳道。

