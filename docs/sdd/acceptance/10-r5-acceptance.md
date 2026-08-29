# Domain Agent Runtime Provider — Phase R5（business-analysis 只读 Module）验收记录

日期：2026-08-29｜分支 `codex/domain-agent-runtime-provider`｜状态：完成（待用户验收）

## 1. 交付内容
- 新增只读 Module `business-analysis@1.0.0`（manifest/spec.schema/默认 Spec/输入输出 Schema），
  阶段语义：understand→plan→resolve_metrics→query→calculate→cross_check→synthesize_with_citations；
  逻辑工具 metric_query/dimension_query（effect=read），无写工具。
- Registry 自动发现双 Module，启动 fail-fast 校验通过；`/api/agents/modules` 暴露双 Module。
- **结果事务分流**（SDD §5.9）：仅 `quality-analysis` 写 QualityResult；business/ticket 等只读
  Module 不落 QualityResult（领域结果走各自 Mapper，后续落地）。批次/重汇的"成功必须一条
  QualityResult"不变量同步按目标分流（Workflow/quality 强制，其余只读 Module 豁免）。

## 2. 测试证据（test_r5_business_module.py，2 过）
- Registry 发现双 Module + 目录端点；
- business Agent 创建/发布/Release 绑定/批次运行闭环（fake provider 产出 schema 合法输出），
  Run succeeded 且 **QualityResult=0**（只读分流生效）。
- 全量 `pytest tests -q` = **277 passed**；verify-fullstack 38/49（=基线）。

## 3. 偏差与后续
1. business-analysis 双 Provider 原生实现（AgentScope/DSH）本轮以 fake provider 验证分派与分流；
   真实 Runtime 实现与 conformance 随门禁补齐（R4 后置）。
2. ticket-automation（写型）按风险递进，需审批/幂等/补偿设计，未在本轮启动（SDD R5 顺序）。
3. 未 push / 未 `--apply` / 未动用户文件。
