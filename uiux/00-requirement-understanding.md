# 资源管理（AI Resources / Data Resources）— 需求理解

> 输入文档：`doc/AI_Resources_Data_Resources_Requirement_V0.1.docx`（Frozen，产品需求）、`doc/Resource_Management_Design_Spec_V1.4.docx`（Design Baseline，设计规范）
> 产出日期：2026-08-23 · 阶段：需求理解 + 前端原型设计（不含代码实现）

---

## 1. 背景与目标

平台现有「配置管理」区已包含 分析任务 / Agents / 工作流 / Tools / 数据定义 / 结果规则，「系统设置」区包含 Connections / Models。这些资源散落在不同入口，缺少统一的资源模型与管理体验。

本期目标（Design Spec V1.4 §设计目标）：

> 建设**统一资源管理前端**，覆盖 **AI Resources** 与 **Data Resources**。
> 技术栈：React、TypeScript、Tailwind、shadcn/ui。

即：把「Agent 执行所依赖的 AI 能力」与「分析任务/评测所依赖的数据」收敛为两个强类型资源域，提供统一的列表、卡片、创建向导、详情与生命周期操作。

## 2. 资源域与边界（Requirement V0.1）

### 2.1 两个资源域

| 资源域 | 消费者 | 资源类型 | 版本机制 |
|---|---|---|---|
| **AI Resources** | Agent 执行过程 | Models、Tools、MCP Servers、Knowledge Sources | Tool → ToolVersion；Model → Model Version；MCP Server、Knowledge Source **无版本** |
| **Data Resources** | 分析任务、Evaluation Agent | Datasources、Data Assets | 均**无版本**机制 |

### 2.2 关键边界

1. **Data Definition 不属于 Resource。** 数据链路为：
   `Datasource → Data Asset → Data Definition → Analysis Task`
   Data Definition 挂在 Data Asset 之后、分析任务之前，是"任务侧"的定义物，不进资源管理。
2. **Agent 不直接保存 Resource 引用。** 引用链固定为：
   `Agent → Workflow → Workflow Version → Node Config → Resource`
   因此资源的「被使用（Usage）」统计口径 = 被哪些 Workflow Version 的 Node Config 引用。
3. **强类型资源模型。** 不做万能 Resource 表；由 Resource Registry 负责注册、查询、状态管理、引用管理。前端对应为：每类资源有独立表单与元数据字段，但共享统一的卡片/详情/操作骨架。

### 2.3 统一的创建与操作约定

- **创建**：统一 Wizard —— `选择资源类型 → 填写类型表单 → 测试 → 保存`（对应 Design Spec：Select Type → Configure → Test → Complete）。
- **操作**：Edit、Test、Disable、Delete；**使用中的 Resource 不允许删除**。
- **页面结构**：统一 `Header + Toolbar + Tabs + Card Grid`。
- **Detail**：统一 `Resource Header → Overview → Configuration → Usage → Versions`。
- **Design System**：shadcn 风格 Card / Tabs / Dialog / Badge / Form，统一 Empty State、Loading、Status。

## 3. 页面清单与信息架构

### 3.1 路由

| 页面 | 路径 | Tabs |
|---|---|---|
| AI Resources 列表 | `/config/ai-resources` | Models · Tools · MCP Servers · Knowledge Sources |
| Data Resources 列表 | `/config/data-resources` | Datasources · Data Assets |
| 创建向导 | 列表页触发（Dialog/页内向导） | Select Type → Configure → Test → Complete |
| 资源详情 | `/config/ai-resources/:type/:id`、`/config/data-resources/:type/:id`（原型阶段示意） | Overview · Configuration · Usage · Versions/变更记录 |

### 3.2 导航（IA）变化 — 需求文档目标树

```
配置管理
├ 分析任务
├ Agents
├ AI Resources
│   ├ Models
│   ├ Tools
│   ├ MCP Servers
│   └ Knowledge Sources
└ Data Resources
    ├ Datasources
    └ Data Assets
```

对照现有单层窄轨导航（app-shell AppRail），原型采用的调整方案：

| 现导航 | 调整后 | 说明 |
|---|---|---|
| 配置管理 › Tools | 移除独立入口 | 收敛为 AI Resources 页内 Tab |
| 系统设置 › Models | 移除独立入口 | 收敛为 AI Resources 页内 Tab |
| 配置管理 › 数据定义 | 保留（开放问题，见 §6） | 需求文档的导航树未列出它 |
| — | 新增「AI Resources」「Data Resources」两个窄轨项 | 页内用 Tabs 区分子类型 |
| 系统设置 › Connections | 保留 | 数据源连接与 Datasource 的关系见 §6 |

窄轨（w-20，icon+短标签）保持不变，仅增删条目 —— 与现有 `dashboard-sidebar-04` 同构结构一致。

### 3.3 统一组件清单（Design Spec V1.4）

| 组件 | 职责 |
|---|---|
| `ResourceCard` | 统一卡片：Icon + Status / Name / Description / Metadata / Usage |
| `ResourceTabs` | 列表页类型 Tab（含计数） |
| `ResourceStatusBadge` | 状态徽章（统一状态语义与配色） |
| `ResourceCreateDialog` | 四步创建向导 |
| `ResourceDetailLayout` | 详情骨架：Header + 内页 Tabs |
| `ResourceActionMenu` | 卡片/详情的操作菜单（Edit / Test / Disable / Delete） |
| `ResourceTestDialog` | 连通性/可用性测试对话框 |
| 各类型 Form | ModelForm / ToolForm / McpServerForm / KnowledgeSourceForm / DatasourceForm / DataAssetForm |

## 4. 各类型资源字段理解（原型取值依据）

以下为基于两份文档 + 现有系统（Models/Tools/Datasources 现状）推导的展示字段，供原型取值，最终以实现期字段定义为准：

| 类型 | 卡片 Metadata | 卡片 Usage | 测试方式 |
|---|---|---|---|
| Model | Provider、Model Key、能力标签（chat/json…） | 被 N 个 Workflow Version 引用 · 7 日调用量 | 发送最小 ping 请求，返回延迟与响应 |
| Tool | Kind（builtin/http）、当前版本号 | 同上 | 以样例入参执行一次，校验输出 |
| MCP Server | Transport（stdio/http）、Endpoint/Command、工具数 | 同上 | 握手并拉取 tool list |
| Knowledge Source | 类型（向量库/文档库）、切片数、Embedding 模型 | 同上 | 检索一次样例 query |
| Datasource | 类型（MySQL/PostgreSQL/OSS/HTTP…）、Endpoint | 下游 Data Asset 数 · 最近检测时间 | 执行连通性检查（如 `SELECT 1`） |
| Data Asset | 所属 Datasource、一条数据代表什么、记录量级 | 下游 Data Definition 数 · 被分析任务引用数 | 抽样读取 N 条，校验字段映射 |

## 5. 状态与交互规则（原型落地口径）

文档未给出完整状态机，原型采用如下口径（开放问题，见 §6）：

- **生命周期状态**：`Enabled`（可用，emerald）/ `Disabled`（已停用，neutral）。所有类型共有。
- **健康状态**：`Healthy` / `Degraded` / `Error`，来自最近一次 Test 或巡检（沿用现有 data-assets 的 Health 语义），与生命周期正交展示。
- **测试中**：Test 执行为即时态（按钮 loading + 结果面板），不落库为新状态；测试失败不自动停用，只把健康度置为 `Error` 并提示。
- **删除防护**：被任意 Workflow Version Node Config（AI Resources）或下游 Data Asset / Data Definition（Data Resources）引用时，删除按钮点击后弹出「不可删除」说明（列出引用方），而非静默置灰。
- **Disable**：停用不影响已有引用记录，但在 Workflow 节点选择器中不可再被新选；详情页 Header 显示停用态。

## 6. 开放问题（需要产品/架构确认，不阻塞原型）

1. **导航树差异**：需求文档的配置管理树只列了 分析任务 / Agents / AI Resources / Data Resources，未包含现有「工作流」「结果规则」「数据定义」。原型按「保留现有入口 + 新增两个资源入口」处理。是否最终收敛？
2. **现有「数据定义 /config/data-assets」页**：与新的 Data Resources › Data Assets 是不同层概念（见 §2.2 链路）。现有页面文案为「数据定义」，但实体名为 DataAsset —— 建议实现期明确：现有页面保留并正名为「数据定义（Data Definition）」，新 Data Asset 实体独立建页。
3. **现有 Tools / Models 页与数据**：迁入 Resource Registry 后，`/config/tools`、`/settings/models` 旧路由是否保留重定向？
4. **Connections 与 Datasource 的关系**：现有系统设置中的 Connections（外部连接）与 Data Resources 的 Datasource 存在概念重叠，需要确认 Datasource 是否复用 Connection 或独立建模。
5. **Wizard 的 Test 步骤**：是否允许跳过？原型默认「必须测试通过才能保存为 Enabled」，失败可回改。
6. **无版本类型的 Versions Tab**：MCP Server / Knowledge Source / Datasource / Data Asset 无版本机制，详情页最后一屏用「变更记录」代替还是直接隐藏？原型采用「变更记录」。
7. **Usage 统计口径**：卡片上的「7 日调用量」依赖运行数据，本期是否只做静态引用数？原型两者都展示，调用量标注为示意。

## 7. 原型交付物索引

见 `uiux/README.md` 与 `uiux/prototype/`（浏览器直接打开 `prototype/index.html`）。

| 文件 | 覆盖 |
|---|---|
| `index.html` | IA 前后对比、原型入口、设计决策 |
| `ai-resources.html` | 列表页（4 Tabs + 卡片 + 操作菜单 + 测试对话框 + 删除防护） |
| `data-resources.html` | 列表页（2 Tabs + 数据链路说明） |
| `wizard.html` | 创建向导四步全流程（含类型表单切换、测试步骤） |
| `detail-tool.html` | 详情页（有版本类型：Versions 时间线 + Usage 引用表） |
| `detail-datasource.html` | 详情页（无版本类型：变更记录变体） |
| `components.html` | 组件规范：卡片解剖、状态体系、空态/加载、测试对话框四态、删除拦截 |
