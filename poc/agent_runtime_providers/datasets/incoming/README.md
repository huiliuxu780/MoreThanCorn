# Incoming call records

此目录只接收本地、已脱敏的原始输入，不纳入 Git。

推荐格式为 UTF-8 JSONL：每行一条完整 JSON 对象。JSON 字符串中的换行、
引号和反斜线应按 JSON 规则转义。收到数据后先执行：

1. JSON/JSONL 语法检查；
2. 对照 `call_record_input.schema.json` 做字段校验；
3. 扫描手机号、身份证、邮箱、地址等残留敏感信息；
4. 生成新的 `sample_id`，不把业务主键当样本标识；
5. 人工确认后才复制为可追踪的 smoke/golden 样本。

如果实际字段与当前 Schema 不一致，优先增加显式映射层，不直接修改原始文件。
