# AgentScope 方案纠错执行总控单

> 日期：2026-09-08  
> 上游审计：`research/morethancorn/mtc003008-audit/AGENTSCOPE-PLAN-AUDIT.md`  
> 使用对象：后续承担方案修订、ADR、契约设计、原型验证和最终实施的 Agent 及人工审阅者。  
> 当前阶段：**只允许基线清理、设计纠错和验证性 spike；产品代码实施尚未放行。**

## 0. 总控结论

保留 AgentScope 2.0.7 作为唯一 Agent 运行底座，保留“平台掌握事实源和治理、runtime 负责 Agent 执行”的总体边界。

不要直接执行 doc11 当前的 P0→G→C/B/T 排期。先完成本总控单 Wave 0–2，消除八项阻断问题，再由人工给出一次明确的 `IMPLEMENTATION_READY` 决定。未收到该决定前，任何 Agent 不得创建迁移、修改 runtime contract、接入生产工具或改动 chat 执行路径。

建议执行顺序：

```text
Wave 0  基线与决策账本
   ↓
Wave 1  六项架构契约并行设计
   ↓
Wave 2  跨契约整合、失败演练、计划重排
   ↓  人工闸门：IMPLEMENTATION_READY
Wave 3  Chat 最小纵切
   ↓
Wave 4  Skill 保真 + 只读工具纵切
   ↓
Wave 5  业务 Agent 迁移
   ↓
Wave 6  Trigger + CommandOutbox + 工单写回
```

## 1. 所有执行 Agent 的共同规则

### 1.1 开工前必读

每个 Agent 必须完整阅读：

1. `research/morethancorn/mtc003008-audit/AGENTSCOPE-PLAN-AUDIT.md`；
2. `docs/v2-design/AUDIT-HANDOFF-agentscope-plan.md`；
3. 与自己任务直接相关的 doc11/doc12/doc03 章节；
4. 自己引用的当前代码，不得只引用上游文档里的行号；
5. 涉及 AgentScope 行为时，对照 2.0.7 官方文档和当前安装包实现。

### 1.2 事实纪律

- 明确区分“当前 HEAD”“当前未提交工作区”“POC”“设计目标”“原站观察”和“审计建议”。
- 不能用“grep 没找到”证明历史上被删除，也不能用构造器依赖证明能力绝对不可拆。
- 不能把 `create_app` 的默认装配外推成普通 `Agent` 的默认行为。
- 不能把 UI 页面相似写成执行协议同构。
- 所有“现成、天然、零改动、100%、exactly-once、全部拍板”必须给出可反驳的精确定义和证据；否则换成边界明确的表述。
- 数字验收必须包含样本、分母、阈值、容差、重复次数和测试环境。

### 1.3 工作区纪律

- 当前工作区已有大量用户/其他会话改动。未完成 W0-1 归属清单前，不得整理、提交、删除、移动或覆盖这些文件。
- 每个 Agent 只修改自己的 `allowed_paths`。需要跨界时先在交付物中提出，不直接动别人的文件。
- Wave 0–2 默认只允许新增 `research/morethancorn/mtc003008-audit/remediation/` 下的文档或证据；不得修改 doc03/doc11/doc12 本体。
- 原设计稿的统一修订只由 W2-3 执行，避免多个 Agent 同时改写同一文件。
- 禁止把 `exports/`、真实业务数据、凭据、token、Cookie 或原站登录态写入 Git/报告。

### 1.4 每项交付的固定格式

每个工作包必须输出：

1. `结论`：接受、修正或否决什么；
2. `事实证据`：文件+行号、官方 URL、测试名/结果摘要；
3. `边界与非目标`；
4. `状态机或序列`；
5. `失败矩阵`：超时、重复、并发、崩溃、取消、权限拒绝；
6. `数据/契约字段`；
7. `迁移与回滚`；
8. `开放问题`：不得偷偷替用户做产品决定；
9. `验收清单`；
10. `对 doc03/doc11/doc12 的修订建议`，但 Wave 0–1 不直接改主文档。

## 2. 角色与并行边界

建议最多四个 Agent 并行，角色不是永久身份，可在下一 Wave 复用：

| 角色 | 职责 | 独占输出 |
|---|---|---|
| Coordinator | 基线、决策账本、跨文档整合、最终状态 | `remediation/00-*`、`remediation/90-*` |
| Runtime Agent | Chat Contract、AgentState、事件与恢复 | `remediation/10-*`、`remediation/11-*` |
| Security/Tool Agent | Credential、Tool Gateway、沙箱与授权 | `remediation/20-*`、`remediation/21-*` |
| Event/Data Agent | Trigger 状态机、CommandOutbox、远端幂等 | `remediation/30-*`、`remediation/31-*` |

并行时禁止：

- 两个 Agent 同时修改 doc11；
- Runtime Agent 自行决定 N1/N3/N4；
- Event/Data Agent 假设 Tool Gateway 已存在；
- Security/Tool Agent把“PermissionRule 可配置”当成平台授权已经实现；
- Coordinator 为了消除冲突擅自把条件决标成已决。

## 3. Wave 0：基线与决策清账

### W0-1 工作区事实基线

**Owner**：Coordinator  
**允许路径**：`remediation/00-worktree-baseline.md`、必要的只读证据附件  
**禁止**：提交、删除、归档、改 `.gitignore`、改产品代码

任务：

- 记录当前 HEAD、分支和审计时间；
- 展开所有 tracked/untracked 文件，不只统计顶层状态项；
- 为每个文件记录状态、SHA-256、与 HEAD 的差异规模、可能来源、是否含真实数据/Secret 风险；
- 将文件分为：已提交产品基线、用户未提交代码、设计稿、审计材料、生成物、真实数据风险、未知归属；
- 对未知归属只列问题，不给出自动处置动作；
- 明确 doc11 的“现状盘点”到底对应哪个 SHA/工作树。

验收：另一个 Agent 仅靠清单即可定位所有文件；文件计数能解释“50、51、110”三个数字各自统计口径。

### W0-2 决策账本

**Owner**：Coordinator  
**允许路径**：`remediation/01-decision-ledger.md`

任务：

- 把 #1–#15、N1–N5、T 甲/乙、查收回炉、知识检索升级条件统一收录；
- 状态只允许：`DECIDED`、`CONDITIONAL`、`EXPERIMENT_PENDING`、`PROTOTYPE_PENDING`、`OPEN`、`REJECTED`；
- 每项写清决定内容、条件、重开条件、证据、冲突文档段落；
- 删除不存在的 G9；说明 G5 是取消还是保留编号占位；
- 对 #4、#7、#9、#11b、#14-UI、#15-T2 不得标成无条件 DECIDED；
- doc12 的“T 轨甲案已拍板”必须列为待修正冲突。

验收：任何实施任务都能引用唯一 decision ID；主文档没有第二套状态定义。

### Wave 0 闸门

- W0-1、W0-2 均完成；
- 未知归属文件没有被碰；
- 人工确认账本状态后，才启动 Wave 1。

## 4. Wave 1：六项架构闭合

Wave 1 可以三个专业 Agent 并行。所有产物仍是设计和验证，不改产品代码。

### W1-1 Chat Runtime Contract v1.1

**Owner**：Runtime Agent  
**输出**：`remediation/10-chat-runtime-contract-v1.1.md`

必须定义：

- request：`schema_version`、`run_id`、`turn_id`、`idempotency_key`、`session_id`、`expected_state_revision`、Agent/Release/Prompt/Skill 指纹、model ref、credential ref、当前消息、附件、output schema、预算、deadline；
- event envelope：`event_id`、`sequence`、`type`、`timestamp`、`run_id`、`turn_id`、payload、schema version；
- event union：text/thinking/model/tool/state/usage/structured output/error/completed/paused；
- SSE：心跳、断线游标、replay、live 拼接、背压、慢消费者、保留期；
- cancellation：请求取消、runtime 接受、模型不支持取消、取消与终态竞态；
- 幂等：重复 submit、平台收不到终态、runtime 完成后重试；
- output schema：机器可读来源、版本、校验降级、平台二次校验；
- 外部执行和 HITL 的 pause/resume token。

必须给出至少六张时序：正常、重复提交、SSE 断线、runtime 崩溃、平台崩溃、external execution pause/resume。

否决条件：若文档仍只有“一个 POST + 两个 capability 位 + 终态 state”，视为未完成。

### W1-2 Session State 与并发一致性 ADR

**Owner**：Runtime Agent  
**输出**：`remediation/11-session-state-consistency-adr.md`

比较并终选：

- PG advisory lock / session lease；
- revision CAS + 冲突重排队；
- 二者组合。

必须定义：

- 一 session 同时允许多少 active turn；
- state envelope：AgentScope 版本、state schema、revision、Agent/Release/Prompt/Skill 指纹、turn、checksum、size；
- CAS 失败、陈旧 worker、lease 过期、重复终态的处理；
- PII、附件、工具参数的加密、访问、保留、清理；
- state 最大体积和压缩/归档策略；
- AgentScope 升级迁移与降级回退；
- 旧直连 chat 回退时允许损失什么、如何向用户显式降级。

验收场景：两个 worker 同时执行同 session 两个 turn，不能出现 state 覆盖或消息倒序。

### W1-3 Credential Resolution ADR

**Owner**：Security/Tool Agent  
**输出**：`remediation/20-credential-resolution-adr.md`

至少比较：

1. `credential_ref + Secret Broker + 短时凭据`；
2. 每凭据/租户独立 runtime；
3. 平台代理模型调用。

默认推荐方案 1，但 Agent 必须验证当前 Connection/ModelProvider 模型是否支持。必须写清：runtime 服务身份、tenant/Agent/Release 授权、缓存时长、轮换、撤销、审计、日志脱敏、Broker 不可用和运行中凭据失效。

禁止把长期 API key 放入 Runtime Contract、RunEvent、AgentState 或普通环境变量快照。

### W1-4 Production Tool Gateway / External Execution ADR

**Owner**：Security/Tool Agent  
**输出**：`remediation/21-tool-execution-boundary-adr.md`

任务：

- 明确 8200 当前是 fixture Tool Service，不是生产 Gateway；
- 对比 MCP proxy 与 `RequireExternalExecutionEvent`，决定主链和补充链；
- 定义授权主体：tenant、user/service principal、Agent、Release、Run、ToolVersion、Connection environment；
- 定义 schema 校验、参数约束、SSRF、响应大小/脱敏、超时、取消、速率限制、审计；
- 明确 runtime PermissionEngine 是体验/纵深防御，平台授权才是最终控制；
- 定义 LocalWorkspace、文件/shell 工具的生产禁用条件与未来沙箱门槛。

首个目标只允许只读 `ticket_query`，不得用外部写动作验证 Gateway。

### W1-5 TriggerEvent 状态机 ADR

**Owner**：Event/Data Agent  
**输出**：`remediation/30-trigger-event-state-machine-adr.md`

必须定义：

- 202 返回前的 durable landing 边界；
- webhook raw body、timestamp 签名、secret version/rotation、replay window；
- event ID 优先、canonical hash fallback 和去重窗口；
- `received/accepted/rejected/duplicate/reserved/dispatched/failed` 状态；
- batch lease、membership、flush race、worker crash recovery；
- filter/mapping/definition/Agent/Workflow/Connection 环境的版本冻结；
- replay original 与 reprocess current 的不同语义；
- Kafka offset 起点、commit 时机、rebalance、回压、毒消息和 group 策略；
- 端到端 correlation：event→batch→TaskRun→Run→Action。

推荐把 `TaskRun.trigger="api"` 泛化方案改为 `external + source_type`，但这仍须在 ADR 中比较迁移成本后决定。

### W1-6 CommandOutbox ADR

**Owner**：Event/Data Agent  
**输出**：`remediation/31-command-outbox-adr.md`

必须否决“仅给 ResultDelivery 增 target_type=http”的 N3 原推荐，除非能完整解决 `UNIQUE(run_id)` 和目标表专用 worker 的迁移。

设计至少包含：

- 一 Run 多 Action；
- action definition/version、Connection/environment、请求/响应脱敏快照；
- dependency/order、状态机、attempt、deadline、审批状态；
- 平台命令记录 exactly-once 与远端效果 at-least-once 的术语边界；
- 目标幂等键、未知超时、查询对账、人工 reconcile、补偿；
- terminal fire-and-forget 与 interactive pause/resume 两类调用；
- append/close/delete/refund 等动作的风险等级；
- Action result 如何幂等恢复 Agent 或 Workflow。

默认建议：新建 `EgressAction/CommandOutbox`，ResultDelivery 保持“Run 输出投递到目标表”的单一职责。

### Wave 1 闸门

每份 ADR 必须互相引用，不允许留下以下循环假设：

- Chat 假设 Gateway 已经存在；
- Gateway 假设 Credential 已经能解析；
- CommandOutbox 假设 Chat 已能 pause/resume；
- Trigger 假设 CommandOutbox 能 exactly-once 写外部；
- State ADR 假设 JobQueue 自动串行。

## 5. Wave 2：整合与重新排期

### W2-1 跨契约一致性审查

**Owner**：Coordinator，另选一个未撰写对应 ADR 的 Agent 交叉复核  
**输出**：`remediation/90-cross-contract-review.md`

逐项验证：

- ID、状态和值域是否一致；
- Run/Turn/Session/Event/Action 的责任边界；
- idempotency key 的作用域和唯一约束；
- 版本指纹是否贯穿 event→run→action；
- Secret 是否可能进入 state/event/log；
- cancel、timeout、crash、retry 的终态是否收敛；
- 外部写成功但响应丢失时是否可对账；
- rollback 是否诚实描述能力降级。

必须做桌面演练：

1. 用户快速连发两个 turn；
2. runtime 完成但 SSE 终态丢失；
3. tool 请求已落库，worker 崩溃；
4. 远端 close 成功但 HTTP 超时；
5. Kafka 消费成功，组批前进程崩溃；
6. Skill/Prompt 在 run 中途发布新版本；
7. credential 被撤销；
8. 恶意工单正文要求忽略规则并导出数据。

### W2-2 修订验收与容量计划

**Owner**：Coordinator  
**输出**：`remediation/91-acceptance-and-capacity-plan.md`

定义：

- Chat：TTFT、p50/p95、断线恢复、状态一致性、并发 session 数；
- Structured output：字段级 precision/recall 或 exact match、容差、schema 失败率；
- Skill：挂载/不挂载对照、资源读取、未声明工具负例；
- 业务迁移：冻结数据集/hash、盲评、三次重复、模型/Prompt/Skill/schema 指纹；
- Trigger：接收吞吐、积压、组批延迟、重复率、恢复时间；
- Action：重复外部效果率、未知终态率、人工对账 SLA；
- 成本：每 turn/record/token/tool/action 成本和全局预算/circuit breaker。

20 条可作为 smoke；正式验收样本量须由风险与误差目标决定，不得直接把“20/20”当统计充分性。

### W2-3 主设计稿统一修订

**Owner**：Coordinator，必须在 W2-1/W2-2 完成后独占执行  
**允许路径**：doc03、doc11、doc12、交接单  
**前置**：人工明确授权修改主设计稿

修订要求：

- 以 decision ledger 为唯一状态源；
- 修正 K1–K15；
- 插入六项 ADR 的结论与引用；
- 重排依赖和阶段；
- 删除已失真的基线声明；
- 把 A5 改为向后兼容而非协议零变化；
- 区分 fixture Tool Service 与 production Gateway；
- 将 N3 推荐改为新的最终决定或保持 OPEN；
- 对所有估时标注假设、范围和置信度。

W2-3 完成后重新做一次独立文档审计。原审计作者不应单独给自己放行。

### Wave 2 人工闸门

只有用户/项目负责人明确写下以下决定，才进入代码实施：

```text
IMPLEMENTATION_READY
accepted_baseline: <sha + manifest version>
accepted_decision_ledger: <version>
accepted_contracts: <list + version>
open_items_allowed_for_spike: <list>
```

没有这条决定，后续 Agent 只能继续文档纠错或做隔离 spike。

## 6. Wave 3–6 实施工作包骨架

以下工作包只在 `IMPLEMENTATION_READY` 后生效。它们是顺序建议，不是本轮授权。

### Wave 3：Chat 最小纵切

| 包 | 内容 | 主要验收 |
|---|---|---|
| C1a | 无工具、无 Planning 的 runtime chat | submit 幂等、event sequence、replay/cancel、state CAS、多 worker |
| C1b | 显式注册 Task* | Task* schema 可见、state_updated、重启保持、旧 UI 忽略未知事件 |
| C1c | 压缩与文本附件 | MIME/编码/大小/token/PII/恶意内容/截断、压缩调用成本归因 |
| C1d | 灰度与回退 | 灰度指标、回退的状态降级提示、无静默丢失 |

### Wave 4：Skill 与只读工具

| 包 | 内容 | 主要验收 |
|---|---|---|
| C2a | Skill artifact 保真 | ZIP/TGZ scripts/resources/assets 全保留；YAML/冲突/路径/炸弹负例 |
| C2b | Skill runtime materialization | 版本/hash 冻结、viewer 真读取、无挂载对照 |
| GTool-1 | 只读 ticket_query | Agent→授权→Connection→远端→脱敏→resume 全链 |
| GTool-2 | 人工批准 append_note spike | pause/approve/execute/resume、重复/超时/拒绝 |

### Wave 5：业务 Agent 迁移

- B1 业务分析；
- B2 质检；
- B3 Release 重绑；
- C3 统一资源编译器。

每个迁移包都必须冻结 Agent/Release/Prompt/Skill/schema/model/credential environment 指纹，不能只记录“使用 AgentScope”。

### Wave 6：事件与工单闭环

| 顺序 | 内容 | 开放写权限 |
|---|---|---|
| S1 | Durable webhook + TriggerEvent | 无 |
| S2 | filter/map + batch state machine | 无 |
| S3 | read-only agent 分类/摘要/拟回复 | 无 |
| S4 | CommandOutbox + 人工批准 append_note | 单动作、批准后 |
| S5 | update_ticket | 条件开放 |
| S6 | close_ticket | 最后开放，要求对账/补偿和人工策略 |
| S7 | Kafka | 不改变动作权限，只增加入口 |

## 7. 推荐先行决定

这些是总控建议，需用户确认后写入 decision ledger：

1. **N1**：高风险写首期 deny，第二阶段人工批准；不能直接从 all-deny 过渡为无人值守 allow。
2. **N2**：Webhook 状态机先行，Kafka 第二期。
3. **N3**：新建 CommandOutbox/EgressAction，不直接扩 ResultDelivery。
4. **N4**：采用 `credential_ref + Secret Broker + 短时凭据`。
5. **N5**：试点顺序为只读分类/拟回复 → 批准后 append_note → update → close。
6. **Planning**：产品上仍随 C1 发布，但工程上拆 C1a/C1b 两个闸门，Task* 必须显式注册。
7. **T 轨实体**：先完成领域模型 ADR，再决定扩 AnalysisTask 还是独立实体；不以 UI 原型代替领域判断。

## 8. 可直接复制给执行 Agent 的任务提示

### Coordinator 提示

> 你负责 AgentScope 纠错计划的 Wave 0。完整阅读审计报告和本总控单。只做只读仓库核对，并在 remediation 目录输出工作区基线与唯一决策账本。不要修改代码、原设计稿、Git 历史或未知归属文件。每个事实给出当前 SHA、文件行号或可复核证据；严格区分已决、条件决、实验待定、原型待定和开放项。完成后报告仍然阻断 Wave 1 的事项。

### Runtime Agent 提示

> 你负责 W1-1/W1-2：Chat Runtime Contract v1.1 与 Session State 一致性 ADR。不要写实现代码。必须解决 turn 幂等、session 并发、state revision/CAS、SSE sequence/replay/cancel、structured schema、pause/resume、崩溃恢复和状态治理。不要假设 JobQueue 天然串行，也不要把 create_app 默认行为当成普通 Agent 默认。输出失败矩阵、时序和验收场景。

### Security/Tool Agent 提示

> 你负责 W1-3/W1-4：凭据解析和生产工具执行边界。不要把 8200 fixture Tool Service 称为生产 Gateway。比较 Secret Broker、独立 runtime 和平台代理模型调用，给出终选依据；再定义 Tool Gateway/ExternalExecution 的身份、授权、Connection、Secret、SSRF、审计、超时、取消和脱敏。Runtime PermissionEngine 只能是纵深防御。首个纵切只允许只读 ticket_query。

### Event/Data Agent 提示

> 你负责 W1-5/W1-6：TriggerEvent 状态机与 CommandOutbox ADR。不要改代码。202 必须建立在 durable landing 上；定义去重窗口、batch lease、版本冻结、replay/reprocess、Kafka offset/rebalance。否决把远端效果称为 exactly-once；处理一 Run 多 Action、未知超时、远端幂等、对账、批准、补偿和 Agent pause/resume。优先评估独立 EgressAction/CommandOutbox，不得只加 ResultDelivery target_type。

### Cross-review Agent 提示

> 你不是重写四份 ADR，而是寻找它们之间的循环假设和失败时不收敛之处。用八个桌面演练逐一穿透 Chat、State、Credential、Gateway、Trigger 和 CommandOutbox，检查 ID、版本、幂等作用域、Secret 边界、终态和回滚是否一致。发现冲突时指出责任 ADR，不替作者静默补洞。

## 9. 完成定义

本纠错任务的完成不是“文档都写了”，而是：

- 基线可复现；
- 决策状态唯一且无偷渡；
- 六项契约在失败场景中能够收敛；
- 计划依赖真实，不再靠“天然并行”；
- 原设计稿完成统一修订并通过一次非作者复审；
- 用户明确签发 `IMPLEMENTATION_READY`。

在此之前，AgentScope 是已经选定的技术方向，但还不是已经具备可安全实施条件的完整方案。
