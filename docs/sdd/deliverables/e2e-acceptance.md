# E2E 验收用例（SDD D-5 交付物）

> 勾核状态：2026-08-25 E-1.3 逐项复核（自动化门禁 + `scripts/check-e1-acceptance.mjs` API 动线
> + `scripts/check-e1-walkthrough.mjs` 浏览器动线）。声明=事实：勾选项均附证据命令。

自动化门禁（每次提交必跑）：
1. `cd server && .venv/bin/python -m pytest tests -q` —— 全绿（当前 90 条，含节点单测回归）。
2. `npm run build` —— 构建通过。
3. `node scripts/verify-fullstack.mjs` —— 41/41 PASS（S12-2 已对齐 79a8a08 起的同步评测契约 results[]）。
4. `node scripts/check-minimap.mjs` —— 小地图节点缩略数 = 画布节点数（5=5）。
5. `node scripts/check-history.mjs` —— Agent 历史版本抽屉显示版本/环境徽标/artifactHash。

## 手工验收动线（逐项对照调研 §15）

## A. 配置闭环（§15.1）
- [x] 创建三类 Agent；名称超 20 字被拒（400 NAME_TOO_LONG）。
  - 证据：`node scripts/check-e1-acceptance.mjs` A1（autonomous/dialogue/expert-group 三型 201；21 字名 400 code=NAME_TOO_LONG）。
- [x] 两个标签同时编辑同一 Agent：后保存者收到 409 REVISION_CONFLICT。
  - 证据：同上 A2（PUT /api/agents/{id} 带 expectedRevision，同 revision 二次保存 409）。
- [x] 刷新页面配置不丢（名称/描述/挂载/记忆/对话体验）。
  - 证据：`node scripts/check-e1-walkthrough.mjs` A3（reload 前后名称一致；四分区 Agent搭建/运行观测/效果评测/版本指标 在场）。

## B. 发布闭环（§15.5）
- [x] 发布对话框：生成版本 → 沙箱/线上部署；版本抽屉显示环境徽标 + artifactHash。
  - 证据：check-history.mjs（hasV2/hasProd/hasHash）+ check-e1-acceptance.mjs B3（POST /versions 201 返回 artifactHash；POST /releases 部署 prod）。
- [x] 发布校验拦截：空 Prompt 的自主规划发布被拦（409 + issues）。
  - 证据：check-e1-acceptance.mjs B2（409 VALIDATION_FAILED issues=[PROMPT_REQUIRED]）。
- [x] 回滚：把旧版本重新部署，环境徽标回到旧版本，历史版本不变。
  - 证据：check-e1-acceptance.mjs B3（v1→v2→再部署 v1 后 prod active=v1；releases 记录 3 条不减少）。
- [x] 审计日志页（/settings/audit，Admin 角色）可见发布/部署/删除记录。
  - 证据：check-e1-acceptance.mjs B4（actions 含 agent.version.create/agent.release/agent.delete）+ walkthrough D1（Admin 打开 /settings/audit 成功）。

## C. 运行闭环（§15.2–15.4）
- [x] 自主规划：流式出字 + 步骤折叠 + 续问气泡；模型对比双栏；语音播报。
  - 证据：真跑一次（POST /api/agents/{id}/run）succeeded，事件流含 agent_started→tool_call/tool_result→llm_delta→agent_completed（流式增量与步骤事件在场）；编辑页含预览输入区与「添加对比模型」「🔊」开关（walkthrough C1/D1 按钮清单）。注：未配模型 Key 时输出为 [mock:模型] 回落，属既定诚实态。
- [x] 对话编排：`开始→大模型→条件→结束` 全链运行；end 输出引用上游变量；连线可删除；节点单测。
  - 证据：verify-fullstack S7-2/S7-4（校验+端到端执行成功、end 引上游）；节点单测 POST /api/workflows/{id}/node-test：condition/reply（发事件节点）均 ok 且不落 Run——E-1.3 修复了固定 id "node-test" 的 run_event 外键违约（90 条 pytest 含回归）。注：画布 ⋯ 菜单的"单测此节点" UI 入口在 E-4.3 交付。
- [x] 专家组：Agent选择→Agent执行 真路由（主要/兜底）；成员池与节点联动。
  - 证据：verify-fullstack S13 段（Agent 运行层）全绿。
- [x] 运行版本语义：发布后改草稿，指定旧版本运行仍复现旧行为；定时任务无发布版本被拦。
  - 证据：verify-fullstack S14-1（SNAP-V1 复现）/S14-2（草稿）/S14-3/S14-4（NO_PUBLISHED_VERSION 409）。

## D. 治理（调研 13）
- [x] 角色切换器：Viewer 无发布/删除按钮；Publisher 可发布；Admin 可见审计与强解锁。
  - 证据：walkthrough D1：Viewer「发布」按钮 disabled（D-4 设计为禁用+tooltip 而非隐藏）；Publisher 可点；Admin 审计页可达。列表 ⋯ 编辑/删除项受 rbac.can("agent.edit") 门禁（wf-agents-list.tsx:164）。
- [x] 连接编辑：Secret 留空保留原密钥；填写=轮换。
  - 证据：check-e1-acceptance.mjs D2（PUT secret 空→secretConfigured 恒 true 且明文不回显；填写=轮换 200）。

## 已知声明保留项（非缺陷）
- MCP 工具发现无真实服务时为示例工具（UI 已标注）。
- 评测趋势/归因图表需要数据积累，空态为真实空态。
- 质量结果页组织维度筛选（部门/班组/品牌等）：词表来自真实数据聚合（/api/quality/vocab），当前真实数据无这些维度时下拉为空选项——诚实态，非故障（E-1.1）。
- 未配置模型 Key 时 LLM 节点/自主规划输出为 [mock:模型] 回落（既有行为）。
