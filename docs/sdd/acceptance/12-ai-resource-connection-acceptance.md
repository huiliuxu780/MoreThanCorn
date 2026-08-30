# AI Resources / Connections 重构验收清单

状态：**待实施、待独立验收**  
规格：`docs/sdd/12-ai-resource-connection-refactor-sdd.md`  
验收规则：实现者填写证据，验收人复跑并勾选；无证据不得标通过。

## 0. 验收记录格式

每一项完成时在条目后追加：

```text
证据：测试名 / 命令与关键输出 / 手工步骤与截图路径 / commit
验收人：
验收时间：
```

结果取值：未验收 / 通过 / 不通过 / 阻塞。不得使用“基本通过”。

---

## A. 数据模型与架构边界

- [ ] A-01 Connector Definition 有不可变 key/version、config schema、credential schema、operations、handler key 和 checksum。
- [ ] A-02 Connection、ConnectionEnvironment、SecretRevision、CheckRun 之间是明确 FK，不再依赖 environments JSONB 作为新路径事实源。
- [ ] A-03 普通 Connection config 更新不创建、不替换、不清空 SecretRevision。
- [ ] A-04 Resource、ResourceVersion、ResourceVersionBinding 已落库；发布版本不可修改。
- [ ] A-05 RuntimeProjection 由版本、绑定和运行环境确定性产生，不读取 Resource latest 草稿。
- [ ] A-06 Tool/MCP/Knowledge/Model 的 application service 不依赖 Router 函数。
- [ ] A-07 生命周期与健康字段分离，状态词表与规格一致。
- [ ] A-08 新增/修改表具备唯一约束、FK、索引、created/updated/actor 和 revision。

## B. Secret、安全与删除

- [ ] B-01 `GET /api/connections/{id}/reveal` 不再返回明文；新 API 无 reveal 能力。
- [ ] B-02 Secret rotate 创建新 revision，旧 revision retired；普通更新 revision 不变。
- [ ] B-03 Secret clear 需要 admin、明确确认、依赖检查和审计。
- [ ] B-04 API、日志、异常、CallRecord、RunEvent、审计中无测试 Secret 明文；静态与动态泄漏扫描通过。
- [ ] B-05 删除有引用 Connection 返回 409 + 完整 refs，不改变任何引用方。
- [ ] B-06 删除有引用 Resource 返回 409 + 完整 refs；历史 Run/Release 不受影响。
- [ ] B-07 默认 DELETE 执行 archive；硬删除仅限无引用 draft，并有 admin 审计。
- [ ] B-08 HTTP egress 能阻断私网、metadata、DNS rebinding、IPv6/link-local、重定向绕过。
- [ ] B-09 Tool mapping 无法覆盖 Host/Authorization/Cookie 等 protected headers。
- [ ] B-10 stdio MCP 无 shell 注入、无完整环境继承、命令受 allowlist 和资源限制。

## C. Connection 行为

- [ ] C-01 新建 Connection 可保存 Draft，不需要客户端传 `tested=true`。
- [ ] C-02 启用必须依赖当前 config fingerprint 的真实成功 CheckRun。
- [ ] C-03 config/Secret/Definition 变化后健康度从 healthy 变 stale。
- [ ] C-04 默认环境不存在、停用或未检查时，发布/执行被明确错误码阻止。
- [ ] C-05 generic HTTP、LLM、MCP、PostgreSQL/MySQL、OSS 分别使用 definition-specific check。
- [ ] C-06 Check 结果包含阶段、耗时、脱敏诊断、fingerprint 和 traceId。
- [ ] C-07 revision 冲突返回 409，不能静默覆盖并行编辑。
- [ ] C-08 环境 code 创建后不可改名；迁移通过新增/切绑定/归档完成。

## D. Tool

- [ ] D-01 HTTP Tool 只保存相对 path，base URL 与 auth 来自 Connection Binding。
- [ ] D-02 Tool input/output 均按发布版本 JSON Schema 校验。
- [ ] D-03 Test、Workflow、Agent 三条入口最终进入同一个 ToolExecutor。
- [ ] D-04 Tool 发布后 spec/binding 不可改；编辑创建新草稿版本。
- [ ] D-05 destructive 或非幂等 Tool 不发生自动 failover。
- [ ] D-06 幂等 Tool 只对规格允许的 transport/429/5xx 错误 failover，并记录多个 Attempt。
- [ ] D-07 普通新建 Tool 不再默认 `echo`；fixture Tool 明确标识 test-only。
- [ ] D-08 CallRecord 可定位 ResourceVersion、Binding、ConnectionEnvironment、SecretRevision 和实际 attempt。

## E. MCP

- [ ] E-01 主服务依赖锁定官方 `mcp==2.1.1` 或评审批准的后续 2.x 版本。
- [ ] E-02 Streamable HTTP 使用官方 `mcp.Client` 完成真实 discover/list_tools。
- [ ] E-03 stdio 使用官方 SDK，executable/args 分离，无自由 shell command。
- [ ] E-04 `services/tool_service` 作为真实 MCP server，主服务 discover 出四个工具且 schema/annotations 正确。
- [ ] E-05 用户选择工具后保存稳定快照；未选择工具正式调用被拒绝。
- [ ] E-06 同名 MCP Tool 经稳定 namespace 去冲突，不靠覆盖或随机后缀。
- [ ] E-07 call_tool 正确处理 structured_content、content blocks、is_error、timeout 和 cancellation。
- [ ] E-08 Connection config/Secret 变化使 discovery cache stale；refresh 后 digest 更新。
- [ ] E-09 `resource_tests.py` 和正式运行路径不存在手写 initialize/session/tools/call。
- [ ] E-10 `_MOCK_MCP_TOOLS` 与生产/普通开发示例发现路径已删除或机器证明不可达。

## F. Knowledge

- [ ] F-01 Knowledge endpoint 和 credential 来自 Connection Binding，不在 `source_config.url` 保存新配置。
- [ ] F-02 Knowledge Collection spec 只保存 collection locator、retrieval policy 和模型引用。
- [ ] F-03 SyncRun 状态、数量、版本、错误和耗时可查询。
- [ ] F-04 Query Test 使用正式 Retriever，返回 slice/source/score/latency。
- [ ] F-05 生产和普通开发无 `[mock]` 切片回退；fixture 仅在显式 test profile 可用。
- [ ] F-06 embedding/rerank 引用已发布 Model ResourceVersion，不引用字符串 latest。
- [ ] F-07 外部只读 Collection 不能在本平台伪装为可编辑正文资产。

## G. LLM / ModelCatalog

- [ ] G-01 Model identity/capability/default params 与 Provider endpoint/credential 分离。
- [ ] G-02 `runner._call_model` 与 `agent_runtime._chat_completion` 已收编为单一 ModelClient。
- [ ] G-03 Provider check 真实访问 Provider；只存在 API Key 不能判健康。
- [ ] G-04 Inference check 使用目标模型发出最小真实推理请求。
- [ ] G-05 新发布 Agent/Workflow 绑定 Model ResourceVersion ID。
- [ ] G-06 流式、非流式、tool calling、错误、usage、egress 和 auth 由同一客户端处理。
- [ ] G-07 环境变量 bootstrap 不会静默覆盖用户 Catalog binding；实际选择可审计。
- [ ] G-08 CallRecord 能定位实际 model、ResourceVersion、binding、env 和 usage。

## H. UI / UX

- [ ] H-01 Connection 新建先选 Definition，表单字段由 schema 驱动。
- [ ] H-02 Connection 页面同时显示 lifecycle 与 health，不把 untested 显示 healthy。
- [ ] H-03 Secret 永不回填；只显示 configured/version/rotatedAt，并提供独立 rotate/clear。
- [ ] H-04 config 修改后立即显示 stale，并引导重新 Check。
- [ ] H-05 有引用的 Connection/Resource 显示 Usage 并禁止删除，不静默解绑。
- [ ] H-06 Resource 四类共享 Overview/Configuration/Bindings/Versions/Usage/Diagnostics 骨架。
- [ ] H-07 内联新建 Connection 返回稳定 ID，关闭后资源向导保留上下文并自动选中。
- [ ] H-08 MCP Discover 展示 capabilities、tools、schema、annotations、digest，并允许选择后测试。
- [ ] H-09 Tool 编辑器不要求用户手写完整 URL；Connection 与相对 path 分区清楚。
- [ ] H-10 Knowledge 展示同步与 query test；Model 展示 provider 与 inference 两级检查。
- [ ] H-11 Published 版本配置只读；编辑动作创建新 Draft。
- [ ] H-12 错误 UI 展示业务错误码、可操作建议和 traceId，不展示 Secret 或原始堆栈。
- [ ] H-13 键盘、焦点、Label、错误关联和密码管理器语义通过可访问性检查。

## I. 迁移与兼容

- [ ] I-01 存量 Connection 总数、ID、默认环境、环境数和 secretConfigured 状态迁移前后一致。
- [ ] I-02 Tool/MCP/Knowledge/Model 总数与稳定 ID 保持；所有可转换项生成 v1 ResourceVersion。
- [ ] I-03 不能自动转换的记录进入 needs_review 清单，不被猜测或丢弃。
- [ ] I-04 存量 Tool/MCP/Model/Knowledge 的 Connection 引用全部有可追踪 Binding 映射。
- [ ] I-05 历史 Workflow/Agent/Release/Run 引用仍可读；artifactHash 不被重写。
- [ ] I-06 新发布只写 ResourceVersion ID，旧字段不再新增数据。
- [ ] I-07 migration 脚本幂等，重复运行不产生重复版本/环境/SecretRevision。
- [ ] I-08 迁移报告包含总数、成功、跳过、异常和具体异常 ID；异常为 0 或逐项处置。
- [ ] I-09 备份恢复演练通过；回滚不删除新表、不暴露 Secret、不破坏历史 Run。

## J. 零假路径、可观测与回归

- [ ] J-01 production profile 下所有 Tool/MCP/Knowledge/LLM 缺真实配置时失败关闭。
- [ ] J-02 普通 dev profile 不会因为缺配置自动返回成功 mock；fixture 必须显式开启。
- [ ] J-03 `check-no-prod-mock`、`check-no-secret-leak`、`check-resource-v2-cutover` 全部通过。
- [ ] J-04 每次 check/discover/test/runtime call 均有 trace/CallRecord/Attempt。
- [ ] J-05 指标能按 connector/resource/operation 查看成功率、P95、错误和 stale 数量。
- [ ] J-06 新旧 Runtime 灰度期可对比，出现异常可 feature flag 回滚。
- [ ] J-07 既有 Agent、Workflow、Task、Run、Resource 列表与发布主链无回归。
- [ ] J-08 lint/typecheck/vitest/build/全量 pytest/Tool Service pytest/全栈 E2E 全绿。

## K. 必跑命令

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run build
server/.venv/bin/pytest server/tests -q
services/tool_service/.venv/bin/pytest services/tool_service/tests -q
node scripts/check-no-prod-mock.mjs
node scripts/check-no-secret-leak.mjs
node scripts/check-resource-v2-cutover.mjs
node scripts/verify-fullstack.mjs
node scripts/e2e-resource-runtime.mjs
```

实际验收时在此记录每条命令的日期、commit、退出码和摘要，不接受只粘贴最后一行 PASS。

## L. 状态日志

| 日期 | 状态 | 说明 |
| --- | --- | --- |
| 2026-08-31 | 清单建立 | 等待实施；所有条目保持未勾选 |

