---
name: native-business-analysis
description: 对业务问题做只读指标分析的工作流（business_analysis_v1）：从问题识别指标口径与查询计划，按阶段工具白名单逐项查询核验（metric_query/dimension_query），经完成屏障汇总后输出带引用的确定性结论。当需要回答关于指标数值、时间窗口、维度拆分的只读业务问题时使用。
---

# 业务指标分析（business_analysis_v1）

来源：DSH 实现 `runtimes/deepseek_harness/plugins/native_business_analysis.mjs`
（bundle `morethancorn-dsh-business-analysis`，composition
`runtimes/deepseek_harness/config/native_business.cordis.yml`），与
`business-analysis@1.0.0` 模块 spec/Schema 及其他 runtime 的同名工作流语义一致。
本技能是这套分析逻辑的规范描述；任何 runtime 实现必须遵守。

## 适用范围与边界

- **输入**：`business_analysis_input`——`question_id`（必需）+ 可选 `window`；问题文本由平台请求上下文携带。
- **输出**：`business_analysis_output`（见"输出契约"，`additionalProperties=false`）。
- **只读**：只允许 `metric_query` / `dimension_query` 两个逻辑工具（经 Tool Gateway MCP，runtime 名 `mcp__quality__metric_query` / `mcp__quality__dimension_query`）。禁止任何写操作。
- **事实边界**：所有数值、单位、引用必须来自工具返回。工具返回 `known:false` 时必须如实报告"指标/维度不存在"，禁止用常识或推测补数。

## 工作流总览

```
identify → execute/<plan-id>（逐计划串行，一次一个） → 完成屏障 → synthesize
```

治理原则：**阶段推进、工具白名单、完成屏障由代码控制**；模型只负责单阶段内的
推理与工具调用。唯一的阶段迁移方式是成功调用提交工具
`business_analysis_submit`；当前阶段以最近一次提交结果为准，初始阶段为 identify。

## 阶段 1：identify（识别）

- 提取 `question_id`，并列出回答该问题**必须查询的每一个指标与维度**：
  - `kind: "metric"`——指标数值查询；
  - `kind: "dimension"`——维度拆分查询。
- **不得合并相互独立的指标/维度**：每个独立查询一条计划。
- 本阶段**不使用任何工具**。
- 提交：`{question_id, plans:[{kind, subject, query}]}`。

代码归一化（不经模型）：计划按序编号 `<kind>-<序号>`（如 `metric-1`、
`dimension-2`）；`kind=metric` 绑定 `metric_query`，`kind=dimension` 绑定
`dimension_query`；`plans` 至少 1 条，否则提交被拒绝。

## 阶段 2：execute/<plan-id>（逐计划查询，串行 + 阶段白名单）

计划**串行**执行（游标逐个推进，不并行）。每个执行阶段的白名单**只有该计划绑定的那一个工具**，
白名单外工具的调用会被守卫直接拒绝。

- 必须且只能调用绑定工具**一次**（代码统计本阶段工具调用，次数不为 1 或工具不符则提交被拒绝）。
- 不允许以"无需查询"为由跳过：进入执行阶段的计划，规定工具必须被真实调用。
- `metric` 计划的提交值 `value` **必须是数值**。
- 提交：`{value, unit, citations, reason}`；`citations` 记录数据来源引用（`{source, reference, summary?}`）。

### 工具语义（Tool Gateway 确定性实现）

两个工具由 `services/tool_service` 的同一确定性实现承载（HTTP/MCP 同构），
数据源为冻结 fixture 数据集（`metric_store`），返回信封
`{tool, version, fixture_dataset, output}`。

- `metric_query(metric, window?, start?, end?)`：返回 `known`、`unit`、
  `window{start,end}`、`points[{date,value}]`、`aggregate`（窗口内均值，保留 2 位小数）。
  未知指标 → `known:false`、`points` 为空。
- `dimension_query(metric, dimension, window?, start?, end?)`：返回
  `breakdown[{key,value}]`（按 key 排序）。未知指标或维度 → `known:false`、`breakdown` 为空。

**符号窗口规则**：时间范围优先传符号窗口 `window ∈ {last_7d, last_14d, last_30d, all}`
（缺省 `last_7d`），由工具服务相对数据集自身日期范围确定性求解起止日期；
显式 `start/end` 优先于符号窗口。**模型不得自行推算或编造日期**——具体区间
永远以工具返回的 `window` 为准。

## 阶段 3：完成屏障（代码校验）

最后一个计划提交成功前，代码校验所有计划均为 `completed`；
**屏障不满足时整个运行失败，不得提前产出最终结论**（禁止伪 succeeded）。
`synthesis_state` 随最后一个 execute 阶段的提交结果一并返回。

## 阶段 4：synthesize（汇总）

- **无工具终态**：守卫禁止一切企业工具，提交工具也拒绝再次调用。
- `synthesis_state` 由代码确定性汇总（不经模型改数）：
  - `question_id`：identify 阶段确认的问题标识；
  - `answer`：汇总结论（注明"基于 N 项只读查询交叉核验，全部计划已通过完成屏障"）；
  - `metrics`：所有 `kind=metric` 计划结果的 `{metric, value, unit}`；
  - `citations`：所有计划引用按序聚合；
  - `confidence`：0.9。
- 模型的职责仅是把 `synthesis_state` **如实**组织成最终 JSON 输出：
  不得修改数值、不得增删引用、不得把 `known:false` 改写成确定性结论。

## 输出契约

最终 Run.output 必须是**一个 JSON 对象**（允许剥离 `<think>` 包裹与 Markdown
围栏），并严格通过 `business_analysis_output` Schema 校验（`additionalProperties=false`）：

```
{
  question_id,
  answer,
  metrics:   [{metric, value(number), unit}],
  citations: [{source, reference, summary?}],
  confidence?: number
}
```

Schema 校验失败按 `OUTPUT_SCHEMA_ERROR`（可重试）处理。

## DSH bundle 组成与路由

- **路由**：平台请求 `context.metadata.workflowMode = business_analysis_v1` →
  adapter 选择 `native_business.cordis.yml` + `native_business_analysis.mjs`，
  并要求 DSH profile 已安装 bundle `morethancorn-dsh-business-analysis`
  （未安装 → `PROVIDER_UNAVAILABLE`，不降级执行）。
- **composition**：jsonrpc server + agent-core（关闭 workspaceContext /
  Bash / Jobs / skills，通用工具面全部裁掉）+ dsh-llm-deepseek + 会话持久化与
  checkpoint + Tool Gateway MCP 客户端（streamable-http，默认
  `http://127.0.0.1:8200/mcp/`，启动失败即失败，工具调用超时 30s）+ 原生插件。
- **环境要求**：`QUALITY_MODEL_API_KEY` 必需；`QUALITY_TOOL_MCP_URL` 指向
  Tool Gateway；`danger-full-access` 权限模式在 development/test 之外被禁止。
- **prompt 组装**（adapter）：AgentSpec instructions + 逻辑工具→runtime 工具
  映射 + 输出 Schema 原文 + Input + Context。

## 禁止事项

- 禁止编造工具结果中不存在的数值、单位、日期、引用。
- 禁止自行推算日期；时间范围一律走符号窗口（或输入显式给定的区间）。
- 禁止合并独立指标/维度为一条计划；禁止遗漏问题要求的查询项。
- 禁止对同一计划多次调用工具，或"保险起见"调用另一个工具。
- 禁止改动 `synthesis_state` 中的数值与引用。
- 禁止在完成屏障未通过时输出最终结论。
- 禁止任何写操作（本模块为 read-only）。
