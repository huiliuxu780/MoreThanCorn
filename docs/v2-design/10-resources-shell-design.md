# 10 · 「能力与资源」合并壳设计 v2：五分类持久壳 + Skill 一等化 + Connections 归设置

> 日期：2026-09-07（v2，当日用户拍板收敛）· 状态：**设计/原型阶段，未改代码**
> 上游：[09-resources-align-19830.md](./09-resources-align-19830.md) §7 路线 A、§7.5 范围收敛
> 原型：[docs/v3-design/prototypes/resources-shell-v1.html](../v3-design/prototypes/resources-shell-v1.html)（v2 形态：五磁贴壳内切换 / 子 tab / 明暗主题 / 挂载弹窗）
>
> **09-07 用户拍板（v2 变更依据）**：
> 1. Workflow 不在壳内展示（磁贴删除，一级导航保留）；
> 2. 结果规则、表单不进壳；
> 3. Connections 与模型接入不同层——**Connections 移入【设置】**（凭据/鉴权存储层）；
> 4. 一级磁贴只保留五个：**Skills / 模型接入 / 工具与 MCP / 知识库 / 数据资产**。

---

## 1. 目标与非目标

### 目标

- **G1 持久壳**：`/resources/*` 浏览流共享同一壳（页头 + 五磁贴行 + 内容槽）；分类切换不离开壳，URL 可分享可回退。
- **G2 Skill 一等化**：SKILL.md 内容包成为资源实体（列表/上传/查看/挂载/校验），运行时注入正文而非名字占位。不做市场供给端。
- **G3 模型接入归位**：Models + Model Providers 合并为「模型接入」分类（接入渠道 / 模型目录两子 tab）；Runtime Providers 移出资源壳（建议设置-执行策略，Q5）。
- **G4 凭据层归设置**：Connections 整页移入【设置】新分区「连接」；路由反转（`/settings/connections` 为真页，`/resources/connections` 变 redirect）；安全操作集与门禁一个不动。
- **G5 定义类出壳有归宿**：表单、结果规则离开壳后归入 Workflow 域（Q7 建议），不留孤儿路由。
- **G6 零破坏收敛**：除上述定向搬家外，canonical 语义以 redirect 保旧链；导航五项与 72px 窄轨不动；后端除 Skill 新表外不动。

### 非目标

- **N1** 不做市场/货架；**N2** 不改全局实体+Usage 引用的归属模型；**N3** 详情/向导/编辑器不进壳；**N4** 不合并/削弱 Connections 安全语义；**N5** 磁贴选中不引入分类色/品牌色底。

---

## 2. IA 与路由

### 2.1 壳与默认分类

`/resources` index = 壳 + 默认分类 **Skills**。原 Hub 门厅退役，计数仪表盘职能由壳磁贴行常驻计数接管（提取 `resources-hub.tsx:36-63` 的并行取数为共享 hook `useResourceCounts`，五路即可）。

### 2.2 壳内五分类（一级磁贴）

| 磁贴 | 路由 | 内容 |
|---|---|---|
| Skills | `/resources/skills` ★ | 新分类（§4.1） |
| 模型接入 | `/resources/models` ★ | 子 tab：接入渠道 / 模型目录（§4.2） |
| 工具与 MCP | `/resources/tools` ★ | 子 tab：Tools / MCP Servers（§4.3） |
| 知识库 | `/resources/knowledge` ★ | 从 AI 资源 tab 提升（§4.4） |
| 数据资产 | `/resources/data` | 子 tab：Datasources / Data Assets（§4.5；磁贴文案按用户口径称「数据资产」） |

### 2.3 出壳与搬家路由表（★新增，→redirect，⇄反转）

| 路由 | 去向 | 说明 |
|---|---|---|
| `/resources` | 壳 index | ★ redirect `/resources/skills` |
| `/resources/ai` | — | → 按 tab 映射：`models|providers`→`/resources/models`；`tools|mcp`→`/resources/tools`；`knowledge`→`/resources/knowledge`；无参→`/resources/models` |
| `/resources/connections` | `/settings/connections` | ⇄ 反转：设置分区为真页（§4.6） |
| `/resources/rules`、`/:id` | `/workflows/rules`、`/workflows/rules/:id` | → 出壳归 Workflow 域（Q7） |
| `/resources/forms`、`/:formId`、`/new` | `/workflows/forms`… | → 出壳归 Workflow 域（Q7；历史 precedent：`/config/forms` 本就 Workflow 导航点亮） |
| `/resources/{ai,data}/:type/:id`、`/new` 向导 | 不变 | 详情/向导不进壳 |
| `/config/*` 旧路由 | redirect 表保持 | 其中 tools/models/connections 目标改指新址 |
| `/workflows`、`/workflows/:agentId` | 不变 | 一级导航；壳内**无**磁贴、无入口卡（用户拍板 1） |
| `/settings?section=connections` | 设置新分区 | ★ 分区注册进 settings.tsx:37-45 分区表 |

### 2.4 面包屑与导航点亮

- 面包屑（app-shell.tsx:68-96）：壳分类层 = 能力与资源 / <分类名>；`/settings/connections` = 设置 / 连接；`/workflows/rules|forms` = Workflow / <名>。
- `computeActiveNav`（app-sidebar.tsx:119-129）：删除"`/settings/connections` 归能力与资源"特例（归设置）；Workflow 的 activePrefixes 增加 `/workflows/rules`、`/workflows/forms`。
- 设置左分区导航新增「连接」项（位置：权限与安全之前）。

---

## 3. 壳组件规格（ResourcesShell）

1. **PageHeader**：标题恒「能力与资源」+ 副标（暂定"统一管理平台能力与数据资产"）；右侧无全局动作。
2. **磁贴行**：单行五磁贴（grid 5 列）。磁贴 = 32px 圆角-8 图标块（20px 图标，中性底）+ 名称 14px/600 + 计数 12px 次要色 + 描述一行 12px。磁贴 = NavLink；**选中态中性**：底 `surface-muted` + 图标块 `surface-raised`+border（N5）。无定义组、无 Workflow 磁贴、无出站角标。
3. **内容槽**：`<Outlet/>`，min-height 60vh；各分类自带工具条/子 tab/列表。

---

## 4. 分类与搬家内容规格

### 4.1 Skills（新，G2 前端面）

工具条（搜索 + 来源筛选 全部/内置/上传 + 主按钮「上传 Skill」）；卡片网格 3 列：名称 + 描述两行 + 来源 chip + 版本/更新时间 + 挂载 Agent chips（头像+名，跳 Agent 详情）+ 行操作图标钮（查看/挂载或卸载/编辑/删除，同规格图标+tooltip）；查看 = 右 Drawer（SKILL.md markdown 只读 + 元数据 KV）；上传 Dialog（名称+描述+.md 文件或粘贴 SegTabs）；挂载 Dialog（Agent 多选 → 写 `config.skills`）；空态"还没有安装或上传 Skill"+上传主按钮。

### 4.2 模型接入（G3）

- 子 tab **接入渠道**：表格（名称/baseUrl 等宽/凭据 Connection 引用 chip/健康/状态/行操作 测试·启停·编辑）；新建渠道 Dialog = 名称+baseUrl+ConnectionPicker(llm 过滤)；保留生产禁 mock:// 门禁文案。
- 子 tab **模型目录**：卡片 4 列（modelKey 等宽+capabilities chips+版本+渠道 badge+被引用数）；新建模型 Dialog；删除被阻 Dialog 保持。
- 内容 = 原 `/resources/ai` 的 models/providers 两 tab 原样搬运，操作集不删。

### 4.3 工具与 MCP

子 tab Tools：tool 卡片 + 来源 chip（内置/自建，借"市场/我的"降维）；子 tab MCP Servers：mcp 卡片（健康徽章+stdio/http chip）。创建走四步向导（路由保留、不进壳）。

### 4.4 知识库

knowledge 卡片原样下沉（vector/document chip + 健康 + embedding 引用 + 被引用数）。

### 4.5 数据资产

子 tab Datasources / Data Assets 原样下沉。**开放问题 Q8**：datasource 同样持凭据引用（Connection），是否随 Connections 归设置？建议**留在本分类**——datasource 是"数据在哪"的业务声明，被资产/任务消费，与纯凭据存储不同层；若拍板归设置则本磁贴改名「数据资产」仅含 assets+definitions。

### 4.6 Connections → 设置「连接」分区（G4）

- 页面内容 = 现 `wf-connections.tsx` **整页原样**（协议 tab + 双徽章卡片 + 创建/编辑/轮换/清凭据 Dialog），仅去壳外 chrome 适配设置分区布局。
- 安全注记随页迁移：工具条保留"Secret 服务端加密、页面永不展示；鉴权脚本沙箱空跑；EnvPatch 禁写 Secret"一行（原 Q4 随之闭环）。
- 路由反转与 redirect 见 §2.3；RBAC 不变（connections 管理权限位照旧）；导航点亮归设置（§2.4）。
- 被引用方不受影响：ConnectionPicker（向导/runtime providers/datasource）数据源为 `/api/connections`，与页面位置无关。

### 4.7 表单 / 结果规则 → Workflow 域（G5，Q7）

- 路由搬家见 §2.3；页面内容原样（forms 卡片+FormBuilder；rules 表格+编辑器）。
- 导航点亮 Workflow（activePrefixes 扩展）；面包屑 Workflow / 表单|结果规则。
- 理由：二者是编排输入与输出治理的定义件，消费方均为 Workflow/Agent 运行链；历史 precedent `/config/forms` 本就 Workflow 点亮。备选（若 Q7 否决）：保留 `/resources/*` 隐藏路由仅深链可达——不推荐，孤儿路由违反 IA 可发现性。

---

## 5. Skill 资源模型（后端设计，本期不实施代码）

### 5.1 实体

表 `skill`：`id` PK、`name` UNIQUE、`description`、`content` TEXT（SKILL.md 正文）、`source` ENUM(`builtin`,`uploaded`)、`version` INT 默认 1（预留不递增）、`created_at`、`updated_at`。
种子：一次性迁移入库现存三份 SKILL.md 为 builtin（business_analysis module、质检、poc consumer-analysis）；DB 为唯一源，文件归档不删。

### 5.2 API

- `GET/POST /api/skills`、`GET/PUT/DELETE /api/skills/{id}`（RBAC 同 tool.view/tool.manage 档）。
- `POST /api/skills/{id}/mount` `{agentIds: []}` / `POST /api/skills/{id}/unmount`：写各 Agent `config.skills`（去重、校验存在）。
- `GET /api/registry/skills`：供校验与 mention 展开。

### 5.3 运行时接线

- `agent_runtime.py:252-255`：「## 挂载技能」名字列表 → 正文注入 `### {name}\n{content}`；单 skill 截断 8000 字符附"（已截断）"。
- `agent_runtime.py:237-238`：`#skill:name` mention 展开改查 registry。
- `routers/agents.py:270-271`：校验对照 registry，未注册 `valid: False` 且编辑器标红。
- Agent 编辑器：`config.skills` 改 Skill 多选 picker。

### 5.4 验收口径

1. 上传 .md → 列表 source=uploaded；Drawer 正文一致。
2. 挂载 Agent A → A 的 run system prompt 含正文（run 详情取证）；未挂载不含。
3. 未注册 skill 名 → valid=False + 标红。
4. 删除被挂载 skill → 阻断 Dialog 列挂载方。
5. >8000 字符注入含截断注记。

---

## 6. 视觉规格

- token 全走 `src/index.css` 四主题（data-theme）；原型先落 light+dark，实施门禁覆盖四套。
- 窄轨 72px：项 56×62 / 图标 20 / 标签 12 / 图标-标签间距 10 / 项距 4 / 圆角 8；选中=hover 同底（light `#ECECE8` / dark `#2A2E2B`），选中仅字重 500。
- 磁贴选中中性底（§3）；状态 chip 走 status 软底 token。
- 组件全 shadcn 标准件；check-ui-standard allowlist 只减不增。
- **交互三态（卡片/磁贴点击效果）**：原站实测（19830 主 CSS `index-QwQAn1hj.css`）——全局默认 `transition-duration:.15s` + `cubic-bezier(.4,0,.2,1)`；bundle 含按压工具档 `active:translate-y-px` / `active:scale-95` / `active:bg-fill-secondary`；复刻源码 `.qw-card` 基类本身静态、反馈逐元素叠加工具类。我方规格：hover = 边框加深（ResourceCard 既有 `hover:border-muted-foreground/40` 保留）+ 卡片 shadow-sm + 行操作显现（既有 group-hover）；pressed = 卡片/磁贴 `translate-y-px`、小按钮 `active:scale-95`；选中 = 磁贴中性底（§3）；内容槽切换 = 150ms fade + 2px 上浮同 easing（display 切换触发）；`prefers-reduced-motion: reduce` 关闭位移与动画。原型 v2 已演示，证据截图 `/tmp/state-tile-hover.png`、`/tmp/state-tile-pressed.png`、`/tmp/state-card-hover.png`。

---

## 7. 迁移与门禁影响

1. `app.tsx`：layout route 包五分类；新路由 + redirect/反转表（§2.3）。
2. 子页去 chrome 下沉：res-list（拆 models/providers/tools/mcp/knowledge 五块）、data 页；wf-connections 适配设置分区；rules/forms 改路由前缀。
3. 设置分区表（settings.tsx:37-45）注册「连接」；`computeActiveNav` 特例删除；Workflow activePrefixes 扩展。
4. 顺带修复：res-list.tsx:45 tab 校验只认 `tool|model` 致旧 redirect 回落首 tab（09 §8-6）——随页面拆分退役，体现为 redirect 映射单测。
5. 门禁：check-ui-standard 无新增；check-visual-regression 资源域+设置域基线重拍+逐屏签字；四主题断言覆盖壳与设置连接页。
6. RBAC：磁贴按既有权限过滤；Skills 复用 tool 档不新增权限位。

---

## 8. 分期

- **P1 壳化+搬家（无新功能）**：ResourcesShell 五磁贴；Connections→设置；rules/forms→Workflow 域；redirect/反转；面包屑与点亮；子页去 chrome。验收：五分类壳内切换不丢壳；旧链全命中；Connections 按钮数前后对账相等；门禁全绿。
- **P2 Skill 一等化**：§5 全量。验收：§5.4 五条。
- **P3 归位收尾**：模型接入子 tab 定型、Runtime Providers 移设置-执行策略（Q5）、数据资产/datasource 归属终判（Q8）。验收：路由表逐条对账。

每期独立验收+基线重拍+回滚快照（prototype-before-dev 闸门）。

---

## 9. 开放问题状态

| # | 问题 | 建议 | 状态 |
|---|---|---|---|
| Q1 | 壳化立项 | 立项，按 §8 三期 | **待拍板**（本文档 v2 + 原型评审） |
| Q2 | 磁贴选中态视觉 | 一期中性底；色彩方案留设计侧 | 待设计 |
| Q3 | Workflow 进壳？ | 不进 | **已决**（用户 09-07：不展示） |
| Q4 | Connections 安全注记 | 随页迁设置，工具条保留一行 | **已决**（随 G4 闭环） |
| Q5 | Runtime Providers 归位 | 设置-执行策略分区 | 待拍板 |
| Q6 | 定义组形态 | 取消定义组 | **已决**（用户 09-07：规则/表单出壳） |
| Q7 | 规则/表单新归宿 | Workflow 域（路由+点亮+面包屑） | 待拍板（建议已给） |
| Q8 | datasources 是否随 Connections 归设置 | 留在数据资产分类 | 待拍板（建议已给） |

---

## 10. 原型说明

`docs/v3-design/prototypes/resources-shell-v1.html`（v2 形态，自包含单文件）：

- 72px 窄轨（选中/hover 同底中性、字重区分）+ 壳三层结构；
- **五磁贴**壳内切换（Skills / 模型接入 / 工具与 MCP / 知识库 / 数据资产），无 Workflow/规则/表单/连接入口；
- Skills：工具条/来源筛选/卡片/挂载 chips/挂载 Dialog/注记；模型接入：接入渠道表格+模型目录卡片；其余分类为下沉形态演示；
- 右上主题钮 light/dark（token 与 index.css 同源子集）；
- 数据为示意（dev 库台账口径），非承诺值。

---

## 11. 实施记录（09-07 夜批：P1+P2 落地，P3 留下批）

**服务端**：
- `agent_runtime.py`：`build_mounted_skills_section()`——agent_skill 一等挂载注入 SKILL.md 正文（8000 字符截断+注记），遗留 config.skills 名字占位按名去重；`#skill:` mention 展开改查注册表描述；
- `routers/agents.py` mounts-health：config.skills 名字对照注册表（未注册 valid=False，旧"恒 True"契约废止，test_agent_runtime 同步更新）；
- `routers/agent_caps.py` 新增 `skills_router`：`GET /api/skills/mounts`（skillId→挂载 Agent 反查 join）；
- `routers/admin.py`：ModelProvider 补 PUT/DELETE（DELETE 被模型引用 409 PROVIDER_IN_USE；baseUrl 过 mock:// 门禁）；
- 迁移 `g048skillseed0001`：仓内两份 SKILL.md 种子为 builtin（wf_dev+wf_test 双库已跑；幂等、缺文件跳过）。

**前端**：
- `components/app/resources-shell.tsx`：持久壳（页头+五磁贴 NavLink+计数 hook+内容槽 slot-in 150ms）；
- `pages/res-skills.tsx`：Skills 分类页（来源筛选/卡片/挂载 chips 跳 Agent/查看 Drawer/上传 Dialog 含 .md 文件读取/挂载 Dialog 差量 install-uninstall/空态）；
- `pages/res-category-pages.tsx`：模型接入（接入渠道表格 CRUD + 模型目录）/工具与 MCP/知识库/数据资产；
- `pages/res-list.tsx` 重写为 `ResCategoryList`（去 PageHeader，操作集不变）；旧 Hub 门厅 `resources-hub.tsx` 删除；
- `pages/wf-connections.tsx` 抽出 `WfConnectionsContent(embedded)`；设置新增「连接」分区（`fixedSection` 路由 /settings/connections）；
- 路由：壳子路由五分类；`/resources/ai` 按 tab 映射 redirect；`/resources/connections`→`/settings/connections` 反转；rules/forms→`/workflows/rules|forms`（旧路由 PrefixRedirect 保链）；导航点亮/面包屑同步（app-sidebar/app-shell/ui-terms）。

**证据**：
- pytest 全量 **437 passed**（含新增 tests/test_skill_shell.py 5 条：正文注入/截断+去重/校验转真/mention/mounts）；
- typecheck 绿；check-ui-standard 绿（file input 改命令式创建，allowlist 未增）；check-theme4-nav 36/36；
- 5199 验收栈实测截图：/tmp/v-shell-skills.png（壳+种子 Skill）、v-shell-models.png（真 dashscope 渠道）、v-settings-connections.png（设置内连接+安全注记）、v-shell-dark.png（暗色）；
- 窄轨点亮矩阵程序化验证：/settings/connections 无一级点亮、/resources/skills→资源、/workflows/forms→流程、/resources/ai?tab=tools→redirect 后资源；
- check-visual-regression 本批**跳过**：其目标栈 5173/8100 非验收栈，且四屏基线为 designer 屏（canvas/drawer），不受本批影响；资源域新屏基线补拍留 P3 批次与逐屏签字一并做。

**P3 待办**：Runtime Providers 移设置-执行策略（Q5）；datasources 归属终判（Q8，现状留数据资产）；资源域视觉基线补拍+签字；磁贴选中色彩方案（Q2 设计侧）。

### 11.1 浏览器实操复审修复（09-07 用户质疑"详情查看和新建完全有问题"后真机逐流程复核）

- **BUG-1 详情 Drawer 空正文**：前端读 `metadata.content`，服务端详情正文在 `config.content`（metadata 仅 category/source/chars）→ 改读 `config.content ?? metadata.content`；实测内置 skill 4866 字符正文渲染；
- **BUG-2 编辑 Dialog 空预填**（同根因，保存会清空正文，危害更大）→ 同修；实测预填 4866 字符；
- **GAP-3 被挂载删除仅 toast**（§5.4-4 要求阻断 Dialog 列挂载方）→ 复用 DeleteBlockedDialog 呈现 agent_skill refs（label=Agent 名，点击跳 Agent 详情）；实测阻断 Dialog 列出「业务分析-通话打标-OpenAI」；
- 复核通过项：新建（字段/保存/新卡/新卡 Drawer 正文）、挂载 Dialog（真 Agent 清单+差量安装/卸载）、卸载后删除成功（API 验证 remaining=[]）、全程无 console error；
- 探针教训：删除成功与否不可用 body 文案包含 skill 名判定（toast 命中误报），须 API 复核。
