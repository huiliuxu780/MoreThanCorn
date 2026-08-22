# 07 · Workflow DSL 设计（Designed）

> 约束来源：Master §7.5/§8.3/§8.7/§8.8（冻结）、任务书 §10.4、quickservice UI 字段（Observed-UI）、Sim DSL（Observed-Source，差异已回填于 §6 与 04）。
> Sim 对照（03/Part A）：Sim 三态=Zustand 编辑态/SerializedWorkflow 运行态/草稿三表+版本 JSON 快照；我们收编为 ui/graph/io 分层+draft_definition+version 快照，运行时由 Runner 内部坍缩，不另存序列化中间态。
> 正式 schema：`contracts/workflow-definition.schema.json`。

## 1. 设计原则

1. **可版本化**：WorkflowVersion 冻结整份 definition + 引用的 Tool Version IDs；Published 不可变。
2. **可校验**：所有引用（node type、tool、model、connection、变量路径）可静态检查 → 支撑"检查(9)"式清单。
3. **UI/Runtime 分离**：`ui` 字段（positions/viewport/zoom）与 `graph` 分离，保存时同包存储、校验时忽略 ui。
4. **不含任意代码**：Transform 用声明式表达式白名单（jsonpath/模板/有限函数），Code 节点 V1 **Omit**（quickservice 有代码节点，但我们安全边界优先；Future）。
5. **凭证外置**：Connection 仅存 `connectionId`；Secret 在 Secret Store。
6. **Node Type 通用化，Node Instance 业务化**（Master §8.3）。

## 2. 顶层结构

```jsonc
{
  "schemaVersion": "1.0",
  "workflow": {
    "id": "wf_01J...", "name": "", "description": "",
    "status": "draft|testing|published|deprecated",   // 生命周期 Master §7.4
    "currentVersionId": null, "draftRevision": 12
  },
  "graph": {
    "nodes": [ WorkflowNode ], "edges": [ WorkflowEdge ]
  },
  "io": {
    "inputSchema":  { JSON Schema },        // Start 输入契约
    "structuredOutputs": [                   // 1..N，Master §8.8
      { "key": "quality_result", "schema": { JSON Schema } }
    ]
  },
  "triggers": { "manual": true, "api": true, "scheduleIds": [ "sch_..." ] },
  "ui": { "positions": { "nodeId": {"x":0,"y":0} }, "viewport": {"x":0,"y":0,"zoom":1} },
  "meta": { "updatedAt": "", "updatedBy": "", "versionNote": "" }
}
```

## 3. WorkflowNode

```jsonc
{
  "id": "n_llm_01",
  "type": "llm",                 // V1: input|llm|tool|condition|transform|end|create-record|notification|human-interrupt(Future)
  "name": "判断是否违规承诺",      // 实例业务名
  "config": {                    // 由 Node Definition.schema 决定（schema 驱动 Inspector）
    "modelRef": { "providerId": "mp_01", "modelId": "qwen-plus", "params": {"temperature":0.2} },
    "prompt": "…#{{n_input.outputs.call_transcript}}…",
    "outputKey": "quality_result"          // 绑定到 structuredOutputs[].key
  },
  "inputs": [ InputBinding ],
  "execution": { "timeoutMs": 60000, "retries": 1, "onError": "fail|skip" },  // V1 有限
  "branches": ["yes","no"]       // condition/router 用，对应 edge.sourceHandle
}
```

InputBinding：

```jsonc
{ "name": "call_transcript",
  "type": "string",
  "source": { "kind": "upstream", "nodeId": "n_input", "path": "outputs.transcript" }
  // kind: fixed | upstream | input | state | system
}
```

变量来源五种（Master §8.7：Input/Upstream/State/System + Fixed）。直接上游可引用，不强制写 State。

## 4. WorkflowEdge

```jsonc
{ "id": "e_01", "source": "n_cond_01", "sourceHandle": "yes", "target": "n_tool_01" }
```
条件路由=sourceHandle 与 node.branches 对应；无 handle 的普通边=唯一后继。

## 5. 校验规则（→ Validator，支撑检查清单）

| 规则 | 问题 kind |
|---|---|
| 恰一个 input 节点、≥1 个 end/create-record 终端 | graph |
| 无孤儿节点、无环（V1 DAG） | unconnected |
| 每个非 input 节点的必填 inputs 已绑定且类型兼容 | unconfigured |
| llm.prompt 中 `#{{}}` 引用路径可达且类型匹配 | unconfigured |
| tool.config.toolVersionId 存在且 Ready | dependency |
| structuredOutputs 每个 key 恰被一个节点产出 | unconfigured |
| condition.branches 与出边 handle 一一对应 | graph |

## 6. 与 quickservice / Sim 的差异（已回填：02 Observed-Network + 03 Observed-Source）

quickservice 实测 DSL（Observed-Network，`flow-detail-decoded-dsl.json`）：顶层 `{nodes, edges, checkList}`；nodes=React Flow 原始序列化（type 恒 'custom'，UI 态 dragging/selected/positionAbsolute 混存）+ `data.nodeDetail` 分型配置；nodeType 枚举实测=**start/end/llm/plugin-tool/code/question-classifier/variable-handle/execution_workflow**；变量绑定 `referInfo{isRef, text:"#<nodeId>_$.path", constantValue, refInfoList}`（引用/固定二态，与我们 InputBinding 同构）；模型内联 `llmConfig{modelCode, diversity, enableThinking, enableSearch, historyChat}`；工具快照 `toolCode/authAppVO/apiPath/apiDocument`；校验 `checkList[{nodeId, flowError[{errorType:'nodeConnectIncomplete'}], customError}]` 随 DSL 持久化；传输 base64(gzip(JSON))。

裁决：我们保留 ui/graph/io 分层（偏离其混存）、名字基引用（偏离其 nodeId 基）、普通 JSON（偏离其压缩）、服务端实时校验（偏离其持久化，但借鉴 errorType 枚举）、Tool Version 引用（偏离其 toolCode 快照）、V1 无 code 节点（安全红线，其 codeContent 入 DSL 不采用）。
- Sim 的 blocks/edges 结构差异见 04 对照表；若 Sim 用 handles 表达分支，我们沿用 sourceHandle 语义（与 xyflow 一致）。

## 6b. 变量机制（两产品互证 + 用户指定的设计方向，Designed 采纳）

1. **入口公共参数**：Start.inputs（userQuery/chatHistory/userId/conversationId/chatId/file，Agent 层另加 `reference`）= 全节点共享只读公共变量；所有节点默认可引。
2. **累积继承**：任意节点可引用**任一拓扑前序节点**的输出（`#<nodeId>_$.path` / Picker 按节点分组列全前序），不限于直接上游。Resolver 校验=可达性（DAG 前序）+类型兼容。
3. **记忆变量（State）**：Agent 层 `customVariableMemory` 声明 + `记忆变量` 节点读写 = 跨节点/跨会话长期状态（Master §8.7 State 语义的产品实证）。我们 DSL 增加 `state` 声明区与 `state` 节点族（V1 可先做 run 内 state，跨会话 Future）。
4. Picker UI：分组=公共参数 / 前序节点（按拓扑序）/ 记忆变量 / 系统；类型过滤；支持搜索（节点多时）。

## 7. 版本化与迁移

- `schemaVersion` 顶层字段；迁移器按版本链升级。
- Published Version = definition 深拷贝 + toolVersionIds + modelRefs 快照 + prompt 全文（Master §7.5；Secret 除外）。
- Run 记录 `workflowVersionId`，历史 Run 永远可解释（Master §6.1 原则）。
