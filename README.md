# AI Quality Intelligence Platform · 企业智能质量平台

企业内部使用的 AI 驱动质量评价与业务洞察平台前端原型（V1 聚焦：智能质检 → 坐席质检）。

## 冻结基线文档

位于 `初始化doc/`：

1. `AI_Quality_Intelligence_Platform_产品架构冻结文档_V1.38_FINAL_BASELINE.md`（Master）
2. `AI_Quality_Intelligence_Platform_DESIGN_SPEC_V1.18_FINAL_BASELINE.md`（Design Spec）
3. `AI_Quality_Intelligence_Platform_IMPLEMENTATION_SPEC_V1.3_FINAL_BASELINE.md`（Implementation Spec）
4. `AI_Quality_Intelligence_Platform_CODEX_HANDOFF_V1.0.md`（Handoff）

冲突处理：产品对象/业务语义 → Master；页面/UI/交互 → Design Spec；Route/状态/RBAC/Query/时间/分页 → Implementation Spec。

## 技术栈

- Vite 7 + React 19 + TypeScript
- Tailwind CSS v4 + shadcn/ui（new-york / neutral）
- Application Shell：shadcn sidebar-03
- Agent Workflow UI：@xyflow/react（节点样式参考 sim 的节点设计）+ shadcn/ui
- react-router-dom v7（URL Query 为列表状态唯一事实来源）
- recharts（shadcn charts）

## 运行

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run lint
npm run build
```

## 目录

```text
src/
├─ app.tsx                  # 固定 Route Map
├─ components/
│  ├─ ui/                   # shadcn/ui
│  ├─ app/                  # Shell / PageHeader / Status tokens / Table / Pagination / 状态组件
│  ├─ quality/              # GlobalFilters
│  ├─ tasks/                # 任务表单区块（Wizard / Edit 复用）
│  └─ agents/               # flow 节点 / Inspector / Variable Picker / Test Run Runner
├─ config/                  # 企业时区 / UI 文案 / 状态语义 token
├─ domain/                  # 业务对象类型
├─ hooks/                   # useListQuery（URL query state）/ useAsyncData
├─ mocks/                   # 目录 / 场景模板 / 生成数据
├─ services/                # mock service（server-side 参数形态，可替换真实 API）
└─ pages/                   # 8 个核心业务页面 + 下钻页 + 403/404
```

## 导航（冻结，不新增一级入口）

```text
智能质检：质量总览 / 质量结果 / 坐席分析
配置管理：分析任务 / Agents / Tools / 数据定义 / 结果规则
Settings：Connections
```
