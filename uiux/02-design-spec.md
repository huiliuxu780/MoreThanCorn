# 资源管理一期 · 设计 Spec（Design V1.0）

> 视觉与组件基线：现有产品 shadcn 中性主题 + 窄轨导航壳（`src/` 现实现，1:1 复刻，不引入新视觉语言）。
> 可交互原型：`uiux/prototype/`（本文档描述与原型的差异处以「Δ」标注，原型已同步修正）。

---

## 1. 设计原则

1. **统一骨架、强类型内容**：列表/卡片/详情/向导六类共用；类型差异只出现在 Icon、副标题、Metadata、表单字段、测试方式。
2. **连接信息归 Connections**：任何 endpoint+凭证都在 Connection；资源卡片/详情只展示引用名与掩码。
3. **状态双轨**：生命周期（Enabled/Disabled）× 健康度（Healthy/Degraded/Error）；颜色仅辅助，文字始终在。
4. **破坏性动作必有出路**：删除拦截要给引用清单与解决路径，不静默置灰。
5. **动作有去向**：每个写操作完成后明确落在哪一页/哪一 Tab/什么反馈（需求 §3.7 矩阵）。

## 2. IA / 导航 / 路由

窄轨（w-20，icon+短标签，组间分隔线）调整后：

```
智能质检   概览 / 结果 / 坐席            （不动）
配置管理   任务 / Agents / 工作流
           AI Resources（新，短标签「AI资源」）
           Data Resources（新，短标签「数据资源」）
           数据定义 / 规则               （不动）
系统设置   连接                          （Models 入口移除）
```

| 路由 | 页面 | 说明 |
|---|---|---|
| `/config/ai-resources` | AI Resources 列表 | `?tab=models\|tools\|mcp\|ks` |
| `/config/ai-resources/new` | 创建向导（scope=ai） | Δ 分域 |
| `/config/ai-resources/:type/:id` | 资源详情（AI 四型） | type ∈ model/tool/mcp/knowledge |
| `/config/data-resources` | Data Resources 列表 | `?tab=datasources\|assets` |
| `/config/data-resources/new` | 创建向导（scope=data） | Δ 分域 |
| `/config/data-resources/:type/:id` | 资源详情（数据两型） | |
| `/config/data-assets` | 数据定义（Definition 管理） | 现有路由，实体切换为 Definition |
| `/config/data-assets/:defId` | 数据定义编辑器 | 现有编辑器迭代 |
| `/config/tools`、`/settings/models` | **重定向** | → `/config/ai-resources?tab=tools\|models` |
| `/config/tools/:toolId` | 重定向 | → `/config/ai-resources/tool/:toolId` |

## 3. 页面设计

### 3.1 列表页（两页同构）

```
PageHeader  标题 + 域说明（含引用链/数据链一句话）      [创建资源]（携带 scope）
Toolbar     [搜索] [状态▾] [健康度▾ | 类型▾(仅 Datasources)] …… 共 N 个资源
Tabs        类型 + 计数徽标
CardGrid    1/2/3/4 列响应式
Pagination  复用现有分页组件
```

- Δ Datasources Tab 的 Toolbar 第二筛选为**类型**（MySQL/PostgreSQL/对象存储/HTTP API）。
- 卡片结构同原型 components.html §1；hover 出 ⋯ 菜单；整卡点击进详情。
- 新建回跳：目标卡片 2s 高亮环（`ring-2 ring-foreground/30`）+ Toast「已创建 · 查看详情」。

### 3.2 创建向导（Δ 分域）

- 入口携带 scope；Step1 只列本域类型卡（AI 4 / Data 2），卡上标注「支持版本/无版本」。
- Step2 类型表单字段矩阵见 03 文档 §6；需要连接的类型含 Connection 选择器 + 「＋ 新建 Connection」内嵌 Sheet（保存后自动选中）。
- Step3 测试面板：类型化测试描述 + 输入（可编辑 JSON）+ 执行；**无「跳过」控件**；失败显示错误 + 「返回修改」；通过才解锁「保存并启用」。
- Step4 摘要（类型/名称/状态/引用=暂无）+ [查看详情] [返回资源列表]。
- 步骤指示器：已完成步骤可点击回退；回退不丢表单状态。

### 3.3 详情页

- Header：Icon 44px + 名称 + 双徽章 + meta（类型·版本·创建/更新时间）+ 动作 [测试][编辑][⋯ 停用/删除]。
- 内页 Tabs：Overview / Configuration / Usage / Versions|变更记录。
- Overview：描述 + 基本信息 kv + 最近测试面板（时间/结果/延迟）。
- Configuration：代码块只读（spec/连接配置）；凭证行掩码 + 轮换按钮；有版本类型提示「修改将产生新草稿版本」。
- Usage：引用表（Workflow×Version×节点×Agent×最近运行）+ 统计卡（调用次数/成功率/P95，tool/model 真实聚合）；数据型为下游对象表。
- Versions：时间线（当前实心点）+「基于 vN 创建新版本」；变更记录型为审计表（时间/操作人/变更）。

### 3.4 Connections 页升级

- 列表增加「协议类型」列与类型筛选；表单 Sheet 增加协议类型 + 结构化 endpoint（按协议切换字段：base_url | host+port | bucket | command）。
- 增加「被引用」视图入口（行内显示引用数，点击弹引用清单）；被引用删除 409 拦截对话框（同资源）。
- 文案更新：「各类资源的连接信息中心：endpoint + 认证（AK/SK、API Key…），凭证加密不回显」。

### 3.5 数据定义页迭代

- 列表：Definition 行（名称 / 所属 Asset / Lifecycle / Revision / 字段数 / 被任务引用数）+ Asset 筛选 + 搜索。
- 编辑器：现有 schema 表格编辑 + eligibility 编辑保留；头部增加「所属 Data Asset」选择（先选 Asset 才能编辑 schema 的自动拉取按钮：从 Datasource 抽样推断字段，可手动改）。
- 发布动作：Draft → Ready（revision+1），Deprecated 可恢复。

## 4. 组件清单（实现命名）

| 组件 | 文件（建议） | 说明 |
|---|---|---|
| ResourceCard | components/resources/resource-card.tsx | 原型 §1 解剖 |
| ResourceTabs | …/resource-tabs.tsx | 计数徽标 + URL tab 同步 |
| ResourceStatusBadge | …/status-badge.tsx | 双轨状态 |
| ResourceActionMenu | …/action-menu.tsx | 菜单 + 删除拦截分发 |
| ResourceTestDialog | …/test-dialog.tsx | 四态 |
| ResourceCreateWizard | pages + components/resources/wizard/* | 分域四步 |
| ResourceDetailLayout | …/detail-layout.tsx | Header + 内页 Tabs |
| ConnectionPicker | …/connection-picker.tsx | 选择+内嵌新建 |
| 各类型 Form | …/forms/*.tsx | 六类 |

## 5. 状态与徽章体系

| 状态 | 维度 | Badge | 触发 |
|---|---|---|---|
| Enabled / Disabled | 生命周期 | success dot / neutral dot | 停用启用操作 |
| Healthy / Degraded / Error | 健康度 | success / warning / danger | Test 或巡检写入 |
| Draft / Ready / Deprecated | Definition & Asset lifecycle | info / success / neutral | 发布流 |

卡片右上优先显示生命周期；健康度异常（Degraded/Error）时替代显示健康度（信息优先）。

## 6. 交互矩阵（与需求 §3.7 一致，补充细节）

- 搜索 300ms 防抖，与 URL `search` 同步（复用 useListQuery）。
- Tab 切换写 URL `tab`，刷新/回退不丢上下文；重定向路由携带 tab。
- 测试执行中按钮 spinner + 禁用；结果面板成功/失败两态；成功后健康度即时刷新。
- 删除拦截对话框「查看引用方」按类型跳转：AI 型 → Workflow 详情定位节点；数据型 → 下游 Asset/Definition/任务列表。
- 空态三态：无资源（引导创建）/ 筛选无结果（清除筛选）/ 加载骨架（CardGridSkeleton）。

## 7. 原型差异同步（Δ 已落地）

1. `wizard.html`：按 `?scope=ai|data` 分域展示类型卡（默认 ai；data 入口只见 Datasource/Data Asset）。
2. `data-resources.html`：Datasources Tab 增加类型筛选（全部类型/MySQL/PostgreSQL/对象存储/HTTP API）。
