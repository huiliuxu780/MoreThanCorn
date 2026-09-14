# 09-14 OpenAPI 初始化轮（Apifox 导出 → 平台 Connection/Tool）

用户给两份 Apifox 导出的 OpenAPI 3.0（测试环境接口，`~/Downloads/默认模块.openapi.json` 与
`默认模块.openapi (1).json`，共 21 端点），问「平台能初始化进去么」→ 评估答复后用户拍板
「你直接来创建」。本轮交付：域名探活证据链、执行链两处真缺口修复、21 端点全量入库、
OAT 连接骨架、诚实限制清单。

## 1. 域名探活证据链（为什么 base 是 gw.dev-corn）

两份文件 `servers: []` 为空，base 域名只能实证。逐域探测（路由存在性判据：
404-no-route vs 403-需鉴权 vs 200）：

| 域名 | 结果 | 结论 |
| --- | --- | --- |
| pre-gw.xixikf.com | Kong「no Route matched」全路径 | 08-30 wiki 网关，不路由这批 API |
| pre-opengateway.xixikf.com | 同上 | 排除 |
| bean-test.bshg.com.cn | 302 → /login/app | 网页门户（文件服务域），非机器网关 |
| gateway.lydaas.com | 文件二路径 403「accesskey not exit」；文件一路径 404 | lydaas 生产网关：路由在但本 AKSK 未注册 |
| **gw.dev-corn.bshg.com.cn** | 文件二路径 403→带 AKSK **200×4**；文件一路径 404 | **文件二测试 base 确认** |
| 调研 HAR（quickservice.lydaas.com） | — | 另一产品线，排除（记忆规约） |

实测（只读查询，平台内解密 AKSK→sign_aksk→直连）：

```
listRecordV2        → HTTP 200 {"code":"query buId by instanceId error",...}（网关过、业务层示例 ID 过期）
queryMessageLog     → HTTP 200 同上
searchTicketById    → HTTP 200 null
dubbo searchTicket  → HTTP 200 {"code":"SystemError",...}（业务层）
```

**文件一（OAT/BSH BP：bshbp-gate/orderPlatform/sopSelectPlatform/bshbp-crm*/sopCornPlatform）
在所有可达网关均 404**——base 域名只存在于用户的 Apifox 环境配置，本轮无法自发现。
OAT 连接以空 base_url 入库（draft），工具执行时报「endpoint 未配置 base_url」诚实失败，
域名补上即通（相对 URL 设计，见 §3）。

## 2. 入库清单（21 端点，幂等键=策展名称）

- **xspace 组（10）**：绑定 `browser-accept-gw`（AKSK）。该连接 dev/root endpoint 原指
  pre-gw.xixikf.com（实测不路由、status=failed）→ 修正为 `https://gw.dev-corn.bshg.com.cn`
  （**secret 未触碰**；prod 环境 gw.xixikf.com 未实测保留不动）。
- **oat 组（11）**：新建连接「OAT 业务网关（BSH BP）」`852bf5c9`：protocol=http-api、
  **kind=script**（Apifox 兼容 shim 脚本产出裸 `Authorization: <JWT>`——导出示例无 Bearer 前缀，
  bearer 种会加前缀不符）、environments test/prod 双槽 endpoint 空（待填）、default_env=test、
  secret={username,token, password←环境变量 OAT_PASSWORD} 加密落库（ledger v1）、lifecycle=draft。
- 状态策略（deny 起步原则）：**查询/鉴权 13 个 ready；写操作 7 个 + multipart 1 个 = 8 个 disabled**
  （建单/创建工单/更新/活动执行/入队/标签编辑/电销推送），启用须用户拍板白名单。
- schema 诚实处理：requestBody schema 为空或 argN 位置参数透传（HSF/Dubbo 代理风格）→
  input_schema 从 example 反推（只取类型，**example 值/PII/token 不入库**）；schema 与 example
  冲突以 example 为准（searchTicketById：schema 称 arg2 对象、example 实为 arg2=工单ID）；
  selectCanBuy/延保卡校验/multipart 推送有真 schema 直接用；响应 schema 完整者存 output_schema。
- 每条 description 带溯源行 `[Apifox OpenAPI 导入 09-14] 组=… 分类=…` + 质量/风险标注
  （argN 语义需人工标注、multipart 限制、存量重复工具退役候选等）。

导入器：`server/scripts/import_openapi_tools.py`（--plan 默认/--apply；spec 路径走参数、
原文件留仓库外；密码只从环境变量读；重复运行 0 创建 21 跳过）。

## 3. 执行链真缺口修复（两处）

1. **工具 URL 相对路径解析**（`connection_runtime.resolve_tool_url`）：绝对 URL 原样（向后兼容）；
   `/` 开头相对路径拼绑定 Connection 的 `endpoint.base_url`——端点单点归 Connection（D5 原则），
   多环境切 env 即切域名，21 个工具配方不再硬编码 host×21。两条执行路径
   （`platform_tool_exec.execute_tool_version` + `runner.exec_tool`）统一接入。
2. **执行面状态闸门**：非 ready（disabled/archived）工具在两条执行路径失败关闭——
   修「界面停用但被引用仍可执行」的僵尸路径（存量 8 个 disabled 工具此前无此闸）。

测试：`tests/test_tool_relative_url.py` 11 条（解析六态 + 平台路径拼接/无连接/闸门 + runner 闸门）。

## 4. 验证证据

- `pytest tests/` **602 passed**（含新增 11；存量零冲击）。
- `gate.sh --live` **ALL GATES GREEN**（8120 重启后）。
- 直签只读调用 200×4（§1 表）——网关鉴权链（平台加密 secret→resolve→sign_aksk）实证。
- 平台执行路径（execute_tool_version，录音查询工具）：相对 URL 正确解析为
  `https://gw.dev-corn.bshg.com.cn/api/hsf/...`、鉴权头正确装配，最终
  `EGRESS_BLOCKED：gw.dev-corn.bshg.com.cn 解析到受限地址 198.18.0.250`——**本机代理 fake-ip
  （198.18/15 被 Python 判私网）撞上工具路径的严格闸 assert_safe_url**（数据源路径走
  enforce_egress 仅生产生效故不受影响）。本地环境限制，非代码缺陷；真实 DNS 部署即通。
  是否把工具路径也降为 enforce（或给本地 fake-ip 受控豁免）= 安全策略拍板项，未擅动。
- OAT script 鉴权空 token → AuthSignError 带引导文案（「先调用 OAT 登录换 Token…」）诚实失败。
- disabled 工具执行 → ValueError/RunError「执行面失败关闭」实证。
- 导入器幂等复跑：创建 0 / 跳过 21 / 缺失 0。
- UI 截图（docs/acceptance/assets/2026-09-14-openapi-import/）：01 工具列表（29 Tool、
  Untested/Disabled 徽章、溯源描述）/02 工具详情（argN+退役候选标注、Connection=browser-accept-gw）/
  03 设置→连接（OAT 连接 draft+自定义脚本鉴权+未测试）。

## 5. 诚实限制与待拍板

1. **文件一 base 域名**：待用户从 Apifox 环境配置提供（环境→默认模块→base URL）；
   补进 OAT 连接 test 环境 endpoint 即全通（相对 URL 已就位）。
2. **写工具白名单**：8 个 disabled 里哪些启用（建单类有真实副作用）。
3. **凭据轮换**：corn-prod 密码与两个长效 JWT 曾明文出现在导出文件/对话；密码已只存加密
   secret，仍建议轮换。OpenAPI 原文件未入仓（含明文凭据+手机号）。
4. **egress 双闸不一致**（assert 严格 vs enforce 仅生产）：本地 fake-ip 下工具活体不可达，拍板口径。
5. **存量重复**：`lydaas_recording_lookup_v2`（disabled、URL 指 gateway.lydaas.com 本 AKSK 不识别）
   为退役候选；新「热线录音查询（listRecordV2）」为统一形态。
6. **健康探针**：http-api 探测 GET base_url 根路径，网关回 404 → 健康恒「失败/未测试」；
   需要 per-connection 健康路径配置（另案）。
7. **argN 语义**：HSF 位置参数透传端点（createTicket 业务契约在 arg12 JSON 字符串内）
   需人工标注字段语义后 agent 才可靠使用。
8. multipart/form-data（电销推送）当前执行链仅 JSON，接通需出站动作改造。

## 6. 提交

代码+脚本+测试+报告+截图一笔提交（OpenAPI 原文件与 tmp 截图脚本不入库）。
