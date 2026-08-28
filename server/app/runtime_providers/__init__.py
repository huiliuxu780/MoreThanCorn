"""Runtime Provider 平台侧集成（SDD 10 R1）。

- contract：Provider-neutral 协议来自 packages/runtime_contract（独立内部包，主进程
  只 import 协议，绝不 import AgentScope/DSH 运行时本体）；
- client：Provider-neutral Gateway（超时/有界重试/幂等/严格校验/错误映射/日志过滤/Egress）；
- registry：Provider 行 → Gateway 构建与健康探测；
- dispatcher：Run → RuntimeExecuteRequest 组装；
- worker：agent-runtime-submit / poll / cancel 三类 JobQueue 任务；
- trace_mapper：Provider TraceEvent → 平台 RunEvent（R1 最小映射）。
"""
