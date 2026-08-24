# Evidence Ledger（证据台账）

> 证据分类规则（任务书 §5）：Observed-UI / Observed-Network / Observed-Source / Inferred / Designed / Unverified。
> 本台账记录每条证据的来源、时间、取证方式与限制。冲突不静默裁决，记录于 §4。

## 1. 调研基线

| 项 | 值 | 标记 |
|---|---|---|
| 目标产品 | 瓴羊 quickService 配置中心 · Agent（新版）工作台 | Observed-UI |
| 产品地址 | https://config.quickservice.lydaas.com | Observed-UI |
| 登录方式 | 用户在 ZCode 内置浏览器（IAB）手动登录，未索取凭证 | Observed-UI |
| UI 调研时间 | 2026-08-21 15:30–16:00（本地） | Observed-UI |
| Sim 仓库 | /Users/rivers/ZCodeProject/sim，branch=main，commit=2d2b8a5930，git status 干净 | Observed-Source |
| Sim 形态 | bun+turbo monorepo：apps/ packages/ openapi/ docker/ helm/ | Observed-Source |
| 我方技术栈 | 前端 Vite+React19+TS+@xyflow/react+shadcn；后端 FastAPI+Pydantic+PostgreSQL+SQLAlchemy+Alembic | Designed（冻结） |

## 2. UI 证据（Observed-UI）

截图位于 `evidence/screenshots/`（编号沿用采集顺序）。

| 截图 | 步骤 | 关键事实 |
|---|---|---|
| 01-workflow-editor-initial.png | 进入编辑器 | React Flow 画布；顶栏=返回/名称+待发布标签/自动保存时间戳/检查/历史/保存/发布；底部悬浮工具条（添加节点/缩放/试运行）；minimap |
| 02-add-node-panel.png | 添加节点 | popover 两组：信息处理(12 项)/代码编辑(2 项)；无搜索、无最近使用 |
| 03-llm-node-config.png | 大模型节点 | 右抽屉≈335px；单次/批处理 Tab；模型/输入/提示词/输出四分区；选中节点蓝环+▶+… |
| 04/05 | 提示词"#"尝试 | 富文本编辑器对自动化输入无响应；行为以页面提示文案为准（Unverified 弹层） |
| 06-variable-ref-picker.png | 变量引用 | 值列=输入框+⚙；菜单含"系统变量 >"级联；新增行含−删除 |
| 07/08 | 级联/删除取证 | 级联子级与删除交互对自动化不友好（Unverified） |
| 09-plugin-node-config.png | 插件工具节点 | 工具建节点时绑定（来源:插件市场/插件名称）；输出 schema 树；流式输出 switch |
| 10-classifier-node-config.png | 问题分类 | 分类行=拖拽把手+名称(0/20)+描述+删除；校验 alert"请输入分类名称"；必填 *query |
| 11-code-node-config.png | 代码编写 | 内嵌深色 IDE（行号+Python 模板 args/ret）；"代码编辑器"外开按钮 |
| 12-test-run-panel.png | 试运行 | 前置校验红 toast"请先配置节点"，阻断运行 |
| 13/14 | 单节点▶ | 无可见反馈（Unverified 原因） |
| 15-publish-attempt.png | 发布 | 软警告模态"发布前未试运行"：试运行/继续发布/取消 |
| 16-history-panel.png | 历史版本 | 右抽屉"历史版本"，空态"暂无历史版本" |
| 17-badge-icon-panel.png | 检查 | "检查(9)"popover：节点未连接完整/节点未完整配置 清单；红点=问题数 |
| 18-workflow-list.png | 列表 | 卡片网格；搜索/全部/降序/管理标签/+创建工作流(黑)；卡=状态#未发布+更新时间+自主创建 |
| 19-tools-page.png | 工具页 | Tab 工具插件/MCP插件；调用日志/管理标签/+创建插件 |
| 20-tool-call-logs.png | 调用日志 | 新标签页；搜索工具编码+归属插件/调用应用筛选+时间范围(默认15min)+8 列表 |
| 21-system-settings.png | 系统设置 | 8 组配置菜单 |
| 22-plugin-management.png | 插件管理 | 平台插件卡=设置/停用；已启用/已停用分区 |
| 23-mcp-plugins-tab.png | MCP Tab | 存在未展开（内容 Unverified） |

页面级 URL 事实（Observed-UI）：列表 `/intelligent-agent/ui/agent_store/blank/newWorkFlow`；编辑器 `.../newWorkFlowDetail?processId=<id>`；工具 `.../pluginBase`；日志 `.../McpUseLog?type=service`；系统设置 `/system-settings(/200150063/200150107)`。

## 3. Network 证据（Observed-Network）— 第三轮 CDP 采集成功

- 采集物：`evidence/network/quickservice-capture-sanitized.json`（117 条，脱敏）；`flow-detail-decoded-dsl.json`（DSL 全文）。
- 过程：IAB 内置浏览器两次被拒（§3 旧记录见 capture-attempt-log 第 2/4b 节）→ 用户授权后改用独立 profile Chrome + `--remote-debugging-port=9222`，我经 CDP 采集并自动执行安全操作序列；凭证零留盘。
- 核心事实（详见 02）：
  - 端点：flow_list / flow_detail / workflow_history/page_query / queryAgentCustomNodesApi / 插件目录 / 插件调用日志 / requiredLock+closeLock（wsId 悲观锁）/ isSigned / user-tenants。全 POST+mopen RPC 信封；workflow 域不走 GraphQL。
  - DSL：`{nodes, edges, checkList}`；节点=React Flow 原始序列化（UI 态混存）+ `data.nodeDetail` 分型配置；nodeType 枚举 start/end/llm/plugin-tool/code/question-classifier/variable-handle/execution_workflow；变量引用 `#<nodeId>_$.path`（isRef/constantValue 二态）；checkList 随 DSL 持久化；定义以 base64(gzip(JSON)) 传输。
  - 保存/创建：flow_saveOrUpdate 统一端点，draftVersion 自增；requiredLock ~2s 心跳续锁。
  - **Run/事件协议（v7 补采，Observed）**：TEST 工作流真实试运行 → `POST /quick/agent/workflow/sse/start`（text/event-stream）；整包实例快照 ~2Hz 推送；agentNodeExecLogList 内嵌节点级 nodeInput/nodeOutput/status(success|running)/executeTime/tokens；门禁链=check_workflow_tryRunning_api→调试配置面板(agent_param_list)→开始运行。模型目录=kbsListAllAvailableLlm。
  - 遗留未取证：发布端点、status 数值码表、条件分支边样本（见 02 §6）。
  - 副作用声明：创建了 TEST-网络采集-勿用 工作流（明确标记，可删）；试运行消耗一次平台 LLM 调用（测试性质，用户授权"执行测试运行"）。

## 7. 第二轮补采（Agent 层，2026-08-21 20:0x–20:3x）

- 范围：创建 Agent 三型弹窗；对话编排编辑器（palette 四组/Agent 配置信息/运行观测 Tab）；自主规划编辑器（角色模板/挂载/预览调试双模型）；资源页（知识库/技能/标签管理）；Agent 层端点（save_agent_config 等，02 §3b）。
- 捕获文件：`quickservice-capture-agent-sanitized.json`（多轮累积）。
- 专家组编辑器内部：**Unverified**（列表横滚+只读入口自动化未打通；创建卡插画与列表标签为证）。
- 变量选择器弹层：仍未完整取证（Picker 打开态 dump 未捕获），机制以引用语法+Start 公共参数+用户确认为准。
- 副作用：自动创建 2 个未命名草稿 agent（`对话编排agent_HapIrsTp1787314834614`、`对话编排agent_HOJdSwxN1787314947698`，另 dOZzeSeu 疑似同轮），均可在"我的Agent"列表删除；未发布、未运行（自主规划型编辑器为只读进入）。

## 8. 第三轮深跑（三型运行，2026-08-21 21:3x–22:0x）

- 对话编排：新建 TEST agent（HOJdSwxN）内嵌流加 LLM+条件节点、连线、配置模型/提示词；条件构建器（引用变量⚙/条件关系/比较变量）与"不能重复连线"toast 取证；最终经列表体验框 chat 运行成功（SSE：开始→大模型→结束 全 success）。
- 专家组：wFMGapml 经 chat 运行成功（SSE：开始→结束）。
- 自主规划：编辑器配置面（角色模板/挂载/预览调试双模型）已取证；运行未自动化成功（体验页登录墙），标 Unverified/Inferred 同端点。
- 工作流试运行 SSE（POST /quick/agent/workflow/sse/start 整包快照+agentNodeExecLogList）于早期轮次实测解析；捕获文件按轮覆盖，正文以 02 §3c 表格留存。
- 环境限制记录：共享 Chrome 窗口尺寸/DPR 波动导致坐标漂移，用 Emulation.setDeviceMetricsOverride 固定视口后稳定；多开标签后 CDP 通道退化（Network.enable 超时），自动化终止于 R27。
- 新增副作用：第三轮又创建若干草稿 agent（HapIrsTp 等，见列表），均未发布，可删。

## 4. 证据冲突记录

| 主题 | 冲突 | 处理 |
|---|---|---|
| 单节点▶无反馈 | UI 未见反馈 vs 预期应弹输入/运行 | 不裁决，标 Unverified；设计侧按"应给反馈"做 Designed |
| 变量行−删除 | 截图可见−图标 vs 点击/ dom_cua 均无效 | 标 Unverified；推测唯一行禁用（Inferred） |

## 5. Sim 证据（Observed-Source，已完成）

由两个后台只读 Agent 产出（Sim @ main 2d2b8a5930，全程未改 Sim 文件）：
- `evidence/sim-part-a-editor-registry.md` — 三态 DSL、通用节点组件、六大 Registry、校验纯函数。
- `evidence/sim-part-b-runtime-infra.md` — DAG 执行链、PG async_jobs 队列、外部 cron 调度、SSE+轮询、五类云端归属。
汇总于 `03-sim-source-architecture-study.md`；取舍入 04/08/09/10。关键澄清：Sim **不用 Convex**（仅作为被集成工具）。
独立验收：`evidence/reviewer-report.md`（无 P0；P1 四条已修复于 02/05/07/11/contracts）。

## 6. 未验证清单（Unverified）

运行中画布状态；节点级 Run 日志 UI；版本回滚；"#"变量弹层；变量级联子级；MCP Tab 内容；单节点运行反馈；quickservice 全部请求 method/body/事件协议；Sim 云端依赖细节（待 Agent B）。

## 7. Round-5（2026-08-23，三型 Agent 编辑器）

新增 Observed：专家组抽屉全字段树 + save_agent_config 契约 + flow_saveOrUpdate(base64+gzip 图) + flow_detail + /api/observation/dashboard + 专家组 palette 7 型 + 自主规划无画布（表单+五类挂载+预览调试多模型对比+更新发布）+ 锁提示模态 + 挂载「已失效」态。详见 `17-round5-agent-editors-study.md`、`evidence/network/r5-*.json`、`evidence/screenshots/r5-*.png`。
仍 Unverified：自主规划预览 SSE 事件字典、专家组试运行 SSE（Inferred 同 chat SSE）。专家组三节点抽屉已于 Round-5b 经 CUA 升级为 Observed（见 17 §6）。
调研副作用：专家组画布曾残留 6 个空壳测试节点，用户刷新后画布已恢复 2 节点（干净）。
