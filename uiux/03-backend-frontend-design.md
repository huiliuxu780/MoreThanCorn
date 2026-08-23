# 资源管理一期 · 前后端功能设计（Engineering V1.0）

> 后端：`server/`（FastAPI + SQLAlchemy + alembic + pytest）。前端：`src/`（React + TS + Tailwind + shadcn）。
> 现状锚点：`server/app/models.py`（Connection/Tool/ToolVersion/ModelProvider/Model/DataAsset/AnalysisTask/WorkflowVersion/CallRecord…）、`routers/admin.py|business.py`、`registry.py`（Node Registry）、`runner.py`。

---

## 1. 架构总览

```
┌ 前端 src ────────────────────────────────────────────────┐
│ pages/resources/*  components/resources/*               │
│   services/resource-api.ts（新增，wf-api 同模式）          │
└───────────────┬──────────────────────────────────────────┘
                │ /api/ai-resources/* /api/data-resources/* /api/data-definitions
                │ /api/connections(升级) /api/registry/resources(picker)
┌ server ──────▼──────────────────────────────────────────┐
│ routers/resources.py（新） routers/connections.py（升级）   │
│ resource_registry.py（新：统一查询/状态/引用/删除防护）      │
│ resource_tests.py（新：六类 test executor）                │
│ registry.py（+knowledge-retrieval / mcp-call 节点定义）     │
│ runner.py（+两个 executor） validator.py（+依赖校验）       │
│ models.py（+5 表 / 改 3 表） alembic migration              │
└──────────────────────────────────────────────────────────┘
```

## 2. 数据模型

### 2.1 新增表

```python
class Datasource(Base):
    __tablename__ = "datasource"
    id, name(64), type(16)            # mysql|postgresql|oss|http
    connection_id FK connection.id    # 地址+凭证归 Connection
    location(128)                     # db 名 / bucket / base path
    config JSONB default {}           # ssl/pool/分区约束等
    status(16) default "enabled"      # enabled|disabled
    health(16) default "healthy"      # healthy|degraded|error
    last_check_at DateTime nullable
    created_at, updated_at

class McpServer(Base):
    __tablename__ = "mcp_server"
    id, name(64), description Text
    transport(8)                      # stdio|http
    command(256) default ""           # stdio 启动命令
    connection_id FK nullable         # http 模式
    env JSONB default {}              # {KEY: {secret_ref}} 环境变量凭证引用
    status(16) default "enabled", health(16) default "healthy"
    discovered_tools JSONB default [] # [{name, description, input_schema}]
    last_test_at nullable, created_at, updated_at

class KnowledgeSource(Base):
    __tablename__ = "knowledge_source"
    id, name(64), description Text
    kind(16)                          # vector|document
    embedding_model_id FK model.id nullable
    source_config JSONB default {}    # 内容来源（文档中台路径/目录等）
    status(16), health(16)
    slice_count Integer default 0
    last_sync_at nullable, created_at, updated_at

class DataDefinition(Base):
    __tablename__ = "data_definition"
    id, name(64)
    data_asset_id FK data_asset.id index
    field_schema JSONB default []     # [{key,displayName,type,description,required}]
    eligibility JSONB default []      # 现有 eligibility 表达式串列表
    lifecycle(16) default "Draft"     # Draft|Ready|Deprecated
    revision Integer default 1
    created_at, updated_at

class ResourceChangeLog(Base):
    __tablename__ = "resource_change_log"
    id, resource_type(16), resource_id(32) index
    action(32)                        # create|update|toggle|secret_rotate|test_fail…
    actor(64) default "", detail JSONB default {}
    created_at                        # 无版本类型的「变更记录」
```

### 2.2 变更表

| 表 | 变更 | 说明 |
|---|---|---|
| `connection` | +`protocol`(16)（http-api/mysql/postgresql/oss/mcp-http/llm）；+`endpoint` JSONB（{base_url} 或 {host,port} 或 {bucket,region}） | kind 保留为认证类型；存量 kind 值映射：api_key→API Key 等 |
| `data_asset` | +`datasource_id` FK nullable；+`location`(128)（表/路径） | datasource_id 空 = 内联 rows（手动来源），存量数据即此形态 |
| `model_provider` | `base_url` 保留但**新建强制走 Connection**（protocol=llm）；存量迁移生成 Connection 并置 `auth_connection_id` | 渐进收敛 |
| `analysis_task` | +`data_definition_id` FK nullable | 空时回落 data_asset_id（存量兼容） |
| `workflow_version` | +`mcp_refs` JSONB、`knowledge_refs` JSONB | 发布快照，供引用扫描 |
| `eval_sample` | +`data_asset_id` FK nullable | 评测样本可从 Data Asset 抽样（轻量联动） |
| `call_record` | +`target_type`(16)（tool/model/mcp/knowledge） | 7 日调用量聚合口径 |

### 2.3 迁移（alembic 单迁移）

1. 建 5 新表。
2. connection 加列；存量行 protocol='http-api'、endpoint={base_url: 现有 endpoint 字段（mock）/ ''}。
3. data_asset 加列（存量 datasource_id=NULL）。
4. 为存量 ModelProvider（base_url 非空）创建 Connection(protocol=llm) 并回填 auth_connection_id。
5. 为存量 http Tool（spec.url 绝对地址且无 connection_id）创建 Connection 并将 spec.url 改写为相对 path。
6. 为存量 DataAsset 创建同名 DataDefinition（field_schema 从前端 mock seed 导入脚本读取，后端空 schema 起步，lifecycle=Ready，revision=currentRevision）。
7. analysis_task.data_definition_id 回填：取该 asset 的首个 Ready Definition。

## 3. Resource Registry（server/app/resource_registry.py）

统一门面（强类型表之上的查询层，不建万能表）：

```python
TYPES = ["model","tool","mcp","knowledge","datasource","asset"]
def list_resources(db, type, *, page, page_size, search, status, health, ds_type) -> Paged[ResourceDTO]
def get_resource(db, type, id) -> ResourceDTO          # 含 metadata/usage 摘要
def set_status(db, type, id, enabled: bool, actor)     # 写 change_log
def references(db, type, id) -> list[Ref]              # 见 §4
def can_delete(db, type, id) -> (bool, list[Ref])
def delete(db, type, id, actor)                        # 不可删抛 409(detail=refs)
```

`ResourceDTO`：{id, type, name, description, status, health, icon_meta, metadata{}, usage{ref_count, calls_7d}, updated_at} —— 前端 ResourceCard 直接消费。

## 4. 引用扫描与删除防护

`references()` 按类型扫描（全部走索引列/JSONB 查询，规模内全表扫 definition 可接受）：

| 被引用类型 | 扫描来源 |
|---|---|
| model | workflow_version.definition 节点 config.modelRef.modelId；knowledge_source.embedding_model_id；workflow_version.model_refs |
| tool | definition 节点 config.toolVersionId → tool_version.tool_id；workflow_version.tool_version_refs |
| mcp | definition 节点 config.mcpServerId；workflow_version.mcp_refs |
| knowledge | definition 节点 config.knowledgeSourceId；workflow_version.knowledge_refs |
| datasource | data_asset.datasource_id |
| asset | data_definition.data_asset_id；analysis_task.data_asset_id；eval_sample.data_asset_id |
| definition | analysis_task.data_definition_id |
| connection | tool.connection_id；mcp_server.connection_id；datasource.connection_id；model_provider.auth_connection_id |

Ref = {kind: "workflow_node"|"asset"|"definition"|"task"|"eval"…, label, workflow_id?, version_no?, node_name?, last_run_at?}。
删除 API：`can_delete` 为假 → `HTTPException(409, detail={"refs": [...]})`，前端弹拦截对话框（沿用 connections 删除现有模式）。

## 5. Test Executor 与健康度（server/app/resource_tests.py）

统一入口 `run_test(db, type, id, input) -> TestResult{ok, latency_ms, output?, error?}`，落 `call_record`（target_type 扩展）+ 更新 health/last_test_at/last_check_at + change_log：

| 类型 | 真实路径 | mock 回落 |
|---|---|---|
| model | 经 provider connection 发最小 chat 请求（复用现有 llm client） | 固定 pong |
| tool | 现有 `/api/tools/{id}/test` 执行 spec | 同现状 |
| mcp | stdio  spawn / http initialize + tools/list，回写 discovered_tools | 返回示例工具表 |
| knowledge | 向量检索 client（配置了真实后端时） | 返回示例切片 |
| datasource | 驱动 ping：mysql/pg `SELECT 1`（pymysql/psycopg 可选依赖）、oss head、http GET 健康路径 | 恒真 + 延迟抖动 |
| asset | 经 datasource adapter 抽样 10 行 / 内联 rows 计数 + 时间字段存在性校验 | 同左（rows 恒在） |

失败 → health=error（不自动停用）+ change_log(test_fail)。

## 6. API 契约（新增/升级）

列表统一 `?page&pageSize&search&status&health`，Datasource 另 `&type`。

```
GET/POST        /api/ai-resources/{models|tools|mcp-servers|knowledge-sources}
GET/PUT/DELETE  /api/ai-resources/{…}/{id}            # DELETE 409 带 refs
POST            /api/ai-resources/{…}/{id}/toggle     # {enabled}
POST            /api/ai-resources/{…}/{id}/test       # {input?} → TestResult
GET             /api/ai-resources/{…}/{id}/usage      # 引用表 + 统计
GET             /api/ai-resources/tools/{id}/versions
POST            /api/ai-resources/tools/{id}/versions # 基于当前建草稿
GET/POST        /api/data-resources/{datasources|assets}
GET/PUT/DELETE  /api/data-resources/{…}/{id}  + /toggle + /test + /usage
GET/POST        /api/data-definitions               # ?assetId 筛选
GET/PUT/DELETE  /api/data-definitions/{id}
POST            /api/data-definitions/{id}/publish    # Draft→Ready, revision+1
POST            /api/data-definitions/{id}/infer      # 从 datasource 抽样推断 schema
GET/POST/PUT    /api/connections（+protocol/endpoint；列表 +type 筛选）
GET             /api/connections/{id}/usage           # 被引用清单
POST            /api/connections/{id}/test（现有，升级按 protocol 分发）
GET             /api/registry/resources?types=&enabledOnly=true   # picker 供给
```

兼容别名：`/api/tools*`、`/api/models*`、`/api/model-providers*`、`/api/data-assets*`（旧语义）保留并内部委托，前端旧页面在迁移期不破。

## 7. Workflow 节点联动

`registry.py` 增加节点定义：

```python
{"type_key":"knowledge-retrieval","family":"外部","label":"知识检索","icon":"book-open",
 "executor_key":"knowledge_retrieval",
 "schema":{"properties":{
   "knowledgeSourceId":{"type":"string","x-control":"knowledge-picker"},
   "query":{"type":"string","x-control":"expression-editor"},
   "topK":{"type":"number","default":5}},
  "required":["knowledgeSourceId","query"]},
 "io":{"outputs":["slices:string","sources:string"]}}
{"type_key":"mcp-call","family":"外部","label":"MCP 工具","icon":"server",
 "executor_key":"mcp_call",
 "schema":{"properties":{
   "mcpServerId":{"type":"string","x-control":"mcp-picker"},
   "toolName":{"type":"string","x-control":"mcp-tool-picker"},  # 枚举来自 discovered_tools
   "args":{"type":"object"}},
  "required":["mcpServerId","toolName"]},
 "io":{"outputs":["result:string"]}}
```

- `runner.py`：`knowledge_retrieval` → resource_tests 的检索 client；`mcp_call` → mcp client（stdio/http，mock 回落）。
- `validator.py`：新节点必填校验 + 依赖校验（资源存在且 status=enabled，否则 issue kind=dependency）。
- 发布（workflows router publish）：遍历 definition 收集 mcp_refs/knowledge_refs 写入 version 快照。
- 设计器：新增两个 picker 组件，数据源 `/api/registry/resources?enabledOnly=true`；llm/tool picker 同改 Registry 供给。

## 8. 数据定义与任务联动

- 任务向导第二步：选 Data Definition（列表仅 Ready；展示所属 Asset + 一条数据代表什么）；mapping 对 `definition.field_schema` 做（autoMapping/mappingIssues 原逻辑换数据源）。
- `batch_run_task`：rows 解析顺序 = definition 存在 → asset.datasource adapter 按 eligibility+scope+window 查询（mock 回落 rows）；否则 asset.rows（存量）。
- 存量任务 data_definition_id 为空时 UI 提示「补建定义」，不阻断运行。

## 9. 前端实现设计

- 新增 `services/resource-api.ts`（req 复用 wf-api 模式）；`domain/types.ts` 增 ResourceDTO/Datasource/McpServer/KnowledgeSource/DataDefinition/ConnectionV2。
- 页面：`pages/res-ai-list.tsx`、`res-data-list.tsx`、`res-wizard.tsx`（scope 由路由决定）、`res-detail.tsx`（type 参数驱动四屏）、`data-definitions.tsx`/`data-definition-editor.tsx`（现 data-assets 页改造）。
- 组件：§4 清单；ResourceCard 消费 ResourceDTO；wizard 表单六类独立文件。
- 导航：`app-sidebar.tsx` NAV_GROUPS 增删（AI Resources cpu / Data Resources database；移除 Tools、Models 条目）；`app.tsx` 增路由 + 两条 `<Navigate>` 重定向；`useRouteBreadcrumbs` 增分支。
- 回跳高亮：列表页读 `location.state?.highlight` 或 `?new=`，卡片 ring 2s 后清除。
- 环境门控沿用 `VITE_WF_API`：mock 模式补 mock-service 六类数据，保证无后端可演示。

## 10. 实施分期

| 期 | 内容 | 验收 |
|---|---|---|
| P1 | models+migration+resource_registry+六类 CRUD/toggle/409 | pytest 覆盖 CRUD+refs |
| P2 | connections 升级 + test executors + health | 六类 test 真/mock 双路径 |
| P3 | 前端列表×2 + 向导分域 + 详情双变体 + 回跳高亮 | 原型交互 1:1 |
| P4 | data_definition 实体 + 定义页迭代 + 任务向导切换 + 存量兼容 | 存量任务可跑 |
| P5 | 节点联动（定义/executor/validator/picker/publish refs） | 新节点端到端 mock 跑通 |
| P6 | 导航收敛+重定向+旧 API 别名+全量回归 | 28/28 存量 + 新增全绿 |

## 11. 测试计划

- 服务端：每类资源 CRUD/筛选/分页；删除防护矩阵（§4 全组合）；test executor mock 路径；wizard 后端约束（无 test 不允许 enabled 的 API 级校验：create 带 `tested:true` 凭证由 test 接口签发 token）；migration 幂等。
- 前端：手测清单对齐原型七页交互；重定向；picker 只列 Enabled；回跳高亮；空态三态。
- 回归：存量 workflow 发布/运行/批量任务不受影响。
