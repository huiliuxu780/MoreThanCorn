# MTC-002B-R4 → MTC-007 独立验收

验收时间：2026-09-06 20:35–20:50（Asia/Shanghai）  
结论：**整包不通过（REJECT）**。不得将 MTC-007 或“主题换骨已完成”标为已完成。

本结论针对提交 `5dff1d3..1ef4050`，未触碰工作区中与本包无关的既有改动。

## 1. 已核实的通过项

| 范围 | 结论 | 证据 |
|---|---|---|
| MTC-002B-R4 核心回归 | 条件通过 | 独立运行 `server/tests/test_mtc002b_r2.py`：11 passed（95.90s）；交付方留存的 `/tmp/final4-battery-{1,2,3}.log` 均显示 94 passed。完整 94 用例的精确命令没有被写入验收文档，因此此处不把三连日志当作可完全复现的独立验收。 |
| 前端基础门禁 | 通过 | `npm run typecheck` 0 error；`npm test -- --run`：34/34。 |
| MTC-003 对象语义 | 通过 | `/tasks` 实页显示且只显示五个约定状态：需要操作、执行中、已完成、排队中、失败/取消；没有将 Delivery 做成泳道。看板与列表均可见。见 `01-tasks-board.png`、`02-tasks-list.png`。 |
| MTC-004/005 真实 API 主路径 | 通过（代码审查） | 自主任务编辑器调用 `bizApi.createTask/updateTask/taskSchedule`；Agent 列表与创建页调用 `agentApi`，未见 mock/demo 数据主路径。 |
| 主题 token 基线 | 通过（仅基线） | `src/index.css` 的 Light token 为 #FFFFFF，Dark token 为 #080909，品牌色为薄荷绿，不是克莱因蓝。 |

## 2. 阻断项

### P0 — MTC-007 没有完成物理拆分，不能以“完成”验收

**[OBSERVED]** `src/features/designer/DesignerPage.tsx` 仍为 **2840 行**。提交 `a2989ce` 对该文件的统计是 `2840 insertions / 0 deletions`，即把 `src/pages/wf-designer.tsx` 改名迁入而非拆分。该单体同时包含：

- `NodePalette`（第 240 行）；
- `ConfigDrawer`（第 575 行）；
- 大量节点专项手写表单（第 691–1220 行）；
- `GenericSchemaForm`（第 1244 行）；
- `AgentConfigDrawer`（第 1606 行）；
- 画布、顶部工具栏、MiniMap 和运行态 UI。

这直接不满足本任务的“设计器物理拆分”和“单一 schema 配置路径”。`ConfigDrawer` 先走手写专项表单、仅在有 schema 时走 `GenericSchemaForm`，是**双路径**，不是统一配置渲染器。交付文档第 85 行也承认这是“偏离建议目录的完全拆分”。

**要求返工：** 至少拆为 `canvas/`、`nodes/`、`inspector/`、`palette/`、`toolbar/`、`runtime/`、`schema/` 等独立模块；所有可配置节点必须由 schema renderer 主导，专项控件只能以 `x-control` 注册扩展，不得在 Inspector 中按 node type 分叉整块表单。

### P0 — Dark 主题在 Workflow 画布不成立

**[OBSERVED]** 选择“深色”后，Workflow 画布、节点面板、顶部栏、浮动工具条仍是浅色白底。真实截图：`07-workflow-dark.png`。这不是截图状态误差：代码直接写死 `bg-white`、`#fff`、`#FEF0F0`、`#A8B3C5`、`rgba(238,241,246,.6)` 等浅色常量，例如：

- 节点面板：`DesignerPage.tsx:247,260`；
- 配置 Drawer：`681–682`；
- 顶栏：`2220`；
- MiniMap、控制条、底部工具条：`2472–2482`。

这与“全局 Light/Dark、白要够白/黑要够黑”的交付目标冲突；白色流程画布占据该一级能力最主要的视觉面积，不能列为“视觉收尾”。

**要求返工：** 画布主题必须由 CSS token 或 React Flow theme token 驱动；删去此 Designer 中所有 Light-only `bg-white` 和颜色常量（状态色/透明度例外但须由 semantic token 派生）；在相同 workflow、相同视口下提供 Light 与 Dark 对照截图及自动断言。

## 3. 非阻断但必须进入返工的缺口

### P1 — MTC-006 的内部跳转仍在生成旧 canonical 路径

**[OBSERVED]** 虽然新路由已存在，资源列表“创建资源”仍导航到 `/config/ai-resources/new` 或 `/config/data-resources/new`（`src/pages/res-list.tsx:132`）；资源向导返回列表也生成旧 `/config/*`（`src/pages/res-wizard.tsx:132–133`）；旧 ToolRedirect 同样先落 `/config/ai-resources/...`（`src/app.tsx:50–52`）。

旧路径可被 redirect 纠正，所以不是数据或权限问题；但它破坏“canonical route”约束，也使以后删除兼容层变得危险。所有**新产生的链接**必须直接指向 `/resources/*`，`/config/*` 只保留被外部深链命中的入口。

### P2 — 产品文案和代码注释仍残留过期方向

**[OBSERVED]** 外观设置仍向用户显示“温暖中性色浅色主题 / 低亮度深色主题”，而当前已确定的方向是极白/极黑中性骨架。截图：`05-settings-appearance.png`、`06-settings-light.png`。同时 `src/index.css:7–11` 仍保留“克莱因蓝方向”的旧注释，虽实际 token 已是薄荷绿。

这不会阻塞功能，但会在下一次视觉迭代时误导实现。应同步为“极白中性浅色 / 极黑中性深色 + 低饱和薄荷绿”。

### P2 — 回归证据的可复现性不足

**[OBSERVED]** 三份 `/tmp/final4-battery-*.log` 的确各显示 94 passed，但交付文档没有记录执行命令或固定的 test manifest；在仓库根执行 pytest 会收集 432 个测试并在外部 runtime/service 测试处出现 13 个 collection error。验收者无法从文档一条命令复现“94”。

**要求返工：** 提交 `scripts/test-mtc002b-r4-battery.sh`（或等价 npm/python 命令）及明确 test file manifest；脚本输出 collected/passed，并让验收文档引用该脚本，而非仅引用 `/tmp` 临时日志。

## 4. 实页证据

| 编号 | 页面 / 状态 | 结果 |
|---|---|---|
| 01 | `/tasks` 看板 | 五状态泳道和 WorkItem 语义正确。 |
| 02 | `/tasks?view=list` | 列表视图真实可用。 |
| 03 | `/workflows/:id` 浅色 | 可进入真实画布；同时证明该页面仍是大型单体 UI。 |
| 04 | 设置 / 外观（深色） | 主题切换控件存在。 |
| 05 | `/workflows/:id` 深色 | **失败证据：主体仍大面积白色。** |

证据文件：

- `01-tasks-board.png`
- `02-tasks-list.png`
- `03-workflow-canvas.png`
- `05-settings-appearance.png`
- `06-settings-light.png`
- `07-workflow-dark.png`

## 5. 返工后的最低验收门槛

1. MTC-007 拆分后的 Designer 单个入口文件只保留组装职责；提交模块树和每个模块职责说明。
2. 用一个 schema-inspector 代码路径覆盖全部可编辑节点；为每个 `x-control` 提供注册和测试。
3. 深色 Workflow 的 canvas、palette、node、drawer、toolbar、minimap、dialog 全部不再出现 Light-only 实色；提供同屏 Light/Dark 证据。
4. 所有资源页内产生的导航使用 `/resources/*`；旧 `/config/*` 只承担 redirect。
5. 提供受版本控制的 R4 battery 脚本，连续三次运行通过；并跑 typecheck、vitest、MTC-003~007 浏览器门禁。

在上述五项全部满足前，**不得进入下一张需求，也不得将这批提交标为“整包完成”。**
