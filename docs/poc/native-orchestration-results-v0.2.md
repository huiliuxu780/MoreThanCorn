# Provider 原生编排 POC v0.2

日期：2026-08-28
分支：`codex/poc-agent-runtime-providers`
模型：`qwen3.8-max`（OpenAI-compatible endpoint）

> 2026-08-28 更新：本文对 PyPI `0.1.1rc1` wheel 的阻塞结论仍成立；官方
> `dsh-v0.1.2-alpha.1` 源码构建版已通过外部插件黑盒测试和本 POC 业务插件
> 初始化。后续结论见 `docs/poc/dsh-source-runtime-results-v0.3.md`。

## 结论先行

这轮不是把一套外置 LangGraph 状态机套在两个 Runtime 外面。共享部分只有输入、输出 Schema、合成 Tool Service 和验收数据；阶段推进与约束分别落在 provider 自己的实现中。

- **AgentScope 2.0.7：能实现，但不是一个现成 Graph DSL。** 本 POC 用 AgentScope `Agent`、`Task`/`AgentState`、MCP `enable_tools`、原生 structured output，加上 provider 内部 Python 编排完成识别、计划、并发执行、屏障和总结。一次完整运行的业务结论全部正确；稳定性仍未过关。
- **DeepSeek Harness 0.1.1rc1 Python wheel：当前不能完成同等级原生 POC。** DSH 源码的 Cordis/agent-loop 扩展面足够表达阶段状态与 agent 作用域工具限制；但 Python wheel 自带的单文件 Runtime 在加载本地绝对路径 ESM 插件后，SDK 初始化稳定报 `cannot create effect on inactive context`。不加载本地插件的原有 Cordis 配置可正常初始化。
- 因此不能把 DSH 的 Python SDK 外面再写一套公共 Python 状态机，然后宣称“两个底座都原生支持”。那只能证明 DSH 可当 LLM 执行器，不能证明当前交付形态能承载本业务的原生行为控制。

## 共享复杂场景

合成通话 `NATIVE-V02-001` 同时包含：

- 多个消费者事项：断网报修、历史未跟进投诉、费用政策咨询，并补充上门时间与短信诉求；
- 两条知识陈述：X2 路由器保修期上门费、宽带故障联系时限；
- 三项可核验承诺：创建工单、发送短信、预约次日下午两点；
- 三种承诺事实：工单已创建、短信未发送、预约存在但时间不一致；
- 一条需要“宽查 → 根据提示补地区/型号/保修状态 → 精查”的知识路径。

对应资产：

- `poc/agent_runtime_providers/datasets/native_workflow/complex_call_v0.2.json`
- `poc/agent_runtime_providers/datasets/native_workflow/tool_fixtures_v0.2.json`
- `poc/agent_runtime_providers/datasets/native_workflow/ground_truth_v0.2.json`
- `poc/agent_runtime_providers/schemas/native_workflow_output.schema.json`

## AgentScope 实现边界

阶段由 `runtimes/agentscope/app/native_workflow.py` 中的 provider 代码推进：

1. `identify`：无工具，结构化提取消费者诉求、知识陈述、承诺；
2. `plan`：代码为每条知识陈述和每项承诺创建独立 AgentScope `Task`；
3. `execute`：最多两个任务并发；知识任务只挂 `knowledge_search`，每个承诺任务只挂对应事实工具；
4. `barrier`：所有 Task 必须为 `completed`，否则禁止总结；
5. `synthesize`：无工具，只生成总结文本；其余标准字段由代码从已验证阶段结果组装。

这证明的是“AgentScope 组件 + 应用代码编排”可实现，不应描述成 AgentScope 2.0.7 自带 LangGraph 式 Pipeline；本地安装版本没有旧教程中的 `agentscope.pipeline` 模块。

## AgentScope 真实运行记录

完整成功的一次结果：

| 项目 | 结果 |
|---|---|
| 消费者诉求 | 识别 5 项，满足“多个” |
| 知识陈述 | 2 项；上门费 `accurate`，24 小时联系 `inaccurate` |
| 承诺 | 工单 `fulfilled`；短信 `unfulfilled`；预约 `mismatched` |
| 执行计划 | 5/5 completed |
| 完成屏障 | passed |
| 实际企业工具调用 | 5 次 |
| 模型调用 | 12 次 |
| Token | input 15,075；output 5,455；total 20,530 |
| 分支重试 | 0 |

成功运行中，费用知识第一轮直接携带了完整上下文并命中精确文章，只发生 1 次检索。因此随后增加了代码验收：第一条费用知识至少要有 2 个 `ToolCallStartEvent`，且第一轮禁止地区和型号，第二轮再精查。

强制两轮后的两次运行均未形成终态结果：

1. 一次在模型流中出现 `incomplete chunked read`，屏障未放行；
2. 启用 AgentScope `ModelConfig(max_retries=1)` 后，一次在 `identify` 阶段没有提交 structured output，屏障未进入执行阶段。

另外，开发过程中代码正确拦截并修复了两类适配错误：承诺类型未使用枚举、MCP client 名包含 `/`。这些不是产品效果分，但说明阶段内部 Schema 和命名边界必须由代码明确约束。

综合评价：**业务正确性可达，代码工具隔离有效，失败时能 fail closed；当前模型/structured-output 稳定性和端到端时延不满足生产要求。**

## DeepSeek Harness 实现与阻塞

POC 已实现一个 import-free Cordis 插件草案：

- 动态 system prompt 暴露当前阶段；
- 本地 `quality_workflow_submit` 工具作为唯一阶段转换入口；
- `agent.ctx.tools.restrict({allow: [...]})` 按阶段切换工具集合；
- 记录企业工具结果，校验知识检索轮数和承诺工具；
- 所有计划完成后才进入 `synthesize`。

文件：

- `runtimes/deepseek_harness/plugins/native_quality_workflow.mjs`
- `runtimes/deepseek_harness/config/native_quality.cordis.yml`

但是该组合无法通过 Python SDK wheel 的初始化。对照结果：

- 原有 `quality.cordis.yml` + MCP：初始化成功；
- 精简安全配置、不加载本地插件：初始化成功；
- 相同配置 + 本地绝对路径 import-free ESM 插件：失败；
- 插件缩减为空实现后复现同一错误。

错误：

```text
deepseek_harness.errors.JsonRpcError: cannot create effect on inactive context
```

这与官方源码文档描述的“从仓库源码运行时加载绝对路径 TypeScript 插件”不是同一个交付路径。当前验证只支持以下结论：

- DSH 架构层面提供 Cordis 插件、动态 prompt、agent 作用域工具 restriction 和可替换 agent-loop；
- DSH 0.1.1rc1 Python wheel 的打包 Runtime 在本机不能加载本 POC 所需的本地插件；
- 若要继续，应选择“从官方源码构建自定义 Runtime”或验证更新版 wheel，而不是退化成提示词约束。

官方设计依据：

- [Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [Core subsystems](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md)
- [Plugin tutorial](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md)
- [Python SDK](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/python-sdk.md)

## 当前建议

1. 继续把 AgentScope 作为下一轮候选，但先做 10～20 次同一复杂样本稳定性跑批，统计终态成功率、P95 时延、每阶段重试和 Token；当前单次成功不足以选型。
2. 保留 DSH Cordis 插件草案作为可复现资产。只有在能从源码构建/运行自定义 Runtime，或新版 wheel 修复本地插件加载后，再做同口径真实模型对比。
3. 不采用“共享外置 Graph + 两个 Runtime 只负责单次 LLM 调用”的结果作为 provider 原生能力证明；如果生产平台最终选择共享 Graph，应把它明确归类为平台编排层选型。
