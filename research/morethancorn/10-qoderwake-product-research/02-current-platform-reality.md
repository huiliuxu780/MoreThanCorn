# 02 · MoreThanCorn 当前平台实现审计（阶段 2 / RESEARCH_ONLY）

> 日期：2026-09-08
> 执行者：阶段 2 执行代理（只读审计）
> 证据纪律：代码事实 = `C1`（文件路径 + 行号，行号以已提交 HEAD 为准）；数据库事实 = 只读 `psql SELECT`（完整命令见 §10）；推断 = `I1`（显式标注）；无法回答 = `EVIDENCE_GAP`（见 §8）。
> 本文件是本轮唯一新增交付物；未修改 `server/`、`src/`、`runtimes/`、`poc/`、迁移、测试、`docs/v2-design/` 任何文件；未运行 pytest 或任何写库脚本；未启停/杀任何进程；未使用浏览器自动化。

---

## 0. 执行环境与 git 状态快照

### 0.1 git 事实（C1）

```text
分支：main（领先 origin/main 25 个提交，未推送）
HEAD：f6824f9421660a4b1e6bb23cf455e738125ebc81
      "chore: checkpoint pre-research platform baseline"
      2026-09-08 15:42:14 +0800
前一提交：894245d "feat(AGENT-CAP): Skill 上传/查看对齐原站……" 2026-09-08 02:00:39 +0800
git status --porcelain：
      ?? .zcode/
      ?? exports/
（无任何 tracked 文件改动）
```

- 任务书提示的"并行会话遗留改动"（g048skillseed 迁移、agent_runtime/admin/settings/wf-connections/res-list）**已经不在工作区，而是被收进了 HEAD**：`git show --stat f6824f9` 显示该 checkpoint 提交包含 `server/alembic/versions/g048skillseed0001_builtin_skills.py`（+70）、`server/app/agent_runtime.py`（+32/-）、`server/app/main.py`（+1）、`server/app/routers/admin.py`（+33）、`server/tests/test_agent_runtime.py`、`server/tests/test_skill_shell.py`（新 +131）、`src/components/app/resources-shell.tsx`（新 +122）、`src/pages/res-list.tsx`、`src/pages/settings.tsx`、`src/pages/wf-connections.tsx`，以及全部 `docs/v2-design/*` 与 `archive/runtimes-retired-2026-09-04/*` 归档移动。`res-skills.tsx`/`res-category-pages.tsx` 则在 894245d 收口（提交信息自述"原并行会话工作，经用户功能要求收口"）。
- 因此本报告把上述内容**按 HEAD 事实引用**（它们已提交），但其"checkpoint 收口"来历在 §7 单独登记，供主审计者判断稳定性。
- 未跟踪目录 `.zcode/`（agent 计划文件）与 `exports/`（`原始通话样本20条_2026-09-03.xlsx` + `原始通话样本20条-原始JSON/`）均非代码，且不在 `.gitignore` 内（.gitignore 全文 37 行已核）。

### 0.2 运行环境事实

| 项 | 事实 | 证据 |
|---|---|---|
| 后端 DB | PostgreSQL `wf_dev`（非 pytest 默认）；pytest 用 `wf_test` | C1 `server/app/config.py:5-9` |
| API base（前端） | `http://127.0.0.1:8120` | C1 `.env.local`（`VITE_WF_API_BASE`） |
| Runtime Provider 注册 | `PROVIDER_KINDS = ("agentscope","deepseek-harness","external")` | C1 `server/app/runtime_providers/registry.py:17` |
| AgentScope pin | `agentscope==2.0.7`（**不是 2.0.8**），PyPI registry 源 | C1 `runtimes/agentscope/pyproject.toml:10`、`runtimes/agentscope/uv.lock:11-13` |
| 运行时格局 | "AgentScope 8301 = Sole runtime as of 2026-09-04 (user decision)"；DSH(8302)/OpenAI Agents(8303) 已退役归档 | C1 `runtimes/README.md:8-16`、`archive/runtimes-retired-2026-09-04/README.md` |
| 三个 Provider 服务当前状态 | `curl -s -m 3 GET /health` 对 8301/8302/8303 **全部不可达**（空响应） | 探针命令见 §10；只读 GET，无副作用 |
| 5173/8000/8100/8120/5199 | 按任务约束**一律未探测**，本报告不对这些服务的健康作任何断言 | 约束遵从 |

### 0.3 wf_dev 数据库只读快照（2026-09-08，命令全文见 §10）

| 表 | 关键事实 |
|---|---|
| `agent_runtime_provider` | 3 行全部 `enabled`：AgentScope-本地验收(kind=agentscope, 8301, **health_status=error**, last_health 2026-08-30)；DSH-本地验收(deepseek-harness, 8302, ok, 09-01)；OpenAI Agents POC(**kind=openai-agents——不在 PROVIDER_KINDS 白名单内**, 8303, ok, 09-02) |
| `release` | 8 行。**没有任何 Release 绑定 AgentScope provider**；3 条 active 绑 `openai-agents`（质检-OpenAI POC、业务分析×2），3 条 active 绑 `deepseek-harness`（DSH消费者分析、DSH规则质检）——两者均为 09-04 已退役运行时 |
| `agent` | 7 行：5 个 module 型（business-analysis×2、quality-analysis×1、**dsh-consumer-analysis×1、dsh-quality-rules-analysis×1——后两个 module_key 不在 Module Registry**，registry 只发现 quality-analysis/business-analysis/ticket-automation，见 `server/app/agent_modules/*/manifest.yaml`）、1 个 autonomous（archived=t 封存夹具）、1 个 custom（客服主管-验收，archived=f） |
| `skill` / `agent_skill` | 6 个 Skill（2 builtin 种子 + 4 upload）；2 条挂载（module 型"业务分析-通话打标-OpenAI"←客服话术质检技能；custom 型"客服主管-验收"←frontmatter-验收技能） |
| `workflow` / `workflow_version` | 9 个工作流（7 published / 2 draft）；**全库草稿与版本中不存在任何 agent/agent-select/agent-exec 节点**（jsonb 扫描仅命中 code-write/knowledge-retrieval/mcp-call 各 1） |
| `run` | 266 行；trigger 分布：manual 255、chat 7、test 2、eval 1、schedule 1；1 条 manual Run 自 2026-09-02 起滞留 `running`（module agent 2ec32968…） |
| `task_run` | 58 行：succeeded 26 / failed 6 / cancelled 2 / partial 1 / **queued 8 / running 15（started_at 介于 09-02 ~ 09-07，为 worker 中断遗留的僵尸态，I1）** |
| `analysis_task` | 25 行（列表前 8 全部 execution_target_type=workflow） |
| `result_delivery` | 82 行（81 succeeded / 1 pending） |
| `job_queue` | 161 行（78 done / **83 dead**），无 pending 积压 |
| `datasource` | 7 行 = 6 postgresql + **1 mysql（disabled/health=error）** |
| `tool` / `tool_version` | 8 个 Tool 全部 `disabled`（7 http + 1 builtin）；8 个 ToolVersion 全部 `ready` |
| `mcp_server` | 1 行（stdio，disabled，health=error） |
| `knowledge_source` | 1 行（vector，disabled，slice_count=0） |
| `connection` | 11 行（含 4 条 sdd13v-* 测试残留、1 条 archived） |
| `schedule` / `schedule_occurrence` | 6 / 201 行 |

**对任务书"已知线索"的独立复核结论（不照抄）：**

1. "本机 PG wf_dev 曾为唯一真库"——**当前可复核为真**：`config.py:5-9` 默认 `wf_dev`，仓内无其他生产 DB 配置物；"曾为唯一"的历史部署形态不可从代码复核（→ EVIDENCE_GAP #1）。
2. "32 个 mysql datasource 曾是占位"——**当前不可复核**：wf_dev 现仅 1 条 mysql datasource（disabled/error），全部迁移与种子脚本中未发现生成 32 条 mysql 行的痕迹（grep 仅命中 `scripts/report-resource-migration.py:35` 的类型映射表）（→ EVIDENCE_GAP #2）。
3. "openai-agents 运行时 09-04 已下线归档"——**复核为真且发现后续风险**：`archive/runtimes-retired-2026-09-04/README.md` 明确"该服务源码从未入过 git（git ls-files 为 0），仅剩 .venv/.pyc 物证"；但 DB 中该 Provider 行仍 `enabled`，且 **3 条 active Release 仍绑定它**（见 §1 Q5）。
4. "AgentScope 被拍板为唯一 Agent 底层但接线未完成"——**复核为真**：`runtimes/README.md`（sole runtime 拍板）+ DB 现实（AgentScope provider health=error、零 Release 绑定、服务不可达）+ `runtimes/README.md:12-16` 自述 DSH 插件"是行为蓝本……until those ports pass real-call regression"（移植未过真实回归）。

---

## 1. §5.1 Agent / Module / Version / Release 逐项回答

### Q1 `Agent` 当前是定义根、版本、实例还是混合体？

**混合体：定义根 + 环境指针；版本与实例分离在 AgentVersion/Run**（C1）：

- `Agent` 行 = 可变身份（name/description/avatar/type/module_key/module_version）+ 可变草稿配置（`config` JSONB + `config_revision` 乐观锁）+ **两个环境部署指针** `sandbox_version_id` / `prod_version_id` + `archived` + `status`（`server/app/models.py:354-378`）。
- `AgentVersion` = 不可变快照（definition/common_config/dependency_snapshot/artifact_hash，`models.py:381-396`）。
- `Release` = 版本→环境部署记录（environment/canary_percent/runtime_provider_id/runtime_binding_snapshot，`models.py:399-415`）。
- **不存在常驻"实例"实体**：运行实例事实由 `Run`（agent_id/agent_version_id/runtime_provider_id/runtime_provider_run_id/runtime_snapshot，`models.py:239-279`）表达。
- I1：`Agent.type` 一列同时承载三代语义（历史 autonomous/dialogue/expert-group、新体系 module、09-07 custom，`models.py:364` 注释 + `routers/agents.py:15-16` TYPE_LABEL），是"类型即世代"的混合列。

### Q2 Custom 与 Module 的创建、编辑、发布、运行链是否一致？

**不一致，且 Custom 链在发布/运行两环是断的**（C1）：

| 环节 | Module | Custom |
|---|---|---|
| 创建 | 同一端点 `POST /api/agents` 的 moduleKey 分支（`routers/agents.py:54-78`），config={spec,modelRef} | 同端点 type=custom 分支（`agents.py:35-53`），config={rolePrompt,skills,modelRef,capabilities}；description 必填 422 |
| 编辑 | `PUT /api/agents/{id}` + expectedRevision 乐观锁（`agents.py:196-225`）；前端只开放 name/description/spec.purpose/modelRef/capabilities（`src/pages/module-agent-config.tsx:1-5` 注释） | 同端点；前端 `src/pages/agent-workspace/custom-config.tsx:36-45` 保存 rolePrompt/capabilities/skills(存 **Skill ID**)/modelRef |
| 版本/发布 | `build_definition` module 分支冻结 agentSpec+schema 引用+policies（`agent_release.py:25-39`）；Release 必须绑 runtimeProviderId（`agents.py:445-490`） | `build_definition` 落入 else 分支要求 `agent.workflow_id`，custom 无 workflow → `ValueError` → 409 NO_WORKFLOW（`agent_release.py:49-51` + `agents.py:366-370`）。**Custom 无法创建版本、无法发布** |
| 结构化运行 | `run_agent` → `_run_module_agent` → Provider 分派（`agent_runtime.py:664-667, 567-646`） | `run_agent` 通用路径：type≠autonomous 且无 workflow 且无版本 → Run 直接置 failed "该 Agent 未绑定工作流"（`agent_runtime.py:704-709`）。**Custom 不能结构化运行** |
| 对话 | `agent_chat` 不区分 type（仅查 DB archived 字段，`agent_caps.py:37-40, 251-263`）——两者都可 chat | 同左 |
| 前端工作区口径 | type=module → 可编辑、有"对话"按钮 | **`archived = Boolean(agent.archived) || agent.type !== "module"`（`src/pages/wf-agent-editor.tsx:87`）→ custom 在自家工作区被显示为"已封存 · 只读"**（`src/features/agents/AgentWorkspaceShell.tsx:52-56`），对话按钮隐藏（L61-65），skills/memory/connectors/mounts 子页全部 readOnly；但 config 子页仍然渲染可编辑的 CustomAgentConfig（`wf-agent-editor.tsx:99-100`，该组件无 readOnly 参数）；直接访问 `/agents/{id}/chat` 仍可用（`src/pages/agent-chat.tsx:48` 只查 `a.archived`）。前后端对"custom 可否写"至少三种口径（UI 壳只读 / config 页可写 / 后端 API 可写）——I1：这是 09-07 加 custom 时未同步壳层 archived 判定造成的口径漂移 |

### Q3 `AgentVersion` 和 `AgentRelease` 实际冻结哪些字段？

C1（`agent_release.py` + `models.py`）：

- **AgentVersion.definition** 按类型三分支（`build_definition`，`agent_release.py:19-56`）：
  - module：`{module:{key,version}, agentSpec(完整校验后的 Spec), inputSchema/outputSchema(带 sha256 的引用), executionPolicy, securityPolicy}`（L25-39；policies 是 Module 级代码常量：timeout 300s/maxModelCalls 30/maxToolCalls 30 等，`agent_modules/base.py:88-96`）；
  - autonomous：`{rolePrompt, modelRef, skills[], tools[], workflows[], knowledges[]}`（L40-48，全部为**名字/ID 列表，不含资源本体**）；
  - dialogue/expert-group：`{workflowId, graph(草稿深拷贝), members[]}`（L49-56）。
- **AgentVersion.common_config**：conversation(autoFollowUp/chitchatFallback/greeting) + memories(声明) + knowledgeFallback（`build_common_config_dict`，L64-79）。
- **AgentVersion.dependency_snapshot**：items[]，类型含 TOOL(解析到 ready ToolVersion.id)/WORKFLOW(current_version_id)/KNOWLEDGE(仅状态)/MODEL(version 号)/AGENT(成员部署版本)/AGENT_MODULE/MODULE_IMPLEMENTATION/MASTER_DATA/INPUT_SCHEMA/OUTPUT_SCHEMA（`freeze_dependencies`，L112-181）。**不含 Skill、不含 Connection、不含 MCP、不含 AgentSkill 挂载**。
- **artifact_hash** = sha256(definition+common+deps 规范化 JSON)（L184-187）。
- **Release** 冻结：agent_version_id、environment(sandbox|prod)、canary_percent(0-100)、runtime_provider_id、runtime_profile、runtime_binding_snapshot={providerId,providerKind,contractVersion,profile,module,moduleImplementation(version/bundle/entry),input/outputSchemaSha256}（`agents.py:478-504`）。约束：Module Release 必须绑 Provider 且 Provider enabled、contract 1.0、Module 有该 kind 实现、一个 Agent 只允许一种 Provider（ONE_PROVIDER_PER_AGENT，`agents.py:445-477`）。
- I1：冻结粒度是"引用 + 状态"而非"内容副本"——Tool 冻到 tool_version_id、Workflow 冻到 version_id、Knowledge 只冻 enabled/disabled 状态、Model 只冻 version 号；资源本体变更（如 Knowledge source_config 改写、Tool spec 新版本发布后旧版本仍 ready）不会破坏快照，但 Knowledge"冻状态不冻内容"意味着发布后知识源内容漂移不可见（`agent_release.py:104-109`）。

### Q4 Module manifest/spec、`Agent.config`、关联表是否存在多事实源？

**存在，至少 5 处**（C1）：

1. **Skill 双轨 + 语义错位**：一等关联表 `agent_skill`（`models.py:437-445`）vs 遗留 `config.skills` 列表（`agent_release.py:44` 冻结、`agent_runtime.py:265` 按"名字"消费）。而 custom 前端把 **Skill ID** 写进 `config.skills`（`custom-config.tsx:88-98` 用 `s.id`），运行时按名字对照（`agent_runtime.py:238-243, 265`）——同一键存在"名字/ID/一等关系"三种语义。`mounts-health` 端点对两轨分别校验（`agents.py:328-337`），承认双轨并存。
2. **Module Spec 双路径**：发布版走冻结 `definition.agentSpec`（`dispatcher.py:33-52`），草稿预览从 `Agent.config` + manifest defaultSpec 现算（`dispatcher.py:53-71`、`base.py:116-135`）——同一语义两条组装路径，靠共用 `build_agent_spec` 收敛（I1：设计上有意为之，代码注释"SDD B-05 两种路径都真消费"，`agent_runtime.py:272-273`）。
3. **Workflow 绑定双源**：`Agent.workflow_id` 列（dialogue/group 执行绑定，`models.py:370`）vs `config.workflows` 挂载列表（autonomous/custom 的资源挂载，`mounts.tsx:20,33-42`）。
4. **Connection 挂载死数据**：`config.connections`（`connectors.tsx:13,20-29` 写入）——后端全库 grep 无任何运行时消费点（仅 `contracts.py:91-100` 的 v2 API 清单文本命中"connections"字样），单源但为死数据。
5. **状态多源**：`Agent.status` 在创建版本/发布时被直接写 "published"（`agents.py:385, 511`），与 Release/指针事实并行存在；`Connection.status` 与 `lifecycle` 双列同步（`models.py:95-97` 注释自认"兼容读"）。

### Q5 发布后 Skill、Knowledge、Workflow、Connection 是否真的被 Runtime 消费？

**按轨道分别回答**（C1，详见 §2 字段级链路）：

- **Module 轨道（当前唯一可发布可结构化运行的轨道）：四者全部不消费。** Runtime 请求体 `AgentExecutionSpec` 只有 instructions/model/tools(逻辑工具名)/master_data/output_schema（`packages/runtime_contract/src/quality_runtime_contract/models.py:66-74`），没有 skills/knowledge/workflows/connections 字段；dispatcher 组装时也只从冻结 definition 取这些（`dispatcher.py:33-52`）。AgentScope adapter 侧：工具经 MCP `enable_tools=[名字]` 连到**固定 env URL**（默认 `http://127.0.0.1:8200/mcp/`，`adapter.py:211-214, 261-273`），该 Tool Service 自述"returns fixture facts only"（`services/tool_service/README.md:3-5`）；模型凭据来自 runtime 容器 env `QUALITY_MODEL_API_KEY`（`adapter.py:153-160`），与平台 Connection/Secret 体系完全隔离。
- **legacy autonomous 轨道（已封存，仅存量 Agent 可跑）：tools/workflows/knowledges 真消费**——`_build_tools` 把挂载解析成 function tools 并留痕 `agent_mounts_resolved` 事件（`agent_runtime.py:160-209, 315`），`_dispatch` 真执行：tool→`exec_tool` HTTP 配方 + Connection 鉴权头（`agent_runtime.py:395-398` → `runner.py:494-542`，L521-534 装 Connection 凭据）；workflow→子 Run 同步执行（L399-405）；knowledge→`search_knowledge` 真 HTTP 或 fail-closed（L406-418 → `resource_tests.py:259-287`）；Skill 正文注入 system prompt（`build_mounted_skills_section`，L251-266，截断 8000 字符）。`config.connections` 在该轨道也不消费。
- **custom 轨道（对话 only）**：chat system prompt 注入 rolePrompt/description/capabilities/**AgentMemory 正文**/**Skill 名字列表（无正文）**（`agent_chat.py:25-46`，L40-44 仅名字）；tools/workflows/knowledges/connections 全不消费。
- **DB 现实放大了断链**：3 条 active Release 绑定的 openai-agents Provider 源码从未入 git 且服务已下线（`archive/runtimes-retired-2026-09-04/README.md`）；2 个 dsh-* module_key 不在 Registry（运行必 MODULE_UNKNOWN，`agent_modules/registry.py:49-60`）；AgentScope Provider health=error 且零绑定。**当前 DB 中没有任何一条"发布→可运行"的活链路指向存活的 Runtime**（I1，基于 0.3 节 DB 快照 + curl 探测）。

### Q6 生命周期与 Agent 类型是否被前端混用？

**是**（C1）：`wf-agent-editor.tsx:87` 用 `agent.type !== "module"` 直接推导"已封存·只读"生命周期态（类型当生命周期用）；`AgentWorkspaceShell.tsx:52-56` 据此渲染"已封存 · 只读" chip——custom Agent（DB archived=f、可对话、config 可保存）在壳层被标成封存。后端 `assert_agent_executable` 只封 autonomous/dialogue/expert-group 三类（`legacy_agent_archive.py:22-26, 58-62`），custom 不在封存名单。列表页 typeLabel 混排历史类型与新类型（`agents.py:15-16`；`wf-agents-list.tsx:33` custom 标签）。

### Q7 当前 Runtime capability 声明是否被端到端测试证明？

**未被真实端到端证明；声明与实现存在缺口**（C1）：

- 平台侧生命周期测试用**进程内 FakeProvider**（"fake provider = 进程内 uvicorn 服务……不依赖外部网络与真实模型"，`server/tests/test_r1_runtime_providers.py:1-5, 48+`），证明的是 Gateway/worker/幂等/取消语义，不是真实 AgentScope。
- runtime 侧 `test_adapter.py` 用 `SimpleNamespace` 双件（L7），`test_native_workflow.py` 用 `FakeRunner`（L19+）；**pytest 套件中唯一 import 真实 agentscope 包的是手动探针 `probe_mcp_compat.py`（非断言测试）**。
- `AgentScopeAdapter.capabilities` 静态声明 `skills=True, session=True, cancel=True, streaming=True`（`adapter.py:134-143`），但：Contract 请求根本没有 skills 载荷（见 Q5）；`cancel` 实现是 no-op（`adapter.py:389-390` `async def cancel: return None`）——**声明与实现不符**。
- `probe_provider` 把 Provider `/health` 实测 capabilities 写回 DB（`runtime_providers/registry.py:28-45`），但 DB 中三份 health 数据均为 08-30~09-02 陈旧值且服务现已全部不可达（§0.2/0.3）。
- 跨 Provider 请求一致性由 fixture 哈希钉扎证明（`runtimes/agentscope/tests/test_platform_module_request.py:14-31` + `server/app/agent_modules/quality_analysis/fixtures/platform_request_v1.json`）——这是契约级证据，不是真实调用回归。

---

## 2. §5.2 资源真实挂载：字段级链路（每资源一张链）

链路环定义：**①页面字段 → ②前端 payload → ③API schema/校验 → ④DB 字段/关联 → ⑤Release/Version snapshot → ⑥Runtime request → ⑦AgentScope 构造/注入**。中断处标注"断点在第 X 环"。

### 2.1 Skill（一等挂载轨：skill + agent_skill）

```text
① res-skills.tsx 上传 Dialog（文件或 name/category/content）+ 挂载 Dialog 选 Agent
   agent-workspace/skills.tsx 市场/我的技能 + 安装/卸载按钮（readOnly 时隐藏，L67/86/92）
② POST /api/skills/upload (multipart: file + agentIds)   [wf-api.ts:445-455]
   POST /api/agents/{id}/skills {skillId}                  [wf-api.ts:588-589]
③ agent_caps.py:296-364 解析 .md frontmatter/.zip/.tgz 内 SKILL.md（5MB 上限、
   SKILL_MD_MISSING/FRONTMATTER_NAME 422）；install_skill 404/409 防重（L97-111）
④ skill 行（content=SKILL.md 全文，models.py:421-434）+ agent_skill 行
   （UNIQUE(agent_id,skill_id)，models.py:437-445；g047 迁移建表；g048 种子 2 条 builtin）
⑤ ——断点在第⑤环——：build_definition/freeze_dependencies 均不含 Skill/AgentSkill
   （agent_release.py:19-56,112-181 全文核实无 skill 依赖类型）
⑥ ——断点在第⑥环——：AgentExecutionSpec 无 skills 字段
   （packages/runtime_contract/.../models.py:66-74）；dispatcher 不读 agent_skill
⑦ AgentScope adapter 不消费 skills；ProviderCapabilities.skills=True 仅为声明
   （adapter.py:134-143）
```

**旁路消费（不经 Release）**：
- chat：system prompt 注入**已安装 Skill 名字**（无正文）——`agent_chat.py:40-44`；
- legacy autonomous 循环：`build_mounted_skills_section` 注入**正文**（8000 字符截断 + 遗留 config.skills 名字占位）——`agent_runtime.py:251-266, 276-277`；测试直证该函数（`server/tests/test_skill_shell.py:50-84`）。但 autonomous 型已封存不可新建（`agents.py:56-58` 410），DB 唯一 autonomous 行 archived=t → **正文注入路径当前无可用宿主**（I1）。

**遗留轨（config.skills）**：custom-config.tsx 把 Skill **ID** 写入 `config.skills`（L88-98）→ `PUT /api/agents` 存 config blob → autonomous 发布时冻结为名字列表（`agent_release.py:44`）→ 运行时按**名字**做 mention 展开与占位（`agent_runtime.py:238-243, 265`）→ **ID/名字语义错位**；module/chat 路径不读 config.skills。断点：第⑤环对 module、语义错位对 custom。

**结论**：资源页"上传并挂载成功"≠ 运行时注入。当前可用轨道上：module 结构化执行完全不消费 Skill；custom 对话只注入名字。不得写"已挂载生效"。

### 2.2 Tool

```text
① res-list.tsx/res-wizard.tsx 工具表单（name/kind/connectionId/description/inputSchema/spec）
② POST /api/ai-resources/tools（resources.py:73-76 → _create:94-108）
③ echo/空 request spec 被拒（除非 WF_TEST_FIXTURES=1 或显式 fixture:true，
   resources.py:41-54；config.py:28-35）；启用需真实 CheckRun 门禁（resource_registry.py:137-155）
④ tool 行 + tool_version 行（version_no 递增、spec=request 配方，models.py:154-176）
   DB 现状：8 个 Tool 全 disabled，8 个 ToolVersion 全 ready
⑤ Release：Module——freeze_dependencies 把 manifest agentSpec.tools（逻辑工具名，如
   knowledge_search@1.0.0）解析到平台 Tool 的 ready ToolVersion（agent_release.py:129-130,
   84-93；spec.default.json tools 名单与 DB Tool 名一致，已核）；autonomous——definition.tools
   名字列表冻结。注意 _resolve_tool 不检查 Tool.status（disabled 也可 FROZEN）
⑥ Runtime：Module——ToolRef(name,version) 进请求（dispatcher.py:45）；
   autonomous/workflow tool 节点——_build_tools 用 Tool+最新 ToolVersion.input_schema 生成
   function schema（agent_runtime.py:168-180），exec_tool 真 HTTP：egress 校验（runner.py:517-519）
   + Tool.connection_id → Connection 凭据签名头（runner.py:521-534）
⑦ AgentScope：adapter 仅把工具名传给 MCPClient enable_tools，连固定
   QUALITY_TOOL_MCP_URL（默认 127.0.0.1:8200/mcp/）——断点在第⑦环：平台 ToolVersion.spec
   配方与 Connection 凭据不进入 AgentScope；实际工具事实来自 services/tool_service
   （README 自述 "returns fixture facts only"，fixtures=poc/.../tool_fixtures_v0.1.json）
```

**结论**：Tool 在 workflow/autonomous 轨道真消费（http 配方+鉴权+egress）；在 Module 轨道只是"名字 allowlist"，执行体是 fixture Tool Service——**断点在第⑦环（执行体错位）**。

### 2.3 Knowledge

```text
① res-category-pages（Knowledge 表单：name/kind=vector|document/embeddingModelId/sourceConfig）
② POST /api/ai-resources/knowledge-sources（resources.py:116-121）
③ 同上（无强校验；启用需 CheckRun 门禁）
④ knowledge_source 行（models.py:1039-1054）。DB 现状：1 行 disabled、slice_count=0
⑤ Release：freeze 仅记 {type:KNOWLEDGE, ref, id, status:FROZEN|DISABLED|MISSING}
   （agent_release.py:104-109）——冻结的是"状态"，无内容/索引 revision 快照；
   common_config.knowledgeFallback 只存 ID 列表（L78）
⑥ Runtime：autonomous——knowledge_{id} function tool + _dispatch → search_knowledge，
   并消费 agent.config.knowledgeAdvanced 的 topK/scoreThreshold/mode（agent_runtime.py:191-200,
   406-418）；workflow——knowledge-retrieval 节点（runner.py:664-676；DB 中 wf-94543 草稿有 1 个）；
   Module——不消费（master_data 是 Module 自带资产，不是 KnowledgeSource）——断点在第⑥环
⑦ search_knowledge：sourceConfig.url 为 http(s) 时真 POST {query,topK,mode}（过 egress），
   否则 fail-closed（fixture 门控 mock 切片）（resource_tests.py:259-287）。
   AgentScope 不接收 knowledge——断点在第⑦环
```

**结论**：Knowledge 是"文档引用 + 外部检索 HTTP 端点"，平台侧**无索引/无 revision**（回答任务书问题：既不是索引 revision 也不是纯提示词描述，是引用+可选高级参数）；Module 轨道不消费。

### 2.4 Workflow（作为 Agent 挂载资源）

```text
① agent-workspace/mounts.tsx "Wakerflow" 子页绑定下拉（选项=GET /api/workflows 列表，L22-29）
   ※ 前端已把该页标题写成原站品牌词 "Wakerflow"（mounts.tsx:44）——术语借用事实，登记备查
② agentApi.update(id, {config:{...config, workflows:[ids]}}, revision)（mounts.tsx:33-42;
   wf-api.ts:524-526 带 expectedRevision）
③ PUT /api/agents/{id}：config 整包覆盖 + 乐观锁 409（agents.py:196-225）
④ agent.config JSONB（无关联表、无 FK）
⑤ Release：仅 autonomous 分支冻结 workflows 名字列表 + _resolve_workflow 记
   current_version_id/UNPUBLISHED（agent_release.py:46, 96-101）；module 分支不含
⑥ Runtime：autonomous——workflow_{id} function tool（agent_runtime.py:181-190），
   _dispatch 创建子 Run(trigger=agent) 同步 execute_run 并回传 output（L399-405）；
   module/custom——不消费。Runtime 没有 "list workflows"/"run workflow" 通用工具
   （全库 grep 无此类工具注册）——断点在第⑥环（对 module/custom）
⑦ AgentScope contract 无 workflow 字段——断点在第⑦环
```

**结论**：Agent 页面的 Workflow 挂载对 module/custom **只停留在 config**（页面能绑≠运行时能调）；只有已封存的 autonomous 轨道曾真消费。`mounts-health` 会校验挂载 workflow 是否 published（`agents.py:341-343`），属管理面校验，不代表运行时消费。

### 2.5 MCP Server

```text
① res mcp 表单（transport=stdio|http、command、connectionId、env）
② POST /api/ai-resources/mcp-servers（resources.py:109-115）
③ transport 白名单 422（L110-111）；discovery/测试走 run_test → _test_mcp：
   真握手或 fixture 工具清单（_MOCK_MCP_TOOLS，仅 WF_TEST_FIXTURES=1 且带 fixture 标记，
   resource_tests.py:25, 72-117）
④ mcp_server 行（discovered_tools JSONB，models.py:1020-1036）。DB：1 行 stdio/disabled/error
⑤ Release：WorkflowVersion.mcp_refs 在发布时收集 mcp-call 节点引用（workflows.py:243-244,
   232-248）；AgentVersion 完全不含 MCP
⑥ Runtime：workflow mcp-call 节点 → mcp_call_tool：http 模式手写 JSON-RPC 真调用
   （过 egress + Connection 鉴权，resource_tests.py:289-325，注释自认"P2 官方 SDK 替换"）；
   stdio 模式无真实实现路径 → fail-closed/fixture（DB 中 wf-94543 草稿含 1 个 mcp-call 节点）
⑦ AgentScope：adapter 的 MCPClient 只连 env QUALITY_TOOL_MCP_URL 固定地址
   （adapter.py:211-214, 261-270），不读平台 mcp_server 表——断点在第⑦环
```

**结论**：平台 MCP registry 与 AgentScope 运行时的 MCP 接线是**两个互不相通的世界**；"注册后握手发现工具列表"（models.py:1021 注释）仅在测试/fixture 门控下发生。

### 2.6 Connection（credential ref 是否进入运行时）

```text
① wf-connections.tsx（kind/protocol/endpoint/environments/secret 表单 + 轮换/清除/测试）
② connApi.create/update/rotateSecret/clearSecret/enable/disable/test（resource-api.ts；
   页面调用点 wf-connections.tsx:208-296）
③ POST/PUT /api/connections + ConnectionCreate/Update schema（admin.py:117-215）；
   明文 Secret 只进 KMS 加密的 secret_ref，reveal 默认禁用（admin.py:269-281；
   contracts.py 冻结 SECRET_REVEAL_DISABLED 错误码）
④ connection 行（secret_ref/environments/auth_script/lifecycle/revision，models.py:82-102）
   + connection_secret_revision 轮换账本（models.py:105-127）+ check_run 健康派生
   （models.py:130-151；resource_registry.py:38-42 无记录=untested）
⑤ Release：不含 Connection（freeze_dependencies 无 conn 类型）；间接引用存在于
   Tool.connection_id / ModelProvider.auth_connection_id / McpServer.connection_id /
   AgentRuntimeProvider.connection_id（models.py:162,185,1029,510）
⑥ Runtime（平台进程内）真消费：exec_tool 鉴权头（runner.py:521-534）、LLM 出站鉴权
   （agent_runtime.py:49-74，env WF_LLM_API_KEY 优先，否则 ModelProvider.auth_connection）、
   mcp http 鉴权（resource_tests.py:289-325）、data_readers/postgres、连接探测
   （admin.py:393-480）；解析=环境覆盖+解密（connection_runtime.py:20-30）
⑦ AgentScope Provider 容器：不接收平台 Connection——模型凭据用容器 env
   QUALITY_MODEL_API_KEY（adapter.py:153-160）；AgentRuntimeProvider.connection_id 字段存在
   （models.py:510）但 adapter/gateway 出站不携带（client.py 全文无 connection 消费）——断点在第⑦环
```

**结论**：credential ref **进入平台进程内运行时**（tool/llm/mcp/data 四类出站），**不进入 Runtime Provider 容器**；Agent 工作区"连接器"子页写的 `config.connections` 则**任何一环都不消费**（断点在第⑤环之前，纯 UI 死数据）。

### 2.7 Memory（补充链路）

```text
① agent-workspace/memory.tsx（全局记忆文档 + 版本历史）
② PUT /api/agents/{id}/memory {content,note}（wf-api.ts；agent_caps.py:163-175）
③④ agent_memory 单行/Agent + agent_memory_revision 快照（models.py:448-470）
⑤ Release：autonomous 的 memoriesSchema 声明进 common_config.memories（agent_release.py:77）；
   AgentMemory 文档本体不进快照
⑥ chat：system prompt 注入记忆文档正文（agent_chat.py:37-39）；autonomous：声明键 +
   memory_read/memory_write 工具（run 级内存字典，agent_runtime.py:201-208, 278-285, 419-427）；
   workflow：memory-variable 节点读写 MemoryRecord 持久表（runner.py:710-768；models.py:322-331）
⑦ Module/AgentScope：不消费——断点在第⑥环（module 轨道）
```

### 2.8 Model（补充链路）

```text
①② res models 表单 / agent 配置页模型下拉（modelRef.modelId=model_key）
③④ model + model_provider 行（models.py:179-199）；DB: LLM-DashScope connection active
⑤ Release：freeze 记 MODEL {ref, status, version 号}（agent_release.py:132-136, 152-157）
⑥ 平台进程：_resolve_base_headers（env WF_LLM_BASE_URL/WF_LLM_API_KEY 优先，否则
   ModelProvider.base_url + auth_connection 签名，agent_runtime.py:49-74）→ OpenAI 兼容
   /chat/completions 真调用（流式 SSE + tool_calls 分片累积，L102-155）→ egress（L96-101）；
   无 base 时：生产 fail（MODEL_UNAVAILABLE，L84-86）/ 非生产 mock 回复（L87-95）
⑦ AgentScope：模型名来自冻结 spec（dispatcher.py:42-44），但 base_url/api_key 来自
   runtime 容器 env（adapter.py:190-199）——凭据不跨界，部分断链在第⑦环
```

### 2.9 任务书特别复核项逐一回答

- **`config.skills` 与 `AgentSkill`**：双事实源并存，语义错位（ID vs 名字 vs 一等关系），见 §2.1。
- **页面显示的 Workflow 与 Runtime 是否有 list/run workflow 工具**：无。Runtime 侧不存在任何 "list workflows"/"run workflow" 工具注册（全库 grep 无命中）；仅 autonomous 循环把**已挂载**的 workflow 逐个包装为 `workflow_{id}` function tool（`agent_runtime.py:181-190`）。
- **MCP registry、tool discovery 与测试 fixture/mock 的边界**：discovery 只在 `run_test`/`_test_mcp` 发生，真握手失败即 fail-closed；`_MOCK_MCP_TOOLS` 仅 `WF_TEST_FIXTURES=1`（非生产）可达且输出带 `fixture:true` 标记（`resource_tests.py:72-117`；`config.py:28-35`）。生产（`WF_ENV=production`）fixture 门恒关。
- **Knowledge 是文档引用、索引 revision 还是提示词描述**：是"外部检索端点引用 + 高级参数"，无平台索引、无 revision（§2.3）。
- **Connection 的 credential ref 是否进入运行时**：进入平台进程运行时，不进入 Provider 容器（§2.6）。
- **资源页面保存成功是否等于 Release/Runtime 生效**：**不等于**。所有资源保存只写各自表；Release 快照只收部分引用（Tool/Workflow/Knowledge/Model 状态级），Skill/Connection/MCP/AgentSkill 挂载完全不进快照；Module Runtime 请求只携带逻辑工具名与模型名。

---

## 3. §5.3 Workflow、Task、Trigger、Run 和工作项 逐项回答

### Q1 现有 Workflow 是否能真正调用新版 AgentVersion？

**代码支持，DB 中零实例**（C1）：
- 路径 A（兼容层）：画布 `agent`/`agent-exec` 节点仍可执行——EXECUTORS 主表不含三键（`runner.py:1064-1074`），但 `_agent_family_executor` 兜底提供（L1077-1088）；`_run_member` 优先使用父 Run 冻结的成员版本 `ctx.frozen_agent_versions`（来自 AgentVersion.dependency_snapshot 的 AGENT 项，`runner.py:1140-1145` → `agent_runtime.py:536-543`），成员为 Module Agent 时走 `_run_module_agent` 同步执行（`agent_runtime.py:640-646` + `runtime_providers/worker.py:323-391`）；成员为旧三类时被 `is_legacy_agent` 节点级拒绝（L530-532）。
- 路径 B（迁移后三连）：`workflow-fixed` 支持 `versionPolicy=pinned` 钉 WorkflowVersion（`runner.py:800-802`）——但这调用的是成员 Agent 的**底层 workflow**，绕过 AgentVersion 体系。
- **现实核验**：对 wf_dev 全库 workflow 草稿+版本做 jsonb 节点类型扫描，`agent/agent-select/agent-exec` 命中 0（命令见 §10）→ "Workflow→新 AgentVersion" 链路当前**无生产实例**，仅测试与代码存在（`server/tests/test_r3_task_agent_target.py` 等覆盖 Task→Agent 而非 Workflow→Agent；I1：Workflow 嵌套 Module Agent 的 R3-5 路径由 `agent_runtime.py:640-646` 注释与 worker 同步执行支撑，未见专属 e2e 测试文件名，未逐一展开验证）。

### Q2 旧 `agent/agent-select/agent-exec` 节点是否已 deprecated 或被迁移器改写？

**已 deprecated，未被自动改写**（C1）：节点注册表三键均 `deprecated: True`（palette 不显示、兼容层可执行——`server/app/registry.py:111-147`）；迁移器 `migrate_definition`（`runner.py:1488-1517`，agent→workflow-fixed / agent-select→workflow-select / agent-exec→workflow-exec，映射缺失留空引导重选）**只被显式端点 `POST /api/workflows/{id}/migrate` 调用**（`routers/workflows.py:93-111`），GET/保存保持透传（L96-99 注释自证）。发布校验阻止新版本引用已封存 Agent（`workflows.py:185-196`）。

### Q3 Workflow 子流程、递归检测、最大深度和版本 pin 的现状？

C1：
- 子流程：`workflow-exec`（固定/动态 code，子 Run trigger=manual、**不带 version_id → 子流程按草稿解析**，`runner.py:631-661`）；`workflow-fixed`（inputMapping 覆盖 + pinned 可钉版本，L786-814）。
- 递归检测：`execute_run` 以 call_chain 判重，命中即 Run failed（L1121-1127）；Agent 递归以 `agent:` 前缀链检测（`agent_runtime.py:534-535, 576-577, 670-671`）。
- 最大深度：workflow 链 `len(chain) >= 5` 失败（L1128-1133）；Agent 链无独立深度上限、靠递归判重（I1：agent_chain 与 wf_chain 分列后各自判重，混合深度无统一上限）。
- 版本 pin：`create_run` 解析顺序=显式 version_id > schedule(pinned_version_id→current_version_id→NO_PUBLISHED_VERSION 失败) > 其余草稿（L1706-1731）；TaskRun 启动一次冻结 `resolved_workflow_version_id`（`task_runner.py:30-44, 897-898`，批次内不漂移）。

### Q4 Agent 页面中的 Workflow 挂载是否只停留在 config？

**对 module/custom：是**（见 §2.4，断点第⑥环）。仅封存 autonomous 轨道曾把挂载转为子 Run 工具。前端"Wakerflow"子页的绑定/解绑只改 `agent.config.workflows`（`mounts.tsx:33-42`）。

### Q5 `AnalysisTask / TaskVersion / TaskRun / Run / WorkItemProjection` 的职责是否重叠？

**不重叠，分层清晰，但 Run 表存在有意的反规范化冗余**（C1）：
- `AnalysisTask`=可变身份+current 指针+legacy 扁平列（`models.py:740-769`，Check 约束保证 workflow/agent 目标互斥 L745-750）；
- `AnalysisTaskVersion`=不可变配置（目标/版本策略/数据窗口/scope/sampling/规则绑定/OutputBinding 全套，L772-821）；
- `TaskRun`=批次（启动时冻结 resolved_rule/workflow_version/agent_version/release/runtime_binding + DataSnapshot + 幂等键，L887-922）；
- `Run`=单条 interaction 执行（task_run_id/interaction_ref/attempt 唯一约束 L241-244；同时承载 workflow 直跑、agent chat/test/eval 等非批次运行）；
- `WorkItemProjection`=**只读投影，无表不双写**（`work_item_projection.py:1-24` docstring 自证；TaskRun + 未触发 ScheduleOccurrence → 五态看板 `STATUS_ORDER`，L41；矛盾数据一律 needs_action 不静默 completed，L62-130）。
- I1：Run 行冗余 task_id/task_version_id/rule_version_id/data_snapshot_id（`models.py:257-264`）与 TaskRun 冻结字段重复，属查询便利反规范化，非双事实源（写入点唯一：`task_runner._interaction_run` L292-308）。

### Q6 manual/schedule/backfill/api 触发的真实状态机？

C1：
- **manual**：`POST /api/tasks/{tid}/runs`（Idempotency-Key header，重复返回原 TaskRun）→ `start_task_run("manual")`（`business.py:1007-1021` → `task_runner.py:132-243`）。门：task 必须 active（paused 409 INV-10，L143-146）；manual 允许 output_mode=platform_only。状态机：queued→running→succeeded/partial/failed（+cancelled 计数列）。旧 `batch-run` 端点仍在（内部同走 manual，`business.py:1023-1030` 自述"过渡入口"）。
- **schedule**：`scheduler_loop`（PG advisory lock 选主，`runner.py:372-395`）→ `schedule_tick`：滚动 48h 物化 `ScheduleOccurrence` + 超 5min 宽限标 missed（`occurrences.py:32-102`）→ `start_task_run(trigger="schedule", schedule_fire_key="{schedule_id}:{utc_iso}")` 幂等（UNIQUE fire_key，`models.py:903`）→ `associate_fire` 回填 occurrence（`runner.py:329-336`）。连续失败 5 次自动停用 Schedule（L349-352）。**非 manual 触发强制 output_mode=target_table**（`task_runner.py:151-154`，SDD13 §18 fail-closed）。
- **backfill**：`POST /api/tasks/{tid}/backfill` 必带 window.start/end → `window_override={mode:fixed}`（`business.py:1032-1046`）→ 行级 `_window_hit` 过滤（`task_runner.py:257-268, 404-407`）。
- **api**：**声明存在、接线不存在**。`TaskRun.trigger` 注释含 api（`models.py:902`）、WorkItem ORIGINS 含 api（`work_item_projection.py:55`）、`run_agent` 对 trigger in ("schedule","api") 有版本解析分支（`agent_runtime.py:595, 679`），但**全库无任何端点以 trigger="api" 创建 TaskRun**（start_task_run 调用点仅 manual/backfill/schedule 三种，grep 证据见 §10）。外部系统今天只能用带 Idempotency-Key 的 manual 端点。
- Run 层 trigger 实际值域比模型注释更宽：`chat`（`agent_chat.py:82`，注释枚举 `models.py:250` 未含 chat——注释漂移）、`batch`（重试，`task_runner.py:582`）、`test/eval/agent/manual/schedule`。

### Q7 自动任务、批量和一次性执行是否共享事实层？

**共享 Run 事实层，不共享看板投影**（C1）：三者都落 `run`/`run_event`/`node_run`/`call_record`（Run 是唯一执行事实表）。但 WorkItem 看板只投影 TaskRun+occurrence（`work_item_projection.py` 只查这两类 + 其子 Run），**一次性 workflow Run（POST /api/runs）、agent chat/test/eval Run 不进任务看板**（`work_items.py:51-90`；I1：chat turn=Run(trigger=chat) 有独立会话 UI，看板不聚合）。

### Q8 外部写回是否有独立 Outbox、幂等、重试和对账？

**有，且与执行终态分离**（C1）：
- Outbox 表 `result_delivery`：UNIQUE(run_id) + UNIQUE(idempotency_key="result-delivery:{run_id}")，exactly-once creation / at-least-once attempt / 目标表 upsert 幂等（`models.py:925-957` 注释即契约）。
- 与 Run.output 同事务创建：`settle_run_success`（`delivery.py:60-103`；Module 结果事务尾部调用 `worker.py:454, 487-488`）。
- Worker：`process_result_delivery` 条件 UPDATE 原子认领 → 写目标表 → 指数退避重试（max_attempts=5）→ 永久错误 dead_letter（`delivery.py:142-229`）；手动重投 `retry_delivery`（仅 failed/dead_letter，payload 不改写，L231+）。
- 对账/聚合：`TaskRun.delivery_status` 独立于执行 status（"禁止以 status=succeeded 推导目标表已有全部结果"，`models.py:912-918`）；`reaggregate_delivery`（`delivery.py:105-131`）；Run 详情返回 delivery 块 + targetReference（`runs.py:131-142`）。DB 现状：82 行（81 succeeded/1 pending）。
- 启动前 fail-closed 目标表探测：`validate_for_start`（`task_runner.py:184-193`）。

---

## 4. §5.4 工作空间、内置工具、Hook、CLI、Channel 逐项验证

| # | 项目 | 结论 | 证据（C1） |
|---|---|---|---|
| 1 | 一等 `Project/Workspace/WorkspaceBinding` 模型 | **当前未实现**。models.py 全文 1128 行无 Project/Workspace/WorkspaceBinding 表；Agent/Task/Run 均无 workspace 字段。前端"工作区/AgentWorkspaceShell"是**页面 IA 壳**（二级侧栏导航），非领域模型（`AgentWorkspaceShell.tsx:1-3` 注释自证"原站 /wakers/{id} 二级侧栏 IA 同构"） | `server/app/models.py`（全文核读）；`src/features/agents/AgentWorkspaceShell.tsx:17-30` |
| 2 | Bash/Read/Write/Edit/Grep/Glob 可治理真实工具 | **当前未实现**。EXECUTORS/节点注册表无此类工具；Tool 表 kind 仅 http|builtin，且 `exec_tool` 无 builtin 分支实现（只有 echo-fixture 门与 http 配方，`runner.py:494-542`）；DB 唯一 builtin Tool（tool-wz9lk）disabled。最接近物是 `code-write` 节点=宿主机 python3 子进程（非治理 shell，见 #3） | `runner.py:1064-1088`；`registry.py`（节点清单）；`models.py:160`（kind 注释） |
| 3 | subprocess 是否只存在于受限节点/测试 | **基本是**。生产代码 subprocess 仅两处：① `exec_code_write`（10s 硬超时 + `code_node_enabled()` 门控——生产**永久禁用**、非生产需显式 `WF_CODE_NODE=on`，`runner.py:816-864` + `config.py:38-45`；DB 中仅"测试"工作流草稿含 1 个 code-write 节点）；② `auth_sandbox.py`（鉴权脚本 QuickJS 子进程隔离，5s 硬超时 + 64MB 限制，L14, 27-29, 82-85）。无其他生产子进程路径 | `runner.py:822-845`；`config.py:38-45`；`auth_sandbox.py:1-29,82-85` |
| 4 | RunStart/SessionStart/BeforeTool/AfterTool/RunEnd Hook 引擎 | **当前未实现**。全库 grep 无 hook 引擎/注册点；`RunEvent` 是事后事实表非可订阅钩子；无 webhook 订阅机制（alerts 的 webhook 是**告警通知出站**，尽力投递，`alerts.py:50-65`，与运行生命周期 Hook 无关） | grep 证据（§10 命令 #14）；`models.py:301-319`；`routers/alerts.py:50-65` |
| 5 | 平台 CLI（非依赖包自带） | **当前未实现**。package.json 无 bin；server 无 argparse/click 用户 CLI；`run_scheduler.py`/`run_worker.py`/`run_legacy_agent_archive.py` 是进程入口/运维脚本；`scripts/` 68 个文件为开发验收脚本（.mjs/.py），非产品 CLI | grep 证据（§10 命令 #14）；`server/` 目录清单 |
| 6 | 通用 IM Channel Gateway | **当前未实现**。无 channel gateway/IM 集成代码；`RunEvent.channel` 是 CONTROL|CONTENT **事件双通道标记**（`models.py:311-312`），与 IM 无关；`notification` 节点只 emit `notification_sent` 事件、无真实外发（`runner.py:690-700`） | `models.py:311-312`；`runner.py:690-700` |
| 7 | 本项目当前是否有飞书产品需求 | **代码与当前设计稿中无飞书产品需求实现**。全库 grep `飞书|feishu|lark` 在 `server/app/`、`src/` 零命中；`docs/v2-design/` 仅 `03-trigger-and-data-mapping.md:20` 一处，且是**对 Coze 的调研引述**（"早期调研（06-SDD 附录 C.4 飞书口径）已记录"），非本项目需求 | grep 证据（§10 命令 #15） |

---

## 5. 四条端到端调用链汇总（文件:行号逐级）

### 链 1 · Agent（Module）：创建→发布→Release→运行→结果 —— **代码级通，运行环境级断**

```text
UI 创建    src/pages/agent-create.tsx:63-81（moduleKey 卡片）→ src/services/wf-api.ts:512-514
API        server/app/routers/agents.py:29-78（registry.get 校验 module → Agent 行 type=module）
编辑       src/pages/module-agent-config.tsx（name/desc/purpose/modelRef/caps）→ wf-api.ts:524-526
           → agents.py:196-225（expectedRevision 乐观锁）
版本       module-agent-config → wf-api.ts:516-518 POST /versions → agents.py:354-390
           → agent_release.py:19-39(build_definition module 分支) → 192-211(validate_publish)
           → 112-144(freeze_dependencies) → 184-187(artifact_hash) → AgentVersion 行(models.py:381-396)
Release    src/components/module-publish-dialog.tsx:56-60（env+canary+provider 必选）
           → agents.py:420-517（Provider enabled/contract 1.0/实现存在/ONE_PROVIDER_PER_AGENT
             445-490；同环境旧 active→rolled_back 491-500；指针回写 506-510）→ Release 行
运行(测试) module-agent-config.tsx:104-115（trigger=test，草稿必须显式 providerId）
           → agents.py:278-297 → agent_runtime.py:655-667(run_agent) → 567-646(_run_module_agent：
             版本/Release/灰度桶解析 579-623 → Run 行 624-629 → JobQueue agent-runtime-submit 636-638
             或同步 execute_module_run_sync 640-646)
Worker     runner.py:1610-1616(_dispatch_job) → runtime_providers/worker.py:148-204(submit：幂等恢复
             155-161；build_runtime_request → dispatcher.py:25-52 冻结 definition→AgentExecutionSpec；
             client.py:115-124 POST /v1/runs，run_id 平台侧生成即 Provider 侧 id)
             → 207-247(poll 有界退避) → 83-102(终态收尾) → 394-489(_settle_module_result：
             平台二次 Schema 校验 412-423 → CallRecord 431-447 → QualityResult/Evidence(仅
             quality-analysis) 457-486 → delivery.settle_run_success 454/487-488)
Runtime    runtimes/agentscope/app/main.py:1-5 → adapter.py:145-387（OpenAIChatModel 190-199；
             native_quality_v0.2 分支 201-256；MCP Toolkit 258-283；Agent+ReActConfig 300-306；
             reply_stream+structured_output 308-376）
返回       RunEvent(runtime_submitted/runtime_trace/runtime_finished, worker.py:196-199,
             trace_mapper.append_provider_events 110) → GET /api/runs/{id}(runs.py:69-170：
             runtime 块/stages/calls/evidence/delivery) → src/pages/run-detail.tsx
```

**判定**：链在代码层端到端闭合（含幂等/取消/超时/结果事务）；**当前运行环境断**——① 三个 Provider 服务全部不可达（§0.2）；② DB 所有 active Release 绑定已退役 Provider（openai-agents 源码从未入 git；DSH 已归档），AgentScope Provider health=error 且零绑定（§0.3）；③ 2 个 dsh-* Agent 的 module_key 不在 Registry（运行必 MODULE_UNKNOWN，`agent_modules/registry.py:49-60`）。

### 链 2 · Skill：上传→挂载→运行注入 —— **通到 DB，断在 Release/Runtime**

```text
UI         src/pages/res-skills.tsx（上传 Dialog + 挂载 Dialog 选 Agent）
           src/pages/agent-workspace/skills.tsx:32-49（安装/卸载/上传并安装；readOnly 隐藏）
API        POST /api/skills/upload（wf-api.ts:445-455）→ agent_caps.py:296-364
           （md frontmatter/zip/tgz 解析 330-345 → SkillResource 行 347-349 → agentIds 逐个
             建 AgentSkill 351-360）；或 POST /api/agents/{id}/skills → agent_caps.py:97-111
DB         skill(models.py:421-434) + agent_skill(models.py:437-445, UNIQUE 防重)
消费A(chat) agent_chat.py:40-44 —— system prompt 仅注入 Skill 名字（无正文）
消费B(封存) agent_runtime.py:251-277 build_mounted_skills_section —— 正文注入（8000 截断），
           但宿主 autonomous 型已封存（agents.py:56-58 创建 410；DB 唯一行 archived=t）
Release    ×  agent_release.py:19-56/112-181 不含 Skill/AgentSkill —— 断点在第⑤环
Runtime    ×  contract models.py:66-74 无 skills 字段；dispatcher.py 不读 agent_skill —— 断点在第⑥环
AgentScope ×  adapter.py 不消费；capabilities.skills=True 仅声明（134-143）—— 断点在第⑦环
测试证据   server/tests/test_skill_shell.py:50-84（正文注入函数直测）、124+（mounts 端点）
```

**判定**：断。上传/挂载/持久化/反查（`/api/skills/mounts`，agent_caps.py:133-140）全通；运行时正文注入仅存在于封存轨道；当前可用轨道（module 结构化、custom 对话）分别"完全不消费"与"只消费名字"。

### 链 3 · Workflow：创建→草稿→发布→运行→事件返回 —— **通（平台最完整链路）**

```text
UI         src/pages/wf-workflows-list.tsx → POST /api/workflows（workflows.py:42-52，默认
           input→end 图 21-39）；设计器 src/features/designer/DesignerPage（wf-agent-editor.tsx:84
           亦作 404 回落）→ PUT /{id}/draft（baseRevision 冲突 409，workflows.py:148-163）
发布        workflows.py:175-229（validate → 封存 Agent 引用阻断 185-196 → form 快照冻结
           200-209 → WorkflowVersion 行 + _collect_refs 收集 tool/model/mcp/knowledge 引用
           210-217, 232-248 → current_version_id 指针 + 绑定 Agent 状态同步 217-224）
运行        POST /api/runs（runs.py:18-27）→ create_run（runner.py:1706-1753：版本解析/图校验/
           form 输入校验 → Run 行 → JobQueue workflow-execution）
Worker     runner.py:1627-1628 → execute_run:1115+（递归检测 1121-1127、深度≤5 1128-1133、
           版本/Agent 冻结谱系 1136-1153、拓扑分批并发 WF_PAR_RUN=4 1218-1234、
           EXECUTORS+_agent_family_executor 分派 1245、协作取消 1325-1332、
           wait-review 挂起/resume 1010-1025 + runs.py:30-53）
子流程      workflow-exec 631-661（子 Run trigger=manual 草稿解析）/ workflow-fixed 786-814
           （pinned 可钉版本）/ agent 系兼容层 agent_runtime.py:441-560
事实        NodeRun(models.py:282-298)/RunEvent(301-319, sequence 单调+CONTROL|CONTENT 双通道
           runner.py:66-84)/CallRecord(334-351, PII 脱敏 runner.py:1101-1110 Ctx.call)
返回        SSE /api/runs/{id}/events（DB 轮询重放 + Last-Event-ID，runs.py:185-213）；
           /trace span 树（Run→NodeRun→CallRecord→子 Run 递归，runs.py:250-317）
```

**判定**：通。DB 有 266 条 Run、9 个工作流真实使用痕迹；schedule 触发走版本冻结（create_run L1716-1724）。薄弱点：`workflow-exec` 子调用不 pin 版本（草稿漂移风险，`runner.py:640`）；`notification` 节点无真实外发（L690-700）。

### 链 4 · TaskRun：任务→批次→逐条 Run→投递→看板 —— **通（api 触发未接线）**

```text
UI         src/pages/tasks.tsx（列表 bizApi.tasks）→ /autonomous-tasks/new =
           src/features/autonomous/AutonomousTaskEditor.tsx:34-45（executionTarget=workflow|agent、
           agentVersionPolicy=pinned|latest_sandbox|latest_prod）
API        POST /api/tasks（business.py:839-966：agent 目标校验 846-885【仅 Module Agent 可作目标
           859-860】、workflow 目标 _validate_task_config 886-905、OutputBinding 预检 907-912、
           AnalysisTask+TaskVersion v1 同事务 918-963）；canonical 别名 /api/automations 同代码路径
           （automations.py:35-41 复用 biz.create_task）
触发        manual：POST /api/tasks/{tid}/runs + Idempotency-Key（business.py:1007-1021）
           backfill：window 必填（1032-1046）
           schedule：scheduler_loop(advisory lock, runner.py:372-395) → schedule_tick(298-357：
             occurrence 物化/missed 标记 → fire_key 幂等 start_task_run → associate_fire)
           api：声明存在、无端点接线（见 §3 Q6）
启动        task_runner.start_task_run:132-243（状态门 143-146 → 非 manual 强制 target_table
           151-154 → 目标解析 _resolve_workflow_version:30-44 / _resolve_agent_target:95-129
           【Release 必须带 Provider 绑定，失败关闭】→ 幂等复用 164-172 → 规则版本冻结
           _resolve_rule_version:54-79 → 目标表 fail-closed 探测 184-193 → reader.validate/count
           194-207 → DataSnapshot 209-217 → TaskRun 行(冻结 resolved_* 全套) 218-229 →
           JobQueue task-run 231-233）
执行        runner.py:1606-1608 → execute_task_run:325-511（分页 read_page 391-403 →
           window/eligibility/scope/sampling 过滤 404-459 → 空 ID/重复 ID 也建失败 Run 424-452 →
           _interaction_run 292-308（Agent 目标带冻结版本+Provider+runtime_binding）→
           _dispatch_interaction_run 311-322（workflow→execute_run；agent→execute_module_run_sync
           worker.py:323-391 含结果事务）→ 计数终态 481-501）
重试/重汇    task-run-retry（runner.py:1609 区段）→ retry_failed_in_taskrun:546-602（新 attempt +
           origin_run_id 谱系）→ reaggregate_task_run:514-543（按最新 attempt 重汇）
投递        delivery.settle_run_success:60-103（Outbox 同事务）→ result-delivery job →
           process_result_delivery:142-229（原子认领/退避/dead_letter）→ reaggregate_delivery:105-131
看板        work_item_projection.build_work_items（TaskRun+未触发 occurrence → 五态；矛盾→
           needs_action）→ GET /api/work-items（work_items.py:51-78）+ SSE digest（128-139）
           → src/pages/operations-today.tsx（/tasks 路由，app.tsx:116）
```

**判定**：通。DB 58 个 TaskRun、201 个 occurrence、82 条 delivery 为真实使用痕迹；但 15 个 TaskRun 滞留 running（09-02~09-07）、8 个滞留 queued、job_queue 83 条 dead——**批次执行的可恢复性在真实环境中未被兑现**（I1：worker 停止后无自动回收 TaskRun 级僵尸态的机制；`recover_stale_jobs` 只回收 job 租约，`runner.py:1579-1596`，不重置已 running 的 TaskRun/Run 行）。

---

## 6. mock / fixture / POC / 生产路径分类台账

### 6.1 生产路径（真实执行，fail-closed）

| 路径 | 位置 | 门禁 |
|---|---|---|
| Workflow DAG 引擎（EXECUTORS 全家族） | `runner.py:1064-1088, 1115+` | 图校验+版本冻结 |
| Tool http 配方执行（egress+Connection 签名+禁重定向） | `runner.py:494-542`；`egress.py:31-59` | 生产强制 egress；echo spec fail-closed |
| LLM OpenAI 兼容真调用（流式+tool_calls） | `agent_runtime.py:77-155` | 生产无 Provider → MODEL_UNAVAILABLE（L84-86），**禁止 mock** |
| TaskRun 批次 + Module Provider 分派 + 结果事务 | `task_runner.py`；`runtime_providers/worker.py` | 版本/Release/Provider fail-closed |
| ResultDelivery Outbox | `delivery.py:60-229` | 原子认领/dead_letter |
| 调度（advisory lock 选主 + occurrence 物化） | `runner.py:298-395`；`occurrences.py` | fire_key 幂等 |
| Connection/KMS/CheckRun 门禁 | `admin.py:117-480`；`check_runs.py`；`resource_registry.py:137-155` | 启用需真实 CheckRun；reveal 禁用 |
| AgentScope Runtime（2.0.7） | `runtimes/agentscope/app/adapter.py` | 输出 Schema 双侧校验；**当前服务不可达** |

### 6.2 mock（非生产回落，带可观测标记）

| mock | 位置 | 边界 |
|---|---|---|
| LLM 回落 `[mock:model]` 回复 / 首工具 ping | `agent_runtime.py:87-95` | 仅非生产 + 无 base_url；生产抛错 |
| Agent 路由取首候选 `routing=mock` | `agent_runtime.py:478-482` | 仅非生产 |
| decision-class/query-rewrite 的 mock 分支 | `runner.py:874-954`（注释自认 mock：第一类） | 无真模型时 |
| `_fallback_answer` 兜底"你好，我在。" | `agent_runtime.py:359-365` | 闲聊兜底异常时 |

### 6.3 fixture（显式门控 `WF_TEST_FIXTURES=1` 且非生产；输出带 fixture:true）

| fixture | 位置 |
|---|---|
| echo 工具 spec | `runner.py:505-513`；创建门禁 `resources.py:41-54` |
| MCP mock 工具清单 `_MOCK_MCP_TOOLS` | `resource_tests.py:25, 72-117` |
| Knowledge mock 切片 | `resource_tests.py:140-145, 282-287` |
| Datasource/OSS mock 检查 | `resource_tests.py:148-214` |
| pytest 全套 profile（conftest 强制开 fixtures，DB=wf_test） | `server/tests/conftest.py:4-10`；`config.py:5-9, 28-35` |
| FakeProvider（进程内 uvicorn，故障注入） | `test_r1_runtime_providers.py:1-5, 48+` |
| FakeRunner / SimpleNamespace 双件（AgentScope 测试不触真包） | `runtimes/agentscope/tests/test_native_workflow.py:19+`；`test_adapter.py:7` |
| 跨 Provider 请求哈希钉扎 fixture | `agent_modules/quality_analysis/fixtures/platform_request_v1.json` + `test_platform_module_request.py:14-31` |
| **Tool Service（8200）= fixture 事实服务**："returns fixture facts only"，数据源 `poc/.../tool_fixtures_v0.1.json` | `services/tool_service/README.md:3-5, 20-23`；adapter 默认 URL `adapter.py:211-214, 265` |
| g048 builtin Skill 种子（仓内 SKILL.md 一次性入库） | `g048skillseed0001_builtin_skills.py:30, 35` |

### 6.4 POC / 已退役 / 封存

| 项 | 状态 | 位置 |
|---|---|---|
| `poc/agent_runtime_providers/` | POC 资产（datasets/ground truth/schemas）；"R0 不接真实平台流量"；但 **golden-eval/eval-summary 生产端点直接读 POC ground truth**（`agents.py:600-604, 656-657`） | `poc/agent_runtime_providers/README.md` |
| native_workflow v0.2 | 文件头自标 "for the v0.2 POC"（5 阶段 identify/plan/execute/barrier/synthesize + per-stage allowlist + fan-out + barrier） | `runtimes/agentscope/app/native_workflow.py:1-5, 170` |
| OpenAI Agents runtime | 09-04 退役；**源码从未入 git**（仅 .pyc 物证）；DB Provider 行仍 enabled + 3 条 active Release 绑定 | `archive/runtimes-retired-2026-09-04/README.md`；§0.3 |
| DeepSeek Harness runtime | 09-04 退役归档；其 Cordis 插件是 AgentScope 移植"行为蓝本"（移植未过真实回归）；DB Provider 仍 enabled + active Release 绑定 + 2 个 dsh-* module_key Agent 已成孤儿（Registry 无此 module） | 同上；`runtimes/README.md:12-16` |
| 旧三类 Agent（autonomous/dialogue/expert-group） | 代码封存：创建/编辑/发布/运行/复制全 410（`legacy_agent_archive.py`；`agents.py:56-58` 等）；worker `agent-execution` job 防呆置败（`runner.py:1601-1605`） | — |
| agent/agent-select/agent-exec 节点 | deprecated（palette 隐藏、兼容层可执行、显式 /migrate 改写） | `registry.py:111-147`；`workflows.py:93-111` |
| `/api/tasks/{tid}/batch-run` | 自述"过渡入口"，内部同走 manual TaskRun | `business.py:1023-1030` |
| `code-write` 节点 | 非真沙箱（宿主机子进程），生产永久禁用 | `runner.py:816-824`；`config.py:38-45` |

---

## 7. 未提交工作区变更清单

**结论：审计时刻无未提交 tracked 变更**（`git status --porcelain` 仅两条 untracked）。

| 项 | 内容 | 处置 |
|---|---|---|
| untracked `.zcode/` | agent 会话计划文件（非产品代码） | 不作为事实引用 |
| untracked `exports/` | `原始通话样本20条_2026-09-03.xlsx`、`原始通话样本20条-原始JSON/`（数据导出物，未入 .gitignore） | 不作为事实引用；含原始通话样本，提示主审计者注意数据敏感性（I1） |
| 已提交的"并行会话遗留" | 任务书点名的 g048skillseed 迁移、agent_runtime/admin/settings/wf-connections/res-list 改动**已被 f6824f9 checkpoint（2026-09-08 15:42，即本研究开始前约 1 小时）收入 HEAD**；res-skills/res-category-pages 由 894245d（09-08 02:00）收口 | 本报告按 HEAD 事实引用（G3 满足：不存在"把未提交变更当 HEAD 事实"的情形）；但登记其"当日 checkpoint 收口"来历：这些代码**未经过独立发布验收**，`test_skill_shell.py` 等配套测试本轮被禁止运行，其通过性只能引用提交信息自述（"回验 md+zip+挂载+UI 全通"，894245d），属提交者声明而非本轮复核（I1） |
| archive 移动 | `archive/runtimes-retired-2026-09-04/*` 的文件系统移动曾在归档 README 中标注"未提交、提交时机由用户决定"，现已随 f6824f9 提交 | 已闭环 |

---

## 8. EVIDENCE_GAP 汇总

| # | 问题 | 为什么无法从代码/只读探针回答 |
|---|---|---|
| 1 | "wf_dev 曾为唯一真库"的**历史**部署形态（是否曾有并行真库/生产库） | 代码只有当前默认值（config.py:5-9）；历史环境无部署物证在仓内；不允许访问其他 DB |
| 2 | "32 个 mysql datasource 曾是占位" | 当前 wf_dev 仅 1 条 mysql 行（disabled/error）；全部迁移/种子脚本 grep 无生成 32 条的痕迹；该说法的历史时点数据已不可见 |
| 3 | AgentScope Provider health=error 的**当前**成因 | health 值写于 08-30；服务现不可达（curl 空响应）；禁止启动服务复测，无法区分"服务没起"与"适配器缺陷" |
| 4 | 8303 openai-agents 服务是否仍可从 .venv 运行 | 源码从未入 git（archive README 自证）；只剩 .pyc；不可启动验证 |
| 5 | Provider `/health` 实测 capabilities 的当前值 | 三个服务全不可达；DB capabilities 列为陈旧快照；测试只有 FakeProvider |
| 6 | DSH→AgentScope 行为移植（docs 05 轨道 B1/B2）的完成度 | runtimes/README 只说"until those ports pass real-call regression"；仓内无已通过的回归记录物证；native_workflow 自标 v0.2 POC |
| 7 | 8120 API / 5199 前端服务健康 | 任务约束禁止触碰这些端口；本报告所有"链路通"均为**代码级**结论，不含"当前服务可用"断言 |
| 8 | 15 个 running TaskRun / 1 个 running Run 僵尸态的成因细节 | 只读 DB 可见 started_at（09-02~09-07）与 provider 绑定，但 worker 进程历史日志不在仓内；不可重启 worker 验证回收行为 |
| 9 | Workflow→Module Agent 嵌套（R3-5）是否有专属 e2e 测试通过记录 | 代码路径存在（agent_runtime.py:640-646 + worker.py:323-391）；测试文件未逐一展开运行验证（禁止 pytest）；仅能确认 test_r3_task_agent_target.py 覆盖 Task→Agent 方向 |
| 10 | connection_schemas.py 的 ConnectionCreate 字段全集 | 本轮未逐行核读该文件（admin.py 调用点已核）；字段级链路②→③环以 admin.py:117-215 行为为准 |

---

## 9. G3 闸门自检表

| G3 条款 | 自检 | 证据 |
|---|---|---|
| 每条"已实现/未实现/旁路/断链"都有文件和行号 | ✅ | §1-§5 全部结论带 `文件:行号`；DB 事实带 §10 命令编号；推断均标 I1 |
| 至少给出 Agent、Skill、Workflow、TaskRun 四条端到端调用链 | ✅ | §5 链 1-4，逐级文件:行号 + 通/断判定 |
| mock、fixture、POC、生产路径分开标注 | ✅ | §6 四张台账（6.1 生产 / 6.2 mock / 6.3 fixture / 6.4 POC-退役-封存） |
| 没有改代码或运行会改数据库的测试 | ✅ | 全程只读：Read/grep/sed/cat/git log/git show/psql SELECT/curl GET /health；未运行 pytest；未写任何 server/src/runtimes/poc/迁移/测试/docs 文件；唯一写入=本交付物 |
| 未提交工作区变更没有被当成稳定 HEAD 事实 | ✅ | §0.1/§7：审计时 tracked 树干净；并行会话遗留已被 f6824f9/894245d 收入 HEAD 后才被引用，且其"当日 checkpoint、测试未复跑"来历已单独登记 |
| §5.2 每类资源字段级链路 + 断点标注，不写"已挂载" | ✅ | §2.1-2.8 八条链，每条标明"断点在第 X 环"；结论一律用"页面能绑≠运行时消费"句式 |
| §5.4 逐项验证存在性，不存在写"当前未实现" | ✅ | §4 七项全部给"当前未实现/基本是/无需求"结论 + 证据，无"应该顺便做"表述 |
| 无法回答的写 EVIDENCE_GAP | ✅ | §8 共 10 项 |
| 已知线索独立验证而非照抄 | ✅ | §0.3 末尾四条复核结论（wf_dev：当前真/历史 gap；32 mysql：不可复核；openai-agents 退役：真+发现 active Release 残留；AgentScope 唯一底层：真+接线未完成量化） |

---

## 10. 本次执行过的全部探针命令清单

均为只读；按执行顺序（同类合并）。**未执行**：pytest、任何写库脚本、任何进程启停/杀、任何浏览器自动化、任何依赖安装。

1. `git -C /Users/rivers/MoreThanCorn status --porcelain`；`git log --oneline -5`；`git status`；`git show --stat HEAD`（含 grep server/src/g048 过滤）；`git log -1 --format="%H %ci %s" f6824f9 / 894245d` —— 输出摘要：tracked 树干净，untracked 仅 .zcode/、exports/；HEAD=f6824f9 checkpoint（2026-09-08 15:42）含 g048 迁移等并行会话改动；main 领先 origin 25 提交。
2. `ls`（仓库根 / server/app / server/app/routers / agent_modules / runtime_providers / data_readers / data_writers / src/pages / src/pages/agent-workspace / src/features/agents / runtimes / poc / archive / packages / scripts / services/tool_service 及子目录）；`wc -l` 核心 server 文件与前端文件 —— 结构清点。
3. `cat`：`runtimes/README.md`、`server/app/config.py`、`server/app/db.py`、`.env`、`.env.local`、`server/app/connection_runtime.py`、`server/app/occurrences.py`、`server/app/legacy_agent_archive.py`(head)、`archive/runtimes-retired-2026-09-04/README.md`、`poc/agent_runtime_providers/README.md`(head)、`services/tool_service/README.md`(head)、`src/pages/task-wizard.tsx`、`.gitignore`、alembic `g047/g048` 迁移全文。
4. `Read`（全文）：`server/app/models.py`(1128 行)、`agent_runtime.py`(772)、`agent_release.py`(249)、`agent_chat.py`(176)、`routers/agents.py`(883)、`routers/workflows.py`(322)、`routers/automations.py`(86)、`routers/runs.py`(317)、`routers/work_items.py`(168)、`routers/resources.py`(533)、`resource_registry.py`(231)、`task_runner.py`(602)、`agent_modules/base.py`、`agent_modules/registry.py`、`runtime_providers/{worker,client,dispatcher,registry}.py`、`runtimes/agentscope/app/adapter.py`(402)、前端 `agent-create.tsx`、`agent-chat.tsx`、`AgentWorkspaceShell.tsx`、`agent-workspace/{skills,mounts,connectors,custom-config}.tsx`、`wf-agent-editor.tsx`。
5. `sed -n`/`grep -n`（分段读取与定位）：`runner.py`（L1-120, 290-395, 494-545, 631-712, 786-875, 1010-1026, 1064-1330, 1480-1753 及多处 grep 定位）、`business.py`（L783-1120, 1490-1516 及端点清单 grep）、`resource_tests.py`（search_knowledge/mcp_call_tool/_test_* 段）、`work_item_projection.py`（L1-130）、`delivery.py`（结构 grep）、`native_workflow.py`（L1-60, 91-170 及 stage grep）、`main.py`（router 注册）、`registry.py`（节点 deprecated 标记）、`routers/{admin,agent_caps,runtime_providers}.py`（端点清单/全文）、`contracts.py`（L1-100）、`egress.py`（全文）、`auth_sandbox.py`（L1-40）、`module-agent-config.tsx`/`governance.tsx`/`home.tsx`/`res-skills.tsx`/`res-list.tsx`/`resources-shell.tsx`/`tasks.tsx`/`operations-today.tsx`/`task-edit.tsx`/`AutonomousTaskEditor.tsx`/`wf-api.ts`（关键段/grep）、`runtimes/agentscope/{pyproject.toml,uv.lock,app/main.py,tests/*}`、`server/tests/{conftest,test_r1_runtime_providers,test_skill_shell,test_agent_runtime}.py`（头部/grep）、`agent_modules/*/manifest.yaml`（grep）、`quality_analysis/spec.default.json`（python3 json 读取 tools/criteria 段）、`packages/runtime_contract/.../models.py`（L50-200）、`docs/v2-design/03`（飞书 grep 上下文）。
6. `grep -rn` 专项验证：config.connections 消费点（零命中）；`api/v2/connections` 实现（仅 contracts.py 清单）；trigger="api" 调用点（零命中）；`subprocess`（仅 runner.py/auth_sandbox.py）；hook/RunStart/SessionStart/BeforeTool/AfterTool（零命中）；feishu/lark/飞书（仅 doc03 调研引述）；workspace/project 模型（零命中）；bin/argparse/click CLI（零命中）；8200 引用；`import agentscope`（仅 probe 脚本）；mysql 种子（仅类型映射表）。
7. `psql -U rivers -h 127.0.0.1 -d wf_dev -c "SELECT …"`（**全部只读 SELECT**，共 5 次调用约 30 条查询）：agent_runtime_provider 全列；datasource 按 type 计数+明细；agent 按 type/module/status 计数+全行明细；skill/agent_skill（含 join agent/skill 明细）；workflow 计数+状态明细；run 计数+trigger×status 分布+running 行明细；task_run 计数+status/delivery_status 分布+running/queued 时间范围；analysis_task 计数+前 8 行；release 全列；agent_version/connection/mcp_server/knowledge_source/tool 计数；connection/tool/mcp_server/knowledge_source 明细；tool_version 状态 join；schedule/schedule_occurrence/job_queue/result_delivery 计数；workflow 草稿与版本的节点类型 jsonb 扫描（agent 家族命中 0）；custom/autonomous agent 的 config->'skills'/config->'connections'。输出摘要已全部录入 §0.3 及相关章节。
8. `curl -s -m 3 http://127.0.0.1:8301/health`、`…8302/health`、`…8303/health`（只读 GET，无状态变更；三个端口均空响应=不可达）。**未触碰** 5173/8000/8100/8120/5199。
9. `python3 -c "import json; …"`（本地读取 spec.default.json，只读）。

---

*报告完。本文件为本阶段唯一产出；所有行号以 HEAD f6824f9 为准，复核时请先确认 `git rev-parse HEAD` 一致。*
