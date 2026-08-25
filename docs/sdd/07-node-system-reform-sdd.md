# 07 · 工作流节点体系改造 SDD（实施契约）

> 状态：**待用户确认，确认前不开工**（2026-08-26）
> 上位材料：`06-workflow-node-master-spec.md`（讨论稿）、`prototypes/node-master-spec-prototype.html` v3（24 屏）、`docs/research/lightweight-workflow-system/`（01–17）、Dify/n8n 字段级对账（08-26）
> 冲突裁决：本文档与 06 不一致处以本文档为准；视觉令牌以 16-ui-replication-spec 为准。
> 证据分级沿用：[实测]=我们/基准产品实测；[对账]=Dify(Apache-2.0)/n8n(fair-code 只读)源码对账；[决策]=用户拍板（附录 A 台账）。

---

## 1. 背景与目标

三轮讨论（08-25/26）定案：不换 n8n；**workflow 为主干**，跑全部类型节点；Agent 模块冻结；Agent 族三节点**改挂已发布工作流版本并合并退役**；节点按"原型→交互细节→开发"闸门推进。

目标：把 21 节点体系改造为 **22 节点**（−3 退役 +4 新增），全部节点 UI/交互/后端达到原型 v3 与本文字段级规格；执行器补齐控制流（loop/wait-review/error-branch/data-read/并行）。

非目标（本周期不做）：HTTP 请求节点（tool 声明式配方覆盖，字段入 Future）；Agent 模块新功能；画布分组/框选成组；跨会话记忆；元数据过滤（knowledge）；memory/vision 分区（llm）。

---

## 2. 决策台账（摘要，全量见附录 A）

| # | 决策 | 日期 |
|---|---|---|
| D1 | workflow 编辑页跑全部类型节点 | 08-25 |
| D2 | 错误分支=节点配置项+error handle，非画布节点 | 08-25 |
| D3 | wait-review V1=人审+定时（外部回调预留） | 08-25 |
| D4 | loop=单画布回边（body/done），validator 白名单 | 08-25 |
| D5 | Agent 节点版本=最新已发布+可钉，不回退草稿 | 08-25 |
| D6 | llm 全量增强（systemPrompt/Schema 编辑器/批处理/润色/测试生成并入单测） | 08-25 |
| D7 | data-read 仅创建者身份，触发者预留 | 08-25 |
| D8 | Agent 族改挂工作流 + 合并退役 agent/agent-select/agent-exec | 08-25 |
| D9 | P0 地基先实施（已完成） | 08-25 |
| D10 | HTTP 节点不做；default-value 失败策略**待复核**（默认不做，复核通过才进 P2） | 08-26 |
| D11 | 实施闸门：原型确认→交互细节确认→开发 | 08-26 |

**待复核项**（随本 SDD 一并确认）：① default-value 第四失败策略；② reply 在 WORKFLOW 页写 run 事件日志；③ memory-variable 写绑定 ⚙ 引用。未获确认则按括号内默认执行。

---

## 3. 目标体系

### 3.1 节点账本（22）

| type_key | 族 | 画布 FLOW/GROUP/WORKFLOW | executor | 状态 |
|---|---|---|---|---|
| input / end / condition | 边界/逻辑 | ✓✓✓ | 现有 | 增强 |
| llm | 智能 | ✓ ✗ ✓ | exec_llm | 全量增强 |
| decision-class | 逻辑 | ✓✓✓ | exec_decision_class | 增强 |
| transform | 数据 | ✓ ✗ ✓ | exec_transform | 增强 |
| query-rewrite / code-write | 数据/代码 | ✓✓✓ | 现有 | 增强 |
| tool / mcp-call / knowledge-retrieval | 外部 | ✓ ✗ ✓ | 现有 | 增强 |
| workflow-exec / fixed / select | 外部 | ✓ ✗ ✓ | 现有 | 增强（吸收 Agent 族） |
| create-record / notification | 副作用 | ✓✓✓ | 现有 | 增强 |
| reply / memory-variable | 对话/记忆 | ✓ ✗ ✓ | 现有 | 增强（待复核②③） |
| **loop** | 逻辑 | ✓ ✗ ✓ | exec_loop（新） | 新增 |
| **wait-review** | 边界 | ✓ ✗ ✓ | exec_wait_review（新） | 新增 |
| **data-read** | 数据 | ✗ ✗ ✓ | exec_data_read（新） | 新增 |
| agent / agent-select / agent-exec | — | 退役 | 兼容层保留 | 退役 |

error-branch 为配置项（`execution.onError`），非节点。并行执行为执行器行为，非节点。

### 3.2 公共机制（所有节点适用）

1. **execution 块**（写入节点 config，schema 进 `contracts/workflow-definition.schema.json`）：
   `{timeoutMs, retry:{enabled,maxRetries,intervalMs}, onError:"fail"|"skip"|"branch"|"default"}`；HTTP 类（tool/mcp-call/data-read）retry 默认 `{true,3,100}`；onError="default" 时附 `defaultValues:{outputKey:value}` [D10 待复核]。
2. **x-control→组件映射**（P0 已落地，保持）：prompt-editor/expression-editor→PromptArea；variable-picker→VarButton；tool/knowledge/mcp-picker→ResourceSelect；mcp-tool-picker→Select(discovered)；workflow-picker(-multi)；agent-picker(-multi)；code-editor→CodeMirror。
3. **变量系统**：VarCascader 增加子属性级联（object 按 element schema 展开，Array 存 element schema）；类型过滤；来源节点名显示（已有）。
4. **校验呈现三处**（P0 已落地）+ 首条错误上卡 hover + 面板 warningDot。
5. **面板公共机制**[对账]：Test Run 覆盖层（引用变量自动生成输入、预填、无输入自动跑）；底部统一输出变量区（可折叠+子字段树）；notice 内联引导；画布卡 subtitle 回显（tool "名·vN"、wait 恢复 URL、loop "源·i/total"）。
6. **视觉**：16 号令牌；shadcn 原生组件（§7.1 映射表）；中性画布（§8.5）。

---

## 4. 逐节点规格（字段级）

> 控件列均为 shadcn 原生（映射见 §7.1）。"保持"=现状已验收不重做。

### 4.1 input（开始）
变量表：名｜类型(Select)｜必填(Switch)｜描述(Input)；预置 6 项（userQuery/chatHistory/userId/conversationId/chatId/reference）锁定；＋添加自定义。校验 R1 恰一个。卡=6 变量 chip（已实现）。

### 4.2 end（结束）
输出绑定表：名｜类型｜值（固定 Input / ⚙ VarCascader 切换）＋添加；结构化输出绑定状态区（key←产出节点，R6）。保持+状态区新增。

### 4.3 llm（大模型）[D6]
| 字段 | 控件 | 默认 | 必填 |
|---|---|---|---|
| modelRef | Popover（能力 chip+check） | — | ✓ |
| systemPrompt | PromptArea（# 唤起） | 空 | ✗ |
| prompt | PromptArea | — | ✓ |
| outputFormat | ToggleGroup Markdown｜JSON Schema | Markdown | ✓ |
| outputSchema | Schema 编辑器（名/类型/描述，object 嵌套/array items/enum）[对账 Dify structured_output] | — | outputFormat=JSON 时✓ |
| 批处理 | ToggleGroup 单次｜批处理；批=批量变量(VarCascader 限 Array)+最大批次(100)+并发(10)→outputList | 单次 | ✗ |
| execution | 健壮性分区（§3.2） | 60s/retry0/fail | ✓ |
交互：切换模型自动清洗非法参数+toast 列出移除项[对账]；润色按钮（替换/重试/取消）[对账飞书]；测试生成并入 Test Run 覆盖层。卡=模型/提示词/输出三 chip 含 answer。

### 4.4 condition（条件判断）
保持规则构建器（分支增删/拖拽/AND-OR/双模值/else 固定）。增强[对账]：操作符族补 `in/not_in/exists/not_exists/is_null/is_not_null`（按 variableType 过滤）；object/file 子属性条件（左值选子路径）；高级开关 ignoreCase(默认开)/looseTypeValidation；分支名可编辑（handle 标签与卡行跟随）。校验 R7+字段级红框（已有）。

### 4.5 decision-class（决策分类）
分类项列表 2–10（名+描述）增删；全局分类规则 Textarea（可选）；无匹配 ToggleGroup 归"其他"｜节点失败；每分类+其他 各一 source handle（卡行替换 c{i}）。输出 classificationTitle/Id。

### 4.6 transform（变量处理）
处理模式 ToggleGroup 聚合｜拼接；输入表 ⚙；模板 PromptArea（已实现）；输出变量表（declared）。

### 4.7 query-rewrite
策略 Select default｜custom；custom→改写 PromptArea；输入绑定 query/chatHistory；输出 queryList。

### 4.8 code-write
CodeMirror（python，10s 沙箱）；模式 ToggleGroup 全量一次｜逐条执行[对账 n8n Code]；⇄同步函数签名（解析 main 参数回填输入表、return 键回填输出表）[对账 Dify code]；输入绑定 ⚙ 升级；输出变量表；标题栏 AI 生成按钮[对账]。

### 4.9 tool（插件工具）
ResourceSelect；版本策略 Select 最新 Ready｜钉版本；参数表按 spec params 动态渲染，每参数 ToggleGroup 常量｜变量[对账 Dify ToolVarInputs]；Settings 折叠分区；未授权整面板=授权按钮；输出=spec schema 树。卡=名·vN。

### 4.10 mcp-call
Server ResourceSelect；工具 Select(discovered)；参数按 inputSchema 动态表单（替换裸 object Textarea）。

### 4.11 knowledge-retrieval
知识源 ResourceSelect；query PromptArea；topK；检索模式 ToggleGroup 单路｜多路；多路=score_threshold+rerank Switch[对账]；元数据过滤预留不实现；输出 slices/sources。

### 4.12 workflow-exec（吸收 agent-exec）
ToggleGroup 固定｜动态；固定=WorkflowPicker；动态=workflowCode 输入绑定行；版本策略 Select；子 Run 挂 Trace（已有）。卡=绑定来源。

### 4.13 workflow-fixed（吸收 agent）
WorkflowPicker；版本策略 Select（最新已发布｜钉版本，不回退草稿 [D5]）；**输入变量映射表**（标准开始变量行预置同名透传，⚙ 可改可清空，＋添加）；输出变量表（jsonPath 抽取）。卡=名·vN·输入数。

### 4.14 workflow-select（吸收 agent-select）
query 输入绑定行（默认 userQuery）；candidates 多选卡（P0 已实现）；路由模型 Select（默认 qwen-plus）；超时 10s 失败走 else；组合校验候选非空。卡=候选数+已选名。

### 4.15 create-record / notification / reply / memory-variable
create-record：outputKey Select（来自 io.structuredOutputs，替换 Textarea）+幂等说明；notification：message PromptArea+渠道 ToggleGroup 日志｜webhook(置灰)；reply：content PromptArea+去向说明（FLOW 对话流/WORKFLOW run 日志 [待复核②]）；memory-variable：mode ToggleGroup 读｜写，读=keys 多选 chip，写=keys+绑定表 ⚙[待复核③]，run 内作用域。

### 4.16 loop（新增）[D4]
| 字段 | 控件 | 默认 |
|---|---|---|
| iterator_selector | VarCascader 限 Array | — ✓ |
| item/index 变量名 | Input | item/index |
| loop_variables | 列表（名/类型/初始值）＋添加 [对账] | [] |
| break_conditions | 条件构建器（限体内子节点变量）+AND/OR [对账] | [] |
| maxIterations | Input+Slider 联动 | 1000 |
| is_parallel/parallel_nums | Switch+Input/Slider(2–10) | false/10 |
| error_handle_mode | Select Terminated｜ContinueOnError｜RemoveAbnormalOutput [对账] | Terminated |
| flatten_output | Switch | true |
画布：body/done 双 source handle；回边合法环（validator 白名单：仅 loop 的 body 回边入环）；卡=源+进度环 i/total+subtitle。输出 outputList/successCount/failCount。执行语义：每轮注入 item/index/loop_variables 执行体子图；每轮一条子 NodeRun（Trace 嵌套）；ContinueOnError 单条失败记 failCount 继续；运行详情容器日志（逐轮状态/失败项）[对账 iteration-log]。

### 4.17 wait-review（新增）[D3]
| 字段 | 控件 | 默认 |
|---|---|---|
| resume_mode | ToggleGroup 人审表单｜定时间隔｜指定时刻｜外部回调(置灰) | 人审 |
| form_content | PromptArea(markdown，可预览) | — |
| form_fields | 类型化列表 paragraph｜select｜singleFile｜multiFiles（扩展名白名单/数量上限）[对账 Dify human-input] | [] |
| user_actions | 按钮列表（title+style primary/default/accent/ghost）＋添加 | [通过(primary),驳回(default)] |
| amount+unit | Input+Select(hour/day) | 24/hour |
| timeout_policy | Select 自动通过｜自动驳回｜升级 | 升级 |
| 定时模式 | 时长 Input 或 cron Input（复用 compute_next） | — |
输出 decision/comment/waitedMs；pass/reject 双 handle；Run.status=paused；恢复 `POST /api/runs/{id}/resume {action, values}`（幂等键 run_id+node_id 防双恢复）；恢复 URL 运行时生成、卡 tooltip 回显[对账 n8n Wait]；卡=橙环+"待审核"。

### 4.18 data-read（新增）[D7]
资产 ResourceSelect(types=asset)；窗口 Select(last_24h/7d/30d/custom 双日期)；抽样 Select(all/random_n/stratify+n)；范围过滤（单字段 eq/contains 简化行）；访问身份 ToggleGroup 创建者｜触发者(置灰)；输出 rows:Array+count。触发参数（AnalysisTask 挂载时）注入 run_input 可覆盖。

---

## 5. 后端改造

1. **registry.py**：新增 loop/wait-review/data-read 定义（schema/io/editor_kinds/icon/accent/描述）；22 节点 editor_kinds 按 §3.1 矩阵；agent 三键标 `deprecated:true`（palette 不显示，兼容层可执行）。
2. **runner.py**：
   - execution 块统一拦截：wait_for 超时、retry（仅 retryable：5xx/timeout/连接错误）、onError 分派（fail 现状/skip 记 skipped/branch 写 error 输出激活 error handle/default 写 defaultValues 继续）。
   - exec_loop：容器状态机（参照 graphon iteration/loop_container_handler 语义自研）；并发走 ready 队列并发消费（并发上限配置项默认 8）。
   - exec_wait_review：paused 落盘（NodeRun status=waiting，Run.status=paused）；resume 端点重入队续跑（outputs 已落库，从该节点继续）。
   - exec_data_read：DataAsset 存储层取数+窗口/抽样。
   - error 输出引用：`{{nodeId.error.message|code|retryable}}` 进 resolve 路径。
3. **validator.py**：loop 回边白名单（R2 特判）；onError=branch 必须有 error 出边；wait-review 表单/超时必填；data-read 资产必填；迁移后图 agent 三键不存在（旧图先改写再校验）。
4. **迁移改写器**（加载/保存时一次性）：agent→workflow-fixed（agentCode→workflowId：成员有底层 workflow 取最新已发布，否则节点标失效引导重选）；agent-select→workflow-select（primaryAgents→candidates，fallback→else 语义）；agent-exec→workflow-exec 动态模式。已发布 AgentVersion 含旧键的运行时走兼容 executor（标 deprecated）。
5. **models/API**：Run.status 增 paused/waiting 语义；`POST /api/runs/{id}/resume`；node execution 块进 definition schema；run_event 增 node_retry/run_paused/run_resumed/loop_progress。

---

## 6. 前端工程

### 6.1 shadcn 映射（原生组件，禁手搓）
ToggleGroup=segmented；Select=下拉；Checkbox=多选卡；Popover+VarCascader=级联；**Slider**（并行度，库存有 designer 未引）；**Table**（参数/映射表，可选替换 plain table）；Switch/Badge/Tooltip 库存；PromptArea/ResourceSelect/WorkflowPicker/Section 复用 P0 组件。

### 6.2 文件拆分（搬移式，非重写）
`src/components/wf/` 拆出：var-cascader.tsx、prompt-area.tsx、resource-select.tsx、workflow-picker.tsx、node-card.tsx、cond-builder.tsx、schema-form.tsx、robustness-section.tsx、output-vars.tsx、test-run-overlay.tsx、schema-editor.tsx、form-fields.tsx、per-node drawers/（llm.tsx、loop.tsx、wait-review.tsx、tool.tsx、workflow-trio.tsx、…）。wf-designer.tsx 保留画布/顶栏/工具条/路由壳。

---

## 7. 实施阶段

- **P0（已完成 08-25）**：x-control 映射、# 唤起铺全、校验三处、描述/图标、e2e 脚本 check-p0-nodespec.mjs。
- **P1**：§6.2 拆分 → editor_kinds 矩阵 → 4.1–4.15 增强节点 → 迁移改写器 → Test Run/输出区/notice/subtitle → **24 屏基线采集（人工比对通过后入库）→ 视觉回归闸门生效（§9）**。
- **P2**：loop → error-branch（含 default-value 若复核通过）→ 并行 → wait-review → data-read → 容器日志/resume UI → **基线增量更新（人工确认后 --update-baseline）**。

---

## 8. 验收标准（DoD：每条须给三类证据之一：[e2e]脚本断言 / [api]命令+输出 / [manual]步骤+screenshot 存档 /tmp 或 docs 附件；另加全局 R 项）

### 8.1 P1 验收
| # | 项 | 验证 |
|---|---|---|
| A1 | WORKFLOW 页 palette 含全 22 节点（退役三键不出现）；FLOW/GROUP 按矩阵 | [e2e] check-p1-matrix.mjs：三画布 palette innerText 断言 |
| A2 | 22 节点抽屉头部一句描述（无"节点配置"兜底）；图标无 Braces 回退 | [e2e] 逐节点打开断言 innerText |
| A3 | 校验三处同源：卡红点计数=抽屉 issue 数=顶栏角标 | [e2e] 未配置 loop 节点断言三处数值一致 |
| A4 | workflow-fixed 映射表 ⚙ 引用写入 config；钉版本后 run 用钉住版本 | [api] POST runs 后 GET run detail 断言 workflowVersionId |
| A5 | workflow-exec 动态模式：workflowCode 绑定路由输出执行对应子流程 | [e2e] select→exec 链 run 成功且子 run 目标正确 |
| A6 | workflow-select 路由模型可配；候选空校验进检查清单；未命中走 else | [api] 构造不匹配 query run 断言 else 分支节点 executed |
| A7 | 迁移改写：旧 agent 三键草稿 GET 返回 workflow 三键；旧已发布版本 run 成功（兼容层） | [api] 造旧格式 draft→GET 断言 type_key；旧 published run 断言 succeeded |
| A8 | llm systemPrompt 生效（trace 含 system message）；Schema 编辑器存嵌套；切模型清洗 toast | [api] run trace 断言；[manual] toast screenshot |
| A9 | tool 每参数常量/变量双模式存 config；未授权态=授权按钮 | [e2e] 断言 config JSON；[manual] 未授权工具 screenshot |
| A10 | condition 新操作符 in/exists 可选可存；子属性条件；分支名同步 handle 标签 | [e2e] 断言 branches JSON 与卡行文案 |
| A11 | code-write 同步签名回填输入/输出表 | [e2e] 写两参 main→点同步→断言表行数 |
| A12 | Test Run 覆盖层按引用自动生成输入项；无输入自动跑 | [e2e] llm 单测断言 userQuery 输入存在 |
| A13 | 健壮性分区全节点可见；retry 生效（失败工具 node_run 含 node_retry 事件） | [api] mock 5xx 工具 run 断言事件序列 |
| A14 | 输出变量区/notice/subtitle 呈现 | [e2e]+[screenshot] |

### 8.2 P2 验收
| # | 项 | 验证 |
|---|---|---|
| B1 | loop：rows=5 run 成功，outputList.length=5；failCount 正确（1 条必失败+ContinueOnError）；break 提前退出；并行 2 时事件交错 | [api] run 断言输出与 run_event 序列 |
| B2 | loop 回边非法环被 validator 放行、普通环仍报错 | [api] 两图 validate 断言 ok/issue |
| B3 | wait-review：run 到节点 status=paused 卡橙环；resume pass 续跑 pass 分支；reject 走 reject；双 resume 幂等；超时自动驳回（amount=1min 测试） | [api]+[e2e screenshot] |
| B4 | error-branch：onError=branch 失败走 error 下游 run succeeded；=skip 下游继续；=default 输出默认值（若复核通过）；选 branch 无 error 边进检查清单 | [api] 三 run 断言 |
| B5 | data-read：10 行资产 random_n=3 → rows.length=3；窗口过滤生效 | [api] 断言 |
| B6 | 并行执行：两独立 llm 节点总耗时 < 串行和（或 node_started 交错） | [api] 事件时间戳断言 |
| B7 | 容器日志：run 详情 loop 逐轮状态/失败项可见 | [e2e screenshot] |

### 8.3 回归（全阶段必过）
| # | 项 | 验证 |
|---|---|---|
| R1 | 复刻验收 e2e-p0.mjs 全绿（15 项） | [e2e] 输出全 true |
| R2 | check-p0-nodespec.mjs 全绿 | [e2e] |
| R3 | server pytest 全绿（97/97 基线不降） | [api] `pytest -q` 输出 |
| R4 | tsc 0 错 + build 通过 + console 无新增 error | [e2e] 脚本 errors 数组对比基线 |
| R5 | 存量已发布 workflow（含旧 agent 键）run 成功 | [api] 抽样 3 个 run |
| R6 | 原型 v3 24 屏与实现逐屏 screenshot 比对无结构差异 | [manual] 比对表 |

**开工前置**：本 SDD 获用户确认 + 待复核①②③获答复。

---

## 9. 视觉回归与组件标准验证（防"偷偷手搓组件 / UI 劣化"）

### 9.1 组件标准静态检查
`scripts/check-ui-standard.mjs` 扫 `src/**/*.{ts,tsx}`，命中即 fail：
- 原生 `<select`/`<option`；裸 `<input`/`<textarea`（必须 `@/components/ui/*`）；`window.alert/confirm/prompt`；
- 手搓弹层（`fixed inset-0`+遮罩 onClick 启发式，须 Dialog/Sheet/Popover）；手搓 switch/checkbox/radio（`role="switch"` 等自绘启发式）。
- **存量豁免**：`scripts/ui-allowlist.json` 记录历史遗留命中，规则为**只减不增**；新命中一律 fail。
- **组件台账**：`src/components/` 下新增文件必须已登记 §6.2 清单（脚本比对目录与清单，未登记 fail）；新 UI 原语一律走 shadcn（ui/ + radix），业务组件只许落 `components/wf/`。
- 验证：[static] `node scripts/check-ui-standard.mjs` exit 0，输出违规 ⊆ allowlist。

### 9.2 视觉基线回归
- 基线库 `scripts/visual-baseline/*.png`：P1 完成且**人工与原型 v3 比对通过**后，采集 24 屏（画布总览 + 22 节点抽屉 + 校验三处）入库随 commit。
- `scripts/check-visual-regression.mjs`（puppeteer-core + pngjs + pixelmatch，均 MIT 小依赖）：同 24 屏逐像素 diff，**单屏差异率 ≤ 0.5%** 判过；故意设计变更须人工确认 → `--update-baseline` 更新并随 commit（commit message 引 SDD 条目）。
- 验证：[e2e] 脚本 exit 0 + diff 热图存 /tmp 供抽查。

### 9.3 设计令牌 DOM 断言（数值化防劣化）
e2e 内 `getComputedStyle` 断言（16 §1 令牌）：画布底 `#EEF1F6`、点格 `#D9DEE7`/16px、节点卡宽 300/圆角 8/边框 `#EDF0F4`、图标基底 `#1F2329`（中性画布，禁彩虹）、抽屉宽 360、主色 `#3D6BFF` 仅用于运行/链接/选中、错误 `#F56C6C`、chip 底 `#F1F3F7` 字 `#7A8699`、未配置 `#B9C2CF`。任一不符 fail。

### 9.4 逐屏人工比对闸门
- 每阶段完工交付必附：该阶段屏 vs 原型 v3 对应屏的比对表（截图左右并列），用户签字（R6 强化为每阶段强制）。
- 新节点/新交互先补原型屏并获确认才允许开发（D11 闸门工具化）。

### 9.5 验收项补充
| # | 项 | 验证 |
|---|---|---|
| V1 | 组件标准静态检查全绿，allowlist 只减不增 | [static] 脚本输出 |
| V2 | 24 屏视觉回归差异 ≤0.5% | [e2e] 脚本+热图 |
| V3 | 令牌 DOM 断言全过 | [e2e] 断言输出 |
| V4 | 组件台账登记检查过 | [static] |
| V5 | 阶段人工比对表签字 | [manual] 用户确认 |

---

## 附录 A · 决策与待复核全量台账
（D1–D11 见 §2；逐节点交互确认台账见 06 附录 D；待复核：①default-value（默认不做）②reply WORKFLOW 写 run 日志（默认按提案）③memory 写绑定 ⚙（默认按提案）。）

## 附录 B · 风险与回滚
- 迁移改写器以 draft 加载时改写、保存落盘；提供 query 参数 `?raw=1` 读原始图用于回滚核对；兼容 executor 保留至少一个发布周期。
- loop/并发以配置项限流（并发上限 8、maxIterations 1000）防失控。
- 每阶段独立 commit；P2 各节点可单独 feature-flag 关闭（registry enabled 覆盖，08 §1 运维启停机制已有）。
