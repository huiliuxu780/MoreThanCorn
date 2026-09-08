# 03 · Trigger 与数据接入设计（判断：引入）

> 日期：2026-09-04 ｜ 状态：设计稿，未动代码
> 回答问题 3：是否引入"在 Task 中绑定、触发产生 Run 的 Trigger"，以及三方数据的格式/字段/定义转换映射。
> 约束来源：SDD-13 §3（TaskRun 四源模型）、§17/§18、fire_key 幂等（INV-11）、生产触发闸门；02 审计 B14/B7。

---

## 1. 判断：引入，且应升级为一等实体

**结论：引入 Trigger，绑定到 Task，触发产生 TaskRun（批次）。**

依据（全部来自代码事实）：
1. **触发面现状只有 cron**。全仓无任何 MQ 消费、无外部推送接收入口；唯一的"推入"是手工 `POST /api/data-assets/{aid}/rows`（`routers/business.py:537`）。业务方明确提出的两个场景（监听 MQ 特定 topic 按条件消费、提供地址接收三方推送）目前**零能力**。
2. **`trigger="api"` 是空洞值**（`models.py:250,821`）：词表存在但没有任何端点以 api 身份创建 TaskRun。引入 Trigger 正好把这个洞填上，模型层几乎无需破坏性变更。
3. **幂等与闸门机制已就位**：`idempotency_key`/`schedule_fire_key` 唯一约束（INV-11）、生产触发闸门（非 manual 强制 `target_table`）都是现成的承接点——外部触发天然是"生产触发"，直接落入既有闸门体系。
4. **成熟产品全部内置触发器层**，这不是激进设计而是补行业标配：
   - **n8n**：trigger 是工作流的第一类节点——Webhook / Schedule(Cron) / Message Queue（Kafka、RabbitMQ、Redis、MQTT）/ Polling / Manual，每个 trigger 自带鉴权配置；
   - **Zapier / Make（Integromat）**：Trigger → Filter（条件逻辑判断是否继续）→ 字段映射步骤，三件套是标配；
   - **Coze（扣子）**：定时触发 + Webhook 触发 + 平台事件触发，触发器可配"AI 筛选规则"（自然语言条件）——早期调研（06-SDD 附录 C.4 飞书口径）已记录；
   - **AWS EventBridge Pipes**：`Source → Filter（过滤条件）→ Transformer（输入转换模板）→ Target` 四段式，与我们"监听→判断→转换→消费"的诉求逐段对应。

---

## 2. 概念模型

```
Trigger（新增一等实体，绑定 Task，1 个 Task 可挂多个 Trigger）
├─ type: schedule（收编现有 Schedule）| webhook | mq | api
├─ 过滤条件: filter = {op, conditions[]}（复用 TaskVersion.scope 同构语法）
├─ 载荷映射: payload_mapping（受限表达式，见 §6）
├─ 批量化策略: batching = immediate | window{maxRecords, maxWaitMs} | manual_flush
├─ 鉴权: webhook 签名密钥 / mq 走 Connection 凭据
└─ 状态: draft | active | paused（paused=停止消费/接收，不删历史）

TriggerEvent（新增：事件流水，不可变）
├─ 原始载荷（落地存储，不塞 JSONB 单列——吸取 DataAsset.rows 教训）
├─ 判定结果: accepted / rejected(filter) / rejected(mapping) / deduped / failed
├─ 去重键命中信息、映射后摘要（脱敏）
└─ 归属的 TaskRun（被哪一批次消费）
```

**执行链路（融入 SDD-13 四源模型，不新增第五源）**：

```
MQ消息 / HTTP推送 / API调用
   │  鉴权校验（签名/令牌）
   ▼
TriggerEvent 落地（原始载荷不可变，事件级幂等去重）
   │  filter 条件判定（用户说的"逻辑判断后再消费"）
   │  payload_mapping 转换（字段改名/路径/类型/默认值）
   ▼
按 batching 策略攒批 ──▶ start_task_run(trigger="api", trigger_ref=trigger_id,
   │                        idempotency_key=事件区间指纹, 数据源=事件暂存)
   ▼
既有链路：TaskRun(批次) → N × Run → ResultDelivery（完全复用，不新建）
```

关键决策：
- **Trigger 产生的批次 `trigger` 词表值用 `api`**（填上空洞值），事件来源细节放 `trigger_ref`（trigger_id + 事件区间）。不改 SDD-13 词表，只在"变更记录"里说明 `api` 语义扩展为"外部触发（含 webhook/mq）"。
- **Schedule 收编为 Trigger 的一种类型**，现有 `Schedule`+`ScheduleOccurrence` 机制原样保留（48h 物化、missed 判定、前端不得用 cron 推算历史——这些是已验收的资产），只是 UI 上归入 Trigger 面板。这样"一个 Task 的所有触发方式"有唯一查看入口。
- **数据不落在 `DataAsset.rows`**（审计 B7 已定性为反模式）。事件暂存用独立表（按事件行存储），批次读取复用 `data_readers` 抽象新增一个 `TriggerEventReader`——与 PostgresReader/InlineReader 同接口。
- **生产触发闸门自动生效**：webhook/mq/api 触发 `trigger != "manual"`，Task 必须已配置 `target_table` 输出才放行（`task_runner.py:151-154` 现有逻辑），无需新闸门。

---

## 3. 三种新触发类型的行为规格

**Trigger 与 Connection 的分工（09-04 用户质询后澄清）**：平台已有完整的 Connection 体系（SDD-12：凭据/多环境/测试连通/统一 resolver）。触发器**不再造第二套"接入信息"表单**：

| 触发类型 | 接入信息归属 |
|---|---|
| MQ | **就是一个 Connection**（kind=mq，新增）：broker 地址/凭据/环境全走 Connection，触发器只引用 `connection_id` + topic/consumer group 配置。复用既有连接选择器组件（`connection-picker`） |
| Webhook | **方向相反，不是 Connection**：Connection 是"我们出站调别人"，webhook 是"别人进站推我们"。没有出站端点可配；只有两样——我方接收地址（系统生成、只读展示+复制）与验签密钥。密钥走既有 secret 机制（secret_ref/KMS/轮换，与 connections 页同款能力），但不建 Connection 实体 |
| API | 复用平台 auth 令牌，触发器层面无凭据 |

对应地，触发器详情页**没有独立的"接入信息配置区"**：MQ 显示所引用的 Connection（点击跳连接详情）、webhook 显示只读地址+密钥管理入口、API 无。页面主体是映射配置与事件流水。

### 3.1 Webhook（"我们提供地址，接收三方推送"）

参考：GitHub/Stripe Webhook（签名+重放防护）、n8n Webhook trigger（path+auth+response）、Zapier Catch Hook。

- **端点形态**：`POST /api/triggers/{triggerId}/events`（每个 Trigger 一条独立地址，便于吊销与审计；不用全局大端点+body 里辨任务）。
- **鉴权**（三选一，创建时生成）：
  1. HMAC 签名头（推荐，对齐 Stripe/GitHub）：`X-MTC-Signature: sha256=HMAC(body, secret)`，含时间戳防重放（±5 分钟窗口）；
  2. Bearer 令牌（简单对接方）；
  3. mTLS/IP 白名单（后续，先不做）。
  密钥走既有 KMS/secret_ref 体系，**永不进快照/日志正文**（全局约束）。
- **接收即应答**：校验通过→落 TriggerEvent→返回 202+事件 ID；映射失败/过滤拒绝也落事件（状态不同）再返回 202——**只有鉴权失败与载荷超限（默认 1MB）返回 4xx**，避免三方无限重推把坏消息反复打进来。坏消息进事件流水的 `failed`，走死信查看而不是拒收。
- **幂等**：优先取三方带的业务唯一键（配置"去重键映射"，如 `$.orderId`）；未配置则用 `sha256(payload)`。命中去重 → `deduped` 状态，不重复消费。
- **响应模板**（V2 可选）：参考 n8n 允许配置同步返回体；首期固定 `{"eventId": ...}`。

### 3.4 接收侧防护与事件留存（自查补漏）

- **限流**：每个 Trigger 端点独立速率限制（默认 10 req/s，可配），超限 429——防三方故障重推打满接收层；
- **载荷上限**：默认 1MB（可配），超限 413；
- **留存策略**：TriggerEvent 原始载荷默认保留 30 天（可配 7/30/90），到期物理删除——原始载荷可能含三方 PII，不留无限期；
- **展示脱敏**：事件流水页展示载荷走既有 `pii.py` 脱敏；完整原文仅在单条事件详情内可见（与质检详情页同权限级别）；
- **快照红线**：事件载荷**不进** TaskRun/Run 快照与 Trace（Secret/PII 全局约束同源）。

### 3.2 MQ 消费（"监听特定 topic，逻辑判断后消费"）

参考：Kafka consumer 语义（consumer group/offset/DLQ）、n8n Kafka/RabbitMQ trigger、AWS EventBridge Pipes 的 filter 段。

- **连接**：MQ broker 接入复用 **Connection 体系**（SDD-12 已定型的 `ConnectorDefinition → ConnectionInstance → 环境解析 → 统一 Resolver`），新增 `kind=mq` 的 connector 定义（首期 Kafka 协议，RocketMQ/RabbitMQ 留 connector 扩展位）。凭据、多环境域名、测试连通全部复用现有连接能力（"Check 和 Run 复用同一个 resolver"不变量天然满足）。
- **消费模型**：
  - 每个 active 的 MQ Trigger = 一个**独立 consumer group**（命名 `mtc-trig-{triggerId}`），从 `latest` 起步（首次）；
  - **先落事件再 ack**：消息→鉴权/反序列化→落 TriggerEvent→提交 offset。落库失败不提交，靠 broker 重投；平台崩溃最多重复消费，配合去重键幂等收敛（at-least-once 语义，与 SDD-13 §7.3 对外投递语义同口径）；
  - **反序列化失败/超尺寸 = 毒消息**：落 `failed` 事件 + 提交 offset（不阻塞分区），进 Trigger 的"死信"视图；不搞本地重试风暴；
  - **过滤在 ack 之前执行**（用户要求的"逻辑判断后消费"）：被过滤拒绝的消息同样提交 offset（它已被"消费"，只是业务上不处理），状态 `rejected(filter)` 可查——这一点与 n8n 的 filter 后丢弃语义一致。
- **消费进程拓扑**（自查补漏）：MQ consumer 是常驻组件，落点选**第三种进程入口 `run_consumer.py`**，与既有 `run_worker.py`/`run_scheduler.py` 同构（共享 Connection resolver 与 job_queue 写入）。不塞进 API 进程（生命周期受请求影响），也不塞进 worker（worker 被长批次作业占住时消费会停）。
- **背压与配额**：单 Trigger 可配最大拉取速率（条/秒）与单批上限。注意瓶颈的真实形态（自查纠正）：队列本身支持多 worker，但**一个批次作业会整批占住一个 worker**（审计 B12）——消息洪峰下大量事件攒成批次后，长批次作业会占满 worker 槽、事件积压在暂存表。因此 **MQ Trigger 上线前，事件攒批（本设计的 batching 策略）是必选项，批次内并行是强烈建议项**，见 §8 排期。
- **启停**：Trigger paused/Task paused → consumer 停止 poll（保留 group 与 offset）；删除 Trigger → consumer group 保留 7 天供恢复。

### 3.3 API 触发（程序化跑批）

- `POST /api/tasks/{taskId}/runs` 现有端点补全：接受 `Idempotency-Key`（已支持）、新增 `trigger_ref` 与 `input_override`（仅限 manual 语义的数据追加）；
- 对外暴露**任务级 OpenAPI 契约文档**（SDD-13 已有 `/api/runs` 工作流级触发，但那是 `trigger=test` 的测试通道，不进批次链路——两者边界在 UI 文案里写清楚）。

---

## 4. 过滤条件（"逻辑判断"）

复用 `TaskVersion.scope` 的 `{op: and/or, conditions[{field, operator, value}]}` 同构语法（`task_runner.py:246-254` 已有求值器，下沉到 service 层后共享）。新增操作符面向消息场景：`exists / not_exists / regex / gt / lt / in`。

UI 用既有的条件构建器形态（设计器 condition 节点的条件行编辑器已存在，抽取复用，不再手搓第三套）。

**首期不引入自然语言条件**（Coze 的 AI 筛选规则）：我们的质检场景条件可枚举，自然语言条件引入 LLM 不确定性，违背"确定性派生"的平台原则；留作 Future。

---

## 5. 三方数据的格式/字段/定义转换

这是用户明确提出的第二半需求："字段命名、字段定义的转换映射能力"。现状是**输出侧有受限表达式引擎、输入侧只有字段改名**（审计 B14 相关、`task_runner.py:281-289`），严重不对称。

### 5.1 统一映射引擎（核心设计）

**把 `output_binding.py` 的受限表达式引擎扩为平台级"映射引擎"，输入/输出两侧共用一套语法**：

```
$payload.a.b[0].c          嵌套路径（输入侧新增能力）
$payload.field :: cast     类型转换：string|integer|number|boolean|timestamp（已有）
$payload.field ?? <默认值>  缺省兜底（已有）
$constant.*  $system.*     常量与系统值（已有）
```

在此基础上新增（全部保持"受限"，不开放脚本/SQL/eval——与输出侧同等安全边界）：
1. **嵌套路径与数组索引**（三方 JSON 常见深结构）；数组**不做展开**（SDD-13 §17 已排除 explode，输入侧同口径：数组字段要么整体透传要么按下标取）；
2. **字段定义映射**：三方字段 → 我方 DataDefinition 字段的对齐，不只是改名，还包括**类型声明对齐**（三方 `"2026-09-03 10:00"` → `timestamp`；三方枚举码值 → 我方受控词表）；
3. **码值转换表（value mapping）**：`{source: "01", target: "已解决"}` 的静态映射表——三方系统最常见的"字段定义不同"就是码值不同。以 master_data JSON 形式管理（agent_modules 已有此形态先例）；
4. **校验即契约**：映射结果必须通过目标 DataDefinition 版本的 schema 校验（required/type/枚举），校验失败的事件进 `rejected(mapping)` 并可预览失败原因——**映射错误在入口处拦截，而不是让 N 条 Run 在批次里各死一次**。

### 5.2 映射配置 UX（参考成熟产品）

| 成熟产品 | 借鉴点 |
|---|---|
| Zapier / Make | **样本驱动**：先贴一条真实推送样本 → 自动展开字段树 → 点选映射（不用手写路径） |
| n8n | 映射预览：输入样本 + 映射规则 → 实时渲染"转换后的一条记录" |
| Airbyte / Fivetran | schema 发现：从样本推断字段类型，与目标 schema 逐行对齐，冲突标红 |
| MuleSoft DataWeave | 视觉连线太重，不学；我们保持"左字段树 + 右目标行 + 表达式输入"的表单形态 |

配置流程（Trigger 编辑抽屉四步）：
1. **接入**：类型/地址/鉴权（生成密钥）/topic+group；
2. **样本**：粘贴或等待真实样本（提供"测试发送"按钮，webhook 可用 `curl` 示例片段一键复制）；
3. **映射**：样本字段树 → DataDefinition 字段，逐行：路径 / 类型转换 / 码值表 / 默认值；底部实时预览转换结果 + 校验结果；
4. **判定与批量化**：过滤条件 + 攒批策略 + 去重键。

### 5.3 与数据定义（DataDefinition）的关系

三方字段"定义"的落点就是我方 DataDefinition：Trigger 必须绑定一个 DataDefinition 版本（正如 Task 绑定定义版本）。`data-definition-editor` 已有 AI 字段推断能力——扩展为"**粘贴三方样本 → 生成定义草稿**"，把"字段定义转换"前置到定义层，映射层只做对齐。

---

## 6. 观测与运维（事件级可查，对齐成熟产品）

- **Trigger 详情页**：基本信息（类型/绑定任务/状态；MQ 显示引用的 Connection、webhook 显示只读接收地址+密钥轮换入口——见 §3 分工表）+ 映射配置 + **事件流水**（最近 7 天：时间/来源/判定状态/去重命中/归属批次，单条可展开脱敏载荷）——对齐 GitHub Webhook 的 "Recent Deliveries" 与 Zapier 的 trigger history；
- **死信视图**：`failed` 事件列表 + 重放按钮（重放=按当前映射重新走一遍判定，生成新事件，原事件不变）；
- **指标**：每 Trigger 接收/接受/拒绝/去重/失败计数进 `alerts` 指标体系（现有告警路由补一类 `trigger` 粒度）；
- **审计**：Trigger 创建/改映射/停消费全部进 AuditLog。

---

## 7. 数据模型增量（摘要）

| 新增 | 说明 |
|---|---|
| `trigger` 表 | id, task_id(真 FK), type, status, config(JSONB: 端点/鉴权引用/topic/group/过滤/映射/攒批/去重键), secret_ref, created/updated |
| `trigger_event` 表 | id, trigger_id(FK), seq, status, payload_ref（大载荷走独立存储/行存储，不入单列 JSONB 巨型化）, dedup_key, mapped_digest, task_run_id, received_at；索引 `(trigger_id, received_at desc)`、`(trigger_id, dedup_key)` unique |
| `TaskRun.trigger_ref` | 现列扩展语义：存 `trigger:{id}:{eventRange}`（不改词表，填 `api` 值） |
| 复用 | `idempotency_key` 唯一约束、`start_task_run` 闸门、`data_readers` 抽象（新增 TriggerEventReader）、Connection 体系（MQ broker 接入） |

## 8. 实施依赖与顺序（建议）

1. **前置**：事件攒批（必选）+ 批次内并行（强烈建议）——防止长批次作业占满 worker 槽导致事件积压（审计 B12 的真实形态）；`data_readers` Protocol 化（顺手，B13 相关）。
2. 一期：**Webhook + API 触发 + 映射引擎输入侧落地 + 事件流水页**（不依赖 MQ 基建，价值立现：三方推送场景直接可用）。
3. 二期：**MQ Trigger（Kafka connector）** + 死信重放 + 告警接入。
4. 三期：Schedule 收编进 Trigger 面板（纯 UI 归位，机制不动）+ 响应模板/轮询触发（按需）。

## 9. 明确不做（边界）

- 不做自然语言过滤条件（确定性原则）；
- 不做数组 explode/聚合转换（SDD-13 §17 同口径）；
- 不做平台侧建表/改表（目标表预存在原则 §1.3）；
- 不做跨平台事件编排（多 Trigger 依赖链、事件驱动工作流互调）——V2 之后评估；
- 不引入 Redis/Kafka 作为平台自身基建依赖（仅作为**对接的外部系统**；平台内部队列维持 PG）。
