# 2026-09-11 治理轮验收：beUI 基线全链路 + 工牌卡 + thinking 冒烟

状态：**待用户起床验收**（代码未提交）。本轮为用户拍板后的通宵执行轮。

## 拍板记录（用户原话裁决）
1. 组件基线 = **beUI**（beui.dev/components/agents，repo `starc007/ui-components`，MIT，copy-paste）；覆盖 = **全链路**（对话页 + agentflow 节点面板 + run 详情）。
2. /agents 新建卡 = 回退原版 create-fan 后**工牌化**：五张用户 supplied 成品头像为**全平台唯一头像池**（旧 13 张已删）；每次悬停回收五牌洗牌换序。
3. thinking 活体冒烟 = **用户批准**（耗 LLM 额度）。
4. 对话输入框禁止手写 → beUI PromptInput；HITL/消息行等其余手写块同批换 beUI。

## 实施清单
- `src/components/beui/`：lib×9 / motion×21（含 button 族、select、popover-morph）/ agents×19（agent-code 去 shiki 同 API 替代；use-favicon 真实现）。调色板类全 remap 到 status-* token；英文文案全中文化（调用中/已完成/批准/拒绝/复制回答/有帮助/停止/发送…）。
- 对话页：PromptInput（composer）、StreamingResponse（正文+操作组+sources 披露）、MessageBubbleCollapsible+ThinkingShimmer（深度思考）、ToolResult、AgentActivity（执行过程态）、AgentProgress、ApprovalCard（HITL，外部等待态不渲染批准钮）、Message/MessageBubble（消息行竖排包裹）。
- agentflow：NodeRunPanel 同基线；run-detail trace 页顶部 AgentActivity。
- 工牌卡：五牌、挂绳孔+大证件照+姓名条；hover 扇出 spread ±70/rot ±8（总宽≈228 < tile 内宽 293，不超出）；mouse-leave 洗牌。
- 头像：`public/avatars/avatar-0..4.png` = 用户五张原图（未加工）；`AVATARS` 长度 5；DB 存量 avatar 全空串无需迁移。
- 新建 Agent 头像一致性：未手选时落库 `avatarFor(template.id)`（新建页预览同款）。

## 证据
- 门禁：typecheck 0 错；vitest **64/64**；check-ui-standard 绿；check-theme4-nav **36/36**；pytest **492/492**。
- thinking 冒烟（真 LLM，用户批准）：scratch agent `smoke-thinking-0911(可删)` id=95259e9c…；release 快照 `frozen_model_params={'thinking_enable': True, 'thinking_budget': 2048}`；会话 48d916d2… 的 assistant 消息 content=[hint, **thinking**, text]；我方对话页「深度思考」折叠块展开可见思考正文+回答（IAB 截图存证）。
- 原站对照：QoderWake 19830 会话转录含 5 个「深度思考」折叠块（IAB 截图存证）——参考链本身存在，断点确为我方开关未开（已修）。
- 流式时序测试 6/6（断言随 beUI 基线更新：swap 动效双节点→getAllByText；HITL 文案拆分标题/描述）。

## 已知遗留（诚实登记）
- `scripts/check-visual-regression.mjs` 硬编码已退役栈 5173/8100（5173 属 Cornplus 禁动），其四屏为工作流设计器——本轮未改该界面，故未重拍基线；该 gate 重指向新栈属独立工单。
- 逐屏人工签字待用户起床执行（本轮 IAB 截图：/agents 两态、对话页思考块、run 详情、原站对照）。
- MessageScroller/ChatApp/AISidebar/Citations 独立件/FileDiff/ImageGeneration/TodoList 有意不引（容器冲突或无数据源，不摆空壳）；related 追问自动生成需额外 LLM 调用，待批。
- scratch agent `smoke-thinking-0911` 与其实会话保留作证据，用户可删。
