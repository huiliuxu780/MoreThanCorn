# 轻量 Workflow 系统 · 调研与设计总报告

> 三证据链：quickservice UI 实操（01）· Network（02，CDP 采集成功，Observed-Network）· Sim 源码（03）。
> 设计：05 架构 / 06 前端 / 07 DSL / 08 Registry / 09 Runner-Worker / 10 Logs-Events / 11 数据模型 / 12 安全部署 / 13 POC 与计划 / contracts/。
> 证据台账：evidence/evidence-ledger.md。

## 任务书 §15 逐条决策

1. **目标产品最值得借鉴的 UI/交互**（第二轮扩充）：检查清单红点徽标；节点卡配置摘要+类型 chip+"未配置"灰字；自动保存时间戳+手动保存并存；发布软警告三选项；统一变量引用（⚙级联+"#"内联）；工具调用日志页（时间窗+耗时+归属）；**变量三机制（入口公共参数+累积继承+记忆变量）**；**编辑器内建可观测（运行观测/回放/智能洞察+灰度）与预览调试双模型对比**（后两项 V2 借鉴）。
2. **Network 能确认的契约**（CDP 采集成功，Observed-Network）：workflow 域端点全集（flow_list/flow_detail/**flow_saveOrUpdate(创建+保存, draftVersion 自增)**/workflow_history/check_workflow_tryRunning_api/**kbsListAllAvailableLlm**/agent_param_list/插件目录/调用日志/**requiredLock 2s 心跳**，全 POST+mopen 信封）；**DSL 保存结构全文**（{nodes,edges,checkList}，nodeType 8 类，referInfo 二态绑定，llmConfig/toolCode 快照，gzip+base64 传输）；编辑悲观锁（wsId）；**Run 协议**：`POST /quick/agent/workflow/sse/start`→SSE 整包快照 ~2Hz+agentNodeExecLogList 节点级日志（真实试运行取证）。仍 Unverified：发布端点、status 数值码表、条件分支边样本（补采清单 02 §6）。
3. **Network 不能证明的后台能力**：数据库/Queue/Worker/Scheduler/重试算法/幂等/凭证加密/日志存储/部署——全部 Designed（05/09/11/12），Sim 源码提供可行性互证。
4. **Sim 支撑闭环的核心模块**：executor/（DAG 内核）、serializer/、tools/registry+executeTool、providers/、lib/core/async-jobs、lib/workflows/schedules、lib/logs、packages/db schema（03 §7）。
5. **Sim 值得参考并重写**：type 字符串贯穿三态+通用节点组件+声明式配置；编辑/运行两态分离；环检测等纯函数（直接复用逻辑）；PG 表队列+幂等认领；外部 cron 扫表调度；SSE+seq 重放；块级重试；触发绑版本快照。
6. **Sim 必须删除**：realtime 协作、custom block overlay、BlockMeta 目录、sim-auto/mothership 云端、Trigger.dev、数百 SaaS 工具、计费准入、厂商遥测、basic/advanced 双模、block 版本后缀治理、isolated-vm/E2B 沙箱（V1）。
7. **是否启动轻量重写**：**是**。Sim 证明"PG+进程内 worker+cron"单机可闭环；quickservice 证明交互形态；我们栈（FastAPI+PG+xyflow）与两者核心机制同构，重写成本远低于裁剪 Sim 的 Next.js/TS 全栈。
8. **为什么不深度裁剪 Sim**：TS/Next.js 与目标 Python 栈不符；其重量在协作/计费/集成长尾（占代码量大头），裁不掉架构只裁得掉功能；且冻结基线已导入 CORNplus 前端源码，后端需独立可控。
9. **为什么不用 LangGraph**：冻结约束；我们的 DAG 语义简单（单 Start+分支+汇聚），自研 200 行级 Runner 可解释、可冻结版本、可证据回溯；LangGraph 引入状态图抽象与依赖，收益为负。
10. **最终基础依赖**：PostgreSQL（唯一必须外部服务）+ FastAPI 进程（web+worker+scheduler 合一）+ croniter/zoneinfo + Fernet。**Redis 不进 V1**（取消用 DB 标志、无跨进程 pub/sub 需求）；Queue 用 PG SKIP LOCKED；无对象存储（大值截断，Future）。
11. **Schedule/Queue/Worker/Logs 进第一期**：**全进**，但形态最小：Schedule=表+tick+API（开关交付）；Queue=PG 表；Worker=同进程 asyncio；Logs=run_event+SSE+轮询兜底+Run Detail。理由：任务书目标闭环硬性要求，且 Sim 证明每项都有零额外依赖实现。
12. **V1 节点**：input / llm / tool / condition / transform / end / create-record / notification（8 种，13 §3）。Code 节点、error 边、循环、并行、子 workflow、human-interrupt 均不在 V1。
13. **最小 POC**：承诺类质检链（Start→LLM①→Condition→Tool 查单→LLM②→Transform→create-record→End），验收 13 项（13 §1）。
14. **第一刀**：Validator+草稿契约（P0）——前端表单、检查清单、发布门禁、Runner 前置校验的唯一事实源。
15. **本轮绝对不做**：LangGraph；任意 Python 存储；Sim TS Runtime 直译；通用 Agent 平台；插件市场；聊天 Workspace；多租户/计费；协作编辑；MCP 运行时；代码沙箱。

## 进入编码前的未决问题（13 §5）

xyflow v12 实测；LLM provider 清单；biz_api 鉴权方式；run_event 保留期运维口径；企业时区配置键。

## 验收对照（任务书 §16）

| 项 | 状态 |
|---|---|
| 真实浏览器 UI 调研+截图 | ✅ 24 张 |
| 完整走通 创建/编辑/测试/Logs | ⚠️ 创建-编辑-校验-发布门禁已走通；**测试运行被产品前置校验合法阻断**（未配置节点），运行态/Logs 以 Sim+Designed 补齐，未伪造 |
| UI↔Network 关联 | ✅ CDP 采集 117 条（脱敏），端点清单与操作步骤关联（02） |
| 还原保存结构/事件链 | ✅ 保存结构已还原（DSL 全文解码）；事件链：quickservice SSE 整包快照协议 Observed + Sim 细粒度事件互证 |
| 完整走通 创建/编辑/测试/Logs | ✅ v6-v7：创建 TEST 工作流→连线→配置模型/提示词/结束输出→试运行→SSE 节点日志（start success 8ms / llm running） |
| Agent 层与全局资源调研 | ✅ 第二轮：三型创建弹窗、对话编排/自主规划编辑器、知识库/技能/标签页、save_agent_config 契约；专家组编辑器内部 Unverified（已记录） |
| 深跑问答与反思 | ✅ 14：工具条四件套实证、全节点类型配置表、并行结论、反思、**就绪度=可开工 P0** |
| 观察/推断分离 | ✅ 全证据标记 |
| Sim 结论来自源码 | ✅ Part A/B 逐文件引用 |
| 核心依赖/云端依赖 | ✅ Part B 五类归属 |
| Node/Tool/Executor/Model/Connection 关系 | ✅ 03/08 |
| Schedule/Queue/Worker/Runner 关系 | ✅ 03/09 |
| Run/NodeRun/Logs/Events/Result 关系 | ✅ 10/11 |
| 前端/后端架构/数据模型/DSL/OpenAPI/Event Schema/安全部署/POC | ✅ 05–13+contracts |
| 无 LangGraph/无平台膨胀 | ✅ |
