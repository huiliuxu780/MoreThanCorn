# Phase E：文档一致性 + 发布控制面 + 观测/对话体验深化（缺口收尾）

状态：执行中
依据：2026-08-24 双代理对账（调研 00–14 vs 代码；docs/sdd+uiux vs 代码）结论；
前置：Phase A–D 已交付、design-run-observability P1+P2、design-condition-rule-builder 已实现。
节奏：E-1 → E-2 → E-3 → E-4 分批提交，每批 pytest+构建+浏览器复核。

---

## E-1 文档一致性清理（让"声明=事实"）✅ 2026-08-25 完成

> 落地记录：E-1.1 删 mocks+`/api/quality/vocab` 真词表+筛选参数真进后端（此前纯摆设）+行 key 去重+favicon；
> E-1.2 15 处裸 fetch 清零（页面/组件全走服务层）；E-1.3 五道门禁全绿（90 pytest/41 fullstack）+13 项手工动线
> 逐项核验勾核（check-e1-acceptance.mjs / check-e1-walkthrough.mjs）；顺带修复节点单测 FK 违约、补 Run 版本徽标（A-01 遗留）。

| # | 条目 | 契约 | 验收 |
| --- | --- | --- | --- |
| E-1.1 | 删 `src/mocks/catalog.ts`、`scenarios.ts` | global-filters/quality-results 的筛选选项改走真实来源（API 聚合或静态常量配置），不引 mocks | `grep -r "mocks/" src` 无命中；质量页筛选仍可用（浏览器） |
| E-1.2 | 页面零裸 fetch（D-3/A-16） | run-detail(×2)/tasks/result-rules/wf-designer(系统变量)/wf-workflows-list/task-detail 全部迁入 `wf-api` 服务层 | `grep -rn "fetch(" src/pages src/components` 仅余 wf-api 内部与 SSE EventSource |
| E-1.3 | 验收勾核 | e2e-acceptance.md 与 01/02/04 验收清单逐条人工/浏览器核验后勾 `[x]`；不实的改注 | 文档复选框状态=代码事实 |

## E-2 发布控制面（调研 01/02/03）

| # | 条目 | 契约 | 验收 |
| --- | --- | --- | --- |
| E-2.1 | Agent 复制/归档 | `POST /api/agents/{id}/duplicate`（新 id、名称+" 副本"、草稿复制）；`PATCH /api/agents/{id}` 增 `archived` 字段，列表默认隐藏+筛选"已归档" | 列表 ⋯ 菜单两动作可用；pytest |
| E-2.2 | 版本 diff | 发布对话框/历史抽屉增"对比"：选两版本（或草稿 vs 版本），行级 diff（增绿删红）渲染 definition JSON | 浏览器可见增删行高亮 |
| E-2.3 | 灰度发布 | Release 增 `canary_percent`；run 解析版本时按 run_id 哈希落桶选 canary/稳定；头部显示"灰度 N%"徽标；"停止灰度"=该 release rolled_back | pytest 覆盖 0/100/边界；UI 徽标 |
| E-2.4 | Agent 编辑锁 | 复用 `/api/locks`（resourceId=`agent:{id}`）：编辑器进入 acquire、离开 release、头部显示占用者；admin 可强制解锁（DELETE 他人锁） | 双浏览器/双 ws 模拟互斥；409 提示 |

## E-3 观测深化（design-run-observability P3 + 07 §6）

| # | 条目 | 契约 | 验收 |
| --- | --- | --- | --- |
| E-3.1 | Trace 导出 | run 详情头部"导出 Trace"下载 JSON（/trace 全量+events） | 浏览器下载成功 |
| E-3.2 | 重试谱系 | run 详情头部展示 origin_run_id 链（向上/向下可点跳转） | 重试后页面可见链 |
| E-3.3 | 嵌套子 Run span | agent-exec/agent-select 执行子 run 时 `ctx.call(kind="agent", target=sub_run_id)`；/trace 将子 run 树递归挂到该 span | pytest：group run 的 trace 含 agent 子树 |
| E-3.4 | 首 token 耗时 | agent_metrics 从 RunEvent 首个 `llm_delta` 与 started_at 差值聚合 avg/p50；观测面板加卡 | pytest/浏览器卡可见 |

## E-4 对话体验与画布补点（02/03/11）

| # | 条目 | 契约 | 验收 |
| --- | --- | --- | --- |
| E-4.1 | 预览消息操作 | 预览会话每条 agent 消息：复制/👍/👎（复制走 clipboard；赞踩持久化到 sample feedback 或本地态+toast） | 浏览器三按钮可用 |
| E-4.2 | Prompt `#` mention | 自主规划角色提示词输入 `#` 唤起资源选择（技能/插件/知识/记忆），插入 `#type:name` token；agent_runtime 组装 prompt 时把 token 展开为资源描述摘要 | 浏览器插入+运行生效（prompt 含展开文本，断言调用记录） |
| E-4.3 | 节点单测入口 | 节点卡 ⋯ 菜单"单测此节点"→对话框填 mock 输入→调 `POST /api/workflows/{id}/nodes/{nodeId}/test`（已存在 workflows.py:169）展示输出/错误 | 浏览器跑通 llm/tool 节点 |

## 不做（继续登记）
插件市场、语义图谱、NL2SQL/图像生成/信息收集节点、观测配置向导、多租户、可访问性专项——保持 03/04 登记状态。
