# 资源管理（AI Resources / Data Resources）— 需求理解与前端原型

> 输入：`doc/AI_Resources_Data_Resources_Requirement_V0.1.docx`（Frozen）+ `doc/Resource_Management_Design_Spec_V1.4.docx`（Design Baseline）
> 日期：2026-08-23 · 阶段：需求理解 + 原型设计（**未改动任何产品代码**）

## 目录

> **本期正式文档（评审反馈 + drill 结论后）：`01-requirement.md`（需求）· `02-design-spec.md`（设计 Spec）· `03-backend-frontend-design.md`（前后端功能设计）。** `00-` 为早期理解稿，开放问题已在 01 中闭环。
>
> **实施状态（2026-08-23）：P1–P6 全部交付并验证。** 后端 38/38 pytest 绿（含 test_resources/test_p5_nodes 新增 10 例）；前端 `tsc && vite build` 绿；浏览器实测：列表真实数据、分域向导全流程（测试门禁→启用→回跳高亮）、`/config/tools` 重定向、数据定义页存量回填、新节点定义下发。未提交 git，待验收。

| 文件 | 说明 |
|---|---|
| `01-requirement.md` | 本期需求 V1.0：反馈 8 条 + drill 3 结论闭环（分域向导/类型筛选/Connection 中心化/Definition 独立实体/完整节点联动/收敛重定向） |
| `02-design-spec.md` | 设计 Spec V1.0：IA/路由/页面/组件/状态/交互矩阵 |
| `03-backend-frontend-design.md` | 工程 V1.0：数据模型+migration、Resource Registry、引用扫描/删除防护、test executor、API 契约、节点联动、分期 P1–P6、测试计划 |
| `00-requirement-understanding.md` | 需求理解（早期稿）：资源域/边界、IA 变化、字段口径、状态与交互规则、开放问题清单 |
| `prototype/index.html` | 原型首页：页面索引、导航 IA 前后对比、关键设计决策 |
| `prototype/ai-resources.html` | AI Resources 列表（4 Tabs / 操作菜单 / 测试 / 停用 / 删除防护） |
| `prototype/data-resources.html` | Data Resources 列表（Datasources / Data Assets + 数据链路说明） |
| `prototype/wizard.html` | 创建向导四步全流程（六类表单切换、测试失败重试） |
| `prototype/detail-tool.html` | 详情（有版本类型：Versions 时间线 + Usage 引用表） |
| `prototype/detail-datasource.html` | 详情（无版本类型：凭证掩码 + 变更记录变体） |
| `prototype/components.html` | 组件规范（卡片解剖 / 状态体系 / 空态 / 菜单 / 测试对话框四态） |

## 查看方式

浏览器直接打开 `prototype/index.html` 即可（纯静态，无需服务器/网络）。
如需本地服务：`cd uiux/prototype && python3 -m http.server 8080`。

## 原型说明

- 视觉 1:1 复刻现有产品：shadcn 中性主题 tokens、窄轨导航壳、`PageHeader`/`FilterBar`/`Badge`/卡片网格规格均取自 `src/` 现实现。
- 可交互：Tabs、⋯ 操作菜单、测试对话框（含失败态）、停用/启用、删除拦截与确认、向导步骤与类型表单切换、搜索筛选。
- 刻意安排的演示分支：「工单系统查询 / 客服会话记录」删除被拦截；「浏览器操作 MCP」测试失败；「短信通知 / http-crm-api」无引用可直接删除；向导选择 MCP Server 类型可见测试失败重试流。
