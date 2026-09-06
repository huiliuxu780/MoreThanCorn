/** FieldControlRegistry：x-control → 控件 的唯一注册表（06-master-spec §2.1 的 MTC-007R 实现）。
 *
 *  规则（独立验收 P0 返工要求）：
 *  - 所有可配置节点由 SchemaInspector 按 schema 渲染，专项控件只能在本表注册扩展；
 *  - 后端注册表 schema 的 x-control 名与前端目录共用同一命名空间；
 *  - 无 x-control 的字段按 type/enum 派生原语控件（也是注册表成员，保证“注册表即全集”）。
 *
 *  测试锚点：registeredControlNames() 供 vitest 断言目录/后端 x-control 全部可解析。 */
import type { PropertySchema } from "../schema/node-schemas"
import type { FieldControl } from "./inspector-types"

import {
  ArrayLinesControl, BooleanControl, EnumSelectControl, HintTextControl,
  JsonEditorControl, NumberControl, TextControl, TextareaControl,
} from "./controls/primitives"
import {
  AgentPickerControl, AgentPickerMultiControl, AssetPickerControl, KnowledgePickerControl,
  McpPickerControl, McpToolPickerControl, ToolPickerControl, VariablePickerControl,
  WorkflowPickerControl, WorkflowPickerMultiControl,
} from "./controls/pickers"
import {
  CodeEditorControl, ExpressionEditorControl, InputsSimpleControl, PromptEditorControl,
  PythonCodeControl,
} from "./controls/editors"
import {
  EndOutputsControl, InputsBindingControl, MemoryWriteValuesControl,
} from "./controls/bindings"
import {
  DecisionClassesControl, InputMappingControl, QueryStrategyControl, RetrievalConfigControl,
  StartFormControl, ToolBindingControl, ToolParamsControl, VersionPolicyControl,
  WorkflowExecBindingControl,
} from "./controls/composites"
import {
  LlmBatchControl, LlmOutputControl, LlmPromptControl, ModelPickerControl, RoutingModelControl,
} from "./controls/llm-controls"
import { ConditionBuilderControl } from "./controls/condition-builder"

const registry = new Map<string, FieldControl>()

export function registerControl(name: string, control: FieldControl): void {
  registry.set(name, control)
}

export function getControl(name: string): FieldControl | undefined {
  return registry.get(name)
}

/** 已注册 x-control 名（有序，供测试与文档）。 */
export function registeredControlNames(): string[] {
  return [...registry.keys()]
}

/** 无 x-control 时按 schema 派生原语控件名。 */
export function derivePrimitiveName(schema: PropertySchema): string {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return "enum-select"
  switch (schema.type) {
    case "boolean": return "boolean"
    case "number": case "integer": return "number"
    case "array": return "array-lines"
    case "object": return "json-editor"
    default: return "textarea"
  }
}

/** 字段 → 控件解析（单一入口；x-control 未注册时回落原语并在控制台留痕）。 */
export function controlFor(schema: PropertySchema): FieldControl {
  const name = schema["x-control"] ?? derivePrimitiveName(schema)
  const c = registry.get(name)
  if (c) return c
  console.warn(`[designer] x-control 未注册: ${name}（回落原语渲染）`)
  return registry.get(derivePrimitiveName(schema)) ?? TextControl
}

/* ---- 注册（原语） ---- */
registerControl("text", TextControl)
registerControl("textarea", TextareaControl)
registerControl("number", NumberControl)
registerControl("boolean", BooleanControl)
registerControl("enum-select", EnumSelectControl)
registerControl("array-lines", ArrayLinesControl)
registerControl("json-editor", JsonEditorControl)
registerControl("hint-text", HintTextControl)

/* ---- 注册（选择器，含后端 registry.py 全部 x-control 名） ---- */
registerControl("variable-picker", VariablePickerControl)
registerControl("workflow-picker", WorkflowPickerControl)
registerControl("workflow-picker-multi", WorkflowPickerMultiControl)
registerControl("tool-picker", ToolPickerControl)
registerControl("knowledge-picker", KnowledgePickerControl)
registerControl("asset-picker", AssetPickerControl)
registerControl("mcp-picker", McpPickerControl)
registerControl("mcp-tool-picker", McpToolPickerControl)
registerControl("agent-picker", AgentPickerControl)
registerControl("agent-picker-multi", AgentPickerMultiControl)
registerControl("model-picker", ModelPickerControl)

/* ---- 注册（编辑器） ---- */
registerControl("prompt-editor", PromptEditorControl)
registerControl("expression-editor", ExpressionEditorControl)
registerControl("code-editor", CodeEditorControl)
registerControl("python-code", PythonCodeControl)
registerControl("inputs-simple", InputsSimpleControl)
registerControl("llm-prompt", LlmPromptControl)

/* ---- 注册（绑定） ---- */
registerControl("inputs-binding", InputsBindingControl)
registerControl("end-outputs", EndOutputsControl)
registerControl("memory-write-values", MemoryWriteValuesControl)

/* ---- 注册（复合） ---- */
registerControl("start-form", StartFormControl)
registerControl("tool-binding", ToolBindingControl)
registerControl("tool-params", ToolParamsControl)
registerControl("retrieval-config", RetrievalConfigControl)
registerControl("workflow-exec-binding", WorkflowExecBindingControl)
registerControl("version-policy", VersionPolicyControl)
registerControl("input-mapping", InputMappingControl)
registerControl("query-strategy", QueryStrategyControl)
registerControl("decision-classes", DecisionClassesControl)
registerControl("condition-builder", ConditionBuilderControl)
registerControl("llm-output", LlmOutputControl)
registerControl("llm-batch", LlmBatchControl)
registerControl("routing-model", RoutingModelControl)
