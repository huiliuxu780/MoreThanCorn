# Phase A｜正确性修复与门面清退

状态：**已冻结**（2026-08-25 用户裁决：五处假功能删除；无版本定时任务报错拦住；进化更名版本指标；旧 mock 画布删除）
预估：1 周
原则：**不引入新数据模型、不动架构**。只修错误实现、处置门面功能、清退 agent 轨道的 mock 残留。
验收主题：页面上能做的，运行时都真实生效；已发布的版本真正被运行。

---

## 1. 范围

### 做
- 修复 2026-08-24 审计确认的 12 处错误实现（见 §3 各项）。
- 处置 8 处门面功能（删除或换真组件，见 A-10～A-13）。
- 清退 agent 搭建轨道的遗留 mock 路径（A-14）。

### 不做
- 不新增数据表、不加 Agent 版本模型（属于 B）。
- 不做流式输出、不做 Trace（属于 B/C）。
- 不动质检业务页面（quality/tasks/result-rules）及其 mock 依赖。
- 不改调研口径之外的节点集合（不新增节点类型）。

---

## 2. 交付物清单（17 项）

| 编号 | 事项 | 层 | 关键文件 |
| --- | --- | --- | --- |
| A-01 | 运行认版本（工作流层） | 后端 | `server/app/runner.py`、`routers/runs.py`、`routers/admin.py`（调度） |
| A-02 | agent-select 真实路由 + 删除路由规则死配置 | 后端+前端 | `server/app/agent_runtime.py`、`src/pages/wf-agent-editor.tsx` |
| A-03 | agent 运行异步化（job_queue） | 后端 | `server/app/agent_runtime.py`、`routers/agents.py`、`runner.py` worker |
| A-04 | VarCascader：可达性过滤 + 注册表 io + 按 id 定位 | 前端 | `src/pages/wf-designer.tsx` |
| A-05 | 注册表类型修正（query-rewrite/decision-class/notification） | 后端 | `server/app/registry.py`、`runner.py` |
| A-06 | condition 运算符补齐 | 后端+前端 | `registry.py`、`runner.py exec_condition`、`wf-designer.tsx` |
| A-07 | CallRecord 关联 node_run | 后端 | `agent_runtime.py _Ctx.call`、`runner.py` |
| A-08 | Agent config 乐观锁 | 后端+前端 | `models.py`、migration 015、`routers/agents.py`、两个编辑器页 |
| A-09 | autonomous 挂载解析留痕（工具版本解析记录） | 后端 | `agent_runtime.py _build_tools/_dispatch` |
| A-10 | 门面删除：高级设置死行、闲聊兜底死开关、词库/经验库/记忆自由文本 | 前端 | `wf-designer.tsx`（AgentConfigDrawer）、`wf-agent-editor.tsx` |
| A-11 | 真选择器替换：成员/挂载/知识兜底 | 前端 | `wf-agent-editor.tsx`、`wf-designer.tsx` |
| A-12 | "进化"面板更名"版本指标" | 前端 | `wf-designer.tsx` |
| A-13 | Agent 模式 Header 补版本/发布状态 | 前端 | `wf-designer.tsx` |
| A-14 | agent 轨道 mock 清退 | 前端 | `app.tsx`、`agents.tsx`、`agent-designer.tsx`、`components/agents/*` |
| A-15 | 硬编码 MODELS 回退列表清除 | 前端 | `wf-designer.tsx` |
| A-16 | 前端 API 客户端收编（D-3） | 前端 | `wf-api.ts`、`wf-agent-editor.tsx`、`wf-designer.tsx` |
| A-17 | 名称长度约束一致化（调研 12 §3.1） | 后端+前端 | `models.py`、migration 015、创建/保存路由 |

---

## 3. 逐项规格

### A-01 运行认版本（工作流层）

**问题**：`create_run`/`execute_run` 恒读 `wf.draft_definition`；发布产生的 `WorkflowVersion` 从不被执行；`Schedule.pinned_version_id` 无人消费。违背调研 00 §4.1/§11.3。

**行为定义**：
1. `Run` 增加可空列 `workflow_version_id` + `definition_source`（`draft`|`version`）。migration 015（与 A-08 合并为一张）。
2. `create_run(db, workflow_id, trigger, run_input, version_id=None, ...)`：
   - `version_id` 给定 → 校验存在且属于该工作流，执行 `WorkflowVersion.definition`，`definition_source=version`。
   - 未给定且 `trigger in (schedule,)` → 解析顺序：`Schedule.pinned_version_id` → 工作流 `current_version_id`（已发布版）→ 两者皆无则**失败**，错误码 `NO_PUBLISHED_VERSION`（定时任务不允许跑未发布草稿）。
   - 未给定且 `trigger in (manual, test, agent)` → 执行草稿，`definition_source=draft`。
3. `execute_run` 不再自行读库取定义；由 `create_run` 解析后的定义随 Run 传递（实现可将定义写入 `run.input` 旁的暂存或执行时按 `workflow_version_id` 重读——选择后者：执行器按 Run 记录的 source/version 重读，避免行膨胀）。
4. 调度器（`admin.py` 定时触发处）传入 schedule 上下文，走上述 schedule 分支；`window_params` 逻辑不变。

**测试**：
- 发布 V1 → 修改草稿 → 以 `version_id=V1` 运行：行为与 V1 一致（断言节点数/输出）。
- 同上场景下触发 schedule（pinned 为空、有 current_version）→ 执行 V1 而非草稿。
- 无发布版本时 schedule 触发 → 失败且错误码 `NO_PUBLISHED_VERSION`。
- manual 触发仍走草稿（回归）。

**验收**：
- [ ] 发布后改草稿，定时运行仍复现已发布版本行为。
- [ ] 手动试运行仍跑草稿（体验不变）。
- [ ] Run 详情可见本次执行的是草稿还是哪个版本。

### A-02 agent-select 真实路由 + 删除路由规则死配置

**问题**：`exec_agent_select` 恒取 `primaryAgents[0]`，"主要/兜底"语义失效；`ExpertGroupEditor` 的路由规则表单运行时零消费（调研 11 §4.3：Agent选择是语义路由器）。

**行为定义**：
1. `exec_agent_select`：
   - 组装候选：`primaryAgents`（Agent id 列表）→ 查库取 name/description。
   - 解析输入 `query`（沿用 `resolve_bindings`，无绑定时取 `run_input.userQuery`）。
   - 调用 `_chat_completion`（复用现成 LLM 通道；mock 模式下保持"取第一个"并记录 `routing=mock`）：system 提示词要求仅输出被选中的候选序号或 `NONE`。
   - 命中 → 返回该 Agent 的 `agentCode/agentName/agentDesc`；`NONE` 或解析失败 → 有 `fallbackAgent` 则用之（事件中标记 `routing=fallback`），否则 `RunError("未命中任何主要 Agent 且无兜底")`。
   - 事件：`emit(..., "agent_select", payload={"query":..., "chosen":..., "routing":"primary|fallback|mock"})`，供后续 Trace 观测。
2. 前端 `ExpertGroupEditor`：删除"路由规则（成员→条件）"整块（输入行 + 添加器）；保留成员列表与试运行；页面说明文案改为"路由在画布的 Agent选择 节点中配置"。`cfg.routing` 存量数据不迁移、不读取、不清理（无害残留，B 阶段随聚合根重构统一处理）。

**测试**：
- mock LLM：无命中路径走兜底；无兜底报错。
- 真 LLM（标记 `@pytest.mark.skipif` 无环境变量时跳过）：两类问题分别路由到主要/兜底（复用现有 `test_agent_runtime.py` 的夹具风格）。

**验收**：
- [ ] 两条不同问题在同一图上分别命中主要 Agent 与兜底 Agent（运行事件里可见 `routing` 标记）。
- [ ] 专家组编辑页不再有"路由规则"表单。

### A-03 agent 运行异步化

**问题**：`POST /api/agents/{aid}/run` 同步执行 `_autonomous_loop`，HTTP 最长阻塞 60s。

**行为定义**：
1. `run_agent` 拆为两段：`create_agent_run`（建 Run + 写 `agent_started` + 入队 `JobQueue(type="agent-execution", payload={"run_id"})`，立即返回 run_id）与 `execute_agent_job(run_id)`（现有 `run_agent` 主体）。
2. worker 分发处增加 `agent-execution` 分支 → `execute_agent_job`。
3. dialogue/expert-group 的嵌套调用（`_run_member`、workflow 子调用）**保持同步递归**（父运行已在 worker 内，嵌套入队会破坏顺序）；仅顶层入口异步入队。
4. `POST /api/agents/{aid}/run` 返回 `202 {runId}`（现为 200 同步返回最终态的调用方：前端 `runAgentOnce` 已是"先 POST 再 GET 详情"，改为轮询 GET 直至终态，间隔 500ms、上限 90s）。
5. `GET /api/agents/{aid}/runs/{run_id}` 已含 events，无需改。

**测试**：
- POST 后 100ms 内返回且 Run 状态为 queued/running；等待终态后事件完整。
- 并发两个运行不互相阻塞（worker 逐个消费即可，不断言并行度）。

**验收**：
- [ ] 预览发送长问题，HTTP 不再挂起；页面出现"运行中"态后拿到结果。

### A-04 VarCascader 可达性 + 注册表 io + 按 id 定位

**问题**：`wf-designer.tsx` 的 VarCascader 列出所有节点（无祖先过滤）、按节点名查找、候选输出硬编码。违背调研 11 §5.2。

**行为定义**：
1. 前端实现祖先可达计算（对当前图 edges 反向遍历，逻辑与后端 `_ancestors` 一致）。
2. 分组列表 = 「系统内置」（保留 开始）+ 可达祖先节点（按 id 定位，展示用名）。
3. 每个节点的候选输出来自节点注册表 `io.outputs`（解析 `"name:type"`）；动态项（`tool` 的 `from-tool-version`、`transform` 的 `declared`）暂按节点 config 中已声明的输出键展示，无则提示"该节点输出由配置决定"。
4. `开始` 组输出以注册表 `input` 定义为准（含 `reference`）。
5. 插入格式暂维持 `{{nodeId.outputs.path}}`（结构化绑定的完整迁移属于 C 阶段）；但**按 id 生成**，杜绝按名。
6. 同文件内所有调用点（prompt 输入、固定输入、条件左值）统一走改造后的级联。

**测试**：e2e（CDP 脚本或手动步骤登记）：构造 `Start→LLM→Transform` 与孤立节点 X，断言 Transform 的级联不出现 X。pytest 覆盖后端祖先算法已有（R3），无需重复。

**验收**：
- [ ] 下游节点可见直接父节点与传递祖先的输出；不可达节点不可见。
- [ ] 节点改名后已插入引用不断裂。
- [ ] LLM 节点候选含 output/thought/answer（来自注册表而非硬编码）。

### A-05 注册表类型修正

1. `query-rewrite`：`io.outputs` 改 `["queryList:array"]`。
2. `decision-class`：`io.outputs` 改 `["classificationTitle:string","classificationId:string"]`；schema 的 `branches` 明确为分类项数组（`{title, description}`），分支 handle 语义与 condition 对齐（执行本体仍为 C 阶段 LLM 化，本阶段仅修契约与展示）。
3. `notification`：从 `exec_end` 别名改为独立 `exec_notification`：记录事件 `notification_sent`（payload 取 config.message，渲染 `{{}}` 引用），返回 `{}`，**不终止流程**。
4. `TERMINAL_TYPES` 保持 `{"end","create-record"}` 不变。

**测试**：runner 事件序列测试补一条含 notification 的中途链（其后仍有节点执行）。

**验收**：
- [ ] 流程中部放置通知节点，运行继续到 End。
- [ ] 前端级联中 Query改写 输出显示为 queryList(Array)。

### A-06 condition 运算符补齐

1. 注册表 `condition.branches[].operator` 枚举补：`not_contains`、`empty`、`not_empty`（现有 eq/neq/contains/gt/lt 保留）。
2. `exec_condition` 实现三者语义；`empty` 判定：None/""/空数组/空对象。
3. 前端条件配置下拉同步补齐（中文标签：不包含/为空/不为空）。

**测试**：三种运算符的判定用例（含边界：空串、None、空数组）。

**验收**：
- [ ] 调研 11 §3.14 的 String 六项关系全部可用（包含/不包含/等于/不等于/为空/不为空）。

### A-07 CallRecord 关联 node_run

**问题**：`_Ctx.call()` 写 `node_run_id=None`，观测链断裂。

**行为定义**：`_Ctx` 构造时接收当前 `node_run_id`（autonomous 顶层运行无节点上下文时为 Run 级的虚拟上下文，可空但保留字段）；`runner.py` 中构造 `_Ctx`/调用 `call()` 的各处传入真实 `node_run.id`。

**测试**：工具节点运行后 `CallRecord.node_run_id` 非空且等于该节点 NodeRun。

**验收**：
- [ ] 运行导出/详情中调用记录可关联到节点。

### A-08 Agent config 乐观锁

1. `Agent` 增列 `config_revision`（int，默认 1）。migration 015。
2. `PUT /api/agents/{aid}` 接受 `expectedRevision`；与库中不等 → `409 {code:"REVISION_CONFLICT"}`；相等 → 更新并 +1，响应返回新 `configRevision`。不带 `expectedRevision` 的旧调用按当前值放行（兼容过渡，前端升级后不再发生）。
3. 前端 `wf-agent-editor.tsx`（两处保存）与 `AgentConfigDrawer.save` 携带并更新 revision；409 时提示"配置已被更新，请刷新"并重新拉取。

**测试**：并发两次 PUT（同 revision）一次成功一次 409。

**验收**：
- [ ] 两个浏览器标签同时编辑同一 Agent，后保存者收到冲突提示而非静默覆盖。

### A-09 autonomous 挂载解析留痕

**问题**：挂载按名查资源、取 latest ToolVersion，运行后无从得知实际用了哪个版本（调研 §8.1 冻结要求的过渡态）。

**行为定义**：
1. `_build_tools` 解析时记录 `resolved = {"tools": [{name, toolId, toolVersionId}], "workflows": [...], "knowledges": [...]}`。
2. 运行启动时 `emit(..., "agent_mounts_resolved", payload=resolved)`；名字查不到的挂载在 payload 中标 `missing`（与现有 mounts-health 口径一致）。
3. 挂载存储仍用名字（改为 id 存储属于 B 的 AgentVersion 依赖快照，一并迁移，避免双改）。

**验收**：
- [ ] 任一 autonomous 运行的事件流开头可见挂载解析清单。

### A-10 门面删除

| 位置 | 处置 |
| --- | --- |
| AgentConfigDrawer "高级设置"死行（无 onClick） | **删除整行** |
| AgentConfigDrawer "闲聊兜底"死开关 | **删除整行**（B 阶段随 CommonAgentConfig 真实现回归） |
| AgentConfigDrawer 专业词库 / 问答经验库 | **删除区块**（无实体支撑；D 阶段随实体回归） |
| AgentConfigDrawer Agent 记忆自由文本 | **删除区块**（B 阶段以结构化表单回归；页面保留一行说明文案） |
| ExpertGroupEditor 路由规则 | 见 A-02 |

原则：宁可没有，不可假有。每个删除点在验收清单中单独打勾。

### A-11 真选择器替换

1. **专家组成员**：`AddInline` 换为 Agent 多选器（数据源 `GET /api/agents`，排除自身与草稿态不可用项；复用下拉/Popover 组件风格）。`cfg.members` 存 Agent id 数组（现存的名字字符串在读取时做一次尽力匹配，匹配不到标记失效）。
2. **autonomous 挂载**：插件/工作流/知识三项改用 `ResourceSelect`（types 分别为 `tools`、workflows 用 `WorkflowPicker` 同款数据、`knowledge-sources`）；`cfg.tools/workflows/knowledges` 过渡期同时接受名字（后端 `_build_tools` 兼容名字与 id 两种键，B 阶段收口为 id）。技能（skills）保留文本输入，但标签改为"技能说明（注入提示词的文本）"，明确其不是资源绑定。
3. **AgentConfigDrawer 知识兜底**：同 `ResourceSelect(knowledge-sources)`。

**验收**：
- [ ] 所有资源添加入口都来自真实注册表，无法输入不存在的资源。
- [ ] 失效资源仍由 mounts-health 标红（能力不回退）。

### A-12 "进化"更名"版本指标"

`EvoPanel` 标题与 Tab 标签改为"版本指标"（内容不变）。真进化能力在 D 阶段落地时再恢复"进化"之名。

**验收**：
- [ ] Tab 与面板标题一致为"版本指标"；不再出现名实不符的"进化"。

### A-13 Agent 模式 Header 补状态

`DesignerInner` 头部在 `agentMeta` 模式下补充：当前工作流发布状态徽标（已发布/待发布）+ 最新已发布版本号（来自 `GET /versions` 或列表接口现有字段）。纯工作流模式不变。

**验收**：
- [ ] 从 Agent 进入画布，Header 可见发布状态与最新版本号。

### A-14 agent 轨道 mock 清退

1. 删除：`src/pages/agents.tsx`、`src/pages/agent-designer.tsx`、`src/components/agents/`（flow-node/node-inspector/test-run-panel/variable-picker 四件）。
2. `app.tsx`：`/config/agents` 固定指向 `wf-agents-list`；移除 `VITE_WF_API` 对 agent 路由的分支。`/settings/connections` 固定指向 `wf-connections`。
3. **保留** `mock-service.ts` 与 `mocks/`（质检 tasks/result-rules/agent-analysis 等页面仍依赖；整体清退属于 D）。`run-detail.tsx` 的 mock 导入保持现状（其真实态走 `realRunDetail` 适配器，D 阶段统一清理）。
4. `wf-agent-editor.tsx` 中 404 回落 `WfDesignerPage(workflowId=agentId)` 的 legacy 分支评估：若仅服务于旧数据，保留但在状态日志登记。

**验收**：
- [ ] `grep -r "agent-designer\|components/agents" src/` 无残留引用。
- [ ] 构建通过；三型 Agent 的创建/编辑/运行全流程走真实 API。

### A-15 硬编码回退清除

`wf-designer.tsx` 内硬编码 `MODELS` 回退列表删除；模型下拉仅来自 `GET /api/registry/models`（接口失败时显示空态与错误提示，不用假数据顶替）。

**验收**：
- [ ] 后端模型接口不可用时页面显示错误态而非假模型列表。

### A-16 前端 API 客户端收编（决策 D-3）

**问题**：`wf-agent-editor.tsx`、`wf-designer.tsx` 的 AgentConfigDrawer/EvalPanel/EvoPanel 等多处使用裸 `fetch` + 私有 `api()` 包装，绕过 `wf-api.ts` 服务层（复用性反思结论）。

**行为定义**：
1. `wf-api.ts` 新增 `agentApi`（get/update/run/runs/mounts-health/versions 相关）。
2. 上述页面全部改经 `agentApi`/`wfApi`/`resApi`；删除页面内私有 `api()`/`WF_BASE2` 包装。
3. 统一错误处理：非 2xx 抛出带状态与正文摘要的错误；409 单独可识别。

**验收**：
- [ ] `grep -n "fetch(" src/pages/wf-agent-editor.tsx src/pages/wf-designer.tsx` 仅剩服务层调用（或为零）。

### A-17 名称长度约束一致化（调研 12 §3.1）

**问题**：前端限制名称 ≤20，`Agent.name` 数据库为 `String(64)`、后端无校验——正在复现调研专门警告过的"创建规则/编辑校验/存储约束漂移"缺陷。

**行为定义**：
1. 统一上限 **20**（与产品规格和现有 UI 一致）。
2. migration 015：`agent.name` 加 check 约束 `char_length(name) <= 20`（如存量超长数据存在，先在状态日志登记并逐条处理，不得静默截断）。
3. `POST /api/agents`、`PUT /api/agents/{aid}` 服务端校验，超限 400 `NAME_TOO_LONG`。
4. `workflow.name` 同步检查是否存在同类漂移，若有则一并加约束（上限取现前端约束值，核验后写入状态日志）。

**验收**：
- [ ] 绕过前端直接 PUT 21 字名称，返回 400 而非落库。

---

## 4. 测试计划汇总

- 新增 pytest（目标 ≥14 条）：A-01×4、A-02×2、A-03×2、A-06×1（多断言）、A-07×1、A-08×1、A-05×1、A-17×2。
- 现有 43 条必须全绿（允许因接口语义变化的最小改写，逐条在状态日志说明）。
- e2e：`scripts/verify-fullstack.mjs` 增补"发布后改草稿再定时运行"场景。
- 前端无测试框架：A-04/A-11/A-13/A-14 以手动验收步骤登记（写入状态日志）。

## 5. 验收清单（用户逐项验收用）

1. [ ] 发布版本被真实执行（A-01 三场景）
2. [ ] Agent选择真路由，主要/兜底可区分（A-02）
3. [ ] 专家组编辑页无路由规则表单（A-02）
4. [ ] 预览不再阻塞挂起（A-03）
5. [ ] 变量级联只见可达祖先（A-04）
6. [ ] 节点改名引用不断（A-04）
7. [ ] 通知节点不再终止流程（A-05）
8. [ ] String 六项条件运算符齐全（A-06）
9. [ ] 调用记录关联节点（A-07）
10. [ ] 并发编辑冲突可见（A-08）
11. [ ] 运行事件含挂载解析清单（A-09）
12. [ ] 五处门面全部移除，无"看似可用实际无效"的控件（A-10）
13. [ ] 资源添加全部来自真实选择器（A-11）
14. [ ] "版本指标"名实相符（A-12）
15. [ ] Agent 模式 Header 有版本/状态（A-13）
16. [ ] agent 轨道 mock 清退、构建通过（A-14）
17. [ ] 无假模型回退（A-15）
18. [ ] 页面不再有裸 fetch，统一走服务层（A-16）
19. [ ] 超长名称被服务端拒绝，前后端与数据库约束一致（A-17）

## 6. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| A-01 改变调度语义，历史无版本的工作流定时任务开始失败 | 错误消息明确指引"请先发布或指定草稿模式"；迁移说明写入状态日志 |
| A-03 异步化影响现有测试的同步断言 | 测试统一改为"等待终态"助手函数 |
| A-03 单 worker 队列阻塞：专家组成员嵌套调用在 worker 内同步递归，一次长跑会阻塞后续任务 | 本阶段接受该限制并在运行事件留痕；worker 池化列入 C 阶段候选项（00-index §5.5 偏差登记） |
| A-11 members 从名字迁 id 的存量数据 | 读取时尽力匹配 + 失效标记，不做破坏性迁移 |
| A-14 删除后仍有隐藏引用 | 以 grep + 构建 + 全流程手动走查兜底 |

回滚：全部改动以功能提交分批（每项一 commit），可单独 revert。

## 7. 变更记录
- 2026-08-25 反思修正：新增 A-16（API 客户端收编，决策 D-3）、A-17（名称长度一致化，调研 12 §3.1）；A-03 风险表补充单 worker 队列阻塞说明（池化列入 C 候选）。
- 2026-08-25 实施偏离登记（均按规格变更规则记录）：
  1. A-01 的 Run 表 `workflow_version_id` 列已存在（历史迁移所建），migration 015 只新增 `definition_source` 与 Agent 两列一约束。
  2. A-01 的 `version_id` 已接线到 `POST /api/runs`（规格未明写，属 API 面必要补全，有 pytest + e2e S14 覆盖）。
  3. A-11 前端选择器存资源 **id**，后端 `_build_tools`/`mounts-health` 按"先 id 后名字"双兼容（规格原文即此约定）。
  4. 现有测试最小改写两条：`test_p2` 调度用例先发布再挂调度（A-01 语义）；`test_agent_runtime` 三个运行用例改为"等待终态"轮询（A-03 异步化）。
  5. `default_config` 同步清掉死配置键（`routing`/`dialogue`/`terms`/`experiences`），与 A-10 前端删除对齐。

## 8. 状态日志
- 2026-08-25 规格草稿完成，待冻结。
- 2026-08-25 四维反思（复用/架构/前端细节/调研冲突）后修正并重新待冻结。
- 2026-08-25 用户裁决四项决策（门面删除/无版本定时报错/进化更名/legacy 清退），规格冻结。
- 2026-08-25 批次 1 完成（d5a7910）：54/54 绿。
- 2026-08-25 批次 2 完成（ee742ab）：61/61 绿。
- 2026-08-25 批次 3 完成（b6ede37）：构建通过，61/61 绿。
- 2026-08-25 批次 4 完成（b78ef12）+ e2e/路由接线收尾：62/62 绿；`verify-fullstack.mjs` 41/41 + S13/S14 全 PASS（真实后端 8100）。待用户逐项验收。
