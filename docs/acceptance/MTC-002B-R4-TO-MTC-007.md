# MTC-002B-R4 → MTC-007 交付与验收文档

> 交付日期：2026-09-06。范围：MTC-002B-R4 稳定化 + MTC-003~MTC-007 全链路重构。
> 证据目录：`.tmp-docs/mtc003-007/`（真实页面截图）、`/tmp/final-battery-{1,2,3}.log`（后端三连）。

## 1. Commit 列表

| Commit | 范围 |
|---|---|
| `5dff1d3` | fix(MTC-002B-R4): digest 回归顺序无关化 + 薄荷绿主题 token 基线 |
| `ed58a1c` | feat(MTC-003): 任务工作台（看板/列表双视图 + WorkItem Drawer） |
| `08a6674` / `c0da0cc`(amend) | feat(MTC-004): 自主任务生命周期（卡片列表/工作档案/统一编辑器） |
| `bbd5b00` | feat(MTC-006): 能力与资源 Hub + canonical 子路由 |
| `a2989ce` | feat(MTC-007): Workflow 列表真实计数 + 设计器迁移与单 schema 配置路径 |
| `82e383d` | test(MTC-002B-R4): budget 双测取最小（顺序无关） |
| 本 commit | docs(MTC-003-007): 原型与验收证据 |

## 2. 修改文件与目的（按 commit 汇总）

- `server/tests/test_mtc002b_r2.py`：digest 跨日期隔离改 2020-01-02/03 空窗口（顺序无关）；budget 双测取最小。
- `src/index.css` / `index.html`：极白/极黑中性骨架 + 低饱和薄荷绿品牌 token；dark `--surface-muted` 残留浅色修复；防闪白底色同步。
- `src/pages/operations-today.tsx`：MTC-003 工作台（双视图、Drawer、升级卡、R3/R4 语义保留）。
- `src/pages/tasks.tsx` / `task-detail.tsx` / `task-wizard.tsx` / `task-edit.tsx` / `src/features/autonomous/AutonomousTaskEditor.tsx`：MTC-004。
- `src/pages/wf-agents-list.tsx` / `agent-create.tsx` / `wf-agent-editor.tsx` / `src/features/agents/AgentLifecycleShell.tsx`：MTC-005。
- `src/pages/resources-hub.tsx` / `src/app.tsx`：MTC-006 Hub 与 canonical 子路由 + 旧路径 redirect。
- `src/features/designer/DesignerPage.tsx`（自 `src/pages/wf-designer.tsx` 迁移）/ `src/pages/wf-workflows-list.tsx`：MTC-007。
- `scripts/verify-mtc003-007.mjs`：真实页面证据截图（23 张）。
- `docs/v3-design/prototypes/*.html`：11 个设计核对原型（含 dark 变体）。

## 3. 新旧路由映射

| 旧 | 新 | 方式 |
|---|---|---|
| `/operations/task-runs/today` | `/tasks` | 既有 redirect 保留 |
| `/config/tasks/*` | `/autonomous-tasks/*` | replace redirect（既有） |
| `/config/agents/*` | `/agents/*` | replace redirect（既有） |
| `/config/workflows/*` | `/workflows/*` | replace redirect（既有） |
| `/config/ai-resources/*` | `/resources/ai/*` | 新增 replace redirect |
| `/config/data-resources/*` | `/resources/data/*` | 新增 replace redirect |
| `/config/result-rules/*` | `/resources/rules/*` | 新增 replace redirect |
| `/config/forms/*` | `/resources/forms/*` | 新增 replace redirect |
| `/settings/connections` | `/resources/connections` | 新增 replace redirect |
| `/config/tools*`、`/settings/models` | `/resources/ai…` | redirect 目标更新 |
| 新增 | `/agents/new`、`/resources`、`/resources/{ai,data,connections,rules,forms}(…)`、`/tasks?view=list` | 新路由 |
| 保留 | `/config/data-assets*`、`/settings/audit|governance`、`/operations/*`、`/quality/*` | 深链/历史保留 |

## 4. API 变化

- 无破坏性变化：旧 API 全保留。
- 附加字段（additive）：`GET /api/tasks` 增 `scheduleSummary`、`lastActivityAt`；`GET /api/tasks/{id}` 增 `createdAt/updatedAt`。
- 无新表、无 migration、无外键变化。

## 5. Migration 清单

**无。**（`git diff` 无 alembic 版本文件变化；`analysis_task` 表名/外键未动。）

## 6. 真实截图（`.tmp-docs/mtc003-007/`，23 张，verify-mtc003-007.mjs 24/24）

tasks-board-light / tasks-board-dark / tasks-list / workitem-drawer / autonomous-list / autonomous-new /
autonomous-detail / autonomous-edit / agents-list / agents-new / agent-detail-build / agent-detail-observe /
resources-hub / resources-ai / resources-data / connection-detail / workflows-list / workflow-canvas /
workflow-inspector / workflow-runstate / 768 / 640-sheet / theme-toggle。

## 7. 测试（collected / passed）

| 组 | 结果 |
|---|---|
| 后端完整回归 ×3（94 collected/次） | 见 `/tmp/final-battery-{1,2,3}.log`（三次全绿为准） |
| `npm test`（vitest） | 34 / 34 |
| `npm run typecheck` | 0 错 |
| `npx eslint`（全部改动文件） | 0 error |
| verify-mtc001 | 27 / 27 |
| verify-mtc002a | 18 / 18 |
| verify-mtc002b 非 bulk / bulk | 25 / 25、20 / 20 |
| verify-mtc003-007 | 24 / 24 |
| `git diff --check` | exit 0 |

## 8. 不碰的用户既有改动

工作区中 `archive/`、`exports/`、`poc/.../skills/`、`server/app/agent_modules/business_analysis/skills/` 等未提交内容保持原样；本系列 commit 仅含上述文件。

## 9. 已知限制

1. MTC-007 设计器拆分为目录迁移 + 单 schema 主路径；手写专项表单保留为 schema 缺失回落（文档化偏离建议目录的完全拆分）。
2. Workflow 列表节点数经并行 detail 获取（页内 N 次请求，N=pageSize），非服务端批量字段；引用数为自主任务聚合（真实）。
3. 资源 Hub 消费规模为聚合真实计数（Agents/自主任务/Workflow 总数），非逐资源引用图；逐资源 refCount 在资源列表卡已有（resource-api usage.refCount）。
4. 原型 HTML 仅为设计核对物，最终验收以真实页面截图为准。
5. 暗色下部分旧页面内联样式（设计器画布令牌）仍为浅色常量，属 MTC-003+ 视觉收尾范围（画布区域）。

## 10. 明确声明

- 未删除旧 API；
- 未删除旧数据；
- 未迁移数据库表；
- 未把 Delivery 作为 WorkItem 主状态（五状态机唯一，Delivery 仅存于 TaskRun 技术详情/诊断/结果处理区）。
