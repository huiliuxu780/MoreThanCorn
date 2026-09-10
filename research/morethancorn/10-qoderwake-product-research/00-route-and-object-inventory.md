# 00 · QoderWake 路由与对象清点（G1）

> 状态：v2（2026-09-08，阶段一浏览器实调完成；细节观察见 01-qoderwake-product-observation.md）
> 证据等级：除注明外均为 O1（当前页面截图 + URL + DOM/可见文案）
> 实例：http://127.0.0.1:19830/（title "QoderWake CN"），视口 1440×900
> 截图目录：research/morethancorn/10-qoderwake-product-research/screenshots/

## 1. 全局导航（所有页面共用的左轨）

左轨默认收起为窄图标轨（有"展开侧边栏"按钮），complementary 区域可访问名为 "Chat 对话"。结构：

| 分组 | 项 | 路由 | 截图 |
|---|---|---|---|
| 工作 | 任务看板 | /work-management | g1-01 |
| 工作 | @Waker | /at-waker | g1-02 |
| 工作 | 自主工作 | /autonomous-work | g1-03 |
| 资源 | Waker 管理 | /management | g1-04 |
| 资源 | 能力与资源 | /resources（重定向 /resources/skills） | g1-05 |
| 员工与群组 | 切换到 Group（按钮，切换左轨列表视图） | 未产生路由变化（待复核） | — |
| 员工与群组 | 新建 Waker | /recruitment-market | 待补 |
| 员工与群组 | Waker 快捷入口 ×3（前端小哥 / RESEARCH-INSTANCE-20260905 / TECH-RESEARCH-20260905，按钮+avatar） | 待复核（疑似进对话 UI） | — |
| 底部 | 用量（按钮） | 待复核 | — |
| 底部 | 设置（按钮） | 待复核 | — |
| 浮层 | 问题反馈（按钮） | — | — |

路由事实：
- `/` 重定向到 `/work-management`（O1）。
- 能力与资源子页签为独立路由：/resources/skills、/resources/connector（**单数**）、/resources/knowledge、/resources/wakerflow、/resources/projects（O1，页签点击后 URL 变化）。
- **路由缺陷（O1，截图 g1-07）**：直接深链 `goto /resources/connectors`（复数、非真实 slug）被重写为 `/resources/connectors/skills/skills/...`（约 150 次重复）且内容区空白；子页签只能经客户端页签点击到达。对我方的启示：深链与 slug 校验是产品契约的一部分。
- WakerFlow 详情：`/wakerflow/<uuid>`；运行记录视图：`/wakerflow/<uuid>/runs/<run-uuid>`（O1，视图切换即换路由）；新建：`/wakerflow/new`（O1）。

## 2. 各路由主对象与主要动作

### /work-management 任务看板（g1-01）
- 主对象：任务（工作记录）。副文案："从「事」出发：查看 Waker 做了什么，完成必要操作并查收结果。"
- 指标带"工作记录"：任务总数 8 / 进行中任务 0 / 需要操作 0 / 已结束任务 8；数据周期 combobox（默认"一个月"）；caption "Waker 们正在休息"。
- "需要关注" region：页签 需要操作（0）/ 查收结果（0）；空态文案"需要你确认、回答或补充信息的任务会显示在这里。"→ **是用户动作队列（页签），不是过滤器**（O1）。
- "全部任务" region：列表/泳道 tab 切换；筛选=搜索框（placeholder 搜索任务、Waker 或 Group）+ Waker/Group combobox + 触发方式 combobox + 任务状态 button + 数据周期 combobox；表列=任务/执行者/来源/状态/最近更新；行内"查看详情"；分页（任务分页 nav + 每页条数 combobox 默认 10 条/页）。
- 行样本（O1）：编写数据解析与接口请求逻辑（前端小哥/对话触发/已完成/32分钟前）、自动任务数据打标（前端小哥/对话触发/已完成）、第 3 次运行（text-only-review/手动触发/失败）、前端唤醒问候（对话触发/已完成）、第 2 次运行（手动触发/已取消）、第 1 次运行（手动触发/已完成）、TECH-RESEARCH-TRIGGER-20260905 #1（手动触发/已完成）、打招呼（对话触发/已完成）。
- 观察：来源仅见"对话触发/手动触发"两种值；**任务行标题存在"第 N 次运行"命名**（text-only-review 的三次运行各成一行）→ 任务看板行粒度疑似 = run 级（O2 待详情复核）。

### /at-waker（g1-02）
- **不是对话 UI，而是 IM 渠道管理页**。主对象：@Waker 的 IM 聊天开通记录。
- 动作：开通 @Waker、IM 连接管理、待处理申请（待处理的聊天接入申请）。
- 表列：聊天 / IM 连接 / Waker / 工作目录 / 模型（tooltip：觉醒模式展示默认 Waker 使用的模型；答疑场景的模型由群聊答疑专员工作流管理）/ 聊天状态 / 启用 / 操作；视图切换 表格/卡片；筛选 搜索+聊天类型+模型+状态；当前空态。
- 对话 UI 的真实入口在左轨 Waker 按钮与 Waker 卡"对话"按钮（待复核）。

### /autonomous-work（g1-03）
- 主对象：自动任务。副文案："通过定时、事件或 API 自动开工，并由 Waker 或 WakerFlow 响应。"
- 指标带：自动任务总数 1 / 已启用 1 / Waker 执行 1 / WakerFlow 执行 0。
- 筛选：执行者 / 触发类型 / 自动任务状态 / 排序（最近创建）。
- 表列：自动任务 / 触发来源 / 触发条件 / 执行者 / 最近触发 / 累计自动运行 / 状态（switch"启用"[checked]，**状态变更控件，禁点**）。
- 行：TECH-RESEARCH-TRIGGER-20260905，触发来源 API，触发条件"通过 POST 请求触发"，执行者 TECH-RESEARCH-20260905（Waker），最近触发 —，累计 0 次，启用。
- 动作：新建自动任务（右上）。

### /management（g1-04）
- 主对象：Waker（员工）。副文案："选择 Waker 开始任务，或者新建一个开始工作。"
- 动作：分享记录 / 导入 Waker / 新建 Waker；页签 管理分类 = Waker | Group。
- 筛选：搜索名称或角色 / 运行状态（**默认"在线"**）/ 角色 / 环境 / 排序字段；计数"3 个 Waker"。
- 卡片字段：在线徽标、本机徽标+主机名（RiversdeMacBook-Pro）、avatar、名称、角色 chip、描述、任务数、最近运行；动作 管理 / 分享 / 对话；链接"查看 X 的角色详情"；另有"新建 Waker"占位卡。

### /resources/*（g1-05…g1-09, flow-01…07）
- 五页签：Skills / 连接器 / 知识库 / WakerFlow / 公开项目（页签卡带副标题：探索与安装 Skill / 连接外部工具与服务 / 沉淀与共享知识 / 编排可复用工作流 / 管理 Waker 共享项目）。
- Skills（g1-05）：子视图 技能市场 | 我的技能；分类 listbox（全部分类 43648、DevOps 与部署 12623、效率工具 12510、研究与分析 3354、内容创作 7249、设计与 UI 3891、数据与 AI 3032、文档与写作 3939）；市场卡=名称+推荐徽标+描述+作者+安装数；分页 2183 页；卡动作"查看并安装"。**市场制数据（43648 等）为原站生态事实，我方已拍板不照搬市场制。**
- 连接器（g1-07b，/resources/connector）：子视图 连接器市场 | 我的连接器；分类 11 组共 22；卡=Waker 内置（全部 Waker 已安装）/浏览器/计算机控制/钉钉/企业微信/Linear/Notion/Supabase/Vercel/Neon/云效 DevOps/Canva可画/墨刀/Todoist/PolarDB/高德云图/企查查/北大法宝/企百科/Proboost/华宇元典/今日投资；动作 打开 X 连接器 / 安装。
- 知识库（g1-08，/resources/knowledge）：范围 listbox 我创建的(1)/与我共享的(0)；新建知识库；卡=名称+资料数+更新时间+"设置可使用该知识库的 Waker"+N 个 Waker 使用+分享+更多操作。→ 知识库是共享资源 + Waker 挂载绑定（O1）。
- WakerFlow（g1-06，/resources/wakerflow）：描述"把多个 Waker 的工作步骤编排成可反复运行的流程，用于代码审查、批量处理和交叉验证等复杂任务。"；新建 WakerFlow 卡 + 现有 flow 卡（名称+描述+N 个 Waker 参与+⋯更多操作）。
- 公开项目（g1-09，/resources/projects）：文案"添加本地目录或 Git 仓库作为工作上下文，发起任务时可直接选择。公开项目对当前账号下所有 Waker 可用；如需创建 Waker 项目，请前往对应 Waker 的管理页。"；新建公开项目；当前空。→ Project/Workspace = 本地目录或 Git 仓库的工作上下文；两级作用域：账号公开 vs Waker 私有（O1）。

### /wakerflow/<uuid> 详情（flow-01…05, 07）
- 头部：返回 WakerFlow 管理 / 标题+重命名 / 视图 radiogroup（WakerFlow | 执行记录，**切换即换路由**）/ 添加触发方式 / 运行（**执行控件，禁点**）。
- WakerFlow 视图：展开对话面板；显示模式 tab 画布 | 脚本；"输入参数" group [disabled]（文案"手动运行，需要填写以下信息："）；版本历史；画布=阶段卡（阶段 01 确认 / 阶段 02 复核，卡内步骤节点带 Waker chip c78b37df31ae）+ 节点级"请输入调整内容"按钮；画布缩放组（平移/缩小/放大/适应）。
- 脚本视图（flow-03）：**代码 DSL 编辑器**。语法事实（O1 全文截图）：
  - `export const meta = { name, description, phases:[{title,detail}], outputSchema:{type,required,properties} }`
  - `phase('<title>')` 分段；`const x = await worker('<prompt>', { label, phase, inputs:[...], outputs:[...], resolve:{ kind:'waker', wakerId:'<8位短id>' } })`
  - `return { ... }` 结构化终态；prompt 间可用 `${acknowledgement}` 模板串传递上游输出。
  - 保存按钮初始 [disabled]（有改动才可用）；版本历史同在场。
- 执行记录视图（flow-02，路由 /wakerflow/<uuid>/runs/<run-uuid>）：画布按 run 渲染阶段状态（阶段 01 失败红框 / 阶段 02 未执行；每阶段"N 个执行节点"+节点状态图标）；右侧 complementary"运行记录"=run 列表（第3次运行 手动运行 运行失败 55分钟前 [selected]；第2次 已终止 9月5日 12:55；第1次 已完成 9月5日 12:47），每 run 行：2–3 个**无 aria/title/tooltip 的图标按钮**（SVG 推断 I1：rotate-cw 系≈重跑、document 系≈报告/日志；**不点击，记 UNIDENTIFIED_CONTROL**）+ "基于此次运行优化工作流"按钮（aria 可证）。
- 版本历史面板（flow-04）：complementary"历史版本"，条目"版本 1 [当前版本] 9月5日 12:46"。**版本化存在（整数版本号+时间）；回滚/发布/草稿语义单版本不可证 → EVIDENCE_GAP**。
- 触发方式弹窗（flow-05，"编辑触发方式"）：文案"**一个 WakerFlow 只有一份自动运行配置，可添加多个触发方式**"；触发方式 (1/5) 必填 + 删除此触发方式；类型卡=定时（按计划运行）| API（收到 API 请求时运行）；调度类型 tab=定期|一次性；重复 combobox（每天）+时间（09:00）+"下次运行: 2026-09-09 09:00"；添加触发方式；"已配置 1/5 个触发方式"；取消/保存。**注意：此处只见 定时|API 两型；"事件"触发仅出现在自主工作页文案与种子截图，两处触发型集合是否一致待复核**。
- 对话面板（flow-07，complementary"对话编辑 WakerFlow"）：新建对话/对话列表/收起；历史生成会话（session id 5db3188f-…，时间戳）完整可见：助手深度思考折叠块（**CoT 外露=原站高风险表象，我方禁抄**）、工具调用按钮"已完成 mcp__wake__workflow_get_script / mcp__wake__workflow_upsert"带参数与响应全文、结论表格、快捷方案 toolbar（基于最近运行优化工作流 / 试运行=执行禁点）、输入框+添加文件或图片+Auto+发送。
  - **upsert 响应体= WakerFlow 存储契约的 O2 级直接证据**：`{id, name, digest(64hex), meta{name,title,description,phases[],callSites[{callSiteIndex,primitive:'phase'|'worker',position{line,column},label}],outputSchema}, scope{kind:'global'}, version:1, generationSessionId, createdAt, updatedAt, script}`。即：脚本为唯一事实源，画布/阶段/节点由 callSites 解析投影；digest=脚本摘要；version 整数递增；生成会话 id 回写定义。

### /wakerflow/new 新建（flow-06）
- **对话式生成页**：欢迎语"编排 Waker 完成复杂任务 更确定，更可靠"+3 条示例 prompt 按钮+自由输入框"输入你的想法"+Auto 模型选择+发送（空时 disabled）。**无手工节点面板/无表单向导**（O1）。创建=自然语言→AI 生成脚本；不提交（提交=创建实体，禁）。

## 3. 无法安全进入 / 本轮阻断清单

| 面 | 原因 | 记号 |
|---|---|---|
| 运行 WakerFlow（头部"运行"、对话面板"试运行"） | 点击即产生真实 run | BLOCKED_BY_SIDE_EFFECT |
| run 行无名图标按钮（疑似重跑/报告） | 无 aria/title/tooltip，含义不可证且可能重跑 | UNIDENTIFIED_CONTROL |
| 自动任务"启用"switch | 状态变更 | BLOCKED_BY_SIDE_EFFECT |
| 触发方式弹窗"保存"、脚本"保存"、新建 flow 发送 | 创建/修改实体 | BLOCKED_BY_SIDE_EFFECT |
| 选择性重做单阶段/单节点 | 页面无任何可见入口；仅 run 级无名图标存疑 | EVIDENCE_GAP |
| Flow 嵌套/环/最大深度 | 页面无可见限制说明；DSL 未见 flow 调 flow 原语（仅 worker resolve kind='waker' 被观察到） | EVIDENCE_GAP |
| 工作空间/资源如何传入 flow run | 未见字段 | EVIDENCE_GAP |
| Skill 市场安装、连接器安装 | 安装=状态变更 | BLOCKED_BY_SIDE_EFFECT |

## 4. 同一名词跨页含义核对（初版）

- "任务"：看板行（run 级嫌疑）vs 自动任务（定义级）vs Waker 卡"任务数"（计数）→ 三义并存，需详情复核（§4.1 问题 7）。
- "触发"：看板"来源"列（对话触发/手动触发）vs 自动任务"触发来源"（API…）vs flow 触发方式（定时/API）→ 触发事实至少三处表达。
- "项目"：公开项目（账号级工作上下文）vs Waker 项目（Waker 管理页内）vs 自主任务表单"工作空间-项目"选项（种子截图）→ 三级嫌疑。
- "执行者/执行方式"：看板"执行者"=Waker；自动任务"执行者"=Waker（WakerFlow 执行计数存在但当前 0）；flow worker resolve kind='waker'。

## 5. v2 回填的新路由与面

| 路由/面 | 主对象与事实 | 截图/证据 |
|---|---|---|
| /conversations/qs_<id>?sid=<session-uuid> | 任务详情=对话会话视图；左栏 对话任务\|自动任务 双 tab+任务列表+新建对话任务；转录含工具调用参数/响应、产物 region、composer(@工作区上下文/选择工作目录/附件/Auto) | tb-01 |
| /wakers/<wakerShortId>/home 及子页 /workflows 等 | Waker 工作区九子页（概览/任务看板/自主工作/记忆/自进化 Skill/Skill/连接器/Wakerflow/知识库/项目/权限/Waker 档案）；概览含 ID/入职/工作日志/热力图/任务类型分布/记忆时间线/技能/连接器 | waker-01, waker-02 |
| /autonomous-work/tr_<id> | 自动任务详情：运行概览四指标(手动=调试不计入)、API 调用地址 atk_ token+外链文档、响应、高级设置、运行历史表(查看任务回链看板) | auto-03 |
| /wakerflow/new | 对话式生成页（无手工节点面板） | flow-06 |
| /recruitment-market | 创建 Waker：9 预置角色+自定义模板+群聊答疑专员+自定义 Waker | snapshot（未截图） |
| 用量按钮 | Credits 面板：团队版/续期日/2,718÷3,000/资源包 | innerText（未截图） |
| 设置按钮 | **两次 JS 点击无可观察面板 → EVIDENCE_GAP（附尝试记录）** | — |
| 切换到 Group | 点击后按钮 [disabled]、无 Group 实体；管理页 Group 页签未开 → 部分证据 | — |
| 新建自动任务弹窗 | 全字段复核（触发 定时\|API 1/5、执行方式 Waker\|WakerFlow、执行指令 0/10000、工作空间三态、高级=最大运行次数+截止日期）；与种子 03/04/05 一致；**副标题"事件"触发在表单无入口（差异事实）** | auto-01, auto-02 |

仍待补（非核心，记缺口）：知识库详情页、Waker"权限/档案/记忆/自进化 Skill"子页、管理页 Group 页签、@Waker 开通弹窗与 IM 连接管理（IM 属我方范围外，主动不深挖）、Skill"我的技能"子视图、连接器"我的连接器"子视图。
