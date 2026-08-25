---
kind: external_dependency
name: 后端 Web 框架：FastAPI + CORS
slug: fastapi
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
---

项目后端以 FastAPI 作为 Web 框架，通过 `server/app/main.py` 启动应用并启用 `CORSMiddleware`；路由按业务域拆分到 `routers/{admin,agents,business,registry,resources,runs,workflows}.py`。数据库迁移使用 Alembic（`server/alembic/versions/*`），运行时由 `runner.py` 的 worker 进程异步执行工作流节点。该框架在本项目中仅承担 HTTP 接口与中间件能力，无额外第三方认证或网关集成。