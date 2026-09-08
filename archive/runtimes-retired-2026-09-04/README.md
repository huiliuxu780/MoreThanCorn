# 归档：退役运行时（2026-09-04 用户拍板）

本目录存放已决定下线的两个 Runtime Provider 服务，**只归档、不再使用、不再演进**。

| 目录 | 原位置 | 状态说明 |
|---|---|---|
| `deepseek_harness/` | `runtimes/deepseek_harness` | DSH 运行时（Cordis harness + Python adapter）。**其 `plugins/native_quality_workflow.mjs` 与 `plugins/native_business_analysis.mjs` 是阶段状态机/工具 guard/屏障的行为蓝本**——在 AgentScope 侧完成移植（docs/v2-design/05 轨道 B1/B2）并通过真实通话回归之前，这两个文件是唯一的行为参考，请勿删除本归档。 |
| `openai_agents/` | `runtimes/openai_agents` | OpenAI Agents SDK 运行时（SDD-14 POC）。**重要事实：该服务源码从未入过 git**（`git ls-files` 为 0），目录内仅剩 `.venv`、`.pytest_cache` 与 `app/__pycache__` 字节码（9 个模块的 .pyc）。SDD-14 的验收结论（20/20、3/3、57/57）真实发生过，但实现代码已不在仓库与磁盘源码形态中——本目录留作"曾运行"的物证。 |

决策记录：`docs/v2-design/00-overview.md`（09-04 拍板：Agent 运行时只留 AgentScope）、`docs/v2-design/05-agent-management-redesign.md` §6 轨道 B。

注意：`runtimes/deepseek_harness` 原有 20 个文件被 git 跟踪，本次为文件系统移动（未提交），`git status` 会显示为 deleted + 本目录 untracked；提交时机与方式由用户决定。
