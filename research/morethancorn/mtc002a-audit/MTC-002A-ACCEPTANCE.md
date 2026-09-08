# MTC-002A 正式验收报告

验收日期：2026-09-05  
验收 Commit：`69d7599cc2bc5ab1383375cf91ad8634a44b1f37`  
结论：**退回小范围返工；MTC-002B 暂不启动。**

## 1. 范围与证据

本次验收只检查 MTC-002A：自主任务语义收敛、`AutomationDefinition` 兼容层、旧 API 兼容、无数据库迁移、产品文案及 MTC-001R 回归。未验收 WorkItemProjection、任务看板重做或自主任务页面视觉重做。

本轮重新从运行中的 `http://127.0.0.1:5199` 捕获并检查：

1. `01-autonomous-tasks-list.png`
2. `02-autonomous-task-new.png`
3. `03-autonomous-task-detail.png`
4. `04-autonomous-task-edit.png`
5. `05-settings-copy.png`

## 2. 已通过项

- [PASS] Commit 只新增 DTO、canonical 路由、文档、测试和产品文案；未修改 ORM 模型、数据库表名或外键，未新增 `Task`/`automation*` 表。
- [PASS] `/api/automations` 七个约定端点已注册并可访问。
- [PASS] 创建、更新、启动运行均复用原 `business.py` 写路径；同一个 Idempotency-Key 在新旧运行接口之间只产生一个 TaskRun。
- [PASS] 新旧列表同 ID 顺序、详情同记录、创建/更新互通、Schedule 同源。
- [PASS] 自主任务列表、新建、详情、编辑及设置页面的目标产品文案已经收敛。
- [PASS] 领域文档明确区分持久化对象和 MTC-002B 的读取模型，并写明物理迁移前置条件。
- [PASS] MTC-001R 固定 80px rail、主题、路由和移动端门禁无回归。

复验结果：

- 后端目标回归：32 passed，1 个第三方弃用 warning。
- Vitest：34/34。
- TypeScript typecheck：通过。
- ESLint 改动 TS/TSX 文件：0 error；Python 文件不在 ESLint 规则范围。
- `verify-mtc001.mjs`：27/27。
- `verify-mtc002a.mjs`：10/10。
- `git diff --check 817a92f..69d7599`：通过。

## 3. 阻断问题

### P1-01 Canonical TypeScript DTO 与实际 API 响应不一致

`src/services/api-types.ts` 把旧 `/api/tasks` 字段和新 `/api/automations` 字段合并进同一个 `AutomationDefinitionDTO`，又将 `AnalysisTaskDTO` 直接 alias 到它。

实际 `/api/automations` 响应不含以下被声明为 required 的字段：

- `workflowVersionPolicy`
- `dataAssetId`
- `dataDefinitionId`
- `taskVersion`

同时 Agent 型自主任务实际返回 `workflowId: null`，但 TypeScript 声明为 `string`。

影响：`typecheck` 虽然全绿，但 `bizApi.automations` 的调用者会被错误类型保证误导，切换页面到 canonical API 后会出现 `undefined`/空值运行时错误。

纠正方案：

1. `AutomationDefinitionDTO` 只描述 canonical 响应，字段 required/nullable 与真实 JSON 完全一致。
2. `LegacyAnalysisTaskDTO` 单独描述 `/api/tasks` 响应。
3. `AnalysisTaskDTO` 可 deprecated alias 到 `LegacyAnalysisTaskDTO`，不能 alias 到 canonical DTO。
4. 增加 workflow-target 与 agent-target 两种 canonical contract 测试。

说明：原任务书同时要求“canonical 新形状”和“旧类型直接 alias 新类型”，这两个要求在现有响应结构下存在逻辑冲突。开发者按字面实现了 alias，但验收必须以实际契约安全为准，因此修正任务书。

### P1-02 Run/Schedule 子资源绕过团队数据范围

复现条件：`WF_AUTH=on`，Team B、`data_scope=team` 的 viewer 访问 Team A 创建的任务。

实测：

```text
GET /api/automations/{id}            -> 403
GET /api/automations/{id}/runs       -> 200
GET /api/automations/{id}/schedules  -> 200
```

原因：canonical wrapper 和它复用的 legacy `list_task_runs` / `list_task_schedules` 都没有执行 `assert_task_readable`。

这不是本提交首次制造的漏洞，旧 `/api/tasks/{id}/runs|schedules` 已经存在；但 MTC-002A 将它复制到了新的 canonical API，扩大了公开契约，不能带入后续架构。

纠正方案：

1. 给 legacy 和 canonical 的 runs/schedules 查询统一增加登录身份依赖和 `assert_task_readable`。
2. admin、scope=all、同团队仍返回 200；跨团队返回 403；匿名生产模式返回 401。
3. 新旧端点分别加入数据范围回归测试。

关闭越权属于安全修复，不视为破坏正常兼容。

## 4. 非阻断但必须纠正的验收问题

### P2-01 第 5 张截图不是独立证据

开发者提交的：

```text
03-autonomous-task-detail.png
05-autonomous-task-runs.png
```

SHA-1 完全相同，二者是同一张截图。验证脚本第 66、68 行也导航到相同详情 URL。

项目当前并不存在 `/autonomous-tasks/:id/runs` 独立页面；原验收材料要求在这里有歧义。返工时不要再复制文件凑数量：将证据改成 `03-autonomous-task-detail-with-runs.png` 即可，或者真正点击一条批次进入 `/operations/task-runs/:id` 并明确它是运行中心页面。

### P2-02 列表“配置版本”全部显示为破折号

列表页面调用 legacy `bizApi.tasks()`，但渲染读取 `task.taskVersion?.versionNo`；legacy 列表实际提供的是 `currentVersionNo`，并不提供 `taskVersion`。详情页可正确显示 V1，列表却全部显示 `—`。

这是 MTC-002A 之前就存在的显示错误，不作为本次新增回归，但建议随 DTO 拆分一起修正：在 legacy DTO 中声明并使用 `currentVersionNo`。不要为了修这个问题强行把整个页面切换到 canonical API，因为当前页面还依赖 `agentName`、`moduleKey` 等 legacy 列表投影字段。

## 5. 页面步骤健康度

| Step | 页面/动作 | 健康度 | 结论 |
|---|---|---|---|
| 1 | 自主任务列表 | 部分通过 | 命名、入口、搜索文案正确；配置版本显示错误。 |
| 2 | 新建自主任务 | 通过（本任务范围） | 标题、返回入口和步骤文案已收敛；未评价后续 MTC-006 的交互重做。 |
| 3 | 自主任务详情与最近批次 | 通过（本任务范围） | 命名、配置快照和批次区块真实可见。 |
| 4 | 编辑自主任务 | 通过（本任务范围） | 命名与数据回填可见；未执行保存，以免改变用户数据。 |
| 5 | 设置占位文案 | 通过 | 已改为“「通用」功能尚未启用”。 |

## 6. 可访问性与证据边界

- 本轮通过 DOM 语义确认标题、按钮、文本框、单选组和表格具有可识别角色。
- 截图只能证明可见文案与布局，不能证明完整键盘顺序、焦点可见性、屏幕阅读器播报或对比度达到 WCAG；这些不是 MTC-002A 的视觉验收目标。
- 未提交新建、编辑、立即执行或回填操作，避免改变当前开发数据；写入正确性由隔离测试覆盖。

## 7. 返工出口

创建独立 Commit `MTC-002A-R`，仅完成：

1. canonical/legacy TypeScript DTO 拆分并补齐 nullability；
2. 新旧 runs/schedules 团队数据范围修复与测试；
3. 列表 `currentVersionNo` 显示修复；
4. 修正重复截图与验证脚本的证据命名。

返工不得进入 MTC-002B、不得新增 WorkItem、不得修改数据库结构、不得重做 UI。

