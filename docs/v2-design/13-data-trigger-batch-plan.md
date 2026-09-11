# 13 号稿：数据接入 → 自动触发 → 三执行体 → 攒批 成熟方案（2026-09-11）

回答用户三问：能不能接入数据自动触发任务？flow/agent/agentflow 能不能执行？批量怎么做（攒批还是别的）？
结论：**前两者平台已具备生产级闭环（下面给证据），缺的只有「攒批层」与并发治理；本稿给出业界标准做法的落地设计。**

## §1 现状盘点（as-is，全部有代码证据）

### 1.1 数据接入
- `DataSource`（models.py:1356）：kind=webhook|polling|test_event；config 存订阅参数；auth_token_hash 鉴权；cursor 游标；status active|paused|error。
- `DataSourceEvent`（models.py:1372）：入站事件全状态（去重/过滤/映射/派发/死信）。
- 入口三通道：
  - webhook 接收端点 `as_automations.py:1036`（带 token 校验）；
  - polling 拉取 `tick_poll_source`（:976，watcher 30s 周期驱动，游标/去重/死信在 ingest 内）；
  - 手动试投 `test_event`（:1024）。
- 管理 UI：`/data-sources` 页存在（app.tsx:24）。

### 1.2 自动触发
- `AutomationTrigger`（models.py:1200）：kind=schedule|api|event|polling，**每个自动任务最多 5 个触发方式**；config={cron,timezone}|{data_source_id,filter,mapping}。
- API 触发：`invoke`（:661）+ 每任务 API key（:624）。
- 后台闭环 `automation_watcher.py`：30s daemon（PG advisory lock 单实例）——schedule 回写、max_runs 准入、终态对账、polling tick、一次性 run 结算。
- 触发事实日志 `AutomationTriggerLog`：received/accepted/running/completed 四态留痕。

### 1.3 三执行体派发
- `ingest`（:782）→ 过滤/映射 → `EventDelivery`（pending→completed/failed/dead，`_schedule_retry` 退避重试+死信）→ `dispatch` 按 automation.target_kind 派发 **agent（session/turn）| workflow（run）| agentflow（release run）** 三执行体。
- 出站治理：`egress.py`（SSRF 闸 + Outbox 语义）；告警 webhook 尽力投递（alerts.py）。

### 1.4 批量现状
- 质检/业务链已有 `trigger_kind="batch"` 的 run（agent_execution.py:779）——**单次批量 run 存在**（输入 items[] 一把跑）。
- **缺**：事件流的攒批窗口（把 N 条事件合成一次 run）、并发池/背压、批量看板、batch 级幂等重放。

## §2 攒批成熟方案（to-be）

业界两流派：①**窗口攒批**（tumbling window：时间 T 或条数 N 先到先flush，Kafka/Flink 语义）；②**流式微批**（slide，延迟低但 run 数多）。本平台事件量级（质检通话/工单）选 **①为主 + size 提前触发**，理由：run 有真实 LLM 成本，合并窗口直接省钱；时延要求分钟级足够。

### 2.1 数据模型（一张表够用）
```
batch_group: id, source_id, group_key(可空=不分组), window_start,
             mode: size|time|size_or_time, size_n, time_sec,
             item_ids: DataSourceEvent.id[], state: open|flushing|flushed|dead,
             run_id( flush 产物 ), created_at, flushed_at
```
- group_key 支持按业务键分组（如 business_line/日期），实现「同组攒一批」；
- flush 条件 watcher 每 tick 检查：`len(item_ids)>=size_n` 或 `now-window_start>=time_sec`。

### 2.2 执行层
- flush → 复用现有 batch run 通道：`dispatch(target, input={items: mapped[]})`，trigger_kind="batch"，batch_id 写入 Run.input 作**幂等键**（重放同 batch 不重复执行：start 前查 run by batch_id）。
- **并发池**：PG `SELECT ... FOR UPDATE SKIP LOCKED` 作业队列（job 表=batch_group flush 任务 + 现有 run 任务），worker 数=每 release 配额（默认 2，配置化）；背压=队列深度阈值暂停 ingest 派发（EventDelivery 保持 pending 不丢）。
- 重试/死信：**复用 EventDelivery 机制**（batch 级 delivery 一行，状态同事件级）。

### 2.3 观测与 UI
- 看板加「批次」lane：received/accepted/flushing/completed/failed 计数（TriggerLog 已有四态，batch 加 group 维度聚合）；
- 自动任务详情加「攒批配置」卡（mode/size/window/group_key）+ 当前 open 组预览；
- 批次详情=items 列表 + 派生 run 链接（run-detail 已有）。

### 2.4 实施切片（每片独立可验收）
- S1 模型+watcher flush（无 UI，配置走 API）+ 幂等：≈1 迁移+watcher 一段+测试；
- S2 并发池+背压（job 表 SKIP LOCKED）；
- S3 UI 两卡（攒批配置+批次 lane）；
- S4 webhook 一期加固（token 轮换+签名校验头）+ polling 源 UI 补游标可视化。
顺序 S1→S2→S3→S4；S1 落地即「攒批」可用。

## §3 直接回答用户
- **接入数据自动触发**：能，今天就能——webhook/polling/API/定时四通道已通，事件经去重/过滤/映射/重试/死信派发；缺的只是攒批与并发治理（§2）。
- **flow/agent/agentflow 执行**：三执行体派发已闭环（dispatch 按 target_kind），自动任务执行者三选一新建时已暴露。
- **批量怎么做**：单次批量 run 已有；事件流批量=§2 窗口攒批（size_or_time tumbling window + group_key + 幂等重放 + SKIP LOCKED 并发池），不发明轮子，全部复用现有 EventDelivery/watcher/run 通道。

## §4 验收清单（S1 起）
- 单测：window flush 三模式（size 提前/time 到期/混合）、group_key 分组、幂等重放不双跑、死信进 dead；
- 活体：test_event 连投 6 条（size=5）→ 观察 open 组 flush 一次 run、items=5、第 6 条进新组；
- 门禁：pytest/vitest/ui-standard/theme4 全绿 + 看板批次 lane 截图。
