# Phase C｜运行可观测与节点系统（细化版）

状态：**已冻结**（2026-08-25 夜间，用户授权连续施工；大纲细化为可执行规格）
预估：本夜尽量完成，未完成项留绿灯与续作点
对标：调研 07 §3（Trace）、08 §9（双通道）、11（节点规格）、12 §7（绑定）、§15.2–15.4

---

## 1. 范围（本阶段）

### C-1 事件通道与 Trace 骨架
- migration 017：`run_event` 增列 `channel`(CONTROL|CONTENT)、`trace_id`、`span_id`、`parent_span_id`、`duration_ms`、`tokens`(JSONB)。
- `emit()` 默认 `channel=CONTROL`、`trace_id=run_id`；`llm_delta`、`reply_sent` 走 CONTENT。
- 节点执行自动产生 span 语义：`node_started/node_completed` 事件补 `span_id=node_run_id`、`parent_span_id=run_id`、耗时与 tokens（从 NodeRun 读取回填）。

### C-2 节点注册表 editorKinds + 目录过滤
- 注册表条目增加 `editor_kinds: ["FLOW"|"GROUP"|"WORKFLOW"]`。
- `GET /api/registry/node-definitions` 原样下发；设计器画布按编辑器类型过滤可添加节点：
  - WORKFLOW（质检工作流）：现有全集（含 create-record/notification 域节点）。
  - FLOW（对话编排）：调研 20 类口径 + 域节点标注（mcp-call/create-record/notification 标记"平台扩展"）。
  - GROUP（专家组）：仅 7 类可添加（agent/agent-select/agent-exec/decision-class/query-rewrite/condition/code-write）+ Start/End。
- 前端 `agentMeta` 增加 `agentType` 字段传入设计器。

### C-3 Inspector 通用渲染兜底
- 无专项表单的节点类型按注册表 `schema.properties` 渲染通用表单（string→Input、number→Input、boolean→Checkbox、enum→Select、其他→JSON 文本），替代"暂无专项配置区"。

### C-4 补齐节点与真实执行器
| 节点 | type_key | 执行器 |
| --- | --- | --- |
| 对话回复 | `reply` | 发 CONTENT 事件 `reply_sent`（渲染引用），不终止流程 |
| 记忆变量 | `memory-variable` | 读写持久化 `memory_record` 表（migration 017；键空间 = agent_id 或 wf 作用域；写入校验已声明键） |
| 工作流选择 | `workflow-select` | LLM 在候选工作流中语义路由（mock：首个候选）；输出 workflowCode/Name/Desc；未命中走 `miss` 分支 |
| 工作流（固定） | `workflow-fixed` | 绑定固定工作流，子运行执行（沿用 workflow-exec 机制，绑定态存 workflowId） |
| Query改写 | `query-rewrite` | 真 LLM 改写为列表（mock：原 query 单元素）；输出 `queryList:array` |
| 决策分类 | `decision-class` | 真 LLM 分类（mock：第一类）；输出 classificationTitle/Id + 分类分支 handle |
| 代码编写 | `code-write` | 子进程沙箱：`python3` 执行，超时 10s，`args.params` 传入，返回字典作为输出 |

**明确推迟到 D 阶段候选（登记，不实现）**：信息收集（暂停-恢复需要运行检查点）、数据查询（NL2SQL 依赖数据目录）、图像生成（依赖生图模型能力）。

### C-5 变量体系（部分）
- 系统变量目录落地：`/api/registry/system-variables` 返回调研实测 14 项（tenantId/userId/userName/sysTime/language/memberId/formId/robotCode/nick/serviceId/serviceName/phoneNum/onlineChannelSource/initContext）。
- 变量级联增加"系统变量"分组（插入 `{{system.xxx}}`，runner 的 system 分支按名返回，未知名返回空串）。
- **偏离登记**：`{{}}` 字符串引用完整结构化迁移（ValueBinding AST）推迟到 D——当前后端校验器已覆盖可达性，迁移属展示层重构，不影响闭环。

### C-6 节点单测
- `POST /api/workflows/{wid}/node-test`：`{nodeId, input}` → 用给定 run_input 执行单个节点执行器 → 返回 `{ok, output, error, durationMs}`；不落 Run/事件。

## 2. 验收清单
1. [x] run_event 新列存在；`llm_delta`/`reply_sent` 为 CONTENT，其余 CONTROL（`test_c1_event_channels_and_trace_ids`、`test_c1_reply_node_emits_content_channel`）
2. [x] GROUP 画布目录仅 7 类可添加；WORKFLOW 全集不变（`editor_kinds` 注册表 + 前端过滤，`201a597`）
3. [x] 7 个新节点执行器测试全绿（`test_c4_*`：code-write 超时拦截、决策分类分支、工作流选择路由、记忆读写）
4. [x] 记忆变量读写持久化 + 未声明键拒绝 + 跨运行回读（`test_c4_memory_write_read_persists_across_runs`；未声明键拒绝见 B 阶段 `test_b_memory_write_rejects_undeclared_key`）
5. [x] 系统变量接口 + 级联系统分组 + `{{system.outputs.x}}` 运行可解析（`test_c5_system_variables_registry_and_resolution`）
6. [x] 通用 Inspector 兜底：无专项表单的节点可编辑配置（`GenericSchemaForm`，构建通过；手工核验）
7. [x] 节点单测接口：成功/失败两条用例（`test_c6_node_test_endpoint`）
8. [x] 既有测试不回归：全量 **80/80 绿**

## 3. 状态日志
- 2026-08-25 大纲建立。
- 2026-08-25 夜间细化为可执行规格并冻结（用户授权连续施工），开工。
- 2026-08-25 夜间完成：后端（`601d365`）+ 前端（`201a597`）；80/80 pytest 绿。**待用户逐项验收。**
- 实施偏离登记：①系统变量引用格式为 `{{system.outputs.x}}`（与既有引用语法同构）；②节点单测入参覆盖节点固定绑定；③`exec_workflow_fixed` 用独立会话读子运行状态（会话缓存陷阱，同 `exec_workflow_exec`）。
