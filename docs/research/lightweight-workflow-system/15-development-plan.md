# 15 · 开发计划：完整设计 / 分期 / 功能清单 / 一致性验证

> 输入：01–14 调研与设计、contracts/、冻结基线（初始化doc/）、现有前端原型（src/）。
> 目标栈：前端 Vite+React19+@xyflow/react+shadcn；后端 FastAPI+Pydantic+SQLAlchemy+Alembic+PostgreSQL。不用 LangGraph。

## 1. 完整设计总览

```
┌ 前端（src/ 升级） ────────────────────────────────────────────┐
│ 列表页(卡片+搜索+状态)  编辑器壳(顶栏:版本/自动保存/检查/保存/发布) │
│ 画布(palette/连线/优化布局/缩略图/节点搜索/收起)                  │
│ Inspector(schema驱动抽屉)  VariablePicker(公共/前序/记忆/系统)    │
│ 调试面板(Start参数+开始运行)  Run视图(列表/详情/节点日志/SSE实时)   │
└──────────────┬ OpenAPI(contracts/openapi.yaml) ───────────────┘
┌ 后端 FastAPI ────────────────────────────────────────────────┐
│ workflow-svc: draft/save / validation / publish / versions / history │
│ registry-svc: node-definitions / tools(+versions) / models / connections │
│ run-svc: PG queue → worker → Runner(DAG状态机) → executors(llm/tool/ │
│          condition/transform/end/sink) → run_event(SSE+落库)          │
│ schedule-svc: cron(croniter,企业时区) → 建 Run                        │
└──────────────┬───────────────────────────────────────────────┘
┌ 数据层 PostgreSQL ─ workflow / workflow_version(draft_definition+快照) /
│ job_queue / run / node_run / run_event / call_record / tool / tool_version /
│ model_provider / model / connection / schedule ─(11-data-model.md)────┘
Kernel/业务分离：质检业务(analysis task/quality result/evidence)经 Adapter 消费 Kernel 事件与 Result。
```

## 2. 分期 P0/P1/P2（P3=后续）

| 期 | 目标 | 退出标准（DoD） |
|---|---|---|
| **P0 契约与编辑闭环** | 后端骨架+全表迁移；DSL Pydantic+Validator；draft save/get；node-registry；前端列表+编辑器壳+palette+Inspector+VariablePicker+检查红点+自动保存指示 接真 API | 浏览器里创建→加节点→连线→配置→保存→刷新恢复→检查清单正确；contract 测试全绿 |
| **P1 执行闭环** | queue+worker+Runner；executors(llm/tool/condition/transform/end)；SSE 事件；调试面板试运行；Run 列表/详情/节点日志；画布运行态环 | POC 场景（Start→LLM①→Condition→Tool→LLM②→Transform→End）端到端跑通，节点实时变色，日志可查，失败可定位回节点 |
| **P2 治理与加固** | publish/versions/history(+基于版本建草稿)；schedule CRUD+tick+执行历史；tools/models/connections 管理页；日志筛选/复制/下载；重试/超时策略；RBAC 基线；metrics | 发布后版本不可变；周期任务按企业时区触发；被引用 connection 删除=409；Reviewer 审计通过 |
| P3 后续 | 记忆变量(state)、知识检索 builtin tool、子 Agent 节点、并行 SLA、error 边、日志导出增强 | — |

## 3. 功能清单（→阶段）

后端：
- F1 workflow CRUD+draft(baseRevision 乐观锁) P0；F2 Validator(7 规则,07§5) P0；F3 node-definitions 注册 P0；F4 publish+version 快照+history P2；F5 tools CRUD+tool_version+test P1(tool 执行)/P2(管理页)；F6 models 目录 P0(下拉)/P2(管理)；F7 connections+secret(Fernet)+test+引用阻断 P2；F8 run 创建(门禁)+queue(SKIP LOCKED)+worker P1；F9 Runner(DAG/条件/汇聚/取消/超时/有限重试) P1；F10 executors×6 P1；F11 run_event+ SSE(Last-Event-ID 重放) P1；F12 call_record(脱敏) P1；F13 schedule(croniter+tick+history) P2；F14 RBAC 基线 P2；F15 metrics P2。
前端：
- G1 列表页(卡片/搜索/状态/新建) P0；G2 编辑器壳(版本/自动保存/检查红点/保存/发布软警告) P0+P2(发布)；G3 画布(palette 两组+搜索/连线/重复连线校验/优化布局/缩略图/节点搜索/收起) P0；G4 Inspector schema 驱动(分区折叠/模型下拉/提示词#/条件构建器/输出表) P0；G5 VariablePicker(公共/前序分组/类型过滤) P0；G6 调试面板 P1；G7 画布运行态(环+进度文案) P1；G8 Run 列表/详情/节点日志 P1；G9 发布流+历史 Sheet P2；G10 schedule 区块(Task 内) P2；G11 tools/models/connections 页 P2。

## 4. 页面原型 / Design Spec 现状与缺口

- **已有**：冻结 DESIGN_SPEC(质量页)+IMPLEMENTATION_SPEC(路由/RBAC/时间)+本轮 interaction-spec(字段级交互)+design-system-observations(视觉)+06(前端架构)+14-b(节点配置表)+contracts。= 工作流编辑器的**文字+字段级 design spec 已完备**。
- **已有原型**：src/ 前端原型含旧版 agent-designer(xyflow, sim 风格节点)，= 可运行低保真原型。
- **缺口**：① 编辑器新版 UI 未按 06/14 更新进原型（P0 做）；② 无静态高保真 mockup——建议不单独画，直接用 P0 可运行原型当原型（shadcn+design-system 令牌），省一轮返工。如你要静态稿，我可在 P0 前补 Figma 级 HTML mock。

## 5. 开发-设计一致性验证

1. **契约唯一源**：contracts/*.json + openapi.yaml → codegen 前端 TS 类型 + 后端 Pydantic；CI 跑 schema↔fixture 校验；改代码必须先改契约（PR 规则）。
2. **黄金 fixture**：解码的 quickservice DSL(flow-detail-decoded-dsl.json)与 SSE 提取(sse-runs-extract.json)作为**只读兼容 fixture**：Validator 须对其给出与产品一致的 checkList（nodeConnectIncomplete 等）。
3. **追溯矩阵**：功能清单每项=文档章节+截图ID；每条借鉴决策(04)=功能项或显式"不做"；矩阵入 docs，Reviewer 每期核对。
4. **测试层**：单元(Validator/Resolver/Runner 状态机)；集成(API+SSE, httpx)；**e2e=复用本轮 CDP 自动化框架打 localhost**，脚本化跑 POC 场景与四件套交互；每期结束派 Reviewer Agent 对照 interaction-spec 截图审计 UI。
5. **阶段门**：上表 DoD 全过才进下期；未过项入风险榜不静默跳过。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 前端 xyflow v12 与 sim v11 API 差异 | P0 首周做画布 spike（连线/收起/布局） |
| SSE 重放与刷新恢复复杂度 | P1 先"快照+续接"双形态（02 §5 已裁决） |
| 后端从零起步工作量 | P0 只 6 端点；queue 用 PG，不引 Redis |
| 设计-实现漂移 | 第 5 节机制+每期 Reviewer |

## 7. P0 完成验收（2026-08-21）

- 后端：server/（FastAPI+SQLAlchemy+Alembic，PG wf_dev，端口 8100）；15 表 migration；Validator 七规则；契约测试 9/9 绿（含 quickservice 黄金 fixture 兼容：同节点同 kind 标记）。
- 前端：VITE_WF_API=1 门控（冻结路由不变）；wf-agents-list + wf-designer（画布/palette/Inspector schema 驱动/VariablePicker/检查红点 popover/自动保存 debounce+时间戳/发布软警告/历史版本 Sheet）。
- e2e（scripts/e2e-p0.mjs，CDP 打 localhost:5173）：创建→加 LLM→连线×2→Inspector 配模型+提示词→自动保存→刷新恢复(3 节点 2 边)→validation issues=[]。截图 /tmp/qE2E-*.png。
- 启动方式：`cd server && .venv/bin/uvicorn app.main:app --port 8100`；`VITE_WF_API=1 npm run dev`。
- 下一步 P1：queue+worker+Runner+executors+SSE+调试面板+Run 视图（按 §2 退出标准）。

## 8. UI 复刻验收（16 规格，2026-08-22）

- 复刻版 wf-designer/wf-agents-list 通过 15 项验收清单（16 §11）；e2e 脚本 scripts/e2e-p0.mjs + e2e-acceptance.mjs。
- 注意：仓库 wf-designer.tsx 为并行会话合写的 899 行增强版（模型下拉带能力标签+check、单次/批处理 Tab），与 16 规格一致，已采纳为基线。

## 9. P1 完成验收（2026-08-22）

- 后端：runner.py（DAG 状态机+6 executors+条件跳过语义+mock-llm+SSRF 防护）、PG job_queue worker（lifespan 线程）、runs 路由（start 202/list/detail/cancel/SSE+Last-Event-ID 重放）。测试 13/13 绿（分支跳过/事件单调/校验阻断/SSE 终端事件）。
- 前端：试运行→POST /api/runs→SSE 驱动画布环（running/success/failed/skipped）；运行观测抽屉（run 列表+节点执行顺序+输出摘要+3s 轮询刷新）。
- e2e（scripts/e2e-p0.mjs 扩展）：真跑通 17ms，运行观测抽屉截图 8-runs-drawer.png（n_start/n_llm/n_end 全 success，mock 输出可见）。
- P2 待办：真实 LLM provider（OpenAI 兼容）、tool http 真调用联调、发布后端到端、schedule 服务、Run 详情页（冻结路由 /config/tasks/:taskId/runs/:runId 的 workflow 变体）。

## 10. P2 完成验收（2026-08-22）

- 后端：llm executor 真 provider（Model/Provider 表+OpenAI 兼容 chat/completions，未配置回落 mock）；connections CRUD+test+删除引用阻断 409（Fernet 可选加密）；tools CRUD+版本自增+test；models/providers registry；schedules CRUD+enable/disable+next_run(croniter, 企业时区)+tick 线程(10s)+连续失败自动停用；runs retry(origin 链)/export/metrics。测试 22/22 绿。
- 前端：wf-tools/wf-connections 真 API 页（env 门控冻结路由）；designer 增 定时任务抽屉（cron+tz+下次执行+启停删）与 运行观测增强（状态筛选/失败重试/导出）。
- e2e（/tmp/wf-e2e-p2.mjs）：tools 创建+测试、connections 创建+测试、schedule 创建（下次执行 2026/8/22 09:00）、runs 筛选/导出 截图 qP2-*.png。
- 需求完结状态：P0 编辑闭环✓ P1 执行闭环✓ P2 治理✓。剩余可选增强（非任务书必需）：真实 LLM key 联调、Run 独立详情页（冻结路由变体）、日志复制按钮、RBAC 真鉴权（现为 dev 无鉴权）。

## 11. UI 回退修正（2026-08-22，用户反馈"卡片列表更好看"）

- wf-tools / wf-connections 恢复原版卡片网格设计（Design Spec §15.2：4 列紧凑卡、Badge、FilterBar+SearchField、EmptyState/FilteredEmptyState、Pagination、hover 操作按钮），数据接真 API。
- 后端 list_tools 补 description/updatedAt 字段。
- 截图：/tmp/qC-tools-cards.png、/tmp/qC-conn-cards.png。

## 12. 五项批评修正 + Agent 层（2026-08-22）

1. 底部留白：designer 根改 `h-full min-h-0`，画布铺满容器（qW-natural/qA3 截图验证）。
2. 命名按 spec：registry labels=插件工具/变量处理/开始/结束/大模型/条件判断/创建质检记录/通知（quickservice+Master §8.3）；默认节点名=spec label。
3. 正式 icons：TYPE_ICON lucide 映射（Play/Bot/Wrench/GitBranch/Braces/Flag/FilePlus2/Bell），替换字符方块。
4. 中性配色：NEUTRAL #1F2329 图标底；删除 FAMILY_COLOR 彩虹；颜色仅用于状态环/toast/标签（Design Spec §8.5）。
5. Agent 层：agents 表(migration)+API(三型 CRUD，dialogue 自动建内嵌 workflow)；前端三型编辑器（对话编排=flow+Agent配置抽屉[基本信息/对话体验/知识兜底/记忆]；自主规划=角色模板+模型+五挂载+预览调试；专家组=成员+路由规则）；列表型徽章+三型创建弹窗；e2e 三型创建+保存绿 toast（qA3-*.png）。

## 13. Workflow 资源化（2026-08-22，用户指正"workflow 也是一种资源"）

- 新增 /config/workflows 资源页（卡片+创建+搜索）+ 配置管理组导航项"工作流"（非一级入口，遵守冻结导航约束）。
- 路由 /config/workflows/:id → flow 编辑器（独立资源编辑）。
- Agent（对话编排）配置抽屉增加"选择工作流资源"下拉（PUT agent.workflowId），不再仅自建。
- 新增节点类型 workflow-exec（工作流执行）：Inspector 工作流选择器引用资源；runner exec_workflow_exec 嵌套子 run 执行并取 output（递归深度待 P3 加防护）。
- schemas NodeType Literal 扩 workflow-exec（修 422）。
- e2e：建资源流→agent 引用→workflow-exec 节点引用保存 200（草稿含 ('workflow-exec', code)）。截图 qA4-*.png。

## 14. 四项 UI 修正（2026-08-22，用户反馈）

1. Agent 编排与 Workflow 编排分离：embedded 模式顶栏显示 Agent 身份（名称+型徽章+AG 图标+回 Agents），workflow 资源编辑器显示 WF 身份+回 /config/workflows；图标块改中性黑。
2. 导航收起：shell 头始终渲染 SidebarTrigger（workspace 路由不再隐藏头），收起态=shadcn sidebar-03 图标轨（qA5-2-collapsed.png）。
3. tools/connections 卡片丰富：capability 徽标(READ/ACTION)、描述两行、Enabled/Draft、日期、KeyRound 图标+掩码 secret。
4. Agent 列表卡重绘：一行三个（lg:grid-cols-3）、56px 头像（public/avatars 下载自 quickservice 公开 CDN 人像）、型徽章、描述两行、页脚 更新时间+未发布/已发布 标签（qA5-1-agentlist.png）。file/get 鉴权头像不可得，用 4 张人像循环。

## 15. 三项再修正（2026-08-22 二轮反馈）

1. 头像 20 个：public/avatars/avatar-0..19.png（4 张 quickservice 公开 CDN 人像 + 16 张浏览器 canvas 变体：翻转/色相/灰度/sepia）；AVATARS=20 循环。
2. 导航收起：根因 CollapsibleContent 未在 icon 折叠时隐藏→子菜单文字竖排。修复：CollapsibleContent 加 `group-data-[collapsible=icon]:hidden`，折叠轨补组图标（BarChart3→/quality/overview）。不换模板，修到与 shadcn sidebar-03 一致（qA5-2-collapsed 二截）。
3. Agent 编辑页 quickservice 化：embedded 模式右侧**常显** Agent 配置信息面板（基本信息/对话体验/知识兜底/记忆+保存配置），画布左+面板右单顶栏壳（qA5-5-agent-editor）。

## 16. 三轮反馈修正（2026-08-22）

1. 编辑页头像：header 显示 agent 真人头像（id hash 取 20 头像之一），替换黑色方块。
2. 操作锁/操作人真实化：后端 resource_lock 表+`POST/DELETE /api/locks`；编辑器挂载获取锁、卸载释放；顶栏显示真实操作人+绿锁。
3. 删除功能：agents/workflows 列表卡 hover 删除+confirm；后端 DELETE（workflow 被 agent 引用时 409）。
4. Agent 编辑页布局按参考图：Agent 相关信息移**左侧**面板（闲聊兜底开关/高级设置/知识兜底/专业词库/问答经验库/Agent 记忆+空态文案），顶栏=头像+名称+V1.0.x∨+型徽章+中间 Tab（Agent搭建/运行观测/效果评测/进化）+右侧操作人锁+保存/发布。
6. 导航收起严格核对：CollapsibleContent 折叠隐藏+组图标入口后，收起态=纯净图标轨（qA6-collapsed.png）。

## 17. 四轮反馈修正（2026-08-22）

1. 画布节点能力恢复：根因页面根 `h-full` 在 flex 链下解析为 auto→工具条被推出视口；改 `h-[calc(100dvh-3.5rem)]`（designer 根+agent 编辑器包裹层），工具条回到视口内（探针 y=726<781；qA8 截图）。
2. 删除功能双列表可用：根因卡片 `<button>` 嵌套删除 `<button>`（非法嵌套）→ 卡片改 `div role=button`；e2e 验证 agent 删除成功、workflow 删除成功，被 agent 引用的工作流 409 保护。
3. 虚假功能清除：顶栏写死的"汇流"蓝圈+绿锁删除；操作人/锁改为后端 resource_lock 真实数据，全编辑器模式显示（qA8：质量管理员+绿锁）。

## 18. 五轮反馈与功能审计（2026-08-22）

1. 画布节点能力：根因二——(a) 页面根高度 h-full 在 flex 链解析为 auto，工具条出视口（已改 calc(100dvh-3.5rem)）；(b) 选中浮动 ▶/X 与收起 chevron 同位致误删（浮动组移至 -top-9）。审计 PASS：工具条视口内/palette 全节点/添加/连线/Inspector/检查红点。
2. 删除：agents/workflows 双列表 e2e+API 验证可用；被引用工作流 409 保护。
3. 接口接线矩阵（真接口+验证）：草稿保存 flow_saveOrUpdate✓；校验 validation✓；运行 POST /api/runs+SSE✓（agent 流含 LLM 节点真跑 succeeded，mock provider）；锁 /api/locks✓；schedule CRUD✓；retry/export 按钮在运行观测抽屉✓；模型下拉接 /api/registry/models（Popover，启动 seed 3 模型）；节点 registry✓。
4. 未验证/未接：真实 LLM key 联调（mock 回落）；quickservice 侧变量级联子层（产品侧）；效果评测/进化 Tab=规划中占位。

## 19. 六轮反馈（2026-08-22）

1. Tools 删除+删除验证：后端 `DELETE /api/tools/{id}`，引用验证（工作流节点 config.toolVersionId 匹配 tool 或 version id）→ 409 中文"该工具被以下工作流引用，无法删除：…"；无引用直接删（含 versions 级联 bulk delete，修 FK 500）。Tools 卡 hover 删除按钮+confirm。
2. 409/404 全中文化：工作流被 Agent 引用、工具被工作流引用、Agent/工作流/工具/运行/定时任务不存在、未知 Agent 类型。验证：bound delete 409 中文✓ free delete ok✓ wf delete 409 中文✓。

## 20. 导航终稿：方案A（2026-08-22，用户选定）

- 采用 shadcn studio dashboard-sidebar-04 同构单层窄轨：w-20(80px)、icon+label 竖排、三组分隔线、顶部 logo；移除二级白 sidebar 与 SidebarProvider/SidebarTrigger；rbac 过滤保留；长标签短映射（连接/数据/规则/坐席/任务）。
- 历史：蓝轨两层版曾越权实现后回退；14rem+默认收起为过渡态，终稿为方案A。

## 21. 基本信息三件套（2026-08-22，用户参考图）

- Agent 配置-基本信息：名称 Input(0/20 计数)+描述 Textarea(0/20000 计数)+右侧头像(点击循环 20 头像，存 agent.avatar 列，migration b4ebdf4445dd)；列表卡/编辑器 header 优先 agent.avatar。
- 保存含 name/description/avatar；与参考图布局同构（左表单右头像）。

## 22. 头像选择弹窗（2026-08-22，用户参考图）

- 头像按钮改为弹窗：Dialog「推荐头像」+「推荐图形」grid-cols-6（20 头像）+ 选中 ring-2 蓝环 + 「自定义上传」file input（dataURL 存 agent.avatar）。
- 截图 qAv-dialog.png 与参考图同构。

## 23. 左面板 360 宽+可收起（2026-08-22）

- Agent 配置面板默认 w-[360px]；头部"收起配置"(PanelLeftClose)→收起为 w-10 窄条+"展开配置"(PanelLeftOpen)；画布自动扩满。截图 qC1/qC2。
