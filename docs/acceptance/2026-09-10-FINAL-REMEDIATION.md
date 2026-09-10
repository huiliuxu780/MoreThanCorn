# 最终缺陷清零轮交付报告（2026-09-10）

> 任务书：MoreThanCorn AgentScope 换底最终缺陷清零任务（§一–§十三）。
> 本报告按任务书 §十三 18 项组织；所有 PASS 附可复跑命令/证据路径。
> 代码状态：**未提交、未推送**（沿用用户指令）。

## 1. 最终判定

**FINAL_REMEDIATION_ACCEPTED**（待本文件 §14 门禁表全绿确认后生效；若最终全量复跑
出现失败则降级 BLOCKED 并逐条登记）。

§十二 停止门禁逐条核对：

| # | 门禁 | 状态 | 证据 |
|---|---|---|---|
| 1 | P0 全关闭 | ✅ | §3 各项 + 回归测试 test_final_remediation_p0.py 18/18 |
| 2 | P1 关闭 | ✅ | §4 |
| 3 | Agent 执行唯一 AgentScope 路径 | ✅ | test_p0_07_* 退役不变量 + 生产 import 扫描零命中 |
| 4 | 无伪造 Session/KB/事件 | ✅ | P0-01 fail-closed + synthetic 过滤测试 |
| 5 | 仅 wf_dev 长期库 | ✅ | `psql -lqt` 仅 wf_dev（§6） |
| 6 | 测试库自动清理 | ✅ | conftest wf_pytest_* 会话级建/删；wf_fixture 模块级建/删；复跑后残留 0 |
| 7 | 产品列表无测试数据 | ✅ | 左栏 Agent(5) 全真实；验收 Agent 已清理 |
| 8 | 新建→发布→对话→刷新恢复 | ✅ | §11 UI E2E（浏览器实录） |
| 9 | 对话全状态+视觉 | ✅ | §12 + exports/visual-evidence-2026-09-10 |
| 10 | 任务/自动任务/接入闭环 | ✅ | 后端 E2E 13/13 + 页面取证 |
| 11 | 导航/设置/详情三视口 | ✅ | 18 张三视口截图 + measurements-after-1440.json |
| 12 | 后端全量 0 失败 0 挂起 | ✅ | §14（481 passed ×多轮） |
| 13 | 前端门禁 | ✅ | typecheck/lint/test/build/diff-check 全 rc=0 |
| 14 | 证据均本轮 | ✅ | exports/*2026-09-10* |
| 15 | PASS 可复核 | ✅ | 每项附命令/路径 |

## 2. 重开记录

见 `2026-09-09-AGENTSCOPE-CUTOVER.md` §0 `FINAL_REMEDIATION_REOPENED`（原 G8 PASS 被
现场推翻、残留数字失效、Knowledge synthetic ID、旧 Runtime 依赖、库数量、前端不达标）。

## 3. P0 修复清单（代码级）

| P0 | 修复 | 回归测试 |
|---|---|---|
| P0-01 KB 伪造 ID | `_ensure_knowledge_base` 改官方 list→create、fail-closed（`KnowledgeUnavailableError`）；根因=旧 payload 缺 `credential_id/dimensions` 恒 422 被 except 掩盖；发布期失败阻止发布；start_session 过滤平台 id/synthetic id（不挂载不伪造） | test_p0_01_*×3 |
| P0-02 参数丢弃 | `split_model_params` 白名单（AgentScope Parameters 字段）+ 发布快照冻结 `frozen_model_params/frozen_exec_timeout_seconds`；`chat_model_config_for_release` 全路径（chat/run/schedule/Workflow 节点/AgentFlow 节点）统一 | test_p0_02_*×2 |
| P0-03 Schedule 漂移 | `_sync_schedule` 钉住 `automation.runtime_release_id`；重发布→删旧建新；模型配置取自冻结快照 | test_p0_03_* |
| P0-04 环境隐式 | `resolve_runtime_agent(..., environment=)` 必填、严格过滤、禁跨环境降级；start_session/run_turn/run_structured/批处理/AgentFlow 全链路显式 | test_p0_04_* |
| P0-05 Flow 解析 | `resolve_agentflow_release`（definition→version→active release）；手动/自动/Tool 三入口共用 | test_p0_05_* |
| P0-06 双 active | g051 部分唯一索引（stable/canary 各一 + flow 一条）；`publish_release` 统一事务（行锁+失败回滚）；并发发布测试 | test_p0_06_*×2 |
| P0-07 旧 Runtime | 结算迁 `run_settlement.py`；agent_chat 死代码删除；agent_runtime ReAct 族删除；main.py 不 import 退役路由；`Run.agentscope_session_id` 专名列（g052）+ 缓存键含 user | test_p0_07_*×4 |
| P0-08 内部鉴权 | 会话级令牌（平台存 sha256、运行时内存注册、官方 DELETE 可清）；flow-run 级令牌；run-platform-tool/run-workflow/run-agent-flow/session-manifest 校验令牌+Release 冻结清单白名单；owner 归属一致性（start_session/会话端点用发布 owner 连运行时）；凭据缓存键 `{user}:{conn}` | test_p0_08_*（含越权 401/403） |
| P0-09 测试粉饰 | 临时库+hermetic 运行时+live 标记；advisory-lock 泄漏根修（专用连接）；worker 竞态 fixture；挂起文件根因=wf_test 污染（已消除）；全量 481×多轮 0 失败 0 挂起 0 跳过 | 全量复跑记录 §14 |

## 4. P1 修复

- `agent-create.tsx` useMemo 副作用 → useEffect。
- SSE 断线指数退避重连 + 重连前回读持久化消息（不重复消息/工具卡）；切换 Session 关旧流（原有）保留。
- Thinking 增量按 block id 聚合（不再每 delta 一卡）。
- 自动滚动：用户上滚脱离、回底接管（替代纯手动 checkbox 语义，checkbox 保留为状态显示）。
- 重复实现收敛：resources_manifest 唯一定义（agent_execution，agent_release 重导出）；发布事务唯一（publish_release）；Session 运行时引用解析唯一（_session_runtime_ref）。
- 发布对话框移除 Runtime Provider 必选（换底后 Release=AgentScope 物化）。
- 治理页"已封存"提示仅对封存 Agent 显示。

## 5. 数据库迁移链（本轮新增）

g051（唯一索引+钉住列）→ g052（run.agentscope_session_id）→ g053（会话/flow 令牌哈希列）
→ g054（event_delivery 入迁移链——B 轮裸建表欠账）。wf_dev/wf_test 均已 upgrade。

## 6. 数据库收敛与清理

详见 `exports/db-cleanup-2026-09-10/CLEANUP-REPORT.md`：

- 备份 10/10（pg_dump -Fc + pg_restore --list 验证），含 wf_dev 本体。
- 删除 9 库：wf_test(4.2GB/6.2M 行)、wf_agentscope、wf_fixture、wf_e2e{,_2,_3}、wf_accept、wf_drill、wf_as_probe。
- AgentScope 官方 Storage 共库 wf_dev（官方无 schema 隔离选项；11 复数表 vs 平台单数表零冲突实测）。
- wf_dev 平台垃圾按 marker 单事务清理（11 Agent/6 Workflow/15 Task/4 Schedule/3 Automation/7 DataSource/95 Run 级联）；孤儿 FK 复查 0。
- 保留：5 真实 Agent + 171 Run + 104 QualityResult（B1 金样本历史）+ audit/check_run。
- 隔离登记（不删）：Workflow「测试」「dbg-wf2」（DEMO-002B 依赖）、audit-A、DEMO-002B*、forms×4。
- 防再积累：临时库自动删 + hermetic 运行时 + live 套件自清理 teardown。

清理后实测：库=1（wf_dev）；平台 Agent=5；运行时 Agent=5、Session=1（证据会话）、Schedule=0；孤儿 FK=0。

## 7. AgentScope 唯一执行入口证明

- 生产代码 import 扫描：`runtime_providers.worker`/旧 ReAct 零命中（test_p0_07_*）。
- 统一入口 `agent_execution`：chat（as_agents sessions/turns）、fresh run、automation dispatch、
  Workflow Agent 节点（task_runner→run_into_existing_run）、AgentFlow 节点（flow_runner 官方
  PipelineProtocol）、agent Tool 回调（内部端点→统一入口）——全部经
  resolve_runtime_agent/start_session/run_structured。
- 运行时侧仅官方原语组合（mtc_router/flow_runner），无平行状态机。

## 8. 装配矩阵（Prompt/Model/Skill/Tool/MCP/Knowledge/Workflow/AgentFlow）

| 对象 | 控制面 | 发布冻结 | 运行时装配 | 证据 |
|---|---|---|---|---|
| Prompt | 草稿 config | compile_system_prompt digest | AgentRecord.system_prompt | runtime-view digest 对比（既有）+ test |
| Model | Model 行+modelRef | frozen_model_id/params/timeout | SessionConfig.chat_model_config | test_p0_02 + 真对话（qwen3.8-max 实参） |
| Skill | skill 表 | _frozen_skills(content+digest) | Workspace 官方上传 | test_release_manifest…（live） |
| Tool | tool/tool_version | _frozen_tools(version) | 内部端点白名单执行 | test_p0_08 白名单 403 |
| MCP | mcp_server+connection | _frozen_mcps(url/transport) | Workspace MCP 官方接口 | live E2E |
| Knowledge | knowledge_source | _frozen_knowledges(真实 KB id/未配置不挂载) | RAGMiddleware（官方） | test_p0_01；外部连通=NOT_CONFIGURED_EXPECTED（无火山鉴权） |
| Workflow | workflow 表 | 任务/Agent 清单 workflow_ids | runner DAG + 统一入口 Agent 节点 | test_r3 |
| AgentFlow | definition/version/release | release 指针 | 官方 PipelineProtocol（flow_runner） | test_p0_05 + live |

## 9. 真实运行/Session ID（本轮证据）

- 真对话（保留 Agent 质检-OpenAI POC）：Session `2b1e86577a08442cb684a0323ccd3bf9`
  （qwen3.8-max，finished_reason=completed，刷新恢复验证）。
- UI E2E 验收 Agent（已清理）：创建 dc45b2e0…→V2 发布 prod→Session f530013a…→真回复→刷新恢复→清理。
- 发布 Release：9c64cad1/68b04ff7/279e9ccf/68bd35f1/3865cca5（5 保留 Agent prod）。

## 10. 任务/自动任务端到端

- 后端：test_p0_e2e_live_stack 13/13（schedule/api/event/polling、max_runs 原子门、deadline、
  死信、interrupt、structured output、active-release 并发）。
- 页面：/tasks、/autonomous-tasks 三视口取证（ours-after-*）。

## 11. Agent 新建完整流程（§六）

浏览器实录（1440×900）：/agents/new → 选 Module 卡/自定义角色对话框（头像/名称/职责/
生成/上传/手动/Skill/模型）→ 模型必选+无模型引导（§六.8）→ 创建 → 详情 → 配置页发布
（环境+灰度，无 Provider 绑定）→ 对话新建 Session → 真回复 → reload 恢复 → 验收 Agent 清理。
证据：ours-after-agent-create-*.png、ours-after-chat-live-reply-1440.png。

## 12. 对话页状态矩阵（§七）

空白会话引导/用户输入/发送中/回复流/Thinking 聚合/Tool 卡（tool_call_id 聚合+脱敏）/
Skill·Knowledge·MCP·子Agent·平台 badge/Flow 节点 chip/structured 卡/interrupt/failed/
cancelled/retry（重发语义标注）/reload 恢复/Session 切换关旧流/SSE 重连去重/自动滚动脱离/
键盘 Enter 发送 Shift+Enter 换行/长文本折叠/秘钥脱敏——实现+测试+浏览器验证。

## 13. 导航/设置/详情（§八）与视觉取证（§九）

测量（measurements-after-1440.json，1440×900）：主侧栏 240/y0；顶区 48（品牌+折叠同行）；
导航首项 y=48（原站同值）；Agent 二级栏 240/x240/y0；主内容页头 h48/x480；Agent 列表
flex-1 独立滚动（max-h-64 已删）；真实头像；齿轮唯一设置菜单（弹菜单不跳页）；身份区静态；
设置页空壳分区删除+二级栏 240；详情全宽 hero 删除、身份仅概览一次。
三视口（1440×900/1280×720/1024×768）×6 页=18 张 + 参考 19830 七张：
exports/visual-evidence-2026-09-10/。
视觉门禁方法学声明：采用结构测量等价（关键元素 x/y/w/h 与参考同构）+ 截图人工比对，
未做像素级 diff 百分比；不声称像素级 95% 数值门禁。

## 14. 门禁命令与结果（本轮）

| 命令 | 结果 |
|---|---|
| `server/.venv/bin/python -m pytest tests/ -q --timeout=180` | 481 passed, 0 failed, 0 skipped（×多轮稳定） |
| `pytest tests/test_final_remediation_p0.py` | 18 passed |
| `pytest tests/test_p0_e2e_live_stack.py tests/test_cutover_p0.py` | 18 passed（live 8120+8301） |
| `npx tsc --noEmit` / `npx eslint src` / `npm run test` / `npm run build` | rc=0 / rc=0 / 46 passed / rc=0 |
| `git diff --check` | rc=0 |

## 15. 尚存差异（诚实登记）

1. Knowledge 外部连通：火山引擎鉴权缺失 → `NOT_CONFIGURED_EXPECTED`；接入契约完成、
   未配置时显示不可用、发布阻止策略生效；不声称连通通过。
2. `#tool:` mention 展开随旧 ReAct 引擎退役（行为差异登记；如需恢复应立项为 PromptBundle 编译步骤）。
3. QoderWake 市场/Group/员工描述卡等不复制（历轮登记的范围外项）。
4. 视觉门禁为结构测量+截图比对，非像素 diff 数值门禁（方法学声明见 §13）。
5. wf_agentscope 历史 384 AgentRecord/1700 Session 为测试物化，备份后整体退役（非迁移）。
6. 隔离未删对象见 §6（来源不能确证者一律不删）。

## 16. 测试数据清理结果

平台：验收 Agent 及其 version/release/session/运行时记录全删；左栏 Agent(5)。
运行时：验收 AgentRecord/Session 删除（204）；保留 5 AgentRecord + 1 证据 Session。
临时库：wf_pytest_* 每轮自动删（复跑后 0）；wf_fixture 模块级自动删。

## 17. git status --short（摘要）

未提交改动覆盖：server/app（agent_execution/agent_release/agent_chat/agent_runtime/
automation_watcher/as_agents/as_automations/as_flows_board/agents/config/main/models/
resource_tests/run_settlement(新)/task_runner 等）、server/alembic（g051–g054）、
server/tests（conftest 临时库+hermetic、test_final_remediation_p0(新)、多套件修正）、
src（app-sidebar/app-shell/agent-chat/agent-create/settings/wf-agent-editor/
AgentWorkspaceShell/module-publish-dialog/agent-ops-panels/connection-picker）、
docs/acceptance（本报告+重开节）、exports（备份/取证/清理报告）、scripts（seed 白名单/栈脚本）。
完整清单以 `git status --short` 实时输出为准。

## 18. 未提交、未推送声明

本轮全部改动**未 commit、未 push**（沿用用户指令"不提交"）。备份与取证文件位于
exports/db-cleanup-2026-09-10/ 与 exports/visual-evidence-2026-09-10/（gitignore 覆盖 exports/）。
