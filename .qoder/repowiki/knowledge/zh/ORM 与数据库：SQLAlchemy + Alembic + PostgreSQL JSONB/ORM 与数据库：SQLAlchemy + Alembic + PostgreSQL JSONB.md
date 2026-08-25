---
kind: external_dependency
name: ORM 与数据库：SQLAlchemy + Alembic + PostgreSQL JSONB
slug: sqlalchemy-alembic-postgresql
category: external_dependency
category_hints:
    - sdk_real_api
    - client_constraint
scope:
    - '**'
---

数据层基于 SQLAlchemy ORM（`models.py`）+ Alembic 迁移（`alembic/versions/*`），数据库方言为 PostgreSQL，大量使用 `JSONB` 列存储工作流定义、节点配置等动态结构。连接串通过环境变量 `WF_DATABASE_URL`（见 `alembic/env.py`）注入，而非硬编码。迁移脚本已覆盖初始 schema、Agent、资源管理、质量结果证据等多个阶段，新增表需遵循现有迁移命名与顺序约束。