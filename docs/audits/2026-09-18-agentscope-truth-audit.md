# 09-18 AgentScope 真实性审计（用户令：严厉审计自己，生产用）

> 方法：对照**已安装 AgentScope 2.0.8 包源码**（runtimes/agentscope/.venv site-packages）逐能力核对
> 平台装配真伪；包面清单由独立代理扫包产出，本侧装配逐处 grep/活体实证。不美化。

## 0. 七问直答

1. **AgentScope 是不是很简陋只有模型调用？** 不是。2.0.8 是完整应用框架：ReAct Agent（含权限引擎/上下文压缩/注入/HITL/中断）、官方 toolkit 装配（workspace 六内置+计划工具+调度工具组+团队工具+extra+MCP+middleware 工具）、八种 workspace 后端（含 Docker/E2B/K8s/bubblewrap 等沙箱）、Redis message bus、WakeupDispatcher、scheduler、RAG、OTel middleware、30 种会话事件+逐模型调用 token 记账。
2. **工具/skill/system prompt/team/流水线是不是都假的？** 工具=真（冻结清单→manifest→官方 toolkit，remove_tool 门禁实证）；skill=真（workspace 文件+官方 SkillViewer 工具+系统提示目录注入）；system prompt=真（release 编译存 AgentRecord）；team=真（官方 TeamCreate/TeamSay/AgentInvite，群聊活体实证）；**流水线=假的那一个**：identify→plan→barrier 只存在于提示词散文，无代码强制（barrier 靠模型自觉）——认账。
3. **权限控制是不是前端假的？** 不是前端假：runtime `tool_policy.py` 包装官方 get_toolkit，按平台冻结 tool_policy/permission_policy 用官方 `Toolkit.remove_tool` 摘除被关族 + 注入 permission_context（ask 规则→官方 HITL 确认流）。**真控制，装配期生效**。认账的边界：平台不可达时 fail-open（保持默认能力面），生产前须拍板改 fail-closed。
4. **为什么不要空间/沙盒？** 因为运行时用的 `LocalWorkspaceManager`＝裸本地目录，**没接任何沙箱后端**——AgentScope 提供 Docker/E2B/K8s/Daytona/bubblewrap/AppleContainer/OpenSandbox 七种沙箱后端，我们一个都没用。这是真缺口，不是上游没有。生产前必须拍板沙箱后端。
5. **执行时到底能装进去什么？** 见 §1 表（真/部分/假/没做逐行）。
6. **哪些开发了/没做/假代码混过去？自动化测试是不是都错？** 见 §2 认账清单与 §3 测试有效性分类。核心认账：golden harness 自 6e81200 起三缺陷（无通话文本/答案泄漏/required 不校验），其历史「20/20」验的是假行为；今日已修，真实水位 5-6/10（模型工具纪律）。平台层测试（hermetic）对平台逻辑有效、对运行时行为盲——分类见 §3。
7. **观测规划了么？** 没有完整观测模块——认账。Agent 执行（chat/structured）的事件与 token **不落库**（run_event/call_record 只服务 workflow/agentflow run）；live SSE 看完即丢。§4 给观测模块规划 O1–O5。

## 1. 逐能力核对表（AgentScope 提供 vs 平台装配 vs 真实状态）

| 能力 | AgentScope 2.0.8 提供 | 平台装配 | 真实状态 | 证据 |
|---|---|---|---|---|
| system_prompt | Agent(system_prompt=…) | release 编译（compile_system_prompt）存 AgentRecord | 真 | agent_execution.compile_system_prompt；runtime mtc_router Agent(system_prompt=agent_record.data.system_prompt) |
| 工具装配 | get_toolkit 八源（workspace 六内置/计划/后台/调度组/团队/extra/middleware/MCP） | extra_factory 桥接平台冻结 Tool（session-manifest）；tool_policy 包装摘除 | 真（今日实证 manifest 200+toolkit 含领域工具+fixture 执行 200） | runtime platform_tools.py / tool_policy.py；/tmp 探针日志 |
| 工具门禁 | PermissionEngine+PermissionContext+remove_tool | 冻结六开关+v2 三态→remove_tool+ask 规则注入 | 真（装配期）；fail-open 边界认账 | runtime tool_policy.py:get_toolkit_with_policy |
| skills | workspace 文件+SkillViewer 工具+系统提示目录 | start_session 上传冻结 skills（upload_workspace_skill） | 真 | agent_execution:689/702；包 workspace/_base.py list_skills |
| team | TeamCreate/TeamSay/AgentInvite/TeamDelete+TeamRecord+bus | group_runner 平台组队+roster SystemMsg+worker guard middleware | 真（群聊活体） | group_runner.py；09-16 验收 |
| 流水线 | 无（包内 pipeline 仅 GoalPipeline） | 「identify→plan→barrier」=提示词散文 | **假（无代码强制）** | spec.default.json instructions 散文；包 pipeline/ 仅 GoalPipeline |
| structured output | GenerateStructuredOutput 工具+校验；工具调用先于结构化检查（_next_action 次序） | run_structured 传 schema | 真；但「系统级工具纪律被模型忽略」=模型行为非装配缺口 | 包 _agent.py:_next_action；e2e9 B 系列失败实证 |
| workspace/沙箱 | Local+Docker/E2B/K8s/Daytona/bubblewrap/AppleContainer/OpenSandbox | **LocalWorkspaceManager 裸目录** | **没做（沙箱零接入）** | runtime main.py:84 |
| 上下文压缩 | ContextConfig+CompressContext 工具+offloader | 默认 config 透传 | 部分（用默认值，未调优/未观测压缩事件） | 包 _config.py |
| 注入 | InjectionConfig（时间/任务/重试提示） | 默认 | 部分 | 同上 |
| HITL/确认 | ASK→RequireUserConfirm→park→resume | 平台 confirm 端点+ApprovalCard | 真（活体实证 sudo 回合） | 09-11 验收 |
| 中断 | UserInterruptEvent | groups interrupt 端点 | 真 | group_runner/as_groups interrupt |
| 调度 | SchedulerManager+cron+ScheduleRecord+四工具 | 自动任务域接 ScheduleRecord | 真（自动任务域） | as_automations；包 _scheduler |
| 记忆 middleware | AgenticMemory/Mem0/ReMe | **未接** | 没做 | 包 middleware/；本侧无引用 |
| RAG | RAGMiddleware+KnowledgeBase+多向量后端 | knowledge 挂载→RAGMiddleware（session knowledge_config） | 真（挂载时） | mtc_router RAGMiddleware 装配 |
| MCP | workspace .mcp+每会话私有 client | MCP 挂载→workspace.add_mcp | 真（挂载时） | 包 _toolkit list_mcps |
| 观测-事件 | 30 种事件+bus replay log+live pub/sub | 仅 SSE 代理转发，**agent run 不落库** | **没做（落库缺失）** | run_event 仅 runner.py 写（workflow） |
| 观测-token | ModelCallEndEvent 带 input/output/cache tokens | **不持久化** | 没做 | 平台无 input_tokens 引用 |
| 观测-OTel | TracingMiddleware（需外部 TracerProvider） | 未配 | 没做 | 包 _tracing；本侧无 setup |
| A2A/语音 | A2AAgent/RealtimeAgent/TTS | 未接 | 没做（不需要） | — |

## 2. 自审认账清单（假/角落/缺口）

1. 流水线假：plan/barrier 无代码强制（§1）。
2. 观测缺：agent run 事件/token 不落库；live SSE 不留痕（§4 规划）。
3. golden harness 三缺陷（6e81200 引入，09-18 修）：无通话文本/答案泄漏/required 不校验；历史 20/20 验假行为。
4. logicalTools 从未进冻结清单（09-18 修）。
5. 沙箱零接入（LocalWorkspace 裸目录）。
6. manifest 不可达 fail-open（tool_policy 文档化取舍）——生产前拍板。
7. enforce_egress import 漏落 NameError（工具执行恒失败，09-18 修）。
8. 上游死配置 stop_on_reject（2.0.8 无消费者）——我们曾当它有效规划过 HITL 行为，认调研不细。
9. TurnMetrics/TurnAggregator 是语音专用——曾列入文本观测规划候选，认误读。

## 3. 测试有效性分类

| 套件 | 验什么 | 有效性 |
|---|---|---|
| 平台单测/集成（conftest hermetic 拦 runtime HTTP） | 平台逻辑（路由/冻结/闸门/映射） | 对平台逻辑有效；对运行时行为盲 |
| live 标记套件（test_p0_e2e_live_stack/test_cutover_p0）+ live smoke | 跨栈真链路 | 真但面窄 |
| golden（09-18 前） | 假行为（无通话/泄漏答案） | **无效（已修）** |
| golden（09-18 后） | 真行为（transcript+required 强制+无泄漏） | 有效；当前水位 5-6/10=模型工具纪律 |
| 门禁（tsc/eslint/vitest/migrate/secret/layer1/2） | 静态与契约 | 有效 |

结论：「每次自动都在跑错的」对**执行层**成立（golden 假+harness 盲），对平台层不成立。修后执行层 gate 首次测真行为。

## 4. 观测模块规划（用户令：需要完整观测模块）

- O1 事件落库：runtime bus replay log（session_read_events）→ 平台 run_event（agent run 也写，trace_id/span_id 复用现列）；保留期策略。
- O2 token/成本 rollup：ModelCallEndEvent tokens → run.token_usage + per-agent 日成本表；对话页/运行详情展示。
- O3 运行详情 trace UI：时间线（model call/tool call/thinking/HITL/compression），tool args/result 脱敏展示；复用 beUI 组件。
- O4 OTel 导出（可选）：TracingMiddleware+OTLP collector，dev 默认 off。
- O5 告警接线：EXCEED_MAX_ITERS/ERROR finished_reason → 告警域（待告警域拍板后接）。
顺序 O1→O2→O3 先行（O4/O5 后置）。工程量估 O1 2 天/O2 1.5 天/O3 2 天。

## 5. 生产准入清单（本审计产出）

1. 沙箱后端拍板并接入（最低 Docker 或 bubblewrap）；
2. fail-open→fail-closed 拍板；
3. 观测 O1–O3 落地；
4. golden 真实水位门禁（阈值另拍，当前 5-6/10 不得作为通过线假装通过）；
5. 云侧 AKSK 轮换 + git 历史旧 WF_SECRET_KEY filter-repo；
6. 流水线代码强制（或明确接受提示词级 barrier 并写入风险登记）。
