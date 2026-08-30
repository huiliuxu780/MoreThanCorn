# P2 代码项轮验收（08-30 侧聊开工：P2-02/SLO/HA/DR/KMS）

依据：09-SDD §15/§15.1/§15.2。用户指示"抓紧开发 P2 生产就绪决策项"；纯决策项（SLO 具体值冻结、IdP、云 KMS 选型、HA 部署拓扑）以 DRAFT 默认推进，待用户冻结/提供后替换。SSO 按 08-27 拍板维持本地账号（P2-01 已闭环）。

## A. P2-02 数据权限（服务端强制）
- [x] migration `g044p2perm0001`：app_user.team + data_scope（all|team，默认 all 存量不变）；双库 up
- [x] 强制点：/api/tasks 列表（created_by ∈ 同队）、/api/tasks/{id} 详情越权 403、/api/quality-results 与 review-queue 按任务创建者 join 过滤（无任务归属行对 team 范围不可见）
- [x] admin 直通；scope 管理端点 /api/auth/users/{uid}/scope（admin；team 必填校验 422；非 admin 403）
- [x] 越权测试 tests/test_p2_data_scope.py 3/3（team 列表/详情 403、scope=all 不回归、端点校验矩阵）

## B. P2-09 SLO（草稿冻结 + 测量）
- [x] server/app/slo.py：十项目标 DRAFT（§15.1 全项），note 明示"未冻结不得用性能良好作验收结论"
- [x] /api/ops/slo：可测项（API p95/p99 经时延中间件采样、队列等待 p95=locked_at-created_at、Run 时长 p95、24h token/成本估算）；不可测项（可用性/调度延迟/RPO/RTO/峰值口径）null+注记，不造假
- [x] 测试 test_ops_slo_endpoint_shape 过

## C. P2-04 HA（选主）
- [x] scheduler_loop PG advisory lock 选主（会话级锁，leader 死亡自动释放）；单实例首 tick 即获锁行为不变
- [x] 测试：双会话互斥、释放后接管 过

## D. P2-05 DR（备份/恢复/演练）
- [x] scripts/dr-backup.sh + dr-restore.sh（pg_dump -Fc / 重建目标库 / 核心表计数校验）
- [x] 本地演练 08-30：wf_dev 3.9M 备份→恢复 wf_dr_drill，run/quality_result/agent/analysis_task/app_user 五表计数与源库完全一致（6786/193/32/22/1）；演练库已 drop
- [x] RPO/RTO 目标值 DRAFT（1h/4h），实测值待生产规模演练填入 /api/ops/slo unmeasured 注记

## E. P2-06 KMS（密钥管理）
- [x] server/app/kms.py：信封加密抽象（LocalKmsProvider 默认；外部 KMS 同接口接入点 get_provider）
- [x] secrets.py 经 KMS 层；decrypt 兼容 env1 信封/旧 Fernet 直密/历史明文；生产失败关闭不变
- [x] 测试 4 项：信封往返/旧密文兼容/缺 key 拒解/生产缺 key 拒加密 过

## F. 保留声明（待用户决策，不伪装完成）
- 10 项 SLO 具体值、RPO/RTO 实测、IdP（SSO 若重启）、云 KMS 选型、HA 多实例部署拓扑——均待用户冻结/提供
- call_record.run_id NOT NULL 维持暂缓（R8-UI-2 已声明）

## 状态日志
| 日期 | 状态 | 说明 |
| --- | --- | --- |
| 2026-08-30 | 代码项完成（待用户验收+冻结决策） | pytest 全量绿（含新增 9 项）；迁移双库；DR 演练对数一致 |
