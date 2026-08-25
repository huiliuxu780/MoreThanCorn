---
kind: build_system
name: Vite+React 前端构建与 Alembic 后端迁移（无 CI/容器化）
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - vite.config.ts
    - tsconfig.app.json
    - tsconfig.node.json
    - eslint.config.js
    - server/alembic.ini
    - server/alembic/env.py
    - server/alembic/script.py.mako
    - scripts/e2e-acceptance.mjs
    - scripts/e2e-p0.mjs
    - scripts/e2e-replica.mjs
    - scripts/verify-fullstack.mjs
---

## 1. 使用的系统与工具

本仓库采用**前后端分离的单体仓库**结构，构建系统由两部分组成：
- **前端**：基于 Vite 7 + React 19 + TypeScript 5.9 的单页应用，使用 `@vitejs/plugin-react` 和 `@tailwindcss/vite` 插件链。
- **后端**：Python FastAPI 服务，通过 Alembic 管理 SQLAlchemy 模型到 PostgreSQL 的数据库迁移；测试使用 pytest（位于 `server/tests/`）。

仓库中**不存在** Dockerfile、docker-compose、GitHub Actions / GitLab CI 等 CI/CD 配置文件，也没有 Makefile、tox.ini、pyproject.toml、requirements.txt 或 setup.py。后端依赖通过本地 `.venv` 虚拟环境管理，未纳入版本控制。

## 2. 关键文件

- `package.json`：定义项目脚本 `dev`、`build`、`lint`、`typecheck`、`preview`，以及全部 npm 依赖与 devDependencies。
- `vite.config.ts`：配置 React 插件、Tailwind CSS 插件、路径别名 `@` → `./src`。
- `tsconfig.app.json` / `tsconfig.node.json` / `tsconfig.json`：TypeScript 多配置，`build` 命令先执行 `tsc -b` 再 `vite build`。
- `eslint.config.js`：ESLint 9 flat config，配合 `typescript-eslint`。
- `server/alembic.ini`：Alembic 配置，默认连接 `postgresql+psycopg://rivers@127.0.0.1:5432/wf_dev`，迁移脚本位于 `server/alembic/versions/`。
- `scripts/*.mjs`：基于 Chrome DevTools Protocol (CDP) 的端到端测试脚本（`e2e-acceptance.mjs`、`e2e-p0.mjs`、`e2e-replica.mjs`、`verify-fullstack.mjs`），直接通过 WebSocket 向 Chrome 调试端口 `http://127.0.0.1:9222/json/list` 发送指令驱动浏览器。

## 3. 架构与约定

### 前端构建流程
1. `npm run build` 顺序执行 `tsc -b`（类型检查并生成声明）→ `vite build`（打包产物）。`typecheck` 命令可单独运行 `tsc -b --pretty false` 用于 CI 场景。
2. 开发模式 `npm run dev` 启动 Vite HMR 服务器，监听 `localhost:5173`。
3. 预览构建产物 `npm run preview`。
4. 代码质量：`npm run lint` 调用 ESLint 扫描根目录。
5. 路径别名统一使用 `@` 指向 `src/`，组件库位于 `src/components/ui/`（shadcn/ui 风格）。

### 后端构建/迁移流程
1. 数据库迁移：在 `server/` 目录下通过 Alembic CLI 操作，迁移脚本按 revision ID 命名（如 `b9be7d4dcf3f_initial_schema.py`），存放在 `server/alembic/versions/`。
2. 测试：`pytest` 运行 `server/tests/` 下的测试文件，按 phase 组织（`test_phase_a.py`、`test_phase_b.py`、`test_phase_c.py`、`test_p2.py`、`test_p5_nodes.py` 等）。
3. 运行时入口为 `server/app/main.py`（FastAPI 应用），Agent 运行时在 `agent_runtime.py`，Worker 调度在 `runner.py`。

### E2E 测试
- 所有 E2E 脚本位于 `scripts/`，通过 CDP 直接操控已开启 `--remote-debugging-port=9222` 的 Chrome 实例。
- 脚本假设前端已在 `localhost:5173` 运行，后端 API 可通过路由访问。
- 截图输出到 `/tmp/qACC-*.png`，用于验收证据留存。

## 4. 约定与约束

- **前端构建必须经过 TypeScript 类型检查**：`build` 脚本强制先执行 `tsc -b`，类型错误会阻止打包。
- **路径导入统一使用 `@` 别名**：`vite.config.ts` 中显式配置 `@` → `./src`，禁止使用相对路径穿越多层目录。
- **数据库变更必须通过 Alembic 迁移**：所有 schema 变更以独立 Python 文件形式提交至 `server/alembic/versions/`，默认数据库 URL 指向本地 `wf_dev` 库。
- **E2E 测试依赖外部 Chrome 调试端口**：脚本硬编码 `BASE = "http://127.0.0.1:9222"`，要求运行前手动启动带 `--remote-debugging-port=9222` 的 Chrome。
- **无容器化与 CI**：仓库未包含任何 Dockerfile、docker-compose、CI YAML 或 Makefile；部署与发布流程不在代码仓库内定义，需参考初始化文档中的部署说明。
- **依赖管理分散**：前端依赖集中在 `package.json`，后端依赖仅存在于本地 `.venv` 且未被版本控制，缺少统一的 `requirements.txt` 或 `pyproject.toml`。