# 2026-09-11 全量代码审查审计（基线 44eadfb，P0 修复于 5c80cd3）

三路只读审计代理并行：后端（server/）35 条、前端（src/）28 条、需求缺口（docs vs 实码）25 条。
P0 三条已修（5c80cd3）；其余按批次列待拍板。门禁：pytest 495 / vitest 65 / theme4 36 / ui-standard / typecheck 0。

## 一、P0（已修 @5c80cd3）
1. 强制鉴权切断机器端点连带权限层 fail-open → main.py `_MACHINE_PREFIXES` 豁免（自有 fail-closed 门不减）。
2. v2 写端点仅 require_role（viewer 可发布/删除/运行）→ 21 处写端点 `Depends(require_operator)`。
3. `_authorized_session` flow-run 令牌兜底可冒充任意 session → 兜底仅认该 run 的节点 Session。

## 二、后端 P1（11，待拍板批 A）
4. skill_mount_map 归档过滤用错列（status!="archived" 应为 archived.is_(False)）agent_caps.py:123
5. skill 删除防护只扫停写遗留表，config.skills 真源不设防 resource_registry.py:99-104
6. config.skills 语义分裂：mounts-health 按名字 / materialize 按 ID agents.py:336 vs agent_execution.py:414
7. 僵尸恢复硬编码 "dev" 身份 automation_watcher.py:334（应 select user_id）
8. recover_parked 在 advisory lock 外，多进程重复恢复 automation_watcher.py:343
9. _RESUMED_PARKED 标记早于 reply_id 校验，缺 reply_id 永久跳过 automation_watcher.py:322
10. operations 读端点绕过 team 数据范围 operations.py:184-380
11. 任意登录用户可以 owner 身份读/操作他人会话 as_agents.py:48-60,132-153
12. /metrics 不在 /api/ 前缀匿名可达且指标名错 admin.py:862-867
13. 附件下载 fid 拼 glob 可枚举他人附件 agent_caps.py:269-275
14. SSE 端点与 header-only 鉴权互斥（EventSource 无法带 header）runs.py:194/operations.py:200

## 三、前端 P1（10，待拍板批 B）
1. 会话切换消息竞态（loadMessages 无 cancelled 守卫）agent-chat.tsx:192-211
2. Skill 详情正文串卡竞态（openView 无守卫不清旧）res-skills.tsx:74-84
3. NodeRunPanel 回读无 abort 校验 node-run-panel.tsx:76-97
4. addNode 自动 id 可撞已有阶段 agentflow-detail.tsx:253
5. 守卫计数恒 N/N（分子分母同值）permissions.tsx:179
6. 资源卡键盘不可达 resource-card.tsx:100 / res-detail.tsx:183
7. 上传 dropzone 键盘不可达 res-skills.tsx:396
8. module-agent-config 整页写死浅色（INK/CARD hex+bg-white）
9. trace-view 状态色/边框全硬编码（dark 必破）
10. agent-common-config hex 常量（同库双标准）

## 四、需求缺口（25，待拍板批 C/D/E）
批 C（P1 产品）：13 号稿 S1+S2 攒批后端（batch_group/flush/SKIP LOCKED 全未动工）；06 号稿 P1+P2+P5 批次观测最小闭环（processed_count/错误聚合/摘要端点）；06 P4 批次取消+硬超时；B1 AgentFlow 运行观测断链（同步阻塞+事后落库+无 flow SSE+无取消）。
批 D（P2）：13 号稿 S3/S4；14 号稿 P2（6 条解析器规则+详情 Dialog+逃逸 6 子规则+命中留痕）；OTel spike；OSS/MySQL reader/MCP tools-list；KB 删除与文档管理；审计日志页与 tasks 列表服务化；质检两 dashboard 路由改提示页（09-04 拍板半实现）；附件上传/@mention；automations 并发/misfire+doc12 Outbox 写回；记忆 timeline skill 事件源改接；trace-view token 化专批；thinking 白名单日志/校验+node-run-panel 重连。
批 E（P3 清理）：死代码包（admin 重复路由/release 死参数/@Waker 永假筛选/trigger=api 死字段/遗留 chat 链/僵尸锁 helper）；诚实展示包（composer 工作目录只读/管理触发跳转/worker 标识/侧栏个人资料）；qwen-plus 硬编码改节点 schema modelRef；AgentSessionIndex 补 FK；log_change 同事务；N+1 批（list_agents/list_flows/to_dto）。

## 五、前端 P2 摘要（18，并入批 D/E）
死代码：chat 版 ThinkingShimmer、beui 三 hooks、Magnetic/Stateful 按钮链、SourcesSection；create-fan 非残留（仍被消费，勿删）。
主题：wf-forms bg-white×5+ring-blue、res-detail 圆点白、resource-dialogs pre 白、amber 裸色板×2、--line-soft 未定义、popover rgba 阴影。
a11y：run-detail 更多操作无 aria、hover-only 按钮键盘不可见×2、英文 aria 残留（message.tsx "user message"）。
逻辑：res-skills 失败静默伪装空态、code-block 复制 timer 无清理、枚举英文直出+进行中态误用 success 绿、res-skills 双文件选择实现合并。

## 六、测试缺口 Top5
T1 recover_parked 零测试；T2 skill_mount_map 正路径/归档过滤无测试；T3 update_resource skill version 分支无测试；T4 internal 会话令牌 flow-run 兜底负例缺失；T5 WF_AUTH=on × 机器端点/SSE 回归缺失。

## 结论
新冻结链方向正确有正例；最大风险已除（P0×3）。剩余按批 C（产品闭环）→ A（安全 P1）→ B（前端 P1）→ D → E 推进建议；visual 基线重拍+逐屏签字、related 追问批仍待用户动作。
