# Module Agent · R4 UI 设计稿（原型先行，待交互确认）

状态：**待用户确认**（闸门：原型全覆盖+对账 → 逐节点确认 → 开发）
日期：2026-08-29｜参考图：AgentHub 配置页（用户 08-29 提供）

## 1. 原型清单（uiux/prototypes/）
| 文件 | 覆盖 |
| --- | --- |
| `module-agent-config-v3.html`（08-29，对位用户参考图） | Agent 配置页高保真：深色左导航/头部版本对照卡/六 Tab/四分区卡（身份可编辑、模型、指令只读+业务定位追加、资源冻结只读）/右侧测试面板（环境=Release 绑定选择、会话+质检摘要+工具调用/上下文/Trace 折叠、usage 行） |
| `module-agent-config.html`（v2·shadcn 对账稿） | 配置页另一稿+发布对话框（版本描述→环境→Runtime Provider 绑定→灰度）+运行观测/版本/评测 Tab |
| `module-agent-r4-screens.html`（v1） | ① Module Catalog ② Providers 管理页 ③ Run Detail 增强 ④ 任务执行目标步骤 |

浏览器打开三个 HTML 即可评审。

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

## 5. 参考图对齐决策（08-29 用户指示"参考这个画原型"后采纳）
1. 配置页以参考图布局为准（v3）：六 Tab、编号分区卡、右侧测试面板、头部 Draft/Last-published 对照。
2. Instructions 区参考图为可编辑大编辑器+变量 chips——本平台语义为 **Module 资产只读**（橙色提示条），实例仅追加"业务定位"；变量 chips 只读展示 Module 输入 Schema 字段。
3. 右侧测试面板环境选择=Release 绑定（沙箱 AgentScope / 沙箱 DSH 灰度 / 线上），草稿预览须选 Provider（R3 语义）。
4. 评分展示标注"规则派生"（Agent 不算分，平台 Scorecard 派生）。

## 6. 剩余产品默认（如无异议即按此开发，改口随时调）
1. 任务向导默认版本策略=**最新沙箱发布**。
2. Providers 页放**资源中心新 Tab**（与 Connections/Tools 同级）。
3. 预览调试首期=发样例输入→结构化输出+调用记录（无流式打字机）。
4. 发布对话框灰度比例**两类 Provider 都展示**（DSH 默认 0 且提示"实验通道"）。
5. Run Detail 阶段表中文文案：识别/计划/执行/屏障/总结（两 Provider 统一）。
