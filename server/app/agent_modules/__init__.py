"""领域 Agent Module 框架（SDD 10 R2）。

Module = Provider-neutral AgentSpec + Input/Output Schema + Tool Policy + Execution Policy
+ Guardrails + Result Mapper + Provider Implementation + Evaluation Suite。
本包只承载平台侧 Module 资产与注册表；两个 Runtime 的原生实现分别在
runtimes/agentscope 与 runtimes/deepseek_harness（禁止被主进程 import）。
"""
