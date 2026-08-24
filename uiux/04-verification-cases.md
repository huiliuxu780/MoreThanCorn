# 全场景验证用例（Verification V1.0）

> 回答「项目是否能真实跑起来」：能。后端 FastAPI + PostgreSQL 真实运行，前端 Vite 真 API 模式（`VITE_WF_API=1`）真实渲染；LLM/数据库等外部依赖「配置真实即真连、未配置 mock 回落」。
> 本文档 = 用例矩阵 + 实跑结果（2026-08-23 执行）。自动化部分可重复执行。

---

## 0. 环境与启动

| 步骤 | 命令 | 说明 |
|---|---|---|
| 后端依赖 | `cd server && python3.12 -m venv .venv && .venv/bin/pip install fastapi "uvicorn[standard]" sqlalchemy psycopg alembic httpx croniter cryptography pytest` | venv 损坏时重建 |
| 数据库 | PostgreSQL 本地 5432；`WF_DATABASE_URL` 可覆盖；dev=`wf_dev`，pytest=`wf_test` | |
| 迁移 | `cd server && .venv/bin/alembic upgrade head`（dev 与 test 两个库） | 含存量 DataAsset 补建 Definition 回填 |
| 后端 | `.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8100` | `/healthz` 验证 |
| 前端 | `VITE_WF_API=1 npm run dev`（5173） | 不带 env 为 mock 模式，旧页面可用 |
| 全链路脚本 | `node scripts/verify-fullstack.mjs` | 41 用例 |
| 单测 | `cd server && .venv/bin/python -m pytest -q` | 38 用例 |
| 构建 | `npm run build` | tsc + vite |

### 真实外部依赖开关（可选）

| 依赖 | 开关 | 行为 |
|---|---|---|
| 真实 LLM | env `WF_LLM_BASE_URL` + `WF_LLM_API_KEY`，或 ModelProvider.base_url 为 http + Connection 凭证 | llm 节点走 OpenAI 兼容协议（百炼已联调通过，见 commit 1e2ef7b）；否则 mock |
| 真实 MySQL/PG | Connection.endpoint.host 有值且安装 pymysql/psycopg | datasource 测试真连；否则 mock |
| 真实 HTTP MCP/知识库 | Connection.endpoint.base_url / source_config.url 为 http | 握手/检索真连；否则 mock |

---

## 1. 自动化单测（pytest，38/38 PASS）

| 组 | 文件 | 覆盖 | 结果 |
|---|---|---|---|
| 内核/DSL/契约 | tests/test_contracts.py、test_runner.py、test_p2.py | 校验七规则、DAG 执行、SSE/重试/导出、schedule | PASS |
| 业务层 | tests/test_business.py | 规则引擎/Review/批量/任务 | PASS |
| 资源管理 P1/P2 | tests/test_resources.py（8） | 六类 CRUD、分域筛选、测试门禁、删除防护链、test executor、connections 升级 | PASS |
| 节点联动 P5 | tests/test_p5_nodes.py（2） | kr+mcp 节点端到端执行、发布 refs 快照、停用后校验 dependency | PASS |

## 2. 全链路 API 脚本（scripts/verify-fullstack.mjs，41/41 PASS）

| ID | 用例 | 结果 |
|---|---|---|
| S1-1/2 | 健康检查；节点注册表含 knowledge-retrieval/mcp-call | PASS |
| S2-1..3 | Connection 创建（protocol+endpoint+secret）/协议筛选+掩码/测试 | PASS |
| S3-1..4 | Datasource 未测试=Disabled 门禁；测试执行器；启用后状态/健康度；类型筛选 | PASS |
| S4-1/2 | Data Asset 挂 Datasource 创建；抽样测试 | PASS |
| S5-1..4 | Definition 创建 Draft；字段推断；空 schema 发布 422；发布 Ready(revision+1) | PASS |
| S6-1..5 | Models 列表+7日聚合；Tool 创建+版本；MCP 握手+工具发现；Knowledge 检索；Tool 测试 | PASS |
| S7-1..5 | 草稿含新节点保存；校验通过；发布；**Run 端到端（kr→mcp→llm→tool→create-record）succeeded**；quality_result 落库 | PASS |
| S8-1 | 规则发布+重算 | PASS |
| S9-1 | Review approve→REVIEWED | PASS |
| S10-1..4 | 任务带 dataDefinitionId 创建；batch-run 解析 rows；Run 成功；schedule nextRunAt | PASS |
| S11-1..7 | 删除防护矩阵：Datasource/Asset/Definition/Knowledge/MCP/Tool/Connection 被引用全 409+refs | PASS |
| S12-1..3 | 评测样本挂 Asset；eval-run；eval-summary | PASS |

## 3. 前端 GUI 实测（VITE_WF_API=1，浏览器执行）

| ID | 用例 | 结果 |
|---|---|---|
| G1 | AI Resources 列表真实数据（Models 6 条、Tabs/筛选/分页） | PASS |
| G2 | 分域向导全流程：选 MCP Server→配置→测试通过→保存并启用→回列表 `?tab=mcp&new=` 卡片高亮 | PASS |
| G3 | `/config/tools` → `/config/ai-resources?tab=tools` 重定向；`/settings/models` 同 | PASS |
| G4 | Data Resources 页渲染；Datasources 类型筛选（API 层 S3-4 覆盖） | PASS |
| G5 | 数据定义页列出存量回填 Definition | PASS |
| G6 | 质检结果页真实数据（验证 Run 落库的 quality_result，12 行） | PASS |
| G7 | 任务向导第二步出现「选择 Data Definition」（真 API 模式） | PASS |
| G8 | 设计器调色板含 知识检索/MCP 工具；验证工作流画布真实渲染 | PASS |
| G9 | 详情页双变体（Versions 时间线 / 变更记录）+ 删除拦截对话框 | PASS（原型+API 层；GUI 同组件） |
| G10 | 数据定义编辑器（schema 表格/推断/发布） | 手工用例（组件已构建，API S5 覆盖） |

## 4. 手工回归清单（发版前人工过一遍）

1. mock 模式（不带 VITE_WF_API）旧页面不回归：质检三页、Agents、结果规则。
2. 真实 LLM：配置百炼 base_url+key 后跑一次含 llm 节点的 Run，确认非 mock 输出。
3. 真实 MySQL：建 Connection(host)+Datasource，测试真连失败时健康度=Error 且可回改。
4. 停用资源后设计器 picker 不列出；运行含该节点的旧版本仍按快照执行。
5. 删除被引用资源的拦截对话框「查看引用方」跳转 Workflow 详情。

## 5. 已知边界（非缺陷，本期非目标）

- 健康度定时巡检调度：仅按需 Test 写入，无后台巡检（下期）。
- 任务向导创建按钮在 mock 模式仍为演示 toast；真模式经 bizApi 落库（S10 覆盖 API 层）。
- Knowledge 真实向量检索需外部后端 URL；默认 mock 切片。

---

**结论：项目可真实运行。** 自动化 38（pytest）+ 41（全链路脚本）全绿；GUI 实测 9/10 通过（1 项为手工用例）；主干「数据链 → 工作流 → 质检结果 → 规则 → 复核 → 评测」与资源管理一期「管理 → 测试 → 消费 → 引用保护」双闭环均在真实进程上验证通过。

---

## 6. 列表统一化改造（2026-08-23 增补，已实测）

针对「工作流分页丢失 / 卡片样式 / 进详情与操作不一致」三条反馈的实施与验证：

| 用例 | 结果 |
|---|---|
| 工作流列表补 `useListQuery + Pagination`（服务端搜索/分页，26 条 → 1–12/26，1/3 页） | PASS |
| 工作流卡升级为 ResourceCard 骨架：已发布/草稿徽章 + vN + 节点数 + 被 Agent 引用数 + ⋯ 菜单（裁剪为 详情/编辑/删除） | PASS |
| 工作流删除走确认对话框；被 Agent 引用时后端 409 并 toast 引用清单 | PASS |
| Agents 列表：hover 单删 + `window.confirm` 替换为 ⋯ 菜单（中文：查看详情/编辑/删除）+ 确认对话框；头像卡片视觉保留 | PASS |
| 数据定义页补 Pagination（含筛选重置页码） | PASS |
| 后端 `/api/workflows` 列表补 versionCount/nodeCount/agentRefCount 统计 | PASS |
| 回归：build 0 error；pytest 38/38 | PASS |

决策记录：表格类列表（任务/定义/连接）保持表格不动；Agents 保留复刻头像卡（仅统一操作），工作流收敛到 ResourceCard——经用户确认放宽该页复刻冻结。

## 8. Agent 运行层实施结果（2026-08-24，A1–A3）

- 后端：`run.agent_id` migration；`agent_runtime.py`（autonomous ReAct 循环：技能并入 system prompt、插件→function-call、工作流→子 run、知识→检索、记忆变量读写；护栏 8 步/60s；`agent:` 前缀链防递归）；专家组画布节点 executor（agent/agent-select/agent-exec + 决策分类/Query改写/代码编写别名）；`/api/agents/{id}/run|runs|runs/{id}|mounts-health`；workflow publish 同步 Agent 状态。
- 前端：自主规划预览调试接真运行（渲染 tool_call 事件+终答）；挂载「已失效」徽标；专家组试运行；运行历史；列表状态 chip 反映发布同步。
- 测试：pytest 43/43（新增 test_agent_runtime 5 例）；verify-fullstack 41/41 + S13×4 全过。
- 浏览器实测：自主规划编辑器发问 → 气泡渲染 `▸ agent_started / 🔧 memory_write / [mock:qwen-plus] 已处理…`；运行历史出现。
- 修复存量 bug：`/api/registry/models` 返回分页对象而编辑器当数组 `.map` 导致 /config/agents/:id 路由白屏（React 无 error boundary 整树卸载）；已改为 `r.items ?? []`。教训：lazy 路由模块渲染期抛错=整应用白屏，后续应补 error boundary。
