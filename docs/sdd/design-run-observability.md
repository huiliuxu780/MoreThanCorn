# 设计规格：Run 详情页观测化升级（LangSmith 风格 Trace 视图）

状态：P1+P2 已实现（2026-08-24，/trace 端点+四 Tab+span 树瀑布+钻取；P3 待定）
依据：LangSmith Trace/OTel span 模型；现状 `src/pages/run-detail.tsx`（平铺五段）；
后端已有观测底座：`RunEvent.span_id/parent_span_id/trace_id/channel/tokens`（SDD C-1）、
`NodeRun.input/output/error/token_usage/duration_ms/attempt`、`CallRecord(kind/tool|model|mcp|knowledge, node_run_id, latency_ms, token_usage, request/response 脱敏)`、`Run.token_usage/origin_run_id`。
**结论：数据底座比页面先进——缺的不是采集，是"span 树 + 真时间轴 + 钻取"的呈现与一个组装端点。**

---

## 0. 调研对齐（2026-08-24 补）

- span 字段对齐调研 07 §3 Trace 模型：`type` 词表（LLM/TOOL/KNOWLEDGE/WORKFLOW/AGENT）、`usage{inputTokens,outputTokens}`、`attributes`（nodeId/attempt/trigger）、`error{code,message,retryable}`。
- 参考产品主 trace 形态＝对话内“查看 N 个步骤”手风琴（调研 02 §Trace Accordion + 证据截图 08/09：thinking/tool/answer 逐行展开）→ Trace Tab 左栏提供 [Span 树 | 查看 N 个步骤] 双模式。
- 观测指标对齐调研 07 §6：运行观测面板补 Token 消耗/错误率卡。

## 1. 现状问题（为什么"完全平铺"不对）

1. 五段纵向平铺（指标卡 / Frozen Snapshot / 节点时间线 / 事件流 / Interaction Executions），无层级、无钻取，扫读成本随 run 复杂度线性增长。
2. 节点时间线的条形只按"最大耗时相对宽度"画，**没有起始偏移、没有真实时间轴**——看不出"慢在哪一段、谁和谁并行"。
3. 事件流是裸序列，不按 span 分组；`node_started/node_completed` 要人肉配对。
4. **NodeRun.input/output 已存但页面完全不展示**——排查"LLM 拿到了什么、吐了什么"现在做不到。
5. **CallRecord（LLM/工具/MCP/知识调用）无任何 API 与视图**——token 花在哪次调用、哪次调用慢，不可见。
6. "查看运行 Trace" 对话框 = 事件流重列一遍，不是 trace。
7. token 无聚合；重试谱系（`origin_run_id`）不可视；失败无错误传播高亮。

## 2. 概念映射（LangSmith/OTel → 本系统）

| 观测概念 | 本系统实体 | 说明 |
| --- | --- | --- |
| Trace | `Run` | trace_id = run_id |
| Root Span | Run 自身 | 含 input/output/error/token_usage |
| Span（chain） | `NodeRun` | parent = root；attempt>1 显示重试角标 |
| Leaf Span（llm/tool/retriever/mcp） | `CallRecord` | parent = 所属 node_run |
| Nested Trace | agent 子 Run | 经 CallRecord(kind=agent) 或补 `run.parent_run_id` 链接（P3） |
| Span Events | `RunEvent` | 已有 node_run_id/span_id 可挂回 span |

## 3. 页面结构（平铺 → 头部 + 四 Tab）

头部（跨 Tab 常显）：Run 名/ID、状态徽标、**总耗时、总 Tokens、LLM 调用数**、trigger 与版本标签（agent+V / workflow+V）、开始→结束；动作：复制、重试、重新运行、取消、导出 Trace JSON（P3）。指标卡保留并加 Tokens/调用数两卡。

Tab：

| Tab | 内容 | 备注 |
| --- | --- | --- |
| **Trace**（默认） | span 树 + 瀑布 + 右栏钻取 | 核心，见 §4 |
| Events | 原事件流 + 过滤（type/node/channel）+ 点事件跳 Trace 对应 span | 保留 SSE 同源原始事实 |
| 业务结果 | 现 Interaction Executions 表原样迁入 | 批量轨主视图；workflow 轨显示空态说明 |
| Snapshot | Frozen Snapshot 网格 + Tools/Mapping Sheet 迁入 | 不可变事实独立成 Tab |

## 4. Trace Tab 形态（LangSmith 同构）

```
┌ Trace ── 时间轴 0ms ────────── 4090ms ────────── 8180ms ┐
│ ▾ Run #b501…            ✔ 8180ms · 1.2k tok [██████████]│
│   ▾ llm · 大模型         ✔ 8012ms · 1.2k tok [█████████]│
│       model · qwen-plus  ✔ 7990ms · 1.1k tok [████████]│
│   kr · 知识检索          ✔ 40ms                  [ ]    │
│   tl · 插件工具          ✘ 60ms (Tool timeout)   [ ]    │← 失败红条+祖先链高亮
│ ┄┄┄┄┄┄┄┄┄┄┄┄ 选中 span 右栏 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ llm · 大模型  ✔ 8012ms  起 02:03:18.123  attempt 1      │
│ [Input] [Output] [Events] [Metadata]                    │
│  CodeMirror 只读 JSON 查看器（折叠/搜索）                │
└────────────────────────────────────────────────────────┘
```

- 树行 = 缩进(深度) + 展开箭头 + 类型 icon（llm/tool/retriever/mcp/chain）+ 名称 + 状态点 + 耗时 + tokens。
- **瀑布条用真实时间轴**：left = started_at − run.started_at，width = duration（替换现有相对宽度）；并行自然重叠可见。
- 行点击 → 右栏 SpanDetail：Input/Output（JSON 只读查看器）、Events（该 span 的 run_event 子集）、Metadata（node_type/attempt/model/token 明细/error 栈）。
- 失败 span 红条，其祖先行加浅红底（错误传播）。
- 纯 React+Tailwind 实现（绝对定位画条），不引新依赖；组件全走标准件（Tabs/Sheet/CodeMirror）。

## 5. 后端契约

新增 `GET /api/runs/{id}/trace`，一次组装（前端不再多路拼接）：

```
{ "root": SpanNode, "totalTokens": {prompt, completion, total},
  "modelCalls": n, "startedAt": ..., "endedAt": ... }

SpanNode = { id, kind: run|node|model|tool|mcp|knowledge|agent,
  name, status, startedAt, endedAt, durationMs, attempt?,
  tokenUsage?, input?, output?, error?, children: [SpanNode] }
```

组装来源：Root=Run；children=NodeRun（按 started_at 序）；NodeRun.children=CallRecord(by node_run_id)。
`GET /api/runs/{id}/events-list` 增 `?nodeRunId=` 过滤参数（Events 挂 span）。
嵌套 agent 子 Run、`parent_run_id` 链接归 P3（若 CallRecord(kind=agent) 未带 node_run_id，补一行传参）。

## 6. 分期

| 期 | 内容 | 相对量 |
| --- | --- | --- |
| P1 | `/trace` 端点 + Trace Tab（树+真时间轴瀑布+SpanDetail I/O） | 中/大 |
| P2 | 页面改四 Tab；Events 过滤+跳 span；Snapshot 迁 Tab；头部加 Tokens/调用数 | 中 |
| P3 | 嵌套 agent 子 run span、重试谱系链（origin_run_id）、Trace JSON 导出、成本估算（可选，需价目表） | 中 |

## 7. 兼容与风险

- 批量轨 Run 无 NodeRun 时 Trace Tab 显示空态 + 指向 Events/业务结果，不假画。
- 大 JSON：查看器默认截断 2000 字符 + "展开全部"，防卡。
- 时间轴精度：同库 now() 时钟一致；duration 为 null（running）画到当前时间并标"进行中"。
- 不删现有能力：重试/取消/复制/Sheet 全保留，仅重排。
