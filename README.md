# CORTEX · AI Quality Intelligence Platform

企业内部 AI 驱动的质量评价与业务洞察平台（V1 聚焦：智能质检 → 坐席质检）。
**全栈系统**：React 前端 + FastAPI/PostgreSQL 平台后端 + AgentScope Agent 运行时。

> 历史说明：本仓库始于前端原型（冻结基线文档见 `初始化doc/`），现已演进为
> 前后端+运行时的完整平台。原型期"mock service"已全部退役，数据一律来自
> 平台 API 与真实 PostgreSQL（wf_dev）。

## 架构与端口

| 组件 | 位置 | 端口 | 说明 |
|---|---|---|---|
| 前端（Vite + React 19 + TS） | `src/` | dev 5173 / 验收 5199 | Vite 仅绑 localhost（::1）；`VITE_WF_API_BASE` 指向平台 |
| 平台后端（FastAPI + SQLAlchemy + PG） | `server/` | 8120（验收栈） | DB `wf_dev`（alembic 迁移）；pytest 用临时库 `wf_pytest_*` |
| Agent 运行时（AgentScope 2.0.x） | `runtimes/agentscope/` | 8301 | Session/Schedule/Toolkit 真源；平台经内部令牌调用 |

API 基址单一事实源：`src/services/wf-api.ts` 的 `WF_BASE`（默认 `http://127.0.0.1:8120`）。

## 运行

```bash
# 前端
npm install
npm run dev          # http://localhost:5173（必须用 localhost，不要用 127.0.0.1）
npm run typecheck && npm run lint && npm run build

# 后端（需本机 PostgreSQL，库 wf_dev 已迁移到 head）
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
WF_DATABASE_URL="postgresql+psycopg://rivers@127.0.0.1:5432/wf_dev" \
  .venv/bin/alembic upgrade head
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8120
.venv/bin/python -m pytest tests/ -q     # 全量后端测试（自动建临时库）

# Agent 运行时（见 runtimes/agentscope/README 与 docs/ops/release.md）
```

## 权威文档

- **运行/自动任务/分析批跑域**：`docs/product-domain/execution-automation-batch-spec.md`
  （IMPLEMENTATION_SOURCE_OF_TRUTH；切片进度 F0–F5 已实施）
- 自动任务定义 / 工作项投影：`docs/product-domain/automation-definition.md`、`work-item-projection.md`
- 验收记录（每轮交付的证据与门禁）：`docs/acceptance/`
- 审计脚本（可重跑门禁）：`scripts/audit_layer1…4`、`scripts/check-*`
- 部署/发布：`docs/ops/release.md`（注意其中 worker/watcher 进程模型的已知漂移项）
- 历史冻结基线（原型期，冲突时以上方现行 Spec 为准）：`初始化doc/`

## 目录

```text
src/
├─ app.tsx                  # Route Map（一级路由 /tasks /autonomous-tasks /agents /resources /workflows /settings）
├─ components/
│  ├─ ui/                   # shadcn/ui
│  ├─ beui/                 # beUI 基线组件（消息流/PromptInput/审批卡等）
│  ├─ app/                  # Shell / 侧栏 / PageHeader / 列表三态 / ErrorBoundary
│  └─ ...
├─ config/ui-terms.ts       # 导航与业务对象固定文案（单一事实源）
├─ hooks/                   # useListQuery（URL query 唯一事实源）/ useAsyncData（含取消）
├─ services/                # wf-api / as-api / resource-api（统一基址/鉴权/超时/错误解析）
└─ pages/                   # 业务页面
server/
├─ app/                     # FastAPI（models / routers / runner / task_runner / watcher / 投影）
├─ alembic/versions/        # 迁移（当前 head：g057eventrt0001）
└─ tests/                   # pytest（每会话临时库 wf_pytest_*，自动清理）
runtimes/agentscope/        # Agent 运行时 + 脚本沙箱（AgentFlow 脚本编排）
```

## 导航（冻结五项一级入口，不新增）

```text
任务（统一工作项看板） / 自动任务（v2 通用自动任务） / Agent / 能力与资源 / Workflow
底部：主题 / 设置 / 账号
```

术语边界：「自动任务」= AutomationDefinition（一次触发 → 一次 Invocation → 一个执行体）；
「分析任务」= AnalysisTask（数据集批量分析，TaskRun → N Run），入口在任务域 `/batch-tasks`，
二者不得混用（2026-09-13 用户拍板）。

## 安全注意

- Secret 服务端加密存储、页面永不回显；机器端点（webhook token / 内部回调）与登录端点边界分离。
- 本地开发凭据（wf_dev、测试 LLM Key）仅限 localhost；生产 profile 缺失 Fernet key 拒绝启动。
- 8000 端口是用户其他服务、5173 在验收期间服务本项目前端——脚本禁止无差别杀端口。
