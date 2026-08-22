# 11 · 数据模型（Designed · PostgreSQL/SQLAlchemy/Alembic）

> 分层：Workflow Kernel 对象（通用执行）vs 质检业务对象（Master §6）。二者通过 Adapter/API 关联，业务规则不进 Runner。
> 约定：PK=ULID(id)；时间 UTC（Implementation §5.1）；JSONB 存 definition/config；软删除仅业务对象，Kernel 运行数据用保留期归档。

## 1. Kernel 对象

### workflow（Agent）
id, name, description, status(draft|testing|published|deprecated), current_version_id FK, **draft_definition JSONB**（草稿全文，07 schema；ui 与 graph 同包分层）, draft_revision int（乐观锁，PUT draft 带 baseRevision，不匹配 409）, created_at/updated_at/by。
唯一约束：name 唯一。删除：软删；存在 Published 版本或活跃 Task 引用时禁止硬删。
（Sim 对照：草稿=规范化三表 vs 我们 V1 单表 jsonb——取 Sim"版本=整包 JSON 快照、触发绑定版本而非草稿"两点，弃其三表规范化，见 04。）

### workflow_version
id, workflow_id FK, version_no int, definition JSONB（07 全文，含 ui）, tool_version_refs JSONB, model_refs JSONB, input_schema JSONB, structured_output_schemas JSONB, note text, published_at/by。
唯一：(workflow_id, version_no)。**不可变**：无 update，仅插入。

### node_definition（Node Registry 持久化部分）
type_key PK, family, label, icon, schema JSONB（config fields）, io_schema JSONB（inputs/outputs 类型）, executor_key, version, enabled bool。
→ 代码注册为主，表仅做运维启停与版本记录（08）。

### tool / tool_version
tool: id, name, description, kind(http|builtin)（**无任意代码 kind**，对齐"不把 Workflow 存为任意源码"红线；builtin=白名单内置实现）, status, connection_id FK null。
tool_version: id, tool_id FK, version_no, input_schema, output_schema, spec JSONB（URL/method/模板或内置 key）, status(ready|deprecated)。不可变。

### model_provider / model
provider: id, name, base_url, auth_connection_id FK, status。
model: id, provider_id FK, model_key, display_name, capabilities[] (text/thinking), default_params JSONB, enabled。

### connection
id, name, kind(api_key|oauth2|basic), provider_hint, secret_ref（指向 Secret Store，**不存明文**）, status(active|error), last_test_at/result。
删除：被 tool/version 引用时阻断并提示（quickservice 未验证项，我们 Designed 为阻断）。

### schedule
id, name, task_id FK（V1 挂 Task；Kernel 保留 workflow_id 直挂能力）, cron_expr, timezone（企业时区，Implementation §5.5）, enabled, window_params JSONB, **pinned_version_id FK null**（启用时绑定 WorkflowVersion，null=跟随 task version_policy 解析；Sim deploymentVersionId 绑定思想，04/08 声称落点）, next_run_at, last_ran_at, failed_count, valid_from/to, created/updated。
索引：(enabled, next_run_at)。连续失败≥5 自动 enabled=false（Sim failedCount，09 §5）。

### job_queue（执行基础设施，09 §1）
id, type, payload JSONB, status(pending|processing|done|failed|cancelled), run_at, attempts, max_attempts, idempotency_key unique null, locked_at, locked_by, error JSONB, created_at。
索引：(status, run_at)。悬挂回收：processing 超 5min 重置 pending。

### trigger（手动/API）
不建表：manual/api 为 workflow.triggers 声明；API 触发经 idempotency-key 中间件落 run。

## 2. 执行对象

### task（业务）
id, name, workflow_id, workflow_version_policy(latest_published|pinned), data_asset_id, scope/sampling JSONB, schedule_id FK null, status。

### run
id, workflow_version_id FK, task_id FK null, trigger(manual|api|schedule|test), idempotency_key unique null, origin_run_id FK null（重试链）, status(queued|running|succeeded|failed|cancelled|timed_out), input JSONB, output JSONB, error JSONB, started_at/ended_at, duration_ms, token_usage JSONB, created_at。
索引：(task_id, created_at desc), (workflow_version_id), status。

### node_run
id, run_id FK, node_id, node_type, attempt int, status(pending|running|succeeded|failed|skipped|cancelled|timed_out), input JSONB, output JSONB, error JSONB, started_at/ended_at, duration_ms, token_usage JSONB。
唯一：(run_id, node_id, attempt)。索引：(run_id)。

### run_event
id, run_id FK, sequence bigserial per run, type, node_run_id null, payload JSONB, created_at。
唯一：(run_id, sequence)。→ SSE 重放源；保留期 30 天（可配）。

### tool_call / model_call（可并表 call_record）
id, node_run_id FK, kind(tool|model), target_id, request JSONB(脱敏), response JSONB(脱敏), status, latency_ms, token_usage, error。
日志脱敏管道写入（12）。

## 3. 业务对象（质检层）

### data_asset / data_asset_revision
资产资格+字段语义；revision 不可变。

### quality_result（AI Structured Result）
id, run_id FK, interaction_ref, workflow_version_id, structured_output JSONB, evidence_ids[], status(ai|reviewed|effective), created_at。

### evidence
id, result_id FK, kind(transcript_span|tool_call|field), locator JSONB, text, source_ref。

### review / review_revision；result_rules / rules_version
按 Master 冻结，略（已有原型页）。

## 4. 关系图（文字）

workflow 1—N version；version 1—N run；task N—1 version(policy)；task 1—1 schedule；run 1—N node_run 1—N event/call；run 1—N quality_result 1—N evidence。
**Kernel↔业务边界**：Runner 只写 run/node_run/event/call 与 structured output 载荷；Create Record 节点（Sink）经 Adapter 调业务服务写 quality_result——副作用幂等键=run_id+node_id（Master §8.9）。

## 5. 与 Sim 差异（03 已回填）

Sim 持久层为 PostgreSQL 单库（Drizzle；Run=workflow_execution_logs 单行+executionData jsonb，**非** Convex——Convex 仅是其被集成工具，Part B Observed-Source）。我们映射为上述关系表并偏离其单行模型：run/node_run 独立表，以保证质检证据链的节点级查询与"历史 Run 可解释"强约束。
