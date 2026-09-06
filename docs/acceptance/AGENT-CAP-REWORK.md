# AGENT-CAP 返工验收文档（09-07 Agent 域重构：原站对齐 + Skill/记忆/对话一等实体）

范围来源：用户 09-07 拍板六条（列表/详情/配置对着 19830 改；放弃在线/本机/group；加对话；6 新头像；不做自进化）+ 四个拍板项（侧栏全同构+发布治理组 / 对话独立工作区含模型选择+附件 / Skill 记忆一等实体新表 / 6 新替换 20 旧）。
铁律执行：所有前端度量先 IAB 实测入台账 `.tmp-docs/agent-cap/measurements.md`（§1–§6），实现只从台账取值；每批浏览器回验截图存 `.tmp-docs/agent-cap/ours-*.png` 与 `original/`。

## 门槛 1 — 后端一等实体与对话运行时
- migration `g047agentcap0001`（expand-only，链 g046）：skill / agent_skill / agent_memory / agent_memory_revision / agent_chat_session / agent_chat_message + run.created_at 索引；wf_dev 与 wf_test 双库已升级。
- registry kind=skill 全接线（AI_TYPES/CLS/COLL/create/update/references/to_dto）；mounts-health 的 skill 改真校验。
- API：列表 +runCount/lastRunAt（单聚合）；run-stats；skills 装/卸；memory GET/PUT/revisions/timeline；chat sessions/messages/turns/uploads；写端点 require_operator；archived 写入口 409。
- 对话运行时：Run(trigger="chat") + JobQueue chat-turn + `_chat_completion(on_delta)` 流式 → RunEvent llm_delta → 终态 agent_completed/agent_failed（前端 streamRunEvents TERMINAL 直接可用）。
- 证据：`pytest tests/test_agent_caps.py` 5/5；全量 `pytest` **432 passed / exit 0**（/tmp/pytest-full-0907.log）。

## 门槛 2 — 列表页对齐（台账 §1/§1b/§4）
- 竖排居中卡（头像48/名称16-500/角色 chip/描述 clamp2 12-18/统计行「任务数 N｜最近运行 X」真数据/1px 分隔）、首格虚线新建占位卡、segment（使用中/已封存）、计数「N 个 Agent」、⋯ 菜单、对话按钮（archived 隐藏）。
- 6 张原站风手绘 SVG 头像（色板像素解码自原站 plate：#C4EDC4/#FFEDD4/#E7E6FB/#AFD5CB/#DFD3FD/#FFE1DD）；旧 20 PNG 保留磁盘（存量引用不破坏）仅默认池替换；agent-create 六宫格 + 修 avatar 未传 create 的 bug。
- 声明偏差：控件高度沿用我方 h-8（原站 h-9/h-7）；segment 浅色用中性 token（原站浅色固定 rgba 不可见=缺陷）；三级文字色 --text-tertiary 四主题实测入 index.css。
- 证据：回验截图 `ours-agents-dark.png`；vitest 46/46。

## 门槛 3 — 详情 IA（台账 §2/§5）
- `AgentWorkspaceShell`：hero 顶栏（avatar/名称/角色 chip/封存 chip/对话/⋯）+ 二级侧栏 w207 分组（概览｜工作:任务看板｜记忆与学习:记忆｜能力与资源:Skill/连接器/Wakerflow/知识库｜管理:配置/发布治理），hover==选中同底+字重 500（沿用 09-06 结论）。
- 九子页：home（工作日志四数字+触发类型环图+核心能力块+记忆时间线）/board（AgentRunsPanel）/memory（两 tab+版本管理 dialog）/skills（市场/我的+上传）/connectors（市场/已装，config.connections 乐观锁）/workflows|knowledge（绑定/解绑/打开）/config（表单+测试面板+capabilities 行编辑器）/governance（评测+版本+Golden 双 Provider 对比保留）。
- 三 tab 壳 AgentLifecycleShell 退役删除；archived 三型全子页只读、无对话；404 回落旧设计器保持兼容。
- 证据：回验截图 `ours-workspace-home.png`、`ours-workspace-config.png`。

## 门槛 4 — 对话工作区（台账 §6）
- /agents/:agentId/chat：左会话历史 w240（新建/空态 13px 三级色）+ 右主列（欢迎 24/500+建议卡 r6 h48+消息流+composer shell r8 pad 12 12 0/toolbar h44：附件 FilePicker+模型 Select+发送）。
- 流式：streamRunEvents llm_delta 增量渲染；失败降 800ms 轮询；附件只存+展示不解析（MVP 局限 UI 注明）；语义=角色对话（不触发 Module 结构化执行，UI 注明）。
- 证据：本地 SSE mock（8399）下端到端流式出字回验 `ours-chat-streaming.png`；真 DashScope key 在本环境 401（外部凭据问题，非代码缺陷，链路与终态处理已验证）。

## 门槛 5 — 门禁全绿
- check-ui-standard：通过（隐藏 file input 收口 `components/ui/file-picker.tsx`，allowlist 零新增）。
- check-theme4-nav：36/36。verify-mtc001：28/28。
- check-ra4-readonly：17/17（断言更新：封存列表取样 + 任务看板子页运行历史；wf_dev 补 RA4-封存夹具-0001 只读夹具行）。
- verify-mtc003-007：26/26（Agent 段断言更新：侧栏任务看板/发布治理 + chat 截图）。
- verify-fullstack：64 PASS 无 FAIL（S13 封存语义不变）。
- vitest 46/46；typecheck 绿；pytest 432 passed。
- check-visual-regression：**本轮跳过并声明**——基线仅 designer 四屏，本轮未改 designer 视觉（仅 WorkflowMetaDialog 头像 import 路径）；5173 端口现属 Cornplus 不可复用为该门禁前端。

## 行为差异与返工修复（均在本轮 commit 声明）
- 列表卡横排→竖排居中；"运行摘要：—"占位→真统计行；详情三 tab→九子页侧栏；对话入口新增。
- 原站缺陷不抄清单：浅色 segment 不可见、i18n 未翻译 key、365 天全零热力图（默认不做）、在线/本机（无心跳概念）。

## 未触碰
- 主题四套 token 骨架（仅新增 --text-tertiary/--segment-* 实测 token）；72px 窄轨；任务看板/资源 Hub/设计器主体；battery manifest（新测试文件未入 manifest，94 基线不变）。

## 已知限制
- 对话 MVP：附件不解析内容；不带 @上下文/工作目录；角色对话不触发 Module 结构化执行。
- 消息气泡度量为台账缺口（原站新会话无历史消息可测），按 token 自定，待原站真实对话截图比对修正。
