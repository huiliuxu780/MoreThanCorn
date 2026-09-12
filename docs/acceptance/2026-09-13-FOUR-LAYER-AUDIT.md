# 2026-09-13 四层代码/UI 审查审计报告

- 指令：用户 2026-09-13「进入之前，请思考下，如何对我们这个项目做代码 ui审查？假功能 错代码？」→「1234 你安排场任务去做吧」（四层全做）。
- 范围：平台后端（server/，8120 验收栈 + wf_dev 活体）、前端（src/，5199）、运行时契约、浏览器真实交互。
- 判定：**READY_FOR_ACCEPTANCE**。四层全部执行完毕，P0=0；本轮发现并已修复 10 项缺陷（含 1 个 N+1、1 组假路由链接、1 个抽屉错路由、1 个测试时区炸弹）；遗留 P1×11 全部登记且有归属（8 项 F5 排期 + 3 项 F0 前历史数据行）。
- 审计工具全部脚本化入库（可重跑复核），截图 11 张待用户逐屏签字。

## 0. 方法论与工具

| 层 | 目标 | 工具（可重跑） | 结果 |
|---|---|---|---|
| 层1 | 假按钮/死链/硬编码状态扫荡 | `python3 scripts/audit_layer1_fake_controls.py`（基线 `scripts/audit_layer1_baseline.json` 只减不增） | 0/0/0，基线锁定 |
| 层2 | 模型×迁移漂移 / Spec端点存在性 / 吞错 / 僵尸端点 / DTO×TS 契约 | `cd server && WF_DATABASE_URL=…wf_dev .venv/bin/python ../scripts/audit_layer2_contract.py` | P0=0，P1=8（F5 排期 allowlist） |
| 层3 | 四执行体运行时行为（双快照禁止转移 + 不变量）+ N+1 计数门禁 | `python3 scripts/audit_layer3_runtime.py`（活体 8120 只读，不耗额度）；`cd server && .venv/bin/python -m pytest tests/test_audit_nplus1.py` | 冒烟 P0=0/P1=3（历史行）；N+1 门禁 5/5 绿 |
| 层4 | 浏览器逐控件点击审计 + 定向验证 + 新屏截图 | `node scripts/audit_layer4_ui.mjs`（无头 Chrome→5199） | 162 控件点击，0 无效果，0 JS 错误，V1/V2 通过 |

层3 状态机基准（以运行代码核对，非文档转抄）：
Run `queued|running|paused|succeeded|failed|cancelled`；TaskRun `queued|running|partial|succeeded|failed|cancelled`；AgentFlowRun `queued|running|succeeded|failed|cancelled`；Invocation `received|accepted|queued|running|completed|failed|cancelled|deduped|rejected`（DTO 大写）；work-item 统一 5 态 `needs_action|running|completed|queued|failed_cancelled`。
禁止转移：终态→任何状态（回退）、`running→queued` 等逆向边；双快照间隔 5s。

## 1. 层1：假控件扫荡

- 扫描 `src/**/*.tsx`：无 handler 按钮（排除 Radix asChild/`trigger={}` 插槽/`{...props}` 透传/submit/disabled）、`href="#"` 死链、JSX 直出状态词（排除 SelectItem 选项文案与 h1–h6 分区标题）。
- 初轮候选逐项 triage 全为误报，最后两个：`app-sidebar.tsx:646`（AccountMenu 的 `trigger={}` 插槽按钮，由 `<DropdownMenuTrigger asChild>` 接线——实文核对）与 `operations-today.tsx:237`（`{w.attention.required ? …}` 条件渲染的「需要操作」分区标题，数据驱动）。误报模式已编码为扫描规则（非行白名单），基线锁定 0/0/0，后续新增即 P0。

## 2. 层2：契约与错代码扫荡

- **A 模型×迁移漂移**：71 表 information_schema 对比，0 漂移。
- **B Spec §12 端点存在性**：初轮发现 canonical 端点缺失 → 本轮补齐 10 个别名端点（修复#1–#3）；余 8 个 event-routes/event-deliveries 端点属 **F5 真实数据源切片**排期（`SCHEDULED_GAPS` allowlist 显式登记，非静默豁免）。
- **C 吞错扫荡**：`automation_watcher.py` 2 处 `except Exception: pass` → `log.warning`（修复#4）；其余命中均带日志或注释豁免。
- **D 僵尸端点**（无测试且无前端消费）：本轮新增别名均被测试/前端消费，无新增僵尸。
- **E DTO×TS 抽样**：`/api/work-items` 响应 21 键 vs TS 23 键——差异为 TS 可选键 `rawStatus?/target?`（新源卡才携带），必需键无缺失，非 P0。

## 3. 层3：运行时行为审计（活体 8120，只读）

覆盖率（诚实上报，0 行=未覆盖不算通过）：

| 执行体 | 快照行数 | 深检 |
|---|---|---|
| Run | 48 | 终态抽样详情 20 |
| TaskRun | 19 | 详情 19；Recovery 链 0（无样本） |
| AgentFlowRun | 14 | 终态节点残留检查 14 |
| Invocation | **0**（wf_dev 无自动任务数据行） | 未覆盖 → pytest test_f2_invocations 兜底 |
| work-item | 89 | 全量不变量 |

- **P0=0**：双快照无终态回退/逆向转移；状态枚举全合法；needs_action⇔attention 一致。
- **P1=3（遗留登记）**：Run `920ac4f0/b41139bf/f56db7f1` 终态 succeeded 但 `started_at/ended_at` 全空——三行均创建于 **09-10（F0 之前）**，属历史数据缺口，非现行代码回归；按种子安全门规约（遗留 DEMO 行只读）**不自动回填**，如需可人工 SQL。
- **N+1 门禁**（新增长度门禁，比 AC-045 固定上界更强：3 行→12 行 SELECT 增量 ≤2，且断言种子生效防空列表假绿）：5/5 绿。门禁建设过程中**实抓 1 个真 N+1**：`GET /api/v2/agentflows/{fid}/runs` 原逐 run 查询节点行（1+N），已修（修复#5）。

## 4. 层4：浏览器逐控件审计（无头 Chrome → 5199 活体）

- 方法迭代如实记录：rev1 一次性句柄+合成 `el.click()`，仅点 10 控件且 16 个「无效果」**全为方法假阳性**（导航后句柄失效静默跳过；Radix 菜单/Select 只认真实 pointer 事件）。rev3 改为每轮重查句柄、按 label 去重、`page.mouse.click` 真实点击、效果信号含元素自身 label/aria 变化。
- **rev3 终值**：5 页 + agentflow 详情页，点击 162 控件，DENY 词表安全跳过 17（不触发变更/不耗额度；其中 4 个为文本含「运行」字样的冲突提示卡，其抽屉路径已被 V1/V2 行点击覆盖），站内导航链接免点 43（href 存在即真导航，死链归层1）。**无效果控件 0，页面 JS 错误 0。**
- **定向验证（层3 修复的浏览器实证）**：
  - V1 ✓：周期切「近 7 天」→ workflow 卡抽屉出现「查看执行详情」→ 实际导航 `/operations/runs/968b1470…`；
  - V2 ✓：分析卡「所属分析任务」→ `/batch-tasks/b63c5f27…`（修复前错路由 `/autonomous-tasks/{分析任务id}`，v2 详情页按 AutomationDefinition 查 id 必然空数据）。

## 5. 本轮修复清单（10 项）

| # | 文件 | 修复 |
|---|---|---|
| 1 | `server/app/routers/business.py` | canonical 别名：`GET /api/analysis-task-runs/{trid}`、`/items`、`/events`、`POST …/retry-failed`（Spec §12 登记端点） |
| 2 | `server/app/routers/as_automations.py` | 别名：`POST /api/v2/automations/{aid}/enable|disable`；`GET /api/v2/invocations/{iid}/events`（workflow→RunEvent / agentflow→节点事件 / session→运行时摘要单批调用，不可达时诚实 note） |
| 3 | `server/app/routers/work_items.py` + `main.py` | `/api/v2/work-items` canonical 别名（list/stream/get 委托既有 handler，同门禁） |
| 4 | `server/app/automation_watcher.py` | 2 处吞错 → `log.warning`（watcher 锁获取/释放） |
| 5 | `server/app/routers/as_flows_board.py` | `list_flow_runs` N+1 → 节点行一次 IN 批量+分组 |
| 6 | `server/app/work_item_projection.py` | 假路由链接组修复：`_exec_item` 改用各源真实 `detail_link`（原硬编码 `/tasks/{wid}` 全 404）并删除伪造 `/{kind}/{id}` target 链；Invocation 卡携带 `automationId`；AgentFlow 卡链 `/agentflows/{def}?view=runs`（release→definition 批量加载）；session 链 agent_id 守卫；**孤儿 Release（血缘断裂）→ needs_action + attention `RELEASE_MISSING` + 降级导航 `/agentflows`**（活体实抓 1 行：run 50dacf6e 引用已删 release b689a7a1） |
| 7 | `src/pages/operations-today.tsx` | 抽屉导航按 kind 分流：分析卡→`/batch-tasks/{id}`（修错路由）；新源卡→「查看执行详情」走 `links.detail`；Invocation→「所属自动任务」`/autonomous-tasks/{id}`；空 id 不出按钮（消灭半假按钮） |
| 8 | `src/services/api-types.ts` | links 联合 `detail: string \| null`（契约对齐运行时） |
| 9 | `server/tests/test_f4_work_items.py` | **测试时区炸弹**：`_today()` 原取 UTC 日期，每天上海 00:00–08:00 窗口错位致 5 用例假红（本轮 00:30 实抓复现）→ 改 Asia/Shanghai；新增 `test_exec_card_links_are_real_routes`（四源真实路由 + 孤儿 Release 断言） |
| 10 | `server/tests/test_audit_nplus1.py` | 新增 5 端点 N+1 增长门禁（work-items / runs / task runs / invocations / agentflow runs） |

## 6. 门禁复验证据（全绿，可复现）

```
cd server && .venv/bin/python -m pytest tests/ -q          → 556 passed
npm run build   (tsc -b && vite build)                      → ✓ built in 4.25s
npx vitest run                                              → 65 passed (11 files)
python3 scripts/audit_layer1_fake_controls.py               → 0/0/0，基线门禁通过
…/audit_layer2_contract.py                                  → P0=0 P1=8（F5 allowlist）
python3 scripts/audit_layer3_runtime.py --interval 5        → P0=0 P1=3（历史行）
node scripts/audit_layer4_ui.mjs                            → 162 点击/0 无效果/0 JS 错误/V1V2 ✓，exit 0
```

注：8120 验收栈已于本轮重启两次加载现行代码（仅 kill `lsof -ti:8120 -sTCP:LISTEN` 精确 PID；8000/5173/5199/8301 未触碰）。

## 7. 截图交签清单（待用户逐屏签字）

目录 `docs/acceptance/assets/2026-09-13-audit/`：

1. `operations-board.png` 今日看板（板视图）
2. `operations-list.png` 今日看板（列表视图）
3. `drawer-workflow-card.png` workflow 卡抽屉（含「查看执行详情」新按钮）
4. `v1-run-detail.png` V1 导航落点（Run 详情）
5. `v2-analysis-detail.png` V2 导航落点（分析任务详情，路由已修正）
6. `agentflows.png` AgentFlow 列表
7. `agentflow-script.png` AgentFlow 详情·脚本投影
8. `agentflow-runs.png` AgentFlow 详情·runs 视图
9. `agents.png` Agent 列表（含封存入口）
10. `automations.png` 自动任务列表
11. `agentflow-detail.png` AgentFlow 详情·runs 视图（逐控件审计页，rev3 增补）

## 8. 遗留与移交

- **P1×8**：event-routes / event-deliveries 端点 → F5 真实数据源切片（层2 `SCHEDULED_GAPS` 显式登记）。
- **P1×3**：09-10 历史 Run 行缺 `started_at/ended_at`（F0 前遗留，登记不回填）。
- **覆盖缺口**：活体 Invocation/Recovery 链冒烟 0 样本（wf_dev 无自动任务数据行）——下轮验收前建议先造一条真实 automation 数据再跑 `audit_layer3_runtime.py` 补覆盖；单测层已有 test_f2/f3 兜底。
- 09-11 全量审查审计的批次 C/A/B/D/E 拍板项**不在本轮范围**，仍待用户裁决（见 9df86c2 报告）。
- 本轮所有提交仅本地（不 push），按惯例待用户验收。
