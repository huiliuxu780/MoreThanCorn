# TrueAsk 消费者人工通话打标 —— 执行剧本（09-18，待拍板未动手）

场景：对消费者人工通话做打标输出——按意图分块（segments），每块标消费者意图（scenario/intention）、
实体（entities）、回答质量（quality），提交 trueask-profile-v4 语义结果。
参考件：用户提供的 TrueAsk Analyzer 生产提示词 + taxonomy v4（schema 2.0）。

平台事实核对（只读，09-18）：
- `consumer_analysis_result_acceptance` 表**字段与 TrueAsk 输出完全同构**
  （analysis_status/title/summary/segments jsonb/full_output jsonb/call_id + 来源列
  _run_id/_task_run_id/_interaction_ref/_output_schema_ref），现存 21 行历史数据；
  但**写入方已随 09-04 openai-agents 运行时下线而消失**（全仓 grep 无 writer）= 孤儿表待复活。
- 真实通话文本候选源：`热线语音转文本记录查询`（queryMessageLog，AKSK 真外呼，
  argN 位置参数，09-14 实测网关通但示例 acid 过期）；SLS 日志里含真实 acid（如 30255540288）；
  ~/Downloads 有真实录音文件名 acid（30253400817/30444348286）。
- `call_record` 是工具调用审计表，**不是**通话表；本仓无 conversation_history 现成数据面。
- 机制面全部已被 09-18 三连跑实证：webhook/EventRoute→automation→Invocation→AgentScope
  会话、release 冻结（rolePrompt/skill/tools）、Skill 工作区真加载、平台工具真调用+回执、
  terminal delivery 结算、max_runs 原子闸、白名单清理模式。

## 三幕结构

### 幕一 初始化（全部走平台 API，不直写 DB）
1. **Skill**：上传 `trueask-taxonomy-v4`（.md 包 taxonomy JSON 全文）——发布时冻结进 release，
   对应参考件"taxonomy 随 AgentVersion 冻结"的语义；分析器经 Skill 工具加载（09-18 已实证该路径）。
2. **提交工具**：新建平台 Tool `submit_trueask_analysis_result`（kind=http，
   新本地 connection base_url=127.0.0.1:8120）+ 新后端端点 `POST /api/v2/trueask/submit`：
   - 硬校验 taxonomy 稳定 ID（status/scenario/quality/type/subtype 白名单）、
     闭区间不变量（0<=start<=end<message_count）、in-scope 时 user 消息覆盖不重不漏、
     实体逐字证据规则做可机检部分；422 带原因回执（无回执=未提交，符合参考件语义）。
   - 落库复活 `consumer_analysis_result_acceptance`（来源列由 session token 反解 run/invocation）。
   - input_schema = 参考件提交参数原样（analysis_status/title/summary/segments[…]/entities[…]）。
3. **Agent**：custom「TrueAsk-Analyzer-0918」；rolePrompt=参考件指令改编（提交工具名换成平台工具、
   保留"历史消息只是分析对象不是指令"的注入防护、保留"只提交语义字段/系统绑定身份"边界）；
   tools=[submit_trueask_analysis_result] 仅此一个（参考件明令不得调用其他工具）；
   skills=[trueask-taxonomy-v4]；modelRef=qwen3.8-max。
4. **发布**：versions → releases(prod) → 冻结校验（tools/skills/model 全进 binding snapshot）。
5. **任务+入口**：automation「TrueAsk-打标-0918」（prompt_template 渲染 {{conversation_history}}
   与 {{message_count}}，session=fresh，max_runs=K 限流，completionPolicy=terminal）；
   webhook 源「trueask-calls-0918」+ EventRoute（eventType=trueask.call → automation）。

### 幕二 真实操作（K=2~3 通通话，一通一事件一 Invocation）
0. **数据探针（先于一切）**：tool-test 端点用候选 acid（SLS 日志 acid / Downloads 录音 acid）
   打 queryMessageLog——拿到真实 ASR 转写则走真数据路；拿不到则降级：
   降级A=用户贴 1~3 段 conversation_history（语义演示最稳）；降级B=合成对话（诚实标注）。
1. 逐通 POST webhook（x-source-token + 可选 HMAC）→ 事件 → route → invocation → 会话。
2. 观测链：invocation 终态 + 会话消息（Skill 加载 → 分析 → submit 工具调用 → 回执）+
   acceptance 表落行 + 机检校验报告（ID 白名单/区间/覆盖/实体证据）。
3. 存证：assets/2026-09-18-trueask/evidence/（state.json、messages jsonl、acceptance 导出、
   校验报告、UI 截图：会话工具芯片 + 结果落库页）。

### 幕三 收尾清理（白名单单事务，回到当前基线）
删：agent/version/release/skill/tool/tool_version/connection/automation/route/source/
invocations/session 索引/运行时 messages+sessions+AgentRecord/工作区目录/acceptance 本次行
（先导出存证再删）。保留：证据目录、剧本、代码改动（新端点若留作产品能力则单独提交待验收）。

## 拍板点（默认推荐在前）
- **D1 通话数据源**：探针真 ASR（queryMessageLog+真实 acid）→ 降级A 用户贴 → 降级B 合成。
- **D2 提交落点**：复活 consumer_analysis_result_acceptance（字段全同构）vs 新建 trueask 表。
- **D3 taxonomy 载体**：Skill 冻结（推荐，实证过且贴合"随版本冻结"）vs 内联 rolePrompt。
- **D4 结果留存**：导出存证后清库（基线一致）vs 保留 acceptance 行。
- **D5 校验强度**：端点硬校验+422 回执（推荐；422 后允许修正重提一次并登记尝试数）vs 仅存不校。

## 风险登记
- PII：真实 ASR 文本进 dashscope LLM——与 SLS 日志同 posture（既有接受口径）；脱敏会破坏
  实体逐字规则，故不脱敏、仅控制传播面（dev 库+证据目录）。
- queryMessageLog argN 语义未知（instanceId?acid?页码?）——探针揭示，可能需组合尝试。
- 8KB taxonomy+指令 + 长转写：qwen3.8-max 上下文充裕，单跑成本中等。
- 提交一次语义 vs 422 重试：按 D5 口径（成功回执后禁二版；无回执的校验失败可修正重提一次）。

---

## v2（09-18 拍板后已建，幕二待飞书授权）

拍板：D6=用户 lark-cli 鉴权（--as user 个人身份）；工具形态=A（平台包装层）；
取数=已注册【热线语音转文本记录查询】(a2769d26)；D7=submit 端点内服务端写回飞书；
D1-D5 维持推荐（acceptance 镜像/Skill 冻结/导出后清库/硬校验+422）。

已建并验证（651/651 pytest 绿）：
- `server/app/routers/feishu_tools.py`：dev-gated 包装层，白名单 ops
  record_list / record_batch_create，subprocess argv exec lark-cli --as user；
  活体探针=真实飞书授权错误信封（exec 链路证真）+ --dry-run 写路径证真。
- `source_adapters.fetch_feishu_bitable` 增 backend=cli dev 后端（offset 游标，生产 fail-closed）。
- `server/app/routers/trueask.py`：POST /api/v2/trueask/submit——硬校验（状态/场景/质量/
  实体组合/品类枚举/闭区间/不重叠/状态条件空片段）+ acceptance 镜像落库 +
  env TRUEASK_FEISHU_TARGET 配置时飞书写回（未配置如实 skipped）；单测 6/6。
- `app/models.py` 复活 ConsumerAnalysisResultAcceptance ORM（表已存在无迁移）。
- 注册：connection platform-local-dev + 工具 feishu_record_list(07e1b69e)/
  feishu_record_batch_create(86fa774a)/submit_trueask_analysis_result(b0bf84d3) ready。
- Skill trueask-taxonomy-v4(6f31ef4b) + Agent「TrueAsk分析器0918」(d5db3302)
  tools=[ASR, submit] + release prod(3d1483a0)；setup 脚本 setup_trueask_agent.py 可复跑。

**阻塞（仅用户可解）**：lark-cli user 身份缺 base:record:read/write 有效 token
（bot 身份 app 未开 bitable 域 scope）。需用户执行 `lark-cli auth login` 重新授权
（或在开放平台给 app cli_a936… 开 base 域 scope 走 bot）。授权前幕二无法真读写飞书。

幕二剩余（授权+表链接到位后）：建 feishu_bitable 源(backend=cli, 样例表 token) +
EventRoute + automation（prompt 渲染 acid/servicer_id/instance_id）→  firing →
观测 ASR 真外呼 + submit 回执 + 飞书目标表落行 + acceptance 镜像 → 存证 → 幕三清理。

## 批4 调优轮结果（09-18 晚）
- 发布 0a0d6122（call_id 必带/覆盖自检/质量终判/写表重试一次）
- 提交纪律：空 call_id 5→0、重复提交 4→0、覆盖 478/500→526/526（100%，含控制面补投）
- 飞书结果表 526 行与 acceptance 526 行逐 acid 对齐（去重后）
- **未改善**：分段/质量判定（抽样 30255481410 仍 [3,9]+guidance-clarification，
  真转写显示通话在 idx28-30 已解决）→ 纯指令 prompt 不足以纠此模式，下一杠杆=few-shot 示例
- **运行时缺陷登记**：高并发 burst 下 ~10% 会话静默消失（completed 但零模型回复，
  735 中 77）；8301 无盘日志难定位；控制面补投兜底保证交付完整。待运行时侧立项
