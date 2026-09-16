# Group UI 测量台账（2026-09-15，19830 活体 IAB 实测 + 原站 CSS 资产核对）

铁律执行记录：全部数值来自活体 getComputedStyle / getBoundingClientRect 或原站 stylesheet 规则原文，禁手写编造。来源标注：[实测]=IAB evaluate；[CSS]=19830 主样式表规则；[截图]=目检截图佐证。
活体前提：用户 09-15 14:54 已自建真组「新的群组」（3 成员），GAP-16 证据缺口由此闭合；本台账全程只读+弹窗内勾选后取消，未产生任何写操作。

## 0. 设计令牌（[CSS] :root light 全表，dark 表同源备查）

| token | 值 | 用途实测落点 |
|---|---|---|
| color-primary | #8EE5A1 | 勾选 checkbox 底/边 |
| primary-hover / active | #73CD94 / #5CB870 | |
| primary-bg / bg-hover | #F1FAF3 / #E6F7EC | 成员行选中底 / 成员行 hover 底 |
| primary-border / hover | #CDEFD9 / #B3E6C7 | |
| text | #141414 | 主文字/选中tab/黑字 |
| text-secondary | #636261 | 未选中tab/添加钮/卡footer钮 |
| text-tertiary | #838280 | 虚线钮字/helper/时间戳/空态 |
| text-quaternary | #8E8C8B | 群卡副标题/分段未选中(compact) |
| border | #BCBBBA | 弹窗边/未勾选checkbox边 |
| border-secondary | #DDDDDD | 侧栏虚线钮边 |
| border-tertiary | #E6E6E6 | 卡边/输入边/tablist底线/面板分隔 |
| fill-secondary | #EFEFEF | 群卡hover+选中底/Leader徽章底/分段容器(mgmt) |
| fill-tertiary | #F9F9F9 | 侧栏壳底/用户气泡底 |
| bg-container | #FFFFFF | 卡底/弹窗底/虚线钮hover底/分段白pill |
| bg-highlight | #080807 | 黑主按钮(创建/页头CTA) |
| text-on-primary/highlight | #FDFDFD | 黑钮字 |
| info | #0B83F1 | 「本机」chip 字（bg=8%透明） |
| mask | #00000080 | 弹窗遮罩 |
| --qc-transition | .2s cubic-bezier(.4,0,.2,1) | 所有 hover 过渡 |
| motion-duration-fast | var(--config-motion-duration-fast) | 分段 indicator 滑动 |

字体族 [实测]：`"DM Sans", -apple-system, "system-ui", "Segoe UI", sans-serif`。

## 1. 全局侧栏（展开态）[实测]

- 壳：w240 h全，bg #F9F9F9，右分隔无 border（主区白底对比）。
- tablist「员工与群组」：容器 w216(x12) h35，border-bottom 1px #E6E6E6，gap 24；tab 按钮 w96 h34 padding 8px 4px，fs12 lh16 fw500；未选中 color #636261 + border-bottom 2px transparent；选中 color #141414 + border-bottom 2px #141414；hover(未选中)：color→#141414，无底色无下划线 [实测 cua.move]。
- 虚线新建钮 `.qc-chat-sidebar__create-group`：h32 w184(x12)，border 1px dashed #DDDDDD，radius 6，color #838280，fs13 lh20，padding 0 8，gap 8，1 个 + icon(14)；hover：bg #FFFFFF + color #141414（border 不变）[实测+CSS]。
- 搜索：label 16x16 icon #838280（x204）；Group 态 placeholder「搜索群组」[实测 snapshot]。
- 群卡 `.qc-chat-group-item`：w216 h56 radius 6 padding 0 6 gap 8；hover 与选中 bg #EFEFEF [CSS 规则族；活体 cua 单次读为 transparent，以 CSS 为准并登记差异]；hover 时右侧 time-col 隐藏、⋯(24x24) 显现 [CSS]。
  - 头像簇 `.qc-chat-sidebar__avatar-badge-wrap`：32x32 容器，内 3 圆头像 14.9px（border-radius 9999）三角排布（上中/左下/右下）[实测]。
  - 名：fs13 lh20 fw600 #141414 单行截断；副标题=成员名「、」连接 fs12 lh18 #8E8C8B 截断 [实测]。
- 折叠态：tablist/列表隐藏逻辑同壳（64px 轨），本台账不重复测壳（已有 nav-fixed 台账）。

## 2. /management Group 视图 [实测]

- h1 28px/600 #141414；副标题 14px #636261「选择 Waker 开始任务，或者新建一个开始工作。」（Group 态文案不变）。
- 页头黑 CTA：h32 padding 0 12 radius 4 bg #080807 字 #FDFDFD fs13 fw500 gap 8（+ icon）；文案随分段切「新建 Group」。
- 分段（toolbar 变体）：容器 h32 w218 bg #EFEFEF radius 6 padding 4 gap 10；tab h24 padding 4 10 radius 4 fs12 fw400；未选中 #636261，选中 #141414 + 白 pill。
- 白 pill 真相 [CSS]：`.qc-segment-tabs__indicator` 绝对定位层，transition transform/width/height（motion-duration-fast + ease-standard）滑动；选中 trigger 自身 background 清零（data-indicator-ready）。
- 网格 [CSS]：`repeat(auto-fill, minmax(min(100%, max(310px, 25% - 9px)), 1fr))` gap 12（断点 25/20/16.67/14.29/12.5%）；列表 gap 20。
- 虚线大 tile：312x127 bg #FFFFFF border 1px dashed #E6E6E6 radius 6 padding 16，内容 + icon(16) gap 8 fs16 #636261 居中。
- 群卡：312x127 bg #FFF border 1px #E6E6E6 radius 6 padding 16 12 12；头像=48x48 radius 8 底 #E7F8E6 mint tile，内 21x21 圆头像 border 1px #FFF，count-3 排布=上中/左下/右下（top/bottom 3px, left/right 3|13.5px）[CSS+实测]；名 fs16 fw650 #141414（h2 内层 span）；**改名=双击卡名或 ⋯→重命名 弹小弹窗**[实测]：w384 居中 bg #FFF border 1px #BCBBBA **radius 12**（≠创建弹窗 8）padding 24；h2 14/500「重命名对话」+X；input h32 全宽 border 1px #DDDDDD radius 6 padding 4 12 fs14 fw400（值=现名，placeholder 输入对话名称）；footer 右对齐 gap 8 距 input 24：取消 ghost h32 13/500 padding 0 12 + 保存黑 h32 13/500 **未改动 disabled opacity .5**；footer：「创建对话任务」钮 h28 fs12 #636261 gap 4(flag icon) + 右 ⋯ 28x28；⋯ 菜单项=重命名/删除 [实测 menu]。

## 3. 创建群组弹窗（DS-011 全交互）[实测]

- 遮罩 #00000080；弹窗 w832 h680 y20 bg #FFF border 1px #BCBBBA radius 8。
- 头：h2 16/500 #141414「创建群组」+ 右 Close；副 p 14 #838280「选择 Waker 成员、编辑群聊标题，并指定 Leader。」；头区与体区有分隔线。
- 字段 label「群聊标题」14/500；输入 h32 w790 border 1px #E6E6E6 radius 6 fs14 fw500 padding 0 28 0 8（右留清除钮）；清除钮 18x18 #8E8C8B；打开即聚焦+默认值「新的群组」全选 [实测 active+selection]。
- 左 pane（w291 x245）：label「Waker 成员」；搜索框 h32 border 1px #E6E6E6 radius 4 padding 0 8（icon+14px 输入，placeholder 搜索 Waker）；helper 12 #838280「群聊可选择多个 Waker，并需指定一位 Leader。」
- 成员行：wrap h48 w291 padding 8 radius 6 gap 8；未选 bg 透明，hover bg #E6F7EC；选中 bg #F1FAF3；checkbox 16x16 radius 3：未选 border 1px #BCBBBA 底白，选中底+边 #8EE5A1 白勾；头像 32 圆；名 fs14? [实测行内 name 元素 h36 容器] 截断 + 「本机」chip（bg rgba(11,131,241,.08) 字 #0B83F1 fs10 fw600 padding 1 5 radius 4）；角色行 12 #838280；选中行右侧 Leader chip：白底 h24 padding 4 8 radius 4 fs12 #838280。
- 右 pane（w458+）：未选成员=居中占位 14 #838280「请先选择一位 Waker，再配置其响应模型和工作目录。」；选中后=成员卡（白底 border #E6E6E6 radius，头像 40?+名 14/500+角色 12 灰+右「设为 Leader」checkbox+strong 14/500）→「响应模型」label + select 触发器 h32 border #E6E6E6 radius（内 14/500 #838280「Auto」+chevron）+ helper 12 灰「仅应用于当前 Waker」→「工作目录」label + 选择钮 h32 全宽 border（icon+「选择工作目录」）+ helper「可选择 Project 或本地目录；未选择时使用默认工作目录」。
- Leader 语义 [实测]：首个勾选者自动 Leader（其设为Leader checkbox checked+disabled）；第二人入组后各成员卡 Leader checkbox 互斥可切。
- sticky 底栏 h64 padding 16 24：左计数 14 #636261「已配置 N 个 Waker」；右 取消（h32 白底 border #E6E6E6 radius 4 14/500）+ 创建（h32 黑 #080807 字 #FDFDFD；**0 成员 disabled=opacity .5 + cursor not-allowed** [实测]）。

## 4. 群聊页（/conversations/groups/{gid}/conv_{cvid}）[实测]

- 三栏：侧栏240 | 任务面板240 | 聊天列(弹性, 内容宽560 居中, padding 12 32 16) | 产物面板240 border-left 1px #E6E6E6。
- 任务面板：头=群头像簇32+群名 14/500；分段(compact 变体) 容器 h36 w207 bg #EDEDED radius 6 padding 4 gap 10，tab h28 padding 4 10 radius 4 fs12 fw500（未选 #8E8C8B/选中 #141414+白pill indicator）；「N 个任务」12 灰 + 右「+ 新建」12/500 #636261；任务卡 h56 padding 10 0 10 6（选中底 #EFEFEF radius 6）：「暂无待关注结果」12 灰 + 任务名 + time 12 灰 + hover ⋯；面板右缘 resize 分隔条。
- 群设置 tab：三节=群成员（12/500 头 + 右「+ 添加」12/500 #636261 h20 padding 0 6 radius 4 gap 4；成员 tile=32 圆头像+Leader 徽章（h11 fs9 fw500 #636261 底 #EFEFEF border 1px #FFF radius 9999 padding 0 4，压头像下缘）+名 12 截断；tile 间距≈23.7）/ 群技能（ⓘ+添加；空=「暂未配置」12 #838280 padding 4 0）/ 成员协作 SOP（ⓘ+添加；行 h28 icon+「通用协作能力」）。
- 聊天列顶 bar：左「任务 1」；右「当前任务」钮 h30 padding 0 12 radius 4 bg #EFEFEF border 1px #E6E6E6 fs13 fw500 [pressed]。
- 消息流：用户消息=右对齐气泡 bg #F9F9F9 radius 8 padding 12 fs13 lh1.65 白底列宽内 max≈473；气泡下右=时间戳 12 #838280 + 复制钮；成员回复=无气泡：24 圆头像 + 名 14/500 #141414 + markdown 正文（h2/p/list/table/code/separator 全支持）+ 时间戳+复制。
- 输入区 `.qc-waker-groups-composer`：外层 padding 0 32 12；shell w496 min-h120 bg #FFF border 1px #E6E6E6 radius 8 padding 12 12 0 + shadow(composer)；编辑器 contenteditable fs13 fw500? [实测 combobox fs13 fw500]，placeholder「输入消息… 输入 @ 提及 Waker，Enter 发送，Shift+Enter 换行」（::before attr）；底 toolbar：左 + 钮，右发送圆钮 32（有字=黑底白箭/空=灰底）；拖拽态 border-color primary [CSS]。
- @提及：placeholder 与 CSS `.qc-waker-groups-composer-mention-chip`（pill bg primary10% 混白、字 qc-primary、内 16 圆头像）证明存在；**活体输入 @ 与 @+文字均未弹出 listbox（两次尝试）**——登记为未复现交互，原型按承诺形态自研待签。
- 产物面板：头「产物」+「共享目录」12/500?+空态「暂无产物」12 灰。

## 5. 差异与未复现登记（诚实差距）

1. 群卡 hover 底色：活体 cua 单点读 transparent，CSS 规则 `:hover:not(--active),--active{background:fill-secondary}` 明确 #EFEFEF → 采 CSS，差异原因疑似 transition .2s 未 settling。
2. @提及弹层未复现（见上）。
3. 管理页分段 fw 实测 400 与 CSS toolbar 变体 fw-medium(500) 不符 → 以实测 400 为准（compact 变体才是 500）。
4. 成员行 name 字号：行容器实测 h36，内 name 元素未单测 → 原型取 14/500（与右 pane 成员卡名一致），签字时肉眼比对。
5. 气泡底色 CSS 多规则（sage-bg/fill-tertiary）→ 以实测 #F9F9F9 为准。
6. 重命名小弹窗文案原站为「重命名对话 / 输入对话名称」（群改名复用对话组件，疑原站文案债）；我方原型与实现用「重命名群组 / 输入群组名称」，形态逐值照抄——文案偏离已登记，签字时确认。
7. Group 域中性色（文字/边框/fill）复用本站 WCAG 修正后 token（09-14 D1 全站拍板），不引入原站 #838280 等原值；mint 族（primary/bg/border/avatar tile）逐值照抄原站入 --group-* 作用域 token。
