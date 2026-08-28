# Domain Agent Runtime Provider — Phase R3 验收记录

日期：2026-08-29｜分支 `codex/domain-agent-runtime-provider`｜状态：完成（待用户验收）

## 1. 交付内容
- **R3-1 执行目标**（migration `g042r3target0001`，up/down 双库验证）：analysis_task(_version).execution_target_type=workflow|agent + agent_id + 版本策略列；workflow_id 改可空；单条 OR 复合 Check 约束（互斥）；POST /api/tasks 收 executionTarget（旧 workflow payload 兼容），响应统一返回 executionTarget。
- **R3-2 TaskRun 冻结**：resolved_workflow_version_id/resolved_agent_version_id/resolved_release_id/runtime_binding_snapshot 启动一次解析；执行/重试一律读冻结值（断言不漂移）。Agent 策略：pinned|latest_sandbox_release|latest_prod_release，Release 必带 Provider 绑定（失败关闭）。
- **R3-3 统一分派**：task_runner `_interaction_run/_dispatch_interaction_run`——Workflow→Runner；Agent→`execute_module_run_sync`（worker 内联：提交→有界轮询→终态收尾→结果事务，与 workflow 批次同步语义一致）。
- **R3-4 结果事务**（exactly-once）：lifecycle→runtime metadata 留痕→**输出 Schema 平台二次校验**（不合→Run failed OUTPUT_SCHEMA_ERROR）→CallRecord（model/tool 结束事件映射，仅脱敏元数据，providerSequence 去重）→Module map_result 投影→QualityResult（agent_version_id/ai_result/追踪字段）+Evidence→**冻结 ResultRuleVersion 派生评分**（Agent 不算分）→同一事务提交。重复轮询/结算不产生第二条（INV-03）。
- **R3-5 Workflow 调 Module Agent**：agent-exec → 子 Agent Run（同步）；成员优先沙箱 Release 绑定/冻结版本；子 Run 阶段只写 Trace 不造假 NodeRun（断言）；成员输出 content+output 双通道。

## 2. 测试证据
| 门禁 | 结果 |
| --- | --- |
| 后端全量 `pytest tests -q` | **270 passed**（R3 新增 4：创建校验+互斥/批次 e2e（冻结快照+恰好一条结果+规则派生 100 分+CallRecord 映射+exactly-once）/失败重试沿用冻结快照成功重汇/agent-exec 嵌套） |
| 迁移 | wf_test+wf_dev up→down→up（约束形态修正为单条 OR 复合 CHECK；agent_version_policy varchar(32)） |
| Runtime 套件 | AgentScope 9 / DSH 10 |
| `scripts/verify-runtime-r0.py` | PASS |
| verify-fullstack | 38/49（失败集=存量基线；S13 过） |
| 历史 Workflow 任务回归 | 既有 09 套件全绿（per-interaction/INV 不变） |

## 3. 偏差与限制
1. Agent 批次为**同步内联执行**（与 workflow 批次语义一致）；分钟级 Provider 延误会占用批次 worker——异步批次+进度聚合留待容量加固（09 D-5 触发点）。
2. `run.runtime_snapshot.runtimeBinding` 承载批次绑定快照（未加独立列，避免 Run 表再加列；SDD §5.6 语义等价，字段可追溯）。
3. 草稿预览仍需显式 providerId（无 Release 时）；批量失败重试沿用冻结 Release（不漂移）。
4. 未跑真实模型/未 push/未 `--apply`/未动用户验收栈。
