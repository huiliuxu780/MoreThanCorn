# 08 · Agent 列表/详情 与 19830 原站对齐规格（评估稿，未实施）

日期：2026-09-07。证据：IAB 实测原站 `/management`（列表）与 `/wakers/{id}/home`（详情概览）的 DOM 快照 + 截图 + 用户提供的列表页元素 dump（含 class/度量）；我方 `localhost:5199/agents` 与 `/agents/:id` 同口径取证。
关联：`05-agent-management-redesign.md`（MTC-005 数字员工卡）、`research/morethancorn/*` 验收文档、[[qoderawake-replica-theme-comparison]]（主题层已对齐，本文只管页面层）。

## 0. 结论

- **列表页可按原站改**：形态同构（筛选行 + 卡片网格），差异在字段、卡片版式与动作，全部可落。
- **详情页不可整页照搬**：原站 = 二级侧栏 12 子页（概览/工作/记忆与学习/能力与资源/权限与管理），承载"常驻员工"模型；我方 = 单页三 tab（搭建/发布/观测），承载"版本化发布对象"（草稿/沙箱/生产）。照搬则发布/评测/版本无安放位置。**IA 重构单列拍板项（§4），本文只规格化无冲突部分。**
- 主题/token 层 09-06 已对齐四主题，本文不涉及。

## 1. 列表页（/agents ← 原站 /management）

### 1.1 度量与 token 映射（原站 → 我方）

| 原站 | 原站值 | 我方落点 | 备注 |
|---|---|---|---|
| `bg-bg-container` | 卡片/输入底 | `bg-surface` | |
| `border-border-tertiary` | 输入/卡边框 | `border` | |
| `text-text` / `text-text-tertiary` | 正文/placeholder | `foreground` / `muted-foreground` | |
| `hover:bg-fill-secondary` | 按钮/卡 hover | 中性 hover token（`surface-raised`） | 不用品牌色 |
| `bg-primary`/`text-text-on-primary` | 主按钮 | Button default（brand） | |
| 头部动作按钮 | h-7 px-2 text-xs rounded | **不抄**：我方 Button sm 全局 h-8 | 跨页一致性优先（UI 一致性硬规） |
| 搜索/筛选控件 | h-9 rounded-lg | **不抄**：我方全局 h-8 | 同上 |
| segment tabs | bar 32px（indicator 24 + pad 4） | TabsList 现规格 | 仅借"分段"形态 |
| 卡片网格 | 1440 视口 4 列（含占位卡） | `md:2 xl:3` → 改 `auto-fill minmax(240px,1fr)` | 与占位卡同排 |

### 1.2 改动清单

1. **卡片版式改竖排**（原站形态）：头像顶部居中 48px → 名称 → 角色 chip（图标+role）→ 描述 line-clamp-2 → 分隔线 → 统计行「任务数 N｜最近运行 X」两栏竖分隔。现横排头像+生命周期徽章布局退役；**生命周期徽章保留**（原站无版本态，我方领域需要），移至名称行右侧。
2. **统计行填真数据**：替换现「运行摘要：—」占位。数据源见 §3 API-1。
3. **首格虚线占位卡**「+ 新建 Agent」，点击 = 头部新建按钮同路由。
4. **筛选行**：`使用中/已封存` 由 Select 改 segment tabs（对应原站 Waker/Group 位）；运行时/排序保留 Select；行右加计数「N 个 Agent」。
5. **卡片动作**：整卡点击=详情（不变）；右上角 ⋯ 菜单（封存/复制 ID 等，遵循 ⋯ 菜单硬规）。原站 管理/分享/对话 三按钮**不抄**：分享无实体、对话入口已随 R-Archive 移除。
6. 头部动作仅保留「新建 Agent」。原站 分享记录/导入 Waker 无对应实体，不做。

### 1.3 明确不抄

- 在线状态点 + 「本机」机器标签：原站 Waker 是带心跳常驻进程；我方 Agent 为配置实体，无在线概念，展示即造假。
- h-9/h-7 控件高度（§1.1）。
- 原站 i18n 缺陷（分享按钮渲染未翻译 key `worker.home.shareWakerTitle`）。

## 2. 详情页（/agents/:id）

### 2.1 无冲突增量（不动三 tab 骨架）

1. **Hero 补字段**：ID（短码，如原站 `ID: xggk3619`）、创建时间（≈入职时间）。
2. **观测 tab 头部加「工作日志」卡**：入职天数/进行中/已完成/待处理 四数字 + 任务类型分布环图（按 run 触发类型分组）。数据源 §3 API-2。
3. **记忆与学习时间线**：`AgentEvolutionPanel` 事件流上移至观测 tab 工作日志卡下方（现仅在进化面板内）。
4. **活跃度热力图：默认不做**。原站 365 天全零占半屏，信息密度差；若拍板要做，用 API-2 的按日计数，组件限高 120px。

### 2.2 不抄

删除 Waker / 编辑 / 对话 按钮（R-Archive 封存语义 ≠ 删除；对话入口已移除）；二级侧栏 12 子页（§4）。

## 3. 后端 API 增量

- **API-1** `GET /agents` 列表项追加 `runCount`、`lastRunAt`（按 agent 聚合 runs，单查询 join，避免 N+1）。
- **API-2** `GET /agents/:id/run-stats`：`{ byStatus: {running,done,pending}, byTrigger: {manual,dialogue,schedule,...}, byDay: [{date,count}] (近365天), sinceDays }`。runs 表已有 created_at/trigger/status，纯聚合。
- 进化事件：复用现有 evolution 接口，不新增。

## 4. 拍板项（未决，不动）

1. **详情页 IA**：是否引入原站式二级侧栏。建议否——保留三 tab，把 §2.1 概览块吸收进观测 tab；侧栏化等 Agent 子资源（记忆/Skill/连接器）实体化后再议。
2. 热力图做不做（§2.1-4）。
3. 实施时机：/agents 两页属 MTC-005/SDD-10 R4 已交付待独立验收范围，改前需确认与验收批次错开或并入返工单。

## 5. 门禁影响（实施时同步）

- `check-ui-standard` allowlist：卡片结构变化需复核（只减不增原则）。
- `check-visual-regression` 基线：/agents 列表与详情两屏重拍。
- verify-mtc005 相关脚本：卡片字段断言更新（运行摘要占位 → 统计行）。

## 实施状态（09-07 夜）
已实施：B1 后端一等实体+对话运行时（g047agentcap0001）；B2 列表+头像；B3 九子页工作区；B4 对话工作区；B5 门禁同步。
验收：docs/acceptance/AGENT-CAP-REWORK.md；台账 .tmp-docs/agent-cap/measurements.md。
拍板记录：侧栏全同构+发布治理组 / 对话=独立工作区(模型选择+附件) / Skill记忆新表 / 6 新头像替换池 / 对话语义=角色对话 MVP / 热力图不做 / 原站缺陷不抄。
