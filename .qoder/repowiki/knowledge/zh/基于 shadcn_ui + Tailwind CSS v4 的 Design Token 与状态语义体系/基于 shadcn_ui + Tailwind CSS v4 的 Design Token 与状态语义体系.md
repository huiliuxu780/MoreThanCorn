---
kind: frontend_style
name: 基于 shadcn/ui + Tailwind CSS v4 的 Design Token 与状态语义体系
category: frontend_style
scope:
    - '**'
source_files:
    - components.json
    - package.json
    - src/index.css
    - src/domain/types.ts
    - src/config/ui-terms.ts
    - src/config/enterprise.ts
    - src/components/ui/button.tsx
    - src/components/app/status-badge.tsx
    - src/components/app/status-indicator.tsx
---

## 1. 系统与方法论

前端采用 **Vite + React 19 + TypeScript** 构建，样式层以 **Tailwind CSS v4**（`@tailwindcss/vite`）为原子化基础，通过 `components.json` 中声明的 `style: "new-york"`、`baseColor: "neutral"`、`cssVariables: true` 启用 shadcn/ui 的 New York 风格主题。所有 UI 组件均位于 `src/components/ui/`，由 shadcn/cli 生成并维护，底层依赖 Radix UI 原语（`@radix-ui/*`）+ `class-variance-authority`（CVA）实现变体组合。

全局样式入口为 `src/index.css`：使用 `@import "tailwindcss"` 和 `@import "tw-animate-css"` 引入样式；通过 `:root` 与 `.dark` 两套 CSS 变量定义完整的设计 token（background / foreground / primary / secondary / muted / accent / destructive / border / input / ring / chart-1..5 / sidebar-*），并在 `@theme inline { ... }` 块中将 CSS 变量映射到 Tailwind 的 `--color-*` 语义命名（如 `--color-primary` → `var(--primary)`），从而让业务组件只消费语义 token，不直接引用 hex 色值。

## 2. 关键文件与包

| 文件 | 作用 |
|---|---|
| `components.json` | shadcn 配置：style=new-york、baseColor=neutral、CSS 变量开关、别名（`@/components/ui` 等）、图标库 lucide |
| `package.json` | 依赖声明：Radix UI 全量、`class-variance-authority`、`clsx`、`tailwind-merge`、`next-themes`、`recharts`、`@xyflow/react`（工作流画布）等 |
| `src/index.css` | 全局设计 token（light/dark）、`@theme inline` 映射、`@layer base` 重置 |
| `src/domain/types.ts` | 定义 `StatusTone = "neutral" | "info" | "success" | "warning" | "danger"`，作为全仓统一的状态语义 token |
| `src/config/ui-terms.ts` | 集中管理 UI 文案（`UI_TERMS`）、状态中文标签（`STATUS_LABELS`）、风险等级（`RISK_LABELS`）以及状态→语义 token 的全局映射 `STATUS_TONES` |
| `src/components/ui/button.tsx` | CVA 变体示例：`variant`（default/destructive/outline/secondary/ghost/link）+ `size`（xs/sm/lg/icon/*），全部通过 Tailwind 语义类名组合 |
| `src/components/app/status-badge.tsx` | 统一状态 Badge，从 `STATUS_TONES` 查 tone 后传给 `Badge variant={tone}` |
| `src/components/app/status-indicator.tsx` | 统一状态指示器：按 `StatusTone` 选择 Lucide 图标 + 文本/区块颜色映射（含 dark 模式适配） |
| `src/config/enterprise.ts` | 企业级部署配置（时区 Asia/Shanghai、locale zh-CN），避免在页面组件内硬编码 |

## 3. 架构与设计决策

- **Design Token 驱动**：所有颜色通过 CSS 变量（oklch 色彩空间）暴露，业务组件仅使用 `bg-primary`、`text-destructive`、`border-border` 等语义类，禁止硬编码 hex。`status-indicator.tsx` 中对 `info/success/warning/danger` 的映射是少数仍写死色类的地方，但仅限于展示层辅助色，主色调仍走 token。
- **状态语义分层**：`domain/types.ts` 中的 `StatusTone` 是跨模块契约；`config/ui-terms.ts` 的 `STATUS_TONES` 将后端枚举（Draft/Published/FAILED 等）映射到前端语义 token；`app/status-badge.tsx`、`app/status-indicator.tsx` 等组件消费该映射，保证同一状态在不同页面视觉一致。
- **上下文消歧**：`StatusBadge` 支持 `context="review" | "run"`，对 `PENDING` 在复核语境显示 warning（待复核），在运行语境显示 neutral（等待中），体现“同一状态码 → 多语义”的设计。
- **Dark Mode**：通过 `next-themes` 切换根节点 class，配合 `@custom-variant dark (&:is(.dark *))` 与 `.dark` 下的 CSS 变量覆盖实现明暗主题。
- **组件组织**：`src/components/ui/` 存放可复用原子组件（button、badge、dialog、sidebar、table 等），`src/components/app/` 存放业务复合组件（status-badge、status-indicator、filters、pagination、table-frame 等），页面级逻辑在 `src/pages/` 中通过路由装配。
- **工作流编辑器**：使用 `@xyflow/react`（React Flow）绘制 Agent 节点图，结合 `AgentNodeKind`（input/llm/tool/transform/condition/router/human-interrupt/create-record/notification/end）统一节点家族。

## 4. 约定与约束

- **颜色来源**：所有主题色必须来自 `src/index.css` 定义的 CSS 变量（`--primary`、`--destructive`、`--chart-*` 等），组件不得硬编码 hex 或 rgb。作者指南明确“状态语义色通过 StatusTone token 管理，禁止硬编码 hex”。
- **状态文案与颜色分离**：`ui-terms.ts` 注释强调“状态文字必须始终存在，颜色只是辅助语义”，因此 `StatusBadge` 始终渲染中文 label，颜色仅起辅助作用。
- **状态映射集中化**：所有后端状态到前端 `StatusTone` 的映射集中在 `STATUS_TONES`，新增状态需在此补充映射，否则回退为 `neutral`。
- **导航结构冻结**：`UI_TERMS.navigation` 注释说明“导航结构冻结，不允许新增一级入口”，新增功能需在现有导航下扩展而非新建顶层菜单。
- **企业级配置外置**：时区、locale 等部署相关常量放在 `config/enterprise.ts`，页面组件不应硬编码。
- **响应式策略**：未引入独立断点系统，完全依赖 Tailwind 的响应式前缀（`sm:`、`md:`、`lg:` 等）与 `use-mobile` hook（见 `hooks/use-mobile.ts`）进行条件渲染。
- **表单与校验**：使用 `react-hook-form` + `@hookform/resolvers` + `zod` 做表单 schema 校验，样式通过 shadcn 的 `Form`、`Input`、`Select` 等组件组合。
- **动画**：通过 `tw-animate-css` 提供通用过渡动画，无需手写 keyframes。
- **图表**：使用 `recharts` 配合 `src/components/ui/chart.tsx` 封装，颜色沿用 `--chart-1..5` token。