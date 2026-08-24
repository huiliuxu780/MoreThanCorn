# Phase B｜Agent 聚合根与发布闭环

状态：**已冻结**（2026-08-25 夜间，用户授权连续施工："继续你后面的吧"）
预估：2 周
前置：Phase A 已验收
验收主题：调研 00 §20 四闭环全部闭合——配置可保存可恢复、依赖可验证可冻结、运行可观察（本阶段补齐流式与步骤）、版本可发布可回滚。

---

## 1. 范围

### 做
- Agent 层的 Draft revision / AgentVersion / Release 三件套（调研 04 §1、09 §7、08 §10）。
- 运行认 Agent 版本：发布的产物真正被执行（承接 A-01 的工作流层，上移到 Agent 层）。
- 发布时依赖冻结（工具版本/模型/知识/成员 Agent 状态）+ 发布前校验。
- CommonAgentConfig 一期：对话体验（自动续问/闲聊兜底）+ 结构化记忆 Schema 声明；后端真实消费。
- autonomous 流式输出（`llm_delta`）+ 预览步骤面板（思考/工具折叠）。
- 保存契约：expectedRevision 全链路（承接 A-08）+ 响应返回新 revision。

### 不做
- Trace/Span 结构化（C）；节点新增与 Inspector 改造（C）。
- 灰度发布、审批流（D）；线上环境真实部署动作（Release 记录先行，部署语义为"标记生效"）。
- 记忆值的持久化存储（C：Memory Service；本阶段只做 Schema 声明与运行时挂载注入）。

---

## 2. 数据模型（migration 016–017）

### 2.1 Agent 增列
```
agent.config_revision      int  not null default 1      -- A-08 已建则跳过
agent.sandbox_version_id   varchar(32) null
agent.prod_version_id      varchar(32) null
```
`agent.status` 语义收窄为编辑态（draft/published 沿用，发布动作同步）。

### 2.1b Run 增列（决策 D-4 运行树）
```
run.parent_run_id          varchar(32) null  -- 嵌套调用（成员 Agent/子工作流）挂载父运行
```
- 顶层运行列表接口默认过滤 `parent_run_id IS NULL`，`includeChildren=true` 时返回。
- `_run_member`、autonomous 子工作流调用创建子 Run 时必须填父。
- Trace 树（C 阶段）以此为骨架，不再回头补。

### 2.2 agent_version（不可变）
```
id                 varchar(32) pk
agent_id           varchar(32) fk agent.id
version_no         varchar(16)      -- V1.0.1 递增（沿用现有序列规则）
schema_version     int default 1
definition         jsonb            -- 类型专属定义快照（见 2.5）
common_config      jsonb            -- CommonAgentConfig 快照
dependency_snapshot jsonb           -- 冻结的依赖清单（见 §4）
artifact_hash      varchar(64)      -- sha256(definition+common_config+dependency_snapshot 规范化序列化)
note               text
created_by         varchar(64)
created_at         timestamptz
unique (agent_id, version_no)
```

### 2.3 release
```
id                 varchar(32) pk
agent_id           varchar(32) fk
agent_version_id   varchar(32) fk agent_version.id
environment        varchar(8)       -- sandbox | prod
status             varchar(16)      -- active | rolled_back | offline
created_by         varchar(64)
created_at         timestamptz
```
约束（应用层保证 + 部分唯一索引）：同一 `(agent_id, environment)` 至多一条 `active`。

### 2.4 CommonAgentConfig（common_config JSONB 结构）
```jsonc
{
  "conversation": {
    "autoFollowUp": {"enabled": false, "count": 3},
    "chitchatFallback": {"enabled": false, "modelId": null, "prompt": ""},
    "segmentation": {"enabled": false, "size": 10}   // 仅存储，运行时消费留 C
  },
  "knowledgeFallback": {"knowledgeIds": []},         // 仅声明，运行时消费留 C
  "memories": [                                       // 结构化记忆声明（调研 04 §6 裁剪版）
    {"id": "", "name": "", "description": "", "dataType": "STRING|NUMBER|BOOLEAN|JSON",
     "defaultValue": "", "duration": "SESSION|LONG_TERM"}
  ]
}
```

### 2.5 definition 快照（按 type）
- `autonomous`：`{rolePrompt, modelRef, skills[], toolIds[], workflowIds[], knowledgeIds[]}`（A-11 后挂载已是 id；版本化时锁工具版本：`tools: [{toolId, toolVersionId}]`）。
- `dialogue`/`expert-group`：`{workflowId, graph: <发布时工作流 draft_definition 的完整拷贝>, members?: [agentIds]}`。图随 Agent 版本走，发布后工作流草稿继续可编辑而不影响已发布 Agent（调研 08 §7：整图快照是权威）。

### 2.6 dependency_snapshot
```jsonc
{"items": [
  {"type": "TOOL", "id": "...", "version": "<toolVersionId>", "statusAtFreeze": "ready"},
  {"type": "MODEL", "id": "...", "version": "<model.version>"},
  {"type": "KNOWLEDGE", "id": "...", "statusAtFreeze": "enabled"},
  {"type": "WORKFLOW", "id": "...", "version": "<workflowVersionNo|null>"},
  {"type": "AGENT", "id": "...", "version": "<其最新 agent_version|null>"}
]}
```

---

## 3. API 契约

统一遵守 00-index §5.1 错误契约。

| 方法 路径 | 语义 | 关键行为 |
| --- | --- | --- |
| `PUT /api/agents/{aid}` | 保存草稿（身份+config） | 要求 `expectedRevision`；响应 `{config, configRevision}`；409 `REVISION_CONFLICT` |
| `POST /api/agents/{aid}/versions` | 发布版本（=调研的"创建不可变版本"） | body `{note?, configRevision, graphRevision?}`；服务端：revision 双校验（决策 D-1：configRevision 必须等于当前 `agent.config_revision`；dialogue/expert-group 的 `graphRevision` 缺省取绑定工作流当前 `draft_revision`，显式传入则必须相等，任一不符 409 `REVISION_CONFLICT`）→ 校验（§4）→ **同一事务内**读取配置与图草稿 → 组装三快照 → 计算 artifact_hash → 落库；响应 `{versionId, versionNo, artifactHash, issues?}`；校验失败 409 + issues 列表 |
| `GET /api/agents/{aid}/versions` | 版本列表 | 含 versionNo/note/createdAt/artifactHash |
| `GET /api/agents/{aid}/versions/{vid}` | 版本详情（含三快照，只读） | |
| `POST /api/agents/{aid}/releases` | 部署到环境 | body `{versionId, environment}`；将旧 active 置 `rolled_back`（回滚=再发旧版：`POST` 指向旧 versionId 即可，语义与调研 08 §10.4 一致）；更新 `agent.{sandbox,prod}_version_id` 与 `agent.status` |
| `GET /api/agents/{aid}/releases` | 部署记录 | |
| `POST /api/agents/{aid}/run` | 运行 | body 增 `versionId?`；解析规则见 §5 |

## 4. 发布前校验（`POST /versions` 内执行，逐项产出 issue）

通用（调研 10 §5）：
- 名称非空 ≤20；description 可选。
- autonomous：rolePrompt 非空；modelRef 已选且模型存在启用。
- dialogue/expert-group：绑定工作流存在；工作流校验器（现有 7 规则）通过；图内资源引用存在启用。
- 挂载/图引用的工具必须能解析到至少一个 ready 版本；知识源 enabled；成员 Agent 存在且非自身、无循环（沿用 call_chain 环检的静态版）。
冻结动作：解析每个工具到**当前最新 ready ToolVersion** 并写入 dependency_snapshot（发布后不漂移）。

## 5. 运行版本解析（核心语义）

`POST /api/agents/{aid}/run {input, trigger, versionId?}`：
1. `versionId` 给定 → 用该版本快照。
2. `trigger=test|manual` 且未给版本 → **草稿态运行**（autonomous 用当前 config；dialogue/group 用绑定工作流当前草稿图），Run 标记 `version=null, definition_source=draft`。
3. `trigger=schedule|api` 且未给版本 → 环境解析：`agent.sandbox_version_id`（默认）→ 无则 422 `NO_RELEASED_VERSION`。
4. 使用版本快照时：autonomous 按快照的 modelRef/挂载（工具用冻结的 toolVersionId）；dialogue/group 执行快照内的图拷贝（**不再读活动工作流草稿**），并沿用 A-01 的执行器。
5. Run 表增列：`agent_version_id`、`definition_source`（migration 017）。
6. 嵌套调用（`_run_member`、子工作流）继承父运行的版本上下文：成员 Agent 按父快照 `dependency_snapshot` 中冻结的 AGENT 版本执行（无冻结记录时回退成员当前草稿并标记 `unfrozen=true` 事件）。

## 6. 流式与步骤面板

0. **前置：单一 LLM 适配器（决策 D-2）**。把 `runner._call_model` 与 `agent_runtime._chat_completion` 合并为一个模型调用模块（统一鉴权解析、mock 回落、流式/非流式双入口）。本阶段所有 LLM 调用（节点执行、autonomous 循环、路由、流式）只允许走该模块；合并过程不得改变现有测试断言的行为。
1. 流式变体（OpenAI 兼容 SSE 解析）：逐块 `emit(..., "llm_delta", payload={"delta": ...})`，结束仍发 `agent_completed`。mock 模式整段一次下发。
2. 前端预览（autonomous）：订阅 `/api/runs/{runId}/events`（现有 DB 轮询 SSE 足够，B 不推翻），增量渲染最终回答；步骤面板按事件分组折叠：思考（占位，C 接真）/工具调用（tool_call+tool_result 配对）/回答。交互对标调研 02 §6 "查看 N 个步骤"。
3. 对话型/专家组运行结果展示维持现状（内容流双通道属于 C）。

## 7. 前端交付

**实现约束（复用与视觉基线）**：
- 运行事件订阅抽成共享钩子（如 `useRunEvents(runId)`：轮询/EventSource 二选一实现、按 sequence 合并、终态通知），预览、运行抽屉、步骤面板共用；禁止第三份事件拼装逻辑（复用性反思结论）。
- 新增面板的视觉基线引用调研 02 的实测常量（左栏 360px、模态 485–600px、抽屉打开压缩画布、Header 元素清单）与 `uiux/` 现有设计文档；无基线的细节在状态日志登记决策依据，不允许无据拍脑袋。
- 微交互清单（调研 03 §8）：返回时的未保存确认、保存按钮禁用/loading 态、Header 自动保存时间指示、流式输出的停止按钮。

| 位置 | 内容 |
| --- | --- |
| 编辑器 Header（三型统一组件） | 版本徽标（草稿 / 最新已发布 Vx）+ 环境标记（沙箱/线上版本）+ 保存状态（未保存/已保存+时间） |
| 发布对话框 | 版本描述输入 → `POST /versions`；成功后询问部署环境（沙箱/线上）→ `POST /releases`；校验失败展示 issues 并阻断 |
| 版本历史抽屉（Agent 级） | 列表 + 详情（三快照只读视图 + artifactHash + 部署记录） |
| 对话体验面板（AgentConfigDrawer / AutonomousEditor 共用） | 自动续问开关+条数；闲聊兜底开关+模型+提示词（真保存、真消费：见下） |
| 记忆 Schema 表单 | 结构化增删改（名称/描述/类型/默认值/时长）；替代 A-10 删除的自由文本 |
| 预览区 | 流式渲染 + 步骤折叠面板 + 运行中态 |

后端对对话体验的最小真消费（不许再出现死配置）：
- `autoFollowUp.enabled` → 运行输出 `output.followUps`：由最终回答的 LLM 追加一次生成（3 条以内）。
- `chitchatFallback.enabled` → autonomous：输入无 userQuery 或运行失败降级时用其模型+提示词产出兜底回复，事件标记 `fallback=chitchat`；dialogue/group：图校验未通过不启用（语义边界写明，避免假承诺）。
- `memories` 声明 → 注入 autonomous system prompt（"可用记忆变量：…"），并为 C 的 Memory Service 预留读写入口；本阶段 memory_write/read 升级为按声明键校验（未声明的键拒绝写入并留痕）。

## 8. 测试计划

pytest 新增（目标 ≥18 条）：
- 版本/发布：草稿→版本快照完整性（含图拷贝）；重复发布版本号递增；发布校验失败不落库；artifactHash 稳定（同输入同 hash）。
- Release：同环境唯一 active；回滚=重新部署旧版本；无发布版本时 api 触发 422。
- 运行解析：草稿/指定版本/环境解析三分支；冻结工具版本被执行（构造两个 ToolVersion 验证）。
- 成员嵌套按冻结版本执行；环检测静态版。
- 对话体验：续问/闲聊兜底真产出；未声明记忆键写入被拒。
- revision 冲突链路端到端。

前端手动验收步骤登记（流式、步骤面板、发布对话框、版本抽屉）。

## 9. 验收清单（映射调研 §15.1 / §15.2）

1. [ ] 三类 Agent 均可保存、刷新恢复、并发冲突可见（§15.1）
2. [ ] 发布产生不可变版本 + artifactHash，历史版本只读（§15.1）
3. [ ] 沙箱运行可固定到指定版本；改草稿不影响已发布行为（§15.1、§4.1）
4. [ ] 回滚恢复旧版本且不修改历史版本记录（§15.5 精神）
5. [ ] 发布校验拦截：空名称/未选模型/失效工具/图校验失败（§12.3）
6. [ ] 依赖冻结可见：版本详情展示冻结的工具版本清单（§8.1）
7. [ ] 对话体验开关真实生效（续问/闲聊兜底各一条证据）
8. [ ] 记忆 Schema 结构化保存，未声明键写入被拒（§8.4 方向）
9. [ ] 预览流式输出，步骤可折叠（02 §6/§7 形态）
10. [ ] 所有失败返回机器错误码 + 可读信息（§15.1）

## 10. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 图拷贝进版本后，工作流编辑与已发布 Agent 的关系让用户困惑 | 版本详情明确展示"快照时间 + 快照图"；文案说明发布后编辑不影响线上 |
| 流式改造触碰已通过的运行链路 | `llm_delta` 作为新增事件，旧事件序列不变；现有测试为回归门禁 |
| 嵌套版本上下文复杂化 | `unfrozen=true` 降级路径保底，宁可跑草稿不留死锁 |
| migration 016/017 与 A-01 的 015 顺序耦合 | 开工前核对 alembic 链，编号以实际链为准并在变更记录登记 |

## 11. 变更记录
- 2026-08-25 反思修正：新增决策 D-1（发布双 revision 校验+同事务快照）、D-2（单一 LLM 适配器）、D-4（Run.parent_run_id 运行树）；§7 增加复用/视觉基线约束与微交互清单（调研 02/03）。

## 12. 状态日志
- 2026-08-25 规格草稿完成，待冻结。
- 2026-08-25 四维反思后修正并重新待冻结。
- 2026-08-25 夜间冻结（用户授权连续施工），开工。
