---
kind: error_handling
name: 后端 RunError + HTTPException 与前端 useAsyncData 统一错误处理体系
category: error_handling
scope:
    - '**'
source_files:
    - server/app/runner.py
    - server/app/agent_runtime.py
    - server/app/resource_tests.py
    - server/app/main.py
    - server/app/routers/admin.py
    - server/app/routers/runs.py
    - server/app/routers/agents.py
    - server/app/schemas.py
    - src/hooks/use-async-data.ts
    - src/services/wf-api.ts
    - src/services/resource-api.ts
    - src/config/ui-terms.ts
    - src/domain/types.ts
---

## 1. 整体方案

本仓库采用“后端领域异常 + FastAPI HTTP 异常 + 前端统一 Hook”的分层错误处理模式：
- 后端核心执行引擎（runner/agent_runtime/resource_tests）通过自定义 `RunError` 表达业务运行期失败；路由层捕获后转为 `HTTPException`，由 FastAPI 自动序列化为 JSON。
- 鉴权、CORS、健康检查等横切逻辑集中在 `main.py` 的中间件与生命周期中，未定义全局异常处理器，依赖 FastAPI 默认行为。
- 前端通过 `src/hooks/use-async-data.ts` 提供 Loading/Error/Retry 三态统一状态，所有页面 API 调用经 `services/wf-api.ts`、`services/resource-api.ts` 包装为 Promise，统一在 `.catch` 中转换为 `Error` 抛出。

## 2. 关键文件与位置

| 层级 | 文件 | 职责 |
|---|---|---|
| 后端核心异常 | `server/app/runner.py` | 定义 `class RunError(Exception)`，DAG 执行器抛出的业务错误均为此类型 |
| Agent 运行时 | `server/app/agent_runtime.py` | 调用 `raise RunError(...)` 表达子工作流失败、工具无版本、Agent 不存在、递归调用、缺少 agentCode 等场景 |
| 资源测试 | `server/app/resource_tests.py` | 对知识检索、MCP 调用等外部依赖失败封装为 `RunError` |
| 路由层 | `server/app/routers/*.py` | 使用 `from ..runner import RunError` 捕获业务异常，再 `raise HTTPException(404/409, ...)` 返回 REST 语义 |
| 应用入口 | `server/app/main.py` | 注册 RBAC Bearer Token 鉴权中间件（401）、CORS、路由挂载、`/healthz` |
| 前端数据 Hook | `src/hooks/use-async-data.ts` | 统一 `data/loading/error` 三态，`.catch` 将未知错误归一为字符串 message |
| 前端 API 服务 | `src/services/wf-api.ts`、`resource-api.ts` | 统一 `req()` 包装，非 2xx 时构造 `Error` 并附带 `res.status` 与 body.detail |

## 3. 架构与约定

### 3.1 后端异常分层

1. **领域异常**：`runner.RunError` 是执行层的唯一业务异常类型。所有节点 executor（LLM、tool、workflow-exec、agent-select/exec、knowledge-retrieval、mcp-call 等）遇到配置缺失、资源不存在、下游调用失败等情况一律 `raise RunError("..." )`。
2. **路由捕获**：路由函数内 try/catch `RunError`，将其转为 `HTTPException(status_code, detail)`。例如 `routers/admin.py` 中对连接/工具/工作流/定时任务/Agent 的 CRUD 操作，找不到即 404，被引用即 409。
3. **Worker 兜底**：`agent_runtime.execute_agent_job` 最外层 `except Exception as exc` 捕获一切未预期异常，回滚事务并将 run 标记为 `failed`，写入 `run.error.message = str(exc)`，同时 emit `agent_failed` 事件。这是“运行期错误不中断进程”的强制保障。
4. **降级策略**：`_route` 中 LLM 路由失败 `except Exception` 直接返回 `(None, "route_error")`，让后续逻辑走 fallback Agent，体现“局部失败不阻断整体流程”的设计。
5. **FastAPI 默认错误**：Pydantic 校验失败、未捕获异常均由 FastAPI 默认异常处理器输出 JSON，无需额外注册。

### 3.2 前端错误处理

1. **useAsyncData Hook**：每个页面通过 `useAsyncData(loader, deps)` 获取 `{ data, loading, error, retry }`。loader 内部 `.catch` 将任意 `err` 归一化为 `error: err instanceof Error ? err.message : "加载失败"`，并提供 `retry` 触发重新加载。
2. **API 服务层**：`wf-api.ts` 与 `resource-api.ts` 的 `req()` 方法统一处理响应：非 2xx 时解析 body（`res.json().catch(() => null)`），构造 `Error(`${res.status}: ${JSON.stringify(body?.detail ?? body)}`)` 抛出，使上层统一 catch。
3. **Mock 兼容**：`mock-service.ts` 模拟相同接口形态，保证开发/联调阶段错误路径一致。
4. **UI 展示**：`config/ui-terms.ts` 将 `Error` 映射为中文文案“异常”，`domain/types.ts` 中 `ExecutionStatus` 包含 `ERROR`，`summary.error` 字段统计失败次数，`errors[]` 记录按 type 聚合的错误列表。

### 3.3 运行期错误持久化

- `Run` 模型字段 `status`（queued/succeeded/failed/skipped）、`error`（`{message: string}`）、`ended_at` 构成统一的运行结果契约。
- `NodeRun` 同样携带 `status`、`error`、`attempt`，用于 DAG 中每个节点的细粒度错误追踪。
- `RunEvent` 以单调 sequence 记录 `agent_started/agent_completed/agent_failed/tool_call/tool_result` 等事件，SSE 端通过 Last-Event-ID 重放。

## 4. 约定与约束

- **业务错误必须用 `RunError`**：所有节点 executor 和 agent_runtime 中的业务失败路径均 `raise RunError(...)`，禁止直接抛普通 `Exception`，以便路由层统一捕获。
- **路由层禁止吞掉 `RunError`**：路由中捕获 `RunError` 后必须转为 `HTTPException` 返回给客户端，不得静默忽略。
- **Worker 必须兜底**：`execute_agent_job` 的 `except Exception` 块不可移除，确保任何未预期异常都会将 run 标记为 failed 并写库，防止僵尸运行。
- **降级优先于中断**：如 `_route` 中 LLM 路由失败降级到 fallback Agent，体现“单点故障不阻断整体流程”的原则。
- **前端统一错误形态**：页面组件不应自行管理 loading/error 状态，应通过 `useAsyncData` 获取，保证 UI 一致性。
- **API 错误必须带 status**：`wf-api.ts` 的 `req()` 抛出的 `Error` 必须包含 HTTP 状态码，便于上层区分 4xx/5xx。
- **RBAC 中间件强制**：当设置环境变量 `WF_API_TOKEN` 时，所有 `/api/*` 请求必须携带 `Authorization: Bearer <token>`，否则返回 401。
- **CORS 仅允许本地开发**：`main.py` 中 `allow_origins` 固定为 `localhost:5173`，生产部署需调整。

## 5. 适用性说明

该错误处理体系覆盖后端执行引擎、Agent 运行时、资源测试、REST 路由以及前端数据加载全链路，属于高置信度的完整实现。