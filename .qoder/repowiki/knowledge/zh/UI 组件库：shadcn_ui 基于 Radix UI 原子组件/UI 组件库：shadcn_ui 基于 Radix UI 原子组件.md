---
kind: external_dependency
name: UI 组件库：shadcn/ui 基于 Radix UI 原子组件
slug: shadcn-ui-radix
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
---

前端 UI 体系采用 shadcn/ui（new-york / neutral 主题），底层全部基于 `@radix-ui/*` 无样式原子组件，配合 Tailwind CSS v4 与 `class-variance-authority`、`tailwind-merge` 进行样式组合。`components.json` 控制组件生成配置，所有 `src/components/ui/*` 均为可复制粘贴的 Radix 封装，非黑盒 npm 包。