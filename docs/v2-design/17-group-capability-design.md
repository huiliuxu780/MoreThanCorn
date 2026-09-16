# 17 号稿：Group 能力设计方案（前端 follow QoderWake，后端 = AgentScope Team 原生）

状态：DRAFT，待用户拍板 D1–D7 后进入 P0 原型闸门。

## 0. 结论先行与拍板翻覆记录

**一句话方案**：Group = 平台一等实体「多 Agent 群聊协作组」（1 名 Leader + 若干成员，用户建组时指定），前端逐字段复刻 QoderWake 已取证形态（侧栏「员工与群组」tablist / 管理页分段控件 / DS-011 创建弹窗），后端不重造协作机制——执行底座直接用 AgentScope 2.0.8 官方 Team 体系（teams 表 + TeamSay 消息路由 + inbox/wakeup + TeamMemberLoopMiddleware），平台侧新增**确定性装配**与**聚合流**两件事。

**显式翻覆记录**（按"翻先前拍板须显式说明成本"规约）：

| 被翻覆拍板 | 出处 | 翻覆成本 |
|---|---|---|
| 04-R6「Group（多 Waker 群组协作）= DEFER 不建」 | research/morethancorn/10-qoderwake-product-research/04-reference-to-mtc-mapping.md:29、EVIDENCE-INDEX.md:40 | 低：当时仅留了 `ChildInvocation.call_kind` 可枚举扩展位，未写任何 Group 代码 |
| 09-09 换底「Group 能力不引入、Group tablist 移除」 | src/components/app/app-sidebar.tsx:36 注释、12-cutover-frontend-research.md:23,41 | 低：前端只是删了 UI stub，恢复 tablist 即可；运行时侧官方 Team 工具族**从未被摘除**（tool_policy.py 仅预留 `"subagent"` 开关位） |
| 旧 `agent.type="expert-group"` 已封存（410） | legacy_agent_archive.py | 无冲突：旧专家组是"编排式伪多Agent"，本稿 Group 是群聊式真多 Agent，不复用旧实体、不解封旧类型 |

翻覆理由：用户 2026-09-15 明确指示基于 AgentScope team 能力建 Group；且 09-08 研究轮已确认官方 Team 四件套就装在我们已用的 PG（teams/sessions 表）+ Redis bus 上，"DEFER 因为底座没有"的前提已不成立。

## 1. 调研对齐（先行证据）

### 1.1 QoderWake Group 已取证事实（前端 follow 的基准）

来源：qoderawake0905/research/qoderwake/_completion_b/（DS-009/010/011 截图 + page-design-specs.md:29-43 + component-state-matrix.md:9,11）、_agent_a/product-map.md:10、_agent_c/api-observation.md:23。

1. **语义**：Group = 群聊。创建弹窗标题「创建群组」，首字段「群聊标题」（默认"新的群组"）。
2. **成员规则**：helper 文案「群聊可选择多个 Waker，并需指定一位 Leader。」——恰一位 Leader + 多成员。
3. **每成员独立配置**：响应模型 + 工作目录（右 pane：「请先选择一位 Waker，再配置其响应模型和工作目录。」）。
4. **入口三处**：① 全局侧栏 tablist「员工与群组」= `Waker(n) | Group(n)` 页签 + 下方虚线「新建 Waker/新建 Group」按钮 + 搜索 + 对象卡片列表（复刻参考代码 qoderawake0905/src/src/components/layout/GlobalSidebar.tsx:81-117）；② /management 页 `Waker | Group` 分段控件（同路由视图切换，无独立 /groups 路由被观察到）；③ 任务看板 Waker/Group 维度筛选（`GET /api/board/tasks?groupId=`）。
5. **创建弹窗（DS-011，证据最完整）**：宽 modal——标题输入（打开即聚焦、默认值全选、带清空）/ 左 pane 成员搜索+候选列表 / 右 pane 选中成员的依赖配置 / sticky 底栏（左「已配置 N 个 Waker」计数，右 取消+创建，**0 成员时创建 disabled**）。
6. **空态（DS-010）**：虚线圆角 icon tile（多人图标）+「暂无 Group」+「创建Group后，可以在这里集中管理Group。」+ 黑色主 CTA「新建 Group」；页头 CTA 随分段控件切换为「新建 Group」。

### 1.2 原站证据缺口——已于 09-15 活体补证闭合（用户自建真组「新的群组」）

补证台账：`docs/v2-design/prototypes/group-ui-measure-ledger-0915.md`（IAB 实测+CSS 规则族全量，只读无写操作）。新取证事实：

1. **群详情=会话页**，路由 `/conversations/groups/{gid}/conv_{cvid}`——Group 1:N 会话（会话=任务，任务面板列「任务 1」+时间+「暂无待关注结果」角标）。
2. **四栏布局**：侧栏240 | 任务面板240（群头像+名 / 分段「任务|群设置」/ 任务卡 / 新建）| 聊天列（560 内容宽居中）| 产物面板240（共享目录/暂无产物），两右栏带 resize 分隔条。
3. **消息流形态**：用户=右对齐气泡 #F9F9F9 圆8 + 时间戳+复制；成员回复=无气泡（24 头像+14/500 名+全 markdown 含表格/code/分隔线）+时间戳+复制。**谁回复显式署名**。
4. **输入区**：白壳圆8 边#E6E6E6 min-h120，placeholder「输入消息… 输入 @ 提及 Waker，Enter 发送，Shift+Enter 换行」，底栏 + 钮/圆形发送钮（空=灰/有字=黑）；CSS 存在 mention-chip（pill 混 primary 10%）但**活体输入 @ 未复现弹层（两次）→ 登记未复现，我方按承诺形态自研待签**。
5. **群设置面板三节**：群成员（32 圆头像 tile+**Leader 徽章**=9px/#636261/#EFEFEF 底白边 pill 压头像下缘+名截断；「+ 添加」）/ 群技能（ⓘ+添加；空=暂未配置）/ 成员协作 SOP（ⓘ+添加；行=icon+名）。
6. **Group SOP 域概念**（群聊内成员自述，产品口径）：持久化、带版本、不可变发布的群级协作规则文档（角色分工/交接/审批/执行顺序/完成标准），`sop init→validate→publish→group sop set` 绑定到群、每次 Run 注入成员系统上下文；与 Group Skill（群级知识）分立。**此为原站真实域概念，纳入 D8 拍板**。
7. **管理页卡交互**：双击卡名行内改名；⋯ 菜单=重命名/删除；卡 footer「创建对话任务」+⋯；虚线大 tile 312x127 居首格。
8. **创建弹窗全交互**：勾选行 mint 底 #F1FAF3（hover #E6F7EC）+绿勾 #8EE5A1+行内 Leader chip（白底）；首勾自动 Leader（其「设为 Leader」checked+disabled），多人后互斥可切；右 pane=成员卡+设为 Leader+响应模型（Auto select，helper 仅应用于当前 Waker）+工作目录（helper 可选 Project 或本地目录）；底栏计数+创建钮 **disabled=opacity .5+not-allowed**。

### 1.3 AgentScope 2.0.8 Team 能力（后端底座，全部已装好）

来源：runtimes/agentscope/.venv/.../agentscope（SP）实读。

| 能力 | 位置 | 对 Group 的用处 |
|---|---|---|
| Team 工具族 TeamCreate/AgentCreate/AgentInvite/TeamSay/TeamDelete | SP/app/_tool/ | TeamSay = 群内消息路由核心（to=None 广播 / to=名字 点对点），HintBlock `<team-message from=...>` 投递 |
| TeamRecord/TeamMember 存储 | SP/app/storage/_model/_team.py、_sql/_tables.py（teams 表 + sessions.team_id 提升列） | 团队花名册持久在我们已用的 wf_dev PG，**进程重启可恢复** |
| TeamMemberLoopMiddleware(max_nudges=3) | SP/app/middleware/_team_member_middleware.py | worker 回复必须以 TeamSay 结束，防哑成员；无团队级总轮次器（平台侧补预算，见 §6.4） |
| InboxMiddleware + MessageBus(Redis db4) + WakeupDispatcher | SP/app/middleware/_inbox_middleware.py、SP/app/_bus_ops.py | 成员被 TeamSay 唤醒异步执行；leader 等汇报（官方 description 禁止 leader 轮询） |
| ChatService 团队上下文 _LeaderContext/_WorkerContext | SP/app/_service/_chat.py ~L780-880 | leader/worker 装配差异官方已做 |
| TeamDetailResponse(team+leader+members[agent,session_id]) | SP/app/_router/_schema/_session.py | 官方明言"供 UI 订阅 worker 流"——聚合流设计有官方背书 |
| SubAgentTemplate + create_app(custom_subagent_templates=) | SP/app/_types.py、_app.py:78-96 | 成员人设/权限模板扩展点（P3 备用） |
| 我方 tool_policy.py `"subagent"` 开关 | runtimes/agentscope/app/tool_policy.py | 现成的角色门禁位：leader 留 TeamSay、成员留 TeamSay、摘 AgentCreate/TeamCreate/TeamDelete（装配权收归平台，见 D1） |

已知风险两处（16 号稿 §17 已登记）：并发 `_new_session` 挂死（script_runner 现以 Semaphore(1) 串行化）→ 本稿装配一律串行；askUser waiting 态不持久（内存 Future）→ Group MVP 不引入 askUser 类 HITL，成员 HITL 走官方 permission 审批通道（ApprovalCard 已有）。

### 1.4 我方挂接点（盘点结论）

迁移 head=g061 → 新迁移 `g062group0001`；模型集中 server/app/models.py；API 惯例 `/api/v2/<resource>` 独立 router；成员绑定解析直接复用 `agent_execution.resolve_runtime_agent`（prod active release 冻结快照，禁跨环境降级）与 agentflow_executor.build_script_body 同款 fail-fast；会话索引复用 `agent_session_index`（trigger_kind 扩词表）；执行域 Spec「一触发一 Invocation 一顶层执行体」→ Group 会话若成为触发目标即第四种执行体（P3，见 D4）。

## 2. 目标与非目标

**目标**：① Group 一等实体（定义/成员/Leader/每成员配置/归档）；② 群聊会话闭环——用户发消息进群 → Leader 拆解派活（TeamSay）→ 成员各自 session 异步执行并汇报 → Leader 汇总回复用户，全程 UI 可见每个成员的流；③ 前端逐字段复刻 §1.1 六个已取证形态；④ 与既有 Agent 生命周期治理对齐（发布冻结、归档闸门、权限 key）。

**非目标**（本期不做，防范围蔓延）：Group 作为 automation/触发目标（P3，D4）；成员级"工作目录"真实沙箱目录映射（我方 workspace=per-session 沙箱，无用户级目录概念，D3）；Group 级 NL 生成编排脚本（那是 AgentFlow 的事）；跨 Group 协作；原站「群聊答疑专员」IM 渠道打通（我方无 IM 渠道域）。

**Group 与 AgentFlow 的边界**（防止两套多 Agent 打架）：Group = **会话式、长存、人在环**的多 Agent 协作（用户随时发言，Leader 自主分工）；AgentFlow = **脚本/DAG 式、一次性、无人值守**的确定性编排（kind=script，waker 绑定预解析）。两者共用 Agent 实体与 release 冻结绑定，互不嵌套（Group 内 Leader 如需确定性流程，可经既有 `run_agent_flow` 平台工具调 AgentFlow——已实现，零新增代码）。

## 3. 领域模型与存储（g062group0001）

```
agent_group                     -- 组定义（真源在平台 PG）
  id str32 PK / name ≤20字 (ck) / description text?     -- description 注入 Leader 群聊上下文
  leader_agent_id FK agent      -- 恰一位（ck: 必须 ∈ 成员，应用层校验）
  avatar / archived bool / revision int / created_at / updated_at

agent_group_member
  id PK / group_id FK / agent_id FK / role ('leader'|'member')
  config JSONB                  -- {"chat_model_config": {...}?, "knowledge_ids": [...]?}  每成员覆盖
  uq(group_id, agent_id) / ck(role in ...) / 成员数上限应用层校验（建议 ≤5，D5）

agent_group_session             -- 一次群聊会话（= 一个 AgentScope team 实例；原站语义=「任务/对话」，1 组 N 会话）
  id PK / group_id FK / status ('active'|'closed'|'failed')
  title text?                   -- 原站任务卡显示「任务 N」+时间；我方可默认序号+首问摘要
  leader_session_id             -- AgentScope leader session（teams.session_id 同值）
  runtime_team_id               -- AgentScope TeamRecord id
  binding_snapshot JSONB        -- 开聊时冻结：{agent_id: {runtime_agent_id, frozen_model_id/params, knowledge_ids}}
  closed_at / created_at

agent_group_session_member      -- 成员会话映射（聚合流与投影用）
  id PK / group_session_id FK / agent_id / session_id / uq(group_session_id, agent_id)

-- D8 拍板项（原站 Group SOP / 群技能域概念，见 §1.2-5/6）：
agent_group_skill               -- 群级技能挂载（复用 skill 实体，P2 候选）: group_id/skill_id/uq
agent_group_sop                 -- 群协作规则：group_id/name/content md/revision/status(draft|published)/published_at
                                  -- 不可变发布语义=published 行只读、改=新 revision 行；绑定=group.sop_id 原子替换
```

复用不新建：`agent_session_index` 扩 trigger_kind 词表 `group`（leader 与成员 session 各一行，反链 group_session_id 经新列或 conversation_key 约定——实现时取新列 `group_session_id`，同 g049 五表一次建）；运行状态投影不建第二套（board/work_item 投影 P3 接入时按既有 work_item_projection 扩）。

**生命周期**：Group 定义（草稿即可用，无独立发布链——成员的发布状态各自经 release 冻结保证）→ 开聊（装配，§4）→ 会话长存可续聊（state 在 AgentScope sessions 表，重启可恢复）→ 关聊（best-effort 解散 runtime team）→ Group 归档（archived=True，禁止开新会话；归档前跑引用闸门）。

## 4. 运行时装配（后端核心，确定性优先）

**D1 推荐：平台侧确定性装配，不让 Leader 运行时自主建团。** 官方 AgentCreate 是"LLM 自助拉人"，建团结果不确定、成员不可控；QoderWake 语义是用户建组时定死成员。装配步骤（新增 runtime 端点 `POST /mtc/group-session`，串行执行规避并发建 session 挂死）：

1. 平台校验：全员 prod active release 存在且未归档 → `resolve_runtime_agent` 解析冻结绑定 → 写 `binding_snapshot`（缺绑定 fail-fast，同 build_script_body 惯例）。
2. runtime 侧：为 leader 建 session（挂 leader 的 runtime_agent_id）+ internal_auth.register → **直接经官方 storage API 写 TeamRecord**（name=组名，**members=仅 worker role="invited"；leader 经 TeamRecord.session_id/leader_agent_id 标识（官方形态）**）→ leader 与逐成员 session 均 `set_session_team_id`（leader 缺此步则 _LeaderContext 不成立）+ 成员 internal_auth.register → 成员 AgentRecord 复用 release 物化的 runtime agent（invited 语义保证解散时不删本体）。
3. 角色门禁（tool_policy.py `"subagent"` 族细化）：**leader 与成员都只保留 TeamSay；摘除 AgentCreate/AgentInvite/TeamCreate/TeamDelete**——团队组成是平台事实，不容 LLM 改写。Leader 系统提示注入群聊花名册（成员名+description+「用 TeamSay 派活，等成员汇报后向用户总结」）；官方 _LeaderContext/_WorkerContext + TeamMemberLoopMiddleware 照常生效。
4. 用户消息 → `ChatService.run(leader_session)`；成员经 inbox+wakeup 异步跑，汇报回 leader inbox，leader 被唤醒汇总。

**聚合流**：平台新端点 `GET /api/v2/groups/{gid}/sessions/{gsid}/stream`（SSE）——服务端并发订阅 leader + N 成员共 N+1 路运行时流（官方 TeamDetailResponse 明言此用途），逐事件加 `source: {agent_id, name, role}` 标签合流转发；前端单连接渲染。断线重连沿用 chat-stream.ts 按事件 id 去重惯例。静默原地 reconcile（禁每事件 toast/重置，09-06 用户打回教训）。

## 5. API（/api/v2/groups，新 router server/app/routers/as_groups.py）

| 端点 | 说明 |
|---|---|
| GET/POST `/api/v2/groups` | 列表（含成员计数/Leader 名/archived 筛选）/ 创建（name+leader+members+每成员 config，0 成员服务端 422 对齐前端 disabled） |
| GET/PATCH/DELETE `/api/v2/groups/{gid}` | 详情 / 改名（管理页卡**双击卡名**或 **⋯→重命名** 均弹重命名小弹窗：w384 圆12 内衬24、input 圆6 边#DDD、保存=有改动才启用 opacity .5 禁用——台账 §2；原站弹窗文案「重命名对话」系复用对话组件的文案债，我方用「重命名群组」已登记台账 §5-6）/描述/成员/Leader/成员 config（revision 乐观锁）/ 删除（⋯ 菜单=重命名/删除，与原站一致；有会话的组删除=归档语义） |
| POST `/api/v2/groups/{gid}/archive`、`/restore` | 归档闸门：组归档→拒新会话；**Agent 归档侧反向扩**：agent 作为在用 group 成员/Leader 时归档 → 返回引用清单（补 agent-archive-gap 的执行面闸门，同提案模式） |
| POST `/api/v2/groups/{gid}/sessions` | 开聊（装配 §4）；同组已有 active 会话 → 409 或续用（D2） |
| GET `/api/v2/groups/{gid}/sessions`、GET `/{gsid}` | 会话列表/详情（含成员 session 映射） |
| POST `/{gsid}/turns` | 用户发言（转 leader session turn） |
| GET `/{gsid}/stream` | 聚合 SSE（§4） |
| POST `/{gsid}/interrupt`、`/confirm` | 中断 / 成员 HITL 审批透传（复用 as_agents 既有 confirm 通道语义） |
| DELETE `/{gsid}` | 关聊（解散 runtime team，best-effort + 状态落库） |

权限：服务端角色制现状（require_role）；前端 rbac.ts Permission 联合增点分单数 key `group.view`/`group.manage`（**permission_seed.py 是 Agent 执行工具防护策略解析器，非 RBAC 种子，勿用**——v1 审查 P0#2）。内部令牌：group session 的 leader/成员 session 照常注册 internal token（P0-08 机制复用），`/api/internal/agent-tools/*` 对 group 成员会话同样可用（成员可跑 workflow/agentflow 工具——零新增）。

## 6. 前端（follow QoderWake，文案用我方词：Waker→Agent，先例=任务看板拍板）

### 6.1 已取证形态——逐字段复刻

1. **侧栏「员工与群组」tablist**（恢复 09-09 移除项）：展开态（240px）导航下方，`Agent（n）| Group（n）` 页签（下划线选中态）+ 虚线「新建 Agent/新建 Group」按钮随页签切换 + 搜索 + 对象卡片列表（头像+名+desc 两行截断）；折叠态（64px）隐藏 tablist（我方壳可折叠是原站没有的形态，D6）。参考代码 GlobalSidebar.tsx:81-117 移植进 app-sidebar.tsx。
2. **/agents 管理页分段控件**：页头 `Agent | Group` segmented control（对应原站 /management，我方无独立 /management 路由，落点在 /agents）；Group 视图：卡片列表 / 空态逐元素复刻 DS-010（虚线多人 icon tile+「暂无 Group」+「创建Group后，可以在这里集中管理Group。」+黑 CTA「新建 Group」），页头 CTA 随页签切换。
3. **创建弹窗复刻 DS-011**：宽 modal；「群聊标题」默认"新的群组"全选+清空按钮；左 pane「搜索 Agent」+候选列表+helper「群聊可选择多个 Agent，并需指定一位 Leader。」+每行 Leader 单选标记；右 pane 选中成员后配置（字段按 D3 拍板结果：响应模型 + 知识挂载，或保留"工作目录"形）；sticky 底栏「已配置 N 个 Agent」+取消/创建（0 成员 disabled）。候选列表只列**已发布且未归档**的 Agent（我方约束，原站无此信息——标注为诚实差异）。
4. **Group 路由**：照抄原站 `/conversations/groups/{gid}/conv_{cvid}`（群详情=会话页，会话 id 入路由）；群级入口另保留 `/groups/{gid}` 重定向到最新 active 会话（原站侧栏群卡直达会话页）。原站管理页同路由切视图，我方 /agents 分段同此。

### 6.2 群聊页与群设置（09-15 已活体取证，逐值复刻，台账 §4）

**群聊页四栏**：侧栏240 / 任务面板240 / 聊天列（内容 560 居中，padding 12 32 16）/ 产物面板240（border-left #E6E6E6）。任务面板=群头像簇+群名 14/500 → 分段「任务|群设置」（compact 变体：容器 h36 #EDEDED 圆6 内衬4，tab h28 12/500，白 pill=滑动 indicator 带 transition）→「N 个任务」+「+ 新建」→ 任务卡 h56（选中 #EFEFEF）→ resize 分隔条。群设置 tab 三节照抄：群成员（32 头像 tile+Leader 徽章 9px pill+名截断+「+ 添加」12/500）/ 群技能（ⓘ+添加+「暂未配置」空态）/ 成员协作 SOP（ⓘ+添加+行 h28）。
**消息流**：用户右对齐气泡 #F9F9F9 圆8 padding12 fs13 **lh1.65**（台账:71 实测；v1 稿 lh20 系笔误已纠） + 时间戳 12 #838280 + 复制钮；成员回复无气泡=24 圆头像+名 14/500+markdown 全量（h/p/ul/table/code/hr）+时间戳+复制。
**输入区**：shell 白 圆8 边#E6E6E6 min-h120 padding 12 12 0 + composer shadow；编辑器 fs13 占位符照抄（@提及承诺）；底栏 + 钮+圆发送钮（空灰/有字黑 #080807）。
**唯一自研区**：@提及弹层（原站 CSS 有 mention-chip、活体未复现弹层）——按 placeholder 承诺+我方标准 Popover 自研，P0 原型已含占位形态，交签时标注。

### 6.3 P0 原型（已产出，待签字）

`docs/v2-design/prototypes/group-v1.html`（本地 http://127.0.0.1:8899/group-v1.html，三屏真交互）：屏A 侧栏 Group 态+管理页（分段滑动/⋯菜单=重命名删除/虚线 tile/卡 hover）；屏B 创建弹窗（勾选 mint 行联动 Leader chip+右 pane 配置+计数+创建钮 disabled opacity.5）；屏C 群聊页（任务/群设置分段滑动+成员 Leader 徽章+消息流+composer 发送钮态）。逐值出处=台账；对账表=台账 §5 差异登记（5 条，含 hover 底色采 CSS 之理由与 @弹层未复现）。

## 7. 决策点（待用户拍板）

- **D1 装配模式**：推荐**平台确定性装配**（§4，成员可控、LLM 无建团权）；备选=官方 leader 自主 AgentCreate/AgentInvite（更"原生"但成员不确定，违背原站"用户选成员"语义）。
- **D2 会话模型**：推荐**一组一长存会话**（active 唯一，续聊=同 team；可手动关聊后重开新 team）；备选=每次开聊新建会话（历史多份，UI 复杂）。
- **D3 成员"工作目录"字段**：原站每成员配{响应模型,工作目录}；我方 workspace=per-session 沙箱，**无用户级工作目录对应物**。推荐：配置 pane 改为{响应模型, 知识挂载}（诚实映射，弹窗保留双字段布局形）；备选 a=保留"工作目录"输入但仅作为注入提示词的文本（形似而神不似，不推荐）；备选 b=D7 活体补证后再定。
- **D4 触发面**：推荐 **P3 后置**——Group 先做人在环群聊；成为 automation target_kind 第四执行体+看板 groupId 筛选随后（须过执行域 Spec 增补，一触发一 Invocation 不变）。
- **D5 成员数**：推荐**含 Leader 共 1..5**（聚合流路数=成员数；唤醒风暴工程上界；原站无证据）。
- **D6 侧栏形态**：tablist 仅展开态显示、折叠态隐藏（我方壳可折叠为原站所无）；群详情路由照抄原站会话路由（§6.1-4）。
- **D7 活体补证**：~~是否允许写操作补证~~ **已闭合**——用户 09-15 自建真组，本稿 §1.2 全部补证事实来自该组只读观察，无需再写原站。
- **D8 群技能与成员协作 SOP 的期次**：原站群设置含「群技能」（群级 skill 挂载）与「成员协作 SOP」（版本化不可变发布、绑定注入成员上下文的协作规则文档）两节。推荐：**群技能 P2**（复用既有 skill 实体+agent_skill 模式加 group 挂载面，UI 三节照抄含空态）；**SOP P3**（新实体 agent_group_sop，不可变发布语义=published 行只读+revision 递增，注入点=装配时拼进 leader/成员系统提示——与 AgentScope SubAgentTemplate/system_prompt 注入路径天然吻合）；备选=两节都 P3 后置（UI 先留空态壳）。

## 8. 实施切片（每片门禁全绿+证据，节奏用户控制）

- **P0 原型**：§6.3 四屏 HTML 原型 + 复刻/自研对账表 → 用户签字（闸门）。
- **P1 后端实体**：g062 迁移 + models + as_groups CRUD/校验/归档闸门 + pytest + 审计脚本口径（层1 假控件/层2 契约）+ **runtime probe**（probes/p1x_team.py：leader+2 invited 成员真 LLM TeamSay 往返、串行装配、重启恢复、TeamDelete 级联——P1 验收前置，仿 13 号稿 probe 惯例）。
- **P2 群聊闭环**：/mtc/group-session 装配端点 + tool_policy 细化 + 聚合 SSE + 前端群聊页 + 侧栏 tablist + 管理页分段 + 创建弹窗 → 活体 E2E（真 LLM 三人组冒烟，仿五一流 live 验证惯例）+ 截图交签。
- **P3 治理与触发面**：automation target_kind=group + Invocation/trigger_kind 词表 + 看板 groupId 筛选投影 + 成员 SubAgentTemplate 定制（如需）。

## 9. 验收标准

1. 复刻对账：以 `prototypes/group-ui-measure-ledger-0915.md` 为逐值基准（活体 getComputedStyle+CSS 规则族），P2 交付时跑逐控件比对脚本（原型→实现同选择器取值 diff ≤ 容差 0），差异仅剩文案 Waker→Agent 与 D3/D6/D8 拍板结果；台账 §5 五条差异登记逐条复核。
1b. P0 原型 `prototypes/group-v1.html` 三屏交用户肉眼签字后方可进 P1（prototype-before-dev 闸门）；@提及弹层为唯一自研交互区，签字时单独标注。
2. 活体链证据：创建一个 3 Agent 组（1 Leader+2 成员）→ 群聊发问 → 证据含：成员各自 session 真实执行（sessions 表+流事件）、TeamSay 消息在 leader 上下文可见（state 落 PG）、聚合流单连接渲染三源、重启 8301 后会话可恢复续聊。
3. 负向：0 成员创建 422/前端 disabled；未发布 Agent 不入候选；归档组成员的 Agent 归档被引用闸门拦截；摘除的 team 工具（AgentCreate 等）在 leader/成员 toolkit 中确实不存在（manifest 断言）。
4. 门禁：gate.sh 全绿（tsc/eslint/vitest/build/pytest/层1层2/迁移单 head g062/无泄密）+ 新增 pytest 覆盖 CRUD/装配校验/闸门。
5. 诚实差距表随验收文档交付（N/A 项、与原站差异项逐条）。

## 10. 执行前五查（四维自检+）

1. **疏漏**：原站 Group 运行记录无证据 → 我方以会话历史+成员 session 索引覆盖，不单建"运行记录"页（P3 看板投影即运行视图）。
2. **逻辑冲突**：与执行域 Spec「一触发一 Invocation」无冲突（P2 前 Group 仅手动开聊，不产生 Invocation；P3 接入时按第四执行体增补 Spec）。与 09-09 拍板冲突已在 §0 显式翻覆。
3. **漏功能点**：成员 HITL（permission 审批）走既有 ApprovalCard+confirm 通道，已在 §5 列；群内 @提及原站无证据 → MVP 不做（用户只对群发言，Leader 负责分工），列入诚实差距表。
4. **验证点稳固**：§9.2 行为断言含 state 落库+重启恢复+工具摘除 manifest 断言，负向四条，对照组=单 Agent 会话不受影响（回归既有 chat E2E）。
5. **复用**：resolve_runtime_agent/binding fail-fast/chat-stream reducer/beUI 组件/internal token/tool_policy 开关位/归档闸门模式全部复用，新增面=2 表组+1 router+1 runtime 端点+聚合流+4 屏前端。
6. **调研冲突**：1.3 已确认 2.0.8 无 msghub/pipeline 同步原语——本稿不依赖任何 1.x 概念；"误把 team 异步机制当同步群聊"（04 号映射文档警告）已规避：UI 明示成员异步执行态（roster 运行态点+汇报折叠卡），不伪装成同步轮流发言。
7. **北极星用户故事**：用户把"质检 Agent + 业务分析 Agent + 工单 Agent"拉一个群，问"上周 CORN 短信投诉集中在哪，给我建单跟进"——Leader 派活、成员各自跑真实工具、Leader 汇总，全程一屏可见。

## 11. 风险

| 风险 | 缓解 |
|---|---|
| 并发建 session 挂死（16 号稿已知） | 装配严格串行；P1 probe 实测 3 成员装配 |
| team 运行期多成员同时被唤醒的并发行为未实测 | probe 含广播唤醒场景；成员上限 ≤5；异常时 tool_policy 一键摘 `"subagent"` 族降级 |
| 无团队级总轮次器 → Leader 反复派活烧预算 | 平台侧 group 会话预算（turn 数/token 上限沿用 frozen_exec_timeout+新增 max_team_turns，超限 interrupt+提示），P2 落地 |
| 官方 teams 表 schema 随 agentscope 升级漂移 | 装配只经官方 storage API（不裸写 SQL）；probe 纳入 gate --live |
| 原站缺口区自研形态被否 | P0 原型闸门先签字后开发；D7 补证选项保留 |
