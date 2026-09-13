# 发布包与部署（09-SDD P1-11）

可复现发布：依赖锁定 + 镜像 + 环境变量 Schema + 迁移/启动命令 + Feature Flag。

## 1. 依赖锁定

- 后端：`server/requirements.txt`（`pip freeze` 固定版本）。更新后必须提交锁文件。
- 前端：`package-lock.json`（npm ci 安装）。

## 2. 镜像

```bash
# 构建（后端 API）——09-13 审计修复（P0-3）：上下文必须是仓库根，
# 因 server/requirements.txt 引用 ../packages/runtime_contract（旧命令必然构建失败）。
# 注意：截至 09-13 本机无 Docker，该修复为静态验证，首次真实构建前不得宣称镜像可用。
docker build -t morethancorn-api:<tag> -f server/Dockerfile .

# 前端静态产物
npm ci && npm run build   # 产出 dist/，由任意静态服务器托管
```

> Worker/Scheduler 与 API 同镜像（见 §4 进程模型）。多实例部署时 Worker 可水平扩展，
> Scheduler 需单实例或选主（09 §6.8；当前为单实例）。

## 3. 环境变量 Schema（.env.prod）

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `WF_ENV` | 是 | development | `production` 启用生产门（拒绝 mock、强制鉴权、缺密钥拒启） |
| `WF_DATABASE_URL` | 是 | — | PostgreSQL DSN（`postgresql+psycopg://user@host:5432/db`） |
| `WF_SECRET_KEY` | 生产必填 | — | Fernet 密钥；生产缺失则拒绝启动（09 P0-11） |
| `WF_ADMIN_PASSWORD` | 生产建议 | admin | 迁移 g033 种子 admin 账号口令 |
| `WF_AUTH` | 否 | 生产恒开 | `on` 强制鉴权（生产自动启用） |
| `WF_CORS_ORIGINS` | 生产建议 | — | 逗号分隔允许域名（生产必填，默认拒绝跨域） |
| `WF_CODE_NODE` | 否 | 关 | `on` 才启用 Code Node（默认禁用，09 P0-11） |
| `WF_LLM_BASE_URL` / `WF_LLM_API_KEY` | 否 | — | 真实 LLM（OpenAI 兼容）；缺失时生产 LLM 调用失败关闭 |
| `WF_PAR_RUN` | 否 | 4 | Run 内节点并发度 |

## 4. 迁移与启动命令

```bash
# 迁移（部署前执行；唯一 head，含 upgrade 与 downgrade）
alembic upgrade head          # 升级
alembic downgrade -1          # 回滚一级

# 启动 API（生产默认：embedded worker 关，watcher 开）
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

进程模型（09-13 审计修复：文档与代码行为对齐，原文"随 lifespan 启动"表述漂移）：

| 进程 | 控制变量 | 生产默认 | 说明 |
| --- | --- | --- | --- |
| API | — | 启动 | uvicorn 主进程 |
| Worker（Run/TaskRun 执行） | `WF_EMBEDDED_WORKER` | **off** | 生产默认不随 API 启动；当前**无独立 worker 入口**，需要时同容器置 `on` 随 lifespan 启动。独立 Worker 容器/入口 = 部署切片欠账（登记） |
| Watcher（对账/轮询/重试/结算） | `MTC_WATCHER` | **on** | 随 API 进程启动；多实例由 watcher 锁互斥（`_try_acquire_watcher_lock`），只有一台实际执行 |
| Scheduler（AgentScope 侧） | 运行时进程 | 随 8301 | 平台不内嵌；见 runtimes/agentscope 部署说明 |

启动自检：`GET /healthz`（存活）、`GET /readyz`（依赖就绪：DB+迁移+队列）。

## 5. Feature Flag（09 §17.4 未完成功能处置）

| Flag | 默认 | 说明 |
| --- | --- | --- |
| Code Node | 关 | `WF_CODE_NODE=on` 启用；默认禁用（安全） |
| 质量总览细分聚合 | 部分空态 | 无数据板块真实空态，不造假（09 P1-03） |
| MCP stdio / Knowledge 无后端 | 禁用/失败关闭 | 生产禁止 mock 回落 |

未完成/降级模块遵循 09 §17.4：从生产移除、或 Feature Flag 禁用返回 `FEATURE_DISABLED`、或明确标注 Beta。

## 6. 发布检查

```bash
node scripts/check-release.mjs   # 校验发布包完整性（锁文件/镜像/文档/单一迁移 head）
```
