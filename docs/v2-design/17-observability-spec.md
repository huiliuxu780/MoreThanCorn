# 17 观测模块设计稿（09-18 用户令「需要规划观测」）

> 状态：设计稿，待审查拍板后动工。审计依据 docs/audits/2026-09-18-agentscope-truth-audit.md §4。
> 现状认账：Agent 执行（chat/structured/group）的事件与 token 不落库；live SSE 看完即丢；
> run_event/call_record 只服务 workflow/agentflow run。AgentScope 侧其实全有：
> 30 种会话事件 + bus replay log（session_read_events）+ ModelCallEndEvent token 记账 +
> finished_reason + OTel TracingMiddleware（需外部 TracerProvider）。

## 1. 目标 / 非目标

目标：
- G1 每次 Agent 执行（chat/structured/group 成员）全事件留痕可回放（模型调用/工具调用/思考/HITL/压缩/中断/超限）；
- G2 token 与成本按 run/session/agent/日 四级 rollup，可对账；
- G3 运行详情 trace 时间线 UI（含 tool args/result 脱敏展示）；
- G4 异常 finished_reason（ERROR/EXCEED_MAX_ITERS/INTERRUPTED）进告警接口（告警域拍板后接线）；
- G5 OTel 导出可选开关（dev 默认 off）。
非目标：不做 APM 级服务监控（另立项）；不做语音 TurnMetrics（上游语音专用，文本不适用——审计认账误读）。

## 2. 数据源（AgentScope 已提供，不造轮子）

- 事件：bus session replay log（`session_read_events`，含全部 30 种 EventType）；
- token：ModelCallEndEvent.input_tokens/output_tokens/cache_input_tokens/cache_creation_input_tokens；
- 结局：ReplyEndEvent.finished_reason ∈ {COMPLETED, INTERRUPTED, EXCEED_MAX_ITERS, ERROR}；
- 压缩/截断：COMPRESS 相关事件 + offloader 文件引用（workspace:///…）。

## 3. 采集路径

- Observer worker（8120 内嵌，随 WF_EMBEDDED_WORKER 开关）：
  - 活会话：订阅 bus live pub/sub（session_subscribe_events）增量写 trace 表；
  - 兜底：run 结束（REPLY_END/会话关闭）时 session_read_events 全量回捞对账补缺（幂等 by event id）；
  - 群会话：每成员 session 各采一条流，source 标签沿用聚合 SSE 口径。
- 不改 runtime；平台侧纯消费（bus 是既有信任域 Redis db4）。

## 4. 数据模型

- 新表 `run_trace_event`：id, run_id(nullable, chat 会话可无 run), session_id, agent_id,
  trace_id, span_id, parent_span_id, seq, type(EventType), payload(JSONB, 脱敏后),
  input_tokens, output_tokens, cache_tokens, duration_ms, finished_reason, created_at；
  索引 (session_id, seq), (run_id), (agent_id, created_at)；
- rollup 表 `agent_usage_daily`：agent_id, day, model_key, runs, input_tokens, output_tokens,
  cache_tokens, cost_cents（单价配置表 model_price：model_key→input/output 每千 token 分）；
- 保留期：trace 明细 30 天、rollup 永久（purge job 日跑，保留期配置化）；
- 脱敏：payload 内 secret 模式（SECRET_RE 复用）mask；tool args/result 超 4KB 截断+offload 引用。

## 5. 端点与 UI

- GET /api/v2/traces（跨 Agent trace 列表：filter=agent/status/trigger/model/时间窗/token 成本区间，分页）；
- GET /api/v2/traces/{traceId}（trace 详情=事件时间线/树）；
- GET /api/v2/agents/{id}/sessions/{sid}/trace（分页 seq）；
- GET /api/v2/runs/{runId}/trace（run↔session 关联沿用 interaction_ref）；
- GET /api/v2/agents/{id}/usage?from&to（日 rollup）；
- **IA（09-18 用户拍板方向：Trace 独立菜单页，形态对齐 Langfuse）**：一级组「观测」下两页——
  **Traces**（Langfuse 形态列表：filter 条+trace 行=时间/agent/触发/结局徽章/latency/tokens/cost，
  行点击进 /traces/:traceId 详情时间线/树）+ **Metrics**（agent 级 token 趋势/成本/错误率/超限）；
  运行详情保留「Trace」tab=同组件嵌入式深链（单 run 作用域 vs 全局检索，作用域不同非重复）；
  对话页保留 live 视图不变（trace 为事后回放）。Trace 对象唯一归属=观测/Traces。
- **图表组件基线（09-18 用户拍板：不手写、用 shadcn）**：shadcn/ui 官方 Charts
  （ChartContainer/ChartTooltip/ChartTooltipContent/ChartLegend/ChartLegendContent + ChartConfig，
  底层 Recharts v3）；主题走 --chart-1..5 CSS 变量（四主题 data-theme 各配）；accessibilityLayer 开。
  新增依赖仅 recharts（shadcn Charts 的官方底层）。原型：prototypes/observability-v1.html。
- 告警接口：observer 见 ERROR/EXCEED_MAX_ITERS 写 alert_event 表（告警域拍板前只落表不推送）。

## 6. 分期与验收

- O1（2 天）：observer worker + run_trace_event + 回捞对账；验收=golden 单样本跑完 trace 表含
  MODEL_CALL/TOOL_CALL/REPLY_END 全序列且 event id 幂等重跑不重复；
- O2（1.5 天）：token rollup + 单价配置 + usage 端点；验收=rollup 总和=trace 明细求和（对账脚本）；
- O3（2 天）：Trace tab + 观测子页 UI；验收=逐屏截图+trace 与 live 视图一致性抽查；
- O4（0.5 天）：OTel 开关（TracingMiddleware+OTLP endpoint 配置，dev off）；
- O5（0.5 天）：alert_event 落表（推送待告警域拍板）。
合计约 6 天。门禁：每期 gate 全绿+对应验收脚本入库。

## 7. 拍板点

- D1 保留期（明细 30 天推荐）；
- D2 成本单价来源（手工配置表推荐 vs 提供商 API 拉取后置）；
- D3 采集形态（live 订阅+结束回捞双保险推荐 vs 仅结束回捞=省资源但 live 期间无 trace）；
- D4 告警阈值（ERROR 即报推荐；EXCEED_MAX_ITERS 按 agent 日次数阈值另配）。

## 8. 先例调研（09-18 用户令「去找找有没有人用 shadcn 做过」）

- **Langfuse**（LLM 观测开源事实标准，github langfuse/langfuse，web/package.json 实证）：
  recharts ^3.8.0（与本仓同版本）+ @radix-ui 全家 + tailwindcss/tailwind-merge/tailwindcss-animate
  = shadcn/ui 模式（components/ui 复制式）。其 Trace 视图=业界标准形态：
  观测树/时间线行（每行 latency+tokens+cost 徽章）、展开 input/output JSON、
  按时间/按树双视图。**本 spec Trace tab 形态对齐 Langfuse**（树嵌套=群成员 leader→worker 观测）。
- **shadcn-admin**（satnaing/shadcn-admin，MIT，Vite+shadcn，10+ 页 dashboard）：布局/卡片/图表页惯例参考（同 Vite 栈）。
- **shadcn 官方 Charts blocks**：ChartContainer/Tooltip/Legend+ChartConfig+--chart-* 变量（本仓 chart.tsx 已含）。
结论：观测 UI 全栈有成熟先例，无自研必要；原型 v2 起对齐 Langfuse trace 形态。
