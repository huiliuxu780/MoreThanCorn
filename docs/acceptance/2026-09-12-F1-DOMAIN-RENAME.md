# F1 领域拆名 · 自验记录（2026-09-12）

> Spec：`execution-automation-batch-spec.md` §19 F1 / §12
> 状态：自验通过（全量 527 绿），未提交待验收

## 交付

| 项 | 内容 |
|---|---|
| canonical API | `POST/GET/PUT /api/analysis-tasks*`（list/create/get/update/start-run/runs/schedules 七端点），与兼容路由共享同一组 handler（同表同数据不变） |
| 兼容 API | `/api/automations*` 全保留；响应统一带 `Deprecation: true` + `Link: </api/analysis-tasks>; rel="successor-version"`（main.py 中间件） |
| 流量统计 | `app/legacy_route_stats.py` 进程内计数（/api/automations、/api/tasks 前缀）；`GET /api/admin/legacy-route-stats`（admin）读取 |
| DTO 改名 | `automation_definition_dto`→`analysis_task_dto`、`automation_definition_version_dto`→`analysis_task_version_dto`（旧名弃用别名保留一个兼容周期）；前端 `AutomationDefinitionDTO`→`AnalysisTaskDTO`（旧名弃用别名；历史 `AnalysisTaskDTO=LegacyAnalysisTaskDTO` 别名改 `LegacyTaskDTO` 让位，autonomous 编辑器引用迁移） |
| 前端客户端 | `wfApi.automations`→`wfApi.analysisTasks`（走 canonical；原段无页面消费，零破坏） |
| 文案收敛 | 「自主任务」→「分析任务」全量 33 处（14 文件，含 ui-terms.ts 中心词表）；后端同域 15 处；`/api/v2/automations`（通用自动任务）不受影响 |

## 测试证据

```
定向: pytest tests/test_f1_domain_rename.py tests/test_mtc002a_automations.py → 13 passed
全量: pytest tests/ → 527 passed（522 + 5 新增）
前端: tsc 0 错 / vitest 65 / build ✓
```

新增断言：alias 与兼容路由同形状同数据互读写；legacy 响应带 Deprecation+Link 而 canonical 不带；
legacy 调用计数 +2；DTO 弃用别名可用。
