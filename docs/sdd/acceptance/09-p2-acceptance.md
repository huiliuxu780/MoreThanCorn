# 09-SDD P2 验收报告（企业级能力）

> 状态：**部分闭环（代码项），整体未通过**。
> 代码可先行的 P2 项（P2-01 本地账号+生命周期、P2-03 单租户、P2-07 PII、P2-08 发布治理）已实现并自验；
> 依赖真实业务/基础设施决策的项（10 项 SLO、SSO/OIDC、HA、DR/RPO-RTO、KMS、P2-02 组织模型、P2-04/05/06/09/10/11/12）
> **必须由用户提供生产要求后方可验收**，Agent 不擅自发明。

- 验收版本：`960e2d1`（P2-01）/ `ffab23c`（P2-08）；P2-07 `ebfeb05`；P2-03 决策登记于 09 v0.2
- 环境：后端 pytest（`wf_test` 隔离库）；前端 vitest + tsc + eslint + 无头浏览器真机验证
- 验收日期：2026-08-27
- 验收人：待用户最终确认（当前为 Agent 自验）

---

## 1. 已闭环（代码项）逐项

| Req | 修改文件（关键） | 迁移 | 测试 | 执行命令 | 实际结果 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| P2-01 企业身份（本地账号+角色增强，用户已拍板替代 SSO） | `app/routers/auth_routes.py`(status/password 端点), `app/auth.py`(停用令牌失效), `app/models.py`(AppUser.status) | g033 | `tests/test_p2_auth_lifecycle.py`(5) | `pytest tests/test_p2_auth_lifecycle.py -q` | 5 passed：停用拒登/既有令牌失效/改密/禁停用自身/短密码拒绝 | PASS（SSO 按用户决策以本地账号+角色增强替代） |
| P2-03 单租户隔离（用户已拍板） | 09 v0.2 决策登记；核心表不加 tenant 列 | — | —（决策项，无代码） | — | 部署/合同层面隔离；单租户内按组织/团队做数据权限 | PASS（决策） |
| P2-07 数据合规-PII 脱敏 | `app/pii.py`(mask_pii/mask_structure), `app/runner.py`(Ctx.call 脱敏) | — | `tests/test_p2_pii.py` | `pytest tests/test_p2_pii.py -q` | 手机/邮箱/身份证/银行卡递归脱敏；调用记录不泄露明文 | PASS（留存/删除/导出/水印余下待组织要求） |
| P2-08 发布治理 | `app/routers/governance.py`, `app/models.py`(ReleaseRequest), `app/routers/workflows.py`(currentVersionNo), 迁移 g038, `src/services/governance.ts`, `src/pages/release-governance.tsx` | g038 | `tests/test_p2_governance.py`(15) + `src/services/governance.test.ts`(8) | `pytest tests/test_p2_governance.py -q`；`npx vitest run`；`node scripts/check-governance.mjs` | 15+8 passed；Diff/审批门禁/职责分离/Canary/发布切指针/回滚恢复/审计留痕全绿；无头浏览器渲染无错 | PASS |

### P2-08 关键不变量（已验证）
- 审批门禁：未 approved 不得 release（409）；rejected 不得 release。
- 职责分离：真实鉴权下申请人不得审批自己（403）；开发态单一 dev 身份不自我锁定。
- 发布/回滚切换资源当前生效指针：release→to_version_no；rollback→from_version_no。
- Canary：release(canary)→canaryPromoted=false；promote→true；非 canary promote→422；重复 promote→409。
- 变更审计：request/approve/release/rollback 全程写 audit_log。

---

## 2. 未闭环（需用户/基础设施决策，Agent 不擅自发明）

| Req | 阻塞原因 | 需要用户提供 |
| --- | --- | --- |
| P2-01 SSO/OIDC | 用户已选本地账号+角色增强；若仍需 SSO 需 IdP | IdP（OIDC metadata/客户端凭据）或确认维持本地账号 |
| P2-02 数据权限 | 组织/团队/数据范围模型未定 | 组织/团队层级与数据范围权限模型 |
| P2-04 高可用 | 需真实多实例部署 + Scheduler 选主验证 | 部署拓扑/编排（K8s/多实例）与演练窗口 |
| P2-05 灾备 | RPO/RTO 未冻结，需真实备份恢复演练 | RPO/RTO 目标 + 备份基础设施 |
| P2-06 安全基线 | KMS/Secret Manager、镜像/依赖扫描、渗透测试需生产设施 | KMS 选型 + 扫描/渗透资源 |
| P2-09 容量与性能 | 10 项 SLO 未冻结 | 见 §15.1 SLO 冻结清单 |
| P2-10 成本治理 | 成本归属/预算需组织口径 | 成本中心/预算阈值 |
| P2-11 数据生命周期 | 大对象存储/归档/TTL 需存储基础设施 | 对象存储与归档策略 |
| P2-12 生产运营 | Dashboard/值班/复盘制度需组织落地 | 运营制度与告警通道 |

---

## 3. 结论

- **代码项（P2-01 本地账号、P2-03、P2-07、P2-08）：自验通过**（后端 239 绿 / 前端 33 绿 / 浏览器真机验证）。
- **整体 P2：未通过**。余下 P2-02/04/05/06/09/10/11/12 依赖用户提供的生产要求与基础设施，
  在用户提供前不得声明 P2 通过，亦不得进入 P3。
