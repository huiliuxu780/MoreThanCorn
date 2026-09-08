# 07 · 自查报告：结论复核（幻觉 / 遗漏）

> 日期：2026-09-04 ｜ 用户要求："review 你的结论，是否有幻想、是否有遗漏"
> 方法：第一轮结论产出后，对全部存疑点重新读码核验（不依赖探查代理的转述），并按用户新拍板（AgentScope 唯一运行时、dashboard 下掉、导航冻结）重查受影响结论。

---

## 1. 已发现并纠正的错误（4 处）

| # | 原结论 | 事实 | 处理 |
|---|---|---|---|
| 1 | 02-F6："质检总览/坐席分析**服务端聚合数据有大片空洞**" | 读 `wf-api.ts:821-880` 核实：KPI/趋势/Top 问题**是真实服务端聚合**（`/api/quality/analytics/*`，09 P1-03 已落地）；空洞仅限次级聚合——`attention/sceneQuality/attentionAgents/scenes` 是**前端硬编码空数组**，`topProblem/topScene` 硬编码 "—"，且总览函数不收参数（筛选不生效）。归因从"服务端没做"纠正为"次级聚合前端硬编码+对应服务端聚合缺失" | 已改 02 |
| 2 | 02-B12/03："大批次长期占用**唯一串行 worker**，MQ 洪峰会**打穿队列**" | 队列认领用 `FOR UPDATE SKIP LOCKED`，本身支持多 worker；真实瓶颈是**一个批次作业整批占住一个 worker 槽**。"打穿队列"表述夸大了 | 已改 02/03 措辞 |
| 3 | 04："自动布局（dagre 或等价，**替换内联实现**）" | `package.json` 无 dagre/elkjs，引入即新增依赖，不应写成既定方案 | 已改为"内联实现原样搬入，新依赖另议" |
| 4 | 06 引用 shadcn kanban 参考页 | 该站点从审查环境两次访问超时，我无法确认其具体形态 | 已在 06 标注[依据声明]：按 shadcn 系 kanban 通用形态描述，HTML 原型阶段人工对照原站校正 |

## 2. 复核中新发现的事实（第一轮报告没有的，全部影响决策）

1. **openai-agents 运行时的源码从未入库，且磁盘上源文件已丢失**：`git ls-files runtimes/openai_agents` = 0；目录里只剩 `.venv`、`.pytest_cache` 和 `app/__pycache__` 字节码（adapter/business_workflow/native_workflow/trace_mapper 等 9 个 .pyc）。含义：SDD-14 的验收结论（20/20、3/3、57/57）真实发生过（字节码与测试缓存可证运行过），但**实现代码不在仓库里，现在也不在工作区**。用户已拍板下线该运行时，方向上无损；但证据处置需要确认：接受"验收证据留在 docs，代码不保留"，还是尝试补录（见 05 §6 B5）。
2. **agentscope 运行时没有 business 工作流实现**：`runtimes/agentscope` 全目录无 business 字样。质量工作流有（`native_workflow.py`，v0.2 POC，含阶段推进/工具白名单/屏障），业务没有。**这是"只留 AgentScope"决策下最大的新增工作量**——业务打标（逐通话打标语义，20/20 已跑通）必须移植进 AgentScope 才能下线 DSH，顺序不可颠倒（05 轨道 B1→B4）。
3. **业务最新语义的载体是未入库文件**：`server/app/agent_modules/business_analysis/skills/native-business-analysis/SKILL.md` 未跟踪；最近提交 e0eb716 特意把它移出（"属并行会话产物"）。移植工作的输入材料目前在仓库外飘着，**需要明确由谁负责入库**，否则 B1 移植蓝本缺失。
4. **`_resolve_window_days` 函数注释自认**："首发支持 last_24h/last_7d/last_30d；**其余视为全量**"——审计 B14（"上一自然日"窗口不生效、读全量）二次确认成立，非推断。
5. **模型无单价字段**：`models.py` 无 price/cost 字段（grep 零命中）——06 批次成本聚合需先补模型单价配置，原文"缺单价字段则补"的判断成立。

## 3. 幻觉风险清单（无硬证据、只有软依据的断言，逐条标注）

| 断言 | 依据等级 | 风险处置 |
|---|---|---|
| 05 §4 AgentScope 2.0.7 的 API 映射（ReActAgent/Toolkit/hooks/RAG 等命名） | 训练知识 + `runtimes/agentscope/app/` 既有代码部分佐证 | 已在 05 加[依据声明]：实施以钉住版本实测为准 |
| 03 对 n8n/Zapier/Make/Airbyte/EventBridge Pipes/Kafka 消费语义的描述 | 训练知识；本会话尝试在线核验未成功（文档站抓取失败/超时） | 方向性结论可靠（均为行业稳定形态），字段级细节实施时以官方文档复核 |
| 06 对 OpenAI Batch API `request_counts`、Airflow Grid View 等的描述 | 训练知识，同上 | 同上；借用的是其"信息架构思想"而非接口细节 |
| "Kafka connector 复用 Connection 体系" | **设计提案**，非既有能力 | 03 文中已按提案表述；实施需 PoC 验证长连接凭据解析 |
| DSH 插件内行为逻辑（阶段状态机/工具 guard/屏障）的描述 | 来自 docs/poc 档案转述，未逐行读 .mjs | 移植时以插件源码为准 |

## 4. 遗漏清单

**已补进文档**：
- MQ consumer 进程归属 → 03 §3.2（独立 `run_consumer.py` 入口）；
- 事件留存/PII/限流/载荷上限 → 03 §3.4；
- openai-agents 下线的证据处置 → 05 B5；
- 两个 dashboard 下掉口径（导航摘除、文件与聚合端点保留）→ 00 §3；
- 导航冻结（含 app-sidebar 硬编码署名不修）→ 00 §4、02-F11、04 头部；
- HTML 原型人工确认闸门升级为全局闸门 → 00 §4。

**诚实披露：仍然存在的缺口（不伪装已解决）**：
- Trigger 事件的 PII 字段清单取决于真实三方载荷，只能在首个接入方对接时落；
- 批次承压的最终方案（批内并行 vs 拆作业）需要原型+压测定参数，06/03 给的是方向不是参数；
- Agent 详情页（05 §5）目前是线框级，交互细节按新闸门要走 HTML 原型确认后才算数；
- Trigger 权限模型（谁能建触发器、谁能看原始载荷）未展开，实施时按既有 RBAC 体系细化；
- 前端探查报告里"组件目录不存在 runs/tools/data-assets/result-rules"与初始任务描述的差异已按实际目录结构记录，无实质影响。

## 5. 硬证据抽样（本轮复核亲手验证过的关键项）

- 文件规模：`wc -l` 实测 wf-designer.tsx 2834 / wf-api.ts 1252 / runner.py 1750 / models.py 1047（51 模型）；
- `wf-api.ts:821-880` 原文读取：`realQualityOverview` 调 `analyticsApi.kpi/trend/topIssues`（真），`attention: []`、`sceneQuality: []`（硬编码）；
- `task_runner.py:47-51` 原文读取：窗口解析函数及其"其余视为全量"注释；
- `runtimes/agentscope/README.md`（2.0.7 钉住、无凭据失败关闭）与 `native_workflow.py` 头部（质量阶段工作流自述）；
- `git ls-files runtimes/openai_agents | wc -l` = 0；`ls -R` 仅字节码；
- 三个 `manifest.yaml` 的 `agentscope:` + `deepseek-harness:` 双实现声明；
- `package.json` 无 dagre/elkjs；`models.py` 无 price/cost。

## 6. 总体评价

第一轮 40 条审计结论与四份设计稿的主干判断**没有方向性幻觉**：证据链来自 4 个独立探查代理的文件:行号级取证，本轮抽验未发现编造。错误集中在**两处归因粗糙**（F6、worker 并发）与**两处表述过满**（dagre、kanban 站点），均已修正。最大的遗漏不是写错了什么，而是第一轮**没有主动去翻 `runtimes/openai_agents` 的 git 状态**，导致"保留 openai-agents 为备选"的建议建立在错误前提上——幸好用户拍板全下线，反而绕开了这个坑；但该发现本身（源码未入库）必须上报，已列入 05 B5 与本文 §2-1。
