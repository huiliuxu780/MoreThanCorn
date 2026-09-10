# 05 · 目标架构候选与强制对比（阶段 5 · 提案）

> 日期：2026-09-08 · 状态：`RESEARCH_ONLY` / 设计建议（`D1`）
> 性质声明：本文件是提案，不是实施基线。按任务书 R5，在收到 `ACCEPTED_FOR_DOC_REVISION` 前不得据此启动 P0 代码工作。所有 D1 建议均列替代方案（§2 三案）、成本（§3.3）与未决项（§9）。
> 证据引用约定：`O1/O2`→01 的 QW 步骤+截图；`C1`→02 的章节/链/断点编号（行号以 HEAD f6824f9 为准）；`A1`→03 的条目编号（[L2.0.7]=已发布实装版，[DEV]=2.0.8-dev@ff8697ec 未发布）；`I1`=推断；`D1`=本提案设计建议。
> 版本基线（A1，03 §1）：实装并 pin `agentscope==2.0.7`（PyPI registry）；"2.0.8"仅存在于官方 main@ff8697ec（PyPI 404、无 tag，最新为 2.0.7.post1）。本提案的编排执行器为平台自建，生产路径不依赖未发布的 pipeline 模块；仅可选的 goal_loop 官方对象复用受发布闸门约束（§9 OD-16）。

> **主审计者后续处置（2026-09-08，二次纠偏）**：本文件的 O/C/A 研究证据继续有效，但架构建议整体停止使用。此前“平台自托管服务层”“非 Chat 不使用 AgentScope Session”“ExecutionState 复制 AgentState”“自建 RunEvent/Trace 投影”“自建 AgentFlow Runner 为既定方案”等均与全面采用 AgentScope 冲突。新的权威边界见 `10-agentscope-native-adoption-and-replica-decision.md`。后续必须重写主设计稿，不得从本文件的旧时序和实体表选择性摘抄。

## §0 硬前提与工作假设

### 0.1 既有拍板（不得违背，07 v1 头部+任务书）

1. AgentScope 为唯一运行时底层（09-08 拍板；02 §0.2 runtimes/README "sole runtime"）。
2. 市场制不照搬；IM 渠道不抄；CoT 不外露（任务书 §1.1/§8）。
3. 任务三义分离，不得合并建表（任务书 §1.3）。
4. 2.0.8 正式版前只允许沙箱 spike（AUDIT-HANDOFF U05 口径，经 03 §1.5/§4.1 复核仍成立）。

### 0.2 07 v1 未决项：仅以默认建议为工作假设（未拍板）

| OD | 默认建议（工作假设） | 本文件受影响段落 |
|---|---|---|
| OD-01 选择性重做级别 | B：run 级重跑+失败阶段起续跑；C（任意节点）P2 gated | §5 Continuation、§6 GR-5、时序 2 E6 |
| OD-02 事件触发一期 | B：随 doc12 S1 落 webhook 事件入口 | §5 TriggerBinding、时序 2 E1 |
| OD-03 Flow 作用域 | A：仅全局起步，schema 留 scope 字段 | §5 AgentFlowDefinition |
| OD-04 挂载语义 | C：引用+可选 pin（MountBinding 带可空 version） | §5 MountBinding、§6 GR-4 |
| OD-05 AgentFlow 编辑器 | C 一期：画布源+脚本只读契约视图；B/D 后续 | §5 AgentFlowDefinition/Version、时序外（UI 层） |
| OD-06 实例/主机维度 | C：Run 记 worker 标识，不建实例实体 | §5 Run |
| OD-07 看板行粒度 | A：看板=run/session 投影，管理页=定义级 | 时序 1/2/4 前端行 |
| OD-08 automation target | A：三型全开（agent/agent_flow/workflow）+强制 pin | §5 ExecutionTarget、时序 2 |

若用户拍板与假设不同，上述段落按 §9 各条目注明的受影响范围修订；本文件不代替拍板。

### 0.3 共同事实基座（三案共享，不因选案而变）

- 我方唯一全通的执行事实层：Run/NodeRun/RunEvent/CallRecord+SSE 重放+/trace 谱系树（C1 02 §5 链3）；TaskRun 冻结/幂等/Outbox/对账（C1 02 §3 Q8、链4）。
- 我方运行环境级断链（三案共同 P0 前置，C1 02 §0.2/§0.3）：8301–8303 不可达；active Release 全绑退役 Provider；AgentScope Provider health=error 零绑定。不修复则任何案都是纸面架构。
- AgentScope 官方保证边界（A1 03 §3.1/§3.2）：会话级持久化（SessionRecord.state: AgentState）、HITL/interrupt/cancel 契约、事件 union、structured output、Task 计划项工具为官方提供；多 stage/并行/barrier/选择性重做/pipeline 持久化/pipeline 服务层托管/Flow 版本化/平台任务体系/schema 迁移框架为平台必须补齐。

## §1 三案定义（按任务书 §8 复述，不预设为既定事实）

- **案 A · Pipeline 仅 AgentVersion 内部配置**：Agent 是唯一顶层资产；PipelineDefinition 跟随 AgentVersion 冻结（= doc11 现状形态，任务书 §9 提及）；自动任务只能选 Agent/Workflow；Agent 内部决定是否走 Pipeline。
- **案 B · AgentFlow 一等版本化资产**：Workflow 与 AgentFlow 是两个独立 Flow 产品，各有定义/版本/编辑器/发布生命周期；AgentFlow 由平台自建 Runner 按 AgentScope 事件契约驱动（PipelineProtocol 为形状参照，A1 03 项1）；Automation 可直接指向 Agent、AgentFlow 或 Workflow；Agent 可把 AgentFlow 当受治理工具调用；AgentFlow 可把 Agent/内部 role 当节点调用；二者共用 Run/ChildInvocation/Event/Policy/Release/Outbox 执行事实（任务书 §1.2）。
- **案 C · 统一 FlowDefinition + engine type**：一个 Flow 产品；workflow/pipeline 只是 engine type 字段；共用编辑器和版本模型；现有 Workflow 迁入统一模型。

## §2 强制比较矩阵（13 维度 × 3 案，每格=结论+证据）

> 判级用词：优/良/中/差（相对三案）。每格附证据引用；无证据的判断显式标 I1/D1。

| # | 维度 | 案 A | 案 B | 案 C |
|---|---|---|---|---|
| 1 | 用户心智 | **差**。用户看不到 Flow 独立对象；自动任务无法"运行一个 Flow"——与原站执行方式两型 radio（Waker｜WakerFlow）直接冲突（O1 QW-06，auto-01）；多 role flow 无归属主体：原站 flow 为账号级资产（scope.kind='global'，O2 QW-15 upsert 契约）且 worker 可解析到非属主 Waker（O1 QW-13），塞进单个 AgentVersion 无产品语义 | **良**。与原站 IA 同构：资产列表两处（Waker 管理/资源-WakerFlow，O1 QW-08/11）；我方用户已有"Workflow 列表+详情+运行记录"心智（C1 02 链3 前端段），AgentFlow 同构新增，学习成本低（I1） | **中**。单一 Flow 列表+engine type 徽标：用户须理解"引擎类型"这一实现级概念才能预测行为（I1）；原站无此先例（O：原站只有 WakerFlow 一种 flow 产品，00 §2） |
| 2 | 与 QoderWake 高保真程度 | **低**。缺 automation→Flow 目标（O1 QW-06）；Flow 触发 1 配置多方式（O1 QW-15，flow-05）无资产锚点；对话式生成会话回写 generationSessionId（O2 QW-15）无归属定义对象 | **高**。一等列表/详情/画布+脚本/run 级记录/触发配置/对话式生成全部有资产位承载（O1/O2 QW-11～15）；双作用域表象可按 OD-03 收敛为 global 起步+scope 预留 | **中高**。交互面可全部复刻，但"两个 flow 入口合一"与原站信息架构（WakerFlow 独立于任何 workflow 概念）不同构（O：原站无统一 flow 产品，00 §2/§4） |
| 3 | 与现有 Workflow 兼容 | **良**（对 Workflow 零改动）。但 Agent↔Workflow 挂载断点仍须单独修（C1 02 §2.4 断点⑥），且案 A 下该断点无 Flow 资产可挂 | **良**（对 Workflow 零改动：不迁移不合并；增量=Trigger target union 扩枚举+InvocationGraph 统一，均为加法，C1 02 链3 基座不动） | **差**。workflow/workflow_version 须迁入 flow_definition+engine type 或维持兼容双轨=新双事实源（I1，基于 C1 02 §1 Q4 双事实源教训）；9 个 workflow/266 真 Run 是活资产（C1 02 §0.3），链3 是当前唯一全通链（02 链3 判定），重构回归风险直接命中最完整资产 |
| 4 | AgentScope 2.0.8(-dev) 映射自然度 | **中低**。官方 pipeline 是"组合多个独立 Agent 实例"的运行时对象：GoalPipeline(executor, verifier) 两 Agent 各有 AgentState/reply_id 路由（A1 03 项2/项8）——塞进单 AgentVersion 后"谁持有会话与状态"含混（I1）；跨 Agent 引用的 flow 更无解（O2 QW-15 global scope） | **良**。FlowVersion↔平台自建编排定义（官方无定义序列化格式，A1 03 §3.2"Flow 级版本/发布/回滚缺失"⇒ 三案都须平台发明，B 给它独立资产位）；role↔Agent=官方装配单元（A1 03 项5/项7）；事件流按 reply_stream 契约统一映射（A1 03 项1/项9）；GoalPipeline 契约形状（_ExecutionReport/_VerificationResult/pass\|fail\|impossible，A1 03 项2）可直接借为 goal_loop stage 语义参照而不依赖其内存对象 | **中**。统一编辑器 schema 须同时表达 DAG jsonb（C1 02 链3 现状）与 pipeline stage/role——官方两侧都无定义格式（A1 03 §3.2），统一抽象纯平台发明，发明面最大（I1） |
| 5 | 版本和 Release | **中**。复用 AgentVersion 冻结（C1 02 链1）但 flow 变更强制 Agent 升版发布=耦合；跨 Agent 复用同一 flow 时多 AgentVersion 各存一份=版本漂移与双事实源风险（I1，类比 C1 02 §1 Q4 教训） | **良**。复制我方最强已证模式：草稿乐观锁→发布快照→版本冻结运行（C1 02 链3）；FlowRelease 与 AgentRelease 对称（C1 02 §1 Q3 models 399-415 模式）；digest/outputSchema/stage 冻结对齐原站 upsert 契约语义（O2 QW-15） | **中低**。须为两种 engine 统一版本模型：迁移现有 WorkflowVersion 发布语义（C1 02 workflows.py:175-229 段）或双轨并存；统一版本模型的 schema 在官方无稳定性承诺下（A1 03 项12）漂移面更大（I1） |
| 6 | 双向调用（Agent↔Flow） | **差**。原站双向通道实证：Waker 工具面 list_wakerflows（O2 QW-04）+flow worker resolve waker（O1 QW-13）。案 A 下 Agent→Flow=调用自己/他人内部配置：跨 Agent 调用实为 Agent→Agent，Flow 不可见、不可 pin、不可预算（I1）；治理（mount/pin/预算）无 Flow 级锚点，安全纠错第 4 条无法落地 | **良**。Agent→AgentFlow=mount+pinned 工具（GR-4 可落地）；AgentFlow→Agent=节点引用 AgentRelease pin 或内联 role 模板；双向都落 ChildInvocation 同一谱系边（§5/§7 时序1、3） | **良**。同案 B，另获 flow↔flow 同型调用便利（统一 engine 注册表）；但统一调度器须同时理解两种 engine 的调用语义（I1 成本） |
| 7 | 父子 Run 与事件 | **中**。flow 阶段无独立 Run 锚点（阶段≠Run）：看板/trace/事件投影粒度粗，阶段级状态只能塞进单 Run 的 NodeRun 类似物（I1）；官方无父子 Run 概念（A1 03 §3.2），平台自建时锚点缺失 | **良**。FlowRun=一等 Run；stage/role=ChildInvocation+子 Run——与现有 workflow 子 Run 模式同构（C1 02 runner 631-661 段）；/trace 谱系树直接扩展（C1 02 链3 返回段） | **良**（同 B）。统一引擎下父子关系同构；额外成本=事件模型须覆盖两种 engine 的阶段语义（I1） |
| 8 | 选择性重做 | **差**。官方无选择性重做（A1 03 §3.2；GoalPipeline 仅整体反馈重迭代，03 项2）；阶段状态在 AgentVersion 内部 pipeline 且官方对象状态纯内存（A1 03 项4）⇒ 重做锚点无资产级 ExecutionState 归属；要外置状态=事实上重新发明案 B（I1） | **良**。ExecutionState/Continuation 挂 FlowRun+FlowVersion：stage id 稳定性由版本冻结保证（C1 02 链3 发布快照模式）；origin_run_id 谱系已有先例（C1 02 链4 重试段）；按 OD-01 假设 B（失败阶段起续跑）落地 | **中**。统一重做语义须覆盖 DAG 节点与 pipeline stage 两种形态；一期只能对一种 engine 实装=名义统一实际双轨（I1） |
| 9 | 权限/预算/环检测 | **中**。Policy 挂 AgentVersion（module policies 常量模式已有，C1 02 §1 Q3 base.py:88-96）但 flow 级预算/深度无独立锚点；环检测：agent 链判重已有（C1 02 §3 Q3）但 flow 不可见⇒"flow 经 agent 回环"不可检（I1） | **良**。FlowVersion 声明预算+深度+发布期静态引用闭合校验；InvocationGraph 单树统一跨类型记账——修复 C1 02 §3 Q3 I1 缺口（agent_chain/wf_chain 分列判重、混合深度无统一上限）；预算分配树=ChildInvocation 树（§6 GR-5、时序闭合表） | **中高**。同样可统一，且引擎无关 Policy 模型一步到位；但抽象须同时覆盖 DAG 节点级与 stage 级权限，设计面更大（I1） |
| 10 | 前端复杂度 | **低投入但低达成**。无新编辑器；但原站 flow 详情 richness（画布+脚本+run 记录+触发+对话面板，O1 QW-12/15）无资产位承载，塞进 Agent 工作区=单页过载（I1） | **中高**。新 Flow 列表/详情/编辑器/run 视图四件套；按 OD-05 假设 C（复用 xyflow 画布资产+脚本只读视图，C1 02 链3 设计器现状）控制增量；对话式生成（原站 O1 QW-15）列后续（OD-05 D 项） | **中**。一套编辑器壳，但须改造为 engine 双模：xyflow 画布对 DAG 可复用、对 pipeline stage 视图仍需新组件，壳内复用有限（I1） |
| 11 | 数据迁移 | **小**。AgentVersion.definition 加字段（C1 02 §1 Q3 冻结分支扩展）；无新顶层表 | **小中**。全新增表（additive）：AgentFlowDefinition/Version/Release+MountBinding 收敛+trigger union 扩枚举；Workflow 零迁移；存量 Run 零改写 | **大**。workflow/workflow_version→flow_definition 迁移或兼容双轨；266 Run/9 workflow 活数据（C1 02 §0.3）；runner EXECUTORS 全家族重构回归（C1 02 §6.1 生产路径表） |
| 12 | 未来扩展 | **差**。跨 Agent 复用、A2A 远端节点（A1 03 §4.9）、team 异步 role（A1 03 项3）都无资产锚点；每加一项 flow 能力都撞 AgentVersion 墙（I1） | **良**。AgentFlow 可渐进吸纳：A2A 节点型、team 异步 role 型、goal_loop stage 型（官方对象发布后，OD-16）；与 Workflow 对称，doc12 事件驱动工单（07 OD-08 提及 flow 骨架路线）可择一承载 | **良（远期）**。统一 engine 注册表长期优雅；但在官方 schema 无稳定性承诺期（A1 03 项12：46 commits/174 文件漂移）过早统一=统一层反复重构（I1） |
| 13 | 锁定成本和回滚 | **锁定最低、回滚最易**（删配置字段即可）——但锁死产品语义（无 Flow 目标），后续转 B=二次迁移已配置的 pipeline 定义+已运行历史（I1） | **中**。新资产线可独立停用/回滚（停建 FlowRelease 即冻结增量，Workflow 与存量 Run 不受影响）；锁定=自建编排 Runner 的持续投入（A1 03 §3.2 补齐清单为固定成本，三案共有，B 只是给它资产位） | **高**。统一化触及唯一全通链（C1 02 链3 判定"通"），回滚需逆向迁移；锁定=统一模型把两种 engine 耦死，官方漂移时统一层与 Workflow 存量同时暴露（I1） |

### 2.1 维度优势汇总（公平性声明）

- **案 B 占优（8 维）**：1 用户心智、2 高保真、4 映射自然度、5 版本 Release、6 双向调用（与 C 并列）、7 父子 Run（与 C 并列）、8 选择性重做、9 权限/预算/环（C 略高于 B 的抽象一步到位，但 B 落地成本更低）。
- **案 A 占优（3 维）**：10 前端复杂度（最低投入）、11 数据迁移（最小）、13 锁定成本和回滚（最低锁定）——代价是 1/2/6/8/12 五个维度的产品与治理能力缺失，且其"低锁定"以"锁死产品语义"为代价（维度 13 格内已注明）。
- **案 C 占优（2 维）**：6/7 与 B 并列且获同型调用便利、12 远期统一优雅——代价是 3/11/13 三个维度对唯一全通链（Workflow）的迁移与回归风险，以及在官方无定义格式、无稳定性承诺期的最大抽象发明面（4/5）。
- 三案共同成本（不因选案消失）：官方 §3.2 补齐清单（编排/状态外置/服务层托管/事件映射/schema 冻结）+ 运行环境断链修复（§0.3）。

## §3 推荐结论：案 B（AgentFlow 一等版本化资产）——D1，待用户拍板（§9 OD-09）

### 3.1 推荐依据（G5 要求：同时具备 O1/O2、C1、A1 三类证据）

**O 类（原站，产品职责证据）**
1. 自动任务"执行方式"radio 两型=交给 Waker｜运行 WakerFlow（O1 QW-06，auto-01-create-dialog-top.png）：Flow 在原站是**独立于单个 Agent 的执行目标**——案 A（自动任务只能选 Agent/Workflow）与该 O1 事实直接冲突。
2. upsert 契约 scope.kind='global'+独立 id/digest/version/generationSessionId（O2 QW-15，flow-07.png）：Flow 是**账号级一等资产**，非某 Waker 的内部配置；worker resolve 可指向非属主 Waker（O1 QW-13，flow-03.png）进一步排除"单 AgentVersion 内部配置"形态。
3. Waker 运行时工具面含 wakerflow 插件（O2 QW-04，tb-01.png：list_wakerflows 响应 wakerId 与路由互证）：Agent→Flow 是**运行时真实通道**，需要可 mount、可 pin、可预算的 Flow 级治理锚点——只有案 B/C 提供；案 C 的等价能力以对唯一全通链的迁移为代价（§2 维度 3/11/13）。

**C 类（我方代码，可行性与教训证据）**
4. Workflow 链是平台唯一全通链（C1 02 §5 链3：草稿乐观锁→发布快照→版本冻结运行→事件/Trace/SSE，DB 266 真 Run）：案 B 的 AgentFlowVersion/Release **复制同一已证模式**，工程风险最低；案 C 要求迁移/重构这条链本身。
5. Skill 断链教训（C1 02 §2.1/链2：Release snapshot 与 Contract 不含 Skill、config.skills 双事实源）：**"挂载物没有独立版本化快照资产"是我方已付过学费的双事实源成因**——案 A 把 flow 定义塞进 Agent.config/definition 恰是同一模式的复刻风险（§2 维度 5）。
6. 混合深度无统一上限、agent_chain/wf_chain 分列判重（C1 02 §3 Q3+I1）：双向调用治理需要 InvocationGraph 单树——该重构在案 B 下是加法（新 ChildInvocation 边表），在案 C 下与引擎统一重构叠加。

**A 类（AgentScope 官方，契约边界证据）**
7. pipeline 契约面极小且零治理：PipelineProtocol 仅 reply_stream 一个方法形状（A1 03 项1）；Run/ChildInvocation/attempt/预算/权限/审计/取消传播/持久化全部不在契约内（A1 03 §4.2）⇒ **Flow 产品语义必然由平台层定义并自证**（三案共有），差别只在这层自建语义有没有独立的冻结锚点——案 B 给它 Version/Release/ExecutionState 的资产归属。
8. GoalPipeline 状态纯内存、无序列化、未接入 create_app（A1 03 项4/项10）：跨进程可恢复的只有会话级 AgentState（A1 03 §4.5）⇒ FlowRun 的阶段状态必须平台外置（ExecutionState，§5）；外置状态需要与某个版本化定义对齐 stage id——案 A 下该定义寄生于 AgentVersion，flow 变更与 Agent 升版耦合（§2 维度 5/8）。
9. 官方无 schema 稳定性承诺（A1 03 项12：Beta+46 commits/174 文件漂移）：**独立资产+冻结快照+mapping_version 是对冲官方漂移的最小结构**；案 C 的统一模型把 Workflow 存量也暴露进同一漂移面（§2 维度 5/13）。

**一句话理由**：原站 O2 证据证明 Flow 是独立于单 Agent 的一等执行目标，我方 C1 唯一全通链给出可复制的"版本→发布→冻结运行"模板，A1 证明官方 pipeline 零治理零持久化、平台必须自建一个可独立冻结的资产锚点——三类证据的交集只落在案 B。

### 3.2 案 B 结构摘要（对应任务书 §8 案 B 五条）

1. Workflow 与 AgentFlow 两个独立 Flow 产品：不迁移、不合并（Workflow 保持 C1 链3 现状+两处小修，§4.3）。
2. AgentFlow 由 AgentScope 事件契约驱动：**编排执行器=平台自建 AgentFlow Runner**（新 job 类型，与 workflow-execution/task-run 同构，C1 02 runner _dispatch_job 模式）；role 执行=Provider 内 AgentScope Agent 装配（A1 03 项5/项7 每回合装配语义）；不使用官方 GoalPipeline 内存对象承载跨 job 状态（A1 03 项4 缺陷），仅借其契约形状定义 goal_loop stage（A1 03 项2）。
3. Automation 可直接指向 Agent、AgentFlow 或 Workflow（ExecutionTarget union，OD-08 假设 A+强制 pin）。
4. Agent 可把 AgentFlow 当受治理工具调用（mount+pinned+平台代执行，GR-4；时序 1）。
5. AgentFlow 可把 Agent（AgentRelease pin）或内联 role 模板当节点调用（ChildInvocation+InvocationGraph，GR-5；时序 1/2；内联模板保证"role 不被强制注册成顶层 Agent"，G5 条款）。
6. 二者共用执行事实：Run/ChildInvocation/RunEvent/PolicySnapshot/Release 模式/CommandOutbox/InvocationGraph/看板投影（任务书 §1.2 要求，§4.3 清单）。

### 3.3 案 B 的成本、P0 前置修复与"不解决什么"（D1 义务：列成本与未决）

**成本**
- 自建 AgentFlow Runner（编排/状态外置/事件映射/续跑）为持续投入——该成本三案共有（A1 03 §3.2），案 B 的增量是资产三件套（Definition/Version/Release）+新前端四件套（列表/详情/编辑器/run 视图，OD-05 假设 C 控制编辑器增量）。
- 第二个 Flow 产品带来的术语与 IA 负担（须在 06 冲突审计中对 doc05/doc08/doc11/doc12 逐段收敛，本轮不改 docs）。

**P0 前置修复清单（不修则三案皆空转；均为 C1 已证缺口）**
1. 运行环境活链路：Provider 可达+active Release 重绑存活 Provider+AgentScope Provider 健康（C1 02 §0.2/§0.3）。
2. adapter cancel 真实现（现状 no-op，声明与实现不符，C1 02 §1 Q7）——取消传播（§7 各时序）依赖此项。
3. runtime_contract 扩展：请求/响应携带 session_state（AgentState blob+schema_version）、skills 载荷、事件映射表 mapping_version 冻结（C1 02 §2.1 断点⑥、contract models.py:66-74；A1 03 项12）。
4. api 触发真端点+token 鉴权（声明存在、接线不存在，C1 02 §3 Q6）。
5. workflow-exec 子调用 pin 策略（不 pin 版本=草稿漂移风险，C1 02 链3 薄弱点）。
6. Skill 单事实源迁移：废弃 config.skills、agent_skill 为唯一挂载表、SkillVersion 入快照（C1 02 §1 Q4-1、链2）。
7. 僵尸 run 回收：TaskRun/Run 级 stale 回收 job（现状仅 job 租约回收，C1 02 链4 判定+§0.3）。

**案 B 不解决的（明确不在推荐范围内）**
- 官方 app 服务层取舍（OD-15）：时序按"平台自托管服务层"假设闭合，若拍板启用官方 ChatService/storage，Session 持久化地点与调度单点约束（A1 03 §4.4）需按 §9 条目修订。
- Flow 内模型驱动的动态分支：一期 stage 间控制流静态声明（§4.2 判定规则），动态分支列 P2（防不可治理，I1）。
- 多副本编排吞吐与公平调度：Runner 复用现有 JobQueue/advisory lock 选主模式（C1 02 链4 触发段），未做专门压测设计。
- Group/IM/市场/CLI/Hook：04 行 6/17/7/16/15 的 DEFER/REJECT 结论不因案 B 改变。

## §4 Workflow 与 AgentFlow 职责边界（G5 条款：不靠一句"一个硬一个软"区分）

### 4.1 边界表

| 判据 | Workflow（保持现状产品） | AgentFlow（新产品，案 B） |
|---|---|---|
| 产品职责 | 确定性业务/数据编排：数据读取→过滤/变换→外写/投递的 DAG 流水线 | LLM role 编排：多 role 交接、审查/质检/生成类目标、结构化终态产出 |
| 节点执行体 | 平台内置执行器（data read/filter/transform/write、mcp-call、knowledge-retrieval、notification、agent 节点、子流程节点；C1 02 §6.1 EXECUTORS 全家族） | Agent（顶层 AgentRelease pin）或内联 role 模板；stage 类型一期=串行/声明式并行/goal_loop（executor+verifier 循环，语义参照 A1 03 项2） |
| 控制流来源 | 静态 DAG（边+条件均为数据，C1 02 链3 图校验） | FlowVersion 静态声明 stage 序列/并行组；模型输出影响 stage 内部行为，**不**在运行时改写 stage 间控制流（一期） |
| 事实源与版本 | DAG jsonb 草稿（乐观锁）→WorkflowVersion 发布快照（C1 02 workflows.py:175-229 段） | 画布图（OD-05 假设 C 一期为源）+脚本只读契约视图→AgentFlowVersion 快照（digest/stage/role 引用集/outputSchema/PolicySnapshot）；对话式生成列后续（O：原站对话式为创建主路径，QW-15/flow-06，我方按 OD-05 分期） |
| 终态契约 | end 节点输出+OutputBinding/目标表（C1 02 链4 OutputBinding 段） | outputSchema 结构化终态**必填**（采纳 O1 QW-13 meta.outputSchema 语义）+平台终态前二次校验（C1 02 worker.py:412-423 模式） |
| 状态与恢复 | NodeRun 节点级+wait-review 挂起/resume（C1 02 链3 Worker 段） | ExecutionState stage 级外置（每 stage 终态即写，补 A1 03 项4 缺口）+Continuation 续跑（OD-01 假设 B） |
| 触发面 | POST /api/runs、schedule（版本 pin 解析，C1 02 create_run:1706-1731）、TaskRun 批量 | AutomationDefinition（三型 target 之一）、Agent 受治理工具调用、手动运行=调试不计入累计（采纳 O1 QW-07 语义） |
| 批量语义 | TaskRun 批次归此轨道（数据窗口/采样/逐条 Run，C1 02 链4） | 不承载批量：Automation 单发→FlowRun 直连（三义分离，§0.1-3） |

### 4.2 判定规则（新需求放哪条轨道）

1. 节点输出是否确定性可复现（同输入同输出、可静态 schema 校验）？是→Workflow 节点。
2. 是否需要模型推理产生内容、跨 role 交接、或"产出-验证"循环？是→AgentFlow stage。
3. 混合？→Workflow 作骨架，嵌 agent/agent_flow 节点（时序 3 模式；与 07 OD-08 提及的 doc12 flow 骨架路线兼容），**不得**在 AgentFlow 内复刻数据管道执行器、也不得在 Workflow 内复刻 role 编排。
4. 批量/数据窗口/外写投递为主干→Workflow+TaskRun；对话式/生成/审查为主干→AgentFlow。

### 4.3 共用执行事实层（任务书 §1.2：两个 Flow 不成为两个运行事实体系）

Run（唯一执行事实表，C1 02 §3 Q7）· ChildInvocation（跨边界谱系边，新增，两轨道同表）· RunEvent（双通道+mapping_version）· InvocationGraph（root_run_id+invocation_path 单树，统一环检测/深度，GR-5）· PolicySnapshot（预算/超时/权限，三主体 Agent/Flow/Automation 同构冻结）· Release 模式（版本→环境部署对称：AgentRelease/FlowRelease/WorkflowVersion pin）· CommandOutbox/ResultDelivery（GR-6）· 看板投影（WorkItemProjection 多源化，04 行 3）。

## §5 案 B 候选模型职责清单（任务书候选清单逐项；命名非最终）

> 动作口径：复用=现有表/机制原样承载；扩展=现有表加字段/枚举；新增=新实体；重构=收敛既有断链/双事实源。全部 C1 引用指 02 对应章节。

### 5.1 Agent 资产线

| 实体 | 职责 | 动作与现状 | 关键契约/证据 |
|---|---|---|---|
| AgentDefinition（≈现 Agent 表） | 可变身份+草稿配置（乐观锁）+环境部署指针（sandbox/prod）；**不承载运行事实、不承载 flow 定义** | 复用（C1 §1 Q1 models.py:354-378）；重构：废弃 config.skills/config.connections/config.workflows 死数据与双事实源（C1 §1 Q4），挂载全部迁 MountBinding；Custom 发布链补全（C1 §1 Q2 断点） | artifact/revision 乐观锁模式保留 |
| AgentVersion | 不可变快照：definition+common_config+dependency_snapshot+artifact_hash | 复用+扩展（C1 §1 Q3）：dependency_snapshot 新增依赖类型 SkillVersion/MCPServerVersion/AgentFlowRelease（Agent 挂载 Flow 时）/WorkspaceBinding/MemoryPolicy/KnowledgeSnapshot | 冻结粒度=引用+版本，不冻内容本体（C1 §1 Q3 I1 现状延续；Knowledge 粒度随 OD-12） |
| AgentRelease | 版本→环境部署（canary/provider 绑定/runtime_binding_snapshot） | 复用（C1 §1 Q3 models.py:399-415+agents.py:445-504 约束组）；P0 前置：active Release 重绑存活 Provider（C1 §0.3） | ONE_PROVIDER_PER_AGENT 约束保留 |

### 5.2 AgentFlow 资产线（全新增）

| 实体 | 职责 | 动作与现状 | 关键契约/证据 |
|---|---|---|---|
| AgentFlowDefinition | Flow 身份+草稿（画布图源，OD-05 假设 C；脚本只读契约视图由图生成）+scope（OD-03 假设：global 起步+字段预留）+current 指针+generation_session_id 回写（对话式生成上线后） | 新增；语义对齐原站 upsert 契约（O2 QW-15：id/name/digest/version/scope/generationSessionId） | 草稿乐观锁复制 Workflow 模式（C1 链3 baseRevision 409） |
| AgentFlowVersion | 不可变快照：stage 序列/并行组声明+role 引用集（AgentRelease pin 或内联 role 模板，OD-17）+输入映射+outputSchema（必填）+PolicySnapshot+depth_budget+digest | 新增；发布快照模式复制 WorkflowVersion（C1 workflows.py:175-229 段）；发布期静态校验=引用闭合+环+深度预算（GR-5） | stage id 稳定性是 Continuation 的前提（§5.4） |
| AgentFlowRelease | 版本→环境部署；Automation/mount/工具调用**只能指向 Release**（或显式 latest_prod/latest_sandbox 策略，复用 C1 AutonomousTaskEditor versionPolicy 口径） | 新增；与 AgentRelease 对称 | 采纳 O：原站"运行"面向发布态 flow（O1 QW-12 头部运行控件）；pin 语义为我方强制（原站无 version 字段表象不抄，O1 QW-13+安全纠错 4） |
| （内联）RoleTemplate | FlowVersion 内部的纯数据 role 定义（system_prompt/model/allowlist/输出 schema），不建顶层 Agent、不进 Agent 列表 | 新增（FlowVersion 子结构）；形态参照官方 SubAgentTemplate"纯数据可序列化"（A1 03 项3） | G5 条款"内部 role 不强制注册顶层 Agent"的落点；冻结点唯一=FlowVersion（防双事实源，C1 §1 Q4 教训） |

### 5.3 Workflow 资产线（不动）

| 实体 | 职责 | 动作与现状 | 关键契约/证据 |
|---|---|---|---|
| Workflow / WorkflowVersion | 确定性 DAG 编排的定义与发布快照 | 复用，零迁移（C1 链3）；两处小修：workflow-exec 强制 pin 声明（P0-5）、agent 系节点按既有 deprecated+/migrate 路线收敛（C1 §3 Q2） | EXECUTORS 全家族+图校验+版本冻结原样保留 |

### 5.4 自动化与执行事实线

| 实体 | 职责 | 动作与现状 | 关键契约/证据 |
|---|---|---|---|
| AutomationDefinition | 自动任务定义=TriggerBinding 集+ExecutionTarget+prompt/参数+WorkspaceBinding+policy 五元组（O1/O2 QW-06/07 语义）；**定义非执行实体**。policy 至少包含 `max_runs`（null=无限）与 `deadline_at`（null=永不截止） | 重构/泛化自 AnalysisTask/TaskVersion（C1 §3 Q5 分层保留）：批量数据窗口场景仍走 TaskVersion/TaskRun；单发自动化直连 Run | 手动调试运行不计入累计/不更新最近触发；累计达到 `max_runs` 后定义自动转 `paused`，到达 `deadline_at` 后不再物化新 fire（采纳 O1 QW-06/07 语义） |
| TriggerBinding | 每定义 1..N 触发方式（上限策略我方定，原站 1/5 为表象不照抄）：schedule（occurrence+fire_key 幂等，C1 链4）｜api（token+Idempotency-Key，P0-4 补端点；atk_ 型 token 内嵌 URL 表象不抄——token 走 KMS secret_ref，C1 §2.6 模式）｜event（OD-02 假设 B 随 doc12 S1）｜manual_debug | 重构（schedule 复用）+新增（api/event 接线） | 一个自动任务=一份自动运行配置+多触发方式（采纳 O1 QW-06/flow-05 文案级契约） |
| ExecutionTarget | union{agent_release, agent_flow_release, workflow_version}+版本策略（pinned｜latest_prod｜latest_sandbox） | 新增（union 扩枚举；现仅 workflow｜agent，C1 链4 UI 段）；OD-08 假设 A+强制 pin | agent 型 target 必须 Release pin（安全纠错 4 精神；07 OD-08 默认建议同） |
| Run | 唯一执行事实表：所有 trigger（chat/automation/flow/flow_stage/agent_tool/workflow_node/continuation/manual/test/eval）落同一表 | 复用+扩展（C1 models.py:239-279）：加 root_run_id/invocation_path/session_id（可空）/worker 标识（OD-06 假设 C）/audit_state（时序 4） | trigger 枚举与注释同步治理（C1 §3 Q6 注释漂移教训） |
| ChildInvocation | 跨边界调用谱系边（持久化）：kind=AGENT_TO_FLOW｜FLOW_TO_ROLE｜FLOW_TO_AGENT｜WF_TO_AGENT｜AGENT_TO_WF｜FLOW_TO_WF；parent_run/child_run/pinned_ref/预算分配/状态 | 新增；泛化现 call_chain/agent_chain 内存判重（C1 §3 Q3）为持久边；/trace 谱系树扩展此边（C1 链3 返回段） | 双向调用同一事实（G5 条款）；预算分配树=此树 |
| RunEvent | 事件事实：CONTROL｜CONTENT 双通道（C1 models.py:301-319 复用）+mapping_version（AgentScope 事件→RunEvent 映射表冻结版本，A1 03 项9/项12） | 复用+扩展 | THINKING→CONTROL（GR-1）；CustomEvent 型投影（plan_progress 等，A1 03 项9） |
| ExecutionState | FlowRun 阶段状态外置：stage_cursor/每 stage 输出快照（schema 校验后）/迭代账本（goal_loop iters）/retry 计数；**每 stage 终态即写库**，崩溃恢复粒度=stage | 新增；直接补 A1 03 项4 缺口（官方 pipeline 状态纯内存不可恢复） | 恢复=job 重认领+读 ExecutionState 续跑；不使用官方内存对象跨 job |
| Continuation | 选择性重做/续跑锚点：reuse_stages+redo_from+前置校验结果（输出快照存在且 schema 通过/FlowRelease digest 一致/无未完成非幂等 Outbox 命令/深度预算重算）；新 Run 以 origin_run_id 谱系关联 | 新增（OD-01 假设 B）；谱系模式复用 C1 链4 retry origin_run_id | 任意节点重做（OD-01 C 项）gated：须节点声明幂等键后开放 |

### 5.5 会话与状态线

| 实体 | 职责 | 动作与现状 | 关键契约/证据 |
|---|---|---|---|
| Session | 对话容器，四分类：USER_CHAT（用户可见多轮）｜GENERATION（Flow 对话式生成会话，回写 generation_session_id）｜FLOW_EPHEMERAL（role run 临时会话，不用户可见）｜SINGLE_RUN（单次任务临时会话）；持 AgentState blob+agent_state_schema_version+source；仅 USER_CHAT/GENERATION 投影为用户可见会话列表 | 新增（平台表）；语义对齐官方 SessionRecord/SessionSource（A1 03 项5），持久化地点=平台 DB（OD-15 假设：平台自托管；若翻转仅地点变化） | Session↔Run：每 chat turn 一 Run、Session 1:N Run（时序 1 工作假设，OD-10 追认）；chat turn=run 原站不可证（01 QW-04 I1），我方以 C1 现状 Run(trigger=chat) 为据 |
| AgentState | AgentScope 会话级状态容器（context/reply_context/tasks_context/permission_context/middle_context） | 复用官方对象（A1 03 项5）；平台以 **opaque blob+schema_version** 托管：不建平台侧查询语义、不读内部字段（防 schema 漂移，A1 03 项12）；升级=冻结版本对照迁移（平台义务，官方无迁移框架） | HITL 依赖 reply_id 路由（A1 03 项8）——blob 必须随请求/响应完整往返 |
| SessionStatus 投影 | 会话四态（RUNNING/IDLE/AWAITING_PERMISSION/AWAITING_EXTERNAL_RESULT）语义由平台 Run 状态派生（waiting_confirm/waiting_external 等），支撑看板"需要操作"队列（04 行 3） | 新增（派生逻辑）；语义对齐 A1 03 项5 SessionStatus | parked 状态可从持久化 context 推导（A1 03 项5 derive_parked_status），平台按 reply_id 恢复路由 |

### 5.6 资源挂载线

| 实体 | 职责 | 动作与现状 | 关键契约/证据 |
|---|---|---|---|
| MountBinding | 统一挂载表：主体=Agent｜AgentFlowVersion(role)；对象=Skill｜Tool｜MCPServer｜Knowledge｜Workspace｜AgentFlow（作为工具）｜Workflow（作为工具）；带可空 version pin（OD-04 假设 C：引用+可选 pin）；**唯一事实源** | 新增（收敛 agent_skill/config.skills/config.connections/config.workflows 散轨，C1 §1 Q4/§2.1/§2.4/§2.6） | mounts-health 管理面校验模式保留（C1 §2.4）；运行时装配只读 Release 快照内的挂载解析结果 |
| SkillVersion | Skill 内容不可变快照；入 AgentVersion/FlowVersion 冻结；运行时经 Toolkit 注入（skills_or_loaders，A1 03 项7） | 新增（修 C1 链2 断点⑤⑥⑦） | "页面挂载成功≠运行时生效"教训（C1 §2.9）→验收以 Provider 请求含 skills 载荷为准 |
| ToolRef | name+version→ready ToolVersion（C1 §1 Q3 TOOL 冻结模式复用）；扩展 danger_class（GR-2）与 idempotency_class（GR-6/重试策略） | 复用+扩展 | _resolve_tool 须补 Tool.status 检查（C1 §2.2 ⑤ 现状 disabled 也可 FROZEN 的缺口） |
| MCPServerVersion | MCP 配置+discovered_tools 清单在发布时刻的快照（现状 discovered_tools 仅测试面写入，C1 §2.5）；Provider 侧按快照装配 MCPClient（stateful/stateless，A1 03 项7） | 新增（快照化）+接线（修 C1 §2.5 断点⑦：adapter 只连固定 env URL 8200） | 凭据经平台代理或受控注入（OD-13/15 关联；现状凭据不进 Provider，C1 §2.6） |
| KnowledgeSnapshot | Release 时刻冻结 KnowledgeSource 引用+状态+检索参数（topK/scoreThreshold/mode，C1 §2.3 config.knowledgeAdvanced 已有）；内容/索引 revision 是否冻结=OD-12 | 新增（冻结粒度待拍板） | 执行体分叉：官方 RAG 服务层（A1 03 项7）vs 我方外部端点引用（C1 §2.3）——OD-12 |
| MemoryPolicy | 记忆读写策略：是否注入正文/运行级写是否允许/写回持久记忆是否需审批；记忆本体仍 agent_memory+revision | 新增（策略）+复用（本体表，C1 §2.7）；三轨消费收敛为 Release 驱动单注入点 | 写回=持久副作用，走审批（GR-6 精神；OD-14） |
| WorkspaceBinding | 三态（平台管理默认｜本地目录｜项目 Git，采纳 O1 QW-06/g1-09 语义）+会话工作区路径约定（我方命名，采纳 O1 QW-04 的 workers/<id>/workspace/<sid>_<date>/+_output/ 形态）+配额/allowlist 引用+执行位置（OD-13） | 新增（C1 §4 #1 零实现） | 高危面治理见 GR-2；产物交付契约（_output 型，present_files 语义采纳）挂此实体 |

### 5.7 策略与交付线

| 实体 | 职责 | 动作与现状 | 关键契约/证据 |
|---|---|---|---|
| PolicySnapshot | timeout/maxModelCalls/maxToolCalls/token 预算/permission mode/审批规则/depth_budget，随 Release 冻结；三主体（Agent/AgentFlow/Automation）同构 | 复用模式（module policies 常量，C1 §1 Q3 base.py:88-96）+新实例（从代码常量升为可配置冻结项） | 对齐官方预算 middleware 语义（A1 03 项8 ReplyBudgetControlMiddleware）但账本在平台侧 |
| ModelRef | model_key+版本冻结（C1 §1 Q3 MODEL 模式）；凭据永不入快照——经 Connection/env 边界（C1 §2.6/§2.8 现状），目标态凭据跨界方案随 OD-13/15 | 复用+扩展 | 生产无凭据 fail-closed 禁 mock（C1 §6.1 LLM 行） |
| OutputSchemaRef | 结构化终态 schema+sha256 引用（C1 §1 Q3 input/outputSchema 带 sha256 模式复用）；AgentFlow 必填（O1 QW-13 meta.outputSchema）；终态前平台二次校验（C1 worker.py:412-423 模式） | 复用模式+新实例 | structured output 机制=官方 GenerateStructuredOutput（A1 03 项9） |
| CommandOutbox | 泛化副作用命令 outbox：目标表写/webhook/外部 API/通知——幂等键 f(run_id, seq)+原子认领+指数退避+dead_letter+对账 | 新增（泛化）；全部模式已被 ResultDelivery 证明（C1 §3 Q8） | 工具外呼：idempotency_class 决定自动重试资格（GR-6） |
| ResultDelivery | 保持=CommandOutbox 的"结果表投递"特化类；UNIQUE(run_id)+exactly-once creation/at-least-once attempt/目标表 upsert 幂等 | 复用，不重建（C1 §3 Q8 契约注释即事实） | TaskRun.delivery_status 独立于执行 status 的口径推广到 FlowRun/Automation（GR-6） |

## §6 强制安全纠错六条 → 具体治理规则（GR-1..6）

> 每条：表象（证据）→ 规则 → 机制落点 → 验证方式。规则为 D1，机制落点引用 C1/A1 既有契约。

### GR-1 · CoT 不外露（纠错第 1 条）
- 表象：原站对话与 flow 生成会话展示"深度思考"全文（O1 QW-04/QW-15，tb-01/flow-07.png）；既有拍板禁抄。
- 规则：THINKING_BLOCK_* 事件一律映射 RunEvent.channel=CONTROL；前端 CONTENT 投影白名单={阶段/进度、工具调用卡（名称+参数摘要+结果摘要）、决策摘要、结构化结果、执行计划项}；CONTROL 仅"审计视图"权限点（run:audit）可见。
- 落点：事件映射表（mapping_version 冻结，§5.4 RunEvent）；THINKING_BLOCK 属官方事件 union（A1 03 项9）故映射必然发生，白名单在投影层强制；双通道字段现成（C1 models.py:301-319）。
- 验证：投影层白名单快照测试+run 详情 UI 断言（无 THINKING 文案泄漏）；审计视图权限点测试。

### GR-2 · 高危工具默认关闭（纠错第 2 条）
- 表象：原站 Waker 转录 Bash(mkdir/npm install)/Write 直接执行、仅 prompt 自约束（O1 QW-04）；我方 code-write 非真沙箱教训（C1 §4 #3）。
- 规则：Bash/Write/Edit 类内置工具不进默认工具面。启用条件全部满足：(a) 该 run 有 WorkspaceBinding；(b) PolicySnapshot.toolsAllowlist 显式列出；(c) 配额生效（文件大小/进程数/超时/磁盘）；(d) 写范围默认=会话工作区+_output/ 产物目录。危险类（工作区外写、网络 egress 非白名单、凭据访问）→RequireUserConfirmEvent→平台 HITL 审批（Run 状态 waiting_confirm）；用户确认可回写会话级权限规则（ConfirmResult.rules，A1 03 项8），规则不跨 session、不入 Release。
- 落点：Provider 装配侧按 Release 快照生成 tools allowlist（平台生成请求，C1 dispatcher 模式）+ToolVersion.danger_class 字段（§5.6）+workspace 内置工具面（A1 03 项7 WorkspaceBase/LocalWorkspace）受 (a)-(d) 门控。
- 验证：装配请求快照测试（无 allowlist 不含高危工具）；审批流 e2e（park→confirm→resume，A1 03 项8 reply_id 路由）；配额越界=run failed 测试。

### GR-3 · Hook 门槛（纠错第 3 条）
- 表象："SessionStart 任意 shell Hook"为任务书转述高危表象（I1 级；原站权限/档案子页未开，04 行 15 如实降级）；我方 Hook 引擎零实现（C1 §4 #4）。
- 规则：一期不建用户可配置 Hook（04 行 15 DEFER）。平台内部 middleware 装配（审计/预算/事件映射）为**代码级**，不开放配置面。若立项，全部前置：HookDefinition 版本化入 Release 冻结+权限点+沙箱执行（auth_sandbox QuickJS 模式扩展，C1 §4 #3）+幂等键+超时+失败策略显式声明；**任意 shell hook 永不放行**；SessionStart 类时机=平台 Run 生命周期事件（RunEvent）订阅，不在 Provider 进程内起 shell。
- 落点：AgentScope middleware hook 点仅为平台进程内装配位（A1 03 项7 Agent docstring：reply/reasoning/permission/acting/model call 等），由平台代码注入（extra_agent_middlewares 语义，A1 03 项5），不暴露给用户。
- 验证：配置面审查（无 Hook 用户入口）；若立项后：沙箱逃逸测试+超时/幂等测试。

### GR-4 · Flow 枚举与调用受限（纠错第 4 条）
- 表象：原站 Waker 工具面有 list_wakerflows（枚举通道存在，O2 QW-04）；治理（mount/pin/预算）页面未见=EVIDENCE_GAP（01 QW-10）。
- 规则：Agent 工具面无 list_all_flows。run_agent_flow 仅接受该 Agent MountBinding 中存在且 pin 到 FlowRelease 的 id；如提供 list_mounted_flows，返回集=挂载集（原站 list 通道收窄为挂载枚举）。校验双端：平台装配侧（请求 tools allowlist 只含挂载项）+Provider 执行侧（未挂载 id→TOOL_NOT_MOUNTED fail-closed 结果回传，run 不中断、Agent 收到明确错误）。每次调用强制生成 ChildInvocation+预算分配（无预算余额=拒绝创建子 Run）。
- 落点：MountBinding（§5.6）+ChildInvocation（§5.4）+PolicySnapshot 预算树；对齐既有 mounts-health 管理面校验思路（C1 §2.4）但升为运行时强制。
- 验证：装配请求快照测试（未挂载 flow 不可见）；TOOL_NOT_MOUNTED e2e；预算耗尽拒绝测试。

### GR-5 · 嵌套与环治理（纠错第 5 条）
- 表象：原站 Flow 嵌套/环/最大深度页面不可见（01 EVIDENCE_GAP）；我方现状 agent_chain/wf_chain 分列判重、混合深度无统一上限（C1 §3 Q3+I1）。
- 规则：每个根 Run 一棵 InvocationGraph：root_run_id 物化于每个 Run 行+invocation_path 数组（定义引用+版本序列）。跨类型统一深度上限默认 5（对齐 C1 现有 wf 链上限；阈值追认=OD-11）。环检测=path 判重：同一（定义 id+版本）在 path 中再现→CYCLE_DETECTED fail-closed（该子 Run 直接 failed，不执行）。发布期静态校验（FlowVersion/WorkflowVersion 同规）：引用闭合（被引用 Release 存在且主体有权 mount）+自身嵌套深度声明≤剩余预算。运行期判重为双保险，静态校验不豁免运行期检查。
- 落点：ChildInvocation 树+Run.invocation_path；execute_run 递归检测泛化（C1 runner:1121-1133 模式从 wf 链扩为跨类型单树）。
- 验证：环构造用例（A→flow→agent→A）fail-closed 测试；深度 6 层拒绝测试；发布期校验单测。

### GR-6 · Run 与 Outbox/Delivery 终态分离（纠错第 6 条）
- 表象：原站运行历史仅单列"运行结果"（O1 QW-07，auto-03.png）；自动任务成功≠外部写回成功为任务书强制纠错。
- 规则：Run/TaskRun/FlowRun 执行终态与外部副作用终态**永远分列**：CommandOutbox（含 ResultDelivery 特化）与执行终态同事务创建、独立 status+幂等键+退避重试+dead_letter+对账 job；UI 运行历史两列（执行结果/投递结果）；"成功"文案禁止暗示外部写回完成；投递失败不回改执行终态，补偿=重投（retry_delivery 模式）或人工处置；非幂等命令（idempotency_class 未声明或 none）不自动重试、且 Continuation 前置校验拒绝在其未完成时续跑（§5.4）。
- 落点：全套模式已被 C1 §3 Q8 证明（UNIQUE(run_id)/原子认领/max_attempts=5/dead_letter/reaggregate/delivery_status 独立列）——泛化到 FlowRun/Automation 即可，不重新发明。
- 验证：投递失败+执行成功的双态 UI 断言；对账 job 测试；Continuation 前置校验用例。

## §7 四条完整时序（案 B 下逐事件闭合）

### §7.0 公共机制（四条时序共用；每条时序内只写差异，但闭合表逐条自答）

- **M1 控制面分工**：平台 server（FastAPI+JobQueue+worker，C1 02 §6.1 生产路径）拥有一切事实（Session/Run/ChildInvocation/RunEvent/ExecutionState/Outbox）与编排；Provider（AgentScope 运行时，8301 型服务）只做"单 Run 的 Agent 装配+reply_stream 执行"，无状态跨调用：请求携带 release 快照引用+session_state（AgentState blob，可空）+budget_remainder+invocation_path，响应回传更新后 session_state+事件流+终态（runtime_contract 扩展=P0 前置 3；装配语义对齐 A1 03 项5/项7"每回合装配"，托管方为平台——OD-15 假设）。
- **M2 事件契约**：Provider 回传 AgentScope AgentEvent union（A1 03 项9）；平台按 mapping_version 冻结映射表转 RunEvent：TEXT/TOOL_CALL/TOOL_RESULT/进度→CONTENT；THINKING→CONTROL（GR-1）；REQUIRE_USER_CONFIRM/REQUIRE_EXTERNAL_EXECUTION→Run 状态迁移（waiting_confirm/waiting_external）+CONTENT 卡片；MODEL_CALL_END.usage→预算账本回写（A1 03 项9 usage 累积语义）。最终 Msg 可由事件流重建（A1 03 项9 Msg.append_event）用于结果校验。
- **M3 HITL/续接**：park=事件后 generator 结束（A1 03 项8）；恢复=平台把 UserConfirmResultEvent/ExternalExecutionResultEvent/UserInterruptEvent 按 reply_id 注入下一次 Provider 调用（reply_id 路由约定，A1 03 项8；reply_id 存于 session_state blob 内，平台不解读、只完整往返）。
- **M4 取消**：用户/系统 cancel→平台对该 Run 及 ChildInvocation 树上全部活跃子 Run 逐个协作取消（C1 runner:1325-1332 模式泛化）：执行中→Provider cancel 调用（P0 前置 2 真实现；官方语义=取消底层 task+CancelledError 清理，A1 03 项8）；parked→注入 UserInterruptEvent（A1 03 项8 幂等双路径）；每级终态回写后向父级传播。
- **M5 预算**：PolicySnapshot（Release 冻结）→Run 预算账本（maxModelCalls/maxToolCalls/token，C1 §1 Q3 module policies 模式泛化）→ChildInvocation 创建时分配 min(父余额, 子 PolicySnapshot)→Provider 请求携带 budget_remainder 并在执行内强制（对齐 A1 03 项8 ReplyBudgetControlMiddleware 语义，账本在平台）→MODEL_CALL_END usage 回写→子 Run 终态余额归还父账本。超限：该 Run failed(BUDGET_EXCEEDED)→按父级 stage/节点策略传播。
- **M6 幂等**：外部副作用（目标表写/webhook/外部 API/通知）一律 CommandOutbox（GR-6）；工具调用重试资格=ToolVersion.idempotency_class；调用方级幂等=Idempotency-Key（C1 manual 模式）；触发级幂等=fire_key（C1 schedule 模式）。
- **M7 恢复**：worker 崩溃→JobQueue 租约回收重认领（C1 recover_stale_jobs 模式）+按持久化状态续：FlowRun 读 ExecutionState（恢复粒度=stage）；Agent run 读 Session.agent_state blob+parked reply_id（M3）；僵尸 Run/TaskRun 由 P0 前置 7 的回收 job 按超时置 failed(STALE)。

### §7.1 时序 1：用户 Chat → Agent → AgentFlow → 多 Agent/role → 返回 Chat

**事件流**

- **E1 用户发送消息**。控制者=平台 ChatAPI。动作：解析 AgentRelease（prod 指针+canary 桶，复制 C1 agent_runtime:579-623 模式）→upsert Session(USER_CHAT)（首轮创建平台 session 行，agent_state=NULL）→创建 **Run#1**（trigger=chat, session_id, agent_release_id, policy_snapshot_ref, root_run_id=Run#1, invocation_path=[agentDef:G]）→入 JobQueue "agent-run"。持久化：Session 行+Run#1 行（平台 DB）。前端：会话流出现用户消息+"运行中"状态。
- **E2 worker 装配执行**。控制者=平台 worker。动作：构建 Provider 请求（M1：release 快照=instructions/model/tools allowlist（GR-2/GR-4 过滤后）/SkillVersion 集/MCPServerVersion 集+session_state（上轮 blob 或 null）+budget_remainder+invocation_path）→POST Provider /v1/runs（C1 client.py:115-124 模式）→Provider 内 AgentScope Agent 装配并 reply_stream（A1 03 项5/项7）。事件按 M2 落 RunEvent@Run#1，SSE 推前端（C1 链3 SSE 模式）。
- **E3 Agent 请求调用 Flow**。控制者=Provider 内 Agent（模型决策）。动作：tool_call `run_agent_flow(flow_release_ref=F, input=…)`——该工具在装配时被声明为**平台代执行类**（external execution）：Provider 不执行它，产出 RequireExternalExecutionEvent(reply_id=R1, tool_call)（A1 03 项8 契约）后 park 该 reply；平台按 M2 迁移 Run#1=waiting_external，落 CONTENT 卡片"请求运行 AgentFlow F"。前端：工具卡片（等待执行）。
- **E4 平台校验并创建 Flow Run**。控制者=平台 worker（拦截事件流）。动作：GR-4 校验（F ∈ Run#1 主体 MountBinding 且 pin 的 FlowRelease；违例→以 TOOL_NOT_MOUNTED 错误 ToolResultBlock 按 M3 回注，Run#1 续跑并由 Agent 报错/改道）→创建 **ChildInvocation#1**（parent_run=Run#1, kind=AGENT_TO_FLOW, pinned_ref=F, budget 分配=M5）→创建 **Run#2**（trigger=flow, flow_release=F, session_id=NULL（Flow 无用户会话）, root_run_id=Run#1, invocation_path=[agentDef:G, flowDef:F@v]）→入 JobQueue "agent-flow-execution"。
- **E5 AgentFlow Runner 初始化**。控制者=平台 AgentFlow Runner（新 job 类型，与 workflow-execution 同构，C1 _dispatch_job 模式）。动作：读 FlowVersion.stages→写 **ExecutionState**（run_id=Run#2, stage_cursor=0, 各 stage 输出槽=空, iters 账本）持久化平台 DB（补 A1 03 项4 缺口；此后每 stage 终态即更新，恢复粒度=stage，M7）。
- **E6 stage1（内联 role 模板"审查者"）**。控制者=Runner。动作：创建 ChildInvocation#2（kind=FLOW_TO_ROLE, role_template_ref=FlowVersion 内嵌 id）+**Run#3**（trigger=flow_stage, root=Run#1, path+role）+Session(FLOW_EPHEMERAL#S3, agent_state=NULL, 不用户可见)→Provider 调用（M1；role 模板的 prompt/model/allowlist 全部来自 FlowVersion 冻结——**role 不注册顶层 Agent**，G5 条款）→role 执行（事件落 RunEvent@Run#3；THINKING→CONTROL）→终态：structured output 按 stage outputSchema 校验（A1 03 项9 GenerateStructuredOutput 机制+C1 worker:412-423 平台二次校验模式）→Run#3 succeeded→S3.agent_state 终态 blob 归档至 Session 行（审计）→stage1 输出快照写 ExecutionState→ChildInvocation#2 关闭、预算余额归还 Run#2 账本（M5）。
- **E7 stage2（顶层 Agent pin：AgentRelease G2）**。控制者=Runner。同 E6，差异：ChildInvocation#3（kind=FLOW_TO_AGENT, pinned_ref=G2）+Run#4 装配消费 G2 的 Release 快照；InvocationGraph 深度+1（GR-5 校验 path 无环、深度≤5）；Session(FLOW_EPHEMERAL#S4) 同 E6。
- **E8（可选 stage 型）goal_loop**。控制者=Runner。动作：平台侧循环（**不**把官方 GoalPipeline 内存对象跨 job 使用，A1 03 项4）：executor Run→产出 _ExecutionReport 形结构化结果→verifier Run→_VerificationResult(pass|fail|impossible)（语义参照 A1 03 项2 契约形状）→fail 则把 message 作为下一次 executor Run 的输入消息；iters 记 ExecutionState（max_iters 来自 FlowVersion，非官方 dead params，A1 03 项2）；pass/impossible→stage 终态。每次迭代=独立子 Run（谱系可审计）。
- **E9 Flow 终态与回传**。控制者=Runner。动作：final stage 输出按 FlowVersion.OutputSchemaRef 平台二次校验→Run#2 succeeded+structured_output 落 Run 行+ExecutionState 终态→ChildInvocation#1 结果=flow 输出 ToolResultBlock→平台按 M3 把 ExternalExecutionResultEvent(reply_id=R1, results) 注入 Run#1 的 Provider 调用→Run#1 续跑（A1 03 项8 Case B 语义）→最终回复 Msg→Run#1 succeeded：session_state 回写 Session(USER_CHAT)、usage 记账（M2）、如有外部投递义务同事务创建 CommandOutbox（M6）。
- **E10 前端终态**。会话转录=工具事件卡+run_agent_flow 卡（展开=Flow run 阶段进度视图，与运行记录页同一投影组件，O1 QW-14 形态采纳）+决策摘要+产物链接（_output 交付契约，04 行 11）；THINKING 不显示（GR-1）；看板投影该 session 一行（OD-07 假设 A），行点击=会话路由（O2 QW-02 导航语义采纳）。

**闭合表（时序 1）**

| 闭合问题 | 答案 |
|---|---|
| Session 在哪存在 | 用户会话=平台 Session(USER_CHAT) 行（持 AgentState blob+schema_version）；role run=FLOW_EPHEMERAL（终态归档、不用户可见）；Flow 本身无 Session（Run#2.session_id=NULL）；Provider 侧无跨调用会话（M1/OD-15 假设） |
| Run 在哪创建 | Run#1=ChatAPI（E1）；Run#2=平台 worker 在 GR-4 校验后（E4）；Run#3/#4=Runner 每 stage（E6/E7）；goal_loop 每迭代独立 Run（E8）——全部平台 DB，同表同谱系 |
| 子调用如何关联 | ChildInvocation 持久边（#1 AGENT_TO_FLOW、#2 FLOW_TO_ROLE、#3 FLOW_TO_AGENT）+root_run_id+invocation_path 物化（GR-5）；/trace 树按 ChildInvocation 边递归（C1 链3 trace 模式扩展） |
| 取消如何传播 | M4：cancel Run#1→树遍历→Run#2 协作取消（Runner 每 stage 开始前检查取消位）→活跃 Run#3/#4 Provider cancel（P0-2）；parked（E3 型 waiting_external）→UserInterruptEvent 按 reply_id 注入；逐级终态回写 cancelled，ExecutionState 保留已完成 stage 快照 |
| 预算如何传播 | M5：Run#1 PolicySnapshot 账本→ChildInvocation#1 分配→Run#2 账本→每 stage 子分配→usage 事件回写→余额逐级归还；超限=BUDGET_EXCEEDED failed 按 stage 策略（默认 fail_fast）上传 |
| 状态在哪持久化 | Session/Run/ChildInvocation/RunEvent/ExecutionState/CommandOutbox 全在平台 DB；AgentState 仅以 blob 存 Session 行（平台不解读，A1 03 项12 防漂移）；Provider 无持久状态（M1） |
| 副作用如何幂等 | 外部投递=CommandOutbox 幂等键 f(run_id,seq)（M6/GR-6）；工具重试资格=idempotency_class；run_agent_flow 本身不自动重试（创建子 Run 属非幂等副作用，重试=新 ChildInvocation 显式发起） |
| 前端显示什么 | E10 全量：进度/工具卡/Flow 阶段视图/决策摘要/产物；THINKING 仅审计权限点（GR-1）；看板 session 行（OD-07 假设） |
| 失败后重做谁、不重做谁 | Run#3（stage1 role）失败→stage retry（FlowVersion 声明，默认 0）→仍败则 Run#2 failed→错误 ToolResultBlock 回注 Run#1，Agent 决定报告或再试（受 Run#1 预算/maxToolCalls 约束）。用户可选"自 stage2 续跑"（OD-01 假设 B）：新 Run#2'(trigger=continuation, origin_run_id=Run#2, reuse=[1], redo_from=2)——**不重做**：stage1（快照复用）、已投递 Outbox 命令、Session 上下文（不丢）；**重做**：stage2 起全部及其子 Run。Run#1 整 turn 失败则用户重发=新 Run（Session 连续） |

### §7.2 时序 2：自动任务 → AgentFlow → Agent → 选择性重做 → 结构化终态

**事件流**

- **E1 触发**。控制者=平台触发面。任何 schedule/api/event fire 在物化前先读取 AutomationDefinition policy：累计自动运行次数达到 `max_runs` 时，以 CAS 将定义转 `paused` 并拒绝物化；当前时间达到或超过 `deadline_at` 时，记录 `expired` 判定且不物化 Run；null 分别表示无限制/永不截止。通过触发门后，schedule 路径：scheduler_loop（advisory lock 选主）→occurrence 物化→fire_key 幂等 start（C1 链4 触发段全套复用）；api 路径：**新端点** POST /api/automations/{id}/invoke，Bearer token（AutomationDefinition.api_credential_ref→KMS secret_ref，C1 §2.6 模式；原站 atk_ 内嵌 URL 表象不抄）+Idempotency-Key 必带（重复返回原 Run）；event 路径（OD-02 假设 B）：webhook 入口鉴权+重放防护随 doc12 S1 设计。manual_debug 路径：详情页"运行"=trigger=manual_debug，不更新最近触发/不计入累计；它仍受 `deadline_at`，但不消耗 `max_runs` 计数。
- **E2 定义解析与 Run 创建**。控制者=平台 worker。动作：在同一事务内重新校验 enabled/paused/`max_runs`/`deadline_at`，防止 E1 后并发越门→AutomationDefinition→ExecutionTarget=agent_flow+版本策略解析（pinned=F@v3 digest 校验｜latest_prod=当前 active FlowRelease）→冻结 resolved_* 全套（复制 C1 TaskRun 冻结模式于 Run 行）→创建 **Run#10**（trigger=automation｜manual_debug, automation_id, occurrence/fire_key 关联, flow_release, root=Run#10, path=[automationDef:A, flowDef:F@v3], policy=AutomationDefinition.policy）→入 JobQueue "agent-flow-execution"。自动运行计数只在成功物化唯一 fire 后原子递增；达到上限时同步把定义转 `paused`。**单发自动化不经 TaskRun**；批量数据窗口场景仍 TaskRun→逐条 Run（C1 链4 原样，三义分离 §0.1-3）。
- **E3 Runner 初始化**。同 时序1-E5：ExecutionState(Run#10) 写库。
- **E4 stage1=顶层 Agent（AgentRelease G pin）**。控制者=Runner。ChildInvocation#10（FLOW_TO_AGENT, pinned_ref=G）+Run#11+Session(FLOW_EPHEMERAL#S11)→Provider 装配（消费 G 的 Release 快照：instructions/model/SkillVersion/MCP/allowlist）→succeeded→输出快照入 ExecutionState→S11 归档。
- **E5 stage2=role 模板，失败**。控制者=Runner。ChildInvocation#11（FLOW_TO_ROLE）+Run#12→模型调用连续失败→stage retry（FlowVersion 声明 retry=2）耗尽（每次 retry=新子 Run+attempt 记 ExecutionState，谱系可查）→Run#12 failed→ExecutionState：stage2=failed(attempts=3)、stage1=succeeded(输出快照在)→Run#10 failed（错误结构落 Run.error；outputSchema 校验仅对成功路径——失败终态不伪造结构化成功输出）。Outbox：若定义声明失败通知→CommandOutbox 行（幂等键 f(run10, notify)）同事务创建，投递独立重试（GR-6：**执行 failed 与投递 pending/succeeded 分列**）。
- **E6 选择性重做（OD-01 假设 B：自失败阶段续跑）**。控制者=用户+平台。动作：Run#10 详情（阶段画布：stage1 绿/stage2 红，投影采纳 O1 QW-14 形态）点"自 stage2 续跑"→平台 **Continuation 前置校验**：(a) stage1 输出快照存在且 schema 校验通过；(b) FlowRelease digest 与 Run#10 冻结一致（pin 未漂移）；(c) stage1 无未完成非幂等 Outbox 命令（GR-6）；(d) InvocationGraph 深度/环预算重算通过（GR-5）→创建 **Run#10'**（trigger=continuation, origin_run_id=Run#10, continuation={reuse:[1], redo_from:2}）→Runner 读 Run#10 的 ExecutionState：stage1 **不重跑**（输出快照注入 stage2 输入）→stage2 新 ChildInvocation#11'+Run#12'→成功→final 输出按 OutputSchemaRef 平台二次校验→**结构化终态**落 Run#10'.structured_output+succeeded→occurrence/累计计数归属原 fire（谱系=origin 链，不重复计数）→Outbox 结果投递同事务创建。
- **E7 前端终态**。自动任务详情=运行概览四指标（手动调试不计入，O1 QW-07 语义）+运行历史表（列=触发来源/**执行终态**/**投递终态**分列，GR-6 有意强于原站单列）+查看 run 回链；Run 详情=阶段画布+attempt/continuation 谱系徽章（区分原站"第 N 次运行"=run 序号的含混，01 I1 教训）+续跑入口（前置校验不满足→置灰+原因文案）。

**闭合表（时序 2）**

| 闭合问题 | 答案 |
|---|---|
| Session 在哪存在 | 自动化 Run 无用户 Session；stage 子 Run 各配 FLOW_EPHEMERAL（终态归档审计）；Flow 定义层的对话式生成会话（GENERATION）只存在于创建/编辑期并回写 generation_session_id（O2 QW-15 语义），与运行期无关 |
| Run 在哪创建 | Run#10=触发面（E2，fire_key/Idempotency-Key 幂等）；Run#11/#12=Runner 每 stage（E4/E5）；retry=新子 Run+attempt 记账；Run#10'=Continuation 校验通过后由平台创建（E6） |
| 子调用如何关联 | ChildInvocation#10/#11（+#11'）持久边+root/path 物化；continuation 谱系=origin_run_id 链（C1 链4 retry 模式泛化）；/trace 递归展示 |
| 取消如何传播 | 运行中取消/停用：Run#10 协作取消→树传播（M4）→occurrence 标 cancelled；**停用定义（enabled=false）只停后续触发，不追取消在跑 Run**（语义显式，避免原站 switch 表象的歧义）；连续失败自动停用沿用 C1 schedule 模式（5 次） |
| 预算如何传播 | AutomationDefinition.policy→Run#10 账本→stage 子分配→retry 各 attempt 独立记账且计入 Run#10 总额（防 retry 预算逃逸）；超限=BUDGET_EXCEEDED failed，运行历史"执行终态"列显式展示该原因 |
| 最大运行次数/截止日期如何传播 | E1 对所有自动触发执行第一道门；E2 在 Run 创建事务内二次校验并原子递增计数。达到 `max_runs` 后定义转 `paused`；到达 `deadline_at` 后不再物化 fire；manual_debug 不计入次数但受截止日期约束 |
| 状态在哪持久化 | ExecutionState（stage 快照/attempt/iters）+Run/ChildInvocation/RunEvent+Outbox 全在平台 DB；崩溃恢复=job 重认领+读 ExecutionState 从 stage 边界续（M7）；role 的 AgentState blob 归档于 FLOW_EPHEMERAL Session 行 |
| 副作用如何幂等 | 触发级=fire_key/Idempotency-Key；投递级=Outbox 幂等键+对账（GR-6）；续跑级=Continuation 前置校验 (c) 拒绝非幂等未完成命令；stage retry 的工具重放资格=idempotency_class（非幂等工具失败→stage 直接 failed 不自动 retry） |
| 前端显示什么 | E7 全量：四指标（调试不计入）/运行历史双终态列/阶段画布/谱系徽章/续跑入口与置灰原因 |
| 失败后重做谁、不重做谁 | **重做**：redo_from 起的 stage 及其全部子 Run（E6）；**不重做**：已完成 stage（输出快照复用）、已投递 Outbox 命令（幂等键判重）、已消费 fire_key（重放返回原 Run）、AutomationDefinition 本身（定义不因运行失败变更）；run 级整体重跑仍保留（trigger=manual_debug 或新 fire） |

### §7.3 时序 3：Workflow → Agent → Workflow 子调用

**事件流**

- **E1 Workflow Run 创建**。控制者=平台 API/触发面。动作：POST /api/runs（或 schedule/TaskRun 交互 Run，C1 链4 原样）→版本解析：显式 version_id＞schedule pinned＞草稿（C1 create_run:1706-1731 保留）；**新增约束（P0-5）**：workflow-exec/agent 节点必须携带 pin 声明（pinned version｜显式 draft 策略字段），无声明=发布校验拒绝——修复 C1 链3 薄弱点（子调用按草稿解析漂移）→创建 **Run#20**（root=Run#20, path=[wfDef:W@v]）→JobQueue "workflow-execution"。
- **E2 execute_run 治理段**。控制者=平台 workflow worker。动作：图校验+**InvocationGraph 初始化**（root_run_id 物化；跨类型 path 判重取代 wf_chain/agent_chain 分列，GR-5）+统一深度记账（上限默认 5，OD-11 假设）+拓扑分批并发（C1 WF_PAR_RUN=4 模式保留）→每节点 NodeRun 创建（C1 链3 Worker 段原样）。
- **E3 agent 节点**。控制者=workflow worker。动作：节点引用 AgentRelease pin（canonical 形态；legacy agent/agent-exec 兼容层按 C1 §3 Q2 deprecated+/migrate 路线收敛，不在目标态新增）→创建 ChildInvocation#20（kind=WF_TO_AGENT）+**Run#21**（trigger=workflow_node, agent_release, root=Run#20, path+[agentDef:G@v]）+Session(FLOW_EPHEMERAL#S21)→Provider 装配执行（M1；同步等待语义沿用 C1 _run_member/execute_module_run_sync 模式的协作取消检查点）。
- **E4 Agent 内调用挂载 Workflow**。控制者=Provider 内 Agent→平台 worker 拦截。动作：tool_call `workflow_{id}`（该 Workflow 在 Agent MountBinding 中且 pin WorkflowVersion——修复 C1 §2.4 断点⑥：挂载真成工具）→RequireExternalExecutionEvent park（M3）→平台校验：mount/pin+**InvocationGraph 环检测**（W 已在其 path 中→CYCLE_DETECTED fail-closed，错误 ToolResultBlock 回注，Run#21 续跑报错）+深度预算→ChildInvocation#21（kind=AGENT_TO_WF）+**Run#22**（trigger=agent_tool, workflow_version pinned, root=Run#20, path+[wfDef:W2@v]）→execute_run（深度+1；Run#22 内部 NodeRun/事件独立落库）。
- **E5 终态汇聚**。控制者=平台 worker。Run#22 终态→ChildInvocation#21 关闭→结果 ToolResultBlock 按 M3 回注 Run#21→Agent 续跑→Run#21 终态→ChildInvocation#20 关闭→父 NodeRun 终态→Run#20 汇聚计数终态（C1 链3/链4 汇聚模式）。事件各自落 RunEvent@各 Run；SSE 按 run 订阅+/trace 谱系树=Run→NodeRun→ChildInvocation→子 Run 递归（C1 runs.py:250-317 扩展）。
- **E6 前端终态**。Run#20 详情=节点画布状态+trace 树（跨类型谱系徽章：workflow/agent/agent_flow）；节点卡显示 pinned 版本号（可审计）；Run#21/#22 详情独立可达（run 级路由，04 行 12 ADOPT 语义）。

**闭合表（时序 3）**

| 闭合问题 | 答案 |
|---|---|
| Session 在哪存在 | Workflow Run 无 Session；Run#21（agent 节点）配 FLOW_EPHEMERAL#S21（终态归档）；Run#22 无 Session（纯 DAG）。用户可见会话零涉及 |
| Run 在哪创建 | Run#20=API/触发面（E1）；Run#21=workflow worker 在 agent 节点（E3）；Run#22=平台在 GR-5 校验后（E4）；全部同表+root/path 物化 |
| 子调用如何关联 | ChildInvocation#20（WF_TO_AGENT）/#21（AGENT_TO_WF）持久边；NodeRun 与 ChildInvocation 一对一挂钩（节点卡→子 Run 直达）；环/深度按 invocation_path 单树判定（GR-5，修 C1 §3 Q3 缺口） |
| 取消如何传播 | Run#20 取消→协作取消沿 NodeRun+ChildInvocation 树（C1 1325-1332 泛化）：Run#22 节点级检查点取消、Run#21 执行中→Provider cancel（P0-2）/parked→UserInterruptEvent（M3/M4）；子 Run 终态回写后父节点才收敛 |
| 预算如何传播 | 节点级预算声明（WorkflowVersion 冻结）→Run#21 分配→Run#22 子分配；每级 PolicySnapshot 上限+usage 回写（M5）；超限该级 failed 按节点失败策略（重试/跳过/终止，WorkflowVersion 声明）上传 |
| 状态在哪持久化 | Run/NodeRun/ChildInvocation/RunEvent/CallRecord 平台 DB（C1 链3 事实层原样）；Run#21 的 AgentState blob 归档 S21；wait-review 挂起/resume 沿用 C1 链3 模式 |
| 副作用如何幂等 | workflow-exec/agent_tool 子调用重试须节点声明幂等键（与 P0-5 pin 声明同为节点配置必填项）；外写叶子节点=Outbox（M6/GR-6）；数据窗口批量幂等由 TaskRun 冻结+行级过滤保证（C1 链4 原样） |
| 前端显示什么 | E6：节点画布+跨类型 trace 树+pin 版本徽章；THINKING 不出（GR-1）；看板投影：TaskRun 场景=批次行（现状），一次性 workflow Run 是否进看板按 OD-07 假设 A（run 投影行，来源=手动/调度） |
| 失败后重做谁、不重做谁 | 一期=run 级重跑+TaskRun 场景失败条目重试（C1 retry_failed_in_taskrun 模式保留：新 attempt+origin 谱系+按最新 attempt 重汇）；**Workflow DAG 节点级选择性重做=DEFER**（OD-01 范围是 AgentFlow stage；workflow 节点重做列 P2，前置=节点级幂等声明全覆盖）；**不重做**：已投递 Outbox、已消费 fire_key、重试时已成功条目（TaskRun 行级过滤） |

### §7.4 时序 4：单次无状态任务 → Agent Planning → 内部 plan items → Run 结束

**事件流**

- **E1 单次执行入口**。控制者=平台 API。动作：POST /api/runs（agent 目标，trigger=api｜manual，Idempotency-Key 可选——重复返回原 Run，C1 manual 模式）→解析 AgentRelease→创建 Session(**SINGLE_RUN**#S30，不用户可见、不投影会话列表行）→创建 **Run#30**（session=S30, root=Run#30, path=[agentDef:G@v], policy=PolicySnapshot 单层账本，无子分配需求）→JobQueue "agent-run"。
- **E2 装配与计划展开**。控制者=平台 worker→Provider。动作：Provider 请求（M1）；Toolkit 含官方 Task 工具（TaskCreate/TaskGet/TaskList/TaskUpdate——直接复用，不自建计划引擎，A1 03 项6）+挂载资源（Release 快照）+GR-2 门控后的 workspace 工具。Agent reply 中自拆计划：TaskCreate×N→tasks_context 写入 AgentState（A1 03 项6：append+顺序数字 id）。
- **E3 计划项投影**。控制者=平台 worker（事件流拦截）。动作：TOOL_CALL_*/TOOL_RESULT_*（Task 工具）按 M2 映射，并另投影 RunEvent(CUSTOM, name="plan_progress", value={taskId,subject,state})——CustomEvent 用途官方点名 task progress（A1 03 项9）→前端 Run 详情"执行计划"进度卡。**状态枚举仅 pending/in_progress/completed**（官方无 failed/cancelled，A1 03 项6——展示层不得虚构状态；条目失败=Run 失败+该条目停留 in_progress 附错误注记）。blocks/blocked_by 仅作展示信息，**平台不实现依赖调度**（A1 03 项6 无消费者，不得外推为调度契约）。
- **E4 执行与终态**。控制者=Provider 内 Agent。动作：逐条推进（TaskUpdate(completed)）；期间工具执行受 GR-2（workspace 内 Read/Write allowlist）与 GR-6（外部副作用走 Outbox）约束→最终 structured_output（若 Release 声明 OutputSchemaRef）→平台二次校验（C1 worker:412-423 模式）→Run#30 succeeded。
- **E5 收尾与审计留存**。控制者=平台 worker。动作：响应回传的 AgentState 终态 blob（含 tasks_context）→快照至 Run#30.audit_state（带 agent_state_schema_version，A1 03 项12 防漂移；计划项随 session 存亡、无独立存储——A1 03 项6，故审计留存必须在此显式落库）→Session S30 标 archived（保留至留存期配置，不删除）→Outbox（如有投递声明）与终态同事务创建（C1 settle_run_success 模式）。
- **E6 前端终态**。Run 详情=执行计划卡+工具事件+决策摘要+结构化结果；看板投影一行 run（来源=手动/API，OD-07 假设 A）；**不产生**新会话行/平台任务/自动任务——三义分离实证（任务书 §1.3；04 行 14 ADOPT）。

**闭合表（时序 4）**

| 闭合问题 | 答案 |
|---|---|
| Session 在哪存在 | 仅 SINGLE_RUN#S30（平台 Session 行，装配必需——Provider 请求以 session_state blob 为状态载体，M1）；不用户可见；archived 后仅供审计 |
| Run 在哪创建 | Run#30=API 入口（E1，Idempotency-Key 判重）；无子 Run（单 Agent 单层；若该 Agent 调 Flow/Workflow 则升级为时序 1/3 形态，谱系规则同 GR-4/5） |
| 子调用如何关联 | 无 ChildInvocation（单层）；plan items 不是调用——仅 RunEvent(CUSTOM) 投影（E3），不入谱系树 |
| 取消如何传播 | Run#30 cancel→Provider cancel（P0-2；执行中=CancelledError 清理，A1 03 项8）→plan items 无补偿（run 内信息，A1 03 项6 无独立生命周期）→audit_state=最后回传 blob 或空（取消时点决定，语义显式）；已创建 Outbox 命令按 GR-6 独立处置（取消不回滚已投递，未投递标 cancelled） |
| 预算如何传播 | PolicySnapshot 单层账本（无子分配）；TaskCreate/TaskUpdate 调用计入 maxToolCalls（防计划抖动耗尽预算——A1 03 项6 工具即普通 tool call）；超限=BUDGET_EXCEEDED failed |
| 状态在哪持久化 | Run#30/RunEvent/audit_state/Outbox 平台 DB；AgentState blob：运行中在 Provider 请求-响应往返（M1 无状态），终态落 S30 行+audit_state 快照；计划项终态随 blob 冻结（E5） |
| 副作用如何幂等 | 调用方级=Idempotency-Key（重试返回原 Run）；工具级=idempotency_class（非幂等工具不自动重试）；投递级=Outbox 幂等键；重跑=新 Run 全新执行（无状态定义决定：无 Continuation——**上次 Run 已投递的 Outbox 命令不重发**，新 Run 的新命令以新 run_id 生成幂等键，目标侧 upsert 语义防重复写入，C1 §3 Q8 模式） |
| 前端显示什么 | E6：执行计划卡（三态枚举）+工具事件+决策摘要+结构化结果；THINKING 不出（GR-1）；看板一行 run 投影 |
| 失败后重做谁、不重做谁 | 失败=Run 级整体重跑（新 Run；无状态任务无"部分重做"语义）；**不重做**：上次 Run 已投递 Outbox 命令、已消费 Idempotency-Key；plan items 不重做——随失败 Run 消亡（audit_state 留审计），新 Run 重新规划 |

## §8 G5 · 架构建议闸门自检表

| G5 条款 | 自检 | 证据/落点 |
|---|---|---|
| 三案已公平比较 | ✅ | §2 矩阵 13 维度×3 案逐格给结论+证据；§2.1 显式汇总案 A 占优 3 维（前端投入/迁移/锁定）、案 C 占优 2 维（同型调用便利/远期统一），未只写偏好案；案 A 的"低锁定以锁死产品语义为代价"、案 C 的"远期优雅以唯一全通链迁移为代价"均如实计入 |
| 推荐结论同时有 O1/O2、C1、A1 三类证据 | ✅ | §3.1：O 类 3 条（QW-06 两型执行目标 O1、QW-15 scope=global upsert 契约 O2、QW-04 wakerflow 插件通道 O2）；C 类 3 条（链3 唯一全通模式、链2 Skill 断链教训、§3 Q3 深度/判重缺口）；A 类 3 条（项1/§4.2 契约面极小、项4/项10 状态纯内存+未接服务层、项12 无稳定性承诺） |
| 所有"双向"调用落到同一父子运行事实和治理规则 | ✅ | 四方向（Agent→Flow 时序1 E3-E4、Flow→Agent/role 时序1 E6-E7 与时序2 E4、Workflow→Agent 时序3 E3、Agent→Workflow 时序3 E4）全部经 ChildInvocation 单表+root_run_id/invocation_path 单树+GR-4/GR-5 同一校验（§5.4/§6） |
| Workflow 与 AgentFlow 的职责不靠一句"一个硬一个软"区分 | ✅ | §4.1 八判据边界表（执行体/控制流来源/事实源/终态契约/状态恢复/触发面/批量语义）+§4.2 四条可操作判定规则+§4.3 共用事实层清单（任务书 §1.2"两个 Flow 不成为两个运行事实体系"落实） |
| 内部 role 不被强制注册成完整顶层 Agent | ✅ | RoleTemplate=FlowVersion 内嵌纯数据（§5.2；形态参照 A1 03 项3 SubAgentTemplate）；时序1 E6 role run 不进 Agent 列表、无 Release、冻结点唯一=FlowVersion；顶层 Agent pin 为可选引用方式而非强制（时序1 E7；边界=OD-17） |
| Chat、多轮 Session、单次任务和批量没有混成一层 | ✅ | Session 四分类（§5.5：USER_CHAT/GENERATION/FLOW_EPHEMERAL/SINGLE_RUN）；四条时序各归其层：多轮会话=时序1、单发自动化=时序2、批量=TaskRun 轨道原样保留（时序2 E2 显式分流）、单次无状态=时序4；plan items 仅投影不入任何任务层（时序4 E3/E6，任务书 §1.3） |
| 资源、工作空间和高风险工具有明确权限边界 | ✅ | MountBinding 唯一挂载事实源+可空 pin（§5.6）；GR-2（高危工具四条件+审批）、GR-4（Flow 枚举收窄+双端 fail-closed）、GR-3（Hook 门槛）；WorkspaceBinding 三态+配额（§5.6）；PolicySnapshot 三主体同构冻结（§5.7） |
| 未决项仍是未决，没有伪装成拍板 | ✅ | 07 v1 OD-01～08 仅在 §0.2 以"默认建议=工作假设"引用并逐条标注受影响段落；本文件新识别 10 项拍板请求全部列 §9"建议追加 07 v2"，**未写入 07、未标记 DECIDED**；推荐案 B 自身也列为 OD-09 待拍板（§3 标题） |

## §9 建议追加 07 v2 的未决项清单（问题+最小拍板问句；不写入 07，七字段格式由 v2 维护者补全）

> 前 5 条对应 07 v1"追加计划"点名事项；后 5 条为本轮 04/05 新识别。每条注明：问题、最小拍板问句、默认建议（D1）、若不拍板的影响段落。

1. **OD-09 · AgentFlow 一等性（案 B）批准**【07 追加计划点名】
   - 问题：是否批准案 B——AgentFlow 为一等版本化资产，与 Workflow 并存且共用 Run/ChildInvocation/RunEvent/Policy/Release/Outbox 执行事实层？（三案比较=本文件 §2，推荐依据=§3.1）
   - 最小拍板问句：**批准案 B（AgentFlow 一等资产）吗？若否，选案 A（AgentVersion 内部配置）还是案 C（统一 FlowDefinition）？**
   - 默认建议：案 B。影响：本文件全部；04 行 2 结论由 OPEN 转为 ADAPT/REJECT 相应形态；doc11 现状（PipelineDefinition 内嵌 AgentVersion，案 A 形态）需 06 冲突审计登记 supersede。
2. **OD-10 · Session↔Run 映射口径**【07 追加计划点名】
   - 问题：原站"chat turn=run"不可证（01 QW-04 I1）；本提案时序 1 假设"每 chat turn 一个 Run、Session 1:N Run"（依据 C1 现状 Run(trigger=chat) 与 A1 03 项5 每回合装配语义）。该口径是否追认？
   - 最小拍板问句：**确认"每 turn 一 Run、Session 1:N Run、看板投影行=session"口径吗？**
   - 默认建议：确认。影响：§5.5 Session、§7.1、04 行 3/5、看板投影源设计。
3. **OD-11 · InvocationGraph 深度与环治理阈值**【07 追加计划点名（"Flow 嵌套/环治理阈值"）】
   - 问题：跨类型统一深度上限取值（GR-5 默认 5，对齐 C1 现有 wf 链上限）；同一定义不同版本是否算环（本提案：path 判重按"定义 id+版本"，即同定义不同版本仍判环——更严格）。
   - 最小拍板问句：**全局深度上限=5（跨 workflow/agent/flow 合计）且环判定按定义 id（含跨版本）吗？**
   - 默认建议：是。影响：§6 GR-5、时序 1 E7/时序 3 E2/E4、发布期静态校验规则。
4. **OD-12 · 知识库执行体与冻结粒度**【07 追加计划点名（"知识库详情缺口处置"的架构面）】
   - 问题：知识检索执行体=AgentScope 官方 KnowledgeBase/RAGMiddleware/index worker（A1 03 项7，引入其存储/blob 依赖，03 §4.3 职责重叠）还是我方现状"外部检索端点引用"（C1 §2.3）？Release 冻结粒度=状态（现状）还是内容/索引 revision？
   - 最小拍板问句：**知识库执行体选官方 RAG 服务层还是平台外部端点引用？一期冻结粒度维持"引用+状态+检索参数"吗？**
   - 默认建议：一期外部端点引用+最小冻结（不引入官方索引栈），官方 RAG 列评估项。影响：§5.6 KnowledgeSnapshot、04 行 9、Provider 装配契约。
5. **OD-13 · 工作空间执行位置与沙箱边界**
   - 问题：文件/shell 工具执行体在 Provider 容器内（LocalWorkspace 宿主本地语义，A1 03 项7/项11）还是平台管理的 workspace 服务？本地目录/Git 项目挂载的隔离与凭据边界（原站隔离实现不可见，01；我方 code-write 非真沙箱教训，C1 §4 #3）。
   - 最小拍板问句：**工作空间执行体放 Provider 容器还是平台侧？本地目录挂载一期是否只允许平台管理目录（禁任意宿主路径）？**
   - 默认建议：Provider 容器内+仅平台管理目录起步（最小暴露面）。影响：§5.6 WorkspaceBinding、§6 GR-2、时序 4 E4、04 行 11。
6. **OD-14 · 记忆写回与晋升链路**
   - 问题：运行级记忆（run 内字典，C1 §2.7）→持久 AgentMemory 的写回是否允许 Agent 运行时发起？晋升是否需人工审批/版本化（agent_memory_revision 已有）？原站"记忆与学习时间线"仅文案级证据（01 QW-09 I1）。
   - 最小拍板问句：**持久记忆只允许管理面编辑，还是允许 Agent 运行时写回（经审批+revision）？**
   - 默认建议：一期只读注入+管理面编辑；运行时写回列 P2（带审批）。影响：§5.6 MemoryPolicy、04 行 10、GR-6 精神（持久副作用受控）。
7. **OD-15 · AgentScope app 服务层启用取舍**
   - 问题：官方 2.0.7 自带 FastAPI 路由/SQL+Redis 存储/分布式 session 锁/ChatService/cron（多副本单点约束，A1 03 §4.4）/IM 网关/权限预算 middleware——与我方 server 职责重叠（A1 03 §4.3）。本提案时序按"平台自托管服务层、Provider 仅库层（Agent/Toolkit/事件）+无状态 /v1/runs"假设闭合。
   - 最小拍板问句：**一期 Provider 是否仅用 AgentScope 库层（平台自托管 Session/调度/事件），官方 app 层全部关闭？**
   - 默认建议：是（最小依赖未审计的官方服务面；Beta+A1 03 项11 示例非生产保证）。影响：§7.0 M1、§5.5 Session 持久化地点、调度归属（我方 scheduler_loop 保留）、04 行 5/9/17。
8. **OD-16 · AgentFlow 生产接线的 2.0.8 发布闸门**
   - 问题：pipeline/A2A 仅存于未发布 main（A1 03 §1.3/§4.1；AUDIT-HANDOFF U05：正式版前仅沙箱 spike）。本提案 Runner 为平台自建、生产路径不依赖 pipeline 模块（2.0.7 即可）；仅 goal_loop 复用官方 GoalPipeline 对象、A2A 节点型需 2.0.8+。
   - 最小拍板问句：**确认"AgentFlow 生产化以平台自建 Runner 为准、不等 2.0.8；官方 pipeline 对象/A2A 仅沙箱 spike 至正式 tag 发布并按 G4 口径重审"吗？**
   - 默认建议：确认。影响：§1 案 B 定义、§3.2-2、时序 1 E8、升级时的 schema 冻结义务（A1 03 项12）。
9. **OD-17 · Flow 节点引用 Agent 的方式边界**
   - 问题：内联 RoleTemplate 与顶层 AgentRelease pin 两种节点引用并存（§5.2/时序1 E6-E7）：何时必须用 pin（如复用已发布 Agent 的身份/记忆/挂载）？内联模板是否允许挂 MountBinding 子集？两者能力漂移如何防双事实源（冻结点=FlowVersion 已定，但模板可引用哪些资源未定）。
   - 最小拍板问句：**接受"内联 role 模板+可 pin 顶层 AgentRelease"双引用方式，且内联模板资源仅限 FlowVersion 冻结集内声明吗？**
   - 默认建议：接受。影响：§5.2 RoleTemplate、§5.6 MountBinding 主体范围、04 行 13。
10. **OD-18 · 原站残余证据缺口补查授权**【07 追加计划点名（"知识库详情缺口处置、设置页/Group 缺口处置"）】
    - 问题：知识库详情页、Waker 权限/档案/记忆/自进化 Skill 子页、管理页 Group 页签、设置按钮（两次点击无面板，01 跨域事实 4）仍为 EVIDENCE_GAP；其中权限/档案子页可能改变 04 行 15（Hook）与行 1（Waker 版本/启停语义）的证据基础。
    - 最小拍板问句：**是否授权再做一轮只读补查（仅打开详情/子页，不触发任何状态变更），或接受现有缺口并按本提案默认建议推进？**
    - 默认建议：接受缺口推进（相关行已按 DEFER/假设处理），补查列可选。影响：04 行 1/6/9/10/15 的 EVIDENCE_GAP 标注维持。

---

*报告完。本文件与 04-reference-to-mtc-mapping.md 为本阶段唯二产出；未修改代码/迁移/docs/lockfile/07；未运行改状态命令；未使用浏览器；未派发子代理。交叉引用：任务书 §8（三案/13 维度/候选模型/四时序/强制安全纠错/G5）、01（O 证据）、02（C 证据）、03（A 证据）、07 v1（OD-01～08）。*
