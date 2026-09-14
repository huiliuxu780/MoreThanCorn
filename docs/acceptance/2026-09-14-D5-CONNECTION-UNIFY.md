# 2026-09-14 D5 连接统一交付（用户拍板「现在做 D5 全量」）

## 0. 背景与诊断（用户三点质疑全部成立）
1. 「数据接入和数据资产感觉不对」→ 三层重叠：Connections（凭据正主）/ 数据资产 Datasource+DataAsset（目录正主）/ 数据接入 DataSource（F5 赶 e2e 自带凭据+表配置，重复造轮子）；
2. 「DataWorks 不止一张表」→ 原建模「一源=一表」粒度错；真实形态=一 project 多表；
3. 「还有个 connections 对不对」→ 对，凭据/多环境/健康/轮换能力它全有，接入层应复用。

目标设计（已实施）：
```
Connection（凭据+端点唯一）→ 目录发现(list tables/logstores/schemas) → DataAsset（表级目录）
   ├─ 分析任务读/写回（沿用）
   └─ 数据接入 DataSource 引用 connection_id + asset_id（config/secret_ref 兼容列双写过渡）
```

## 1. 后端
- 迁移 `g060d5unify0001`：data_source.connection_id/asset_id；data_asset.config（目录元数据）。迁移不碰凭据明文（安全门）。
- `catalog_discovery.py`（新）：maxcompute=pyodps list_tables（分区/注释）；sls=list_logstore（RAM 缺权限失败关闭并提示授权项）；postgresql/mysql=information_schema（排除系统 schema；pymysql 缺失失败关闭）；其余协议空目录。凭据一律 Connection.secret_ref；出站过 enforce_egress。
- 端点 `GET /api/connections/{cid}/catalog`（失败 502 CATALOG_DISCOVERY_FAILED）。
- Connection 协议白名单扩 `maxcompute/sls`；aksk 双约定兼容 `_aksk()`（Connection 形 {access_key, secret_key} 与源级旧形 {access_key_id, access_key_secret}）。
- 接入 create/patch 增 connection_id/asset_id；校验改为「connection_id 或 endpoint/project 二选一」；tick 解析顺序 connection→asset→config 兼容列。
- 存量迁移脚本 `server/scripts/migrate_d5_corn_source.py`（幂等）：CORN 源已迁（connection=65926ab7…/datasource=02b637b7…/asset=b8390979…）。

## 2. 前端
- Connections 页：行「目录」按钮（maxcompute/sls/postgresql/mysql）→ 目录对话框（名称/类型/schema/分区/挂为数据资产）；挂载=ensure Datasource + create DataAsset（config 带 partitioned/comment/schema）。
- 数据接入创建对话框：两级选择器（Connection → 目录表/logstore）；选连接后隐藏手工 endpoint/凭据域（由连接承载）；不选则兼容手工模式。
- 数据源详情页：「连接与数据资产（D5）」卡（引用展示 + 已挂载资产切换 select + 去连接目录挂载新表指引）。
- 连接表单：maxcompute/sls 端点域（endpoint+project）；协议 icon（Database/ScrollText）。

## 3. 测试与门禁
- `tests/test_d5_connection_unify.py` ×4：catalog mock odps 凭据来自 Connection；postgresql 真 information_schema（系统 schema 排除）；tick 经 connection 解析凭据/端点（mock fetch_page 断言注入）；校验二选一+兼容模式。
- 门禁：`gate.sh --live` ALL GATES GREEN（pytest 560 / vitest 76 / tsc -b / build / lint 0 / 层1-4 / 返工实证）。
- 活体证据：catalog=29 表（真 MaxCompute，凭据走 Connection）；CORN 源经 connection 引用 poll=397 行/4 页。
- 截图 `docs/acceptance/assets/2026-09-14-d5-unify/`：connections-catalog-dialog / datasources-two-level-selector / detail-refs-card。

## 4. 遗留
- SLS 真 e2e 待 RAM `log:ListProject/ListLogStores` 授权生效（用户处理中）；
- 凭据轮换提醒仍有效（两组 AKSK 明文过对话）；
- 旧 config.endpoint/secret_ref 兼容列待流量清零后删除（双写过渡期）。
