# Reviewer Report · lightweight-workflow-system（只读审查）

> 审查人：独立 Reviewer（只读，未修改任何被审文件）。
> 审查范围：README、01–13、contracts/（openapi.yaml、workflow-definition.schema.json、run-event.schema.json）、evidence/（evidence-ledger.md、network/capture-attempt-log.md、sim-part-a/b、screenshots 清单）。
> 日期：2026-08-21。

## 通过项

1. **证据性（总体）**：三链标记纪律总体严格。02 全文 method/path 标 Inferred、body/事件标 Unverified，文档头明示；12 每行带 Designed 标记；03/Part A/Part B 逐文件引用且区分 Observed-Source 与 Inferred（Part A §1 subblock store 动机、Part B §Queue 重试"Observed-Source + Inferred"均如实拆分）；ledger §2/§6 逐截图标记，自动化不可达处（04/05、07/08、13/14）如实标 Unverified 而非臆断。
2. **冲突处理**：04 冲突记录 3 条（节点视觉/条件表达/Run 存储）均给出裁决+理由；ledger §4 两条（单节点▶无反馈、变量行−删除）选择"不裁决、标 Unverified"并说明设计侧对策。抽查未发现静默选择：变量语法、节点添加面板、Run 存储偏离 Sim 等差异均在 04 表中有决定列。
3. **过度设计（核心项通过）**：Redis 明确不进 V1（README §10、05 §2、09 §4 取消走 DB 标志）；无对象存储（大值截断，10 §4）；选 SSE 弃 WebSocket 有论证（05 §5）；独立 worker 非默认（05 §2 默认同进程，Queue 适配层只留扩展缝）；V1 节点 8 种、error 边/循环/并行/子 workflow/human-interrupt 均在 ⛔ 列。
4. **禁用项（总体）**：LangGraph 仅以"不引入"出现（README §9、05、09）；无 Sim TS Runtime 直译（明确 Python 重写，仅环检测等纯函数逻辑级复用且有 Sim 证据支撑）；无平台化倾向（08 §1 明示"不做 DB 驱动动态节点"；Trigger Registry/MCP 运行时/插件市场均 Omit）。（唯一疑点见问题清单 P1-2）
5. **完整性**：Schedule=09 §5+11 schedule 表+openapi /schedules+13 P4；Queue=09 §1；Worker=09 §1/§2+05 §2；Logs=10 全文+11 run_event/node_run/call_record；Events=10 §2+run-event.schema.json；取消=09 §4+openapi cancel；重试=09 §4（节点级）+队列层不重试声明；幂等=09 §6；时区=09 §5 croniter/zoneinfo+11 schedule.timezone；版本冻结=07 §7+11 workflow_version 不可变；Sink 幂等=09 §6+11 §4（键 run_id+node_id）。全部有落点。
6. **闭环**：创建(POST /workflows)→编辑(PUT draft)→校验(GET /validation、POST /runs 409 门禁)→测试(mode=test 跑 draft)→节点日志(node_run+run_event+SSE)→发布(POST /publish 快照)→触发(manual/api/schedule)→Run→执行(09 §2)→事件(17 型 SSE+重放)→Result(create-record→quality_result/evidence，05 §3、11 §3/§4、13 P5)。主链无断点（仅一处入口小缺口，见 P2-5）。
7. **契约一致性（核心枚举通过）**：事件 type 列表 10 §2 与 run-event.schema.json 逐一相等（各 17 种，已数核）；workflow.status 四态在 07/11/schema 一致；节点 type 8 种在 07/08/11/13/schema 一致；InputBinding 五来源（fixed/upstream/input/state/system）07 与 schema oneOf 一致；draft revision 乐观锁 11（draft_revision+baseRevision 409）与 openapi SaveDraftRequest、schema draftRevision 一致。
8. **可实施性**：13 P0–P5 有内容与出口标准；第一刀明确（P0+P1 Validator+草稿契约，且说明其作为四个消费方唯一事实源的理由）；未决问题 5 条列出（13 §5，README 同步）。
9. **诚实性**：evidence/network/capture-attempt-log.md 如实记录能力盘点与 3 次 evaluate 被拒；"Observed-Network = 0 条"在 ledger §3 与 02 一致声明；全文检索确认无任何伪造 Observed-Network 条目；补救选项与"采用选项 3 推进"的决策透明。

## 问题清单

### P0

无。未发现伪造证据、未发现禁用项实质违反、未发现阻断闭环的断点。

### P1

**P1-1 · Sim 相关残留表述与已取得的 Observed-Source 冲突（证据回填缺失）**
- 文件/位置：① 11-data-model.md §5（"Sim 若以 Convex 文档模型存储（待证）"）；② 05-target-system-architecture.md §6（"若其 Queue/Worker 依赖 Convex/云（待 03 证实）"）；③ 02 §4（"其订阅机制若为 Convex subscription/SSE"）；④ 07 §6 标题"（待 03 回填）"及"若 Sim 用 handles 表达分支"。
- 问题：03 §1 与 Part B 已以 Observed-Source 证实 Sim 持久层=PostgreSQL（Drizzle）、不使用 Convex/Inngest/Temporal/BullMQ、订阅=SSE+eventId 重放、分支=connection.sourceHandle。上述四处仍以"待证/若"悬挂，其中 11 §5 直接把已被证伪的假设写进数据模型文档的取舍依据，属证据链未闭环（违反"冲突/结论应回填裁决"的纪律）。
- 建议修复：11 §5 改写为"Sim 为 PG 关系表+jsonb 混合（Observed-Source，03 §1），我们取其版本快照+触发绑版本两点、弃其 executionData 单行折叠（见 04 冲突 #3）"；05 §6、02 §4、07 §6 同步删除"待证/若"表述并引用 03/Part A/B 结论。

**P1-2 · tool.kind 出现未定义的 "python"，与"任意 Python 源码存储"红线相邻**
- 文件/位置：11-data-model.md §1 tool 表（`kind(http|python|builtin)`）。
- 问题："python" 仅在此处出现；08 §3 只定义 http 与 builtin（builtin=代码注册实现类，executor_key 指向），13 §3 亦写 "http/builtin executor"。若 "python" 意指把用户 Python 源码存入 spec JSONB，则直接触犯 README §15"绝对不做：任意 Python 存储"；若只是 builtin 的别名，则属未定义术语混入 P0 建表依据。
- 建议修复：删除 "python"（收敛为 http|builtin），或在 11/08 明确 "python kind = 代码注册的 builtin 实现引用（executor_key），DB 只存 spec 声明不存源码"，并在 13 §4 红线表述中点名该边界。

**P1-3 · schedule 的版本绑定三处不一致**
- 文件/位置：04 表"触发绑定版本"行（"采用（schedule.version_id / task.version_policy）"）、08 §6（"schedule 行绑定 workflow_version_id"）vs 11 §1 schedule 表字段列表（无 workflow_id/workflow_version_id，仅 task_id，且"Kernel 保留 workflow_id 直挂能力"无对应列）。
- 问题：V1 实际链路（05 §4：scheduler 解析 task.version_policy→version_id）只需要 task.version_policy，11 表结构与之自洽；但 04/08 声称的 schedule.version_id 不存在于数据模型，实施者无法判断以谁为准。
- 建议修复：二选一——① 11 schedule 表补 `workflow_id null / workflow_version_id null`（Kernel 直挂能力落列）；② 04/08 改为"V1 经 task.version_policy 间接绑版本，schedule 直挂版本为 Future"。

**P1-4 · DSL triggers 字段：07 与正式 schema 字段名不符**
- 文件/位置：07 §2（`"triggers": { "manual": true, "api": true, "schedules": [ ScheduleRef ] }`）vs contracts/workflow-definition.schema.json（`triggers.scheduleIds: string[]`）。
- 问题：字段名（schedules vs scheduleIds）与类型（ScheduleRef 对象数组 vs 字符串数组）双不一致；schema 是契约事实源，07 是设计说明，实施（P0 Validator、P1 前端）会两者对照，易生分歧。
- 建议修复：07 §2 改为与 schema 一致的 `scheduleIds: string[]`（ScheduleRef 若无额外字段则删除该概念）。

### P2

**P2-1 · openapi 与数据模型/设计的零散不齐**
- 文件/位置：① openapi `/runs/{id}/retry` 声称 "originRunId 关联"，但 11 run 表无 origin_run_id 字段，09/10 亦无 Run 级重试设计；② openapi ValidationReport.issues.kind 含 `schema`，07 §5 规则表只产出 graph/unconnected/unconfigured/dependency；且 issues 强制 `nodeId`，工作流级问题（如"恰一个 input 节点"）无落点；③ openapi Workflow.status 为裸 string，未收敛到 draft|testing|published|deprecated 枚举。
- 建议修复：① run 表加 `origin_run_id null` 或 V1 契约删 /retry 端点；② kind 枚举与 07 §5 对齐（删 schema 或补规则），issues 增加 workflow 级落点（nodeId 可空+level 字段）；③ status 补 enum。

**P2-2 · job_queue 表未纳入 11 数据模型**
- 文件/位置：09 §1 定义 job_queue（含 SQL），但 11 全表清单无此表；13 P0 出口写"Alembic 全量表（11）"。
- 问题：按 13 P0 字面执行会漏建队列表，到 P2 才发现。
- 建议修复：11 §2 增补 job_queue（引用 09 §1 定义），或 13 P0 改为"全量表（11）+ job_queue（09 §1）"。

**P2-3 · 02 §1 表标题"可观察契约面（Observed-UI 级）"混入未逐条标记的推断**
- 文件/位置：02 §1 表第三列，如"发布接口前置条件读取'最近一次成功 Run'状态 → Run 与 Publish 共享状态存储"、"返回问题数组：{nodeId, kind: unconnected|unconfigured}"。
- 问题：文档头虽总括"method/path 均 Inferred"，但"共享状态存储"等属架构级推断，置于 Observed-UI 标题表内易被误读为目标产品客观事实。
- 建议修复：第三列逐条加 (Inferred) 标记，或把列名改为"推断契约约束（Inferred）"。

**P2-4 · evidence-ledger 两处陈旧/遗漏**
- 文件/位置：① ledger §6 未验证清单仍写"Sim 云端依赖细节（待 Agent B）"，而 Part B 已交付（其五类归属已回答该项）；② ledger §2 截图表未覆盖 `18-back-to-list.png`（screenshots/ 实际 24 张，含两张 18 号，表内仅 18-workflow-list）。
- 建议修复：① 从 §6 移除或标"已由 Part B 覆盖"；② 补 18-back-to-list 行或说明其为重复编号的同一事实。

**P2-5 · 无 Task 的 Run（test/manual）缺 Run Detail 入口**
- 文件/位置：06 §1、10 §3（Run Detail 路由冻结 `/config/tasks/:taskId/runs/:runId`）vs 11 run.task_id 可空。
- 问题：测试运行/无 Task 手动运行无 task 上下文，该路由不可达；测试态日志虽可走 Designer Test Panel，但正式 manual Run 的节点日志入口未定义，属闭环末端小断点。
- 建议修复：06 §1 补无 task 场景路由（如 `/config/runs/:runId` 或 Designer 内 Run Sheet），或声明 V1 仅经 Run 列表（GET /runs）跳转并给出前端落点。

**P2-6 · 其他小项**
- ① 12 §1"Schedule 创建强制最大并发 1"无实现落点：11 schedule 表无并发字段、09 §5 无重叠触发抑制设计（建议：09 §5 声明"tick 时若存在同 schedule 的活跃 run 则跳过本次"并落 ledger）；
- ② notification 节点（13 §3，"V1 仅日志级通知"）未说明解决什么问题即进 V1 八节点，建议补一句理由或移 Future；
- ③ CreateRunRequest.mode(test|manual|api) 与 run.trigger(test|manual|api|schedule) 的映射未在任何文档显式说明（建议 11 run 表或 openapi 注释一句"mode 即 trigger，schedule 仅内部产生"）；
- ④ capture-attempt-log.md 时间记作"16:2x"不精确（建议补实际分钟，与 ledger §1 的 15:30–16:00 UI 时段衔接）。

## 总体结论

**可进入实施（有条件）**。证据纪律、冲突裁决、V1 克制度、诚实性四项核心质量均达标；无 P0。P1 共 4 条，全部是"文档间契约/数据模型一致性 + 证据回填"问题，不涉及架构返工，预计半日内可在文档层修复：其中 P1-2（tool.kind "python"）因与硬性红线相邻，须在 P0 建表前澄清；P1-3/P1-4 须在 P0 Validator/契约测试编码前对齐（以 contracts/ 下 schema 为事实源回改 07/04/08/11）。第一刀（Validator+草稿契约）不受上述问题实质影响，修复 P1 后即可按 13 P0 启动。P2 可与对应阶段并行修订。
