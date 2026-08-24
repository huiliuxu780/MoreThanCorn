---
kind: dependency_management
name: 前后端依赖管理：npm + lockfile（后端无声明式依赖清单）
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
    - .gitignore
---

## 1. 使用的系统/工具
- 前端（React + Vite + TypeScript）：使用 **npm** 作为包管理器，通过 `package.json` 声明运行时与开发依赖，并通过仓库根目录的 `package-lock.json`（lockfileVersion 3）锁定精确版本。
- 后端（FastAPI Python 服务）：未发现 `requirements.txt`、`pyproject.toml`、`setup.py`、`Pipfile`、`poetry.lock` 等任何 Python 依赖清单文件；`server/.venv/` 在 `.gitignore` 中被忽略，说明虚拟环境由本地创建，不纳入版本控制。
- 构建/脚本：`scripts/` 下的 Node 脚本（如 `e2e-*.mjs`、`verify-fullstack.mjs`、`cdplib.py`）直接复用项目 npm 安装的工具链，未引入额外独立依赖声明。

## 2. 关键文件
- `package.json`：唯一的前端依赖声明入口，定义 `dependencies`（运行时）和 `devDependencies`（构建/类型检查/lint）。
- `package-lock.json`：npm 生成的完整依赖树锁文件，包含所有传递依赖的精确版本与 `resolved` 地址（指向 `registry.npmmirror.com`），用于保证跨环境可重复安装。
- `.gitignore`：显式忽略 `node_modules`、`.venv/`、`__pycache__/`、`*.pyc`，表明依赖安装产物均不入库。
- `tsconfig.*` / `vite.config.ts` / `eslint.config.js`：消费已安装的 TypeScript、Vite、ESLint 等工具，间接约束依赖版本范围。

## 3. 架构与约定
- 单一前端工作区：整个仓库只有一个 `package.json`，不存在 monorepo 结构或子模块独立依赖管理。
- 组件库来源：UI 基于 shadcn/ui（new-york/neutral 主题），底层 Radix UI 组件通过 `@radix-ui/*` 与 `radix-ui` 聚合包引入；样式走 Tailwind CSS v4（`tailwindcss` + `@tailwindcss/vite`）。
- 依赖版本策略：运行时依赖普遍采用 `^` 前缀（如 `react ^19.2.8`、`zod ^4.4.3`、`recharts ^3.8.0`），允许小版本升级；TypeScript 使用 `~5.9.2` 这种更严格的 patch 限定。构建期依赖同样以 `^` 为主。
- 镜像源：`package-lock.json` 中大量 `resolved` 字段指向 `https://registry.npmmirror.com/...`，说明实际安装使用了国内 npm 镜像。
- 后端无声明式依赖：Python 侧没有提交任何依赖清单，意味着当前代码库本身不包含“可被 CI 自动解析”的后端依赖声明——依赖版本由开发者本地 `.venv` 维护，不在仓库内固化。

## 4. 约定与约束
- 新增前端依赖必须通过 `npm install <pkg>` 写入 `package.json`，并同步提交 `package-lock.json`，以保证安装结果可重现。
- 禁止将 `node_modules`、`.venv`、`dist`、`*.pyc` 等安装产物提交到 Git（由 `.gitignore` 强制）。
- 前端依赖按职责分为 `dependencies`（应用运行所需）与 `devDependencies`（构建/类型检查/lint 所需），二者严格区分。
- 由于后端缺少 `requirements.txt`/`pyproject.toml`，当前仓库对 Python 依赖的管理是**非声明式**的；若需统一后端依赖版本，需在 `server/` 下补充标准清单文件并提交至版本库。
- 脚本目录 `scripts/` 中的 Node 脚本依赖应通过项目根 `package.json` 的 devDependencies 提供，而非另行安装全局工具。

综上，本仓库的依赖管理以 npm + lockfile 为核心，覆盖全部前端与脚本工具；后端 Python 依赖目前未在仓库中以清单形式声明，属于本地化、非版本固化的状态。