# 13 · WakerFlow 脚本语义实地核证（2026-09-12）

> 方法：活体实例 127.0.0.1:19830 只读观察（页面 API fetch，未运行/未编辑任何 Flow）。
> 证据：`wakerflow-script-evidence-20260912.json`（`/api/agents/{wakerId}/workflows/{id}` 原始响应，含完整 script）。
> 样本：`weekly-meeting-prep`（wfId `e3a14b4c-7066-4b73-8e87-a4090d836d28`，Waker=RESEARCH-INSTANCE-20260905，2026-09-10 由 NL 生成，0 次运行）。
> 用户假设：「WakerFlow 不是普通 flow，是通过脚本驾驭单/多 agent 串、并、循环执行的能力」——**核实为真**。

## 1. 本质：WakerFlow 定义是一段可执行的 JS 模块

定义对象核心字段：`script`（9.6KB JS 源码）+ `meta.callSites[]`（primitive/label/line/column）+ `digest` + `scope{kind:'waker', agentId}` + `generationSessionId`。Canvas 视图是脚本经 callSites 的**投影**，不是独立定义；Script 视图才是第一事实源。

## 2. 脚本 = 自由 JS + 五个编排原语

`export const meta = { name, description, whenToUse, inputSchema, outputSchema, phases[] }`（I/O 用 JSON Schema 强约束；phases 带逐阶段 detail，仅供观测分组）。

| 原语 | 签名（实测样本） | 语义 |
|---|---|---|
| `phase(title)` | `phase('生成周会议程')` | 观测分组标记（时间线/看板按 phase 聚合），非执行边界 |
| `worker(prompt, opts)` | `await worker(\`…${变量}…\`, { label, phase, inputs, outputs, schema, resolve: { kind:'waker', wakerId } })` | 驱动任意 Waker 执行一段 Prompt，JSON Schema 校验结构化输出；**resolve 可指定别的 Waker=多 agent** |
| `askUser(prompt, opts)` | `await askUser(…, { options:['采纳当前议程','需要调整'], defaultValue, label, phase })` → `{value, skipped}` | 人工确认/输入（HITL），可跳过 |
| `parallel([fn,…])` | `await parallel([() => worker(…), () => worker(…), () => worker(…)])` | 并行扇出（样本：三份分角色清单），失败项降级 `.filter(Boolean)` 并 log 缺口 |
| `log(msg)` | `log(\`第 ${round+1} 轮修订…\`)` | 过程日志 |

脚本主体即普通 JS：模板字符串拼 Prompt、`for (let round=0; round<2; round++)` 修订循环（配 `break`/最大轮数）、`if (check.skipped || …)` 条件、`reduce` 校验时长合计——**串行=顺序 await、并行=parallel()、循环/条件=原生 JS 控制流**，无需任何 DSL 节点。

## 3. 对既有认知的修正

1. doc11 v4.1 决策点13「NL 生成但产物结构化（阶段序列+节点）」**不准确**：产物就是代码，结构化阶段序列是 callSites 投影。
2. 「无视觉设计器」需再表述：编辑器是 Canvas/Script 双视图、右侧 AI 对话共编；Canvas 可看可调，但事实源在 script。
3. 08 号稿「WakerFlow≈team 产品化外壳」降权：脚本原语是单 agent 编排语义（worker 可解析到其他 waker，但没有 TeamSay/互调语义），更接近「agent 版的确定性程序」。
4. 与我方三执行体对照：AgentFlow=声明式节点 DAG（拓扑串行、无循环/并行分支）；Workflow=确定性数据流（有 branch/foreach 但 agent 非一等公民）；WakerFlow=**脚本编排的 agent 程序**，两者都不是它的同构物。

## 4. 影响面（待拍板，未动任何代码/Spec）

- Spec §6 执行目标 union「Agent/AgentFlow/Workflow」与 §8 三执行体适配契约：若要对齐 WakerFlow 语义，AgentFlow 需要「脚本解释器」运行时（worker/phase/parallel/askUser/log 五原语；并行=asyncio、HITL=既有 ApprovalCard、worker=既有 Session 执行通道），不是现有 DAG 引擎加节点。
- F0 已交付的执行真实性（异步/增量/token）与脚本化改造正交，全部复用。
- 关键拍板点：①是否将「脚本编排 AgentFlow」立项（原型闸门）；②若立项，script 语言形态（JS 子集/Python/自研 DSL）与 askUser→HITL 卡映射；③Canvas 只读投影还是可编辑。
