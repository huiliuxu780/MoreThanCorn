# MTC-006R + MTC-007R + Theme-R + R4-Battery-R 返工验收文档

> 返工对象：`research/morethancorn/mtc003007-audit/MTC-002B-R4-TO-MTC-007-ACCEPTANCE.md`（REJECT）的五项最低门槛。
> 基线：`1ef4050`。返工提交（base..HEAD）：
>
> | Commit | 范围 |
> |---|---|
> | `0f12f3f` | fix(Theme-R)：设计器色板全 token 化 + 外观文案同步终版方向 |
> | `5aa89de` | refactor(MTC-007R)：Designer 物理拆分 + schema 单一配置路径 |
> | `526c385` | fix(MTC-006R)：资源域新产生链接一律 canonical /resources/* |
> | `41662ad` | test(MTC-002B-R4)：battery 脚本入库（固定 manifest + collected/passed） |
> | 本 commit | docs：返工验收文档与证据索引 |

## 门槛 1 — Designer 入口只保留组装职责（模块树与职责说明）

`src/features/designer/DesignerPage.tsx` 由 2840 行单体降为 ~440 行组装层（hooks 编排 + 模块挂载），
目录结构如下（每模块职责一句话）：

```text
src/features/designer/
├── DesignerPage.tsx            入口：ReactFlowProvider + DesignerInner 组装（选区/抽屉/pop 状态编排）
├── designer-types.ts           跨模块共享类型（NodeCfgLoose/WfNodeData/DrawerKind/props 契约）
├── node-meta.tsx               节点类型→图标映射 + 抽屉头部一句话描述（全节点单一来源）
├── toast.tsx                   设计器内 Toast（顶居中、status token 软底、2.5s 自隐）
├── use-designer-document.ts    文档编排：加载归一化/防抖自动保存/撤销重做/开始字段缓存注入
├── use-workflow-lock.ts        真实编辑锁（resource_lock；封存画布不取锁；强制解锁）
├── canvas/
│   ├── WorkflowCanvas.tsx      ReactFlow 受控组装（事件上抛、drop 换算、colorMode 跟随主题）
│   ├── WorkflowNodeCard.tsx    节点卡：摘要行/条件分支行/运行态边框/快捷+/试运行控制台
│   ├── WorkflowEdges.tsx       WfEdge→RF Edge（分支出边标签、token 线色/选中态）
│   ├── CanvasControls.tsx      左下角缩放控件（适应/放大/缩小/百分比）
│   └── WorkflowMiniMap.tsx     小地图（SVG attribute 场景按主题取成对具体值）
├── palette/NodePalette.tsx     左侧节点面板（可折叠+搜索；PaletteGroups 与快捷+共用）
├── inspector/
│   ├── NodeInspector.tsx       配置抽屉壳（头部/描述/问题清单 + 健壮性/输出变量统一区）
│   ├── SchemaInspector.tsx     唯一配置渲染器：resolveNodeSchema → Section × 注册表控件
│   ├── FieldControlRegistry.tsx x-control 注册表（33 个注册名 + 原语派生 + 回落留痕）
│   ├── inspector-types.ts      FieldControlProps/InspectorContext 契约
│   ├── data-hooks.ts           控件数据源（模型目录/MCP 工具/工作流/Agent 列表，真注册表）
│   ├── AgentConfigDrawer.tsx   旧 Agent 只读配置抽屉（知识兜底/成员池/记忆/对话体验）
│   └── controls/               primitives / pickers / editors / bindings / composites /
│                               condition-builder（专项交互全部以 x-control 注册）
├── schema/
│   ├── node-schemas.ts         前端控件目录 + 后端注册表 schema 合并解析 + x-show-if
│   └── node-schemas.test.ts    契约测试（注册完整性/合并语义/可见性，12 用例）
├── toolbar/
│   ├── DesignerTopbar.tsx      顶栏（返回/徽标/Agent 页签/检查/锁/保存/发布）
│   └── DesignerBottomToolbar.tsx 底部工具条（面板/撤销/缩略图/布局/缩放/搜索/试运行）
├── runtime/
│   ├── NodeRunState.ts         SSE 事件→画布运行态映射 + 订阅器
│   ├── use-run-session.ts      试运行会话（校验→启动→SSE；校验失败复位 running）
│   ├── WorkflowRunPanel.tsx    运行观测抽屉（列表/节点顺序/重试/导出）
│   ├── DebugRunDrawer.tsx      调试配置抽屉（开始 form 渲染/回退四字段+对话组）
│   ├── EvalPanel.tsx           工作流级效果评测（rule/model Judge + 人评覆盖）
│   └── EvoPanel.tsx            版本指标面板
├── dialogs/
│   ├── WorkflowHistoryDialog.tsx 历史版本抽屉（工作流/Agent 版本+部署徽标+对比入口）
│   ├── WorkflowMetaDialog.tsx  基础信息（名称/简介/图标=图标库+头像库）
│   ├── PublishWarnDialog.tsx   发布软警告
│   ├── NodeTestDialog.tsx      节点单测（mock 输入，不落 Run）
│   └── ScheduleDialog.tsx      定时任务抽屉
└── theme/workflow-theme.ts     主题桥接：useUiTheme + MINIMAP_THEME 成对值 + CodeMirror 模式
```

## 门槛 2 — 单一 schema-inspector 代码路径 + x-control 注册与测试

- 渲染路径唯一：`SchemaInspector` 消费 `resolveNodeSchema(type, 后端 def)`；
  Inspector 全链路（含 controls/）**不存在任何按 node type 的 if/switch 分叉**。
- schema 来源合并规则（schema/node-schemas.ts）：前端目录提供控件映射/分组/可见性/文案；
  后端注册表（server/app/registry.py）提供字段存在性与类型/枚举；后端独有键同路径追加；
  目录 `absorbs` 声明被复合控件统一管理的键（如 llm 的 outputFormat）；同键目录控件优先。
- 目录未覆盖类型（transform/reply/notification/create-record/agent 三键）直接渲染后端
  schema——同一 renderer，无第二路径。
- 专项交互=注册扩展：33 个 x-control（原语 8 + 选择器 11 + 编辑器 6 + 绑定 3 + 复合 12 +
  condition-builder），后端 registry.py 使用的 13 个 x-control 名全部在注册表内。
- 测试：`src/features/designer/schema/node-schemas.test.ts`（12 用例）断言
  「目录/后端每个 x-control 已注册」「原语派生名在注册表」「未知 x-control 回落原语」
  「absorbs 不双渲染」「目录控件优先」「24 个后端 type_key 全部可渲染」「x-show-if 语义」。
  `npm test -- --run`：46/46（原 34 + 新 12）。

## 门槛 3 — 深色 Workflow 全表面成立（同 workflow 同视口对照 + 自动断言）

- 门禁脚本：`scripts/verify-mtc007r-theme.mjs`，结果 **23/23 PASS**：
  - 静态扫描 42 个源文件（designer 全目录 + wf/controls + wf/sections + agent-ops-panels）
    无 Light-only 实色（bg-white/#fff/浅色面板 hex/旧蓝旧墨 hex/neutral 底/rgba(238,…)），
    白名单仅：theme/workflow-theme.ts 成对桥接值、控制台 `bg-white/10` 透明叠层；
  - 浏览器断言（1440×900，同一 workflow `2077152f…`）：
    Light root L=0.958、topbar/palette/card/toolbar/minimap/inspector L=1.000；
    Dark root L=0.045、各表面 L=0.068、对话框 L=0.034（阈值 light≥0.85 / dark≤0.30）。
- 对照截图（本地证据，脚本可复现）：`.tmp-docs/mtc007r/`
  designer-light.png / designer-dark.png / designer-inspector-light.png /
  designer-inspector-dark.png / designer-dialog-dark.png。
- token 体系：index.css 新增 `--wf-canvas/--wf-canvas-dot/--wf-edge/--wf-console(-inset)`
  与 `--status-*-soft`，Light/Dark 成对定义；C 色板=var(--*) 派生；
  MiniMap/CodeMirror 等无法用 var() 的场景走 theme/workflow-theme.ts 成对具体值。

## 门槛 4 — 资源页新产生导航全部 /resources/*

| 位置 | 旧生成 | 新生成 |
|---|---|---|
| res-list 创建/编辑/详情 | /config/{ai,data}-resources/… | /resources/{ai,data}/… |
| res-wizard base/查看详情 | /config/{scope}-resources/… | /resources/{scope}/… |
| res-detail listPath | /config/{domain}-resources | /resources/{domain} |
| app.tsx ToolRedirect | /config/ai-resources/tool/:id | /resources/ai/tool/:id |
| app-shell 面包屑（config 分支 href + resources 分支详情补齐） | /config/* | /resources/* |
| wf-forms / result-rules / result-rule-editor | /config/forms、/config/result-rules | /resources/forms、/resources/rules |
| designer StartFormControl 管理表单 | /config/forms | /resources/forms |

旧 `/config/*` 路由仅保留 redirect 与 `data-assets` 遗留挂载；sidebar activePrefixes 中的
`/config/*` 仅作高亮匹配（非链接生成）。

## 门槛 5 — 受版本控制的 battery 脚本 + 三连绿 + 全量门禁

- 脚本：`scripts/test-mtc002b-r4-battery.sh`（manifest 头部逐文件列计数；先 collect-only
  校验 94，漂移 exit 2；`runs` 参数支持验收三连）。
- 三连结果（`/tmp/rework-battery-x3.log`）：
  `94 passed` ×3（343.44s / 360.05s / 338.02s），`battery OK: 3 run(s) x 94 passed`。
- 全量门禁矩阵：

| 门禁 | 结果 |
|---|---|
| `scripts/test-mtc002b-r4-battery.sh 3` | 94/94 ×3 全绿 |
| `npm run typecheck` | 0 错 |
| `npm test -- --run`（vitest） | 46/46 |
| `npx eslint`（全部改动文件，--max-warnings=0） | 0 错 0 警 |
| `scripts/verify-mtc007r-theme.mjs` | 23/23 |
| `scripts/verify-mtc003-007.mjs` | 24/24（23 张真实截图） |

## 行为差异与返工修复（相对 1ef4050，均已在 commit message 声明）

1. `use-run-session`：校验失败复位 running（旧实现泄漏 running=true 致试运行按钮永久禁用）。
2. readOnly（R-Archive）画布禁止 quickAdd 与 reconnect（旧实现仅禁 connect/drop，属封存语义漏洞）。
3. AgentConfigDrawer 透传 wf-agent-editor 的真实 avatar（旧实现恒 undefined 走哈希回落）。
4. Inspector 分区顺序统一为「schema 分区 → 健壮性 → 输出变量」（旧实现顺序随双路径漂移）。
5. llm 节点恢复富配置 UX（模型选择器/输入绑定/系统设定/输出 schema/批处理）——
   旧 GenericSchemaForm 对 modelRef 仅渲染 JSON textarea；现以 x-control 注册实现。
6. condition 节点恢复规则构建器（旧 GenericSchemaForm 将 branches 渲染为逐行文本，
   破坏 handle 声明同步）；删除分支仍联动移除画布出边（校验器 R7 依赖）。

## 未触碰

- 无 migration、无表名/外键变化、无旧 API/旧路由删除、无旧数据修改；
- 工作区无关改动保持原样：`archive/`、`exports/`、`research/`、`docs/v2-design/`、
  `poc/…/skills/`、`server/app/agent_modules/business_analysis/skills/`、`runtimes/` 既有删除；
- 8000/8001/5173 端口进程未触碰；验收栈 8120（wf_dev）+ vite 5199 保留运行。
