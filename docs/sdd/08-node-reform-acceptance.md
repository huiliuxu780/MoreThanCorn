# 08 · 节点体系改造验收报告（07-SDD 实施证据）

> 2026-08-26 · 提交链：9f0db78（回滚快照）→ 4db0bad（M1+M2 后端）→ c8ace44（M3+M4 前端）→ 8d4733f（M5 闸门）→ 本报告提交（M6）
> 证据三类：[pytest] 测试名 / [e2e] 脚本+输出 / [manual] 步骤。未自动化项明确标注。

## 0. 总览

| 套件 | 结果 |
|---|---|
| server pytest | **108/108**（基线 97 + test_p6 8 + test_p7 3） |
| tsc -b --noEmit | 0 错 |
| npm run build | 通过 |
| scripts/check-p0-nodespec.mjs | 19 项断言全 true |
| scripts/check-visual-regression.mjs | 4 屏 diff ≤0.005% + 令牌断言全过（300px/8px/#EEF1F6/360px） |
| scripts/check-ui-standard.mjs | 通过（allowlist 只减不增；components/wf 台账一致） |
| scripts/e2e-p0.mjs（复刻 15 项） | 通过（与基线运行同输出） |

## 1. P1 验收（07-SDD §8.1）

| # | 项 | 证据 | 结果 |
|---|---|---|---|
| A1 | WORKFLOW 页全节点/deprecated 不进 palette | [e2e] check-p0：WORKFLOW 画布 palette-add 变量处理/对话回复/工作流选择=true；registry deprecated=[agent,agent-select,agent-exec] 且 families 过滤 | ✅ |
| A2 | 22 节点抽屉一句描述/图标无回退 | [e2e] check-p0 *-desc=true；NODE_DESC/TYPE_ICON 全量（含 loop/wait-review/data-read） | ✅ |
| A3 | 校验三处同源 | [e2e] check-p0：transform-issues-box=true + 节点卡红点断言（P0 基线）+ 顶栏角标 | ✅ |
| A4 | workflow-fixed 映射+钉版本 | [pytest] test_p7_acceptance::test_a4_workflow_fixed_mapping_and_pinned_version | ✅ |
| A5 | workflow-exec 动态模式 | [pytest] test_p7::test_a5_workflow_exec_dynamic_mode | ✅ |
| A6 | workflow-select 路由+else | [pytest] test_p7::test_a6_workflow_select_routes_and_else | ✅ |
| A7 | 迁移改写器 | [pytest] test_p6_nodes::test_migration_rewriter_agent_to_workflow_trio（显式 /migrate 端点） | ✅ |
| A8 | llm systemPrompt/Schema/批处理/润色 | 后端 [pytest] 无专项（mock LLM）；前端已实现；[manual] 起床后抽屉目验 + 润色按钮 | 🟡 待人工 |
| A9 | tool 参数双模式/未授权态 | 前端已实现；[manual] 目验 | 🟡 待人工 |
| A10 | condition 操作符族/开关/分支名 | OPS_BY_TYPE/OP_LABEL 扩展+高级开关+分支名 Input 已实现；[manual] 目验 | 🟡 待人工 |
| A11 | code-write 同步签名 | 已实现（正则解析 args.params.get/return 键）；[manual] 目验 | 🟡 待人工 |
| A12 | Test Run 覆盖层自动输入 | **未做** → 偏差 D1 | ❌ 延后 |
| A13 | 健壮性分区全节点 | RobustnessSection 全节点渲染；[pytest] test_p6 retry/skip 语义 | ✅ |
| A14 | 输出变量区/subtitle/notice | OutputVarsSection + 卡 subtitle 已实现；视觉基线含抽屉 | ✅ |

## 2. P2 验收（07-SDD §8.2）

| # | 项 | 证据 | 结果 |
|---|---|---|---|
| B1 | loop 聚合/失败计数 | [pytest] test_p6::test_loop_container_iterates_and_aggregates / test_loop_continue_on_error_counts_failures | ✅ |
| B2 | 回边白名单/普通环报错 | [pytest] test_p6::test_loop_backedge_whitelist_and_plain_cycle_still_error | ✅ |
| B3 | wait-review 暂停/续跑/幂等 | [pytest] test_p6::test_wait_review_pause_resume_and_idempotent（resume 202 + 二次 409） | ✅ |
| B4 | error-branch 路由+error 引用 | [pytest] test_p6::test_error_branch_routes_and_error_ref_resolves | ✅ |
| B5 | data-read 抽样 | [pytest] test_p6::test_data_read_sampling_random_n | ✅ |
| B6 | 并行执行事件交错 | **未做**（执行器仍串行；parallel_nums 仅存配置）→ 偏差 D2 | ❌ 延后 |
| B7 | 容器日志 | run-detail 循环容器日志卡 + loop_iter 事件（B1 运行产生）；[manual] 页面目验 | 🟡 待人工 |

## 3. 回归（§8.3）

| # | 项 | 结果 |
|---|---|---|
| R1 | e2e-p0 复刻 | ✅ |
| R2 | check-p0-nodespec | ✅ |
| R3 | pytest 基线不降 | ✅ 97→108 |
| R4 | tsc/build/console | ✅（console 仅存量 /api/locks CORS 与 React key 警告，见 D4） |
| R5 | 存量已发布 workflow 可跑 | ✅（test_p6/p7 含旧键兼容执行） |
| R6 | 原型逐屏比对 | 🟡 视觉基线 4 屏自动回归过；全 24 屏人工比对起床后执行 |

## 4. 偏差与延后（诚实清单）

| # | 项 | 说明 | 计划 |
|---|---|---|---|
| D1 | A12 Test Run 自动输入覆盖层 | 本周期未做 | P1.5 |
| D2 | B6 执行器并行消费 | loop/并行仍串行执行；配置字段已预留 | P2.5（需 worker 并发改造） |
| D3 | default-value 第四失败策略 | 按决策不做 | 待复核 |
| D4 | 存量 console 警告 | /api/locks CORS（localhost vs 127.0.0.1）+ 某处 React 重复 key | 单独修 |
| D5 | 单体拆分部分完成 | controls/sections 已抽；wf-designer 仍含画布/抽屉主体 | 渐进 |
| D6 | pytest flaky | test_phase_a::a01 曾单次 flaky（多 worker 竞争 job_queue），重跑绿 | 观察 |
| D7 | 添加节点改左侧固定面板（可折叠+搜索） | 08-26 用户决策；偏离 16 号复刻 §S3 底部 Popover（22 节点弹层 863px 溢出）；视觉基线已重采 | 已生效 |

## 5. 起床验收路线（manual）

1. 打开任一工作流：palette 应见 22 节点（无 Agent 三键）；逐节点开抽屉核对描述/分区。
2. llm：系统设定/JSON Schema 编辑器/批处理/AI 润色（需真 LLM 配置否则 mock）。
3. 画 loop：body 回边 + done；跑一次看 run 详情循环容器日志。
4. 画 wait-review：跑→PAUSED→run 详情"审核通过/驳回"→续跑。
5. 健壮性分区：失败策略三值；error 分支拉红色虚线边跑通。
6. 视觉：与原型 v3（docs/sdd/prototypes/node-master-spec-prototype.html）逐屏比对。
