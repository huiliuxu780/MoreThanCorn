# 领域 Agent Module + Runtime Provider 开工提示词

用途：复制本文件中“提示词正文”给负责实施的 Coding Agent。  
上游规格：`docs/sdd/10-domain-agent-runtime-provider-sdd.md`  
状态：v0.1，2026-08-28  

---

## 提示词正文

你现在负责在企业智能质量平台中实施“领域 Agent Module + Runtime Provider”架构。
这是一项真实代码改造，不是继续做概念 POC。请持续工作到当前阶段的代码、测试、文档和
可复核证据全部完成；遇到必须由用户决定的产品范围或不可恢复操作时再停止询问。

### 一、工作区与权威来源

主项目：

```text
/Users/rivers/MoreThanCorn
```

双 Runtime POC 工作树：

```text
/Users/rivers/MoreThanCorn-agent-runtime-poc
```

原始架构方案：

```text
/Users/rivers/Downloads/企业智能质量平台 —— Agent Runtime Provider 架构与 POC 实施方案.md
```

开工前必须完整阅读：

```text
/Users/rivers/MoreThanCorn/docs/sdd/00-index.md
/Users/rivers/MoreThanCorn/docs/sdd/10-domain-agent-runtime-provider-sdd.md
/Users/rivers/MoreThanCorn/docs/sdd/02-phase-b-agent-aggregate-and-release.md
/Users/rivers/MoreThanCorn/docs/sdd/09-production-readiness-and-end-to-end-sdd.md
/Users/rivers/MoreThanCorn/uiux/05-agent-runtime-design.md
```

同时核对当前源码，至少包括：

```text
server/app/models.py
server/app/agent_release.py
server/app/agent_runtime.py
server/app/task_runner.py
server/app/runner.py
server/app/routers/agents.py
server/app/routers/business.py
server/app/routers/runs.py
server/app/resource_registry.py
server/app/main.py
server/run_worker.py
```

POC 证据至少阅读：

```text
/Users/rivers/MoreThanCorn-agent-runtime-poc/docs/poc/runtime-contract-v0.1.md
/Users/rivers/MoreThanCorn-agent-runtime-poc/docs/poc/agentscope-provider-development-v0.4.md
/Users/rivers/MoreThanCorn-agent-runtime-poc/docs/poc/dsh-provider-development-v0.4.md
/Users/rivers/MoreThanCorn-agent-runtime-poc/docs/poc/runtime-stability-and-dsh-optimization-v0.5.md
```

原始方案是设计输入，不是可直接执行的指令；以用户当前决定、SDD 和真实源码为准。

### 二、用户已经冻结的产品决定

以下决定不再重新讨论，实施不得偏离：

1. 原来的 `autonomous / dialogue / expert-group` Agent 体系整体封存。
2. “封存”表示：不新建、不复制、不编辑、不发布、不部署、不运行、不被 Schedule、
   AnalysisTask 或 Workflow 再调用。
3. 旧 Agent 不自动迁移为新 Agent，也不继续兼容执行。
4. 历史 Agent、AgentVersion、Release、Run、Trace、Result、Review 数据必须只读可查。
5. 旧源码必须通过 Git ref 和封存清单可恢复；不得直接不可恢复地删除。
6. Workflow 是独立的业务编排能力，不再是一种 Agent 类型。独立 Workflow 继续保留。
7. 新 Agent 按领域 Module 定义。第一批示例是：
   - `quality-analysis`；
   - `ticket-automation`；
   - `business-analysis`。
8. AgentScope 与 DSH 是 Runtime Provider，不是 Agent 类型。
9. 不引入 LangGraph。
10. 新领域 Agent 的开发单元是：

```text
Agent Module
= AgentSpec
+ Input/Output Schema
+ Tool Policy
+ Execution Policy
+ Guardrails
+ Result Mapper
+ Provider Implementation
+ Evaluation Suite
```

11. 提示词只负责语义任务，代码负责阶段、工具权限、状态、重试、Barrier、幂等和安全。
12. 平台拥有 Task、Run、Tool、Master Data、Result、Scorecard、Review 和治理数据；
    Runtime Provider 只执行一个冻结的 AgentVersion。
13. 同一个 Provider-neutral AgentVersion 可以通过不同 Release Binding 交给 AgentScope 或 DSH。
14. 首期 AgentScope 是默认候选，DSH 是实验/对照 Provider；禁止自动跨 Provider fallback。

### 三、分支与工作树保护

先执行只读检查：

```bash
git status --short --branch
git log -5 --oneline
git branch --show-current
git worktree list
```

要求：

- 不在 `main` 上直接开发；
- 基于当前已同步的 `main` 创建：

```text
codex/domain-agent-runtime-provider
```

- 如果分支已存在，先核对其基线和状态，不得重建或覆盖；
- 不执行 `git reset --hard`、`git clean`、`git checkout -- <path>`；
- 不删除、覆盖或提交用户已有的无关修改；
- 当前已知用户文件 `scripts/view-final.mjs` 不属于本任务，必须保持原样；
- 不 push、不创建远程 PR，除非用户另行明确要求；
- 每阶段使用小而可审查的本地 commit；提交前展示 diff 摘要和测试证据。

如果创建分支会与当前未提交修改冲突，停止写操作，先给出准确冲突清单；不要自行 stash
用户文件。

### 四、Secret 与 POC 迁移红线

POC 工作树存在本地 `.env.local` 和隔离环境。迁移时严禁复制或提交：

```text
.env.local
.venv/
.pytest_cache/
__pycache__/
evaluation/results/
.artifacts/
DSH 本地 session/workspace
任何 API Key、Token、Cookie 或 Connection 明文
```

只能提交 `.env.example`，且全部为无效占位符。

开工和提交前都要执行敏感信息扫描。发现疑似 Secret：

- 不在终端输出完整值；
- 不把值写入报告；
- 只报告文件、变量名和是否已被 Git 跟踪；
- 停止提交该文件并清理本次新增副本；
- 不修改用户原始 POC `.env.local`。

POC 内容按白名单迁移，不允许整目录复制：

```text
允许评估迁移：
packages/runtime_contract 的源码和测试
packages/runtime_service 的源码和测试
runtimes/agentscope 的必要源码、配置和测试
runtimes/deepseek_harness 的必要源码、bundle、patch、配置和测试
质量 AgentSpec、JSON Schema、Master Data 示例
evaluation 的执行器、Ground Truth 与非结果数据
docs/poc 的技术证据

禁止迁移：
虚拟环境、缓存、构建产物、运行结果、本地密钥、本地 DSH home、临时 workspace
```

迁移后路径和 import 必须适配主项目，不能保留依赖 POC 工作树绝对路径的生产代码。

### 五、总体实施顺序

严格按以下阶段推进。每阶段完成后更新：

```text
docs/sdd/10-domain-agent-runtime-provider-sdd.md 的状态日志
阶段验收报告
测试命令与实际结果
已登记偏差/风险
```

不要同时大改所有层。先建立边界和测试，再接真实 Provider。

---

## Phase R-Archive：旧 Agent 只读封存

这是第一阶段，必须先完成。

### R-A1. 建立封存基线

1. 记录封存前 commit、数据库 migration head、旧 Agent 相关入口和测试。
2. 生成仓库内封存清单，例如：

```text
docs/archive/legacy-agents/manifest.md
```

清单至少列出：

- 旧 Agent 数据模型字段；
- 前端创建/编辑/运行入口；
- 后端 API；
- `agent_runtime.py` 旧执行器；
- Runner 中的 `agent/agent-select/agent-exec` 依赖；
- JobQueue 类型；
- Schedule、AnalysisTask、Workflow 引用；
- 历史查询与 Run Detail 路径；
- 相关测试；
- 封存 Git commit/ref。

3. 如果具备权限，创建本地封存 tag 或归档分支；如果需要修改远程状态，则只记录建议命令，
   等用户授权后再执行。

### R-A2. 封存行为

实现统一判定函数，例如：

```text
is_legacy_agent(agent_or_version)
assert_agent_executable(agent_or_version)
```

旧 Agent 的以下写/运行操作统一返回：

```json
{
  "code": "LEGACY_AGENT_ARCHIVED",
  "message": "该旧版 Agent 已封存，仅支持历史查询"
}
```

HTTP 状态使用 `410 Gone`。必须覆盖：

- create legacy agent；
- duplicate；
- update config；
- create version；
- create release；
- manual/API/schedule/batch run；
- Workflow `agent-exec`；
- retry/replay 中重新执行旧 Agent。

历史 GET 保留：

- Agent identity；
- AgentVersion；
- Release history；
- Run/RunEvent/CallRecord；
- Result/Evidence/Review。

### R-A3. 数据封存工具

不要在 migration 中无条件批量修改真实业务数据。实现一个可审计命令：

```text
默认 dry-run
显式 --apply 才修改
输出数量和 ID 摘要，不输出敏感内容
可重复执行
事务化
记录 AuditLog
```

它负责：

- 旧 Agent `archived=true`；
- 活跃 Release → `offline`；
- 引用旧 Agent 的 Schedule → `enabled=false`；AnalysisTask → `status=paused`；
- 输出引用旧 Agent 的 Workflow 节点清单，不自动改写 Workflow 图。

本地开发只运行 dry-run；除非用户明确授权，不对真实数据执行 `--apply`。

### R-A4. UI 封存

- 移除旧三类创建卡片和入口；
- 旧 Agent 详情显示“已封存，只读”；
- 隐藏保存、复制、发布、部署、运行按钮；
- 历史版本、运行、结果仍可查看；
- 独立 Workflow 页面不受影响；
- Workflow 发布校验必须阻止引用封存 Agent。

### R-A5. 封存验收

- 新旧所有入口都不能创建新的 Legacy Agent Run；
- 已有历史数据完整可查；
- 独立 Workflow 可以继续运行；
- 数据封存命令默认不会修改数据；
- 重复 dry-run 结果稳定；
- worker 不再注册旧 Agent 执行路径；
- 源码通过 Git ref/清单可恢复。

---

## Phase R0：合并公共 Contract 与 Runtime 服务骨架

### R0-1. 公共 Contract

迁入并生产化 POC `quality_runtime_contract`：

- strict Pydantic models，`extra=forbid`；
- `RuntimeExecuteRequest`；
- `RunAccepted`；
- `RuntimeRun`；
- `RuntimeInfo`；
- `RuntimeUsage`；
- `RuntimeError`；
- `TraceEvent`；
- `HealthStatus/ProviderCapabilities`；
- queued/running/succeeded/failed/cancelled 状态校验；
- 幂等冲突测试；
- output/error/finished_at 终态一致性测试。

保持平台业务模型不进入 Contract。

### R0-2. Runtime 目录

迁入两个独立服务：

```text
runtimes/agentscope
runtimes/deepseek_harness
```

要求：

- 与 FastAPI 主进程依赖隔离；
- 各自有独立 pyproject/lock/镜像边界；
- 不在主 server 进程 import AgentScope 或 DSH；
- POC `InMemoryRunService` 明确标记 dev/test，不作为生产恢复方案；
- health endpoint 必须真实检查 adapter、runtime/profile/bundle，而不是固定返回 ok。

### R0-3. POC 回归

先用 fake model/tool 跑离线测试；只有本地环境已正确提供 Secret 时才运行 real-model。
不得读取、打印或复制 `.env.local` 内容。

---

## Phase R1：Runtime Provider Registry 与 Gateway

### R1-1. 数据模型

按 SDD 增加：

```text
AgentRuntimeProvider
Release.runtime_provider_id
Release.runtime_profile
Release.runtime_binding_snapshot
Run.runtime_provider_id
Run.runtime_provider_run_id
Run.runtime_request_hash
Run.runtime_snapshot
CallRecord.run_id
```

要求：

- Runtime Provider 不与 ModelProvider 合表；
- Secret 只引用现有 Connection/Secret 管理；
- migration 可升级、可降级；
- `CallRecord.run_id` 使用先可空、回填、校验、再 NOT NULL 的安全迁移；
- 历史 `CallRecord` 通过 NodeRun 回填 Run；孤儿记录必须报告，不能静默丢弃。

### R1-2. Provider API

实现：

```text
POST /api/runtime-providers
GET  /api/runtime-providers
GET  /api/runtime-providers/{id}
PUT  /api/runtime-providers/{id}
POST /api/runtime-providers/{id}/probe
POST /api/runtime-providers/{id}/disable
```

API 遵守项目统一错误结构、RBAC 和 AuditLog。

### R1-3. Gateway Client

实现 provider-neutral：

```text
submit(request)
get_run(run_id)
cancel(run_id)
health()
```

必须有：

- 连接和读取 timeout；
- 有界重试；
- request hash；
- idempotency key；
- provider error 映射；
- response strict validation；
- PII/Secret 日志过滤；
- egress allowlist；
- fake provider integration tests。

### R1-4. 异步 worker

增加或等价实现：

```text
agent-runtime-submit
agent-runtime-poll
agent-runtime-cancel
```

不要让 poll 在 worker 中 sleep 数分钟。未终态时记录下次检查时间并释放 worker。
worker 重启后必须能根据 `Run.runtime_provider_run_id` 恢复查询，不能重新无条件 submit。

---

## Phase R2：Agent Module 框架与质检 Module

### R2-1. 新 Agent 数据模型

新增：

```text
Agent.module_key
Agent.module_version
```

采用 expand/contract：先可空以兼容历史封存行；新 Agent 必填。

目标 API 不再接受旧 `type` 作为产品类型：

```json
{
  "name": "服务热线质量分析 Agent",
  "moduleKey": "quality-analysis",
  "moduleVersion": "1.0.0"
}
```

### R2-2. Module Registry

实现：

```text
server/app/agent_modules/base.py
server/app/agent_modules/registry.py
server/app/agent_modules/quality_analysis/
```

Module 必须提供：

- manifest；
- Spec Schema；
- Input/Output Schema；
- request mapper；
- result mapper；
- policies；
- evaluator；
- Provider implementation compatibility metadata。

Registry 启动时发现重复版本、缺 Schema、缺实现、哈希不一致必须 fail fast。

### R2-3. AgentVersion 与 Release

扩展 `build_definition/freeze_dependencies/validate_publish`：

- 冻结 Module key/version；
- 冻结完整 AgentSpec；
- 冻结 Input/Output Schema 版本与 hash；
- 冻结 Tool/MCP/Model/MasterData/Knowledge 引用；
- 校验至少一个 Provider Implementation；
- artifact hash 覆盖全部快照。

Provider 选择不写入 AgentSpec，而在 Release 时绑定。

### R2-4. 质检 Module

从 POC 迁入 `quality-analysis`，保留真实验证过的阶段语义：

```text
identify
→ plan
→ execute
→ barrier
→ synthesize
```

必须支持：

- 多个消费者诉求；
- 多条知识陈述；
- 每条知识查询允许多轮 refinement；
- 多个不同类型的坐席承诺；
- 每个对象一个独立 Plan；
- 每个 Plan 独立状态、attempt 和错误；
- 代码 Barrier；
- 证据不足 fail closed；
- 总结阶段不再挂企业工具；
- 不由 Agent 计算最终质检分数。

### R2-5. AgentScope 实现

- Python 显式编排阶段；
- Identify Agent 不挂企业查询工具；
- Plan Builder 由代码生成结构体；
- 每个 Plan 只注册允许工具；
- 知识 Plan 支持有界多轮；
- Python 判断 completion barrier；
- facts/IDs/status/evidence 优先代码组装；
- 最终 output schema 二次校验。

### R2-6. DSH 实现

- 使用 source-built、固定版本的 SDK/Runtime；
- 使用版本化 profile + Cordis bundle；
- 每 Agent 独立 scoped state；
- fixed tool catalog；
- `tools.guard()` 按 stage/plan 拒绝越权；
- `quality_workflow_submit` 负责提交校验和状态转换；
- completion barrier 由插件代码判断；
- adapter 再校验 output schema；
- 生产禁用 `danger-full-access`；
- 不在运行时动态 clone 或安装插件。

---

## Phase R3：AnalysisTask、Run 与 QualityResult 闭环

### R3-1. AnalysisTask 执行目标

支持：

```text
execution_target_type = workflow | agent
```

新增 Agent target 字段，Workflow 字段改为条件可空，并增加数据库 Check Constraint。
兼容旧 Workflow task payload，但新响应统一返回 `executionTarget`。

### R3-2. TaskRun 冻结

增加：

```text
resolved_workflow_version_id
resolved_agent_version_id
resolved_release_id
runtime_binding_snapshot
```

TaskRun 启动时一次解析，分页、worker 重启和失败重试不得漂移到新版本。

### R3-3. 统一 Dispatcher

把 `task_runner.py` 对 `execute_run(run.id)` 的硬编码改成：

```text
resolve_execution_target
create Run
dispatch_execution
```

Workflow 走现有 Runner；Agent 走 Runtime Provider Gateway。

### R3-4. 结果事务

Provider 成功后：

1. 校验 lifecycle；
2. 校验 runtime metadata；
3. 校验 output schema；
4. 脱敏并持久化 Trace/CallRecord；
5. 调用 quality result mapper；
6. 写 Run output/usage/runtime snapshot；
7. 写 QualityResult/Evidence；
8. 应用冻结的 ResultRuleVersion；
9. Run succeeded；
10. 同一事务提交。

禁止出现 succeeded Run 没有 QualityResult；禁止重复轮询产生多个生效 Result。

### R3-5. Workflow 调用新 Agent

如保留 `agent-exec` 节点，它只能调用新 Module Agent：

```text
父 Workflow Run
→ agent-exec NodeRun
→ 子 Agent Run
```

领域 Agent 内部阶段只写子 Run Trace，不创建假的 Workflow NodeRun。

---

## Phase R4：UI、治理与生产门禁

实现最小产品面：

- Module Catalog；
- 新 Agent 创建与配置；
- AgentSpec/Schema/Tool Policy 展示；
- Provider/Runtime Profile Release 绑定；
- Provider health/capabilities；
- Run Detail 的 stage、calls、usage、runtime versions、evidence；
- AnalysisTask 选择 Workflow 或 Agent；
- 旧 Agent 只读封存页。

生产门禁：

- 真实脱敏 Golden Set；
- contract/conformance；
- batch stability；
- timeout/cancel/worker restart；
- model down/tool down/provider down/bad schema；
- PII/Secret/egress/RBAC/Audit；
- cost/token/P95；
- AgentScope canary；
- DSH 仅实验流量，除非另行通过晋级门槛。

---

### 六、架构不可违反项

实施过程中发现“更省事”的方式也不得违反：

- 不把领域 Agent 内部阶段做成平台 Workflow DAG；
- 不引入 LangGraph；
- 不让两个 Provider 使用不同公共 Spec、Schema、模型、工具或 Ground Truth；
- 不在主 API/worker 进程安装并 import 两套重 Runtime；
- 不把 ModelProvider 当 RuntimeProvider；
- 不把 Provider 私有字段写入公共 AgentSpec；
- 不把 Runtime 结果直接当可信业务结果，平台必须二次校验和映射；
- 不用 Prompt 代替 tool allowlist/guard；
- 不让 Agent 自由计算最终质检分数；
- 不自动跨 Provider fallback；
- 不把 POC 内存状态存储声称为生产恢复机制；
- 不把 fixture Tool Service 当生产数据源；
- 不对旧 Agent 做自动转换或自动重放；
- 不删除历史 Run/Result/Review；
- 不泄漏 Secret、PII 或完整工具响应到普通日志。

### 七、测试要求

每阶段至少补齐：

```text
unit tests
database migration tests
API contract tests
negative/security tests
worker lifecycle tests
idempotency tests
existing regression tests
```

质量 Module 额外要求：

- 多诉求；
- 多知识陈述；
- 多轮检索；
- 多承诺；
- 错工具被代码拒绝；
- 单 Plan 失败；
- barrier fail closed；
- invalid JSON/output schema；
- Provider timeout/cancel；
- MCP 断线；
- Ground Truth；
- 两 Provider 同 request hash。

基础门禁按仓库实际依赖执行，至少包括：

```bash
cd /Users/rivers/MoreThanCorn/server
python -m pytest tests -q

cd /Users/rivers/MoreThanCorn
npm run build
node scripts/verify-fullstack.mjs
git diff --check
```

如果仓库当前门禁命令已经变化，先从 package/CI/SDD 找到权威命令，在验收报告中说明替代，
不要静默跳过。

Real-model 测试只有在 Secret 已由环境安全提供时运行；没有 Secret 时报告
`provider_unavailable` 的真实结果，不得使用 mock 冒充成功。

### 八、实施过程沟通

开工时先向用户汇报：

1. 当前分支和工作树状态；
2. 发现的无关用户修改；
3. R-Archive 影响范围；
4. 本轮准备完成的具体阶段；
5. 不会执行的破坏性动作。

工作超过 60 秒时持续给出简短进度，但不要把中间状态说成完成。

遇到以下情况必须暂停并请求用户决定：

- 需要修改或删除真实生产数据；
- 需要 push、远程 tag、PR、部署或发布；
- 发现旧 Agent 仍有真实活动 Schedule/Release，封存会中断业务；
- 需要不可恢复地删除源码或历史记录；
- AgentSpec/数据结构需要改变已冻结业务含义；
- 首个写型工具的审批/补偿责任尚未确定。

以下情况不需要询问，可按 SDD继续：

- 只读源码审计；
- 新开发分支中的代码和测试；
- 可回滚 migration 代码；
- fake provider/tool 测试；
- 文档与验收报告；
- 不影响用户文件的格式化和 lint 修复。

### 九、每阶段交付格式

阶段结束时按下面格式汇报：

```text
阶段：R-Archive / R0 / R1 / R2 / R3 / R4
状态：完成 / 部分完成 / 阻塞

完成内容：
- ...

关键文件：
- 绝对路径 + 行号

数据模型/API 变更：
- ...

测试证据：
- 命令
- 通过数/失败数

未完成/偏差：
- ...

风险：
- ...

下一步：
- ...
```

所有“完成”必须有代码、测试或可复核命令证据；不要使用“应该可以”。

### 十、最终 Definition of Done

全部实施完成时必须证明：

1. 旧三类 Agent 已只读封存，不能产生新 Run，历史数据可查且源码可恢复；
2. 新 Agent 只按领域 Module 创建；
3. 同一 AgentVersion 可分别绑定 AgentScope/DSH，而不修改业务 Spec；
4. 质检 Module 在两个 Provider 上通过公共 Contract、Schema 和 Ground Truth；
5. AnalysisTask 可以直接选择 Agent，不需要伪造 Workflow；
6. Workflow 仍可独立运行，并可把新领域 Agent 作为一个节点调用；
7. 一次 Agent execution 只有一条平台 Run；
8. Runtime/Adapter/Module/Schema/Tool/Model/Rule/DataDefinition 版本全链路可追溯；
9. Trace、CallRecord、token、duration、evidence 可在 Run Detail 查询；
10. 质检结果由 Result Mapper 落库，评分由平台规则引擎派生；
11. 工具权限由代码和 Tool Gateway 控制，不依赖提示词；
12. worker 重启、重复 submit/poll、timeout、cancel 不产生重复结果；
13. Secret/PII/egress/RBAC/Audit 通过负向测试；
14. 原项目完整测试和构建门禁全绿；
15. SDD 状态日志、验收报告、变更记录和本地 commits 完整。

现在开始：先执行只读基线检查，完整阅读权威文件，输出一份基于当前源码的
R-Archive 影响清单和分阶段实施计划；随后在非 `main` 分支按上述顺序实施。不要先复制
POC 整个目录，不要接触 `.env.local`，不要跳过旧 Agent 封存阶段。
