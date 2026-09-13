# 2026-09-13 批1+批2 交付：后端可信度 + 前端加固（外部审计后续）

- 依据：`docs/audits/2026-09-13-project-audit.md` §8 修复顺序 + 我方建议（用户批复「来 开始」）。
- 范围：批1 后端可信度（P0-1/快赢三件/Webhook 加固/Docker 静态修复）+ 批2 前端加固（拆包/组件测试/gate.sh/对比度测量）。
- 判定：**READY_FOR_ACCEPTANCE**。`scripts/gate.sh --live` 一键全绿（含活体层3/层4/返工实证）。
- 批3（Connection 表格重设计/数据源治理 UI/IA 术语/对比度色值）为视觉与产品决策，**方案备妥待拍板，未擅动基线**。

## 批1：后端可信度

### 1.1 P0-1 连接解析双轨收口（外部审计最高优先级）
- 病灶：连接测试走 `resolve_for_request()`（环境合并+结构化凭据取 password），Reader/Writer 直读 `conn.endpoint` + `decrypt_secret` 裸串——**结构化 Basic 凭据会把整个 JSON 当密码、环境覆盖完全失效**，"测试通过但任务连不上/连错环境"。
- 修复：新增 `connection_runtime.resolve_db_target()` 唯一实现（环境合并 / payload.username 优先于 endpoint.user / 裸串=密码 / Datasource.location 优先于 endpoint.database），**PostgresReader、PostgresWriter、admin._probe_connection 三方统一收口**。
- 测试 `test_p0_connection_resolver.py` 5 例：结构化凭据精确断言（user/password 字符串级）、裸串兼容、环境覆盖+default_env、database 优先级、**真 PG 集成**（结构化凭据+prod 环境覆盖下 Reader keyset 分页真读 3 行 / Writer inspect_target / 探测三方同参连通）。
- 诚实注记：本机 PG 为 trust 认证，密码值正确性由单元层字符串断言证明，集成层证明管线接通；外部真库验证仍属报告 §9 验收标准（需用户环境）。

### 1.2 快赢三件
- `/metrics`：① `wf_workflows_total` 原统计 `Tool.id`（数错对象）→ 改 `Workflow.id`；② 补内部令牌门——配置 `MTC_INTERNAL_TOKEN` 即强制 `X-MTC-Internal` 校验，生产未配置 fail-closed 501，开发未配置放行。活体实证：错令牌 401 / 对令牌 200。
- 事件聚合 `partial_failed`：任一 delivery 完成即 dispatched 的掩盖语义 → 有成有败如实标 `partial_failed` + error 摘要（明细仍在 delivery 层）。
- `fast-uri` 3.1.5→3.1.7（npm overrides 强制），**`npm audit --omit=dev` 0 漏洞**（P0-4 清零）。

### 1.3 Webhook 加固（平台侧可做的部分）
- 请求体上限 256KB（content-length 预检 → 413）；per-source 滑动窗口限速（默认 60/min，`config.rate_limit_per_min` 可配 → 429）。测试：`test_webhook_size_and_rate_limits`（12/12 文件绿）。
- 诚实边界：chunked 无长度请求的体积兜底属网关/部署项；限速为进程内存实现（多 worker 须共享存储）；HMAC 签名/重放窗口**归 EventBridge 接入切片**（阿里云事件自带签名，现在自建大概率拆掉重做）。

### 1.4 Docker 发布链静态修复（P0-3）
- 病灶：构建上下文 `server/` 无法解析 requirements 里的 `../packages/runtime_contract`——**镜像从来构建不出来**，而 check-release 通过。
- 修复：Dockerfile 改仓库根上下文（`docker build -f server/Dockerfile .`），COPY packages/ + server/*，WORKDIR /app/server 使相对路径成立；`docs/ops/release.md` 同步：构建命令 + **进程模型表对齐真实行为**（Worker 生产默认 off 且无独立入口=部署欠账如实登记；Watcher 默认 on 随 API 进程、多实例锁互斥）。
- 诚实注记：本机无 Docker，**未做真实构建验证**——文件与文档均标注「首次真实构建前不得宣称镜像可用」。

## 批2：前端加固

### 2.1 vendor 分组拆包（eng#17）
`vite.config.ts` manualChunks 按包分组（react/radix/codemirror/markdown+highlight/charts/xyflow/motion），无 catch-all（强分组会成循环 chunk，实测警告后移除）：

| chunk | 修复前 | 修复后 | 加载时机 |
|---|---:|---:|---|
| tool-result（共享块） | **802.5 kB** | 23.0 kB | 懒 |
| 入口 index 两块 | 487.5 + 426.3 | **157.7**（单块） | 首屏 |
| vendor-react | （混入入口） | 231.6 | 首屏 |
| vendor-radix | （混入入口） | 170.0 | 首屏 |
| vendor-markdown | （混入共享块） | 779.7 | **仅对话/节点面板懒页** |
| vendor-codemirror | （混入入口） | 473.3 | 仅脚本编辑器懒页 |
| vendor-charts | chart 330.4 | 406.4 | 仅图表懒页 |

首屏原始体积 ≈ 913→559 kB（-39%），重依赖全部退出首屏路径；>500kB 警告仅剩懒加载块（如实保留，不靠调 chunkSizeWarningLimit 消音；再瘦需 beui CodeBlock 换 PrismLight 注册制=组件改造批）。

### 2.2 三页面组件测试 ×11（eng#19 第一批）
- `task-board.rework.test.tsx` ×4：摘要失败→alert+重试、禁渲染假 0；成功→真实 KPI；pending 行徽章=排队中（LANE_LABEL 语义锁定）；查收文案为零；行 role=link+Enter 键盘可达。
- `data-sources.rework.test.tsx` ×3：轮询字段齐备+缺 URL 拒提交+**config 形状按后端契约断言**（url/interval_seconds/cursor_field/cursor_param/mapping）；映射方向文案；列表失败错误态；token 一次性交付（复制+强提醒）。
- `wf-connections.rework.test.tsx` ×4：失败错误态；搜索防抖走服务端 search 参数；协议计数来自全量拉取（后页协议不消失）；操作按钮 focus-visible 类。
- vitest 总数 65→**76**（14 文件）。

### 2.3 仓库门禁 battery（eng#20 第一步）
- `scripts/gate.sh`：一键串 tsc/lint(--max-warnings=0)/vitest/build/pytest/层1/层2/迁移单 head/secret 扫荡/npm audit，`--live` 追加层3/层4/返工实证。**规约：交付提交前必须本机跑绿**（GitHub 网络不稳+提交长期本地未推，远端 CI 保护不了当前工作流）。
- `.github/workflows/gates.yml` 已写好（frontend+backend 两 job，PG service container），推送常态化即生效；层3/4 不入 CI（需活体栈+浏览器）。
- 首跑证据：`ALL GATES GREEN (含活体)`，EXIT=0。
- 已知假失败登记：`check-no-prod-mock.mjs`（扫描器只看同函数体的假阳性，外部报告 §6 已手工复核）未纳入 battery，待扫描器校准。

### 2.4 对比度测量轮（UI#21，只测量未改色）
`scripts/audit_contrast.py`：解析四主题 token，WCAG 2.x 公式量化 15 组真实配对（含徽章 soft 底组合）。结果：
- **dark / dark-parchment：全过**。
- **light / light-parchment：14 处正文级确凿 <4.5:1**——`--text-tertiary #838280`（3.84/3.65，时间戳类小字）；状态三色作文本/徽章皆不过：success #42B883（2.5/2.27）、warning #E6A53A（2.14/1.94）、danger #E06363（3.42/3.05）。
- **处置：色值是原站实测冻结基线，不擅自改**。已算好全过的文本角色候选值待拍板（见下）。

## 拍板提案（批3 + 色值，均不擅动）

| # | 决策 | 建议方案（推荐项已算好可过检值） |
|---|---|---|
| D1 | 浅色主题对比度 | 新增**文本角色 token**：light 系 `--status-success-text:#237A4E`（5.30/5.03/4.82）、`--status-warning-text:#8F6410`（5.25/4.99/4.76）、`--status-danger-text:#BE4343`（5.16/4.90/4.59）、`--text-tertiary` 加深至 `#737270`（4.81/4.56）；**图标/色点/图表保持原站值**，仅文本与徽章字色切 -text token——最小视觉漂移过 WCAG。dark 系不动（已全过） |
| D2 | Connection 桌面布局 | 推荐**表格主视图**（列：名称/协议/鉴权/环境数/生命周期/健康/最近检查/操作常显），卡片仅 <lg 断点保留；信息不截断（名称 title+两行省略） |
| D3 | 数据源治理 UI | 推荐**行内抽屉**（不新增一级页）：基本信息+编辑/暂停/删除（需补后端管理端点）+事件流水（复用 F5 `/api/v2/event-deliveries?sourceEventId` 扩展 by-source 过滤）+死信重试；token 重新生成端点同批补 |
| D4 | 双「数据源」IA + 术语 | 推荐不动导航：两页互设一句边界说明+跳转；`ui-terms.ts` 扩 glossary（中文主名/英文技术名/适用域）作文案单一事实源 |

## 门禁证据（可复现）

```
./scripts/gate.sh --live     → ALL GATES GREEN (含活体)，EXIT=0
  其中：tsc ✓ / eslint --max-warnings=0 ✓ / vitest 76(14文件) ✓ / build ✓ 3.6s
       pytest 573 ✓ / 层1 0/0/0 ✓ / 层2 P0=0 P1=0 ✓ / 迁移单head ✓
       secret ✓ / npm audit prod 0 漏洞 ✓ / 层3 P0=0 P1=3(历史行) ✓
       层4 162控件 0无效果 ✓ / 返工实证 V1-V4 ✓
metrics 令牌门活体：错令牌 401 / 对令牌 200
python3 scripts/audit_contrast.py → 四主题×15配对量化表（/tmp/contrast2.json 同款可重跑）
```

## 遗留登记（不静默）
- Docker 真实构建验证（本机无 Docker）；独立 Worker 进程入口（部署切片欠账）。
- beui CodeBlock 换 PrismLight（vendor-markdown 779→约 100kB 级，组件改造批）。
- `check-no-prod-mock.mjs` 扫描器假阳性校准。
- 外部报告余项：Reader registry 与 type 声明对齐（建议冻结能力口径而非补实现）、webhook HMAC（EventBridge 切片）、大文件拆分轮、存量 `as unknown as`（契约客户端生成批）。
- 报告 §9「可连接真实数据源」验收标准中的**外部真库端到端**仍待用户环境实测。
