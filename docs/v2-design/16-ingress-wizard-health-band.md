# 16 号稿：新建接入一站式向导 + 接入健康概览带（A 案详细设计）

状态：**待用户确认，未动工**（2026-09-15 用户拍板 A 案=向导+概览带，先设计后动工）。
上位约束：IA 不再搬移（设置→连接=终版，本稿零 IA 变更）；向导是**流程**不是**位置**；
老入口全保留；组件复用优先、禁平行重写（[[ui-consistency-demand]] [[standard-components-demand]]）。

## 1. 现状事实（代码核对，2026-09-15）

| 事实 | 证据 | 设计后果 |
| --- | --- | --- |
| DataSource 无失败原因列：poll 失败仅 `status="error"`，消息只进 HTTP 502 不落库 | models.py:1474-1492；as_automations.py:1731/1767 | 后端变更①：迁移加列 |
| **全站无路由创建 UI**：as-api 无 createRoute 方法；data-source-detail 仅路由列表（:599）；路由至今只能 API/脚本建 | grep 全 src 无 createRoute | 向导步④=首个路由创建 UI；同款表单回填详情页「路由治理」补创建入口（可见性=交付规约） |
| 路由 API 现成：POST/PUT/DELETE /api/v2/event-routes（F5 八端点） | event_routes.py:216+ | 后端零路由逻辑改动 |
| 六型源表单字段内联在 data-sources.tsx 创建 Dialog（369-548 行） | data-sources.tsx | 前端变更①：抽 `SourceKindFields` 共享组件，老 Dialog 与向导共用 |
| Connection 表单按协议分字段在 wf-connections.tsx（EpFields/secret 区） | wf-connections.tsx | 前端变更②：抽 `ConnectionFormFields`，向导内联建连接复用 |
| 目录发现两级选择器（connId→catalog）已在创建 Dialog 内 | data-sources.tsx:400-432 | 随 SourceKindFields 一起抽 |
| 事件/投递 24h 统计无聚合端点；逐源客户端拉=N+1 | event_routes.py list 端点 | 后端变更②：聚合端点+ N+1 门禁断言 |
| **自动拉取层残缺（09-15 用户质疑「都要主动去拉取么」实证）**：watcher 仅当 `config.interval_seconds>0` 才自动 tick（automation_watcher.py:249-251），但创建表单只给 api_pull 写 interval——maxcompute/sls/多维表格三型 interval 恒 0=事实手动-only；两个真实源（SLS bsh/CORN）已于 09-15 补 300s | automation_watcher.py:247-254；data-sources.tsx 表单 | 前端变更③：**所有 PULL_KINDS 表单（老 Dialog+向导步③+详情页编辑器）补「自动拉取间隔」字段**（默认 300s；0=仅手动并显式警示）；概览带加「自动拉取」列 |

## 2. 入口与 IA（零变更承诺）

- 设置→连接、能力与资源→数据资产、数据接入（源+事件流水）三处**不动**。
- 数据接入页头部新增主按钮「新建接入（向导）」；原「新建数据源」按钮保留为次按钮。
- 向导=独立全页 `/data-sources/wizard`（D3 先例：操作量大的流程给整页，不用 Dialog）。
- 概览带=数据接入页「数据源」tab 内、表格上方常驻。

## 3. 向导流程（五步状态机）

```
① 类型 → ② 凭据 → ③ 源配置 → ④ 路由(可跳过) → ⑤ 完成
   ↑________ 任意步可回退，表单状态保留 ________↑
```

**步① 类型**：六型卡（复用 KIND_LABEL/KIND_ICON）+每型一句「什么时候选我」；
test_event 卡标注「仅链路验证，不接真实系统」。

**步② 凭据**（按型分流）：
- webhook：整步跳过（显示「无需凭据，保存后交付一次性 token」预告）。
- 其余五型三选一 Radio：
  a. **复用连接**：Select 按 protocol 过滤现有 Connection（maxcompute/sls→同名协议；api_pull/feishu→http-api）；
  b. **内联新建**：嵌 `ConnectionFormFields`（协议锁定为当前型），名称自动建议 `<源名>-conn` 可改；
     落库为**普通可复用 Connection**（不加单次标记——将来复用是优点）；
  c. **不用连接**：源级凭据 JSON 或匿名（表单如实说明限制，沿用现 honest-note 文案）。
- 凭据字段永不回显；内联新建的 secret 走现有创建 API 加密链路。

**步③ 源配置**：`SourceKindFields`（现 Dialog 字段原样抽出）+ 映射/过滤折叠区；
选了连接且协议=maxcompute/sls 时显示目录选择器（复用 loadCatalog）；
**所有 PULL_KINDS 显示「自动拉取间隔（秒）」字段（默认 300；0=仅手动，note 显式警示
「watcher 不会自动拉取」）**——修 09-15 实证的自动层残缺（现状仅 api_pull 有 interval）。

**步④ 路由（可跳过）**：`RouteForm` 最小表单=名称 + 目的地类型 XOR
（automation｜analysis_task，Select 列现有定义）+ 目的地实例 Select + 说明（可选）。
跳过按钮文案=「暂不配置：事件仅留 filtered 存证，稍后可在详情页补」——**不伪装成已配置**。

**步⑤ 完成**：提交语义=**单次 apply 顺序创建** connection?(内联)→source→route；
任一失败=停在该实体、显示后端错误原文、可重试（按名称幂等防撞：重名报明错不静默覆盖）；
成功页列创建清单（名称+id）+ 三按钮：立即拉取验证（pull 型）/ 查看事件流水 / 返回列表。

## 4. 接入健康概览带

数据源 tab 表格上方紧凑表（每源一行，列）：
名称+型 icon ｜ 状态徽章 ｜ **自动拉取（pill：自动·5min / 手动 / 推送型·无需拉取；subline=下次拉取时刻或 interval=0）** ｜
最近拉取（时间 + 成功 n 条 / **失败原因 inline 红字**）｜
事件 24h ｜ 投递 24h（completed/failed/dead 三色计数）｜ 路由（n 条 / **「未配置」警告 chip**）｜ 操作（发送测试事件/立即拉取降为次级/管理；空态=虚线框引导文案）。
- 「未配置」chip 点击 → 直达该源详情页路由治理区（含新创建入口）或向导步④预填。
- filtered 占比高时在路由列旁提示「事件在积压未消费」——治「看不懂」的第二半。

**聚合端点契约**：`GET /api/v2/data-sources/health-summary`
→ `{items:[{sourceId,status,lastPollAt,lastPollOk,lastPollError,lastPollCount,
events24h,deliveries24h:{completed,failed,dead,filtered},routeCount}]}`；
单条聚合 SQL（join+group by），进 test_audit_nplus1 断言清单。

## 5. 后端变更清单（3 项，均小）

1. **迁移 g061**：data_source 加 `last_poll_error Text default ''`、`last_poll_ok Boolean default true`、
   `last_poll_count Integer default 0`；tick 成功/失败两路都写（成功清空 error）。
2. **health-summary 端点**（require_role()）+ 24h 窗口用业务时区（09-13 教训）。
3. as-api 客户端：`createRoute` / `healthSummary` 两方法+DTO。

## 6. 前端变更清单

1. 抽 `SourceKindFields`（data-sources.tsx 创建 Dialog 字段组+目录选择器）→ 老 Dialog 改用它（行为不变）。
2. 抽 `ConnectionFormFields`（wf-connections.tsx 协议字段+secret 区）→ 老连接 Dialog 改用它。
3. 新 `RouteForm`（最小）→ 向导步④ + data-source-detail 路由治理区**补创建入口**（列表旁「新建路由」按钮）。
4. 新页 `/data-sources/wizard`（五步状态机+apply 语义）。
5. 概览带组件（health-summary 驱动，loading/error/empty 三态）。
6. ui-terms：GLOSSARY 增「接入向导」「接入健康」两条；边界条文案不动。

## 7. 测试与验收

- pytest：g061 双路写列、health-summary 聚合正确性（含时区窗）、nplus1 断言、poll 失败留 error 文案。
- vitest：向导步迁移/内联连接 payload 形状/跳过路由语义/重名报错（+存量 76 不回归）。
- e2e（puppeteer 真浏览器）：test_event 型走完五步（无外部调用）+ sls 型复用现有连接跳路由；
  概览带显示未配置 chip；详情页新建路由可用。
- 逐屏截图交签（向导五步+概览带+详情页路由创建），门禁 gate.sh --live 两遍绿。

## 8. 风险与非目标

- 风险：两处已审计页面的抽取重构→存量 vitest+门禁+前后截图对比兜底；向导与老 Dialog 双入口漂移→共享组件单点。
- 非目标：路由编辑器全量重设计（PUT/DELETE 仍在详情页+API）；IA 搬移；自动调度新语义；
  Connection 健康探针 per-connection 路径（另案登记不变）。

## 9. 工时拆分

B1 后端 3 项（0.5d）→ B2 三组件抽取+老页面回归（1d）→ B3 向导页（1.5d）→
B4 概览带+详情页路由创建（1d）→ B5 测试/e2e/截图/门禁（1d）。合计约 5 人日，按批次交付每批可验收。
