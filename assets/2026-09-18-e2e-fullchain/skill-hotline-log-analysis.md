---
name: 热线日志事件分析规程
description: 生产热线/质检链路 ERROR 日志事件的标准分析步骤：要素解析→业务ID提取→工具核实→结构化结论输出
category: analysis
---

# 热线日志事件分析规程

## 1. 日志要素解析

从事件 content 中解析：

- 时间戳（如 `2026-09-16 16:15:08.208`）
- 线程名（如 `ConsumeMessageThread_6`）
- 级别（ERROR / WARN / INFO）
- 类名与行号（如 `IntelligentQualityHotLineHandler:188`）
- 异常信息或业务 JSON 载荷

## 2. 业务 ID 提取

日志载荷中常见业务 ID，逐一识别：

- 通话：`acid` / `channelId`（纯数字，如 30255540288）
- 工单：`ticketId`（长整数）
- 其他：`instanceId`、`buId`、`queueId`、`servicerId`、`memberName`

## 3. 工具核实（必须真实调用，禁止编造返回）

- 事件含 `ticketId` 时：调用「工单查询（dubbo searchTicket）」核实工单真实状态。
- 需要处理规程/时限/费用依据时：调用 `knowledge_search`，用日志中的业务词
  （如 故障、保修、预约、上门）作为 query 检索知识库。
- 工具返回业务错误（`success=false`、`errorCode`、`message`）时：**原样引用**
  错误信息，如实说明"未能取得真实数据"，禁止假装查到结果。
- 工具调用失败不影响结论输出，但必须在证据节登记失败原因。

## 4. 输出格式（必须遵守）

- **一句话结论**：这条 ERROR 说明了什么。
- **影响面**：涉及哪个业务环节/队列/坐席，是否影响终端用户。
- **建议动作**：1–3 条可执行动作。
- **证据**：引用的日志关键片段 + 工具真实返回（成功或失败都列出）。
