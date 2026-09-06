/** MTC-007R 单一配置路径的 schema 目录（数据，不是代码分叉）。
 *
 *  解析规则（resolveNodeSchema）：
 *  1. 前端目录（NODE_CONFIG_SCHEMAS）提供字段的控件映射（x-control）、分组（x-section）、
 *     可见性（x-show-if）与文案（title/x-hint）；
 *  2. 后端注册表 schema（server/app/registry.py）是字段存在性与类型/枚举的权威：
 *     后端独有的键按原样追加进默认分组，走同一个 renderer；
 *     被复合控件统一管理的键在目录里以 absorbs 声明，避免双份渲染；
 *  3. 目录未覆盖的类型（transform/reply/notification/create-record/agent 三键）直接用后端
 *     schema 渲染——所有可编辑节点只有 SchemaInspector 这一条代码路径。
 *
 *  专项交互一律以 x-control 注册进 inspector/FieldControlRegistry，
 *  禁止在 Inspector 中按 node type 分叉整块表单（独立验收 P0 返工要求）。 */
import type { NodeDefinition } from "@/services/wf-api"

export interface PropertySchema {
  type?: string
  /** 字段中文 label；缺省回落 FIELD_LABEL / key */
  title?: string
  enum?: string[]
  /** enum 显示文案（value → label） */
  "x-enum-labels"?: Record<string, string>
  default?: unknown
  /** FieldControlRegistry 注册名；缺省按 type 派生原语控件 */
  "x-control"?: string
  /** 分组标题；缺省「配置」 */
  "x-section"?: string
  /** 分组默认是否展开（仅对该分组第一个字段生效） */
  "x-section-open"?: boolean
  /** 条件可见：依赖同节点其他配置键 */
  "x-show-if"?: { key: string; equals?: unknown; notEquals?: unknown; in?: unknown[] }
  /** 字段下方一行说明 */
  "x-hint"?: string
  /** 控件私有参数（placeholder / minH / namePrefix 等） */
  "x-params"?: Record<string, unknown>
}

export interface NodeConfigSchema {
  properties: Record<string, PropertySchema>
  /** 被复合控件吸收的后端 schema 键（不再逐字段渲染） */
  absorbs?: string[]
}

/** 06-master-spec §2.1 字段 label 中文化回落表（schema 未给 title 时使用）。 */
export const FIELD_LABEL: Record<string, string> = {
  modelRef: "模型", prompt: "提示词", template: "模板", code: "代码", query: "查询",
  topK: "topK", keys: "记忆键", mode: "模式", candidates: "候选工作流", branches: "分支",
  toolVersionId: "插件工具", knowledgeSourceId: "知识源", mcpServerId: "MCP Server",
  toolName: "MCP 工具", workflowCode: "工作流", workflowId: "工作流", message: "消息内容",
  content: "回复内容", outputKey: "输出键", strategy: "策略", args: "参数",
  itemVar: "迭代变量", indexVar: "索引变量", maxIterations: "最大迭代数",
  parallel: "并行执行", parallelNums: "并行度", errorHandleMode: "错误响应",
  flattenOutput: "展平输出 flatten_output", iteratorRef: "循环源",
  resumeMode: "恢复方式", formContent: "审核提示", amount: "时长/超时值", unit: "单位",
  timeoutPolicy: "超时策略", dataAssetId: "数据资产", window: "数据窗口",
  sampling: "抽样", sampleN: "样本数 n", systemPrompt: "系统设定",
  ignoreCase: "大小写不敏感", looseTypeValidation: "宽松类型校验",
}

/** 前端控件目录：专项交互全部走 x-control 注册扩展。 */
export const NODE_CONFIG_SCHEMAS: Record<string, NodeConfigSchema> = {
  /* ---- 边界 ---- */
  input: {
    properties: {
      __form: { "x-control": "start-form", "x-section": "输入表单（输入契约）" },
    },
  },
  end: {
    properties: {
      __outputs: { "x-control": "end-outputs", "x-section": "输出" },
    },
  },

  /* ---- 智能 ---- */
  llm: {
    properties: {
      modelRef: { type: "object", "x-control": "model-picker", "x-section": "模型" },
      __inputs: { "x-control": "inputs-binding", "x-section": "输入" },
      systemPrompt: {
        type: "string", "x-control": "prompt-editor", "x-section": "系统设定（可选）",
        "x-section-open": false,
        "x-params": { placeholder: "人设/回复逻辑/语言风格；优先级高于提示词", minH: "min-h-14" },
      },
      prompt: {
        type: "string", "x-control": "llm-prompt", "x-section": "提示词",
        "x-params": { placeholder: "请输入提示词", minH: "min-h-24" },
      },
      __output: { "x-control": "llm-output", "x-section": "输出" },
      __batch: { "x-control": "llm-batch", "x-section": "批处理", "x-section-open": false },
    },
    absorbs: ["outputFormat", "outputSchema"],
  },

  /* ---- 外部 ---- */
  tool: {
    properties: {
      __tool: {
        "x-control": "tool-binding", "x-section": "插件工具",
        "x-hint": "默认绑定最新版本；节点引用计入删除防护。",
      },
      __params: { "x-control": "tool-params", "x-section": "参数（常量｜变量）" },
    },
    absorbs: ["toolVersionId", "toolId"],
  },
  "knowledge-retrieval": {
    properties: {
      knowledgeSourceId: { type: "string", "x-control": "knowledge-picker", "x-section": "Knowledge Source" },
      query: {
        type: "string", "x-control": "prompt-editor", "x-section": "检索配置",
        "x-params": { placeholder: "{{开始.outputs.userQuery}}", minH: "min-h-14" },
      },
      __retrieval: { "x-control": "retrieval-config", "x-section": "检索配置" },
    },
    absorbs: ["topK", "retrievalMode", "scoreThreshold", "rerankEnable"],
  },
  "mcp-call": {
    properties: {
      mcpServerId: { type: "string", "x-control": "mcp-picker", "x-section": "MCP Server" },
      toolName: {
        type: "string", "x-control": "mcp-tool-picker", "x-section": "MCP 工具",
        "x-hint": "工具列表来自 MCP Server 握手发现；无真实服务时为示例工具（不可当真）。",
      },
      args: { type: "object", "x-control": "json-editor", "x-section": "参数" },
    },
  },
  "workflow-exec": {
    properties: {
      __exec: { "x-control": "workflow-exec-binding", "x-section": "绑定模式" },
    },
    absorbs: ["workflowCode", "mode"],
  },
  "workflow-fixed": {
    properties: {
      workflowId: { type: "string", "x-control": "workflow-picker", "x-section": "工作流" },
      __versionPolicy: { "x-control": "version-policy", "x-section": "版本策略" },
      __mapping: { "x-control": "input-mapping", "x-section": "输入变量映射" },
    },
    absorbs: ["versionPolicy", "pinnedVersionId"],
  },
  "workflow-select": {
    properties: {
      candidates: {
        type: "array", "x-control": "workflow-picker-multi", "x-section": "候选工作流（多选）",
        "x-hint": "未命中任何候选 → else 分支。",
      },
      __routing: {
        "x-control": "routing-model", "x-section": "路由模型",
        "x-hint": "未命中走 else；路由超时 10s 失败降级 else。",
      },
    },
    absorbs: ["routingModel"],
  },

  /* ---- 逻辑 ---- */
  condition: {
    properties: {
      branches: { type: "array", "x-control": "condition-builder", "x-section": "条件分支" },
      ignoreCase: {
        type: "boolean", "x-section": "高级", "x-section-open": false, default: true,
      },
      looseTypeValidation: { type: "boolean", "x-section": "高级" },
      __condHint: {
        "x-control": "hint-text", "x-section": "高级",
        "x-params": { text: "操作符族含 in/not_in/exists/is_null 系；object/file 子属性条件经变量级联子路径选择。" },
      },
    },
  },
  "decision-class": {
    properties: {
      branches: {
        type: "array", "x-control": "decision-classes",
        "x-section": "分类项（命中走对应分支，未命中走 else）",
      },
    },
  },
  loop: {
    properties: {
      iteratorRef: {
        type: "string", "x-control": "variable-picker", "x-section": "循环源",
        "x-hint": "限 Array 类型；画布 body 口拉回边构成循环体。",
      },
      itemVar: { type: "string", "x-section": "循环源", default: "item" },
      indexVar: { type: "string", "x-section": "循环源", default: "index" },
      maxIterations: { type: "number", "x-section": "执行限制", "x-section-open": false, default: 1000 },
      parallelNums: { type: "number", "x-section": "执行限制", default: 10 },
      parallel: { type: "boolean", "x-section": "执行限制" },
      errorHandleMode: {
        type: "string", "x-section": "执行限制", default: "terminated",
        "x-enum-labels": {
          terminated: "Terminated（终止）",
          continue_on_error: "ContinueOnError（继续）",
          remove_abnormal: "RemoveAbnormal（剔除）",
        },
      },
      flattenOutput: { type: "boolean", "x-section": "执行限制", default: true },
    },
  },
  "wait-review": {
    properties: {
      resumeMode: {
        type: "string", "x-section": "恢复方式", default: "human",
        "x-enum-labels": { human: "人审表单", interval: "定时间隔", specific: "指定时刻" },
      },
      formContent: {
        type: "string", "x-control": "prompt-editor", "x-section": "恢复方式",
        "x-show-if": { key: "resumeMode", equals: "human" },
        "x-params": { placeholder: "审核提示（markdown，可预览）", minH: "min-h-14" },
      },
      amount: { type: "number", "x-section": "恢复方式", default: 24 },
      unit: { type: "string", "x-section": "恢复方式", default: "hour" },
      timeoutPolicy: {
        type: "string", "x-section": "恢复方式", "x-section-open": true, default: "escalate",
        "x-show-if": { key: "resumeMode", equals: "human" },
        "x-enum-labels": { auto_pass: "自动通过", auto_reject: "自动驳回", escalate: "升级" },
      },
      __outs: {
        "x-control": "hint-text", "x-section": "输出与出口", "x-section-open": false,
        "x-params": { text: "decision / comment / waitedMs；画布 pass / reject 双出口；运行时卡内橙环“待审核”，恢复 URL tooltip 回显。" },
      },
    },
  },

  /* ---- 数据 ---- */
  "data-read": {
    properties: {
      dataAssetId: { type: "string", "x-control": "asset-picker", "x-section": "数据资产" },
      window: { type: "string", "x-section": "窗口与抽样", default: "all" },
      sampling: { type: "string", "x-section": "窗口与抽样", default: "all" },
      sampleN: {
        type: "number", "x-section": "窗口与抽样", default: 10,
        "x-show-if": { key: "sampling", in: ["random_n", "stratify"] },
      },
      __hint: {
        "x-control": "hint-text", "x-section": "窗口与抽样",
        "x-params": { text: "访问身份=流程创建者（触发者预留置灰）。" },
      },
    },
  },
  "query-rewrite": {
    properties: {
      __strategy: { "x-control": "query-strategy", "x-section": "Query 改写" },
      __inputs: {
        "x-control": "inputs-simple", "x-section": "输入绑定",
        "x-params": { sequentialNames: ["query", "chatHistory"], placeholder: "固定值或留空取 Start" },
      },
    },
    absorbs: ["strategy", "template"],
  },

  /* ---- 代码 ---- */
  "code-write": {
    properties: {
      code: {
        type: "string", "x-control": "python-code", "x-section": "代码（Python 沙箱，10s 超时）",
        "x-hint": "必须定义 main(args)，返回 dict；输入来自下方输入绑定（args.params）。",
      },
      __inputs: {
        "x-control": "inputs-simple", "x-section": "输入绑定",
        "x-params": { namePrefix: "in", placeholder: "固定值" },
      },
    },
  },

  /* ---- 记忆 ---- */
  "memory-variable": {
    properties: {
      mode: { type: "string", "x-section": "配置" },
      keys: { type: "array", "x-section": "配置" },
      __write: {
        "x-control": "memory-write-values", "x-show-if": { key: "mode", equals: "write" },
        "x-section": "写入值（输入绑定：变量名=记忆键）",
      },
    },
  },
}

/* ---- 解析：目录 + 后端注册表 schema → 分组字段序列 ---- */

export interface ResolvedField {
  key: string
  schema: PropertySchema
}

export interface ResolvedSection {
  title: string
  defaultOpen: boolean
  fields: ResolvedField[]
}

export interface ResolvedSchema {
  sections: ResolvedSection[]
  empty: boolean
}

const DEFAULT_SECTION = "配置"

function backendProps(def: NodeDefinition | undefined): Record<string, PropertySchema> {
  const p = (def?.schema as { properties?: unknown } | undefined)?.properties
  return p && typeof p === "object" ? (p as Record<string, PropertySchema>) : {}
}

/** 单一解析入口：目录字段（有序）+ 后端独有字段（追加，absorbs 除外）→ x-section 分组。 */
export function resolveNodeSchema(typeKey: string, def?: NodeDefinition): ResolvedSchema {
  const catalog = NODE_CONFIG_SCHEMAS[typeKey]
  const backend = backendProps(def)
  const fields: ResolvedField[] = []
  const seen = new Set<string>()
  for (const [key, schema] of Object.entries(catalog?.properties ?? {})) {
    fields.push({ key, schema: { ...backend[key], ...schema } })
    seen.add(key)
  }
  const absorbed = new Set(catalog?.absorbs ?? [])
  for (const [key, schema] of Object.entries(backend)) {
    if (seen.has(key) || absorbed.has(key)) continue
    fields.push({ key, schema })
  }

  const sections: ResolvedSection[] = []
  const byTitle = new Map<string, ResolvedSection>()
  for (const f of fields) {
    const title = f.schema["x-section"] ?? DEFAULT_SECTION
    let sec = byTitle.get(title)
    if (!sec) {
      sec = { title, defaultOpen: f.schema["x-section-open"] ?? true, fields: [] }
      byTitle.set(title, sec)
      sections.push(sec)
    }
    sec.fields.push(f)
  }
  return { sections, empty: sections.every((s) => s.fields.length === 0) }
}

/** x-show-if 求值（SchemaInspector 与控制台测试共用）。 */
export function fieldVisible(schema: PropertySchema, cfg: Record<string, unknown>): boolean {
  const cond = schema["x-show-if"]
  if (!cond) return true
  const v = cfg[cond.key]
  if (cond.in) return cond.in.includes(v)
  if (cond.equals !== undefined) return v === cond.equals
  if (cond.notEquals !== undefined) return v !== cond.notEquals
  return true
}
