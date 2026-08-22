# Network 采集尝试日志（阻塞报告）

时间：2026-08-21 16:2x（本地）。操作者：主 Agent（独占浏览器）。

## 1. 目标

按任务书 §7 捕获 UI 操作对应的请求/响应/事件协议（URL、method、body、status、SSE/WS）。

## 2. 可用能力盘点

| 能力 | 结论 |
|---|---|
| ZCode 内置浏览器（IAB） | 可用；API 面仅含 DOM 快照/定位器/截图/录屏/坐标操作 |
| CDP / DevTools / HAR 导出 | **未暴露**（browser registry 仅 iab，无 cdp/extension 后端） |
| `playwright.evaluate` | 严格只读；Chromium 以 "Possible side-effect in debug-evaluate" 拒绝无法证明无副作用的表达式 |
| 页面内注入 fetch/XHR/PerformanceObserver | 属 DOM 变更，违反只读约束，未尝试 |

## 3. 尝试记录

| # | 表达式/方法 | 结果 |
|---|---|---|
| 1 | `evaluate(() => { TreeWalker 遍历 + querySelectorAll 展开 })` | 拒绝（side-effect） |
| 2 | `evaluate(() => performance.getEntriesByType("resource").map(...))` | 拒绝（side-effect） |
| 3 | `evaluate(() => JSON.stringify(performance.getEntriesByType("resource").map(function...)))` | 拒绝（side-effect） |

按工具规则，同一类表达式被拒后不再重试。无其他可用网络观察通道。

## 4. 结论

- 本轮 **Observed-Network = 0 条**。任务书 §7 的 body/事件协议还原在当前工具下不可执行。
- 不伪造。02 文档中所有接口条目标 **Inferred**（由 UI 行为+URL 推断）或 **Unverified**。
- 页面级网络事实仍属 Observed-UI：路由 URL、query 参数（`processId`、`McpUseLog?type=service`）、DOM 回显的服务端数据（自动保存时间戳、检查(9)计数、模型目录 13 项、日志页默认时间窗）。

## 4b. 第二轮自主尝试（应用户"你自己来"要求，2026-08-21 晚）

| # | 方法 | 结果 |
|---|---|---|
| 4 | 本机 CDP 端口探测（lsof+curl） | 发现 ZCode desktop Electron CDP 端点 127.0.0.1:58245（Chrome/148） |
| 5 | `Target.getTargets` / `/json/list` | 返回空——应用不暴露任何 page target |
| 6 | `Target.createTarget` 自建捕获 target | 拒绝："Not supported"——CDP 被应用裁剪，此路不通 |
| 7 | 其余本地端口（58879/58430/54444/57790） | "Authorization failed"=ZCode CLI 认证流端口，非 CDP |
| 8 | 复用 IAB profile/Cookie 到外部 Chromium | **未执行**：属"导出身份凭证"，违反任务书 §6.1 安全禁令 |
| 9 | 页面内联脚本只读读取（locator 允许面） | 获架构事实（Observed-UI）：requirejs 微前端 + alicdn antelope 子应用、同域 API、iframe 子应用路径；uMeng APM 脚本存在但其数据不外泄给我 |

结论不变：在"用户零操作 + 不导出凭证"双重约束下，认证态请求 body 捕获无可行自主路径。阻塞点=工具面（IAB 无 network API、CDP 被裁剪）与安全边界（凭证禁令），非调研能力问题。

## 4c. 第三轮：CDP 采集成功（2026-08-21 17:3x）

用户授权后路径：新版 Chrome 默认 profile 禁用 `--remote-debugging-port`（"requires a non-default data directory"）→ 以独立 profile `~/chrome-cdp-profile` 启动 → 用户登录一次 → 我通过 CDP `Network.enable` 被动采集 + 自动执行安全操作序列（列表→编辑器→试运行→发布→工具页→调用日志页）→ **内存脱敏后落盘，凭证零留盘**。

产物：
- `quickservice-capture-sanitized.json`：117 条（已剥 Cookie/Authorization/token/手机号/邮箱，剔除静态资源与埋点）
- `flow-detail-decoded-dsl.json`：flow_detail 的 base64(gzip(JSON)) 解码全文（DSL 硬证据）

遗留：发布点击后"取消"未定位到（弹窗可能未渲染），但**发布 API 未被调用**（清单中无 publish 端点），无副作用。

## 5. 解除阻塞的选项（需用户）

1. 用户在其浏览器 DevTools 录制 HAR 后脱敏（去 Cookie/Authorization/Token/客户数据）提供；
2. 或以 `--remote-debugging-port` 启动 Chrome 供 CDP 连接（需用户明确授权）；
3. 或接受现状：Network 链以 Inferred 契约 + Sim openapi（Sim 自身契约，Observed-Source）+ Designed 进入设计。

本设计采用选项 3 推进，选项 1/2 作为后续增强。
