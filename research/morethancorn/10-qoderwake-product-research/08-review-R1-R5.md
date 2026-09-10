# 08 · 独立复核报告（R1–R5 验收 · 第二双眼睛）

> 日期：2026-09-08 · 性质：独立复核（主审计者之外的第二复核代理），`RESEARCH_ONLY`
> 复核对象：本目录 00/01/02/03/04/05/06/06a/07/EVIDENCE-INDEX 与 screenshots/（28 张）
> 基线：git HEAD `f6824f9421660a4b1e6bb23cf455e738125ebc81`（复核开始时 `git rev-parse HEAD` 实测一致；tracked 树 0 改动，untracked 仅 `.zcode/`、`exports/` 与本目录交付物）
> 独立性声明：00 的 G2 表、02 的 G3 表、03 的 G4 表、05 的 G5 表、EVIDENCE-INDEX 的 REF-BROKEN=0 声明**一律当作待证命题**，本报告全部结论来自复核代理自行的抽查（源码 sed/grep 实测、官方 URL 重放、截图逐张目视），未继承任何自检结论。
> 边界遵守：未修改任何被复核文件（本文件为唯一写入）；未改代码/迁移/docs/lockfile；未运行改状态命令与测试；未使用浏览器（截图以 Read 工具目视）；未派发子代理。

---

## R1 · 证据可重放抽查明细

### R1a · 01 的 O1/O2 结论抽查（10 条；方法=入口 URL/前置状态与 00/01 记录互核 + 对应 PNG 目视）

| # | 结论摘要（01 步骤） | 抽查方法 | 结果 | 证据 |
|---|---|---|---|---|
| O-1 | QW-01：看板指标带 8/0/0/8＋"需要操作/查收结果"=用户动作队列页签＋五筛选＋表列（O1） | 目视 g1-01-work-management.png；与 00 §2 路由/字段记录互核 | PASS | 截图含标题"任务看板"＋左轨；指标 8/0/0/8、"需要操作(0)/查收结果(0)"页签与空态文案、五筛选、表列 任务/执行者/来源/状态/最近更新、8 行（含"第 3 次运行 失败/第 2 次运行 已取消/第 1 次运行 已完成"）全部与记录一致；无空白/黑屏/遮挡 |
| O-2 | QW-02：看板行 1:1 对话 session；行粒度=run/session 级；看板混排对话/flow run/automation run 三类（O2） | 目视 tb-01-task-detail.png；与 g1-01 行、flow-02 run 列表、auto-03 回链三处互核 | PASS（附注 N-1） | 截图含左栏"前端小哥/对话任务\|自动任务/3 个任务"＋标题＋composer，会话视图判定成立；g1-01 的"第 N 次运行"三行与 flow-02 三次 run 一一对应成立。**附注 N-1**：同一 run 在看板显示"已取消"、在 flow 执行记录显示"已终止"，跨视图状态词差异 01/00 均未登记（见 F-4） |
| O-3 | QW-04：转录含工具调用（Bash/Write/list_wakerflows/TaskCreate/present_files）、产物 region(7)、composer、CoT 外露（O1+O2） | 目视 tb-01；核对 01 记录与 00 §5 路由 | PASS（附注 N-2） | 截图定位要素齐备（左轨+左栏+标题）；产物(7) region、composer（@工作区上下文/选择工作目录/Auto）、Qwen 错峰横幅可见。**附注 N-2**：本张截图为转录下段视口，工具调用卡与 list_wakerflows 响应正文不在画面内——该 O2 子面依赖 01 的 DOM 记录而非截图；不构成误导裁切，但建议补一张含工具卡的捕获 |
| O-4 | QW-05：自主工作列表指标 1/1/1/0、行=API/"通过 POST 请求触发"/switch 启用（O1） | 目视 g1-03-autonomous-work.png | PASS（加抽） | 标题"自主工作"＋副标题含"事件"字样（差异事实源头可见）、指标 1/1/1/0、四筛选、行字段与 switch[on] 全一致 |
| O-5 | QW-06：新建弹窗=名称/触发(定时\|API 两卡、1/5)/执行方式(Waker\|WakerFlow)/执行指令 0/10000/工作空间三态/高级=最大运行次数+截止日期（O1） | 目视 auto-01＋auto-02；与种子 03/04/05 声明互核 | PASS | 上半：触发方式 1、定时\|API 卡、定期\|一次性、每天 09:00、"下次运行: 2026-09-09 09:00"、添加触发方式 1/5、执行方式两卡；下半：执行对象+更换、执行指令 0/10000、工作空间三态 tab、高级设置展开（无限制\|自定义、永不截止\|指定日期及两句语义文案）。表单上下半段齐备 |
| O-6 | QW-07：自动任务详情=定义级（面包屑/四指标/atk_ URL/运行历史回链）（O1+O2） | 目视 auto-03-task-detail.png | **FAIL（敏感数据维度）**；结论自洽性 PASS | 面包屑"自主工作>详情"、Waker chip、启用/编辑/删除/运行、四指标（含 info 图标）、触发来源 API+API 调用地址、响应、高级设置全部与记录一致；运行历史表在本张视口下段未入画（01 记录存在，回链 O2 子面同 N-2 性质）。**FAIL 原因**：截图与 01 正文曾完整记录 API 调用凭据，现统一替换为 `atk_****(masked)`——原记录违反任务书 §2.3"不得读取或记录……token、凭据"，亦不满足 R1"截图没有敏感数据"判据。处置见 R5 可立即修订项 1 |
| O-7 | QW-09：Waker=资产根+运行实例混合体；九子页左 nav＋概览内容（O1） | 目视 waker-01-manage-page.png | PASS | 左 nav 四分组（工作/记忆与学习/能力与资源/权限与管理）共 12 项含概览；ID sgnj1523、入职 2026-09-08、在线徽标、工作日志四指标、热力图、任务类型分布(3/0/0)、记忆与学习时间线（front-design 等）全一致；混合体判定有画面支撑 |
| O-8 | QW-12：flow 详情=头部控件+画布阶段卡+worker chip+输入参数+版本历史入口（O1） | 目视 flow-01-detail-text-only-review.png | PASS | 返回/标题+重命名/视图 radio(WakerFlow\|执行记录)/添加触发方式/运行、画布\|脚本 tab、输入参数（右、收起态）、历史图标、阶段 01 确认→阶段 02 复核卡＋节点 chip c78b37df31ae、缩放组，全一致 |
| O-9 | QW-13：DSL 全文=meta{phases,outputSchema}+phase()+worker(resolve:{kind:'waker',wakerId})+模板串+return；保存[disabled]（O1） | 目视 flow-03-script-view.png 逐行读代码区 | PASS | 43 行 DSL 与 01 转录逐字段一致（name/description/phases 两项/outputSchema required[acknowledgement,review]/两处 resolve wakerId c78b37df31ae/${acknowledgement} 模板串/return）；保存按钮灰态可见 |
| O-10 | QW-14：run 级路由+阶段按 run 渲染（01 失败红框/02 未执行）+run 列表三行+无名图标不点（O1+O2） | 目视 flow-02-execution-records.png；与 g1-01 行互核 | PASS | 视图 radio 切到"执行记录"、右栏 run 列表（第3次 运行失败 55分钟前[selected]、第2次 已终止 9月5日12:55、第1次 已完成 12:47）、每行 2–3 个无名称图标按钮、画布阶段 01 红框"失败"/阶段 02"未执行"，全一致；与看板行互证成立（词差异见 N-1） |
| O-11 | QW-15：整数版本单条+触发弹窗 1 配置多方式+对话面板 upsert 工具链+对话式新建（O1+O2） | 目视 flow-04、flow-05、flow-07（flow-06 未目视，见局限） | PASS（附注 N-2 同型） | flow-04：右栏"历史版本=版本 1[当前版本] 9月5日12:46"；flow-05："编辑触发方式"弹窗 触发方式(1/5)*+删除、定时\|API、定期\|一次性、每天 09:00、下次运行预览、"已配置 1/5 个触发方式"、取消/保存；flow-07：对话面板"已完成 mcp__wake__workflow_upsert"工具按钮+深度思考折叠+结论表+快捷方案(基于最近运行优化/试运行)+composer。**附注**：upsert 响应 JSON 全文（digest/callSites/scope/generationSessionId）为展开态 DOM 记录，本张截图工具按钮为折叠态——O2 存储契约子面依赖 DOM 记录，建议补展开态捕获 |

**R1a 小计：10 条抽样中 9 PASS、1 FAIL（O-6 敏感数据）。** 另加抽 g1-03 一致。三条附注（N-1 跨视图状态词、N-2 转录级子面依赖 DOM 记录）不推翻结论，列入 R5 修订清单。

### R1b · 02 的 C1 结论抽查（10 条；方法=在 HEAD f6824f9 工作区（tracked 0 改动）sed/grep 实测行号与调用链）

| # | 结论摘要（02 章节） | 抽查方法 | 结果 | 证据（复核实测） |
|---|---|---|---|---|
| C-1 | §1 Q1：Agent=定义根+环境指针混合体；AgentVersion/Release/Run 字段（models.py:354-378/381-396/399-415/239-279） | sed 四段 | PASS | 354 起 Agent 类含 config_revision/sandbox_version_id/prod_version_id/archived；381 起 AgentVersion 含 definition/common_config/dependency_snapshot/artifact_hash；399 起 Release 含 environment/canary_percent/runtime_provider_id/runtime_binding_snapshot；239 起 Run 含 uq_run_taskrun_interaction_attempt 与 257-264 冗余冻结列 |
| C-2 | §1 Q2/Q6：Custom 发布断（409 NO_WORKFLOW）+运行断（failed 未绑定工作流）+前端"类型当生命周期"（wf-agent-editor.tsx:87、agent_release.py:49-51、agents.py:366-370、agent_runtime.py:704-709） | sed 五处 | PASS | wf-agent-editor.tsx:87 恰为 `const archived = Boolean(agent.archived) \|\| agent.type !== "module"`；agent_release.py:49-51 else 分支 `raise ValueError(...未绑定工作流...)`；agents.py:370 `HTTPException(409, NO_WORKFLOW)`；agent_runtime.py:704-709 `run.status="failed"..."该 Agent 未绑定工作流"` |
| C-3 | §1 Q4-1/§2.1：config.skills 存 Skill **ID** 而运行时按**名字**消费=三义错位（custom-config.tsx:88-98、agent_runtime.py:238-243,251-266、agents.py:328-337） | sed 四处 | PASS | custom-config.tsx 88-98 按钮以 `s.id` 存取；agent_runtime.py 238-243 `filter_by(name=name)`+名字占位、251-266 `build_mounted_skills_section` 8000 截断+legacy 名字列表；agents.py:328-337 mounts-health 对两轨分别校验 |
| C-4 | §1 Q7：capabilities 静态声明与实现不符（adapter.py:134-143 声明 cancel=True vs 389-390 no-op） | sed 两段 | PASS | 134-143 `ProviderCapabilities(... skills=True ... cancel=True ...)`；389-390 `async def cancel(self, run_id): return None` |
| C-5 | §2.2/§2.5 断点⑦：AgentScope 轨道工具执行体=固定 env URL 8200 fixture 服务（adapter.py:211-214,261-273；services/tool_service/README.md:3-5） | sed 三处 | PASS | 211-214 与 265 均 `QUALITY_TOOL_MCP_URL` 默认 `http://127.0.0.1:8200/mcp/`；261-273 MCPClient `enable_tools=[tool.name...]`；README L3-5 原文 "It returns fixture facts only" |
| C-6 | §1 Q5/§2.1 断点⑥：AgentExecutionSpec 无 skills/knowledge/workflows/connections 字段（contract models.py:66-74） | sed | PASS | 66 起 AgentExecutionSpec 仅 id/version/instructions/model/tools/master_data/output_schema |
| C-7 | §3 Q3：wf 链环判重+深度≤5、workflow-exec 子调用不 pin、agent 系节点 deprecated（runner.py:1121-1133,640；registry.py:111-147） | sed+grep | PASS | 1121-1127 call_chain 判重 failed；1128-1133 `len(chain)>=5` failed；640 `create_run(ctx.db, code, "manual", ...)` 无 version_id；registry.py 112/124/139 三键 `deprecated: True` |
| C-8 | §3 Q6：api 触发"声明存在、接线不存在"（models.py:902 注释、work_item_projection.py:55、agent_runtime.py:595/679 分支；全库无 trigger="api" 创建点） | sed+全库 grep | PASS | models.py:902 注释 `manual\|schedule\|backfill\|api`；ORIGINS 含 api；595/679 `elif trigger in ("schedule","api")`；start_task_run 调用点仅 runner.py:329(schedule) 与 routers/business.py:999（manual/backfill 端点 1007-1021/1032-1046、batch-run 过渡入口 1023-1030 实测在位），无任何 api 创建点 |
| C-9 | §3 Q8：Outbox 契约与执行终态分离（models.py:925-957、delivery.py:60-103/142-229/105-131/231+） | sed+grep | PASS | ResultDelivery 双 UNIQUE+max_attempts=5+dead_letter 注释即契约；delivery.py 函数行号 60/105/142/231 与重试判定 182/194 全对 |
| C-10 | §4 #3：subprocess 仅两处受限（runner.py:816-864 code-write 10s+门控、config.py:38-45 生产永久禁用、auth_sandbox.py:14,27-29,82-85 QuickJS 5s/64MB） | sed 四处 | PASS | exec_code_write `timeout=10`+`code_node_enabled()` 门；config.py `code_node_enabled` 生产恒 False；auth_sandbox TIME_LIMIT_S=5、MEMORY_LIMIT=64MB、subprocess.run(timeout=TIME_LIMIT_S) |

**R1b 小计：10/10 PASS。** 精度附注：02 §0.2 引 `pyproject.toml:11`，实测 `agentscope==2.0.7` 在第 10 行（差 1 行，实质无误，见 F-5）。

### R1c · 03 的 A1 结论抽查（8 条；[L2.0.7]=本地 venv 包源码实测，[DEV]=按 03 §0 的 U11–U17 URL 以只读 curl 在 ff8697ec 重放）

| # | 结论摘要（03 条目） | 抽查方法 | 结果 | 证据（复核实测） |
|---|---|---|---|---|
| A-1 | §1.1/1.2/1.3/1.5 版本事实：实装=2.0.7 registry wheel、2.0.7 零 pipeline、2.0.8 未发布、pin==2.0.7 | 本地 dist-info/_version/目录/grep + curl PyPI per-version | PASS | `agentscope-2.0.7.dist-info` 唯一；`_version.py` L4="2.0.7"；无 `pipeline/` 目录、全库 grep PipelineProtocol/GoalPipeline 零命中；dist-info 无 direct_url.json；METADATA `Development Status :: 4 - Beta`；uv.lock L11-13 registry/2.0.7；**复核日重放**：PyPI `2.0.8/json`=404、`2.0.7.post1/json`=200（03 版本结论今日仍真） |
| A-2 | 项1：PipelineProtocol=单方法 typing.Protocol（[DEV] pipeline/_base.py L15-33） | curl 重放 ff8697ec 全文 | PASS | 取回 32 行（03 记 33 行，尾行计数差，见 F-7）：L4-12 导入、L15 `class PipelineProtocol(Protocol)`、L16-22 docstring、L24-31 `reply_stream(inputs: Msg\|list[Msg]\|UserConfirmResultEvent\|UserInterruptEvent\|ExternalExecutionResultEvent) -> AsyncGenerator[AgentEvent\|Msg, None]` 逐行吻合；`__init__.py` 仅导出两名字；`_version.py`="2.0.8" |
| A-3 | 项2：GoalPipeline 构造/dead params/内存状态/反馈循环（[DEV] _goal_pipeline.py L22-325 各锚点） | curl 重放全文+grep | PASS | 325 行、12469B 与 U9 记录一致；L22 _ExecutionReport、L34 _VerificationResult(pass\|fail\|impossible)、L59-66 构造签名、L88-91 `_iters/_goal` 内存字段+HITL 注释、dead params 出现行恰为 63/65/74/79/85/87 且无其他读取、L124-125 重置、L146-161 reply_id 路由+ValueError、L163-169 interrupt 转发、L177/248 while、L304-321 fail 反馈 UserMsg——全部逐行吻合 |
| A-4 | 项4：pipeline state 纯内存、无序列化/存储接入（[DEV]） | 重放全文 grep | PASS | `state_dict\|serialize\|model_dump\|storage\|load_state` 在 _goal_pipeline.py 零命中 |
| A-5 | 项5：AgentState/Session/ChatService/SessionStatus/interrupt/cancel 边界（[L2.0.7] 六组锚点） | 本地 sed | PASS | state/_state.py L178 类起、session_id L181/summary L185/context L189/reply_context L237/permission_context L243/tool_context L252/tasks_context L257/middle_context L263-265、L192-194 "backword compatibility"+L195-210 validator；storage/_model/_session.py L221 `state: AgentState`；_chat.py L98-111 docstring 逐句吻合、L519 interrupt 双路径+"idempotent"；_session.py L61-95 SessionStatus 优先级 docstring、L256-300 cancel_session_run(timeout=10) |
| A-6 | 项6：Task=内部计划项；blocks/blocked_by 无**调度**消费者（[L2.0.7]） | 本地 sed+grep | PASS（附注 F-6） | state/_task.py L11-39 全字段+state 三态无 failed/cancelled；_create_task.py L25-28/L99-108 顺序 id/L116 append；_toolkit.py L38-77 七类装配序（Workspace builtins 含 Bash/Read/Write/Grep 居首）。**附注 F-6**：blocked_by 在 `_get_task.py:85-87`、`_list_task.py:62-63` 存在**展示型读取**（拼给 LLM 的文本），03"全包零命中"表述不精确；但"无调度/执行消费者=非调度契约"的结论成立 |
| A-7 | 项9：事件 schema 封闭 union（"EventType 27 值/AgentEvent 29 成员"）+append_event+ReplyFinishedReason | 本地 python 计数+sed | **FAIL（计数错误）** | 实测 [L2.0.7]：EventType=**28** 值（REPLY×2+MODEL_CALL×2+TEXT×3+DATA×3+THINKING×3+HINT×1+TOOL_CALL×3+TOOL_RESULT×4+EXCEED×1+REQUIRE×2+USER_CONFIRM_RESULT/USER_INTERRUPT/EXTERNAL_RESULT×3+CUSTOM×1）；AgentEvent union=**28** 成员（EventBase 子类亦 28）。03 项9/§3.1 与 06 CF-12/CF-25 所引"27 值/29 成员"均错。行号锚点（L26-67/L70/L518-549/L552-581、message/_base.py L244、types/_reply.py L10-16）全部正确；THINKING_BLOCK_*∈union 正确。**连带发现 F-2**：CustomEvent docstring（L531-537）官方明列 well-known name `"state_updated"`（agent state tasks/permission 变更）——06 CF-12"官方 union 中不存在 state_updated 事件"属过度修正（无独立事件类型为真，但官方以 CustomEvent 承载并点名），其建议新文本若照抄将写入新事实错误 |
| A-8 | 项10+项12：console 接入 pipeline（[DEV]）；官方无迁移框架、仅点状 validator（[L2.0.7]） | curl 重放 console/_console.py + 本地 sed | PASS | [DEV] console/_console.py L8 import PipelineProtocol、L18-19 `_run_reply(agent: Agent\|PipelineProtocol)`、L96-97 `launch_console(agent: Agent\|PipelineProtocol)`、L118-119 docstring 吻合；[L2.0.7] 迁移 validator 见 A-5，无 alembic/schema_version 框架（03 P13 口径与本地结构一致） |

**R1c 小计：8 条中 7 PASS、1 FAIL（A-7 计数）。** [DEV] 重放说明：raw.githubusercontent.com 在本环境首次请求 `_base.py` 返回 HTTP 000，重试成功；`_goal_pipeline.py/__init__.py/_version.py/_console.py` 均一次或重试后 200；未构成 NETWORK_BLOCKED（docs.agentscope.io 未重放，维持 03 的 NETWORK_BLOCKED 记录）。

### R1d · EVIDENCE-INDEX 正查引用抽查（5 条；验证 REF-BROKEN=0 声明）

| # | 索引引用 | 抽查方法 | 结果 | 证据 |
|---|---|---|---|---|
| I-1 | 04-R1 行：QW-08＋g1-04-management.png＋models.py:354-378 | 01 grep 步骤号＋ls 截图＋sed 源码 | PASS | 01 L81 有 QW-08；截图在位；行号见 C-1 |
| I-2 | 05-REC 行：05 §3.1 三类证据＋QW-06/15/04＋auto-01-create-dialog-top.png | 05 读核＋01 grep＋ls | PASS | 05 §3.1 O/C/A 各 3 条在位；QW 步骤在位；截图在位 |
| I-3 | 05-SEQ4-E3 → 03 项9 CustomEvent L518-549 | 本地 sed | PASS | L518 `class CustomEvent(EventBase)` 起，docstring 含 task progress/team membership/permission updates |
| I-4 | 04-R17 → docs/v2-design/03-trigger-and-data-mapping.md:20 飞书=Coze 调研引述 | sed 原文 | PASS | 第 20 行恰为 Coze 行含"（06-SDD 附录 C.4 飞书口径）已记录" |
| I-5 | 05-P0-2 → runtimes/agentscope/app/adapter.py:389-390 cancel no-op；NOTE-2 合并区间（agents.py:445-477＋478-504） | sed＋02 原文核对 | PASS | 389-390 no-op 实测；02 §1 Q3 原文同时含 445-477 与 478-504 两段，合并区间注记属实 |

**R1d 小计：5/5 PASS。** 抽样范围内 REF-BROKEN=0 声明成立。

---

## R2 · 半截调查检查（8 种失败模式）

**扫描范围声明**：01 全部 QW-01…16＋跨域事实 6 条＋"页面证明不了的内容"13 条；02 §0–§10 与链1–4、断点①–⑦；03 §1 版本五项＋12 契约项＋§3 三列表＋§4 九条；04 主表 17 行＋§2/§3；05 §0–§9 与四时序全部事件。逐条对照任务书 §12 R2 所列 8 种失败模式。

**命中清单：零命中。** 逐模式核查结论：

1. 只看创建页没看详情/运行页——01 对看板/自主/Waker/Flow 四类核心对象均具列表+详情+运行记录三视角；唯一未开面（知识库详情、Waker 权限/档案子页、Group 页签、设置页）均显式记 GAP-11/15/16/12 且对应结论（04-R9/R1/R6/R15）按缺口降级或 DEFER，未越界声称。
2. 只看 UI 没追 Runtime——02 八条字段级链路逐环标断点⑤⑥⑦；04 每行结论均引用断点编号；04-R7 明写"页面挂载成功≠运行时生效"教训入目标态验收口径。
3. 只看到类名没追实例化和调用——02 §1 Q7 专验"声明≠实现"（cancel no-op）；§4 七项以注册点/grep 零命中证"未实现"而非以类名证"已实现"。
4. 只看成功路径没查失败/取消/恢复/幂等——02 §3 Q6/Q8 覆盖取消/重试/Outbox/对账并主动暴露僵尸态（15 running/8 queued/83 dead）；03 项8 覆盖 cancel/interrupt/park-resume；05 四时序闭合表逐条答取消/预算/恢复/幂等。
5. 只看官方示例没看 Protocol——03 项1 直读 Protocol 源码、项2 直读 GoalPipeline 全文 325 行+官方测试清单、项11 将示例定性教学级（BYPASS/单进程/demo 自述），未以示例代契约。
6. 看到"支持"按钮就声称生产可用——01 对运行/试运行/保存/启用 switch/安装/发送一律 BLOCKED_BY_SIDE_EFFECT，无名图标 UNIDENTIFIED_CONTROL 不点；04-R2/R12 不声称原站有选择性重做；02 §6 将 fixture/mock/POC/退役分四台账。
7. 把 mock/fixture/POC 写成平台现状——02 §2.2/§2.5/§6.3 明定 8200=fixture 执行体、_MOCK_MCP_TOOLS 仅 WF_TEST_FIXTURES=1、native_workflow 自标 POC；04-R8/06 CF-17 将该错位登记为对方文档的 FACT_ERROR 而非自身结论。
8. 把原站概念直接翻译成我方表名——04 §2 三义落位表＋04-R14"平台层不再新建任何 Task 表"＋05 §5 命名全部为我方实体（AutomationDefinition/ChildInvocation/ExecutionState…）并标注复用/新增/重构动作；blocks/blocked_by 明令不得外推为调度契约。

**非模式类精度发现（不属于 8 模式，但独立复核必须登记，均不推翻核心结论）**：

- F-1：03 项9/§3.1 事件计数错（27/29 → 实测 28/28），并已传染至 06 CF-12/CF-25 建议新文本。
- F-2：06 CF-12"官方 union 中不存在 state_updated"过度修正（CustomEvent docstring 官方点名 state_updated 为 well-known name）；正确表述应为"无独立事件类型；状态变更经 CustomEvent(name='state_updated') 承载，映射表须将其作为已知 name 冻结映射"。
- F-3：01 QW-07 正文与 auto-03 截图完整记录 atk_ 调用凭据（任务书 §2.3 禁止记录 token）。
- F-4：同一 run 看板"已取消" vs flow 执行记录"已终止"的跨视图状态词差异未登记（O-2 附注 N-1）。
- F-5：02 §0.2 引 pyproject.toml:11，实测第 10 行（差 1 行）。
- F-6：03 项6"blocked_by 全包零命中"不精确（_get_task/_list_task 有展示型读取）；结论不受影响。
- F-7：03 U11 记 _base.py"全文 33 行"，wc 实测 32 行（尾行计数口径差）。
- F-8：EVIDENCE-INDEX NOTE-4 与 06 §6 述 OD-09…18"未写入 07"；现 07 已含 v2 追加（OD-09…19，文件 mtime 晚于二者）。属新鲜度滞后，非悬空引用、非纪律违规。

---

## R3 · 架构闭合（05 §7 四时序逐事件 9 问审）

审计方法：逐事件核"控制者/创建哪个 Run/是否创建 Session/版本与资源快照来源/权限·预算·取消·deadline 传播/状态持久化位置/副作用幂等/前端显示/失败后重做谁不重做谁"；并全文件 grep 禁语"平台自动处理/AgentScope 自带/后面补"（**0 命中**）。

### 时序 1（Chat→Agent→AgentFlow→多 role→返回 Chat，E1–E10）

| 事件 | 控制者 | Run/Session | 快照来源 | 传播/持久化/幂等/前端要点 | 闭合 |
|---|---|---|---|---|---|
| E1 | 平台 ChatAPI | Run#1(trigger=chat)+Session(USER_CHAT) upsert | AgentRelease（prod 指针+canary，复制 C1 agent_runtime:579-623） | Session/Run 落平台 DB；前端用户消息+运行中 | ✅ |
| E2 | 平台 worker | — | Release 快照=instructions/model/allowlist(GR-2/4 过滤)/SkillVersion/MCPServerVersion+session_state+budget_remainder+invocation_path（M1，P0-3 契约扩展） | 事件按 M2 mapping_version 落 RunEvent+SSE | ✅ |
| E3 | Provider 内 Agent | Run#1→waiting_external | — | run_agent_flow=平台代执行类→RequireExternalExecutionEvent park（A1 项8 契约）；前端工具卡 | ✅ |
| E4 | 平台 worker | ChildInvocation#1+Run#2(trigger=flow, session_id=NULL) | FlowRelease pin=F | GR-4 双端校验违例→TOOL_NOT_MOUNTED 回注；预算 M5 分配 | ✅ |
| E5 | AgentFlow Runner | ExecutionState(Run#2) 写库 | FlowVersion.stages | 补 A1 项4 缺口；恢复粒度=stage（M7） | ✅ |
| E6/E7 | Runner | ChildInvocation#2/#3+Run#3/#4+Session(FLOW_EPHEMERAL) | role=FlowVersion 内联模板冻结集；agent=AgentRelease G2 pin | GR-5 深度/环；structured output 平台二次校验；stage 快照写 ExecutionState；余额归还 | ✅ |
| E8 | Runner（平台侧循环） | 每迭代独立子 Run | max_iters 来自 FlowVersion（非官方 dead params） | iters 记 ExecutionState；不用官方内存对象跨 job | ✅ |
| E9 | Runner | Run#2 终态 | OutputSchemaRef 二次校验 | ExternalExecutionResultEvent 按 reply_id 回注（A1 项8 Case B）；session_state 回写；Outbox 同事务（M6） | ✅ |
| E10 | 前端 | — | — | 阶段视图/工具卡/决策摘要/产物；THINKING 仅审计权限点（GR-1）；看板 session 行（OD-07 假设） | ✅ |

9 问闭合表在位且逐问有答；取消=M4 树传播+parked 注入 UserInterruptEvent；重做=stage retry→Continuation（OD-01 假设 B）明列"不重做：stage1 快照/已投递 Outbox/Session 上下文"。

### 时序 2（自动任务→AgentFlow→Agent→选择性重做→结构化终态，E1–E7）

| 事件 | 控制者 | Run/Session | 快照来源 | 要点 | 闭合 |
|---|---|---|---|---|---|
| E1 | 平台触发面 | — | — | schedule=occurrence+fire_key（C1 复用）；api=新端点+Bearer(KMS)+Idempotency-Key（P0-4）；event 随 OD-02；manual_debug 不计入累计 | ⚠️ UNC-01 |
| E2 | 平台 worker | Run#10（冻结 resolved_* 全套于 Run 行） | ExecutionTarget 版本策略解析（pinned digest 校验｜latest_prod） | 单发不经 TaskRun；批量分流 TaskRun 原样 | ⚠️ UNC-01 |
| E3–E5 | Runner | ExecutionState+stage 子 Run+FLOW_EPHEMERAL | AgentRelease G pin / role 模板 | retry=新子 Run+attempt 记账；failed 终态不伪造结构化成功；失败通知=Outbox 分列（GR-6） | ✅ |
| E6 | 用户+平台 | Run#10'(trigger=continuation, origin=Run#10) | Continuation 前置校验 (a)快照 schema (b)digest 一致 (c)无非幂等未完成 Outbox (d)深度/环重算 | stage1 不重跑；累计计数归属原 fire 不重复 | ✅ |
| E7 | 前端 | — | — | 四指标/双终态列/谱系徽章/续跑置灰原因 | ✅ |

**UNC-01（未闭合 1 项）**：O1 QW-06/auto-02 已证的两条策略语义——"达到最大运行次数后将自动暂停该任务""到达截止日期后将不再自动触发"——在 05 的 AutomationDefinition/TriggerBinding 字段表（§5.4）、时序 2 E1/E2 触发门、以及闭合表中**均无字段级与门控级契约**（05/04 全文 grep"截止/deadline/最大运行次数"零命中；04-R4 仅以"policy 五元组"标签带过）。R3 九问之"deadline 如何传播"在时序 2 无答。性质：D1 提案完备性缺口（非证据缺失、非禁语式甩锅）；不依赖任何 OD。修复=AutomationDefinition.policy 增 max_runs/deadline 字段＋E1/E2 触发解析处加门（达上限→定义自动 paused；达截止→不再物化 fire）＋闭合表补行＋04 行 4/06 CF-08 新文本同步。

### 时序 3（Workflow→Agent→Workflow 子调用，E1–E6）

E1 版本解析保留 C1 create_run:1706-1731＋P0-5 pin 声明必填；E2 InvocationGraph 初始化取代 wf_chain/agent_chain 分列（GR-5）；E3 agent 节点=ChildInvocation#20+Run#21+S21，同步等待沿用 C1 _run_member 模式＋协作取消检查点；E4 Agent→Workflow 工具调用经 mount/pin+环检测（CYCLE_DETECTED fail-closed 回注）+ChildInvocation#21+Run#22；E5 终态逐级收敛、/trace 递归；E6 前端 pin 版本徽章。9 问闭合表在位；重做=一期 run 级+TaskRun 行级重试，Workflow 节点级重做显式 DEFER（P2，前置=节点幂等声明全覆盖）——为显式决策而非"后面补"。全事件闭合 ✅（UNC=0）。

### 时序 4（单次无状态→Planning→plan items→Run 结束，E1–E6）

E1 Run#30+Session(SINGLE_RUN)（OD-19/OD-10 门控的载体假设，已显式挂拍板）；E2 官方 Task 工具直接复用（A1 项6）+GR-2 门控工具面；E3 plan_progress=RunEvent(CUSTOM) 投影、状态枚举仅三态不得虚构、blocks/blocked_by 不做调度；E4 GR-2/GR-6 约束执行；E5 audit_state 快照（schema_version）+Session archived+Outbox 同事务；E6 三义分离不产生新会话/任务行。9 问闭合表在位；取消=plan items 无补偿（显式语义）；重跑=新 Run 全新执行、旧 Run 已投递命令不重发（幂等键 f(run_id,seq) 天然隔离）。全事件闭合 ✅（UNC=0）。

**R3 小计：未闭合 1 项（UNC-01）；禁语 0 命中；其余事件级 9 问均有契约落点（M1–M7＋GR-1…6＋P0 前置清单，P0 各项均带 C1 证据与验证方式，不构成"后面补"）。**

---

## R4 · 冲突与决策纪律核对表

| # | 核对项 | 方法 | 结果 | 证据 |
|---|---|---|---|---|
| 1 | 07 的 OD-01…19 均无被写成 DECIDED | grep 07 全文 `DECIDED\|已拍板\|拍板完成`＝0 命中；逐条读 v1 八项+v2 追加十一项 | PASS | 19 项均保持"问题/证据不能决定/选项/默认建议/代价/推迟影响/最小问题"七字段或等价结构；头部"已由既有拍板关闭"四项（IM/CoT/市场制/唯一底层）系用户历史拍板复述，非本轮偷拍 |
| 2 | 05 §0.2 仅以工作假设引用 OD | 读核 §0.2 表+尾句 | PASS | 表头"仅以默认建议为工作假设（未拍板）"，八行逐条标受影响段落，尾句"本文件不代替拍板"；§8 G5 行与 §9 十项"未写入 07、未标记 DECIDED"自述经 grep 复核属实 |
| 3 | 06 的 D01–D22 处置无静默覆盖 | 读核 §3.1 全表+§3.2+§3.3 | PASS | 保留 13/修订 9/废止 0 逐条给依据与联动拍板；每条"修订"均带 supersede 方向（如 D03/D19→OD-09 案 B 载体、D13/D14→OD-19/OD-10、D16 条件废止触发=OD-09 批准）；落档规则"原行保留+新增处置列、不得删行改写"；U03 跳空走 CF-35 显式登记；D23–D28 候选全绑 OD |
| 4 | 04/05 未因像 QoderWake 而重复建设我方已有 Workflow/Task/Resource 能力 | 读核 05 §4/§5＋04 各行"复用/新增/重构"列 | PASS | Workflow 零迁移（§5.3，仅 P0-5 pin 与 deprecated 收敛两处小修）；AutomationDefinition=AnalysisTask/TaskVersion 泛化而非并行新内核（批量仍走 TaskRun）；CommandOutbox=ResultDelivery 泛化且保留其特化不重建；看板=WorkItemProjection 多源化复用；schedule/occurrence/fire_key 复用；04-R14 明令"平台层不再新建任何 Task 表" |
| 5 | 未因复用旧代码保留 02 已证断链的双事实源 | grep 05 处置点 | PASS | config.skills→P0-6 废弃+agent_skill 唯一挂载表+SkillVersion 入快照（05 §3.3-6、§5.1、§5.6 MountBinding 收敛四散轨）；call_chain/agent_chain/wf_chain 分列→ChildInvocation 持久边+InvocationGraph 单树（§5.4、GR-5、时序3-E2）＋06 CF-23 分工新文本；config.connections/config.workflows 死数据→废弃迁 MountBinding（§5.1）；Skill ID/名字错位→06 CF-40 三方映射表 |
| 6 | （附加）交叉新鲜度 | 比对 07 mtime 与 06/INDEX 表述 | 观察 F-8 | 07 已含 v2（OD-09…19）；06 §6 与 INDEX NOTE-4 仍述"待入 07 v2/未写入 07"。方向一致、无决策纪律违规，建议元信息同步 |

**R4 小计：违规 0 项。**

---

## R5 · 最终状态建议

### 建议判定：`ACCEPTED_FOR_DOC_REVISION`

**理由**：

1. **证据链经独立抽查成立**：O 类 10 条结论与 00/01 记录自洽、截图均可定位且非空白/黑屏/误导裁切（1 条因凭据未脱敏判 FAIL，属卫生问题而非证据虚假）；C 类 10 条 file:line 与调用链在 HEAD f6824f9 实测全对；A 类 8 条中 7 条锚点逐行吻合（含 [DEV] 四文件 curl 重放与 PyPI 404/200 复核日重放），1 条为计数错误但行号锚点与结论方向正确；INDEX 正查 5/5 成立，REF-BROKEN=0 在抽样内为真。
2. **无半截调查**：R2 八模式零命中；所有证据缺口（GAP-01…52）均显式台账化且结论按缺口降级，无越界声称。
3. **架构闭合度足以进入文档修订**：四时序 36 个事件中仅 1 处策略字段级缺口（UNC-01），且 05 本身是挂 OD-09 拍板的 D1 提案、非实施基线；禁语零命中；M1–M7/GR-1…6/P0 七前置均带契约与验证方式。
4. **决策纪律完好**：R4 零违规；19 个 OD 与 D01–D22 处置全部可追溯、无静默覆盖。
5. **不构成 REWORK_REQUIRED**：未发现需要重返原站/重跑探针/重取官方证据的缺失项——F-1…F-8 与 UNC-01 均为文本级纠错或提案补字段，可在修订轮内闭合。**不构成 BLOCKED_FOR_USER_DECISION**：本轮复核未产生任何"真实产品选择会改变领域模型或权限边界"的新决策点；真决策点已被 OD-01…19 完整覆盖。

**生效条件**：以下"可立即修订项"中第 1–5 项应在文档修订启动前或同轮完成；第 6 项（UNC-01）须在 05 随 OD-09 落档修订时闭合；在收到本判定前，任何交付物内容不得写成实施基线、不得启动 P0 代码工作（维持任务书 §12 末条）。

### 清单 A · 可立即修订项（不依赖 OD 的事实纠错/安全红线/卫生）

1. **凭据脱敏（安全红线，F-3）**：01 QW-07 正文将 atk_ token 替换为 `atk_****…` 式掩码；auto-03-task-detail.png 在台账加注"含调用凭据，引用时须掩码/重裁"或重裁；顺带自检 01 其余转录与 exports/ 提示是否另有凭据/PII 入文。
2. **事件计数纠错（F-1）**：03 项9/§3.1 改"EventType 28 值/AgentEvent union 28 成员（[L2.0.7] 实测）"；06 CF-12/CF-25 建议新文本同步改数。
3. **state_updated 表述纠错（F-2）**：06 CF-12 结论与新文本改为"官方 union 无独立 state_updated 事件类型；状态变更（tasks/permission）经 CustomEvent(name='state_updated') 官方点名承载——映射表须将该 known name 纳入 mapping_version 冻结映射"，删除"旧表述废止"式过度修正。
4. **跨视图状态词登记（F-4）**：01 QW-02 或 00 §4 补注：同一 run 看板显示"已取消"、flow 执行记录显示"已终止"，二者为同 run 的跨视图词形差异（我方投影词表设计时须显式映射，见 06 CF-22 两级词表）。
5. **行号/措辞微纠（F-5/F-6/F-7/F-8）**：02 pyproject 引号改 :10；03 项6 证据句改"Task 工具族与定义点之外无调度/执行消费者（_get_task/_list_task 的展示型读取属 LLM 信息面）"；03 U11 行数改 32；INDEX NOTE-4 与 06 §6 的 OD-09…18 状态更新为"已入 07 v2"。
6. **UNC-01 闭合（提案补字段，不依赖 OD）**：05 §5.4 AutomationDefinition.policy 增 max_runs/deadline 两字段（语义采纳 O1 QW-06：达上限→定义自动 paused；达截止→不再物化 fire），§7.2 时序 2 E1/E2 加触发门步骤、闭合表补"deadline/最大运行次数传播"行；04 行 4 与 06 CF-08 新文本同步补字段级表述。

### 清单 B · 必须等拍板项（对齐 OD 编号；拍板前关联段落不得定稿）

- **OD-09**（主闸门）：案 B 一等 AgentFlow 批准与否 → 06 CF-01/02/03/06/07 簇与 D03/D06/D09/D11/D19/D20 处置落档。
- **OD-08**：automation target 三型+强制 pin → CF-04/05/08。
- **OD-16（含 U05 范围澄清）**：自建 Runner 生产化、官方 pipeline/A2A 仅沙箱 spike → CF-15、D02 注记。
- **OD-15**：官方 app 服务层逐项取舍（IM 网关默认关闭行在内）→ CF-14、时序 M1/Session 持久化地点。
- **OD-19**：Session 措辞边界（D13/D14/闸门 4）→ CF-21、时序 4 E1 载体。
- **OD-10**：每 turn 一 Run、Session 1:N Run → D13、CF-22/D28。
- **OD-01**：选择性重做级别 → Continuation/GR-5/时序 2 E6。
- **OD-02**：事件触发一期 → TriggerBinding/时序 2 E1。
- **OD-03/04/05**：scope/挂载语义/编辑器形态 → AgentFlowDefinition/MountBinding/DIM10。
- **OD-06/07**：Run worker 标识/看板行粒度 → CF-32/CF-34。
- **OD-11**：深度上限 5 与跨版本环判定 → GR-5/CF-23。
- **OD-12/13/14**：知识执行体与冻结粒度/工作空间执行位置/记忆写回 → CF-27(U02)/CF-28/MemoryPolicy。
- **OD-17**：Flow 节点双引用方式边界 → RoleTemplate/MountBinding 主体。
- **OD-18**：原站残余缺口（知识库详情/权限档案子页/Group 页签/设置页）补查授权或接受缺口。

---

## 复核代理自身局限（没做什么、为什么）

1. **未重开原站浏览器**：R1a 以"截图目视＋00/01 记录互核"复现，不能证明页面当前仍与 2026-09-08 捕获时一致（端口/会话可能已变）；活体复现需新一轮只读实调（OD-18 可授权）。
2. **截图目视 13/28 张**（g1-01、g1-03、tb-01、auto-01/02/03、waker-01、flow-01/02/03/04/05/07）：其余 15 张（含种子 01–05、g1-02/04/05/06/07/07b/08/09、waker-02、flow-06）信任 01 G2 与 INDEX §3 台账的逐张登记，仅核文件名在位；种子 01–05 与 auto-01/02 的一致性声明（ISO-3）未逐张重比。
3. **转录级 O2 子面未获截图直证**：list_wakerflows 响应 JSON、workflow_upsert 响应全文、auto-03 运行历史表、QW-07 tooltip 文案等位于折叠/下段/悬停态，现有截图为折叠或视口下段——这些子面的可重放性依赖 01 的 DOM 记录（已如实附注 N-2，未判 FAIL）。
4. **未重跑 DB 探针与 pytest**：02 §0.3 的行数/分布事实（266 Run、58 TaskRun、82 delivery、83 dead 等）未重查（禁改状态命令约束下 psql 只读重查虽允许但本轮未做），信任其 §10 命令清单的可重放声明；C1 抽查全部为 HEAD 源码静态核对。
5. **[DEV] 重放为部分重放**：仅重取 pipeline/_base.py、_goal_pipeline.py、pipeline/__init__.py、_version.py、console/_console.py 五文件与 PyPI per-version 两端点；U7 的 174 文件 compare 清单、GitHub tags/releases API、docs.agentscope.io（NETWORK_BLOCKED）未重放，信任 03 §0 台账。
6. **06a 未逐行通读**：抽查其全局检索节、T10 专节与三处"01 已证候选"节；06 §4 的 68 项逐条定级未重算（抽查 CF-08/24/26/28/34/38 的映射一致性）。
7. **R3 为文本审计**：逐事件读核＋禁语 grep，未做形式化模型检查；UNC-01 之外的"闭合"判定依赖 05 自述契约与所引 C1/A1 锚点（锚点已抽验）。
8. **抽样非简单随机**：按"高承载结论分层"选取（upsert 契约、任务三义、断链链路、版本双轨、事件 union 等），对低承载段落（如 02 §6.2 mock 台账明细、03 项7 Hub 字段）覆盖较薄；若主审计者要求，可加抽。
9. **未验证 exports/ 数据敏感性处置**：仅确认 02 §7/ISO-11 已登记提示，未打开该目录内容（避免接触原始业务数据）。

*复核完。本文件为本轮唯一新增交付物；除本文件外未写任何文件，未改任何被复核对象。*
