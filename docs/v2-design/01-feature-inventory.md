# 01 · 功能盘点：全部页面与功能

> 日期：2026-09-04 ｜ 状态：只读盘点，未改任何代码
> 口径：前端 30 个路由实体、28 个页面文件（约 23.2k 行）；后端 14 个 Router、222 个端点（约 28.9k 行）。
> 完成度标记：✅ 完整可用 ｜ 🟡 结构完整但数据/能力有洞 ｜ ⬜ 占位级

---

## 1. 页面总表（按导航域）

### 1.1 质检分析域（质量洞察）

| 路由 | 页面 | 功能 | 状态 |
|---|---|---|---|
| `/quality/overview` | quality-overview.tsx (286行) | 质量总览：KPI×5、趋势图、需要关注列表、主要质量问题表、场景质量条形图（可下钻） | 🟡 「需要关注」「场景质量」服务端恒返回空，表格风险/场景列恒为 "—"；**全局筛选不生效**（筛选参数进了依赖数组但没传给请求） |
| `/quality/results` | quality-results.tsx (424) | 质检结果列表：全部/待复核/已复核 Tab、7 个筛选+更多筛选 Sheet、排序、分页、保存视图 | ✅（「已保存视图」是用词表首项伪造的，无持久化） |
| `/quality/results/:interactionId` | quality-result-detail.tsx (640) | 质检结果详情：左右可拖分栏（左对话逐字稿/右质检结果）、准则逐条复核、滑块改分、复核历史、证据引用、同列表翻页 | ✅ |
| `/quality/agent-analysis` | agent-analysis.tsx (296) | 坐席/班组分析：双视图、趋势、需要关注坐席、问题/场景卡、坐席维度交互列表 | 🟡 同 overview，`attentionAgents`/`scenes` 恒空、`topProblem/topScene` 恒 "—"，筛选不生效 |

### 1.2 任务域（配置管理）

| 路由 | 页面 | 功能 | 状态 |
|---|---|---|---|
| `/config/tasks` | tasks.tsx (194) | 任务列表：状态/工作流/资产筛选、搜索、表格、分页 | 🟡 **假分页**：一次拉全量后硬编码 page=1/pageSize=50，筛选搜索全在客户端内存做 |
| `/config/tasks/new` | task-wizard.tsx (183) | 6 步任务向导：基本设置/执行目标/分析数据/结果输出/执行策略/确认 | ✅ |
| `/config/tasks/:taskId` | task-detail.tsx (220) | 任务详情：立即执行/回填/启停/编辑、版本快照卡、最近 5 批次表、回填 Sheet | ✅ |
| `/config/tasks/:taskId/edit` | task-edit.tsx (122) | 任务编辑：单页表单复用向导 5 个 Section，从 TaskVersion 快照回填，保存=新建不可变版本 | ✅ |

任务配置能力现状（表单分区 `task-form-sections.tsx` 919 行）：
- 执行目标：Agent（版本策略：最新沙箱/最新生产/钉版本）或 Workflow（最新已发布/钉版本）
- 分析数据：数据资产 + 数据定义版本 + 输入映射（**仅字段改名**）+ 过滤条件 + 抽样 + 数据窗口
- 结果输出：platform_only / target_table（目标资产+定义版本+写模式 append/upsert+唯一键+映射表达式）
- 执行策略：一次性 / 每日 / 每周 / 每月（cron 生成）
- **没有**：事件触发、MQ 触发、外部推送接收、依赖触发

### 1.3 运行中心（SDD-13 落地，2026-09-02 已验收）

| 路由 | 页面 | 功能 | 状态 |
|---|---|---|---|
| `/operations/task-runs/today` | operations-today.tsx (235) | 今日运行看板：六列（即将/排队/执行中/投递/需关注/已完成），一张卡=一个 TaskRun 批次；SSE 实时+5s 轮询降级 | ✅ 全仓实时更新最完备的页面 |
| `/operations/task-runs` | operations-history.tsx (195) | 批次历史：表格+服务端分页，筛选/排序/分页全进 URL | ✅（分页控件手搓，未用共享 Pagination） |
| `/operations/task-runs/:taskRunId` | task-run-detail.tsx (356) | 批次详情：执行+投递双状态徽标、8 概览卡、四 Tab（Interaction Runs / 结果投递 / 失败分析六分类 / 只读配置快照）、重试失败执行/重试失败投递 | ✅ |
| `/operations/runs/:runId` | run-detail.tsx (794) | 单 Run 详情：状态头+取消/重试/审核续跑、四 Tab（Trace 瀑布/事件/Executions/快照）、Token 与调用卡、阶段表 | ✅ 体量过大 |

### 1.4 Agent 与工作流域

| 路由 | 页面 | 功能 | 状态 |
|---|---|---|---|
| `/config/agents` | wf-agents-list.tsx (249) | Agent 卡片网格：头像/版本徽标/封存标记、搜索/排序/类型筛选、新建 Module Agent 对话框 | ✅（整页绕过 shadcn 主题，inline hex 色） |
| `/config/agents/:agentId` | wf-agent-editor.tsx (201) | 三型分发：module→配置页；dialogue/expert-group/autonomous→**封存只读壳**（410 语义） | ✅ |
| （内嵌） | module-agent-config.tsx (446) | Module Agent 配置：编号分区卡（身份/模型/指令只读+业务定位追加/资源冻结）+右侧测试面板（环境=Release 绑定）+概览/运行观测/版本三 Tab+发布对话框 | ✅ |
| `/config/workflows` | wf-workflows-list.tsx (131) | 工作流卡片网格+创建/删除 | ✅ |
| `/config/workflows/:agentId` | wf-designer.tsx (**2834**) | 流程设计器：24 种节点卡渲染、左侧节点面板（服务端注册表驱动）、右侧配置抽屉、画布（连线校验/自动布局/撤销重做）、编辑锁、版本/发布门禁、SSE 试运行、节点单测、8 个抽屉面板 | ✅ 功能完整但为全仓最大巨石文件（详见 02 审计） |
| `/config/forms`、`/config/forms/:formId` | wf-forms.tsx (538) | 表单列表 + 三栏表单构建器（物料面板/画布/属性面板/真渲染预览） | ✅ |

### 1.5 资源域（AI Resources / Data Resources）

| 路由 | 页面 | 功能 | 状态 |
|---|---|---|---|
| `/config/ai-resources` | res-list.tsx (218) | AI 资源列表：Models / Tools / MCP / Knowledge / Runtime Providers 五 Tab+卡片+测试/删除 | ✅ |
| `/config/data-resources` | res-list.tsx | 数据资源列表：Datasources / Assets 两 Tab | ✅ |
| `/config/*-resources/new` | res-wizard.tsx (311) | 4 步向导：选型/配置/测试/完成（先以 disabled 落库、测试通过才启用） | ✅ |
| `/config/*-resources/:type/:id` | res-detail.tsx (257) | 资源详情：KV 表+引用关系（被引用拦截删除）+版本+编辑/测试 | ✅ |
| `/config/data-assets` | data-definitions.tsx (120) | 数据定义列表（路由名仍叫 data-assets，实体已改名 Data Definition） | ✅ |
| `/config/data-assets/:defId` | data-definition-editor.tsx (120) | 数据定义编辑：字段 schema 行编辑+eligibility+AI 字段推断+发布 | ✅ |
| `/config/result-rules` | result-rules.tsx (145) | 结果规则集列表 | ✅ |
| `/config/result-rules/:ruleSetId` | result-rule-editor.tsx (361) | 规则编辑：准则行增删、严重级/评分、版本历史、导入导出 | ✅ |

### 1.6 设置域

| 路由 | 页面 | 功能 | 状态 |
|---|---|---|---|
| `/settings/connections` | wf-connections.tsx (627) | 连接管理：卡片+创建/编辑对话框、鉴权六型（含自定义脚本沙箱）、多环境域名四槽、按环境测试连通、密钥轮换 | ✅ |
| `/settings/audit` | audit-log.tsx (**55**) | 审计日志：裸表格一次拉 200 条，静默吞错 | ⬜ 占位级，无筛选/分页/错误态 |
| `/settings/governance` | release-governance.tsx (258) | 发布治理：申请队列+审批/驳回/发布/晋级/回滚+版本 Diff 对话框 | ✅ |
| `/403`、`*` | system-pages.tsx | 403/404 | ✅ |

旧路由兼容：`/config/tasks/:taskId/runs/:runId` → `/operations/runs/:runId`；`/config/tasks/:taskId/batches/:taskRunId` → `/operations/task-runs/:taskRunId`；`/config/tools/*` → AI Resources；`/settings/models` → AI Resources?tab=models。

---

## 2. 后端能力盘点（14 Router / 222 端点）

| Router | 端点数 | 职责 |
|---|---:|---|
| admin | 50 | 模型/知识库/工具等旧资源、质检结果查询、审计、系统管理（含重复注册的 `POST /api/models`） |
| business | 39 | 任务 CRUD/版本/调度/运行/回填/批次、规则集、数据资产/数据定义、质检复核 |
| agents | 29 | Agent/Module 实例、版本、Release 发布（含 canary）、Provider 绑定、评测 |
| resources | 27 | 六类资源统一门面（SDD-12 重构后） |
| forms | 12 | 表单定义/版本/记录 |
| workflows | 11 | 工作流定义/版本/节点注册表/校验/试运行 |
| governance | 9 | 发布申请/审批/晋级/回滚 |
| runs | 8 | Run 详情/事件/Trace/取消/重试/审核续跑 |
| analytics | 8 | 聚合分析（GROUP BY 白名单拼装） |
| runtime_providers | 7 | Runtime Provider 注册/健康/能力 |
| auth_routes | 7 | 认证/角色 |
| alerts | 7 | 告警规则（**仅出站通知**，指标粒度：队列/调度/错误率/数据源/模型） |
| operations | 6 | 运行中心：今日看板/历史/详情/投递/失败分析 |
| registry | 2 | 节点定义目录 |

## 3. 运行链路盘点（实体关系）

```
Workflow(定义) ── WorkflowVersion(不可变) ┐
                                          ├─▶ Run(单条执行) ─▶ NodeRun ─▶ CallRecord
AgentModule(manifest) ─ AgentVersion ─ Release ┘        │
                                                        ▼
AnalysisTask(可变) ─ AnalysisTaskVersion(不可变) ─▶ TaskRun(批次) ─▶ N × Run(每条交互)
        │                                              │
        ├─ Schedule ─ ScheduleOccurrence(48h物化) ─────┤ 触发
        ├─ DataAsset ─ Datasource ─ Connection         ├─ DataSnapshot(输入水位/读数)
        └─ ResultRuleSet ─ RuleVersion                 └─ ResultDelivery(Outbox 投递) ─▶ 外部目标表
```

- **批次 = TaskRun**（无独立 Batch 模型）：一次触发 = 一个 TaskRun = N 条 Interaction Run。
- 触发方式仅四种：Schedule occurrence 到点 / 手动 / backfill / API（**API 是空洞值，无端点使用**）。
- 单条数据成败：每条交互独立 Run 行（状态/错误/attempt 谱系），批次聚合计数。
- 投递：Run 成功同事务创建 ResultDelivery（exactly-once creation），at-least-once 写外部 PostgreSQL 表，5 次退避后 dead_letter；执行状态与投递状态分离。

## 4. 功能面结论

1. **完整且可用的主干**：任务配置→批次执行→单条执行→输出投递→运行中心观测→质检结果复核，这条主链是真 API、真 LLM、真 PG 打通的（质检 20/20、业务分析 3/3 真实批次已跑通）。
2. **四个明显空洞**：
   - 质检分析域两张总览页的聚合数据服务端未实现（恒空 + 筛选不生效）——**用户 09-04 决定：下掉且不再重做**（00 §3）；
   - 审计日志页是占位；
   - 触发面只有 cron，无事件/推送/消息接入；
   - 输入侧字段映射只有改名能力（与输出侧受限表达式引擎不对称）。
3. **已封存不再演进**：旧三型 Agent（autonomous/dialogue/expert-group）只读；Agent Module 壳层按 06-SDD 冻结（等 workflow 能力稳定后重启 Agent 讨论）。
