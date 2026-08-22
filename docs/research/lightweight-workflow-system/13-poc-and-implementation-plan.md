# 13 · 最小 POC 与分阶段实施计划（Designed）

## 1. POC 场景（任务书 §12 确认版）

```
Start(输入: call_transcript, service_id)
→ LLM① 识别承诺类型（structured output: promise_type, has_promise）
→ Condition has_promise == true
   ├─ yes → Tool 查询工单创建记录（http tool, connection=biz_api）
   │        → LLM② 比对承诺与工单记录，判断是否执行到位
   └─ no  → Transform 生成"无承诺"结构化结果
→ Transform 合并生成 quality_result + evidence[]
→ create-record（Sink，幂等键=run_id+node_id）
→ End
```

POC 验收点（逐条可演示）：
1. 创建 Workflow（列表→Designer）；2. 保存草稿（自动保存指示）；3. 节点注册表驱动 Palette/Inspector；4. Tool 注册（DB 行，不改代码）；5. Model 选择；6. 条件分支执行；7. 测试运行（Test Panel 输入→运行）；8. NodeRun 逐节点落库；9. SSE 事件驱动画布节点状态环；10. Logs 面板（节点输入/输出/Tool Call/耗时）；11. 发布 V1（Dependency Check+二次确认+Version Note）；12. 手动触发正式 Run（绑定 published version）；13. 检查清单红点（未配置/未连接）。
**Schedule 与批量 Task 不进 POC**：但 `schedule` 表、`POST /schedules` API、scheduler tick 代码以"开关关闭"状态随 V1 交付（接口与接入点就绪，任务书 §12 要求）。

## 2. 实施分阶段

| 阶段 | 内容 | 出口标准 |
|---|---|---|
| P0 地基 | Alembic 全量表（11）；FastAPI 骨架；auth 占位；node/tool registry 代码注册；Validator（07 §5）+ 纯函数环检测 | `POST /workflows`+`PUT draft`+`GET validation` 契约测试绿 |
| P1 编辑器闭环 | 前端 Designer 接真 API：Palette/通用节点/Inspector schema 表单/Variable Picker/自动保存/检查红点 | 可编辑出 POC 图并通过 validation |
| P2 执行闭环 | PG queue（SKIP LOCKED）+ 同进程 worker + Runner 状态机（09）+ executors(llm/tool/condition/transform/sink) + run_event + SSE | POC 测试运行全绿，画布实时状态 |
| P3 发布与运行 | publish/versions/history sheet；手动触发；Run 列表/Run Detail/Logs 面板；Tool 调用日志 | POC 12 项验收全过 |
| P4 任务与 Schedule | Task 绑定 version policy；schedule CRUD+tick+执行历史；Data Window [start,end) | 周期任务跑通（企业时区） |
| P5 业务接线 | create-record Sink→quality_result/evidence；Review 流；Result Rules 消费 | 与既有质检页联通 |

第一刀（任务书 §15"第一刀开发什么"）：**P0+P1 的 Validator 与草稿契约**——它同时是前端表单、检查清单、发布门禁、Runner 前置校验的唯一事实源。

## 3. V1 节点清单（任务书 §11 判断）

| 节点 | 用途 | Executor | 错误行为 |
|---|---|---|---|
| input | 声明输入契约 | 透传+schema 校验 | 校验失败=run failed |
| llm | 模型调用+结构化输出 | llm_gateway | 重试 retries 次后 failed；超时 timed_out |
| tool | 绑定 Tool Version 调用 | http/builtin executor | SSRF 拦截；5xx/timeout 有限重试 |
| condition | 分支（branches→sourceHandle） | 表达式求值（白名单） | 求值异常=failed |
| transform | 声明式数据转换 | jsonpath/模板求值器 | 类型不匹配=failed |
| end | 终端，汇总输出 | 收集 structured outputs | — |
| create-record | Sink 持久化质检记录 | Adapter→业务服务 | 幂等重放安全；失败可重试 |
| notification | V1 仅日志级通知 | log sink | onError=skip 默认 |

判断回答：Knowledge Search=**Tool**（builtin kind）；Output≠End（structured outputs 是契约，End 是终端节点，二者保留）；Human Review **不**做节点（业务层 Review 页已存在，Future 再评估 human-interrupt）；Schedule=Trigger 不是 Node；Tool 只保留一个通用 Tool 节点；Model 是节点配置不是节点。

## 4. 本轮绝对不做

LangGraph；Code 节点/任意 Python 存储；并行/Join/循环/子 workflow；OAuth 连接目录；MCP 运行时；多租户/计费；实时协作；节点市场；聊天 Playground。

## 5. 进入编码前的未决问题

1. xyflow v12 与 Sim reactflow v11 API 差异实测（Part A 未确认 #3）；
2. LLM provider 清单与网关协议（OpenAI 兼容？）需业务确认；
3. biz_api Tool 的真实鉴权方式（决定 connection kind）；
4. run_event 保留期与归档的运维口径；
5. 企业时区取值来源（部署配置键名）。
