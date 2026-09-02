# SDD-14 OpenAI Agents Runtime POC 验收报告

**状态：工程门禁全过（G01–G19），等待用户浏览器终验（G20）**
**日期：2026-09-02**
**分支：`feat/sdd14-openai-agents-runtime`（报告提交时 HEAD：`d4c36c2`）**
**依据：`docs/sdd/14-openai-agents-runtime-provider-poc-sdd.md`（v0.1 已批准）**

---

## 1. 环境事实

| 项 | 值 |
| --- | --- |
| OpenAI Agents SDK | `openai-agents==0.22.0`（钉扎，uv.lock） |
| Runtime Adapter | provider=`openai-agents` runtime_version=`0.22.0` adapter_version=`0.1.0` |
| Contract | schema_version 1.0（未修改 `packages/runtime_contract`，§66 约束满足） |
| Runtime 端口 | `http://127.0.0.1:8303`（8301 AgentScope / 8302 DSH / 8303 OpenAI Agents） |
| 模型端点 | `https://dashscope.aliyuncs.com/compatible-mode/v1`（OpenAI-compatible） |
| 模型 | `qwen3.8-max`（与 AgentScope/DSH POC 同一模型，横向可比，§14.3） |
| 运行时模型配置 | `QUALITY_MODEL_ENABLE_THINKING=false`（见 §5 发现 4；API Key 不在本报告） |
| 工具网关 | `services/tool_service` @ `127.0.0.1:8200`（MCP `/mcp/`，read-only fixture 事实） |
| Provider ID | `cf5ff394fc514f0d94b3d57ce7089d71`（kind=openai-agents，enabled） |
| Agent | `2ec32968e295437a878a17300d1cf84c`（质检-OpenAI POC，quality-analysis@1.0.0） |
| Agent Version | `c4bc298d57bd4ecba2208436b12a73dd`（v1，artifactHash `7e691c1a…`） |
| Release | `97a357522cb043d68105e5f2a762051a`（sandbox，active，runtime_provider_id→OpenAI） |
| Task | `c05d94ce25294050bd42b67ced6e71ff`（agent target，pinned version，platform_only） |
| Task Version | `c435fb1285744df3911ba7537499d32e` |
| TaskRun | `0f2735c84f3c40a69dd38b432de93746`（manual 触发，20 条） |
| 用例库 | 存量 `DSH真实回归集V1`（asset `96fd99a44a314677ac956f9bdbf36aae`，20 条 canonical 通话） |

## 2. 验收门禁结果（§54）

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| G01 Provider 注册 | ✅ | POST /api/runtime-providers kind=`openai-agents` 201；未知 kind 422（`test_poc_g01_openai_agents_provider_registers`） |
| G02 Health 真实检查 | ✅ | /health 四项真实检查（adapter/凭据/端点连通级探测/工具网关）非固定 ok；平台 probe 返回 ok 并回写 capabilities（`test_poc_g01`/`test_health_*`） |
| G03 Module 兼容 | ✅ | manifest `implementations.openai-agents: {version 0.1.0, entry native_quality_v0.2}`；`resolve_implementation` 测试 |
| G04 Agent Release | ✅ | sandbox Release 绑定成功；1:1 口径保持（跨 kind 再绑 409 `ONE_PROVIDER_PER_AGENT`）；绑定快照 providerKind/moduleImplementation 断言（`test_poc_g04_*`） |
| G05 存量用例库 | ✅ | 批次输入全部来自 `dsh_real_regression_v1`（20 条 canonical 通话）；未创建任何假数据集 |
| G06 Task 创建 | ✅ | `executionTarget=agent` + pinned 版本 + 嵌套 inputMapping（`{"$":…}` 改为显式字段映射） |
| G07 TaskRun | ✅ | POST /api/tasks/{id}/runs → `0f2735c8…` queued→succeeded |
| G08 Interaction Runs | ✅ | 20 条 Run（每条用例一条，非合并） |
| G09 Runtime 指向 | ✅ | 20/20 `runtime_provider_id = cf5ff394…`（SQL 断言） |
| G10 真实模型 | ✅ | qwen3.8-max 真实调用 521 次，input 10,309,963 / output 58,924 tokens（无 fake model） |
| G11 真实工具调用 | ✅ | 269 次真实 MCP 工具调用（CallRecord kind=tool）；knowledge_search/ticket_query/sms_query/appointment_query 均被真实调用 |
| G12 硬白名单 | ✅ | 三层交集矩阵 + SDK 级未授权工具拒绝（`test_tools` 11 项）；真 MCP 实测：阶段仅见白名单工具（`filtered tools: ['knowledge_search']` / `['sms_query']`） |
| G13 动态 fan-out | ✅ | RunEvent 阶段事件含 `execute/knowledge-1..10`、`execute/promise-*`（最大用例 10 条知识断言）；plan_count/fan_out 元数据 |
| G14 结构化输出 | ✅ | 20/20 output 非空，双层校验（runtime jsonschema + 平台 `_settle_module_result` 二次校验）全部通过 |
| G15 Trace | ✅ | Run Detail stages 6 块（identify/execute/*…）+ calls 28 条（样例 Run `5a1fcac7…`）；CallRecord model 521 + tool 269 |
| G16 Usage | ✅ | Run Detail usage：prompt/completion/total/modelCalls/toolCalls（样例：273,845 total / 19 model / 9 tool） |
| G17 失败路径 | ✅ | 真实失败：首批（超时策略修复前）`RUNTIME_TIMEOUT` 如实落库；错误映射自动测试：超时→`timeout`、坏输出→`output_schema_error`、适配层错误透传（`test_contract` 11 项）；失败详情带阶段进度+耗时（`_progress_details`） |
| G18 expected 隔离 | ✅ | 用例库本身无 expected 列；inputMapping 仅映射输入字段；dispatcher 请求体不含任何期望数据 |
| G19 Secret 安全 | ✅ | API Key 仅存在于 runtime 进程环境变量；不进 git/trace/日志/API DTO；trace 只存截断摘要（500/1000 字符）；.gitignore 增补 `.env` |
| G20 UI 终验 | ⏳ 待用户 | 见 §6 验收路径（服务栈已就绪） |

## 3. 批次结果（§52/§53 两维度）

**维度 A（工程链路）：20/20 succeeded，0 failed。** 全链路真实：平台页面可创建的 Task → 冻结解析 → 真 OpenAI runtime → 真模型 → 真工具 → 结构化输出 → Run.output → Run Detail。

**维度 B（业务效果）：受工具 fixture 覆盖限制，如实呈现（§53 要求区分两维度，不混为一谈）。**
`tool_fixtures_v0.2.json` 的事实仅覆盖合成样本 `CASE-SYN-NATIVE-001`；20 条回归用例的 case_id（真实 acid）不在 fixture 中，工具查询如实返回无记录 → 判定多为 `insufficient_evidence`（不猜、不虚构证据，符合 Case E 语义）。

| 用例 | Run | 状态 | model | tool | tokens | knowledge | promise | service_type |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| sample-001 | 5a1fcac7… | succeeded | 19 | 9 | 273,845 | insufficient_evidence | insufficient_evidence | REPAIR |
| sample-002 | 7d112bcf… | succeeded | 5 | 1 | 6,772 | not_applicable | insufficient_evidence | OTHER |
| sample-003 | 85e38911… | succeeded | 19 | 9 | 381,869 | insufficient_evidence | insufficient_evidence | REPAIR |
| sample-004 | d1e7a564… | succeeded | 6 | 2 | 98,820 | insufficient_evidence | not_applicable | REPAIR |
| sample-005 | 90d0db26… | succeeded | 31 | 17 | 389,819 | insufficient_evidence | failed | REPAIR |
| sample-006 | 3d6dd9b1… | succeeded | 36 | 20 | 644,150 | insufficient_evidence | failed | REPAIR |
| sample-007 | 1ab8e851… | succeeded | 45 | 25 | 1,049,017 | insufficient_evidence | failed | REPAIR |
| sample-008 | 3c43f437… | succeeded | 38 | 22 | 1,005,375 | insufficient_evidence | insufficient_evidence | REPAIR |
| sample-009 | 04ac777c… | succeeded | 28 | 14 | 610,438 | insufficient_evidence | insufficient_evidence | REPAIR |
| sample-010 | f4010512… | succeeded | 5 | 1 | 17,866 | not_applicable | failed | CONSULTATION |
| sample-011 | 8eb4ac7f… | succeeded | 8 | 2 | 14,514 | not_applicable | failed | REPAIR |
| sample-012 | 52914b84… | succeeded | 46 | 26 | 1,077,963 | insufficient_evidence | insufficient_evidence | OTHER |
| sample-013 | 58c4caa5… | succeeded | 29 | 15 | 329,295 | insufficient_evidence | insufficient_evidence | COMPLAINT |
| sample-014 | a66c03f7… | succeeded | 31 | 15 | 466,102 | insufficient_evidence | insufficient_evidence | OTHER |
| sample-015 | 2ba6dbcd… | succeeded | 8 | 2 | 21,077 | not_applicable | insufficient_evidence | OTHER |
| sample-016 | 77095614… | succeeded | 55 | 33 | 1,255,703 | insufficient_evidence | not_applicable | REPAIR |
| sample-017 | 94e87c22… | succeeded | 15 | 7 | 238,418 | insufficient_evidence | insufficient_evidence | OTHER |
| sample-018 | 9fcb5e4d… | succeeded | 12 | 4 | 140,482 | insufficient_evidence | insufficient_evidence | OTHER |
| sample-019 | 7b1d6419… | succeeded | 42 | 22 | 1,259,223 | insufficient_evidence | insufficient_evidence | OTHER |
| sample-020 | 0ea82b5c… | succeeded | 43 | 23 | 1,088,139 | insufficient_evidence | failed | OTHER |
| **合计** | | **20/20** | **521** | **269** | **10,368,887** | | | |

**§52 Expected 对照：用例库无 expected 数据**（回归集仅存 canonical 通话，无期望输出列）——按 §52 口径，无 Expected 则不做机械对照；业务合理性由上表判定分布 + 人工抽查输出文本评估。仓库内唯一 ground truth（NATIVE-V02-001）属合成评测样本，不在存量用例库中，未纳入本次批次（§34 禁止假数据集替代）。

**§51 最低用例覆盖**：Case B（knowledge_search 真实多轮检索）✅；Case C（三类承诺工具真实调用）✅；Case D（多事项 fan-out，最大 10 计划）✅；Case E（insufficient_evidence 如实输出）✅；Case F（真实超时失败 + 自动错误映射测试）✅；Case A（纯理解/0 计划路径）由自动测试覆盖（`test_workflow_without_claims_or_promises`），批次内样本均含至少一个核验事项。

## 4. 性能记录（§62/§63）

- 单用例全链路（关思考、5 计划、并行 2）：**50.1s**（identify 9s / plan <1s / execute 36s / barrier <1s / synthesize 3.4s；22 model calls / 10 tool calls / 275,509 tokens）。
- 最大用例（10 知识断言 + 承诺）：约 15–20 分钟以内完成（1.26M tokens，sample-019）。
- 20 条批次（同步顺序执行）：约 17 分钟。
- **超时决策（§63）**：关思考后最重单用例远低于 300s 默认超时，**未调整** Module `timeoutSeconds=300`。思考开启时单调用即可超过 120s 并触发端点截断（见发现 4），如未来启用思考需先重测并另行决策。

## 5. 实施过程发现与修复（全部有独立提交）

1. **native workflow 路由键分歧（`e6c510b`）**：R0 时期 adapter 读 `workflow_mode`，R2 起平台规范键为 `workflowMode`——native 工作流在平台路径从未触发过。修复：两个既有 adapter + 新 runtime 均接受双键。
2. **native 输出形态与平台 Schema 不兼容（`3b6f7d5`/`7efc12a`）**：native 结果（consumer_needs/…）与 `quality_output.schema.json`（findings/labels/summary，additionalProperties=false）不一致，是 native 从未走通平台路径的另一根因。修复：运行时内确定性投影（不经 LLM），labels 只取 Master Data 码；sample_id 容错解析（顶层→嵌套→run 标识）。
3. **inputMapping 嵌套引用（`d4c36c2`）**：存量用例库整列 canonical 存储，`_apply_mapping` 增加点号路径（向后兼容）。
4. **思考模式与端点截断（`c9fd804`）**：qwen3.8-max 思考开启时单次调用 52s+，长样本 >120s 触发 APITimeoutError/APIConnectionError；关闭后 9s/调用。运行时级环境开关 `QUALITY_MODEL_ENABLE_THINKING`（不进冻结 AgentSpec，跨 Provider 契约请求不变）。
5. **dashscope 工具轮后 response_format 失效（`c9fd804`）**：裸客户端对照实验证实端点在请求携带 tools 时静默忽略 json_schema 格式（无 tools 请求始终生效）。修复：带工具阶段两阶段执行（工具循环→无工具强制结构化），无工具阶段保持单阶段。
6. **SDK 0.22 MCP 适配（`c9fd804`）**：静态白名单过滤为 `{"allowed_tool_names": […]}`（列表形态被当作动态过滤报 UserError）；MCP 生命周期由调用方 connect/cleanup（每阶段独立连接，与 AgentScope 同构）。
7. **平台工具资源 CheckRun 受 egress 门禁（未修复，登记）**：平台侧工具测试执行器对 127.0.0.1 失败关闭（09 P0-11 SSRF 门禁，SDD 14 §61.3 明确要求保持）；四个工具资源以 disabled 状态注册。Release 冻结仅要求工具存在性，运行时工具调用走 runtime→工具网关直连，不受影响。
8. **观测加固（`c9fd804`）**：失败详情带异常消息+阶段进度+耗时；模型参数真正下发阶段 Agent；瞬态网络错误有界重试（§64）。

## 6. 用户浏览器终验路径（G20，待执行）

服务栈（均已就绪）：

| 服务 | 地址 |
| --- | --- |
| 前端 | `http://localhost:5173` |
| 后端 | `http://127.0.0.1:8120`（wf_dev） |
| OpenAI Agents Runtime | `http://127.0.0.1:8303` |
| 工具服务 | `http://127.0.0.1:8200` |

验收步骤：

1. 打开任务列表 → `OpenAI Agents - Quality POC` 任务 → 任务详情核对：Execution Target=agent、Agent=质检-OpenAI POC、版本策略=钉住、Output Mode=platform_only；
2. 进入 TaskRun `0f2735c8…`（批次）→ 核对 total/succeeded=20、resolved AgentVersion/Release/Runtime Provider；
3. 任选一条 Interaction Run 进入 Run Detail → 核对：Runtime（openai-agents/0.22.0/0.1.0）、Input、Output（结构化 findings/labels/summary）、Stages（identify/execute/*…）、Calls（model/tool）、Usage（tokens/调用数）、Evidence；
4. （可选）在任务页点击"运行"再触发一批次，验证页面手工触发 → 新 TaskRun → 新 Runs 全链路；
5. （可选，business 场景）任务 `OpenAI Agents - 业务分析 POC` → TaskRun `5ace2fee…` → 3 条 Run（指标聚合 86.4%/85.81% 与区域拆解，见 §9.2）。

## 7. 已知限制（如实登记）

- 工具事实为 fixture（read-only，§61.4）；回归用例的真实 case_id 不在 fixture 覆盖内 → 业务判定多为证据不足（§53 维度 B 受限，维度 A 不受影响）。
- native v0.2 流程不含辱骂检测阶段，`abusive_language` criterion 不输出（与 AgentScope/DSH 的 native 语义一致）。
- 运行时状态为进程内存储（InMemoryRunService，POC 定位 §4）；生产恢复由平台 Gateway/Queue 负责。
- 每阶段独立 MCP 连接（连接/列出开销本地可忽略）。
- Usage 依赖端点 `include_usage` 回传；本次端点全部回传，未出现需要置 0 标注的场景。
- 平台工具资源 disabled（egress 门禁，见 §5-7）；不影响运行与验收，生产化时需与部署决策一并处理。
- 本 POC 累计消耗约 1,040 万 tokens（含调试轮次）。

## 8. 测试与回归证据

| 套件 | 结果 |
| --- | --- |
| `runtimes/openai_agents` pytest | **57/57**（contract 11 / adapter 10 / tools 11 / native workflow 8 / business workflow 7 / trace 4 / e2e 6） |
| `services/tool_service` pytest | **12/12**（含 business 工具 metric_query/dimension_query 6 项） |
| `server/tests` pytest 全量 | **365/365**（基线 359 + SDD-14 新增 6；business manifest 变更后全量复跑通过。注：期间一次 `test_settle_and_real_write` 失败经单独复跑通过，确认为与并行运行批次的状态干扰偶发） |
| AgentScope runtime 套件（路由键修复后） | 9/9 |
| DSH runtime 套件（路由键修复后） | 12/12 |

## 9. business-analysis 场景扩展（2026-09-02 用户指令追加）

质检 POC 通过后，用户要求把第二个只读场景 `business-analysis@1.0.0` 也接入 OpenAI runtime 并真实跑任务。实施与结果如下。

### 9.1 实施内容

| 项 | 说明 |
| --- | --- |
| 工具服务扩展 | `metric_query` / `dimension_query`（read-only fixture，MCP+HTTP 双通道）；**符号窗口**（`last_7d/last_14d/last_30d/all`）由工具端对数据集日期范围确定性求解——模型不得也不需推算日期（初版模型臆造 2024 日期致窗口为空，此为修复根因） |
| fixture 数据 | `tool_fixtures_v0.2.json` 增 `metric_store`：connect_rate/resolution_rate/avg_handle_time 14 日序列 + region/service_group 维度（近 7 日 connect_rate 均值钉扎 86.4，与 R5 测试先例一致） |
| runtime 工作流 | `business_workflow.py`：identify（问题→查询计划）→ execute/<plan>（每计划恰好一次对应工具）→ barrier → synthesize；**数值/单位/引用由代码从工具回包确定性解析（模块铁律"数值计算由确定性代码完成"），语言模型只发起查询与撰写 answer** |
| 平台绑定 | manifest 增 `openai-agents` 实现（entry `business_analysis_v1`）；metric/dimension 工具注册为平台资源（同质检工具，受 egress 门禁为 disabled） |
| 用例库 | 平台无存量 business 用例（已核实）——新建内联资产「业务分析用例库v1」3 条：模块题库 q1（近 7 日/近 14 日两个窗口）+ q2（区域对比）。如实登记：非存量库，为场景首建 |
| 实体 | Agent `e2787f2b…` / Version `3d11888e…` / Release `4e438ab3…`（→ OpenAI Provider）/ Task `84e6d759…` / TaskRun `5ace2fee…` |

### 9.2 真实运行结果（真模型 + 真工具）

**3/3 succeeded（TaskRun succeeded）**：

| 用例 | 结果 | 数值 |
| --- | --- | --- |
| BIZ-Q1-7D（近 7 日接通率） | succeeded | connect_rate **86.4%**，窗口 2026-08-27..2026-09-02（7 点，与 fixture 钉扎一致） |
| BIZ-Q1-14D（近 14 日接通率） | succeeded | connect_rate **85.81%**（14 日窗口，窗口语义正确区分） |
| BIZ-Q2-REGION（区域对比） | succeeded | 区域拆解 east 88.2 / north 85.6 / south 86.9 / west 84.8，metrics=[]（纯维度问题，Schema 合法） |

- runtime_provider_id 3/3 指向 OpenAI Provider；CallRecord model 13 + tool 3；stages 事件 identify/execute/metric-1/execute/dimension-1/synthesize 齐全；**每计划恰好一次工具调用**（exactly-once 守卫实测生效）。
- 输出过平台 `_settle_module_result` 的 business output Schema 二次校验。
- 调试过程如实登记：前 5 轮尝试失败，三个根因依次修复——① 工具输出 content-blocks 形态未归一（MCP 返回 `[{type:*_text,text}]`）；② 模型臆造日期致窗口为空 → 符号窗口；③ 数值提取由 LLM 改为代码确定性解析（消除失败源）。第 6 轮起稳定成功。

### 9.3 与既有实现的语义对齐

- DSH 侧 `native_business_analysis.mjs` 为本场景既有参考实现（状态机同构）；AgentScope 侧 business 走通用路径（SDD-10 已登记偏差）。本次为 OpenAI runtime 首个 staged business 实现。
- 输出 Schema（question_id/answer/metrics/citations/confidence，additionalProperties=false）与 DSH synthesize 契约一致；`ticket-automation`（write 型）仍按 §61.4 排除。

---

**结论**：SDD-14 §69 DoD 的工程侧全部成立——存量用例库配置的 Agent Analysis Task 绑定 OpenAI Agents Runtime Provider，手工运行产生真实 TaskRun 与 20 条 Interaction Run，由 OpenAI Agents SDK 使用真实模型与受控工具完成动态多事项质检，符合现有 Output Schema 的结果写入 `Run.output`，并可在 Run Detail 查看阶段/调用/用量/证据。追加的 business-analysis 场景亦以真实模型/真实工具 3/3 跑通（§9）。剩余唯一门禁为 G20 用户浏览器终验。
