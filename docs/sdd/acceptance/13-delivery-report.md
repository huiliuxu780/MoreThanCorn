# SDD 13 投递回归报告（2026-09-01T18:42:13.082705+00:00，库 wf_dev）

- Consumer 20 条 Run.output 全部写入：rows=20 distinct_run=20 ✔
- Quality 20 条 Run.output 全部写入：rows=20 distinct_run=20 ✔
- 谱系列（_run_id/_task_run_id/_task_version_id/_interaction_ref/schema_ref）正确 ✔
- JSONB 数组/对象未被字符串截断或双重编码 ✔
- payload hash 与冻结 ResultDelivery 一致；重复投递 3 次目标表仍单行 ✔
- 重新执行产生新 Run 谱系（21 行=20+1），历史不被覆盖 ✔
- 永久错误码区分：TARGET_TABLE_MISSING（attempts=1）✔
- 重试投递仅 failed/dead_letter 且不改写 record_payload ✔
