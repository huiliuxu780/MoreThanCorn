# Domain Agent Runtime Provider — Phase R2 验收记录

日期：2026-08-29
分支：`codex/domain-agent-runtime-provider`
阶段状态：完成（待用户验收）

## 1. 本阶段范围

R2 落地 Agent Module 框架与质检 Module（SDD 10 §2/§5.1/§6/§9.1/R2-1～R2-6）：
新 Agent 只按领域 Module 创建；Module Registry 启动 fail fast；版本发布冻结
Module+AgentSpec+Schema 哈希+依赖；Release 时绑定 Runtime Provider；Module 运行
经 R1 worker 分派到 Provider。旧三类入口保持封存。

- **数据模型**（migration `g041r2module0001`，可升级可降级）：`agent.module_key/module_version`
  先可空（expand/contract，封存历史行不回填）；新 Module Agent 应用层必填，type 内部值 `module`
  仅历史读取保留。
- **Module 资产**（`server/app/agent_modules/quality_analysis/`）：manifest.yaml（key/version/
  风险等级/双实现/逻辑工具/工作流模式）、spec.schema.json、spec.default.json（自 POC
  quality_agent_v0.1 迁入，criteria/工具策略/提示词语义逐字保留）、schemas/（输入/输出 JSON
  Schema，自 POC 复制）、master_data/（service_type/issue_taxonomy v1）、evaluators（Ground
  Truth 对比评分）、fixtures/platform_request_v1（跨 Provider 公共请求钉扎）。
- **Module Registry**（base.py+registry.py）：加载即校验（缺字段/缺实现/默认 Spec 不合 Schema
  即拒）；启动 warmup fail fast（main.lifespan）；`get/validate_spec/resolve_implementation`；
  实例可覆盖 modelRef/purpose，**criteria/tools/master_data 属 Module 版本资产不可实例改写**。
- **发布链**（agent_release.py + routers/agents.py）：Module 分支 build_definition（module+
  agentSpec+input/outputSchema sha256+执行/安全策略）；freeze_dependencies 新增
  AGENT_MODULE/MODULE_IMPLEMENTATION/MASTER_DATA/INPUT_SCHEMA/OUTPUT_SCHEMA 依赖类型，
  逻辑工具解析到平台 Tool ready 版本；validate_publish 模型必填且启用；Spec 结构经 JSON Schema
  强校验（409 AGENT_SPEC_INVALID）；artifact hash 继续覆盖全部快照（同配置重发哈希稳定）。
- **Release Runtime Binding**（R1 列的消费）：Module Agent 发布必须 `runtimeProviderId`；
  校验 Provider 存在/enabled/kind 有 Module 实现/contract 1.0；写
  `release.runtime_provider_id/runtime_profile/runtime_binding_snapshot`（含 module 实现版本、
  bundle/entry、Schema 哈希）。**同一 AgentVersion 可同时绑定 AgentScope（稳定）与 DSH
  （canary）到 sandbox**。
- **运行分派**：`run_agent` Module 分支——schedule/api 按环境指针解析 Release 绑定（灰度按桶
  选 Provider），创建 Run（agent_version_id+runtime_provider_id）并入队 R1
  `agent-runtime-submit`；草稿预览须显式 providerId（definition_source=draft，标记进请求
  metadata）；嵌套（agent-exec 调 Module Agent）明确报错留待 R3-5。dispatcher 按 Module 冻结
  Spec 组装 RuntimeExecuteRequest（workflowMode 进 context.metadata）。
- **Runtime 侧**：AgentScope/DSH 均已 request-driven（POC 实现=quality-analysis 1.0.0 的双
  Provider Implementation）；各增 conformance 测试钉扎公共请求 agent 段 SHA-256；DSH 测试
  锁定 NATIVE_BUNDLE 与 manifest 声明一致；danger-full-access 守卫已在（非 dev 拒绝）。

## 2. 测试证据

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 后端全量（含 R2 新增 8 项） | `server/.venv/bin/python -m pytest tests -q` | **266 passed, 0 failed**（连续两轮） |
| AgentScope 套件（+conformance） | `runtimes/agentscope/.venv/bin/pytest -q runtimes/agentscope/tests` | 9 passed |
| DSH 套件（+conformance） | `runtimes/deepseek_harness/.venv/bin/pytest -q runtimes/deepseek_harness/tests` | 10 passed |
| 迁移 | wf_test/wf_dev `alembic upgrade head` | head=`g041r2module0001` |
| R0 边界回归 | `python3 scripts/verify-runtime-r0.py` | PASS |
| 前端三件套 / git diff --check | — | 全绿 / 干净 |
| verify-fullstack | `node scripts/verify-fullstack.mjs` | 38/49（失败集=存量基线；S13 修复为只取旧类型条目——Module Agent 进入列表后原断言过脆） |

R2 新增平台测试（`server/tests/test_r2_agent_modules.py`，8 项）：Registry 资产+fail fast+Spec
校验；实例不可改写 Module 资产；Module 创建（旧类 410/未知模块 422）；发布冻结全量断言
（module/agentSpec/Schema 哈希/7 类依赖/哈希稳定）；Release 绑定校验（必填/404/409×2）+
双 Provider sandbox 并存+binding_snapshot 断言；分派 e2e（fake provider 真实 HTTP：请求含
workflowMode/4 工具/2 主数据/冻结 Schema，双 Provider **agent 段哈希一致**）；钉扎 fixture
资产漂移守卫（改 spec/Schema 不同步重钉→三侧同挂）；未发布 422+预览必须 providerId；
100% 灰度 Release 绑定按桶落 DSH。

## 3. 关键文件

- `server/app/agent_modules/{__init__,base,registry}.py`、`server/app/agent_modules/quality_analysis/*`
- `server/alembic/versions/g041r2module0001_agent_module.py`、`server/app/models.py`
- `server/app/agent_release.py`（Module 分支）、`server/app/routers/agents.py`（创建/Release 绑定）
- `server/app/agent_runtime.py`（`_run_module_agent`）、`server/app/runtime_providers/dispatcher.py`
- `runtimes/*/tests/test_platform_module_request.py`（跨 Provider conformance）

## 4. 已登记偏差与决策

1. **criteria/tools/master_data 不允许实例覆盖**：比 SDD §2.3"AgentSpec 可含工具清单"更严
   ——同 Module 版本的核验语义不可漂移；实例差异通过 purpose（注入 instructions 尾部）与
   modelRef 表达。如需不同 criteria → 发布新 Module 版本。
2. **模型选择在实例（modelRef）并冻结进 AgentSpec.model**：POC Spec 无 model 字段；适配器
   要求 request.agent.model——按"模型属于业务实例配置"落地（SDD §15.2 示例未含，不冲突）。
3. **DSH 实现的 profile/bundle 选择仍走环境变量（QUALITY_DSH_PROFILE/HOME）**：Release
   binding_snapshot 已记录 bundle/profile 名称（R2 未把 binding 注入 Provider 环境装配——
   Provider 进程部署仍人工；R4 生产门禁前需把 binding→部署装配自动化或明确运维流程）。
4. **草稿预览必须显式 providerId**（无 Release 可解析）；统一 target 解析收敛在 R3-1/3-3。
5. **嵌套调用（Workflow agent-exec → Module Agent）R2 明确不支持**（清晰报错），R3-5 交付。
6. **verify-fullstack S13 取首条旧类型**：Module Agent 出现在 archived=all 列表后，
   原断言假设首条为旧 Agent 过脆，已修。
7. 注册表目录形态：policies 并入 base（Module 首期共享只读默认值），request_mapper 由
   manifest.workflowMode + request_context 承载——SDD §2.2 为建议目录，语义等价。

## 5. 限制与后续

- 未跑真实模型（Provider 联调属 conformance/Golden Set 门禁，R4 前）；未构建 Docker 镜像。
- R3 目标：AnalysisTask 支持 Agent target、统一 dispatcher、结果事务
  （QualityResult/Evidence/ResultRule 派生）、Run Detail 增强、agent-exec 调 Module Agent。
- 未 push、未执行数据 `--apply`、未触碰用户验收栈（5173→8120）。
