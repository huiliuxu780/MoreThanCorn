# Module Agent · R4 UI 设计稿（原型先行，待交互确认）

状态：**待用户确认**（闸门：原型全覆盖+对账 → 逐节点确认 → 开发）
日期：2026-08-29｜参考图：AgentHub 配置页（用户 08-29 提供）

## 1. 原型清单（uiux/prototypes/）
| 文件 | 覆盖 |
| --- | --- |
| `module-agent-config.html`（已有，v2·shadcn 对账稿） | Agent 配置页（身份/模型/Spec 摘要/资源只读/版本对照/发布对话框含 Runtime Provider）、运行观测、版本与发布、效果评测 |
| `module-agent-r4-screens.html`（本稿新增 v1） | ① Module Catalog（列表+创建流程+封存区）② Runtime Providers 管理页 ③ Run Detail 增强 ④ 新建质检任务·执行目标步骤 |

浏览器打开两个 HTML 即可评审；本稿后附交互确认清单。

## 2. 参考图（AgentHub）对齐与取舍
| 参考图元素 | 取舍 |
| --- | --- |
| 左侧 Module 内导航（Overview/Instructions/Resources/Memory/Runtime/Versions） | 收敛为四 Tab：配置/运行观测/版本与发布/效果评测（与平台现有 Agent 页信息架构一致；Memory/Runtime 归入"配置"分区卡） |
| Agent identity 分区卡（名称/描述+字数） | 采纳 |
| Model & reasoning（模型/推理力度/温度） | 采纳（模型来自 registry；参数经 AgentSpec.model.parameters 冻结） |
| Instructions 大编辑器+变量 token | **只读展示**（Module 资产，实例仅可追加"业务定位" purpose——SDD 10 R2 已定：criteria/工具/主数据不可实例改写） |
| Resources 卡（Tools/Knowledge/MCP/Skills） | 采纳为只读（Module 冻结的逻辑工具+主数据；引用指向资源中心） |
| 右侧 Test Agent 面板（会话+Tool Calls+Context+Trace+Run） | 采纳为"预览调试"：选择沙箱 Release 绑定的 Provider 试运行，展示 usage/tool calls/trace；草稿预览须选 Provider（R3 语义） |
| Draft vs Last published + Compare | 采纳（版本对照复用现有 agent-version-diff） |
| Publish 按钮下拉 | 采纳：发布对话框=版本描述→部署环境→**Runtime Provider 绑定（必选）**→灰度比例 |

## 3. 调研对齐（00–14）
- 运行观测指标口径（token/calls/P95）沿用调研 07 §6；Run Detail 三层结构（阶段→调用→结果）对应 Trace/Span 设计。
- 配置页分区卡+右侧测试面板形态已在配置页原型 v2 按 shadcn tokens 对账。

## 4. 屏幕清单与关键交互（两份原型合计）
1. Catalog：Module 卡片网格+「已封存」折叠区；新建=选 Module→基本信息→模型→Spec 知会→创建。
2. Providers：列表（健康真实探测值）+注册/编辑抽屉（Connection 引用凭据、config 禁密钥由后端校验）+探测/停用（admin+审计）。
3. Run Detail：执行目标/Runtime 版本/耗时 Token 三卡 + 阶段表（Trace CONTROL）+ CallRecord 表（脱敏详情）+ 派生质检结果卡（评分标注"规则 V3 派生"）+ 复核状态。
4. 任务向导：执行目标二选一（Workflow 现状保位）；Agent 目标=仅列 Module Agent+版本策略三选+确认页展示全部冻结值。
5. 配置页（见 v2 原型）：四 Tab+分区卡+右侧预览调试+发布绑定。

## 5. 交互确认清单（请逐条拍板）
1. Catalog 新建流程四步（选 Module→基本信息→模型→Spec 知会）是否 OK？Spec 摘要"仅知会不可改"是否符合预期？
2. Run Detail 用表格式阶段列表（识别/计划/执行/屏障/总结）——DSH 的阶段名一致，是否需要统一中文文案表？
3. 任务向导默认版本策略=最新沙箱发布，是否改为最新线上？
4. Providers 页放在资源中心新 Tab（与 Connections/Tools 同级）还是 Agents 区？
5. 预览调试（参考图右侧面板）首期只做"发一条样例输入→看结构化输出+调用记录"，不做流式打字机，是否 OK？
6. 发布对话框灰度比例仅对 DSH 类 Provider 展示（AgentScope 首期稳定通道），还是两类都展示？
