# 09-17 对话/群聊八条指认修复（a–h）

用户指认八条；先活体实测原站 19830 取事实，再实施。

## 原站实测事实

- 对话任务⋯菜单 = **置顶 / 重命名 / 删除**（CUA 真点击取证）。
- 群设置：群成员「添加」为真功能（添加 Waker 弹窗：搜索+勾选+逐成员配置）；成员展示 **Leader 左起第一**。
- 群任务面板「新建」=新建对话，**多任务并存**（无单 active 限制）。
- 侧栏 Waker 行头像 **32px**；侧栏页脚 profile 块 **61px**。

## 修复对照

| 指认 | 修复 | 证据 |
|---|---|---|
| a 对话只能打开/删除、下拉缺陷 | 两列表⋯=置顶/打开详情/重命名/删除；详情弹窗；置顶排序键 pinned_at（迁移 g069）；hover+focus-within 双触发修「下拉看不见」 | 截图 01/02；API pin/rename 200 |
| b 群成员 leader 第一 | 后端 `_view` 排序 leader 优先（单一事实源） | API members[0].role=leader；截图 03 |
| c 无法添加群成员 | 假 disabled 按钮→真弹窗（搜索+勾选）；PATCH members 放宽：active 会话内成员增删放行、Leader 仍冻结（Spec D2/§4.1 回写） | API 增删往返 200；截图 03 |
| d 无法新发起群对话 | 根因=后端单 active 409 ACTIVE_SESSION_EXISTS；废弃该限制（reuse_active 仅 automation 复用） | UI 新建→conv_c8ce5cfe 200 |
| e 无法删除/重命名群 | 群页头⋯=重命名群组（复用 GroupRenameDialog）/删除群组（有流水=归档） | 群页⋯渲染；groups-view 原入口保留 |
| f 标题叫「对话」 | 迁移 g069 title 列；首轮 turn 后台线程 LLM 4-12 字总结（逐 enabled 模型回落；全败回落截断）；群默认「任务 N」同路替换 | 真总结「春天团队出游地点建议」入列表/页头 |
| g 侧栏头像太小 | size-6→size-8（32px，原站同值） | 实测 32 |
| h 页脚太高 | p-2/p-2→p-1.5/px-2 py-1；69px→57px（原站 61） | 实测 57 |

## 顺手修的真缺陷

- **平台直连 401 根因**：`_resolve_base_headers` 对 kind=api_key 出 X-API-Key 头，而 OpenAI 兼容口只认 Bearer——draftRole/标题等全部平台级 LLM 调用静默 401（运行时走 AgentScope 自有映射不受影响）。修：api_key→Bearer。
- 8120 手工重启丢 WF_SECRET_KEY 陷阱登记：须带 `WF_SECRET_KEY`（start-dev-stack.sh 默认值）重启，否则解密 RuntimeError。

## 验证

- vitest 80/80；test_groups 22/22；gate.sh ALL GATES GREEN。
- 5199 活体：群新建会话/⋯四菜单/置顶排序/添加成员弹窗/leader 序/标题真总结；agent 对话⋯四菜单；侧栏 32px/57px。
- 截图 assets/2026-09-17-conv-group-fixes/01–03。
- 测试痕迹清理：cred-probe 会话已删、测试置顶已取消。
