# DSH wheel 升级与源码 Runtime 验证 v0.3

日期：2026-08-28
POC 分支：`codex/poc-agent-runtime-providers`

## 结论

- PyPI 上 `deepseek-harness-sdk` 与 `deepseek-harness-runtime-bin` 的最新版仍是 `0.1.1rc1`，因此没有可直接升级的已发布 wheel。
- DSH 官方源码已推进到 `0.1.2-alpha.1`。本机从官方 tag `dsh-v0.1.2-alpha.1` 成功构建 macOS ARM64 Runtime，并生成配套的两个 `0.1.2a1` wheels。
- 官方 installed-wheel `sdk-profile-plugin` 黑盒用例通过。它在 checkout 外的干净 Python 3.12 venv 中，用 `dsh plugin --profile sdk add file:...` 安装外部 bundle，验证外部插件与 Runtime 使用同一 Cordis 实例，并完成一次模拟模型请求。
- POC 自己的 `morethancorn-dsh-native-quality-workflow` bundle 也已安装到隔离 `sdk` profile；连接现有质量 MCP、发现 4 个企业工具并完成 SDK Runtime 初始化，未再出现 `cannot create effect on inactive context`。
- Adapter 迁移到新版 profile API 后，复杂合成样本 `NATIVE-V02-001` 已完成一次真实模型执行，结果为 `succeeded`，全部业务结论与 Ground Truth 一致。
- 因而 v0.2 中的阻塞应收窄为：**PyPI 的 `0.1.1rc1` 单文件 Runtime 不能承载本 POC 的本地插件；新版官方源码构建链已经能承载外部插件。** 这不是 DSH 架构永久不支持，而是已发布 wheel 落后于源码能力。

## 已验证版本与产物

| 项目 | 结果 |
|---|---|
| PyPI SDK 最新版 | `0.1.1rc1` |
| PyPI Runtime wheel 最新版 | `0.1.1rc1` |
| 官方源码 tag / commit | `dsh-v0.1.2-alpha.1` / `cd5ef8148158c3a752a658978873241fdf8e2bbc` |
| 源码版本 | `0.1.2-alpha.1` |
| 构建 Node | `24.19.0`；构建器封装 Node `24.20.0` |
| Runtime executable | `deepseek-harness-sdk-runtime-macos-arm64`，约 248.4 MB |
| Runtime wheel | `deepseek_harness_runtime_bin-0.1.2a1-py3-none-macosx_14_0_arm64.whl`，约 69 MB |
| SDK wheel | `deepseek_harness_sdk-0.1.2a1-py3-none-any.whl` |
| 外部插件黑盒用例 | `smoke-python-runtime: sdk-profile-plugin passed` |
| 质量工作流插件初始化 | `quality-plugin-runtime-initialize: passed` |
| 完整复杂场景 | `succeeded`，5/5 plans completed，barrier passed |

本次保存的 wheel SHA-256：

- Runtime：`24b8ba4d5f0affb316dd392b3706e37711b72aa8e52ef6824436e1c373e9c7dd`
- SDK：`bc932637efcbac3c70110031ffcee1225860368a7acae214a4d682b049925c25`

本地大体积产物放在 `poc/agent_runtime_providers/.artifacts/`，由 `.gitignore` 排除。仓库只保存可复现脚本与插件源码，避免把平台相关的 70～250 MB 二进制提交到 Git。

## POC 插件迁移

`runtimes/deepseek_harness/plugins/` 已改造成 DSH 新版可安装 bundle：

- `package.json` 声明 `dsh.bundle.patch`；
- `cordis.patch.yml` 安装质量 MCP client 与 `native_quality_workflow.mjs`；
- profile 通过 `dsh plugin --profile sdk add file:<absolute-plugin-dir>` 持久化安装；
- 运行时只需显式 `DSH_HOME`，普通启动不依赖系统 Node 或 pnpm；只有安装/更新插件时需要 pnpm。

官方最小插件已经完成真实黑盒验证。质量工作流 bundle 的打包、MCP 发现、
agent-scope 初始化与完整五计划真实模型执行均已验证。新版 adapter 自动识别
`dsh_home + profile + patches` API，并保留 `cordis + session_root` legacy 路径。

本次真实模型结果：消费者诉求 5 项；两条知识结论分别为 `accurate` 与
`inaccurate`，各进行了 2 轮查询；三项承诺分别为 `fulfilled`、`unfulfilled`、
`mismatched`；5/5 plans completed，barrier passed。共 16 次模型调用、7 次企业
工具调用、8 次阶段提交工具调用，总 token 91,460。业务正确性通过，但调用次数和
上下文成本需要下一轮优化，并进行 10～20 次稳定性跑批。

## 复现

在 POC worktree 根目录运行：

```bash
poc/agent_runtime_providers/scripts/build_dsh_source_runtime.sh
```

脚本默认固定官方 `dsh-v0.1.2-alpha.1`，要求 Node `>=22.19`、pnpm 与 Python `>=3.10`。可通过 `DSH_SOURCE_REF`、`DSH_SOURCE_DIR`、`DSH_ARTIFACT_ROOT` 和 `DSH_PYTHON` 覆盖。

## 回归结果

- 官方 `sdk-profile-plugin` installed-wheel smoke：通过；
- POC 质量 MCP + 业务 bundle Runtime initialize：通过；
- POC 完整复杂场景真实模型运行：通过；
- POC Python 单测：`37 passed`；
- `git diff --check`、bundle `package.json` 解析与构建脚本语法检查：通过；
- 所有本地服务均已停止。

## 官方依据

- [DSH Python SDK on PyPI](https://pypi.org/project/deepseek-harness-sdk/)
- [DSH Runtime wheel on PyPI](https://pypi.org/project/deepseek-harness-runtime-bin/)
- [DSH official repository](https://github.com/deepseek-ai/deepseek-harness)
- [Runtime carrier build reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk-runtime/README.md)
- [Package and install a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
