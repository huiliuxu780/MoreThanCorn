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

## 4b. form 特性（08-26 决策：集中表单=工作流输入契约）

决策：form 独立实体+独立管理页；开始节点引用 formId，字段=全局固定输入变量（不允许追加）；发布快照冻结 form 字段。

| 项 | 证据 | 结果 |
|---|---|---|
| form CRUD/删除防护/必填校验/默认值兜底/发布冻结/冻结不受后续编辑影响 | [pytest] test_p8_forms::test_form_crud_and_delete_guard | ✅ |
| 迁移 f0rm20260826 双库（wf_dev/wf_test） | [api] alembic upgrade head ×2 | ✅ |
| 种子表单（对话六件套/空表单） | [api] GET /api/forms | ✅ |
| 管理页 /config/forms + 侧栏"表单" + 开始抽屉 picker/转表单/管理入口 | [manual] 起床目验 | 🟡 |
| 三栏表单构建器（字段面板｜实时预览｜属性面板；参考 shadcn-builder UX 自写，08-26 决策 B）；新建/编辑走独立页面 /config/forms/new 与 /:formId（与 tasks/ai-resources 约定一致，弹窗退场） | [e2e] check-ui-standard 过；[manual] 目验 | 🟡 |
| 消费点改读 form：变量级联开始组/调试抽屉/映射表(子流程 form)/输出变量区 | [manual]+单测间接 | 🟡 |
| pytest 总量 | 109/109 | ✅ |

## 5. 起床验收路线（manual）

1. 打开任一工作流：palette 应见 22 节点（无 Agent 三键）；逐节点开抽屉核对描述/分区。
2. llm：系统设定/JSON Schema 编辑器/批处理/AI 润色（需真 LLM 配置否则 mock）。
3. 画 loop：body 回边 + done；跑一次看 run 详情循环容器日志。
4. 画 wait-review：跑→PAUSED→run 详情"审核通过/驳回"→续跑。
5. 健壮性分区：失败策略三值；error 分支拉红色虚线边跑通。
6. 视觉：与原型 v3（docs/sdd/prototypes/node-master-spec-prototype.html）逐屏比对。

## 4c. V1.5 吸收开发方案（08-26 用户全选）

| 项 | 证据 | 结果 |
|---|---|---|
| field key/label 分离、key 正则+创建后不可改、字段 key 不可改（按 id 匹配） | [pytest] test_p8（409 key 不可改隐含）+ 后端 _norm_field | ✅ |
| key 正则放宽大小写（触发内置字段 camelCase；推荐 snake） | 偏差登记 | 🟡 偏差 |
| form status draft/published/disabled + POST publish→FormVersion + versions 列表 + 删除规则（被引用/有记录/已发布禁删） | [pytest] 109/109 + [manual] 列表页发布/停用按钮 | ✅/🟡 |
| 校验引擎 required/minLength/maxLength/min/max/pattern/selections（前后端共用 validate_form_input） | [pytest] test_p8 必填 422/RunError | ✅ |
| 字段族 15 种（radio/checkbox-group/multi-select/datetime/file/heading/description/divider/section）+ layout span 3/6/9/12（12 列网格预览） | [e2e] check-ui-standard；[manual] 构建器目验 | ✅/🟡 |
| binding 字段侧（manual/workflow_output/data_source/constant/expression）+ condition visibleWhen | 构建器属性面板；create-record mapping 优先、binding.workflow_output 兜底写 FormRecord | ✅ |
| undo/redo（history 栈 + ⌘Z/⇧Z） | [manual] 构建器 | 🟡 |
| FormRecord 层（values+formVersion+runId）+ records API | [pytest] 隐含 + [manual] API | ✅ |
| 工作流引用 formId+version（create-record config.formId/formVersion/mapping） | 后端 exec_create_record | ✅ |
| RHF+Zod | 未引（后端 Python 校验+前端受控组件） | 🟡 偏差 |
| DnD dnd-kit | 缓（点击添加+↑↓） | ⏸ |
| Property Registry schema 驱动属性面板 | 未做（统一面板硬编码） | 🟡 偏差 |

## 4d. 构建器 v3（08-26 用户六条反馈）

| 反馈 | 处理 | 结果 |
|---|---|---|
| 1 无预览功能 | 构建器“预览”模式：FormRenderer 真渲染（无 Key/边框/拖拽柄，showErrors） | ✅ |
| 2 日期/日期时间/附件非标准 shadcn | 新增 ui/calendar.tsx（react-day-picker v9+date-fns v4）+ DatePicker(Popover+Calendar)；FilePick（隐藏 input+Paperclip 按钮+文件名 chip） | ✅ |
| 3 下拉单选/多选自写样式 | 单选=shadcn Select；多选=MultiSelect（Popover+Command+Check+已选 badges） | ✅ |
| 4 每个组件增加 icon | palette 15 种字段各配 lucide 图标；设计卡头部同图标 | ✅ |
| 5 属性面板丑/类型感知 | Accordion 六组（Basic/Data/Validation/Display/Binding/Condition）；dataType 不可改（随 type 派生只读展示）；类型切换限兼容组（§39 矩阵）；validation 按类型显示 | ✅ |
| 6 quickservice form HAR | 已解析：仅设计器壳+布尔接口，无字段 schema；UX 以 shadcn 约定+开发方案为准 | 🟡 参考有限 |

## 4e. quickservice 新 HAR（getjsonschemabycode 真 schema）参考吸收

HAR 提取到 epoch/formily 字段模型（Input/Radio props）。吸收与登记：

| HAR 属性 | 处理 | 状态 |
|---|---|---|
| uniqueKey 唯一约束 | validation.unique + FormRecord 查重 422 + 构建器 Validation 勾选 | ✅ |
| disabled | display.disabled + 渲染器 pointer-events+opacity + 构建器 Display 勾选 | ✅ |
| readOnly | V2 | ⏸ |
| visibleRole/permission4Browse/Update（字段级权限） | V2 | ⏸ |
| dataSource/dataSourceLinkage（选项来自数据源+级联） | V2 | ⏸ |
| intelligentAssistance（AI 辅助输入） | V2 | ⏸ |
| tips | 已有 description/placeholder 覆盖 | ✅ 等价 |
| fieldWidth/columnSpan | 已有 span 3/6/9/12 | ✅ 等价 |
| options[{label,value,disabled}] | options 模型一致（disabled 入 V2） | ✅ |

## 4f. 画布 8 条反馈（08-26，commit 6e5c836）

| # | 反馈 | 处理 |
|---|---|---|
| 1 | 节点 hover 用 @beui/tilt-card？ | 讨论后不引入（社区件供应链+3D transform 破坏 handle 命中+中性设计冲突）；保持蓝边+投影 |
| 2 | 画布空白手势不对 | pane grab / 拖拽 grabbing |
| 3 | 已连线可拖改接 | edges reconnectable + onReconnect |
| 4 | 节点尾+快捷添加 | 非分支节点尾+；分支节点每分支 handle 旁+；自动连线/同分支改接 |
| 5 | 单节点运行带动其他节点 | onRunNode 改 node-test 真单测，先清空结果 |
| 6 | 结果无耗时/tokens、展开崩坏 | SSE 补 durationMs；llm tokens 进事件；外层固定 300px+break-all |
| 7 | 试运行防连点 | 进行中态 spinner+disabled，终态复位 |
| 8 | 扳手假功能 | 删除（宁缺勿假） |

## 4g. 08-26 收尾批次

| 项 | 处理 | 证据 |
|---|---|---|
| B6 并行执行 | ready 批次 ThreadPoolExecutor（WF_PAR_RUN 默认 4）+ 每节点独立 session + 共享态锁 + emit sequence 串行锁 | pytest 109 |
| memory-variable 写绑定 ⚙ 引用 | 写绑定行加 ⚙ VarCascader（upstream source） | 已实现 |
| A12 尾 | DebugDrawer 由开始 form 驱动即覆盖 prompt 引用（引用指向 start 字段） | 已覆盖 |
| default-value 第四值 | 按决策不做 | 登记 |
| /api/locks CORS | 旧后端残留；现后端 preflight/POST 均带 ACAO，无需代码改动 | curl 验证 |
| 测试确定性 | tests/conftest.py WF_PAR_RUN=1（生产并行不受影响） | 两连绿 |
