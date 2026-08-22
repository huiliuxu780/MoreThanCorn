# 14 · 深跑问答（a–e）与长线调研反思

## a. Flow 全局能力四件套（V1a 实证）

| 能力 | 结论 | 证据 |
|---|---|---|
| 优化布局 | ✅ 有。工具条"优化布局"按钮，点击后节点自动重排为整齐分层布局 | qV1a-icon2-layout.png（tooltip"优化布局"+重排前后对比） |
| 缩略图开关 | ✅ 有。工具条"缩略图"按钮切换 minimap 显隐 | qV1a-icon1.png（tooltip"缩略图"） |
| 节点搜索 | ✅ 有。工具条放大镜→搜索框+结果弹层（输入"大模型"列出匹配节点，点击可定位） | qV1a-icon-search-typed.png |
| 卡片收起 | ⚠️ 节点标题旁有 ∨ chevron 控件（所有节点），**收起行为未实证**（点击坐标落入节点体触发了抽屉）；控件存在=Observed，行为=Unverified | 多截图可见 chevron |

另有：缩放%下拉、适应画布、连线"不能重复连线"校验 toast、选中节点浮现 ▶单节点运行+…菜单。

## b. 各节点类型配置内容（卡片摘要+抽屉实测汇总）

| nodeType | 输入 | 输出 | 关键配置项 | 取证方式 |
|---|---|---|---|---|
| start | — | userQuery/chatHistory/userId/conversationId/chatId/file{fileType,fileUrl,fileName}/reference | 公共参数表(名/类型/必填/描述)+添加 | 抽屉 |
| end | output(可多条) | — | 值=固定或引用 | 抽屉 |
| llm | 自定义变量表 | output/thought/answer | 模型下拉(能力标签)、提示词(#变量)、单次/批处理、输出格式(Markdown/JSON)+输出示例 | 抽屉 |
| plugin-tool | 工具 schema 参数(含授权变量) | schema 树 | 工具绑定(toolCode/插件名/来源)、流式输出开关 | 抽屉 |
| condition | query 等 | 分支 handles(如果/否则) | 条件构建器=引用变量⚙+条件关系+比较变量；+添加条件/+添加分支 | 抽屉 |
| code | 自定义变量表 | 自定义 | 内嵌 IDE(args/ret 约定)+外开编辑器 | 抽屉 |
| question-classifier | *query | classificationTitle/Id | 模型；分类行(拖拽/名称0-20/描述/删除)+其他分类 | 抽屉 |
| variable-handle | 自定义 | Group1 Str. | 分组 groups | 卡片+抽屉 |
| knowledge-search | query Str. | outputAnswer Str. | **知识库选择器**（未配置知识库） | 卡片 |
| data-query | 自定义 | outputAnswer Str. | **查询条件+数据表**选择器 | 卡片 |
| query-rewrite | query+chatHistory | queryList **Arr.** | — | 卡片 |
| image-gen | 自定义 | image1 **Img.** | **模型+原图** | 卡片 |
| customer-service-tool | — | — | **内置客服工具列表**（创建工单=自动创建工单、在线转人工=工作流转人工节点，+添加） | 抽屉 |
| dialogue-reply / info-collect / agent / memory-var / workflow-exec | 见卡片 | 见卡片 | 对话回复=回复话术；信息收集=表单字段；agent=子Agent选择；记忆变量=读/写记忆；workflow-exec=workflowCode | 卡片级 |

类型系统观察：输出类型含 Str./Int./Obj./Arr./Img.； Arr/Img 证明类型系统不止标量。

## c. 节点并行支持

- **结构层 ✅**：一个节点可拉出多条出边到不同下游（Start 同时直连 End 与 LLM 被画布接受）；专家组创建卡插画=条件扇出到多 Agent 节点。
- **执行层 ⚠️ Unverified**：并行运行实测被前置校验拦截（新增未配置节点触发门禁），未拿到并发时间戳证据；Sim 引擎就绪队列并发可作参考实现。
- 设计裁决：我们 V1 Runner 就绪队列天然支持并发分支（09），但**第一版验收只承诺顺序+条件**，并发作为免费附带不承诺 SLA。

## d. 长线调研反思

**做对的**：
1. 三链交叉+证据分级（Observed/Inferred/Unverified/Designed）贯穿始终，未伪造任何事实；阻塞（Network、登录墙、CDP 退化）均如实记录。
2. 由浅入深三轮（UI 普查→契约解码→三型深跑），每轮都修正了上一轮的认知错误（层级误读、变量机制、运行协议双形态）。
3. 安全边界零越界：未发布、未删数据、未导出凭证；副作用（草稿 agent/测试行）全部标记可删。

**做错的/代价**：
1. **坐标自动化过度投资**：在窗口/DPR 漂移上消耗约 15 轮才引入 Emulation 固定视口——应第一轮就做。教训：共享浏览器自动化先锁视口再谈坐标。
2. **证据留存失误**：捕获文件按轮覆盖，早期 SSE 正文丢失——应每轮独立文件+关键 body 即时落盘。
3. **产品层级先验错误**：首轮把 subflow 当顶层对象，浪费一轮设计校准——应先做 IA 全景再深入。
4. 部分结论停在卡片级（b 表后 6 行抽屉内部未开），条件"如果"完整构建器、记忆变量读写 UI 仍 Unverified。

**置信度地图**：高=编辑器交互/DSL/保存/校验/双 SSE/三型运行（两型实测）；中=Agent 层契约/全局资源页；低=发布端点/status 码表/并行并发/自主规划运行/记忆变量 UI。

## e. 开发复刻就绪度评估

**结论：可以开工，且建议立即开工 P0。** 理由：
- 前端复刻所需：壳层/节点卡/抽屉/变量引用/校验/工具条四件套/调试面板 全部有截图+字段级 Spec（01/06/interaction-spec）。
- 后端所需：DSL schema（07+contracts）、保存/校验/锁/历史端点语义（02）、Runner+Queue+Scheduler 设计（09，Sim 互证可行）、事件协议（10，双形态取舍已裁决）、数据模型（11）、安全部署（12）。
- 不阻塞编码的缺口（边开发边补）：发布端点细节、status 数值码表、并行并发语义、记忆变量 UI、自主规划运行迹。这些都在 P2+ 才需要。

**第一刀不变**：Validator + 草稿契约（P0）——它是前端检查清单、发布门禁、Runner 前置校验的共同事实源。
