# Agent Runtime Provider POC

这个目录用于在不改动平台业务模型的前提下，对比 AgentScope 与 DeepSeek
Harness 两个 Runtime Provider。两边共享：

- 一份 Agent Spec；
- 一套输入、输出 JSON Schema；
- 一套 Master Data；
- 同一个 Tool Service；
- 同一条 Runtime Contract 和请求体；
- 同一套 15 条全合成 smoke 数据与 Ground Truth。

Runtime 只负责编排、模型调用、Tool 调用和 trace。质检 Task、Result、Review、
Scorecard 以及最终评分仍属于平台层。

## R0 迁入状态

本目录保留已脱敏的 Spec、Schema、Master Data、合成数据和评测器，作为后续 R2
领域 Module 的 conformance fixture。生成结果、虚拟环境、DSH 二进制和 `.env.local`
均未迁入。

R0 不接真实平台流量，也没有把 POC Tool Service 当成生产服务。离线测试不需要
模型密钥或 Tool Service；真实模型对比要等 R2 接入 dev/test Tool Gateway 后再启用。

## 本地入口（R2 接好 dev/test Tool Gateway 后）

在仓库根目录设置本地环境变量（真实密钥不要写入文件或提交）：

```bash
export QUALITY_MODEL_API_KEY='...'
export QUALITY_MODEL_ID='...'
# 使用兼容端点时再设置：
export QUALITY_MODEL_BASE_URL='...'
```

启动两个独立 Runtime（Tool Gateway 地址由环境提供）：

```bash
uv run --project runtimes/agentscope --frozen \
  uvicorn app.main:app \
  --app-dir runtimes/agentscope --host 127.0.0.1 --port 8301

uv run --project runtimes/deepseek_harness --frozen \
  uvicorn app.main:app \
  --app-dir runtimes/deepseek_harness --host 127.0.0.1 --port 8302
```

先跑单条 Case A：

```bash
uv run --project poc/agent_runtime_providers/evaluation --frozen \
  python \
  -m quality_runtime_evaluation.run_comparison \
  --sample-id SMOKE-A01
```

不传 `--sample-id` 会依次运行全部 15 条。结果写入本地 `evaluation/results/`
且默认不进 Git。每条样本保存唯一的 `request_sha256`，两个 Provider 收到的
请求体完全相同。

## 当前门禁

没有 `QUALITY_MODEL_API_KEY` 时两个 Provider 都会接收请求，然后以统一的
`provider_unavailable` 结束；不会调用 mock 模型。真实 A/B/C 对比需要先配置
同一模型、端点和参数。

## v0.2 原生编排验证

v0.1 的 15 条 batch 比较的是每个 Runtime 各自的一次自治 Agent loop。v0.2
另外验证多诉求、多轮知识检索、多承诺、分计划工具约束和完成屏障，避免把共享
外置状态机误当成 Provider 原生能力。

- AgentScope 实现：`runtimes/agentscope/app/native_workflow.py`
- DSH Cordis 插件草案：`runtimes/deepseek_harness/plugins/native_quality_workflow.mjs`
- 结果与当前限制：`docs/poc/native-orchestration-results-v0.2.md`

## v0.3 DSH 源码 Runtime

PyPI 当前仍只有 `0.1.1rc1`。POC 已从 DSH 官方 `dsh-v0.1.2-alpha.1`
构建配套 SDK/Runtime wheels，并通过官方外部 profile 插件黑盒用例。源码构建
脚本、产物保存策略和插件 bundle 迁移说明见：

- `poc/agent_runtime_providers/scripts/build_dsh_source_runtime.sh`
- `docs/poc/dsh-source-runtime-results-v0.3.md`
- `runtimes/deepseek_harness/plugins/package.json`
- `runtimes/deepseek_harness/plugins/cordis.patch.yml`

## 双 Provider 开发方案

- 总纲：`docs/poc/agent-runtime-provider-development-guide-v0.4.md`
- AgentScope：`docs/poc/agentscope-provider-development-v0.4.md`
- DeepSeek Harness：`docs/poc/dsh-provider-development-v0.4.md`
- 5 次稳定性与 DSH 压缩结果：`docs/poc/runtime-stability-and-dsh-optimization-v0.5.md`
