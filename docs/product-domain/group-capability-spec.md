# MoreThanCorn Group（多 Agent 群聊协作组）能力 Spec

版本：v1.1（2026-09-15；v1.0 经独立审查 4 P0+10 P1 全修，审查报告见 §9）
状态：**APPROVED 开工**——用户 09-15 原型三屏签字+「开始」开工令；D1–D11 按各条推荐值执行（个别项 P2 签字前可翻，翻覆须显式登记）。
上位文档：docs/v2-design/17-group-capability-design.md（设计稿，本 Spec 为其契约化；冲突以本 Spec 为准）
测量基准：docs/v2-design/prototypes/group-ui-measure-ledger-0915.md（前端逐值唯一真源；本 Spec §5.6 补值表为其扩展）
原型：docs/v2-design/prototypes/group-v1.html（P0 闸门件，三屏真交互）

## 0. 决策摘要

| # | 决策 | 状态 | 结论/推荐 |
|---|---|---|---|
| D1 | 运行时装配模式 | 待拍板 | 平台确定性装配（§4.2）：平台直写官方 TeamRecord（**members 仅 worker，leader 经 TeamRecord.session_id/leader_agent_id 标识，官方形态**）+ 全员 session 绑 team_id；摘除 LLM 建团四工具（AgentCreate/AgentInvite/TeamCreate/TeamDelete），leader/worker 仅留 TeamSay；group 会话 manifest 缺失 fail-closed |
| D2 | 会话模型 | 待拍板 | 一组 N 会话（会话=原站「任务」UI 文案）；**POST sessions 遇 active 一律 409 ACTIVE_SESSION_EXISTS**（前端引导续聊或先关聊）；关聊=标 closed 不解散 runtime（保 transcript，§4.1 DELETE） |
| D3 | 成员「工作目录」字段 | 待拍板 | 配置 pane 改 {响应模型, 知识挂载}；不装假字段 |
| D4 | Group 进 automation 触发面 | **已落地（09-16 P3）** | g065 group_id + g066 ck 复合约束扩 group 分支；dispatch 第四执行体（reuse active 会话）+leader chat_trigger；board group 维度+前端筛选；「一触发一 Invocation」不变、不套 TaskRun |
| D5 | 成员数 | 待拍板 | **members 含 Leader 共 1..5，其中恰一位 role=leader**（聚合流路数=成员数） |
| D6 | 侧栏 tablist 折叠态 | 待拍板 | 仅展开态（240）显示；折叠轨隐藏 |
| D7 | 活体补证 | **已闭合** | 用户 09-15 自建真组只读补证完毕 |
| D8 | 群技能 / 成员协作 SOP 期次 | **已落地（09-16 提前）** | g063 群技能挂载+agent_group_sop 不可变发布+绑定指针；装配注入 workspace/SOP System；UI 三节真接线 |
| D9 | @提及弹层 | 待拍板 | 自研入 P2（原站 placeholder 承诺+CSS mention-chip 存在、活体弹层未复现）；**翻覆设计稿 §10-3「MVP 不做」旧句**（该句与设计稿 §6.2 自相矛盾，以本行为准） |
| D10 | Group 域色彩 token | 待拍板 | 原站 mint 值入**作用域 token**（`--group-*`），不动全局 --primary/--brand-primary（#2F7D4B/#76D596）；群域与全站品牌色并存登记为已知视觉差异 |
| D11 | DM Sans 字体 | 待拍板 | 自托管 woff2 引入（OFL 开源）；不引入则回落系统栈并登记差异 |

翻覆记录：显式翻覆 04-R6「Group=DEFER」、09-09「Group 能力不引入/tablist 移除」（app-sidebar.tsx:36 注释）、设计稿 §10-3「@提及 MVP 不做」三笔；成本均低（无既有 Group 代码；官方 Team 底座已就绪）。

## 1. 背景与依据

### 1.1 问题陈述
平台现有两条多 Agent 路径：AgentFlow（脚本/DAG、一次性、无人值守）与 agent_tool 反触。缺一条**会话式、长存、人在环**的多 Agent 协作面。QoderWake 原站该面=Group（群聊），09-15 活体全量取证（含用户自建真组）。

### 1.2 目标与非目标
目标：Group 一等实体（定义/成员/Leader/每成员配置/归档）；群聊会话闭环（用户发言→Leader 派活→成员异步执行汇报→Leader 汇总，全程 UI 署名可见）；前端逐值复刻（台账+§5.6 补值表为真源）；与 Agent 生命周期治理对齐。
非目标：IM 渠道打通；Group 内 NL 编排脚本（属 AgentFlow）；跨 Group 协作。

### 1.3 依据（证据链）
- 原站形态：台账 §1–§4（IAB getComputedStyle 实测+原站 stylesheet 规则族原文）。
- 运行时底座：AgentScope 2.0.8 实读——Team 工具族（SP/app/_tool/）、TeamRecord/teams 表+sessions.team_id（SP/app/storage/_sql/_tables.py:210,168）、TeamMemberLoopMiddleware(max_nudges=3)、InboxMiddleware+MessageBus(Redis db4)+WakeupDispatcher、TeamDetailResponse（官方注"so the UI can subscribe to the worker's chat"）、storage base upsert_team/set_session_team_id（SP/app/storage/_base.py:806,407）；我方 main.py create_app 默认挂载、tool_policy.py `"subagent"` 键=五工具元组。
- 平台挂接点：迁移 head=g061pollhealth0001（单 head 实算）→ g062group0001；models.py 单文件惯例（ck_agent_name_len ≤20 先例）；/api/v2/<resource> router 惯例；resolve_runtime_agent(db,user_id,agent,*,environment) 禁跨环境降级（agent_execution.py:526-560）；agent_session_index（trigger_kind 词表为注释级，无 DB ck）；角色制鉴权 require_role（auth.py:134-152）+ 前端 rbac.ts 点分单数 key。
- 并发挂死先例：script_runner.py:56-59 `_WORKER_GATE=Semaphore(1)` 代码注释（P5 冒烟实证并发 _new_session 挂死）——装配串行依据。

### 1.4 边界：Group ≠ 相邻概念
| 概念 | 关系 |
|---|---|
| AgentFlow（kind=script/DAG） | 并列不嵌套；Group 内 Leader 可经既有 run_agent_flow 平台工具调用（零新增；前提 leader session 注册 internal token，§4.2④） |
| 旧 agent.type=expert-group | 已封存 410（legacy_agent_archive.py:21-30），不复用不解封 |
| AgentScope TeamRecord | 运行时实例；平台 agent_group 为定义真源；TeamRecord.members 仅 worker（官方形态），LLM 无建团/解散权（D1） |
| Workflow | 无关 |

## 2. 领域词汇

- **Group / 群**：多 Agent 群聊协作组定义实体；成员（含 Leader）1..5，恰一位 Leader（D5）。
- **群会话（UI 文案「任务」）**：Group 的一次群聊实例=一个 AgentScope team；路由 conv_{id}；领域层一律称群会话。
- **Leader**：对用户发言负责、经 TeamSay 派活与汇总的成员；创建时指定、可切换（互斥单选）。
- **成员配置**：每成员 {响应模型覆盖, 知识挂载}（D3）；开聊冻结进 binding_snapshot。
- **群技能**：群级 skill 挂载（D8-P2）。**成员协作 SOP**：版本化不可变发布群协作规则文档，绑定后注入成员系统上下文（D8-P3）。
- 禁止混用：Group≠AgentFlow≠expert-group；「任务」仅 UI 文案。

## 3. 领域模型与不变量

### 3.1 实体
**g062group0001（P1，只建以下四表+索引列；skill/sop 迁移随切片走 g063/g064，验收口径=单 head 当期迁移）**；models.py 惯例：str32 id/JSONB/created_at/updated_at/archived/显式 revision/ck_*/uq_*。

```
agent_group: id, name(ck ≤20字), description?, leader_agent_id, avatar?,
             archived bool, revision int, created_at, updated_at
agent_group_member: id, group_id FK, agent_id FK, role ck('leader','member'),
             config JSONB {chat_model_config?, knowledge_ids?},
             uq(group_id, agent_id)
agent_group_session: id, group_id FK, title?, status ck('active','closed','failed'),
             leader_session_id, runtime_team_id, binding_snapshot JSONB,
             closed_at?, created_at
agent_group_session_member: id, group_session_id FK, agent_id, session_id,
             uq(group_session_id, agent_id)
agent_session_index: 增列 group_session_id FK?（非空仅 trigger_kind='group' 行）；
             trigger_kind 注释词表增 'group'（注释级，无 DB ck）
-- g063(P2): agent_group_skill(group_id, skill_id, uq)
-- g064(P3): agent_group_sop(id, group_id, name, content_md, revision,
             status ck('draft','published'), published_at?)；published 行只读、改=新 revision、群绑定指针原子替换
```

### 3.2 不变量（门禁断言源）
1. **Leader 唯一且 ∈ 成员**：leader_agent_id 与 role='leader' 成员行一致且恰一条（事务校验+pytest）。
2. **成员数（含 Leader）1..5**（D5）：创建/编辑超限 422。
3. **发布冻结**：开聊时全员须 prod active release 且未归档（resolve_runtime_agent(environment="prod")）；缺绑定 fail-fast 422；binding_snapshot 落库后会话内不重解析。
4. **团队组成平台所有 + fail-closed**：leader/worker toolkit 摘除建团四工具、留 TeamSay；**group 会话 manifest 拉取失败=默认 deny subagent 族**（非 group 会话维持 tool_policy 现状 fail-open）；manifest 断言四工具不存在于群会话任一成员。
5. **装配串行**：/mtc/group-session 内 session 创建严格顺序（依据 script_runner.py:56-59 先例）。
6. **解散安全**：关聊（DELETE session）**不调 delete_team**（保 transcript，§4.1）；Group 删除/归档清理路径调官方 SessionService.delete_team 时 members 仅 worker（invited），leader session 官方语义不删→平台侧另行关闭 leader session 并标 closed；任何级联不删平台 Agent 本体与 runtime AgentRecord。
7. **归档双向闸门**：Group 归档→拒新开聊 409；Agent 归档时若为在用 Group 成员/Leader→409+引用清单（闸门模式同 legacy_agent_archive.collect_archive_plan 之引用清点）。
8. **一触发一 Invocation 不变**：P3 前 Group 不作 automation target；接入按执行域 Spec 增补第四执行体。
9. **会话可恢复**：team 花名册在官方 teams 表（wf_dev PG）；8301 重启后 active 群会话可续（probe 断言）。
10. **预算上界**：max_team_turns+frozen_exec_timeout 复用；超限 interrupt+提示（P2）。
11. **closed 会话只读**：closed/failed 会话拒 turns（409）；stream 可重放（session 未删）；任务面板列 closed 任务=只读查看。

## 4. 后端契约

### 4.1 API（server/app/routers/as_groups.py，prefix /api/v2/groups；鉴权=角色制 Depends(require_role(...)) 现状惯例；前端 key=group.view/group.manage 入 rbac.ts Permission 联合+VIEW_PERMS/MANAGE_PERMS，**不涉 permission_seed.py**——该文件是 Agent 执行工具防护策略解析器，非 RBAC 种子）

| 方法 路径 | 语义 | 错误 |
|---|---|---|
| GET / | 列表：成员计数/Leader 名/archived 筛选/分页 | |
| POST / | 创建 {name, leader_agent_id, members:[{agent_id, config?}]}（members 含 leader 行）；0 成员/Leader∉members/超 5 → 422 | 422 |
| GET /{gid} | 详情（成员+config） | 404 |
| PATCH /{gid} | 改名/描述/成员/Leader/成员 config；revision 乐观锁；**成员/Leader 变更仅允许无 active 会话**（binding 冻结） | 409 REVISION_CONFLICT / 409 ROSTER_FROZEN / 422 |
| DELETE /{gid} | 无会话=真删；有会话=归档语义（⋯「删除」同源） | |
| POST /{gid}/archive、/restore | 归档闸门（不变量 7）；**archive 遇 active 会话 409 ACTIVE_SESSION_EXISTS**（先关聊） | 409 |
| GET /{gid}/sessions | 群会话列表（UI 任务列表，含 closed 只读） | |
| POST /{gid}/sessions | 开聊=装配（§4.2）；**已有 active→409 ACTIVE_SESSION_EXISTS**（D2 拍死） | 409/422 |
| GET /{gid}/sessions/{gsid} | 详情（成员 session 映射） | 404 |
| POST /{gid}/sessions/{gsid}/turns | 用户发言→leader session turn | 409(closed) |
| GET /{gid}/sessions/{gsid}/stream | 聚合 SSE（§4.3） | |
| POST /{gid}/sessions/{gsid}/confirm | 成员 HITL 审批：body 含 **agent_id** 定位成员 session（as_agents confirm 语义按 session 扫描 pending tool_call） | 404/409 |
| POST /{gid}/sessions/{gsid}/interrupt | body {scope:'leader'\|'all'} 默认 all=广播中断全员 | |
| DELETE /{gid}/sessions/{gsid} | 关聊：status=closed+拒新 turns；**不解散 runtime team**（不变量 6/11，transcript 保真） | 409(已 closed) |

改名交互（管理卡双击名 / ⋯→重命名 双入口）= PATCH {name}；弹窗保存启用=trim 非空且 ≠ 现名（前端），服务端再校 ck。

### 4.2 运行时装配（runtimes/agentscope 新增 POST /mtc/group-session；X-MTC-Internal 门）
入参：{group_session_id, team_name, team_description?, leader:{runtime_agent_id, chat_model_config, knowledge_ids}, workers:[同构]}（workers=非 Leader 成员，D1 官方形态）。
步骤（严格串行，不变量 5；TeamMember.session_id 必填故 worker session 先于 team）：
① leader upsert_session + internal_auth.register(leader session token)；
② 逐 worker：upsert_session + internal_auth.register（session 清单即 member_sessions）；
③ 官方 storage upsert_team：TeamRecord{user_id, **session_id=leader_session_id, leader_agent_id=leader runtime id**, data=TeamData{name, description, members=[workers 全员 TeamMember{owner_id, agent_id, session_id, role="invited"}]}}；
④ set_session_team_id(leader+workers, team.id)（_LeaderContext 成立条件：session_record.team_id 非空 且 team.session_id==session.id，SP/app/_service/_chat.py:837-852）；写 agent_group_session_member；
⑤ 返回 {runtime_team_id, leader_session_id, member_sessions[], session_tokens hashes}→平台落 agent_session_index（trigger_kind='group'、group_session_id、session_token_hash）。
工具门禁（不变量 4）：tool_policy 对 group 会话 leader/worker 摘四工具留 TeamSay；**manifest 缺失 fail-closed deny subagent 族**；leader 系统提示注入花名册（worker 名+description+「用 TeamSay 派活、等汇报后向用户总结」）；**TeamSay 寻址规则=官方 directory 命名：invited 成员为 `name@agent_id[:8]`**（p1x probe 实证；leader 提示注入的即该寻址名，禁裸名）；官方 _LeaderContext/_WorkerContext、TeamMemberLoopMiddleware、InboxMiddleware 照常。leader 已注册 token → 会话内 run_agent_flow/run_workflow 平台工具可用（§1.4）。

### 4.3 聚合 SSE 契约
GET /{gsid}/stream：服务端并发订阅**成员数路**（leader 为成员之一，D5；TeamDetailResponse.members 供 worker session 清单）运行时流，逐事件加 `source:{agent_id,name,role}` 合流转发；事件 id 全局单调，前端断线重连按 id 去重（chat-stream.ts:94 reducer 惯例）；**静默原地 reconcile**（按 id 合并/保滚动/合流；禁每事件 toast/禁重置第一页）；成员执行态（idle/working/done）由流事件推导（roster 状态点=自研补值，§5.6）。closed 会话 stream=只读重放。

### 4.4 投影与索引
agent_session_index：leader 与每 worker session 各一行（trigger_kind='group'、group_session_id 反链）；board/work_item 投影 P3（D4）接入，不建第二套运行状态（执行域 Spec :19 口径）。

## 5. 前端 Spec（真源=台账+§5.6；禁手搓，用既有 beUI/shadcn 标准件）

### 5.0 令牌（D10：原站 mint 值入作用域 token `--group-*`，不动全局 --primary/--brand-primary；过渡 .2s cubic-bezier(.4,0,.2,1)；字体栈 D11）
group-primary #8EE5A1 / group-primary-bg #F1FAF3 / group-primary-bg-hover #E6F7EC / group-primary-border #CDEFD9 / 文字四色 #141414,#636261,#838280,#8E8C8B / 边框三色 #BCBBBA,#DDD,#E6E6E6 / fill #EFEFEF,#F9F9F9 / 黑钮 #080807 字 #FDFDFD（disabled opacity .5+not-allowed）/ 遮罩 #00000080 / info #0B83F1（本机 chip）/ 危险 #FF4D4F（补值，§5.6）。

### 5.1 侧栏（展开 240/#F9F9F9；D6 折叠态隐藏 tablist）
tablist「Agent（n）| Group（n）」（计数实测含括号数字）：容器 w216 h35 底线 1px #E6E6E6 gap24；tab w96 h34 pad 8/4 fs12 lh16 fw500；未选 #636261+2px 透明底线，hover 字色→#141414 无底无 bg；选中 #141414+2px #141414。虚线新建钮 h32 边 1px dashed #DDD 圆6 字 #838280 fs13 gap8 hover 白底黑字。**搜索 icon 16 #838280；Group 态输入 placeholder「搜索群组」**（台账:38）。群卡 h56 圆6 pad 0/6 gap8 hover/选中 #EFEFEF，hover 时 ⋯24 替换时间列；头像簇 32 容器 3×14.9 圆三角；名 fs13 lh20 fw600 截断；副标题=成员名「、」连 fs12 lh18 #8E8C8B 截断。

### 5.2 管理页（/agents 分段 Agent|Group；分段=滑动白 pill indicator：容器 #EFEFEF h32 圆6 内衬4 gap10，tab h24 pad 4/10 圆4 fs12，indicator=absolute 白层 transition transform/width/**height** motion-duration-fast ease-standard）
页头 h1 28/600+副 14 #636261+右黑 CTA h32 圆4 pad 0/12 fs13 fw500 gap8（文案随分段）。**整页空态逐元素复刻 DS-010**：虚线圆角多人 icon tile+「暂无 Group」+「创建Group后，可以在这里集中管理Group。」+黑 CTA「新建 Group」。网格 repeat(auto-fill,minmax(min(100%,max(310px,25% - 9px)),1fr)) gap12。虚线大 tile 312x127 边 dashed #E6E6E6 圆6 居中+icon gap8 fs16 #636261。群卡 312x127 白 边 #E6E6E6 圆6 pad 16/12/12：头像 48 圆8 底 #E7F8E6+21 圆 border 1px #FFF count-3 三角(3|13.5px)；名 fs16 fw650 截断（**双击=重命名弹窗**）；footer 分隔（补值：dashed #E6E6E6，§5.6）：创建对话任务 h28 fs12 #636261 gap4+⋯28；⋯菜单=重命名/删除（删除行危险色 #FF4D4F，补值）。
**重命名弹窗**：居中 w384 白 边 #BCBBBA **圆12** pad24；h2 14/500+X；input h32 边 #DDD 圆6 pad 4/12 fs14；footer 右对齐 gap8 距 input 24：取消=白底边 #E6E6E6 圆4 13/500 pad 0/12（台账:63）+保存黑 13/500（未改动 disabled .5）；文案我方「重命名群组/输入群组名称」（原站「重命名对话」文案债，台账 §5-6）。

### 5.3 创建弹窗（DS-011 逐值）
w832 h680 白 边 #BCBBBA 圆8；头 h2 16/500+副 14 #838280+X；label 14/500；标题 input h32 边 #E6E6E6 圆6 fs14 fw500 pad 0/28/0/8+清除钮 18（打开聚焦+默认值全选）；左 pane w291：搜索 h32 边 #E6E6E6 圆4 pad 0/8、helper 12 #838280、成员行 h48 pad8 圆6 gap8（hover #E6F7EC/选中 #F1FAF3；checkbox 16 圆3 边 #BCBBBA→选中 #8EE5A1 白勾；头像 32；名 14/500+本机 chip(10/600 #0B83F1 底 8%)；角色 12 #838280；选中行 Leader chip 白底 h24 pad 4/8 圆4 12 #838280）；右 pane 边左 1px #E6E6E6（补值）：未选占位 14 #838280 居中；选中=成员卡（边 #E6E6E6 圆6，pad/头像 40/select 圆=补值待补测§5.6：名 14/500+角色 12+**strong「设为 Leader」14/500**+checkbox 互斥）+响应模型 label+select h32 边 #E6E6E6（Auto+chevron，内字 14/500 #838280）+helper 12+工作目录/知识挂载（D3）钮 h32+helper；底栏 h64 pad 16/24：计数 14 #636261+取消（白底边 #E6E6E6 圆4 14/500 pad 6/12）+创建黑（0 成员 disabled .5）。
候选列表仅列**已发布且未归档** Agent（我方约束，入 §6.6 差异表）。

### 5.4 群会话页（路由 /conversations/groups/:gid/conv_:cvid；/groups/:gid 重定向最新 active；App.tsx Route Map 注释同步登记）
四栏：侧栏 | 任务面板 240（右分隔=补值待补测）| 聊天列（内容 560 居中；**外层 pad 0/32/12、shell w496** 台账:72）| 产物面板 240 border-left 1px #E6E6E6（头「产物」14/500+「共享目录」12/500+空态「暂无产物」12 #838280；**两右栏均带 resize 分隔条**）。
任务面板：群头像簇 32+名 14/500；分段 compact（容器 h36 #EDEDED 圆6 内衬4 gap10；tab h28 pad 4/10 圆4 fs12 fw500 未选 #8E8C8B；indicator 滑动同 §5.2）；「N 个任务」12 #838280+「+ 新建」12/500 #636261；任务卡 h56 pad 10/0/10/6 选中 #EFEFEF 圆6（角标 12 灰+名+time 12 灰；名字号=补值 13/500）；closed 任务卡只读徽标（不变量 11）。
群设置 tab 三节：群成员（头 12/500+「+ 添加」12/500 #636261 h20 pad 0/6 圆4 gap4；tile=32 圆头像+**Leader 徽章**(h11 fs9 fw500 #636261 底 #EFEFEF 边 1px #FFF 圆9999 pad 0/4 压头像下缘)+名 12 截断，tile 间距 23.7；**成员执行态点=自研补值**）/群技能（ⓘ+添加；空=暂未配置 12 #838280 pad 4/0）/成员协作 SOP（ⓘ+添加；行 h28 icon+名）。
聊天列：顶 bar 左「任务 N」（补值 14/500）右「当前任务」h30 pad 0/12 圆4 底 #EFEFEF 边 #E6E6E6 fs13 fw500；消息流 pad 12/32/16：用户=右对齐气泡 #F9F9F9 圆8 pad12 fs13 **lh1.65**（台账:71，v1.0 lh20 已纠）max473+meta(12 #838280+复制钮 16 补值)；成员=无气泡：24 圆头像+名 14/500+markdown 全量(h2/p/ul/table/code/hr)+meta；聚合流署名渲染（source.role=member 按成员消息形态入流）。
输入区：shell 白 圆8 边 #E6E6E6 min-h120 pad 12/12/0+composer shadow；编辑器 fs13 占位符「输入消息… 输入 @ 提及 Agent，Enter 发送，Shift+Enter 换行」；底栏 + 钮 24+圆发送 32（空=灰底灰箭/有字=#080807 白箭；空态底色补值 #EFEFEF）；**@提及弹层自研（D9）**：标准 Popover+成员列表；选中后 mention-chip（pill 底 group-primary 10% 混白、字群域主色、内 16 圆头像，照原站 CSS 类值）。

### 5.5 导航与权限
侧栏不新增一级入口（Group 住 tablist+管理页分段，follow 原站 IA）；前端 Permission 联合类型增 group.view/group.manage（点分单数惯例）；服务端角色制现状。

### 5.6 补值登记表（台账外取值；验收白名单=台账 §5 六条+本表+§6.6 差异表）
| 值 | 出处 | 处置 |
|---|---|---|
| 危险色 #FF4D4F（⋯删除行） | 原站 token 表 error（台账 §0 有 token，组件级未实测） | 采 token 表 |
| 任务面板右分隔/顶 bar「任务 N」14/500/任务卡名 13/500/复制钮 16/发送空态 #EFEFEF/右 pane 边左/群卡 footer dashed/成员卡 pad+头像 40+select 圆 | 原型取值或截图目检 | **P2 开工前活体补测一次回填台账**；补测前原型值生效 |
| indicator shadow-xs | 原站 CSS --toolbar/--form-fill 变体规则 | 采 CSS |
| 成员执行态点、closed 只读徽标、@提及弹层 | 自研 | D9/自研登记 |

## 6. 验收标准
1. 复刻对账：实现 vs 台账+§5.6 逐控件取值 diff≤容差 0（脚本化，选择器清单入 scripts/）；白名单=§6.6 表。
2. P0 闸门：group-v1.html 三屏用户肉眼签字后方可 P1。
3. 活体链：3 成员组（1 Leader+2 worker）真 LLM 群聊——worker 各自 session 真执行且流事件署名、TeamSay 在 leader 上下文可见（state 落 PG）、聚合流单连接成员数路、8301 重启续聊（不变量 9）、关聊后 transcript 可重放（不变量 11）。
4. 负向：0 成员/超 5 422+前端 disabled；未发布 Agent 不入候选；active 会话再开 409；归档双向 409+引用清单；建团四工具 manifest 不存在+**manifest 缺失 fail-closed 断言**（不变量 4）；closed 会话 turns 409；并发装配串行计时（不变量 5）。
5. 门禁：gate.sh 全绿（tsc/eslint 0 警告/vitest/build/pytest/层1 层2/迁移单 head 当期/无泄密）+ probes/p1x_team.py 入 --live（含广播唤醒+重启恢复+fail-closed 三场景）。
6. 诚实差距表=§6.6，随验收文档交付。

### 6.6 诚实差异与自研登记表（唯一一张表）
1. 群卡 hover 底色采 CSS #EFEFEF（活体单点读 transparent，疑似 transition 未 settling）——台账 §5-1。
2. @提及弹层自研（原站未复现）——D9。
3. 管理页分段 fw 实测 400（CSS toolbar 变体 500）——台账 §5-3，采实测。
4. 成员行名字号 14/500 为假设值——台账 §5-4，P2 补测。
5. 气泡底色采实测 #F9F9F9（CSS 多规则）——台账 §5-5。
6. 重命名弹窗文案我方「重命名群组」（原站「重命名对话」文案债）——台账 §5-6。
7. 候选列表仅已发布未归档 Agent（我方约束，原站无此信息）。
8. 文案 Waker→Agent（我方词，先例=任务看板拍板）。
9. Group 域 mint token 与全站品牌绿并存（D10）。
10. 成员执行态点/closed 徽标=自研补值（§5.6）。

## 7. 实施切片（开工令前置=P0 签字+D1–D11 拍板；节奏用户控制）
P1 实体与治理：g062+models+as_groups CRUD/校验/闸门+pytest+probe p1x_team（装配/广播/重启/fail-closed）。
P2 群聊闭环：/mtc/group-session+tool_policy 细化+聚合 SSE+前端四屏（含群技能挂载、@提及自研、§5.6 补测回填）+活体 E2E+截图交签。
P3 触发面与 SOP：automation target_kind=group（执行域 Spec 增补）+看板 groupId 筛选+g064 agent_group_sop。

## 8. 风险
并发建 session 挂死（装配串行+probe 计时）；team 多 worker 并发唤醒未实测（probe 广播场景+D5 上界+fail-closed 降级）；无团队级总轮次器（max_team_turns P2）；官方 teams schema 升级漂移（只经官方 storage API+probe 入 live）；@提及自研被否（P0 签字前置）；DM Sans 授权/加载（D11）。

## 9. 审查记录
v1.0→v1.1 独立审查（只读代理，77 次工具调用实读代码/台账/执行域 Spec）：4 P0+10 P1+8 P2。
P0 修复：#1 leader session 补 set_session_team_id+TeamRecord.session_id/leader_agent_id 写明（§4.2①②）；#2 权限机制改角色制+rbac.ts 点分 key，删 permission_seed 误用（§4.1/§5.5）；#3 成员数口径统一「含 Leader 1..5」+TeamRecord.members 仅 worker（§2/D5/不变量2/§4.2/§4.3）；#4 气泡 lh20→lh1.65（§5.4，设计稿同误另修）。
P1 修复：#5 官方 members 形态（同 #3）；#6 关聊不解散保 transcript（D2/不变量 6/11/§4.1 DELETE）；#7 POST sessions 409 拍死（D2）；#8 fail-closed（不变量 4/§4.2）；#9 作用域 token（D10/§5.0）；#10 confirm 带 agent_id/interrupt scope（§4.1）；#11 侧栏搜索+DS-010 空态+tab 计数（§5.1/§5.2）；#12 台账外值入 §5.6 补值表；#13 差异表唯一化 §6.6；#14 leader internal_auth.register（§4.2①）。
P2 修复：#15 索引列去问号+词表注释级说明（§3.1）；#16 弹窗存疑值入补值/采台账（§5.3）；#17 迁移切片 g062 仅 P1 四表（§3.1/§6.5→§6.4）；#18 @提及翻覆登记（D9）；#19 resize 双栏/产物文案/输入区外层 pad+shell 宽/汇报形态从 live（§5.4）；#20 悬空引用改 script_runner.py:56-59 与 collect_archive_plan（§1.3/不变量 7）；#21 Route Map 注释+DM Sans 登记（§5.4/D11）。
