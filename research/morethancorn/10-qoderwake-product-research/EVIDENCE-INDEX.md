# EVIDENCE-INDEX · 证据索引与一致性核对（任务书 §10）

> **2026-09-08 纠偏提示**：本索引对 00～08 的引用存在性核对仍有效，但其中所有“平台自建 Session/RunEvent/ExecutionState/AgentFlow Runner”“只用 AgentScope 库层”等架构交叉引用均已失效。现行决定见 10 号纠偏控制单和 docs/v2-design/11 v6.0；不得用本索引的旧 GAP“处置方式”覆盖新决定。

> **2026-09-08 副作用实调追加**：01 的只读限制已由 `11-task-automation-live-replay.md` 解除。创建、编辑、启停、手动运行、Session 回链、任务看板五泳道/搜索和 API 官方规则已有新证据；旧 GAP 只在 11 明确仍未闭合时继续有效。删除、关注动作和失败路径仍未证。

> 日期：2026-09-08 · 状态：`RESEARCH_ONLY`（本文件为本代理唯一交付物）
> 目的：使任何架构结论可反查到 (a) 原站步骤与截图；(b) 我方代码文件/行号；(c) AgentScope 官方 tag/commit/行号；(d) 推断（I1）与设计建议（D1）。
> 输入（只读）：同目录 00 / 01 / 02 / 03 / 04 / 05 / 07 / QODERWAKE-REFERENCE-RESEARCH-HANDOFF.md（任务书）。
> 纪律：未新增任何结论；所有摘要为源文件原文的转录或压缩；未修改其他任何文件；未运行改状态命令；未使用浏览器；未派发子代理。

## 0. 锚点约定（引用前先读）

| 锚点 | 含义（转录自源文件） |
|---|---|
| `O1/O2` | 原站观察，实例 `http://127.0.0.1:19830/`（2026-09-08，视口 1440×900）；步骤号 = 01 的 `QW-01…QW-16`；截图 = `screenshots/` 下文件（§3 台账） |
| `C1` | 我方代码事实，行号一律以 HEAD `f6824f9421660a4b1e6bb23cf455e738125ebc81` 为准（02 §0.1）；本索引转录 02 的章节号（§x Qy / 链1–4 / 断点①–⑦环 / §4 #1–#7）与其附带的 `文件:行号` |
| `A1 [L2.0.7]` | 本地已安装 agentscope 2.0.7 正式版（PyPI wheel，对应官方 tag `v2.0.7`），路径前缀 `runtimes/agentscope/.venv/lib/python3.11/site-packages/agentscope/`（03 头部） |
| `A1 [DEV]` | 官方仓库 `github.com/agentscope-ai/agentscope` @ commit `ff8697ec4d59ee01f3766176e70cb24ee894d6c6`（= 采集时 main HEAD，`_version.py` 声明 2.0.8，**未发布**：PyPI 404、无 tag），路径前缀 `src/agentscope/`（03 头部/§1.3/§1.4） |
| `I1` / `D1` | 推断 / 设计建议（显式标注，不得当事实） |
| `GAP-xx` / `ISO-x` / `REF-BROKEN` | 本索引 §4 缺口台账 / §2.5 孤立证据 / §5 悬空引用清单 |

结论 ID 约定：`04-R1…04-R17` = 04 §1 映射主表 17 行；`04-§2/§3` = 04 的三义落位表与高危表象去向表（为 04-R3/R4/R14 与 05-GR1…6 的派生视图）；`05-REC` = 05 §3 推荐案；`05-DIM1…13` = 05 §2 矩阵 13 维；`05-SEQ0…4` = 05 §7.0 公共机制与 §7.1–7.4 四时序；`05-GR1…6` = 05 §6 治理规则；`05-P0-1…7` = 05 §3.3 P0 前置修复清单。

---

## 1. 结论 → 证据正查表

### 1.1 04 映射主表（17 行：概念 + 结论枚举值）

> 列内 file:line 均照抄 02（C1）与 03（A1）原文；完整行号明细以 02/03 对应章节为准。

| 结论 ID | 摘要（概念 + 结论） | O 证据（QW 步骤 + 截图） | C 证据（02 链/断点 + file:line） | A 证据（03 条目 + 锚点 + 源码行） | I/D 标注 |
|---|---|---|---|---|---|
| 04-R1 | Waker（资产根+运行实例混合体）= **ADAPT** | QW-08（g1-04-management.png）卡片字段/筛选；QW-09（waker-01-manage-page.png）九子页+混合体判定；挂载引用/复制/pin 不可见→GAP-15；Waker 级版本/发布/草稿未见→GAP-15 | 02 §1 Q1（models.py:354-378、381-396、399-415、239-279）；Q2 断点（agent_release.py:49-51、agents.py:366-370、agent_runtime.py:704-709；wf-agent-editor.tsx:87、AgentWorkspaceShell.tsx:52-56/61-65、agent-chat.tsx:48）；Q4（多事实源 5 处）；Q6（legacy_agent_archive.py:22-26/58-62、agents.py:15-16）；§4 #1（models.py 全文 1128 行无实例实体；AgentWorkspaceShell.tsx:17-30） | 03 项5：[L2.0.7] app/storage/_model/_agent.py L65-105（AgentData）、L112-129（AgentRecord）；app/_app.py L209-224（每回合装配） | I1“类型即世代”语义债（02 Q1 I1）；I1 挂载=引用倾向（01 QW-09）；D1 运行事实一律落 Run、不抄混合体；OD-06 假设 C（GAP-50）、OD-18 |
| 04-R2 | WakerFlow（一等 Flow 资产表象）= **OPEN**（交互层采纳，资产层一等性待 OD-09 拍板） | QW-11（g1-06-resources-wakerflow.png）；QW-12（flow-01-detail-text-only-review.png）；QW-13（flow-03-script-view.png DSL 全文）；QW-14（flow-02-execution-records.png，O2 与看板互证、选择性重做无入口→GAP-04）；QW-15（flow-04-version-history.png / flow-05-add-trigger-dialog.png / flow-06-create-entry.png / flow-07-chat-panel.png；O2 upsert 存储契约）；QW-10（waker-02-subpage-wakerflow.png）双作用域对照 | 02 链3（workflows.py:42-52/148-163/175-229；runner.py:1115+、1706-1753；薄弱点 runner.py:640 子调用不 pin）；§2.4 断点⑥（mounts.tsx:33-42；agent_runtime.py:181-190、399-405）；§2.9（无 list/run workflow 工具，全库 grep 零命中） | 03 §1.3（PyPI 2.0.8→404，U2）；§1.1（P10/P11：2.0.7 零 pipeline）；项2 [DEV] pipeline/_goal_pipeline.py L55-325；项4 [DEV] L83-91（纯内存）；项10 [DEV] console/_console.py L96-97、app 四文件 pipeline 零引用（U17）；§3.2；§4.1/§4.2 | I1 双作用域解释（01 QW-10）；D1 交互层 ADAPT、资产层三案→05-REC；OD-09/05/01/03/08/16/17；风险=发布闸门（GAP-33）与 schema 漂移（03 项12） |
| 04-R3 | 任务看板（run/session 级统一投影）= **ADAPT** | QW-01（g1-01-work-management.png）指标带+动作队列页签；QW-02（tb-01-task-detail.png）O2 行粒度=run/session 级、三类执行事实混排（看板行↔会话列表↔路由 sid 互证） | 02 §3 Q5（work_item_projection.py:1-24、L41、L62-130；models.py:241-244、257-264）；Q7（work_items.py:51-90：chat/一次性 workflow Run 不进看板）；链4 看板段（operations-today.tsx、app.tsx:116） | 03 项9：[L2.0.7] event/_event.py L518-549（CustomEvent 扩展位）、_chat.py L105-110（replay log+live 扇出）；项5：_session.py L61-95（SessionStatus 四态） | OD-07 假设 A（GAP-51）；D1 投影源多源化（chat session/flow run/automation run/TaskRun）+ 行点击导航契约统一 |
| 04-R4 | 自主工作/自动任务（五元组定义非执行实体）= **ADAPT** | QW-05（g1-03-autonomous-work.png）；QW-06（auto-01-create-dialog-top.png / auto-02-create-dialog-lower.png；1/5 触发、两型执行方式、“事件”差异事实→GAP-13）；QW-07（auto-03-task-detail.png；O2 运行历史回链、atk_ URL、手动=调试 tooltip）；批量能力完全不出现（01 QW-07） | 02 §3 Q5（models.py:740-769、772-821、887-922）；Q6（business.py:1007-1021、1032-1046；task_runner.py:132-243、151-154；api 触发声明存在无端点：models.py:902、work_item_projection.py:55、agent_runtime.py:595/679）；Q8（models.py:925-957；delivery.py:60-103、142-229、105-131；task_runner.py:184-193）；§0.3（15 running/8 queued TaskRun、83 dead job）；链4 UI 段（AutonomousTaskEditor.tsx:34-45） | 03 §4.4：[DEV] app/_app.py L91、L203-210（enable_scheduler 多副本单点约束）；§3.2（平台任务体系=平台必须补齐） | OD-08 假设 A 三型+强制 pin（GAP-52）、OD-02（GAP-46）；D1=P0-4 api 端点、P0-7 僵尸回收；I1 僵尸态成因（02 链4 判定） |
| 04-R5 | Chat（会话=工作容器；CoT 外露=REJECT 子面）= **ADAPT** | QW-04（tb-01-task-detail.png）O1 转录/工具面/composer + O2 list_wakerflows wakerId↔/wakers/ 路由互证；chat turn=run 不可证→GAP-20（01 §4.2 I1）；CoT=01 跨域事实1（tb-01 / flow-07-chat-panel.png） | 02 §1 Q5 custom 轨（agent_chat.py:25-46、L40-44 Skill 仅名字）；§3 Q6/Q7（agent_chat.py:82 trigger=chat 不进看板；models.py:250 注释漂移）；§2.8 ⑥（agent_runtime.py:49-74、77-155 平台进程内 LLM 直调）；§1 Q7（adapter.py:134-143 声明 vs 389-390 cancel no-op） | 03 项5：[L2.0.7] app/_service/_chat.py L98-128、L227-238；storage/_model/_session.py L179-221；项8：event/_event.py L427-515、_chat.py L519-576、_session.py L256-300；项9（THINKING_BLOCK_* ∈ EventType L26-67）；§4.3 | D1=GR-1（THINKING→CONTROL）、chat 迁 Provider（依赖 P0-1/2/3）；OD-10、OD-15 建议追加（未入 07 v2，NOTE-4） |
| 04-R6 | Group（多 Waker 群组协作）= **DEFER** | 01 跨域事实5（部分证据：切换按钮 disabled、无 Group 实体）；QW-03（g1-02-at-waker.png tooltip“群聊答疑专员工作流”文案级）；00 §5（Group 页签未开→GAP-16） | 02 §6.4（expert-group 封存：legacy_agent_archive.py；agents.py:56-58 等 410；runner.py:1601-1605 防呆）；§3 Q1（成员冻结谱系 runner.py:1140-1145 → agent_runtime.py:536-543） | 03 项3/项6：[L2.0.7] app/_tool/_agent_create.py L30-40/L108+、_team_say.py L78/L91、app/_types.py L89-129（SubAgentTemplate）、storage/_model/_agent.py L112-127（source="team"）；§4.7；§4.9（[DEV] agent/_a2a_agent.py L2） | D1 不建、仅 ChildInvocation.call_kind 枚举留扩展；认知风险=误把 team 异步当同步群聊（03 §4.7）；OD-18 补查 Group 页签 |
| 04-R7 | Skills（一等技能资源+挂载；市场制=既有拍板不照搬）= **ADAPT** | QW-16（g1-05-resources.png 市场页 43648 项等生态数据）；QW-09（waker-01-manage-page.png 技能 chips/上传入口）；Skill 是否复制入 Waker 目录不可见→GAP-15 | 02 链2：①–④通（wf-api.ts:445-455、588-589；agent_caps.py:296-364、97-111、133-140；models.py:421-434、437-445）；断点⑤（agent_release.py:19-56、112-181 无 Skill 依赖类型）、⑥（packages/runtime_contract/src/quality_runtime_contract/models.py:66-74 无 skills 字段）、⑦（adapter.py:134-143 仅声明）；§1 Q4-1（custom-config.tsx:88-98 存 Skill ID vs agent_runtime.py:238-243、265 按名字消费）；链2 消费A（agent_chat.py:40-44）/消费B（agent_runtime.py:251-277；test_skill_shell.py:50-84） | 03 项7：[L2.0.7] skill/_base.py L8/L23、skill/_local_loader.py L16、tool/_toolkit.py L88-115（skills_or_loaders=唯一入口）、app/_service/_toolkit.py L38-77、app/hub/_skill/*（SkillHub）；§3.3（SkillCard pin→GAP-38） | OD-04 假设 C（GAP-48）；D1=SkillVersion 入快照+Contract skills 载荷+Toolkit 注入（P0-6）；“自进化 Skill”=DEFER 子面（I1 文案级不可证）；市场制子面=REJECT（既有拍板，01 跨域/00 §2） |
| 04-R8 | MCP Server/Tools（连接器=受治理挂载+工具面插件通道；Bash/Write 默认开放=拒绝子面）= **ADAPT** | QW-16（g1-07b-resources-connectors.png）；QW-04（tb-01-task-detail.png：Bash/Write/present_files/list_wakerflows 参数响应全文 O1+O2）；路由缺陷（g1-07-resources-connectors.png，01 §4.6）；工具权限/危险级别/凭据边界不可见（01 §4.6.8/9/10→GAP 台账） | 02 §2.5 断点⑦（adapter.py:211-214、261-273 只连固定 QUALITY_TOOL_MCP_URL；models.py:1020-1036）；§2.2 断点⑦（runner.py:494-542；services/tool_service/README.md:3-5 “returns fixture facts only”）；§2.6 断点⑦（adapter.py:153-160 容器 env 凭据；对照 runner.py:521-534 Connection 签名头）；§2.5 ⑥（resource_tests.py:289-325 mcp http 真调用+egress+鉴权）；§1 Q5；§6.3（fixture 台账） | 03 项7：[L2.0.7] mcp/_mcp_client.py L25-59（stateful/stateless）、mcp/_config.py L9/L44、workspace/_base.py L223/L554、_local_workspace.py L65/L141、permission/_types.py L18/L81-85/L88/L99-102；[DEV] mcp/_mcp_client.py +141-28（runtime headers，U7）；项8（ConfirmResult.rules：event/_event.py L453-464） | D1=GR-2（拒绝 Bash/Write 默认开放，安全纠错第 2 条）；重构 registry→运行时接线、以真实治理执行体替换 fixture；市场制子面=REJECT（既有拍板） |
| 04-R9 | Knowledge（共享资源+Waker 挂载绑定）= **ADAPT** | QW-16（g1-08-resources-knowledge.png：“设置可使用该知识库的 Waker”+“N 个 Waker 使用”）；详情页未开→GAP-11（01 G2 ⚠️、00 §5） | 02 §2.3：断点⑥（Module 不消费）/⑦（AgentScope 不接收）；⑥ autonomous（agent_runtime.py:191-200、406-418）、workflow（runner.py:664-676）、⑦（resource_tests.py:259-287 fail-closed）；⑤（agent_release.py:104-109 冻状态不冻内容）；models.py:1039-1054；§1 Q3 I1（内容漂移不可见）；§0.3（1 行 disabled/slice_count=0） | 03 项7：[L2.0.7] rag/_knowledge.py L44、middleware/_rag.py L456/L105/L79、storage/_model/_session.py L87-108（SessionKnowledgeConfig）、app/_service/_knowledge_base.py L5-11、app/_app.py L82-86/L145-188（chunker pin 在知识库记录）；§4.3；§3.3 | OD-12 建议追加（执行体分叉：官方 RAG vs 外部端点引用；本行不拍板）；D1=KnowledgeSnapshot（引用+状态+检索参数为最小冻结集） |
| 04-R10 | Memory（Agent 级持久记忆+时间线）= **ADAPT** | QW-09（waker-01-manage-page.png：记忆子页+“记忆与学习时间线”文案级）；记忆子页未开→GAP-15；“学到新技能”自进化表象=I1 不可证 | 02 §2.7：models.py:448-470；⑤（agent_release.py:77 声明入 common_config、本体不进快照）；断点⑥（Module 不消费）；三轨（agent_chat.py:37-39 正文注入、agent_runtime.py:201-208/278-285/419-427 run 级内存字典、runner.py:710-768 MemoryRecord 持久表；models.py:322-331） | 03 项5：[L2.0.7] state/_state.py L178-265（AgentState.context/summary）、SessionRecord.state L221；项11（U10：examples/long_term_memory/mem0 仅示例级）；§3.1/§3.2（官方无跨 session 产品级长期记忆保证） | OD-14 建议追加；D1=MemoryPolicy 入 Release 快照+时间线由 RunEvent 投影；一期只读注入+显式受控写回；I1 自进化仅文案级 |
| 04-R11 | Projects/Workspace（可挂载工作上下文+三态+产物交付）= **ADAPT** | QW-16（g1-09-resources-projects.png：两级作用域文案）；QW-06（auto-01-create-dialog-top.png 工作空间三态 tab）；QW-04（tb-01-task-detail.png：workers/<wakerShort>/workspace/<sidShort>_<MMDD>/ 路径约定+_output/+present_files 响应）；隔离实现不可见→GAP-05 | 02 §4 #1（models.py 全文 1128 行无 Project/Workspace/WorkspaceBinding；AgentWorkspaceShell.tsx:17-30 IA 壳自证）；§4 #3（runner.py:816-864 code-write 宿主机子进程+config.py:38-45 生产永久禁用；auth_sandbox.py:14、27-29、82-85 QuickJS 5s/64MB）；§2.6（egress/KMS 边界思路复用） | 03 项7：[L2.0.7] workspace/_base.py L223（WorkspaceBase）、_local_workspace.py L65（LocalWorkspace=宿主本地目录）；项5：storage/_model/_session.py L117（workspace_id）、L134（cwd）；项11：[DEV] examples/pipeline/goal L23-25（目录内直跑） | OD-13 建议追加（执行位置 Provider 容器 vs 平台侧）；D1=从零新建一等模型+GR-2；原站“默认开放 Bash/Write+宿主目录”禁抄（01 跨域事实2） |
| 04-R12 | 运行记录（run 级路由/列表/阶段状态/回链）= **ADOPT** | QW-14（flow-02-execution-records.png：run 级路由 O1+与看板行互证 O2；无名图标=UNIDENTIFIED_CONTROL 不点击）；QW-07（auto-03-task-detail.png 运行历史+回链 O2）；QW-09（waker-01-manage-page.png 工作日志/热力图）；attempt 未见→GAP-03 | 02 链3 返回段（runs.py:69-170、185-213 SSE 重放+Last-Event-ID、250-317 /trace span 树；runner.py:66-84 sequence 单调；models.py:282-298、301-319、334-351）；链4 重试段（task_runner.py:546-602 origin_run_id+新 attempt、514-543 重汇）；§3 Q7（Run=唯一执行事实表） | 03 项9：[L2.0.7] event/_event.py L552-581（union 29 成员）、message/_base.py L244+（Msg.append_event 确定性重建）、_chat.py L105-110（replay log 晚到订阅）；§3.2（官方无产品级运行记录/attempt 模型）；项5（官方持久化仅会话级） | I1“第 N 次运行=run 序号非 attempt”（01 QW-14）；D1=展示区分 run 序号/attempt/continuation 三谱系+事件映射 mapping_version 冻结（防 03 项12 漂移）+THINKING→CONTROL（GR-1）；OD-01（GAP-45） |
| 04-R13 | 子代理（内部 role）= **ADAPT**（拒绝“role 必须注册为顶层资产”） | QW-13（flow-03-script-view.png：resolve:{kind:'waker',wakerId:'c78b37df31ae'}、无 version 字段）；QW-10（waker-02-subpage-wakerflow.png O2 global 对照）；01 §4.4.10（I1 role=模板）；/recruitment-market 预置角色卡（01 §4.4 末，snapshot 未截图） | 02 §6.4（expert-group 成员机制封存）；§1 Q3（dependency_snapshot AGENT 项冻结成员部署版本，agent_release.py:112-181）；§3 Q1 路径A（runner.py:1077-1088、1140-1145 → agent_runtime.py:536-543、640-646）；§3 Q3+I1（agent_runtime.py:534-535、576-577、670-671 agent: 前缀链；runner.py:1121-1127、1128-1133 wf 链深度≤5；混合深度无统一上限） | 03 项3/项6：[L2.0.7] app/_types.py L89-129（SubAgentTemplate“纯数据可序列化”L103-104）、storage/_model/_agent.py L112-127（team worker 恰一 session）、app/_service/_toolkit.py L70-71/L94-97；§4.7（“Flow 节点=role”同步编排官方不提供）；§4.9（A2A） | I1 role=模板非运行子代理；D1=双引用方式（内联 RoleTemplate+AgentRelease pin）+ChildInvocation/InvocationGraph 统一治理（GR-5）；OD-17、OD-11；“无 version 字段”表象不抄（安全纠错第 4 条） |
| 04-R14 | 内部任务管理（Agent 计划项=第三义）= **ADOPT** | QW-04（tb-01-task-detail.png：TaskCreate/TaskUpdate 按钮+参数/响应页面可见文本、taskId "1"）；01 §4.2（任务三义全部实证） | 02 全文无计划项实体；§3 Q5（AnalysisTask 占用“Task”名称=术语碰撞面，models.py:740-769）；Q7（看板不收 run 内计划）；链3 事实段（RunEvent models.py:301-319 可承载投影） | 03 项6：[L2.0.7] state/_task.py L11-39（Task 模型，state 枚举无 failed/cancelled）、tool/_task/_create_task.py L83-130（tasks_context.append L116、顺序 id L99-108）、_update_task.py L137-149、app/_service/_toolkit.py L61-62；blocks/blocked_by 全库零消费者；项9（CustomEvent L518-549 docstring 点名 task progress） | D1=直接复用官方 Task 工具+tasks_context、展示名建议“执行计划”、run 收尾终态快照入审计（05-SEQ4-E5）；红线=不得与平台任务/自动任务合并建表（任务书 §1.3） |
| 04-R15 | Hook = **DEFER**（原站一手证据缺失，如实降级） | GAP：01 全文无 Hook 步骤；表象系任务书 §8 安全纠错第 3 条转述（I1 转述级）；Waker 权限/档案子页未开（00 §5→GAP-15，可能改变本行证据基础→OD-18） | 02 §4 #4（全库 grep hook/RunStart/SessionStart/BeforeTool/AfterTool 零命中；models.py:301-319 RunEvent=事后事实表非钩子；alerts.py:50-65 webhook=告警出站） | 03 项7：[L2.0.7] agent/_agent.py L143-147（middlewares docstring hook 点：reply/reasoning/permission checking/acting/model call/context compression/system prompt retrieval）；项5（app/_app.py L209-224 extra_agent_middlewares 每回合注入） | D1=GR-3（版本化 HookDefinition+权限点+沙箱+幂等+超时；任意 shell 永不放行）；middleware 仅平台进程内装配位，不作用户可配置面 |
| 04-R16 | CLI = **DEFER** | GAP：01 全文无 CLI 步骤（无路由、无页面）；QW-08（g1-04-management.png 本机徽标+主机名）仅为“本地形态”旁证，不能推出 CLI 存在与否 | 02 §4 #5（package.json 无 bin；server 无 argparse/click 用户 CLI；run_scheduler.py/run_worker.py=进程入口；scripts/ 68 文件=开发验收脚本） | 03 项10：[DEV] console/_console.py L96-97（launch_console(Agent 或 PipelineProtocol)=库级调试件）；[L2.0.7] launch_console 仅接受 Agent；官方无平台 CLI 契约 | D1=一期不建；若建则 CLI=平台 HTTP API 薄壳、零旁路治理面；按任务书 §5.4 纪律不写“应该顺便做” |
| 04-R17 | IM Channel（@Waker）= **REJECT**（既有拍板关闭） | QW-03（g1-02-at-waker.png：渠道治理页判定+表列 O1）；IM 接入后运行形态→GAP-14（无已开通聊天可看；属我方范围外主动不深挖） | 02 §4 #6（models.py:311-312 RunEvent.channel=CONTROL/CONTENT 事件双通道标记≠IM；runner.py:690-700 notification 无真实外发）；§4 #7（server/app+src 全库 grep 飞书/feishu/lark 零命中；docs/v2-design/03-trigger-and-data-mapping.md:20 仅 Coze 调研引述） | 03 §4.3/项7（官方自带 Feishu/Discord/DingTalk 渠道网关+enable_channel_worker+channel tools）；§1.4（[DEV] docs/NEWS.md “DingTalk channel supported”） | 既有拍板（任务书 §1.1+07 v1 头部）；D1=enable_channel_worker=false 作 OD-15 取舍表默认行；channel 术语双义碰撞登记入 06 冲突审计 |

> 04 §2（三义落位表）为 04-R3/R4/R14 的派生视图（证据同上三行 + 03 项6）；04 §3（高危表象→治理去向表）为 05-GR1…GR6 的对照视图（#1→GR-1、#2→GR-2、#3→GR-3、#4→GR-4、#5→GR-5、#6→GR-6）；04 §4 结论分布统计与 §5 未决项对照不含独立证据。

### 1.2 05 一级结论（32 行：推荐案 1 + 13 维矩阵 + 公共机制/四时序 5 + GR 6 + P0 7）

| 结论 ID | 摘要 | O 证据（QW + 截图） | C 证据（02 + file:line） | A 证据（03 + 锚点 + 行） | I/D 标注 |
|---|---|---|---|---|---|
| 05-REC | **推荐案 B：AgentFlow 一等版本化资产**（§3；待拍板 OD-09） | §3.1 O类：QW-06（auto-01-create-dialog-top.png 执行方式两型 radio=交给 Waker/运行 WakerFlow，O1）；QW-15（flow-07-chat-panel.png upsert scope.kind='global'+id/digest/version/generationSessionId，O2）；QW-04（tb-01-task-detail.png list_wakerflows 运行时通道，O2）；QW-13（flow-03-script-view.png worker 可解析非属主 Waker，O1） | §3.1 C类：链3（唯一全通链：workflows.py:175-229 → runner.py:1115+ → runs.py:185-317；DB 266 真 Run）；链2/§2.1（Skill 断链教训：断点⑤⑥⑦+config.skills 双事实源）；§3 Q3+I1（agent_runtime.py:534-535 等分列判重、混合深度无统一上限） | §3.1 A类：项1（[DEV] pipeline/_base.py L15-33 单方法形状）；§4.2（Run/ChildInvocation/attempt/预算/权限/审计/取消/持久化全不在契约内）；项4/项10（[DEV] _goal_pipeline.py L83-91 纯内存；create_app 无 pipeline 参数、仅 console 接入）；§4.5（恢复保证仅会话级）；项12（Beta+46 commits/174 文件漂移） | D1（OD-09 待拍板；替代案 A/C=05 §1、成本=§3.3）；I1=§2 矩阵各维判级；“一句话理由”=三类证据交集论证 |
| 05-DIM1 | 维度1 用户心智：A 差 / B 良 / C 中（B 占优） | QW-06（auto-01 两型 radio——案 A 与之直接冲突）；QW-15（flow-07 scope=global O2）；QW-13（flow-03 非属主 resolve）；QW-08/11（g1-04 / g1-06 资产列表两处） | 链3 前端段（wf-workflows-list.tsx → DesignerPage 既有“Workflow 列表+详情+运行记录”心智） | — | I1（B/C 学习成本、engine type 心智判级）；00 §2（原站只有 WakerFlow 一种 flow 产品→案 C 无先例） |
| 05-DIM2 | 维度2 与 QoderWake 高保真：A 低 / B 高 / C 中高（B 占优） | QW-06（automation→Flow 目标）；QW-15（flow-05 触发 1 配置多方式、flow-07 generationSessionId 回写 O2）；QW-11～15（列表/详情/画布+脚本/run 级记录/触发/对话生成全部有资产位） | — | — | 00 §2/§4（原站无统一 flow 产品→案 C 不同构） |
| 05-DIM3 | 维度3 与现有 Workflow 兼容：A 良 / B 良 / C 差 | — | §2.4 断点⑥（mounts.tsx:33-42；agent_runtime.py:181-190——案 A 下无 Flow 资产可挂）；链3（基座不动，B 为加法）；§1 Q4（双事实源教训）；§0.3（9 workflow/266 Run 活资产） | — | I1（案 C 迁移=新双事实源+回归风险命中最完整资产） |
| 05-DIM4 | 维度4 AgentScope 2.0.8(-dev) 映射自然度：A 中低 / B 良 / C 中（B 占优） | QW-15（flow-07 global scope——案 A 跨 Agent 引用无解） | 链3（DAG jsonb 现状→案 C 统一编辑器须双表达） | 项2/项8（[DEV] _goal_pipeline.py L59-66 构造、L146-161 reply_id 路由=双 Agent 各有状态）；项5/项7（role↔Agent=官方装配单元）；项1/项9（reply_stream 契约/事件流统一映射）；§3.2（官方无定义序列化格式→三案都须平台发明）；项2（_ExecutionReport L22-31/_VerificationResult L34-52 契约形状可借） | I1（案 A“谁持有会话与状态”含混；案 C 发明面最大） |
| 05-DIM5 | 维度5 版本和 Release：A 中 / B 良 / C 中低（B 占优） | QW-15（flow-07 digest/version/outputSchema 语义对齐） | 链1（AgentVersion 冻结）；链3（草稿乐观锁→发布快照→版本冻结运行=已证模式）；§1 Q3（models.py:399-415 AgentRelease 对称模式；workflows.py:175-229）；§1 Q4（类比教训） | 项12（无稳定性承诺→案 C 统一模型漂移面更大） | I1（案 A flow 变更强制 Agent 升版=耦合；多 AgentVersion 各存一份=漂移） |
| 05-DIM6 | 维度6 双向调用（Agent↔Flow）：A 差 / B 良 / C 良（B/C 并列，B 落地成本低） | QW-04（tb-01 list_wakerflows O2）；QW-13（flow-03 resolve waker O1）——原站双向通道实证 | —（落点=05 §5.4 ChildInvocation） | — | I1（案 A 跨 Agent 调用=Agent→Agent、Flow 不可见/不可 pin/不可预算，安全纠错第 4 条无法落地；案 C 同型调用便利 vs 双 engine 调度成本） |
| 05-DIM7 | 维度7 父子 Run 与事件：A 中 / B 良 / C 良（B/C 并列） | — | 链3（runner.py:631-661 workflow-exec 子 Run 模式=同构先例；runs.py:250-317 /trace 谱系树直接扩展） | §3.2（官方无父子 Run 概念→平台自建） | I1（案 A 阶段≠Run 锚点缺失；案 C 事件模型须覆盖两种 engine） |
| 05-DIM8 | 维度8 选择性重做：A 差 / B 良 / C 中（B 占优） | （间接：QW-14 原站无入口→GAP-04） | 链3（发布快照→stage id 稳定性前提）；链4 重试段（task_runner.py:546-602 origin_run_id 谱系先例） | §3.2（官方无选择性重做）；项2（[DEV] L311-321 仅整体反馈重迭代、L124-125 新输入重置预算）；项4（官方对象状态纯内存→案 A 重做锚点无归属） | OD-01 假设 B（GAP-45）；I1（案 A 外置状态=重新发明案 B；案 C 名义统一实际双轨） |
| 05-DIM9 | 维度9 权限/预算/环检测：A 中 / B 良 / C 中高 | — | §1 Q3（agent_modules/base.py:88-96 module policies 常量模式）；§3 Q3+I1（runner.py:1121-1127、1128-1133；agent_runtime.py:534-535、576-577、670-671 分列判重→B 以 InvocationGraph 单树修复） | — | OD-11（阈值追认）；I1（案 A “flow 经 agent 回环”不可检；案 C 抽象一步到位但设计面大） |
| 05-DIM10 | 维度10 前端复杂度：A 低投入低达成 / B 中高 / C 中（A 占优=最低投入） | QW-12/15（flow-01/03/02/04/05/06/07：画布+脚本+run 记录+触发+对话面板 richness） | 链3 设计器现状（DesignerPage/xyflow 画布资产——经 07 OD-05 引证） | — | OD-05 假设 C（GAP-49）；I1（案 A 塞进 Agent 工作区=单页过载；案 C 壳内复用有限；对话式生成列后续） |
| 05-DIM11 | 维度11 数据迁移：A 小 / B 小中 / C 大（A 占优） | — | §1 Q3（AgentVersion.definition 加字段=案 A 无新顶层表）；§0.3（266 Run/9 workflow 活数据）；§6.1（runner EXECUTORS 全家族生产路径=案 C 重构回归面）；链3（案 B 全新增表 additive、存量零改写） | — | I1（小/小中/大判级） |
| 05-DIM12 | 维度12 未来扩展：A 差 / B 良 / C 良（远期）（B 占优） | — | — | §4.9（[DEV] A2AAgent=未来远端节点型）；项3（team 异步 role 型）；项12（46 commits/174 文件漂移→过早统一=统一层反复重构） | OD-16（goal_loop 官方对象/A2A 节点型=发布闸门后）；I1（案 A 每加一项 flow 能力都撞 AgentVersion 墙） |
| 05-DIM13 | 维度13 锁定成本和回滚：A 锁定最低 / B 中 / C 高（A 占优=最低锁定，代价=锁死产品语义） | — | 链3 判定“通”（案 C 触及唯一全通链、回滚需逆向迁移） | §3.2（补齐清单=三案共有固定成本，B 只是给它资产位） | I1（案 A 转 B=二次迁移；案 B 可独立停用回滚；案 C 双 engine 耦死+官方漂移同时暴露） |
| 05-SEQ0 | §7.0 公共机制 M1–M7（四时序共用契约） | — | M1：§6.1（FastAPI+JobQueue+worker 生产路径）；M2：models.py:301-319（RunEvent 双通道现成）；M4：runner.py:1325-1332（协作取消模式泛化）；M5：§1 Q3（base.py:88-96 module policies 泛化为 Run 预算账本）；M6：§3 Q8（Idempotency-Key manual 模式+fire_key schedule 模式）；M7：runner.py:1579-1596（recover_stale_jobs 租约回收）+P0-7 | M1：项5/项7（每回合装配语义，托管方=平台）；M2：项9（AgentEvent union、MODEL_CALL_END usage 累积、Msg.append_event L244+ 重建）；M3：项8（park=事件后 generator 结束；reply_id 路由 L146-161 [DEV]）；M4：项8（CancelledError 清理+UserInterruptEvent 幂等双路径 _chat.py L519-576）；M5：项8（[L2.0.7] middleware/_budget.py L21-30 ReplyBudgetControlMiddleware 语义对齐、账本在平台）；M7：项4（ExecutionState 补官方缺口） | D1 全套；OD-15 假设（平台自托管、Provider 无状态 /v1/runs）；依赖 P0-2（cancel）/P0-3（contract 扩展） |
| 05-SEQ1 | 时序1 用户 Chat→Agent→AgentFlow→多 Agent/role→返回 Chat（E1–E10+闭合表） | E10：QW-14（flow-02 阶段进度视图形态采纳）、QW-02（tb-01 行点击=会话路由导航语义）；工作假设来源：QW-04（chat turn=run 不可证→GAP-20/OD-10） | E1：agent_runtime.py:579-623（prod 指针+canary 桶解析模式）、§3 Q6（Run trigger=chat 现状）；E2：client.py:115-124（POST /v1/runs 模式）、链3 SSE（runs.py:185-213）；E6：worker.py:412-423（平台二次校验模式）；RunEvent：models.py:301-319 | E2：项5/项7（Provider 内 Agent 装配）；E3：项8（RequireExternalExecutionEvent [L2.0.7] event/_event.py L440-450 → park）；E6：项9（GenerateStructuredOutput agent/_structured_output_tool.py L42-45）；E8：项2（goal_loop 契约形状）+项4（不把官方内存对象跨 job 使用）；E9：项8（ExternalExecutionResultEvent L505-515+Case B 续接语义）；全程：项12（AgentState blob+schema_version 防漂移） | D1；OD-10（每 turn 一 Run、Session 1:N Run）；OD-07 假设 A（E10 看板 session 行）；OD-01 假设 B（闭合表续跑）；OD-15 |
| 05-SEQ2 | 时序2 自动任务→AgentFlow→Agent→选择性重做→结构化终态（E1–E7+闭合表） | E1/E7：QW-07（auto-03 手动=调试四指标 tooltip 语义采纳）；E1：QW-15（flow-05 触发文案级契约“1 配置多方式”）；E6：QW-14（flow-02 阶段画布投影形态）；闭合表：QW-15（flow-07 GENERATION 会话回写 generation_session_id O2 语义）；E7：01 I1（“第 N 次运行”含混教训→谱系徽章） | E1：链4 触发段（runner.py:372-395 advisory lock 选主+occurrence 物化+fire_key 幂等）、§2.6（KMS secret_ref 模式——atk_ 内嵌 URL 表象不抄）、§3 Q6（连续失败 5 次自动停用 runner.py:349-352 沿用）；E2：链4 TaskRun 冻结模式（task_runner.py:218-229 resolved_* 全套）、链4 UI 段（AutonomousTaskEditor.tsx:34-45 现仅 workflow/agent）；E5/E6：链4 重试段（task_runner.py:546-602 origin_run_id 谱系泛化）；批量分流：链4 原样 | 经 SEQ0 公共机制（M1–M7）；E6 Continuation 前置校验=D1 自建（03 §3.2 官方无选择性重做） | D1；OD-02 假设 B（event 路径随 doc12 S1）；OD-08 假设 A；OD-01 假设 B（E6 redo_from）；GR-6（E5/E7 执行终态与投递终态分列=有意强于原站单列） |
| 05-SEQ3 | 时序3 Workflow→Agent→Workflow 子调用（E1–E6+闭合表） | E6：run 级路由独立可达=04-R12 ADOPT 语义（间接 O：QW-14） | E1：runner.py:1706-1731（create_run 版本解析保留）+链3 薄弱点（runner.py:640 子调用草稿解析→P0-5 pin 声明修复）；E2：runner.py:1121-1127、1128-1133（环/深度泛化为跨类型单树）、runner.py:1218-1234（WF_PAR_RUN=4 保留）、链3 Worker 段（NodeRun）；E3：§3 Q2（registry.py:111-147 deprecated+workflows.py:93-111 /migrate 收敛）、§3 Q1（_run_member/execute_module_run_sync worker.py:323-391 模式）；E4：§2.4 断点⑥修复（挂载真成工具）；E5：runs.py:250-317（/trace 扩展） | 经 SEQ0 M1/M3/M4（项5/项8） | D1；OD-11（深度上限 5 假设，对齐 C1 wf 链）；OD-07 假设 A（一次性 workflow Run 看板投影）；Workflow DAG 节点级重做=DEFER P2（前置=节点级幂等声明全覆盖） |
| 05-SEQ4 | 时序4 单次无状态任务→Agent Planning→内部 plan items→Run 结束（E1–E6+闭合表） | 间接：04-R14 ← QW-04（tb-01 TaskCreate/TaskUpdate 表象）；E6 三义分离实证（任务书 §1.3；01 §4.2） | E1：business.py:1007-1021（Idempotency-Key manual 模式）、models.py:239-279（Run）；E4：worker.py:412-423（二次校验）；E5：§3 Q8 settle_run_success（delivery.py:60-103 同事务 Outbox） | E2：项6（Task 工具直接复用：_create_task.py L83-130 append+顺序数字 id；不自建计划引擎）、项7（Toolkit 装配）；E3：项6（state 三态枚举无 failed/cancelled→展示层不得虚构；blocks/blocked_by 无消费者→平台不实现依赖调度）、项9（CustomEvent L518-549 → RunEvent(CUSTOM, plan_progress) 投影）；E5：项12（audit_state 带 agent_state_schema_version）+项6（计划项随 session 存亡→审计必须显式落库）；闭合表：项8（cancel=CancelledError 清理） | D1；OD-07 假设 A（看板一行 run 投影）；三义分离红线（任务书 §1.3） |
| 05-GR1 | GR-1 CoT 不外露（纠错第 1 条） | QW-04/QW-15（tb-01-task-detail.png / flow-07-chat-panel.png “深度思考”全文外露 O1）；既有拍板禁抄 | models.py:301-319（RunEvent CONTROL/CONTENT 双通道字段现成） | 项9（THINKING_BLOCK_* ∈ 官方事件 union [L2.0.7] event/_event.py L26-67→映射必然发生，白名单在投影层强制） | D1（mapping_version 冻结+CONTENT 白名单+run:audit 权限点；验证=快照测试+UI 断言）；任务书 §8 纠错第 1 条 |
| 05-GR2 | GR-2 高危工具默认关闭（纠错第 2 条） | QW-04（tb-01：Bash(mkdir/npm install)/Write 直接执行、仅 prompt 自约束 O1） | §4 #3（runner.py:816-864 code-write 非真沙箱教训；auth_sandbox.py:14、27-29、82-85）；dispatcher 模式（runtime_providers/dispatcher.py:25-52 平台生成请求） | 项7（workspace/_base.py L223/L554、_local_workspace.py L65/L141 内置工具面受 (a)-(d) 门控）；项8（ConfirmResult.rules [L2.0.7] event/_event.py L453-464=用户确认可回写会话级权限规则、不跨 session 不入 Release；reply_id 路由审批流） | D1（四启用条件+danger_class+HITL 审批）；任务书纠错第 2 条；OD-13 关联 |
| 05-GR3 | GR-3 Hook 门槛（纠错第 3 条） | 无一手 O 证据——表象系任务书 §8 纠错第 3 条转述（I1 转述级；04-R15 已如实降级；原站权限/档案子页未开→GAP-15） | §4 #4（Hook 引擎零实现：grep 零命中；alerts.py:50-65 边界）；§4 #3（auth_sandbox QuickJS 沙箱模式可扩展） | 项7（agent/_agent.py L143-147 middleware hook 点=进程内装配面）；项5（extra_agent_middlewares 每回合注入语义，app/_app.py L209-224） | D1（一期不建用户可配置 Hook；若立项=HookDefinition 版本化+权限点+沙箱+幂等+超时；任意 shell hook 永不放行） |
| 05-GR4 | GR-4 Flow 枚举与调用受限（纠错第 4 条） | QW-04（tb-01 list_wakerflows 枚举通道存在 O2）；QW-10（治理 mount/pin/预算页面未见→GAP-07） | §2.4（agents.py:341-343 mounts-health 管理面校验思路→升为运行时强制） | — | D1（无 list_all_flows；run_agent_flow 仅 MountBinding+pin；TOOL_NOT_MOUNTED 双端 fail-closed；每次调用强制 ChildInvocation+预算分配）；任务书纠错第 4 条 |
| 05-GR5 | GR-5 嵌套与环治理（纠错第 5 条） | 01 GAP（Flow 嵌套/环/最大深度页面不可见→GAP-08） | §3 Q3+I1（runner.py:1121-1127、1128-1133 wf 链模式泛化为跨类型单树；agent_runtime.py:534-535、576-577、670-671 分列判重缺口修复）；NOTE-3 | — | D1（root_run_id+invocation_path 物化；CYCLE_DETECTED fail-closed；发布期静态引用闭合校验+运行期双保险）；OD-11（阈值 5 追认） |
| 05-GR6 | GR-6 Run 与 Outbox/Delivery 终态分离（纠错第 6 条） | QW-07（auto-03-task-detail.png 运行历史仅单列“运行结果”O1） | §3 Q8（全套模式已证：delivery.py:60-103、142-229、105-131；models.py:925-957 UNIQUE(run_id)+幂等键、912-918 delivery_status 独立列；task_runner.py:184-193 fail-closed 探测） | — | D1（泛化到 FlowRun/Automation：CommandOutbox+idempotency_class+Continuation 前置校验 (c) 拒绝非幂等未完成命令）；任务书纠错第 6 条 |
| 05-P0-1 | P0 前置1 运行环境活链路（Provider 可达+Release 重绑+健康） | — | 02 §0.2（8301/8302/8303 curl 空响应=全不可达）；§0.3（3 Provider 行 enabled 但 AgentScope health=error；8 Release 零 AgentScope 绑定、active 全绑 openai-agents/DSH）；§1 Q5（archive/runtimes-retired-2026-09-04/README.md：openai-agents 源码从未入 git） | — | D1（三案共同前置：“不修则三案皆空转”）；关联 GAP-25（health 成因）/GAP-26（8303 .venv 不可验证） |
| 05-P0-2 | P0 前置2 adapter cancel 真实现 | — | 02 §1 Q7（runtimes/agentscope/app/adapter.py:389-390 `async def cancel: return None`=no-op；134-143 capabilities cancel=True 声明与实现不符） | 03 项8（[L2.0.7] 官方取消语义：_chat.py L519-576、_session.py L256-300、_cancel_dispatcher.py L2-45；CancelledError 清理路径） | D1；M4/各时序取消传播依赖此项 |
| 05-P0-3 | P0 前置3 runtime_contract 扩展（session_state+skills 载荷+mapping_version） | — | 02 §2.1 断点⑥（packages/runtime_contract/src/quality_runtime_contract/models.py:66-74 AgentExecutionSpec 无 skills/session_state 字段）；§1 Q5 | 03 项12（schema 冻结/映射版本化义务）；项5（AgentState blob 须随请求/响应完整往返）；项9（事件映射面） | D1；GAP-44（官方 release notes 迁移说明缺失）关联 |
| 05-P0-4 | P0 前置4 api 触发真端点+token 鉴权 | QW-07（auto-03 atk_ token 内嵌 URL=表象参照；我方改 Bearer+KMS secret_ref、表象不抄） | 02 §3 Q6（trigger="api" 声明存在：models.py:902、work_item_projection.py:55、agent_runtime.py:595/679；全库无端点 grep 零命中） | — | D1（Idempotency-Key 必带、重复返回原 Run）；GAP-01（原站 API 真实 schema 不可证→契约自定义） |
| 05-P0-5 | P0 前置5 workflow-exec 子调用 pin 策略 | — | 02 链3 薄弱点（runner.py:631-661 子 Run 不带 version_id→草稿解析漂移；对照 runner.py:786-814 workflow-fixed pinned 可钉版本） | — | D1（pin 声明必填、无声明=发布校验拒绝；落点=05-SEQ3-E1） |
| 05-P0-6 | P0 前置6 Skill 单事实源迁移 | — | 02 §1 Q4-1（custom-config.tsx:88-98 Skill ID 写入 config.skills vs agent_runtime.py:238-243、265 按名字消费=语义错位）；链2 断点⑤⑥⑦（agent_release.py:19-56、112-181；contract models.py:66-74；adapter.py） | — | D1（废弃 config.skills；agent_skill 唯一挂载表+SkillVersion 入快照；验收=Provider 请求含 skills 载荷，02 §2.9 教训） |
| 05-P0-7 | P0 前置7 僵尸 run 回收 job | — | 02 §0.3（task_run 15 running/8 queued 滞留 09-02~09-07；job_queue 83 dead；run 1 行滞留 running 自 09-02）；链4 判定（runner.py:1579-1596 recover_stale_jobs 只回收 job 租约、不重置 TaskRun/Run 行） | — | D1（TaskRun/Run 级 stale 回收按超时置 failed(STALE)；M7 依赖）；GAP-30（成因细节）关联 |

---

## 2. 证据 → 结论反查表

> 覆盖：01 的 QW-01…16 及跨域事实/G2/汇总；02 的四链、全部章节与断点；03 的 12 契约条目与版本事实；00（补充）。引用格式为 §1 的结论 ID；括号内为 07 v1 的 OD 引用（07 非结论文件，仅辅助定位）。未被任何结论引用者标 `→ISO-x`（§2.5）。

### 2.1 01（原站观察）证据反查 — 25 行

| 证据 | 摘要 | 被引用结论 |
|---|---|---|
| QW-01 | 看板指标带/动作队列页签/五筛选（g1-01） | 04-R3 |
| QW-02 | 行点击=会话路由；行粒度=run/session 级、三类混排 O2（tb-01） | 04-R3、04-§2 平台任务行、04-前置硬事实6、05-SEQ1-E10；（07-OD-07） |
| QW-03 | @Waker=IM 渠道治理页；tooltip“群聊答疑专员”（g1-02） | 04-R17、04-R6（文案级） |
| QW-04 | 对话转录/工具面/composer/路径约定/present_files；TaskCreate/TaskUpdate；chat turn=run 不可证 I1（tb-01） | 04-R5、04-R8、04-R11、04-R14、04-§3 #1/#2/#4、04-前置硬事实6、05-REC(O类3)、05-DIM6、05-GR1、05-GR2、05-GR4、05-SEQ4（经 04-R14）、05-OD-10(§9) |
| QW-05 | 自动任务列表指标/switch（g1-03） | 04-R4 |
| QW-06 | 新建自动任务表单全字段；1/5 触发；两型执行方式；三态工作空间；“事件”差异事实（auto-01/02） | 04-R4、04-R11、05-REC(O类1)、05-DIM1、05-DIM2、05-§5.4 TriggerBinding、05-§5.6 WorkspaceBinding；（07-OD-02、OD-08） |
| QW-07 | 自动任务详情四指标/atk_ URL/运行历史回链 O2；批量不出现（auto-03） | 04-R4、04-R12、04-§3 #6、04-前置硬事实6、05-§4.1 触发面、05-§5.4 AutomationDefinition、05-GR6、05-SEQ2-E1/E7、05-P0-4；（07-OD-08 相关） |
| QW-08 | Waker 列表卡字段/本机徽标/主机名（g1-04） | 04-R1、04-R16（旁证）、05-DIM1；（07-OD-06） |
| QW-09 | Waker 工作区九子页/混合体判定/记忆时间线/技能 chips（waker-01） | 04-R1、04-R7、04-R10、04-R12、05-OD-14(§9)；（07-OD-04、OD-06） |
| QW-10 | per-Waker flow 列表与 global 对照 O2；治理页面未见（waker-02） | 04-R2（双作用域对照）、04-R13、05-GR4（表象 GAP）；（07-OD-03） |
| QW-11 | /resources/wakerflow 独立列表（g1-06） | 04-R2、05-DIM1、05-DIM2；（07-OD-03） |
| QW-12 | flow 详情头部/画布/输入参数 disabled/版本历史入口（flow-01） | 04-R2、05-DIM10、05-§5.2 AgentFlowRelease（头部运行控件）；（07-OD-05） |
| QW-13 | 脚本 DSL 全文：phase()/worker()/resolve/outputSchema；无 version 字段（flow-03） | 04-R2、04-R13、05-REC(O类2)、05-DIM1、05-§4.1 终态契约、05-§5.2 AgentFlowRelease、05-§5.7 OutputSchemaRef；（07-OD-04、OD-05） |
| QW-14 | run 级路由/阶段状态渲染/无名图标/run 列表（flow-02） | 04-R2、04-R12、05-SEQ1-E10、05-SEQ2-E6、05-SEQ3-E6（经 04-R12）、05-DIM8（间接）；（07-OD-01） |
| QW-15 | 版本整数/触发弹窗 1 配置多方式/对话面板 upsert 契约 O2/对话式新建（flow-04/05/06/07） | 04-R2、04-§3 #1、05-REC(O类2)、05-DIM1、05-DIM2、05-DIM4、05-DIM5、05-DIM10、05-§4.1 事实源、05-§5.2 AgentFlowDefinition、05-§5.4 TriggerBinding（flow-05）、05-§5.5 Session-GENERATION、05-GR1、05-SEQ2 闭合表；（07-OD-05） |
| QW-16 | 资源五页签：Skills/连接器/知识库/公开项目（g1-05、g1-07b、g1-08、g1-09） | 04-R7（g1-05）、04-R8（g1-07b、g1-07）、04-R9（g1-08）、04-R11（g1-09）、05-§5.6 WorkspaceBinding（g1-09） |
| 跨域事实1 | CoT“深度思考”外露（tb-01/flow-07） | 04-R5、04-§3 #1、05-GR1 |
| 跨域事实2 | Bash/Write 默认开放（tb-01） | 04-R8、04-R11、04-§3 #2、05-GR2 |
| 跨域事实3 | 工作空间路径约定+_output/+present_files 交付契约 | 04-R8、04-R11（经 QW-04）、05-§5.6 WorkspaceBinding（形态采纳） |
| 跨域事实4 | Credits 用量面板+设置按钮无面板 | 设置按钮半：05-OD-18(§9)；**Credits 数据半：无结论引用 →ISO-1** |
| 跨域事实5 | Group 部分证据（按钮 disabled、无实体） | 04-R6、05-OD-18(§9) |
| 跨域事实6 | 模型 Auto 选择器/Qwen 错峰折扣计价表象 | 无 →ISO-2 |
| G2 自检表 | 截图覆盖/视觉检查/双视角/禁点纪律 | 04-R9（知识库详情 ⚠️）；本索引 §3 截图台账（视觉检查列） |
| 01 头部 | 种子截图 01–05 独立复核一致结论 | 仅本索引 §3 台账 →ISO-3 |
| “页面证明不了的内容（汇总）” | 13 项不可证清单 | 04-R11（隔离实现）；本索引 §4 GAP-01…13 的直接来源 |

### 2.2 02（我方代码审计）证据反查 — 45 行

| 证据 | 摘要 | 被引用结论 |
|---|---|---|
| §0.1 | git/HEAD 快照（f6824f9） | 05 头部（C1 行号基线锚点）；04/05 全部 C1 引用的有效性前提 |
| §0.2 | 运行环境（DB wf_dev、8301–8303 全不可达、sole runtime 拍板 runtimes/README.md:8-16） | 04-前置硬事实4、05-§0.1-1、05-§0.3、05-P0-1 |
| §0.3 | wf_dev DB 只读快照 | 04-前置硬事实4、04-R1（风险）、04-R4、04-R9、05-§0.3、05-DIM3、05-DIM11、05-P0-1、05-P0-7；子行 datasource/connection/analysis_task →ISO-4/5/6 |
| §1 Q1 | Agent=定义根+环境指针混合体（models.py:354-378 等） | 04-R1、05-§5.1 AgentDefinition |
| §1 Q2 | Custom 链发布/运行双断+前后端三种可写口径 | 04-R1、05-§5.1（Custom 发布链补全） |
| §1 Q3 | AgentVersion/Release 冻结字段（dependency_snapshot、policies base.py:88-96、models.py:399-415） | 04-R1、04-R13、05-DIM5、05-DIM9、05-DIM11、05-§5.1、05-§5.6 ToolRef、05-§5.7 PolicySnapshot/ModelRef/OutputSchemaRef、05-SEQ0-M5 |
| §1 Q4 | 多事实源至少 5 处（Skill 双轨/Spec 双路径/Workflow 双源/config.connections 死数据/状态多源） | 04-R1、04-R7、05-DIM3、05-DIM5、05-§5.1、05-§5.2 RoleTemplate（冻结点教训）、05-P0-6 |
| §1 Q5 | 发布后资源消费按轨道回答（Module 四者全不消费） | 04-前置硬事实4、04-R8、05-P0-3（关联） |
| §1 Q6 | 生命周期与类型混用（wf-agent-editor.tsx:87） | 04-R1（口径统一重构项） |
| §1 Q7 | capability 声明未被端到端证明；adapter cancel no-op（adapter.py:389-390） | 04-R5、04-R7、04-R8（声明≠实现教训）、05-P0-2 |
| §2.1（链2 详版） | Skill 字段级链路：断点⑤⑥⑦+config.skills ID/名字错位 | 04-R7、05-REC(C类5)、05-P0-3（contract models.py:66-74）、05-P0-6、05-§5.6 SkillVersion |
| §2.2 | Tool 链：断点⑦执行体错位（fixture Tool Service 8200） | 04-R8、05-§5.6 ToolRef（_resolve_tool 不检查 status 缺口） |
| §2.3 | Knowledge 链：引用+外部检索端点、无索引无 revision；断点⑥⑦ | 04-R9、05-§5.6 KnowledgeSnapshot、05-OD-12(§9) |
| §2.4 | Workflow 挂载链：断点⑥（module/custom 停留 config）；mounts-health（agents.py:341-343） | 04-R2、05-DIM3、05-§5.6 MountBinding、05-GR4、05-SEQ3-E4 |
| §2.5 | MCP 链：registry 与运行时两个世界；断点⑦（adapter 固定 env URL） | 04-R8、05-§5.6 MCPServerVersion |
| §2.6 | Connection 链：credential ref 进平台进程不进 Provider 容器；断点⑦；config.connections 死数据 | 04-R8、04-R11（边界思路）、05-§5.4 TriggerBinding（KMS 模式）、05-§5.6 MCP（凭据现状）、05-§5.7 ModelRef、05-SEQ2-E1、05-P0-4、05-OD-13(§9) |
| §2.7 | Memory 链：三轨消费不一致；断点⑥（Module） | 04-R10、05-§5.6 MemoryPolicy、05-OD-14(§9) |
| §2.8 | Model 链：平台进程内 LLM 直调；凭据不跨界（部分断链⑦） | 04-R5、05-§5.7 ModelRef |
| §2.9 | 任务书特别复核项（页面能绑≠运行时消费等） | 04-R2（无 list/run workflow 工具）、04-R7（教训）、05-§5.6 SkillVersion（验收口径） |
| §3 Q1 | Workflow→新 AgentVersion：代码支持、DB 零实例；成员冻结谱系 | 04-R6、04-R13、05-SEQ3-E3 |
| §3 Q2 | agent 系节点 deprecated、迁移器仅显式端点 | 05-§5.3、05-SEQ3-E3 |
| §3 Q3 | 子流程/递归/深度/版本 pin 现状；混合深度无统一上限（I1） | 04-R13、05-REC(C类6)、05-DIM9、05-§5.4 ChildInvocation、05-GR5、05-SEQ3-E2/E4、05-OD-11(§9) |
| §3 Q5 | AnalysisTask/TaskVersion/TaskRun/Run/WorkItemProjection 分层不重叠 | 04-R3、04-R4、04-R14（术语碰撞）、05-§5.4 AutomationDefinition |
| §3 Q6 | manual/schedule/backfill/api 状态机；api 声明存在无端点；trigger 注释漂移 | 04-R4、04-R5、05-P0-4、05-§5.4 Run（枚举治理教训）、05-SEQ1-E1（trigger=chat 现状）、05-SEQ2-E1（5 次停用） |
| §3 Q7 | 自动任务/批量/一次性共享 Run 事实层、不共享看板投影 | 04-R3、04-R5、04-R12、04-R14、05-§4.3（Run=唯一执行事实表） |
| §3 Q8 | Outbox/幂等/重试/对账齐备且与执行终态分离 | 04-R4、05-§0.3、05-§5.7 CommandOutbox/ResultDelivery、05-GR6、05-SEQ0-M6、05-SEQ4-E5/闭合表 |
| §4 #1 | 一等 Project/Workspace/WorkspaceBinding 未实现；AgentWorkspaceShell=IA 壳 | 04-R1、04-R11、05-§5.6 WorkspaceBinding |
| §4 #2 | Bash/Read/Write/Edit/Grep/Glob 可治理工具未实现；exec_tool 无 builtin 分支 | 无 →ISO-12 |
| §4 #3 | subprocess 仅两处受限（code-write 生产禁用；auth_sandbox QuickJS） | 04-R11、04-R15（隔离模式复用）、05-GR2、05-GR3、05-OD-13(§9) |
| §4 #4 | Hook 引擎未实现（grep 零命中） | 04-R15、05-GR3 |
| §4 #5 | 平台 CLI 未实现 | 04-R16 |
| §4 #6 | IM Channel Gateway 未实现；RunEvent.channel=事件双通道标记 | 04-R17 |
| §4 #7 | 无飞书产品需求（grep 零命中；doc03:20 仅调研引述） | 04-R17 |
| §5 链1 | Agent(Module) 创建→发布→运行→结果：代码级通、运行环境级断 | 05-DIM5；05-SEQ1-E1/E2（行号引用 agent_runtime.py:579-623、client.py:115-124）；04-R1（经 §1 Q1/Q3 间接） |
| §5 链2 | Skill 上传→挂载→注入：通到 DB、断在 Release/Runtime | 04-R7、05-REC(C类5)、05-P0-6、05-§5.6 SkillVersion |
| §5 链3 | Workflow 全链：平台唯一全通链；薄弱点 workflow-exec 不 pin | 04-R2、04-R3（看板段）、04-R5（SSE 返回段）、04-R12（返回段）、05-§0.3、05-DIM1（前端段）、05-DIM3、05-DIM5、05-DIM7、05-DIM8、05-DIM10（设计器）、05-DIM13、05-REC(C类4)、05-§4.1、05-§5.2、05-§5.3、05-SEQ0-M4、05-SEQ1-E2、05-SEQ3 全程、05-P0-5 |
| §5 链4 | TaskRun 全链：通（api 触发未接线）；僵尸态判定 | 04-R3（看板段）、04-R4、04-R12（重试段）、05-§0.3、05-DIM8（重试段）、05-§5.4 TriggerBinding/ExecutionTarget/Continuation、05-SEQ2（触发/冻结/重试段）、05-SEQ3-E1、05-SEQ0-M6/M7、05-P0-7（判定） |
| §6.1 | 生产路径台账（fail-closed 清单） | 05-DIM11、05-§4.1（EXECUTORS 全家族）、05-SEQ0-M1、05-§5.7 ModelRef（LLM 行禁 mock） |
| §6.2 | mock 台账（4 项） | 无 →ISO-7 |
| §6.3 | fixture 台账（Tool Service 8200 等） | 04-R8 |
| §6.4 | POC/退役/封存台账 | 04-前置硬事实4（openai-agents/DSH 退役行）、04-R6（expert-group 封存）、04-R13、05-§5.3（deprecated 节点行）；子行 golden-eval/native_workflow/batch-run →ISO-8/9/10 |
| §7 | 未提交工作区变更清单（exports/ 敏感性、checkpoint 来历登记） | 无 →ISO-11 |
| §8 | EVIDENCE_GAP 10 项 | 04/05 无直接编号引用（缺口性质）；本索引 §4 GAP-23…32 的來源 |
| §9/§10 | G3 自检表+探针命令清单 | 元/纪律层：不入结论反查；供复核代理按任务书 R1 重放 |

### 2.3 03（AgentScope 契约审计）证据反查 — 32 行

| 证据 | 摘要 | 被引用结论 |
|---|---|---|
| §0（P1–P13/U1–U18） | 探针与 URL 全清单 | 支撑层：P10/P11 被 04-前置硬事实1 引用；U10 被 04-R10（项11）引用；U2–U8 支撑 §1 版本事实；其余为条目级行号定位来源（复核 R1 用） |
| §1.1 | 本地唯一安装=2.0.7 正式版；2.0.7 零 pipeline（P10/P11） | 04-前置硬事实1、04-R2、05 头部版本基线 |
| §1.2 | 安装来源=PyPI registry wheel（无 direct_url.json） | 05 头部（“03 §1”整节引用） |
| §1.3 | PyPI 2.0.8→404；最新=2.0.7.post1（2026-08-28） | 04-前置硬事实1、04-R2、05 头部版本基线、05-OD-16(§9) |
| §1.4 | 无 v2.0.8 tag；main HEAD=ff8697ec；NEWS 三条（A2A/Pipeline/DingTalk）；ahead 46/174 文件 | 04-R17（DingTalk NEWS）；项12 的漂移数据源（间接入 04-前置硬事实5、05-DIM12） |
| §1.5 | lockfile pin ==2.0.7；旧说法（AUDIT-HANDOFF U05/doc11/doc12）未过期核对 | 04-前置硬事实1、05-§0.1-4、05-OD-16(§9) |
| 项1 | PipelineProtocol=极小结构化协议（reply_stream 单方法；[DEV] pipeline/_base.py L15-33） | 04-前置硬事实2、04-R2、05-§1 案B定义（形状参照）、05-DIM4、05-REC(A类7) |
| 项2 | GoalPipeline=1 executor+1 verifier 固定循环；dead params；契约形状（[DEV] _goal_pipeline.py L22-325） | 04-前置硬事实2、04-R2、05-DIM4、05-DIM8、05-§3.2-2、05-§4.1（goal_loop 语义参照）、05-SEQ1-E8、05-OD-16(§9) |
| 项3 | 多 stage/并行/barrier/选择性重做全部不原生支持；team=异步协作 | 04-R6、04-R13、05-DIM12、05-§5.2 RoleTemplate（SubAgentTemplate 形态参照） |
| 项4 | pipeline state 纯内存、不可跨进程持久化（L83-91） | 04-前置硬事实2、04-R2、05-DIM8、05-REC(A类8)、05-§3.2-2、05-§4.1 状态恢复、05-§5.4 ExecutionState、05-SEQ0-M7、05-SEQ1-E5/E8 |
| 项5 | AgentState/Session/ChatService 边界；SessionStatus 四态；每回合装配 | 04-R1、04-R5、04-R10、05-DIM4、05-§5.5（Session/AgentState/SessionStatus 三实体）、05-§5.6 WorkspaceBinding（workspace_id/cwd）、05-SEQ0-M1、05-SEQ1-E2、05-SEQ4、05-GR3、05-OD-10/OD-15(§9) |
| 项6 | Task=Agent 内部计划项（tasks_context；blocks/blocked_by 无消费者） | 04-R13（team 对照）、04-R14、05-SEQ4-E2/E3/E5/闭合表 |
| 项7 | Toolkit/MCP/Skill/Knowledge/Workspace 装配链；权限面；Hub 机制 | 04-R7、04-R8、04-R9、04-R11、04-R15、05-DIM4、05-GR2、05-GR3、05-§5.6 SkillVersion/MCPServerVersion/KnowledgeSnapshot、05-SEQ0-M1、05-SEQ1-E2、05-SEQ4-E2、05-OD-12/13/15(§9) |
| 项8 | HITL 事件对/reply_id 路由/interrupt 双路径/cancel 广播/预算 middleware | 04-R5、05-DIM4、05-GR2（ConfirmResult.rules）、05-§5.5 AgentState（reply_id 往返）、05-§5.7 PolicySnapshot、05-SEQ0-M3/M4/M5、05-SEQ1-E3/E9、05-SEQ3 闭合表、05-SEQ4 闭合表、05-P0-2 |
| 项9 | 事件 schema（EventType 27 值/union 29 成员）/streaming/structured output/CustomEvent | 04-R3、04-R5、04-R12、04-R14、05-DIM4、05-§5.4 RunEvent、05-§5.7 OutputSchemaRef、05-GR1、05-SEQ0-M2、05-SEQ1-E6、05-SEQ4-E3、05-P0-3（映射面） |
| 项10 | Agent 接入 create_app 完备；pipeline 零服务层接入、仅 console | 04-前置硬事实2、04-R2、04-R16、05-REC(A类8)、05-OD-15/OD-16(§9 关联) |
| 项11 | 官方示例=教学样例非生产保证（BYPASS/单进程/demo 自述） | 04-R10（U10 mem0 示例级）、04-R11（LocalWorkspace 宿主语义）、05-OD-13/OD-15(§9) |
| 项12 | 无 schema 版本化/迁移框架；Beta；2.0.7→dev 已现漂移 | 04-前置硬事实5、04-R2（风险）、04-R5（风险）、04-R12（风险）、05-DIM5、05-DIM12、05-REC(A类9)、05-P0-3、05-§5.4 RunEvent（mapping_version）、05-§5.5 AgentState（opaque blob）、05-SEQ0-M2、05-SEQ1、05-SEQ4-E5、05-OD-16(§9) |
| §3.1 | 三列表·官方提供 | 05-§0.3、04-R10（边界） |
| §3.2 | 三列表·平台必须补齐 | 04-前置硬事实2、04-R2、04-R4、04-R12、05-§0.3、05-DIM4、05-DIM7、05-DIM8、05-DIM13、05-§3.3 成本、05-SEQ2-E6 |
| §3.3 | 三列表·不能确认 | 04-R7（SkillCard pin）、04-R9；本索引 §4 GAP-33…44 的来源 |
| §4.1 | 版本基线双轨；发布闸门口径 | 04-前置硬事实1、04-R2（风险）、05-§0.1-4、05-OD-16(§9) |
| §4.2 | pipeline 契约面极小且零治理 | 04-前置硬事实2、05-REC(A类7) |
| §4.3 | 官方 app 服务层与我方 server 职责重叠 | 04-前置硬事实3、04-R5、04-R9、04-R17、05-OD-12/OD-15(§9) |
| §4.4 | 调度器官方单点约束（enable_scheduler） | 04-前置硬事实3、04-R4、05-§3.3（不解决什么）、05-OD-15(§9) |
| §4.5 | 状态恢复保证只到 Agent 会话级 | 05-REC(A类8) |
| §4.6 | 升级必然伴随平台侧快照/迁移工程；正式发布后按 G4 重审 | 无编号引用 →ISO-13（内容经 03 项12/05-OD-16 覆盖） |
| §4.7 | 多 role 官方路径=异步 team 非编排节点 | 04-R6（风险）、04-R13 |
| §4.8 | HITL/取消语义可复用且有精确契约 | 无编号引用 →ISO-14（05-SEQ0-M3/M4 直接引项8） |
| §4.9 | A2A 出现；跨 agent 官方通道可能分化 | 04-R6、04-R13、05-DIM12 |
| §5 | EVIDENCE_GAP 9 项+NETWORK_BLOCKED 台账 | 本索引 §4 GAP-33…44 的来源（含 docs.agentscope.io NETWORK_BLOCKED） |
| §6 | G4 自检表 | 元/纪律层：不入结论反查（复核 R1 用） |

### 2.4 00（路由与对象清点）证据反查（补充）— 5 行

| 证据 | 摘要 | 被引用结论 |
|---|---|---|
| 00 §1 | 全局导航表+路由事实+深链缺陷 | 无直接编号引用 →ISO-15（路由缺陷内容与 01 §4.6 同义，经其入 04-R8；路由事实经 QW 步骤入口 URL 进入各行） |
| 00 §2 | 各路由主对象与动作（含市场制数据=原站生态事实标注） | 04-R7（市场制既有拍板）、05-DIM1、05-DIM2（原站只有 WakerFlow 一种 flow 产品） |
| 00 §3 | 阻断清单（BLOCKED_BY_SIDE_EFFECT/UNIDENTIFIED_CONTROL/EVIDENCE_GAP） | 间接：与 01 QW-15“三档区分”同义入 04-R2；经本索引 GAP-04/08/21/22 |
| 00 §4 | 同一名词跨页含义核对（任务/触发/项目/执行者） | 05-DIM2（“00 §2/§4”引用） |
| 00 §5 | v2 回填路由与面（conversations/wakers 子页/tr_ 详情/recruitment-market/用量/设置/Group/新建弹窗） | 04-R6、04-R9、04-R10、04-R13（recruitment-market）、04-R15、05-OD-18(§9)；GAP-11/12/15/16/17/18 来源 |

### 2.5 孤立证据（未被 04/05 任何结论引用 — 提示复核代理注意）— 15 项

| ISO | 证据 | 说明 |
|---|---|---|
| ISO-1 | 01 跨域事实4 · Credits 用量面板数据（团队版/续期日 2026-09-22/2,718÷3,000/资源包 0） | 同条目的“设置按钮无面板”半被 05-OD-18 引用；Credits 数据本身无结论引用。若未来做用量/配额设计（PolicySnapshot 相关）可回查 |
| ISO-2 | 01 跨域事实6 · 模型信息（composer/flow 面板 Auto 选择器；Qwen 错峰折扣文案=模型市场/计价表象） | 无结论引用；与 ModelRef/计价相关设计时可回查（Auto 字段作为 composer 属性已随 QW-04 被引用） |
| ISO-3 | 01 头部 · 种子截图 01–05 独立复核一致结论（03/04/05↔auto-01/02；01/02↔g1-01/g1-03） | 仅本索引 §3 截图台账引用；04/05 未引用。任务书 §11“只能复核不能继承”的履证记录 |
| ISO-4 | 02 §0.3 · datasource 明细（7 行=6 postgresql+1 mysql disabled/health=error） | 无结论引用；仅与 02 §8 GAP#2（→GAP-24）历史说法关联 |
| ISO-5 | 02 §0.3 · connection 明细（11 行，含 4 条 sdd13v-* 测试残留、1 条 archived） | 无结论引用；数据卫生线索，06 冲突审计或后续清理时可回查 |
| ISO-6 | 02 §0.3 · analysis_task 25 行（列表前 8 全部 execution_target_type=workflow） | 无结论引用（04-R4/05-§5.4 引 §3 Q5 的 models 行号而非行数）；佐证“现 target 仅 workflow”的 DB 面 |
| ISO-7 | 02 §6.2 · mock 台账全部 4 项（agent_runtime.py:87-95 LLM 回落、478-482 routing=mock、runner.py:874-954 decision-class mock、agent_runtime.py:359-365 _fallback_answer） | 无结论引用（05-§5.7 仅引 §6.1 LLM 行的禁 mock 门禁）；复核代理注意：目标态验收时这些 mock 边界仍是回归面 |
| ISO-8 | 02 §6.4 · golden-eval/eval-summary 生产端点直接读 POC ground truth（agents.py:600-604、656-657） | 无结论引用；生产端点读 POC 数据是独立风险线索，建议 06 冲突审计登记 |
| ISO-9 | 02 §6.4 · native_workflow v0.2（5 阶段 identify/plan/execute/barrier/synthesize+per-stage allowlist+fan-out+barrier，文件头自标 POC） | 无结论引用；注意：这是仓内已存在的“多阶段编排”雏形，与 05 AgentFlow Runner 设计相关但未被 05 引用——复核代理应确认是有意忽略还是遗漏 |
| ISO-10 | 02 §6.4 · /api/tasks/{tid}/batch-run 过渡入口（business.py:1023-1030） | 无结论引用；P0/迁移清理时可回查 |
| ISO-11 | 02 §7 · untracked exports/（原始通话样本 xlsx+JSON，未入 .gitignore）数据敏感性提示+“checkpoint 当日收口、测试未复跑”来历登记 | 无结论引用；提示复核代理：数据敏感性处置与 894245d/f6824f9 提交自述测试通过性（I1 提交者声明）未被他证 |
| ISO-12 | 02 §4 #2 · Bash/Read/Write/Edit/Grep/Glob 可治理真实工具未实现（EXECUTORS 无此类；exec_tool 无 builtin 分支 runner.py:494-542；唯一 builtin Tool disabled） | 无编号引用（GR-2 引 §4 #3）；GR-2 的“我方现状未实现”面实际由此条支撑，建议复核时并入 GR-2 证据链 |
| ISO-13 | 03 §4.6 · “唯一底层升级必然伴随平台侧快照/迁移工程；2.0.8 正式发布后按 G4 口径重审” | 无编号引用；内容经 03 项12（04-前置硬事实5、05-REC A类9）与 05-OD-16 覆盖 |
| ISO-14 | 03 §4.8 · “HITL/取消语义可复用且有精确契约、无需发明” | 无编号引用；05-SEQ0-M3/M4 直接引 03 项8 的同内容 |
| ISO-15 | 00 §1 · 全局导航结构表+路由事实（/ 重定向、resources 子页签独立路由、wakerflow 路由族）+底部按钮待复核 | 无编号引用；导航/路由事实经 01 各 QW 步骤“入口 URL”字段进入结论，深链缺陷半经 01 §4.6 入 04-R8 |

---

## 3. 截图台账（screenshots/ 逐文件，28 个）

> “视觉检查”列引用 01 G2 自检表：G2-1=六类核心区域覆盖；G2-2=逐张目视无空白/黑屏/遮挡；G2-3=关键表单上下半段；G2-4=列表+详情双视角；G2-5=未以保存/运行/启停换证据。

| 文件名 | 页面/路由 | 对应 QW 步骤 | 视觉检查结论（01 G2） |
|---|---|---|---|
| 01-task-board.png | /work-management 任务看板（种子） | QW-01（复核与 g1-01 一致，01 头部） | G2-1/G2-2/G2-5 ✅；独立性复核记录=ISO-3 |
| 02-autonomous-work-list.png | /autonomous-work 列表（种子） | QW-05（复核与 g1-03 一致） | G2-1/G2-2/G2-5 ✅；ISO-3 |
| 03-autonomous-task-create.png | 新建自动任务弹窗（种子） | QW-06（复核与 auto-01/02 一致） | G2-2/G2-3 ✅；ISO-3 |
| 04-autonomous-task-create-lower.png | 同弹窗下半（种子） | QW-06 | G2-2/G2-3 ✅；ISO-3 |
| 05-autonomous-task-advanced.png | 同弹窗高级设置（种子） | QW-06 | G2-2/G2-3 ✅；ISO-3 |
| auto-01-create-dialog-top.png | /autonomous-work 新建弹窗上半（触发/执行方式/执行指令/工作空间） | QW-06 | G2-2 ✅；G2-3（上半段）✅ |
| auto-02-create-dialog-lower.png | 同弹窗下半（高级设置展开：最大运行次数/截止日期） | QW-06 | G2-2 ✅；G2-3（下半段）✅ |
| auto-03-task-detail.png | /autonomous-work/tr_956b9556b2b34c51 详情 | QW-07 | G2-2 ✅；G2-4（自动任务 列表+详情）✅ |
| flow-01-detail-text-only-review.png | /wakerflow/724a121a-38dd-49c3-86f2-55cde851be5d 画布视图 | QW-12 | G2-2 ✅；G2-4（Flow 列表+详情+runs）✅ |
| flow-02-execution-records.png | /wakerflow/<uuid>/runs/faa34ee3-4264-403e-9767-4d807f4107ad 执行记录 | QW-14 | G2-2 ✅（无名图标未点击=G2-5） |
| flow-03-script-view.png | /wakerflow/<uuid> 脚本视图（DSL 全文） | QW-13 | G2-2 ✅ |
| flow-04-version-history.png | /wakerflow/<uuid> 版本历史面板 | QW-15 | G2-2 ✅（单版本→GAP-10） |
| flow-05-add-trigger-dialog.png | “编辑触发方式”弹窗 | QW-15 | G2-2 ✅；G2-3（单屏完整）✅ |
| flow-06-create-entry.png | /wakerflow/new 对话式生成页 | QW-15 | G2-2 ✅（未提交=G2-5） |
| flow-07-chat-panel.png | /wakerflow/<uuid> 对话面板（含 workflow_upsert 响应全文=O2 存储契约） | QW-15 | G2-2 ✅ |
| g1-01-work-management.png | /work-management | QW-01 | G2-1（看板）/G2-2/G2-5 ✅ |
| g1-02-at-waker.png | /at-waker | QW-03 | G2-1（@Waker+对话）/G2-2 ✅（当前空态=页面事实非截图事故） |
| g1-03-autonomous-work.png | /autonomous-work | QW-05 | G2-1（自主）/G2-2 ✅ |
| g1-04-management.png | /management | QW-08 | G2-1（Waker 管理）/G2-2 ✅ |
| g1-05-resources.png | /resources/skills 技能市场 | QW-16 | G2-1（资源）/G2-2 ✅ |
| g1-06-resources-wakerflow.png | /resources/wakerflow | QW-11 | G2-1/G2-2 ✅ |
| g1-07-resources-connectors.png | /resources/connectors（错误复数 slug 深链，被重写 ~150 次、内容区空白） | 无独立 QW 步骤（01 §4.6 路由缺陷段；00 §1） | G2-2 特例：缺陷证据——空白内容区系产品 bug，非截图事故（01 G2 原文） |
| g1-07b-resources-connectors.png | /resources/connector（单数真实 slug） | QW-16 | G2-1/G2-2 ✅ |
| g1-08-resources-knowledge.png | /resources/knowledge | QW-16 | G2-2 ✅；G2-4 ⚠️ 知识库详情未开=GAP-11 |
| g1-09-resources-projects.png | /resources/projects（当前空） | QW-16 | G2-1/G2-2 ✅（空态=页面事实） |
| tb-01-task-detail.png | /conversations/qs_01m1zy6bnvc9fmjswwg4v7w313?sid=168f5d8c-… 任务详情=会话视图 | QW-02 与 QW-04（双步骤共用） | G2-1（看板+对话）/G2-2/G2-4（任务 列表+会话详情）✅ |
| waker-01-manage-page.png | /wakers/b82d781c4c06/home 概览 | QW-09 | G2-1/G2-2/G2-4（Waker 列表+workspace）✅ |
| waker-02-subpage-wakerflow.png | /wakers/b82d781c4c06/workflows 子页 | QW-10 | G2-2 ✅（空态=页面事实，O2 对照 scope.kind='global'） |

---

## 4. 缺口台账（统一编号 GAP-01…GAP-52）

> 来源分组：A=01“页面证明不了的内容（汇总）”13 项；B=01/00 步骤级补充缺口 9 项；C=02 §8 EVIDENCE_GAP 10 项；D=03 §3.3“不能确认”∪ §5 EVIDENCE_GAP/NETWORK_BLOCKED 去重后 12 项；E=07 v1 OD-01…08（决策缺口）8 项。
> “阻断性质”口径：**阻断**=该缺口使某结论不能成立或不能进入实施；**部分阻断**=仅阻断结论的某个子面；**不阻断**=结论已按缺口自设计或按默认建议推进，缺口仅限制对原站/官方/历史的外推。
> 注：05 §9 新识别的 OD-09…OD-18（10 项拍板请求）不在 07 v1 内，按任务口径不编入本台账；其“阻断=待拍板”性质已在 §1 正查表 I/D 列逐行标注。

### 4.A 01 页面证明不了（汇总 13 项）

| GAP | 缺口 | 来源 | 影响结论 | 阻断性质 |
|---|---|---|---|---|
| GAP-01 | API 真实 schema（仅 atk_ URL 与 upsert 响应两隅可证） | 01 汇总 | 04-R4、05-P0-4、05-§5.4 TriggerBinding | 不阻断，仅限制外推（我方 api 端点契约为自定义 D1，不声称知道原站 schema） |
| GAP-02 | target 是否 pin 发布版本（flow 以 wakerId 短 id 引用、无 version 字段可见） | 01 汇总 | 04-R13、05-§5.2 AgentFlowRelease、05-§5.4 ExecutionTarget、GAP-48(OD-04) | 不阻断（我方“引用必须可 pin”为 D1 决策，正是对此缺口的处置；原站表象不抄） |
| GAP-03 | WakerFlow 内部状态机/attempt/父子事件（无独立视图） | 01 汇总、QW-14 | 04-R12、05-§5.4 ExecutionState/ChildInvocation | 不阻断，仅限制外推（不得声称原站有/无 attempt；我方三谱系区分为自建） |
| GAP-04 | 选择性重做（页面无任何可见入口；无名图标=UNIDENTIFIED_CONTROL） | 01 汇总、QW-14、00 §3 | 04-R2/R12、05-DIM8、05-§5.4 Continuation、05-SEQ2-E6、GAP-45(OD-01) | 不阻断（任务书红线：“原站支持选择性重做”不成立；我方 Continuation=自设计，按 OD-01 假设 B） |
| GAP-05 | 工作空间隔离实现 | 01 汇总 | 04-R11、05-GR2、05-OD-13(§9) | 不阻断（GR-2 治理为任务书强制项，不以原站实现为据） |
| GAP-06 | 自动任务幂等/并发（页面未见；或需查外链文档） | 01 汇总、QW-07 | 04-R4、05-§5.4 TriggerBinding | 不阻断（我方 fire_key/Idempotency-Key 模式为 C1 已证自建，02 §3 Q6/Q8） |
| GAP-07 | Waker↔Flow 双向调用的治理（mount/pin/预算/环检测页面未见） | 01 汇总、QW-10 | 04-R13、05-GR4/GR5 | 不阻断（治理规则=我方强制设计 D1，非借鉴项） |
| GAP-08 | Flow 嵌套与最大深度（页面无可见限制说明；DSL 未见 flow 调 flow 原语） | 01 汇总、00 §3 | 05-GR5、05-OD-11(§9) | 不阻断（深度上限 5=对齐 C1 wf 链的 D1 自定；发布期静态校验+运行期双保险为自建） |
| GAP-09 | DSL 并行/条件/聚合/循环/重试支持度（样本中均未出现） | 01 汇总、QW-13 | 04-R2、05-§4.1（一期 stage 类型=串行/声明式并行/goal_loop） | 不阻断，仅限制外推（不能因按钮缺失断言原站不支持，亦不得声称支持） |
| GAP-10 | 版本回滚/发布/草稿语义（仅单版本不可证） | 01 汇总、QW-15（flow-04） | 04-R2、05-§5.2 AgentFlowVersion/Release | 不阻断（我方发布/回滚语义=自设计 D1，复制 C1 链3 模式） |
| GAP-11 | 知识库详情页未开 | 01 G2 ⚠️、00 §5 | 04-R9、05-OD-12/OD-18(§9) | 不阻断（OD-12 默认建议可在无详情证据下推进）；07 追加计划点名处置 |
| GAP-12 | 设置页（两次 JS 点击无可观察面板，附尝试记录） | 01 跨域事实4、00 §5 | 05-OD-18(§9) | 不阻断（无结论依赖设置页） |
| GAP-13 | 事件触发表单入口缺失（副标题称“定时、事件或 API”，表单只见 定时/API 两卡） | 01 汇总、QW-06 差异事实、00 §5 | 04-R4、05-§5.4 TriggerBinding、05-SEQ2-E1、GAP-46(OD-02) | 不阻断（勿把副标题当表单事实；OD-02 假设 B 系我方 doc12 业务驱动，不以原站为上限） |

### 4.B 01/00 步骤级补充缺口（9 项）

| GAP | 缺口 | 来源 | 影响结论 | 阻断性质 |
|---|---|---|---|---|
| GAP-14 | IM 接入后的运行形态（无已开通聊天可看；IM 属我方范围外主动不深挖） | 01 QW-03 | 04-R17 | 不阻断（REJECT 已由既有拍板关闭） |
| GAP-15 | Waker“权限/档案/记忆/自进化 Skill”子页未开 | 00 §5、01 QW-09 | 04-R1（版本/启停语义）、04-R7（Skill 复制可见性）、04-R10（记忆）、04-R15（Hook 面）、05-OD-18(§9) | 不阻断，但为补查优先项：05-OD-18 明言“权限/档案子页可能改变 04-R15（Hook）与 04-R1 的证据基础” |
| GAP-16 | 管理页 Group 页签未开、无 Group 实体（部分证据） | 00 §5、01 跨域事实5 | 04-R6 | 不阻断（DEFER 判定正基于“证据不足”） |
| GAP-17 | @Waker 开通弹窗与 IM 连接管理未进入 | 00 §5 | 04-R17 | 不阻断（范围外） |
| GAP-18 | Skill“我的技能”、连接器“我的连接器”子视图未开 | 00 §5 | 04-R7、04-R8 | 不阻断，仅限制外推 |
| GAP-19 | worker resolve.kind 枚举完备性（仅见 kind='waker'） | 01 QW-13 | 04-R2、04-R13、05-§5.2（role 引用集设计） | 不阻断，仅限制外推 |
| GAP-20 | chat turn = run 不可证伪/证实（I1 倾向、O 级不足） | 01 QW-04 必须回答 | 04-R5、05-SEQ1、05-OD-10(§9 建议) | 不阻断（以“每 turn 一 Run、Session 1:N Run”工作假设推进，待 OD-10 追认） |
| GAP-21 | 工作空间/资源如何传入 flow run（未见字段） | 00 §3 | 04-R2/R11、05-SEQ0-M1（请求携带=自设计） | 不阻断 |
| GAP-22 | 运行类动作副作用阻断总集（BLOCKED_BY_SIDE_EFFECT：运行/试运行/保存×3/启用 switch/安装/发送） | 00 §3、01 G2-5 | 04-R2（运行期行为）、04-R7（安装行为） | 不阻断（纪律边界；原站运行期行为仅以既有 run 记录 QW-14/QW-07 为 O2 证） |
### 4.C 02 §8 EVIDENCE_GAP（10 项）

| GAP | 缺口 | 来源 | 影响结论 | 阻断性质 |
|---|---|---|---|---|
| GAP-23 | “wf_dev 曾为唯一真库”的历史部署形态（仓内无部署物证） | 02 §8#1 | 无（历史说法不进目标架构） | 不阻断，仅限制外推 |
| GAP-24 | “32 个 mysql datasource 曾是占位”当前不可复核（现仅 1 条 mysql 行） | 02 §8#2 | 无 | 不阻断（无结论依赖该说法；关联 ISO-4） |
| GAP-25 | AgentScope Provider health=error 的当前成因（“服务没起”vs“适配器缺陷”不可区分） | 02 §8#3 | 05-P0-1 | 部分阻断：不阻断 P0-1 的必要性结论，但阻断其修复执行路径（动工前须复测区分成因） |
| GAP-26 | 8303 openai-agents 服务是否仍可从 .venv 运行（源码从未入 git，仅 .pyc 物证） | 02 §8#4 | 04-前置硬事实4、05-P0-1 | 不阻断（断链结论以“源码未入 git+服务不可达+active Release 残留”三证成立） |
| GAP-27 | Provider /health 实测 capabilities 当前值（三服务全不可达、DB 为 08-30~09-02 陈旧快照） | 02 §8#5 | 05-P0-1、05-P0-2 | 不阻断（“声明≠实现”由 02 §1 Q7 独立支撑） |
| GAP-28 | DSH→AgentScope 行为移植完成度（无已过真实回归的物证；native_workflow 自标 v0.2 POC） | 02 §8#6 | 05-REC/§3.2（Runner 自建，不依赖移植物） | 不阻断 |
| GAP-29 | 8120 API/5199 前端等服务健康（任务约束未探测） | 02 §8#7 | 02 链1–4 与 05-§0.3 的全部“链路通”结论 | 不阻断，仅限制外推（04/05 所有“通”均为代码级断言，不含“当前服务可用”） |
| GAP-30 | 15 running TaskRun/1 running Run 僵尸态成因细节（worker 历史日志不在仓内） | 02 §8#8 | 05-P0-7 | 不阻断（回收必要性已由 §0.3 行数证明；成因待修复后归因） |
| GAP-31 | Workflow→Module Agent 嵌套（R3-5）是否有专属 e2e 测试通过记录 | 02 §8#9 | 05-SEQ3-E3 | 不阻断，但复核需注意：C1 代码路径存在（agent_runtime.py:640-646+worker.py:323-391），e2e 证明缺位，SEQ3 为 D1 设计 |
| GAP-32 | connection_schemas.py ConnectionCreate 字段全集（本轮未逐行核读） | 02 §8#10 | 04-R8、05-§5.4 TriggerBinding（token 方案以 admin.py:117-215 行为为准） | 不阻断 |

### 4.D 03 “不能确认”（§3.3 ∪ §5 去重后 12 项，含 NETWORK_BLOCKED）

| GAP | 缺口 | 来源 | 影响结论 | 阻断性质 |
|---|---|---|---|---|
| GAP-33 | 2.0.8 正式版发布时间、最终 tag 内容及其与 ff8697ec 的差异（版本不存在；main 持续变动不冻结） | 03 §3.3/§1.3/§1.4 | 04-前置硬事实1、04-R2 风险列、05-OD-16(§9) | 部分阻断：阻断 goal_loop 官方对象复用与 A2A 节点型的生产化（发布闸门后+按 G4 重审）；不阻断案 B 主线（Runner 自建、2.0.7 即可生产） |
| GAP-34 | docs.agentscope.io pipeline/overview 页面内容（NETWORK_BLOCKED：WebFetch ECONNRESET×2+curl HTTP 000；存在性仅由 NEWS.md 链接证实） | 03 §5/§3.3 | 无（A1 结论全部基于源码/tests/NEWS） | 不阻断，仅限制外推（官方文档叙述未核验） |
| GAP-35 | GoalPipeline max_retries/verifier_reset_context dead params 的官方意图（bug 还是待接线） | 03 §3.3/§5#1 | 05-SEQ1-E8 | 不阻断（设计已绕开：max_iters 来自 FlowVersion，非官方 dead params） |
| GAP-36 | Task.blocks/blocked_by 的预期执行语义（字段存在、可写入、无任何消费者源码） | 03 §3.3/项6 | 04-R14、05-SEQ4-E3 | 不阻断（已裁定：平台不实现依赖调度、不得外推为调度契约） |
| GAP-37 | ChatService 长 reply 中途崩溃的状态恢复粒度（_persist 位于结束路径，中途快照有无未核验） | 03 §3.3/§5#2 | 05-SEQ0-M7、05-OD-15(§9) | 不阻断（平台自托管假设不依赖官方中途快照；恢复粒度=stage/Run 为自建） |
| GAP-38 | MCPCard/SkillCard 的版本 pin 字段（未逐一读取） | 03 §3.3/§5#3 | 04-R7 风险列 | 不阻断（“市场安装=版本可控”不可假定；市场制不照搬） |
| GAP-39 | A2AAgent 657 行实现的治理完备性（权限/预算/审计是否贯穿，未逐行审计） | 03 §3.3/§5#4 | 04-R6/R13、05-DIM12 | 不阻断（A2A 节点型列 OD-16 发布闸门后） |
| GAP-40 | message bus replay log/事件持久化的保留与裁剪策略 | 03 §3.3/§5#5 | 04-R3（replay log 作投影事件源的可行性） | 不阻断（平台自建 RunEvent 持久化，不依赖官方 replay log） |
| GAP-41 | 官方 pipeline 服务化路线图/milestone 是否存在 | 03 §3.3/§5#8 | 05-DIM12、05-OD-15(§9) | 不阻断，仅限制外推（不得假定官方未来提供服务层托管） |
| GAP-42 | examples/web_ui、agent_service 的官方定位（生产参考 or 教学） | 03 §5#6 | 05-OD-15(§9 默认建议) | 不阻断 |
| GAP-43 | v2.0.7.post1 release notes 是否含迁移说明（release body 未读取） | 03 §5#7 | 05-OD-16(§9 重审闸门)、05-P0-3 | 不阻断 |
| GAP-44 | Task 计划项在官方 web_ui 中的投影方式（前端示例源码未核验） | 03 §5#9 | 05-SEQ4-E3 | 不阻断（我方 plan_progress 投影为自建 D1） |

### 4.E 07 v1 未决项（决策缺口，8 项）

> 性质说明：本组非证据缺口，而是“拍板缺口”——三方证据已齐但产品选择未定。04/05 全程仅以 07 默认建议为工作假设（05 §0.2），“阻断”指受影响段落在拍板前不得定稿实施。

| GAP | OD | 决策缺口 | 阻断的结论（拍板前不得定稿） | 默认建议（工作假设） |
|---|---|---|---|---|
| GAP-45 | OD-01 | 选择性重做的产品承诺级别 | 05-§5.4 Continuation、05-GR5、05-SEQ2-E6、04-R2/R12 | B（run 级重跑+失败阶段起续跑；C 任意节点列 P2 gated） |
| GAP-46 | OD-02 | “事件触发”是否进入一期 | 05-§5.4 TriggerBinding、05-SEQ2-E1、04-R4 | B（随 doc12 S1 落 webhook 事件入口） |
| GAP-47 | OD-03 | Flow 作用域模型（全局/属主/双作用域） | 05-§5.2 AgentFlowDefinition、04-R2 | A（仅全局起步+schema 留 scope 字段） |
| GAP-48 | OD-04 | 资源挂载语义（引用/复制/版本 pin） | 05-§5.6 MountBinding、05-GR4、04-R7 | C（引用+可选 pin） |
| GAP-49 | OD-05 | AgentFlow 编辑器形态 | 05-§5.2 Definition/Version、05-DIM10、04-R2 | C 一期（画布源+脚本只读契约视图；B/D 后续） |
| GAP-50 | OD-06 | Waker“在线实例/本机”维度是否引入 | 04-R1、05-§5.4 Run（worker 标识） | C（Run 记 worker 标识，不建实例实体） |
| GAP-51 | OD-07 | run 投影是否成为唯一看板语义 | 04-R3、05-SEQ1/2/4 前端行 | A（看板=run/session 投影，管理页=定义级） |
| GAP-52 | OD-08 | automation target 三型关系 | 04-R4、05-§5.4 ExecutionTarget、05-SEQ2 | A（三型全开+agent 型强制 Release pin） |

**缺口统计**：共 52 项（A 组 13 + B 组 9 + C 组 10 + D 组 12 + E 组 8）。阻断性质分布：部分阻断 2 项（GAP-25、GAP-33）；“不阻断但复核需注意/补查优先”2 项（GAP-15、GAP-31）；其余 48 项均为“不阻断，仅限制外推或按默认建议推进”。另：05 §9 的 OD-09…OD-18（10 项新识别拍板请求）未写入 07 v1，按任务口径不编入本台账，其待拍板性质已在 §1 正查表 I/D 列逐行标注。

---

## 5. 一致性核对与 REF-BROKEN 清单

### 5.1 核对方法与范围（全量核对，非抽样）

1. **QW 步骤号**：收集 04/05 全文出现的全部 QW-xx → 逐一对照 01 的“步骤 ID：QW-xx”段落。结果：仅出现 QW-01…QW-16，全部真实存在于 01（§4.1=QW-01/02；§4.2=QW-03/04；§4.3=QW-05/06/07；§4.4=QW-08/09/10；§4.5=QW-11/12/13/14/15；§4.6=QW-16）；未引用不存在的 QW-17+。
2. **截图文件名**：收集 04/05 出现的全部截图名 → 逐一对照 screenshots/ 实际文件清单（28 个，§3 台账逐文件核过）。结果：全部存在；仅 NOTE-1 的缩写形式不精确。
3. **02 编号**：收集 04/05 出现的全部 02 引用（§0.1–§10、链1–4、§1 Q1–Q7、§2.1–§2.9 与断点环⑤⑥⑦、§3 Q1–Q8、§4 #1–#7、§6.1–§6.4）→ 逐一对照 02 章节结构。结果：全部存在；02 的链路环定义（①页面→⑦AgentScope 注入）与 04/05 使用的断点编号语义一致。04/05 未引用不存在的“链5”“Q9”“#8”等编号。
4. **02 file:line 直抄核对**：05 直接转录 file:line 共 17 处（models 399-415；models.py:354-378；models.py:239-279；models.py:301-319；agents.py:445-504；workflows.py:175-229；base.py:88-96；contract models.py:66-74；runner 631-661；runner:1121-1133；runner:1325-1332；runner.py:640；create_run:1706-1731；runs.py:250-317；worker.py:412-423；agent_runtime:579-623；client.py:115-124）→ 逐一对照 02 原文。结果：全部能在 02 找到对应记载；其中 2 处为 02 相邻引用的合并区间（NOTE-2、NOTE-3），其余与 02 逐字一致。04 未直接转录 file:line（全部为 02 章节级引用），章节引用全部存在。
5. **03 编号**：收集 04/05 出现的全部 03 引用（项1–项12、§1.1–§1.5、§3.1–§3.3、§4.1–§4.9、P10/P11、U10、[L2.0.7]/[DEV] 锚点）→ 对照 03 结构。结果：全部存在；03 §4 为编号列表 1–9，04/05 的“03 §4.x”引用形式与列表项号一一对应；[L2.0.7]/[DEV] 锚点约定在 03 头部与 04/05 头部引用约定中一致声明（NOTE-5）。
6. **07/00/任务书引用**：OD-01…OD-08 全部存在于 07 v1，且 05 §0.2 转录的 8 条默认建议与 07 各条“默认建议”字段逐一相符（B/B/A/C/C/C/A/A+强制 pin）；OD-09…OD-18 全部存在于 05 §9（10 项），04/05 引用处均明示“建议追加、未写入 07”（NOTE-4）；00 §1–§5 全部存在；任务书被引节号（§1.1/§1.2/§1.3/§5.4/§7/§8/§9/§10、G2/G3/G4/G5、强制安全纠错第 1–6 条、R5）全部存在于任务书原文。

### 5.2 REF-BROKEN 清单（悬空引用）

**REF-BROKEN = 0 条。** 未发现 04/05 引用的 QW 步骤号、截图名、02 章节/链/断点/Q 编号、03 条目/§ 编号、07 OD 编号、00 章节号在源文件中不存在的情形。

### 5.3 非精确引用注记（非悬空，复核时留意）

| NOTE | 位置 | 说明 |
|---|---|---|
| NOTE-1 | 04-R2（04 行2 原文“flow-04/05/06/07.png”） | 缩写记法而非完整文件名。实际文件：flow-04-version-history.png、flow-05-add-trigger-dialog.png、flow-06-create-entry.png、flow-07-chat-panel.png（四个均存在，§3 台账已逐文件列全） |
| NOTE-2 | 05 §5.1 AgentRelease 行“agents.py:445-504” | 为 02 §1 Q3 两处相邻引用 agents.py:445-477（ONE_PROVIDER_PER_AGENT 等约束）与 agents.py:478-504（Release 冻结字段）的合并区间；两段均存在于 02，非悬空 |
| NOTE-3 | 05 GR-5 落点“runner:1121-1133” | 为 02 §3 Q3 两处相邻引用 L1121-1127（call_chain 环判重）与 L1128-1133（链长 ≥5 失败）的合并区间；两段均存在于 02，非悬空 |
| NOTE-4 | 04/05 多处引用 OD-09…OD-18 | 该 10 项仅存在于 05 §9（“建议追加 07 v2”），不在 07 v1；04 §5 与 05 §8/§9 均已明示“未写入 07、未标记 DECIDED”，属拍板请求引用而非悬空引用；复核代理按任务书 R4 检查“未决项未伪装成拍板”时以此为清单。状态更新（2026-09-08）：OD-09…18 已入 07 v2（七字段补全），OD-19 同轮追加 |
| NOTE-5 | 04/05 引用 03 的 [DEV] 行号处 | 未逐处重复标注 commit ff8697ec4d59ee01f3766176e70cb24ee894d6c6；版本锚点由 03 头部统一约定、04/05 头部引用约定明示“A1→03 条目编号（[L2.0.7]/[DEV]）”，非悬空；外部复核按 03 §0 的 U11–U17 URL 重放 |
| NOTE-6 | 04-R1 A 证据列（04 行1 原文“无‘在线/主机’运行实例实体，运行事实在 session/run 层（03 项5/项9）”） | 缺席型 A 证据：03 项5/项9 无逐字否定句，该表述由官方实体清单（AgentData/AgentRecord/SessionRecord/事件面）中不存在此类实体推出；04 已将该行标注 ADAPT（I/D），复核时应核对 03 项5 实体清单而非寻找逐字否定句 |

### 5.4 交叉一致性抽查（04↔05↔07↔任务书 同源事实互核）

- 版本双轨事实三处一致：03 §1.1/§1.3（实装 2.0.7、2.0.8 未发布）= 04 前置硬事实1 = 05 头部版本基线；04/05 全文无“已安装 2.0.8”类表述。✅
- 运行环境断链事实一致：02 §0.2/§0.3 = 04 前置硬事实4 = 05 §0.3/§3.3 P0-1。✅
- 任务三义一致：任务书 §1.3 = 01 QW-02/04/07 实证 = 04 前置硬事实6/§2 = 05 §0.1-3/SEQ4-E6。✅
- 强制安全纠错六条映射完整无遗漏：任务书 §8 六条 = 04 §3 #1–#6 = 05 GR-1–GR-6（一一对应）。✅
- 04 §4 结论分布统计核对：ADOPT 2 行（R12/R14）、ADAPT 10 行（R1/3/4/5/7/8/9/10/11/13）、DEFER 3 行（R6/15/16）、REJECT 1 行（R17）、OPEN 1 行（R2），合计 17 行——与 §1 正查表逐行结论枚举核对一致。✅
- 05 §2.1 维度优势汇总核对：案 B 占优 8 维、案 A 占优 3 维（DIM10/11/13）、案 C 占优 2 维（DIM6/7 并列+DIM12 远期）——与 §2 矩阵各格判级抽查一致（DIM6/DIM7 B、C 均“良”；DIM9 C“中高”高于 B“良”但 §2.1 已注“B 落地成本更低”）。✅
- 05 §0.2 的 OD 默认建议转录与 07 v1 原文逐条一致（见 5.1-6）。✅
- 04 §5 纪律声明核对：04/05 对 OD-01…08 全部以“默认建议为工作假设”措辞引用，无一处写成已拍板；05 §8 G5 末行自检与之一致。✅

---

## 6. 交付物自检与数量汇总

- 本文件为本代理唯一产出；未修改其他任何文件；未运行改状态命令（全程只读检查+仅写入本文件）；未使用浏览器；未派发子代理；未新增结论（§1–§4 全部为源文件内容的索引与转录，§5 为引用存在性核对）。
- **正查表行数：49**（04 主表 17 行 + 05 一级结论 32 行：推荐案 1、13 维矩阵 13、公共机制/四时序 5、GR-1..6 共 6、P0 前置 7）。
- **反查表行数：107**（01 证据 25 + 02 证据 45 + 03 证据 32 + 00 补充 5）。
- **孤立证据：15 项**（ISO-1…ISO-15，§2.5，含复核提示）。
- **GAP 总数：52 项**（GAP-01…GAP-52：01 汇总 13 + 01/00 步骤级 9 + 02 §8 10 + 03 不能确认 12 + 07 OD 8；部分阻断 2、复核注意 2、其余不阻断）。
- **REF-BROKEN：0 条**（非精确引用注记 6 条，NOTE-1…NOTE-6，均非悬空）。

*索引完。*
