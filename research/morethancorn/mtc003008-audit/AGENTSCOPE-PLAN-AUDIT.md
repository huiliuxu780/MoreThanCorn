# AgentScope 全量接线与事件驱动工单方案审计

> 审计日期：2026-09-08  
> 审计范围：`AUDIT-HANDOFF-agentscope-plan.md`、`11-agentscope-full-integration.md`、`12-event-driven-workorder-pipeline.md`、`03-trigger-and-data-mapping.md` 及其直接引用的当前代码、AgentScope 2.0.7 官方文档和 QoderWake 原站页面。  
> 审计性质：设计与结论审计；未修改产品代码、迁移、配置或三份主设计稿。  
> 结论状态：**退回修订（REVISE），P0 暂不放行。**

## 1. 执行结论

选择 AgentScope 作为 Agent 运行底座是可行方向，本轮没有发现需要推翻该技术选型的证据。问题在于当前计划把若干仅在 AgentScope `create_app`、POC 或单进程条件下成立的事实，外推成了自有 Runtime Contract 架构下“开箱即用”“现成复用”或“天然保证”的能力。

本轮共记录：

- **8 项阻断问题（P0）**：在修正前不应开工；
- **11 项高风险问题（P1）**：会导致返工、数据重复、权限穿透或验收失真；
- **7 项一般纠错（P2）**：主要是证据强度、术语和计划一致性问题；
- K1–K15 中：**2 项成立、5 项部分成立、8 项需改写**；
- “15 项全部拍板”不成立：至少 #4、#7、#9、#11b、#14-UI、#15-T2 仍含条件或后续闸门，且 12 号稿的 T 轨选型与交接单互相冲突。

当前计划最大的问题不是遗漏了某个 AgentScope API，而是缺少以下五个跨层契约：

1. 会话 turn 的并发、幂等、断线恢复和状态版本契约；
2. 平台模型凭据到独立 runtime 的安全解析契约；
3. 真正的生产 Tool Gateway、授权与外部执行回路；
4. 外部写动作的持久化、等待/恢复、对账和远端幂等契约；
5. TriggerEvent 从接收、去重、组批到 TaskRun 的事务状态机。

因此，建议把现有“P0→G→C/B/T 并行”改成“基线冻结→六项架构闭合→最小纵切→业务迁移→事件写回”。详见 §8。

## 2. 审计方法与事实边界

本报告将结论分为三类：

- **事实**：由当前工作区代码、Git 状态、AgentScope 2.0.7 官方文档或实际页面直接支持；
- **推断**：根据实现边界得出的工程判断，已标明前提；
- **建议**：审计者给出的方案修正，不冒充原有拍板。

已完成的独立复核包括：

- 当前 Git 基线、未提交项和目标文档状态；
- AgentScope 2.0.7 Context、Plan、Skill、Run Agent、Agent Service 文档及安装包实现；
- 当前 `JobQueue`、chat、Skill 上传、runtime adapter、Tool Service、ResultDelivery、模型/Connection 路径；
- QoderWake 的 Waker 设置、WakerFlow 运行页、自动任务列表和创建弹窗；
- 三份设计稿的决策状态、依赖关系和同一概念跨文档表述。

未进行：代码修改、数据库变更、外部写操作、QoderWake 配置保存、性能压测和真实第三方工单写入。

## 3. P0 阻断问题

### P0-01：交接基线不可复现，“代码零改动/50 个文件”已失真

**事实**

- 交接单声明基线为 `main@337fcf8`、50 个未提交文件；当前实际 HEAD 为 `894245d`。
- 当前 `git status --short` 有 51 个顶层状态项：28 个 tracked 修改/删除、23 个 untracked 顶层项；将 untracked 展开后有 110 个未跟踪文件。
- 三份设计稿目前自身也是未跟踪文件；同时存在 `server/app/agent_runtime.py`、`server/app/main.py`、前端页面等未提交代码修改。
- `894245d` 本身已包含 Skill 上传/查看相关提交，晚于交接单声称的基线。

**判断**

“三份是设计稿，审的不是代码交付”成立；但“仓库代码零改动”作为仓库状态声明不成立。以旧 SHA 和模糊文件数继续做 P0，无法区分交接前代码、并行改动和本轮待实施内容。

**必须修正**

- 生成只读基线清单：HEAD、每个 tracked diff、每个 untracked 文件、SHA-256、归属人/会话、保留/归档/忽略建议；
- 不按 mtime、目录名或“卡死会话记忆”自动提交用户改动；
- `exports/`、真实数据和凭据类内容先做泄露扫描，不能为了清洁工作区直接纳入版本库；
- P0 行政清理与 AgentScope 产品实施拆成两张变更单。

### P0-02：“15 项全部拍板”与文档自身冲突，未决项已泄漏为已决

**事实**

- doc11 §7 标题说“全部已拍板”，但 #4 行仍写“A/B 待终拍”；交接单又直接声明 #4=A。
- #7/#9 需 G3/G6 实测后定；#11b/#14-UI/#15-T2 仍要求原型签字。这些不是无条件终决。
- doc11 A6 仍写“待拍板”，§7 却说 #8 已决定走自有服务。
- doc12 将“T 轨甲案”写成“已拍板方向”，交接单和 doc11 又说甲/乙要在 T2 终拍。
- 交接单列出“G9 回填”，doc11 只有 G1–G8，且 G5 已取消，不存在 G9。

**判断**

当前“已决/条件决/未决/已否决/未来触发再决”五种状态被压成了一个“全部拍板”。这会让实施者越过原型闸门，尤其会误导 T 轨实体选型。

**必须修正**

建立唯一决策账本，每项至少包含：`decision_id`、状态、决定内容、条件、证据、决定人、日期、替代案、重开条件。建议状态：

- #1/#2/#3/#5/#6/#8/#10/#11a/#12/#13：已决；
- #4：条件决，A 起步，达到定义好的检索失败阈值后重新决 B；
- #7/#9：方向性决定，技术载体未决；
- #11b/#14-UI/#15-T2：原型闸门未决；
- N1–N5：未决。

在账本修正前，不应把 doc11 标记为“冻结执行版”。

### P0-03：Runtime Contract v1.1 不足以承载北极星故事

**事实**

doc11 给出的 `/v1/chat` 请求/事件设计没有完整定义以下字段或语义：

- `turn_id`、请求幂等键、同一 turn 的重复提交处理；
- `session_state_revision` 或 CAS 条件；
- Agent/Release/PromptBundle/SkillBundle 的版本指纹；
- `structured_schema` / `output_schema` 的来源和版本；
- SSE event 的封闭联合类型、事件 schema 版本、严格递增 sequence；
- 重连游标、历史 replay、心跳、取消；
- paused / waiting_external / waiting_user 等非终态；
- runtime 已执行但平台未收到终态时的恢复协议。

现有 runtime contract 1.0 对 run 已有 `run_id`、`idempotency_key`、output schema、trace sequence 和 cancel 能力；拟议 chat 契约反而丢失了这些成熟语义。

**影响**

- 北极星故事 1 要求结构化字段，但 chat 请求没有 machine-readable schema 来源；仅在 SKILL.md 中写字段要求，不能等价于 `structured_schema`。
- 终态帧丢失时，平台不知道 runtime 是否已经完成；简单重试会重复模型调用或工具副作用。
- 后续 ExternalExecution/HITL 无法安全暂停和恢复。

**必须修正**

先写可验证的 Contract v1.1 schema 和状态机，再排 C1。最低要求见 §8.2。

### P0-04：`JobQueue chat-turn` 不“天然串行”，会话状态存在并发覆盖

**事实**

- `JobQueue` 只按最早到期任务 `FOR UPDATE SKIP LOCKED` 认领，没有 session 级锁。
- chat-turn payload 只有 run/message 引用；多个 worker 可以同时处理同一 session 的两个 turn。
- A3 计划把完整 AgentState 放在 session JSONB 中，但没有 revision、锁、租约或 CAS。

**影响**

两个 turn 可读取同一个旧 state，各自生成新 state，后完成者覆盖先完成者；消息顺序、计划任务、压缩摘要和工具上下文会丢失。这不是边缘情况，而是多 worker 或用户快速连发时的确定性竞态。

**必须修正**

采用一种明确方案并做多 worker 测试：

- PG advisory lock / session lease，实现一会话至多一个 active turn；或
- `runtime_state_revision` 乐观锁 + 冲突重排队；
- 无论哪种，都要有 turn 幂等键、唯一约束、终态写入 CAS、陈旧 worker 失效规则。

### P0-05：8200 当前是只读 fixture Tool Service，不是生产 MCP Gateway

**事实**

- `services/tool_service/README.md` 明确写着“returns fixture facts only”。
- 服务只暴露四个合成数据查询工具，全部标注 read-only；没有平台 Connection 执行、按 Agent/Release/Run 授权、审批、租户隔离或审计上下文。
- runtime adapter 连接 8200 只能证明 MCP 协议兼容，不能证明 A4 的生产治理链存在。

**判断**

doc11 A4、doc12 现状表和 K13 把“POC Tool Service”写成“平台 MCP Gateway 已现成”是事实性错误。平台 `runner.exec_tool` 具备 Connection/SSRF 逻辑，不代表 AgentScope 经 8200 的调用已经走到这条路径。

**必须修正**

把“生产 Tool Gateway / External Execution Broker”列为独立前置工作，而不是 C2/P4 中的接线细节。至少定义：身份、授权主体、工具/版本、参数约束、Connection 环境、secret resolution、超时、重试、审计、响应脱敏、速率限制和取消。

### P0-06：N3 推荐不可实施，`ResultDelivery` 不能直接扩成多动作 HTTP Outbox

**事实**

- `ResultDelivery` 有 `UNIQUE(run_id)`，语义是一条 Run 最多一个目标表投递。
- 其 worker 强依赖 `TaskRun.output_binding_snapshot`、DataSource writer、目标数据定义和表记录映射。
- 工单场景同一 run 可能包含 create、append_note、update、close 等多个独立动作。

**判断**

doc12 N3 推荐“扩 `target_type=http` 复用 ResultDelivery”不是小扩展：它既违反一 run 一 delivery 的唯一约束，也把命令副作用混入结果投递聚合语义。所谓“不新造第五源”是错误优化目标；表数量不是事件源数量。

**必须修正**

推荐新建 `EgressAction` / `CommandOutbox`，或对 ResultDelivery 做一次有迁移成本的通用 Outbox 重构；不能只加 `target_type`。新模型须支持一 run 多动作、动作顺序/依赖、业务幂等键、目标能力、状态机、响应快照、人工批准、对账和补偿。

### P0-07：Agent 调用同步工具，而 Outbox 是异步写；中间缺少暂停/恢复协议

**事实**

- ReAct 工具调用通常等待工具结果后继续推理。
- doc12 又要求所有外部写先落 Outbox，由 worker 异步执行。
- 当前 chat contract 没有 `waiting_external`、continuation token、外部结果回填或 crash recovery。

**影响**

实现者只能在三种坏选择中临时挑一个：绕过 Outbox 同步直写、向模型返回“已成功”假结果、或长期阻塞 runtime 请求。三者都破坏既定红线。

**必须修正**

明确区分：

- terminal fire-and-forget 动作：模型不再依赖结果，可在 run 终态后投递；
- interactive 动作：runtime 发出 external execution request，平台事务落 Outbox，AgentState 进入 paused，worker 完成后以 action result 幂等恢复同一 turn；
- 高风险动作：先进入 approval_pending，再执行；不得将 unattended 的 `ask` 自动降级成 allow。

### P0-08：模型凭据边界未闭合，“DashScope 原生直行”没有平台级多凭据方案

**事实**

- 平台模型通过 `ModelProvider.auth_connection_id` / Connection 持有凭据引用。
- 当前 AgentScope runtime 使用环境变量式单凭据路径，并不天然知道某个 Agent/tenant 应使用哪条 Connection。
- 文档同时要求平台是事实源、请求不带 Secret、runtime 又直接调用 DashScope。

**判断**

三条约束不能在没有 credential broker 的情况下同时成立。G8 做一次 smoke 不会解决多 provider、多租户、轮换、撤销和审计。

**必须修正**

推荐契约只传 `credential_ref`，runtime 用自身服务身份向平台 Secret Broker 换取短时、最小权限凭据；Broker 做租户/Agent/Release 授权和审计。若不建设 Broker，就必须在“每凭据独立 runtime 部署”或“平台代理模型调用”中明确选择并承认成本。

## 4. P1 高风险问题

### P1-01：K2 将 `create_app` 默认行为误写成自有 Agent 默认行为

AgentScope 官方 Plan 文档明确要求先实例化 `TaskCreate/TaskGet/TaskList/TaskUpdate` 并注册到 Toolkit。`create_app` 的 service toolkit 会“Planning tools — always on”，但普通 `Agent(toolkit=None)` 得到的是空 Toolkit。

因此：

- “AgentScope 提供四个计划工具”成立；
- “自有 runtime 中计划模式框架 always-on”不成立；
- C1 若决定启用，必须显式注册并验收；
- TaskCreate/TaskUpdate 会修改 AgentState，不是“零副作用”，准确说法应是“无外部系统副作用，但有会话状态、token 和行为副作用”；
- 官方还说明依赖阻塞是 advisory，模型仍可越过 blocked task，不应把计划图当强执行编排。

官方依据：[AgentScope Plan — Equip the Tools](https://docs.agentscope.io/versions/2.0.7/en/building-blocks/plan)。

### P1-02：K1 的“100% 开箱、零自研上下文逻辑”范围过度

框架确实会自动装配已提供的 system prompt、skill 描述、摘要、近期上下文和状态提示；但平台仍需决定：

- identity/persona/playbook 的编译和版本；
- Skill 选择、Memory 版本和附件内容边界；
- token 预算、截断、压缩模型、保留字段；
- state envelope、并发、持久化、迁移和回滚；
- 不可信外部内容如何与系统指令隔离。

建议改写为：“AgentScope 原生承担 runtime 内部的上下文组装和压缩；平台仍负责上下文政策、资源编译、版本冻结和持久化协议。”这不是“配置搬运”四个字能覆盖的工作量。

### P1-03：K3 的 Skill “1:1 零转换”不成立，上传已丢失包内资产

AgentScope Skill 的原生单位是目录，除 `SKILL.md` 外可带 scripts/resources/assets。当前上传端点对 ZIP/TGZ 只读取第一份 `SKILL.md`，其余文件全部丢弃；数据库只有全文 Markdown，没有资源清单、包哈希或版本。另有：

- frontmatter 用正则逐行解析，不是完整 YAML；
- Skill 名称没有唯一约束或冲突策略；
- 压缩包中多个 SKILL.md 的选择不确定；
- 缺少路径穿越、符号链接、压缩炸弹和资源大小策略；
- `markdown=row.content` 若包含 YAML 头，与 loader 返回正文的行为不完全相同。

此外，“Skill 正文从不加载”只对旧 HEAD/部分路径成立：当前未提交的 `agent_runtime.py` 已给结构化旧运行路径注入全文，而 chat 仍没有真加载。必须明确观察基线和执行路径，不能再写全局结论。

官方依据：[AgentScope Skill](https://docs.agentscope.io/versions/2.0.7/en/building-blocks/tool/skill)。

### P1-04：A5“前端协议零改动”与计划内容冲突

`thinking_delta`、`state_updated`、计划面板、工具展示位和未来 HITL 卡片都是新增前端可见契约。旧前端忽略未知事件能保持兼容，不等于协议没变。

建议改写为：“C1 对现有文本聊天保持向后兼容；新事件采用 additive schema，旧客户端可忽略。计划/工具/HITL 可视化属于显式前端增量。”

### P1-05：AgentState 作为 opaque JSONB 缺少治理

当前设计没有 state envelope。至少要记录：AgentScope 版本、state schema 版本、Agent/Release/Prompt/Skill 指纹、revision、生成 turn、校验和、字节数和更新时间。还需处理：

- state 可能重复存储完整消息、工具参数、附件片段和 PII；
- 单行无限增长、数据库备份与日志泄漏；
- AgentScope 升级后的 state migration；
- 回退到旧 chat 路径时如何保留摘要与 tasks_context；
- 终态前 runtime 崩溃时最后可恢复点。

建议给 state 设置加密/访问控制、大小上限、保留期和版本迁移测试；“opaque”只能表示平台不解释业务字段，不能表示平台不治理。

### P1-06：LocalWorkspace + PermissionEngine 不是生产沙箱

LocalWorkspace 与 runtime 进程共享 OS 权限。路径白名单不能完整防住 shell 逃逸、符号链接/TOCTOU、子进程、网络外带和宿主凭据读取。带 Bash/Edit/Write 的 Skill 不能因 PermissionRule 存在就进入生产。

生产选择应是：首期完全不开放文件/shell；或使用独立低权用户加进程/容器/OS 沙箱，并限制网络、挂载、资源、进程数和 Secret。P4 必须先有威胁模型和逃逸负向测试。

### P1-07：外部 HTTP 不存在平台单方面保证的 exactly-once

平台可保证“命令记录 exactly-once 创建”，执行通常只能 at-least-once。超时可能发生在远端成功、平台未收到响应之后；没有目标端幂等键或查询对账 API 时，重试会重复写。

`sha256(payload+action)` 不能作为通用兜底：两个合法且内容相同的 append 动作会被错误合并。每个 action definition 必须声明远端幂等能力、重试安全性、对账方法和补偿策略；不具备时应转人工而不是声称 exactly-once。

### P1-08：Trigger 去重、接收和组批状态机不完整

03 号稿的 `(trigger_id, dedup_key) UNIQUE` 若永久生效，会永久丢弃内容相同但合法重复的事件。`sha256(raw payload)` 还依赖 JSON canonicalization，且无法表达幂等窗口。

建议：

- 首选上游稳定 event ID；fallback hash 必须基于 canonical bytes，并有明确时间窗/来源命名空间；
- 状态机至少为 `received → accepted/rejected/duplicate → reserved_in_batch → dispatched`，带 lease 和 crash recovery；
- 使用 batch membership 关系保留每条 event 与 TaskRun 的可追踪性；
- 将“重试原版本”和“用当前映射重新处理”分成两个显式动作；后者不是重放，而是 reprocess。

### P1-09：Webhook 与 Kafka 默认值会导致安全或数据丢失

- HMAC 不能只签 body 后口头声称防重放；需要签 timestamp + 原始 body、恒定时间比较、允许时钟偏差、secret 轮换和 replay window。Stripe 的官方方案也要求使用原始 body 并校验带时间戳的签名。[Stripe webhook signatures](https://docs.stripe.com/webhooks/signature)
- HTTP 202 应在“原始事件已可靠持久化”后返回，过滤、映射、组批宜异步；否则慢处理和失败语义不清。
- Kafka `auto.offset.reset=latest` 在无已有 offset 时从末尾开始，可能跳过既有 backlog；Kafka 官方也警告特定情况下会产生消息丢失。[Kafka consumer configuration](https://kafka.apache.org/40/generated/consumer_config.html#consumerconfigs_auto.offset.reset)
- “每 trigger 一个 group”“保留 7 天”“10 rps/1 MB/30 天”都不是未经容量测试即可冻结的通用默认值。

### P1-10：外部事件内容进入自主 Agent，缺少 Prompt Injection 与越权模型

工单正文、Webhook 字段和附件都是不可信数据。若它们与 system/skill 指令同层拼接，内容可诱导 Agent 调用高风险工具、外传数据或绕过业务约束。

必须定义：内容/指令分层、字段化工具参数、工具最小权限、数据域授权、输出目的地约束、敏感字段脱敏和高风险动作批准。对于 close/delete/refund 等不可逆动作，首期应保持 deny 或人工确认，而不是“All deny → allow”逐步放开后默认无人值守。

### P1-11：验收样本、性能门槛和工期估算没有统计含义

- “20/20”只是样本量，不是通过标准；业务结果对比 openai-agents 是迁移一致性，不等于正确性。
- 需要冻结样本清单和哈希、字段级 metric/tolerance、人工盲评规则、随机性重复次数、模型快照、负例和边界例。
- “延迟增加 <30%”需定义 TTFT、p50/p95、端到端、并发数、样本量和绝对 SLO。
- G 轨同时验证真实模型、state、create_app、团队、外部执行等，1–1.5 天没有置信依据。
- C/B/T 声称天然并行，但会共同修改 runtime contract、DB、runner、Tool Gateway、资源编译和测试；必须先给 change-set/owner/dependency matrix。

## 5. P2 一般纠错

### P2-01：K6 的证据只能证明“2.0.7 无顶层模块”

包内 grep 可以证明当前版本没有 `pipeline` / `msghub` 顶层模块，不能单独证明它们“从 1.x 被删除”。若历史结论对方案无影响，建议删掉“已删除”，只保留“2.0.7 不提供该顶层 API，平台编排继续自持”。

### P2-02：K7“team 工具拆不出”过强

构造器需要 storage/message bus/workspace manager，说明拆用成本高，并非技术上不能拆。正确结论是：“脱离 create_app 需要实现三类适配器，当前收益不足，且 TeamSay 与平台边界冲突，因此 P5。”

### P2-03：Waker bible 与 AgentScope Skill 只部分重叠

原站 bible 同时承担技能路由、审批、门控、交付契约和跨流程约束；AgentScope 原生 Skill 注入只提供名/描述及按需查看正文。二者不是“同功”，更准确是“技能发现部分重叠，治理与流程语义不等价”。

### P2-04：WakerFlow“结构同构”证据不足

实际页面支持“阶段、执行节点、门控、运行记录和触发”这一 UI 级类比，但不足以证明版本冻结、重试、分支、并发、数据契约、补偿和回滚同构。建议改为“UI/概念层结构相似，执行语义待协议级对照”。

### P2-05：K11 的“真缺口恰好五件”仍是半截调查

除会话形态、Prompt、事件、预算、观测外，原站页面还显示或暗示：工作空间绑定、最多五个触发器、Waker/WakerFlow 二选一、创建后生命周期。平台侧还缺并发、重试、成本配额、HITL/查收、WakerFlow 执行器和端到端关联。应改成“已确认至少五项”，不要封口为完整全集。

### P2-06：`trigger="api"` 收编 webhook/mq 会损害审计语义

为了避免修改词表，把 webhook、Kafka 和直接 API 全记为 `api`，会让指标、授权和事故追踪失真。建议新增 `external`，并在结构字段中记录 `source_type/source_id/event_id`；或直接扩词表为 webhook/mq/api。词表多一个值的迁移成本低于长期语义债。

### P2-07：PG 全文检索“零组件”不等于“零工作量”

当前 KnowledgeSource 只有来源元数据，未见完整 ingestion/chunk/index/ACL/citation/sync 模型。中文语料还需确定分词和检索配置并做基准测试。P4 的 3–4 天估算遗漏数据管道；向量升级触发条件也应以检索评测阈值定义，而不是“语义需求真实出现”。

## 6. K1–K15 复核表

| 结论 | 审计结果 | 纠正后表述 |
|---|---|---|
| K1 上下文 100% 开箱 | **需改写** | runtime 组装/压缩原生；平台上下文政策、编译、版本和持久化需自建 |
| K2 Planning always-on | **需改写** | create_app 默认 always-on；自有 Agent 必须显式注册 Task* |
| K3 Skill 1:1 零转换 | **需改写** | SKILL.md 语义兼容；当前上传丢 scripts/resources，必须做保真包模型 |
| K4 structured_schema 原生 | **部分成立** | 原生能力成立；chat contract 未携 schema，重载后校验降级，平台二次校验仍需 |
| K5 自有薄契约优先 | **部分成立** | 选择合理；不是“1 端点+2 位”即可完成，需完整会话协议 |
| K6 pipeline/msghub 已删除 | **部分成立** | 2.0.7 当前无顶层模块；历史删除需版本证据 |
| K7 team 拆不出 | **需改写** | 可通过适配器拆用，但成本/边界不合适，P5 合理 |
| K8 三文件与 Skill 同功 | **部分成立** | 三文件观察成立；bible 仅技能发现部分与 Skill 重叠 |
| K9 WakerFlow 结构同构 | **需改写** | 页面概念相似；执行协议同构未证明 |
| K10 自动任务 UI 模型 | **成立** | 页面观察成立，但不是完整后端数据模型证明 |
| K11 真缺口五件 | **需改写** | AnalysisTask 有 agent 目标成立；缺口至少五项，不是全集 |
| K12 附件假透传 | **成立** | 当前 chat 只拼文件名；C1 还需安全/限额/提取治理 |
| K13 工单积木三态 | **需改写** | 入口仅设计；生产 Gateway 不存在；出站仅目标表投递样板，HTTP 动作非现成 |
| K14 三故事北极星 | **部分成立** | 故事方向好；故事 1 缺 schema 契约，故事 3“协议零改动”需改 |
| K15 推进顺序/天然并行 | **需改写** | 关键共享依赖未闭合，不能按当前并行声明排期 |

## 7. 对 N1–N5 的审计建议

这些是建议，不冒充用户已有决定。

| 决策 | 建议 | 理由 |
|---|---|---|
| N1 高风险写护栏 | 首期 `deny`；第二阶段人工批准；满足远端幂等+对账+补偿后才允许无人值守 | PermissionRule 不是平台最终授权，且不可逆动作无法靠重试保证安全 |
| N2 MQ 范围 | Webhook durable landing 和状态机先完成；Kafka 第二期，独立做 offset/rebalance/回压压测 | 避免同时调试两套接入语义 |
| N3 EgressAction 落点 | 新建 `EgressAction/CommandOutbox`，不要只扩 ResultDelivery | 支持一 run 多动作、动作依赖和与结果投递分离 |
| N4 凭据形态 | `credential_ref` + 平台 Secret Broker + runtime 短时取用 | 满足不在契约传长期 Secret、多租户和轮换 |
| N5 试点工单流 | 先“查询→分类/摘要→拟回复”只读；再加批准后 append_note；close 最后开放 | 先验证判断质量和可观测性，再承担不可逆副作用 |

T 轨甲/乙案不建议仅靠视觉原型终拍。应先回答：指令型自动任务是否仍以“数据集批次”为核心、是否需要独立会话历史、是否支持多触发器/工作空间、生命周期和权限是否与 AnalysisTask 相同。若这些核心不相同，强塞 AnalysisTask 会形成大量 nullable/分支字段，乙案更干净；若 80% 以上状态机和治理完全相同，甲案才合理。

## 8. 修正后的实施路线

### 8.1 Stage 0：可复现基线与决策冻结

交付物：

- Git 文件级 manifest + hash + ownership；
- 唯一决策账本；
- 文档中删除“全部拍板”“天然”“100%”“exactly-once 外部效果”等过度承诺；
- 明确哪些观察基于 HEAD、哪些基于未提交工作区。

闸门：任意审计者可在同一 SHA/manifest 下复现事实，未决项没有被实施文本偷偷固化。

### 8.2 Stage 1：六项架构闭合，不写业务功能

先补六份短 ADR/契约：

1. Chat Contract：turn idempotency、event union/sequence/replay/cancel、structured schema、paused/resume；
2. Session State：revision/CAS、锁、envelope、大小/加密/保留/迁移；
3. Credential Resolution：credential_ref、Broker、runtime 身份、轮换/撤销；
4. Tool Execution：生产 Gateway 与 ExternalExecution 的主次、授权和审计；
5. Command Outbox：一 run 多动作、远端幂等、批准、对账、补偿；
6. Trigger State Machine：durable landing、去重窗口、组批 lease、版本冻结和 replay/reprocess。

闸门：每份都有失败矩阵和至少一个 crash/retry sequence diagram；不能只给 happy path DTO。

### 8.3 Stage 2：最小 chat 纵切

建议拆 C1：

- C1a：无工具、无 Planning 的单 turn runtime chat，先验证事件、幂等、断线 replay、取消和 state CAS；
- C1b：显式注册 Task*，验证 state_updated、计划状态持久化及旧 UI 忽略未知事件；
- C1c：长会话压缩和文本附件，补 MIME、编码、大小/token、恶意内容、PII 和截断测试。

这不是否定“计划随 C1 启用”的产品决定，而是把一个发布阶段拆成可归因的技术闸门。

### 8.4 Stage 3：Skill 保真与资源编译

先修 Skill artifact 模型和 materialization，再做 C2。必须覆盖：包内文件保留、YAML 正确解析、名称冲突、哈希/版本、路径安全、大小限制、纯 prompt 与带工具 Skill 分类。结构化输出 schema 必须来自发布快照，而不是靠模型阅读 Markdown 猜测。

### 8.5 Stage 4：生产工具治理纵切

先用一个只读 ticket_query 完成 Agent→平台授权→Connection→外部系统→脱敏结果→Agent resume 全链；再做一个需要人工批准的 append_note。两条链都通过 crash/retry/duplicate/timeout 测试后，才允许 B/T 轨依赖“工具已现成”。

### 8.6 Stage 5：业务 Agent 迁移

依次做 B1/B2/B3，但验收改成：冻结数据集、字段级准确性、迁移一致性、人工盲评、负例、三次随机重复、模型/Prompt/Skill/schema 指纹、成本和 p95 延迟。20 条可作为 smoke，不应作为最终统计验收全集。

### 8.7 Stage 6：Trigger 与工单写回

顺序建议：durable webhook landing → filter/map → batch state machine → read-only agent → CommandOutbox → approval → append/update → close。Kafka 在 webhook 状态机稳定后接入。T 轨实体选型在 Stage 1 的领域模型 ADR 后终拍，而不是先写成甲案既定。

## 9. 最低放行清单

以下全部满足后，才建议把结论从 REVISE 改为 READY：

- [ ] 基线 SHA/manifest 与工作区事实一致；
- [ ] 决策账本无自相矛盾，T 轨和 N1–N5 保持未决；
- [ ] Chat Contract 含 idempotency、revision、sequence、replay、cancel、schema、pause/resume；
- [ ] 同 session 双 turn、多 worker、worker crash 测试有明确预期；
- [ ] credential_ref 到短时凭据的安全链闭合；
- [ ] 8200 fixture 服务不再被称作生产 Gateway；
- [ ] Skill 压缩包 scripts/resources 不丢失；
- [ ] CommandOutbox 支持一 run 多动作及不确定超时对账；
- [ ] Webhook 在 202 前 durable landing，签名含 timestamp 防重放；
- [ ] Trigger 去重有窗口，replay 与 reprocess 分开；
- [ ] 外部不可信内容有 prompt-injection/数据外传防线；
- [ ] 验收标准有 metric、样本、容差、并发和绝对 SLO；
- [ ] 更新后的依赖图不再声称 C/B/T“天然并行”。

## 10. 证据索引

### 仓库事实

- `docs/v2-design/AUDIT-HANDOFF-agentscope-plan.md:13-14,55-64`
- `docs/v2-design/11-agentscope-full-integration.md:28-32,42,150-157,167-207,264,330-406,675-753`
- `docs/v2-design/12-event-driven-workorder-pipeline.md:25-30,44-45,68-113,130-139`
- `docs/v2-design/03-trigger-and-data-mapping.md:15,53-81,176-205`
- `server/app/models.py:222-236,421-434,740-821,887-957`
- `server/app/agent_chat.py:93-140`
- `server/app/routers/agent_caps.py:296-363`
- `server/app/runner.py:1550-1650`
- `server/app/delivery.py:60-102,145-217`
- `server/app/agent_runtime.py` 当前未提交 diff 与 `HEAD:server/app/agent_runtime.py`
- `services/tool_service/README.md:1-23`
- `services/tool_service/app/main.py:19-68`
- `packages/runtime_contract/src/quality_runtime_contract/models.py:66-90,114-185`

### 官方资料

- [AgentScope Context Overview 2.0.7](https://docs.agentscope.io/versions/2.0.7/en/building-blocks/context/overview)
- [AgentScope Plan 2.0.7](https://docs.agentscope.io/versions/2.0.7/en/building-blocks/plan)
- [AgentScope Skill 2.0.7](https://docs.agentscope.io/versions/2.0.7/en/building-blocks/tool/skill)
- [AgentScope Run Agent 2.0.7](https://docs.agentscope.io/versions/2.0.7/en/building-blocks/agent/run-agent)
- [AgentScope Agent Service 2.0.7](https://docs.agentscope.io/versions/2.0.7/en/deploy/agent-service)
- [Apache Kafka consumer `auto.offset.reset`](https://kafka.apache.org/40/generated/consumer_config.html#consumerconfigs_auto.offset.reset)
- [Stripe webhook signature verification](https://docs.stripe.com/webhooks/signature)

## 11. 最终意见

这套方案的主方向可以保留：平台继续掌握事实源和治理面，AgentScope 提供 Agent 执行、上下文、结构化输出与 Skill 运行能力；不整体引入 create_app 也是合理选择。

但当前版本把 POC 能力、框架可用能力和平台已接通能力混在了一张表里，形成了“看起来只差接线”的错觉。实际上 C1 之前还存在一层必须完成的分布式系统设计。只要先把 §8.2 六项契约闭合，后续路线仍能沿用大部分现有材料；如果跳过这一层，最可能发生的不是 AgentScope 不能跑，而是对话状态丢失、重复外部写、工具越权和中途返工。
