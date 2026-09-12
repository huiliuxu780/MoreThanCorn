# Agent 封存闸门补齐 · 自验记录（2026-09-12）

> 背景：E-2.1 已有封存数据层与列表筛选（archived bool + lifecycle 枚举 + 默认隐藏 +
> 已封存 tab），但执行面无闸门——封存只是「列表隐藏」。本轮补齐为真封存。

## 交付

| 闸门 | 位置 | 行为 |
|---|---|---|
| 创建版本 | agents.py create_agent_version | 409 AGENT_ARCHIVED |
| 发布/回滚 | agents.py create_release | 409 AGENT_ARCHIVED |
| 自动任务 dispatch（agent 目标） | as_automations.py（原子门**之前**，不消耗 max_runs 配额） | REJECTED/AGENT_ARCHIVED |
| 脚本保存校验 | validate_script_definition | 422（waker 已封存） |
| 脚本运行时构建 | build_script_body | ValueError [AGENT_ARCHIVED] |
| DAG flow 版本保存 | as_flows_board.create_version | 422（节点引用已封存 Agent） |
| 分析任务执行目标 | 既有闸门（P0-B：已归档 Agent 不可作为执行目标） | 不变 |

## 引用清单与 UI

- `GET /api/agents/{id}/references`：分析任务（current_version 执行目标）/ 自动任务 /
  flow 节点 / 脚本引用 计数+样例；
- Agent 列表卡 hover 操作行新增「封存/解封」（双向），确认弹窗展示引用清单与
  「封存不解除引用，AGENT_ARCHIVED 拒绝；默认不自动暂停相关自动任务」提示；
- 已封存卡 80% 透明度灰显，无对话入口；使用中/已封存 tab 与计数联动（截图 07/08）。

## 边界（登记）

- 运行中执行不受影响（闸门只拦新执行）；历史与 Session 数据全保留；
- Chat 入口未拦（封存语义针对执行链路；对话属产品决策另议）；
- 封存不自动暂停引用它的自动任务（默认仅提示，弹窗明示）。

## 测试证据

```
test_f_agent_archive 5 条：版本/发布 409、dispatch 409（REJECTED/AGENT_ARCHIVED +
配额未消耗断言）、引用计数（分析任务/自动任务）、404。
全量: pytest 538 passed / tsc 0 错 / vitest 65 / build ✓
UI 实测: 8120 重启后 5199 浏览器全流程（点封存→引用弹窗→确认→已封存 tab 灰显卡）。
```
