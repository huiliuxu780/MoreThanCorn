# 02 · 代码审计：架构与技术实现问题清单

> 日期：2026-09-04 ｜ 状态：只读审计，未改任何代码
> 范围：`server/`（FastAPI + SQLAlchemy + Alembic，169 个非 venv Python 文件 ≈ 28.9k 行）与 `src/`（React19 + Vite + TS ≈ 23.2k 行）。
> 分级：🔴 高（结构性/正确性风险，改动越早成本越低）｜ 🟠 中（债务累积中，随功能增长放大）｜ 🟡 低（卫生问题）。

---

## 1. 总体判断

这套代码是"调研驱动、验收驱动"长出来的：契约文档（SDD/冻结规格）很完备，测试覆盖可观（后端 ~350 个测试函数/9.6k 行），仓库卫生良好（无死代码、无 TODO 残留、`__pycache__`/`dist` 未入库）。**真正的债务不在卫生，而在三处结构**：

1. **后端没有 service 层**——14 个 router 直接操作 ORM，核心域逻辑（规则引擎/发布/审计）寄居 router，并被运行时层反向导入，分层已经倒挂。
2. **两个上帝文件**——`runner.py`(1750 行，引擎+调度+队列+LLM 客户端+worker 五合一) 与 `wf-designer.tsx`(2834 行，画布+节点卡+8 个抽屉+自研 Toast 全家桶)。
3. **多处"双轨并存"**——两套 Agent 执行路径、两套错误响应格式、两套视觉体系（shadcn 主题 vs 复刻 quickservice 的 inline 色）、三源输出契约。每次新增功能都在双轨上加码。

---

## 2. 后端问题清单

### 2.1 分层与依赖（🔴）

| # | 问题 | 证据 |
|---|---|---|
| B1 | **无 service 层**：全仓无 `services/` 目录，router 直接 `db.query/commit`。直接 DB 操作计数：admin 82、business 54、agents 40、resources 34 处 | `server/app/routers/*.py` |
| B2 | **运行时反向依赖 router**：规则求值定义在 `routers/business.py:108-165`，被 `runner.py:612`、`task_runner.py:248,273`、`runtime_providers/worker.py:485` 导入。靠函数内延迟 import 掩盖循环依赖 | 同左 |
| B3 | **router 横向导入**：`agents.py:9` 引 `workflows._default_definition`；`agents.py:446` 引 `admin.audit`；`admin.py:614` 引 `resources._assert_not_echo_spec` | 同左 |
| B4 | **重复路由**：`POST /api/models` 在 `admin.py:586` 与 `admin.py:957` 逐字重复定义，OpenAPI 出现重复路径 | `routers/admin.py` |

### 2.2 数据模型（🔴）

| # | 问题 | 证据 |
|---|---|---|
| B5 | **51 个 ORM 模型挤在单文件 `models.py`（1047 行）**，全文件 0 个 `relationship()`，关联全靠手工 join | `server/app/models.py` |
| B6 | **大量"伪外键"**：`Run.agent_id/task_id`、`QualityResult.*_id`、`Schedule.task_id`、`AnalysisTaskVersion` 十余个 `*_id` 均为 `String(32)` 无 FK 约束，删除不级联不报错，引用完整性全靠应用自律 | `models.py:249-259,511-530,207-213,709-733` 等 |
| B7 | **JSONB 当主存储**：`DataAsset.rows` 整个数据集塞单列（`append_rows` 每次全量读→拼→整列写回，O(n) 放大+并发丢更新）；`QualityResult.transcript/review_history` 塞单行 JSONB，而复核历史同时有独立表 `ReviewRevision`——**同一事实双写两处** | `models.py:655,521-523,905`；`business.py:537-547` |
| B8 | 外键长度不一致：`AnalysisTask.workflow_id` 是 String(64)，`workflow.id` 是 String(32)，将来补真 FK 会直接冲突 | `models.py:676,712` |

### 2.3 运行时（🔴/🟠）

| # | 问题 | 证据 |
|---|---|---|
| B9 | 🔴 `runner.py` 上帝文件（1750 行）：20+ 节点执行器 + 裸 httpx LLM 客户端 + 调度循环 + job_queue 认领/心跳/死信 + worker 主循环；`execute_run` 单函数 285 行 | `server/app/runner.py` |
| B10 | 🔴 两套 Agent 执行路径并存：`agent_runtime.py` 内置 ReAct 循环（裸 HTTP）与 `runtime_providers/worker.py` 外部 Provider 提交/轮询，各自维护终态收尾；后者还有 `time.sleep(0.3)` 忙轮询 | `agent_runtime.py:246-337`；`runtime_providers/worker.py:148-291,366-388` |
| B11 | 🟠 任务队列是自研 `job_queue` 表+裸线程 0.5s 轮询（无 celery/arq）。机制本身完整（SKIP LOCKED/租约/退避/死信），但全部内嵌在 runner.py，且 `job_queue.run_at` 无索引 | `runner.py:1530-1665`；`models.py:229` |
| B12 | 🟠 单个 TaskRun 作业在 worker 内**整批同步串行**执行逐条交互（队列本身支持多 worker 认领，但一个批次作业从开始到结束占住一个 worker 槽，批次越大占用越久）；批次无取消端点（`cancelled_count` 列无写入路径）；批次无硬超时（SLO `taskRunDeadlineSec` 只是 DRAFT） | `task_runner.py:391-479`；`slo.py:26` |
| B13 | 🟠 轮询型"伪实时"：Provider 等待靠 job_queue 自塞 poll 任务；运行中心 SSE 端点每 2s 全量重建 board + 每卡一条 COUNT（N+1） | `runtime_providers/worker.py:119-134`；`routers/operations.py:200-241` |
| B14 | 🟠 输入侧窗口模板与运行期不一致：前端提交 `previous_day/week/month`，后端 `_resolve_window_days` 只认 `last_24h/7d/30d`（函数注释自认"其余视为全量"）——**"上一自然日"模板运行期不过滤，实际读全量**。已在自查中读码二次确认 | `task_runner.py:47-51,257-268`；`src/domain/task-mapper.ts:51-58` |

### 2.4 契约与一致性（🔴/🟠）

| # | 问题 | 证据 |
|---|---|---|
| B15 | 🔴 `contracts.py:86-125` 冻结了 40 条 `/api/v2/*` 路由，**代码零实现**——"冻结契约先行"机制实际漂移 | `server/app/contracts.py` |
| B16 | 🔴 错误信封只在 admin 遵守：`error_detail` 仅 `admin.py` 使用（20 处），其余 router 裸中文 `HTTPException`（business 78 处、agents 23 处……），前端被迫按端点分别处理 | 各 router |
| B17 | 🟠 输出契约三源并存（Module schema / legacy quality_output_schema 表 / WorkflowVersion.structured_output_schemas），回退链 `module→workflow→legacy→none` 本身即症状 | `business.py:33-63` |
| B18 | 🟠 大部分写端点无请求模型（`payload: dict` + 手写 if/raise 校验） | `business.py:538,823`；`agents.py:355` 等 |
| B19 | 🟠 Agent manifest 的 `resultMapper`/`evaluator` 声明是**死契约**：代码从不读取这两键；`quality_analysis/result_mapper.py` 只有 docstring 没有函数；ticket-automation 的 DSH bundle 在 harness 侧映射表不存在 | `agent_modules/*`；`runtimes/deepseek_harness/app/adapter.py:33-49` |

### 2.5 索引 / 性能 / 安全（🟠/🟡）

| # | 问题 | 证据 |
|---|---|---|
| B20 | 🟠 热路径缺索引：`job_queue(status,run_at)`、`run.created_at`、`quality_result.created_at`（列表默认按时间倒序） | `models.py:229,270,537` |
| B21 | 🟠 `PostgresWriter.write_record` 每行新开连接（含一次解密），批量投递连接风暴，无连接池 | `data_writers/postgres.py:88-119` |
| B22 | 🟠 自研 HMAC 令牌无吊销（无 jti/黑名单）；非生产环境加密失败**回落明文**且解密路径长期兼容明文 | `auth.py:52-74`；`secrets.py:13-21,33-45` |
| B23 | 🟠 无直接测试的大模块：`check_runs.py`、`resource_registry.py`、`agent_release.py`、`secret_ledger.py`、`data_writers/` 全部 0 引用测试文件 | `server/tests/` |
| B24 | 🟡 迁移命名三套风格并存、含裸 SQL 回填，`alembic downgrade` 基本不可用 | `alembic/versions/` |
| B25 | 🟡 `vendor/crypto-js.js` 整库内嵌无版本号；`main.py:34-49` lifespan 混入业务种子；时间助手/sha256 规范重复定义 4-5 处 | 各文件 |

## 3. 前端问题清单

### 3.1 结构（🔴/🟠）

| # | 问题 | 证据 |
|---|---|---|
| F1 | 🔴 `wf-designer.tsx` 2834 行巨石：画布+节点卡+配置抽屉(650 行手写分支)+8 个面板+自研 Toast+撤销重做+编辑锁+SSE 试运行+自动布局全在一个文件 | `src/pages/wf-designer.tsx` |
| F2 | 🔴 `services/wf-api.ts` 1252 行：15 个 API 命名空间+散装函数+适配层混居，手写 fetch 无统一错误/重试/缓存 | `src/services/wf-api.ts` |
| F3 | 🟠 状态管理零基础设施：无 store、无请求缓存层（无 react-query）；`useAsyncData/useListQuery` 只覆盖约一半页面，另一半各写各的 useEffect | 全仓 |
| F4 | 🟠 重复代码：300ms 搜索防抖 ×4（+1 变体）、手搓分页 ×2（未用共享 Pagination）、`useAsyncDetail` 重复实现、错误剥离正则 ×4 | `tasks.tsx:48-54`、`quality-results.tsx:62-69`、`result-rules.tsx:34-41`、`run-detail.tsx:93-100`、`operations-history.tsx:183-191`、`task-run-detail.tsx:129-144,229-232` 等 |

### 3.2 假功能 / 数据空洞（🔴）

| # | 问题 | 证据 |
|---|---|---|
| F5 | 任务列表假分页：全量拉取后硬编码 `{page:1,pageSize:50}`，分页组件形同摆设 | `tasks.tsx:29-31,66-76` |
| F6 | 质检总览/坐席分析的**次级聚合**是空洞：KPI/趋势/Top 问题已接真实服务端聚合（`/api/quality/analytics/*`，09 P1-03 落地），但 `attention/sceneQuality/attentionAgents/scenes` 由前端硬编码为空、`topProblem/topScene/风险/场景` 恒 "—"，对应服务端聚合缺失；且总览函数本身不收参数，页面筛选**完全不生效**。（用户 09-04 决定：两页下掉且**不再重做**，端点暂留作数据底座，见 00 §3） | `wf-api.ts:821-880`；`quality-overview.tsx:50-53`；`agent-analysis.tsx:29-30` |
| F7 | "已保存视图"用词表首项伪造，无持久化 | `quality-results.tsx:174-176` |
| F8 | 审计日志：固定 200 条+静默吞错+无筛选分页 | `audit-log.tsx:16-19` |

### 3.3 双轨视觉与手搓控件（🟠）

| # | 问题 | 证据 |
|---|---|---|
| F9 | 双轨视觉体系并存：设计器及 Agent 页"1:1 复刻 quickservice"（inline hex 51 处、`INK/INK2/INK3` 常量三处重复声明、`wf/controls.tsx` 自成一套 `C` 令牌）vs 主站 shadcn 主题；与 `domain/types.ts:3` 自我约定直接冲突 | 全仓 |
| F10 | 86 个裸 `<button>`（集中在 wf-designer）；自研 Toast 与 sonner 两套并存（自研版吞掉 position 参数）；emoji 👍👎 当人评按钮 | `wf-designer.tsx:296-323,2772-2773` |
| F11 | 硬编码：用户"质量管理员" ×3（未用真实身份；其中 `app-sidebar.tsx:294` 一处位于**冻结的左侧导航**内，V2 不修——用户 09-04 拍板导航不动）、`LEGACY_SIX_CLIENT` 六件套+一次性迁移按钮、后端地址兜底 `127.0.0.1:8100`、任务表单中文枚举互转硬编码 | `wf-designer.tsx:1899,2388,120-127`；`app-sidebar.tsx:294`；`wf-api.ts:4`；`task-edit.tsx:37,55-60` |

### 3.4 类型与健壮性（🟠/🟡）

| # | 问题 | 证据 |
|---|---|---|
| F12 | 23 处 `as unknown as` 强转、`NodeCfgLoose = Record<string, any>` 豁免、15 处 `eslint-disable`（多为 exhaustive-deps） | 全仓 |
| F13 | 节点/边 ID 用 `Date.now() % 100000`——同毫秒快速添加会撞 ID | `wf-designer.tsx:2008,2017,2136,2155,2161` |
| F14 | 模块级可变全局：`setStartFields/getStartFields` 隐式耦合设计器与变量级联器；`toastFn` 单例 | `wf/controls.tsx:50-51` |
| F15 | 🟡 路由参数 `:agentId` 实为 workflowId（误导）；`src/features/` 空目录；`audit-log` 等早期占位未清 | `app.tsx:116` |

## 4. 仓库结构观察

- `runtimes/`（agentscope / deepseek_harness / openai_agents）、`packages/`（runtime_contract / runtime_service）、`services/tool_service`、`poc/agent_runtime_providers` 构成"平台 + 运行时"多仓布局，各自独立 venv/lock，方向正确；但 **DSH bundle 名等跨服务契约是两端硬编码字符串**（B19），无共享常量与版本协商。
- `poc/`、`runtimes/` 已入 git（非 venv 部分），`exports/`（含真实通话样本）未入库——保持现状即可，但样本数据不要入库。
- 前端 `dist/` 未入库（本地残留），无问题。

## 5. 修复优先级建议（仅建议，未实施）

**第一优先（结构性，改动越早越便宜）**
1. 建立 `server/app/services/` 层：规则引擎、发布、审计、任务编排下沉；切断 `runner/task_runner/worker → routers` 反向导入（B1/B2/B3）。
2. 拆分 `runner.py` 为四件：`engine/`（节点执行+遍历）、`scheduler/`、`jobqueue/`、`llm_client/`（B9）。
3. `DataAsset.rows`、`QualityResult.transcript/review_history` 迁出单行 JSONB；软外键补真 FK 或文档化引用检查（B6/B7）。
4. 统一错误信封 + 处置 `/api/v2` 死契约（实现或删除）+ 删重复路由（B4/B15/B16）。

**第二优先（随 V2 新功能一并做）**
5. 前端引入请求层（react-query 或等价）+ 消灭 4 处复制粘贴（F3/F4）；wf-api.ts 按域拆分。
6. 设计器拆分 + 视觉令牌统一到 CSS 变量（配合 04 文档的 Flow 重设计）。
7. 输入映射引擎升级（配合 03 文档的 Trigger/映射设计，与输出侧引擎对称）。
8. 批次取消/硬超时/进度可信化（配合 06 文档）。

**第三优先（卫生）**
9. 索引补齐（B20）、Writer 连接复用（B21）、令牌吊销（B22）、补测试空洞（B23）、迁移命名收敛（B24）。
