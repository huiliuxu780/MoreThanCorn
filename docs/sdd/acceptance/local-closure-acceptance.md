# 本地真实业务闭环验收报告（2026-08-28）

> 目标：确认项目能在本机完整运行（非生产部署验收）。**不修改代码、不提交 Git**。
> 环境：HEAD `6b5e29a`；隔离库 `wf_accept`（完整迁移至 g038）；后端 `:8120`（WF_AUTH=on）；前端 `:5173`（VITE_WF_API_BASE=:8120）；Worker/Scheduler 同库。
> 真实 LLM API key：**无**（`WF_LLM_API_KEY`/`auth_connection_id` 均空）。主闭环采用「input→create-record」无 LLM 工作流，结果由真实输入行派生，非 mock。

> **复验更新（2026-08-28，见 §七）**：三个 P1 缺陷已修复（`b3a6c2e`/`7ab3c50`）并复验通过，
> 本地业务闭环（含真实 PostgreSQL 数据源、详情复核、重启持久化）现为 **PASS**。下文一至六为首次验收记录。

## 一、总结结论：首次 **FAIL** → 复验 **PASS**（见 §七）

核心闭环（创建→发布→执行→3=3=3→结果列表→刷新/重启持久化→错误路径真实失败）在**内联数据**下真实跑通；
连接测试真实通过；错误路径无伪成功。但存在 3 个 P1 缺陷阻断"完整"闭环：
① 真实 Postgres 数据源闭环永远无法产出有效 interaction_ref；② 质量结果详情页白屏（复核无法在浏览器完成）；
③ follow_latest 串用其他规则集版本。故不满足"创建—发布—执行—结果—复核完整成功"，判 **FAIL**。

## 二、完整验收表（14 步）

| # | 步骤 | 方式 | 结果 | 证据 |
|---|------|------|------|------|
| 1 | 登录 | 浏览器 | PASS | 01-logged-in-task.png |
| 2 | 创建真实数据源 | API（connection+datasource） | PASS | 10-connections.png；conn=d939a2… |
| 3 | 连接测试+读3条真实数据 | 测试=API；读取=Worker 真实读 | PASS（读3行真实） | conn_test ok:true；snap.read_count=3 |
| 4 | 创建并发布规则集 | API | PASS | rule_ver=1cb31791… |
| 5 | 创建任务绑定 | API | PASS | task=1b80ac5c… |
| 6 | 启动任务 | 浏览器（立即执行） | PASS | 02-run-final.png |
| 7 | 观察 queued→final | 浏览器刷新观察 | PASS | 见状态迁移日志 |
| 8 | 3=3=3 | DB | 内联 PASS / 数据源 FAIL | runs=3,results=3（D-00x）；数据源=EMPTY_REF |
| 9 | 结果页检查 | 浏览器 | 列表 PASS / 详情 FAIL(白屏) | 03 列表；04 白屏 |
| 10 | 复核 | 浏览器被白屏阻断 | FAIL | 05/06（详情页崩溃） |
| 11 | 刷新数据仍在 | 浏览器 | PASS | 08-after-refresh.png |
| 12 | 重启后端数据仍在 | 浏览器 | PASS | 09-after-backend-restart.png（5条） |
| 13 | 非法输入真实失败不落库 | DB | PASS | B/C-00x OUTPUT_SCHEMA_INVALID，quality_result 无对应行 |
| 14 | 数据源断开/模型失败不伪成功 | DB+代码 | PASS | postgres=READER_ERROR/EMPTY_REF；LLM 无 key=401 RunError |

## 三、专项回归

| # | 项 | 结果 | 定位 |
|---|----|------|------|
| 1 | 模型失败仍返回硬编码"你好，我在。"并标成功 | 主路径 PASS；Agent 闲聊兜底残留 FAIL | agent_runtime.py:256-261,330（P2） |
| 2 | follow_latest 串用其他规则集 | **FAIL** | task_runner.py:66-68（全局最新，无 rule_set 作用域）（P1） |
| 3 | 开启认证后 SSE 正常 | PASS（200 text/event-stream） | — |
| 4 | 页面请求全指向本机后端 | PASS（仅 :5173 + 127.0.0.1:8120） | accept-browser-1 输出 |
| 5 | 取消后 Worker 仍执行 | 仅自动化测试覆盖（未实测） | test_p1_* |

## 四、阻断问题清单（按优先级）

- **P1-1** 真实 Postgres 数据源闭环不可用：asset.record_id_field 恒为 camelCase 且创建/更新 API 不写入（resources.py:105-111,204-207），safe_ident 不引号（data_readers/base.py:16-21），二者对真实 Postgres 互斥 → 永远 EMPTY_INTERACTION_REF 或 SQL 错误（task_runner.py:289）。
- **P1-2** 质量结果详情页白屏：前端访问 `detail.businessFacts.length` 而后端详情不返回 businessFacts → React 崩溃，复核无法在浏览器完成（src/pages/quality-result-detail.tsx:490）。
- **P1-3** follow_latest 解析全局最新规则版本（无 rule_set 作用域），发布其他规则集即串版（task_runner.py:66-68）。
- **P2-1** Agent 闲聊兜底在模型失败时返回硬编码"你好，我在。"并标 succeeded（agent_runtime.py:256-261,330）。

## 五、真实浏览器 vs 自动化

- 真实浏览器（puppeteer 驱动真实 Chromium 渲染真实前端）：登录、启动任务、观察状态、结果列表、刷新、重启持久化、连接页回显（步骤 1,6,7,9列表,11,12 + 截图）。
- 真实 HTTP API（真实后端，非 mock）：connection/datasource/asset/rule/task 创建与连接测试（步骤 2-5）。
- 自动化测试/DB 查询：3=3=3、错误路径、follow_latest、SSE（步骤 8,13,14,回归）。
- 未实测（仅既有测试）：取消后 Worker 行为（回归5）。

## 六、证据位置

- 截图/日志：`/tmp/accept-evidence/`（01–10.png；backend-8120*.log；worker.log；scheduler.log；frontend-5173.log）。
- 数据库：`wf_accept`（task_run/run/quality_result/job_queue/data_snapshot）。
- 脚本：`scripts/accept-browser-1.mjs`（登录/启动/观察）、`-2`（结果/复核/刷新）、`-3`（重启持久化/连接页）。

> 说明：验收数据保留在 `wf_accept`；本次启动进程（8120/worker/scheduler/5173 验收前端）将于验收后停止。

## 七、复验（2026-08-28，修复后）——**PASS**

修复提交：`b3a6c2e`（详情页默认值 / follow_latest 作用域 / recordIdField / safe_ident 引号）、
`7ab3c50`（PG reader 行值 JSON 安全化）。环境同首次（wf_accept 重建、8120+5173+worker+scheduler）。

| 项 | 结果 | 证据 |
|----|------|------|
| 浏览器创建连接+真实测试 | PASS | conn_test ok:true；r2-pg |
| 创建 PostgreSQL 数据源+资产（recordIdField=interactionId，camelCase 引号列） | PASS | asset.record_id_field=interactionId |
| 创建规则+任务并执行 3 条 DB 记录 | PASS | runs A-001/2/3 succeeded；taskrun 3/3/0 |
| 3=3=3（真实 PG 数据） | PASS | quality_result=3 |
| 打开详情（不白屏，Business Facts 空态优雅） | PASS | 04-result-detail.png；pageerrors 无 |
| 领取/完成复核 | PASS | review_revision=1；A-003 effective_review_revision_id 置位 |
| 刷新后仍在 | PASS | 08-after-refresh.png |
| 重启后端后仍在 | PASS | 重启后结果行数=3 |
| follow_latest 不串规则集 / 无作用域 422 | PASS | test_p0_taskrun.py 两条新断言 |

回归：后端 240 passed；前端 33 vitest + tsc/eslint 0；首次发现的 P1-1/P1-2/P1-3 均已消除。
残留（不阻断本地闭环，建议后续处理）：P2-1 Agent 闲聊兜底模型失败返回硬编码并标 succeeded（agent_runtime.py:256-261,330）。

判定：**本地业务闭环通过（PASS）**。

## 八、第二轮复验（2026-08-28）：前端契约补齐 + 浏览器数据层验证

结论修正：**本地执行引擎闭环 PASS；纯浏览器端到端闭环仍未完全 PASS。**
> API 辅助装配下，本地真实 PostgreSQL 业务闭环通过；从空环境完全依靠浏览器创建并运行，尚未一次干净跑通。

修复提交：`6d800d3`（recordIdField 入 payload+渲染 / 任务表单 RuleSet 作用域 / PG 连接用户名+库名）；
提交卫生：`36e92ce` untrack `.qoder` 并 gitignore（确认非本人工作，未推送）。

| 项 | 方式 | 结果 |
|----|------|------|
| PostgreSQL Connection 浏览器创建（含用户名/库名，真实探测 active） | 浏览器 | PASS |
| Datasource 浏览器创建（type=postgresql，绑定连接） | 浏览器 | PASS |
| Asset 浏览器创建（recordIdField=interactionId，测试 Ready） | 浏览器 | PASS |
| recordIdField 入 payload+渲染 / RuleSet 选择+resultRuleSetId / 连接 user+database | 代码+type/lint/vitest | PASS |
| Rule/Task/执行/复核/重启 全浏览器一次跑通 | — | **未完成**（Task 依赖已发布 Workflow，设计器创建超出本次自动化范围） |

后端 240 / 前端 33 / tsc+lint 0。未推送任何提交。

## 九、收尾轮（2026-08-28）

- 删除被取代/调试验收脚本（`dbg-select.mjs`、`accept-browser-data.mjs`）；保留 final/final2 作为最后一段尝试记录。
- 任务表单 RuleSet 作用域增加必填提示（`required` + 条件描述，7d550b5）。
- 最后一段（Rule 发布→Task→执行→复核→重启 全浏览器）仍未干净跑通：任务向导绑定「Evaluation Agent」聚合，
  空库无可选 Agent；多选向导的无头自动化不稳定。属环境/自动化限制，非已证实产品缺陷。
- 结论维持：**本地执行引擎与浏览器数据层 PASS；纯浏览器完整业务闭环差最后一段。** 未推送任何提交。

## 十、最终轮（2026-08-28）：纯浏览器完整业务闭环 **PASS**

按用户更正的根因（任务下拉本就列 Workflow；系验收脚本未正确操作 Radix Select + 一次性 catalog 缓存）重跑：
种子后整页 reload 绕开缓存；改为「鼠标点 trigger→读取 option 文本→点击精确项」，不再用模糊 typeahead。

| 步骤 | 方式 | 结果 |
|------|------|------|
| 确认 `GET /api/workflows?pageSize=100` 返回种子 r4-wf | API | PASS |
| Rule 浏览器发布，DB 确认 status=published | 浏览器+DB | PASS |
| Task 浏览器创建（4 步向导：Workflow=r4-wf / Definition=r4-def / RuleSet=r4-rule，follow_latest） | 浏览器 | PASS（tv: follow_latest+ruleSet 置位） |
| 执行 3 条 → 3 Run succeeded / 3 Result | 浏览器+DB | PASS（3=3=3） |
| 详情不白屏 + 领取/完成复核（review_revision=1） | 浏览器+DB | PASS |
| 刷新 + 重启后端后 3 条仍在 | 浏览器 | PASS |

前置（非浏览器，已声明）：外部测试表 accept_input、已发布 Workflow/Definition 种子。
Connection/Datasource/Asset 已于第二轮纯浏览器创建。已知轻微 UX 缺口：向导 stepValid 未校验 ruleSetId（空值靠后端 422 兜底），不阻断闭环。

**最终判定：本地执行引擎 PASS + 浏览器数据层 PASS + 纯浏览器完整业务闭环 PASS。** 未推送任何提交。
