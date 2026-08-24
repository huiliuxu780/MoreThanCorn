---
kind: external_dependency
name: HTTP 客户端：httpx（调用外部 LLM/工具端点）
slug: httpx
category: external_dependency
category_hints:
    - sdk_real_api
scope:
    - '**'
---

后端通过 `httpx` 发起对外部 LLM 提供商及工具服务的 HTTP 调用，在 `agent_runtime.py` 和 `runner.py` 中分别用于 Agent 运行时的远程推理与节点执行。Secrets（如 API Key）通过 Connection/KnowledgeSource 模型持久化后解密传入，不应在代码中硬编码。