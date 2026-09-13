# 2026-09-13 外部审计返工：前端工程 + UI/UX（43 项）+ 耦合后端安全 4 项

- 输入：用户转交外部审计（完整报告 `docs/audits/2026-09-13-project-audit.md`，用户消息节选前端工程 21 项 + UI/UX 22 项）。
- 边界（沿用审计自述）：未做全量浏览器矩阵、真实读屏器与色彩对比度测量，不宣称穷尽兼容性/WCAG。
- 判定：**READY_FOR_ACCEPTANCE**。47 项发现（43+4 耦合后端）逐项核实：**修复 35 / 部分修复·渐进 3 / 待拍板 8 / 待测量 1**，无一静默跳过。
- 证据脚本：`scripts/check-audit-rework-0913.mjs`（可重跑，EXIT=0）；截图 `docs/acceptance/assets/2026-09-13-audit-rework/`。

## 一、前端工程 21 项处置

| # | 发现 | 核实 | 处置 |
|---|---|---|---|
| 1 | P0 轮询表单创建出的对象不可用 | 属实（只提交 `{mapping}`，后端 `tick_poll_source` 必填 `config.url`） | **已修**：表单补 URL/间隔(≥10s 校验)/游标字段/游标参数名，全部落 `config`；轮询行新增「立即拉取」真实入口。**诚实边界**：未摆鉴权字段——后端拉取尚不消费凭据，假字段比缺字段更坏；带鉴权拉取属审计报告 P0-2 后端切片 |
| 2 | P0 映射方向文案与后端相反 | 属实（后端 `for key, path in mapping.items()`=输入键→路径） | **已修**：文案改「触发输入键 → payload 取值路径」+ 行内示例；`CreateSourceBody` 强类型固化契约 |
| 3 | P1 看板摘要失败伪装成 0 | 属实（`summary.data ?? {}` + `?? 0`，error 不渲染） | **已修**：错误态显式渲染+重试按钮，loading 显「…」；同病灶的 `agent-workspace/board.tsx` 一并修。实机 KPI=107/0/0/105 真实值。审计当时全 0 的触发根因（其环境的请求失败）未能复现，但现在任何失败都可见、不再冒充业务零值 |
| 4 | P1 「需要操作」泳道取错状态 | **部分属实（根因纠正）**：后端语义正确（`waiting`=运行时等待人工=`needs_action`；`pending`=queued/无消息）；错的是前端 `LANE_LABEL` 把两词写反，行徽章与计数互相矛盾 | **已修**：LANE_LABEL 交换（pending=排队中，waiting=需要操作），Tab 计数源保持 `lanes.waiting` 不动 |
| 5 | P1 API 基址两个默认端口 | 属实（wf-api 默认 8100=残留旧服务陷阱端口） | **已修**：`WF_BASE` 单一事实源（默认 8120），as-api 改为复用；4 处内联默认随 fetch 收口消灭 |
| 6 | P1 原生 fetch ×4 绕过服务层 | 属实（agentflow-detail/res-category-pages/connectors/app-sidebar） | **已修**：分别收口到 `pagedApi.agents`/`asApi.kbConfigStatus`/`connApi.create`/`pagedApi.agents` |
| 7 | P1 加载错误吞成空数据 | 属实（res-list `catch(()=>setData([]))`；wf-connections 只 setLoading） | **已修**：两页均补 error 态 + `ErrorState` 组件 + 重试 |
| 8 | DataSources 忽略 loading/error | 属实 | **已修**：三态分离渲染（加载中/失败+重试/空态各有其形） |
| 9 | Connection 搜索只过滤当前页 | 属实（本地 `search` 与服务端 `params.search` 两套） | **已修**：搜索 300ms 防抖写回 URL params 走服务端，删本地名称过滤 |
| 10 | protoCounts 只统计当前页 | 属实 | **已修**：计数独立拉搜索命中全量（pageSize=200 上限，凭据类实体量级有界，代码注释如实标注）。实机 tab 计数 LLM(1)/MCP(3)/MySQL(1)/PostgreSQL(6) 为全局值 |
| 11 | as-api 错误正文双消费 | 属实（json() 失败后再 text() 必抛 body already read） | **已修**：text() 一次读取→尝试 JSON.parse→statusText 兜底 |
| 12 | 无统一超时/真取消 | 属实 | **已修（渐进）**：wf-api/as-api 全部请求统一 30s `AbortSignal.timeout` 并与调用方 signal `AbortSignal.any` 合并；`useAsyncData` 真 abort（deps 变化/卸载终止在途请求，取消不当错误上报）；看板×3+数据源列表已接 signal 透传。其余 API 函数的 signal 形参属渐进接线，超时已全局兜底 |
| 13 | Suspense 替换整壳 | 属实 | **已修**：Suspense 下沉到 AppShell 内容区，导航壳常驻；实证切路由 150ms 时 nav 仍在（V4） |
| 14 | 无 ErrorBoundary | 属实 | **已修**：`RouteErrorBoundary`（局部兜底+错误编号+重试；chunk 失效识别→「刷新页面」引导，console 留全堆栈） |
| 15 | 宽泛类型转换 | 属实 | **部分修**：本轮触点全部强类型化（`SourceRow`/`CreateSourceBody`/`BoardSummary`，task-board/data-sources/board 的 Record 宽转换清除）；`ConnectionDTO`/`VersionRow` 等存量 `as unknown as` 登记给「契约客户端生成」批次 |
| 16 | 巨型模块（1456/1298/1031 行等） | 属实 | **待拍板**：大型重构，建议独立轮+回归门禁，不混入修复批 |
| 17 | 构建产物 802kB chunk | 属实 | **待拍板**：manualChunks 拆包策略（vendor/router 级）属构建架构决策 |
| 18 | 3 个 hooks 警告 | 属实 | **已修**：stateful 补 `[children, reduce]`（保留流式宽度追踪语义，setWidth 自带相等短路）；motion/select 解构稳定引用；agentflow-detail 取局部 `retryRuns`。**lint 现 0 error 0 warning** |
| 19 | 关键页面测试缺失 | 属实（11 文件/65 测试，无 DataSources/Connections/TaskBoard 专项） | **待拍板**：建议下轮组件测试批（本轮新增行为已有浏览器实证脚本兜底） |
| 20 | 无仓库级 CI | 属实（无 .github/workflows） | **待拍板**：GitHub Actions vs 本地 battery 门禁（注意 GitHub 网络不稳历史）；需定门禁清单与失败策略 |
| 21 | README 严重过时 | 属实（仍称前端原型/mock service） | **已修**：全量重写（架构+端口表+运行命令+权威文档指针+术语边界+安全注意） |

## 二、UI/UX 22 项处置

| # | 发现 | 处置 |
|---|---|---|
| 1 | 轮询能力不可用仍展示 | **已修**（工程#1：表单补全后即真实可用；鉴权边界诚实标注） |
| 2 | 107 vs 0 自相矛盾 | **已修**（工程#3；实机截图 v1 为证） |
| 3 | 错误/加载/空态不分 | **已修**（工程#7/#8：五个页面三态分离） |
| 4 | Connection 桌面布局浪费 | **待拍板**：表格主视图重设计=视觉基线变更，须先过组件基线闸门 |
| 5 | 卡片信息截断 | **待拍板**（同 #4 一并设计；本轮先补「待验证」标记与 title 全称提示缓解） |
| 6 | 操作仅悬停可见 | **已修**：全部行内操作按钮补 `focus-visible:opacity-100` + 容器 `group-focus-within`，键盘 Tab 即现 |
| 7 | DB 字段无可访问名称 | **已修**：host/port/用户名/数据库/Bucket/Region/基址/密钥全部 aria-label |
| 8 | Label 未关联输入框 | **已修**：data-sources 全表单 htmlFor/id；wf-connections 名称 htmlFor、鉴权/协议 aria-labelledby；`SearchField` 组件级默认 `aria-label=placeholder`（全局生效） |
| 9 | 任务行只能鼠标点 | **已修**：tabIndex+role=link+aria-label+Enter/Space+focus ring（泳道视图本就是 button） |
| 10 | 搜索只有 placeholder | **已修**（同 #8 组件级修复） |
| 11 | 协议/鉴权默认不协调 | **已修**：切 DB 协议时 api_key 自动联动 basic（可手改） |
| 12 | Webhook token 交付不完整 | **已修**：专用交付对话框+复制按钮（成功/失败 toast）+「仅显示一次，关闭无法再查看，丢失只能重建」强提醒。**遗留**：重新生成入口需后端补 regenerate 端点，登记 |
| 13 | 数据源缺治理界面 | **部分修**：补「立即拉取」（真后端 `POST /{sid}/poll`）；编辑/暂停/删除/事件历史/死信管理=新功能切片（后端管理端点亦缺），**待拍板**+基线闸门 |
| 14 | 空态实现层语言 | **已修**：改为用户视角下一步指引（创建 Webhook→测试事件验证；轮询→自动拉取/立即拉取） |
| 15 | 测试事件错误技术化 | **已修**：JSON 不合法（带解析器信息）与后端拒绝分流；成功提示带派发结果或「无匹配路由（可查 filtered 证据）」 |
| 16 | 内部实施阶段暴露 | **已修**：查收禁用页签整体移除（拍板本就不做查收）；两处页头「并查收结果」改「并查看执行结果」；全站「查收」字样清零（实证） |
| 17 | 两套「数据源」概念 | **待拍板**：信息架构决策（建议：「数据接入」=事件入口、「数据资产」=资源域，互设说明与跳转） |
| 18 | 中英文术语无统一原则 | **待拍板**：建议扩展 `ui-terms.ts` 单一事实源为完整术语表（中文主名+英文技术名+适用域） |
| 19 | active+未测试语义含糊 | **已修**：健康徽章追加「·待验证」+ title「迁移遗留数据：未经连接测试验证，生产使用前请先测试」 |
| 20 | 硬编码颜色绕过主题 | **已修**：`bg-black`/`#1F2329`/`#EDF0F4` → `bg-foreground`/`text-background`/`var(--border)` 语义 token（四主题自适应；实证 noHardcodedBlack） |
| 21 | 小字号/暗色对比度风险 | **待测量**：审计自述未做正式测量、不下 WCAG 结论；建议专项轮（对比度抽样+字号盘点），不凭观感改数值 |
| 22 | 整页骨架闪屏 | **已修**（工程#13） |

## 三、耦合后端安全微修 4 项（跨界明示：与本轮前端修复直接耦合，不修则前端修复放大风险）

| # | 修复 | 文件 |
|---|---|---|
| B1 | 轮询出站过统一 Egress 闸（生产拦私网/元数据；原裸 `httpx.get` 绕过 SSRF 防线）+ 禁跟随重定向 | `as_automations.py tick_poll_source` |
| B2 | 事件过滤未知 op **fail-closed**（原 fail-open 放行）+ EventRoute 保存时校验 op 枚举（422 `FILTER_OP_INVALID`） | `as_automations.py` / `event_routes.py` |
| B3 | 重试退避舍入错误（原截整分钟+30s，秒数>30 时首次重试立即到期） | `as_automations.py _schedule_retry` |
| B4 | ingress 写端点 viewer 可写 → `require_operator`（create_source/poll/test-event） | `as_automations.py` |

## 四、门禁与实证证据（全部可复现）

```
server: .venv/bin/python -m pytest tests/ -q          → 567 passed
前端:  tsc --noEmit ✓ / tsc -b+vite build ✓ 3.79s / eslint 0 error 0 warning（3→0）/ vitest 65 passed
审计:  层1 0/0/0 基线门禁 ✓；层3 活体 P0=0 P1=3（仅 09-10 历史行）✓；
      层4 162 控件 0 无效果 0 JS 错误 V1/V2 ✓
返工实证: node scripts/check-audit-rework-0913.mjs → EXIT=0
      V1 看板 KPI=107/0/0/105 真实值、查收字样 0、内部阶段文案 0
      V2 轮询表单 URL/间隔/游标齐、映射方向正确、匿名GET诚实注记、label 关联
      V3 搜索 aria ✓、协议 tab 全局计数、操作按钮 focus-visible、无 bg-black、待验证标记
      V4 懒路由切换 150ms 导航壳常驻；jsErrors=[]
截图: docs/acceptance/assets/2026-09-13-audit-rework/{v1-task-board,v2-datasource-polling-form,v3-connections,v4-shell-persists}.png
```

8120 已重启加载现行后端（仅精确 PID；8000/5173/5199/8301 未触碰）。

## 五、待拍板 / 下一批清单（不擅自动工）

**前端/UI（8 项）**：#16 大文件拆分轮；#17 拆包策略；#19 三页面组件测试批；#20 CI 方案（GitHub Actions vs 本地 battery）；UI#4+5 Connection 表格主视图重设计（视觉基线闸门）；UI#13 数据源治理 UI（新功能切片，含后端管理端点）；UI#17 双「数据源」IA 决策；UI#18 术语统一表；UI#21 对比度/字号测量轮。

**外部审计报告的后端批（本轮未动，建议顺序照报告 §8）**：P0-1 连接解析双轨（测试走 `resolve_for_request`、Reader/Writer 直读 endpoint/secret_ref——「数据源已可用」最直接反例，**建议最优先**）；P0-3 Docker context 缺 `packages/runtime_contract`；P0-4 `fast-uri@3.1.5` high（升 3.1.6）；P1 Reader/Writer registry 与 `Datasource.type` 声明不一致（MySQL 驱动缺失/OSS/HTTP 无读路径）；P1 webhook HMAC/时间窗/限速/体积上限；P2 `/metrics` 暴露与 `wf_workflows_total` 统计错对象；P2 事件 partial_failed 聚合状态。

**小遗留**：webhook token regenerate 端点；`as unknown as` 存量转换（契约客户端生成批）；API 函数级 signal 渐进透传。
