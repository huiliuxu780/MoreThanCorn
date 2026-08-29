# Domain Agent Runtime Provider — Phase R4 验收记录

日期：2026-08-29｜分支 `codex/domain-agent-runtime-provider`｜状态：完成（待用户验收）

## 1. 交付内容
**后端**
- Run Detail 增强（§15.4）：get_run 返回 `runtime`(provider/runtime/adapter/contract/module impl 版本)、`stages`(runtime_trace→阶段)、`calls`(CallRecord 脱敏)、`usage`、`evidence`。
- 运行时指标端点 `GET /api/runtime-providers/metrics/aggregate`：token/模型/工具调用/时长 P50/P95/cost 估算（门禁展示）。
- Provider 兼容矩阵：`GET /api/runtime-providers/{id}` 返回 `compatibleModules`（manifest 声明 × kind）。
- Module 目录端点 `GET /api/agents/modules`（Catalog/创建对话框共用）。

**前端（对位原型 v3）**
- Catalog：`wf-agents-list` 增加「新建 Agent」对话框（选 Module→名称→模型→Spec 知会只读）+ Module 徽标 + 类型筛选含封存标注。
- 配置页：新增 `module-agent-config.tsx`（编号分区卡：身份可编辑/模型/指令只读+业务定位/资源冻结；右侧测试面板选 Provider 运行→结构化输出+调用+usage）。
- 发布绑定：新增 `module-publish-dialog.tsx`（生成版本→环境→Runtime Provider 必选→灰度）。
- 编辑器分发：module 类型 → 配置页。

**门禁（离线）** `tests/test_r4_gates.py`（5 过）：Golden Set 评测器正确性（smoke GT passed/failed 反例）；worker 重启恢复不重发；Run Detail 增强字段；指标端点；兼容矩阵。

## 2. 测试证据
| 门禁 | 结果 |
| --- | --- |
| 后端 `pytest tests -q` | **275 passed**（270+R4 5） |
| 前端 typecheck / lint / build | 全绿 |
| `verify-runtime-r0.py` | PASS |
| verify-fullstack | 38/49（=存量基线；S13 过） |

## 3. 偏差与后续
1. 前端 Run Detail/任务向导/Providers 独立页 UI 本轮未做（后端字段已备），下轮补齐；不影响门禁。
2. cost 为 token 估算（真实计价以供应商账单为准）。
3. Golden Set 用 smoke GT（native_workflow GT 未随白名单迁入）；真实脱敏 Golden Set 属生产门禁（R4 后置/需数据授权）。
4. 未 push / 未 `--apply` / 未动用户验收栈与 `uiux/prototypes`、`scripts/view-final.mjs`。
