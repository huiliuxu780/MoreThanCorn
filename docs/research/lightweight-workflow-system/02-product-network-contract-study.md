# 02 · 目标产品 Network 契约研究（已升级为 Observed-Network）

> 证据：`evidence/network/quickservice-capture-sanitized.json`（117 条，CDP 采集+内存脱敏，无凭证留盘）；
> DSL 全文：`evidence/network/flow-detail-decoded-dsl.json`（flow_detail 的 gzip+base64 解码结果）。
> 采集方式与阻塞史：`evidence/network/capture-attempt-log.md`。

## 1. 传输层事实（Observed-Network）

- API 域名同站：`config.quickservice.lydaas.com`；业务接口集中在 `POST /api/agent_store/<Service_method>`（mopen RPC 风格，全 POST+JSON），少量 `/v1/*`。
- 平台网关另有 `api.quickservice.lydaas.com/h5/mopen.*`（graphql/case/hotline/权限树等基建），**workflow 域不走 GraphQL**。
- 响应信封两种形态：
  - `{success, present, value, retry}`（flow_detail / lock 类）
  - `{success, result, total, errorCode, message, validateErrors, header{traceId, rpcId, date, tenantId, buId}}`（history / customNodes 类）
- **工作流定义以 base64(gzip(JSON)) 存于 `base64Data` 字段**，列表与详情都返回全量定义（列表也带全量 DSL！）。
- 编辑器进入即调 `requiredLock {code, dataType:'workflow', wsId}`，离开 `closeLock`；锁失败返回 `{isLockedSuccess:false, userName}`——**单写者悲观锁，无实时协同**（与 Sim realtime 协作形成对照）。

## 2. 端点清单（Observed-Network）

| 端点 | 请求体 | 响应要点 |
|---|---|---|
| `POST /api/agent_store/flow_list` | `{queryKeyword, orderByField, orderByType:'desc', language}` | `{total, value:[{workflowCode, description, source, gmtCreate/gmtModified, features{language, dynamicVersion, isHasChildWorkflowNode, isHasFrontInteractionNode}, childWorkflowEnable, base64Data}]}` |
| `POST /api/agent_store/flow_detail` | `{workflowCode, agentCode:null}` | `{success, present, value:{workflowCode, description, source:'manual', childWorkflowEnable, features, base64Data}}` |
| `POST /v1/workflow_history/page_query` | `{workflow_code, status:'', page, size}` | `{result:[], total}`（未发布=空，Observed） |
| `POST /api/agent_store/queryAgentCustomNodesApi` | `{start, size:999, customNodeId}` | 租户自定义节点注册表（本租户空） |
| `POST /api/agent_store/IpaasAppUIService_pageQueryCurrTenantPluginApp` | 分页 | 租户插件（工具）目录 |
| `POST /api/agent_store/AgentStoreAppUIService_queryCurrTenantCanUsePluginApp` | — | 可用插件过滤 |
| `POST /api/agent_store/IpaasApiUIService_queryCurrTenantPluginToolServiceLog` | — | 工具调用日志（对应 McpUseLog 页） |
| `POST /api/agent_store/flow_saveOrUpdate` | 同 flow_detail.value 形状（含 base64Data） | **创建+保存统一端点**；响应 `{workflowCode, workflowName, workflowDesc, workflowIcon, draftVersion:'V1.0.1'}`——**草稿有自增版本号** |
| `POST /api/agent_store/check_workflow_tryRunning_api` | `{workflowCode}` | `{value: true|false}`——**服务端试运行门禁**（false 时客户端 toast"请先配置节点"，不创建 Run） |
| `POST /api/agent_store/kbsListAllAvailableLlm` | — | **模型目录**（抽屉模型下拉数据源） |
| `POST /api/agent_store/agent_param_list` | — | 调试配置面板的 Start 参数清单 |
| `POST /quick/agent/workflow/sse/start` | `{tenantId, userId, query(JSON str), bizInvokeFrom:'ROBOT_TEST', workflowCode, dataList}` | **text/event-stream 运行流**（见 §5） |
| `POST /api/agent_store/requiredLock` / `closeLock` | `{code, dataType, wsId}` | `{value:{isLockedSuccess, userName}}`；**编辑器内 ~2s 心跳续锁**（实测 24–44 次/会话） |
| `POST /api/agent_store/PlatformSignRecordAbilityService_isSigned` | — | 协议签署校验 |
| `GET /base/user-tenants` | — | 租户列表 |

## 3. DSL 保存结构还原（Observed-Network，§7.4 交付）

解码后顶层：`{nodes, edges, checkList}`。

**nodes**：React Flow 原始序列化（**UI 态混存**：`dragging/selected/positionAbsolute/width/height`），每节点：

```jsonc
{
  "id": "<uuid>", "type": "custom",          // ReactFlow nodeType 恒为 custom（单一通用组件，与 Sim 一致！）
  "position": {"x":..,"y":..},
  "data": {
    "nodeId": "<uuid>", "nodeName": "大模型",
    "nodeType": "llm",                        // 业务类型：start|end|llm|plugin-tool|code|question-classifier|variable-handle|execution_workflow
    "nodeDetail": { ...按类型不同... },
    "runData": {}                             // 运行态槽位（草稿中为空；推断运行后回填供 Inspect）
  }
}
```

**nodeDetail 分型字段表**：

| nodeType | nodeDetail 关键字段 |
|---|---|
| start | input[], output[]（系统变量） |
| end | output[], **outputMode** |
| llm | **executionMode**('single'/批处理), input[], **llmConfig{modelCode, modelName, modelLogo, diversity, enableSearch, enableThinking, historyChat, isDelete}**, **llmOutputType**('Markdown'), **llmOutputExamples**, output[] |
| plugin-tool | **toolCode, toolName, appCode, appSource, apiPath, apiDocument, authAppVO(授权引用), componentCode, tenantId, relatedCommodityId**, icon, input[], output[]（+data.toolData） |
| code | **codeContent, codeType**, input[] |
| question-classifier | classifications[], otherClassification, input[], output[] |
| variable-handle | dealType, groups[], input[], output[] |
| execution_workflow | executeType, input[] |

**变量绑定结构**（input/output 数组项）：

```jsonc
{ "code": "userQuery", "type": "String", "required": false, "desc": "用户输入的原始问句", "isSystem": true,
  "referInfo": { "isRef": false, "dataType": "String",
                 "text": "#<nodeId>_$.userQuery",      // 引用语法：#节点Id_$.路径
                 "constantValue": "", "refInfoList": [], "textHtml": "", "simpleHtml": "" } }
```
`isRef=true` 走上游引用（refInfoList），`false` 用 constantValue 固定值——**与 07 的 InputBinding(fixed|upstream) 设计同构**（Observed-Network 确认）。

**edges**：React Flow 边：`{source, target, sourceHandle:'source', targetHandle:'target', type:'custom', id:'reactflow__edge-<source><sh>-<target><th>', updatable:true}`。条件分支未见样本（无已配置分支节点），Unverified。

**checkList**：校验结果**随 DSL 一起保存**：`[{nodeId, flowError:[{errorType:'nodeConnectIncomplete', tips:'节点未连接完整'}], customError:[]}]`（本次 6 条）。→ 检查红点数据源即此。

## 3b. Agent 层契约（第二轮补采，Observed-Network）

| 端点 | 请求要点 | 响应/语义 |
|---|---|---|
| `POST /api/agent_store/save_agent_config` | `{agentCode, agentName, agentType:'workflow', iconUrl, agentTags, config:{workflows:[{workflowCode}], customVariableMemory:[], knowledges:[], dialogueConfig:{quickAccess, enableChitchat, automaticAsk, advancedConfig}}}` | **Agent=配置壳+以 code 引用内嵌 workflow**；记忆变量=customVariableMemory |
| `POST /api/agent_store/flow_saveOrUpdate`（source=`agent-default`） | 同 subflow | Agent 内嵌流与资源级 subflow **同一保存端点**，仅 source 区分 |
| `POST /api/agent_store/AgentService_queryPageList` / `mopen.ly.ikb.agent.one.list` | — | Agent 列表 |
| `POST /api/agent_store/query_model_list` | — | Agent 编辑器模型列表 |
| `POST /api/agent_store/queryDialogueConfig` | `{}` | 对话配置 |
| `POST /api/agent_store/agent_param_list` | — | 调试面板 Start 参数 |
| `POST /api/observation/dashboard` | — | 运行观测 Tab 仪表盘 |
| `mopen.ly.ikb.agent.config.one.get` | — | Agent 详情（客服辅助类 agent 的 config JSON 字符串内嵌） |

创建交互：弹窗三型卡**单击即创建草稿**（自动命名）并跳 `QuickExperience`；版本号 `V1.0.1` 与灰度位出现在顶栏（发布/灰度体系存在，细节未取证）。

## 3c. 运行协议（三型深跑，第二轮 Observed-Network）

两种运行入口，两套 SSE 形态：

| 入口 | 端点 | SSE 形态 | 实测节点轨迹 |
|---|---|---|---|
| 工作流试运行（编辑器调试面板"开始运行"） | `POST /quick/agent/workflow/sse/start` {tenantId,userId,query,bizInvokeFrom:ROBOT_TEST,workflowCode,dataList} | **整包实例快照 ~2Hz**：status 数值码 + `agentNodeExecLogList[{nodeType,nodeId,nodeName,nodeInput,nodeOutput,status,executeTime,tokens}]` | 开始 success(8ms)→大模型 running→… |
| Agent 对话运行（列表体验框/体验页） | `POST /v1/chat` → `GET /v1/quick/agent/sse/start?sessionId=&msg=` | **增量消息流**：`title` 序列（"开始执行中/开始执行完成/大模型执行中/大模型执行完成/结束执行中/结束执行完成"）+ finalAnswer + traceId + nodeExecId | 对话编排型=开始→大模型→结束；专家组型=开始→结束（空流） |

- 会话辅助端点：`POST /v1/get_conversations`、`POST /v1/query_conversation_history`。
- 三型运行归属实测：对话编排（HOJdSwxN）✅ success；专家组（wFMGapml）✅ success；自主规划 ⚠️ 未自动化跑通（体验页 ai.lydaas.com 在新标签有独立登录墙；其运行协议与对话型同端点，Inferred）。
- 证据留存说明：SSE 正文曾在采集会话中实时解析（上表即解析结果）；因捕获文件按轮次覆盖，正文未全量落盘，`sse-runs-extract.json` 为可得的最后一轮提取。

## 4. 与我们设计（07）的对照与裁决

| 维度 | quickservice（Observed） | 我们（Designed） | 裁决 |
|---|---|---|---|
| UI/Runtime 分离 | 混存（React Flow 原始态入库存档） | ui/graph/io 分层 | **保留我们的分层**（可校验/可迁移）；记录其做法 |
| 变量引用 | `#<nodeId>_$.path`（Id 基） | `#{{name.outputs.path}}`（名字基+归一检查） | 保留我们的（可读性+重命名安全） |
| 校验 | checkList 随 DSL 持久化 | Validator API 实时算 | 保留 API 计算（单一事实源）；**借鉴 errorType 枚举**（nodeConnectIncomplete/nodeUnconfigured…） |
| 模型引用 | llmConfig.modelCode 内联快照 | modelRef{providerId,modelId} 结构化 | 保留我们的；借鉴 diversity/enableThinking/historyChat 参数集 |
| 工具绑定 | toolCode+authAppVO+apiPath 快照 | tool_version_id 引用 | 保留版本化引用；authAppVO≈connection_id 映射 |
| 代码节点 | codeContent 存 DSL | V1 无 Code 节点 | 维持（安全红线） |
| 编辑锁 | wsId 悲观锁 requiredLock/closeLock | baseRevision 乐观锁 | 记录其做法；V1 保留乐观锁（单人场景够用），锁冲突提示文案借鉴 |
| 传输 | gzip+base64 全文（列表也带全量 DSL） | 普通 JSON | 记录；V1 不压缩（规模小），**列表接口不返回定义全文**（只返回摘要，我们的偏离改进） |
| 信封 | 双信封+traceId | 统一 `{code,message,data}`+traceId | 统一信封 |

## 5. Run 事件协议（已 Observed-Network，v7 补采）

在 TEST 工作流（Start→LLM→End，配置模型+提示词+结束输出）上真实触发试运行：

- 入口链：`试运行`按钮 → 客户端先调 `check_workflow_tryRunning_api`（true 才继续）→ 打开**调试配置面板**（Start 参数表单：userQuery/chatHistory(带示例对话)/userId/conversationId/chatId/file，数据源 `agent_param_list`）→ `开始运行` → `POST /quick/agent/workflow/sse/start`。
- 传输：**POST 返回 text/event-stream**；推送模型=**周期性整包实例快照**（实测 ~2Hz、64+ 帧），**非**细粒度事件增量；客户端自行 diff 渲染。
- 快照 payload（Observed，字段节选）：
  ```jsonc
  { "id": 38477705, "workflowInstanceId": "a9d9...", "workflowCode": "...",
    "conversationId": "cid...", "chatId": "...", "status": 11,          // 数值状态码：11=running（完整码表未取证）
    "input": "<JSON string>", "output": null,
    "features": { "traceId": "...", "instanceName": "TEST-...", "dynamicVersion": "..." },
    "agentNodeExecLogList": [ { "id": "<instanceId>#<uuid>", "nodeType": "start|llm|...",
        "nodeId": "...", "nodeName": "开始", "nodeInput": "<JSON string>", "nodeOutput": "<JSON string>",
        "status": "success|running", "executeTime": 8, "tokens": null, "gmtCreateMs": ... } ],
    "childWorkflowInstanceList": null, "agentConversationMsgId": "mid...", "sseDomain": "ai.ly..." }
  ```
- 节点级日志内嵌于快照（nodeInput/nodeOutput/executeTime/tokens/status）——**NodeRun 即 agentNodeExecLogList 元素**；子工作流有 childWorkflowInstanceList 嵌套。
- 与 Sim 对照：Sim=细粒度 SSE 事件+eventId 重放；quickservice=整包快照轮推。我们 contracts/run-event.schema.json 维持细粒度+sequence（重放/审计更优），**同时借鉴整包快照里的 nodeExecLog 字段命名与 tokens/executeTime 计量**（04 记录裁决）。

## 6. 补采清单（剩余，可选）

1. 发布端点与二次确认请求（未触发，安全约定）；
2. 条件分支边的 DSL 样本（question-classifier 配置后导出）；
3. status 数值码表（11=running 之外）；
4. 正式 Run（非 ROBOT_TEST）的历史查询端点（workflow_history 已见，Run 级列表端点未见）。
