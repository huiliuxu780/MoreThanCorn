# 09-18 端到端全链路真跑存证

问题：**agent 能不能端到端真实跑通 数据=任务=agent=run=结束，且 agent 带工具/提示词/skill。**
答案：**能。** 三连跑全部 COMPLETED，prompt/skill/工具三类装配全部在运行期被真实消费。

## 链路（全部走平台 API，无直写 DB）

```
SLS bsh 生产日志(阿里云, 真实拉取)            webhook/test-event 入口(真实 payload)
        │                                              │
        ▼                                              ▼
   data_source_event ── EventRoute(filter: content contains ERROR) ──► EventDelivery
        │
        ▼
   automation「生产ERROR事件分析-0918」(max_runs=3 原子闸门)
        │  render_prompt({{content}})
        ▼
   Invocation(automation_trigger_log) ── start_session(fresh)
        │
        ▼
   AgentScope 2.0.8 runtime(8301)：冻结 release = rolePrompt(identity) + SKILL.md(workspace) + 2 tools(PlatformHttpTool)
        │  真 LLM qwen3.8-max(DashScope)
        ▼
   工具真调用：Skill(工作区) / knowledge_search(平台→HTTP 200) / 工单查询 dubbo(AKSK 签名→gw.dev-corn 真实外呼)
        │
        ▼
   invocation COMPLETED + delivery COMPLETED(terminal 策略 watcher 结算) + 会话消息持久化
```

## 三连跑结果

| # | 入口 | 事件（真实生产日志） | 工具调用 | invocation |
|---|------|---------------------|----------|------------|
| 1 | SLS 真拉取(poll) | 09-16 16:15:12 ES `index_not_found_exception`(ads_tb_crmxspace_ltpp_real_sea) | Skill 真加载 | f6389f7d COMPLETED 11:37 |
| 2 | SLS 真拉取(poll) | 09-16 16:15:13 同上另一条 | Skill + knowledge_search(200, articles=[]) | 44a38bfe COMPLETED 11:49 |
| 3 | test-event(库内真实 payload 原样) | 09-13 18:02:53 ServiceTicket/博西 CRM BusinessException | Skill + knowledge_search + 工单查询 dubbo(**AKSK 真外呼**, 网关返回 SystemError 被如实引用) | 7546109d COMPLETED 11:52 |

agent 输出质量：三次均按 Skill 规程给出 一句话结论/影响面/建议动作/证据；工具返回为空或业务报错时**如实登记、不编造**（run2 明确写"本条日志未出现 ticketId…故未调用；已在证据节如实登记"）。

## 实体 ID

- Skill `e23d4e4b2ee0413cad6cc678f159876a`（热线日志事件分析规程，.md 上传）
- Agent `d95aa5d02a8f44a29da896cfb316fa64`（数据事件分析员-0918，custom，qwen3.8-max）
- Release `c0fcf1d2ea36434684ed32e02e56ac57`（prod，冻结 rolePrompt+2 tools+1 skill）
- Automation `81e044b9a50840d88e7340d6e1705523`（max_runs=3 已耗尽=后续事件被闸门拒）
- EventRoute `c1ab9465f5a7481c9ed066d69498d4ac`（SLS 源 → automation，completionPolicy=terminal）
- 工具：`08c43094…`(工单查询 dubbo, AKSK) + `12e97c5d…`(knowledge_search, dev fixture 后端)

## 复跑

`server/.venv/bin/python assets/2026-09-18-e2e-fullchain/run_e2e_fullchain.py`（stage1-10，断点续跑 --from-stage N）。
注意：本 automation max_runs 已耗尽；复跑需新建 automation 或调大 max_runs。SLS 源已恢复 paused。

## 本轮发现并修复的平台缺陷

1. **事件聚合误标 failed**（已修，`server/app/routers/as_automations.py` ingest 聚合）：
   completionPolicy=terminal 成功派发 delivery=running（等 watcher 结算），聚合只认 completed
   → 成功事件被标 `failed/all deliveries failed`。活体证据 event 53a6ad7a…（delivery completed、
   invocation COMPLETED 却事件 failed）。修复=running/pending 视同已派发；回归测试
   `test_terminal_policy_event_status_dispatched`（负向对照：撤修复必红）。已修数据行 1 条。
   全量 pytest 645/645 绿。

2. **会话页用户消息文字墙**（已修，`src/pages/agent-chat.tsx`）：用户消息裸 `<span>{text}</span>`
   既不保换行又不限长——事件触发自动任务注入的 9KB 生产堆栈把会话页撑成 2848px 文字墙
   （用户指认"对话内容都炸了"）。修复=超 1500 字走组件库既有 `MessageBubbleCollapsible`
   （6 行 line-clamp+渐变遮罩+展开/收起），短文本补 `whitespace-pre-wrap` 保换行。
   实测：用户消息 2848px→190px（折叠）/5649px（展开，94 换行全保留）；tsc -b 绿、vitest 174/174 绿。
   截图 evidence/ui-4-session-collapsed.png。

3. **工具面板双重序列化**（已修，`src/lib/tool-display.ts` 新共享 helper + agent-chat /
   node-run-panel 接入）：运行时 tool_result 原始形态是 content-block 信封数组、input 常为
   JSON 字符串，旧代码直接 stringify → 展示 `"{\"ticketId\": …}"` 与
   `[{"type":"text","text":"{\"status_code\":200…"}]` 双重转义（用户指认"为什么不优雅展示"）。
   修复=toolResultText 取信封文本 → unwrapJsonString 解字符串信封 → JSON 对象缩进 2 空格、
   非 JSON 保持原文、超 cap 截断附诚实注记。a11y 快照实证展开内容已为缩进 JSON；
   截图 evidence/ui-5-tool-pretty.png。tsc -b 绿、vitest 174/174 绿。

## 诚实差距清单（未修，登记待拍板）

1. **OAT 凭据失效**：corn-prod 登录 40001（09-14 后疑似已轮换）；OAT 系工具（服务单/CRM 查询）
   全部不可用。AKSK 网关(gw.dev-corn)签名有效，但 Apifox 示例业务 ID 全过期（09-14 已知），
   外呼返回业务错误——run3 已如实展示该形态。要"工具返回真业务数据"需用户给新凭据/新业务 ID。
2. **fixture 工具 input_schema={}**：knowledge_search 等四只读工具 schema 空，模型不知道传 query
   （run2/3 均空参调用返回空集）。agent 在结论里自曝"未传 query"。应补 schema（query 必填）。
3. **任务看板(/tasks)不投影事件触发 invocation**：首页"全部任务 共 0 条"，三次 run 只在
   自动任务详情→运行历史与 Agent 会话页可见。F4 统一看板投影未覆盖 event 触发链路。
4. **自动任务详情"触发条件"显示"未配置触发（仅手动）"**：真实触发来自 EventRoute（数据侧配置），
   该页不展示 route 反查——IA 接缝，易误读。
5. **旧事件不重路由**：ingest 去重分支对已入库(含 filtered)事件不再匹配新建 route——新 route 只吃
   新事件。设计如此（防回灌），但"给历史数据补路由"无入口，需显式登记。
6. run 表无 event 触发投影（09-16 即存在）：观测/run 列表看不到这些执行，会话页才是家。
   （09-18 观测 IA 拍板"run 列表+run 详情接 agent 执行数据"落地后需复核。）

## 证据文件

- evidence/stage1..stage10-*.json：各阶段 API 响应
- evidence/run1/2/3-messages-raw.jsonl：三次会话全量消息（含 tool_call/tool_result 原文）
- evidence/ui-1-automations-list.png：自动任务列表（累计 3 次/启用）
- evidence/ui-2-automation-detail.png：任务详情（运行历史 3×event completed + Session 链接）
- evidence/ui-3-session-tools.png：会话页（Skill/knowledge_search/工单查询 三工具芯片全已完成、
  输入输出原文、"触发：事件触发（自动任务）"、1 次模型调用/3 个工具）
- evidence/ui-4-session-collapsed.png：文字墙修复后——用户消息折叠 6 行+渐变+展开按钮，
  会话页恢复可读（修复前 2848px 文字墙）
- evidence/state.json：链路实体 ID 状态
