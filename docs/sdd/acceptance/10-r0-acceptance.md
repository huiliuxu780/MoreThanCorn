# Domain Agent Runtime Provider — Phase R0 验收记录

日期：2026-08-28
分支：`codex/domain-agent-runtime-provider`
阶段状态：完成（待用户验收）

## 1. 本阶段范围

Phase R0 只迁入公共 Runtime Contract、共享服务骨架、两个隔离的 Runtime Provider
以及可复现的 POC 证据，不连接平台业务流量，不恢复已封存的旧 Agent 执行入口。

迁入内容：

- `packages/runtime_contract`：Provider-neutral 严格协议模型；
- `packages/runtime_service`：供 Provider 适配器复用的开发/契约测试服务骨架；
- `runtimes/agentscope`：AgentScope 独立服务、原生编排、健康检查和测试；
- `runtimes/deepseek_harness`：DSH 独立服务、Cordis Plugin/Bundle、权限边界和测试；
- `poc/agent_runtime_providers`：AgentSpec、Schema、脱敏合成数据、离线评测与构建脚本；
- `docs/poc`：双 Runtime POC 过程、结果和开发说明。

明确未迁入：

- `.env.local`、真实 Secret；
- POC `.venv`、缓存、运行结果、临时状态和构建产物；
- POC Tool Service 生产部署；
- 任何 Provider Registry、Gateway、数据库迁移或业务流量接入。

## 2. 边界验收

- 五个 Python 项目均有独立 `pyproject.toml` 和 `uv.lock`；
- AgentScope 与 DSH 各有独立 Dockerfile、启动说明和 `.env.example`；
- FastAPI 主服务不 import AgentScope 或 DSH；
- Contract 不含平台 Task、Result、Scorecard、Review 等业务模型；
- `InMemoryRunService` 明确限定为开发与契约测试实现，不承诺生产恢复；
- Provider health 会真实检查 adapter、runtime package/profile/bundle、模型凭据和
  DSH 权限模式，不会固定返回健康；
- DSH 不再默认启用 `danger-full-access`，非开发/测试环境会拒绝该配置；
- 未提供模型凭据时，Provider 正确报告 `degraded`，而不是伪报 `ok`；
- `scripts/verify-runtime-r0.py` 对依赖边界、危险默认值、Secret 文件和交付文件做机械门禁。

## 3. 测试证据

| 门禁 | 结果 |
| --- | --- |
| Runtime Contract | 5 passed |
| Runtime Service | 7 passed |
| AgentScope adapter/native workflow/health | 8 passed |
| DSH adapter/Cordis bundle/permission/health | 8 passed |
| POC evaluation | 9 passed |
| R0 Python 小计 | **37 passed** |
| 五个 `uv lock --check` | PASS |
| DSH Cordis Plugin `node --check` | PASS |
| Python `compileall` | PASS |
| `scripts/verify-runtime-r0.py` | PASS |
| 后端 `pytest tests -q` | **245 passed** |
| 前端 typecheck / lint / build | PASS / PASS / PASS |
| `git diff --check` | PASS |

`verify-fullstack` 为 38/49；S13 封存契约全部通过。其余 11 项失败为
`S2-3、S4-2、S5-2、S5-4、S7-4、S8-1、S10-1、S10-2、S10-4、S11-3、S11-7`，
与 R-Archive 验收时在 main 对照服务上确认的存量失败集合完全一致，R0 未触碰这些资源类路径。

## 4. 环境限制与后续项

- 本机没有 Docker CLI，因此本阶段完成了 Dockerfile、独立 context 和锁文件检查，
  但没有声称镜像已构建；镜像构建应进入 CI。
- DSH 当前锁定官方 PyPI 基线 `0.1.1rc1`。POC 验证过的源码构建版 `0.1.2a1`
  不携带可提交的官方制品，须在 Phase R2 前通过内部构建和制品仓库固定摘要后晋级。
- 未运行真实模型和真实工具测试，也未读取 `.env.local`；本阶段只要求离线契约回归。
- 没有执行数据封存工具的 `--apply`，没有 push、远程 tag、PR 或业务流量切换。

## 5. 验收结论

Phase R0 的“结构合并、不接业务流量”目标已完成。公共协议和两个 Provider 服务已进入
原项目并形成独立依赖边界，旧 Agent 仍保持封存；可以在用户验收后进入 Phase R1，
实现 Provider Registry、Gateway 及 fake provider 生命周期闭环。
