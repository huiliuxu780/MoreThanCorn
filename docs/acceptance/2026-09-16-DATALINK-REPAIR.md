# 数据链路修复验收（2026-09-16）

## 1. 根因（「坏了」的部分）
- watcher tick 循环只选 `status == "active"` 的拉取源；tick_pull_source 失败即置
  `status="error"` → **源被永久排除出 tick**，单次出站 TLS 抖动（09-15 19:04，
  MaxCompute SSL EOF / SLS RemoteDisconnected，与 GitHub flaky 同族网络问题）
  把两个真源 parked 致死，直到人工干预。
- EventRoute 未配置 → 全部事件 filtered（CORN 397 / SLS 49889），消费链从未接通。

## 2. 修复
- server/app/automation_watcher.py：tick 选择纳入 `("active","error")`；
  成功路径 tick_pull_source 自愈回 active。回归测试 test_watcher_ticks_error_sources。
- EventRoute 消费配置：新建 automation「数据事件分析-0916」（target=规划协调A-e02e，
  prompt 模板 {{content}}）；三条 route（CORN / SLS / wizard-e2e test 源）→
  automation；SLS route 加 filter content contains ERROR + dedupe(content, 24h) 防风暴；
  SLS 游标推进到修复时刻（跳过一天积压，只流新日志）。

## 3. 活体证据
- watcher 自愈：重启后 error 源未经人工干预自动 tick 成功回 active（last_poll_ok=t）。
- 消费链：test 事件注入 → event dispatched → event_delivery completed →
  invocation 040bbf6e completed（target_kind=agent_session，session eb176959 真跑）。
- 无风暴：修复后 30 分钟内 SLS 500 条新日志全 filtered（INFO 不命中 ERROR 过滤器），
  CORN 无新行 dedupe 持平，invocation 仅测试 1 条。
- 测试 20/20；gate.sh ALL GATES GREEN。

## 4. 登记
- dead delivery db6faa52 为修复前无路由时期遗留，不重试（历史证据保留）。
- 出站 TLS 抖动为环境族问题（fake-ip/代理），非代码缺陷；watcher 修复使其自愈而非致死。
- D1–D7（EventBridge 订阅+CloudEvents 转换层 P0.5 等，15 号稿）仍待拍板，不在本次范围。
