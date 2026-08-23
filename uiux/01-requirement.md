# 资源管理一期 · 需求文档（Requirement V1.0）

> 上游文档：`doc/AI_Resources_Data_Resources_Requirement_V0.1.docx`（Frozen）、`doc/Resource_Management_Design_Spec_V1.4.docx`（Design Baseline）
> 前置产出：`uiux/00-requirement-understanding.md`（理解稿）、`uiux/prototype/`（原型）
> 本文档合并 2026-08-23 评审反馈 8 条与 3 项 drill 结论，作为本期实施唯一需求口径。

---

## 1. 背景与目标

平台已具备 Workflow 内核、Agent 三型、分析任务、质检业务层与 FastAPI 后端（`server/`）。本期建设**统一资源管理**：把 Agent 执行与分析任务依赖的能力/数据收敛为强类型资源域，提供统一的列表、向导、详情、生命周期操作，并**打通后端与 Workflow / 任务 / 评测模块的联动**（资源可管理、可测试、可被节点消费、可被引用保护）。

## 2. 术语与资源域

| 概念 | 定义 | 本期动作 |
|---|---|---|
| **AI Resources** | Agent 执行过程使用的 AI 能力：Model、Tool、MCP Server、Knowledge Source | 新建统一列表/向导/详情 |
| **Data Resources** | 分析任务与 Evaluation Agent 使用的数据：Datasource、Data Asset | 新建统一列表/向导/详情 |
| **Data Definition** | 挂在 Data Asset 之下、面向任务的字段语义层（schema + eligibility + revision） | **独立实体**，由现有「数据定义」页迭代而来 |
| **Connection** | 通用连接信息中心：endpoint + 认证（AK/SK、API Key、Bearer、Basic 等），凭证加密不回显 | 现有页**升级为全资源类型通用**，不合并、不删除 |
| **Resource Registry** | 资源注册/查询/状态/引用管理服务端模块 | 新建 |

链路边界（Frozen）：
- 数据链：`Datasource → Data Asset → Data Definition → Analysis Task`；Data Definition 不属于 Resource。
- 引用链：`Agent → Workflow → Workflow Version → Node Config → Resource`；Agent 不直接持有资源引用。
- 版本策略：Tool（ToolVersion）、Model（Model Version）有版本；MCP Server / Knowledge Source / Datasource / Data Asset 无版本，用**变更记录**审计。

## 3. 功能需求

### 3.1 AI Resources 列表（/config/ai-resources）

- 结构：Header + Toolbar + Tabs + Card Grid（Spec V1.4 冻结）。
- Tabs：Models / Tools / MCP Servers / Knowledge Sources，带计数。
- Toolbar：搜索 + 状态筛选（Enabled/Disabled）+ 健康度筛选（Healthy/Degraded/Error）。
- ResourceCard 统一骨架：Icon+Status / Name / Description / Metadata / Usage（被引用节点数 + 7 日调用量，调用量来自 call_record 聚合，真实数据）。
- 操作菜单：查看详情 / 编辑 / 测试 / 停用·启用 / 删除（见 §3.7）。

### 3.2 Data Resources 列表（/config/data-resources）

- Tabs：Datasources / Data Assets。
- **Datasources Tab 必须支持按类型筛选**（MySQL / PostgreSQL / 对象存储 / HTTP API）+ 状态筛选 + 搜索（反馈#2）。
- Data Assets Tab：搜索 + 状态筛选；卡片展示所属 Datasource、一条数据代表什么、Lifecycle、下游 Definition 数。
- 页面常驻数据链边界说明（Datasource → Data Asset → Data Definition → Task）。

### 3.3 创建资源向导（反馈#1、#5-wizard）

- **同一套 UI，按域分入口**：从 AI Resources 进入只见 4 类 AI 类型；从 Data Resources 进入只见 2 类数据类型。不做跨域混合选择页。
- 四步固定骨架：Select Type → Configure → Test → Complete。
- Configure：六类强类型表单；需要外部连接的类型（Tool-http / MCP-http / Datasource / Model-Provider）在表单内**选择或新建 Connection**（内嵌轻量创建 Sheet）。
- **Test 步骤不可跳过**（反馈#5）：必须测试通过才能保存为 Enabled；失败可回上一步修改后重试。
- 保存成功 → 跳回来源列表页、激活对应 Tab、新卡片高亮 + Toast 带「查看详情」动作（反馈#6）。

### 3.4 详情页

- 统一骨架：Resource Header（Icon/Name/状态/操作）→ Overview / Configuration / Usage / Versions。
- 有版本类型（Tool/Model）：Versions 时间线（Published/Deprecated、Latest、基于当前版本建新草稿）。
- 无版本类型：第四屏为**变更记录**（资源变更审计：创建/配置变更/凭证轮换/停用启用）。
- Usage：引用方清单（Workflow Version × 节点 × 所属 Agent × 最近运行）+ 调用统计（tool/model 为 call_record 真实聚合；datasource/asset 为下游对象计数）。
- Configuration：只读展示 + 凭证掩码 + 「编辑」入口；有版本类型修改产生新草稿版本。

### 3.5 Connections 连接信息中心（反馈#5）

- 定位升级：各类资源的**连接信息（endpoint + 认证能力，AK/SK 等）统一存放处**；资源表只存 `connection_id` 引用，不存明文凭证。
- 连接增加协议类型：http-api / mysql / postgresql / oss / mcp-http / llm 等；endpoint 结构化（base_url 或 host/port/bucket）。
- 保留独立页面与独立测试（Test）；被资源引用时不可删除（沿用现有 409 模式）。
- **不与 Datasource 合并**：Datasource = 语义层（库/桶/路径 + 巡检），Connection = 连接层（地址 + 凭证）。

### 3.6 数据定义迭代（drill 结论：独立实体）

- 新建 `data_definition` 实体：`data_asset_id` + 字段 schema + eligibility + lifecycle（Draft/Ready/Deprecated）+ revision。
- 现有「数据定义」页（/config/data-assets）与编辑器**迭代为 Definition 管理入口**：列表按 Asset 分组/可筛选；编辑器承接现有 schema/eligibility/revision 能力。
- Data Asset（新薄实体）：name + datasource_id + 表/路径 + 一条数据代表什么 + 时间字段 + lifecycle/health；保留 `rows` 内联数据作为「手动/内置」来源（datasource_id 可空）。
- 分析任务向导第二步改选 **Data Definition**（带出 Asset 与 schema），复用现有 autoMapping / mappingIssues 逻辑；存量任务保留 data_asset_id 回落兼容。

### 3.7 生命周期与交互规则（反馈#6）

- 状态：生命周期 Enabled/Disabled 与健康度 Healthy/Degraded/Error 正交；测试失败只降健康度，不自动停用。
- 停用：保留数据与既有引用，禁止新引用（节点 picker 只列 Enabled）。
- **删除防护**：存在引用 → 拦截对话框列出引用方与解决路径（409）；无引用 → 二次确认删除。使用中永不物理删除。
- 动作去向矩阵：

| 动作 | 完成后去向 | 反馈 |
|---|---|---|
| 向导保存 | 来源列表 + 对应 Tab 激活 + 新卡高亮 + Toast(查看详情) | 反馈#6 |
| 详情内编辑保存 | 留在详情，Toast | 反馈#6 |
| 列表菜单编辑保存 | 回列表（原 Tab），Toast | 反馈#6 |
| 测试（对话框） | 留在原地，徽章/健康度即时更新 + Toast | — |
| 停用/启用 | 留在原地，卡片即时更新 + Toast | — |
| 删除确认 | 留列表，卡片移除 + Toast | — |
| 详情「查看引用方」 | 跳转对应 Workflow 详情/任务详情 | — |

### 3.8 Workflow 节点联动（drill 结论：完整联动）

- 内核新增两个节点类型：**knowledge-retrieval**（config: knowledgeSourceId/query/topK）与 **mcp-call**（config: mcpServerId/toolName/args）。
- 设计器新增对应 picker；llm 节点 model picker、tool 节点 tool picker 改由 Resource Registry 供给（仅 Enabled）。
- 发布 Workflow Version 时快照新增引用集合（mcp_refs / knowledge_refs），供引用扫描与删除防护。
- 校验器（validator）对新节点做必填与依赖校验（资源存在且 Enabled）。

### 3.9 导航收敛（drill 结论：收敛+重定向）

- 窄轨「配置管理」新增：AI Resources、Data Resources；**移除** Tools、Models 旧入口。
- 旧路由重定向：`/config/tools` → `/config/ai-resources?tab=tools`；`/config/tools/:id` → 对应详情；`/settings/models` → `/config/ai-resources?tab=models`。
- 工作流 / 结果规则 / 数据定义 / 连接等其余入口**一律不动**（反馈#3）。

## 4. 非功能需求

- 凭证：Secret 仅存 `secret_ref`（Secret Store），API 不回显明文；UI 掩码 ••••••••。
- 强类型资源模型：不建万能 Resource 表；Registry 提供统一查询门面。
- 外部依赖回落：与现有模式一致——配置真实 endpoint/驱动则真连，否则 mock 回落（模型/工具/数据源同策略）。
- 权限：沿用 rbac（resource.view / resource.manage 粒度按类型映射现有 permission）。

## 5. 验收清单（摘要，详表见 03 文档）

1. 两个列表页六类资源 CRUD + 筛选（含 Datasource 类型筛选）+ 分页 + 空态/骨架。
2. 向导分域、四步、Test 不可跳过、失败重试、保存回跳高亮。
3. 详情页双变体（Versions / 变更记录）+ Usage 引用表真实数据。
4. 删除防护：六类资源 × 引用来源全部 409 拦截并列出引用方。
5. Connections 升级：协议类型 + 结构化 endpoint + 被引用不可删；资源创建可内嵌新建 Connection。
6. 数据定义：Definition 实体 CRUD + 任务向导改选 Definition + 存量兼容。
7. 节点联动：knowledge-retrieval / mcp-call 可配置、可发布、可执行（mock 回落）；picker 只列 Enabled。
8. 导航收敛与重定向生效；旧 API 别名兼容。
9. 服务端测试全绿（存量 28/28 + 新增用例）。

## 6. 非目标（本期不做）

- 向量库真实嵌入/索引引擎（Knowledge Source 检索 mock 回落）。
- 健康度定时巡检调度（仅按需 Test + 手动；调度器下期）。
- RBAC 新权限模型重构（沿用现有）。
- 资源导入/批量注册、资源市场。
