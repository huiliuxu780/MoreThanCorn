# Phase C｜运行可观测与节点系统

状态：大纲（开工前细化为可执行规格）
预估：2.5 周
前置：Phase B 已验收

---

## 1. 目标

把"运行可观察可重放"闭环补到调研验收线：Trace/Span 结构化、CONTROL/CONTENT 双通道事件、节点目录按编排器过滤、Inspector schema 驱动、补齐调研基线节点、变量体系统一为结构化绑定并接入记忆持久化。

对标：调研 07 §3（Trace）、08 §9（双 SSE）、11（节点规格）、12 §7（绑定）、§15.2–15.4（验收）。

## 2. 范围（细化前的边界承诺）

### C-1 Trace/Span 与事件通道
- `run_event` 增列：`channel(CONTROL|CONTENT)`、`trace_id`、`span_id`、`parent_span_id`、`duration_ms`、`tokens`。
- 事件 Envelope 对齐调研 00 §9.5（eventId/sequence/runId/traceId/channel/type/payload）。
- Span 类型化：LLM / TOOL / KNOWLEDGE / AGENT / ROUTER / MEMORY / WORKFLOW；子 Agent 调用同 trace + `hop` + 预算传递（承接 B 的版本上下文）。
- SSE 断线按 sequence 恢复（现有 Last-Event-ID 机制保留）。

### C-2 节点注册表升级
- `editorKinds: ["FLOW"|"GROUP"|"WORKFLOW"]`：Flow 目录 = 调研 20 类口径（含域节点标注）；Group 目录收敛为 7 类可添加 + Start/End；质检工作流保留域节点。
- 能力声明：`resourceType / supportsNodeTest / sideEffectLevel`。
- 节点类型版本 `configSchemaVersion`（迁移钩子预留，不必全量实现）。

### C-3 Inspector schema 驱动
- 通用表单渲染器消费 `NodeDefinition.schema`；`x-control` 注册自定义控件（prompt-editor/tool-picker/agent-picker/knowledge-picker/mcp-picker/variable-picker 已有雏形）。
- 手写 ConfigDrawer 分支逐个迁移，迁移完删除。

### C-4 补齐节点（优先级排序，逐项可独立验收）
1. 对话回复（CONTENT 流出口；承接 A-05 的 notification 语义拆分）
2. 记忆变量节点 + Memory Service 持久化（表：tenant/agent/user/key + TTL；写后回读验证＝调研 §15.2）
3. Query改写 / 决策分类 接真 LLM（替换占位执行器）
4. 工作流选择（语义路由）/ 固定工作流节点
5. 代码编写沙箱（子进程隔离 + 超时 + 输出声明）
6. 信息收集（提问-暂停-恢复；工程量最大，允许拆两个迭代）
7. 数据查询（依赖现有 Datasource；NL2SQL 可后置）
8. 图像生成（依赖模型能力，允许 mock-first）
- 不做：客服工具（全局不做清单）。

### C-5 变量体系统一
- 结构化 `ValueBinding` 全面替换 `{{...}}` 字符串（字符串仅作展示渲染）。
- 五作用域：SYSTEM（14 个系统变量入注册表）/ RUN_INPUT / NODE_OUTPUT / MEMORY / SECRET（预留）。
- 节点删除/端口变化时引用进入 INVALID 并阻断发布（校验器扩展）。
- 条件节点改存结构化左值（移除正则解析）。

### C-6 节点单测与预检分层
- 节点单测：填入参 → 单节点执行 → 输出/日志/错误（调研 07 §4）。
- 预检三层：静态结构（现有）+ 依赖解析 + 环境（凭据/配额占位）。

## 3. 验收基线（映射调研 §15.2–15.4）

- [ ] 跑通 `Start → LLM/Code → Condition → Reply → End`，分支/合流/类型校验正确（§15.3）
- [ ] 变量选择器只显示系统、Start 与可达祖先输出（§15.3、11 §5.2）
- [ ] 节点失败停止或走错误分支；SSE 断线可恢复（§15.3）
- [ ] autonomous 完成一次 Knowledge + Tool + Memory 可观察链路，Memory 写入可回读（§15.2）
- [ ] 专家组主路由/兜底可验证；子 Agent Span 与主 Trace 关联；循环/最大 hop 生效（§15.4）
- [ ] Group 目录只见 7 类可添加节点；Inspector 无"暂无专项配置区"残留
- [ ] Trace 视图按 Span 树展示类型/耗时/错误；不展示隐藏推理全文（00 §9.6）

## 4. 候选项（范围外，登记备查）
- 汇总器（Aggregator）独立节点（调研缺口：无真实样本，先设计后验证）
- 灰度流量切分的数据面支持

## 5. 状态日志
- 2026-08-25 大纲建立；开工前须细化为可执行规格并冻结。
