# 09-18 观测设计自审（用户令「你自己审计一下吧」）

> 对象：17 号设计稿 + 原型 v2；方法：对着入库参考图
> （prototypes/reference/langfuse-trace-overview.png）逐元素核对 + 对着我方数据模型
> （O1/O2  planned 表结构）核对「哪些格子有数据源、哪些是假按钮」。认账+修复同轮完成。

## 发现与处置

| # | 级别 | 发现 | 处置 |
|---|---|---|---|
| F1 | 形态偏差 | 原型 v2 屏 B 做三栏；参考图 trace 详情=**两栏**（span 树｜观测详情），图左栏是 trace **列表页**而非 per-run facet 栏 | 屏 B 改两栏；per-run 过滤上移为树上工具条（搜索+类型 chips），对齐图中栏 toolbar |
| F2 | 假按钮 | 右栏「+加入数据集/Annotate/加评论」无后端=违反假按钮铁律 | 删除，入延后清单（数据集/标注/评论待 annotation 表立项） |
| F3 | 空 tab 风险 | Scores tab 无数据源定义 | 定义=golden 比对结果（run_id 关联）+人工标注（annotation 表，O5）；O5 前空态+CTA，不放假数据 |
| F4 | 徽章缺失 | 图 meta 徽章含 User ID；v2 漏 | 补 User 徽章（触发用户） |
| F5 | 组件未定 | Input/Output JSON 树组件悬置 | 定 react-json-view-lite（专用小依赖，过 npm audit 门禁）；不手写（用户规则） |
| F6 | 阈值 Arbitrary | latency 色阶 10s/30s 拍脑袋 | 默认值+观测配置可调（O3 配置项） |
| F7 | 缺失 | 图底部 Graph 折叠条未做 | 延后（价值低），登记 |
| F8 | 范围 | 图左栏=跨 run observation 检索；用户拍板「只要 run 列表+详情」故不做 | 登记延后，不偷偷做不偷偷砍 |
| F9 | 语义 | 屏 A 直方=run 计数（图=observation 计数） | run 列表作用域自洽，保留并注记 |
| F10 | 数据核对 | v2 各格子数据源核对：latency/tokens/cost=O1/O2 ✔；规则 Skill 徽章=asset_refs ✔；Release 徽章=release 版本 ✔；Env ✔；Scores/标注/三动作=无（F2/F3） | 除 F2/F3 外无悬空格子 |

## 与既有决策一致性核对

- 不新建一级观测组 ✔（用户二次收敛）；观测=run 列表加列+run 详情既有四 Tab ✔；
- 群 span 树成员嵌套=Langfuse 树形态 ✔；对话页 live 不变 ✔；
- 组件基线=shadcn（ChartContainer/Table/Badge/Accordion）+react-json-view-lite（F5）✔ 用户「不手写、用 shadcn」规则。

## 结论

原型 v2 已按 F1–F5 修订（同轮）；F6–F8 登记延后/配置化；F9/F10 注记。设计面至此无假按钮、无悬空数据格、
形态对齐参考图两栏详情+列表加列。O1/O2/O3 开工前置仅剩用户开工令与 D1–D4 拍板。
