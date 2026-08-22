# 04 · 三证据链交叉对照与我们的决定

> 链：UI=quickservice 实操（01，Observed-UI）；Network=02（本轮工具阻塞，Inferred/Unverified）；Sim=03（Observed-Source）。
> 冲突处理：UI 与 Sim 差异不静默裁决，逐条给"我们的决定+理由"。Network 缺失不构成冲突，契约以 Designed 补齐。

| 能力 | 目标产品 UI | Network | Sim 机制 | 我们的决定 | V1 |
|---|---|---|---|---|---|
| Workflow 列表 | 卡片网格+搜索/筛选/排序+黑主按钮 | **Observed**：POST flow_list {queryKeyword, orderByField/Type}；**列表响应携带全量 DSL(base64Data)** | 列表+文件夹+模板（重） | 表格/卡片切换；**列表只返回摘要不返回定义全文**（对其做法的改进偏离） | ✅ |
| 编辑器壳 | 顶栏(自动保存/检查/历史/保存/发布)+底部工具条+minimap | — | 左工具栏+右面板+协作 | 取 quickservice 壳（更聚焦）+ 冻结基线 Designer 壳层 | ✅ |
| 节点添加 | popover 两组无搜索 | — | 工具栏拖拽+搜索+分类 | 面板+搜索+拖拽（xyflow 原生 onDrop），分类=家族 | ✅ |
| 节点卡 | 配置摘要+类型 chip+未配置灰字 | — | 通用卡+状态环 | **两者合并**：sim 中性卡+摘要行+runStatus 环（flow-node.tsx 已具备，补摘要） | ✅ |
| 节点配置 | 右抽屉分区折叠 | — | 右面板 SubBlock 大 switch | schema 驱动 Inspector（基线 §8.6），控件集裁剪 | ✅ |
| 变量引用 | ⚙级联+"#"内联 | — | `<block.field>`+resolver | `#{{name.outputs.x}}`+Picker 四来源；名字归一纯函数复用 | ✅ |
| DSL | 不可见（UI 层） | **Observed**：{nodes,edges,checkList}；RF 原始态+nodeDetail 分型；引用 `#<nodeId>_$.path`；gzip+base64 传输 | 三态+serializer | 07：ui/graph/io 分层（**偏离其混存**）；引用改名字基；普通 JSON（不压缩） | ✅ |
| Validator/检查清单 | 红点=问题数+清单 popover | **Observed**：checkList 随 DSL 持久化，errorType=nodeConnectIncomplete 等 | 序列化时 collectBlockFieldIssues+边校验纯函数 | 独立 ValidationReport API（实时算，偏离其持久化）；**借鉴 errorType 枚举** | ✅ |
| Draft/自动保存 | 时间戳+手动保存 | **Observed**：进入编辑器 requiredLock(wsId 悲观锁)/离开 closeLock；本次未触发保存请求（补采） | realtime op+PUT state 兜底+版本向量 | debounce PUT draft+baseRevision 乐观锁；**记录其悲观锁做法**（V1 不采用） | ✅ |
| Publish/Version | 软警告三选项；历史抽屉空态 | **Observed**：workflow_history/page_query {workflow_code,status,page,size}（未发布=空）；发布端点本次未触发 | deploy=JSON 快照+isActive 切换+restore | Dependency Check+二次确认+Version Note（基线 §7.6）；版本不可变 | ✅ |
| 触发绑定版本 | 未观察到 | — | schedule/webhook 绑 deploymentVersionId | 采用（schedule.version_id / task.version_policy） | ✅ |
| Test Run | 调试配置面板（Start 参数表单）+开始运行 | **Observed**：check_workflow_tryRunning_api 门禁→调试面板(agent_param_list)→`POST /quick/agent/workflow/sse/start` | builder 手跑=草稿态 SSE | 校验门禁+draft 执行+SSE；**借鉴调试配置面板形态**；单节点运行 V1 必须有反馈（补其缺口） | ✅ |
| Run/NodeRun/事件 | 画布节点运行环（未及终态截图） | **Observed**：SSE 整包快照 ~2Hz；agentNodeExecLogList 内嵌 nodeInput/nodeOutput/status/executeTime/tokens；status 数值码(11=running) | 细粒度 SSE 事件+eventId 重放；Run=单行 logs | **我们=细粒度事件+sequence**（重放/审计优），借鉴 nodeExecLog 字段与 tokens/executeTime 计量；Run/NodeRun 独立表（偏离其内嵌 jsonb） | ✅ |
| Model 目录 | 抽屉模型下拉 | **Observed**：kbsListAllAvailableLlm | 目录+执行两层 | 配置表+modelRef；下拉数据源模式同 | ✅ |
| Runner | 不可见 | Unverified | DAG 就绪队列+边激活+汇聚 | Python 重写（09）；V1 顺序+分支，汇聚语义保留 | ✅ |
| 条件路由 | 分类节点多出口 | — | 输出语义+sourceHandle | sourceHandle=branch（07），与 xyflow 一致 | ✅ |
| error 边/容错 | 未观察到 | — | error handle 路由 | V1 onError=fail/skip；error 边 Future | ⛔V1 |
| Schedule | **无入口** | — | 外部 cron+workflow_schedule+自动 disable | Task 内 Schedule 区块（基线）；进程内 tick+可选外部端点；企业时区 | ✅ |
| Trigger 类型 | 对话/API/子工作流 | — | manual/api/webhook/schedule+74 集成 | V1 manual+api+schedule；webhook Future | ✅ |
| Queue/Worker | 不可见 | Unverified | async_jobs+inline worker | PG 表队列+同进程 asyncio worker；可拆进程 | ✅ |
| Run/NodeRun | 无 Run 历史入口（缺口） | — | 单行 logs+jsonb 折叠 | **独立 run/node_run 表**（查询/证据需要），偏离 Sim 单行模型 | ✅ |
| Logs 实时 | 工具调用日志页（轮询感） | — | SSE+eventId 重放；列表 10s/3s 轮询 | SSE 主+轮询兜底；Run Detail 节点时间线 | ✅ |
| 日志→画布定位 | 未观察到 | — | traceSpans 渲染 | node_failed 带 nodeId→Designer 高亮（补双方缺口） | ✅ |
| Tool | 建节点时绑插件；调用日志页 | **Observed**：插件目录=IpaasAppUIService_pageQueryCurrTenantPluginApp；调用日志=IpaasApiUIService_queryCurrTenantPluginToolServiceLog；DSL 内 toolCode+authAppVO+apiPath 快照 | Block≠Tool；ToolConfig 配方；custom/MCP | 通用 Tool 节点+**tool_version 引用**（偏离其 toolCode 快照）；http/builtin；调用日志 | ✅ |
| Model | 平台预置下拉+能力标签 | **Observed**：llmConfig{modelCode, diversity, enableThinking, enableSearch, historyChat} 内联 | 目录+执行两层；内联 id | 配置表+modelRef 结构化引用；**借鉴参数集** | ✅ |
| Connection | 授权变量注入（弱） | **Observed**：DSL 的 authAppVO=授权应用引用 | OAuth 目录+credential 表+id 引用 | connection 表+secret_ref（authAppVO 映射）；删被引用=409；OAuth 目录 Future | ✅ |
| 暂停/恢复/人审 | 无 | — | paused_executions+resume_queue | Future（业务 Review 走业务层，不进 Runner） | ⛔V1 |
| 子 workflow | 有"工作流执行"节点 | — | 进程内嵌套+callChain 防递归 | Future；保留 callChain 思路 | ⛔V1 |
| 循环/并行 | 无 | — | 哨兵+子流克隆 | Future | ⛔V1 |
| 成本/Token | 未观察到 | — | usage_log 账本 | node_run/run token_usage 汇总；账本 Future | ✅简 |
| 大值外置 | — | — | traceStoreRef | Future（V1 截断标记） | ⛔V1 |
| 协作编辑 | 无 | — | realtime Socket.IO | Do Not Adopt | ⛔ |
| 代码节点 | 有（内嵌 IDE） | — | isolated-vm 沙箱 | **V1 不做**（安全边界）；Transform 白名单表达式替代 | ⛔V1 |

| Agent 层对象 | 三型 Agent+内嵌流+资源挂载 | **Observed**：save_agent_config(workflows[]/knowledges/customVariableMemory/dialogueConfig)；创建=点型卡即建草稿 | 无直接对应（Sim 无 agent 壳） | 我们 V1：**Agent=Workflow 同一对象**（冻结基线），但保留"资源挂载区"（知识/工具/记忆）作为 Agent 配置面板；三型 taxonomy 记录不做 | ✅壳简化 |
| Agent 级节点族 | palette 四组含 Agent/信息收集/对话回复/记忆变量 | Observed | Sim subflow/loop 等 | V1 节点清单不变（13 §3）；**记忆变量节点=Future**，Agent 子调用节点=Future | ⛔V1 |
| 可观测性 | 运行观测 Tab（观测配置/回放/智能洞察+灰度+消耗量） | Observed | Sim 无内建 | **借鉴**：Run Detail 之外做"观测"视图 V2；V1 先 Run 列表+详情 | V2 |
| 调试 | 自主规划型预览调试+双模型对比 | Observed | Sim playground | **借鉴双模型对比**入 Test Panel（V2）；V1 单模型 | V2 |
| 技能 | 技能=可挂载能力（知识库检索工具），与工具并列 | Observed | Sim tools | 我们：知识检索=builtin Tool（合并工具/技能两概念，简化） | ✅ |
| 变量机制 | 公共参数+累积继承+记忆变量 | Observed（语法+Picker 结构）+用户指定 | Sim 同名引用+state | **采纳**（07 §6b） | ✅ |
| 运行协议 | 双 SSE：workflow 整包快照 vs chat 增量 title 流 | Observed（三型两型跑通） | 细粒度事件+eventId 重放 | 我们=细粒度+sequence；**借鉴 chat 流的节点 title 进度渲染**做前端节点态文案 | ✅ |

## 冲突记录

1. **节点视觉**：quickservice 彩色图标族 vs 基线"黑白灰中性、禁彩虹"。裁决：基线优先（冻结），quickservice 只借信息结构（摘要行/chip），不借配色。
2. **条件表达**：quickservice 分类节点"选项"列表 vs Sim 边挂 condition。裁决：branches 在节点、handle 在边（07），UI 用分支表编辑（类 quickservice 选项体验），存储用 sourceHandle（Sim/xyflow 兼容）。
3. **Run 存储**：Sim 单行 jsonb vs 我们独立表。裁决：独立表——质检证据链需要节点级查询与保留策略；Sim 模型在其规模下合理，不静默照搬。
