# MoreThanCorn 项目专业审计报告

审计日期：2026-09-13  
审计范围：后端、前端、整体架构、数据源能力、UI/UX、安全与交付工程  
审计方式：源码静态审查、真实 API 对照、自动化测试、生产依赖审计、桌面端与 390px 移动端实机页面检查。未修改业务代码。

## 1. 执行结论

“项目已经推进到可以连接数据源”这个前提只在非常有限的范围内成立：

- 已成立：可以创建 Connection、保存/轮换密钥、做健康检查；存在 PostgreSQL DataReader/DataWriter；存在 Webhook 接收、事件去重、路由、投递和重试的数据模型。
- 未成立：MySQL、OSS、HTTP 数据源没有生产 DataReader；写入只有 PostgreSQL；当前轮询数据源 UI 不能填写 URL、游标或认证，保存后必然无法拉取；轮询后端绕过统一出网策略；PostgreSQL 运行时没有使用已经实现的环境解析器，并会把结构化 Basic 凭据误当成密码字符串。
- 当前数据库里的“DSH真实回归数据源”连接到本机 `wf_dev`，只能证明本地 PostgreSQL 自连接回归，不能证明外部客户数据源已经端到端打通。

专业判断（主观评分，不是测试事实）：整体约 **4.8/10，处于集成型原型 / pre-alpha 控制面阶段**。不建议对外宣称“真实数据源接入已完成”，也不建议在修复 P0 项前接入生产网段或生产凭据。

| 维度 | 评分 | 判断 |
| --- | ---: | --- |
| 后端工程 | 6.5/10 | 测试和安全基座较强，但接入路径存在关键断层 |
| 数据源就绪度 | 3/10 | 仅 PostgreSQL + inline 有真实读路径；轮询闭环不可用 |
| 前端工程 | 5.5/10 | 类型/构建通过，错误状态、配置一致性和测试覆盖不足 |
| 整体架构 | 5/10 | 分层意图清晰，但双数据源模型、巨型模块和部署边界失配 |
| UI/UX | 5.5/10 | 视觉体系一致；管理密度、可访问性和“真实状态表达”有明显问题 |
| 安全与生产化 | 4/10 | Secret/鉴权基座不错，但轮询 SSRF、RBAC、供应链和镜像是阻断项 |

## 2. 最高优先级发现

### P0-1：PostgreSQL“测试通过”与“任务运行”使用了两套连接解析逻辑

事实：连接测试会调用 `resolve_for_request()`，正确合并默认环境、环境端点和环境密钥，并把结构化凭据取出 `password`。但 DataReader/DataWriter 直接读取 `conn.endpoint` 和 `conn.secret_ref`，没有调用解析器；随后 `_decrypt()` 的返回值直接作为 psycopg 的 `password`。当凭据是 `{username,password}` 或使用环境覆盖时，连接测试可以成功，而真实任务读取/写入失败或连错环境。

证据：[connection_runtime.py](/Users/rivers/MoreThanCorn/server/app/connection_runtime.py:19)、[admin.py](/Users/rivers/MoreThanCorn/server/app/routers/admin.py:423)、[postgres reader](/Users/rivers/MoreThanCorn/server/app/data_readers/postgres.py:12)、[postgres writer](/Users/rivers/MoreThanCorn/server/app/data_writers/postgres.py:13)。

影响：这是“数据源已可用”最直接的反例，且会产生假阳性健康检查。建议把运行时适配器统一收口到 `resolve_for_request()`，并增加环境覆盖、Basic 结构化密钥、根密钥回落的端到端测试。

### P0-2：轮询数据源前后端均未形成安全、可用闭环

事实：新建轮询源的 UI 只提交 `{mapping}`，没有 URL、认证、游标、间隔字段；后端 `tick_poll_source()` 明确要求 `config.url`，因此从当前 UI 创建的轮询源在拉取时必然 422。后端又直接 `httpx.get(url)`，没有复用已经存在的 `enforce_egress()`，可访问内网/元数据地址；也没有 Connection 鉴权、分页/批量上限或负载限制。

证据：[data-sources.tsx](/Users/rivers/MoreThanCorn/src/pages/data-sources.tsx:47)、[as_automations.py](/Users/rivers/MoreThanCorn/server/app/routers/as_automations.py:1508)、[automation_watcher.py](/Users/rivers/MoreThanCorn/server/app/automation_watcher.py:243)。

影响：功能不可用，同时存在 SSRF 高风险。修复前应禁用 polling capability，而不是以可用功能展示。

![轮询表单缺少 URL、游标、间隔与认证配置](/Users/rivers/.codex/visualizations/2026/09/13/01a09959-9bdb-79c3-962d-d2ec034d08ea/data-source-polling-form-missing-config.png)

### P0-3：文档声明的 Docker 构建路径按现状无法包含仓库内依赖

事实：文档和 Dockerfile 指定构建上下文为 `server/`，但 `server/requirements.txt` 引用了 `../packages/runtime_contract`。Docker 构建上下文不能读取父目录，Dockerfile 也没有复制 `packages/`，因此安装依赖阶段无法解析该路径。当前机器未安装 Docker，未做实际 build；这是由构建上下文规则与文件内容直接推导出的静态阻断。

证据：[Dockerfile](/Users/rivers/MoreThanCorn/server/Dockerfile:1)、[requirements.txt](/Users/rivers/MoreThanCorn/server/requirements.txt:47)、[release.md](/Users/rivers/MoreThanCorn/docs/ops/release.md:10)。

影响：`check-release.mjs` 通过并不等于镜像可构建。应把 context 提升到仓库根、显式复制本地包，或发布/构建 wheel 后安装；CI 必须真实构建镜像。

### P0-4：生产依赖树存在 1 个高危安全公告

`npm audit --omit=dev --registry=https://registry.npmjs.org` 报告 1 个 high：`fast-uri@3.1.5`，经 `@hookform/resolvers -> ajv -> fast-uri` 引入，关联主机混淆和 SSRF 类公告，修复版本为 3.1.6。当前仅确认依赖存在，尚未证明业务代码路径可利用，因此不能直接宣称项目已被攻破。

证据：[package-lock.json](/Users/rivers/MoreThanCorn/package-lock.json:4728)、[package-lock.json](/Users/rivers/MoreThanCorn/package-lock.json:5944)。

## 3. 后端审计

### P1：数据源支持范围与模型声明不一致

- `Datasource.type` 声明 `mysql|postgresql|oss|http`，但 Reader registry 只实现 PostgreSQL；Writer registry 也只实现 PostgreSQL。
- MySQL 健康检查依赖 `pymysql`，生产 requirements 未安装该驱动，因而会失败关闭。
- OSS 在生产分支明确返回“真实对象探测未实现”。HTTP 只有健康 GET，没有任务数据读取器。

证据：[reader registry](/Users/rivers/MoreThanCorn/server/app/data_readers/__init__.py:12)、[writer registry](/Users/rivers/MoreThanCorn/server/app/data_writers/registry.py:8)、[resource_tests.py](/Users/rivers/MoreThanCorn/server/app/resource_tests.py:148)。

### P1：存在两个概念相近、生命周期不同的数据源模型

`Datasource` 表示资源/数据库连接，`DataSource` 表示 Webhook/轮询事件入口，两者分别落在 `datasource` 和 `data_source` 表，UI 也分别叫“数据资产”与“数据接入”。这不是单纯命名问题：连接、健康、游标、事件和资产之间没有统一的所有权边界，未来会增加权限、审计和迁移成本。

证据：[models.py · Datasource](/Users/rivers/MoreThanCorn/server/app/models.py:1045)、[models.py · DataSource](/Users/rivers/MoreThanCorn/server/app/models.py:1468)。

建议明确 bounded context：例如 `ResourceConnector/DataAsset` 与 `EventSource`，并用显式关系连接，不要继续让两个 DataSource 名称扩散到 API/DTO/UI。

### P1：数据接入写接口错误地允许 viewer

创建数据源、手动轮询、发送测试事件均使用无角色参数的 `require_role()`，在生产中任何已登录 viewer 都能写入或触发外部调用。代码中自动任务创建已使用 `require_operator`，这里明显不一致。

证据：[as_automations.py](/Users/rivers/MoreThanCorn/server/app/routers/as_automations.py:1009)、[as_automations.py](/Users/rivers/MoreThanCorn/server/app/routers/as_automations.py:1540)、[as_automations.py](/Users/rivers/MoreThanCorn/server/app/routers/as_automations.py:1555)。

### P1：事件过滤器对未知操作符 fail-open

`_apply_filter()` 对不认识的 `op` 返回 `True`。配置拼写错误会把原本应被过滤的数据全部放行，应在保存时校验枚举，并在运行时 fail-closed。

证据：[as_automations.py](/Users/rivers/MoreThanCorn/server/app/routers/as_automations.py:1050)。

### P1：首次重试时间计算有舍入错误

30 秒退避先把当前时间截到整分钟再加 30 秒；当当前秒数大于 30 时，`next_retry_at` 已经在过去，第一次重试会立即到期。应直接使用 `now + timedelta(seconds=delay)`。

证据：[as_automations.py](/Users/rivers/MoreThanCorn/server/app/routers/as_automations.py:1379)。

### P1：Webhook 安全模型仍是基础 bearer token

优点是 token 只存 SHA-256 摘要并用恒定时间比较，事件有 `(source_id,dedupe_key)` 唯一约束。缺口是应用层未见请求体大小限制、时间戳/重放窗口、请求体 HMAC 签名、IP/速率限制。如果这些不由网关补齐，token 泄露后没有抗重放与抗洪泛能力。

证据：[webhook handler](/Users/rivers/MoreThanCorn/server/app/routers/as_automations.py:1564)、[event model](/Users/rivers/MoreThanCorn/server/app/models.py:1484)。

### P2：事件总状态会掩盖部分投递失败

只要任一 delivery 完成，event 就会进入 `dispatched`，即便其他 route 失败。明细仍在 delivery 中，但列表级状态容易让运维漏看部分失败。建议引入 `partial_failed` 或成功/失败计数。

证据：[as_automations.py](/Users/rivers/MoreThanCorn/server/app/routers/as_automations.py:1360)。

### P2：公开 metrics 暴露且指标内容有误

鉴权中间件只保护 `/api/*`，`/metrics` 不在其内；如果网关没有单独限制，会泄露运行数量。另一个明显 bug 是 `wf_workflows_total` 实际统计 `Tool.id`。

证据：[main.py](/Users/rivers/MoreThanCorn/server/app/main.py:15)、[admin.py](/Users/rivers/MoreThanCorn/server/app/routers/admin.py:863)。

### 后端做得好的部分

- 生产环境缺失/非法 Fernet key 时拒绝启动；机器端点与登录端点边界清楚。
- Secret 不回显、轮换/清除独立、动态 canary 泄漏检查通过。
- 数据库标识符校验与参数化值、PostgreSQL 唯一键幂等写入、事件去重和 route revision 冻结设计合理。
- 中央 egress policy 对已接入它的 HTTP 测试路径有效；问题是 polling 绕开了它。
- 后端测试量与迁移检查明显好于前端。

## 4. 前端审计

### P1：任务看板把摘要请求失败伪装成真实的 0

实机页面表格显示共 107 个任务，后端摘要返回 `total=107, ended=105`，但四张 KPI 卡均显示 0。原因层面仍需单独定位网络/加载链路，但表达层已经确定：页面读取 `summary.data ?? {}` 后对缺失值使用 0，且完全不展示 `summary.error`。错误状态被误表达成业务零值。

证据：[task-board.tsx](/Users/rivers/MoreThanCorn/src/pages/task-board.tsx:119)。

![任务表有 107 条而 KPI 全为 0](/Users/rivers/.codex/visualizations/2026/09/13/01a09959-9bdb-79c3-962d-d2ec034d08ea/task-board-summary-mismatch.png)

### P1：API 基址存在两套默认值

旧客户端 `wf-api.ts` 默认 8100，新客户端 `as-api.ts` 和四处页面直连默认 8120。当前 `.env.local` 掩盖了问题，但预览、测试或生产漏配环境变量时，同一页面可能请求两个后端。

证据：[wf-api.ts](/Users/rivers/MoreThanCorn/src/services/wf-api.ts:4)、[as-api.ts](/Users/rivers/MoreThanCorn/src/services/as-api.ts:8)、[agent-workspace/connectors.tsx](/Users/rivers/MoreThanCorn/src/pages/agent-workspace/connectors.tsx:51)。

### P1：加载失败被多个页面吞成空状态

资源列表把失败直接 `setData([])`；连接列表也只结束 loading，不展示错误。网络故障和“确实没有数据”对用户不可区分。这类错误表达会直接污染运营判断。

证据：[res-list.tsx](/Users/rivers/MoreThanCorn/src/pages/res-list.tsx:58)、[wf-connections.tsx](/Users/rivers/MoreThanCorn/src/pages/wf-connections.tsx:155)。

### P2：全局 Suspense 会在路由懒加载时替换整个应用壳

`Suspense` 包住全部 `Routes`，页面块加载时侧栏和导航也会消失，实机导航中观察到整页表格骨架闪屏。应让 AppShell 常驻，把 fallback 下沉到 outlet/页面区域。

证据：[app.tsx](/Users/rivers/MoreThanCorn/src/app.tsx:97)。

### P2：复杂度集中且客户端契约松散

- `wf-api.ts` 1456 行；`agent-chat.tsx` 1298 行；`agentflow-detail.tsx` 1031 行。
- 后端 `runner.py` 1770 行、`business.py` 1647 行、`as_automations.py` 1584 行、`models.py` 1504 行。
- 前端仍有 4 处原生 `fetch` 绕过服务层；后端大量端点用裸 `dict` body，缺少强类型 DTO/自动生成客户端。
- 前端只有 11 个测试文件、65 个测试，未找到 DataSources、Connections、TaskBoard 的专用组件/集成测试。

这会提高变更耦合和契约漂移成本；已经出现“映射 UI 文案与实际字典方向相反”的实例：UI 写“payload 路径 → 触发输入键”，代码实际遍历 `for key, path in mapping.items()`，即“触发输入键 → payload 路径”。

证据：[data-sources.tsx](/Users/rivers/MoreThanCorn/src/pages/data-sources.tsx:131)、[as_automations.py](/Users/rivers/MoreThanCorn/server/app/routers/as_automations.py:1074)。

## 5. UI/UX 审计

### 视觉与信息架构优点

- 深色主题、侧栏、卡片、表格、状态色和间距系统整体一致；主操作位置稳定。
- Connection 将 lifecycle 与 health 分开显示、Secret 不回显、轮换后要求重测，这些都是正确的企业管理语义。
- 移动端 390px 的创建 Connection 对话框能重排为可操作的单列/双列组合，没有明显裁切。

### P1：连接管理页面不适合真实运维密度

桌面端内容区被设置导航限制在约半屏宽，右侧大面积空白；同时一页 12 张四列卡片，名称、协议和状态大量截断。管理员恰恰需要完整名称、端点环境、健康时间和引用关系，卡片布局降低了扫读与故障定位效率。建议桌面端默认用密集表格，卡片仅用于窄屏或概览。

![连接管理在桌面端空间利用不足、卡片信息被截断](/Users/rivers/.codex/visualizations/2026/09/13/01a09959-9bdb-79c3-962d-d2ec034d08ea/connection-management-density.png)

### P1：Connection 表单依赖 placeholder，屏幕阅读器无字段名称

PostgreSQL 的 host、port、username、database 四个 Input 没有关联 label/`aria-label`；可访问性树只显示匿名 text field。placeholder 也会在输入后消失。这里不能宣称 WCAG 合规，当前证据只足以确认表单命名缺失。

证据：[wf-connections.tsx](/Users/rivers/MoreThanCorn/src/pages/wf-connections.tsx:108)。

![390px 移动端连接表单](/Users/rivers/.codex/visualizations/2026/09/13/01a09959-9bdb-79c3-962d-d2ec034d08ea/postgres-connection-form-mobile-390.png)

### P2：交互可访问性与产品文案仍有工程痕迹

- 任务列表整行只绑定 `onClick`，没有键盘焦点、button/link 语义或 Enter/Space 行为。
- 搜索框只有 placeholder，没有可访问名称。
- “查收结果（一期无真实查收状态，不伪造）”把内部实现阶段暴露给最终用户，应该隐藏能力或换成面向用户的解释。
- Webhook token 只在段落中显示一次，没有复制、确认保存或重新生成引导，容易造成一次性凭据丢失。

证据：[task-board.tsx](/Users/rivers/MoreThanCorn/src/pages/task-board.tsx:208)、[task-board.tsx](/Users/rivers/MoreThanCorn/src/pages/task-board.tsx:231)、[data-sources.tsx](/Users/rivers/MoreThanCorn/src/pages/data-sources.tsx:99)。

## 6. 架构与交付审计

### P1：自动化测试没有被仓库内 CI 强制执行

仓库未发现 `.github/workflows` 或等价的仓库 CI 配置。当前测试是“本机可以通过”，不是“每次合并都必须通过”。至少应把 typecheck、lint、前后端测试、npm audit、Alembic 单 head、secret leak、真实 Docker build 纳入合并门禁。

### P1：发布文档与运行时实际行为漂移

README 仍把项目描述为“前端原型”和“mock service”，与现有 FastAPI/PostgreSQL/AgentScope 架构明显不符。release 文档称 Worker/Scheduler “当前随 app.main lifespan 启动”，实际生产默认关闭 embedded worker，但 watcher 默认仍在 API 进程启动；文档又没有给出独立进程的完整命令。这会造成部署者误配任务执行和轮询职责。

证据：[README.md](/Users/rivers/MoreThanCorn/README.md:1)、[release.md](/Users/rivers/MoreThanCorn/docs/ops/release.md:37)、[main.py](/Users/rivers/MoreThanCorn/server/app/main.py:61)。

### P2：发布门禁存在假失败，也缺少关键真验证

`check-no-prod-mock.mjs` 当前失败，指向 `update_provider()`；手工审查确认它实际调用了 `_assert_no_mock_base()`，后者有 production guard，因此这是静态扫描器只看同一函数体造成的假阳性。与此同时 `check-release.mjs` 通过，却没有真实构建 Docker 镜像。这说明门禁的可信度需要校准，不能只追求“有脚本”。

证据：[check-no-prod-mock.mjs](/Users/rivers/MoreThanCorn/scripts/check-no-prod-mock.mjs:39)、[admin.py](/Users/rivers/MoreThanCorn/server/app/routers/admin.py:568)。

## 7. 实际验证结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 11 文件、65 测试通过 |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过但有 3 个 React hooks 警告 |
| `npm run build` | 通过；最大 chunk 802.50 kB（gzip 278.07 kB），有拆包警告 |
| `server/tests` | 567 通过，1 个 Starlette/httpx 弃用警告 |
| `runtime_contract` | 5 通过 |
| `runtime_service` | 7 通过，1 个相同弃用警告 |
| `tool_service` | 7 通过 |
| `pip check` | 通过 |
| `check-release` | 通过，但不构建镜像 |
| `check-no-secret-leak` | 静态 + 动态 canary 通过 |
| `check-no-prod-mock` | 失败；手工确认当前为扫描器假阳性 |
| `npm audit --omit=dev` | 1 high、0 critical；reachability 未验证 |
| 轮询相关后端测试 | 未找到 |
| Docker 实际构建 | 未执行：当前机器没有 Docker；静态分析已确认 context 失配 |

## 8. 建议的修复顺序

1. **先冻结能力口径**：UI 暂时隐藏/禁用 polling、MySQL、OSS、HTTP 数据读取，产品文案改成“PostgreSQL 数据资产接入 + Webhook Beta”。
2. **修 P0 连接一致性**：Reader/Writer 统一解析环境与结构化凭据；补真实 PostgreSQL 集成测试。
3. **修轮询安全闭环**：复用 Connection + auth + egress policy，限制 payload/批量/超时/重定向，加入 per-source schedule、游标原子提交和 backpressure。
4. **修发布链**：修 Docker context；CI 真构建、启动、迁移、readyz、最小读写回归。
5. **修 RBAC 与 Webhook**：数据源写操作收紧到 operator/admin；增加 schema、HMAC、时间窗、速率和体积限制。
6. **修前端真实性**：loading/error/empty 三态分离；API base 单一事实源；任务 KPI 不允许错误降级为 0。
7. **再做 UI 信息架构**：Connection 改表格主视图、补 label/键盘语义、隐藏内部阶段文案；最后拆大文件与生成 API 客户端。

## 9. 验收标准

只有同时满足以下条件，才建议把状态改成“可连接真实数据源”：

- 至少一个外部 PostgreSQL（非本机平台库）从创建 Connection、环境密钥、测试、DataAsset 绑定、分页读取、失败重试到结果写回全部通过。
- 相同连接使用 Basic 结构化密钥和环境覆盖时，测试与运行连接到同一目标。
- polling 从 UI 能完整配置，SSRF 用例被拒绝，认证、间隔、分页、游标和批量上限都有自动化测试。
- 生产镜像可由空缓存构建并完成 migration + API + worker + watcher/scheduler smoke test。
- 任务/资源/连接页面在 API 失败时显示错误而不是 0 或空数据。
- P0/P1 测试成为合并门禁，且高危生产依赖清零或完成有依据的例外审批。
