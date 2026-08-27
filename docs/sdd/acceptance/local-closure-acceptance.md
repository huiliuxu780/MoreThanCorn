# 本地真实业务闭环验收报告（2026-08-28）

> 目标：确认项目能在本机完整运行（非生产部署验收）。**不修改代码、不提交 Git**。
> 环境：HEAD `6b5e29a`；隔离库 `wf_accept`（完整迁移至 g038）；后端 `:8120`（WF_AUTH=on）；前端 `:5173`（VITE_WF_API_BASE=:8120）；Worker/Scheduler 同库。
> 真实 LLM API key：**无**（`WF_LLM_API_KEY`/`auth_connection_id` 均空）。主闭环采用「input→create-record」无 LLM 工作流，结果由真实输入行派生，非 mock。

## 一、总结结论：**FAIL（部分通过）**

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
