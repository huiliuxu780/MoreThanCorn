# 阶段二设计稿：领域 Agent 去代码化（Module manifest → DB 模板）

> 09-18 草稿，待用户审查拍板后动工。前置：阶段一（规则 Skill 化，commit 0da9485）已交付；
> 金样本重基线 + 注入 A/B 结果回填本文 §5。

## 0. 背景

阶段一已把**规则内容**（criteria/主数据）搬出代码 manifest 进 Skill 包（criteria.json 伴生文件），
run/会话开工解析+记账（asset_refs）+fail-closed。但领域 Agent 的**定义骨架**仍在代码里：
`server/app/agent_modules/*/manifest.yaml` + `result_mapper.py` + 原生管线 entry。
用户拍板方向：「不太想代码写死一个 agent」——定义骨架进 DB，代码只留执行引擎与契约校验器。

## 1. 现状 manifest 残留清单（要搬的东西）

| 资产 | 现在位置 | 去向 |
|---|---|---|
| displayName/description/riskClass | manifest | DomainTemplate 行字段 |
| inputSchema/outputSchema | manifest schemas/*.json | DomainTemplate JSONB 列 |
| instructions（spec.default） | manifest spec.default.json | DomainTemplate.instructions |
| logicalTools | manifest | DomainTemplate.logical_tools JSONB |
| policies（execution/security） | manifest | DomainTemplate.policies JSONB |
| criteria/主数据 | **已在 Skill 包**（阶段一） | 不动 |
| result_mapper.py（投影函数） | 代码 | 退役：通用 schema 校验+通用投影取代（§3） |
| implementations.entry（原生管线） | 代码 | 退役：ReAct+规则 Skill 默认；复杂域可选 AgentFlow 脚本（§3） |

## 2. 目标实体：DomainTemplate（新表，不塞 Agent.config）

- `template_key`（唯一）+ `version`（单调整）+ `status(draft/published)` + 上表字段 +
  `required_rules_skill`（阶段一声明迁此）+ `created_by/reviewed_by`。
- 领域 Agent 创建 = 选模板（published 版）+ 实例层字段（现有 agent.config 实例层不动）。
- 模板变更 = 新版本 + 评审记录；写型模板（risk_class=write）加审批闸门。
- UI：能力与资源壳加「领域模板」页（列表/版本 diff/在线编辑/发布），复用 Skill 页交互模式。

## 3. 两个代码函数的退役路径

1. **result_mapper**：现状把模型结构化输出投影成 QualityResult 等类型。退役条件：
   输出已由 output_schema 机制强制（structured_schema），质检结果页/看板/事件投递改消费
   「run 结构化输出 + criteria id 对齐」的通用形态（findings[] 按 id 取）。
   迁移期双读：优先通用投影，缺字段回落老 mapper（一个发布周期后删回落）。
2. **原生管线 entry**（identify→plan→execute→barrier→synthesize）：默认换成
   ReAct + 规则 Skill + instructions（模型自排），阶段一注入通道（rules_context，
   MTC_RULES_INJECT）作为准则显式注入开关；复杂域（需严格阶段屏障）可选 AgentFlow
   脚本编排（脚本即版本化资产，run 时引用已发布版本+快照记账）。

## 4. 冻结与复现凭据（不丢治理）

- run 快照三件套：release 冻结（模型/工具/权限）+ `asset_refs.rules_skill`（已有）+
  新增 `asset_refs.template_ref={template_key, version}`——「这单按哪版模板+哪版规则跑」可查。
- 金样本基准绑 template version + rules skill version（B1 口径升级）。

## 5. 门禁与顺序（用户既有规矩：回归不绿不归档）

1. 金样本重基线 20/20（注入 off，环境稳定日）← **进行中 09-18**；
2. 注入 on 臂 20 样本 A/B：≥ 基线则默认 on（规则新版本对 prod 行为即时生效的承诺兑现），
   否则默认 off 并记录原因；
3. seed：三 manifest → DomainTemplate 行（version=1），registry 读 DB 优先、代码兜底；
4. 质检结果页/看板切通用投影（双读期）；
5. 金样本 20/20 + 全量门禁绿 → 代码 manifest/mapper/entry 归档（archive/，不删文件先冻）；
6. 观察一个发布周期后删回落与代码残留。

## 6. 拍板点

- D1 模板载体：新表 DomainTemplate（推荐）vs 塞 Agent.config JSONB（不推荐：模板是多 Agent 共享资产，per-agent 存会漂移）。
- D2 管线替代：ReAct+规则 Skill 默认（推荐，最简）vs 全域 AgentFlow 脚本（工期×2，屏障严格）。
- D3 通用投影范围：质检结果页+看板+事件投递一次切（推荐）vs 只切质检页（留尾巴）。
- D4 代码归档时机：回归绿即归档冻（推荐）vs 双跑一周期后归档（更稳更慢）。

## 7. 工程量估

后端（表+迁移+registry DB 优先+template CRUD/发布+asset_refs.template_ref+通用投影双读）4–5 天；
前端模板页 2 天；结果页切通用投影 1 天；测试+金样本回归 1–2 天。合计约 8–10 天，分两批交付。
