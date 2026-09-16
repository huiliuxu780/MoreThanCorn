# 15 号稿：数据连接与自动任务触发扩展调研（2026-09-12）

> **状态：`RESEARCH / 决策支持材料，待拍板`**。本文只做调研与建议，不实施、不改边界。
> 边界仍服从 `docs/v2-design/03-trigger-and-data-mapping.md`（BOUNDARY_FROZEN，首个真实场景前不冻结模型）
> 与权威 Spec `docs/product-domain/execution-automation-batch-spec.md`（默认一触发一执行、
> 入口攒批须实测数据、§20 非目标）。与两者冲突处一律以它们为准。

## 0. 调研问题与结论速览

用户四问 + 两问：

| # | 问题 | 一句话结论 |
|---|---|---|
| 1 | 数据库连接怎么接（作为触发源/数据源） | 业界三路线：定时轮询+游标 / PG LISTEN-NOTIFY / CDC。**一期只做轮询+游标**（复用 watcher+DataReader），CDC 留升级路径；选型矩阵见 §3.2 |
| 2 | MQ 监听怎么做 | Kafka/RocketMQ 语义已查清；**先持久化再 ack 的既有口径与两家官方最佳实践一致**；实现门槛=需要真实 broker 信息，见 §3.3 |
| 3 | 被 call API（webhook） | **四通道里唯一已实现的一路**，但只做 token 校验；业界标准序（验签→快速2xx→落库→异步→幂等）有一批低成本低风险加固项，见 §3.1 |
| 4 | 获取 DataWorks 表 | 全仓首次调研；OpenAPI 两版本、元数据链路、QPS 配额（基础版几乎不可用）、OpenEvent 事件订阅（企业版门槛）全部查清，见 §3.4 |
| 5 | 成熟任务平台怎么做 | Zapier/Make/n8n/Dify/Temporal/Airflow/Prefect/Dagster/Inngest/Hookdeck 十家触发模型对比完成，见 §2 |
| 6 | 各类型代码怎么写、成熟参考 | 每节附「成熟代码参考」小节（官方文档+开源仓库路径），映射到我们模型的建议集中在 §4 |

**范围收敛（2026-09-12 用户拍板）**：对接面主要是**阿里云上的产品 + 已有系统的接口**。据此新增 §3.5（EventBridge 统一事件总线 + 轻量消息队列 MNS/SMQ + 三个接入场景的选型矩阵），§5 排序与拍板项已按阿里云线收敛：EventBridge HTTP 目标与我们 webhook 入口共用收口；MQ 形态取决于客户侧已有 RocketMQ/Kafka/MNS 哪种。

**总建议排序**（详见 §5）：P0 webhook 加固（纯安全、不动架构）→ P0.5 EventBridge 订阅阿里云产品事件（HTTP 目标复用 webhook 入口 + CloudEvents→DataSourceEvent 转换层）→ P1 DataWorks 元数据拉取 → 按需：DB 轮询触发源（直连 RDS/客户库时）/ MQ 直连（客户已有 RocketMQ/Kafka）/ MNS 队列（已有系统大流量）→ 二期 OpenEvent 事件链（DataWorks 企业版门槛）。

---

## 1. 既有口径与现状锚点（先对齐，避免重复设计）

### 1.1 已实现（全部有代码证据）

- **触发五型**：manual / schedule / api / event / polling（`AutomationTrigger`，最多 5 触发方式）。
- **入口三通道**：webhook 接收端点（X-Source-Token 校验）、polling 拉取（`tick_poll_source`，watcher 30s 周期）、test_event 手动试投。
- **事件治理链**：`DataSourceEvent`（`source_id+dedupe_key` 唯一去重）→ filter → mapping → `EventDelivery`（退避重试+死信）→ `AutomationInvocation` → 三执行体派发。
- **数据库读取**：`data_readers/postgres.py` 已是真实实现（SELECT 1 探活 + keyset 分页 + 时间窗），但**只服务分析取数，不是触发源**。
- **出站**：`egress.py`（SSRF 闸）+ `delivery.py`（ResultDelivery Outbox）。
- **调度**：`automation_watcher.py` 30s daemon（PG advisory lock 单实例）。

### 1.2 缺口（本次调研对象）

| 缺口 | 现状 |
|---|---|
| MQ 监听 | **全仓零实现**（kafka/rabbitmq/mqtt grep 无命中）；设计只到 03 号稿最小契约 |
| 数据库作为**触发源** | 无（DataReader 只是分析取数；polling 类型 DataSource 是拉 API/feed 的通用拉取，无 DB 游标语义） |
| DataWorks | 全仓（docs/research/src/server）零提及 |
| webhook 接收加固 | 只有静态 token，无 HMAC 签名/时间戳防重放 |

### 1.3 红线（调研建议不得越过）

- 03 号稿：MQ 的「具体存储与 at-least/exactly-once 语义必须随首个 Broker 实测，不在文档造表」；filter/mapping/dedupe/batching 属数据接入层，一期只允许确定性可预览表达式；轮询调度与 Agent 执行调度是两个职责。
- 权威 Spec §10.3：入口攒批六项实测门槛；§20：不实现没有真实输入场景支撑的通用 MQ 抽象、不建 Temporal 级分布式调度平台。
- 调研中的任何「设计点」都是给**首个真实场景落地时**用的素材，不是现在就建的表。

---

## 2. 成熟平台触发模型对比

### 2.1 对比总表

| 平台 | 触发类型枚举 | 轮询去重机制 | 推送事件机制 | 幂等模型 | 重试/死信 | 触发方式数量上限 |
|---|---|---|---|---|---|---|
| Zapier | polling / REST hook | 主键 `id`：激活时缓存 seen-ids，poll 比对只触发新 id；updated 场景用 `id+updatedAt` 组合新主键 | per-Zap 唯一 webhook URL + subscribe/unsubscribe 生命周期 + `X-Hook-Secret` 握手；**无 HMAC** | 平台侧 seen-id 集合 | Autoreplay 重试（细节未核实） | 无明确上限（轮询间隔按套餐 1–15min） |
| Make | polling（Watch* 系列）/ instant（webhook） | "since the last scenario run" 平台侧比对；**无新数据的轮询显式建模为 check run** | webhook 排队到下次 run | 未核实 | 未核实 | 无明确上限 |
| n8n | Schedule/Webhook/IMAP/RSS/Kafka/Postgres 等 Trigger 节点 | `getWorkflowStaticData('node')` 存 seen ids；**坑：仅 active 时持久化，测试态不保存** | Webhook 节点 4 种 respond 模式（立即/末节点结束/显式 Respond 节点/流式） | 用户流程内自建 | 执行级重试（未核实） | 无明确上限 |
| Dify (v1.10+) | Schedule / Plugin 事件 / Webhook——**三类都是 Start 节点变体**，多 trigger 用 Variable Aggregator 汇聚 | —（无轮询型） | 唯一 callback URL（自托管经 `TRIGGER_URL`） | 未核实 | 未核实 | 多 trigger/workflow 允许 |
| Temporal | Schedule（cron）/ Signal（外部事件）/ API | — | Signal / Signal-with-Start；服务端 request-id 去重 + 官方建议业务自带 idempotency key | 业务级 key | Workflow 级重试模型 | Schedule 有 Action 上限（超限自动 pause） |
| Airflow | cron / Dataset(2.4)→Asset+AssetWatcher(3.x) / sensor 轮询 | sensor 由用户实现 | Asset 事件、deferrable trigger | dagrun 去重 | task 重试 | — |
| Prefect | 状态变化/事件/**missing-event（预期事件缺失告警）**/webhook | — | webhook→Jinja2 模板→Event（成功仅回 204） | 事件 `id` 字段 | 未核实 | — |
| **Dagster** | schedule / sensor（+ GraphQL 推事件） | **cursor（字符串，tick 成功才推进；失败不推进=at-least-once）+ run_key 双层去重** | GraphQL API 推事件 | run_key 去重 | tick 默认 60s 超时即失败 | — |
| Inngest | event / cron / webhook | 事件 `id`（24h 窗口） | SDK ingest | **idempotency（CEL key）+ throttle + concurrency + debounce 四正交 policy** | 自动重试 + attempt 计数 + NonRetriableError | debounce 上限 7 天 |
| Hookdeck | —（纯 webhook 接收层） | — | — | 事件 ID | 非 2xx 重试默认，上限 50 次，尊重 Retry-After（≤7 天），failed 保留可重放 | — |
| Stripe/GitHub | —（发布方规范） | — | — | Stripe-Event-ID / X-GitHub-Delivery | Stripe 3 天指数退避 / GitHub 10s 内回 2xx | Stripe 16 endpoints |

来源：Zapier [Trigger](https://docs.zapier.com/integrations/build/trigger)/[Deduplication](https://docs.zapier.com/integrations/build/deduplication)/[REST Hook](https://docs.zapier.com/integrations/build/hook-trigger)；Make [模块类型](https://help.make.com/types-of-modules)；n8n [Trigger 索引](https://docs.n8n.io/integrations/builtin/trigger-nodes/)/[Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)/[static data](https://docs.n8n.io/build/code-in-n8n/cookbook/built-in-methods-and-variables-examples/getworkflowstaticdata)/[轮询博客](https://blog.n8n.io/creating-triggers-for-n8n-workflows-using-polling/)；Dify [Trigger 公告](https://dify.ai/blog/introducing-trigger)/[overview](https://docs.dify.ai/en/cloud/use-dify/nodes/trigger/overview)/[代码](https://github.com/langgenius/dify)（`api/core/workflow/nodes/` 下 trigger_* 三目录）；Temporal [Schedules](https://docs.temporal.io/schedule)/[Handling Messages](https://docs.temporal.io/handling-messages)；Airflow [Datasets 2.9](https://airflow.apache.org/docs/apache-airflow/2.9.0/authoring-and-scheduling/datasets.html)/[Assets 3.x](https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/assets.html)/[Sensors](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/sensors.html)/[Deferring](https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/deferring.html)/[3.2 博客](https://airflow.apache.org/blog/airflow-3.2.0/)；Prefect [Webhooks](https://docs.prefect.io/v3/concepts/webhooks)/[Events](https://docs.prefect.io/v3/concepts/events)/[Automations](https://docs.prefect.io/v3/concepts/automations)；Dagster [Sensors](https://docs.dagster.io/guides/automate/sensors)/[API](https://docs.dagster.io/api/dagster/schedules-sensors)/[超时](https://docs.dagster.io/deployment/troubleshooting/sensor-timeouts)/[daemon 源码](https://github.com/dagster-io/dagster)（`python_modules/dagster/dagster/_daemon/sensor.py`）；Inngest [Flow Control](https://www.inngest.com/docs/guides/flow-control)/[幂等](https://www.inngest.com/docs/guides/handling-idempotency)/[Debounce](https://www.inngest.com/docs/guides/debounce)/[Retries](https://www.inngest.com/docs/functions/retries)；Hookdeck [Retries](https://hookdeck.com/docs/retries)/[接收实践](https://hookdeck.com/docs/use-cases/receive-webhooks)；Stripe [Webhooks](https://docs.stripe.com/webhooks)；GitHub [Best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)/[验签](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)。

### 2.2 可借鉴要点（按对我们的价值排序）

1. **Dagster sensor 的 cursor 语义 = 我们 polling 触发源的直接对标**：cursor 是 per-sensor 字符串状态；**tick 失败不推进 cursor（at-least-once），成功才原子写入**；run_key 与 cursor 双层去重（注意官方警告：想重置 cursor 就不要用 run_key）；`minimum_interval_seconds` 是下限不是精确频率；60s 超时，官方建议用 cursor 把昂贵评估分块。
2. **Zapier seen-ids + `id+updatedAt` 组合主键**：最朴素的轮询去重语义；「同一 id 更新要不要重触发」的矛盾官方答案就是组合新主键。
3. **Stripe/GitHub 的 webhook 接收序**：验签（HMAC-SHA256+时间戳 tolerance，constant-time 比较，raw body）→ 快速 2xx → 落库 → 异步处理 → 按事件 ID 幂等。GitHub 的 `X-GitHub-Delivery` 在重投时**保持同一 ID**，天然 dedupe key。
4. **Inngest 四 policy**（idempotency/throttle/concurrency/debounce）是「准入层」最完整的公开设计；且区分 rate-limit（丢弃）与 throttle（排队）两种语义。对应我们 Spec §7.4 准入顺序的扩展方向。
5. **Temporal Schedule overlap policy 六档 + catchup window**：定时触发的重叠/补跑语义完备答案（默认 Skip；catchup window 默认一年、最小 10s）。对应我们 schedule misfire policy 的细化参考。
6. **Make 的 check run**：无新数据的轮询显式建模为「检查运行」，可观测、不污染 run 历史——对应我们 TriggerLog 可以区分「轮询无产出 tick」与真实触发。
7. **Airflow poke/reschedule/deferrable 三档**：轮询占资源的完整谱系；30s 常驻 watcher 属 poke 型，低频轮询可借鉴 reschedule 思路。
8. **Prefect missing-event**：「预期事件缺失」告警是 automation 隐藏刚需（心跳式对账）。
9. **n8n static data 的坑**：轮询状态不能依赖内存/非事务存储——我们的 cursor 状态必须事务化落库。

---

## 3. 四类接入逐项调研

### 3.1 被调 API / Webhook 接收（已有，建议加固）

**现状**：`POST /api/v2/ingress/webhook/{sid}` + X-Source-Token 校验 + dedupe_key 去重 + EventDelivery 链。方向正确，缺业界标准的签名层。

**业界标准序**（Stripe/GitHub/Hookdeck 三方一致）：

```text
验签(常量时间比较, raw body) → 快速 2xx → 事件落库 → 异步处理 → 按事件 ID 幂等
```

**差距与建议加固清单**（均为接收端安全项，不动架构）：

| # | 项 | 业界参照 | 建议 |
|---|---|---|---|
| W1 | HMAC 签名可选启用 | Stripe `Stripe-Signature: t=<ts>,v1=<sig>`（HMAC-SHA256 of `"{timestamp}.{raw body}"`，官方 tolerance 默认 5 分钟且禁止 0）；GitHub `X-Hub-Signature-256=sha256=<hex>` | DataSource 增加 `signing_secret` 可选字段；配置了才验签，未配置保持 token-only（兼容现有内部调用方） |
| W2 | 时间戳防重放 | Stripe：超出 tolerance 拒绝 | 同上，t= 超过 5 分钟拒绝 |
| W3 | 常量时间比较 | 两家官方均明令禁止裸 `==` | 用 `hmac.compare_digest` |
| W4 | 快速 2xx 后异步处理 | GitHub：10s 内回 2xx 否则判失败；Stripe：先 2xx 再复杂逻辑 | 我们已是 202 accepted + 异步派发，合规；保持 |
| W5 | 幂等用对方事件 ID | Stripe：按 Event-ID 追踪重复；GitHub：delivery ID 重投不变 | 文档化 dedupe_key 推荐值=调用方事件 ID；调用方无 ID 时才用 payload hash |
| W6 | secret 轮换双活 | Stripe：secret 滚动期 24h 双活 | 轮换窗口内新旧 secret 同时可验 |
| W7 | 死信可重放 | Hookdeck："Without a dead-letter strategy, failed events silently disappear"；failed 事件保留可手动重放 | EventDelivery 已有 dead 态；确认重放入口与 dedupe_key 幂等保护 |

### 3.2 数据库连接作为触发源（新增；一期推荐轮询+游标）

#### 3.2.1 三条路线

| 路线 | 机制 | 优势 | 硬伤 |
|---|---|---|---|
| **P：定时轮询+游标** | 周期性 `SELECT ... WHERE cursor_col >= :last_value` | 只需只读账号；跨库通用（MySQL/Oracle/MSSQL/PG 同构）；零额外组件 | 只见 UPSERT **看不见 DELETE**；延迟=轮询周期；需游标列+索引 |
| **N：PG LISTEN/NOTIFY** | 业务表建 trigger 函数 `pg_notify`，监听长连接 | PG 独有的轻量准实时 | 仅 PG 且需建 trigger 的 DDL 权限；payload ≤8000 字节；**不在线即永久丢失**（无持久化/补发），必须「启动回查+轮询兜底」合流；通知队列满(标准 8GB)时 NOTIFY 事务 commit 失败 |
| **C：CDC** | 读事务日志（Debezium/逻辑解码/binlog） | 完整变更序、捕获 DELETE/旧值、不改数据模型、停机不漏 | 运维重：PG 需 `wal_level=logical`+REPLICATION 角色+复制槽（**槽不消费时 WAL 无限累积**，可致库盘满，需 `max_slot_wal_keep_size`）；MySQL 需 ROW binlog+复制账号；Oracle LogMiner 需 DBA 深度配合（XStream 需 GoldenGate 授权）；PG 逻辑解码不捕获 DDL |

核心论据：Debezium 官方《Five Advantages of Log-Based CDC》——轮询"might miss intermediary data changes"且"will not allow you to identify any records that have been deleted"；Airbyte 官方换 CDC 三条件：**需要删除记录 / 库 ≥500GB / 没有合理 cursor 列**。业界共识：**轮询是默认起点，规模/删除/低延迟是升级 CDC 的触发条件，NOTIFY 只是 PG 补充**。

#### 3.2.2 选型矩阵

| 客户库场景 | 推荐 |
|---|---|
| 任意库，普通只读 SELECT 账号 | **P**（唯一通用路线；时延≈30s 量级） |
| PG，可建 trigger，需准实时 | N + P 回查兜底；要 delete/旧值→C |
| PG，大库（≥500GB）或需删除捕获 | **C**（Airbyte 官方三条件） |
| MySQL，DBA 可开 ROW binlog+复制账号 | 时延敏感→C（Debezium 或 python-mysql-replication），否则 P |
| Oracle 生产库 | 默认 P，特批才 C |
| 网络受限/禁止常驻连接 | P（低频批量） |

#### 3.2.3 成熟实现的关键机制（我们抄语义，不抄代码）

- **游标持久化**：Logstash jdbc input 把 `sql_last_value` 每轮查询后立即落盘（`last_run_metadata_path`，多 input 必须各自独立路径）；Airbyte 把 state 中心化存平台侧。→ 我们对应：**per-trigger 游标行，事务化 upsert**（对应 Dagster per-sensor cursor）。
- **列值游标 vs 时间游标**：Logstash `use_column_value=true`（numeric/timestamp 两型）与 `false`（用采集端本机时钟）是一组官方样本取舍；**numeric 自增列不受时区/DST/时钟回拨影响最稳，timestamp 列更通用（行更新也推进）**。初始值约定：timestamp→epoch，numeric→0。
- **重叠式推进**：Airbyte 官方立场"sources should prefer resending data if the cursor field is ambiguous"——查询条件用 `>=` + 下游按主键幂等（宁重勿漏）；cursor 列**必须有索引**，否则全表扫描。
- **keyset 分页**：Use The Index, Luke——OFFSET 深翻页越走越慢且分页间隙插入会重复/漏读（"The idea to use the number of rows seen to skip over them later is simply wrong"）；标准写法 `WHERE (key > last) ORDER BY key LIMIT n`，多列用行值比较。**我们 `data_readers/postgres.py` 的 `read_page` 已是 id 单列 keyset，方向正确；增量触发场景需扩展复合游标 `(updated_at, id)` 防同时间戳多行漏读**。
- **删除感知（轮询路线的必要补偿）**：①软删标记列（约定优先，不支持则降级）；②低频全量对账（按主键 count/校验和/分页 diff，复用 DataReader，每日级兜底）；③CDC 一劳永逸。Debezium 的 incremental snapshot 本质也是快照对账，将来可作为 CDC 数据修复通道。
- **Python 监听侧（若走 N 路线）**：asyncpg `add_listener`（注意连接池归还连接会移除监听，需 `create_pool(setup=...)`）；psycopg3 `notifies()` 生成器或 `add_notify_handler`（官方建议 autocommit；生成器循环独占一条连接）。参考实现：n8n Postgres Trigger（`packages/nodes-base/nodes/Postgres/PostgresTrigger.node.ts` + `.functions.ts`，函数体即 `perform pg_notify($2, row_to_json(NEW)::text)`；注意它把整行 JSON 塞 payload，宽行撞 8000B，我们不应照抄，只发主键）。
- **CDC 参考实现**：Debezium（PG 默认 pgoutput 插件，wal2json 自 1.8 弃用；MySQL binlog ROW；Oracle LogMiner 默认）；**Debezium Engine 是纯 Java API，Python 不能直接用**；现实路径是 **Debezium Server 独立进程 → HTTP sink 推送**（每实例单连接器，官方定位偏早期，文档原话"Please let us know if you encounter any problems"）。python-mysql-replication 可用但无 schema 演进处理（加列/删列致解析错位），只适合自建小规模。
- **CDC 运维代价清单**：复制槽膨胀（Gunnar Morling《The Insatiable Postgres Replication Slot》：不活跃槽每 5 分钟 64MB WAL 段）、DDL 变更流程、REPLICA IDENTITY 权限、崩溃恢复仍是 at-least-once。

#### 3.2.4 一期设计点清单（供首个真实场景立项用）

1. **游标状态表**：`trigger_cursor_state(trigger_id, column, column_type, value, updated_at)`，拉取成功后事务性 upsert；失败不推进（Dagster 语义）。
2. **首跑模式两选**：`full_first`（从初始值分页跑完全量再增量）与 `now_first`（起点=当前，只看新数据）。
3. **回拨容忍**：游标一律取**数据库列值**；查询 `>=` 重叠 + lookback 窗口（如 cursor−60s）对冲客户库时钟漂移；统一 UTC；timestamp 列要求 `timestamptz` 或明确时区约定（Logstash 文档点名 DST 歧义时间戳会查询失败）。
4. **删除感知**：默认软删列约定 + 每日低频对账兜底。
5. **限流**：30s 默认周期；无索引的 cursor 列拒绝配置并给 DDL 建议；失败指数退避；同客户库多 trigger 合并调度节流。
6. **CDC 升级预留**：游标抽象为 `(column, type, value)` 三元组（与 Debezium offset/LSN 同构）；内部事件契约 `(table, pk, op, before, after, ts)`，轮询期 op 恒为 UPSERT，CDC 接入时自然出现 DELETE；CDC 作为触发后端的第二实现（Debezium Server HTTP 推送→我们 webhook 接收端点），不推翻轮询层。

### 3.3 MQ 监听（新增，全仓空白）

#### 3.3.1 Kafka 消费者语义（官方文档核实）

- **offset 提交时机是 at-least-once 的关键**：`enable.auto.commit` 默认 true（5000ms 周期），意味着崩溃可能丢消息；**标准姿势=关自动提交，处理完成（含持久化）后手动 commit**。重复投递由消费端幂等吸收。
- **两个超时分工**：`session.timeout.ms`（默认 45s，后台心跳线程，防「进程死」）vs `max.poll.interval.ms`（默认 5min，**防「线程活着但处理卡死」——在消费回调里做长处理会反复触发 rebalance 的直接官方依据**）。注意 KIP-848 新协议（`group.protocol=consumer`）下 session.timeout 不再支持。
- **背压**：`pause()/resume()` partitions；rebalance 用 `cooperative-sticky` 减少迁移但**不消除重复**。
- **重试/DLT**：简单 DLT（`<topic>-dlt`）vs Spring Kafka 式逐级 retry topic（牺牲 per-key 顺序换吞吐；多 group 时 topic 名应含 group id）；**「业务幂等+少量重试+DLT」优于追求 exactly-once**——Kafka transactions 只保证 Kafka 日志内部的原子性，对「消费→写 PostgreSQL」这类外部副作用无效；transactions 仅 consume-process-produce 回环才真有必要。
- **毒丸**：反序列化/schema 错误必须跳过入 DLT 而不是无限重投（否则卡死分区）；Kafka Connect 对应 `errors.tolerance=all` + DLQ topic。
- **Python 客户端**（2026-09 实测）：`confluent-kafka` 2.15.1（librdkafka，**生产首选**）、`kafka-python` 3.0.11（停滞 4 年后复活）、`aiokafka` 0.14.0。
- **可靠消费骨架要点**（confluent-kafka）：`enable.auto.commit=False` + `enable.auto.offset.store=False` → poll 循环：反序列化（失败=毒丸→DLT+跳过）→ **幂等 upsert 入库（`ON CONFLICT (dedupe_key) DO NOTHING`）**→ 成功后 `store_offsets`/同步 commit；失败不提交等重投；处理慢 `pause()` 拉平。
- **两段式是官方认可模式**：消费回调只做「接收侧持久化+commit」，业务执行交给平台内 job queue（Uber《Reliable Reprocessing and DLQ with Kafka》同款：Kafka 之外的 DB 承担重处理与死信）。

#### 3.3.2 RocketMQ 语义（Apache 官方 + 阿里云）

- **4.x PUSH**：失败返回 `RECONSUME_LATER` → 服务端重投 `%RETRY%+ConsumerGroup`，16 级递增间隔（10s→2h），超 `maxReconsumeTimes`（默认 16）进 `%DLQ%+ConsumerGroup`。
- **5.x 两种 consumer**：PushConsumer（listener 返回值即隐式 ack）vs **SimpleConsumer（显式 ReceiveMessage + InvisibleDuration + 成功后显式 AckMessage，可 `ChangeInvisibleDuration` 续期）——这就是 RocketMQ 版「先持久化再 ack」，与我们口径天然对齐，建议优先**。
- **阿里云差异**：RocketMQ 5.x 接入点 `rmq-cn-*.aliyuncs.com`（走 Proxy）+ 控制台凭据，兼容 4.x/5.x SDK；Python SDK 用 `rocketmq-python-client`（gRPC，5.1.1，2026-02 发布；旧 C++ wrapper 2019 年后弃用）。
- **阿里云 Kafka 版**：三类接入点（默认 VPC 免鉴权 / SASL / SASL_SSL:9093）；需下载 SSL 根证书且证书 CN=AliKafka 而接入点是 IP → 须关闭 hostname 校验（librdkafka `ssl.endpoint.identification.algorithm` 置空）；**协议完全兼容开源 Kafka，confluent-kafka 代码不变，只换 endpoint+证书+凭据**。

#### 3.3.3 模型映射（最小路径，待首个 broker 实测后冻结）

| 我们的概念 | MQ 侧对应 |
|---|---|
| `DataSource` 新增 kind | `kafka` / `rocketmq_simple`（SimpleConsumer 优先）/ `rocketmq_push` |
| consumer group | 每 DataSource 一个（如 `platform-ds-<id>`） |
| 一条消息 | 一条 `DataSourceEvent`；`dedupe_key = topic:partition:offset`（RocketMQ 用 message key/UNIQ_KEY） |
| ack/commit 时点 | **先 `DataSourceEvent` 落库持久确认，再 commit/ack**——03 号稿口径与 Kafka 官方（处理后提交）、RocketMQ SimpleConsumer（处理后 Ack）一致 ✅；落库与 commit 之间崩溃的重复由 dedupe_key 唯一约束兜住 |
| 平台内重试/死信 | `EventDelivery` 承担业务级退避+死信；MQ 侧重试只留给投递即失败的瞬时错误，**避免双层重试叠加放大延迟** |
| 进程形态 | 独立常驻 consumer 进程（与 FastAPI 分开；可由 watcher 同款 PG advisory lock 保证单实例），**不嵌 API 进程**（每次发布/重启都会 rebalance） |
| 回调纪律 | 回调只做「反序列化（毒丸→DLT）→ 幂等入库 → ack」，耗时 ≪ poll 间隔/InvisibleDuration；下游触发进平台 job queue；RocketMQ 设足 InvisibleDuration，超时续期 |

#### 3.3.4 成熟代码参考

- **n8n KafkaTriggerV1**（`packages/nodes-base/nodes/Kafka/v1/KafkaTriggerV1.node.ts`）：kafkajs `eachBatch` → emit 成功后才 `resolveOffset`+`commitOffsetsIfNecessary`，失败"skipping commit"等重投；emit 期间持续 `heartbeat()` 防 rebalance——「处理成功后手动提交」的工业级参照。
- Kafka Connect sink（无需写消费代码落 DB，内置 DLQ）适合旁路方案，但对每 DataSource 独立 group/动态配置管理，内置 consumer 更可控。
- Kestra Kafka Trigger / OpenFn Kafka trigger 为同类参照（consumer group + 手动 offset commit）。

### 3.4 DataWorks 表获取（新增，全仓空白）

#### 3.4.1 OpenAPI 元数据 API（两个版本并存）

- **新版 2024-05-18（推荐）**：官方提示新版数据开发必须用新版本。推荐链 `ListCatalogs(仅 DLF/StarRocks)→ListDatabases→ListSchemas→ListTables→GetTable`：
  - `ListTables`：`ParentMetaEntityId`（qualified name，如 `maxcompute-project:::project_name`、`holo-database:instance_id::database`）+ 分页 PageNumber/PageSize（**最大 100**）；仅基础信息，**必须再调 GetTable**。
  - `GetTable`：按 qualified name 取详情（TechnicalMetadata=Owner/Location/…，BusinessMetadata=Readme/Tags/血缘/产出）；**字段级 Columns 是否返回未核实，需 OpenAPI Explorer 确认**（旧版有 `GetMetaTableColumn` 兜底）。
  - RAM Action：`dataworks:ListTables` / `dataworks:GetTable`（资源 `*`，不支持资源级授权）。
  - 官方最佳实践：《通过 OpenAPI 查询表列表和表详情》。
- **旧版 2020-05-18（fallback）**：`ListMetaDB → GetMetaDBTableList → GetMetaTableBasicInfo / GetMetaTableColumn（字段级，已核实）/ GetMetaTablePartition / GetMetaTableOutput（血缘）`；`SearchMetaTables` 仅支持 MaxCompute 与 EMR。**注意：`GetMetaTable`/`ListMetaTables`/`GetDatasourceMeta` 未在官方文档命中，勿使用**。
- **数据源 API**：`ListDataSources`（2020-05-18）：按 ProjectId+DataSourceType+EnvType(0 开发/1 生产) 列出，返回含连接串 Content。

#### 3.4.2 QPS/配额（对企业元数据同步是首要约束）

| DataWorks 版本 | 限制 |
|---|---|
| 基础版 | 总 QPS ≤5，**每日 ≤100 次**（几乎不可用），免费 3100 次/月 |
| 标准/专业版 | 每月 10 万/50 万免费额度 |
| 企业版 | 读 QPS ≤50、写 ≤20，免费 100 万次/月，超额 0.3 元/万次 |

额度按主账号+子账号每地域累计（子账号调用同样消耗配额）。

#### 3.4.3 底层引擎直连（替代路线）

| 引擎 | 方式 | 备注 |
|---|---|---|
| MaxCompute | **pyodps**（官方 SDK）：`o.list_tables()/get_table()/open_reader()`（分区表须传 partition） | 字段级 schema 完整；需 AK/SK+endpoint |
| MaxCompute | MaxCompute OpenAPI 2022-01-04：`GET /api/v1/projects/{p}/tables`（marker 翻页） | `odps:ListTables` |
| Hologres | **PG wire 直连查 `information_schema`**（兼容 PG 协议） | 与我们 DataReader(postgres) 同构，成本最低 |
| EMR/Hive | Hive Metastore Thrift / Spark SQL | 简述，未深入核实 |

**对比结论**：DataWorks OpenAPI 的价值=跨引擎统一视图+数据地图业务元数据（标签/类目/血缘/产出），但受版本/配额/列级信息限制；**直连引擎字段级 schema 更完整、无版本门槛**。建议：元数据主线走 DataWorks OpenAPI，字段级 schema 用直连引擎补齐。

#### 3.4.4 OpenEvent 事件订阅（触发路线，硬门槛=企业版）

- 架构：DataWorks → **EventBridge 自定义总线** → 事件规则（`source=["acs.dataworks"]` + type 过滤）→ 投递目标。配置：开通 EventBridge → DataWorks 开放平台添加事件分发通道（选工作空间+总线，需服务关联角色授权）。**租户级事件默认走 default 总线，不走自定义通道**。
- 已核实事件（eventCode）：`instance-status-changes`（status：**5=失败、6=成功**、4=运行中）、`dag-status-changes`、`workbench-monitor-alert`、**`dqc-check-finished-event`（DQC 校验完成，checkResult 0 通过/1 橙/2 红/-1 异常/-2 跳过）**、`commit-table`/`deploy-table`（注意这是 DataWorks 开发表发布动作，**不是引擎任意 DDL**）、节点/文件/补数据/权限审批等。
- 投递目标：自建 HTTPS（公网）或经 EventBridge 路由到 MNS/消息队列 Kafka/函数计算等 → **「OpenEvent→EventBridge→MNS→我方 MQ 消费者」链路成立**。
- **限制**：仅 DataWorks **企业版**；限北京/杭州/上海/深圳/成都/张家口/硅谷/弗吉尼亚/法兰克福/东京/香港/新加坡地域；需开放平台管理员权限。→ 事件触发的客户覆盖率受限，**轮询 OpenAPI 查实例状态仍是兜底**（对应 API 名未核实，需 OpenAPI Explorer 确认）。

#### 3.4.5 数据服务（DataService Studio）读数路线

向导/脚本模式把单表或多表关联查询生成 API 并发布；鉴权=API 网关 AppKey/AppSecret（签名）或 AppCode（简单）；管理 API：`CreateDataServiceApi/ListDataServiceApis/PublishDataServiceApi/GetDataServiceApplication`（已核实）。适合「客户不给引擎账号、只给白名单查询」场景，但建 API 的人力成本在客户侧。

#### 3.4.6 鉴权与 SDK

- 签名：RPC 风格阿里云统一 AK/SK 签名（SDK 封装）；endpoint 按工作空间地域（`dataworks.{region}.aliyuncs.com`，VPC 为 `dataworks-vpc.{region}.aliyuncs.com`，公网列表接入前以官方 endpoint 页为准）。
- 企业常规：RAM 子账号 + `AliyunDataWorksReadOnlyAccess` 系统策略，或自定义只读策略（仅含 ListProjects/ListDataSources/ListTables/GetTable/GetMetaTableColumn 等 Action）。
- Python SDK：`alibabacloud-dataworks-public20240518`（最新 9.7.0，新版 API 用这个）/ `alibabacloud-dataworks-public20200518`（7.0.1）；官方示例库 **aliyun/dataworks-openplatform-examples**（meta-api-demo 元数据同步 + event-instance-status-demo 事件订阅）。

#### 3.4.7 对我们模型的最小路径与分期建议

- **凭据**：`Connections(aksk)` 完全兼容；连接配置 `{ak, sk, region, endpoint, workspace_id}`，多环境=开发/生产 workspace 各一条。
- **一期建议做**：DataWorks 元数据拉取器（新 connector 类型 `dataworks`）——拉取链 ListProjects→ListDataSources→ListTables→GetTable（新版优先、旧版 fallback），落地表资产目录（name/comment/owner/type/partition_keys/项目空间+引擎类型），字段清单用 GetMetaTableColumn 或直连引擎补齐；**全局令牌桶限速（按客户版本取 QPS 上限）+ 429 退避 + 每日配额告警（基础版 100 次/天要在连接健康检查里预警）**；给客户最小授权 RAM 模板文档。
- **二期值得排期**：OpenEvent→EventBridge→MNS→我方 MQ 消费者触发链（`instance-status-changes` status=6 驱动「产出后自动质检」、`dqc-check-finished-event` 驱动「校验回流分析」）；读数路线（默认推荐 pyodps；或客户已建 DataService API 则走 AppKey/AppSecret）。
- **不做**：扩展程序（拦截管控）类接入；绕过 EventBridge 的直发推送（OpenEvent 无此模式）；任何未核实 API 名（接入前统一在 OpenAPI Explorer 用客户账号试跑确认）。

### 3.5 阿里云事件接入补遗：EventBridge 统一总线 + 轻量消息队列 MNS（范围收敛后新增）

> 用户口径（2026-09-12）：对接面主要是「阿里云上的产品 + 已有系统的接口」。EventBridge 是把这条线收口的关键件：
> 阿里云产品事件开通即接入，已有系统可用自定义事件源/HTTP Source 推入，投递目标可直指我们 webhook。

#### 3.5.1 EventBridge 能力清单（官方文档核实）

- **事件源**：①官方云产品事件源——开通即自动接入「云服务专用事件总线」，覆盖 OSS/RDS/PolarDB/Kafka 版/RocketMQ 版/Hologres/E-MapReduce/操作审计/配置审计等（[官方清单](https://help.aliyun.com/zh/eventbridge/user-guide/alibaba-cloud-service-event-sources)；注意 SLS/MNS/DataWorks 不在该清单——DataWorks 走 OpenEvent 自有链路入 EventBridge，见 §3.4.4）；②自定义事件源——已有系统经 SDK 按 **CloudEvents 1.0** 调 PutEvents（AK/SK 签名，[PutEvents API](https://help.aliyun.com/zh/eventbridge/developer-reference/api-eventbridge-2020-04-01-putevents)），或用 **HTTP Source**（EventBridge 生成 webhook 地址，已有系统零 SDK 直推，[文档](https://help.aliyun.com/zh/eventbridge/user-guide/create-a-custom-event-source-of-the-http-or-https-events-type)），或 MNS 队列经事件流拉入。
- **事件目标 19 种**：HTTP/HTTPS、MNS 队列（`acs.mns.queue`）、Kafka、RocketMQ、FC、SLS、钉钉等（[事件目标参数](https://help.aliyun.com/zh/eventbridge/user-guide/event-target-parameters)）。**HTTP 目标**：仅 POST body 传数据（自定义 header/query 须用「API 端点 API Destination」）；Network 支持 Public/VPC（需 VPC/vSwitch/安全组）；内置 Token 鉴权（`x-eventbridge-signature-token` 请求头）。
- **投递语义**：PushRetryStrategy 二选一——`BACKOFF_RETRY`（3 次，10–20s 随机）或 `EXPONENTIAL_DECAY_RETRY`（176 次，指数退避封顶 512s，总时长约 1 天）；重试耗尽进死信，**死信仅支持 MNS 队列或 RocketMQ 落点，默认不启用=超限即丢弃**（[CreateEventStreaming](https://www.alibabacloud.com/help/zh/eventbridge/developer-reference/api-eventbridge-2020-04-01-createeventstreaming)）。at-least-once 字样官方页未见明示（未核实），工程上按至少一次设计。
- **事件规则**：source/type/subject/data.* 过滤（精确/前缀/数值范围等，**不支持正则与 `*` 通配**，[事件模式](https://help.aliyun.com/zh/eventbridge/user-guide/event-patterns)）；转换模板四种（ORIGINAL/CONSTANT/JSONPATH/TEMPLATE）。
- **消费形态**：纯推送模型，**无 SDK 拉取订阅**；要拉取就走「规则→MNS/RocketMQ/Kafka→消费者」。
- **计费**：自定义总线/事件流收费，每 64KB 计 1 事件；云服务专用总线的官方事件发布未列为收费项（单价细节未核实）；QPS 配额未核实。

#### 3.5.2 轻量消息队列（原 MNS，现 SMQ）要点

- **队列语义（与 RocketMQ SimpleConsumer 逐项等价）**：`ReceiveMessage`（长轮询 0–30s，可见性超时 1s–12h）→ 处理 → `DeleteMessage` 即显式 ack；超时不删自动重投；`ChangeMessageVisibility` 续期。**消息保留 1 分钟–7 天**；单消息 ≤64KB；批量 16 条（[队列 API](https://www.alibabacloud.com/help/zh/mns/developer-reference/queue-queue)）。
- **Python**：`pip install aliyun-mns-sdk`（[aliyun/aliyun-mns-python-sdk](https://pypi.org/project/aliyun-mns-sdk)，线程安全 MNSClient，官方样例 sample/queue/recv_and_del_message.py）。注意包名是 `aliyun-mns-sdk` 不是 `aliyun-mns`。
- **作为 EventBridge 事件目标**：`acs.mns.queue` 官方一等公民——「EventBridge→MNS→我方拉取」是标准链路；也是 EventBridge **死信的推荐落点**。
- **Topic HTTP 推送**仍在维护（5s 内回 2xx，2000 TPS 上限）但对单接收端不推荐（无死信、超时苛刻）；官方主推「队列拉取 + EventBridge 集成」。
- **计费**：API 请求次数 + 资源占用，**每月每账号 2000 万次免费请求额度**（[计费概述](https://help.aliyun.com/zh/mns/product-overview/billing-overview)）。

#### 3.5.3 三个接入场景的选型矩阵

| 场景 | 方案对比 | 推荐 |
|---|---|---|
| **A. 阿里云产品事件**（DataWorks 任务完成/DQC、OSS、RDS 等） | 逐产品对接=N 套接入且多数产品无 webhook 推送；统一 EventBridge=开通即接入+CloudEvents+过滤/重试/死信免费获得 | **统一走 EventBridge**：专用总线规则过滤 → HTTP 目标（VPC 可选+Token 鉴权）指向我们 webhook 入口；DataWorks 走 OpenEvent→自定义总线，同一收口 |
| **B. 已有系统通知我们**（普通内部 HTTP 服务） | ①直推 webhook：系统侧改造最小（HTTP client+HMAC 头），可靠性靠两端；②写 MNS 队列我方拉取：消息持久 7 天/削峰/可见性超时自动重投，系统侧一行 SendMessage；③EventBridge 自定义事件源：PutEvents+CloudEvents 改造中等 | 一期 **①直推 webhook**（内网可信、事件量可控）；大流量/不许丢 → 二期 **②MNS 队列**；客户已用 EventBridge 才上 ③ |
| **C. 消费客户侧 MQ**（已有 RocketMQ/Kafka） | 直连（RocketMQ SimpleConsumer 优先 / Kafka 用 confluent-kafka）：时延最低、平台侧需常驻 consumer；EventBridge 桥接 HTTP：平台零改动复用 webhook，多一跳+计费 | 客户已有 MQ 且网络可打通 → **直连**；平台不愿常驻 MQ 客户端/客户愿托管 → EventBridge 桥接过渡 |

#### 3.5.4 一期最小组合（阿里云口径）

1. webhook 加固（§3.1 W1–W7）承接已有系统直推 + EventBridge HTTP 目标（含 `x-eventbridge-signature-token` 校验，与现有 token 模型同构）。
2. EventBridge 规则若干条（按 `source`/`type` 过滤）+ **CloudEvents→DataSourceEvent 转换层**（按 `source=acs.xxx`/`type` 映射、从 `data` 提取字段）——这是阿里云主线唯一需要新建的代码面。
3. 可选：一个 MNS 队列作 EventBridge 死信落点（重试耗尽可观测不丢弃）+ 平台 DLQ 巡检视图。
4. 二期按客户实情启用：MNS 队列（场景 B 升级）、RocketMQ SimpleConsumer/Kafka 直连（场景 C）、EventBridge 自定义事件源、DataWorks OpenEvent（企业版门槛解除后）。

---

## 4. 通用机制：调研结论 → 我们模型映射

| 机制 | 业界答案 | 我们的落点 |
|---|---|---|
| 交付语义 | 轮询（Airbyte `>=` 重叠、宁可重发）、CDC（Debezium 崩溃回退 LSN）、MQ（at-least-once）**三家全是 at-least-once + 下游幂等** | 不变式已有：`INV-020~025`（幂等/去重/防火 key）+ dedupe_key 唯一约束；新通道全部复用，不造 exactly-once |
| 轮询游标 | Dagster cursor（成功才推进）+ Logstash sql_last_value（每轮落盘）+ Airbyte 重叠查询 | §3.2.4 设计点；对应 Spec §6.4 Polling「cursor 在接收事实持久化后才推进」的细化 |
| 准入 policy | Inngest 四正交：idempotency（24h 窗）/throttle（排队）/concurrency/debounce（latest-wins）；rate-limit（丢）≠throttle（排队） | Spec §7.4 准入顺序的候选扩展；**是否引入 debounce/throttle 属 spec 变更，须拍板**（见 §5 D6） |
| 定时重叠/补跑 | Temporal overlap policy 六档（默认 Skip）+ catchup window；我们已有 misfire 默认不补跑 | 已基本对齐；补跑风暴防护可借 catchup window 概念 |
| 重试/死信 | Hookdeck 50 次上限+Retry-After+failed 保留可重放；Stripe 3 天指数退避 | EventDelivery 已有退避+dead；确认：重试总量上限、Retry-After 透传、dead 重放入口+幂等 |
| 心跳式对账 | Prefect missing-event 自动化 | 低成本增强项：预期事件缺失告警（对 polling/MQ 通道健康检查） |
| 观测 | Make check run 显式建模 | TriggerLog 区分「轮询无产出 tick」与真实触发，避免历史噪音 |
| 事件信封 | EventBridge=CloudEvents 1.0；Stripe 事件对象；GitHub delivery | 阿里云主线新增 **CloudEvents→DataSourceEvent 转换层**（§3.5.4，按 source/type 映射）；已有系统直推 webhook 保持原 JSON body |

---

## 5. 落地建议与拍板项

### 5.1 建议排序（无真实场景数据前，只排「调研成熟度」与「依赖」，不开工）

| 优先级 | 事项 | 性质 | 依赖 |
|---|---|---|---|
| P0 | webhook 接收加固（W1–W7，§3.1；含 EventBridge `x-eventbridge-signature-token` 校验） | 纯安全加固，不动架构 | 无；随时可做 |
| P0.5 | EventBridge 订阅阿里云产品事件：专用总线规则 → HTTP 目标复用 webhook 入口；**CloudEvents→DataSourceEvent 转换层**；可选 MNS 死信队列（§3.5.4） | 阿里云主线唯一新增代码面 | 客户开通 EventBridge；**无需等 MQ 选型** |
| P1 | DataWorks 元数据拉取器 + 表资产目录（§3.4.7） | 数据连接（非触发） | 客户提供：DataWorks 版本、RAM 授权、地域/endpoint、QPS 预算 |
| P1' | DataWorks OpenEvent 订阅链（§3.4.4） | 触发增强 | 客户 DataWorks **企业版** + 指定地域 |
| 按需 | DB 轮询触发源（kind=db_polling，§3.2.4 设计点清单） | 新触发通道 | 出现需要**直连 RDS/客户库**的真实场景（03 号稿开工门禁） |
| 按需 | MQ 直连消费者（独立进程 + RocketMQ SimpleConsumer 优先，§3.3.3 映射表） | 新触发通道 | 客户侧**已有** RocketMQ/Kafka 且网络可打通；随首个 broker 实测冻结（03 号稿红线） |
| 按需 | MNS 队列拉取通道（§3.5.2） | 新触发通道 | 已有系统事件量大/不许丢时的场景 B 升级 |
| 二期 | DataWorks 读数（pyodps/DataService）；EventBridge 自定义事件源 | 增强 | 按客户能力 |

### 5.2 拍板项（用户裁决后才能进设计/实施）

- **D1 首个真实场景**（已被用户口径部分回答）：对接面=阿里云产品+已有系统接口。剩余拍板：第一个要通的具体场景是哪个（如「DataWorks 任务完成→自动质检」或「已有系统推工单→自动分析」）？
- **D2 阿里云消息形态**（原「Kafka 还是 RocketMQ」已收敛）：客户侧/公司内现在已有哪些——RocketMQ（4.x/5.x）、Kafka 版、MNS，还是都没有？都没有则 P0.5 EventBridge 链先行，MQ 直连暂不做；已有则按 §3.5.3 场景 C 直连。另：已有系统能否改造加 HMAC 头，还是必须零改造直推？
- **D3 webhook 签名**：W1–W3（HMAC+时间戳+常量时间比较）是否排期？EventBridge Token 鉴权是否启用？
- **D4 数据库触发源**：是否还需要直连 RDS/客户库做轮询触发（若数据都能经 DataWorks/接口获取，可降级不排）？需要时按 §3.2.4 设计点走。
- **D5 DataWorks**：目标客户 DataWorks 版本（决定新版/旧版 API 与 QPS 档位）；一期是否只做元数据目录不做读数。
- **D6 admission policy**：是否把 Inngest 式 debounce/throttle 纳入 Spec §7 准入模型（属权威 Spec 变更，需修 spec 再实施）。
- **D7 攒批**：维持 Spec §10.3 关闭状态；若事件/MQ 接入后吞吐实测触发门槛条件，再按 §10.3 走 IngressBatch 立项（不重启 13 号稿旧方案）。

---

## 6. 参考资料索引（按主题）

- **平台触发模型**：Zapier Trigger/Deduplication/REST Hook（docs.zapier.com）；Make 模块类型（help.make.com/types-of-modules）；n8n Trigger 索引/Webhook/static data/Postgres Trigger/Kafka Trigger 源码（docs.n8n.io、github.com/n8n-io/n8n）；Dify Trigger 公告+文档+源码（dify.ai/blog/introducing-trigger、github.com/langgenius/dify）；Temporal Schedules/Handling Messages（docs.temporal.io）；Airflow Datasets/Assets/Sensors/Deferring/3.2 博客（airflow.apache.org）；Prefect Webhooks/Events/Automations（docs.prefect.io/v3）；Dagster Sensors/超时排查/daemon 源码（docs.dagster.io、github.com/dagster-io/dagster）；Inngest Flow Control/幂等/Debounce/Retries（inngest.com/docs）；Hookdeck Retries/接收实践（hookdeck.com/docs）；Stripe Webhooks（docs.stripe.com/webhooks）；GitHub Webhooks 最佳实践/验签（docs.github.com）。
- **数据库触发**：Logstash jdbc input（elastic.co/guide）；Airbyte Incremental Append/Postgres Source（docs.airbyte.com）；Debezium 五优势博客/PostgreSQL/MySQL/Oracle/Engine/Server（debezium.io）；PostgreSQL NOTIFY/LISTEN/逻辑解码（postgresql.org/docs）；Use The Index, Luke no-offset（use-the-index-luke.com/no-offset）；asyncpg/psycopg3 官方 API；python-mysql-replication（github.com/julien-duponchelle/python-mysql-replication）；Gunnar Morling《The Insatiable Postgres Replication Slot》（morling.dev）。
- **MQ**：Apache Kafka 4.1 Consumer Configs + design.md（kafka.apache.org）；Spring Kafka Non-Blocking Retries/Topic Naming（docs.spring.io）；Confluent Kafka Connect DLQ 深潜（confluent.io/blog）；Uber Reliable Reprocessing（uber.com/blog/reliable-reprocessing）；Apache RocketMQ 4.x Push 消费/5.x Consumer Types/消费重试（rocketmq.apache.org）；阿里云 RocketMQ 消息重试/版本差异/示例代码（help.aliyun.com）；阿里云 Kafka 接入点对比/SSL 证书说明/Python SDK 接入（help.aliyun.com）；confluent-kafka-python / kafka-python / aiokafka（PyPI 实测版本）。
- **DataWorks**：使用 DataWorks OpenAPI（含 QPS 配额表）；2024-05-18 ListTables/GetTable；2020-05-18 API 总览/ListMetaDB/GetMetaDBTableList/SearchMetaTables/GetMetaTableColumn/ListDataSources；OpenEvent 概述/开启消息订阅/事件消息格式；EventBridge 路由到 MNS/事件目标参数；DataService 生成 API/调用认证；RAM AliyunDataWorksReadOnlyAccess；pyodps 文档站；MaxCompute OpenAPI ListTables（2022-01-04）；Hologres 系统表；官方示例库 github.com/aliyun/dataworks-openplatform-examples（全部 help.aliyun.com 域下）。
- **EventBridge / MNS（阿里云事件主线补遗）**：EventBridge 官方云产品事件源/事件源概览/事件目标参数/事件模式/计费概述（help.aliyun.com/zh/eventbridge/*）；PutEvents API + SDK 发布示例（CloudEvents 1.0 + AK/SK 签名）；CreateEventStreaming（重试/死信参数）；HTTP/HTTPS 类型自定义事件源；MNS 队列 API（可见性超时 12h/保留 7 天）/Python SDK（pypi `aliyun-mns-sdk`）/Topic HTTP 推送（5s/2000TPS）/计费（2000 万次/月免费额度）；与 DataWorks OpenEvent 的关系互引 §3.4.4。

---

*调研方法：2026-09-12 五路调研（四路并行 + 范围收敛后 EventBridge/MNS 补遗），全部结论以官方文档/一手仓库核实并附 URL；未能核实的条目在文中原位标注「未核实」，实施前须在 OpenAPI Explorer / 真实 broker / 官方文档复核。*
