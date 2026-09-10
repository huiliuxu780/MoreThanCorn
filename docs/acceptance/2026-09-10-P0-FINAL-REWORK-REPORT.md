# 2026-09-10 P0 最终返工报告（AgentScope 换底 × QoderWake 产品体验）

## 1. 最终状态

**READY_FOR_INDEPENDENT_AUDIT**（审计返工二轮闭环后重新送审）

（本轮不自签 ACCEPTED/COMPLETED；最终签收由独立审计执行。）

> **修订说明（2026-09-10，两次审计返工后的统一修订版）**：
> - **首审轮**：本报告首版被独立审计判 **REWORK_REQUIRED**（6 项返工），逐项闭环记录在 §22；
> - **二审轮（本轮，执行 Agent 任务书 7 项 P0 + 门禁 + 停止条件）**：在首审返工基础上又发现并修复 **5 处真实产品缺陷**（Task 向导目录不含已发布 custom Agent + 目录合并竞态、自动任务 Workflow 目标后端缺 published 校验、AgentFlow 不可执行被误归 TARGET_NOT_FOUND、对话页死通道不重挂/终态事件丢失卡 running、会话删除接口无 Run 引用守卫），并**如实登记一起验收事故**（聊天类脚本误删 5 个既有会话，含用户 1 次真实对话；已修复根因 + 平台守卫 + 孤儿清零，见 §23.6）。逐项记录在 §23；
> - 本次修订为**全文统一修订**：§2/§5/§9/§11–§17/§19–§22 中所有数量与引用均已对齐**最终证据**（evidence/*.json，二轮末采集）；与终值冲突的中间轮口径已就地改写或标注失效；
> - 本报告唯一权威数据库终值 = **evidence/db-counts-final.json**（§14）；唯一权威门禁清单 = §15。
>
> **追加轮（2026-09-10，用户 14+14 项详情页/视觉反馈）**：见 §19「追加修复轮」（28 项对账在 §20）。

## 2. 修改文件完整清单

git status 共 **203 项（72 M / 6 D / 125 ??）**（main @ f6824f9，含前几轮未提交工作与两轮审计返工），含前几轮未提交工作与本轮回工。本轮（09-10 P0 任务书 + 审计返工）直接修改/新增：

后端：
- server/app/agent_runtime.py（run_agent 支持 custom→AgentScope 统一入口；AGENT_ARCHIVED 门；_run_module_agent→_run_native_agent 通用化）
- server/app/routers/as_agents.py（single_run 建平台 Run 行+返回 run_id/session_id；/confirm HITL 端点；/api/v2/knowledge-bases/config-status 诚实状态；**二轮事故修复：DELETE sessions 增加 Run 引用守卫——被平台 Run 引用的 Session 一律 409 SESSION_REFERENCED_BY_RUN，杜绝再产生 run→session 孤儿**）
- server/app/routers/as_automations.py（保存阶段目标完整校验 422；列表筛选/排序/分页+executor 展示字段；_sync_schedule ValueError→422；**二轮：Workflow 目标补 published 校验（与前端选择器/定时执行入口 NO_PUBLISHED_VERSION 同语义）；AgentFlow 目标语义分层——存在性=TARGET_NOT_FOUND、无 active Release=TARGET_NOT_EXECUTABLE**）
- server/app/routers/business.py（Task 执行目标放开 custom Agent；旧三类/归档拒绝；custom 无 Module Schema 跳过映射校验）
- server/app/agentscope_client.py（chat_confirm：UserConfirmResultEvent 提交）
- server/app/automation_watcher.py（running Run 按真实 Session 状态结算）
- server/app/runtime_providers/registry.py、server/app/agent_modules/__init__.py、server/app/models.py（B4 残留清理：PROVIDER_KINDS/docstring/kind 注释）
- server/app/routers/agents.py（golden-eval provider 可选化+文档诚实化；**审计返工1：列表项新增 `executable` 字段 = 未归档 且 有 active prod Release，与 as_automations._validate_target 同一判定**）
- server/app/routers/runs.py（**审计返工3：GET /api/runs 支持 taskRunId/agentId 过滤，DTO 补 taskId/taskRunId/agentId/agentscopeSessionId/output，使 Task→Run→Session→输出链可查证**）
- scripts/p0a_cleanup.py、scripts/p0h_resource_assembly.py、scripts/mcp_local_safe_server.py、scripts/e2e_browser_flow.mjs、scripts/capture_visual_evidence.mjs、scripts/check-dom-bounds.mjs（新增）
- scripts/e2e_task_execution.mjs（**审计返工3 新增、二轮重写**：UI 向导创建（实开选择器断言无草稿泄漏）→ UI【立即运行】→ TaskRun 终态 → Run/Session/输出（非空互异）→ 详情/运行记录双页刷新恢复 → 失败路径（回滚 Release 后启动→明确报错不悬挂）→ 全清理；15 项）
- scripts/evid_automation_rejection.mjs（**新增，审计补证：草稿/归档 Agent 作为自动任务执行者的 422 拒绝 + 正向对照 + 三选择器数据源快照**）
- scripts/evid_model_selection.mjs（**新增、二轮扩展**：模型选择 10 项——按钮守卫/真实下拉/刻意选第二个模型/payload 拦截/服务端绑定/配置页刷新恢复/发布快照 frozen_model_key/executable 翻转/回滚+归档清理）
- scripts/evid_streaming_chat.mjs（**二轮新增（P0-6）**：4 轮真实对话——SSE 帧时间线（页内 tee）/≥3 DOM 增长/上滚不回拉/工具卡聚合/停止按钮/断线重连不重复+看门狗收尾/QW 同视口几何对照/仅删自建会话；10 项）
- scripts/e2e_browser_flow.mjs（**二轮加固（P0-5）**：全部断言终态化（expected/actual/evidence）；skill 安装四连验证（后端挂载→发布快照→workspace 注入→行为生效）；卡片/按钮分开计数；选择器真实点选；清理逐步验证+残留守卫，清理失败=脚本失败；22 项）
- server/tests/test_audit_executability.py（**二轮新增**：可执行对象统一判定 6 测试——executable 标志矩阵/草稿 422/归档 422/可执行保存+run-now/Workflow 草稿拒绝/AgentFlow 无 Release 拒绝）
- server/tests/test_audit_session_guard.py（**二轮新增**：会话删除守卫 2 测试——Run 引用 409/无引用放行）

前端：
- src/pages/agent-chat.tsx（P0-D 三栏重建+P0-C 流式：乐观回显/事件 reducer/平滑合并/HITL 卡/内部 hint 隐藏；**P0-6 修复：①SSE 通道存活跟踪（streamAliveRef）——停止/断线致通道死亡后，下一次发送自动重挂流；②重连/重挂失败续接退避重试链（原先 streamUrl 失败即终止）；③重挂后状态对账 reconcileAfterReattach——按 AgentScope running/idle/awaiting_permission/awaiting_external_result 四态恢复，idle 仅在持久化消息读取成功后原子收尾，未知状态不臆断完成；④卡死看门狗——≥8s 无 SSE 帧且 UI 仍 running/有 live 残片时触发同一对账；⑤发送/确认时刷新看门狗基准，收到新帧后重置独立重连预算**）
- src/lib/executable-targets.ts + executable-targets.test.ts（**二轮新增**：可执行对象唯一判定 helper——agent 按后端 executable、workflow 按 published、agentflow 按 active_release_id；默认执行者仅取自可执行集；6 单测）
- src/pages/automations-v2.executables.test.tsx（**二轮新增**：创建弹窗组件测试 3 项——默认预选第一个 executable/草稿不出现、空态+发布引导可见且保存禁用、workflow/agentflow 空态各自可见）
- src/pages/agent-create.model.test.tsx（**二轮新增**：模型守卫 3 项——模型 API 失败/空列表 → 创建禁用+配置引导（不静默默认值）、有模型未选择 → 填完名称仍禁用）
- src/components/tasks/task-form-sections.tsx（**二轮 P0-3 修复**：Task 向导执行目标目录原只收 `type==="module"` Agent——已发布的 custom Agent（产品唯一正式 Agent）在产品页面根本选不到；改为收录 executable 的 custom Agent（与后端同源判定），并修复双分支目录合并竞态（workflow 分支后解析时按 moduleKey 过滤会抹掉 custom 条目）；工作流分支同时排除 custom 防漏入）
- src/services/chat-stream.ts（新增：AgentScope 2.0.8 全事件纯 reducer+事件 id 去重+未识别事件台账）
- src/pages/agent-create.tsx（P0-E 模板市场+详情抽屉+自定义对话框重建；**审计返工2：必选「模型」下拉（真实 /api/registry/models 列表），未选时创建按钮禁用 + toast 拦截，payload 显式携带 modelRef.modelId，废除 models[0] 静默绑定**）
- src/pages/automations-v2.tsx（P0-G 指标带/四筛选/排序/分页/执行者列/真实选择器创建弹窗；**审计返工1：三个执行对象选择器只列真正可执行对象——agent 按后端 `executable` 字段、workflow 按 published、agentflow 按 active_release_id，与后端同一判定**）
- src/services/wf-api.ts（**审计返工1：agents 列表类型补 `executable?: boolean`**）
- src/pages/settings.tsx（P0-F 独立 240 二级侧栏壳）
- src/components/app/app-sidebar.tsx（P0-F 度量对齐：64/240、h48 品牌行、20px 折叠钮、10px 分组、h32/13px 链接、h56 Agent 卡、28 底部图标、默认收起）
- src/components/app/app-shell.tsx（页级滚动收进 Shell 容器：h-svh+overflow 控制）
- src/features/agents/AgentWorkspaceShell.tsx（根 h-full overflow-hidden；二级栏/主区独立滚动）
- src/pages/wf-agent-editor.tsx（只读判定修正：custom 不再被 type!=="module" 整体只读）
- src/pages/agent-workspace/governance.tsx（发布入口提升到治理页全类型可用；Golden Set 单引擎化；退役 runtime-providers 调用）
- src/pages/res-category-pages.tsx（Knowledge NOT_CONFIGURED 横幅）
- src/services/as-api.ts（automations 参数化；confirm 客户端）
- src/test-setup.ts、vite.config.ts（vitest jsdom setup）
- src/pages/agent-chat.stream.test.tsx（流式时序与重挂对账测试 6 例；含 idle 持久化收尾、HITL 四态恢复）

## 3. 旧 Agent 保留/归档/删除名单与理由

| Agent | 处置 | 理由 |
|---|---|---|
| DSH消费者分析 / DSH规则质检 | 归档（archived=true），历史只读 | 测试/回归资产（B1 金样本基准载体 dsh_real_regression_v1 保留）；退出产品运行面 |
| 质检-OpenAI POC / 业务分析-OpenAI POC | 归档，历史只读 | POC（openai-agents 运行时 09-04 已下线） |
| 业务分析-通话打标-OpenAI | 归档；业务配置迁移为新正式 Agent「业务分析-通话打标」(e773172b, custom, AgentScope-native) | 含真实业务配置（打标指令+qwen3.8-max+质检技能挂载），按任务书迁移后归档旧实例 |
| 物理删除 | 无（Agent 范围） | 任务书允许但非必须；全部历史经 pg_dump 备份（/tmp/wf_dev_backup_pre_p0a_20260910.sql, 9MB）+ 依赖清单 JSON 留痕。非 Agent 的本轮取证脚手架（P0-EVID-FLOW / P0-EVID-WF / 测试连接）按审计返工项4 物理删除，见 §22.4 |

证据：evidence/p0a-inventory-before.json / p0a-inventory-after.json。

## 4. 旧 Release 清理结果

- 清理前：10 条 active（5 prod AgentScope + 5 sandbox 旧 provider：deepseek-harness×2 / openai-agents×3）。
- 清理后：active=1（仅产品 Agent e773172b prod）；active 且绑定旧 provider=0；legacy provider enabled=0（deepseek-harness/openai-agents 行 disabled）。
- 验收期 E2E/取证 Agent 的 active Release 全部 rolled_back（audit_log 留痕：e2e.cleanup.release_rollback / p0.cleanup.archived_agent_release_rollback）。

## 5. 新 AgentScope 执行入口说明

唯一执行入口 = server/app/agent_execution.py（start_session/run_turn/run_structured/run_into_existing_run）→ AgentScope 2.0.8（8301）原生 Session/structured-run/flow-run。覆盖矩阵（全部实测）：
- 普通 Agent 一次性执行：POST /api/agents/{id}/run（custom 同权，fresh Session）+ POST /api/v2/agents/{id}/runs；
- 多轮对话：/api/v2/.../sessions+/turns+SSE 代理；
- Module 结构化执行：run_structured（Module outputSchema）；
- Task 调用 Agent：task_runner→run_into_existing_run（custom 已放开，business.py）；
- Automation 调用 Agent：as_automations.dispatch→start_session+chat_trigger；
- Workflow Agent 节点：runner._agent_family_executor→_run_native_agent；
- AgentFlow Agent 节点：agentflow_executor→rt.flow_run（活体 run 3894b2d2 曾 succeeded，记录存 e2e-browser.json；其 DB 行随 P0-EVID-FLOW 按审计清理项4 移除）；
- Agent 主动调用 Workflow/AgentFlow：internal tool（run_workflow/run_agent_flow，token 校验）；
- API 直调：/api/runs（Workflow 活体 run 23ca0b7c 曾 succeeded、LLM 节点真输出 WF-OK，记录存 e2e-browser.json；DB 行随 P0-EVID-WF 按审计清理项4 移除）/agentflows/runs。
- **现行活体执行证据（DB 行在库）**：Task 真执行链 run 2 条（taskRunId b6a626ee，见 §11）。

## 6. Run 与 Session 的责任边界

- Run（平台 run 表）= 平台执行事实：一次性 run/批次 interaction/Workflow run 均建 Run 行；v2 single_run 自本轮起建 Run（status running→watcher 按真实 Session 状态结算 succeeded/failed，输出取会话最后已完成 assistant 消息，不伪造）。
- Session（AgentScope sessions/messages + 平台 agent_session_index）= 运行时上下文与事件载体；SSE 事件、HITL、工具调用均发生在 Session。
- AutomationTriggerLog = 自动任务触发事实（与 Session 经 session_id 关联）。
- 不伪造：无 Session 即无事件；REPLY_END 合并只读持久化消息。

## 7. 流式事件映射表（AgentScope 2.0.8 EventType → 前端）

| 事件 | 处理 |
|---|---|
| REPLY_START/END | status running→completed/failed/interrupted/exceeded；END 触发平滑合并（先取持久化再同批清 live） |
| TEXT_BLOCK_START/DELTA/END | 按 block_id 聚合为同一条逐字增长消息（data-testid=live-text） |
| THINKING_BLOCK_* | 按 block_id 聚合，折叠/展开（流式 open、完成可折） |
| TOOL_CALL_START/DELTA/END、TOOL_RESULT_* | 按 tool_call_id 聚合连续工具卡（调用中/等待结果/success/error/interrupted/denied） |
| MODEL_CALL_START/END | 执行过程台账（右栏"执行过程"计数） |
| HINT_BLOCK | 渲染提示卡；内部 <system-reminder> 脚手架不入消息流（台账计数） |
| DATA_BLOCK_* | 数据块追加（JSON 文本） |
| REQUIRE_USER_CONFIRM / REQUIRE_EXTERNAL_EXECUTION | HITL 状态+批准/拒绝卡（POST /confirm → UserConfirmResultEvent） |
| USER_INTERRUPT / EXCEED_MAX_ITERS | interrupted / exceeded 终态 |
| CUSTOM | 自定义事件卡（脱敏截断） |
| 未识别 | unsupported 台账（右栏可展开），不静默丢弃 |
| 去重 | 事件 id（EventBase.id）seen 集合，重连不重复追加 |

## 8. 流式时序测试证据

- vitest jsdom：src/pages/agent-chat.stream.test.tsx 6/6 PASS——REPLY_END 前 ≥3 次不同 DOM 增长、用户消息先出现（乐观回显）、重连重放同 id 不重复、完成合并不闪空（采样器）、工具卡 START/DELTA/END 逐步变化、未识别事件入台账，以及重挂后 idle 持久化收尾、HITL 状态恢复不误报 completed、等待外部结果时不显示无效批准按钮。
- 浏览器实测（终值）：evidence/streaming-verification.json——T1 长文回复 REPLY_END 前 **283 次不同长度 DOM 增长**（同轮 SSE 帧 TEXT_BLOCK_DELTA=283 逐帧时间对齐）；e2e_browser_flow 加固版另记 48 次（早轮 43 次，均 ≥3 达标）。
- 真实 SSE 契约：P0-H/E2E 全程经平台代理 SSE（8301 原生事件），非轮询。

## 9. Agent 新建 E2E

e2e-browser.json（加固版 22/22）：模板市场 article 卡 9 张与按钮（查看详情 9 / 创建 9）**分开计数** → 卡上「创建」→ 统一创建页 `/agents/new?template=<id>`（**必选模型下拉** + Skill/知识库/连接器卡片式 PickerDialog）→ 填名称+选模型 → 创建 → /agents/<id>。模型选择全链（evidence/model-selection.json，**10/10 PASS** 终轮）：未选模型按钮 disabled=true → 真实下拉 4 项（占位+qwen3.8-max/qwen-max/qwen-plus）→ 刻意选第二个真实模型 qwen-max → UI 创建 201 → 拦截 POST /api/agents payload 含 `"modelRef":{"modelId":"qwen-max"}` → GET 服务端绑定一致 → **配置页刷新后仍显示 qwen-max** → 创建版本+发布 prod → **release 快照 frozen_model_key=qwen-max（psql 直查）** → executable=true → 清理（release rolled_back+audit、Agent 归档、executable=false）。截图 evidence/model-selection/01–04。（首审轮 8/8 版本与 ff6bccce 采证 Agent 为历史记录，被本终值接替。）

## 10. 对话 E2E

e2e-browser.json（加固版）：统一创建页建 Agent → UI 安装 Skill（四连终态验证，§23.2 P0-5）→ 发布 prod → 新建对话 → 长文流式（48 增量）→ Skill 行为轮（违禁词清单真实输出）→ MCP 工具调用 → HITL 卡 UI 批准 → 工具结果 ECHO:E2E-OK → 刷新恢复持久化消息（全 PASS）。流式专项终值另见 evidence/streaming-verification.json（10/10：SSE 帧时间线 / 283 次 DOM 增长 / 上滚不回拉 / 工具卡单卡聚合 / 停止按钮 / 强制断流后重挂不重复 + 看门狗收尾 / QW 同视口几何对照）。

## 11. Task/Automation/Workflow/AgentFlow E2E

- **Task 真执行 E2E（终值：二轮重写版，evidence/e2e-task-execution.json，15/15 PASS）**：UI 向导实开选择器（仅列已发布 Agent，草稿泄漏=0）→ UI 创建 Task acaecc96（executionTarget=agent e773172b「业务分析-通话打标」，latest_prod_release，数据集 20 条、固定数量抽样 2）→ 详情页 UI【立即运行】→ TaskRun 17a856f0 终态 succeeded（total=20 / succeeded=2 / failed=0，冻结 release 7b1132ed）→ 2 条 Run 均挂真实 agentscopeSessionId（64bc48e8/92e1b4eb）且入 agent_session_index → output.content 非空互异（468/459 字节真实打标 JSON）→ 详情页与运行记录页 reload 恢复 → 失败路径（回滚 Release 后启动→明确报错、无悬挂）→ 全量归档清理。完整 ID 与时间线在证据 JSON。
- 首审轮 10/10 链（taskRun b6a626ee，API 创建+API 启动）为历史记录：其 2 条 run 中 1 条因 §23.6 事故失去会话已显式清除，活体证据以上行终值链为准。
- 旧 E2E 中"Task 仅创建+引用"项（e2e-browser.json task_created_referencing_agent 201）保留为选择器数据源验证；真执行链以上行为准。
- Automation：UI 创建（执行者 Select 真实选择）→列表 executor 展示→手动运行→history completed（PASS，e2e-browser.json）。**审计补证（evidence/automation-target-rejection.json，6/6 PASS）**：归档草稿 Agent（数据分析师/前端工程师）作为 target → 422 TARGET_ARCHIVED；临时解除归档的数据分析师（无 active prod Release）→ 422 TARGET_NOT_EXECUTABLE（验证后已恢复归档）；正向对照活跃 Agent → 201 创建成功后立即删除（automations 余 0）；三选择器数据源快照：agents 仅 executable=true 的「业务分析-通话打标」、workflows 仅 published（测试/dbg-wf2）、agentflows 0（P0-EVID-FLOW 已按审计项4删除）。
- Workflow：活体 run 23ca0b7c 曾 succeeded（LLM 节点真输出 WF-OK）+ 8f272588（基线轮）；两条 DB 行均随 P0-EVID-WF 按审计项4 清理，记录存 e2e-browser.json。
- AgentFlow：活体 run 3894b2d2 曾 succeeded（单 Agent 节点，经统一入口）；DB 行随 P0-EVID-FLOW 按审计项4 清理，记录存 e2e-browser.json。

## 12. Prompt/Model/Skill/Tool/MCP/Knowledge 装配矩阵

| 资源 | 冻结 | Session 装配 | 活体证明 |
|---|---|---|---|
| System Prompt | release.runtime_binding_snapshot.prompt_digest | runtime AgentRecord system_prompt | runtime-view matches_published |
| Model+参数 | frozen_model_id/key/params/timeout | chat_model_config_for_release | 真模型回复（E2E/P0-H） |
| Skill | _frozen_skills（name/content/sha256） | workspace upload <name>/SKILL.md | workspace_skill_uploaded + Agent 遵循 SKILL 输出违禁词表 |
| Tool | _frozen_tools（ready ToolVersion） | 平台工具白名单 | 历史轮+pytest |
| MCP | _frozen_mcps（http only） | workspace mcp 注册 | mcp__safe-mcp-echo__safe_echo 调用闭环 ECHO:P0H-MCP-OK |
| Knowledge | _frozen_knowledges（真实 runtime_kb_id 或 disabled 留痕） | 未配置不挂载 | NOT_CONFIGURED + 启用门禁 422 + 发布阻断 409/422 |
| Workflow/AgentFlow | manifest workflow_ids/agentflow_ids | internal tool 白名单 | 活体 run（§11） |

证据：evidence/p0h-assembly.json（**17/17 PASS**）。

## 13. 三视口测量与截图索引

- evidence/visual/{1440x900,1280x720,1024x768}/：01-nav-tasks、01b-nav-collapsed、02-settings、03-agents-list、04-agent-create、05-agent-detail、07-chat-streaming、08-chat-toolcard(s)、09-chat-complete、10-automations-list、11-automations-create（mtc+qw 双套）。
- evidence/visual-geometry.json（rail/settings-sidebar/main 几何）、evidence/dom-bounds.json（**36/36 PASS = 11 路由 + 自动任务弹窗态 × 3 视口**；二轮按任务书补齐 /batch-tasks、/workflows、/agentflows 与「新建自动任务」弹窗交互终态）。
- evidence/model-selection/{01-before-select,02-dropdown-open,03-model-picked,04-config-after-refresh}.png + model-selection.json（**二轮扩展 10/10**：含发布快照 frozen_model_key 与 executable 翻转）。
- evidence/automation-target-rejection.json（首审补证：422 拒绝 + 正向对照 6/6；后端语义二轮加固后由 test_audit_executability.py 6 测试覆盖新规则）。
- evidence/e2e-task-execution.json（**二轮重写 15/15**：UI 向导创建 + UI 启动 + 失败路径 + 双页刷新恢复 + 时间线 + 全部 ID）。
- evidence/streaming-verification.json + streaming/{t1-completed,t2-toolcard,t3-stopped,t4-after-reconnect}.png（**终轮 10/10**：SSE 帧时间线 283×TEXT_BLOCK_DELTA/283 次 DOM 增长/上滚不回拉/工具卡聚合/停止/强制断流后 stream fetches=3、成功 opens 1→2 且回复不重复/QW 几何对照）。
- evidence/g0-site-record.json（二轮 G0 只读现场记录）、evidence/db-counts-final.json（**唯一权威数据库终值**）。
- 逐项差异裁决：research/morethancorn/11-p0-rework-20260910/visual-adjudication.md。

## 14. 数据库终值（唯一权威 = evidence/db-counts-final.json，二轮全部修复/验证/清理完成后采集）

> 中间轮快照（db-counts-after.json 各版本）一律作废；下表为终值。「清理前」列保留 09-10 晨原始基线供对照。

| 对象 | 清理前(09-10 晨) | 终值（db-counts-final.json） |
|---|---|---|
| wf_* 数据库 | 1 (wf_dev) | **1（仅 wf_dev）**；pytest 临时库执行后自动清理（两轮后 `psql -l` 复核仅 wf_dev）；空库迁移链验证 wf_mig_check 建→upgrade head（g054evtdlv0001，71 表）→已删 |
| agent | 6（5 历史+1 迁移） | **23 = 22 归档 + 1 活跃**。活跃仅「业务分析-通话打标」e773172b（custom/published）。归档构成：5 历史（DSH×2、OpenAI POC×2、通话打标-OpenAI）+ 前端工程师×5、数据分析师×1、E2E-统一创建-X×1（首审轮处置）+ 二轮验收临时：EVID-MODEL-TEST×3、E2E-BROWSER-*×3、E2E-FAILPATH-*×4（全部采证后即归档） |
| agent_version / release | — / 10 active | 33 / **38（active=1 仅产品 Agent prod；active 旧 provider=0）** |
| legacy provider enabled | 2 | 0（3 provider 仅 agentscope enabled） |
| agentscope agents/sessions/messages/schedules | 6/3/—/— | **30 / 19 / 54 / 0**（agents 含归档 Agent 的历史物化记录，21→30 增量为二轮验收 Agent，均被 release/index 引用；sessions 含事故后余量与本轮真实执行会话，详见 §23.6） |
| session_index / chat_sessions | 3 / — | 17 / 1 |
| schedule（平台） | 2 / enabled 1 | **2 / enabled 0**（二轮清除 3 条 UI 向导 E2E 任务遗留的启用调度「E2E-TASK-EXEC-*-schedule」+6 条 occurrence——任务已归档而调度仍每日 02:00 启用，属必须停掉的验收残留；显式 ID 单事务+audit 留痕） |
| analysis_task | 10 active | **23（active 3 = audit-A/DEMO-002B×2 只读历史；paused 7；archived 13 含本轮 E2E 任务）** |
| task_run | — | **41（succeeded 26 / failed 5 / cancelled 2 / partial 1 / running 7）**；running 7 为 09-02..09-07 历史陈旧状态（非本轮产生，登记不动） |
| automation_definition / trigger | 0 / 0 | 0 / 0（正向对照与 E2E 创建均已删） |
| run / quality_result | 171 / 104 | **177 / 104**（含最新 Task 真执行链 2 条活体 run；本轮显式删除 3+5 条孤儿 E2E run，见 §23.6） |
| skill / mcp / knowledge | 6 / 1 / 1 | 3 / 1 / 1（mcp-b17dz、ks-4m1z5 留痕 disabled） |
| connection | — | **14 总 / 10 未归档**（4 归档=本轮 E2E 脚本 API DELETE 的归档留痕行；未归档 10 条均为真实配置） |
| workflow / version | — / — | 2 / 2（测试、dbg-wf2；均 published，被 active task 依赖，只读保留） |
| agentflow 五表 | — | **1 / 0 / 0 / 0 / 0**：仅存 definition「测试」（created_by=dev，创建于二轮进行中 17:58，非本轮任何脚本产物——判定为用户现场操作，按"来源不明/用户数据不删"规约保留并登记） |
| 孤儿引用（10 类全扫） | run→session 3 等 | **全部 0**（run→session / index→session / index→agent / release→agent / release→version / taskrun→task / run→taskrun / version→agent / messages→session / agentflow 子表） |
| 活体执行证据（在库可查） | — | Task 真执行链：task acaecc96（archived）→ taskRun **17a856f0**（succeeded 2/2）→ 2 run + 2 session（64bc48e8/92e1b4eb，受删除守卫保护）→ 冻结 release 7b1132ed |

## 15. 测试命令、退出码、真实数量、时长（终轮门禁）

| 命令 | 结果 | 实际数量 | 时长 |
|---|---|---|---|
| server/.venv/bin/python -m pytest server/tests -q（终轮1） | exit 0 | **489 passed / 0 failed / 0 skipped**（1 条 StarletteDeprecationWarning） | 56.98s |
| 同上（终轮2） | exit 0 | **489 passed / 0 failed / 0 skipped**（1 条 StarletteDeprecationWarning） | 52.07s |
| pytest 临时库自清验证 | 通过 | 两轮后 `psql -l` 仅 wf_dev，无 wf_pytest_*/wf_fixture 残留 | — |
| 空库迁移链（createdb wf_mig_check → alembic upgrade head） | exit 0 | head=**g054evtdlv0001**，71 表；验证后 dropdb | ~10s |
| npx vitest run | exit 0 | **10 files / 64 tests passed**（含 agent-chat 6 项流式/重挂对账回归） | 3.62s |
| npx tsc -b --pretty false | exit 0 | 0 errors | — |
| npx eslint . | exit 0 | 0 problems | — |
| npm run build | exit 0 | 成功 | 4.08s |
| git diff --check | exit 0 | clean | — |
| node scripts/check-dom-bounds.mjs | exit 0 | **36/36 PASS（11 路由+弹窗态 × 3 视口：1024×768/1280×720/1440×900）** | ~70s |
| node scripts/e2e_browser_flow.mjs（加固版，真实 Chrome+真实 LLM） | exit 0 | **22/22 PASS** | ~5min |
| node scripts/e2e_task_execution.mjs（重写版） | exit 0 | **15/15 PASS** | ~3min |
| node scripts/evid_streaming_chat.mjs（新增） | exit 0 | **10/10 PASS** | ~4min |
| node scripts/evid_model_selection.mjs（扩展版） | exit 0 | **10/10 PASS** | ~30s |
| node scripts/evid_automation_rejection.mjs | exit 0 | **6/6 PASS**（首审轮采集；后端语义二轮加固后由 pytest 6 测试覆盖） | <5s |
| scripts/p0h_resource_assembly.py | exit 0 | **17/17 PASS**（本日早轮证据；未复跑——每轮运行会在 wf_dev 留 mcp 连接残留，复跑将污染 §14 终值快照；其覆盖路径已由 pytest 489 与本轮 22/22 skill 四连验证承接） | ~4min |

## 16. 尚未完成 / 无法验证（UNC / NOT_CONFIGURED / FAILED）

- Knowledge 火山引擎鉴权：**NOT_CONFIGURED**（诚实状态端点+UI 横幅+发布 fail-closed；启用门禁 422"尚未通过真实检查"）。
- MQ 消费触发适配器：**UNC**（触发层已解耦为 DataSource 适配器架构，webhook/polling/schedule/api/event 已实现；MQ 未实现，不伪造入口）。
- QoderWake 流式"生成中"参照：未在其产品触发新执行（无副作用纪律），参照取既有会话转录（08-chat-toolcards-qw）。
- 原站"用量/credits、工作空间三态、网络诊断/环境设备/更新"：我方无对应真实能力，未设空壳（N/A）。
- audit-A 任务孤儿外键（workflow 'w'）：历史数据只读保留。
- 上轮报告 Session 数字与 ours-after-autonomous-* 证据：已作废，本轮全部重采（§13/§14）。

## 17. git status

**203 项未提交变更（72 M / 6 D / 125 ??）**，main @ f6824f9（二轮返工全部完成后实测）。完整清单见 `git status --short`（本报告 §2 列本轮直接修改）。

## 18. 提交状态声明

**未提交、未推送、未部署。** 所有变更仅存在于工作区；数据库变更限本机 wf_dev（已 pg_dump 备份 + audit_log 留痕）。

---
证据目录：research/morethancorn/11-p0-rework-20260910/（qoderwake-live-observations.md / visual-adjudication.md / evidence/*）。
等待独立审计。

---

## 19. 追加修复轮（2026-09-10 第二轮 · 用户 14 项详情页反馈）

### 19.1 最终状态

**READY_FOR_INDEPENDENT_AUDIT**（追加轮；仍未提交/未推送/未部署）

### 19.2 逐项处置与证据

| # | 反馈 | 根因/处置 | 证据 |
|---|---|---|---|
| 1 | 无对话任务时输入不自动产生任务 | 无 Session 时 send 未先建 Session（422 死路）。修：sendText 无 session 时自动 `POST /sessions` 建立对话任务并回填 URL | 浏览器：无任务态输入回车 → `?session=<new>` 出现，左侧任务列表新增 1 条（verify4） |
| 2 | 对话任务无法删除 | 无删除入口+后端无删除链。修：运行时 `DELETE /sessions/{id}`（agentscope_client.delete_session）+ 平台 `DELETE /api/v2/agents/{aid}/sessions/{sid}`（运行时删除失败不阻断索引清理，失败原因如实返回）+ 左列表 ⋯ 菜单「删除对话任务」+ 确认弹窗 | 浏览器真实鼠标点击闭环：菜单→弹窗→删除，任务 4→3，toast「对话任务已删除」（del-ui2）；端点直测 HTTP 200 / 12ms |
| 3 | 无法新建自动任务 | 执行对象必填但无默认值，用户不选则保存报 422。修：打开弹窗时预选第一个**真正可执行**的 Agent（审计返工1 后按后端 `executable` 字段过滤；当时草稿「数据分析师」已归档，现默认为「业务分析-通话打标」）；保存前对 agent/workflow/agentflow 分别给出明确必填校验 | 浏览器：弹窗执行者自动预选可执行 Agent；拒绝链证据 evidence/automation-target-rejection.json 6/6 |
| 4 | 对话输入没有严格还原 | 附件/上下文为禁用假入口、模型是只读文字。修：按原站 composer 还原——「选择工作目录」按钮 + 「+」添加文件或图片 + 模型下拉（真实模型列表，标注绑定来自发布快照）+ 自动滚动 + 发送/停止；附件与上下文如需真实能力未接入时给出诚实提示（不伪造上传） | 截图 visual-fix/14-chat-composer.png；浏览器断言 选择工作目录/添加文件或图片/选择模型 三入口在场 |
| 5 | 任务看板不对 | Agent 内 board 子页原为通用运行观测面板，与 QoderWake `/wakers/<id>/task` 不符。重写为：指标带（任务总数/进行中/需要操作/已结束）+ 触发方式/任务状态/数据周期筛选 + 四列任务表 + 分页 + 每页条数；后端 board 投影新增 `executor` 过滤与 `executor_id` 字段 | 截图 visual-fix/15-agent-task-board.png；浏览器断言 指标/筛选 在场 |
| 6 | 丢失【自主工作】 | 新增 `agent-workspace/autonomous.tsx`（QoderWake `/wakers/<id>/triggers` 同构：h2+副文案+新建自动任务+触发类型/状态/排序筛选+列表+空态引导），接入二级栏「工作」组 | 截图 visual-fix/16-agent-autonomous.png |
| 7 | 连接器做的不对 | 重写 `connectors.tsx` 对齐原站：动作组（去市场/手动添加/从 JSON 导入）+「我的连接器」/「连接器市场」两 tab + 空态文案；手动添加/导入真实创建 Connection 并挂载 | 截图 visual-fix/17-agent-connectors.png；浏览器断言 手动添加/从 JSON 导入/我的连接器/连接器市场 全在场 |
| 8 | 没有 Waker 档案 | 新增 `agent-workspace/profile.tsx`（QoderWake `/wakers/<id>/settings`「Waker 档案」同构：个人简介 + 三份角色源文件 identity.md/persona.md/bible.md + 查看 + 修改角色源文件 + 角色管理归档 + 真实能力挂载清单），接入二级栏「权限与管理」组 | 截图 visual-fix/18-agent-profile.png |
| 9 | WakerFlow 列表丑陋应卡片 | `agentflows.tsx` 由表格改卡片网格：首格「新建 AgentFlow」虚线卡 + flow 卡（名称/发布徽标/描述/N 个节点/N 个版本/⋯ 更多操作：打开·查看执行记录·删除）；后端列表补 `node_count`、新增 `DELETE /api/v2/agentflows/{fid}` | 截图 visual-fix/19-agentflows-list.png |
| 10 | WakerFlow 详情页/运行历史展示不对 | `agentflow-detail.tsx` 重写对齐原站：头部视图切换（AgentFlow 视图 / 执行记录，URL `?view=runs`）+ 编排视图（节点编排 + 版本历史）+ 执行记录视图（主区按选中 run 渲染节点状态/attempt/Session 跳转/重跑，右栏「运行记录」run 列表按「第 N 次运行 · 触发方式 · 状态 · 时间」选中高亮） | 截图 visual-fix/21-agentflow-runs.png；浏览器断言 运行记录（2）含两条 run，节点 attempt 在场 |
| — | 数据接入无法新建 | 弹窗只有「取消」没有提交按钮（创建逻辑写在标题按钮 onClick）。修：补「保存」按钮 + 抽出 `create()`（含创建中态） | 弹窗按钮实测 ["Webhook","取消","保存","Close"]；截图 visual-fix/20-data-sources.png |
| — | Agent 列表对话按钮无法点击（假按钮） | 根因：操作行与统计行同占一个 grid 单元，不可见统计层在上方吞掉指针事件。修：统计行 `pointer-events-none` + 操作行 `z-10`（并对齐 QoderWake 的 配置/分享/对话 三动作） | 浏览器真实鼠标点击：修复前停在 `/agents`，修复后进入 `/agents/<id>/chat`；`elementFromPoint` 命中按钮 |
| — | 自定义 Agent 弹窗太窄 | max-w-2xl(512) → sm:max-w-3xl(768)；模板详情 512→sm:max-w-2xl(768) | 实测弹窗宽 768×792 |
| — | Skill 详情页与目标产品不一致 | 由右侧 520px Sheet 改为原站「安装 Skill」式居中弹窗（768 宽）：名称/来源/分类/字数 + Skill 说明（SKILL.md 正文）+ 已安装 Agent + 关闭/编辑正文/安装到 Agent | 实测弹窗宽 768，含 Skill 说明 + 安装到 Agent |

### 19.3 本轮代码改动清单

后端：`server/app/agentscope_client.py`（delete_session）、`server/app/routers/as_agents.py`（DELETE sessions 端点）、`server/app/routers/as_flows_board.py`（board executor 过滤 + executor_id + flow node_count + DELETE flow）。
前端：`agent-chat.tsx`、`agent-create.tsx`、`agent-workspace/board.tsx`、`agent-workspace/connectors.tsx`、`agent-workspace/autonomous.tsx`（新）、`agent-workspace/profile.tsx`（新）、`features/agents/AgentWorkspaceShell.tsx`、`pages/wf-agent-editor.tsx`、`pages/agentflows.tsx`、`pages/agentflow-detail.tsx`、`pages/data-sources.tsx`、`pages/res-skills.tsx`、`pages/wf-agents-list.tsx`、`services/as-api.ts`、`pages/agent-chat.stream.test.tsx`（mock 补 runtimeView/wfApi.models）。

### 19.4 追加轮门禁（全绿；表内为该轮当时实测值，最终复跑终值一律见 §15）

| 命令 | 结果 |
|---|---|
| npx tsc -b --pretty false | exit 0 |
| npx eslint . | exit 0（0 error；修复 1 处 exhaustive-deps warning） |
| npx vitest run | 当时 7 files / 49 tests（终值 10 files / 64，§15） |
| npm run build | 成功 |
| server pytest tests/ -q | 当时 481 passed（终值 489×2 轮 0 failed/0 skipped，§15） |
| node scripts/check-dom-bounds.mjs | 全绿（**终值 36/36 = 11 路由+弹窗态 × 3 视口**，见 §15） |
| git diff --check | clean |

浏览器回验：对话发布引导+发送自动建任务+任务删除闭环+composer 三入口 / Agent 任务看板+自主工作+连接器+档案 / AgentFlow 卡片列表+执行记录 / 数据接入保存 / Agent 卡对话真点击 / 自定义 Agent 弹窗 768 / Skill 详情 768 —— 全部实测通过。

证据目录：`research/morethancorn/11-p0-rework-20260910/evidence/visual-fix/`（14–23 号截图）。

### 19.5 本轮仍未闭合（诚实登记）

- 对话「附件上传 / 工作区上下文选择」：UI 入口已还原为可用按钮，但真实上传/上下文注入链未接入，点击给出诚实提示（不伪造上传成功）。
- 自主工作/自动任务「事件」触发依赖已注册 event source；「MQ 消费」适配器仍为 UNC（触发层已解耦，未实现）。
- AgentFlow 画布为结构化节点编辑器（非自由画布），与原站可视化画布形态有差异（功能等价：节点/顺序/版本/发布/运行/重跑）。

### 19.6 声明

追加轮同样**未提交、未推送、未部署**；仅本机工作区与 wf_dev（变更留痕）。等待独立审计。

### 19.7 追加：任务看板泳道卡片样式对齐（同日，用户追问"卡片样式对么？"）

原实现泳道卡是 `rounded-md border p-2 text-left text-xs`（标题+执行者·来源两行，无头像/无状态 chip/无时间），与 QoderWake 泳道卡差异明显。

对照原站 `qc-work-management-lane` 实测（1440×900）：
- 泳道列：`rounded 8px`、底 `#F9F9F9`、`padding 12px 0 12px 12px`、列头 `<header><strong>名称</strong><span>计数</span></header>`（fs14）；
- 泳道卡：`rounded 6px`、白底、1px 边框、`padding 24px`、`gap 16px`，三段结构——
  1. 头行：avatar 32×32 + 执行者名（fs14）+ `<time>` 相对时间（fs12 三级色，右对齐）；
  2. `<strong>` 任务标题（fs14/500）；
  3. meta 行：`来源：{触发}`（fs12 三级色）+ 状态 chip（dot 5×5 + label，fs12/500，软底 + —done 语义色，`rounded 4px`、`padding 4px 6px 4px 10px`）。

我方按此重写 `task-board.tsx` 泳道分支：列 `rounded-lg`(8px)/`bg-(--fill-tertiary)`/`py-3 pl-3`；列头 `<header>` 名称+计数；卡白底 `rounded 6px` 边框 `px-6 py-6 gap-4`，含 avatar32 + 执行者名 + 相对时间 / `<strong>` 标题 / 来源 + `StatusChip`（dot+label，按 lane 取 `--status-*-soft`/`--status-*` 语义色）；空列显示"暂无任务"。`BoardTask` 增 `executor_id` 以取真实头像；后端投影行补 `executor_id`。

实测：泳道列 radius 8px / bg rgb(249,249,249)；卡 radius 6px；chip 底 rgb(236,247,240) / 字 rgb(66,184,131)（= --status-success-soft / --status-success）。截图 `evidence/visual-fix/25-mtc-swimlane.png`、参照 `24-qw-swimlane.png`、列表视图 `26-mtc-task-list.png`。

门禁复跑：tsc 0 / eslint 0 / vitest 49 / build ok / DOM 门禁全绿（终值见 §15） / git diff --check clean / pytest 481。

### 19.8 追加：第二轮 4 项反馈（同日）

| # | 反馈 | 结论与处置 |
|---|---|---|
| 1 | 泳道空白太多 | 卡内边距/间距抄错（我用了 `px-6 py-6 gap-4`）。原站泳道卡实际由**内层 button**提供 `padding 12px / gap 8px`（外层 wrapper pad=0）。已改 `p-3 gap-2`：卡高 154→114px（原站 130px，差因我方标题/时间行更紧凑）。泳道列高 644px 与原站 640px 一致（原站空列同样占满，非缺陷）。 |
| 2 | 自动任务卡片和原效果不一致 | 原站 `/autonomous-work` 指标是**灰底单条带**（`#F9F9F9`/圆角6/内距20，值 44px·600、名称 13px、说明 12px），不是四张边框卡。已重写为单条带 grid；`/work-management` 工作记录同轮改为原站白卡样式（值 26px，四张 metric 卡）。 |
| 3 | idle 是啥 | 对话页头部把内部 `stream.status` 原样渲染成徽章（裸英文 `idle`）。已改为：状态为 idle 时**不显示**；其余用「圆点 + 中文态（执行中/已完成/等待确认/已取消/超出迭代/执行失败）」，与原站一致。 |
| 4 | AgentFlow 详情页有问题（不是 react-flow 页面） | 原站 WakerFlow 详情是**阶段卡画布**（浅底 `#FCFCFC` + 每阶段白卡：阶段 01 标签/标题/说明/Agent chip/节点级「请输入调整内容」+ 右下缩放组），不是表单编辑器。已弃用节点 textarea 列表，重写为阶段卡画布 + 缩放（60–160%）+ 节点级调整弹窗（改步骤说明→生成新版本）；版本/digest/发布收进底部条。执行记录视图同样改为阶段卡按 run 状态着色 + 右栏运行记录。后端版本列表补返回 `definition`（供画布渲染）。 |

门禁复跑：tsc 0 / eslint 0 / vitest 49 / build ok / DOM 门禁全绿（终值见 §15） / git diff --check clean / pytest 481。证据：visual-fix/25（泳道）、27（自主任务）、29（AgentFlow 详情阶段画布）。

### 19.9 关于 react-flow 的说明

我方另有真正的流程设计器（`src/features/designer`，基于 `@xyflow/react`），用于 **Workflow 画布**。AgentFlow（WakerFlow）在原站不是自由画布语义，而是「自然语言/脚本生成的阶段流水线」，故详情按原站阶段卡呈现；如你希望 AgentFlow 也接 react-flow 自由画布，这是**产品形态决策**（会偏离原站），请指示。

### 19.10 追加：折叠按钮图标（同日）

两处修正，均以原站实测为准：

1. **图标形状**：原站折叠/展开按钮是**无箭头的 panel-left 面板图标**（`fill=currentColor`）：展开态=左栏实心块；收起态=外框+左侧细竖线。我方原用 lucide `PanelLeftOpen/Close`（带 `→`/`←` 箭头），已按原站 SVG path 原值新增 `PanelFoldIcon` 替换。
2. **收起态显示时机**：原站收起态顶部按钮**默认只显品牌 logo，仅悬停时切换为「展开侧边栏」面板图标**（panel 图标 `display:none` 常驻隐藏；移开即还原）。实测三态：默认 logo 29px / 悬停 panel 16px / 移开 logo。我方原收起态把 panel 图标常驻显示（"折叠之后为什么还持久展示"），已改为 `group-hover` 切换。

复核实测（我方 5199，与原站一致）：收起默认 `img display:block 28px / svg none`；悬停 `img none / svg block 16px`；移开回 logo；展开态常驻 panel 图标 20px（位置 x=207/y=14 vs 原站 208/14）。

门禁：tsc 0 / eslint 0 / vitest 49 / build ok / `git diff --check` clean / DOM 门禁全绿（终值见 §15）。截图 `visual-fix/30-nav-fold-collapsed.png`；原站参照在 `research/.../10-qoderwake-product-research/screenshots/`（cutover-nav-collapsed.png）。

### 19.11 追加：侧栏按钮尺寸对齐（同日）

以原站实测（`/work-management`，1440×900）逐项对齐：

| 元素 | 原站实测 | 我方（修正前） | 我方（修正后） |
|---|---|---|---|
| 底部图标按钮 | 28×28，padding 6px，radius 4px，**图标 16px** | h28/**w47**，pad 4px，图标 **20px** | 28×28 / 图标 16px |
| 收起态底部 | **仅图标按钮**（column，间距 12px，footer pad `12px 0`），不显示头像/账号 | 头像 24px 常驻 + 齿轮 | 仅齿轮 28×28 @ x=18，账号块隐藏 |
| 展开态头像 | 28px + 名称(strong) + 团队版 | 24px | 28px |
| 导航项（展开） | x=12 / w=216 / h32 / pad `4px 8px` / radius 4 / 图标 16 | x=8 / w=223 | x=12 / w=215 / 图标 16 |
| 导航项（收起） | x=0 / **w=64 满轨** / h32 / 图标 16 | x=8 / w=47 | x=0 / w=63 / 图标 16 |

根因：①底部齿轮用了 `size-5`(20px) 图标 + `p-1`，且收起态保留了账号块；②导航容器固定 `px-2`，收起态未去掉左右内距，导致项不满轨。

修正：底部按钮统一 28×28/pad6/radius4/图标16；收起态 footer 仅图标；导航容器展开 `px-3`、收起 `px-0`，项 `w-full`。

门禁：tsc 0 / eslint 0 / vitest 49 / build ok / `git diff --check` clean。截图 `visual-fix/31-nav-expanded.png`、`30-nav-fold-collapsed.png`。

### 19.12 追加：收起态「紧凑胶囊」（同日）

反馈「这个为什么不做？」指向原站 `qc-quests-sidebar__compact-directory` —— 侧栏收起后**并未清空**，仍保留一个白底竖向药丸胶囊（`compact-capsule`），内含「+ 新建（→ /recruitment-market）」与 Agent 头像快捷入口（Group 切换不引入）。

原站实测：胶囊 x=12/w=40、白底、`border-radius:9999px`、`padding 8px`、column `gap 12px`、内容高（约 197px，向下随 Agent 数增长，超出滚动）；内部项 24×24（图标按钮 24×24 / 头像 24×24 圆形）；上方有 24×1 分隔线。

我方此前 `if (collapsed) return null` 把整块 Agent 列表隐藏了。已补：收起态渲染白底竖向胶囊（x=12/w=40/radius 全圆/padding 8/gap 12），内含「+ 新建 Agent」（跳 /agents/new）与活跃 Agent 头像（头像 24px，当前 Agent 加 ring 高亮，title 提示名称），内容高、超长可滚。实测（当时）：胶囊 x=12/w=40、白底、含 3 个按钮（新建 Agent / 数据分析师 / 业务分析-通话打标）；审计项4 将草稿「数据分析师」归档后，胶囊现为 2 个按钮（新建 Agent / 业务分析-通话打标）。

诚实差异：原站另有「切换到 Group」按钮与「新建 Waker」链接，Group 能力按任务书不引入，故胶囊内不设该项。

门禁：tsc 0 / eslint 0 / vitest 49 / build ok / `git diff --check` clean / DOM 门禁全绿（终值见 §15）。截图 `visual-fix/30-nav-fold-collapsed.png`。

### 19.13 追加：执行者列与触发来源枚举（同日）

**执行者展示**：原站 `qc-work-management-assignee` 是「avatar 20px + 名称」的组合（可点进员工详情，Workflow/AgentFlow 执行者无 avatar）。我方列表视图此前只渲染纯文本执行者名（泳道视图已有 avatar）。已改为「`avatarFor(executor_id) 20px` + 名称」，与泳道卡一致。

**来源枚举**：原站「触发方式」筛选只有 **7 值**（含"全部"）：全部 / 手动触发 / 定时触发 / 事件触发 / API 触发 / @Waker 触发 / 对话触发。我方此前直接透出后端内部 `SOURCE_LABELS` 的 9 个执行载体 kind（含 `Workflow`/`AgentFlow`/`Agent`/测试 等），属于把"执行载体"误当"触发来源"——这就是"来源为什么这么多类型"。

修正：`SOURCE_LABELS` 收敛为面向用户的中文触发类型（manual→手动触发、chat→对话触发、schedule→定时触发、api→API 触发、event/webhook→事件触发、at_waker/im→@Waker 触发），其余执行载体（workflow/agentflow/batch/agent_tool/test/eval）按入口来源折叠到「手动触发/对话触发」。`/api/board/filter-options` 只返回 6 个触发类型（按内部 kind 集合归并），`source` 过滤支持逗号集合。实测：列表来源仅出现 手动触发/对话触发/API 触发，下拉为 全部+6 类型，与原站一致。

门禁：tsc 0 / eslint 0 / vitest 49 / build ok / `git diff --check` clean / DOM 门禁全绿（终值见 §15） / pytest 481。截图 `visual-fix/26-mtc-task-list.png`。

### 19.14 追加：流程图标统一（Workflow / AgentFlow，同日）

原站全站对「流程」只有一个图标：**WakerFlow 图标**（`qc-capabilities-page__tab-icon`，资源页五页签与 Waker 详情导航 `Wakerflow` 项为同一 path），实测 path：
`M4 15V8.5C4 6.01472 6.01472 4 8.5 4C10.9853 4 13 6.01472 13 8.5V15.5C13 16.8807 14.1193 18 15.5 18C16.8807 18 18 16.8807 18 15.5V8.82929C16.8348 8.41746 16 7.30622 16 6C16 4.34315 17.3431 3 19 3C20.6569 3 22 4.34315 22 6C22 7.30622 21.1652 8.41746 20 8.82929V15.5C20 17.9853 17.9853 20 15.5 20C13.0147 20 11 17.9853 11 15.5V8.5C11 7.11929 9.88071 6 8.5 6C7.11929 6 6 7.11929 6 8.5V15H9L5 20L1 15H4ZM19 7C19.5523 7 20 6.55228 20 6C20 5.44772 19.5523 5 19 5C18.4477 5 18 5.44772 18 6C18 6.55228 18.4477 7 19 7Z`

我方此前图标不统一：Workflow 与 AgentFlow 侧栏项分别用 lucide `Workflow`/`Waypoints`，AgentFlow 列表页头用 `GitBranch`，资源卡/图标组用 lucide `Workflow` —— 四个不同图标。

修正：新增 `FlowIcon`（原站 path 原值），统一用于 ①侧栏 Workflow 项 ②侧栏 AgentFlow 项 ③AgentFlow 列表页头 ④资源卡 `TYPE_ICON.workflow` 与 meta 行 ⑤`wf-icons` 图标组「流程」项。实测复核：侧栏 Workflow 与 AgentFlow 两 svg path 完全相同（`same:true`），页头一致，无箭头残留。

门禁：tsc 0 / eslint 0 / vitest 49 / build ok / `git diff --check` clean / DOM 门禁全绿（终值见 §15） / pytest 481。截图 `visual-fix/31-nav-expanded.png`、`19-agentflows-list.png`。

### 19.15 追加：执行者 icon 按类型 + 导航 icon 回滚（同日，修正 19.14 的误改）

上一轮（§19.14）我误把「全站统一成一个流程图标」理解为「Workflow 与 AgentFlow 合并为同一个图标」，把导航/页头/资源卡/图标组全部换成同一个 `FlowIcon`——这抹掉了两类对象的区分。本轮按真实意图修正：

1. **导航 icon 回滚**：侧栏 `Workflow` 恢复 lucide `Workflow`、`AgentFlow` 恢复 lucide `Waypoints`；`agentflows` 页头同样用 `Waypoints`（与导航一致）；`resource-card` 与 `wf-icons` 图标组回滚 lucide `Workflow`；`logo.tsx` 移除 `FlowIcon`。即：每类型保留**自己的**固定 icon，且同一类型在「导航 / 页头 / 列表 / 资源卡」各处一致。
2. **任务列表执行者 icon 按类型**（原站 `qc-work-management-assignee` 同构）：
   - Agent 会话 → 该 Agent 头像（圆形 20px）；
   - Workflow 运行 → `Workflow` 图标（中性方块 20×20，`--fill-tertiary`）；
   - AgentFlow 运行 → `Waypoints` 图标（原站 flow-avatar 实测：软绿方块 20×20 / radius 4 / 图标 ≈18，`--status-success-soft` + `--status-success`）。

此前执行者列一律渲染 `avatarFor(executor名)`，所以 Workflow/AgentFlow 行错显成了一个兜底头像（这就是"执行者的 icon 搞错了"）。实测复核：列表执行者列现为三类图标混合（`kinds: [AgentFlow, agent, Workflow]`），AgentFlow 行软绿方块、Workflow 行中性方块、Agent 行头像。

门禁：tsc 0 / eslint 0 / vitest 49 / build ok / `git diff --check` clean / DOM 门禁全绿（终值见 §15）。截图 `visual-fix/26-mtc-task-list.png`、`21-agentflow-runs.png`、`31-nav-expanded.png`。

### 19.16 追加：新建 Agent 卡片网格与悬停操作（同日）

原站 `.rm-grid` 实测：`grid-template-columns: repeat(auto-fill, minmax(min(100%, 276px), 1fr))`（**弹性自适应**，容器 1136px 下 4 列 × 275px），非固定 2/3 列。我方此前用 `sm:grid-cols-2 lg:grid-cols-3`（固定断点列数），且卡片「查看 X 的详情」按钮**常驻**。

修正：
1. 网格改 `repeat(auto-fill, minmax(min(100%,271px),1fr))` 弹性；内容区容器对齐原站（`max-w-[1200px] p-8` → 1440 视口内容宽 1136）。实测：容器 1136 / 4 列 / 卡宽 275，与原站逐值一致。
2. 卡片操作区改「查看详情 + 创建」两按钮，默认 `opacity-0`，**悬停卡片才显示**（`group-hover`，对齐原站 `.rm-card__actions` 的 `opacity/visibility` 过渡）；「创建」直接基于该模板创建（不再只跳详情抽屉）。

门禁：tsc 0 / eslint 0 / vitest 49 / build ok / `git diff --check` clean / DOM 门禁全绿（终值见 §15）。截图 `visual-fix/04-agent-create.png`、`04b-agent-create-hover.png`。

### 19.17 追加：新建 Agent 统一为单一「完善信息」页（同日）

用户要求：任何类型的 Agent 都统一进同一个创建页（原站 `/wakers/new?template=<id>` 同构）。

原站实测结构：面包屑（创建 Waker › 完善信息）+ 表单列（h2「创建 {模板}」、头像+上传头像、名称*、我负责什么*（预填模板描述）、运行环境（本地/当前设备/在线 + 切换运行环境 + 说明）、Skills(N)（chip+移除 / 从市场添加 / 上传Skill）、知识库（添加知识库）、连接器(N)（添加连接器）、创建/暂不创建）+ 右侧「员工预览」aside（400px/#F9F9F9：头像大图+员工名称+模板名+本地 chip+日期+主要负责）。

我方重写 `src/pages/agent-create.tsx`：
- `/agents/new` = 模板市场（自适应网格卡，悬停显「查看详情/创建」）；
- `/agents/new?template=<id>` = 统一创建/完善信息页，**module / preset / custom 三类模板共用同一表单**（module 模板只读说明其内置 Schema/治理；preset/custom 可编辑角色配置 Markdown）；
- 表单字段与右侧员工预览按原站同构；「创建」按模板 kind 调 `agentApi.create`（module → moduleKey；preset/custom → custom+rolePrompt+skills），并挂载 skills/mcps/knowledges；
- 无模型时「创建」禁用并给引导（不产生不可运行 Agent）。

E2E：market → `?template=custom` → 填名称/职责 → 创建 → 跳 `/agents/<id>`（toast「已创建…」）→ 归档清理。三视口 DOM 边界全过（含 `?template=preset-frontend`）。

门禁：tsc 0 / eslint 0 / vitest 49 / build ok / `git diff --check` clean / DOM 门禁全过（终值见 §15）。截图 `visual-fix/04-agent-create.png`、`04b-create-form.png`。

### 19.18 追加：移除「运行环境」+ 重做三个选择弹窗（同日）

1. **移除「运行环境」区块**（本地/当前设备/在线/切换运行环境）：用户判定"这不是我们的功能"（多设备运行为原站特性，我方单设备）。已从统一创建页删除。
2. **重做 添加Skill / 添加知识库 / 添加连接器 弹窗**：原实现为"点按即生效的卡片列表 + 完成按钮"，无搜索、无确认、无已选计数。重做为统一 `PickerDialog`：
   - 标题 + 说明；
   - 搜索框（按名称过滤）；
   - 复选行列表（Checkbox + 名称，选中行高亮）；
   - 空态（暂无可选项 / 没有匹配项）；
   - 页脚「已选 N 项」+ 取消 / **确认**（确认才写回表单）。
   实测：打开「从市场添加 Skill」→ 搜索框在、3 行复选、页脚 取消/确认、「已选 0 项」→ 勾选后「已选 1 项」→ 确认 → 表单出现已选 chip。

门禁：tsc 0 / eslint 0 / vitest 49 / build ok。截图 `visual-fix/04c-picker-dialog.png`、`04b-create-form.png`。

### 19.19 追加：选择弹窗改卡片式（同日）

用户反馈：skill 添加弹窗里 skill 应是**卡牌**；知识库添加也要**带 icon 的卡片**。原站实测：skill 市场弹窗为 `.skill-market-card` 卡片网格（icon + 名称 + checkbox + 描述两行截断）；知识库弹窗为带 icon 行卡（icon + 标题 + 来源 + 勾选指示）+「已选择 N 个」。

重做 `PickerDialog`（`src/pages/agent-create.tsx`）：
- **skill**：2 列卡片网格；每卡 = 图标（原站 skill-market fallback svg path 原值）+ 名称 + Checkbox + 描述 `line-clamp-2`；选中卡高亮；
- **kb / mcp**：带 icon 行卡（知识库用原站 knowledge-picker 的 book svg path 原值；连接器用 Plug）+ 标题 + 来源/描述 + 勾选指示（Check）；
- 公共：搜索框 + 「已选择 N 个」+ 取消/确认；选项数据带 description（registry 返回的 description 透传）。

实测：skill 弹窗 6 张卡 / 2 列 / 每卡有 icon+checkbox+描述 /「已选择 0 个」；kb 弹窗行卡有 icon + 来源行 +「已选择 0 个」。

门禁：tsc 0 / eslint 0 / build ok。截图 `visual-fix/04c-picker-skill-cards.png`、`04d-picker-kb-cards.png`。

---

## 20. 用户指出问题清单（本线程逐条对账）

> 用户在本线程先后指出的全部问题，逐条给出处置与证据。证据目录：
> `research/morethancorn/11-p0-rework-20260910/evidence/`（visual-fix/ 截图、dom-bounds.json、p0a/p0h/e2e JSON）。

### 20.1 第一轮（Agent 详情 14 项 + 4 项）

| # | 用户指出 | 处置 | 证据 |
|---|---|---|---|
| 1 | 无对话任务时，输入消息不会自动产生一个任务 | `sendText` 无 session 时先 `POST /sessions` 建对话任务再发送 | §19.2；浏览器实测 URL 出现 `?session=` |
| 2 | 对话任务无法删除 | 左列表 ⋯ 菜单「删除对话任务」→ 确认弹窗 → `DELETE /api/v2/agents/{aid}/sessions/{sid}`（运行时 Session + 平台索引同删） | §19.2；实测 4→3 |
| 3 | 无法新建自动任务 | 执行者默认预选第一个**真正可执行**的 Agent（审计返工1 后按后端 `executable` 过滤，现默认「业务分析-通话打标」）+ 保存前 agent/workflow/agentflow 必填校验 | §19.2；evidence/automation-target-rejection.json 6/6 |
| 4 | 对话输入没有严格还原 | composer 对齐原站：选择工作目录 / + 添加文件或图片 / 模型下拉 / 自动滚动 / 发送·停止 | §19.2 |
| 5 | 任务看板不对 | 工作记录改原站白卡（值 26px）+ 泳道卡对齐 + 执行者/来源/状态 chip | §19.2/19.7/19.13 |
| 6 | 丢失【自主工作】 | Agent 详情新增「自主工作」子页（原站 /triggers 同构） | §19.2 |
| 7 | 连接器做的不对 | 连接器子页对齐原站（我的连接器/市场/手动添加/JSON 导入） | §19.2 |
| 8 | 没有 waker 档案 | Agent 详情新增「Agent 档案」子页（identity/persona/bible + 归档管理） | §19.2 |
| 9 | wakeflow 列表丑陋，应卡片 | AgentFlow 列表改卡片网格（新建占位卡 + flow 卡 + ⋯） | §19.2 |
| 10 | wakeflow 详情/运行历史不对 | 详情改阶段卡画布 + 执行记录视图（右栏 run 列表 + 节点状态/attempt/Session/重跑） | §19.2 |
| 11 | 数据接入无法新建 | 弹窗补「保存」按钮（原只有取消） | §19.2 |
| 12 | Agent 列表对话按钮无法点击、齿轮按钮是假的 | 操作行 `z-10` 压过同格不可见统计层；齿轮为真实 DropdownMenu（主题/设置/退出） | §19.2；实测点击进 /chat |
| 13 | 自定义 agent 弹窗太窄 | 512 → 768（sm:max-w-3xl） | §19.2 |
| 14 | skill 详情页和原站完全不一致 | 改原站「安装 Skill」式弹窗（选择要安装的 Agent + 确认） | §19.2 |

### 20.2 第二轮（卡片/图标/来源/统一创建/弹窗）

| # | 用户指出 | 处置 | 证据 |
|---|---|---|---|
| 15 | 泳道卡片样式不对 | 卡内边距/间距按原站内层 button 实测（p12/gap8）；卡高 154→114 | §19.7；visual-fix/25/26 |
| 16 | 折叠后按钮仍持久展示，应悬停才显 | 收起态默认品牌 logo，`group-hover` 才切面板图标（原站 opacity/visibility 同构） | §19.10；实测 opacity 0→1 |
| 17 | 执行者展示没做到位 | 执行者列按类型：Agent 头像 / Workflow 中性方块 / AgentFlow 软绿方块（原站 flow-avatar 实测） | §19.15；visual-fix/26 |
| 18 | 来源为什么这么多类型 | 后端 SOURCE_LABELS 收敛为原站 7 值枚举（手动/定时/事件/API/@Waker/对话触发），执行载体折叠 | §19.13；实测下拉 全部+6 |
| 19 | agentflow 的 icon 搞错了 | 侧栏/页头/列表统一 `Waypoints`（与导航一致） | §19.15 |
| 20 | workflow 的 icon 搞错了 | 侧栏/资源卡/图标组统一 lucide `Workflow` | §19.15 |
| 21 | 导航的 icon 给我回滚 | 撤销 19.14 的「合并为同一 FlowIcon」误改；每类型保留自己的固定 icon | §19.15 |
| 22 | 卡片应自适应宽度 | 网格改 `repeat(auto-fill, minmax(min(100%,271px),1fr))`；容器 1136 → 4 列×275（与原站逐值一致） | §19.16；实测 4 列 |
| 23 | 卡片按钮悬停才展示 | 卡操作区默认 opacity-0，group-hover 显「查看详情/创建」 | §19.16；实测 0→1 |
| 24 | 新建任何类型 agent 统一成一个页面 | `/agents/new?template=<id>` 统一「完善信息」页（module/preset/custom 共用）+ 右侧员工预览 | §19.17；E2E 创建→详情→归档 |
| 25 | 「运行环境」不是我们的功能，去掉 | 整块移除（多设备运行为原站特性） | §19.18；实测页面已无 |
| 26 | 添加 skill/知识/连接器弹窗做的不好，重做 | 统一 PickerDialog：搜索 + 已选 N 个 + 取消/确认（确认才写回） | §19.18；visual-fix/04c |
| 27 | skill 添加弹窗里 skill 是卡牌 | skill 弹窗改 2 列卡片网格（原站 svg icon + 名称 + checkbox + 描述两行） | §19.19；visual-fix/04c |
| 28 | 知识库添加也是有 icon 的卡片 | kb/mcp 弹窗改带 icon 行卡（原站 book svg / Plug + 标题 + 来源 + ✓） | §19.19；visual-fix/04d |

### 20.3 汇总

- 28 项用户指出问题：**全部处置完毕**，均有浏览器实测或门禁证据（二轮独立门禁全绿后复核成立，§15/§23）；
- 无一项以"范围外/不做"搪塞（唯一移除项「运行环境」为用户明确指示移除）；
- 误改（19.14 合并 icon）已按用户指示回滚（§19.15）。

## 21. 最终状态

**READY_FOR_INDEPENDENT_AUDIT**（首审 6 项 §22 + 二审 7 项 P0 §23 全部闭环后重新送审）

全部门禁最终复跑绿（实际条数与时长见 §15）：pytest **489×2 轮（0 failed/0 skipped）** / 空库迁移链→head **g054** / vitest **64** / tsc 0 / eslint 0 / build ok / `git diff --check` clean / DOM **36/36**（11 路由+弹窗态×3 视口）/ e2e_browser_flow 加固版 **22/22** / e2e_task_execution 重写版 **15/15** / evid_streaming_chat **10/10** / evid_model_selection **10/10** / evid_automation_rejection **6/6** / p0h **17/17**（早轮，登记）；
数据库终值见 §14（**evidence/db-counts-final.json**）；孤儿引用 10 类全扫 **0**；
未提交、未推送、未部署；等待独立审计。

---

## 22. 首审返工应对（REWORK_REQUIRED → 逐项闭环，2026-09-10）

> **本节为首审轮历史记录**。其中被二轮（§23）更新的部分以本节内标注与 §13–§15 终值为准：
> DOM 门禁 24/24 → 终值 **36/36**；e2e_task_execution 10/10 → 重写为 **15/15**；model-selection 8/8 → 扩展为 **10/10**；
> §22.6 中「e2e_browser_flow/p0h 未复跑」的说明对 p0h 仍成立，e2e_browser_flow 已在二轮加固并复跑（**22/22**）；
> §22.5 快照终值以 **db-counts-final.json（§14）** 为准；首审轮 Task 证据链（taskRun b6a626ee）的 run/session 行因 §23.6 事故受损，
> 活体证据以二轮链（taskRun 17a856f0）为准。

独立审计对本报告首版判 **REWORK_REQUIRED**（6 项返工 + 7 项停止条件）。以下为逐项根因、修复文件与最终证据；本报告 §1–21 已同步做全文内联一致性修订（过期数量一律改为最终证据值，失效 DB 引用一律标注清理去向）。

### 22.1 返工项1：自动任务三个执行对象选择器只返回真正可执行对象（前后端同一判定）

- **根因**：前端 automations-v2 选择器只过滤 `!archived`，而后端 `as_automations._validate_target` 要求「未归档 且 有 active prod Release」——两套判定不一致，前端可保存、后端 422 拒绝。
- **修复文件**：`server/app/routers/agents.py`（列表项新增 `executable` 字段，判定与 `_validate_target` 完全同源）；`src/services/wf-api.ts`（类型补 `executable?: boolean`）；`src/pages/automations-v2.tsx`（agent 选择器按 `executable===true` 过滤、workflow 按 `published`、agentflow 按 `active_release_id`；默认预选第一个 executable Agent）。
- **证据**：evidence/automation-target-rejection.json（**6/6 PASS**）——①全量 13 Agent 快照中 executable 仅「业务分析-通话打标」；②归档草稿「数据分析师」→ 422 TARGET_ARCHIVED；③归档草稿「前端工程师」→ 422 TARGET_ARCHIVED；④临时解除归档的数据分析师（无 active prod Release）→ 422 TARGET_NOT_EXECUTABLE（验证后恢复归档）；⑤正向对照：活跃 Agent 创建自动任务 201 → 立即删除（automations 余 0）；⑥三选择器数据源快照（agents 1 / workflows published 2 / agentflows 0）。

### 22.2 返工项2：Agent 创建页真实模型选择（废除 models[0] 静默绑定）

- **根因**：原实现创建时静默取 `models[0]` 绑定，用户无选择权且不可见。
- **修复文件**：`src/pages/agent-create.tsx`——新增必选「模型」下拉（数据源 `/api/registry/models` 真实列表）；未选时【创建】按钮 `disabled` + toast「请选择模型」双重拦截；payload 显式携带 `modelRef: { modelId }`；无可用模型时给出配置引导文案。
- **证据**：evidence/model-selection.json（**8/8 PASS**）+ 截图 evidence/model-selection/01-before-select.png（未选模型按钮 disabled=true）/ 02-dropdown-open.png（下拉 4 项：占位+qwen3.8-max/qwen-max/qwen-plus）/ 03-model-picked.png（选中 qwen-max）。**API payload 实录**（请求拦截，非 mock）：`{"name":"EVID-MODEL-TEST",…,"modelRef":{"modelId":"qwen-max"},"type":"custom",…}` → POST 201 → GET 服务端绑定 `{"modelId":"qwen-max"}` 与所选一致（刻意选第二个真实模型证明非默认绑定）→ 验收 Agent（ff6bccce）归档清理。

### 22.3 返工项3：Task 真执行 E2E（创建→启动→TaskRun→Run/Session→终态→输出→清理）

- **根因**：旧 e2e 只验证「任务创建 + 引用 Agent」，未走真实执行链。
- **修复文件**：`server/app/routers/runs.py`（GET /api/runs 支持 `taskRunId`/`agentId` 过滤；DTO 补 `taskId/taskRunId/agentId/agentscopeSessionId/output`，链路可查证）；新增 `scripts/e2e_task_execution.mjs`。
- **证据**：evidence/e2e-task-execution.json（**10/10 PASS**，真实 LLM 执行非 mock）：task_create 201（executionTarget=agent e773172b，数据集 20 条、抽样 first_2）→ task_start 202（taskRunId b6a626ee，冻结 release 7b1132ed）→ TaskRun 终态 succeeded（total=20 数据集 / succeeded=2 抽样 / failed=0）→ 2 条 Run 存在 → 2/2 挂真实 agentscopeSessionId → 2/2 终态 succeeded 且 output 含 content → 2/2 已入 agent_session_index → 任务归档清理 200。

### 22.4 返工项4：清除本轮遗留草稿 Agent 与 P0-EVID-FLOW

- **处置**（全部留痕，先核验后删）：
  - 草稿 Agent「数据分析师」（ed057326）、「前端工程师」（4d78a08a）→ `PUT /api/agents/{id} {"archived":true}` **归档**（DB 复核 archived=t），退出产品运行面与全部选择器；
  - 「P0-EVID-FLOW」（5dca12db）→ **物理删除**：agentflow_node_run×4 → agentflow_run×2 → agentflow_release×1 → agentflow_version×1 → agentflow_definition×1（单事务，删前确认无 FK 约束、按子先父后顺序；删后五表计数全 0）；
  - 同族清理（同一 P0-EVID 取证脚手架，来源确认为本轮脚本所建）：「P0-EVID-WF」（d7ac9313）workflow + 其 2 条 run（23ca0b7c「WF-OK」真输出 / 8f272588 基线轮）+ 1 条 call_record（qwen-plus 模型调用记录）；脚本产生的 10 条测试连接（e2e-mcp-conn×5 / p0h-safe-mcp-conn×3 / vis-mcp-conn×1 等，删前核验 tool/datasource/model_provider/runtime_provider/mcp_server/secret_revision 六类引用全 0）。
- **历史 E2E 遗留的「前端工程师」×4、「E2E-统一创建-X」**：早已归档（非活跃面），维持归档处置。

### 22.5 返工项5：清理后重新采集数据库快照

- evidence/db-counts-after.json 已**在全部清理与补证脚本自清理之后**重采（旧快照作废），终值全文录入 §14。关键数字：agent 14（13 归档+1 活跃）/ release active 1 / legacy provider enabled 0 / agentscope agents 21 / sessions 10 / messages 34 / session_index 8 / tasks 13（active 3）/ automations 0 / runs 176 / task_runs 38 / connections 11 / workflows 2 / **agentflows 0**。

### 22.6 返工项6+7：报告数量从最终证据重写 + §1–21 全文一致性检查

- 已内联修订（非末尾追加）：DOM 21/21→**24/24**（§13/§15/§19.4/§19.7–19.17/§21 共 12 处）；e2e_browser_flow 17/17→**18/18**；p0h 14/14→**17/17**（§12/§15）；§14 数据库数字全部替换为清理后终值；§5/§11 中已删除 DB 行（23ca0b7c/3894b2d2）的"活体"表述改为"曾 succeeded，记录存 e2e-browser.json，DB 行按审计项4 清理"并补现行活体证据指向；§9 补模型选择链；§17 git 计数 183→195（二轮终值 **203**，见 §17/§23.8）；§19.2/§19.12/§20.1 中「数据分析师」相关的过期默认值/胶囊成员表述更新为归档后现状；§15 补三个新证据脚本的实际条数与"为何不复跑 e2e_browser_flow/p0h"的诚实说明（复跑会重新污染清理后快照）。
- 本报告内所有数量均可由 evidence/*.json 逐项复核。

### 22.7 停止条件遵守声明

本轮返工全程：未提交/未推送/未部署；未伪造任何 Knowledge/Session/事件/运行记录/观测数据；未以最终消息冒充流式；未把 mock 称为真实 E2E；未删除无法确认来源的数据（所有删除对象均为本轮脚本产物且删前核验引用）；未将 QoderWake 要求功能登记为范围外；未修改历史验收结论掩盖失败（过期口径按审计要求内联改判并标注证据来源）。19830 原站只读未触碰；5173/8000 端口服务未动。

### 22.8 首审轮送审（历史）

首审 6 项返工闭环后曾报 READY_FOR_INDEPENDENT_AUDIT（快照 db-counts-after.json）。**该结论已被二审轮（§23）接替**：二审在首审基础上又发现 5 处真实产品缺陷并发生 1 起验收事故（均已修复/处置），最终送审状态以 §23.9 为准，数据库终值以 db-counts-final.json（§14）为准。

---

## 23. 二审返工轮（执行 Agent 任务书：7 项 P0 + 门禁 + 停止条件，2026-09-10 晚）

> 本节为二轮（本报告当前版）的完整闭环记录。G0 只读现场记录 = evidence/g0-site-record.json（git 状态、逐表计数、未归档 Agent 与 active Release、E2E/P0/TEST/SMOKE/EVID 名称扫描、产品/历史/验收临时/来源不明四分类、孤儿清单）。

### 23.1 修改文件清单（本轮新增/修改，已并入 §2）

后端：`as_automations.py`（Workflow published 校验 + AgentFlow NOT_FOUND/NOT_EXECUTABLE 语义分层）、`as_agents.py`（会话删除 Run 引用守卫 409）、`tests/test_audit_executability.py`（新，6 测试）、`tests/test_audit_session_guard.py`（新，2 测试）。
前端：`src/lib/executable-targets.ts`（新，唯一判定 helper）+ 同名测试（6）、`automations-v2.tsx`（helper 接入 + 三类空态发布引导 + 保存禁用）、`automations-v2.executables.test.tsx`（新，3）、`agent-create.model.test.tsx`（新，3）、`task-form-sections.tsx`（向导目录收录 executable custom Agent + 合并竞态修复 + 文案）、`agent-chat.tsx`（streamAliveRef 死通道重挂 + 重连失败续接退避链 + AgentScope 四态 reconcileAfterReattach 对账 + 持久化成功后原子收尾 + 8s 无帧看门狗）。
脚本：`e2e_task_execution.mjs`（重写）、`e2e_browser_flow.mjs`（加固）、`evid_model_selection.mjs`（扩展）、`evid_streaming_chat.mjs`（新）、`evid_automation_rejection.mjs`（微调）、`check-dom-bounds.mjs`（11 路由+弹窗态）。

### 23.2 七项 P0：根因 → 修复 → 验证证据

**P0-1 可执行对象统一判定**。根因：前端 `!archived` 近似 vs 后端「未归档+active prod Release」两套语义漂移；且后端 Workflow 目标只查存在性（草稿可保存、定时触发必败 NO_PUBLISHED_VERSION）、AgentFlow「无 active Release」被误归 TARGET_NOT_FOUND。修复：唯一判定 = `src/lib/executable-targets.ts`（agent→后端 executable 字段；workflow→published；agentflow→active_release_id），后端 `_validate_target` 补齐 Workflow published 校验与 AgentFlow 语义分层；弹窗空态（发布引导链接 + 保存禁用）；后端 422 兜底保留；未自动发布任何草稿。验证：`test_audit_executability.py` **6/6**（executable 标志矩阵含 sandbox-only/归档/缺字段、草稿 422 TARGET_NOT_EXECUTABLE、归档 422 TARGET_ARCHIVED、可执行保存+run-now+history、Workflow 草稿 422/published 201、AgentFlow 无 Release 422/有 Release 201）；`executable-targets.test.ts` **6/6** + `automations-v2.executables.test.tsx` **3/3**（默认预选第一个 executable、草稿不出现、空态可见且不能提交）；浏览器实证：e2e_task_execution「wizard_agent_selector_lists_published_only」（选项=仅「业务分析-通话打标」，泄漏=0）+ e2e_browser_flow「automation_selector_real_pick」（实开下拉点选）。

**P0-2 模型选择**。根因：`models[0]` 静默绑定。修复+验证见 §9/§22.2（首审轮已修）；本轮扩展证据链至发布快照：`evid_model_selection.mjs` **10/10** —— 未选禁用（disabled=true）→ 真实下拉（/api/registry/models 4 项）→ 刻意选第二个模型 qwen-max → 拦截 POST payload `"modelRef":{"modelId":"qwen-max"}` → 创建 201 → GET 绑定一致 → **配置页刷新后仍显示 qwen-max**（截图 04-config-after-refresh.png）→ 创建版本+发布 prod → **release.runtime_binding_snapshot.frozen_model_key=qwen-max（psql 直查）** → executable 翻转 true → 清理（release rolled_back+audit、agent 归档、executable 回 false）。vitest `agent-create.model.test.tsx` **3/3**：模型 API 失败/空列表 → 创建禁用+「设置·连接/资源·模型」引导（不静默默认值）；有模型未选 → 填完名称仍禁用。模板无推荐模型预填（如未来引入只作可见默认值）。模型参数/超时仍由既定发布快照链（frozen_model_params/frozen_exec_timeout_seconds）处理，未另建体系。

**P0-3 Task 真执行 E2E（12 步全链）**。根因（新发现产品缺陷）：Task 向导目录 `loadCatalog` 只收 `type==="module"` Agent——已发布 custom Agent 在产品页面**根本选不到**；且 workflow 分支合并 `filter(moduleKey)` 在后解析时把 custom 条目整体抹掉（竞态）。修复：目录收录 executable custom Agent（与后端同源判定）+ 对称合并。验证：`e2e_task_execution.mjs` **15/15**（最终证据链，evidence/e2e-task-execution.json 含全部 ID+时间线）：
- 产品页面选择已发布 Agent：UI 实开向导下拉，选项=[业务分析-通话打标]，草稿/归档泄漏=0；
- UI 向导创建 Task：task **acaecc96**（名称/数据定义 DSH/规则集 DSH回归候选规则V1/固定数量 2 条，全部 UI 真点击）；服务端核对 executionTarget={type:agent, agentId:e773172b, versionPolicy:latest_prod_release}；
- UI 启动：详情页【立即运行】→ toast「批次已启动（17a856f0）」；
- TaskRun **17a856f0** 真实终态 succeeded（数据集 total=20，抽样 succeeded=2，failed=0），冻结 release **7b1132ed**；
- 统一 Run ×2（run_ids 见证据 JSON）均挂真实 AgentScope Session（**64bc48e8 / 92e1b4eb**）且 2/2 入 agent_session_index；
- 输出非假：两条 output.content 非空、互不相同（468/459 字节，真实逐条打标 JSON：service_type_code 等字段各异）；
- UI 恢复：详情页「最近运行=已完成」reload 后仍在；/operations/task-runs?taskId= 含该批次行 reload 后仍在；
- 失败路径：临时 Agent 发布后回滚 Release → UI【立即运行】→ 明确「启动失败」toast、页面可交互、无 queued/running 悬挂（不永久 loading）；
- 清理：task×2 归档、临时 Agent 归档、release rolled_back+audit；cleanup 失败=脚本失败。
仅创建/仅 201/仅 run_id 均不判 PASS——本链每一环都有终态断言。

**P0-4 清理与产品数据解纠缠**。G0 四分类见 g0-site-record.json。处置：首审轮已归档草稿（数据分析师/前端工程师）与已删 P0-EVID-* 维持；本轮新增显式清理（全部 dry-run 先行、显式 ID、单事务、audit 留痕）：3 条 09-10 晨孤儿 E2E run（RUN-OK 标记守卫）+ 事故产生的 5 条孤儿 run（§23.6）+ 3 条 UI 向导 E2E 任务遗留**启用**调度（每日 02:00 cron，任务已归档而调度仍活=真实残留风险）+6 occurrence。保留不动：5 历史归档 Agent、audit-A/DEMO-002B（active task，只读历史）、7 条 09-02..09-07 陈旧 running task_run、workflow「测试」/dbg-wf2（DEMO 依赖）、agentflow definition「测试」（本轮进行中 17:58 由 dev 用户现场创建，非脚本产物——来源不归本轮，按规约保留登记）。清理后孤儿 10 类全扫 **0**。

**P0-5 伪充分断言纠正**。`e2e_browser_flow.mjs` 加固版 **22/22**：
- skill_mount_via_ui 不再以「点击过安装」判过——四连终态：①后端 config.skills 含 registry id（GET /api/agents/{id} 对照 /api/registry/resources）②发布快照 _frozen_skills 含「客服话术质检技能」（psql 直查 runtime_binding_snapshot）③AgentScope workspace 注入（GET sessions/{sid}/skills 返回该技能）④真实执行行为生效（对话回复按 SKILL 步骤输出违禁词清单，排除用户消息与工具卡原文的误匹配）；
- 模板市场 article 卡片（9）与按钮（查看详情 9/创建 9）分开计数；
- Automation 执行对象改为**实开下拉、断言选项、真实点选**（首版靠默认预选巧合通过的路径已废除）；
- 每条结果 JSON 含 name/pass/expected/actual/evidence/ts；
- 清理逐步验证状态码 + release psql 回滚余量=0 + 残留守卫（未归档 e2e-mcp-conn=0、active release=0），任一失败 exit 1；
- 本轮 3 次运行产生的连接均为 API DELETE 归档留痕（未归档残留 0）。

**P0-6 流式与对话体验真实验证**（不重写既有流式实现，验证真实现场）。`evid_streaming_chat.mjs` **10/10**（evidence/streaming-verification.json + streaming/*.png）：
- SSE 事件时间线（页内 fetch-tee 记录 UI 实际消费帧）：T1 REPLY_START=1、**TEXT_BLOCK_DELTA=283**、REPLY_END=1（总 290 帧）；
- REPLY_END 前 DOM **283 次不同长度增长**（MutationObserver 时间戳 vs REPLY_END 帧时间对齐）≥3 达标；
- 上滚不被拉回：流式中滚至顶（top=0），2s 后 top=0（max=332，未回拉）；
- 工具卡聚合：Skill 工具调用 TOOL_CALL_START/END+TOOL_RESULT_END 各 1，DOM 恒为单卡（9 次采样 allSingle=true，状态演进不分裂）；
- 停止按钮：流式中点击 → 流终止、composer 回 idle、状态「已取消」；
- 断线重连不重复：页内 AbortController 显式中止当前 SSE + CDP offline 2.5s → 恢复，`stream fetches=3` 且成功 open 从断流前 1 增至 2（证明本次 T4 真正重挂成功）→ 回复完成；持久化 assistant 消息标记恰 1 条×1 次、刷新后全文=2（用户指令+回复各 1，>2 即重复）；UI 终态收尾（stopBtn=false、live=0、runtime=idle）；
- 刷新恢复：T1 后 reload 回复完整；
- 真实产品缺陷修复（本轮）：①死通道不重挂（停止/断线后 SSE 通道死亡，下一次发送走在死通道上 UI 永久 running）→ streamAliveRef + 发送后自动重挂；②重连重试链在 streamUrl 失败时直接终止 → 续接同一退避链；③重挂后运行时不重放已发终止事件 → reconcileAfterReattach 按 AgentScope 四态对账，HITL 恢复不再误报 completed，idle 先读回持久化消息再原子清 live；④终态事件丢失（客户端网络停顿但连接未断）→ 8s 无帧看门狗复用同一对账；⑤发送/确认时重置无帧计时，收到帧后重置重连预算；⑥awaiting_external_result 只显示等待态，不再暴露必然 409 的批准/拒绝按钮。修复后组件回归 6/6、T4 双检全过；
- QW 同视口对照（1440×900）：左历史栏 x=64/w=240（QW 实测 64/240，逐值一致）、消息流居中列 textarea w=702（QW ~720，±80 内）、「当前任务」入口与发送钮在场、composer 结构（选择工作目录/+/模型下拉/圆形发送）对齐；QW 侧数值取本日早轮活体实测（qoderwake-live-observations.md §2），本轮对 QW 产品零操作、零触发。附件/工作目录入口为诚实提示态（未接真实能力不伪造上传），无新增假按钮。

**P0-7 报告重生成**：本报告即统一修订版——全文数量从最终证据逐项核对（§13/§14/§15），失效中间轮结论已就地标注（§22 头部、§22.8），DOM=36（11 路由+弹窗×3 视口）、e2e-browser=22、p0h=17（不再出现 21/21、17/17 旧口径与 14/14）；「28 项全部完成」的 §20.3 结论以本轮独立门禁全绿为前提复核成立；Task「创建验证」（e2e_browser_flow task_created_referencing_agent）与「执行 E2E」（e2e_task_execution 15/15）已明确区分；Knowledge 火山鉴权=NOT_CONFIGURED、MQ 适配器=UNC 维持登记（§16），未扩展范围。

### 23.3 自动任务可执行对象统一判定规则（唯一口径）

- **Agent**：`未归档 AND 存在 environment=prod、status=active 的 Release`——由后端 `/api/agents` 列表 `executable` 字段单点计算（agents.py），前端选择器/默认预选只消费该字段；后端保存校验 `_validate_target` 同一规则（422 TARGET_ARCHIVED / TARGET_NOT_EXECUTABLE）。
- **Workflow**：`status == "published"`（发布事务同时落 current_version_id，与 create_run(trigger=schedule) 的 NO_PUBLISHED_VERSION 要求一致）；显式固定已发布版本（workflow_version_id）时放行。
- **AgentFlow**：`resolve_agentflow_release 可解析出 active Release`（definition→version→active release 链）；前端按 active_release_id 过滤。
- 无可执行对象：前端空态+发布引导+保存禁用；后端 422 兜底保留；不存在任何自动发布草稿的路径。

### 23.4 验收临时数据清理前后清单（本轮）

| 对象 | 清理前 | 处置 | 清理后 |
|---|---|---|---|
| 孤儿 E2E run（晨轮会话被删遗留） | 3（3d77426c/f3ff2262/6d878c35，RUN-OK 标记） | dry-run→显式 ID 单事务删除 | 0 |
| 事故孤儿 run（§23.6） | 5（4424cd91/ba5b9f10/40adcaee/4351905d/9d07d057） | dry-run→显式 ID 单事务删除+audit | 0 |
| UI 向导 E2E 任务遗留启用调度 | 3（E2E-TASK-EXEC-*-schedule，每日 02:00，enabled=t）+6 occurrence | 显式 ID 删除+audit | schedule=2（历史 DEMO，disabled）/enabled=0 |
| 本轮临时 Agent | EVID-MODEL-TEST×2、E2E-BROWSER-*×3、E2E-FAILPATH-*×4（另首审轮已归档者维持） | 采证后即归档（release 均 rolled_back+audit） | 活跃面 0，全部归档 |
| 本轮临时 Task | E2E-TASK-EXEC-*×3、E2E-REF-TASK×1、E2E-FAILPATH-TASK-*×4 | API 归档 | active 面 0 |
| 本轮临时连接 | e2e-mcp-conn×3（加固版脚本运行） | 脚本内 API DELETE（归档留痕）+残留守卫 | 未归档 0 |
| 本轮临时会话 | 流式验证×4、浏览器 E2E 若干 | 脚本自删（仅自建白名单）/随 Agent 归档留存为证据 | 删除仅限自建；Task E2E 会话保留（受 409 守卫） |
| Automation | E2E-REF-AUTO、EVID-REJECT-TEST 等 | 创建即删 | automation_definition=0 |

### 23.5 门禁（命令/退出码/真实数量/时长）

见 §15（本轮最终复跑值）。补充验证：pytest 临时库两轮后自动清理（`psql -l` 仅 wf_dev）；迁移链从空库（wf_mig_check）upgrade head 成功（g054evtdlv0001，71 表）后删除。浏览器门禁覆盖任务书 10 页面项：导航（随每页）、Agent 列表、Agent 创建（市场+表单）、Agent 详情、对话、Task（/tasks+/batch-tasks）、新建自动任务（页面+弹窗交互终态）、Workflow、AgentFlow、设置页 ×3 视口=36 项，无横向溢出/页面级异常滚动/裁切。

### 23.6 验收事故登记（如实披露，不掩盖）

**事故**：二轮 P0-6 期间，聊天类验证脚本（evid_streaming_chat.mjs 早版与临时调试脚本）打开 `/agents/{id}/chat` 未带 `?session=` 时，页面自动挂载**既有会话**；脚本清理逻辑把所挂会话当作"自建会话"调用 DELETE，共误删 **5 个既有会话**：Task E2E 证据会话 ×4（3682dc0e/fa6ad246/0999b8b1/d1c968d8——首审轮 taskRun b6a626ee 与二轮中间轮次）及 **1 个用户真实使用中的会话**（ed7b3b0c，含用户 16:43 发送的「测试」消息与 Agent 回复；该会话同时是 b6a626ee 链的证据会话）。
**影响**：上述会话的运行时消息不可恢复；对应 5 条平台 Run 成为孤儿引用；首审轮报告引用的活体链（b6a626ee）降级为"平台侧记录在库、运行时会话已失"。
**处置**：①根因修复——脚本一律经 API 自建会话+白名单清理（仅删"脚本启动后新建"的会话，预存集合硬校验）；②平台守卫——DELETE sessions 对被 Run 引用的会话一律 409 SESSION_REFERENCED_BY_RUN（test_audit_session_guard.py 2/2），同类误删在平台层被阻断；③数据修复——5 条孤儿 run 显式 ID 删除+audit 留痕，孤儿 10 类归零；④证据重建——Task 真执行链全量重跑（15/15，taskRun 17a856f0，会话受守卫保护）；⑤用户数据损失无法恢复，在此如实登记并向用户致歉。
**另登记**：G0 时发现 16:43 用户真实使用产品（向 ed7b3b0c 发送「测试」并获回复、经 UI 删除一个 chat 会话）——该操作非本轮脚本所为，已计入快照口径说明。

### 23.7 UNC / NOT_CONFIGURED / FAILED 清单

- **NOT_CONFIGURED**：Knowledge 火山引擎鉴权（诚实端点+UI 横幅+发布 fail-closed 维持，§16）；
- **UNC**：MQ 消费触发适配器（触发层已解耦，未实现，不伪造入口，未借本轮扩围）；
- **FAILED**：无未修复失败项。已知非本轮缺陷登记：7 条 09-02..09-07 历史陈旧 running task_run 与 1 条 run（87fb777f，09-02）为换底前遗留状态，不属本轮对象，登记不动；对话「附件上传/工作区上下文」为诚实不可用提示态（§19.5）。

### 23.8 git 状态

`git status --short` 共 **203 项（72 M / 6 D / 125 ??）**，分支 main @ f6824f9（与 origin 的关系未变：本地领先，未推送）。完整清单以 `git status --short` 实时输出为准（本轮新增文件均已列入 §2/§23.1）。

### 23.9 停止条件逐项核对与最终判定

| # | 停止条件 | 状态 | 证据 |
|---|---|---|---|
| 1 | 选择器与后端判定一致 | ✅ | §23.3 唯一口径；pytest 6/6 + vitest 6/6+3/3 |
| 2 | 草稿 Agent 不再出现在执行者 | ✅ | wizard/automation 下拉实测选项=仅可执行对象（泄漏=0）；422 链 6/6 |
| 3 | 创建页真实模型选择、models[0] 消除 | ✅ | model-selection 10/10（payload+frozen_model_key）；vitest 3/3 |
| 4 | Task 真执行 E2E 完整通过 | ✅ | 15/15（12 步全链+ID+时间线，§23.2 P0-3） |
| 5 | 流式真实浏览器验证通过 | ✅ | streaming-verification 10/10（283 DELTA/283 增长/强制断流后 opens 1→2 且不重复） |
| 6 | 验收临时对象清理完成或逐项不可删证据 | ✅ | §23.4（保留项均给出理由：历史审计/DEMO 依赖/用户产物） |
| 7 | 数据库无新增孤儿引用 | ✅ | 10 类全扫=0（事故孤儿已显式清除并登记 §23.6） |
| 8 | 报告、证据与数据库数字完全一致 | ✅ | §13–§15 全部取自 evidence/*.json 与 db-counts-final.json |
| 9 | 所有测试门禁通过 | ✅ | §15（pytest 489×2 0f0s、迁移链、64 vitest、36 DOM、22/15/10/10/6 证据脚本） |
| 10 | 未提交、未推送、未部署 | ✅ | §23.8；数据库变更限本机 wf_dev（audit_log 留痕） |

**最终判定：READY_FOR_INDEPENDENT_AUDIT**（不自签 COMPLETED/ACCEPTED）。
未提交、未推送、未部署。等待独立审计。

> 提交说明：以上“未提交”描述的是本报告验收取证时点。用户随后授权将通过独立复核的核心实现与审计材料分批提交；提交记录以 Git 历史为准，仍未推送、未部署。
