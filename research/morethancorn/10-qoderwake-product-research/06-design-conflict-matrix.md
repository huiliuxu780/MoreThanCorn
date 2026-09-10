# 06 · 设计稿冲突矩阵（阶段 6）

> **2026-09-08 纠偏提示**：本矩阵记录的是旧设计稿与旧架构提案的冲突，事实证据仍可复核，但修订建议已被 10 号纠偏控制单替代。尤其不得继续采用平台 Session/AgentState/RunEvent、library-only AgentScope 或自建 AgentFlow Runner 的建议。

> 日期：2026-09-08 · 状态：`RESEARCH_ONLY`（本文件为本轮唯一交付物；未修改 `docs/v2-design/` 任何文件、任何代码/迁移；全程只读；未使用浏览器；未派发子代理）
> 审计对象：docs/v2-design/03-trigger-and-data-mapping.md（09-04，无版号）、05-agent-management-redesign.md（v2.1）、08-agent-pages-align-19830.md（v2.1）、11-agentscope-full-integration.md（v5.1）、12-event-driven-workorder-pipeline.md（v2.1）、AUDIT-HANDOFF-agentscope-plan.md（v2.1）。六档全部逐段回原文核对（06a 摘句仅作索引，本矩阵所有引句均对照原文行级复核）。
> 证据引用约定（任务书 §3）：`O1/O2`＝01 的 QW 步骤＋截图名；`C1`＝02 的章节/链/断点编号或 file:line（行号以 HEAD f6824f9 为准）；`A1`＝03 的条目编号（`[L2.0.7]`＝已发布实装版源码行；`[DEV]`＝2.0.8-dev@ff8697ec4d59ee01f3766176e70cb24ee894d6c6，未发布）；`D1`＝04/05 提案（未拍板，不得当既定事实引用）；`06a`＝设计稿事实抽取底稿。
> “是否需用户拍板”列语义：**是**＝绑定 07 的 OD 编号或本矩阵建议新编号，须用户决定后才能修订对应文档段；**否**＝事实纠错、既有拍板落实或任务书强制安全纠错，经主审计者 R5（`ACCEPTED_FOR_DOC_REVISION`）后直接修订。
> 本轮只给逐段修订建议与“建议新文本”（附录，每条 ≤120 字），不直接改六档设计稿。冲突 ID（CF-xx）为稳定引用编号，按主题分簇，非文档阅读顺序。

---

## §0 执行摘要

- **冲突总条数：40**。九类型分布：FACT_ERROR 5 · STALE_VERSION 4 · MODEL_CONFLICT 3 · UI_CONFLICT 0 · SECURITY_GAP 2 · UNDECIDED_AS_DECIDED 3 · MISSING_CONTRACT 17 · TERMINOLOGY_COLLISION 4 · DUPLICATE_CAPABILITY 2（计数表见 §5）。
- **需用户拍板：16 条**（对齐 07 v1 OD-01～08 与 05 §9 建议的 OD-09～18，另建议新编号 **OD-19**；状态更新 2026-09-08：OD-09…19 已全部入 07 v2）；其余 24 条为事实纠错/强制纠错类，经 R5 验收后可直接修订。
- **D01–D22 处置（单独一节 §3，禁静默覆盖）：保留 13 · 修订 9 · 废止 0**；另提出 6 项**建议新增决定**（D23–D28 候选，全部绑定 OD 待拍板）；U02 默认建议需随 OD-12 修订、U05 需随 OD-16 澄清范围、U03 跳空需补解释。
- 三点横向观察：
  1. 六档的“现状事实”类表述与 02 高度一致（同日审计同源），真实冲突集中在**02 新证的环境级 P0 事实**（运行死链、Release 绑退役 Provider、8200 fixture 工具执行体、僵尸 TaskRun、HEAD 已移动）与 **O/A 级新证据**（原站 Flow 一等性、AgentScope 版本双轨、`state_updated` 不是独立事件类型而是官方点名的 CustomEvent name）。
  2. 最大结构性冲突簇＝**05 推荐案 B（AgentFlow 一等资产）vs 六档现行案 A 形态（PipelineDefinition 内嵌 AgentVersion、二元 target、否定 Flow 入数据模型）**，共 8 行（CF-01～08），全部 gated by OD-09/OD-08，未拍板前不得改档、也不得把案 B 写成既定事实。
  3. **安全红线缺口（CoT 外露、高危内置工具、文件系统工作空间）不依赖任何 OD**（任务书 §8 强制安全纠错＋07 v1 头部既有拍板），应在 R5 后最先修订（CF-24/25/26/28）。
- UI_CONFLICT＝0 的说明：doc08 逐页规格与 O1 证据的实质分歧均已归入更准确的类型（thinking 消息块＝安全红线 → CF-24 SECURITY_GAP；看板投影缺口＝契约缺失 → CF-34 MISSING_CONFLICT；Flow 资产页缺位＝未决被拍板 → CF-02）；未发现“纯 UI 规格与原站/我方实测 UI 事实相抵触”的独立条目。

---

## §1 必查清单（任务书 §9）逐条回应

| # | 必查项 | 结论 | 对应冲突行 |
|---|---|---|---|
| 1 | doc11 PipelineDefinition 内嵌 AgentVersion 与一等 AgentFlow（05 推荐案 B）的冲突 | **冲突成立**。doc11 §2.7 末段＋§7 冻结清单第 3 项＋§4 全节＋D19 将 Pipeline 定为 AgentVersion 内部拓扑；O2 证据（upsert 契约 scope.kind='global'、执行方式两型 radio、list_wakerflows 运行时通道）与 A1（Flow 级版本化/持久化/服务层托管＝官方缺失、平台必须补齐）共同支持一等 Flow 资产候选。案 B 为 D1 未拍板，冲突按 OD-09 门控登记，不预设结论 | CF-01（MODEL_CONFLICT）、CF-06、CF-07；D03/D09/D19 处置＝修订（§3） |
| 2 | doc05 的 Agent/Module/Version/Release 能否冻结 AgentFlow 引用 | **不能**。四处缺口：§3 资源版本规则表无 AgentFlow 行；§4.1 AgentVersion 冻结清单（15 项）无 AgentFlowRelease；§2.4 MountBinding 对象仅 Skill/Tool/Knowledge/Workflow；§6.2 API 与 §9 验收 12–14 仅覆盖 Workflow 双向。C1 现状同证：freeze_dependencies 类型表无 flow 类（agent_release.py:112-181） | CF-03（MISSING_CONTRACT，拍板 是） |
| 3 | doc08 的 Agent 工作区是否缺 Execution/Flow/工作空间/双向关系 | **Execution 不缺**（§5 执行页已设计 Pipeline/Planning/混合模式）；**Agent↔Workflow 双向不缺**（§4 两关系区＋§12 双向编排验收）。**缺**：① Flow 一等资产页与 Agent↔AgentFlow 双向关系（且 §4 把“WakerFlow 不进入本项目数据模型”写成拍板，OD-09 未决）；② 文件系统义工作空间/产物交付契约（全档“工作区”均指管理 UI 壳）；③ 平台看板多源统一投影与动作队列页签；④ thinking 消息块触碰 CoT 红线 | CF-02、CF-06、CF-28、CF-34、CF-24 |
| 4 | doc12 是否仍把 T1 当唯一工单流水线实现 | **是**。§8 的 T1（Trigger/映射/batching）＋T5（“Workflow/Agent 两类 Task target 合流”）仍是唯一工单链路；§0 把“执行目标是 WorkflowVersion 或 AgentVersion”二元写成拍板（“三选不成立”）；无单发自动化直连 Run 路径、无 AgentFlow target；T3 仍锚定 11 号稿 P1 QualityPipeline（案 A 载体）。OD-08/OD-09 未决，该二元拍板属未决被写成已决 | CF-05（UNDECIDED_AS_DECIDED，拍板 是）；CF-08 |
| 5 | doc03 的 Trigger target union 是否需加 AgentFlow | doc03 本身**未显式写 target union**（Trigger 只绑定 Task，产生 TaskRun）；union 实际落点＝AnalysisTask 的 DB Check 约束 workflow｜agent（C1 models.py:745-750）＋doc11 §9/doc12 §0 的二元表述。若 OD-08/OD-09 批准三型，doc03 §2/§7 需补 ExecutionTarget 契约并加 agent_flow_release 成员（强制版本 pin）；同时 doc03 的“Trigger 产生的批次”单一路径需与“单发直连 Run”分流（见 CF-08） | CF-04（MISSING_CONTRACT，拍板 是） |
| 6 | D01–D22 哪些废止/修订/新增 | **保留 13（D01/D02/D04/D05/D07/D08/D10/D12/D15/D17/D18/D21/D22）· 修订 9（D03/D06/D09/D11/D13/D14/D16/D19/D20）· 废止 0**。无一条被新证据整体推翻：治理原则全部存活，修订动因＝案 B 载体变化（D03/D09/D19/D20）、挂载与 Session 口径精确化（D06/D11/D13/D14）、batching 归属收窄（D16）。另建议新增 D23–D28 候选（全部绑定 OD，待拍板，见 §3.3）。U/N 项处置见 §3.2 | §3 全节 |
| 7 | 旧“2.0.8-dev/PyPI 未发布”事实是否过期 | **未过期，不定 STALE_VERSION**。A1 复核：PyPI `2.0.8`→404、无 v2.0.8 tag、最新＝2.0.7.post1（2026-08-28）、main HEAD 仍＝ff8697ec（03 §1.3/§1.4/§1.5，U2/U3/U6）。但文档缺**双轨基线契约**：实装并 lock 的是 2.0.7 正式版（registry wheel，P5/P6/P7），2.0.7 中零 pipeline 代码（P10/P11）；doc11 §3.1“官方当前提供”清单未区分哪些属已发布 2.0.7、哪些仅 [DEV]。“当前采用 2.0.8”只能读作设计/spike 基线——据此定级为 MISSING_CONTRACT 而非 STALE_VERSION。现行 pin=2.0.7 不违反 doc11 §12/D02 | CF-11；连带 CF-13（GoalPipeline dead params）、CF-15（U05 闸门范围） |
| 8 | 飞书/IM 是否被误写成当前范围 | **未被误写**。“飞书”六档仅 1 次（doc03 §1 依据 4，对 Coze 的调研引述，06a 全局检索＋C1 02 §4 #7 grep 复核）；“IM”作为渠道概念 0 次；C1 证明零实现、零需求（02 §4 #6/#7）。风险点在 doc11 §3.1：官方 App 层清单未提其自带 IM 渠道网关（Feishu/Discord/DingTalk，A1 03 §4.3），若 OD-15 取舍时误启用即入范围——已把“逐项取舍表（含渠道网关默认关闭）”列为拍板项；channel 双义术语另登记 | CF-14（拍板 是，OD-15）、CF-39（术语） |
| 9 | “固定治理骨架”是否又被写成固定业务 Agent | **未复发**。doc11 §4.1（治理不变量 11 项清单＋“不是把阶段名和 prompt 写死在 Python”）、doc08 §5.2（“不同 ModuleVersion 可声明不同 stages/edges/roles；通用 Runtime 只固定治理不变量”）、doc12 §4.1（“首个质检 ModuleVersion 的声明式 PipelineDefinition，不是通用控制器里写死的唯一七段流程”）、HANDOFF §5 均保持边界，且与 A1 03 §3.2（编排语义官方缺失、平台自建）一致。无需入表 | —（核查通过） |
| 10 | mock 工具是否被误写成完整产品能力 | **部分成立**。doc12 §2.1“Connection / egress / MCP Gateway｜已有凭据、出站策略和工具闸门能力｜外部动作复用”对 **AgentScope 轨道不成立**：adapter 只连固定 env URL 的 8200 fixture Tool Service（自述 "returns fixture facts only"），不读平台 tool/mcp_server 表，凭据不进 Provider 容器（C1 02 §2.2/§2.5/§2.6 断点⑦）。doc11 §1.2“Module 结构化 Run 主链存在”缺“代码级通/运行环境级断”限定（三 Provider 全不可达、零 AgentScope Release 绑定）。native POC 的 fixture 表述（doc11 §4.5/HANDOFF A06）准确，无需修 | CF-17（FACT_ERROR）、CF-16（FACT_ERROR）、CF-18（A 清单缺项） |

**02 P0 级现实逐项入表核对（任务书另条要求）**：运行时死链→CF-16/18/20；Release 绑退役 Provider→CF-16/18/19/20；api 触发无端点→CF-09（doc12 §2.1 与之矛盾）＋doc03 §1 依据 2 已如实记录（核查通过，不入表）；Skill 双事实源→文档已如实记录（A01/A02、doc11 §1.1/§12、doc05 §1.1），但缺“ID/名字语义错位”第三义→CF-40；Custom 半断链→文档已记录（A03/A08、doc05 §1.1.3），缺“前后端三种可写口径＋409 NO_WORKFLOW 断点细节”→CF-40；僵尸 TaskRun/83 dead job→CF-18/20；HEAD 894245d→f6824f9、52 dirty path 已被 checkpoint 收入→CF-19（STALE_VERSION）。

**06a 额外输入逐项消化**：doc11 实为 v5.1 且自述冻结失效→CF-36；“AgentFlow”六档 0 次→CF-06；U03 编号跳空→CF-35；各档“01 已证但文档未提”清单 68 项→§4 逐条定级（入表 33 项次、非冲突 35 项次，允许一条候选映射多行/合并同类）。

---

## §2 冲突矩阵总表

### 2.A AgentFlow 一等性与执行目标（案 B 冲突簇，全部 gated by OD-09/OD-08）

| 冲突 ID | 文档与段落 | 当前表述 | 新证据 | 问题类型 | 建议动作 | 是否需用户拍板 |
|---|---|---|---|---|---|---|
| CF-01 | doc11 §2.7 末段、§7 冻结清单第 3 项、§4 全节；D19（11 §11.1） | “AgentScope Pipeline 是 AgentVersion 内部运行拓扑……二者允许互相调用，但不合表”；“PipelineDefinition、controller/version/state schema”随 AgentVersion 原子冻结 | O1 01 QW-06（auto-01-create-dialog-top.png：执行方式两型 radio，Flow 是独立于单 Agent 的执行目标）；O2 QW-15（flow-07.png upsert 契约：独立 id/digest(64hex)/version/scope.kind='global'/generationSessionId）；O2 QW-04（tb-01.png：list_wakerflows 运行时通道）；O1 QW-13（flow-03.png：worker resolve wakerId 可指非属主）；A1 03 §3.2（Flow 级版本/持久化/服务层托管＝平台必须补齐）、项4（[DEV] _goal_pipeline.py L83-91 状态纯内存）；C1 02 链3（草稿乐观锁→发布快照→冻结运行可复制模式）；D1 05 §2/§3（案 B，未拍板） | MODEL_CONFLICT | 若 OD-09 批案 B：§2.7 改三主体（Agent/AgentFlow/Workflow）互调不合表；§7 第 3 项改“PipelineDefinition（单体内部拓扑）或 AgentFlowRelease 引用（经 MountBinding）”；§4 QualityPipeline 载体映射到 AgentFlow 内置方案；D19 按 §3 处置表修订并显式 supersede 记录。若维持案 A：在 11 §11 登记否决案 B 的理由。新文本见附录 CF-01 | 是（OD-09；连带 OD-16/OD-17） |
| CF-02 | doc08 §4（“参考产品的 WakerFlow 只是交互参考，不进入本项目数据模型”）、§14 第 2 条 | 以拍板语气否定 Flow 进入数据模型 | 任务书 §1.2（候选结构“不得预先把这一候选结构写成既定事实”——其否定式 likewise）；O2 QW-15（Flow 为账号级一等资产表象）；D1 05 §9 OD-09（明示“doc11 现状需 06 冲突审计登记 supersede”）；C1 02 链3（我方有可复制的一等 Flow 资产模式） | UNDECIDED_AS_DECIDED | OD-09 未决前，把该句从“拍板”降级为“待决”：命名/DSL/契约不照抄维持不变（正确），但“Flow 产品职责是否由我方一等 AgentFlow 承载”改为引用 OD-09；§14“不把 Wakerflow 当成 AgentScope Pipeline”保留（该句与案 B 兼容）。新文本见附录 CF-02 | 是（OD-09） |
| CF-03 | doc05 §3 资源版本规则表、§4.1 冻结清单、§2.4 MountBinding、§6.2 API、§9 验收 12–14 | 冻结对象含 ToolVersion/SkillVersion/KnowledgeSnapshot/WorkflowVersion；MountBinding 对象仅四类；无 AgentFlow 任何冻结/挂载/API/验收条目 | C1 02 §1 Q3（freeze_dependencies 类型表 agent_release.py:112-181 无 flow 类）；O2 QW-15（Flow 独立 id/digest/version 契约）；O2 QW-04（Agent→Flow 运行时通道需 mount+pin 锚点）；D1 05 §5.1/§5.2/§5.6（dependency_snapshot 增 AgentFlowRelease 类型、MountBinding 对象扩 agent_flow、FlowRelease pin） | MISSING_CONTRACT | 若 OD-09 批案 B：§3 表增 AgentFlow 行（pin AgentFlowRelease）；§4.1 清单增第 16 项；§2.4 resource_type 扩 agent_flow（主体扩 AgentFlowVersion(role)，OD-17）；§6.2 增 flow mounts 端点；§9 增验收“Agent 仅可调用已挂载且 pin 的 FlowRelease，未挂载不可枚举”（GR-4 口径）。新文本见附录 CF-03 | 是（OD-09；连带 OD-17/OD-04） |
| CF-04 | doc03 §2 概念模型、§7 数据模型增量 | “Trigger（新增一等实体，绑定 Task……）”；trigger 表 task_id 真 FK；全文无 ExecutionTarget/target union 表述 | C1 02 链4 UI 段（AutonomousTaskEditor.tsx:34-45 executionTarget=workflow｜agent）、§3 Q5（models.py:745-750 Check 约束 workflow/agent 互斥）；O1 01 QW-06（auto-01：执行方式含“运行 WakerFlow”型）；D1 05 §5.4（ExecutionTarget union{agent_release, agent_flow_release, workflow_version}＋强制 pin）、07 OD-08 | MISSING_CONTRACT | doc03 §2/§7 补“执行目标契约”小节：target 由所绑自动化定义持有而非 Trigger；union 成员与版本解析策略（pinned｜latest_prod｜latest_sandbox）显式列出；agent_flow_release 成员标注“OD-08/OD-09 拍板后生效”。新文本见附录 CF-04 | 是（OD-08/OD-09） |
| CF-05 | doc12 §0 结论、§1 场景图、§3 目标选择表、§8 T1/T5 | “旧稿中的‘flow / agent 批量 / agent 对话三选’不成立。正确选择……1. Task 的执行目标是 WorkflowVersion 或 AgentVersion”；T5“Workflow/Agent 两类 Task target 合流” | O1 01 QW-06（执行目标三要素中 Flow 独立成型）、QW-07（auto-03：单发定义、运行历史另表、无批量字段）；D1 05 §3.2/§7.2 E2（Automation 可直接指向 AgentFlow；单发不经 TaskRun）、§4.2 判定规则 3；07 OD-08（三型 target 未决）；C1 02 §3 Q5（TaskRun＝批次层） | UNDECIDED_AS_DECIDED | OD-08/09 未决前：§0 二元拍板句改为“现行实现为二元（C1），三型 union 待 OD-08 拍板”；§1 场景图与 §3 表加 agent_flow 占位行（标注待决）；§8 T5 改名“执行目标合流（成员随 OD-08）”；T3 补“若 OD-09=B，工单 Pipeline 可改由 AgentFlow 内置方案承载，与 11 号稿 P1 的映射需同轮修订”。新文本见附录 CF-05 | 是（OD-08/OD-09） |
| CF-06 | 六档全局（06a 全局检索：“AgentFlow”0 次出现）；落点：HANDOFF §7 M1 清单、doc11 §2/§7/§10、doc05 §2–§4、doc08 §4/§5、doc12 §3 | 六档无任何 Flow 一等资产契约：无 AgentFlowDefinition/Version/Release、无 Flow 编辑器与生成会话、无 FlowRun 平台外置阶段状态、无 flow mount/flow target | O1/O2 01 QW-11～15（g1-06/flow-01..07：列表/详情/画布+脚本双视图/run 级路由与阶段状态/整数版本/触发 1 配置多方式/对话式生成与 workflow_get_script/upsert 存储契约）；A1 03 §3.2（多 stage/并行/barrier/选择性重做/持久化/服务层托管/Flow 版本化＝平台必须补齐清单）；C1 02 §4 #1（无 Workspace/Flow 类模型）、链3（可复制发布快照模式）；D1 05 §5.2/§5.4（候选模型全套） | MISSING_CONTRACT | 若 OD-09 批案 B：在 HANDOFF §7 M1 交付清单与 doc11 §7/§10 增补 AgentFlow 资产线契约（Definition/Version/Release、ExecutionState stage 终态即写、Continuation 前置校验、编辑器形态随 OD-05、scope 随 OD-03、重做级别随 OD-01、生成会话 generation_session_id 后续期）；doc08 §4“流程/编排”页扩为 Workflow/AgentFlow 双 mount 区＋Flow 独立资产页 IA。若否决：登记否决理由并关闭本行。新文本见附录 CF-06 | 是（OD-09；连带 OD-01/03/05/16/17） |
| CF-07 | doc11 §9 执行语义关键字（“flow：平台 WorkflowVersion 执行”）；doc08 §4（“原‘Wakerflow’改名‘流程/编排’”） | 裸用“flow”指代 WorkflowVersion；“流程/编排”页名不区分 Flow 产品 | 06a 全局检索（“AgentFlow”0 次；最接近表述即 11 §9 该句）；O1 01 QW-11（原站 WakerFlow 为独立产品名）；C1 02 §2.4（前端 mounts.tsx:44 仍用原站品牌词“Wakerflow”——术语借用待清理）；D1 05 §4.1（Workflow/AgentFlow 边界表） | TERMINOLOGY_COLLISION | 若案 B 成立：11 §9 关键字改“workflow：WorkflowVersion 执行；agent_flow：AgentFlowRelease 执行”；全档禁用裸“flow”；doc08 §4 页名拆“Workflow 挂载区/AgentFlow 挂载区”；F1 验收补“前端清除 Wakerflow 品牌词”（任务书 §1.1 品牌禁抄）。新文本见附录 CF-07 | 是（OD-09 决定命名空间） |

### 2.B 自动任务与 Trigger 模型

| 冲突 ID | 文档与段落 | 当前表述 | 新证据 | 问题类型 | 建议动作 | 是否需用户拍板 |
|---|---|---|---|---|---|---|
| CF-08 | doc03 §2（Trigger 绑 Task、batching 为 Trigger 属性、1 Task 多 Trigger）、§7 trigger 表；doc11 §0.1 故事 D、§9（“automation：Task + Trigger + budget”）；doc12 §0（“自动任务只是由 Trigger 启动 TaskRun”） | 一切触发一律攒批进 TaskRun；自动化＝Task＋Trigger；无单发直连路径；无 prompt/workspace/policy 五元组定义模型 | O1 01 QW-06（auto-01/02：自动任务＝Trigger+target+prompt+workspace+policy 五元组表单；触发方式 1/5；表单/详情零批量字段）、QW-07（auto-03 tooltip：手动运行＝调试，不更新最近触发/不计入累计/不更新最近结果）、QW-15（flow-05：“一个 WakerFlow 只有一份自动运行配置，可添加多个触发方式”）；C1 02 §3 Q5（AnalysisTask 分层）、链4（TaskRun＝批次）；D1 05 §5.4（AutomationDefinition/TriggerBinding/单发直连 Run、manual_debug 口径）、§7.2 E2 | MODEL_CONFLICT | 三档同轮收敛：自动化定义改五元组（TriggerBinding 集＋ExecutionTarget＋prompt/参数＋WorkspaceBinding＋policy）；单发触发直连 Run，不经 TaskRun；batching 收窄为数据窗口批量场景（TaskVersion/TaskRun 轨道）属性；Run.trigger 增 manual_debug（调试不计入累计，落投影口径）；“1 定义 1 份自动运行配置、多触发方式、上限我方定”。doc03 §7 trigger 表随之改绑自动化定义（迁移规则随 M0）。新文本见附录 CF-08 | 是（OD-08/OD-09；OD-02 关联事件触发一期） |
| CF-09 | doc12 §2.1 表 AnalysisTask/TaskVersion/TaskRun 行 | “已有 workflow/agent 执行目标、manual/schedule/backfill/**api** 触发来源、幂等字段和 resolved version” | C1 02 §3 Q6（“api：声明存在、接线不存在……全库无任何端点以 trigger='api' 创建 TaskRun”，§10 命令 6 grep 零命中；models.py:902 仅注释词表）；doc03 §1 依据 2 同档自证“trigger='api' 是空洞值” | FACT_ERROR | §2.1 该行现状列改“manual/schedule/backfill 已接线；api 仅词表声明、无端点（空洞值，正由 03 号稿 Trigger 设计填补）”。新文本见附录 CF-09 | 否 |
| CF-10 | doc03 头部（日期 2026-09-04；约束来源“SDD-13……02 审计 B14/B7”） | 六档中唯一未随 09-08 回炉标版的文档（06a 定位节）；引用旧轮“02 审计”条目为约束来源 | 06a 全局事实（无 v 字段）；HANDOFF §2（“旧 00–10……仅作背景证据”——doc03 所引旧审计已被降级）；C1 02 §0.1（现行代码基线 HEAD f6824f9） | STALE_VERSION | 补版号（v1.1）与基线注记：旧审计引用降级为背景证据，代码事实以 research/10-qoderwake-product-research/02（HEAD f6824f9）为准；随 CF-04/CF-08/CF-33 同轮修订。新文本见附录 CF-10 | 否 |
| CF-33 | doc03 §2（“Schedule 收编为 Trigger 的一种类型，现有 Schedule+ScheduleOccurrence 机制原样保留”）、§7 trigger 表（config JSONB 含端点/鉴权/topic/group/过滤/映射/攒批/去重键） | 收编后 trigger 行与 schedule 表的字段级权威划分未闭合：type=schedule 的调度配置存放位置未声明 | C1 02 §0.3（schedule 6 行/schedule_occurrence 201 行真实资产）、链4 触发段（fire_key 幂等 models.py:903、48h 物化 occurrences.py:32-102）；02 §1 Q4（五处多事实源教训：双轨并存是已付学费的断链成因） | DUPLICATE_CAPABILITY | doc03 §7 补划分声明：type=schedule 的 trigger 行仅持 schedule_id 引用＋UI 归集，调度配置权威留在 schedule 表，禁止复制 cron/时区字段入 trigger.config；occurrence/fire_key 机制原样。新文本见附录 CF-33 | 否 |

### 2.C AgentScope 版本基线与官方契约

| 冲突 ID | 文档与段落 | 当前表述 | 新证据 | 问题类型 | 建议动作 | 是否需用户拍板 |
|---|---|---|---|---|---|---|
| CF-11 | doc11 头部（“AgentScope 基线：2.0.8-dev@ff8697ec……PyPI 尚无 2.0.8 发布物”）、§3.1（“官方当前提供：PipelineProtocol……GoalPipeline……AgentState……AgentScope App”）；HANDOFF §1 表“AgentScope 基线”行、§4 | 2.0.8-dev 表述本身准确；但全文未记录实装基线＝2.0.7 正式版（registry wheel），§3.1“官方当前提供”清单不区分 2.0.7 已发布项与仅 [DEV] 项 | A1 03 §1.1（唯一安装＝2.0.7 dist-info，P1/P4）、§1.2（P5 无 direct_url.json＋INSTALLER=uv＝registry 安装；P6 pyproject `agentscope==2.0.7`；P7 uv.lock registry）、§1.3（U2：PyPI 2.0.8→404，最新 2.0.7.post1；U4 releases/latest）、§1.4（U3 无 v2.0.8 tag；U6 main＝ff8697ec）、§1.5（旧说法未过期＋易混点 I1）、P10/P11（2.0.7 零 pipeline 代码/零 Pipeline 类） | MISSING_CONTRACT | doc11 头部与 HANDOFF §1 改双轨基线契约（实装 2.0.7 lock＋spike 基线 2.0.8-dev@ff8697ec＋升级门）；§3.1 清单逐项加版本归属标注（[2.0.7] / [仅 DEV]）。明示“2.0.8-dev/PyPI 未发布”表述经 03 复核**未过期、保留**。新文本见附录 CF-11 | 否 |
| CF-12 | doc11 §5 方案 B 第 5 点 | “state_updated 等 AgentScope 事件映射为平台 RunEvent” | A1 03 项9（[L2.0.7] event/_event.py L26-67：EventType **28 值**、L552-581 AgentEvent **28 成员**；**无独立 state_updated 事件类型**，状态变更（tasks/permission）经官方点名 CustomEvent(name='state_updated') 承载（L531-537 docstring）；[DEV] 同构）；项5（状态持久化经 SessionRecord.state，非事件） | FACT_ERROR | 改为“AgentScope 事件 union（EventType 28 值/AgentEvent 28 成员，含 TOOL_CALL_*、THINKING_BLOCK_*、CUSTOM）按 §6.3 前缀表经 mapping_version 冻结映射为 RunEvent；state_updated 非独立事件类型而是官方 CustomEvent known name，须纳入 mapping_version 冻结映射”。“旧表述废止”式过度修正不采纳（2026-09-08 复核 F-1/F-2 修正）。新文本见附录 CF-12 | 否 |
| CF-13 | doc11 §3.2（“不能错误推导”四条）；HANDOFF §4（已验证结论 1–7） | GoalPipeline 风险清单缺两项源码事实：dead params 与无上限重提示循环 | A1 03 项2（[DEV] _goal_pipeline.py：max_retries/verifier_reset_context 仅 L63/65/74/79/85/87 赋值后从未读取；L177/L248/L274-292 结构化输出重提示循环无次数上限） | MISSING_CONTRACT | doc11 §3.2 增两条“不能错误推导”：dead params 不得作为 retry 治理依据；重提示循环无上限，平台侧必须自设上限/超时（P1 spike 验收项）。新文本见附录 CF-13 | 否 |
| CF-14 | doc11 §3.1（App 层组件清单）、§3.3 第 5 点（“不直接挂载完整 create_app……可以复用其实现思想和必要组件”）；doc12 §2.1 无对应行 | “必要组件”无逐项取舍清单；App 层清单未列 IM 渠道网关与调度器单点约束 | A1 03 §4.3（官方 app 层与我方 server 职责重叠：FastAPI 路由/SQL+Redis 存储/分布式 session 锁/ChatService/cron/IM 渠道网关 Feishu/Discord/DingTalk/知识索引 worker/权限预算 middleware）、§4.4（[DEV] app/_app.py L203-210：enable_scheduler APScheduler 内存 jobstore 多副本单点约束）、项5/项7；C1 02 §4 #6（我方无 IM gateway，RunEvent.channel 与 IM 无关）；D1 05 §9 OD-15 | MISSING_CONTRACT | doc11 §3.3 增第 7 点：官方 App 层逐项取舍表（storage/message bus/ChatService/scheduler/channel 网关/knowledge index worker/permission middleware），一期默认全关、Provider 仅用库层，任何启用需单独契约审计；渠道网关（飞书等）显式列为关闭项（IM＝REJECT 既有拍板）。新文本见附录 CF-14 | 是（OD-15） |
| CF-15 | doc11 §11.2 U05（“2.0.8 正式版之前是否允许生产｜不允许，只做沙箱 spike”）；HANDOFF §6 U05 行、§4 末段 | U05 闸门对象含糊：未区分“2.0.8-dev 能力不得生产”与“以已发布 2.0.7 为底座的平台生产化”两种读法 | A1 03 §4.1（版本双轨：可安装可 pin 的是 2.0.7；U05 裁定与今日事实自洽——指 2.0.8 能力）；D1 05 §9 OD-16（AgentFlow 生产化以平台自建 Runner 为准、2.0.7 即可，不依赖未发布 pipeline 模块；官方对象仅 spike 至正式 tag） | MISSING_CONTRACT | U05 改写为范围明确的双句闸门（2.0.8-dev 代码及其 pipeline/A2A 能力禁生产；2.0.7 正式版底座的生产接线不受本闸门限制，但受 P0-E 环境闸门约束——CF-20）；与 OD-16 一并请用户确认。新文本见附录 CF-15 | 是（OD-16/U05） |

### 2.D 现状事实与 P0 现实（02 已证）

| 冲突 ID | 文档与段落 | 当前表述 | 新证据 | 问题类型 | 建议动作 | 是否需用户拍板 |
|---|---|---|---|---|---|---|
| CF-16 | doc11 §1.2 表 Module 行（“主链存在，但只带核心 AgentSpec”）；doc12 §2.1 AgentScope adapter 行（“可执行 Module；capability 和配置契约存在错配”） | 现状表止步“代码级存在/可执行”，未记录运行环境级断链，读者会得出“发布即可运行”结论 | C1 02 §0.2（8301/8302/8303 curl /health 全部不可达）、§0.3（release 8 行无一绑 AgentScope；3 条 active 绑 openai-agents——源码从未入 git；2 条 active 绑 DSH——已归档退役；AgentScope Provider health=error；2 个 dsh-* module_key 不在 Registry）、§1 Q5、§5 链1 判定（“代码级通，运行环境级断……当前 DB 中没有任何一条‘发布→可运行’的活链路”） | FACT_ERROR | 两处现状列加限定：“代码级主链闭合；运行环境级当前断（Provider 全不可达、active Release 全绑退役 Provider、AgentScope 零绑定）——活链路修复为 P0-E 前置（CF-20）”。新文本见附录 CF-16 | 否 |
| CF-17 | doc12 §2.1 表 Connection/egress/MCP Gateway 行 | “已有凭据、出站策略和工具闸门能力｜外部动作复用，不建立第二套凭据或 SSRF 策略” | C1 02 §2.2 断点⑦（adapter 仅把工具名传 MCPClient enable_tools，连固定 QUALITY_TOOL_MCP_URL 默认 127.0.0.1:8200/mcp/，adapter.py:211-214,261-273；Tool Service README 自述 "returns fixture facts only"，services/tool_service/README.md:3-5）、§2.5 断点⑦（平台 MCP registry 与 AgentScope 运行时互不相通）、§2.6 断点⑦（凭据进平台进程不进 Provider 容器，adapter.py:153-160 用容器 env）、§6.3 fixture 台账 | FACT_ERROR | 该行拆两轨表述：workflow/autonomous 轨道 egress＋Connection 鉴权真实存在（runner.py:494-542,517-534）；AgentScope 轨道当前不经 Gateway——工具执行体为 8200 fixture 服务、MCP 两个世界、凭据不跨界；“复用”结论仅在 Contract v1.2＋真实执行体接线（G0/P0-E）后成立。新文本见附录 CF-17 | 否 |
| CF-18 | HANDOFF §3 复核事实表 A01–A17 | 清单覆盖配置源/断链/capability 等，但缺 02 已证的环境级与执行体级 P0 事实 | C1 02 §0.2/§0.3（Provider 全不可达；active Release 全绑退役 Provider；dsh-* 孤儿 module_key；15 running/8 queued 僵尸 TaskRun＋job_queue 83 dead，无 TaskRun 级回收——recover_stale_jobs 只回收 job 租约 runner.py:1579-1596）、§2.2/§2.5/§2.6 断点⑦（8200 fixture 执行体/MCP 两个世界/凭据不跨界）、§3 Q6（api 触发零端点） | MISSING_CONTRACT | §3 增补 A18–A22（死链与退役 Provider 绑定、dsh 孤儿、僵尸 TaskRun 与回收缺失、fixture 工具执行体与 MCP 断界、api 触发零接线），复核入口指向 02 对应章节；§8 闸门 8 的“Runtime 未消费”判定口径扩到执行体（fixture≠消费）。新文本见附录 CF-18 | 否 |
| CF-19 | HANDOFF §1 表（“Git HEAD 894245d”“dirty path 数 52”）、§6 P0 行（“52 个 dirty path 的归属与提交拆分”）；doc11 §0（“P0 只做未提交工作区归属……”） | 工作区基线记录停留在 894245d/52 dirty paths | C1 02 §0.1（HEAD＝f6824f94 “chore: checkpoint pre-research platform baseline” 2026-09-08 15:42；git status --porcelain 仅 ?? .zcode/ 与 ?? exports/；g048 迁移等并行会话改动已被收入 HEAD）、§7（checkpoint 收口来历：配套测试本轮禁跑、通过性仅提交信息自述、未经独立发布验收） | STALE_VERSION | HANDOFF §1 更新 HEAD 与 dirty 计数；§6 P0 行与 doc11 §0 重定义为“f6824f9/894245d checkpoint 收口内容的独立验收与基线封存（逐路径归属确认＋配套测试复跑授权）”，不再是“未提交文件归属”。新文本见附录 CF-19 | 否 |
| CF-20 | doc11 §10 分期表 P0 行；HANDOFF §7 P0 节；doc12 §8 T0 行 | P0 范围＝文件归属/文档封版/commit-lock/POC 标记；分期计划无“运行环境活链路修复”前置闸门 | C1 02 §0.2/§0.3/链1 判定（无活链路则任何发布/运行结论纸面化）、§1 Q7（adapter cancel no-op，adapter.py:389-390；capabilities 静态声明与实现不符）、§3 Q6（api 无端点）、链3 薄弱点（workflow-exec 子调用不 pin 版本 runner.py:640）、链4 判定（僵尸态无回收）；D1 05 §0.3/§3.3（P0 前置修复清单 7 项，“不修则三案皆空转”） | MISSING_CONTRACT | doc11 §10/HANDOFF §7 增 P0-E 环境活链路闸门（7 项：Provider 可达＋健康真实、active Release 重绑/退役 Provider 清理、cancel 真实现、api 触发端点、workflow-exec pin、Skill 单事实源、僵尸回收 job），出口闸门＝“存在至少一条 发布→可运行→结果事务 的活链路”；T0/G0 显式依赖 P0-E。新文本见附录 CF-20 | 否 |
| CF-40 | doc11 §1.1（“Skill 同时存在 config.skills 和 AgentSkill 两条写路径”）；HANDOFF A02/A03/A08；doc05 §1.1 缺口 3/5 | 双路径表述缺第三义：custom 前端写 Skill **ID**、遗留运行时按**名字**消费（ID/名字/一等关系三义并存）；Custom 断链缺“前后端三种可写口径”与发布断点细节 | C1 02 §1 Q4-1（custom-config.tsx:88-98 写 s.id；agent_runtime.py:238-243,265 按名字消费；mounts-health 双轨分别校验 agents.py:328-337）、§1 Q2（build_definition else 分支 ValueError→409 NO_WORKFLOW，agent_release.py:49-51＋agents.py:366-370；run 置 failed“该 Agent 未绑定工作流”agent_runtime.py:704-709；UI 壳只读 wf-agent-editor.tsx:87/AgentWorkspaceShell.tsx:52-56 vs Config 页可写 vs 后端 API 可写 vs agent-chat.tsx:48 只查 archived）、§2.1 遗留轨 | MISSING_CONTRACT | A02 补语义错位三义（迁移映射必须含 ID→名字→一等关系对照表，M0 盘点项）；A03/A08 补三种可写口径与 409 NO_WORKFLOW 断点（doc05 §6.1 的 API 处置表已覆盖修复方向，无需改）；doc11 §1.1 该句加“且 ID/名字语义错位”。新文本见附录 CF-40 | 否 |

### 2.E Session/Run/子调用语义

| 冲突 ID | 文档与段落 | 当前表述 | 新证据 | 问题类型 | 建议动作 | 是否需用户拍板 |
|---|---|---|---|---|---|---|
| CF-21 | doc05 §5 表（“无状态单次输入输出只创建 Run”）、§5.1（“子 Run……不自动创建 Chat Session”）；doc11 §2.5（“无状态单次任务只有 Run，不创建 Session”）、§2.7、D13/D14；doc12 §0/§3.1/§5 表；HANDOFF §5 要点、§8 闸门 4 | “无状态任务/子调用不创建 Session”为已确定拍板（D14 属 HANDOFF §5 不得回退清单） | D1 05 §5.5（Session 四分类含 SINGLE_RUN/FLOW_EPHEMERAL 非用户可见状态载体）、§7.4 E1（时序 4 显式创建 SINGLE_RUN#S30）、§7.1 E6（每 role run 创建 FLOW_EPHEMERAL）、§7.0 M1（Provider 无状态，AgentState blob 须有载体）；A1 03 项5（官方跨进程持久化保证＝SessionRecord.state，[L2.0.7] storage/_model/_session.py L221）、项4（pipeline 级无持久化）；C1 02 §3 Q6（Run(trigger=chat) 现状存在，models.py:250 注释未含 chat） | MODEL_CONFLICT | 提案与既有拍板字面冲突，不得静默二选一：提请新编号 **OD-19**——D13/D14/闸门 4 的“Session”界定为“用户可见 Chat Session”，非投影状态载体 Session 豁免（05 案）；或否决豁免、AgentState blob 改由 Run.audit_state 承载（字面维持 D14）。拍板后同轮修订 doc05 §5/doc11 §2.5/doc12 §5/HANDOFF 闸门 4 措辞。新文本见附录 CF-21 | 是（建议新编号 OD-19；连带 OD-10/OD-15） |
| CF-22 | doc11 §6.2（根 Run 状态 5+2）；doc08 §7.2（看板状态 8 项含 waiting input/confirmation/external result）；doc03 §2（TaskRun.trigger 词表不改、填 api 值） | Run 状态与 trigger 两级词表在三档各有一份、互不引用，无单一权威定义；扩展值（manual_debug/automation/flow/flow_stage/agent_tool/continuation）无落点 | C1 02 §3 Q6（Run 层 trigger 实际值域 chat/batch/test/eval/agent/manual/schedule 已宽于 models.py:250 注释——注释漂移实证；TaskRun 层仅 manual/schedule/backfill）；D1 05 §5.4（Run.trigger 扩展枚举＋“trigger 枚举与注释同步治理”教训条目） | MISSING_CONTRACT | 在 doc11 §6.2 增设两级词表权威表（TaskRun.trigger＝doc03 口径四值；Run.trigger＝现状七值＋扩展七值，标注各值引入阶段），doc08 §7.2/doc03 §2 改为引用；模型注释与校验枚举同步列入 G0 验收。新文本见附录 CF-22 | 否 |
| CF-23 | doc05 §5.1（ChildInvocation 字段清单）；doc11 §2.7（InvocationGraph 投影） | 新建 ChildInvocation/InvocationGraph，未声明与既有 CallRecord、call_chain/agent_chain 内存判重的分工或归并 | C1 02 链3（CallRecord＝Run 内调用明细事实，PII 脱敏 runner.py:1101-1110，models.py:334-351）、§3 Q3（递归检测＝call_chain 判重 runner.py:1121-1127＋agent: 前缀链 agent_runtime.py:534-535,576-577；wf 链深度≤5 runner.py:1128-1133；agent 链无独立上限、混合深度无统一上限——I1 缺口）、§1 Q4（双事实源教训）；D1 05 §5.4（ChildInvocation＝内存判重泛化为持久边） | DUPLICATE_CAPABILITY | doc05 §5.1 补分工声明：ChildInvocation＝跨边界谱系边（唯一环检测/深度/预算记账源）；CallRecord＝Run 内调用明细（保持现状）；call_chain/agent_chain/wf_chain 内存判重退役并迁 InvocationGraph 单树；杜绝子调用事实双源。新文本见附录 CF-23 | 否 |

### 2.F 安全边界

| 冲突 ID | 文档与段落 | 当前表述 | 新证据 | 问题类型 | 建议动作 | 是否需用户拍板 |
|---|---|---|---|---|---|---|
| CF-24 | doc08 §8（“消息块支持 text、thinking、data、tool call/result、hint”）、§12 Chat 验收（“tool/thinking/task events 可见”）；HANDOFF §8（无对应闸门） | thinking 被设计为 Chat 消息块类型且列入“可见”验收 | O1 01 跨域事实 1（tb-01-task-detail.png/flow-07.png：原站“深度思考”全文外露＝高危表象，01 裁定我方禁抄）；任务书 §8 强制安全纠错第 1 条（应展示可审计进度/工具事件/决策摘要/结构化依据）；07 v1 头部（“CoT 不外露”＝已关闭既有拍板）；D1 05 GR-1（THINKING→CONTROL，CONTENT 投影白名单，run:audit 权限点）；A1 03 项9（THINKING_BLOCK_* 属官方 union，映射必然发生，须在投影层分级） | SECURITY_GAP | §8 消息块清单删 thinking（改“thinking 事件入 CONTROL 通道，默认不渲染，仅审计视图可见”）；§12 验收改负向断言（“CONTENT 投影无 THINKING 文案泄漏”＋审计权限点测试）；HANDOFF §8 增补对应硬闸门。既有拍板落实，无需再拍板。新文本见附录 CF-24 | 否 |
| CF-25 | doc11 §6.3（事件前缀表含 reply.started/text.delta/**thinking.delta**；“每个事件必须有 sequence、channel……”） | 有 channel 字段要求，但无事件→channel 的冻结映射：thinking.delta 归 CONTENT 还是 CONTROL 未定，映射表无版本化 | A1 03 项9（EventType 28 值/[L2.0.7] L26-67）、项12（官方无 schema 稳定性承诺：Beta＋46 commits/174 文件漂移，映射必须冻结版本）；C1 02 链3（RunEvent CONTROL｜CONTENT 双通道现成，models.py:301-319）；D1 05 §5.4 RunEvent mapping_version、GR-1 落点；O1 01 跨域事实 1（红线动因） | MISSING_CONTRACT | §6.3 增“事件映射契约”段：AgentEvent→RunEvent 映射表随 Release 冻结 mapping_version；THINKING_BLOCK_*→CONTROL；TEXT/TOOL/进度→CONTENT；REQUIRE_USER_CONFIRM/EXTERNAL→控制态迁移＋CONTENT 卡片；MODEL_CALL_END.usage→预算账本；映射表变更走 ADR。新文本见附录 CF-25 | 否 |
| CF-26 | 六档全局（06a 全局检索：“Bash”“Hook”“allowlist”“工作空间隔离”0 次出现）；落点：doc11 §2.6/§3.3、doc08 §6/§8（仅“工具调用经平台 Gateway”一句）、HANDOFF §8 | 六档无高危内置工具（Bash/Write/Edit）治理契约、无 Hook 门槛条款；而 AgentScope 装配面默认含 workspace 内置工具 | A1 03 项7（[L2.0.7] app/_service/_toolkit.py get_toolkit L38-77：装配顺序第 1 类即“Workspace builtins (Bash / Read / Write / Grep / …)”；WorkspaceBase/LocalWorkspace）、项11（官方 pipeline 示例以 PermissionMode.BYPASS 绕过权限，examples/pipeline/goal L38-42）；O1 01 跨域事实 2/QW-04（tb-01：Bash mkdir/npm install、Write×7 直接执行，仅 prompt 自约束）；C1 02 §4 #2（我方无治理 Bash/Write 工具）、#3（code-write＝宿主机子进程非真沙箱、生产永久禁用 runner.py:816-864）、#4（Hook 引擎零实现）；任务书 §8 纠错第 2/3 条；D1 05 GR-2/GR-3 | SECURITY_GAP | HANDOFF §8 增硬闸门 12（高危工具默认关闭四条件：WorkspaceBinding＋PolicySnapshot allowlist＋配额/超时＋写范围=会话工作区+_output/；越界→HITL 审批；任意 shell Hook 永不放行）；doc08 §6 阻断规则与 doc11 §2.6 platform policy 段同步引用；Hook 一期不建用户配置面（04 行 15 DEFER，GR-3 前置清单写入）。执行位置细节随 OD-13，规则本身为任务书强制。新文本见附录 CF-26 | 否（细则关联 OD-13） |
| CF-27 | doc05 §3 表 Knowledge 行（“KnowledgeSnapshot，包括文档集合与索引 revision”）；doc11 §7 冻结清单第 7 项（“KnowledgeSnapshot/index revision”）；HANDOFF §6 U02 默认建议（“冻结文档集合和索引 revision；缺任一阻断发布”） | 把“索引 revision”写成可冻结对象 | C1 02 §2.3（Knowledge＝外部检索端点引用＋高级参数 topK/scoreThreshold/mode；**平台侧无索引、无 revision**；knowledge_source 仅 1 行 disabled/slice_count=0）、§1 Q3 I1（现冻结粒度＝状态不冻内容）；A1 03 项7（官方 RAG 服务层存在 index worker/chunker pin——属另一执行体分支）；D1 04 行 9/05 OD-12（执行体分叉待拍板） | FACT_ERROR | 三处改“引用＋状态＋检索参数”为现状最小冻结集；“文档集合/索引 revision”标注为仅当 OD-12 拍板采用官方 RAG 服务层后生效的目标态；U02 默认建议随 OD-12 重写（现默认在 C1 现状下不可执行）。新文本见附录 CF-27 | 是（OD-12；U02 联动） |

### 2.G 工作空间 / 资源 / 记忆 / 可观测

| 冲突 ID | 文档与段落 | 当前表述 | 新证据 | 问题类型 | 建议动作 | 是否需用户拍板 |
|---|---|---|---|---|---|---|
| CF-28 | 六档全局（06a 全局检索：无任何一稿定义文件系统/Project 型工作空间）；落点：doc05 §2.1/§2.4（无 Workspace 挂载对象）、doc08 §4（“工作区”＝管理 UI）、doc11 §3.1（Workspace 仅官方组件名）、doc12（无产物契约） | 文件系统义工作空间、Project/WorkspaceBinding、会话工作区路径约定、_output/ 产物交付契约全部缺位 | O1 01 跨域事实 3/QW-04（tb-01：workers/<wakerShortId>/workspace/<sidShort>_<MMDD>/＋会话 _output/＋present_files 契约：目录不可作产物、7 文件 copied）、QW-06（auto-01：工作空间三态 tab 默认｜本地目录｜项目）、QW-16（g1-09：公开项目＝本地目录或 Git 仓库、两级作用域）；C1 02 §4 #1（models.py 全文 1128 行无 Project/Workspace/WorkspaceBinding；AgentWorkspaceShell 仅页面 IA 壳）；D1 05 §5.6 WorkspaceBinding、04 行 11 ADAPT、OD-13 | MISSING_CONTRACT | doc05 §2.4/§3 增 Workspace 为一等挂载对象与版本规则行（WorkspaceBinding 三态＋作用域＋配额/allowlist 引用＋执行位置随 OD-13）；doc08 §4 增“工作空间”栏目（与“工作区壳”更名区分，见 CF-29）；doc12 §7 增产物交付契约（_output 型，Run 产物引用可查收）；Release 冻结清单增 WorkspaceBinding 引用。新文本见附录 CF-28 | 是（OD-13） |
| CF-29 | doc08 全档/doc11 §1.3、§8（“工作区”＝Agent 管理 UI）；HANDOFF §1（“工作区”＝git 工作区）；doc11 §3.1（Workspace＝AgentScope App 组件名） | 同一词“工作区/workspace”在三处语义不同，且文件系统义缺位后该词将被第四义占用 | 06a 全局检索第 4 条（三义记录）；A1 03 项7（官方 Workspace 组件语义）；C1 02 §4 #1（IA 壳注释自证）；O1 QW-06（原站“工作空间”＝文件系统义） | TERMINOLOGY_COLLISION | 六档各首次出现处加术语注记并统一：管理 UI 壳→“Agent 管理页/工作区壳”；git 义→“git 工作区”；官方组件→“AgentScope Workspace 组件”；文件系统义专属“WorkspaceBinding/工作空间”。新文本见附录 CF-29 | 否 |
| CF-30 | doc05 §2.1 conversation 区（仅“memory policy”一词）、§4.1 冻结清单（无记忆策略项）；doc08 §4 记忆栏目（“长期记忆；不混 AgentState/PipelineState”） | 记忆无 MemoryPolicy 冻结契约、无运行级→持久记忆写回/晋升链路、无学习时间线投影口径 | O1 01 QW-09（waker-01-manage-page.png：记忆与学习时间线“记忆新增/学到新技能 design-system”）；C1 02 §2.7（三轨消费不一致：chat 注入正文 agent_chat.py:37-39／autonomous run 级内存字典 agent_runtime.py:201-208／workflow MemoryRecord 持久表 runner.py:710-768；Module 不消费＝断点⑥；记忆本体不进 Release 快照）；A1 03 §3.1/§3.2（官方无跨 session 产品级长期记忆保证）；D1 05 §5.6 MemoryPolicy、04 行 10、OD-14 | MISSING_CONTRACT | doc05 §2.1/§4.1 增 MemoryPolicy（只读注入或经审批写回；晋升须 revision＋审批；入 Release 冻结）；三轨消费收敛为 Release 驱动单注入点（M3 验收补条目）；时间线由 RunEvent 投影、不建第二事实源；写回节奏随 OD-14。新文本见附录 CF-30 | 是（OD-14） |
| CF-31 | doc05 §2.4（MountBinding 仅正向挂载）；doc08 §6（能力页行字段无反向引用/共享作用域） | 缺共享资源治理面：知识库“N 个 Agent 使用”反向引用计数与“设置可使用 Agent”入口、项目/工作空间两级作用域（账号共享/Agent 私有）、被引用资源删除/禁用约束 | O1 01 QW-16（g1-08-resources-knowledge.png：“设置可使用该知识库的 Waker”＋“1 个 Waker 使用”＋分享；g1-09：两级作用域文案）；D1 04 行 9/11（ADAPT：共享知识库＋挂载绑定＋可设置使用范围）；C1 02 §2.9（资源页保存≠生效教训——反向引用须来自 MountBinding 单源反查） | MISSING_CONTRACT | doc08 §6 增共享资源治理区规格（反向引用计数由 MountBinding 反查、授权变更入 AuditLog、删除/禁用被引用资源的可见阻断）；doc05 §2.4 补 scope 之外的 ownership/sharing 字段位（作用域模型随 OD-03 同轮定稿）。新文本见附录 CF-31 | 否（D1 建议，随 R5；作用域关联 OD-03） |
| CF-32 | doc05 §5 Run 表（“Run｜一次执行事实；Chat 每 turn 也是 Run”）；doc11 §2.5 | Run 事实无 worker/执行位置标识字段；“哪台机器跑的”不可归因 | O1 01 QW-08（g1-04-management.png：本机徽标＋主机名 RiversdeMacBook-Pro＋在线徽标——原站把执行位置做成可见事实）；C1 02 §1 Q1（Run 列 models.py:239-279 无 worker 字段；runtime_provider_run_id 仅 Provider 侧 id）、§4 #1（无实例实体）；D1 07 OD-06（默认 C：Run 记 worker 标识，不建实例实体）、05 §5.4 Run 扩展 | MISSING_CONTRACT | doc05 §5 Run 行补 worker 标识（host/process/instance tag）与投影口径（运行中心“执行者”列）；维持 doc08 §14“不用在线状态模拟非驻留 Agent”边界；是否引入更重实例维度随 OD-06。新文本见附录 CF-32 | 是（OD-06） |

### 2.H 看板投影

| 冲突 ID | 文档与段落 | 当前表述 | 新证据 | 问题类型 | 建议动作 | 是否需用户拍板 |
|---|---|---|---|---|---|---|
| CF-34 | doc08 §2 表任务看板行（“GET /api/agents/{id}/runs｜平面 Run/Event，无 stage/unit”）、§7（层级设计限于 Agent 工作区内） | 看板契约停留在单 Agent 平面 Run 列表；无平台级多源统一投影、无行粒度裁定、无“需要操作/查收结果”动作队列 | O2 01 QW-02（tb-01：看板行＝run/session 级，对话 session、flow run、automation run 三类执行事实混排，行点击＝会话路由；与 flow-02 三次 run、auto-03 回链互证）、O1 QW-01（g1-01：“需要操作/查收结果”＝用户动作队列页签非过滤器）、QW-07（auto-03：运行历史“查看任务”回链看板）；C1 02 §3 Q7（WorkItemProjection 只投影 TaskRun＋occurrence；chat Run、一次性 workflow Run 不进看板 work_items.py:51-90）、§3 Q5（投影只读无双写、矛盾→needs_action）；D1 04 行 3 ADAPT、05 §4.3 看板投影多源化、07 OD-07 | MISSING_CONTRACT | doc08 §7 增“平台任务看板投影契约”节：多源（chat session/AgentFlow run/automation run/TaskRun 批次）统一投影、行粒度＝run/session 级、来源/执行者列、动作队列由 Run 控制态＋投递终态派生（GR-6 双终态列）；Agent 工作区“工作”页＝同一投影组件的 Agent 过滤视图；行粒度语义随 OD-07 拍板。新文本见附录 CF-34 | 是（OD-07） |

### 2.I 决策纪律与术语

| 冲突 ID | 文档与段落 | 当前表述 | 新证据 | 问题类型 | 建议动作 | 是否需用户拍板 |
|---|---|---|---|---|---|---|
| CF-35 | doc11 §11.2（U01/U02/U04/U05/U06，无 U03）；HANDOFF §6（同跳空） | U03 编号跳空，两处一致且文内无解释 | 06a T10 专节（完整性核对：U03 缺失、文内无解释）；任务书 R4（“旧 D01–D22 不被静默覆盖”；未决项增删须有 supersede 记录） | UNDECIDED_AS_DECIDED | 主审计者核对 11 号稿 v5.0 底稿确认 U03 去向（曾拍板则补拍板记录与 supersede 对象；曾合并则注明并入哪条；纯跳空则补编号说明）；此后未决项编号只增不复用。新文本见附录 CF-35 | 否（文档纪律修复；去向核查属主审计者） |
| CF-36 | doc11 §0（“开工状态：冻结。原 v4.1 的‘15 点全部拍板、方案冻结’已经失效”）与 §11.1（D01–D22 已确定）并存；HANDOFF §0/§2 | v5.1 已自我声明 v4.x 拍板失效，但六档体系内外仍有“按 11 号稿拍板执行”的引用惯性；D01–D22 未经本轮证据逐条处置即被视为有效 | 06a doc11 定位节（实为 v5.1、自述冻结失效、22 条决策点）；C1/A1/O 本轮新证据（02/03/01）对多条 D 决策构成修订动因（§3 处置表）；任务书 R4（新决定有明确 supersede 对象） | STALE_VERSION | 在 doc11 §0 与 HANDOFF §2 增“对外引用口径”注记：现行权威＝v5.1 冻结态，v4.x“15 点拍板”不得再被引用为开工依据；D01–D22 的效力以本矩阵 §3 处置表为准（保留 13/修订 9/废止 0），修订项在对应 OD 拍板后落档。新文本见附录 CF-36 | 否 |
| CF-37 | HANDOFF §2（权威文档 1–6 列表；“SDD-12/13/14、旧 00–10、历轮 research 与 qoderwake 调研仅作背景证据。它们与上述文档冲突时，不能倒过来覆盖本轮已纠正的结论”） | 权威清单不含本轮调研产物（00–07）；“qoderwake 调研仅作背景证据”条款若适用于本轮 O1/O2/C1/A1 已证事实，将阻断按任务书 §9 修订设计稿 | 任务书 §9/§12 R4（本轮冲突审计的目的即以新证据修订设计稿）；02 §0.1（HEAD 已移动，HANDOFF 自身基线被本轮 C1 修正——CF-19）；03 §1.5（本轮 A1 复核支持既有版本结论）；00/01（O 级证据为本轮新增） | STALE_VERSION | §2 清单增第 7 项：research/morethancorn/10-qoderwake-product-research/00–07（本轮 O/C/A 证据与 D1 提案），并注明：R5 验收后设计稿按其 06 矩阵修订；“仅作背景证据”条款继续适用于**历轮** research，不适用于本轮经闸门复核的 O/C/A 级事实（D1 提案仍须拍板）。新文本见附录 CF-37 | 否 |
| CF-38 | doc05 §10（“不把 AgentScope 内部 Task 合并为平台 Task”）；doc11 §5 末段、§0.1 故事 B；doc08 §5.3；doc12（“自动任务”散见） | 三义分离原则已在，但“Task/任务”一词在六档仍四义混用（平台任务/看板行、自动任务、TaskRun 批次、AgentScope 内部计划项），无统一术语表与 UI 展示名裁定 | 任务书 §1.3（必须独立判断并统一命名）；O1 01 QW-04（tb-01：TaskCreate/TaskUpdate＝运行内计划项 taskId "1"——三义在原站全部实证）、QW-02（看板行＝run/session）、QW-06/07（自动任务＝定义）；A1 03 项6（Task＝tasks_context 内部计划项；state 枚举无 failed/cancelled；blocks/blocked_by 全库无消费者）；D1 04 §2 落位表（展示名建议“执行计划”）、行 14 ADOPT | TERMINOLOGY_COLLISION | 在 HANDOFF §2 或 doc05 附录增设术语权威表：平台任务＝看板投影行（WorkItem）；自动任务＝AutomationDefinition；批次＝Task/TaskRun；内部计划项＝AgentScope Task 工具（UI 展示名“执行计划”）；四义禁合表、禁互相推导；blocks/blocked_by 不得当调度契约。新文本见附录 CF-38 | 否 |
| CF-39 | doc11 §6.3（“每个事件必须有 sequence、channel……”——channel＝事件分级）；doc11 §3.1（App 层清单未列 channels）；六档无 IM 表述 | RunEvent.channel（CONTROL｜CONTENT）与 AgentScope app 层 channels（IM 渠道网关）同名异义，未登记防撞 | D1 04 行 17（明示“术语碰撞（channel 双义）需在 06 冲突审计中登记”）；C1 02 §4 #6（RunEvent.channel＝CONTROL｜CONTENT 事件双通道标记，models.py:311-312，与 IM 无关）；A1 03 §4.3/项5（官方 channels/channel_clients＝Feishu/Discord/DingTalk IM 网关；2.0.8-dev NEWS 增 DingTalk channel） | TERMINOLOGY_COLLISION | doc11 §6.3 加术语注记：RunEvent.channel＝事件分级通道，与 IM 无关；官方 IM channel 面属 OD-15 取舍表且默认关闭（IM＝REJECT 既有拍板）；两词禁止混用，任何 IM 面讨论不得借用事件通道词。新文本见附录 CF-39 | 否 |

---

## §3 D01–D22 处置表（单独一节；禁静默覆盖）

> 处置值：**保留**＝新证据不推翻，原文继续有效（附注记）；**修订**＝决策核心存活，但载体/范围/措辞须随拍板或新证据改写（给出 supersede 方向）；**废止**＝决策整体不再成立。本轮**无废止项**：02/03/01 的新证据推翻的是文档中的**现状事实表述**（CF-09/16/17/27/40）与**未决被拍板**（CF-02/05），没有任何一条 D 决策的治理原则被证伪。所有“修订”均须在对应 OD 拍板或 R5 验收后落档，落档时在 11 §11.1 原行保留＋新增“处置（06 矩阵 CF-xx）”列，不得删行改写。

### 3.1 D01–D22 逐条处置

| 编号 | 决策要旨（11 §11.1 原文摘句） | 处置 | 依据（证据/关联冲突） | 联动拍板 |
|---|---|---|---|---|
| D01 | AgentScope 是唯一 Agent Runtime | **保留** | A1 03 §4.1（版本双轨不动摇“唯一底层”拍板）；C1 02 §0.2（runtimes/README sole runtime）。附注记：生效前置＝P0-E 环境活链路（CF-16/CF-20）；官方 app 服务层取舍不改本条（CF-14） | OD-15 关联 |
| D02 | 2.0.8 正式发布前以精确 Git commit 做隔离 spike，不假装已发布 | **保留** | A1 03 §1.3/§1.5（PyPI 404、无 tag、main＝ff8697ec——表述经复核未过期）；现行 pin=2.0.7 不违反本条 | OD-16（CF-15：与 U05 范围澄清一并确认“自建 Runner 以 2.0.7 生产接线”） |
| D03 | 方案 A 是声明式 Core 的 QualityPipeline；不直接使用 GoalPipeline，也不把业务阶段写死在控制器 | **修订** | “不直接套 GoalPipeline/不写死业务阶段”保留（A1 03 项2/§3.2 支持：官方零治理，平台自建）；**载体修订**：若 OD-09=B，质检类多 role 编排迁 AgentFlow 内置方案（FlowVersion 声明 stages/roles），PipelineDefinition 仅保留给单体 Agent 内部执行拓扑或整体 supersede（CF-01/CF-06） | OD-09 |
| D04 | 方案 B 是 AgentScope Planning Agent | **保留** | A1 03 项6（Task 工具＋tasks_context 官方提供，直接复用不自建）；O1 QW-04 工具级实证；04 行 14 ADOPT。附注记：UI 展示名“执行计划”（CF-38） | — |
| D05 | Pipeline 与 Planning 正交可组合 | **保留** | A1 03 项6/项2 不推翻；若案 B，正交性表述延伸至 AgentFlow stage 的 role 级（措辞微调随 CF-01 落档） | OD-09 关联 |
| D06 | 内部角色默认内嵌 AgentVersion，不全部升级为顶层 Agent | **修订** | 原则保留；**内嵌点扩展**：AgentVersion 内 RoleVersion 或 AgentFlowVersion 内联 RoleTemplate 双落点（D1 05 §5.2，形态参照 A1 03 项3 SubAgentTemplate 纯数据模板；G5 条款“role 不强制注册顶层 Agent”的落点）（CF-06） | OD-17 |
| D07 | 控制器、barrier、retry、checkpoint、schema、permission 不是 Agent | **保留** | 与 D1 05 GR-5/治理不变量清单一致；A1 03 §3.2（治理为平台补齐项）支持 | — |
| D08 | unit verifier 与 final verifier 独立于 executor | **保留** | A1 03 项2（GoalPipeline executor≠verifier 形状参照）；D1 05 §4.1 goal_loop stage 维持独立核验语义 | — |
| D09 | 失败子项选择性重做是方案 A 必备验收项 | **修订** | unit 级**自动**重做（策略触发）保留；**修订**：若 OD-09=B，重做锚点移至 FlowRun 的 ExecutionState/Continuation，用户级重做级别随 OD-01（默认 B＝失败阶段起续跑；C gated）；注记对照事实：原站无任何可见选择性重做入口（O1 QW-14 红线记录），承诺级别系我方自选，不得引原站背书（CF-01/CF-06） | OD-01、OD-09 |
| D10 | Core 冻结；改 Core 走派生或新版本 | **保留** | 若案 B，对称扩展至 FlowVersion/内置 Flow 模板冻结（措辞随 CF-06 落档） | OD-09 关联 |
| D11 | Extension 可挂 Skill、Tool、Knowledge，并支持 global、stage、role scope | **修订** | **修订**：挂载对象收敛为 MountBinding 唯一事实源（C1 02 §1 Q4 五处双事实源教训；D1 05 §5.6），主体扩至 AgentFlowVersion(role)，资源类型扩（Workspace、AgentFlow/Workflow 作为工具）；version_policy 随 OD-04（引用＋可选 pin）（CF-03/CF-28） | OD-04、OD-09 |
| D12 | Release 原子冻结全部依赖闭包 | **保留** | 目标态决策不变。附注记：C1 02 §1 Q3 证明现闭包缺 Skill/Connection/MCP/AgentSkill（agent_release.py:112-181），缺口修复列 P0-E/M1（CF-20）；若案 B，闭包增 AgentFlowRelease 类型（CF-03） | OD-09 关联 |
| D13 | Chat 每 turn 是 Run；多轮才有 Session | **修订** | “每 turn 一 Run”保留并提请 OD-10 追认（C1 02 §3 Q6 Run(trigger=chat) 现状支持；O1 QW-04 原站不可证）；“多轮才有 Session”需措辞边界：状态载体 Session（SINGLE_RUN/FLOW_EPHEMERAL，非用户可见）是否豁免——CF-21 与 D14 同源 | OD-10、OD-19（新） |
| D14 | 无状态单次任务不创建 Session | **修订** | D1 05 §7.4 E1 时序显式创建 SINGLE_RUN 状态载体 Session，与字面冲突（A1 03 项5：官方持久化保证在 SessionRecord.state；M1 无状态 Provider 需 blob 载体）；不得静默覆盖：提请 OD-19 界定“Session”＝用户可见 Chat Session（豁免）或否决豁免（blob 改 Run.audit_state 承载）（CF-21） | OD-19（新） |
| D15 | Pipeline 恢复状态叫 ExecutionState/Continuation，不冒充 Chat Session | **保留** | D1 05 同名沿用；若案 B，ExecutionState 锚点扩至 FlowRun（载体扩展、命名与“不冒充 Session”原则不变）；与 OD-19 的 Session 界定正交 | OD-09 关联 |
| D16 | 批量属于 TaskRun 调度策略；自动任务可配置 batching | **修订** | **修订**：O1 QW-06/07（原站自动任务表单零批量字段、单发定义）＋D1 05 §5.4/§7.2（单发自动化直连 Run，不经 TaskRun；batching 收窄为数据窗口批量场景属性）；“自动任务可配置 batching”子句若案 B 批准则废止，批量与自动化仅共享 Run/Outbox 事实层（CF-08） | OD-08、OD-09 |
| D17 | native_workflow.py 只作 POC 证据，不作生产基类 | **保留** | C1 02 §6.4（文件头自标 v0.2 POC）一致；doc11 §4.5 处置准确 | — |
| D18 | 前端必须改；不能维持“交互协议零改动” | **保留** | C1 02 §1 Q2/Q6（前端三口径漂移）、doc08 §0 自证 | — |
| D19 | WorkflowVersion 与 AgentVersion 支持双向组合，但不与 AgentScope Pipeline 合表 | **修订** | “不合表”原则保留；**前提修订**：若 OD-09=B，“AgentScope Pipeline＝AgentVersion 内部拓扑”被 AgentFlow 一等性 supersede，双向组合扩为三主体（Agent/AgentFlow/Workflow）互调，共用 ChildInvocation/InvocationGraph（O2 QW-04/QW-13 双向通道实证；D1 05 §4.3）（CF-01） | OD-09 |
| D20 | Agent→Workflow 走授权 mount/tool；Workflow→Agent 走通用 agent-run 节点 | **修订** | 模式保留并扩展 flow 边（run_agent_flow 工具、flow→agent 节点，D1 05 时序 1/3）；**注记实现缺口**：agent-run 节点当前不存在（旧 agent 系节点 deprecated、无替代实现，C1 02 §3 Q2 registry.py:111-147），Runtime 无 list/run workflow 工具（02 §2.4 断点⑥）——落 P0-E/G0（CF-20） | OD-09 关联 |
| D21 | 跨 Agent/Workflow 子调用统一维护 InvocationGraph、版本 pin、预算、权限、取消、幂等与环检测 | **保留** | D1 05 GR-5 同构；附注记：C1 02 §3 Q3 现状缺口（agent_chain/wf_chain 分列判重、混合深度无统一上限）＝重构对象；统一深度阈值与环判定口径随 OD-11 追认（默认 5，按定义 id 判环） | OD-11 |
| D22 | IDENTITY/playbook/PERSONA 编译为版本化 PromptBundle；BIBLE 类内容是软约束 | **保留** | O1 无相反证据（原站 BIBLE 类表象未见反例）；D1 05 GR-1/§5.7 一致 | — |

**处置分布：保留 13 · 修订 9 · 废止 0。**

### 3.2 U/N/P0 未决项处置注记

| 编号 | 现状 | 处置 |
|---|---|---|
| U01（SkillVersion 独立表 vs 内容快照） | 未决 | 维持未决；D1 05 §5.6（SkillVersion 独立快照＋闭包存 hash）支持现默认建议；C1 02 链2 断点⑤⑥⑦证明紧迫性 |
| U02（KnowledgeSnapshot 冻结范围） | 未决，默认建议“冻结文档集合和索引 revision” | **默认建议需修订**：C1 02 §2.3 证明平台侧无索引/revision，现默认在现状下不可执行；执行体分叉随 OD-12（CF-27） |
| U03 | **编号跳空，文内无解释** | 补去向说明（CF-35）；未决编号只增不复用 |
| U04/N5（partial barrier） | 未决 | 维持未决，无新证据影响 |
| U05（2.0.8 正式版前是否允许生产） | 未决，默认“不允许，只做沙箱 spike” | 维持未决＋**范围澄清**：闸门对象＝2.0.8-dev 能力，不涵盖以 2.0.7 为底座的生产接线（CF-15/OD-16） |
| U06/N1（高风险工单写 HITL） | 未决 | 维持未决；D1 05 GR-6/N1 默认（沙箱 deny、生产白名单）一致 |
| N2（Kafka 首期协议范围） | 未决 | 维持未决；事件触发一期范围与 OD-02 联动（CF-08 关联） |
| N3（HTTP Outbox 新表 vs 扩 ResultDelivery） | 未决 | 维持未决；D1 05 §5.7 提供比较输入（CommandOutbox 泛化＋ResultDelivery 特化，全套模式已被 C1 02 §3 Q8 证明），不预设结论 |
| N4（试点目标系统） | 未决 | 维持未决 |
| N6（任务升级为 Chat Session 的权限/归属） | 未决 | 维持未决；与 OD-19 的 Session 措辞界定联动（CF-21） |
| P0（52 个 dirty path 归属） | HANDOFF §6 列为未拍板 | **事实已变化**：f6824f9 checkpoint 已收入全部 dirty path（C1 02 §0.1）；重定义为“checkpoint 收口的独立验收与基线封存”（CF-19），仍属开工前置 |

### 3.3 建议新增决定（D23–D28 候选；全部待用户拍板，本矩阵不决定）

| 候选编号 | 拟新增决定 | 绑定拍板 | 关联冲突行 |
|---|---|---|---|
| D23（候选） | AgentFlow 为一等版本化资产（Definition/Version/Release），与 Workflow 并存且共用 Run/ChildInvocation/RunEvent/Policy/Release/Outbox 执行事实层；批准时同步 supersede：doc11 §2.7/§4/§7.3/D19 表述、doc08 §4/§14 否定句、doc12 §0 二元 target、doc03 target union | OD-09 | CF-01/02/03/06/07 |
| D24（候选） | ExecutionTarget union＝agent_release｜agent_flow_release｜workflow_version，一律强制版本解析策略（pinned｜latest_prod｜latest_sandbox） | OD-08 | CF-04/05/08 |
| D25（候选） | WorkspaceBinding 三态（平台管理默认｜本地目录｜Git 项目）为一等挂载对象；高危内置工具（Bash/Write/Edit）默认关闭四条件＋HITL 审批；_output/ 型产物交付契约；任意 shell Hook 永不放行 | OD-13（GR-2/GR-3 规则本身为任务书强制） | CF-26/CF-28 |
| D26（候选） | AgentScope 事件→RunEvent 映射表以 mapping_version 随 Release 冻结；THINKING→CONTROL；前端 CONTENT 白名单投影，CoT 不外露（仅 run:audit 审计视图） | 既有拍板落实（无需新拍板，列入以固化为 D 级决定） | CF-24/CF-25 |
| D27（候选） | D13/D14/闸门 4 的“Session”界定为**用户可见 Chat Session**；非投影状态载体 Session（SINGLE_RUN/FLOW_EPHEMERAL）豁免——或否决豁免、AgentState blob 由 Run.audit_state 承载 | OD-19（本矩阵建议新编号） | CF-21 |
| D28（候选） | 追认“每 chat turn 一 Run、Session 1:N Run”；设立 TaskRun.trigger 与 Run.trigger 两级词表权威表（含 manual_debug/automation/flow/flow_stage/agent_tool/workflow_node/continuation 扩展），模型注释与校验枚举同步 | OD-10 | CF-22 |

---

## §4 06a“01 已证但文档未提”候选清单逐条定级（68 项，允许合并同类）

> 定级值：**入表 CF-xx**＝已登记为冲突行；**非冲突**＝核查后不构成文档冲突（给出理由）。同一候选在多档重复出现时指向同一 CF 行。

### 4.1 doc03（06a §一.4，10 项）

| # | 候选要旨 | 定级 |
|---|---|---|
| 1 | 自动任务 API 触发鉴权＝atk_ token 内嵌调用地址（QW-07） | 非冲突：03 §3.1 鉴权三选为我方自主设计；D1 05 §5.4 明示 atk_ 表象不抄（token 走 KMS secret_ref） |
| 2 | 原站触发表单仅“定时｜API”两卡、“事件”无入口（QW-06 差异记录） | 非冲突：webhook/mq 系我方业务驱动（任务书禁以原站为上限裁剪已有设计）；事件一期范围随 OD-02 |
| 3 | 自动任务＝五元组定义、表单/详情零批量字段（QW-06/07） | 入表 CF-08 |
| 4 | 一份自动运行配置＋触发方式上限 1/5（QW-15） | 入表 CF-08 |
| 5 | 手动运行＝调试语义（不更新最近触发/不计入累计）（QW-07 tooltip） | 入表 CF-08（建议新文本含 manual_debug 口径） |
| 6 | 看板＝三类执行事实统一投影、行粒度 run/session 级（QW-02） | 入表 CF-34 |
| 7 | @Waker＝IM 渠道管理页（QW-03） | 非冲突：IM＝REJECT（既有拍板）；03 范围无 IM，正确 |
| 8 | 工作空间路径约定与 _output/、present_files 产物契约（跨域事实 3） | 入表 CF-28 |
| 9 | CoT 外露、Bash/Write 默认开放（跨域事实 1/2） | 非冲突（03 范围外）；跨档安全缺口入表 CF-24/CF-26 |
| 10 | Credits 用量面板、模型 Auto/错峰折扣（跨域事实 4/6） | 非冲突：计价与模型市场表象不采纳（与市场制不照搬同源拍板；04 无对应行） |

### 4.2 doc05（06a §二.4，11 项）

| # | 候选要旨 | 定级 |
|---|---|---|
| 1 | Waker 混合体（资产根＋在线/本机/主机名运行实例）（QW-09） | 入表 CF-32（worker 标识维度，OD-06）；doc08 §14“不用在线状态模拟非驻留 Agent”为正确边界，保留 |
| 2 | 招聘市场＝创建 Waker 页、预置角色模板卡（01 §4.4） | 非冲突：doc08 §3.3 内置方案卡承载同职责；市场制/员工化表象不抄（既有拍板） |
| 3 | Skill 市场生态数据（43648/2183 页）（QW-16） | 非冲突：市场制不照搬（既有拍板；01 QW-16 注记） |
| 4 | 知识库共享＋“N 个 Waker 使用”反向绑定（QW-16） | 入表 CF-31 |
| 5 | 公开项目＝本地目录/Git 仓库、两级作用域（QW-16） | 入表 CF-28/CF-31 |
| 6 | 自进化 Skill 与记忆学习时间线（QW-09） | 时间线入表 CF-30；自进化＝DEFER 子面（04 行 7），非冲突 |
| 7 | TaskCreate/TaskUpdate 工具级实证、三义异质（QW-04） | 非冲突：doc05 §10 三义分离原则已在；统一术语表与展示名入表 CF-38 |
| 8 | 双向调用工具级证据（list_wakerflows/resolve.kind='waker'）（QW-04/13） | 非冲突：HANDOFF §9 禁止引 qoderwake 作模型证据，文档不引为正确纪律；ChildInvocation 与 CallRecord 分工入表 CF-23 |
| 9 | 工作空间文件系统契约（跨域事实 3） | 入表 CF-28 |
| 10 | CoT/Bash 高危表象、05 policies 无对应表述（跨域事实 1/2） | 入表 CF-24/CF-26（doc05 §2.1 policies 区需补 GR-2/GR-3 落点） |
| 11 | Credits/Auto/Group disabled/@Waker IM（跨域事实 4/5/6、QW-03） | 非冲突：不采纳/范围外；Group＝04 行 6 DEFER，expert-group 封存不翻案 |

### 4.3 doc08（06a §三.4，12 项）

| # | 候选要旨 | 定级 |
|---|---|---|
| 1 | CoT 红线未提＋§8 thinking 消息块（跨域事实 1） | 入表 CF-24 |
| 2 | Bash/Write 默认开放须隔离＋allowlist＋审批（跨域事实 2、QW-04） | 入表 CF-26 |
| 3 | 工作空间文件系统/_output/present_files/composer 选目录（跨域事实 3） | 入表 CF-28 |
| 4 | 看板统一投影＋动作队列页签（QW-01/02） | 入表 CF-34 |
| 5 | 自动任务表单事实五项（QW-06/07、auto-02） | 入表 CF-08 |
| 6 | Flow 对话式生成/编辑工具链与 upsert 存储契约（QW-15/16、flow-02/07） | 入表 CF-06 |
| 7 | Flow DSL（meta/phase()+worker()/resolve/outputSchema）（QW-13） | 入表 CF-06（outputSchema 必填语义由 D1 05 §4.1 采纳） |
| 8 | Flow 整数版本、回滚/发布/草稿 UI 未见（QW-15） | 入表 CF-06（我方发布快照＋回滚设计有意强于原站缺口，不照抄其缺位） |
| 9 | @Waker＝IM 渠道页（QW-03） | 非冲突：REJECT |
| 10 | 资源市场生态（连接器市场 22 个含钉钉/企业微信等）（QW-16） | 市场制非冲突（不照搬）；共享/绑定治理面入表 CF-31 |
| 11 | 招聘市场/自进化/活跃度热力图/任务类型分布/记忆时间线（QW-08/09） | 非冲突（模板卡已有 08 §3.3；热力图/分布＝概览投影 D1 可选）；时间线入表 CF-30 |
| 12 | Credits/模型 Auto 折扣/Group disabled/路由缺陷 /resources/connectors×150（跨域事实 4/5/6、01 §4.6） | 非冲突（不采纳/范围外）；路由缺陷启示（深链与 slug 校验属产品契约）建议并入 doc08 §12 验收补充项，不单独入表 |

### 4.4 doc11（06a §四.4，14 项）

| # | 候选要旨 | 定级 |
|---|---|---|
| 1 | CoT 红线与 thinking.delta 通道归属未记录（跨域事实 1） | 入表 CF-25（红线本体入表 CF-24） |
| 2 | Bash/Write 须隔离＋allowlist＋审批（跨域事实 2） | 入表 CF-26 |
| 3 | 工作空间文件系统（Workspace 仅组件名）（跨域事实 3） | 入表 CF-28/CF-29 |
| 4 | Credits 面板（跨域事实 4） | 非冲突：计价表象不采纳 |
| 5 | Group 入口部分 disabled（跨域事实 5） | 非冲突：DEFER（04 行 6） |
| 6 | 模型 Auto/错峰折扣/“模型由工作流管理”tooltip（跨域事实 6、QW-03） | 非冲突：计价/市场表象不采纳；ModelRef 冻结口径（§7 第 9 项）与“模型随 Flow 冻结”兼容（D1 05 §5.7） |
| 7 | 自动任务表单事实 vs 故事 D 四类触发＋batching（QW-06/07、auto-02） | 入表 CF-08 |
| 8 | 一份 Flow 自动运行配置 1/5（QW-15） | 入表 CF-08 |
| 9 | 看板统一投影＋动作队列（QW-01/02） | 入表 CF-34 |
| 10 | Flow DSL/存储契约/run 级路由/阶段节点状态/attempt 未见（QW-12–16） | 入表 CF-06（attempt：我方 origin_run_id/attempt 谱系强于原站可见面，04 行 12 ADOPT） |
| 11 | Waker 混合体/九子页分组/招聘市场（QW-08/09） | 混合体入表 CF-32；九子页→capability 渲染重设计系 doc08 §4 既有裁定，非冲突；招聘市场非冲突 |
| 12 | @Waker＝IM 渠道页（QW-03） | 非冲突：REJECT；官方 channel 网关默认关闭入表 CF-14 |
| 13 | 资源市场生态（Skill 市场/连接器 22 个/知识库绑定/公开项目）（QW-16） | 市场制非冲突；绑定/作用域入表 CF-31/CF-28 |
| 14 | 双向调用工具级证据（list_wakerflows/resolve）（QW-04/13） | 非冲突（引用边界纪律正确）；设计落点入表 CF-23/CF-06 |

### 4.5 doc12（06a §五.4，11 项）

| # | 候选要旨 | 定级 |
|---|---|---|
| 1 | 自动任务表单事实（五元组/atk_/手动调试/零批量/定时｜API）（QW-06/07、auto-02） | 入表 CF-08；atk_ 表象非冲突（D1 05 §5.4 明示不抄） |
| 2 | 一份自动运行配置 1/5（QW-15） | 入表 CF-08 |
| 3 | 看板投影＋运行历史“查看任务”回链（QW-02/07） | 入表 CF-34 |
| 4 | Flow 编排实体事实（DSL/脚本唯一事实源/digest/callSites/整数 version/generationSessionId/“基于此次运行优化工作流”）（QW-12–16） | 入表 CF-06（“基于此次运行优化”＝Continuation/优化入口 D1，随 OD-05 后续期） |
| 5 | 原站外部写形态（连接器市场＋Bash/Write 直接执行）（QW-16、QW-04） | 非冲突：我方 Outbox/egress/Gateway 设计有意更强（GR-6）；Agent 轨道现状不经 Gateway 入表 CF-17 |
| 6 | 双向调用工具级证据（QW-04/13） | 非冲突（引用边界）；落点入表 CF-23 |
| 7 | @Waker＝IM 渠道页（QW-03） | 非冲突：REJECT |
| 8 | 工作空间/项目（路径约定/_output/present_files/两级作用域/composer 选目录） | 入表 CF-28 |
| 9 | CoT 外露红线（跨域事实 1） | 入表 CF-24/CF-25 |
| 10 | Credits/模型 Auto/Group disabled（跨域事实 4/5/6） | 非冲突：不采纳/DEFER |
| 11 | 选择性重做在原站无任何可见入口（QW-14 红线记录） | 非冲突：doc12 §4.2 系自主更强承诺、未引原站背书（纪律正确）；承诺级别随 OD-01，处置注记见 §3 D09 行 |

### 4.6 AUDIT-HANDOFF（06a §六.4，10 项）

| # | 候选要旨 | 定级 |
|---|---|---|
| 1 | CoT 红线未列入 A01–A17/§8 闸门（跨域事实 1） | 入表 CF-24（动作含 §8 闸门增补） |
| 2 | Bash/Write 隔离＋allowlist＋审批未入复核事实/闸门（跨域事实 2） | 入表 CF-26（动作含新增硬闸门 12） |
| 3 | 工作空间文件系统/_output/present_files 未提及（跨域事实 3） | 入表 CF-28/CF-29 |
| 4 | Credits/模型 Auto/Group/@Waker IM（跨域事实 4/5/6、QW-03） | 非冲突：不采纳/REJECT/DEFER |
| 5 | 自动任务表单事实未入复核清单（QW-06/07、auto-02） | 入表 CF-08；§7 T1 二元 target 入表 CF-05 |
| 6 | Flow DSL/对话式生成/upsert 契约/整数版本无回滚 UI（QW-13/15/16） | 入表 CF-06 |
| 7 | 市场生态/招聘市场/自进化/热力图（QW-08/09/16） | 非冲突：市场制不照搬/DEFER 子面 |
| 8 | 看板统一投影＋动作队列页签（QW-01/02） | 入表 CF-34 |
| 9 | 原站路由缺陷（/resources/connectors 重写×150 空白）（01 §4.6） | 非冲突：启示（深链/slug 校验）建议并入 doc08 §12 验收，不单独入表 |
| 10 | 选择性重做原站对照事实（A06 只记我方）（QW-14） | 非冲突：并入 §3 D09 处置注记与 CF-06 |

**定级汇总**：68 项候选中，入表 33 项次（映射至 CF-05/06/08/21 间接/24/25/26/28/29/30/31/32/34/38 及 CF-17/23 关联）、非冲突 35 项次（理由均为：既有拍板关闭（IM/市场制/CoT）、任务书引用边界纪律（不引 qoderwake 作模型证据）、有意不采纳的表象（计价/在线状态/atk_）、或已由文档既有裁定覆盖（模板卡/九子页重设计））。

---

## §5 按问题类型计数表

| 问题类型 | 条数 | 冲突行 |
|---|---:|---|
| FACT_ERROR | 5 | CF-09（api 触发“已有”）、CF-12（state_updated 被误写为独立事件类型）、CF-16（主链存在/可执行缺环境断链限定）、CF-17（Gateway“已有”对 Agent 轨道不成立）、CF-27（Knowledge“索引 revision”不存在） |
| STALE_VERSION | 4 | CF-10（doc03 未标版/引旧审计）、CF-19（HEAD/dirty path 基线过期）、CF-36（v4.x“拍板版”认知过期）、CF-37（HANDOFF 权威清单未含本轮产物） |
| MODEL_CONFLICT | 3 | CF-01（Pipeline 内嵌 vs AgentFlow 一等）、CF-08（Trigger→TaskRun 唯一路径 vs AutomationDefinition 单发直连）、CF-21（D14 字面 vs 状态载体 Session） |
| UI_CONFLICT | 0 | —（核查说明见 §0：doc08 逐页规格与原站/我方实测 UI 的实质分歧均已归入 CF-24（安全）/CF-34（契约缺失）/CF-02（未决被拍板），无独立纯 UI 冲突条目） |
| SECURITY_GAP | 2 | CF-24（thinking 消息块/“可见”验收触碰 CoT 红线）、CF-26（高危内置工具与 Hook 治理契约六档 0 次出现） |
| UNDECIDED_AS_DECIDED | 3 | CF-02（doc08 否定 Flow 入数据模型）、CF-05（doc12 二元 target“三选不成立”拍板）、CF-35（U03 静默跳空） |
| MISSING_CONTRACT | 17 | CF-03（doc05 无 AgentFlow 冻结能力）、CF-04（doc03 target union 未显式）、CF-06（AgentFlow 全套契约 0 出现）、CF-11（版本双轨基线）、CF-13（GoalPipeline dead params/无上限循环）、CF-14（官方 App 层取舍表）、CF-15（U05 闸门范围）、CF-18（A01–A17 缺 P0 环境事实）、CF-20（分期缺 P0-E 活链路闸门）、CF-22（Run/trigger 两级词表权威）、CF-25（事件→channel 冻结映射）、CF-28（WorkspaceBinding/产物契约）、CF-30（MemoryPolicy/写回/时间线）、CF-31（共享资源治理面）、CF-32（Run 无 worker 标识）、CF-34（看板多源投影）——计 16，另 CF-40（Skill 语义错位/Custom 三口径粒度缺口）＝17 |
| TERMINOLOGY_COLLISION | 4 | CF-07（“flow”四义）、CF-29（“工作区/workspace”三义＋第四义预留）、CF-38（“Task/任务”四义）、CF-39（“channel”双义） |
| DUPLICATE_CAPABILITY | 2 | CF-23（ChildInvocation vs CallRecord/call_chain 分工未声明）、CF-33（trigger 表 vs schedule 表调度配置双源风险） |
| **合计** | **40** | CF-01～CF-40 |

---

## §6 需用户拍板项清单（16 条；与 07 的 OD 编号对齐，另建议新编号 OD-19）

> 纪律：以下各项在拍板前，关联冲突行只能挂起，不得由执行者按默认建议改档（任务书 R4/G5）。OD-01～08 已在 07 v1 登记；OD-09～18 由 05 §9 建议追加 07 v2；OD-19 由本矩阵新识别。

| 拍板编号 | 状态 | 需要用户回答的最小问题 | 关联冲突行 | 默认建议（D1 来源，未拍板） |
|---|---|---|---|---|
| OD-09 | 05 §9 建议（待入 07 v2） | 批准案 B（AgentFlow 一等版本化资产、与 Workflow 并存且共用执行事实层）吗？若否，选案 A 还是案 C？ | CF-01/02/03/06/07（连带 CF-04/05/08；D03/D06/D09/D11/D19/D20 处置） | 案 B（05 §3，O/C/A 三类证据交集） |
| OD-08 | 07 v1 | automation target 三型全开（agent/agent_flow/workflow）＋强制 pin，确认？ | CF-04/05/08 | A＋强制 pin（07 OD-08） |
| OD-16 | 05 §9 建议 | AgentFlow 生产化以平台自建 Runner 为准、不等 2.0.8；官方 pipeline/A2A 对象仅沙箱 spike 至正式 tag 并按 G4 口径重审——确认？（同时澄清 U05 闸门范围） | CF-01/15（U05、D02 注记） | 确认（05 OD-16） |
| OD-17 | 05 §9 建议 | 接受“内联 role 模板＋可 pin 顶层 AgentRelease”双引用方式，且内联模板资源仅限 FlowVersion 冻结集内声明？ | CF-01/03（D06 处置） | 接受（05 OD-17） |
| OD-15 | 05 §9 建议 | 一期 Provider 仅用 AgentScope 库层、官方 app 层（存储/总线/ChatService/调度器/IM 渠道网关/知识索引 worker）全部关闭？ | CF-14（D01 注记、CF-39 关联） | 是（05 OD-15） |
| OD-13 | 05 §9 建议 | 工作空间执行体放 Provider 容器还是平台侧？本地目录挂载一期是否只允许平台管理目录？ | CF-28（CF-26 细则关联） | 容器内＋仅平台管理目录（05 OD-13） |
| OD-12 | 05 §9 建议 | 知识库执行体选官方 RAG 服务层还是平台外部端点引用？一期冻结粒度维持“引用＋状态＋检索参数”？ | CF-27（U02 默认建议重写） | 外部端点＋最小冻结（05 OD-12） |
| OD-14 | 05 §9 建议 | 持久记忆只允许管理面编辑，还是允许 Agent 运行时写回（经审批＋revision）？ | CF-30 | 一期只读注入＋管理面编辑（05 OD-14） |
| OD-06 | 07 v1 | Run 记 worker 标识（方案 C，不建实例实体、不模拟在线状态），确认？ | CF-32 | C（07 OD-06） |
| OD-07 | 07 v1 | 看板＝run/session 投影、管理页＝定义级，确认？ | CF-34 | A（07 OD-07） |
| OD-19 | **本矩阵建议新编号** | D13/D14/闸门 4 的“Session”是否界定为“用户可见 Chat Session”，非投影状态载体 Session（SINGLE_RUN/FLOW_EPHEMERAL）豁免？若否决，AgentState blob 改由 Run.audit_state 承载 | CF-21（D13/D14 处置、N6 联动） | 豁免（05 §7.4 时序需要 blob 载体；A1 03 项5 官方持久化保证在会话级） |
| OD-01（连带） | 07 v1 | 选择性重做级别“B 先行、C gated”确认？ | CF-06（重做契约）、D09 处置 | B（07 OD-01） |
| OD-02（连带） | 07 v1 | 事件触发（webhook）随 doc12 S1 一期落地，确认？ | CF-08（触发面成员） | B（07 OD-02） |
| OD-03/04/05（连带） | 07 v1 | Flow 作用域（仅全局起步＋scope 预留）、挂载语义（引用＋可选 pin）、编辑器形态（一期画布源＋脚本只读视图）确认？ | CF-06/CF-03/CF-31 | A/C/C（07 OD-03/04/05） |
| OD-10（追认） | 05 §9 建议 | 确认“每 turn 一 Run、Session 1:N Run、看板投影行＝session”口径？ | D13 处置、CF-22（D28 候选） | 确认（05 OD-10） |
| OD-11（追认） | 05 §9 建议 | 全局深度上限＝5（跨 workflow/agent/flow 合计）且环判定按定义 id（含跨版本）？ | D21 注记、CF-23 | 是（05 OD-11） |
| OD-18 | 05 §9 建议 | 原站残余证据缺口（知识库详情/权限档案子页/Group 页签/设置页）补查授权或接受缺口推进？ | 无直接冲突行（维持 04 对应行 EVIDENCE_GAP 标注） | 接受缺口推进（05 OD-18） |

---

## §7 附录 · 建议新文本（每条冲突 ≤120 字替换段落草案；仅为修订建议，未写入任何设计稿）

- **CF-01（doc11 §2.7 末段替换）**：“AgentScope Pipeline 与平台 Workflow 均为编排产品：若 OD-09 批准案 B，多 role 编排由一等 AgentFlow（Definition/Version/Release）承载，AgentVersion 仅保留单体执行配置；Workflow 保持独立版本化业务流程资产。三者允许互调、不合表，共用 Run/ChildInvocation/事件/预算/取消事实层。”
- **CF-02（doc08 §4 该句替换）**：“参考产品的 WakerFlow 命名、DSL 与契约不进入本项目；其‘Flow 作为独立执行目标’的产品职责是否由我方一等 AgentFlow 承载，待 OD-09 拍板——批准则增设独立资产页与挂载区。本句不得再被引用为对一等 Flow 的否决依据。”
- **CF-03（doc05 §4.1 清单末尾增项）**：“16. AgentFlowRelease（若 Agent 挂载 AgentFlow）：dependency_snapshot 增 agent_flow 依赖类型；MountBinding.resource_type 扩 agent_flow；§3 表增行——AgentFlow 作为受治理工具必须 pin 到 FlowRelease；发布校验含 flow 引用闭合与深度预算，未挂载不可枚举。”
- **CF-04（doc03 §2 增补段）**：“执行目标契约：Trigger 不直接持有 target，target 由所绑自动化定义持有。ExecutionTarget union＝workflow_version｜agent_release｜agent_flow_release（第三成员随 OD-08/OD-09 拍板生效），一律声明版本解析策略（pinned｜latest_prod｜latest_sandbox），发布/运行禁止 latest 漂移。”
- **CF-05（doc12 §0 第 1 点替换）**：“执行目标选择在两个正交层次：1. ExecutionTarget＝WorkflowVersion｜AgentVersion｜AgentFlowRelease（三型随 OD-08/09 拍板生效；现行为二元）；2. runner 与 Planning 是 AgentVersion 内部维度，不构成额外 target。单发事件处理可直连 Run 不经 TaskRun；批量数据窗口仍走 TaskRun。原‘三选不成立’裁定随拍板同步 supersede。”
- **CF-06（HANDOFF §7 M1 清单增补）**：“M1 增补（OD-09 批准后生效）：AgentFlowDefinition/Version/Release 三件套；FlowRun 的平台外置 ExecutionState（每 stage 终态即写库）；Continuation 续跑前置校验（快照/digest/Outbox/深度四项）；编辑器一期画布源＋脚本只读契约视图（OD-05）；scope 字段预留（OD-03）；Automation/mount/工具三入口一律 pin FlowRelease。”
- **CF-07（doc11 §9 关键字替换）**：“执行语义关键字修订：workflow＝平台 WorkflowVersion 执行；agent_flow＝平台 AgentFlowRelease 执行（案 B 批准后启用）；agent＝对 AgentVersion 发起 Run。全档禁用裸‘flow’一词，避免与 AgentFlow、原站 WakerFlow、doc08‘流程/编排’页名四义混淆；前端同步清除 Wakerflow 品牌词（F1 验收）。”
- **CF-08（doc03 §2/doc11 故事 D 收敛段）**：“自动任务＝AutomationDefinition 五元组：TriggerBinding 集＋ExecutionTarget＋prompt/参数＋WorkspaceBinding＋policy，是定义而非执行实体。policy 显式含 `max_runs` 与 `deadline_at`：达到上限后定义自动转 `paused`，到达截止时间后不再物化 fire；触发入口与 Run 创建事务内双重校验。单发触发直连 Run；batching 仅保留给数据窗口批量场景（TaskVersion/TaskRun 轨道）。手动运行＝manual_debug，不更新最近触发、不计入累计；一个定义一份自动运行配置、多触发方式。”
- **CF-09（doc12 §2.1 该单元格替换）**：“已有 workflow/agent 执行目标与幂等字段、resolved version；触发来源 manual/schedule/backfill 已接线，api 仅词表声明、无任何端点以 trigger='api' 创建 TaskRun（空洞值，由 03 号稿 Trigger 设计填补，见其 §1 依据 2）。”
- **CF-10（doc03 头部增补）**：“版本：v1.1（2026-09-08 对齐回炉口径）。约束来源更新：所引‘02 审计 B14/B7’与 SDD-13 按 AUDIT-HANDOFF §2 降级为背景证据；现行代码事实以 research/morethancorn/10-qoderwake-product-research/02-current-platform-reality.md（HEAD f6824f9）为准。”
- **CF-11（doc11 头部替换）**：“AgentScope 双轨基线：实装并锁定＝2.0.7 正式版（PyPI registry wheel，runtimes/agentscope/pyproject.toml `agentscope==2.0.7`，包内零 pipeline 代码）；设计/spike 基线＝2.0.8-dev@ff8697ec（PyPI 无 2.0.8 发布物、无官方 tag，最新 2.0.7.post1）。凡引 2.0.8 能力必须标注[仅 DEV]；升级门＝正式 tag 发布后重跑契约审计。”
- **CF-12（doc11 §5 第 5 点替换）**：“AgentScope 事件 union（EventType 28 值/AgentEvent 28 成员，含 TOOL_CALL_*、THINKING_BLOCK_*、CUSTOM）按 §6.3 前缀表经 mapping_version 冻结映射为平台 RunEvent；`state_updated` 不是独立事件类型，而是官方 CustomEvent 的 known name，须纳入 mapping_version。”
- **CF-13（doc11 §3.2 增补两条）**：“GoalPipeline 的 max_retries 与 verifier_reset_context 为 dead params（赋值后全文件从未读取），不得作为重试治理依据；其结构化输出重提示循环无次数上限，终止性依赖模型行为，平台侧必须自设迭代上限与超时（列入 P1 spike 验收）。”
- **CF-14（doc11 §3.3 增补第 7 点）**：“官方 App 服务层逐项取舍表：storage、message bus、ChatService、scheduler（多副本单点约束）、IM 渠道网关（Feishu/Discord/DingTalk）、knowledge index worker、permission/budget middleware——一期默认全部关闭，Provider 仅用库层（Agent/Toolkit/事件），平台自托管服务面；取舍随 OD-15 拍板，启用任何一项须单独契约审计。”
- **CF-15（U05 行替换）**：“U05 修订：2.0.8-dev（未发布 main）代码及其 pipeline/A2A 能力一律不得生产使用，只允许隔离 spike；以已发布 2.0.7 为底座的平台生产接线不受本闸门限制，但受 P0-E 环境活链路闸门约束。AgentFlow 生产化以平台自建 Runner 为准（OD-16 默认口径）。”
- **CF-16（doc11 §1.2 Module 行结论列替换）**：“代码级主链闭合（AgentVersion/草稿→dispatcher→worker→Provider→结果事务）；运行环境级当前断：8301–8303 全部不可达、AgentScope Provider health=error 且零 Release 绑定、全部 active Release 绑已退役 Provider——发布即可运行的前提是先过 P0-E 活链路闸门。”
- **CF-17（doc12 §2.1 Gateway 行替换）**：“workflow/autonomous 轨道的工具/LLM/MCP 出站已有 egress＋Connection 凭据闸门；AgentScope 轨道当前不经 Gateway：adapter 仅连固定 8200 fixture Tool Service（自述仅返回 fixture 事实）、不读平台 tool/mcp_server 表、凭据不进 Provider 容器。‘外部动作复用’仅在 Contract v1.2 与真实执行体接线后成立。”
- **CF-18（HANDOFF §3 增补行）**：“A18 三 Provider 服务不可达且全部 active Release 绑退役 Provider（openai-agents 源码从未入 git）；A19 两个 dsh-* module_key 不在 Registry（运行必 MODULE_UNKNOWN）；A20 15 running/8 queued 僵尸 TaskRun 与 83 dead job，无 TaskRun 级回收；A21 Module 轨工具执行体＝8200 fixture 服务，MCP registry 与运行时互不相通；A22 api 触发词表声明、零端点接线。”
- **CF-19（HANDOFF §1 两行与 §6 P0 行替换）**：“Git HEAD＝f6824f9（checkpoint 提交，已收入原 52 个 dirty path；tracked 树干净，untracked 仅 .zcode/ 与 exports/）。P0 重定义：对 f6824f9/894245d checkpoint 收口内容做独立验收——配套测试未在本轮复跑、未经发布验收，逐路径归属确认与基线封存仍为开工前置。”
- **CF-20（doc11 §10 P0 行/HANDOFF §7 P0 节增补）**：“P0 增设 P0-E 环境活链路闸门：①Provider 服务可达且健康真实；②active Release 重绑存活 Provider、清理退役 Provider 行与 dsh 孤儿 Agent；③adapter cancel 真实现；④api 触发真端点＋token 鉴权；⑤workflow-exec 子调用 pin 声明；⑥Skill 单事实源迁移；⑦僵尸 Run/TaskRun 回收 job。出口闸门＝至少一条‘发布→可运行→结果事务’活链路；G0/T0 显式依赖 P0-E。”
- **CF-21（doc11 §2.5 增补句）**：“Session 措辞边界（待 OD-19）：D13/D14/闸门 4 中‘Session’指用户可见 Chat Session。平台可建非投影的状态载体 Session（SINGLE_RUN/FLOW_EPHEMERAL）作为无状态任务与 flow 子 Run 的 AgentState blob 载体；若 OD-19 否决豁免，blob 改由 Run.audit_state 承载，任何载体均不投影为用户会话。”
- **CF-22（doc11 §6.2 增补段）**：“两级词表权威定义：TaskRun.trigger＝manual｜schedule｜backfill｜api（03 号稿口径，词表不扩）；Run.trigger＝chat｜manual｜test｜eval｜agent｜schedule｜batch（现状）＋automation｜manual_debug｜flow｜flow_stage｜agent_tool｜workflow_node｜continuation（扩展，随案 B/Contract v1.2 引入）。模型注释、校验枚举与本表同步，列入 G0 验收。”
- **CF-23（doc05 §5.1 增补句）**：“分工声明：ChildInvocation＝跨边界谱系边（parent/child Run、目标版本、预算、幂等键），是环检测/深度/预算记账的唯一事实源，泛化并取代 call_chain/agent_chain 内存判重；CallRecord＝Run 内调用明细（PII 脱敏）维持现状。两者职责不同、写入点各一，禁止双事实源；InvocationGraph 由 ChildInvocation 单树投影。”
- **CF-24（doc08 §8 该行替换＋§12 验收替换）**：“消息块支持 text、data、tool call/result、hint；thinking 事件一律落 CONTROL 通道，对话流默认不渲染，仅具 run:audit 权限点的审计视图可见（CoT 不外露＝既有安全拍板，禁抄原站‘深度思考’外露表象）。§12 验收改：CONTENT 投影无 THINKING 文案泄漏（负向断言）＋审计权限点测试。”
- **CF-25（doc11 §6.3 增补段）**：“事件映射契约：AgentScope AgentEvent union→RunEvent 的映射表以 mapping_version 随 Release 冻结（官方 schema 无稳定性承诺，Beta＋跨版本漂移已证）。THINKING_BLOCK_*→channel=CONTROL；TEXT/TOOL/进度→CONTENT；REQUIRE_USER_CONFIRM/EXTERNAL_EXECUTION→Run 控制态迁移＋CONTENT 卡片；MODEL_CALL_END.usage→预算账本回写。映射表变更走 ADR。”
- **CF-26（HANDOFF §8 增补闸门 12）**：“闸门 12：Bash/Write/Edit 类高危内置工具不进默认工具面（AgentScope 装配面默认含 workspace 内置工具，必须显式门控）。启用四条件同时满足：run 有 WorkspaceBinding、PolicySnapshot allowlist 显式列出、配额/超时生效、写范围＝会话工作区＋_output/。越界写/非白名单 egress/凭据访问触发 HITL 审批；任意 shell Hook 永不放行，Hook 一期不建用户配置面。”
- **CF-27（doc05 §3 Knowledge 行替换）**：“Knowledge：现状＝外部检索端点引用＋检索参数（topK/scoreThreshold/mode），平台侧无索引、无 revision。最小冻结＝引用＋状态＋参数快照（KnowledgeSnapshot）；‘文档集合/索引 revision’冻结仅在 OD-12 拍板采用官方 RAG 服务层后生效，不得把现状不存在的冻结对象写成发布规则。”
- **CF-28（doc05 §2.4 增补段）**：“Workspace 为一等挂载对象：WorkspaceBinding 三态（平台管理默认｜本地目录｜Git 项目）＋作用域两级（账号共享/Agent 私有）＋会话工作区路径约定＋_output/ 产物交付契约（目录不可作产物）＋配额/allowlist 引用＋执行位置（随 OD-13）。入 Release 冻结；高危文件/shell 工具面按闸门 12 门控。”
- **CF-29（六档术语注记模板）**：“术语注记：本文‘工作区’指 Agent 管理 UI 壳（doc08/11）；git 工作区（HANDOFF §1）与 AgentScope Workspace 组件（doc11 §3.1）为不同概念；文件系统义工作空间统一命名 WorkspaceBinding/工作空间（doc05 新契约）。四义禁止混用，新稿引用时须带限定词。”
- **CF-30（doc05 §2.1 memory 扩展）**：“MemoryPolicy 契约：只读注入或经审批写回；运行级记忆→持久 AgentMemory 的晋升须审批＋revision 留痕；MemoryPolicy 入 Release 冻结；三轨消费（chat 正文/run 级字典/workflow MemoryRecord）收敛为 Release 驱动单注入点；记忆与学习时间线由 RunEvent 投影，不建第二事实源（写回节奏随 OD-14）。”
- **CF-31（doc08 §6 增补段）**：“共享资源治理面：知识库卡显示‘N 个 Agent 使用’反向引用计数（由 MountBinding 单源反查）与‘设置可使用 Agent’授权入口；项目/工作空间显示两级作用域（账号共享/Agent 私有）；共享与授权变更入 AuditLog；删除/禁用被引用资源时显示可见阻断与引用清单。”
- **CF-32（doc05 §5 Run 行增补）**：“Run 事实表增 worker 标识（host/process/instance tag），回答‘哪台机器执行的’；不建 Agent 实例实体、不用在线状态模拟非驻留 Agent（doc08 §14 边界维持）；运行中心与看板‘执行者’列由 Run.worker 与目标定义联合投影（引入方式随 OD-06）。”
- **CF-33（doc03 §7 增补句）**：“trigger 表划分声明：type=schedule 的 trigger 行仅持 schedule_id 引用与 UI 归集；调度配置权威（cron/时区/48h 物化/missed 判定）仍在 schedule 表，禁止把调度字段复制入 trigger.config；ScheduleOccurrence 与 fire_key 幂等机制原样保留，收编仅改查看入口。”
- **CF-34（doc08 §7 增补节）**：“平台任务看板投影契约：看板＝run/session 级多源统一投影（chat session、AgentFlow run、automation run、TaskRun 批次行混排，来源/执行者列区分）；‘需要操作/查收结果’＝由 Run 控制态与投递终态派生的用户动作队列页签（非过滤器）；执行终态与投递终态分列展示；Agent 工作区‘工作’页＝同一投影组件的 Agent 过滤视图（行粒度随 OD-07）。”
- **CF-35（doc11 §11.2 增补注记）**：“编号说明：U03 为历史空缺（其去向由主审计者核对 v5.0 底稿后回填本注：曾拍板则补拍板记录与 supersede 对象，曾合并则注明并入条目）；未决项编号只增不复用，任何未决项的删除或合并必须留显式记录，禁止静默覆盖。”
- **CF-36（doc11 §0 增补句）**：“对外引用口径：本稿现行权威＝v5.1 冻结开工态。v4.x 的‘15 点全部拍板、方案冻结’已失效，不得再被任何稿目/排期引用为开工依据；§11.1 D01–D22 的效力以 06 冲突矩阵处置表为准（保留 13/修订 9/废止 0），修订项在对应 OD 拍板后落档并保留原行＋处置列。”
- **CF-37（HANDOFF §2 增补第 7 项）**：“7. research/morethancorn/10-qoderwake-product-research/00–07：本轮原站观察（O1/O2）、代码审计（C1）、官方契约（A1）与映射/提案（D1）。R5 验收（ACCEPTED_FOR_DOC_REVISION）后，设计稿按其 06 冲突矩阵修订；‘历轮 research 与 qoderwake 调研仅作背景证据’条款继续适用于历轮产物，不适用于本轮经闸门复核的 O/C/A 级事实（D1 提案仍须拍板）。”
- **CF-38（HANDOFF §2 或 doc05 附录新增术语表）**：“任务术语权威表：平台任务＝看板投影行（WorkItem，run/session 级）；自动任务＝AutomationDefinition（触发/目标/prompt/工作空间/策略定义）；批次＝Task/TaskRun（数据窗口调度）；Agent 内部计划项＝AgentScope Task 工具（tasks_context，UI 展示名‘执行计划’）。四义禁止合并建表、禁止互相推导；blocks/blocked_by 仅展示信息，不是调度契约。”
- **CF-39（doc11 §6.3 增补注记）**：“术语注记：RunEvent.channel＝CONTROL｜CONTENT 事件分级通道，与 IM 无关；AgentScope app 层的 channels/channel_clients 为 IM 渠道网关（Feishu/Discord/DingTalk），属 OD-15 取舍表且默认关闭（IM＝REJECT 既有拍板）。两词禁止混用，任何 IM 面讨论不得借用事件通道词汇。”
- **CF-40（HANDOFF A02/A03/A08 增补）**：“A02 补：config.skills 存在 ID/名字语义错位并存——custom 前端写 Skill ID，遗留运行时按名字消费，迁移须建 ID→名字→一等关系三方映射表（M0 盘点项）。A03/A08 补：Custom 可写口径前后端三分（UI 壳只读/Config 页可写/后端 API 可写），发布断点＝build_definition else 分支 409 NO_WORKFLOW，运行断点＝Run 直接置 failed‘未绑定工作流’。”

---

## §8 纪律声明与验收对照

- 本轮只产出本文件（06-design-conflict-matrix.md）；未修改 docs/v2-design/ 任何文件、任何代码/迁移/lockfile；全部核验命令为只读（Read/grep/tail/wc）；未使用浏览器；未派发子代理。
- 六份设计稿全部逐段回原文核对后再定级（06a 摘句仅作索引）；每条“新证据”均带等级与出处（O1/O2＋QW 步骤/截图名；C1＋02 章节/链/断点编号或 file:line，行号以 HEAD f6824f9 为准；A1＋03 条目/[L2.0.7]/[DEV] ff8697ec 源码行；D1 均显式标注为未拍板提案）。
- 未决项纪律：案 B/AgentFlow 相关 8 行全部 gated by OD-09/OD-08，本矩阵未把任何提案写成既定事实；D01–D22 逐条给出处置与 supersede 方向，无静默覆盖；新识别拍板项以建议编号（OD-19、D23–D28 候选）登记，等待用户回答。
- 任务书 §9 必查清单 10 项已在 §1 逐条回应；06a 三项额外输入（doc11 v5.1 冻结失效、AgentFlow 0 次、U03 跳空）分别落 CF-36/CF-06/CF-35；68 项“01 已证但文档未提”候选在 §4 逐条定级；02 的 P0 级现实（运行时死链/Release 绑退役 Provider/Skill 双事实源/Custom 半断链/api 触发无端点）分别落 CF-16/18/19/20、CF-40、CF-09。
- 在收到主审计者 `ACCEPTED_FOR_DOC_REVISION` 前，本矩阵的建议动作与建议新文本均不得写入设计稿，也不得据此启动 P0 代码工作。

*报告完。交叉引用：任务书 §9（表头/九类型/必查清单）、§3（证据等级）、R4（冲突与决策纪律）；06a（摘句索引与全局检索事实）；01（O 证据）、02（C 证据，HEAD f6824f9）、03（A 证据，[L2.0.7]/[DEV] ff8697ec）、04/05（D1 提案）、07 v1（OD-01～08）。*
