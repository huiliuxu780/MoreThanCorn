# 17 · Round-5 调研：三型 Agent 编辑器（字段 / palette / 接口）

> 2026-08-23，CDP 实测（用户手动登录）。证据分级：Observed = 抓到 DOM/网络；Inferred = 同族推断；Unverified = 未抓到。
> 截图：evidence/screenshots/r5-*.png；网络：evidence/network/r5-*.json。

## 1. 三型编辑器对比（Observed）

| 维度 | 对话编排（Round-3/4） | 自主规划 AgentBuilder | 专家组 AgentGroup |
|---|---|---|---|
| 编排形态 | React Flow 画布，14 节点族 | **无画布**：表单 + 挂载列表 | React Flow 画布，7 节点族 |
| 顶栏 | 保存/发布/试运行/自动保存于 | 保存/**更新发布**▾（已发布态） | 保存/发布▾/待发布 |
| 页签 | Agent搭建/运行观测/效果评测/进化(/汇流) | 同左 | 同左 + **汇流** |
| 试运行 | 画布底栏 | **预览调试**面板：多模型对比（添加对比模型 1/2） | 画布底栏 |
| 模型选择 | llm 节点内 | 抽屉顶部全局（qwen3.7-max） | 无全局（成员 Agent 各自带） |

## 2. 自主规划（AgentBuilder）字段矩阵（Observed）

抽屉「Agent配置信息」：
- 全局模型 select；基本信息（名称 9/20）；
- **角色能力描述** textarea（「指导Agent在什么场景提供服务」；按钮：AI生成 ×2、选择模板；模板骨架 `# 角色：/## 目标：/## 技能：`，技能段内嵌「技能名 code：使用时机+数据源+注意」条目）；
- 挂载区（chips：技能/知识/工具/对话体验/记忆/语义）：**技能 / 插件 / 工作流 / 知识 / 记忆变量** 五类挂载，条目卡 = 首字头像 + 名称 + 描述 + 状态徽标（**已失效** = 挂载目标下线时的生命周期态）；
- 预览调试：对话输入 + 「添加对比模型 (1/2)」多模型并排回答。

锁提示模态：「当前页面正在被"汇流"编辑」+ 知道了（非阻塞 JS 线程的 UI 模态）。

## 3. 专家组（AgentGroup）字段矩阵（Observed）

抽屉「Agent配置信息」：
- 基本信息(0/20)；对话体验：**自动续问**(automaticAsk.enable)、**闲聊兜底**(enableChitchat)、高级设置(advancedConfig.fileUpload)；
- Agent 知识兜底：知识文件 / 专业词库 / 问答经验库（三库）；
- Agent 记忆：记忆变量（提示「在工作流中配置记忆变量节点读写」→ customVariableMemory）；
- Agent：添加多个 Agent，画布编排。

save_agent_config 契约（Observed，见 r5-group-save-contracts.json）：
`{agentCode, agentName, description, iconUrl, agentType:"expert-group", agentTags(Type), experienceAgentTags(Type), config:{workflows:[{workflowCode}], customVariableMemory:[], knowledges:[], dialogueConfig:{quickAccess{enable,accesses[]}, enableChitchat, automaticAsk{enable}, advancedConfig{fileUpload}, segmentConfig{enable,frequency}, reasoning{enable}, onboarding{welcomeTitle, welcomeSubTitle, presetQuesions, displayMode, openingAction, imageUrl{gifUrl,avatar}}}}}`

## 4. 节点 palette 三型对比（Observed —— 用户提醒实锤）

| 对话编排（14） | 专家组（7） | 自主规划（0，挂载代替） |
|---|---|---|
| 开始/结束/大模型/插件工具/条件/代码/问题分类/变量处理/客服工具/知识检索/数据查询/Query改写/图像生成/工作流执行/记忆变量… | 信息处理：Agent / Agent选择 / Agent执行 / 决策分类 / Query改写 / 条件判断；代码编辑：代码编写 | 技能/插件/工作流/知识/记忆变量 挂载 |

共有族：Query改写/条件判断/代码；专家组独有：Agent/Agent选择/Agent执行/决策分类。

## 5. 接口契约（Observed）

| 端点 | 用途 | 备注 |
|---|---|---|
| POST /api/agent_store/requiredLock / closeLock | 编辑锁 | 负载 {code, dataType:"agent", wsId} |
| POST /api/agent_store/flow_saveOrUpdate | 画布保存 | **base64(gzip(JSON{nodes,edges,checkList}))**；节点 nodeDetail{nodeName,nodeType,nodeId,runData} |
| POST /api/agent_store/flow_detail | 画布读取 | {code: processId} |
| POST /api/agent_store/save_agent_config | 抽屉配置保存 | 见 §3 |
| POST /api/observation/dashboard | 运行观测 | {agentId, startTime…}；UI=当前版本/灰度/消耗量/观测配置/观测回放/智能洞察 |
| POST /v1/chat → GET /v1/quick/agent/sse/start | 三型运行 SSE | **三型共用，Observed**：自主规划预览调试 POST /v1/chat {query, agentInstanceId, bizInvokeFrom:"ROBOT_TEST", deep_plan, features, dataList} → SSE 流（Round-2 已抓 title 序列） |

校验：checkList[].flowError[].errorType=nodeConnectIncomplete 等，与画布「检查」红徽标同源。

## 6. 专家组三节点抽屉（Round-5b，CUA Observed，2026-08-24）

CDP 注入被主线程阻塞挡死，改用 Computer Use（系统级截图+AX+按键）成功抓取并复原画布。

| 节点 | 抽屉字段（Observed） | 语义 |
|---|---|---|
| Agent | 节点名（=成员 Agent 名）；输入=开始变量映射表 userQuery/chathistory/userid/conversationid/chatid/file{fileType,fileUrl,fileName}/reference，每行「请输入或引用变量」+⚙；输出 content String | 成员 Agent 执行节点；添加时弹「添加Agent」候选列表（带类型徽标 自主规划/对话编排） |
| Agent选择 | 描述「根据用户问题和Agent描述信息，输出一个适合本次执行的Agent」；输入 query Str.（+添加）；**主要Agent配置**（+添加Agent）；**兜底Agent配置**（+添加Agent，「若未命中任何主要Agent则使用当前唯一的兜底Agent」）；输出 agentCode/agentName/agentDesc String | 路由分发节点 |
| Agent执行 | 描述「根据agentCode执行对应的Agent」；输入 agentCode Str.（+添加）；输出=自定义变量表（No data + 添加） | 执行选中 Agent |

典型编排链路：开始 → Agent选择(query) →（agentCode）Agent执行 → 结束；或直接 开始 → Agent → 结束。

## 7. 缺口（Unverified / Inferred）

- 自主规划预览 SSE 事件名序列（Inferred 同 Round-2 title 流）。
- 自动化注意：quickservice 页面主线程间歇长阻塞，CDP eval/截图均会间歇超时；**Computer Use（AX+系统截图+按键）不受影响，是该产品唯一可靠自动化通道**。节点删除=选中+Backspace。

## 7. 对我们实现的含义

1. 自主规划 ≠ 画布：实现为「角色 prompt + 五类挂载 + 全局模型」，运行期把挂载编译进执行循环（技能→prompt 段；插件→tool executor；工作流→子 workflow-exec；知识→knowledge-retrieval；记忆→变量读写）。
2. 专家组 = 成员 Agent + 路由画布：Agent/Agent选择/Agent执行/决策分类 四节点语义 = fan-out + 条件 + 汇总。
3. 运行协议借鉴 chat SSE 的 title 进度流（开始/大模型/结束执行中…），与我们 run_event 细粒度流并存（前端节点态文案用 title 流，04 号文档已定）。
4. 挂载生命周期：目标资源停用/删除时挂载显示「已失效」（对应我们删除防护的软态）。
5. 编辑锁：requiredLock/closeLock 模式值得我们多端编辑场景借鉴（本期不做）。
