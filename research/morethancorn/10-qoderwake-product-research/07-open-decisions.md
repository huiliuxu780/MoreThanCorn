# 07 · 未决决策清单（v1，阶段一证据固定项）

> **2026-09-08 纠偏提示**：本清单中的默认建议基于旧平台运行架构，现全部降级为历史问题记录。AgentScope 原生接管和 QoderWake 产品复刻边界以 10 号纠偏控制单为准；任何 OD 若仍需保留，必须按新唯一真相源重新提问，不能沿用旧默认值。

> 规则：未决项不得伪装成拍板（G5/R4）。每项七字段：问题 / 为什么现有证据不能决定 / 选项 / 默认建议 / 代价 / 推迟决定的影响 / 需要用户回答的最小问题。
> v1 来源：00（路由清点 v2）+ 01（观察报告）。架构级未决项待 04/05 完成后追加 v2。
> 已由任务书或既有拍板关闭、**不再列为本轮未决**的事项：IM/@Waker 渠道不抄（任务书 §1.1）；CoT 不外露（强制安全纠错）；市场制不照搬（既有拍板）；AgentScope 为唯一运行时底层（09-08 拍板，硬前提另列于 sdd14 记忆）。

## OD-01 选择性重做的产品承诺级别

- 问题：我方 Run 体系是否承诺"失败后只重做某阶段/某节点"？
- 为什么现有证据不能决定：原站 WakerFlow 执行记录只有 run 级状态与无名图标（UNIDENTIFIED_CONTROL），无任何可见的阶段级重做入口（01 QW-14）；我方现有 Workflow 亦无此能力（待 02 复核确认）。原站不证明=我方无借鉴来源，只能自设计。
- 选项：A 不做（仅 run 级重跑）；B run 级重跑+失败阶段起续跑（需 Continuation/ExecutionState 设计）；C 任意节点选择性重做（需节点级幂等与快照）。
- 默认建议：B（P1），C 列 P2 且要求节点声明幂等键后才开放。
- 代价：B 需 ExecutionState 持久化与阶段输出快照；C 再加节点级依赖分析。
- 推迟影响：Run 表与事件 schema 若不留 continuation 字段，后补需迁移。
- 最小问题：接受"B 先行、C  gated"吗？

## OD-02 "事件触发"是否进入我方 Trigger 一期

- 问题：原站副标题称"定时、事件或 API"，但新建弹窗与 flow 触发弹窗均只见 定时|API（01 QW-06/flow-05 差异事实）。我方 doc03/doc12 已设计 webhook/Kafka 事件入口。一期做不做事件触发？
- 为什么现有证据不能决定：原站表单层无事件入口（O1），其"事件"是文案还是未上线能力不可知；我方需求侧（工单链路 doc12）真实需要事件入口，与原站对齐与否不构成约束。
- 选项：A 一期仅 manual/schedule/api（对齐原站可见能力）；B 一期含 webhook 事件（我方 doc12 S1 路线）；C 事件仅预留枚举不实现。
- 默认建议：B（我方业务驱动，不以原站为上限；任务书禁"因像原站而裁剪我方已有设计"）。
- 代价：B 需入口鉴权/重放/幂等（doc12 已有 Outbox/SSRF 闸设计可复用）。
- 推迟影响：Trigger union 与自动化表单需二次改版。
- 最小问题：事件触发随 doc12 S1 一期落地，确认？

## OD-03 Flow 的作用域模型：全局 / 属主 / 双作用域

- 问题：原站 WakerFlow 有 global（/resources/wakerflow 列表、upsert scope.kind='global'）与 per-Waker（/wakers/<id>/workflows）双作用域表象（01 QW-10/11）。我方 AgentFlow 若成立，作用域怎么定？
- 为什么现有证据不能决定：原站双列表的权限语义不可见（global 是否=全账号可见可跑？per-Waker 是否=私有？无权限页证据）；我方单租户现状使"共享"语义价值存疑。
- 选项：A 仅全局；B 仅属主（Agent 私有）；C 双作用域+可见性位。
- 默认建议：A 起步（单租户），schema 留 scope 字段以便升 C。
- 代价：C 需可见性/授权模型；A 后升 C 需回填 scope。
- 推迟影响：列表页 IA 与挂载 UI 需返工。
- 最小问题：单租户阶段接受"仅全局+scope 字段预留"吗？

## OD-04 资源挂载语义：引用 / 复制 / 版本 pin

- 问题：原站知识库卡显示"N 个 Waker 使用"+绑定设置（引用语义倾向），Skill 是否复制进 Waker 工作目录不可见；flow 脚本以 wakerId 短 id 引用 Waker 且**无 version 字段**（01 QW-09/13）。我方 Release snapshot 已走冻结快照路线（doc05）。映射时以谁为准？
- 为什么现有证据不能决定：原站运行时注入方式不可见（任务书红线：页面能添加≠运行时已注入）；我方现状链路是否真消费 Release snapshot 待 02 复核。
- 选项：A 全引用（运行时解析最新）；B 全快照（Release 冻结）；C 引用+可选 pin（mount 表带 version 可空）。
- 默认建议：C（与 doc05 Release 冻结兼容，且解释原站"引用"表象）。
- 代价：C 需 MountBinding 带可空 pin 与解析规则。
- 推迟影响：AgentFlow/Agent 的 mount 表设计反复。
- 最小问题：mount=引用+可选 pin 确认？

## OD-05 AgentFlow 编辑器形态：画布 / 脚本 / 对话生成

- 问题：原站 WakerFlow=脚本为唯一事实源+画布投影+对话式生成与对话式编辑（01 QW-12/13/15）。我方 Workflow 现有画布设计器（xyflow）。AgentFlow 编辑器做哪种？
- 为什么现有证据不能决定：三形态成本差异大且互不蕴含；原站证明"脚本源+画布投影"可行，但我方画布资产是否可复用为投影层待前端评估；对话生成依赖运行时 LLM 工具链（我方 AgentScope 接线未完成）。
- 选项：A 画布源（现状延续）；B 脚本源+画布投影（对齐原站）；C 画布源+脚本只读视图；D 对话生成优先。
- 默认建议：C 一期（复用画布资产、脚本作只读契约视图），B/D 列后续（D 依赖 C1 验收）。
- 代价：B 需 DSL 解析/callSites 投影层；D 需编辑 Agent 工具链与安全闸。
- 推迟影响：编辑器信息架构与版本 diff 方案（脚本 diff vs 图 diff）不同。
- 最小问题：一期 C、后续 B/D 排序确认？

## OD-06 Waker"在线实例/本机"维度是否引入我方 Agent

- 问题：原站 Waker 卡带 在线徽标+本机徽标+主机名+工作日志/热力图/记忆事件（01 QW-08/09），即"资产根+运行实例"混合体。我方 Agent 当前为定义+版本+Release（doc05），无实例/主机维度。是否引入？
- 为什么现有证据不能决定：原站混合体的运行时含义（在线=进程常驻？心跳？）不可见；我方部署形态（服务端集中 vs 本机 worker）未拍板。
- 选项：A 不引入（Agent 纯定义，运行事实全在 Run）；B 引入 AgentInstance/Worker 心跳实体；C 仅在 Run 上记 worker 标识（host/pid）。
- 默认建议：C（最小满足"哪台机器跑的"可观测性，不建实例实体）。
- 代价：B 需心跳/注册/失联治理。
- 推迟影响：运行中心"执行者"列与故障归因口径。
- 最小问题：C 方案（Run 记 worker 标识）确认？

## OD-07 看板行粒度：run 投影是否成为我方唯一看板语义

- 问题：原站看板=run/session 级统一投影（对话 session、flow run、automation run 混排，01 QW-02）。我方工作台现有双视图+Drawer（003–007 交付）与 /tasks 看板（周期化已实施）。是否把"行=run 投影"定为唯一语义？
- 为什么现有证据不能决定：我方已有列表存在定义级与 run 级混用历史（tasks kanban 对齐轮已做 run 级 5 列+分页）；统一投影会改变既有页契约，需用户对产品口径拍板。
- 选项：A 全看板 run 投影（对齐原站）；B 定义级列表+run 级详情（现状）；C 双 tab（事/定义）。
- 默认建议：A 于"任务看板"页、定义级保留于各管理页（与原站 IA 同构）。
- 代价：A 需 WorkItemProjection 查询层与来源/执行者列口径。
- 推迟影响：看板与运行中心职责边界持续模糊。
- 最小问题：看板=run 投影、管理页=定义级，确认？

## OD-08 自动任务"执行指令=Prompt 直发"与我方 flow 骨架路线的关系

- 问题：原站自动任务执行指令=每次触发把文本作为 Prompt 直发所选 Waker（01 QW-06），即 automation→agent 单跳；我方 doc12 推荐 flow 骨架+agent 节点。两者并存还是收敛？
- 为什么现有证据不能决定：原站证明单跳 prompt 模式产品化成立；我方工单链路需要多节点治理；是否允许 automation target 同时含 agent/flow/workflow 三型属产品选择（任务书案 B 表述含三型，但未拍板）。
- 选项：A 三型 target 全开（案 B 表述）；B 仅 agent+workflow（现状）；C 仅 flow（收敛）。
- 默认建议：A 但 agent 型 target 强制走 Release pin（安全纠错第 4 条精神）。
- 代价：A 需 ExecutionTarget union 与三型各自的预算/取消传播。
- 推迟影响：Trigger target union（doc03）与自动化表单字段反复。
- 最小问题：automation target 三型全开+强制 pin 确认？

## v2 追加（2026-09-08，来源 05-target-architecture-proposal.md §9；七字段由本档补全）

### OD-09 AgentFlow 一等性（案 B）批准

- 问题：是否批准案 B——AgentFlow 为一等版本化资产，与 Workflow 并存且共用 Run/ChildInvocation/RunEvent/Policy/Release/Outbox 执行事实层？
- 为什么现有证据不能决定：三案各有证据支撑（05 §2 十三维矩阵：B 占优 8 维、A 占优 3 维、C 占优 2 维），属产品形态选择而非事实问题；doc11 现状为案 A 形态（PipelineDefinition 内嵌 AgentVersion），翻转需 supersede 登记。
- 选项：A（AgentVersion 内部配置）/ B（一等资产）/ C（统一 FlowDefinition+engine type）。
- 默认建议：B（05 §3.1：O2 执行目标两型+scope=global+Waker→Flow 工具通道 × C1 Workflow 全通链模板 × A1 官方 pipeline 零治理零持久化，三证据交集）。
- 代价：B=新增定义/版本/发布三表+编辑器四件套+自建编排 Runner；A=锁死产品语义（无 Flow 执行目标）；C=迁移唯一全通链（266 真 Run/9 workflow）的回归风险。
- 推迟决定的影响：04 行 2 维持 OPEN；doc11/doc03/doc05 的修订方向无法定稿；P0 前置修复可先行（不依赖选案）。
- 最小问题：批准案 B 吗？若否，选 A 还是 C？

### OD-10 Session↔Run 映射口径

- 问题：原站"chat turn=run"不可证（01 QW-04 I1）；05 时序 1 假设"每 chat turn 一个 Run、Session 1:N Run、看板投影行=session"。是否追认？
- 为什么现有证据不能决定：原站会话视图不显示 run id/attempt（O 级不足）；我方现状 Run(trigger=chat) 支持该口径但非证明。
- 选项：A 每 turn 一 Run（05 假设）；B 每 session 一 Run（turn 为事件）；C 双轨（对话 turn 级+任务 session 级）。
- 默认建议：A（与 C1 现状与 A1 每回合装配语义一致）。
- 代价：A=Run 行数膨胀与看板投影去重规则；B=turn 级取消/预算无锚点。
- 推迟决定的影响：05 §5.5 Session、§7.1 时序、看板投影源设计悬置。
- 最小问题：确认"每 turn 一 Run、Session 1:N Run、看板行=session"吗？

### OD-11 InvocationGraph 深度与环治理阈值

- 问题：跨类型统一深度上限取值（05 GR-5 默认 5，对齐 C1 现有 wf 链上限）；环判定按"定义 id+版本"（同定义不同版本仍判环，更严格）是否接受？
- 为什么现有证据不能决定：阈值为治理参数无外部真值；C1 现状 agent_chain/wf_chain 分列判重、混合深度无统一上限（02 §3 Q3）。
- 选项：上限 5 / 3 / 10；环含跨版本 / 仅同版本。
- 默认建议：上限 5+环含跨版本（fail-closed）。
- 代价：过严误杀合法长链；过宽放大故障半径。
- 推迟决定的影响：发布期静态校验与运行期判重规则无法落码。
- 最小问题：全局深度上限=5 且环按定义 id（含跨版本）判吗？

### OD-12 知识库执行体与冻结粒度

- 问题：知识检索执行体=AgentScope 官方 RAG 服务层（引入其存储/blob 依赖）还是我方现状外部检索端点引用？Release 冻结粒度=引用+状态+检索参数（现状）还是内容/索引 revision？
- 为什么现有证据不能决定：原站知识库运行时注入不可见（01 §4.6 缺口）；官方 RAG 栈与我方 server 职责重叠度见 03 §4.3，取舍属架构选择。
- 选项：执行体=官方 RAG / 外部端点引用；冻结=状态 / 内容 revision。
- 默认建议：一期外部端点引用+最小冻结；官方 RAG 列评估项。
- 代价：官方栈=存储依赖与升级漂移面；外部端点=检索质量与可用性外包。
- 推迟决定的影响：KnowledgeSnapshot 表结构与 Provider 装配契约悬置。
- 最小问题：执行体选外部端点引用、一期冻结维持"引用+状态+参数"吗？

### OD-13 工作空间执行位置与沙箱边界

- 问题：文件/shell 工具执行体在 Provider 容器内（官方 LocalWorkspace 宿主本地语义）还是平台管理的 workspace 服务？本地目录/Git 挂载一期是否只允许平台管理目录（禁任意宿主路径）？
- 为什么现有证据不能决定：原站隔离实现不可见（01）；我方 code-write 非真沙箱教训（02 §4 #3）；两位置各有凭据边界与运维成本。
- 选项：Provider 容器 / 平台 workspace 服务；目录=仅平台管理 / 允许任意宿主路径。
- 默认建议：Provider 容器内+仅平台管理目录起步。
- 代价：容器内=宿主暴露面随挂载扩大；平台服务=多一跳与产物回传契约。
- 推迟决定的影响：WorkspaceBinding、GR-2 高危工具治理、时序 4 闭合悬置。
- 最小问题：执行体放 Provider 容器且一期禁任意宿主路径吗？

### OD-14 记忆写回与晋升链路

- 问题：运行级记忆→持久 AgentMemory 的写回是否允许 Agent 运行时发起？晋升是否需人工审批+revision？
- 为什么现有证据不能决定：原站"记忆与学习时间线"仅文案级证据（01 QW-09 I1）；写回=持久副作用，治理级别属产品选择。
- 选项：A 一期只读注入+管理面编辑；B 允许运行时写回（审批+revision）；C 自由写回。
- 默认建议：A，B 列 P2。
- 代价：B 需审批队列与 revision 回滚 UI；C 有记忆投毒风险（REJECT 级）。
- 推迟决定的影响：MemoryPolicy 字段与 GR-6 适用范围悬置。
- 最小问题：一期持久记忆只允许管理面编辑吗？

### OD-15 AgentScope app 服务层启用取舍

- 问题：官方 2.0.7 自带 FastAPI 路由/SQL+Redis 存储/分布式 session 锁/ChatService/cron（多副本单点约束）/IM 网关/权限预算 middleware，与我方 server 职责重叠。一期 Provider 是否仅用库层（平台自托管 Session/调度/事件，官方 app 层全关）？
- 为什么现有证据不能决定：官方服务面为 Beta 且示例非生产保证（03 项11）；启用与否改变 Session 持久化地点与调度归属，属架构选择。
- 选项：A 仅库层+平台自托管；B 启用官方 ChatService/storage；C 混合（仅 cron 或仅 session 锁）。
- 默认建议：A。
- 代价：A=平台自研会话锁/调度维护成本；B=接受官方多副本单点约束与未审计服务面。
- 推迟决定的影响：05 §7 M1 控制面分工、Session 持久化地点、04 行 5/9/17 悬置。
- 最小问题：一期 Provider 仅用 AgentScope 库层、官方 app 层全关吗？

### OD-16 AgentFlow 生产接线的 2.0.8 发布闸门

- 问题：pipeline/A2A 仅存于未发布 main（03 §1.3/§4.1；HANDOFF U05：正式版前仅沙箱 spike）。确认"AgentFlow 生产化以平台自建 Runner 为准、不等 2.0.8；官方 pipeline 对象/A2A 仅沙箱 spike 至正式 tag 发布并按 G4 重审"？
- 为什么现有证据不能决定：2.0.8 发布时间表不可知（PyPI 404、无 tag，03 §1）；等与不等是风险偏好选择。
- 选项：A 自建 Runner 不等；B 等 2.0.8 正式 tag 再生产化；C 双轨（自建+官方对象灰度）。
- 默认建议：A（05 提案基线；2.0.7 已够库层装配）。
- 代价：A=官方对象发布后二次对齐成本；B=产品空窗期不可控。
- 推迟决定的影响：升级时 schema 冻结义务（03 项12）与 goal_loop stage 语义来源悬置。
- 最小问题：确认生产化以自建 Runner 为准、官方 pipeline 仅沙箱 spike 吗？

### OD-17 Flow 节点引用 Agent 的方式边界

- 问题：内联 RoleTemplate 与顶层 AgentRelease pin 双引用方式并存：何时必须 pin？内联模板可挂哪些资源（建议仅限 FlowVersion 冻结集内声明）？如何防能力漂移成双事实源？
- 为什么现有证据不能决定：原站 worker resolve 只见 kind='waker'+wakerId（无模板概念，01 QW-13）；双方式的边界是设计选择。
- 选项：A 双方式+模板资源限冻结集；B 仅 pin；C 仅内联模板。
- 默认建议：A（B 牺牲多 role 轻量编排，C 牺牲身份/记忆/挂载复用）。
- 代价：A 需两套冻结校验规则；B/C 各自丢失一侧能力。
- 推迟决定的影响：RoleTemplate schema、MountBinding 主体范围、04 行 13 悬置。
- 最小问题：接受双引用方式且内联模板资源仅限 FlowVersion 冻结集吗？

### OD-18 原站残余证据缺口补查授权

- 问题：知识库详情页、Waker 权限/档案/记忆/自进化 Skill 子页、管理页 Group 页签、设置按钮（两次点击无面板）仍为 EVIDENCE_GAP；其中权限/档案子页可能改变 04 行 15（Hook）与行 1（Waker 版本/启停语义）的证据基础。是否授权再一轮只读补查？
- 为什么现有证据不能决定：缺口本身即"证据不存在"，只能补查或接受。
- 选项：A 接受缺口按默认建议推进；B 授权一轮只读补查后再定 04 相关行。
- 默认建议：A（相关行已按 DEFER/假设处理），B 列可选。
- 代价：B=一轮浏览器实调时间；A=若权限子页存在强约束则 04 行 1/15 需返工。
- 推迟决定的影响：04 行 1/6/9/10/15 的 EVIDENCE_GAP 标注维持至复核轮。
- 最小问题：接受现有缺口推进，还是先补查一轮？

### OD-19 "Session"措辞边界（v2 第二次追加，来源 06 CF-21/D27 候选）

- 问题：D13/D14 与 HANDOFF §5 不得回退清单里的"Session"指用户可见 Chat Session，还是涵盖非投影状态载体 Session（SINGLE_RUN/FLOW_EPHEMERAL）？05 时序 4 显式创建 SINGLE_RUN 作 AgentState blob 载体，与 D14"无状态单次任务不创建 Session"字面冲突。
- 为什么现有证据不能决定：A1 官方跨进程持久化保证仅在 SessionRecord.state（03 项5），M1 无状态 Provider 又必须有 blob 载体——"豁免 Session"与"Run.audit_state 承载"两案技术上都成立，属拍板字面与架构整洁的取舍，非事实问题。
- 选项：A 界定 Session=用户可见 Chat Session，状态载体豁免（05 案/D27 候选）；B 否决豁免，AgentState blob 改由 Run.audit_state 承载（字面维持 D14）；C 载体更名（如 ExecutionContext）彻底避开 Session 词。
- 默认建议：A，并同轮修订 doc05 §5/doc11 §2.5/doc12 §5/HANDOFF 闸门 4 措辞（06 附录 CF-21 已备新文本草案）。
- 代价：A=四档措辞修订+不得回退清单更新；B=Run 表加 audit 态字段且丢失与官方 SessionRecord 语义对齐；C=新词与官方命名碰撞（TERMINOLOGY_COLLISION 风险）。
- 推迟决定的影响：05 §5.5/§7.1/§7.4、Session 四分类表与 CF-21 修订无法定稿；连带 OD-10/OD-15。
- 最小问题：Session 界定为用户可见 Chat Session 并豁免状态载体吗（否则选 B 或 C）？
