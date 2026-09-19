# CORTEX (MoreThanCorn) — 产品功能完整性矩阵

审计日期：2026-09-15 ｜ 模式：AUDIT ONLY ｜ 方法：路由×导航可达性对账 + 项目自带门禁实跑（层1假控件扫描/层2契约扫描，均绿）+ API-AUDIT/RUNTIME-AUDIT/DATA-MODEL-AUDIT 交叉引用 + 三条样板链路逐层 trace。
Status 词表：COMPLETE / PARTIAL / UI_ONLY / API_ONLY / DEAD / BROKEN / UNKNOWN。

---

## 1. 导航可达性对账（侧栏 7 项 + 设置 vs 68 条路由）

侧栏入口（app-sidebar.tsx:41-89）：任务看板 /tasks · 自动任务 /autonomous-tasks · Agents /agents · Workflows /workflows · AgentFlow /agentflows · 能力与资源 /resources · 数据接入 /data-sources；设置经头像下拉（/settings，二级：connections/audit/governance/appearance/security）。

**无导航入口的路由（URL 手输/页内跳转才可达）**：
| 路由 | 入口现状 | 判定 |
|---|---|---|
| /quality/overview、/quality/results、/quality/agent-analysis | **全仓无任何 Link/navigate 指向三页入口**（仅三页互链+面包屑文案）——质检中心整域是导航孤岛 | ⚠️ 产品定位是"AI 质量智能平台"，核心域无入口 |
| /operations/today | 零入口（/tasks 看板 09-09 起为一级入口，today 页被架空） | 疑似废弃重复页 |
| /batch-tasks 树 | operations-today（自身孤儿）与深链；注释自述"深链保留" | 有意降级，可接受 |
| /operations/task-runs（批次历史） | task-detail / operations-today 页内链接 | 弱可达 |
| /config/data-assets（数据定义） | 侧栏资源壳内数据分类页可达 | OK |
| /settings/audit、/settings/governance | settings 页内入口 | OK |

## 2. 功能矩阵（按域）

### ① 任务看板 / 运营（COMPLETE）
| Feature | Route | UI | API | Service/DB | Runtime | Test | Status |
|---|---|---|---|---|---|---|---|
| 统一工作项看板 | /tasks | ✓ | /api/work-items(+stream SSE) | work_item_projection 只读投影 | ✓(静默reconcile) | task-board.rework.test 4例 | **COMPLETE** |
| 批次历史/详情 | /operations/task-runs(+/:id) | ✓ | /api/operations/task-runs* | business+ops 投影 | ✓ | e2e 脚本+pytest | COMPLETE |
| Run 详情/trace | /operations/runs/:runId | ✓ | /api/runs/{id}/trace+events | run/node_run/call_record | ✓ | pytest | COMPLETE |
| 今日运行(旧) | /operations/today | ✓ | 同 ops | — | — | — | **DEAD候选**(零入口,与/tasks重叠) |

### ② 批量分析任务（COMPLETE，正名迁移半途）
| Feature | Route | 链路 | Status |
|---|---|---|---|
| 任务列表/向导/编辑/详情 | /batch-tasks 树 | UI→bizApi→business.py→analysis_task(_version)→task_runner 批跑 | COMPLETE（真 e2e 在案：20/20 真模型批次） |
| 批次执行/失败重试/Recovery 批次 | task-run-detail | retry_failed_in_taskrun 血缘新建 | COMPLETE（但 6 条历史卡 running，AUD-RT-002） |
| 结果投递 Outbox | deliveries 面板 | delivery.py 原子认领+退避+死信 | COMPLETE（库中 1 条 dead 实证机制真实） |
| 人工评审流（claim/assign/release） | **无 UI** | 后端 5 端点齐全 | **API_ONLY** |

### ③ 自动任务 v2（PARTIAL）
| Feature | 链路 | Status |
|---|---|---|
| 列表/详情/创建（三型触发） | automations-v2→as_automations→automation_definition | COMPLETE |
| Schedule 触发→Invocation | watcher 30s+occurrence fire_key | COMPLETE（库中 4 条 Invocation） |
| API 触发（外部 invoke） | API key 门+幂等键 | COMPLETE（API_ONLY 消费面=设计如此） |
| Event 触发全链 | webhook→data_source_event(19821条全 filtered)→EventRoute→XOR 派发 | **PARTIAL**：入站半程真数据验证过，**派发半程从未走通到 dispatched**（AUD-DB-003） |
| EventRoute 管理 | UI 只能 list+create；GET/PUT/DELETE 端点无前端 | **PARTIAL**（配错无法改删，AUD-API-003） |
| Invocation 取消/重试/事件流 | 端点齐全，前端零消费（观察走投影） | API_ONLY（可接受的架构选择） |
| 预算 max_runs | 30s 反应式准入 | PARTIAL（非原子，AUD-RT-003） |

### ④ Agent 域（COMPLETE 为主）
| Feature | 链路 | Status |
|---|---|---|
| 列表/创建/编辑器九分区 | wf-agents-list/agent-create/wf-agent-editor+agent-workspace 11子页 | COMPLETE |
| 对话（SSE 流式+thinking+HITL） | agent-chat→as_agents stream 代理→8301 | COMPLETE（stream test 6例+09-11 活体冒烟） |
| 发布治理（审批/canary/回滚） | release-governance+governance.py+agent_release 单事务 | COMPLETE（库中 10 active/17 rolled_back 实证） |
| 版本冻结/快照执行 | frozen_model/skills/mcps/tools/knowledges | COMPLETE（RUNTIME §2） |
| 权限六开关 | frozen_*_policy v2→manifest→wrapper | COMPLETE |
| 封存 archive | 列表筛选+双向端点；执行面六闸门 | COMPLETE（09-12 E-2.1 落地） |
| 进化（candidates/apply/reject） | 后端 3 端点 | **API_ONLY**（evolutionList 读面在用，动作面无 UI） |
| 评测动作面（eval-run/human-score/generate-prompt/duplicate/stop-canary） | 后端建成 | **API_ONLY** |
| Skill 上传（md/zip/tgz 一步挂载） | v1 面在用；v2 upload 端点无前端 | COMPLETE(v1)/DEAD候选(v2) |
| 知识库 KB | create/status 在用；kb/search 无前端 | PARTIAL |

### ⑤ AgentFlow 脚本编排（COMPLETE）
编辑器（CodeMirror）/AI 生成对话框/ast 投影画布/SSE 执行/askUser HITL 恢复/选择性重跑——live 冒烟全过（真实 LLM，attempts=1/3 worker/askUser 闭环），多 Agent 编排示例（mayday-travel）在案。watchdog 强杀+崩溃路径 askUser 结算齐全。

### ⑥ Workflow/设计器（COMPLETE）
列表/画布设计器（@xyflow）/16 类节点/DSL 校验/发布冻结版本/run-now/SSE 节点状态订阅（NodeRunState EventSource）/minimap。历史"发布版本从不执行"缺陷已修（执行走 workflow_version_id）。缺节点级超时（AUD-RT-001）。

### ⑦ 能力与资源（COMPLETE）
五分类壳（skills/models/tools/knowledge/data）+向导+详情+版本（tool_version）+引用防护删除（usage 端点）+数据定义（发布/推断/版本）。resource-api 动态 base(type) 全链在用。旧 /resources/ai 入口 replace-redirect 治理干净。

### ⑧ 数据接入（PARTIAL——入站强、消费弱）
六型源（polling/webhook/sls/maxcompute/test_event/api_pull）：SLS/MaxCompute 真 e2e 全通（500+500 事件/397 行 CORN 实测）；接入健康概览带+一站式向导（wizard 路由已挂，**文件未提交**=工作区状态）。事件流水 tab：19821 条全 filtered（消费链未通，同③）。

### ⑨ 质检中心（**拍板延后——2026-09-15 用户决策：允许下线，后面再做**）
overview/results/result-detail(含复核 UI)/agent-analysis 四页齐全、互相链接、API 全通（quality-results 有真数据链）。整域无导航入口+人工评审后端流 API_ONLY——**用户已拍板该域整体延后**（主线=功能和平台），不再按"不可见=未交付"计缺口；下线执行工单见 Findings FEAT-001。

### ⑩ 系统/设置（COMPLETE 为主）
登录/RBAC 三角色/主题五档/连接管理（多环境+AkSk+测试连通）/审计日志(427条)/发布治理入口。**用户管理无 UI**（/api/auth/users 5 端点 API_ONLY）。告警域整域 API_ONLY 且**运行时惰性**（规则永不自动评估，AUD-RT-004）。

## 3. 假功能四类清单（实证）

| 类 | 结果 | 证据 |
|---|---|---|
| ① 假按钮/死链 | **0**（门禁绿） | `scripts/audit_layer1_fake_controls.py` 实跑：fake_buttons=0, dead_links=0, hard_status=0，allowlist 只减不增 |
| ② 前端调不存在的 API | **0**（门禁绿+抽查） | 层2 B/E 段 P0=0；抽查 eval human-score 疑似断链实为 admin.py:1355 存在（两套评测并存造成误判） |
| ③ 保存了但 runtime 不读 | **2 处确认** | alert_rule（配置永不自动评估）；event_route 建后无法经 UI 修改（PUT 无前端）→ 配置陈旧化 |
| ④ 吞错恒成功 | **2 处确认（UI 层）** | task-run-detail.tsx:241 `.catch(() => undefined)`（投递面板加载失败静默空白）；wf-api.ts:336 `.catch(() => null)`（snapshot 失败静默）。后端层2 C 段吞错=0 |

## 4. 三条样板 trace

**T1 创建并发布 Workflow→run now→看结果**：wf-workflows-list「新建」→POST /api/workflows（workflows.py:create，validator.validate DSL）→设计器保存 PUT definition→发布 POST /{wid}/publish（冻结 workflow_version）→run-now POST /api/runs（require_operator，幂等键）→JobQueue→worker EXECUTORS 逐节点（NodeRun 落库+RunEvent）→前端 NodeRunState.ts:27 EventSource 订阅 /api/runs/{id}/events→run-detail trace（call_record/token usage）。**每层有文件:行号，断点=0，COMPLETE。**

**T2 Automation 创建→触发→Invocation→派发**：automations-v2 创建（POST /api/v2/automations，target_kind XOR 校验）→schedule 型：watcher 30s tick 到期→schedule_occurrence(fire_key 唯一)→Invocation(automation_trigger_log) queued→running→agent 会话执行→终态对账结算。event 型：webhook POST /api/v2/ingress/{sid}(x-source-token)→data_source_event→EventRoute 匹配→XOR 派发→**断点在"无任何 route 命中→19821 条全 filtered"**（配置缺失非代码缺陷，但链路端到端未验证）。

**T3 Agent 配置→chat 生效**：agent-create/editor 保存 config（config_revision 递增）→发布：agent_release.publish_release（行锁+物化 frozen_model_id/params+_frozen_skills/tools/mcps/knowledges 快照）→chat：as_agents sessions/turns→agent_execution 从 **release 快照**（非 live config）编译 prompt→8301 会话→SSE 平台代理→HITL confirm 回传→agent_session_index 落库→看板投影。**UI 配置经"发布"动作进 runtime（草稿不生效=设计语义），COMPLETE。**

## 5. 统计

| Status | 计数（按功能条目） |
|---|---|
| COMPLETE | 32 |
| PARTIAL | 7（事件消费链/EventRoute管理/预算门/质检入口/KB/数据接入消费面/正名迁移） |
| API_ONLY | 6 域（告警/用户管理/人工评审/进化动作面/评测动作面/Invocation实体面） |
| UI_ONLY | 0 |
| DEAD候选 | 2（/operations/today 页、v2 skills-upload 端点） |
| BROKEN | 0 |

## 6. Findings

### AUD-FEAT-001 质检中心整域无导航入口 → **拍板关闭（2026-09-15）**
- Files: src/components/app/app-sidebar.tsx:41-89（7 项无质检）; src/app.tsx:160-163; 全仓 grep 零入口链接
- **用户拍板**：质检中心允许下线——当前主线=功能和平台，质检域后面再做。本条从 P1 缺陷改判为**有意延后**，不再计入产品缺口。
- 遗留执行项（待用户开工令，本轮 AUDIT ONLY 不动代码）——正式下线工单范围：
  1. 路由：app.tsx:160-163 四条 /quality/* 路由摘除或转 NotFound/占位；
  2. 页面：quality-overview / quality-results / quality-result-detail / agent-analysis 四页归档（建议移 archive/ 而非删除，"后面再搞"要回迁）；
  3. **页内跳转入口两处必须同批处理**：run-detail.tsx:452,606（Run 详情"查看质检结果"跳转 /quality/results/:id）——下线后变死链，需摘除或改抽屉内嵌；
  4. 保留面：quality_result 数据域、business.py 质检 API、analytics 质量 KPI **不动**（批跑产物仍是平台主链路输出）；
  5. 门禁同步：layer1 allowlist / layer4 浏览器审计 / visual-baseline 若含 quality 屏需同批调整，防止门禁红。
- Severity: 拍板关闭（执行项风险=低，改动面 6 文件） | Confidence: CONFIRMED

### AUD-FEAT-002 /operations/today 零入口孤儿页（与 /tasks 看板职责重叠）
- Files: src/pages/operations-today.tsx; src/app.tsx:134
- Severity: **P3**（DEAD 候选，需产品确认后归档） | Confidence: CONFIRMED（零入口事实）

### AUD-FEAT-003 六个 API_ONLY 功能域（后端建成、UI 未接）
- Files: API-AUDIT §3.4 全表（alerts×7/用户管理×5/评审流×5/进化动作×8/评测动作×8/Invocation×6）
- Impact: 约 40 端点的工程投入对用户不可见；其中 alerts 叠加运行时惰性（规则永不评估）=双重未交付。
- Severity: **P1**（alerts/用户管理/评审流为产品缺口）；其余 P3 | Confidence: CONFIRMED

### AUD-FEAT-004 UI 层吞错 2 处（加载失败静默空白）
- Files: src/pages/task-run-detail.tsx:241; src/services/wf-api.ts:336
- Severity: **P3** | Confidence: CONFIRMED

### AUD-FEAT-005（正面）门禁体系真实有效
- Evidence: 层1 假控件=0（allowlist 只减不增）、层2 模型×库漂移=0/Spec 端点存在性过/吞错=0/僵尸=0、602 pytest+76 vitest 全绿（64s/13s）——"假功能"在本仓已被系统性清理过（09-13 四层审计遗产）。
- Severity: 信息项 | Confidence: CONFIRMED（本次实跑）

### AUD-FEAT-006 告警域+用户管理下线（2026-09-18 用户拍板"全部下线"）
- 告警域：纯后端无 UI（规则永不自动评估，AUD-RT-004）→ main.py 卸挂载 + /api/alerts* tombstone 410；
  测试 test_p1_alerts.py 删除、test_p1_hardening 两告警用例删除。
- 用户管理：UI 本不存在（API_ONLY）→ /api/auth/users 五管理端点 410 RETIRED（登录/me 保留）；
  test_p2_auth_lifecycle.py 删除、p0_auth/p0_security_negatives 夹具改 DB 直种、p2_data_scope 管理端点用例删除。
- 质检中心：09-16 已 tombstone（FEAT-001 执行），本条闭环三域全下线。
- 门禁：pytest 641/641 绿；活体 alerts/users=410、login 保留。

### AUD-FEAT-007 lark-cli 正位=插件层（2026-09-18 用户指认）
- 现状：feishu_tools subprocess 包装=过渡插件适配器（docstring 已定位）；平台插件槽=MCP server
  实体已存在但**运行时 MCP 挂载未实施**（probes/p07 仅实证）=真缺口。
- 终态工单（待开工令）：运行时 MCP mount（stdio/http）→ lark-cli 包为首个 stdio MCP 插件
  （record_list/record_batch_create/field_list）→ 退役 feishu_tools 适配器；submit 端点服务端
  写回改由 agent 经 MCP 写工具完成（prompt 加步）。

### AUD-FEAT-007 修正（2026-09-18 同轮自纠）：插件层=MCP，**已实施**（http transport）
- 上轮"运行时 MCP 挂载未实施"=**误判撤回**（grep 漏了运行时路由文件；/workspace/mcp /hub/mcp /mcp 端点集全在，
  p07 活体实证=仓内 tool_service MCP over streamable HTTP 真挂载真调用）。
- 真限制仅一条：**stdio transport 未支持**（平台侧显式 raise；frozen 路径硬编码 http_mcp）；
  mcp-b17dz(stdio) 当前无 agent 挂载（mcps 挂载表空），无地雷。
- lark-cli 插件化终态修正：包 **http MCP 插件**（p07 同形），非 stdio；feishu_tools 适配器届时退役。
- 两层并存分工：工具层=声明式 HTTP 配方+平台鉴权执行；插件层=MCP 外部能力服务器+协议发现。
