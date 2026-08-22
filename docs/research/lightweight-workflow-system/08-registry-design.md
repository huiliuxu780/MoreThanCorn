# 08 · Registry 设计（Designed，Sim 机制取舍见各节标注）

> Sim 事实来源：`evidence/sim-part-a-editor-registry.md`（Observed-Source）。
> 总原则：**关联键一律字符串**（node type / tool id / model id / connection id），无运行时对象引用（Sim 核心机制，Reference）。

## 1. Node Registry（节点定义）

- 结构：Python 侧 `NODE_REGISTRY: dict[type, NodeDefinition]`，NodeDefinition=Pydantic：
  ```python
  class NodeDefinition(BaseModel):
      type: str            # input|llm|tool|condition|transform|end|create-record|notification
      family: str          # 画布分组（信息处理/逻辑/数据/终端）
      label: str; icon: str; accent: str
      config_schema: dict  # JSON Schema → Inspector 动态表单（shadcn 控件映射表）
      inputs: list[PortDef]; outputs: OutputSchemaDef   # 声明式类型端口
      executor_key: str
      defaults: dict       # 新建节点默认 config
      execution_defaults: dict  # timeout/retries 默认
  ```
- 注册方式：代码静态注册（模块 import 时填 map）；DB 表 `node_definition` 仅存 enabled 覆盖与版本记录（运维启停），**不做 DB 驱动动态节点**（Sim custom-block overlay = Do Not Adopt，Part A #15）。
- 前端消费：`GET /registry/node-definitions` 返回同构 JSON → Palette 列表 + Inspector 表单 + 节点卡摘要行渲染（**单一通用节点组件**，Sim nodeTypes=4 的通用 WorkflowBlock 思路，Reference and Rewrite；我们已有 `flow-node.tsx`，保持）。
- 动态表单：Sim SubBlockType 大 switch 裁剪为 10 种控件：text/textarea/number/select/combobox/switch/json-schema-editor/prompt-editor/tool-picker/model-picker/connection-picker（Part A #3，Reference and Rewrite）。

## 2. Executor Registry（后端执行器）

- 结构：`EXECUTORS: dict[type, NodeExecutor]` + `default_executor`（兜底=tool 调用语义，Sim generic-handler 思想，Part A #5）。
- 接口：
  ```python
  class NodeExecutor(Protocol):
      async def execute(ctx: RunContext, node: WorkflowNode, inputs: dict) -> NodeOutput
  ```
- 与 Sim 差异：Sim 用 canHandle 谓词链（适配 17 种异构 handler）；我们节点种类≤10 且 type 明确，**dict 直查更简单**；保留 default 兜底用于未来扩展（Designed）。

## 3. Tool Registry

- Tool = 一次外部调用的**声明式配方**（Sim ToolConfig 三件套：params schema + request 配方 + transformResponse，Part A #6，Reference and Rewrite）。
- 结构：DB 表 tool/tool_version（11）；spec JSONB：
  ```jsonc
  { "kind": "http",
    "request": { "url": "{connection.baseUrl}/x", "method": "POST",
                 "headers": {...}, "bodyTemplate": {...} },   // 模板变量={input.x}
    "params": { JSON Schema }, "outputs": { JSON Schema },
    "transform": { "extract": "data.items", "errorPath": "error.message" },
    "retry": { "max": 1, "on": ["5xx","timeout"] } }
  ```
- 内置工具 kind=builtin（如 knowledge_search、biz_api_query），executor_key 指 Python 实现。
- **Tool 与 Node 是两个概念**（Sim 证实，Part A 要点）：Tool 节点=通用节点+绑定 tool_version_id；LLM 节点可挂 tools 列表作为 function calling（V1：Omit function calling，Future）。
- 新增一个 Tool = 插一行 DB（http）或一个 builtin 实现类+注册行——**不改画布/Runner 代码**（验收问题回答）。

## 4. Model Registry

- V1：**配置表 model_provider/model**（11）+ Settings 页维护；不建 Sim 式 4700 行目录（Omit in V1，Part A #11）。
- 引用：节点 config.modelRef={providerId,modelId}（**不**学 Sim 内联裸 model id 字符串——我们要冻结与可校验）。
- Model Adapter：单一 `llm_gateway` 模块按 provider 分派（OpenAI 兼容协议优先），能力标签用于 UI（文本生成/深度思考，quickservice 借鉴）。

## 5. Connection Registry

- V1：connection 表 + secret_ref（Fernet）；kind=api_key|basic|bearer；**不做 OAuth 服务目录**（Sim OAUTH_PROVIDERS Omit in V1，Part A #12）。
- 引用：tool.connection_id；删除被引用连接=409+引用清单（Designed，quickservice 未验证项）。
- 连接测试：`POST /connections/{id}/test` 用 tool spec 的 ping 请求或 TCP/401 探测。

## 6. Trigger Registry

- V1 不建注册表：trigger 为 workflow.triggers 声明（manual/api）+ schedule 表（Task 级）。Sim TRIGGER_REGISTRY（74 服务 webhook）= Omit（Part A #13）。
- **Schedule 是 Trigger 不是 Node**（任务书 §11 判断确认）：schedule 行绑定 workflow_version_id（Sim deploymentVersionId 绑定思想，Reference），不占用画布。

## 7. 合并/分离判断

| Registry | 决策 |
|---|---|
| Node+Executor | 定义与执行分离两表/两 map，type 字符串关联（Sim 同） |
| Tool | 独立（版本化实体），与 Node 分离 |
| Model | 独立配置表，V1 轻量 |
| Connection | 独立（Secret 边界） |
| Trigger | 合并进 workflow.triggers + schedule 表，不独立 Registry |
| Selector/Modal/BlockMeta | 不建（Do Not Adopt） |

## 8. 校验共用纯函数（Direct Reuse，Part A #7/#10）

- 前端 TS 直接移植 `wouldCreateCycle/filterAcyclicEdges/filterUniqueWorkflowEdges` 语义；后端 Python 同语义实现（Validator 与保存接口共用）。
- 节点名归一+保留名/重名检查同移植（变量引用 `#{{node.outputs.x}}` 依赖名字唯一）。
