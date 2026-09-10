# 01 · QoderWake 目标产品观察报告（阶段一）

> 日期：2026-09-08 · 实例：http://127.0.0.1:19830/（title "QoderWake CN"）· 视口 1440×900
> 执行：本文件记录阶段一只读观察；2026-09-08 后续已对 TEST 对象执行创建、编辑、启停和手动运行，见 `11-task-automation-live-replay.md`。本文件中的“禁点/未执行”只描述阶段一当时状态，不再代表当前总证据边界。
> 证据等级：O1=截图+URL+DOM；O2=跨视图交叉印证；I1=推断（显式标注）
> 截图：screenshots/ 下 g1-*（路由清点）、tb-*（看板/对话）、auto-*（自主工作）、waker-*（Waker 管理）、flow-*（WakerFlow）
> 种子截图 01–05 已独立复核：03/04/05 与 auto-01/02 一致（见 §4.3）；01/02 与 g1-01/g1-03 一致

## §4.1 任务看板（/work-management）

步骤 ID：QW-01
入口 URL：http://127.0.0.1:19830/ → 重定向 /work-management
前置状态：已登录实例（沿用既有会话）
用户动作：打开首页，等待"正在加载工作记录…"消失
可见结果：指标带"工作记录"（任务总数 8/进行中 0/需要操作 0/已结束 8，数据周期=一个月）；"需要关注"区（需要操作(0)/查收结果(0) 两页签，空态文案"需要你确认、回答或补充信息的任务会显示在这里"）；"全部任务"区（列表/泳道 tab；搜索+Waker/Group+触发方式+任务状态+数据周期五筛选；表列 任务/执行者/来源/状态/最近更新；8 行；分页+每页条数）
对象/字段/状态：状态值见 已完成/失败/已取消；来源值见 对话触发/手动触发
截图：g1-01-work-management.png
证据等级：O1
确认的事实："需要操作/查收结果"是**用户动作队列页签**（region"需要关注"+空态文案），不是过滤器；看板带周期维度的聚合指标
不能由此确认：指标口径（"已结束"是否含失败/取消）
风险/疑问：行粒度（见 QW-02）

步骤 ID：QW-02
入口 URL：/work-management 行点击
用户动作：点击行"编写数据解析与接口请求逻辑"
可见结果：路由变为 /conversations/qs_01m1zy6bnvc9fmjswwg4v7w313?sid=168f5d8c-…（**任务详情=对话会话视图**）；左 complementary"前端小哥"含 对话任务|自动任务 双 tab、"3 个任务"、新建对话任务、任务列表（每条目带"暂无待关注结果"徽标+时间+更多操作）
截图：tb-01-task-detail.png
证据等级：O2（看板行 ↔ 会话列表条目 ↔ 路由 sid 三处互证）
确认的事实：对话触发的看板行 1:1 对应一个 conversation session；看板同时收录 flow 运行行（"第 N 次运行"，执行者列=flow 名 text-only-review，来源=手动触发，与 flow-02 的三次 run 状态 失败/已终止/已完成 一一对应）与自动任务运行（auto-03 运行历史"查看任务"回链）
**必须回答**：目标产品的任务看板**不是创作实体列表，而是 Run/WorkItem 的统一投影视图**——同一张表混排 对话 session、flow run、automation run 三类执行事实，用"来源/执行者"列区分。O2
任务与 Run 的关系：对话任务=1 行 1 session；flow=1 行 1 run（"第 N 次运行"）；即**行粒度=run/session 级，而非定义级**。O2
补注（复核 F-4/N-1）：同一 run 在看板显示"已取消"、在 flow 执行记录显示"已终止"，为跨视图词形差异；我方投影词表设计须显式映射（06 CF-22 两级词表）

## §4.2 @Waker / 对话

步骤 ID：QW-03
入口 URL：/at-waker
可见结果：**IM 渠道管理页**而非对话 UI：开通 @Waker / IM 连接管理 / 待处理申请三按钮；表列 聊天/IM 连接/Waker/工作目录/模型(tooltip:觉醒模式展示默认 Waker 使用的模型；答疑场景的模型由群聊答疑专员工作流管理)/聊天状态/启用/操作；表格/卡片视图；当前空态
截图：g1-02-at-waker.png
证据等级：O1
确认的事实：@Waker 一级入口的产品职责=把 IM 聊天接入 Waker 协作（渠道治理），对话本体在别处
不能由此确认：IM 接入后的运行形态（无已开通聊天可看）→ 对 IM 子面记 EVIDENCE_GAP（且 IM 属我方范围外，不深挖）

步骤 ID：QW-04
入口 URL：/conversations/qs_…?sid=…（由看板行进入）
可见结果：对话转录完整可见：用户消息(15:19:49) → Waker 回复含"深度思考"折叠块（**CoT 外露**）、工具调用按钮带参数/响应全文：Bash(ls/mkdir/npm install/which node)、mcp__plugin_wake_wakerflow__list_wakerflows（响应 {"wakerId":"b82d781c4c06","workflows":[]}）、TaskCreate/TaskUpdate（"Task #1 created/Updated"）、Write×7、mcp__plugin_wake_mcp_adapter__present_files（失败一次：directories not supported；成功一次：7 文件 copied 到 _output）；产物 region(7 个,可展开/下载)；composer=输入消息(@ 选择当前工作区上下文)+选择工作目录+添加文件或图片+Auto+发送
截图：tb-01-task-detail.png
证据等级：O1（工具名/参数/响应为页面可见文本）+ O2（list_wakerflows 的 wakerId 与 /wakers/b82d781c4c06 路由互证）
确认的事实：
- Waker 运行时工具面含 **wakerflow 插件工具**（list_wakerflows）→ Waker→Flow 方向存在运行时通道（O2）；是否含 run 类工具本转录未见（I1：存在但未证）
- **TaskCreate/TaskUpdate 是 Agent 运行内计划项**（taskId "1"），与看板任务、自动任务三者异质（任务书 §1.3 的三义在此全部实证）
- 工作空间路径约定：/Users/rivers/.qoderwake-cn/data/workers/<wakerShortId>/workspace/<sidShort>_<MMDD>/；会话产物目录 …/<session-uuid>/_output/（present_files 响应可见）
- 多轮连续性：sid 路由参数+左栏会话列表（O1）
必须回答：chat turn = run？看板行=session（1:1），但转录内不显示 run id/attempt；**"一个 session 一个 run"无法从页面证伪或证实 → 记 I1 倾向、O 级不足**
不能由此确认：对话是否可主动"运行某 WakerFlow"的 UI 呈现（仅见 Waker 自发 list 工具与文案提议"如果你更希望做成 WakerFlow…我来配置"）

## §4.3 自主工作 / 自动任务

步骤 ID：QW-05
入口 URL：/autonomous-work
可见结果：指标带 总数1/已启用1/Waker 执行1/WakerFlow 执行0；筛选 执行者/触发类型/自动任务状态/排序；表列 自动任务/触发来源/触发条件/执行者/最近触发/累计自动运行/状态(switch 启用[checked]，禁点)；行 TECH-RESEARCH-TRIGGER-20260905=API/"通过 POST 请求触发"/Waker/—/0 次/启用
截图：g1-03-autonomous-work.png（与种子 02 一致）
证据等级：O1

步骤 ID：QW-06
入口 URL：/autonomous-work 新建自动任务
可见结果（上半，auto-01）：名称*；触发条件*（"什么时候开始"）：触发方式卡 **定时|API 两型**（1/5+添加触发方式）、调度类型 定期|一次性、重复=每天+09:00+"下次运行: 2026-09-09 09:00"；执行方式*（"触发后交给谁执行"）radio=交给 Waker|运行 WakerFlow；执行对象*（Waker 卡+更换）；执行指令*（"每次触发时，都会将这里的内容作为 Prompt 发送给所选 Waker"+0/10000+Auto）；工作空间 tab=默认工作空间|本地目录|项目；高级设置折叠
可见结果（下半，auto-02）：高级设置[expanded]：最大运行次数=无限制|自定义（"达到最大运行次数后将自动暂停该任务"）；截止日期=永不截止|指定日期（"到达截止日期后将不再自动触发"）；取消/保存
截图：auto-01-create-dialog-top.png / auto-02-create-dialog-lower.png
证据等级：O1；与种子 03/04/05 独立复核一致
**阶段一差异记录**：页副标题称"通过定时、事件或 API 自动开工"，但当时新建弹窗与 flow 触发弹窗只见 定时|API。后续实调已证明页面会查询 event-source capability，官方说明也明确事件/定时拉取按来源条件展示；因此正确结论是“当前实例无可用来源”，不是“产品没有事件能力”。见 11 §8。

步骤 ID：QW-07
入口 URL：/autonomous-work/tr_956b9556b2b34c51（行点击）
可见结果：面包屑 自主工作>详情；Waker chip+标题+"响应 Waker X"；启用 switch/编辑/删除/运行；运行概览四指标（tooltip 明确"手动运行仅用于调试，不更新最近触发/不计入累计自动运行/不更新最近结果"）；触发条件：来源 API+**API 调用地址 https://api.qoder.com.cn/v1/qoderwake/automation/invoke/atk_****（已掩码；依任务书 §2.3 不记录原始凭据）**+外链 docs.qoder.cn 调用说明；响应：TECH-RESEARCH-20260905·Waker·可用+执行指令原文；高级设置；**运行历史表**（#/最近触发/触发来源/运行结果/状态/操作=查看任务；行 1=9月5日 3:21 手动 成功）
截图：auto-03-task-detail.png
脱敏注记（2026-09-08 复核修正 F-3）：正文 atk_ 凭据已掩码；auto-03 截图经 DOM 掩码后重捕、含凭据原图已覆盖；01 其余转录自检无其他凭据/PII 入文
证据等级：O1+O2（运行历史"查看任务"回链看板=automation run→task 关联的直接证据）
**必须回答**：自动任务是**定义**（Trigger+target+prompt+workspace+policy 五元组，运行历史另表）而非执行实体；批量能力在此**完全不出现**（表单/详情均无批量字段）→ 不能声称自动任务≡批量。阶段一只看到 invoke URL；后续实调与官方文档证明还要求独立 Bearer PAT，并明确 `wakeSessionUniqueId` 只控制会话复用、不是幂等键，见 11 §7。

## §4.4 Waker 管理

步骤 ID：QW-08
入口 URL：/management
可见结果：分享记录/导入 Waker/新建 Waker；页签 Waker|Group；筛选 搜索/运行状态(默认在线)/角色/环境/排序；3 卡+新建占位卡；卡=在线徽标+本机徽标+主机名 RiversdeMacBook-Pro+avatar+名称+角色 chip+描述+任务数+最近运行；悬停露出 管理(齿轮,aria-label)/分享/对话
截图：g1-04-management.png
证据等级：O1

步骤 ID：QW-09
入口 URL：/wakers/b82d781c4c06/home（卡"管理"）
可见结果：左 nav 九子页=概览|任务看板|自主工作|记忆|自进化 Skill|Skill|连接器|Wakerflow|知识库|项目|权限|Waker 档案（分组：工作/记忆与学习/能力与资源/权限与管理）；概览=ID sgnj1523+入职时间+编辑+工作日志四指标+活跃度热力图(按日任务数)+任务类型分布(对话任务3/自动任务0/@Waker 0)+记忆与学习时间线(记忆新增/学到新技能 design-system 等)+核心能力(5)+技能与工具(11 技能 chip+从技能市场添加+上传技能)+连接器(暂无+添加+导入 JSON)
截图：waker-01-manage-page.png
证据等级：O1
确认的事实：Waker 是**混合体**——用户可见资产根（角色/技能/挂载/权限/档案）+ 运行实例（在线/本机/主机名/工作日志/热力图/记忆事件）共存于一对象
不能由此确认：每种挂载是引用/复制/版本 pin（知识库卡见"N 个 Waker 使用"绑定关系=引用语义倾向 I1；Skill 是否复制入 Waker 目录不可见）→ EVIDENCE_GAP；Waker 级 版本/发布/草稿/启停 状态未见（仅在线）→ EVIDENCE_GAP

步骤 ID：QW-10
入口 URL：/wakers/b82d781c4c06/workflows（子页 Wakerflow）
可见结果："WakerFlow 管理"独立列表+新建入口；该 Waker 下空态"点击新建 WakerFlow，通过自然语言生成第一个可运行工作流"
截图：waker-02-subpage-wakerflow.png
证据等级：O1+O2（与 flow upsert 响应 scope.kind='global' 对照：Flow 有 全局/Waker 属主 双作用域；text-only-review 为 global 故不出现在此 Waker 列表——I1 解释）
必须回答（§4.4.8/9）：Waker 能否调用 WakerFlow=**运行时工具面有 list_wakerflows（QW-04），管理面有 per-Waker flow 列表**；WakerFlow 反向选 Waker=脚本 resolve.kind='waker'+wakerId（flow-03）→ 双向在产品层均存在入口；治理（mount/pin/预算）页面未见 → EVIDENCE_GAP
（§4.4.10）内部子代理/role 是否必须注册为顶层 Waker：未见子代理概念；flow 节点直接引用 Waker id；"群聊答疑专员"等预置角色在招聘市场以模板存在 → 倾向"role=模板，非运行子代理"（I1）

创建入口：/recruitment-market=创建 Waker 页（预置角色卡：前端/后端/测试/产品经理/数据分析师/UI 设计师/内容运营/DevOps/项目管理员/运维工程师+自定义模板 RESEARCH-TEMPLATE+群聊答疑专员；每卡能力 chip；"自定义 Waker"按钮）。O1（snapshot，未截图：预置列表为市场型内容，非本轮核心）

## §4.5 WakerFlow（最高优先级）

步骤 ID：QW-11
入口 URL：/resources/wakerflow（能力与资源第四页签）
可见结果：描述"把多个 Waker 的工作步骤编排成可反复运行的流程，用于代码审查、批量处理和交叉验证等复杂任务"；新建卡+flow 卡（text-only-review：描述+"1 个 Waker 参与"+⋯）
截图：g1-06-resources-wakerflow.png
证据等级：O1

步骤 ID：QW-12
入口 URL：/wakerflow/724a121a-38dd-49c3-86f2-55cde851be5d
可见结果：头部=返回/标题+重命名/视图 radio(WakerFlow|执行记录,切换即换路由)/添加触发方式/运行(禁点)；画布=阶段卡 阶段01 确认→阶段02 复核（卡内步骤节点带 Waker chip c78b37df31ae）+节点级"请输入调整内容"+缩放组；"输入参数" group[disabled]（"手动运行，需要填写以下信息："）；版本历史；显示模式 画布|脚本
截图：flow-01-detail-text-only-review.png
证据等级：O1

步骤 ID：QW-13（脚本视图）
可见结果：**DSL 全文**：export const meta={name,description,phases:[{title,detail}],outputSchema{type,required,properties}}；phase('确认')；const x=await worker('<prompt>',{label,phase,inputs:['起始点'],outputs:['确认文本'],resolve:{kind:'waker',wakerId:'c78b37df31ae'}})；模板串 ${acknowledgement} 传递上游输出；return {acknowledgement,review}；保存[disabled]
截图：flow-03-script-view.png
证据等级：O1
确认的事实：编排基本单位=phase()+worker()；worker 的 resolve 只见 kind='waker'（其他 kind 未见→EVIDENCE_GAP）；串行由代码顺序表达；并行/条件/聚合/循环/重试在 DSL 样本中**均未出现**（不能因按钮缺失即断言不支持，记 EVIDENCE_GAP）；outputSchema=结构化终态契约

步骤 ID：QW-14（执行记录）
入口 URL：/wakerflow/<uuid>/runs/faa34ee3-4264-403e-9767-4d807f4107ad
可见结果：画布按 run 渲染阶段状态（阶段01 失败红框/阶段02 未执行；每阶段"1 个执行节点"+节点状态图标）；右"运行记录"面板=第3次运行(手动/运行失败/55分钟前,selected)/第2次(已终止/9月5日12:55)/第1次(已完成/9月5日12:47)；每 run 行 2–3 个**无 aria/title/tooltip 图标按钮**（SVG 路径推断 I1：rotate-cw 系≈重跑、document 系≈报告；不点击）+"基于此次运行优化工作流"(aria 可证)
截图：flow-02-execution-records.png
证据等级：O1+O2（run 状态与看板"第 N 次运行"行互证）
确认的事实：run 级路由存在；阶段/节点级状态可见；attempt 概念未见（"第 N 次运行"=run 序号而非 attempt，I1）；父子执行/事件流未见独立视图 → EVIDENCE_GAP
**选择性重做：页面无任何可见入口**（仅无名图标存疑）→ 任务书红线："支持选择性重做"不成立，记 EVIDENCE_GAP+UNIDENTIFIED_CONTROL

步骤 ID：QW-15（版本历史/触发/对话面板/新建）
- 版本历史：complementary"历史版本"=版本1[当前版本] 9月5日12:46（flow-04）。版本化=整数 version；**回滚/发布/草稿 UI 未见** → EVIDENCE_GAP
- 触发弹窗"编辑触发方式"：文案"**一个 WakerFlow 只有一份自动运行配置，可添加多个触发方式**"；1/5；定时|API；定期|一次性；重复+下次运行预览；取消/保存（flow-05）
- 对话面板"对话编辑 WakerFlow"：生成会话(session 5db3188f-…)+深度思考块+工具 mcp__wake__workflow_get_script / mcp__wake__workflow_upsert 参数与响应全文+快捷方案(基于最近运行优化工作流/试运行=禁点)+composer（flow-07）。**upsert 响应=存储契约 O2**：{id,name,digest(64hex),meta{…,phases[],callSites[{callSiteIndex,primitive:'phase'|'worker',position{line,column},label}],outputSchema},scope{kind:'global'},version:1,generationSessionId,createdAt,updatedAt,script}→ 脚本为唯一事实源，画布由 callSites 投影；digest=脚本摘要；生成会话 id 回写定义
- 新建 /wakerflow/new：**对话式生成页**（欢迎语+3 示例 prompt+自由输入+Auto+发送[disabled]），无手工节点面板（flow-06）
证据等级：O1（各截图）+O2（upsert 契约）
必须回答（§4.5 区分三档）：页面明确证明=列表/详情/脚本 DSL/版本整数/run 级状态/触发 1 配置多方式/对话生成与编辑工具链；仅按钮推断=节点"请输入调整内容"(AI 局部调整, I1)、无名图标(重跑/报告, I1)；被副作用阻断=运行/试运行/保存/选择性重做/嵌套与环限制/工作空间传递（BLOCKED_BY_SIDE_EFFECT 或 EVIDENCE_GAP）

## §4.6 能力与资源

步骤 ID：QW-16（五页签）
- Skills /resources/skills：技能市场|我的技能；分类 listbox 带计数（全部分类 43648…）；市场卡=名+推荐+描述+作者+安装数；分页 2183 页（g1-05）。**市场制生态数据，我方已拍板不照搬**
- 连接器 /resources/connector（**单数 slug**）：连接器市场|我的连接器；11 分类 22 个；卡含 Waker 内置(全部 Waker 已安装)/浏览器/计算机控制/钉钉/企业微信/Linear/Notion/Supabase/Vercel/Neon/云效/Canva/墨刀/Todoist/PolarDB/高德/企查查/北大法宝/企百科/Proboost/华宇/今日投资；动作 打开/安装（g1-07b）
- 知识库 /resources/knowledge：范围=我创建的(1)/与我共享的(0)；卡=名+资料数+更新时间+"设置可使用该知识库的 Waker"+"1 个 Waker 使用"+分享+更多操作（g1-08）→ 知识库=共享资源+Waker 挂载绑定
- WakerFlow：见 §4.5
- 公开项目 /resources/projects：文案"添加本地目录或 Git 仓库作为工作上下文，发起任务时可直接选择。公开项目对当前账号下所有 Waker 可用；如需创建 Waker 项目，请前往对应 Waker 的管理页"+新建（空）（g1-09）→ Project/Workspace=本地目录或 Git 仓库；作用域两级=账号公开/Waker 私有
证据等级：O1
不能由此确认（§4.6.8/9/10）：删除/禁用被引用资源的可见约束、工具权限/危险级别/作用域/凭据边界、运行前 schema snapshot/健康检查/授权提示——均未在资源壳页面出现（Waker"权限"子页未开，记 EVIDENCE_GAP）
路由缺陷（O1，g1-07）：深链 /resources/connectors（复数错 slug）被重写为 …/skills×~150 且内容空白；子页签仅客户端点击可达

## 跨域事实与高危表象清单

1. **CoT 外露**：对话与 flow 生成会话均展示"深度思考"全文推理（tb-01/flow-07）→ 我方禁抄（任务书强制安全纠错第 1 条）
2. **Bash/Write 默认开放**：Waker 转录中 Bash(mkdir/npm install)、Write 直接执行，仅靠 prompt 自约束（tb-01）→ 我方须工作空间隔离+allowlist+审批
3. 工作空间=workers/<wakerShort>/workspace/<sidShort>_<MMDD>/ + 会话 _output/；present_files 为产物交付契约（目录不可作产物、非 git 仓不生成 codeChanges）
4. 用量=Credits 面板（团队版 2026-09-22 续期，2,718/3,000 已用 91%，资源包 0）；**设置**按钮两次 JS 点击无可观察面板 → EVIDENCE_GAP（附尝试记录）
5. Group：左轨"切换到 Group"点击后按钮变 [disabled]、列表无 Group 实体；管理页 Group 页签未开 → 部分证据
6. 模型信息：composer 与 flow 面板均有 Auto 选择器；状态条出现 Qwen 错峰折扣文案（模型市场/计价表象）

## G2 自检表

| 条件 | 结果 |
|---|---|
| 六类核心区域均有当前截图 | ✅ 看板 g1-01/tb-01；@Waker+对话 g1-02/tb-01；自主 g1-03/auto-01..03；Waker 管理 g1-04/waker-01..02；WakerFlow g1-06/flow-01..07；资源 g1-05/07b/08/09 |
| 截图人工/视觉检查（无空白/黑屏/遮挡） | ✅ 每张 emit 后目视；g1-07 为缺陷证据（空白内容区系产品 bug，非截图事故） |
| 关键表单上下半段 | ✅ auto-01+auto-02；flow-05 单屏完整 |
| 每核心对象 列表+详情/编辑 两视角 | ✅ 任务(列表+会话详情)/自动任务(列表+tr_详情)/Waker(列表+workspace)/Flow(列表+详情+runs)；⚠️ 知识库详情未开=EVIDENCE_GAP |
| 未以保存/运行/启停换证据 | ✅ 禁点清单：运行/试运行/保存×3/启用 switch/安装/发送/删除；无名图标不点 |
| 明确列出"页面证明不了的内容" | ✅ 见各节 EVIDENCE_GAP 与 §3 阻断清单（00 文件） |

## 页面证明不了的内容（汇总）

API 真实 schema（仅 atk_ URL 与 upsert 响应两隅）；target 是否 pin 发布版本（flow 引用 wakerId 为短 id，无 version 字段可见）；WakerFlow 内部状态机/attempt/父子事件；选择性重做；工作空间隔离实现；自动任务幂等/并发；Waker↔Flow 双向调用的治理（mount/pin/预算/环检测）；Flow 嵌套与最大深度；DSL 并行/条件/聚合/循环/重试支持度；版本回滚/发布/草稿；知识库详情；设置页；事件触发表单入口。
