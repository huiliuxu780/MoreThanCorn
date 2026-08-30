# DSH 两个独立 Agent POC

本目录只新增两个独立 Runtime Request 合同，不修改旧 `quality-agent` 基线：

- Agent 1 `dsh-consumer-analysis`：消费者意图、13 个场景、实体和 8 种回应有用性；
- Agent 2 `dsh-quality-rules-analysis`：读取冻结质检规则，逐项返回四态结果，不计算分数。

两个 builder 都直接接收同一份 canonical call，Agent 2 的函数签名不存在 Agent 1 输出参数，
因此不会形成隐式串联。

`master_data/product_catalog_v1.json` 是从 `产品组名称与CODE.xlsx` 只读提取的品牌与
产品组主数据。真实样本中的“西门子”可精确解析为品牌 `A02`，“洗碗机”可精确解析为
产品组 `1201`；无法唯一对应时不得猜 CODE。

## 规则资产决策

现有 `ResultRuleSet.rules` / `ResultRuleVersion.rules` 继续作为一个版本化业务资产，推荐结构为：

```text
evaluationRules[]  Agent 2 读取的质检项目定义
scoreRules[]       系统根据 Agent 2 的 result_by_rule 确定性扣分
issueRules[]       系统根据 Agent 2 的 result_by_rule 派生问题和风险
```

管理员在“质检/结果规则”页面编辑草稿并发布；Task Run 只读取已发布、不可变的
`ResultRuleVersion` 快照。Agent 2 以及 Runtime 均不得注册、更新或回写规则。
`master_data/quality_rules_seed_v1.json` 是 10 条候选规则和系统评分映射的导入种子，
上线前仍需业务管理员审核发布。

`rule_import.build_result_rule_set_create_payload()` 可把种子转换成现有
`POST /api/result-rules` 的创建载荷，但不会自行调用接口或发布版本。发布时由平台生成
`ResultRuleVersion`；Agent 2 运行时只拿该版本快照，绝不回写“质检规则”列表。

## Canonical 数据格式

`schemas/hotline_call_input.schema.json` 是今后推荐的唯一 Agent 输入格式。关键字段：

```json
{
  "schema_version": "1.0",
  "call": {
    "acid": "30444348286",
    "connid": null,
    "tenant_id": null,
    "started_at_ms": 1772261958972,
    "ended_at_ms": 1772262137876,
    "recording_lookup": {
      "provider": "lydaas-list-record-v2",
      "lookup_field": "acid"
    }
  },
  "messages": [
    {
      "index": 0,
      "message_id": "102...",
      "role": "chatbot",
      "speaker": {"id": "...", "name": "机器人", "source_type": "CHATBOT"},
      "text": "您好……",
      "start_time_ms": 1772261958972,
      "end_time_ms": 1772261958972,
      "start_offset_ms": 0,
      "end_offset_ms": 0,
      "need_split": false
    }
  ],
  "source": {"format": "lydaas-message-v2", "trace_id": null},
  "recording_metadata": {
    "format": "wav",
    "channels": 1,
    "sample_rate_hz": 8000,
    "sample_width_bytes": 2,
    "duration_ms": 175640
  }
}
```

当前 normalizer 同时支持：

- `data.messages.list[]`，角色 `CUSTOMER/SERVICER/CHATBOT/SYSTEM`；
- 旧 `success + data[]`，确认映射 `senderType 1/2/4 = customer/agent/system`。

消息按开始时间排序并重新生成连续 index。姓名、电话、地址和原始 speaker 字段不脱敏。
真实样本及录音不会复制进 Git，只在调用方指定的输出目录生成运行材料。

## 录音接口

`recording.resolve_recording()` 按以下合同调用：

```text
POST https://gateway.lydaas.com/api/hsf/xspace-openapi-proxy/HotlineProxyService/listRecordV2
{"arg0": "<workspace key>", "arg1": "<acid>"}
```

只接受 `success=true`、`callId` 与 acid 一致且 URL 为 HTTPS 的记录；多条记录取
`recordCreatedTime` 最新一条。签名 OSS URL 不写入普通结果，业务结果只保留 call_id、
稳定引用和必要的音频时间区间。

函数支持由调用方传入 `headers`，但不会把认证信息写死在代码中。使用当前本机环境、
不带任何额外认证头直调真实接口返回 HTTP 403，因此部署方还需要提供该网关要求的
服务身份或认证头；这不影响响应解析合同和本地 WAV 处理。

当前 Runtime Contract 仍是 JSON-only，不能直接把 WAV 二进制作为模型消息。POC 已完成
录音解析和 WAV 元数据处理；后续把 `audio_clip_transcribe` 接入质量 MCP 后，规则可以按
`allowedTools` 对称启用音频片段复核。

## 13 个场景

`故障咨询、报修与预约、转人工、服务进度与物流、安装咨询、政策发票等咨询、产品咨询、
价格/门店咨询、选购推荐、型号对比、使用指导、配件/耗材咨询、日常维护保养`。

## 8 种 usefulness

`有用_基础回应、有用_高质量回应、无用_答非所问、无用_错误/有害、无用_系统异常、
无用_无法解决、引导_其他渠道转接、引导_需求澄清`。

## 本地处理真实样本

```bash
PYTHONPATH=packages/runtime_contract/src:poc/agent_runtime_providers \
python -m independent_agents.sample_runner \
  --transcript '/path/response 机器人转人工.json' \
  --audio '/path/30444348286录音文件.wav' \
  --output-dir /tmp/dsh-independent-agents-sample \
  --model qwen3.8-max
```

输出 canonical call、两个彼此独立的 Runtime 请求和结构化运行摘要。

如本机 DSH Runtime 已运行，可分别提交两个请求（两条命令互不依赖）：

```bash
PYTHONPATH=packages/runtime_contract/src:poc/agent_runtime_providers \
python -m independent_agents.runtime_client \
  --request /tmp/dsh-independent-agents-sample/consumer_analysis_request.json \
  --output /tmp/dsh-independent-agents-sample/consumer_analysis_runtime_result.json

PYTHONPATH=packages/runtime_contract/src:poc/agent_runtime_providers \
python -m independent_agents.runtime_client \
  --request /tmp/dsh-independent-agents-sample/quality_rules_request.json \
  --output /tmp/dsh-independent-agents-sample/quality_rules_runtime_result.json
```
