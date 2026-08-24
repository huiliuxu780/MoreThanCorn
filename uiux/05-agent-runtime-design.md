# 05 · Agent 运行层设计（三型闭环）

> 依据：17-round5-agent-editors-study.md（Round-5 实测）+ 01–04 文档 + 现有 kernel。
> 目标：自主规划 / 专家组 从「配置能存」升级为「可运行、可观测、可评测」，与对话编排一起三型闭环。
> 状态：待用户批准后实施。

## 1. 需求与验收

| 用例 | 验收 |
|---|---|
| 自主规划：角色 prompt + 五类挂载（技能/插件/工作流/知识/记忆变量）+ 全局模型，点「预览调试」发问 | 后端真实执行（LLM + 挂载消费），SSE 流式返回，前端渲染计划/工具调用/终答 |
| 挂载消费语义 | 技能→并入 system prompt；插件→tool executor（function-call 循环）；工作流→子 workflow 执行；知识→knowledge-retrieval；记忆变量→run 级变量读写 |
| 循环护栏 | 最大步数（默认 8）、最大时长（默认 60s）、递归深度复用 workflow-exec 链防护 |
| 专家组：成员 Agent + 路由（决策分类/条件）画布 | 试运行按 routing 分发到成员（成员=dialogue→其 workflow；autonomous→其执行循环），并发执行，汇总节点出终答 |
| 运行观测 | 三型运行落 Run 表（trigger=agent），运行观测页接 /api/observation 等价端点 |
| 发布同步 | Workflow 发布后 Agent 卡状态同步「已发布」；挂载资源停用/删除时挂载显示「已失效」 |
| 评测闭环 | 评测样本可对 autonomous/expert-group 直接跑（不依赖 workflow） |

## 2. 执行模型（后端）

### 2.1 autonomous 执行循环（`agent_runtime.py`）

```
run_agent(agent, input, stream):
  ctx = {variables: memories 初值, steps: 0}
  system = rolePrompt + 技能段(挂载 skills 的 name+desc) + 约束段
  tools  = 挂载插件 → OpenAI tools schema（复用 tool executor 的 spec）
  loop:
    resp = llm_chat(model, system, history, tools)          # 真 LLM（OpenAI 兼容）
    if resp.tool_calls: 对每个 call 分发执行（tool/workflow/knowledge/memory_readwrite）
                        结果回填 history；emit event(tool_call)；steps++ 护栏
    else: emit event(final)；break
```

- 事件流：复用 run_event（type: agent_started / plan / tool_call / tool_result / workflow_exec / knowledge_hit / memory_write / llm_delta / agent_completed / agent_failed），SSE 端点复用 /api/runs/{id}/events；前端 title 文案映射（开始执行中/工具调用中/…）对齐产品 chat 流。
- Run 表加 `agent_id` 列（nullable，migration），trigger="agent"。

### 2.2 expert-group 执行

- 画布即其 workflow（processId）；成员 Agent 节点（Agent/Agent选择/Agent执行）= 新 executor `agent_exec`：按 nodeDetail.agentCode 递归 `run_agent`（dialogue 成员=跑其 workflow，autonomous 成员=2.1 循环），深度复用 call_chain 防护。
- 决策分类/条件节点 = 现有 condition executor 的别名映射；Query改写/代码编写 复用现有 transform/condition 族。
- 汇总：结束节点 inputs 绑定各成员输出 → output。

### 2.3 API

| 端点 | 说明 |
|---|---|
| POST /api/agents/{id}/run {input, trigger=test|eval} | 建 Run(agent_id, trigger) → 入队 → 返回 {runId} |
| GET /api/runs/{id}/events | 复用 SSE |
| GET /api/agents/{id}/runs | 运行观测列表 |
| GET /api/agents/{id}/mounts-health | 挂载失效检测（资源存在且 enabled，否则「已失效」） |

### 2.4 发布同步

- workflows publish 时回写 agent.status=published（agent.workflow_id 反查）；
- 资源 toggle/disable 时不主动改挂载，mounts-health 运行时计算（软态，符合产品「已失效」徽标语义）。

## 3. 前端

- 自主规划编辑器（现 AutonomousEditor）：预览调试接真 SSE（替换 mock 文案）；挂载卡加「已失效」徽标（mounts-health）；模型 select 接 registry models（enabledOnly）。
- 专家组编辑器：试运行按钮接 /api/agents/{id}/run + 事件流面板；成员节点抽屉 = Agent select（候选=其他 agents）。
- 运行观测页签：接 /api/agents/{id}/runs + run-detail 复用。
- Agents 列表：发布态同步展示。

## 4. 分期

- A1：Run.agent_id migration + run_agent 循环（autonomous）+ /api/agents/{id}/run + SSE + 预览调试接通 + 护栏测试。
- A2：agent_exec/决策分类 executor + 专家组试运行 + 汇总 + mounts-health + 已失效徽标。
- A3：发布同步 + 运行观测页 + 评测对三型开放 + 全量回归（pytest + verify-fullstack 增补 S13 Agent 用例）。

## 5. 缺口映射（Inferred 项的处理）

- 自主规划 SSE 事件字典未抓到 → 用我们 run_event 细粒度流 + title 文案映射（04 已定），不 1:1 其产品事件名。
- 专家组三节点抽屉已实测（17 §6，CUA Observed）：Agent=成员执行（输入变量映射表+输出 content）；Agent选择=路由（query 入，主要Agent配置+兜底Agent配置，输出 agentCode/agentName/agentDesc）；Agent执行=按 agentCode 执行（输出自定义变量表）。前端抽屉 1:1 对齐该字段结构。
