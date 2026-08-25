# 06 · 工作流节点总纲（Node Master Spec）

> 状态：待评审草稿 · 2026-08-25
> 上位文档：`docs/research/lightweight-workflow-system/`（01–17）、`docs/research/product-ui-interaction-study/`、`docs/sdd/00–05`
> 证据分级：**[实测]** = 我们代码/基准产品实测；**[设计]** = 我方设计文档已预留未实现；**[REC]** = 本文推荐的自研决策（无基准背书，评审时单独确认）

---

## 0. 背景、范围与冻结声明

### 0.1 决策背景

2026-08-25 三轮讨论的结论，构成本文档的输入：

1. **不换 n8n**。n8n 的许可（Sustainable Use License）不允许嵌入我们的产品对外提供；其 Vue 编辑器无法进入我们的 React 应用；我们 ~21 个领域节点仍需用它的 TS 框架重写。n8n 的价值在"吸收思想"（§6）。
2. **workflow 为主干**。分析任务（`AnalysisTask` 模型注释即"workflow × 数据资产 × schedule"，`models.py:451`）等实体以 flow 为主干执行；节点做精细，让 workflow 能跑全部类型的节点。
3. **Agent 模块冻结，Agent 族节点保留并精细化**（见 0.2）。

### 0.2 冻结声明（本周期生效）

**冻结范围（不再新增功能、不再改 UI，仅修缺陷）：**

- Agent 列表页、Agent 编辑器壳层（`src/pages/wf-agent-editor.tsx` 的 autonomous 四 Tab 壳）、Agent 发布控制面（`agent_release.py`：版本快照/灰度/归档/编辑锁）的新功能演进。
- 三型 Agent 的运行时语义（`agent_runtime.py` 的 ReAct 循环、专家组路由）保持现状。

**不冻结（本文档管辖）：**

- 画布上的 Agent 族节点（`agent` / `agent-select` / `agent-exec`）的 UI 与交互精细化（§5）。
- 节点注册表、执行器、校验器为支撑节点精细化所做的演进。

**冻结的退出条件**：全部 workflow 能力（含 §4 新节点）上线稳定后，重启 Agent 讨论。届时 Agent 层应成为"精细化节点之上的薄皮"，而非平行体系。

### 0.3 阅读约定

- 每个节点按统一七栏写：定位 / 配置 UI（目标）/ 前端交互 / 后端契约 / 校验 / 观测 / 现状缺口→目标。
- 前端引用以 `src/pages/wf-designer.tsx` 行号为准（2362 行单文件，附录 A 有索引）；后端以 `server/app/registry.py`、`runner.py`、`agent_runtime.py` 为准。
- 视觉令牌一律继承 `docs/research/lightweight-workflow-system/16-ui-replication-spec.md` §1，不另立标准。

---

## 1. 节点体系总览

### 1.1 现有 21 节点（`registry.py:9-248`，全部有真执行器）

| type_key | family | 标签 | editor_kinds | executor | 前端定制程度 |
|---|---|---|---|---|---|
| input | 边界 | 开始 | FLOW/GROUP/WORKFLOW | exec_input | 无表单（schema 空） |
| end | 边界 | 结束 | 三Kind | exec_end | 深度定制（输出绑定表） |
| llm | 智能 | 大模型 | FLOW/WORKFLOW | exec_llm | 深度定制 |
| condition | 逻辑 | 条件判断 | 三Kind | exec_condition | 深度定制（最完整） |
| decision-class | 逻辑 | 决策分类 | FLOW/GROUP | exec_decision_class | 部分定制 |
| transform | 数据 | 变量处理 | FLOW/WORKFLOW | exec_transform | 通用兜底 |
| query-rewrite | 数据 | Query改写 | FLOW/GROUP | exec_query_rewrite | 深度定制 |
| code-write | 代码 | 代码编写 | FLOW/GROUP | exec_code_write | 深度定制（CodeMirror） |
| tool | 外部 | 插件工具 | FLOW/WORKFLOW | exec_tool | 深度定制 |
| mcp-call | 外部 | MCP 工具 | FLOW/WORKFLOW | exec_mcp_call | 深度定制 |
| knowledge-retrieval | 外部 | 知识检索 | FLOW/WORKFLOW | exec_knowledge_retrieval | 部分定制 |
| workflow-exec | 外部 | 工作流执行 | FLOW/WORKFLOW | exec_workflow_exec | 部分定制 |
| workflow-select | 外部 | 工作流选择 | FLOW | exec_workflow_select | 通用兜底 |
| workflow-fixed | 外部 | 工作流 | FLOW | exec_workflow_fixed | 通用兜底 |
| create-record | 副作用 | 创建质检记录 | WORKFLOW | exec_create_record | 通用兜底 |
| notification | 副作用 | 通知 | WORKFLOW | exec_notification | 通用兜底 |
| reply | 信息回复 | 对话回复 | FLOW | exec_reply | 通用兜底 |
| memory-variable | 记忆变量 | 记忆变量 | FLOW | exec_memory_variable | 通用兜底+补丁 |
| agent | Agent | Agent | FLOW/GROUP | exec_agent_node | 简陋（单 Select） |
| agent-select | Agent | Agent选择 | GROUP | exec_agent_select | 简陋（Checkbox+Select） |
| agent-exec | Agent | Agent执行 | GROUP | exec_agent_exec | 简陋（单 Select） |

执行器分布：`runner.py:673` EXECUTORS 表 15 个 + `runner.py:685` `_agent_family_executor` 6 个（其中 agent 三键已决策退役，见 §5）。终端节点集合 `TERMINAL_TYPES={end, create-record}`（`registry.py:252`）。

> 节点体系账：21 现有 − 3 退役（agent/agent-select/agent-exec）+ 4 新增（loop/wait-review/data-read + error-branch 配置项不计节点）= **22 节点**。

### 1.2 新增 4 节点 + 1 项执行器行为

| 新增 | 类别 | 一句话定位 | 主要参照 |
|---|---|---|---|
| loop | 逻辑 | 对 Array 变量逐条/分批执行子图，输出聚合 | 我方 LLM 批处理模式[实测基准]、Dify iteration[开源]、飞书工作流循环节点[公开资料] |
| wait-review | 边界 | 暂停 Run 等待人工/定时/外部事件，落盘可恢复 | quickservice 信息收集节点[实测]、n8n Wait[开源] |
| error-branch | 逻辑 | 节点失败走错误输出 handle，而非整 Run 死 | n8n error output[开源]；我方 07 文档 onError[设计] |
| data-read | 数据 | 从 DataAsset 按窗口/抽样取数，输出 rows:Array | 分析链业务自研[REC] |
| （并行执行） | 执行器行为 | ready 队列并发消费，非新节点 | 09 文档"就绪队列并发，V1 不承诺"[设计] |

**为什么是这四个**：分析任务挂上 flow 主干的四个硬前置——批量过样本要 loop、跑得要快并行、质检复核要 wait-review、单条失败不拖死整批要 error-branch。data-read 是 create-record 的对称读端。循环节点在基准产品（quickservice）中**不存在**（调研 11 未观察到，仅有 LLM 批处理模式与防循环治理），loop 与 error-branch 的形态主要参照 n8n/Dify 开源代码，属 [REC]+[开源实测] 混合，评审时重点看。

### 1.3 family 与 editor_kinds 矩阵（08-25 逐节点评审通过，台账见附录 D）

原则：**独立工作流编辑页跑全部类型节点**（用户决策）；FLOW/GROUP 在现状基础上补齐。

| 节点 | FLOW | GROUP | WORKFLOW |
|---|---|---|---|
| input / end / condition / create-record / notification | ✓ | ✓ | ✓ |
| llm / tool / knowledge-retrieval / mcp-call / workflow-exec / workflow-select / workflow-fixed / transform / reply / memory-variable | ✓ | | ✓ |
| query-rewrite / code-write / decision-class | ✓ | ✓ | ✓ |
| loop / wait-review | ✓ | | ✓ |
| data-read | | | ✓ |
| Agent 族三节点 | 退役，并入工作流三连（§5，08-25 决策） | — | — |

error-branch 不是画布节点，是节点配置项（§4.3）。registry `editor_kinds` 按本表在 P1 批量修订。

---

## 2. 跨节点公共机制

### 2.1 Registry 驱动与 x-control 映射表

**现状**：前端不是真 schema 驱动。`ConfigDrawer`（wf-designer.tsx L503-1020）按 `node.type` 硬编码 13 种专项表单；其余落 `GenericSchemaForm`（L1023-1106）。后端声明的 12 种 x-control 中，仅 `workflow-picker` 被渲染器真识别，`prompt-editor` 只加等宽字体，其余全部被专项分支绕过或落通用 Textarea（含未实现的 `workflow-picker-multi`）。注册表的 `icon`/`accent` 前端完全未用（图标走硬编码 `TYPE_ICON` L127-135，仅 11 种）。

**目标**：建 x-control→组件 的统一映射表，专项表单逐步迁入：

| x-control | 目标组件 | 现状 |
|---|---|---|
| prompt-editor | 多行编辑区 + `#` 唤起变量级联 + 等宽 | 仅 llm 有 # 唤起；其余无 |
| expression-editor | 单行 + `#` 唤起变量级联 | 普通 Input，无变量 |
| variable-picker | VarCascader（L337-400） | condition 已用 |
| tool-picker | ResourceSelect(types=tool) + 版本策略选择 | 已用，自动绑最新版（应可选钉版本） |
| knowledge-picker / mcp-picker / mcp-tool-picker | ResourceSelect 系 | 已用 |
| workflow-picker | WorkflowPicker（L1151） | 已用 |
| workflow-picker-multi | 多选 Popover（卡片+搜索） | **未实现** |
| agent-picker / agent-picker-multi | AgentRefCard 选择器（§5.3 新组件） | 裸 Select/Checkbox |
| code-editor | CodeMirror | 已用 |

**硬编码清理**：专项排除列表（L1015-1017）与 Agent 族类型串判断（L534）改为读注册表字段（如 `def.inspector === "custom:xxx"`），注册表新增节点不再需要手工同步前端两处字符串。

### 2.2 变量引用系统

**现状**（[实测]我们）：`VarCascader` 两栏级联，左栏 = 系统变量 + 开始节点 + 控制流可达祖先（反向 DFS，与后端 `_ancestors` 同构）；插入格式 `{{nodeId.outputs.name}}`；`#` 唤起仅 llm 提示词一处（L677-688）。输出来自注册表 `io.outputs` 的 `"name:type"` 串；`io.outputs` 为字符串（如 tool 的 `from-tool-version`）时显示"输出由资源配置决定"。

**目标**（对齐调研 11 §5、07 §6b）：

1. 所有 prompt-editor / expression-editor 字段支持 `#` 唤起（transform、reply、knowledge-retrieval.query、notification.message 补齐）。
2. 引用存储结构化：保留 `text` 展示串 + `refInfo{nodeId, path, dataType}`（基准 quickservice 同构，调研 11 §5.3）；节点改名只更新展示串不破坏引用；引用目标删除/端口变化 → 引用 INVALID 并阻止发布（validator R4 已有路径可达校验，补端口变化检测）。
3. 类型过滤：级联右栏按目标字段类型过滤候选（condition 已按 `OPS_BY_TYPE` 做操作符过滤，推广到全部引用点）。
4. Object 输出按 schema 展开子路径（`file.fileType` 式）；Array 输出保存 element schema[REC]（调研 11 §5.4 明确"仅 Array 不足以支持下游字段选择"）。

### 2.3 执行健壮性契约（execution 块）

**[设计]** 07 文档 §3 已定义 `node.execution: {timeoutMs, retries, onError: fail|skip}`，09 文档 §4 定义了语义（仅 retryable 错误重试、指数退避 1s/3s、run 总时限 10min）。**现状代码未落地**：runner 仅有传输层超时（LLM 60s `runner.py:168`、工具 10s `runner.py:364`、code subprocess 10s `runner.py:590`），无节点级重试，`onError` 未实现（`while ready and not failed`，`runner.py:784`）。

**目标**（本总纲的执行器侧契约，与节点 UI 同步落地）：

- 每个节点抽屉增加"健壮性"折叠分区：超时（秒，默认按节点族给：llm 60 / tool 10 / code 10 / 其余 30）、重试（0–3 次，仅 retryable：5xx/timeout/连接错误）、失败策略（停止｜跳过｜走错误分支，见 §4.3）。
- 重试事件入 run_event（`node_retry`，含 attempt/backoff），挂进现有 Trace 重试谱系（E-3）。
- run 总时限与取消保持 09 设计。

### 2.4 校验呈现

**现状**：校验全部来自后端 `validator.py`（R1–R7），呈现**只有**顶栏"检查"Popover（L1852-1885）；`issues` 已传入节点卡数据（L1656）但 `WfNodeCard` 未渲染（传入即弃）；抽屉内无字段级错误（唯一例外 condition 未选变量红框 L778）。

**目标**：

1. 节点卡右上角错误红点 + 计数（与顶栏 Popover 同源），点击 Popover 条目定位并打开抽屉（已有）。
2. 抽屉内字段级红框 + 行内文案（"请选择模型"/"请配置提示词"），错误文案由 validator 的 issue.kind + 字段路径生成。
3. 试运行门禁保持"请先配置节点" toast（交互规格 S6）。

### 2.5 空/加载/错误文案与视觉标准

继承 interaction-spec S9 与 16 号文档：空态统一插画 + 四字文案（暂无数据/暂无插件）；类型 chip（Str./Obj. 浅灰底 11px）；未配置 = `#B9C2CF` 灰字；toast 顶部居中红边 2.5s；抽屉 360 宽、分区 chevron 折叠、头部 [彩色图标][名][…][×] + 一句节点描述（**节点描述文案目前只硬编码 3 种，全部 21+4 节点补齐一句描述**）。

### 2.6 公共面板机制（Dify/n8n 逐条对账，08-26）

1. **单节点试跑表单**：面板内 "Test Run" 覆盖层，按节点引用变量自动生成输入项（prompt 引用、`#context#`/`#files#` 特殊键），预填示例，无必填输入时自动运行。升级现有"单测此节点"（E-4.3）。
2. **失败策略四值**：停止｜跳过｜走错误分支｜**默认值**（失败按输出变量逐个填默认值继续；Dify default-value；第四值待复核，原型 ㉔）。
3. **重试三件**：retry_enabled / max_retries / retry_interval；HTTP 类节点默认开（3 次/100ms）；替换原"retries 0–3"单值。
4. **统一输出变量区**：面板底部固定可折叠输出区（名/类型/描述，object 可展开子字段树）。
5. **notice 内联引导 + 画布卡 subtitle 回显**：控件附声明式内联说明；画布卡副标题回显关键配置（tool "SLS 查询 · v2"、wait 恢复 URL）。
6. **校验聚合**：节点 checkValid 首条错误上节点卡（hover）+ 面板字段 warningDot 橙点；与 §2.4 互补。
7. **HTTP 请求节点本周期不做**[决策]：tool 声明式配方（08 §3）覆盖 HTTP 语义；Dify http / n8n HttpRequestV3 的字段（分页/限速/cURL 导入）入 tool spec 的 Future 储备。

---

## 3. 现有节点规格（Agent 族见 §5 专章）

> 每节点七栏。"现状缺口→目标"只列差异，共性缺口（x-control 映射、# 唤起、校验呈现）见 §2，不重复。

### 3.1 边界族

#### input（开始）

- **定位**：Run 的输入契约；全节点共享只读公共变量来源（07 §6b）。
- **配置 UI（目标）**：输入变量表（变量名｜类型｜必填｜描述｜删除），空态插画 + "+ 添加"。默认六变量 userQuery/chatHistory/userId/conversationId/chatId/reference 预置且不可删（注册表 io 已声明）。
- **前端交互**：现状抽屉只剩标题（schema 空 → GenericSchemaForm 返回 null）→ 目标为上述变量表（对齐基准开始节点列结构，交互规格 S4）。
- **后端契约**：`exec_input` 透传 run_input；`SummaryRows`（L187-235）硬编码只展示 3 个变量 → 改为读注册表 io 全量 6 个。
- **校验**：R1 恰一个 input。
- **观测**：workflow_started 携带 input 摘要（脱敏）。

#### end（结束）

- **定位**：收集结构化输出（07 `structuredOutputs`）。
- **配置 UI**：输出绑定表（变量名｜类型｜值：固定值 Input / 引用 VarCascader 切换）——现状已深度定制（L851-891），保持。
- **后端契约**：`exec_end` 收集；R6 每个 structuredOutput key 恰被一个终端产出。
- **缺口→目标**：值列的"固定/引用"切换保持；补字段级校验呈现（§2.4）。

### 3.2 智能族

#### llm（大模型）——标杆节点，其余节点向其看齐

- **定位**：一次 LLM 调用；prompt 模板 + 模型引用 + 输出格式。
- **配置 UI（现状已深，目标补齐）**：
  - 模型 Popover：选项 = 模型名 + 能力标签 chip + check（现状有，`resApi.registry("model")`）。
  - 输入绑定表（变量名｜类型｜值 + ⚙ 引用）。
  - 提示词 prompt-editor + `#` 唤起（现状唯一支持处，保持）。
  - 输出格式 Select（Markdown/JSON）+ 输出示例按钮 + 固定输出表 output/thought/answer（**SummaryRows 卡内只硬编码 2 个，补 answer**）。
  - **[基准实测] 批处理模式**（调研 11 §3.4）：segmented 单次｜批处理；批处理配置 = 批量列表变量（Array 引用）+ 最大批次数（默认 100）+ 并发数（默认 10）；输出切换为 `outputList:Array`。**此模式是 loop 节点的语义先导**（§4.1 说明两者关系）。
  - 模型参数（temperature 等）折叠高级区（注册表 modelRef.params 已有，现状无 UI[缺口]）。
  - **[飞书公开资料实测]** prompt 编辑器自带"AI 润色"（替换/重试/取消）与独立"测试生成"面板（测试数据可生成/手改 + 预览 + 重新生成）——先试再上线是标配；与我们的节点单测对话框（L2162）合并升级。
  - **[飞书公开资料实测]** 输出双模式：简易模式（字段类型+名称+描述）｜JSON 示例模式；不启用时默认 `{"输出": ...}`。我们 outputFormat Markdown/JSON 为其前身，JSON 模式与现有"输出示例"按钮合并。
  - **[飞书公开资料实测]** 系统设定（system message）独立于输入指令且优先级更高 → llm config 增补可选 systemPrompt 字段（prompt-editor + # 唤起）。
- **后端契约**：`exec_llm`（runner.py:133）；`_call_model` 走 llm_gateway；60s 超时；usage 记 token。
- **字段对账 08-26**：JSON 模式升级为 Schema 编辑器（object 嵌套/array items/enum）；切换模型自动清洗非法参数 + toast；memory/vision 分区预留（V1 不做）。
- **校验**：R3 必填 modelRef/prompt；R4 prompt 引用可达。
- **观测**：node_completed 带 usage；首 token 耗时（E-3）。

### 3.3 逻辑族

#### condition（条件判断）——规则构建器标杆

- **定位**：声明式分支路由；分支 = handle，边 = sourceHandle。
- **配置 UI（现状最完整，保持）**：多分支增删/排序、AND/OR ToggleGroup、操作符按变量类型过滤（`OPS_BY_TYPE` L402-454）、字面量/变量双模式、else 兜底行；卡内每分支一个 source handle（`ConditionRows` L238-261）。
- **后端契约**：`exec_condition` 输出 `selected`；runner 分支语义 `runner.py:808-814`（仅激活同 handle 出边，其余级联失活）。
- **校验**：R7 分支与出边 handle 一一对应。
- **字段对账 08-26**：操作符族补 in/not in/exists/not exists/is(null) 系；object/file 子属性条件（element schema）；ignoreCase/looseTypeValidation 开关；分支名可编辑（handle 标签跟随）。
- **缺口→目标**：数值/布尔/数组操作符目前仅 String 系实测完整（调研缺口）→ 按注册表 variableType 枚举（string/number/boolean/array/object）补齐操作符集[REC]：number 加 gt/gte/lt/lte（schema 已声明）、boolean 加 is/is-not、array 加 contains/empty。

#### decision-class（决策分类）

- **定位**：LLM 语义分类路由（分支由分类项定义）。
- **配置 UI**：分类项列表（名称+说明）现状有；**缺口**：分支出口仅文字提示 "c{i}"，无画布 handle 联动 → 目标对齐 condition：每个分类项一个 source handle + 卡内分支行 + "其他"兜底 handle（基准问题分类节点有"其他分类"兜底，调研 11 §3.10）。
- **后端契约**：输出 classificationTitle/classificationId；分支语义同 condition（runner.py:810 已列入分支族）。
- **校验**：分类名非空（行内 alert，交互规格 S4 已验证模式）。
- **[飞书公开资料·AI 分类节点]** 形态强化，四项纳入：分类 2–10 个（名称+描述）；无匹配 = 归"其他"｜节点失败 二选一（对齐 else handle / fail）；可选全局分类规则（整体概括补充文本）；每分类一条分支且可嵌套在循环节点内逐条处理。

### 3.4 数据族

#### transform（变量处理）

- **定位**：声明式表达式聚合/拼接（07 原则 4：不含任意代码）。
- **配置 UI**：[基准实测] 处理模式 Radio（多输出聚合/多输出拼接）+ 输入表 + 输出表（调研 11 §3、evidence/19 截图）。现状：通用兜底，template 等宽 Textarea **无变量插入** → 目标：prompt-editor + # 唤起 + 模式 segmented + 输出变量表（declared）。
- **后端契约**：`exec_transform` 模板渲染（`render_refs` runner.py:109）。

#### query-rewrite（Query改写）

- **定位**：检索前查询改写，输出 queryList:Array。
- **配置 UI**：策略 Select（default/custom）+ custom 时显示改写提示词（现状有）+ 输入绑定；提示词补 # 唤起。
- **后端契约**：`exec_query_rewrite`；输出 queryList 供下游 knowledge-retrieval/loop 消费。

### 3.5 代码族

#### code-write（代码编写）

- **定位**：受控代码节点（subprocess 隔离 + 10s 超时，runner.py:590）。
- **配置 UI**：CodeMirror Python（现状有，唯一真代码编辑器）+ 输入绑定（现状仅固定值 → **补变量引用**，与 transform 对齐）+ 输出变量表（declared）。
- **安全红线**：保持 07 原则 4 的边界——subprocess 隔离、超时、无网络（SSRF blocked runner.py:363 同标准）。
- **字段对账 08-26**：同步函数签名（解析参数回填输入/返回值回填输出类型）；执行模式 全量一次｜逐条执行；编辑器标题栏 AI 生成按钮。

### 3.6 外部族

#### tool（插件工具）

- **定位**：通用工具节点 + 建节点时绑定 tool_version（08 §3 关键结论：Tool 与 Node 是两个概念）。
- **配置 UI**：ResourceSelect(types=tool) 现状有；**缺口**：自动绑最新版本 → 目标加版本策略 Select（最新 Ready｜钉版本），钉版本时发布快照冻结（07 §7 已要求 Tool Version IDs 进快照）。
- **输入/输出**：输入 = tool spec params schema 动态生成绑定表；输出 = spec outputs schema 树展示（基准 S8：schema 树可嵌套）。
- **后端契约**：`exec_tool`；retry 在 tool spec 层（08 §3 `retry:{max,on:[5xx,timeout]}`）——与 §2.3 节点级重试的关系：tool spec retry 管传输层，节点 execution.retries 管节点层，不叠加放大（取 max 语义[REC]）。
- **字段对账 08-26**：每参数独立常量/变量双模式；输入参数与工具设置（Settings 折叠区）分区；未授权时整面板替换为授权按钮。

#### mcp-call（MCP 工具）

- **配置 UI**：MCP Server 选择 + 工具下拉（握手发现的 discovered_tools）现状有；**缺口**：args 目前是裸 object Textarea → 目标按所选工具的 inputSchema 动态生成参数表单（复用 GenericSchemaForm 渲染工具 schema）。
- **后端契约**：`exec_mcp_call`；输出 result:string。

#### knowledge-retrieval（知识检索）

- **配置 UI**：知识源选择 + topK 数字框现状有；query 从普通 Input → expression-editor + # 唤起。
- **后端契约**：`exec_knowledge_retrieval`；输出 slices/sources。
- **字段对账 08-26**：检索模式 单路｜多路 + score_threshold + rerank 开关/权重；元数据过滤（automatic/manual）预留。

#### workflow-exec / workflow-fixed / workflow-select（子流程三连，吸收退役 Agent 族，§5）

- **语义区分**：exec = 按 code 执行子流程（含动态绑定模式）；fixed = 绑定一个 workflow 实例执行（含输入映射表）；select = LLM 路由从候选中选一个。
- **配置 UI**：exec = WorkflowPicker + 固定｜动态 segmented（动态 = workflowCode 输入绑定行）；fixed = WorkflowPicker + 输入变量映射表（⚙ 引用，默认同名透传）+ 输出变量表；select = candidates 多选卡（P0 已实现）+ 路由模型可配 + 组合校验候选非空。
- **版本策略**：三节点统一"最新已发布｜钉版本"Select，与 tool 一致；钉版本进发布快照；不回退草稿[决策]。
- **画布卡**：fixed = 流程名+版本+输入数；exec = 绑定来源；select = 候选数+已选名。
- **后端契约**：`exec_workflow_exec` 同步子 Run（enqueue=False）+ call_chain 防环；select 路由 routingModelRef 可配（默认 qwen-plus），超时 10s，失败走 else。
- **观测**：子 Run 挂调用记录、Trace 递归展开（E-3.3）。
- **迁移**：旧图 agent/agent-select/agent-exec 按 §5.3 一次性改写。

### 3.7 副作用族

#### create-record（创建质检记录）

- **定位**：质检业务 Sink；幂等键 = run_id+node_id（09 §6）。
- **配置 UI**：outputKey 从 Textarea → 单行 Input + 结构化输出 key 下拉（来自 workflow io.structuredOutputs）。
- **后端契约**：`exec_create_record`；重放安全。

#### notification（通知）

- **配置 UI**：message 补 # 唤起；[REC] 渠道 Select（日志｜IM webhook，V1 仅日志，保持 `notify_log`）。

### 3.8 对话族

#### reply（对话回复）

- **配置 UI**：content prompt-editor + # 唤起（现状等宽 Textarea 无变量）。
- **后端契约**：`exec_reply`；输出到对话流（SSE 内容流）。

#### memory-variable（记忆变量）

- **配置 UI**：mode segmented 读｜写；读 = keys 多选（chip 式，现状"每行一项 Textarea"→改 chip）；写 = keys + 输入绑定表（现状补丁在通用表单内 L1088-1103 → 迁为正式 inspector）。
- **后端契约**：`exec_memory_variable`；V1 run 内 state，跨会话 Future（07 §6b）。

---

## 4. 新节点规格

### 4.1 loop（循环迭代）

- **定位**：对 Array 变量执行子图（loop 体 = 画布上 loop 节点下游到汇聚点的子图，或内嵌子画布[REC 选前者，与 xyflow 单画布一致]）。
- **与 llm 批处理的关系**：批处理是"单节点内并发映射"，loop 是"子图级迭代"；两者并存（基准亦如此：LLM 批处理模式存在且无循环节点）。简单映射用批处理，体内含多节点/分支/人审用 loop。
- **配置 UI**：
  - 迭代源：variable-picker（限 Array 类型，类型过滤 §2.2）。
  - 迭代变量名（默认 item）+ 索引变量名（默认 index）。
  - 最大迭代数（默认 1000，防失控）+ 并发数（默认 1，>1 走 §4.5 并行执行）。
  - 输出：outputList:Array（每迭代体输出聚合）+ 成功/失败计数。
  - 卡内摘要行：`循环 {{source}} · 并发 N`。
- **前端交互**：loop 体在画布上以**回边**表达（loop 节点出边 → 体 → 回 loop 的 "body" handle；汇聚走 "done" handle）；validator 特判此合法环（R2 无环规则加白名单：仅 loop 回边合法）。
- **后端契约**：runner 新增 loop 状态机——每轮以 item/index 注入 ctx 执行体子图；每轮一条子 NodeRun 谱系（Trace 嵌套，E-3 机制复用）；迭代间检查 cancel_requested。
- **校验**：迭代源必填且类型 Array；回边与 done 边齐全；最大迭代数 ∈ [1, 10000]。
- **观测**：loop_progress 事件（i/total），画布节点卡显示进度环。
- **代码参照**（§6 核实）：graphon iteration/loop container_handler（Apache-2.0，同语言可复制）；coze loop 的 break/continue 子节点语义。
- **字段对账 08-26**：loop_variables（循环内可变变量，名/类型/初始值）；break_conditions（复用条件模型，可引体内子节点输出）；并行开关 + 并行度（数字+滑杆联动）；error_handle_mode 三值（Terminated/ContinueOnError/RemoveAbnormalOutput）；flatten_output 展平开关；运行详情容器专属日志（逐轮状态/失败项）。

### 4.2 wait-review（等待/人工审核）

- **定位**：暂停-恢复原语。基准最接近形态 = quickservice 信息收集节点（调研 11 §3.3：主动提问并暂停，收到输入恢复；超时秒数/超时追问/最大轮次默认 3/全局跳转）。
- **配置 UI**：
  - 等待类型 segmented：人工审核｜定时等待｜外部事件（V1 做前两个[REC]）。
  - 人工审核：审核提示（prompt-editor + #）、审核表单（通过｜驳回 + 意见 textarea）、超时秒数、超时策略（自动通过｜自动驳回｜升级）、最大等待时长。
  - 定时等待：等待时长/等到指定时刻（cron 复用 compute_next runner.py:195）。
  - 输出：decision:string(pass/reject/timeout) + comment:string + waitedMs:number；两出口 handle：pass / reject。
- **后端契约**：Run 状态机新增 `paused`（run.status），暂停点 = wait-review NodeRun(status=waiting)；恢复 = `POST /api/runs/{id}/resume`（payload decision/comment）→ job_queue 重入队（run_at=now，幂等键 run_id+node_id 防双恢复）；恢复后从该节点继续（outputs 已落库，无需整图重跑）。这是 09 文档"暂停/恢复 V1 Omit(Future)"的兑现，**本节点是兑现它的最小切口**。
- **前端交互**：画布节点卡 waiting 态 = 橙色等待环 + "待审核"；运行抽屉/Trace 显示审核入口按钮；审核动作在运行详情页完成（不跳 IM，V1）。
- **校验**：超时策略必填；定时等待表达式合法。
- **观测**：run_paused / run_resumed 事件；审核动作入 ResourceChangeLog 同标准的审计日志。
- **代码参照**（§6 核实）：Dify human_input 三层（引擎/后端/前端，同栈）；activepieces approval piece（MIT，审批产品语义）；n8n Wait（三恢复方式）。
- **字段对账 08-26**：恢复方式 人审表单｜定时间隔｜指定时刻｜外部回调(预留)；人审表单=类型化字段（paragraph/select/singleFile/multiFiles，含扩展名白名单/数量上限）+ user_actions 操作按钮（样式 primary/default/accent/ghost）+ 输出由表单字段动态生成；超时 值+单位(hour/day)；恢复 URL 运行时生成、画布 tooltip 回显。

### 4.3 error-branch（错误分支，配置项而非新画布节点）

- **形态决策**[REC]：不做独立画布节点，做**每个节点的配置项 + 约定错误 handle**。理由：n8n 的 error output 是节点级端口语义；独立"catch 节点"会引入作用域歧义。
- **配置**：§2.3 健壮性分区的失败策略三值：停止（fail，现状）｜跳过（skip，07 已设计）｜走错误分支（branch）。
- **画布语义**：选 branch 的节点自动获得第二个 source handle `error`（卡内以红色虚线端口呈现）；失败时该节点 NodeRun status=failed_but_routed，错误对象 `{code,message,retryable}` 作为 error handle 的输出供下游引用（`{{nodeId.error.message}}`）。
- **后端契约**：runner 失败路径改造——retries 用尽后按 onError 分派；error 输出写入 outputs 表使下游可引用；`while ready and not failed` 的 failed 判定改为"存在 fail 策略节点失败"。
- **校验**：onError=branch 的节点必须有 error handle 出边，否则检查清单报"错误分支未连接"。
- **与循环的配合**：loop 内单条失败 + onError=skip → 该条记入失败计数、继续下一条（整批不死的硬需求）。
- **代码参照**（§6 核实）：n8n 错误三态语义（只学不复制）；Dify error-handle 组件（同栈 UI）；kestra errors 段/allowFailure（教科书）。

### 4.4 data-read（数据读取/抽样）

- **定位**：分析链读端，与 create-record 对称。从 DataAsset 按窗口/抽样取数。
- **配置 UI**：
  - 数据资产选择（ResourceSelect types=asset，复用）。
  - 数据窗口 Select（last_24h/last_7d/last_30d/custom，custom 双日期）——与 AnalysisTask.data_window 同词表。
  - 抽样 Select（all/random_n/stratify，n 数字框）——与 AnalysisTask.sampling 同词表。
  - 范围过滤（可选，condition 同款规则构建器子集[REC 简化版：单字段 eq/contains]）。
  - 数据访问身份 Select（触发者｜创建者）[飞书公开资料·AI 分析节点]——触发者身份仅能读其有权限的数据，无权限节点不执行；V1 可先只做创建者身份、字段预留[REC]。
  - 参考资料（可选，文件/云文档链接作为口径与风格参考）[飞书实测]——V1 不做，字段预留。
  - 输出：rows:Array + count:number。
- **后端契约**：`exec_data_read` 新执行器；数据访问走现有 DataAsset 存储层；输出 rows 直接喂 loop 迭代源或 llm 批处理。
- **与 AnalysisTask 的关系**：AnalysisTask 挂 flow 后，其 data_window/sampling 字段成为"触发参数"注入 run_input，data-read 节点默认引用 run_input（可覆盖）——实体配置与节点配置不双写（调研 12 §7.4 双写教训）。

### 4.5 并行执行（执行器行为，非节点）

- **现状**：Kahn 就绪队列但 `ready.pop(0)` 串行（runner.py:785）。
- **目标**：ready 队列并发消费（asyncio/线程池，并发上限配置项默认 8，09 §1 已设计）；join 语义 = 入队条件"所有存活入边已结算"（09 §2 已设计 isNodeReady）。
- **承诺边界**：并发不保证节点启动顺序；观测事件以 sequence 单调为准（已有）。
- **前置**：节点执行器无共享可变状态（ctx.outputs 写入加锁或按节点归并[REC]）。

---

## 5. Agent 族退役与能力收编专章（08-25 决策）

### 5.1 方向（两步决策）

1. **改挂目标**：Agent 族节点不再引用 Agent 实体，改引用**已发布工作流版本**（能力）。Agent 实体保持冻结，迁移完成后自然淡出（§0.2）。
2. **合并退役**：改挂后 Agent 三节点与 workflow 三连语义重叠，**合并并退役 agent/agent-select/agent-exec 三个 type_key**。

| 退役节点 | 并入 | 继承/新增语义 |
|---|---|---|
| agent | workflow-fixed | 固定调用 + **新增**输入变量映射表（开始变量标准行，⚙ 引用，默认同名透传，可改可清空）+ 输出变量表 + 钉版本 |
| agent-select | workflow-select | 候选多选 + LLM 路由 + else 兜底 + **新增**路由模型可配 |
| agent-exec | workflow-exec | **新增**"动态绑定"模式（workflowCode 来自输入绑定，如接路由输出） |

### 5.2 工作流三连的增量（承接原 Agent 族精细化诉求）

- **workflow-fixed**：抽屉加输入映射表 + 输出变量表（复用 llm/end 输入表组件）；画布卡 = 流程名 + 版本 + 输入数。
- **workflow-exec**：抽屉加 固定｜动态 segmented；动态模式显示 workflowCode 输入绑定行；画布卡显示绑定来源。
- **workflow-select**：candidates 多选卡保持（P0 已实现）；路由模型 routingModelRef 可配（默认 qwen-plus，超时 10s，失败走 else）；组合校验候选非空。
- 专家组（GROUP）画布改用工作流三连；成员池概念退役（MemberPoolPicker 随 Agent 模块入冻结区）。
- 原 §5.1 草稿的 12 条粗糙点随合并自然消解（无成员池、无 agentCode 语义错位、无空 Select）；输入映射表/输出变量表/钉版本在工作流三连上按附录 D 落地。

### 5.3 迁移与兼容

- 旧图加载时一次性改写：`agent`→`workflow-fixed`（agentCode→workflowId；成员 Agent 有底层工作流时取其最新已发布版本，否则节点标"失效"引导重选）；`agent-select`→`workflow-select`（primaryAgents→candidates，fallback 入 else 语义）；`agent-exec`→`workflow-exec` 动态模式。
- 已发布 AgentVersion 含 agent 族节点的，运行时仍可解释（runner 保留旧 executor 作兼容层，标 deprecated）；新编辑一律走合并后节点。

### 5.4 与冻结声明的关系

Agent 模块（列表页/编辑器壳层/发布控制面）仍按 §0.2 冻结；本章只做"节点引用目标改挂 + type_key 合并"，不给 Agent 模块加新功能。Agent 实体的只读/展示能力保留到迁移完成。

---

## 6. 成熟方案对照与学习代码索引

### 6.1 对照表（许可与路径均经代理实际抓取核实，2026-08-25）

| 仓库 | 许可（核实） | 栈 | 学什么 | 红线 |
|---|---|---|---|---|
| langgenius/dify + **langgenius/graphon** | Apache-2.0 + 两附加条件（多租户 SaaS 需商业授权；`web/` 不得移除品牌） | Next.js/React-TS + Flask/Python；执行引擎已拆独立仓 graphon（纯 Python，Apache-2.0） | **第一参照系**：节点面板组织、iteration/loop/human-input 节点、变量选择器、错误处理 UI；graphon = 后端引擎可直接学 | graphon 可复制；dify `web/` 注意品牌条款 |
| n8n-io/n8n | Sustainable Use（fair-code，非 OSI） | **Vue3 + @vue-flow** / Node-TS | 语义天花板：Agent 子节点挂接、错误三态、表达式引擎、Wait/SplitInBatches | **只学设计，不复制代码** |
| langflow-ai/langflow | MIT | React + **@xyflow/react** + Vite / Python | 同栈双友好：`flow_controls/` 包组织（loop/human_input/conditional_router/sub_flow）、Python 侧 schema 驱动 | 可复制 |
| activepieces/activepieces | MIT（除 `packages/ee`） | **React + @xyflow/react + Radix** / TS | approval piece = 人审产品化最完整参照；loop 为引擎内置；piece 声明式框架 | 可复制 |
| coze-dev/coze-studio | Apache-2.0 | React（Fabric.js 画布）/ Go DDD | 同构产品对照：loop + break/continue 子节点、interrupt-resume、setters 属性编辑器 | 可复制 |
| kestra-io/kestra | Apache-2.0 | Java + Vue | 错误处理教科书（errors 段/allowFailure 降级/局部+全局处理器） | 学语义 |
| windmill-labs/windmill | **AGPLv3** 为主 | Rust + Svelte | 审批/挂起一等公民设计 | **只读，复制触发 copyleft** |
| FlowiseAI/Flowise | Apache-2.0 | — | **已归档（2026-08）**，仅历史参考 | 不投入 |

总体判断：① Dify+graphon 栈匹配且四新节点全有现成实现，首选；② n8n 只学语义（Agent 挂接/错误三态/表达式）；③ Langflow+Activepieces 许可最干净、同 @xyflow/react，可安全借鉴片段；④ coze-studio 形态同构值得通读；⑤ Flowise 放弃、Rivet 降级（MIT 可随意读但偏 IDE）、Node-RED 只读 catch/split 概念。

### 6.2 按关注点的学习路径（核实版）

| 关注点 | 首选 | 核实路径 | 次选 |
|---|---|---|---|
| 节点配置面板 | Dify | `web/app/components/workflow/nodes/<节点>/`（node.tsx + panel.tsx + use-config.ts）+ 共享控件 `nodes/_base/components/`（field.tsx、input-support-select-var.tsx…） | n8n `packages/frontend/editor-ui/src/features/ndv/`（纯 schema 驱动范式，Vue 学范式不学组件）；coze `frontend/packages/workflow/setters/` |
| 循环 | Dify graphon | `graphon/src/graphon/nodes/{iteration,loop}/` + `graph_engine/{iteration,loop}_container_handler.py`（子图容器化执行） | coze `backend/domain/workflow/internal/nodes/loop/`（break/continue 子节点语义最细）；n8n `nodes-base/nodes/SplitInBatches/`（分批断点续跑流派） |
| 等待/人审 | Dify | `graphon/src/graphon/nodes/human_input/`（pause_reason/session_binding/boundary）+ `api/core/workflow/human_input_{policy,adapter,forms}.py` + 前端 `nodes/human-input/`——唯一暂停/会话绑定/表单回填/引擎三层齐备的 React+Python 实现 | activepieces `packages/pieces/core/approval/`（审批产品语义，MIT）；n8n `nodes/Wait/`（webhook/定时/表单三恢复） |
| 错误分支 | n8n（语义） | `packages/core/src/execution-engine/workflow-execute.ts`（停止/继续/错误输出三态 + Retry on Fail）+ `nodes-base/nodes/ErrorTrigger/` | Dify `graphon/.../graph_engine/error_handler.py` + 前端 `nodes/_base/components/error-handle/`；kestra errors 段 |
| Agent 节点 | n8n（语义） | `packages/@n8n/nodes-langchain/nodes/agents/Agent/V3/AgentV3.node.ts` + `packages/workflow/src/interfaces.ts:2836` `NodeConnectionTypes`（ai_tool/ai_memory/ai_languageModel… 类型化连接挂接）+ `AgentTool.node.ts`（agent 再作工具） | Dify `api/core/workflow/nodes/agent_v2/`（策略插件化协议） |
| 变量选择器 | Dify（React 实现） | `nodes/_base/components/{add-variable-popup,input-support-select-var}.tsx` + `variable-inspect/` + 系统/会话/环境三层面板 | n8n `packages/workflow/src/expression.ts`（表达式引擎语义最全） |
| 工具声明式配方 | activepieces | `packages/pieces/framework/` | 对照我们 08 §3 Tool spec |

### 6.3 与基准产品（quickservice）的关系

本总纲的 UI 形态以 quickservice 实测（16/17 号文档）为主参照（我们画布已 1:1 复刻其令牌），开源代码为**机制**参照（循环/等待/错误的运行时语义）。两者冲突时：视觉听 quickservice，机制听开源。

---

## 7. 实施顺序建议（仅建议，待评审后另开实施文档）

- **P0（地基，1 周内）**：x-control 映射表落地（§2.1）+ 校验呈现三处（§2.4）+ # 唤起铺全（§2.2-1）+ 节点描述/图标补齐。全部是前端存量改造，不动后端语义。
- **P1（Agent 族精细化，§5）**：AgentRefPicker + 三节点抽屉重做 + 输入映射表/输出变量表后端契约。
- **P2（控制流，§4）**：error-branch（最小、独立）→ loop → 并行执行 → wait-review（依赖 run 暂停/恢复，最重）→ data-read（与分析任务挂 flow 同期）。
- **贯穿**：§2.3 execution 块随 P2 每个节点同步落地，不单独排期。

---

## 附录 A · 前端文件索引（wf-designer.tsx）

| 区段 | 行号 |
|---|---|
| TYPE_ICON 硬编码图标表 | L127-135 |
| SummaryRows 节点卡摘要 | L187-235 |
| ConditionRows 卡内分支行 | L238-261 |
| WfNodeCard 唯一自定义节点组件 | L263-316 |
| nodeTypes 注册 | L317 |
| VarCascader 变量级联 | L337-400 |
| OPS_BY_TYPE 操作符表 | L402-454 |
| ResourceSelect 通用资源选择器 | L457-489 |
| ConfigDrawer 主体 | L503-1020 |
| memberPool 加载 | L531-541 |
| llm 专项 | L616-706 |
| tool/knowledge/mcp 专项 | L707-754 |
| condition 规则构建器 | L755-850 |
| end 输出绑定 | L851-891 |
| workflow-exec/code/query-rewrite/decision-class | L892-976 |
| agent 族专项 | L978-1013 |
| 通用兜底排除列表 | L1015-1017 |
| GenericSchemaForm | L1023-1106 |
| memory-variable 补丁 | L1088-1103 |
| DebugDrawer | L1109-1144 |
| WorkflowPicker | L1151-1164 |
| MemberPoolPicker | L1210-1246 |
| AgentConfigDrawer（Agent 级，冻结范围） | L1248-1354 |
| families（editor_kinds 过滤） | L1687-1696 |
| issues 传入节点卡（未渲染） | L1656 |
| 顶栏检查 Popover | L1852-1885 |
| ReactFlow 使用处 | L1948 |
| 节点单测对话框 | L2162-2184 |

## 附录 B · 调研缺口与自研决策清单（评审用）

| # | 项 | 级别 | 决策 |
|---|---|---|---|
| 1 | loop 形态 | **决策 08-25** | 单画布回边 + validator 白名单（§4.1） |
| 2 | error-branch 形态 | **决策 08-25** | 节点配置项 + 错误 handle，不新增画布节点（§4.3） |
| 3 | wait-review V1 范围 | **决策 08-25** | 人审 + 定时；外部事件 Future（§4.2） |
| 4 | Agent 节点版本策略 | **决策 08-25** | 最新已发布 + 可钉版本，不回退草稿（§5.3） |
| 5 | tool 重试与节点重试取 max 不叠加 | REC | §3.6 |
| 6 | 数值/布尔/数组操作符集 | REC+调研缺口 | §3.3 |
| 7 | Array 输出存 element schema | REC（调研 11 §5.4 建议） | §2.2 |
| 8 | 画布分组/框选成组 | 调研未覆盖 | 本周期不做 |
| 9 | 循环节点基准形态 | **决策 08-25** | 飞书+开源互证背书；形态同 #1 |
| 10 | llm 增强范围 | **决策 08-25** | 全量：systemPrompt/JSON 示例模式/批处理/AI 润色/测试生成面板（§3.2） |
| 11 | data-read 访问身份 | **决策 08-25** | 仅创建者身份，触发者字段预留（§4.4） |
| 12 | 实施顺序 | **决策 08-25** | P0 地基先（§7） |
| 13 | default-value 失败策略（第四值） | **决策 08-26 待复核** | 原型 ㉔ 四值策略 |
| 14 | HTTP 请求节点 | **决策 08-26** | 本周期不做；tool 配方覆盖，字段入 Future 储备 |

---

## 附录 C · 飞书多维表格公开资料事实表

> 2026-08-25 后台代理抓取飞书帮助中心（暂停决定前已启动，结果自动返回，纳入参照）。与 §5.2 实地观察互证。

### C.1 三层产品形态

- **自动化**：线性 2–4 步、无分支、列表式配置。
- **工作流**：画布式（可缩放/拖拽/重命名），支持条件判断/多分支/**循环**；**AI 节点（AI Agent/AI 分类）只在工作流侧**；另有节点捷径中心。与自动化共享触发器/动作资产与月度额度。
- **多维表格智能体**（2025 v7.73，内测）：第三条线，对话式+事件驱动，六区配置（基础信息/任务指令/触发器/工具/知识库/记忆），分享三级权限（可使用/可编辑/可管理）。
- 对照我们：editor_kinds 过滤（简单/复杂画布分节点集）与飞书"AI/逻辑节点只放复杂侧"同哲学（§1.3）。

### C.2 AI Agent 复合节点（工作流内）

- 主节点：输入指令（⊕ 引用前序数据/表变量/自然时间，≤10,000 字）；自定义输出格式开关（简易模式 = 字段类型+名称+描述｜{ } JSON 示例模式）；回复消息 Stream(beta，仅消息触发)；高级设置 = 系统设定（优先级高于输入指令）+ **最大迭代次数**（工具调用次数上限）。
- 大模型子节点：豆包预置、可切 DeepSeek；生成随机性 0–1、最大回复长度 token、**超时时间 ms**。
- 记忆子节点：读取历史会话次数（仅"接收飞书消息"触发可用）。
- 工具子节点：多个；类型 = 已有工作流节点（发送消息/新增记录/抽签/随机数…）+ 预置 MCP（使用身份：当前用户/流程触发者 + 工具列表启用）+ 自定义 MCP（描述、Streamable HTTP/SSE、地址、鉴权 无/Header/Bearer）。
- 输入 ⊕ 分层引用（"1. 接收到飞书消息时 > 消息内容"）；输出以"2. AI Agent"被下游引用。

### C.3 其它 AI 节点

- **AI 生成文本**（自动化+工作流）：⊕ 引用字段（黑名单：附件/条码/按钮字段）；**Prompt 润色按钮**（替换/重试/取消）；**测试生成面板**（测试数据可生成/替换/手改 + 预览 + 重新生成）；输入上限 8,192 UTF-8 字符；显式报错表（超限/空指令/敏感词/引用字段被删/token 超限/限流每小时 1,800 次）。
- **AI 分析**（内测）：分析任务（自然语言 + ⊕ 引用）；分析数据范围（多选数据表）；**数据访问身份（触发者/创建者）**；参考资料（≤10 文件 ≤10MB）；输出要求（风格描述或云文档链接模板）。
- **AI 分类**（仅工作流，内测）：见 §3.3 强化项。官方对比：AI 分类 = LLM 动态判断；多分支 = 严格预设条件取首个命中。
- **AI 字段捷径**（表格层）：预置 6 捷径（分类/翻译/智能标签/信息提取/总结/自定义自动填充）；输入字段必填 + 自动更新开关 + **"生成前 5 行"预览再全列应用**；输出类型固定映射；自定义填充输出可选 文本/数字/单选/多选/日期；DeepSeek 捷径支持 BYO key。

### C.4 触发器与变量机制

- 触发器：新增/修改记录、满足条件、到达记录时间、定时、点击按钮、webhook、飞书消息、Outlook 邮件。
- 智能体触发器：**AI 筛选规则**（自然语言条件，与勾选规则同时满足）、默认回复兜底、工具自动挂载（消息触发→飞书消息工具；记录变更→记录管理工具）、运行身份规则、同事件多触发器独立运行、创建人失权触发器自动失效。
- 变量引用：⊕ 分层选择器"前序步骤 > 字段"；消息触发变量集（消息ID/类型/内容/附件/发送人/时间/提及成员/来源群组）。

### C.5 开放平台边界

- 无服务端 API 创建/管理自动化或工作流节点；扩展走前端插件 `addAction`（FormItem 表单组件清单 / Context 执行上下文 / ResultType 输出定义 / testAction 本地模拟）——对照我们 08 §3 Tool 声明式配方与工具测试端点。

### C.6 来源 URL（核心）

- 工作流 vs 自动化：feishu.cn/hc/zh-CN/articles/470261575139
- 触发与操作一览：…/740947703250
- AI Agent 节点：…/643175485940（英文 Lark：…/780255521788）
- AI 生成文本：…/902812682257
- AI 分析：…/053888024514
- AI 分类：…/843535382074
- AI 字段捷径：…/464880997049
- 智能体搭建：…/333906895867；智能体触发器：…/610686468172
- v7.73 发布：…/822750267735

> 注：Base Agents 文档仅飞书中文区存在，Lark 国际版未发布。

---

## 附录 D · 节点交互逐节点评审台账（08-25 与用户逐条确认）

| 节点 | 画布归属（确认） | 状态 | 备注 |
|---|---|---|---|
| input | 三Kind | 通过 | |
| end | 三Kind | 通过 | |
| llm | FLOW+WORKFLOW | 通过 | 含 systemPrompt/JSON 示例模式/批处理/AI 润色并入单测 |
| condition | 三Kind | 通过 | |
| decision-class | FLOW+GROUP+WORKFLOW | 通过 | 全局规则+无匹配二选一+每分类 handle |
| transform | FLOW+WORKFLOW | 通过 | |
| query-rewrite | FLOW+GROUP+WORKFLOW | 通过 | |
| code-write | FLOW+GROUP+WORKFLOW | 通过 | 输入绑定加 ⚙ 引用 |
| tool | FLOW+WORKFLOW | 通过 | 画布卡=工具名+版本 |
| mcp-call | FLOW+WORKFLOW | 通过 | args 按 inputSchema 动态表单 |
| knowledge-retrieval | FLOW+WORKFLOW | 通过 | |
| workflow-exec | FLOW+WORKFLOW | 通过 | 画布卡=子流程名+版本 |
| workflow-select | FLOW+WORKFLOW | 通过 | 画布卡=候选数+已选名 |
| workflow-fixed | FLOW+WORKFLOW | 通过 | 版本策略+画布卡 |
| create-record | 三Kind | 通过 | 画布卡=输出 key |
| notification | 三Kind | 通过 | 画布卡=消息截断 |
| reply | FLOW+WORKFLOW | 默认提案待复核 | WORKFLOW 页写 run 事件日志（用户跳过该题） |
| memory-variable | FLOW+WORKFLOW | 默认提案待复核 | 写绑定支持 ⚙ 引用（用户跳过该题） |
| loop | FLOW+WORKFLOW | 通过 | 草图确认 |
| wait-review | FLOW+WORKFLOW | 通过 | |
| error-branch | 配置项 | 通过 | |
| data-read | WORKFLOW | 通过 | |
| agent | 退役 | **合并退役** | → workflow-fixed（08-25 决策，§5） |
| agent-select | 退役 | **合并退役** | → workflow-select |
| agent-exec | 退役 | **合并退役** | → workflow-exec 动态模式 |

> "workflow 跑全部类型节点"决策已落入本表：WORKFLOW 页补入 reply/memory-variable/workflow-select/workflow-fixed/query-rewrite/code-write/decision-class 等。
