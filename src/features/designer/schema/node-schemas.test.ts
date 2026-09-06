/** MTC-007R 单一配置路径契约测试：
 *  1. schema 目录里出现的每个 x-control 都必须在 FieldControlRegistry 注册；
 *  2. 后端注册表（server/app/registry.py）用到的每个 x-control 名必须可解析；
 *  3. resolveNodeSchema：目录覆盖类型全部非空；后端独有键追加；absorbs 键不重复渲染；
 *     目录控件优先于后端同名键；
 *  4. fieldVisible / derivePrimitiveName 行为。 */
import { describe, expect, it } from "vitest"
import {
  NODE_CONFIG_SCHEMAS, resolveNodeSchema, fieldVisible, FIELD_LABEL,
} from "./node-schemas"
import {
  registeredControlNames, getControl, derivePrimitiveName, controlFor,
} from "../inspector/FieldControlRegistry"

/** server/app/registry.py 中实际使用的全部 x-control 名（契约镜像，改动需双侧同步）。 */
const BACKEND_X_CONTROLS = [
  "prompt-editor", "tool-picker", "variable-picker", "workflow-picker",
  "agent-picker", "agent-picker-multi", "workflow-picker-multi",
  "expression-editor", "code-editor", "knowledge-picker",
  "mcp-picker", "mcp-tool-picker", "asset-picker",
]

/** server/app/registry.py 的全部 type_key（25 个，含 deprecated agent 三键）。 */
const BACKEND_TYPE_KEYS = [
  "input", "llm", "tool", "condition", "transform", "end", "create-record",
  "workflow-exec", "notification", "agent", "agent-select", "agent-exec",
  "decision-class", "query-rewrite", "code-write", "knowledge-retrieval",
  "mcp-call", "reply", "memory-variable", "workflow-select", "workflow-fixed",
  "loop", "wait-review", "data-read",
]

describe("x-control 注册表完整性", () => {
  it("schema 目录中的每个 x-control 均已注册", () => {
    const missing: string[] = []
    for (const [type, cat] of Object.entries(NODE_CONFIG_SCHEMAS)) {
      for (const [key, prop] of Object.entries(cat.properties)) {
        const x = prop["x-control"]
        if (x && !getControl(x)) missing.push(`${type}.${key}:${x}`)
      }
    }
    expect(missing).toEqual([])
  })

  it("后端注册表使用的每个 x-control 名均可解析", () => {
    const missing = BACKEND_X_CONTROLS.filter((x) => !getControl(x))
    expect(missing).toEqual([])
  })

  it("原语派生名全部在注册表中（enum/boolean/number/array/object/string）", () => {
    const names = registeredControlNames()
    for (const schema of [
      { enum: ["a"] }, { type: "boolean" }, { type: "number" },
      { type: "array" }, { type: "object" }, { type: "string" }, {},
    ]) {
      expect(names).toContain(derivePrimitiveName(schema))
    }
  })

  it("controlFor 对未知 x-control 回落原语而不是抛错", () => {
    const c = controlFor({ type: "string", "x-control": "not-exists-xyz" })
    expect(typeof c).toBe("function")
  })
})

describe("resolveNodeSchema 合并语义", () => {
  it("目录覆盖的所有类型解析结果非空", () => {
    for (const type of Object.keys(NODE_CONFIG_SCHEMAS)) {
      const r = resolveNodeSchema(type, undefined)
      expect(r.empty, type).toBe(false)
      expect(r.sections.length, type).toBeGreaterThan(0)
    }
  })

  it("后端独有键被追加渲染（同一 renderer 路径）", () => {
    const def = {
      type_key: "llm", family: "智能", label: "大模型", icon: "bot", accent: "#000",
      executor_key: "llm", io: {},
      schema: { type: "object", properties: { backendOnlyKey: { type: "string" } } },
    }
    const r = resolveNodeSchema("llm", def)
    const keys = r.sections.flatMap((s) => s.fields.map((f) => f.key))
    expect(keys).toContain("backendOnlyKey")
  })

  it("absorbs 声明的后端键不再单独渲染（复合控件统一管理）", () => {
    const def = {
      type_key: "llm", family: "智能", label: "大模型", icon: "bot", accent: "#000",
      executor_key: "llm", io: {},
      schema: { type: "object", properties: { outputFormat: { type: "string", enum: ["Markdown", "JSON"] } } },
    }
    const r = resolveNodeSchema("llm", def)
    const keys = r.sections.flatMap((s) => s.fields.map((f) => f.key))
    expect(keys).not.toContain("outputFormat")
    expect(keys).toContain("__output")
  })

  it("同键位目录控件优先，后端类型信息保留（modelRef=object+model-picker）", () => {
    const def = {
      type_key: "llm", family: "智能", label: "大模型", icon: "bot", accent: "#000",
      executor_key: "llm", io: {},
      schema: { type: "object", properties: { modelRef: { type: "object" } } },
    }
    const r = resolveNodeSchema("llm", def)
    const f = r.sections.flatMap((s) => s.fields).find((x) => x.key === "modelRef")
    expect(f?.schema["x-control"]).toBe("model-picker")
    expect(f?.schema.type).toBe("object")
  })

  it("无目录类型直接渲染后端 schema（transform/reply/notification/create-record/agent 三键）", () => {
    for (const type of ["transform", "reply", "notification", "create-record", "agent", "agent-select", "agent-exec"]) {
      expect(NODE_CONFIG_SCHEMAS[type], type).toBeUndefined()
    }
    const def = {
      type_key: "reply", family: "信息回复", label: "对话回复", icon: "message-square", accent: "#000",
      executor_key: "reply", io: {},
      schema: { type: "object", properties: { content: { type: "string", "x-control": "prompt-editor" } } },
    }
    const r = resolveNodeSchema("reply", def)
    expect(r.empty).toBe(false)
    expect(r.sections[0].fields[0].schema["x-control"]).toBe("prompt-editor")
  })

  it("目录+后端合成后，全部 24 个后端 type_key 都可渲染（未知类型才允许空）", () => {
    // 后端 schema 全空的类型（input/end）由目录兜底；其余类型后端 schema 非空。
    const backendEmptySchema: Record<string, boolean> = { input: true, end: true }
    for (const type of BACKEND_TYPE_KEYS) {
      const fakeDef = backendEmptySchema[type]
        ? { schema: { type: "object", properties: {} } }
        : { schema: { type: "object", properties: { someKey: { type: "string" } } } }
      const r = resolveNodeSchema(type, fakeDef as never)
      expect(r.empty, `${type} 必须可渲染`).toBe(false)
    }
  })
})

describe("fieldVisible / 标签回落", () => {
  it("x-show-if equals / in / notEquals", () => {
    expect(fieldVisible({ "x-show-if": { key: "mode", equals: "write" } }, { mode: "write" })).toBe(true)
    expect(fieldVisible({ "x-show-if": { key: "mode", equals: "write" } }, { mode: "read" })).toBe(false)
    expect(fieldVisible({ "x-show-if": { key: "sampling", in: ["random_n", "stratify"] } }, { sampling: "all" })).toBe(false)
    expect(fieldVisible({ "x-show-if": { key: "sampling", in: ["random_n", "stratify"] } }, { sampling: "stratify" })).toBe(true)
    expect(fieldVisible({ "x-show-if": { key: "a", notEquals: "x" } }, { a: "y" })).toBe(true)
    expect(fieldVisible({}, {})).toBe(true)
  })

  it("FIELD_LABEL 回落表覆盖后端 schema 的裸键", () => {
    for (const key of ["outputKey", "message", "content", "keys", "mode", "args"]) {
      expect(FIELD_LABEL[key], key).toBeTruthy()
    }
  })
})
