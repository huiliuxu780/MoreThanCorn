# R8-UI 验收清单（Module Agent UI 轮）

基线：`snapshot/pre-r8-ui-20260830`（409fd6a）｜依据：`docs/sdd/11-module-agent-ui-design.md` §4–§7
范围：Providers 管理页 / RunDetail 增强 / 任务向导执行目标 / 配置页增强。后端契约 R1–R7 已备，本轮以前端为主。

## 验收项

### A. Providers 管理页（资源中心新 Tab）
- [x] A-1 资源中心出现「Runtime Providers」Tab，与工具/模型同级；路由 `?tab=providers` 深链可达（真机截图 1-providers.png）
- [x] A-2 列表列完整：名称/Kind/Endpoint/Contract/健康（ok·7h 前 等真探测值+相对时间）/状态；数据来自 `/api/runtime-providers`
- [x] A-3 注册抽屉：名称/Kind/Endpoint/凭据=Connection 下拉（不接收明文 Secret）/config JSON（前端禁密钥字段提示，后端 422 兜底）
- [x] A-4 编辑抽屉回填（GET 详情含 config）；保存走 PUT
- [x] A-5 行操作：探测（probe 后健康列刷新；编辑抽屉 capabilities 只读）、停用（admin 门控+tooltip，服务端 require_admin 兜底）、启用、编辑
- [x] A-6 停用后徽标「已停用，历史可查」；历史 Run 不受影响（后端 R1 语义，未造数据）

### B. RunDetail 增强
- [x] B-1 三卡：执行目标（Agent 版本 v2·quality-analysis@1.0.0/来源）/Runtime（agentscope·runtime 2.0.7·adapter 0.1.0·contract 1.0·impl 0.2.0）/耗时 Token（total+模型/工具次数）（截图 2-rundetail-agent.png）
- [x] B-2 阶段表按 workflowStage 聚合（中文映射 §6-5，trace_mapper 透传）；无阶段语义的 Run 整块隐藏（真机该 Run 无 stage，块未渲染=诚实隐藏）
- [x] B-3 CallRecord 表：kind/目标/token/状态/耗时+详情对话框（脱敏 request 直显）
- [x] B-4 派生质检卡：评分 100/Risk+findings 结论（confidence）+复核状态；标注「规则派生，非 Agent 给分」；兼容 findings/criteria 两形态
- [x] B-5 evidence 列表 kind/locator/text（locator 对象安全序列化，修复 React child 崩溃）
- [x] B-6 双路由可达；配置页测试面板结果「查看 Run 详情 ↗」+ 运行观测面板「Run 详情 ↗」
- [x] B-7 重试谱系导航改用视角感知 runPath，既有能力不回归

### C. 任务向导执行目标
- [x] C-1 五步：基本设置→执行目标→分析数据→执行策略→确认（截图 3-wizard-target.png）
- [x] C-2 类型 radio 卡：工作流/领域 Agent；切换重置 agentId，workflow 旧字段（versionPolicy/fixedVersion）独立保留
- [x] C-3 Agent 下拉仅列 Module Agent；草稿禁选并示「（草稿：无发布版本，不可选）」
- [x] C-4 三选：最新沙箱发布（默认）/最新线上发布/钉住（版本+artifactHash 前 8；catalog 补真版本列表）
- [x] C-5 数据步输入映射沿用 R7（必填校验 mappingOk+服务端 422 中文 toast）
- [x] C-6 确认页执行目标行+创建后 taskVersion 快照渲染（taskVersionSummary 增执行目标行）
- [x] C-7 edit 页 executionTarget 往返保真（type/agentId/三选策略/pinned）
- [x] C-8 workflow 不回归：mapper 契约测试更新后 34/34 绿；pytest 289 绿

### D. 配置页增强
- [x] D-1 对照卡（草稿 rev/最近发布 V2+日期）+对比按钮（AgentVersionDiffDialog）（截图 4-config-page.png）
- [x] D-2 模型可选（registry models；修复 {items} 解包），保存写入 modelRef
- [x] D-3 指令只读+橙色提示条+业务定位可编辑
- [x] D-4 资源 2×2（工具/输入 Schema/输出 Schema/Provider 实现）+已冻结徽标
- [x] D-5 测试面板：有 Release=环境绑定选择；草稿=Provider 必选；结果=结构化输出+工具调用折叠+usage 行；无流式
- [x] D-6 「查看 Run 详情 ↗」跳 agent 路由

### E. 卫生与回归
- [x] E-1 tsc / eslint(0) / build 全绿
- [x] E-2 pytest 289 绿（后端增量：runs quality 块+stages 聚合、trace_mapper 透传）；vitest 34/34
- [x] E-3 check-ui-standard 通过；allowlist 移除已清零键 1 个（只减不增）；顺带清债：wf-connections 三处原生控件换 shadcn（Radio/Checkbox/Textarea）、wf-icons.tsx 补登记（快照 worktree 对照确认失败系 R4 存量，非本轮引入）
- [x] E-4 真机截图 /tmp/r8-ui-shots/（1-providers/2-rundetail-agent/3-wizard-target/4-config-page/5-connections），控制台错误零
- [x] E-5 零假路径：新增按钮全接线；stages/质检卡/调用表无数据即隐藏

## R8-UI-2 增量（08-30 用户指示：1+2 直接做、3 直接封存、4 暂缓）

### F. 效果评测 Tab（配置页第四 Tab）
- [x] F-1 Golden Set 卡：16 样本（smoke v0.1 jsonl 15 + native v0.2 单样本 1）+ 来源路径；修复加载器存量 bug（parents[4]→parents[5] 仓库根；.json 单对象兼容）——此前 Ground Truth 从未加载
- [x] F-2 真实 Run 聚合卡 + 逐 criterion 表：核验次数/状态分布/平均 confidence/按 Provider 分组；数据仅来自既有 QualityResult findings；无数据空态真实
- [x] F-3 后端 `/api/agents/{id}/eval-summary` 只读聚合端点（不造数据）

### G. Providers 兼容矩阵
- [x] G-1 编辑抽屉只读展示 compatibleModules（manifest 声明，key@version + implementation）

### H. 数据封存（用户 08-30 授权）
- [x] H-1 `run_legacy_agent_archive.py --apply`（actor=rivers-authorized-20260830）：wf_dev 29 个旧 Agent archived + 审计；幂等
- [x] H-2 孤儿 CallRecord：28 条经 node_run 真链回填；307 条无 node_run 的旧直调历史**不删不造假链接**，留作封存历史
- [x] H-3 **保留声明**：call_record.run_id NOT NULL 维持暂缓（307 行无法非破坏性收口）；wf_test/wf_accept 未执行封存

## 状态日志
| 日期 | 状态 | 说明 |
| --- | --- | --- |
| 2026-08-30 | 清单建立 | 开工前冻结；逐屏确认结论见 11 §7 |
| 2026-08-30 | **R8-UI 完成（待用户验收）** | 四屏补齐+清债；证据见上表；回滚点 `snapshot/pre-r8-ui-20260830` |
| 2026-08-30 | **R8-UI-2 完成（待用户验收）** | 效果评测 Tab+兼容矩阵+数据封存；pytest 289/vitest 34/UI 门禁绿；真机 6-eval-tab/7-provider-drawer 零控制台错误 |
| 2026-08-30 | **R8-UI-3（用户真机反馈修复）** | 任务向导执行策略步规则绑定前置闸门：未选 pinned 规则版本或 RuleSet 时「下一步」禁用（后端 422 兜底不变）；真机断言 禁用→选 RuleSet→启用 通过 |
