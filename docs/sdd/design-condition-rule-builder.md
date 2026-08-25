# 设计规格：条件分支规则构建器升级

状态：已实现（2026-08-24，前后端 + 浏览器验收）
依据：调研 11 §3.14（条件判断实测形态）+ Dify/Coze 主流规则构建器形态
决策：用户已选定"规则构建器 + 类型运算符"方案（2026-08-25）

---

## 1. 目标

把条件判断节点从"每分支单条件"升级为**规则构建器**：每分支可含多个条件、组内且/或连接、运算符按左值类型动态给出、分支与条件可增删拖拽、Else 兜底显式。对齐调研 11 §3.14 的实测形态。

## 2. 数据模型变更

### 2.1 当前（待改造）
```
branches: [{ handle, variable, operator, value }]
```
每分支仅一个条件。

### 2.2 目标
```
branches: [{
  handle: string,            # 分支 handle（= 画布出边）
  label?: string,            # 分支显示名（可选，缺省"分支 N"）
  logic: "AND" | "OR",       # 组内多条件的连接方式
  conditions: [{
    variable: string,        # 变量引用（{{node.outputs.x}}）
    variableType: string,    # 左值类型（用于给出运算符集）
    operator: string,        # 运算符（按类型）
    valueMode: "LITERAL" | "VARIABLE",
    value?: string,          # valueMode=LITERAL 时的字面量
    valueRef?: string,       # valueMode=VARIABLE 时的变量引用
  }]
}]
# else 分支不存入 branches，固定兜底
```

**兼容**：旧数据 `branches[].variable/operator/value` 需迁移为 `conditions[0]`（logic 缺省 AND）。

## 3. 类型感知运算符集

| 左值类型 | 运算符 |
| --- | --- |
| 字符串 | 等于 / 不等于 / 包含 / 不包含 / 为空 / 不为空 /（可选：开头是/结尾是/正则） |
| 数值 | 等于 / 不等于 / 大于 / 大于等于 / 小于 / 小于等于 / 为空 / 不为空 |
| 布尔 | 等于 / 不为空 |
| 数组 | 包含 / 不包含 / 为空 / 不为空 /（可选：长度等于） |
| 对象 | 为空 / 不为空 |

左值类型来源：变量级联选中变量的 `dataType`；未知类型回退到"字符串"运算符集。

## 4. 前端交互（规则构建器）

```
┌ 条件判断 ────────────────────────────────┐
│ 分支 1   [且▾]                  [⋮][×]   │
│   ┌──────────────┬───────┬─────────────┐│
│   │大模型.answer▾│包含  ▾│[退货][引用▾]││
│   └──────────────┴───────┴─────────────┘│
│   [＋ 添加条件]                           │
│                                          │
│ [＋ 添加分支]         Else（兜底，不可删）│
└──────────────────────────────────────────┘
```

- 分支卡：`[且/或 切换]` + 条件列表 + `[＋添加条件]` + `[⋮ 拖拽/× 删除]`。
- 条件行：`[变量级联选择] [运算符] [比较值]`；比较值支持"字面量/引用变量"切换。
- 变量选中后显示真实路径（如 `大模型.answer`），不再显示"已引用"。
- 分支可增删、拖拽排序；Else 固定、不可删。
- 每个分支 = 画布一个出边 handle，分支标签标在出边上。

## 5. 后端求值变更（`exec_condition`）

```
for branch in branches:            # 顺序，命中即走
    results = [eval(condition) for condition in branch.conditions]
    hit = all(results) if branch.logic == AND else any(results)
    if hit: return branch.handle
return "else"
```
`eval(condition)`：解析 `variable` 取值 → 按 `operator` 与 `value/valueRef` 比较。`valueMode=VARIABLE` 时先解析 `valueRef` 取值。

## 6. 与现有机制的兼容

- 复用现有 `VarCascader`（变量级联）、分支 handle、`_branch_ok` 运算符。
- `_branch_ok` 扩展为按类型分发；现有 8 运算符保留并归入对应类型。
- 前端 `VarCascader` 需回传所选变量的 `dataType`（当前已能拿到端口类型）。

## 7. 工作量与拆分

| 子项 | 内容 | 相对量 |
| --- | --- | --- |
| 数据模型 + 兼容迁移 | branches[].conditions + logic；旧数据迁移 | 中 |
| 类型运算符映射 + `exec_condition` 组内 AND/OR | 后端求值 | 中 |
| 规则构建器前端组件 | 条件增删/且或/拖拽/真实变量路径 | 大 |
| 比较值字面量/引用切换 + 类型控件 | 前端 | 中 |

## 8. 风险

- 旧条件数据迁移需保证不丢分支；发布校验需覆盖"空分支/空条件"。
- 类型运算符依赖变量类型准确；未知类型回退字符串集，避免卡死。
- 拖拽排序引入前端拖拽库或原生 drag，需评估成本。
