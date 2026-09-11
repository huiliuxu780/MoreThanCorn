# 14 号稿：Agent「安全与权限」页设计（对齐原站 /wakers/<id>/permissions，先设计后动工）

状态：**设计稿，待用户签字后动工**。实测源：原站 19830 权限页（2026-09-11 用户提供 DOM 全量）+ 运行时官方 permission 引擎核码。

## §0 原站实测结构（对照基准）
1. 头部：「安全与权限——控制这个 Waker 能做什么，以及遇到风险操作时如何处理」+ 总状态 chip（已关闭）。
2. 主开关卡×3：危险操作确认（关时挂 warning alert「当前不会检查危险操作…」）/ 敏感文件保护 / 企业安全模式（使用企业模型，任务数据仅保留在本机）。
3. 「默认权限」+「工具使用权限 17」：**三态计数条**「直接使用 · 询问 · 不可使用」（0/17/0 式）。
4. 工具守卫六类规则卡（命令注入 3/3、资源滥用 4/4、代码执行 8/8、网络滥用 2/2、敏感文件访问 3/2、权限提升 2/2）：每类=启用开关+规则表（检测内容描述+RULE_ID｜风险等级 tag 严重/高｜处理方式「确认后执行」开关｜查看详情）；另有「Shell 逃逸检测」子规则描述段（命令替换/混淆标志/转义空白/转义操作符/换行/注释引号失同步/引号内换行）。

## §1 我们能把哪些功能做控制（可控矩阵，均有代码落点）
| 原站功能 | 我方控制点 | 可行性 |
|---|---|---|
| 工具三态（直接/询问/不可） | 官方 PermissionContext.allow/ask/deny_rules（Bash=子串、Read/Write=glob）+ 已建 remove_tool（deny 双保险） | ✅ P1 |
| 危险操作确认主开关 | PermissionMode：关=BYPASS（现状），开=ACCEPT_EDITS（有人值守快迭代）；DEFAULT 过严（无人值守自动任务会全停等确认）不作主档 | ✅ P1 |
| 六类守卫规则表（22 条） | 平台种子规则→ask_rules（Bash 子串模式：rm -rf/mkfs/curl\|bash/sudo/chmod 777/reverse-shell/proc-environ…）；官方 bypass-immune 语义保证 BYPASS 下危险 ASK 转 DENY 不被静默放行 | ✅ P2 |
| 每规则处理方式（确认后执行/直接阻止） | 单规则 behavior ask↔deny 切换 | ✅ P2 |
| 敏感文件保护 | sensitive_paths→ask_rules(Write/Read glob)+working_directories 管理 | ✅ P3 |
| Shell 逃逸检测 | 运行时 BashCommandParser 固定安全层（tree-sitter）；**展示不可关**（诚实标注「平台固定安全层」），不做假开关 | ✅ P1 展示 |
| 企业安全模式 | release 级 provider 限制（仅本地/指定 connection）；涉及连接治理 | ⏳ P3 |
| 17 工具清单 | 内建 12（Bash/Read/Write/Edit/Grep/Glob/Task×4/ToolStop）+ 调度 4 + 团队 5 + 平台 2 + manifest 动态件；动态件三态在 manifest 层落实 | ✅ P1 静态件先行 |

## §2 页面 IA 与线框（Agent 工作台新增子页「安全与权限」，位于「配置」与「发布治理」之间）
```
┌ 安全与权限                            [总状态 chip: 危险确认已开启/已关闭]
│ 副题：控制这个 Agent 能做什么，以及遇到风险操作时如何处理。保存后需重新发布生效。
├─ 卡1 危险操作需要确认 [Switch]
│    描述：开启后，Agent 检测到高风险命令会先暂停执行，并向你请求确认。
│    关时 warning alert：当前不会检查危险操作，Agent 将按其他已有权限继续执行。
├─ 卡2 敏感文件保护 [Switch] + 路径 glob 列表编辑器（每行一条，增/删）
├─ 卡3 工具使用权限  计数条「N 直接使用 · M 询问 · K 不可使用」
│    表：工具名 | 族 | 三态 segment(直接/询问/不可) | 说明
│    （静态 17 件先行；manifest 动态件显示「随发布快照」只读行）
├─ 卡4 工具守卫规则  六类卡：[类名 + 启用 Switch + n/n]
│    类内表：检测内容(描述+RULE_ID) | 风险 tag(严重/高) | 处理方式 segment(确认后执行/直接阻止) | 详情(Dialog 展示匹配模式)
├─ 卡5 Shell 逃逸检测（只读说明卡）：平台固定安全层，命中即走审批；列 7 子规则描述；无开关（诚实）
├─ 卡6 企业安全模式 [Switch disabled + tooltip「P3：连接治理联动」]（诚实占位，不伪造）
└─ 页脚：[保存]（写 config.permissions v2）· 提示「冻结进下一发布版本」
发布治理页：版本卡增「权限快照」chip（mode + 三态计数 + 守卫启用类数）
```
交互细则：主开关关→卡4 全部只读灰化（规则不生效）但保留展示；三态切「不可」同时运行时 remove_tool（模型感知无此能力）；切「询问」=ask_rules 全命令子串 `*`? 官方 Bash 子串语义无通配全匹配→用 mode=ACCEPT_EDITS 下对 Bash 加 ask_rule rule_content=""（空串=全匹配，需核引擎语义，动工首日验证，不成立则退化为按类别种子规则覆盖）。

## §3 契约 schema（frozen_permission_policy v2，release 快照）
```json
{"version":2,
 "mode":"bypass|accept_edits",
 "tools":{"Bash":"allow|ask|deny", ...},
 "guards":{"master":true,"categories":{"cmd_injection":{"enabled":true,"rules":{"TOOL_CMD_DANGEROUS_RM":"ask|deny"}}}},
 "sensitive_paths":["**/.ssh/**"],
 "rules_seed":"2026-09-11"}
```
运行时应用点：tool_policy wrapper 每回合按 manifest 下发策略**内存态**赋值 session_record.state.permission_context（mode+rules），deny 族同步 remove_tool 双保险；不写持久 state 防漂移。

## §4 分期
- P1：页面骨架（卡1/3/5）+ 三态 + 主开关 mode 映射 + 冻结 v2 + 运行时应用 + 治理 chip + 测试（冻结/应用/三态计数）。
- P2：卡4 六类 22 条种子规则 + 每规则 handling 切换 + 详情 Dialog。
- P3：卡2 敏感路径 UI + 卡6 企业模式（连接治理联动）。
- P4：权限命中留痕→run 事件（ask 触发/拒绝记录）+ 看板可见。

## §5 验收
- 关主开关+deny Bash：模型自述无 Bash（已有同款活体验证路径）。
- 开主开关+ask rm：Bash rm 命令触发 HITL 确认卡（对话页 ApprovalCard 已就绪）。
- 冻结快照 v2 进 release；旧版本 release 不受影响（不可变）。
- 门禁全绿 + 逐屏签字。
