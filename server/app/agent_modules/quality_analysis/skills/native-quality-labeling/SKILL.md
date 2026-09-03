---
name: native-quality-labeling
description: 对脱敏服务热线通话记录做质检打标的工作流（native_quality_v0.2）：从通话中识别消费者诉求/知识陈述/坐席承诺，按阶段工具白名单逐项核验（知识多轮检索、承诺按类型绑定事实工具），经完成屏障汇总后输出结构化质检标签（findings/labels）。当需要对单条通话记录打标、质检、核验坐席知识准确性或承诺履约情况时使用。
---

# 通话质检打标（native_quality_v0.2）

来源：DSH 实现 `runtimes/deepseek_harness/plugins/native_quality_workflow.mjs`，
与 `quality-analysis@1.0.0` 模块 spec/Schema 及 OpenAI/AgentScope runtime 的同名
工作流语义一致。本技能是这套打标逻辑的规范描述；任何 runtime 实现必须遵守。

## 适用范围与边界

- **输入**：一条已脱敏的服务热线通话记录（`sample_id` + 对话 messages，可含 case_id/start_time/产品上下文）。
- **输出**：结构化打标结果（见"输出契约"）。
- **只读**：只允许查询类工具（知识库检索、工单/短信/预约查询）。禁止任何写操作（不得真正创建工单、发短信、改预约）。
- **事实边界**：所有结论必须来自输入通话或工具返回的事实。禁止补充输入中不存在的人物、时间、业务动作或政策。**证据不足时必须输出 `insufficient_evidence`，不能猜测。**
- **不算分**：打标只给结论与标签；质检分数由平台 Scorecard/规则引擎派生。

## 工作流总览

```
identify → plan → execute/*（并行，受并发上限约束） → barrier → synthesize
```

治理原则：**阶段推进、计划生成、工具白名单、完成屏障由代码控制**；模型只负责
单阶段内的推理与工具调用。阶段迁移不允许由模型自由决定。

## 阶段 1：identify（识别）

从通话逐项提取三类事项，**不得合并相互独立的事项**：

1. **消费者诉求** `consumer_needs[]`：category ∈ {repair, complaint, policy_consultation, appointment, other}，含 description 与 evidence_sequences（证据句序号）。
2. **知识陈述** `knowledge_claims[]`：坐席给出的**可由知识库核验**的政策、规则、产品知识、费用、办理条件、标准流程陈述。
3. **坐席承诺** `promises[]`：具体、针对当前个案、可由业务事实核验的未来动作。type ∈ {ticket, sms, appointment}，含 commitment 与 evidence_sequences。

关键区分规则：

- "我会……""将在……内……"等**未来时业务动作和时限属于承诺，不属于知识陈述**。
- **工单已提交、短信已发送、预约已创建等个案业务状态是承诺核验对象**，不得归为知识陈述。
- 仅出现承诺、未出现产品规则/政策/费用/办理条件/标准流程陈述时，知识维度不适用（`not_applicable`），且禁止调用 knowledge_search。
- 不构成可核验承诺、必须判 `not_applicable` 的内容：泛泛的服务态度或过程表态（"尽快处理""持续关注""马上帮您处理"）、没有明确业务动作的安抚、面向所有客户的统一规则或时限说明（统一规则只进入知识维度）。
- 录音中没有任何坐席发言：辱骂维度输出 `insufficient_evidence`，知识与承诺维度输出 `not_applicable`，不得调用任何工具。

本阶段**不使用任何工具**。

## 阶段 2：plan（计划生成，确定性）

计划由代码根据 identify 结构化结果确定性生成，**不交给模型自由创造**：

- 每条 `knowledge_claim` → 一个知识核验计划，工具固定 `knowledge_search`。
- 每条 `promise` → 一个承诺核验计划，工具按类型严格绑定：

| promise.type | 绑定工具 |
| --- | --- |
| ticket | ticket_query |
| sms | sms_query |
| appointment | appointment_query |

## 阶段 3：execute（逐计划核验，并行 + 阶段白名单）

计划并行执行（并发上限 2）。每个执行阶段只能看见并使用自己的白名单工具，
**白名单外的工具物理不存在**（不是提示词禁止，而是根本不注册）。

### 知识核验（knowledge-N）

- 只可使用 `knowledge_search`。
- **第一条知识陈述（knowledge-1）至少两轮真实检索**：第一轮宽查询（只用核心词，不带地区/型号），第二轮加入地区、型号、保修状态做精确查询。禁止首轮检索后直接提交。
- 其余知识陈述至少一轮：检索结果 `decisive=true` 即提交；否则按 `refinement_hints` 改写查询继续检索，直到证据充分（最多 3 轮）。
- 输出：`status ∈ {accurate, inaccurate, insufficient_evidence}` + `search_rounds[]`（每轮 query / evidence_refs / decisive）+ `evidence_refs[]` + `reason`。
- 禁止用常识补齐证据。

### 承诺核验（promise-N）

- 必须且只能调用其绑定工具**一次**。
- 输出：`status ∈ {fulfilled, unfulfilled, mismatched, insufficient_evidence}` + `evidence_refs[]` + `reason`。
- 不允许模型以"我觉得无需查系统"跳过：只要进入承诺核验计划，规定工具必须被真正调用。

## 阶段 4：barrier（完成屏障）

所有计划必须进入终态（completed/failed）才能进入 synthesize。
**屏障不满足时整个打标运行失败，不得提前产出最终标签**（禁止伪 succeeded）。

## 阶段 5：synthesize（汇总）

- **不使用任何工具**。
- 只读取已完成的结构化执行结果（诉求/知识核验/承诺核验），不得重新查询事实、不得新增或修改事实、不得把 `insufficient_evidence` 改成通过。
- 产出一段简洁总结（summary），引用关键核验结论。

## 输出契约

### 核验事实（中间产物）

```
{
  sample_id,
  consumer_needs: [{need_id, category, description, evidence_sequences}],
  knowledge_claims: [{claim_id, claim, status, search_rounds, evidence_refs, reason}],
  promises: [{promise_id, type, commitment, tool, status, evidence_refs, reason}],
  workflow: {stage_order, plans: [{plan_id, kind, subject_id, status, tool_policy}], barrier_passed},
  summary
}
```

### 平台打标投影（最终 Run.output，符合 quality_output.schema.json）

由代码确定性投影（不经模型改数）：

- **findings**：
  - `knowledge_accuracy`：有知识核验时——任一 `inaccurate` → `failed`；否则任一 `insufficient_evidence` → `insufficient_evidence`；否则 `passed`。无知识陈述 → `not_applicable`。
  - `promise_fulfillment`：有承诺核验时——任一 `unfulfilled`/`mismatched` → `failed`；否则任一 `insufficient_evidence` → `insufficient_evidence`；否则 `passed`。无承诺 → `not_applicable`。
  - `abusive_language`：native v0.2 流程不含辱骂检测阶段，不输出该 criterion。
  - evidence：每条核验的证据引用（source=conversation/tool，reference，summary）。
- **labels**：`service_type_code` 取首个消费者诉求的类别映射（repair→REPAIR，complaint→COMPLAINT，policy_consultation→CONSULTATION，appointment/other→OTHER）；`issue_codes` 取失败维度对应码（knowledge_accuracy failed→KNOWLEDGE_ERROR，promise_fulfillment failed→PROMISE_NOT_FULFILLED）。**标签只能取 Master Data 中已有的 code。**
- **confidence**：决定性结论 0.9；证据不足 0.5；不适用 1.0。

## 禁止事项

- 禁止编造输入或工具结果中不存在的事实、数值、证据。
- 禁止猜测；证据不足一律 `insufficient_evidence`。
- 禁止调用白名单外的工具；禁止为"保险"调用全部工具。
- 禁止把期望答案/参考答案（expected）注入打标过程。
- 禁止计算质检分数。
- 禁止在屏障未通过时输出最终标签。
