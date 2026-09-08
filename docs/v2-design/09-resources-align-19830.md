# 09 · 「能力与资源」对比分析：我方资源域 vs QoderWake（19830）

> 日期：2026-09-07 · 状态：**仅分析，未改代码** · 目的：评估"把多个页面合并进一个大的【能力与资源】"的可行性与取舍
>
> 证据来源：
> - 原站截图 `~/qoderawake0905/research/capture-20260906/08-resources-skills.png`、`09-resources-skills-mine.png`、`10-resources-connector.png`（2026-09-06 抓取，与线上 19830 一致）
> - 原站源码 `~/qoderawake0905/src/src/app/resources/{skills,connector}/page.tsx`、`src/components/overlays.tsx`（安装弹窗）、`src/components/layout/GlobalSidebar.tsx`
> - 原站调研 `~/qoderawake0905/research/qoderwake/02-qoderwake-information-architecture.md`
> - 我方代码 `src/app.tsx`、`src/components/app/app-sidebar.tsx`、`src/pages/resources-hub.tsx`、`src/pages/res-list.tsx`、`src/pages/wf-connections.tsx` 等（行号见正文）

---

## 0. 结论摘要（TL;DR）

1. **"合并进一个大的能力与资源"这件事，我方在一级层面已经做完了**：导航五项之一「能力与资源」→ `/resources` Hub（6 磁贴 + 真实计数），旧路由全部 redirect 收口（MTC-006/006R）。原站在一级层面和我们同构。
2. **真正的差异在二级**：原站的磁贴是**同一页面壳内的分类切换器**（页头「能力与资源」+ 磁贴行 + 下划线 tab 始终在屏），我们的磁贴是**跳走到独立页面的链接**（进入子页后 Hub 壳消失，只剩面包屑维持身份）。用户感受到的"他这个设计很好"，核心是这一层**壳的持续性**。
3. 原站的深层模型是**市场安装制**（逛市场 → 选 Waker → 安装），我方是**配置管理制**（创建 → 测试 → 启停 → 版本 → 引用）。市场制我方**没有供给端**（无外部目录），整套照抄会出现空的市场 tab；但其中的三个子模式可以借：市场/我的 ≈ 平台内置/自建、安装到 Waker ≈ 挂载到 Agent、左栏分类带计数。
4. 推荐路线 **A（壳化）+ 局部借 C（分类轴清理）**：把 `/resources/*` 包进一个持久壳布局（页头 + 磁贴行 + 内容槽），子页内容原样下沉；不动导航五项、不动 canonical 路由、不动后端。市场制（路线 B）不采纳，仅借其子模式。

---

## 1. 原站现状：【能力与资源】长什么样

### 1.1 IA 位置

- 全局侧栏分两组：「工作管理」（任务看板/@Waker/自主工作）、「员工资源」（Waker 管理/**能力与资源**）。能力与资源是全局**唯一**资源入口，href `/resources/skills`，激活规则 `pathname.startsWith("/resources")`（GlobalSidebar.tsx:34,41）。
- Waker（员工）作用域内还有**第二级**「能力与资源」分区：Skill / 连接器 / WakerFlow / 知识库 / 项目（02-IA.md；WakerSidebar.tsx:24-33）。即资源有**全局市场面**和**单员工已装面**两个视角。

### 1.2 页面壳结构（skills 与 connector 两页同构）

自上而下四层，**全部子页共享同一壳**：

1. **PageHeader**：标题恒为「能力与资源」+ 副标「释放你的 Waker 潜能，解锁更多可能」（skills/page.tsx:32）。
2. **入口磁贴行**：5 张横排磁贴 = Skills / 连接器 / 知识库 / WakerFlow / 公开项目（mock-data.ts:400-406）。磁贴 = 32px 圆角图标块（选中态换品牌色底：Skills 粉底、连接器紫底）+ 标题 + 一行描述；选中磁贴加边框+投影。溢出时变左右箭头轮播（截图 10）。**磁贴点击只换下方内容，不换页壳**（URL 在 /resources/* 内切换）。
3. **下划线 tab**：每个分类一对「市场 / 我的」——技能市场|我的技能、连接器市场|我的连接器（skills/page.tsx:64；connector/page.tsx:72）。
4. **内容区**：
   - 市场 tab = 左 199px 分类栏（搜索框 + 分类列表带计数，如「DevOps 与部署 12623」）+ 右卡片网格（Skills 4 列 / 连接器 3 列）。Skill 卡 = 图标+名称+「推荐」绿标+三行描述+作者+下载量；连接器卡 = 图标+名称+描述+「+」安装钮或「全部 Waker 已安装」绿 chip。
   - 我的 tab = 右对齐工具条（搜索 + 「来源 全部」筛选 + 黑底主按钮「上传 Skill」）+ 空态文案「还没有安装或上传 Skill」（截图 09）。

### 1.3 安装动作 = 绑定到员工

- Skill 安装弹窗：大图标 + 名称 + 推荐 chip + 更新/作者 + 描述 + 「Skill 说明」区；**页脚 = 「选择 Waker」下拉 + 安装按钮**（未选 Waker 时按钮置灰）（overlays.tsx:586-640）。
- 连接器安装弹窗：居中小弹窗，双图标「A + B」示意连接，「安装 {name}」+ 描述 + **「选择一个或多个 Waker」多选 + 安装**（overlays.tsx:642-690）。
- 角色创建弹窗里同样有「技能(0) 插件市场选择/上传Skill」和「MCP(0) 添加 MCP」两块（overlays.tsx:436-460）——**MCP 在原站归入连接器/能力装配语境，从不单独成一级概念**。

### 1.4 原站模型一句话

> 资源 = 可逛的市场商品；价值终点 = 装到某个 Waker 身上；全局页是货架，员工页是背包。

---

## 2. 我方现状：资源域长什么样

### 2.1 一级入口（已合并，与原站同构）

- 导航五项冻结：任务 / 自主任务 / Agent / **能力与资源** / Workflow（app-sidebar.tsx:50-93）；「能力与资源」→ `/resources`，activePrefixes 覆盖 `/resources`、`/config/ai-resources`、`/config/data-resources`、`/config/data-assets`、`/config/result-rules`、`/settings/connections`（:77-84）。
- Hub 页 = 6 磁贴卡片网格：AI 资源 / 数据资源 / 连接 / 结果规则 / Workflow 输入表单 / Workflow，每卡带**真实计数 + 消费规模引用数**（resources-hub.tsx:36-102）。**这一点比原站强**：原站磁贴无计数，我方磁贴是活的仪表盘。
- 旧路由全部 redirect 收口到 `/resources/*`（app.tsx:151-166），canonical 化已在 MTC-006R 完成。

### 2.2 二级 = 各自独立的全页面

| 磁贴 | 落地页 | 页内结构 |
|---|---|---|
| AI 资源 | `/resources/ai` | 顶部 tab：Models / Tools / MCP Servers / Knowledge Sources / Runtime Providers（表格面板）；卡片网格 4 列；筛选=搜索/状态/健康度；分页 12/页（res-list.tsx:24-32） |
| 数据资源 | `/resources/data` | tab：Datasources / Data Assets，其余同上 |
| 连接 | `/resources/connections` | 按协议分 tab + 卡片网格；生命周期+健康度双徽章；创建/编辑/轮换/清凭据全 Dialog（wf-connections.tsx:300-624） |
| 结果规则 | `/resources/rules` | 表格列表 + 版本化编辑器 `/resources/rules/:id` |
| 表单 | `/resources/forms` | 卡片网格 + 三栏 FormBuilder 编辑器 |
| Workflow | `/workflows` | 卡片网格 + ReactFlow 设计器（**独立一级导航项**） |

- 每种资源有**详情页**（Overview/Configuration/Usage/Versions 四 tab，res-detail.tsx:139-232）与**四步创建向导**（选类型→配置→测试→完成，测试不可跳过，res-wizard.tsx:32,79-129）。
- **MCP** = AI 资源页的一个 tab（mcp-servers collection），是一等管理对象：有健康探测、stdio/http 配置、被设计器 McpToolPicker 消费（designer/inspector/data-hooks.ts:12-28）。
- **Connections** = 凭据/端点基础设施层：多环境域名、AkSk 鉴权脚本沙箱、secret 轮换/清除；被 Runtime Providers 与资源向导以 ConnectionPicker **引用**（runtime-providers-panel.tsx:210-217；res-wizard.tsx:240-243）。
- 资源与 Agent/Workflow 的关系 = **全局注册表 + 引用**：设计器/Agent 编辑器经 `/api/registry/resources` 拉 Enabled 资源做选择器；详情页 Usage tab 反向列出消费方。

### 2.3 我方模型一句话

> 资源 = 平台托管的配置实体；价值终点 = 被 Workflow/Agent 引用跑起来；生命周期（测试/启停/版本/引用）是一等公民。

---

## 3. 逐项对比

| 维度 | 原站 19830 | 我方 | 评价 |
|---|---|---|---|
| 一级入口数 | 1（能力与资源） | 1（能力与资源） | **平** |
| Hub 磁贴 | 5，无计数，纯入口 | 6，带真实计数+消费规模 | **我方强** |
| 磁贴语义 | 页壳内分类切换（壳不消失） | 跳独立页面的链接（壳消失） | **原站强** ← 用户感知点 |
| 页头身份 | 「能力与资源」标题+副标全子页常驻 | 仅面包屑+导航高亮维持 | **原站强** |
| 分类轴 | 磁贴=资源种类；左栏=市场话题分类（带计数） | Hub 磁贴=管理域；页内 tab=资源种类 | 轴不同，原站多一层"话题" |
| 市场/我的 | 每分类一对 tab（市场=供给，我的=已装/已传） | 无；只有"全部列表+状态筛选" | 模型差异（见 §4.2） |
| 资源归属 | 安装到 Waker（员工背包） | 全局实体 + Usage 反向引用 | 模型差异（见 §4.3） |
| 生命周期深度 | 无（市场 mock：安装即终点） | 创建向导/测试/启停/版本/引用阻断删除 | **我方强得多** |
| MCP 归属 | 连接器语境/角色装配块，不独立 | AI 资源页一等 tab，有健康探测 | 我方更重，合理（真运行时） |
| Connections 归属 | 「连接器」= 外部服务市场卡（钉钉/Notion…） | 独立页 = 凭据/多环境基础设施 | **概念不同名同**（见 §4.4） |
| Workflow 归属 | WakerFlow = 能力与资源磁贴之一 | 独立一级导航项 | 决策点（见 §7-Q3） |
| 安装/创建交互 | 弹窗内选 Waker → 安装 | 四步向导（测试强制）→ 落库 | 我方重但必要 |
| 空态/上传 | 我的 tab 有上传主按钮+空态 | 列表页有新建入口，空态较弱 | 原站略强 |

---

## 4. 设计差异的本质（三个心智模型差）

### 4.1 壳持续 vs 页跳走（布局层，最值得学）

原站把「能力与资源」做成**一个应用内的小应用**：页头、磁贴行、tab 条是常驻 chrome，内容槽换片。用户在任何深度都知道"我在能力与资源里，当前在连接器分类"。我方 Hub 是一次性门厅：进门后磁贴和计数就没了，子页各自为政（列表页 chrome 互不相同：tab 顶置 vs 协议 tab vs 纯表格）。**这是"他这个设计很好"的主要来源，也是合并诉求的真正落点。**

### 4.2 市场安装制 vs 配置管理制（供给层，不能照抄）

原站有 43646 个 Skill 的供给端，"市场/我的"才有意义。我方资源全部内部创建，若加"市场"tab 将是空壳。但有一个**真实对应物**：我方 tools 分 `builtin`（平台内置目录）与 `http`（自建），models 来自 provider 注册表——这正是"平台供给 vs 我的"。可把市场/我的模式**降维借用**为列表页的「内置 / 自建」来源筛选或 tab，而不是照搬市场。

### 4.3 员工背包 vs 全局引用（归属层，方向相反但可互补）

原站资源装到 Waker；我方资源全局存在、被 Workflow/Agent 引用，Usage tab 反向可见。我方模型对"共享复用+治理"更友好，不应改。可借的是**反向入口**：原站安装弹窗的"选择 Waker"≈ 我方"挂载到 Agent"——可在资源详情/列表加"挂载到 Agent"快捷动作，把引用关系从"设计器里挑"前移到"资源侧推"，补齐 Agent 员工卡与资源域的双向链路。

### 4.4 同名不同物：连接器 ≠ Connections（概念层，需显式区分）

原站「连接器」= 外部 SaaS 能力卡（钉钉/Notion/Vercel），装完即获得工具；我方 Connections = **凭据与端点 substrate**（AKSK、多环境域名、鉴权脚本），被 MCP Server / Runtime Provider / Datasource 引用，本身不直接产出能力。若合并时把两者混为一谈会污染安全边界（Secret 治理、EnvPatch 禁写 Secret 等门禁挂在 Connections 上）。**合并展示可以，合并概念不行**：壳内 Connections 分类应保留独立的安全语义与操作集。

---

## 5. 值得借鉴清单（按性价比排序）

1. **持久壳布局**（§4.1）：`/resources` 壳 = 页头 + 磁贴行 + 内容槽；6 磁贴改为壳内切换；子页去掉各自页头重复 chrome。收益：身份持续、合并感、与原站同构；成本：一个 layout route + 子页去 chrome。
2. **分类栏带计数**：原站左栏「分类 + 计数」与我方 Hub 磁贴计数同源；壳化后可把各分类计数常驻磁贴（现在已有），并在列表页左侧加类型/状态分类栏（带计数），替掉部分顶置 tab。
3. **内置/我的 来源轴**（§4.2）：tools/models 列表加来源筛选，对齐"市场/我的"的信息价值而不造空市场。
4. **挂载到 Agent 快捷动作**（§4.3）：资源侧主动推送引用，补双向链路。
5. **我的 tab 的空态与上传主按钮**：我方列表空态偏弱，可借其"搜索+来源筛选+主按钮"工具条形态。
6. **磁贴选中态的色底图标**：原站选中磁贴图标换品牌色底（粉/紫），比我方纯边框选中更易扫读；可纳入主题 token 复用（注意品牌绿退役"选中"职责的 09-06 夜决议——磁贴选中若用色底需走中性或分类色，需设计确认）。

## 6. 不值得照抄清单

1. **市场供给端**（43646 商品、作者、下载量、推荐位）：无供给即空壳。
2. **安装到 Waker 作为主归属**：与我方全局注册表+Usage 治理模型冲突，改归属会动 RBAC/引用完整性/删除阻断一整条链。
3. **双 240px 侧栏**：原站 Waker 作用域第二侧栏；我方导航冻结 72px 窄轨五项（拍板记录在案），Agent 作用域已有 LifecycleShell 三 tab，无需再套侧栏。
4. **把 MCP 藏进连接器**：我方 MCP 是真运行时端点（健康探测/stdio/http/工具清单拉取），一等 tab 是正确的；原站藏法源于其市场 mock 深度不足。

---

## 7. 合并方案选项与推荐

### 路线 A（推荐）：壳化合并 —— 一个壳，六分类，深度保留

- 新增 `/resources` layout shell：PageHeader（能力与资源 + 副标）+ 磁贴行（6，带计数，壳内切换）+ 内容槽。
- 现有 6 个子页**内容原样下沉**进槽：res-list / connections / rules / forms / workflows-list 去掉各自页头，保留 tab、筛选、网格、表格与全部操作。
- 路由不变（`/resources/ai` 等 canonical 保持，MTC-006R 成果不动）；仅 app.tsx 套 layout。
- 详情页/向导/编辑器**不进壳**（它们是任务流不是浏览流），面包屑回壳。
- 成本：1 个 shell 组件 + 5 个子页去 chrome + 磁贴改 NavLink；门禁影响面：check-ui-standard（磁贴组件复用现有卡片标准）、visual-regression（资源域 4 屏基线需重拍）。

### 路线 B（不推荐）：全市场制改造

加市场/我的 tab + 安装到 Agent 弹窗。空市场 + 归属模型冲突，收益为负。仅吸收其子模式（§5-3/4/5）。

### 路线 C（可选叠加）：分类轴清理

壳内 6 磁贴按层重排并显式分组标注：能力层（AI 资源/数据资源）· 连接层（连接）· 定义层（结果规则/表单）· 编排层（Workflow）。或进一步把 AI+数据两页合成一个「资源」分类、页内 6 类型 tab（现状两页 tab 本就同构，res-list.tsx:24-36）。注意：定义层两件套（规则/表单）是业务治理产物，与"能力"语义有距离，合进同一磁贴组需在页头副标或分组标签上说清。

### 开放决策点（需拍板）

- **Q1**：路线 A 是否立项？立项则出 SDD（壳组件规格 + 子页去 chrome 清单 + 基线重拍计划）。
- **Q2**：磁贴选中态视觉（色底图标 vs 现状边框）——受 09-06 夜"品牌绿退役选中职责"决议约束，需设计侧给中性/分类色方案。
- **Q3**：Workflow 是否从一级导航收进能力与资源磁贴（原站 WakerFlow 在资源内）？收则导航五项变四项，触碰冻结拍板；**建议不收**——我方 Workflow 是生产主线（设计器+运行观测），体量远超原站 WakerFlow 磁贴，Hub 磁贴保留入口即可。
- **Q4**：Connections 在壳内的安全语义标注（凭据层徽标/独立操作集）是否随壳化一并显式化。

---

## 7.5 范围收敛补充（09-07 用户追加）：Skill 一等支持 + 模型接入开放问题

用户补充口径：**不需要原站那么多东西；至少支持 Skill；模型接入形态未定。**

### 7.5.1 Skill 现状：半截骨架，升级路径天然

- **运行时只认名字不认内容**：Agent config `skills: []` 为纯名字列表；`agent_runtime.py:252-255` 仅把名字拼进 system prompt「## 挂载技能」；`#skill:name` mention 展开时 desc 回退为名字本身（:237-238）——**SKILL.md 正文从未被加载**。
- **校验形同虚设**：`routers/agents.py:270-271` 对任意 skill 名字一律 `valid: True`，无注册表对照。
- **真资产已存在但未接线**：`server/app/agent_modules/business_analysis/skills/native-business-analysis/SKILL.md`、`poc/agent_runtime_providers/independent_agents/skills/consumer-analysis/SKILL.md` 等（另质检一份，见 memory agent-inventory-and-skills）；全 server 无代码读取这些文件。
- **结论**：Skill 一等化 = 把"名字占位"升级为"内容包资源"：资源实体 {name, description, content(SKILL.md), source: builtin|uploaded, version}；挂载到 Agent 时注入正文（挂载即显式 opt-in，token 成本可控）；校验改对照注册表；资源壳加「Skills」磁贴（我的技能列表 + 上传 + 挂载动作）。**市场 tab 不做**（无供给端），与原站差异仅缺货架，不缺背包。

### 7.5.2 模型接入现状：三层链是好的，未定的是 UI 归位

现状链：Connections(llm 协议凭据) → ModelProvider(baseUrl + auth_connection_id) → Model(provider_id + model_key + capabilities, versioned)。Wizard 模型步 = providerId + modelKey（res-wizard.tsx:35,85）。门禁在位：生产禁 mock:// provider（admin.py `_assert_no_mock_base`）。

**隐患（对比中发现）**：`/resources/ai` 页内「Models」tab 与「Runtime Providers」tab 并排，但两者是不同轴——ModelProvider=模型接入渠道，RuntimeProvider=Agent 执行运行时（AgentScope/DSH 端点）。同名"providers"并置是真实混淆源，壳化时必须拆开。

三个立场：
- **立场 1（推荐）**：壳内设「模型接入」磁贴 = 两个子 tab：接入渠道（providers：baseUrl+凭据引用+健康）/ 模型目录（models：key/capabilities/版本/被引用）。三层链与 API 不动，纯 UI 归位。
- **立场 2**：Provider 并入 Connections（llm 协议连接即渠道，模型目录挂连接下）。概念更纯但动 ModelProvider 表/API/向导，成本大，暂缓。
- **立场 3**：原站式隐藏（平台托管不暴露）。不可行：真多供应商 key 与治理需要可见性（memory real-llm-configured）。
- **Runtime Providers 归位**：执行运行时属 Agent 域基础设施，建议移出资源壳（去 Agent 页或设置），不与模型接入混居。开放问题 Q5。

### 7.5.3 收敛后的壳磁贴建议（6→6，换血而非扩容）

Skills（新）/ 模型接入（models+providers 合并归位）/ 工具与 MCP（原 AI 资源两 tab 合一）/ 知识库 / 数据资源 / 连接。
结果规则与表单 = 定义层，建议降为壳内「定义」分组磁贴或并入 Workflow 磁贴组（Q6）；Workflow 磁贴保留入口、一级导航不动（Q3 建议不变）。

## 8. 风险与约束清单

1. 导航五项冻结（72px 窄轨拍板在案）：壳化不动导航，安全。
2. `/resources/*` canonical 与 redirect 表（app.tsx:138-166）为 MTC-006R 验收成果：壳化不得改路由语义。
3. 视觉回归门禁：资源域属 4 屏基线范围，壳化后需重拍基线 + 逐屏签字。
4. check-ui-standard allowlist 只减不增：壳内新组件须走标准件（shadcn Tabs/Card），禁手搓。
5. Connections 安全门禁（Secret 治理/EnvPatch/沙箱）挂在页面操作集上：下沉进壳时操作集必须原样保留，不得为统一 chrome 删按钮。
6. 已知小 bug 顺带记录（不在本次范围）：res-list.tsx:45 tab 校验只认 `tool`/`model`，旧 redirect 传 `tab=tools`/`tab=models` 会回落首 tab。
