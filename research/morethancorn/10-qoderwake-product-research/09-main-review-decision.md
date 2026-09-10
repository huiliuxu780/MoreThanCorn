# 09 · 主审计结论的撤回与纠偏记录

> 日期：2026-09-08
> 状态：`SUPERSEDED_HISTORY_ONLY`
> 现行决定：见 `10-agentscope-native-adoption-and-replica-decision.md`

## 1. 保留的研究结论

- QoderWake 页面、路由、字段和截图观察仍可作为产品复刻证据。
- MoreThanCorn 当前代码断链、双事实源、mock/fixture 和旧 Provider 残留的审计仍有效。
- AgentScope 当前实际安装为 2.0.7；2.0.8 Pipeline 只存在于固定官方开发提交的结论仍有效。
- 事件 union 计数修正、凭据脱敏和相关证据纠错继续有效。

## 2. 撤回的架构决定

以下旧决定经过用户追问和 AgentScope app 源码复核后确认错误，现全部撤回：

1. 一期只使用 AgentScope 库层，关闭 ChatService/storage/scheduler/knowledge app 服务。
2. 平台拥有 Session、AgentState、消息、调度和 Agent 事件事实。
3. 无状态任务不创建 AgentScope Session。
4. 非 Chat AgentState 由平台 ExecutionState/RuntimeCheckpoint 保存。
5. 所有 AgentScope 执行都复制成平台 Run/RunEvent。
6. 平台自建 QualityPipeline/AgentFlow Runner 已经获得批准。
7. 既有 Runtime Provider Contract 是 AgentScope 生产接入的正确边界。

错误根因是：把“AgentScope 是唯一底座”错误理解成“保留平台运行时，只把 AgentScope 当一个 Provider”。

## 3. 新结论

- AgentScope app 原生对象和服务是 Agent 运行时唯一真相源。
- 无状态 Schedule 每次创建 fresh Session；有状态 Schedule 复用 Session。
- AgentScope 已有能力不重造，未有能力先登记缺口。
- QoderWake 任务/自动任务只复刻已观察产品行为，不复制私有 API 或猜测后台规则。
- 现有 Workflow 保留；AgentFlow 等待 2.0.8 Pipeline app 集成 spike。
- 观测只采用实际验证的 Session API、AgentEvent、TracingMiddleware 和 OTel backend 数据。

## 4. 当前判定

```text
研究证据：可继续使用
旧架构提案：拒绝
主设计稿：正在重写
产品代码：继续冻结
P0：未授权
```
