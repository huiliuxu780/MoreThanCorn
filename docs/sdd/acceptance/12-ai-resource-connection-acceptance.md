# AI Resources / Connections 重构验收清单

状态：**P0 独立验收不通过（A-03、B-03、C-04 阻断；其余阶段待实施）**
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
- [ ] A-03 普通 Connection config 更新不创建、不替换、不清空 SecretRevision。**P0 验收不通过：部分环境更新会删除未提交环境及其 Secret 事实记录。**
- [ ] A-04 Resource、ResourceVersion、ResourceVersionBinding 已落库；发布版本不可修改。
- [ ] A-05 RuntimeProjection 由版本、绑定和运行环境确定性产生，不读取 Resource latest 草稿。
- [ ] A-06 Tool/MCP/Knowledge/Model 的 application service 不依赖 Router 函数。
- [x] A-07 生命周期与健康字段分离，状态词表与规格一致。
- [ ] A-08 新增/修改表具备唯一约束、FK、索引、created/updated/actor 和 revision。

## B. Secret、安全与删除

- [x] B-01 `GET /api/connections/{id}/reveal` 不再返回明文；新 API 无 reveal 能力。
- [x] B-02 Secret rotate 创建新 revision，旧 revision retired；普通更新 revision 不变。
- [ ] B-03 Secret clear 需要 admin、明确确认、依赖检查和审计。**P0 验收不通过：`PUT environments[].clearSecret=true` 可绕过确认和依赖检查。**
- [x] B-04 API、日志、异常、CallRecord、RunEvent、审计中无测试 Secret 明文；静态与动态泄漏扫描通过。
- [x] B-05 删除有引用 Connection 返回 409 + 完整 refs，不改变任何引用方。
- [x] B-06 删除有引用 Resource 返回 409 + 完整 refs；历史 Run/Release 不受影响。
- [x] B-07 默认 DELETE 执行 archive；硬删除仅限无引用 draft，并有 admin 审计。
- [ ] B-08 HTTP egress 能阻断私网、metadata、DNS rebinding、IPv6/link-local、重定向绕过。
- [ ] B-09 Tool mapping 无法覆盖 Host/Authorization/Cookie 等 protected headers。
- [ ] B-10 stdio MCP 无 shell 注入、无完整环境继承、命令受 allowlist 和资源限制。

## C. Connection 行为

- [x] C-01 新建 Connection 可保存 Draft，不需要客户端传 `tested=true`。
- [x] C-02 启用必须依赖当前 config fingerprint 的真实成功 CheckRun。
- [x] C-03 config/Secret/Definition 变化后健康度从 healthy 变 stale。
- [ ] C-04 默认环境不存在、停用或未检查时，发布/执行被明确错误码阻止。**P0 验收不通过：更新可把 `default_env` 设为不存在的 code 并返回 200。**
- [ ] C-05 generic HTTP、LLM、MCP、PostgreSQL/MySQL、OSS 分别使用 definition-specific check。
- [x] C-06 Check 结果包含阶段、耗时、脱敏诊断、fingerprint 和 traceId。
- [ ] C-07 revision 冲突返回 409，不能静默覆盖并行编辑。
- [ ] C-08 环境 code 创建后不可改名；迁移通过新增/切绑定/归档完成。

## D. Tool

- [ ] D-01 HTTP Tool 只保存相对 path，base URL 与 auth 来自 Connection Binding。
- [ ] D-02 Tool input/output 均按发布版本 JSON Schema 校验。
- [ ] D-03 Test、Workflow、Agent 三条入口最终进入同一个 ToolExecutor。
- [ ] D-04 Tool 发布后 spec/binding 不可改；编辑创建新草稿版本。
- [ ] D-05 destructive 或非幂等 Tool 不发生自动 failover。
- [ ] D-06 幂等 Tool 只对规格允许的 transport/429/5xx 错误 failover，并记录多个 Attempt。
- [x] D-07 普通新建 Tool 不再默认 `echo`；fixture Tool 明确标识 test-only。
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

- [x] J-01 production profile 下所有 Tool/MCP/Knowledge/LLM 缺真实配置时失败关闭。
- [x] J-02 普通 dev profile 不会因为缺配置自动返回成功 mock；fixture 必须显式开启。
- [x] J-03 `check-no-prod-mock`、`check-no-secret-leak`、`check-resource-v2-cutover` 全部通过。
- [ ] J-04 每次 check/discover/test/runtime call 均有 trace/CallRecord/Attempt。
- [ ] J-05 指标能按 connector/resource/operation 查看成功率、P95、错误和 stale 数量。
- [ ] J-06 新旧 Runtime 灰度期可对比，出现异常可 feature flag 回滚。
- [x] J-07 既有 Agent、Workflow、Task、Run、Resource 列表与发布主链无回归。
- [x] J-08 lint/typecheck/vitest/build/全量 pytest/Tool Service pytest/全栈 E2E 全绿。

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
| 2026-08-31 | P0 实施完成，交付待验收 | 分支 `feat/sdd12-p0-connection-refactor`（HEAD f9e4149）；迁移 `g045sdd12p0001`（wf_dev/wf_test 已 upgrade head）；12 项机器门禁全绿（见 M.1）；P0 证据见附录 M；全部条目保持未勾选，由验收人复跑 |
| 2026-08-31 | P0 独立验收不通过 | 验收人复跑既有机器门禁全部通过；新增负向探针命中 A-03、B-03、C-04 三个 P0 阻断项。通过的 P0 条目已勾选，失败项保持未勾选；详情见 M.5。 |
| 2026-08-31 | 阻断项修复完成，二次待验收 | 修复与证据见 M.6：A-03 环境 patch 化、B-03 EnvPatch 禁 Secret 写入、C-04 default_env 合并后校验，另修复归档门禁/轮换结构校验/_set_env_ref 落库缺陷；后端 336 tests、E2E 41/41、verify-fullstack 63/63、全部静态度门禁复验通过。失败项保持未勾选，由验收人二次复跑 |

---

## M. P0 交付证据（实现者填写；验收人复跑后在对应条目勾选）

交付物：分支 `feat/sdd12-p0-connection-refactor`（含迁移 `g045sdd12p0001_secret_revision_check_run`，
已在 wf_dev / wf_test 执行 `alembic upgrade head`）。
验收环境：后端 `uvicorn app.main:app --port 8120`（WF_DATABASE_URL=wf_dev，默认开发 profile，
**未开** `WF_TEST_FIXTURES`）；前端 `npm run dev`（5173 → 8120）。

### M.1 机器门禁复跑命令（全部已通过，验收人可逐条复跑）

```bash
cd /Users/rivers/MoreThanCorn
npm run lint                                     # eslint 0 error
npm run typecheck                                # tsc -b 0 error
npm test -- --run                                # vitest 34 passed
npm run build                                    # vite build ok
server/.venv/bin/pytest server/tests -q          # 327 passed（含 4 个 SDD-12 新测试文件）
services/tool_service/.venv/bin/pytest services/tool_service/tests -q   # 7 passed（新增 tests/conftest.py 修复跨目录导入）
node scripts/check-no-prod-mock.mjs              # PASS（mock/echo 均有生产/fixture 守卫）
node scripts/check-no-secret-leak.mjs            # 需运行中的服务（LEAK_BASE，默认 http://127.0.0.1:8120）：静态+金丝雀 PASS
node scripts/check-resource-v2-cutover.mjs       # PASS（P0 切流不变量）
VERIFY_BASE=http://127.0.0.1:8120 node scripts/verify-fullstack.mjs      # 63/63 PASS
E2E_BASE=http://127.0.0.1:8120 node scripts/e2e-resource-runtime.mjs     # 34/34 PASS
server/.venv/bin/python scripts/report-resource-migration.py --out docs/sdd/acceptance/12-migration-report-P0.json
```

### M.2 条目级证据映射（仅覆盖 P0 已交付项）

| 条目 | 证据 |
| --- | --- |
| A-03 | `test_sdd12_secret_lifecycle.py::test_a03_update_without_secret_preserves_all_refs`；e2e R5-1～R5-3；verify S4/S5 链。普通更新不产生/替换/清空 SecretRevision（`_env_rows_merge` 按 code 合并，掩码保留）。 |
| A-07 | 生命周期与健康分离：`connection.lifecycle`（draft/active/disabled/archived）与 `check_run` 派生健康（untested/healthy/degraded/failed/stale）；`test_sdd12_contracts.py::test_status_vocab_frozen_verbatim`；e2e R1-3/R2-4/R3-2。 |
| B-01 | reveal 恒 410：`test_sdd12_secret_lifecycle.py::test_b01_reveal_disabled_410`、`test_p0_security_negatives.py::test_viewer_cannot_reveal_secret`；e2e R4-1；verify S2-4。前端 `pagedApi.reveal` 已删除，编辑页不再回显。 |
| B-02 | 轮换=新 revision + 旧 retired、普通更新不变：`test_b02_rotate_creates_new_revision_retires_old`、`test_rotate_env_scoped`、`test_a03_*`（断言 revision 不新增）；e2e R4-2/R5-3。 |
| B-03 | 清除需 admin+确认口令+依赖检查：`test_b03_clear_requires_admin_confirm_and_refs_check`（错口令 422；有引用 409+refs；force 后清除并审计）；e2e R4-4/R4-5。 |
| B-04 | 静态：`check-no-secret-leak.mjs`（routers 层无解密调用、reveal 410、审计不含明文）；动态：金丝雀扫描 9 个响应面无明文；`test_b04_no_plaintext_leak_in_api_audit_callrecord_checkrun`（含 DB 密文断言，测试用合法 Fernet key）。 |
| B-05 | 有引用 Connection 删除 409+完整 refs 且不解绑：`test_sdd12_connection_lifecycle.py::test_delete_409_refs_and_archive_flow`、`test_p2.py::test_connection_referenced_delete_blocked_with_refs`；e2e R6-1/R6-2；verify S11-7/S11-7b。 |
| B-06 | Resource 删除防护（原有 409+refs 保留）：`test_resources.py::test_delete_protection_chain`；verify S11-1～S11-6。 |
| B-07 | 默认删除=归档；硬删仅限无引用 draft 且留审计：`test_delete_409_refs_and_archive_flow`、`test_p2.py::test_connection_free_delete_archives`；e2e R6-3～R6-6；verify S11-7c/S11-7d。Resource 侧归档语义随 P2 Catalog（lifecycle/published）落地，本阶段 Resource 保持"409 防护 + 无引用可删 + 审计"。 |
| C-01 | 新建 Draft 无需客户端 tested：`test_c01_create_is_draft_without_client_tested`（tested:true 被忽略）；e2e R1-1；verify S2-1b。 |
| C-02 | 启用依赖当前指纹的成功 CheckRun：`test_c02_c06_enable_requires_real_checkrun`；e2e R1-2/R2-3；verify S2-3a/S2-3a2/S2-3c。 |
| C-03 | 配置/Secret 变化→stale：`test_c03_config_change_marks_stale_and_blocks_enable`、`test_secret_rotate_marks_connection_stale`；e2e R3-2/R3-3/R4 后健康派生；资源侧 `test_sdd12_resource_gate.py::test_toggle_enable_requires_real_test`（新版本→stale→409）。 |
| C-04 | 未检查/检查失败启用被明确错误码阻止：422 `CONNECTION_UNCHECKED`（无记录）、409（最近检查失败/`RESOURCE_HEALTH_STALE`）。见 C-02/C-03 证据。 |
| C-06 | CheckResult 含阶段/耗时/脱敏诊断/指纹/traceId：`test_c02_c06_*`（stage=capability/statusCode/checkRunId/traceId/configFingerprint）；e2e R2-2；verify S2-3b。 |
| D-07 | 普通新建 Tool 不再默认 echo；fixture 需显式标记：`test_sdd12_resource_gate.py::test_d07_echo_spec_rejected_without_fixture_marker`；e2e R8-1；verify S6-1b。向导默认 spec 改为真实请求骨架。 |
| J-01 | 生产/无 fixture 失败关闭：`test_j01_model_call_fail_closed_without_provider`（MODEL_UNAVAILABLE）；`check-no-prod-mock.mjs` PASS。 |
| J-02 | 普通 dev 无自动 mock；fixture 需显式开启且输出带标记：`test_j02_*`（delenv 后 MCP/Knowledge/Datasource/echo 全部失败关闭）；`test_fixture_profile_marks_output`；e2e R8-2/R8-3；verify S6-3～S6-5。pytest 套件的 fixture profile 由 `server/tests/conftest.py` 显式 `WF_TEST_FIXTURES=1`。 |
| J-03 | `check-no-prod-mock`、`check-no-secret-leak`、`check-resource-v2-cutover` 三脚本均通过（M.1）。 |
| J-07 | 主链回归：verify-fullstack 63/63（S8/S9/S10/S12/S13/S14 均过）；pytest 327 全绿。 |
| J-08 | lint/typecheck/vitest/build/pytest×3/全部脚本通过（M.1 命令与结果）。 |

### M.3 浏览器侧验证（实时栈 5173→8120，wf_dev）

在 `http://localhost:5173/settings/connections` 真机复核（非截图走查）：
- 生命周期与健康双徽章分离展示；未检查连接显示"未测试"，不显示"健康"（H-02）。
- 轮换凭据为受控 Dialog（非原生 prompt）；提交后卡片版本 1→2、健康转"已过时"，
  toast"凭据已轮换（版本 2）…请重新测试"（B-02/C-03）。
- 对凭据已变化的 draft 连接点"启用"，toast 如实提示"配置或凭据已变化，最近检查结果失效；
  请重新检查后再启用"（C-02/C-03 UI 表达）。
- 编辑对话框密钥输入框为空、占位提示"已保存的密钥不可回显"，无任何明文回填（B-01 UI 侧）。

### M.4 明确不在 P0 范围（保持未勾选，后续阶段交付）

- A-01/A-02/A-04/A-05/A-06/A-08：Connector Definition、规范化 ConnectionEnvironment/Resource/ResourceVersion/Binding 表、ProjectionService —— P1/P2（§17）。
- B-08～B-10：egress 负向用例补强、protected headers、stdio 安全 —— 部分已有基础（`egress.py`），完整负向矩阵随 P1/P2。
- C-05/C-07/C-08：definition-specific check、PATCH If-Match、环境改名规则 —— P1。
- D-01～D-06、E-01～E-10、F-01～F-07、G-01～G-08：Tool/MCP/Knowledge/LLM 运行时重构 —— P2/P3。
- H-01～H-13：Connections/Resource Center 新 IA 属 P1-06/P2；本阶段仅最小 UI 止血（去 reveal、启用/轮换/清除、生命周期+健康徽章、409 引用提示）。
- I-01～I-09：M1–M5 数据迁移 —— P1 起；交付时存量盘点见 `12-migration-report-P0.json`（needs_review=0，32 个存量连接协议均可映射）。
- J-04～J-06：全链路 trace/指标/灰度 —— P2/P4。

### M.5 P0 独立验收记录（2026-08-31）

验收人：Codex（独立复跑）

验收 commit：`f9e41497b04dae56e798436767404a45aa298ab4`

结论：**不通过**。既有 12 项机器门禁全部通过，但新增负向探针发现 3 个 P0 明示不变量未实现；机器门禁缺少对应覆盖。

机器门禁复跑摘要：

- `npm run lint`、`npm run typecheck`、`npm test -- --run`（34 passed）、`npm run build`：退出码 0。
- `server/.venv/bin/pytest server/tests -q`：327 passed，5 warnings，退出码 0。
- `services/tool_service/.venv/bin/pytest services/tool_service/tests -q`：7 passed，退出码 0。
- `check-no-prod-mock`、`check-no-secret-leak`（9 个动态响应面）、`check-resource-v2-cutover`：PASS。
- `verify-fullstack.mjs`：63/63 PASS；`e2e-resource-runtime.mjs`：34/34 PASS。
- `wf_dev` / `wf_test` 的 Alembic current 均为 `g045sdd12p0001 (head)`。

阻断复现（探针文件位于 `/tmp/sdd12_acceptance_negatives.py`，每条均在 `finally` 清理自产生数据）：

1. **A-03：部分环境更新不是按 code 合并。** 新建 `dev`/`prod` 两环境后，仅 PUT `dev`，接口返回 200；再次 GET 只剩 `dev`，未提交的 `prod` 及其 Secret 事实记录被删除。
2. **B-03：环境 Secret 可绕过专用 clear 门禁。** Connection 被 Tool 引用时，PUT `environments[].clearSecret=true` 返回 200 并清除；未要求 `CLEAR_SECRET`，也未返回 `409 REFERENCE_CONFLICT`。
3. **C-04：不存在的默认环境未被阻止。** 对仅有 `dev` 的 Connection PUT `default_env=ghost` 返回 200；未返回明确校验错误。

附加缺口（不单独映射本轮 P0 勾选项，但须与阻断项一并修复/补测）：

- 已归档 Connection 的 `/test` 仍返回 200 并写入新 CheckRun；真机卡片上的“编辑 / 测试 / 轮换凭据”也均保持可用。
- Basic/AKSK 等结构化凭据的卡片快捷轮换 Dialog 只有单字符串输入，服务端 rotate 又未按 `kind` 校验 payload 结构，可能把有效结构化凭据轮换为不可用字符串。
- 交付报告记录 32 条 Connection；本轮 `verify-fullstack` / runtime E2E 会向 `wf_dev` 写入验收数据，复跑后的临时盘点为 38 条、`needs_review=0`。该数量变化来自门禁脚本写入，不是迁移丢数。
- 分支与当前 `main` 各自包含内容相同的 dev-stack 提交，SHA 历史分叉但三方 `merge-tree` 未见冲突标记；合并前仍建议 rebase/整理重复提交。

### M.6 阻断项修复记录（实现者，2026-08-31；验收人复跑后在对应条目勾选）

修复分支：`feat/sdd12-p0-connection-refactor`（本轮修复提交见状态日志；`main` 已含相同内容的 dev-stack 提交，分支已 rebase 去重）。

**三个 P0 阻断项的修复与复现验证：**

1. **A-03（部分环境更新丢环境）**：更新路径改为按 code 的 patch——`_env_rows_patch` 以存量集合为基底，未提交环境（含 `secret_ref`）整体保留；仅显式 `remove: true` 删除（被删环境若带凭据，同步退役其 SecretRevision 并审计 `connection.env_removed`）。
   - 证据：`test_sdd12_secret_lifecycle.py::test_update_omitted_envs_are_preserved`（仅提交 dev，prod 含密钥保留；显式 remove 才删）；`test_sdd12_acceptance_negatives.py::test_c04_removing_default_env_without_repoint_rejected`；E2E R9-1。
2. **B-03（PUT 绕过清除门禁）**：更新路径环境模型改为 `EnvPatch`（pydantic `extra="forbid"`）——PUT 携带 `secret`/`clearSecret` 一律 422；凭据写入/清除唯一入口为 `secret:rotate` / `secret:clear`（后者保留 `CLEAR_SECRET` 确认词 + 引用检查 + `force` 审计）。根级 `secret` 仍显式 422 并指向轮换接口。
   - 证据：`test_update_rejects_any_secret_field`（掩码/新值/清除四类 payload 全 422，存量密钥不变；环境清除走专用端点）；E2E R9-2/R9-2b。
3. **C-04（ghost default_env 落库）**：`default_env` 校验从 pydantic（只见请求内集合）移至服务端——在 patch 合并存量环境**之后**校验 `default_env ∈ 合并后 codes`；删除当前默认环境且未改指 → 422。创建路径维持原有同请求校验。
   - 证据：`test_c04_ghost_default_env_rejected`、`test_c04_valid_default_env_switch_ok`、`test_c04_removing_default_env_without_repoint_rejected`、`test_c04_create_with_ghost_default_env_rejected`；E2E R9-3。

**附加缺口修复：**

4. **归档连接写入门禁**：`/test`、`secret:rotate`、`secret:clear`、`PUT`、`:enable`、`:disable` 对 `lifecycle=archived` 一律 `409 CONNECTION_DISABLED`（不再写 CheckRun/last_test_at）。前端归档卡片只渲染"已归档 · 只读"，无操作按钮。
   - 证据：`test_archived_connection_rejects_test_rotate_clear`；E2E R9-4；浏览器复核（归档卡片无按钮）。
5. **轮换凭据结构校验**：`validate_secret_structure(kind, secret)` 为创建与轮换同源校验（aksk 必须 access_key+secret_key；basic 必须 username）；rotate 端点调用之，非法结构 422。创建路径同步收紧。前端轮换 Dialog 增加"轮换范围"选择（根凭据/各环境）并按 `kind` 渲染结构化输入（用户名/密码、AK/SK）。
   - 证据：`test_rotate_validates_basic_structure`、`test_rotate_validates_aksk_structure`、`test_rotate_api_key_accepts_string`、`test_create_validates_structured_secret`；E2E R9-5/R9-5b；浏览器复核（prod 环境结构化轮换 → 版本 2，根凭据版本不变）。
6. **顺带修复的潜在缺陷**：`_set_env_ref` 原实现原地改动 JSONB 缓存对象，SQLAlchemy 比较不出差异 → 环境级轮换/清除**静默不落库**。已改为不可变重建；`test_rotate_env_scoped` 强化为断言"轮换后环境密文变化且与账本一致"。

**门禁覆盖补强（防复发）**：新增 `server/tests/test_sdd12_acceptance_negatives.py`（9 用例）与 `e2e-resource-runtime.mjs` R9 段（7 断言），上述阻断路径全部进入机器门禁。

**复验结果（修复后）**：`pytest server/tests` 336 passed；`tool_service` 7 passed；`verify-fullstack` 63/63；`e2e-resource-runtime` 41/41；`check-no-prod-mock` / `check-no-secret-leak`（9 响应面）/ `check-resource-v2-cutover` / `check-ui-standard` PASS；lint/typecheck/vitest(34)/build 通过。迁移无变化（仍 `g045sdd12p0001 (head)`）。

**遗留说明**：门禁脚本复跑仍会向 `wf_dev` 写入验收连接；被引用的残留连接按删除防护返回 409（预期行为），无引用 draft 已批量硬删清理；归档连接按 B-07 设计保留。
