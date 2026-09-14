# 2026-09-14 数据源类型体系交付（maxcompute / api 拉取 / webhook / 飞书多维表格）

- 用户拍板（09-14）：类型选择每类型独立 icon；支持 maxcompute / api（拉取）/ webhook / 飞书多维表格；并问「需要我给你什么才能端到端测通」→ 凭据清单见 §5。
- 判定：**READY_FOR_ACCEPTANCE**。`./scripts/gate.sh --live` ALL GREEN；api_pull 已用本地 stub 真跑通端到端（§4）。

## 1. 类型体系与 icon

| kind | 标签 | icon（lucide） | 拉取/推送 | 凭据（secret_ref 加密） |
|---|---|---|---|---|
| webhook | Webhook（外部推送） | Webhook | 推送（X-Source-Token） | 接收 token（auth_token_hash） |
| api_pull | API（拉取） | CloudDownload | 平台拉取（游标分页） | 可选 bearer / api_key / basic |
| maxcompute | MaxCompute | Database | pyodps reader 切片 | {access_key_id, access_key_secret} |
| feishu_bitable | 飞书多维表格 | Table | tenant_token + bitable records 分页 | {app_id, app_secret} |
| test_event | 测试事件 | FlaskConical | 手动测试入口 | — |

存量 `polling` 行经 g059 迁移为 `api_pull`；创建/保存按类型校验必填（保存即拒，不留到拉取时才炸）。

## 2. 后端

- 迁移 `g059srckinds0001`：kind 重命名 + `data_source.secret_ref`（加密凭据列；config 只放非敏感参数）。
- `server/app/source_adapters.py`（新）：`fetch_page(kind, config, secret_ref, cursor)`；
  **凭据在适配器层解密**（路由层不接触明文，secret-leak 门禁）；所有出站过 `enforce_egress`；
  pyodps 缺失 → `SourceDriverMissing` 失败关闭**不 mock**；飞书 tenant_access_token→records
  分页（page_token 游标、fields 展平、业务错误码透传）；api_pull 游标参数递增+尾页停；
  空凭据匿名拉取（不挂空 Authorization 头）。
- `tick_pull_source`（原 tick_poll_source）：单 tick ≤5 页背压、页大小封顶 200、游标落
  `src.cursor`、去重键带源前缀 `{source_id}:{key}`、拉取失败 status=error+502。
- 端点：`POST /{sid}/poll`（拉取型；推送型 409）、`POST /{sid}/secret`（设置/更新/清除凭据，
  永不回显）、create 带 secret 加密落库；watcher 定时 tick 改按 PULL_KINDS。
- 测试 `tests/test_source_kinds.py` ×6：kind 校验与迁移、secret 信封加密落库断言（函数级
  WF_SECRET_KEY，免疫模块级 env 踩踏）、api_pull 鉴权三形+游标、飞书全链路 mock、
  maxcompute 驱动缺失 fail-closed、/poll 端到端（去重键前缀+二次拉取去重）。

## 3. 前端

- 创建对话框：类型下拉带 icon；分类型字段（api_pull: url/间隔/游标/页大小；maxcompute:
  endpoint/project/table；feishu: app_token/table_id/view_id）；凭据 JSON 文本域（加密说明）。
- 详情页 `/data-sources/:id`：类型 icon 页头；分类型接收配置编辑器；凭据卡（掩码+设置/更新
  对话框+清除）；列表类型徽章带 icon + 「管理」入口。
- 截图：`docs/acceptance/assets/2026-09-14-source-kinds/`（create-kind-select-icons /
  create-feishu-fields / detail-feishu-light）。

## 4. 端到端证据（无需凭据部分）

```
api_pull 本地 stub e2e（page_size=2，3 行数据）：
  第1次 poll → {"polled":3,"pages":2,"cursor":null}（游标分页 t1,t2 → t3）
  事件落库 3 条，dedupe_key={source_id}:t1..t3，status=filtered（无路由=留证据）
  第2次 poll → polled 3 但事件仍 3 条（源前缀去重生效）
gate.sh --live → ALL GATES GREEN（pytest 584 / vitest 76 / build / lint0 / 层1-4 / 对比度0）
```

## 5. 端到端测通所需凭据清单（用户问题答复）

| 类型 | 需要你给 | 备注 |
|---|---|---|
| webhook | **无** | 自包含；curl 示例：`curl -X POST http://…/api/v2/ingress/webhook/{id} -H 'X-Source-Token: …' -d '{…}'` |
| API（拉取） | 可选：真实系统 URL + 鉴权（bearer token / api key / basic 任一组） | 不给也能测：本地 stub 已证管线；给真实 URL 即换真源 |
| 飞书多维表格 | ① 自建应用 **app_id + app_secret**（开通 bitable 读权限）；② 测试多维表格的 **app_token + table_id**（视图 view_id 可选） | 或授权我用 lark-cli 以你的身份建一张测试表（但服务端拉取仍需应用凭据，用户 token 不能长期驻留服务端） |
| MaxCompute | ① RAM 用户 **AccessKey ID/Secret**（对目标 project 有读权限）；② **endpoint + project + 表名**（分区表给分区约定）；③ 批准 `pip install pyodps` 进 server venv | 当前驱动缺失=失败关闭；装驱动+给凭据后即通 |
| 网络 | 生产环境出站走 egress 闸（私网/元数据拦截）；飞书/MaxCompute 公网端点可过；本地开发全放行 | 若目标在内网需白名单 |

## 6. 遗留登记

- pyodps 未安装（等批准）；飞书/MaxCompute 真源 e2e 等凭据；
- 飞书增量拉取暂用 page_token 全量分页（无变更增量语义），后续可加 updated_field 增量；
- MaxCompute 分区表暂整表切片读，分区裁剪待真实表结构后补。

## 7. 补遗（09-14 续）：SLS 类型 + 真凭据 e2e

### 7.1 新增第五类型 sls（SLS 日志，icon=ScrollText）
- 适配器 `fetch_sls`：GetLogs 拉取，游标=`ts:offset`（from=ts 含 + offset 起 line=page_size；
  满页 offset 递增、空页游标保持——同秒后到日志靠 offset 续取）；初始游标=now-from_window_seconds(默认3600)；
  config.query 可选查询语句；凭据 {access_key_id, access_key_secret} 走 secret_ref。
- 前端：创建表单 endpoint/project/logstore/query/页大小 + 详情页编辑器；类型校验保存即拒。
- 测试 ×3：游标语义（满页/空页/offset 续）、缺 logstore 拒、缺凭据失败关闭（不 mock 客户端）；
  maxcompute 驱动缺失测试改为 import 阻断式（pyodps 已装，仍验证失败关闭路径）。
- 驱动安装：server venv 增 `pyodps 0.13.2` + `aliyun-log-python-sdk`（用户给凭据即视为批准）。

### 7.2 真凭据 e2e（只读操作）
- **MaxCompute 真跑通**：`bshcn_consumer_corn_prod.dim_aliyun_crm_case_type_status`（分区表）
  → poll 返回 polled=25/pages=5（page_size=5 游标分页）→ 25 条事件落库（行无 id 字段→hash 去重键生效）
  → 无路由留 filtered 证据 → 源与事件已清理。**分区处理**：config.partition 显式指定，
  缺省自动取最新创建分区；分区表无分区失败关闭。
- **发现（需用户澄清）**：
  ① `func_quickbi_corn` 在给定 project 中**不存在**（29 张表无 func/quickbi/corn 匹配；函数列表空；
  该 AKSK 无 odps:ListProjects 权限，仅给定 project 可达）——需确认它是什么对象
  （表/视图/函数/QuickBI 数据集？在哪个 project？）。
  ② SLS AKSK 的 `log:ListProject` 被 RAM 拒绝（scoped 策略）→ 无法自发现 project/logstore；
  GetLogs 可能对指定 project/logstore 有权限——**需用户提供 project + logstore 名**（query 可选）。

### 7.3 凭据安全注记
- 凭据经对话明文传递 → **建议 e2e 完成后轮换两组 AKSK**；
- 平台侧存储为 secret_ref 信封加密（WF_SECRET_KEY 包裹 data key），API 永不回显；
- 全部真源操作仅只读（SELECT / GetLogs / list），无写入。
