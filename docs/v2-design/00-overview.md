# 00 · 总纲：技术债盘点与 V2 设计方向

> 日期：2026-09-04（当天二次修订：落定用户拍板）｜ 状态：盘点+设计稿，**未改任何代码**
> 本目录共 8 份文档：本总纲 + 01 功能盘点 + 02 代码审计 + 四个专题设计（03 Trigger/04 Flow/05 Agent/06 批次）+ 07 自查报告。
> 方法：4 个独立探查代理全仓取证（前端 23.2k 行、后端 28.9k 行、38 迁移、全部 SDD/调研/验收档案对账），所有结论带文件:行号证据。
>
> **用户已拍板（09-04）**：① Agent 运行时只留 AgentScope，DSH 与 openai-agents 全部下线（**当天已执行归档**：两目录移至 `archive/runtimes-retired-2026-09-04/`）；② 所有视觉/前端方案必须先出 HTML 原型并经人工确认，左侧导航栏冻结不动，页面内容参考库 = `shadcnuikit.com/dashboard/default` 全量页面库（逐页确认参考页，见 §4-4）；③ 质检总览、坐席分析两个 dashboard 页先下掉，业务跑通后再重新开发；④ 其余设计点按文档推荐执行。

---

## 1. 六个问题的直接回答

| # | 问题 | 结论 | 详见 |
|---|---|---|---|
| 1 | 页面与功能盘点 | 30 路由/28 页面，主干链路（任务→批次→单条执行→投递→运行中心→质检复核）**真打通且已验收**；四个空洞：质检两张总览页聚合数据缺失且筛选不生效（**用户已决定：下掉且不再重做**）、审计日志占位、触发面只有 cron、输入映射只能改名 | 01 |
| 2 | 代码审计 | 债务不在卫生（仓库很干净），在三处结构：**后端无 service 层+运行时反向依赖 router**、**两个上帝文件**（`runner.py` 1750 行 / `wf-designer.tsx` 2834 行）、**多处双轨并存**（两套 Agent 执行/两套错误格式/两套视觉/三源契约）。清单 25 条后端 + 15 条前端，带证据与修复优先级 | 02 |
| 3 | 是否引入 Trigger | **引入，升级为一等实体**。填上 `trigger="api"` 空洞值，融入 SDD-13 四源模型；Webhook（签名鉴权+事件流水）/ MQ（consumer group+先落库再 ack+毒消息死信）/ API / Schedule 收编四类；三方字段转换用**统一受限映射引擎**（把输出侧已有引擎扩到输入侧：嵌套路径/类型转换/码值表/默认值），样本驱动配置，映射错误入口拦截 | 03 |
| 4 | Flow 前端优化 | 先拆房子再装修：`wf-designer.tsx` 拆为 `features/designer/` 分层；**统一配置路径**（GenericSchemaForm 为唯一渲染器，手写抽屉的定制控件降级为注册表字段渲染器）；视觉令牌落 CSS 变量终结双轨；22 节点逐个给出配置规格表；手绘验证（手填 mock）升级为按引用变量自动推导输入 | 04 |
| 5 | Agent 管理重设计 | **Agent 定义从仓库 manifest 迁到 DB 配置**，UI 全量管理；**运行时只留 AgentScope**（用户拍板，DSH/openai-agents 下线，05 §6 给了含代码事实的下线计划：业务打标工作流需先移植、openai-agents 源码从未入库等）；AgentSpec 保持 provider-neutral（不推翻 ADR）；新概念：Skill（工具打包能力）/Plugin（外部能力接入）/版本化 Prompt/护栏配置化 | 05 |
| 6 | 批次一眼查看 | 保持 SDD-13 三页架构做**增强**：L0 看板分段进度条、L1 历史三数列、L2 批次详情头部重设计（5 秒看懂：状态→成败分布→失败集中度+成本）；前提是后端数据可信化：增量进度/结构化错误聚合/跳过留痕/批次取消+硬超时/摘要端点/批次告警 | 06 |

## 2. 技术债全景（按性质归堆）

```
结构性（越早改越便宜）
├─ 后端无 service 层，规则/发布/审计寄居 router，运行时反向导入   02 §2.1
├─ runner.py 上帝文件（引擎+调度+队列+LLM+worker 五合一）          02 B9
├─ wf-designer.tsx / wf-api.ts 两个前端巨石                        02 F1/F2
├─ DataAsset.rows / QualityResult.transcript 等 JSONB 当主存储      02 B7
└─ 软外键无约束、51 模型单文件                                      02 B5/B6

一致性（双轨税）
├─ 两套 Agent 执行路径（内置 ReAct vs Runtime Provider）            02 B10
├─ 错误信封只有 1/14 router 遵守；/api/v2 冻结契约零实现            02 B15/B16
├─ 三源输出契约 + manifest 死契约（resultMapper/evaluator）         02 B17/B19
└─ 前端双轨视觉（shadcn vs 复刻 quickservice inline 色）            02 F9

能力空洞（产品面）
├─ 触发面只有 cron（无事件/推送/消息）                              03 §1
├─ 输入映射仅改名、"上一自然日"窗口运行期不生效（读全量！）        02 B14
├─ 质检总览/坐席分析聚合数据缺失、筛选不生效                        01 §1.1
└─ 批次进度/错误聚合/取消/超时 不可信或缺失                          06 §1
```

## 3. V2 路线建议（依赖顺序，不是时间承诺）

```
阶段 0  结构修复（为一切新功能铺路，约对应审计"第一优先"）
        service 层下沉 + runner 拆分 + 错误信封统一 + JSONB 迁移
        即时项：质检总览/坐席分析两个 dashboard 下导航（用户拍板，见下）
阶段 1  批次可信化 + 一眼查看（06 的 P1/P2/P5 → L0/L1/L2 前端）
        ★ 最高价值点先落地，且是 Trigger 洪峰的承压前提
阶段 2  Trigger 一期：Webhook + API + 映射引擎输入侧 + 事件流水（03）
        并行：设计器拆分与视觉令牌统一（04 的 S1）
阶段 3  运行时收敛 + Agent 配置化（05 轨道 B1-B5 与轨道 A 并行）
        前置硬依赖：业务打标工作流移植进 AgentScope（B1）→ 才允许 DSH 下线（B4）
        并行：Flow Inspector 统一 + 逐节点规格对账（04 的 S2-S4）
阶段 4  Trigger 二期：MQ（Kafka）+ 死信重放 + 批次/触发器告警接入
        收尾：审计日志页重做（两个质检 dashboard 已取消，不再重做）
```

**两个 dashboard 的终局口径（用户 09-04 两次拍板）**：`/quality/overview` 与 `/quality/agent-analysis` 从侧边导航摘除、路由改提示页或重定向；**不再重做**（第二次拍板撤销了"业务跑通后重做"）。页面文件与已接通的服务端聚合端点（`/api/quality/analytics/*`）暂保留不删，作为其他页面（任务/批次/Agent 观测）可复用的数据底座；若后续确认无复用价值再单独清理。

**依赖关系说明**：
- MQ Trigger 依赖批次承压改造（单个 TaskRun 作业会长时间占住一个 worker，批次内逐条串行）→ 06 的承压改造在前；
- Flow 拆分（04-S1）是纯重构，可与任何阶段并行，且为 Trigger 的过滤条件构建器、映射行编辑器提供共享控件；
- Agent 配置化（05 轨道 A）与 Trigger（03）解耦，可并行；但 05 轨道 B（运行时收敛）里 B1/B2 是 B4（DSH 下线）的硬前置，顺序不可乱；
- dashboard 重做不占当前预算，等数据。

## 4. 全局闸门（本仓既有规矩 + 用户新增，V2 全程有效）

1. 规格即契约：偏离冻结规格必须写变更记录（00-index §0）；
2. **HTML 原型人工确认（用户 09-04 强化）**：所有视觉/前端方案必须先产出 HTML 原型并经人工确认才能实现。这是 07-SDD §9.4"原型先行"的升级版——原型载体明确为可打开的 HTML，不是线框描述；
3. **左侧导航栏冻结（用户 09-04）**：`app-sidebar` 的结构、分组、视觉一律不动（含其中已知的硬编码署名小瑕疵，V2 不修）；
4. 页面内容视觉参考库：**全量参考 `shadcnuikit.com/dashboard/default`（shadcn UI Kit 的完整 dashboard 页面库，不只是 kanban）**。每个新建/大改页面做原型前，按固定格式逐页向用户确认参考页："XX页面，功能包括xxx，需要参考哪个页面"——用户 09-04 指定的协作方式，不确定就问，不猜；
5. 视觉回归 ≤0.5% + 组件标准扫描 allowlist 只减不增 + 设计令牌 DOM 断言；
6. 验收三类证据（测试名可重跑 / 命令+输出 / 手工步骤），不接受自指性完成声明；
7. Secret 永不进 Prompt/快照/事件/Trace；零假路径、零双轨。

## 5. 拍板事项状态（09-04 已全数落定）

| 事项 | 结果 |
|---|---|
| ① DSH 去留 | **下线**（05 轨道 B4） |
| ② openai-agents 去留 | **下线**（05 轨道 B5；注意其源码从未入库，见 07 §2） |
| ③ Module 转"官方模板" | 接受 |
| ④ Skill 首期粒度（工具打包型） | 接受 |
| ⑤ 多 Agent 编排 V2 不做 | 确认 |
| ⑥ Webhook 默认鉴权 = HMAC 签名 | 接受 |
| ⑦ MQ 首发协议 = Kafka | 接受 |
| ⑧ 批次详情头部改版（概览卡降折叠区） | 接受（先过 HTML 原型确认） |
| ⑨ 视觉令牌不换数值、落 CSS 变量 | 接受 |
| ⑩ 修复优先级（结构→一致性→空洞） | 认可 |
| 新增：两个质检 dashboard 先下掉 | 接受（§3 口径） |
| 新增：HTML 原型人工确认闸门、导航冻结、kanban 参考 | 接受（§4） |

实施前仅剩两个非方向性待办：openai-agents 的证据处置方式（只留文档 vs 补录源码）、并行会话未入库的 business skills 文件由谁提交。

## 6. 页面参考映射（shadcnuikit.com/dashboard，09-04 起逐页确认）

| 页面 | 参考页 | 状态 |
|---|---|---|
| 今日运行看板 `/operations/task-runs/today` | `/dashboard/apps/kanban` | ✅ 用户指定 |
| 批次详情 `/operations/task-runs/:id` | `/dashboard/project-detail` | ✅ 用户指定 |
| 批次历史 `/operations/task-runs` | `/dashboard/project-management` | ✅ 用户指定 |
| 触发器列表（新） | `/dashboard/apps/courses` | ✅ 用户指定 |
| 任务列表 `/config/tasks` | `/dashboard/apps/tasks` | ✅ 用户确认（09-04） |
| 触发器详情（新） | **专业产品驱动**（用户否决 orders/details 参照）：Stripe Webhooks endpoint（signing secret reveal/rotate、event subscriptions、Send test webhook、undelivered）+ GitHub Recent Deliveries（response code/latency/Redeliver/展开 Request-Response）+ Segment debugger（Live 事件流+校验态）。v2 原型已出 | ⏳ v2 待确认 |
| Agent 列表（重做） | **专业平台驱动**：信息架构学 Dify/Coze 等专业 Agent 平台（见 05 §5 取证），shadcn kit 仅作组件样式来源 | ✅ IA 方向确认 |
| Agent 详情（重做） | **专业平台驱动**；v1 两版（配置表单堆叠：平铺九 Tab/三段分组）均被用户否决——根因是做成了"配置页"，专业形态应为**生命周期一级 Tab + 三栏编辑工作区 + 常驻调试面板**（QuickService 调研 02 §1-2 一手证据 + 扣子/Dify 同构）。v2 原型已出 | ⏳ v2 待确认 |
| 审计日志（重做） | `/dashboard/pages/orders`（筛选+状态表格） | ✅ 用户确认 |
| 两个质检 dashboard（重做，业务跑通后） | 届时再问一轮 | — |

备注：站点可用 curl 访问（WebFetch 超时），页面结构已抓样存证；所有原型必须人工对照原站校正后才算数。

**原型进度**（`docs/v2-design/prototypes/`，讨论稿，均经无头浏览器截图自验；**09-04 晚全部页面换统一 premium 皮肤 `_skin.css`**——Linear/Vercel 式中性精致：微标签大写字距/tabular 数字/ring+soft-shadow 卡片/顶部径向微光/单一靛蓝点缀，用户"不够高级"意见的响应）：
- `batch-detail-v1.html` — 批次详情页（参考 project-detail；状态带三层信息+四 Tab+折叠上下文）；
- `operations-today-v1.html` — 今日运行看板（参考 apps/kanban；六列+批次卡+分段进度+失败集中 chip）；
- `trigger-detail-v1.html` — **被否**（orders 参照不专业）；
- `trigger-detail-v2.html` — 触发器详情 v2（专业参照：Stripe/GitHub/Segment；Listening 开关+endpoint strip+事件流 Tab（Live/HTTP 码/耗时/Redeliver/Request-Response 展开）+未送达+MQ lag 注记）；
- `tasks-v1.html` — 任务列表（参考 apps/tasks；服务端分页+行内启停+最近 5 批迷你态）；
- `agent-detail-v1-grouped.html` / `agent-detail-v1-flat.html` — **均被否**（配置堆叠形态错误）；
- `agent-detail-v2.html` — Agent 详情 v2（生命周期一级 Tab=搭建/观测/评测/版本发布；搭建页三栏工作区：左提示词主面+模型，中技能/插件/知识/契约装配卡，右常驻调试+模型对比）；
- `audit-log-v1.html` — 审计日志（参考 pages/orders；筛选/分页/错误态齐备）；
- `agent-list-v1.html` — Agent 列表 v1（已被 v2 取代）；
- `agent-list-v2.html` — **Agent 列表 v2（最新）**：结构标杆 HF Spaces——渐变封面卡（玻璃态状态 chip+水印字+♥运行量）+⌘K 命令栏+分类轨+sparkline 页脚，色彩企业低饱和；
- `agent-detail-v3.html` — **Agent 详情 v3（最新）**：v2 结构（生命周期 Tab+三栏工作区）+ 深色 hero 头带（大头像+行内健康统计：7日运行/成功率/p95/Token）+ 图标化分区卡 + 控制台风调试输出；
- `benchmark-board.html` — "别人家的高级感"对照板：Plausible / shadcn 官方 / Tremor 截图+活链接+学什么。
待出：无（两个质检 dashboard 已取消）。设计阶段全部闭环。

## 7. 文档索引

- [01 功能盘点](./01-feature-inventory.md) — 全部路由/页面/后端能力/运行链路
- [02 代码审计](./02-code-audit.md) — 40 条问题清单（带证据）+ 修复优先级
- [03 Trigger 与数据映射](./03-trigger-and-data-mapping.md) — 引入判断+概念模型+三型触发+统一映射引擎
- [04 Flow 前端重设计](./04-flow-frontend-redesign.md) — 拆分方案+画布/节点卡+统一配置面板+22 节点规格
- [05 Agent 管理重设计](./05-agent-management-redesign.md) — AgentScope 唯一运行时+Skill/Plugin/Prompt+双轨迁移计划
- [06 批次观测](./06-batch-observability.md) — 四层钻取+批次头部重设计+后端可信化改造
- [07 自查报告](./07-self-review.md) — 对以上结论的幻觉/遗漏复核：已纠正项、新发现、剩余风险
