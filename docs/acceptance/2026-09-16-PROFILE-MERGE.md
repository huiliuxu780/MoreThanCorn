# 09-16 配置页退役 · 并入 Agent 档案（原站同构）

用户指认：「配置和 agent 档案两个功能重叠，去看看 qoderwake」。

## 1. 原站活体实测（127.0.0.1:19830，2026-09-16）

- Waker 详情导航「权限与管理」组 = **权限 | Waker 档案**，**没有独立「配置」页**。
- 「Waker 档案」页 URL 即 `/wakers/<id>/settings`——档案页就是配置页本体。
- 档案页三段：
  1. 角色摘要：名称 + 个人简介 + 「修改」按钮 → 编辑对话框（名称/头像上传/简介）；
  2. 角色源文件：identity.md / persona.md / bible.md，各带原站 hint 文案 + 「查看」→
     **真实文件内容**渲染弹窗 + 弹窗内「编辑」按钮；
  3. 角色管理：删除 Waker。
- 概览页另有「编辑」「删除 Waker」按钮（同对话框）。

## 2. 我方重叠面（合并前）

| 内容 | 配置页 | 档案页 | 其他页 |
|---|---|---|---|
| identity/persona/bible | 编辑卡 1–3 | 「角色源文件」三行投影（内容为合成占位，非真实源文件） | — |
| 六工具族开关 | 卡 5 | — | 安全与权限（v2 三态，另写同 config.permissions） |
| 资源/挂载 | 卡 6 | 能力挂载徽章 | Skill/连接器/知识库 子页 |
| 模型 | 卡 4 | — | — |
| 发布/对比 | 顶栏 | — | 发布治理（已有发布入口） |

## 3. 合并案（已实施）

- 导航「权限与管理」= 安全与权限 | 发布治理 | Agent 档案；**「配置」项删除**。
- `/agents/:id/config`：module/custom → 重定向 `/profile`；legacy 封存类型
  （dialogue/expert-group/autonomous）保留只读视图直达（历史档案）。
- 档案页重建（原站三段 + 平台扩展段），字段唯一编辑入口：
  - 名称/头像/核心能力 = 「修改」对话框（头像上传改 dataURL 持久化；原 agent-create 的
    blob URL 不落库缺陷未在本轮处理，登记待办）；
  - 描述 = identity.md 编辑；config.persona = persona.md 编辑；
  - module：spec.purpose = bible.md 编辑（Module 冻结指令只读展示）；
    custom：rolePrompt = bible.md 编辑；
  - modelRef = 「模型与推理」段（新 Session 默认模型；发布冻结文案保留）。
- 六工具族开关迁入「安全与权限」页 tab2「工具族装配」块。
- 对比（模型/版本）入口迁入「发布治理」页头（发布入口本已在该页）。
- 删除 `src/pages/module-agent-config.tsx`、`src/pages/agent-workspace/custom-config.tsx`。

## 4. 顺手修掉的四个真缺陷

1. **persona 从未进 system_prompt**：`build_definition` 的 module/custom 分支不写 persona
   键，`compile_system_prompt` 永远编译不到（配置页「编译进 system_prompt」为虚假声明）。
   修复：两分支补 `"persona": cfg.get("persona", "")`。
2. **设置 persona 会静默丢掉 rolePrompt**：`compile_system_prompt` 旧逻辑
   「parts 非空即丢弃 legacy」；as_agents.py:97 草稿对话同坑。修复：legacy 在 parts 非空时
   以 `<identity>` 分区并入（parts 为空仍原文，存量行为不变）。
3. **业务定位/思考参数从未进冻结 Spec**：`build_agent_spec` 读 `cfg["purpose"]` 与
   `modelRef["parameters"]`，前端写的是 `config.spec.purpose` 与 `modelRef.params`。
   修复：后端两键位都接受。
4. **安全与权限保存抹掉六族开关**：该页保存纯 v2 结构，`normalize_tool_policy` 缺键视为
   开启 → 族开关被静默重置。修复：保存时 v1 六键与 v2 同写；并跟踪本地 revision 支持连续保存。

后端新增：`GET /api/agents/modules` 返回 `defaultInstructions`（bible.md 查看=真实冻结指令）。

## 5. 验证

- vitest 80/80；定向 pytest 64/64；全量门禁见 gate 输出。
- 5199 活体（module=景点搜索C-e02e / custom=业务分析-通话打标）：
  - 导航无「配置」；列表齿轮直达 `/profile`；`/config` 重定向生效；
  - 档案页三段+扩展段渲染正确；bible.md 弹窗=真实指令（quality-analysis 888 字符）；
  - 编辑态=冻结指令只读 + purpose 可编辑；编译预览与后端 compile 规则一致；
  - 安全与权限 tab2 六族开关：关 subagent → 保存 → API 校验 v1(subagent:false)+v2 全键同在
    → 还原保存（连续两次保存无 409）；
  - 发布治理页头=对比+发布新版本。
- 截图：assets/2026-09-16-profile-merge/01–06。

## 6. 登记待办（非本轮范围）

- agent-create 头像上传用 `URL.createObjectURL`（blob URL 不落库，刷新即失效）。
- modules meta 的 `providers` 仍列 deepseek-harness（09-04 已退役 runtime 的注册表残留）。
