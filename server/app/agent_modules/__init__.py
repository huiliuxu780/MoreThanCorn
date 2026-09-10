"""领域 Agent Module 框架（SDD 10 R2）。

Module = Provider-neutral AgentSpec + Input/Output Schema + Tool Policy + Execution Policy
+ Guardrails + Result Mapper + Provider Implementation + Evaluation Suite。
本包只承载平台侧 Module 资产与注册表；Runtime 原生实现在 runtimes/agentscope
（唯一底座，禁止被主进程 import）。deepseek-harness 运行时已于 09-04 退役删除。
"""
