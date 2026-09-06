/** SchemaInspector：全部可编辑节点的唯一配置渲染路径（MTC-007R P0）。
 *  输入 = resolveNodeSchema(类型, 后端注册表 def)；输出 = Section 分组 × 注册表控件。
 *  本组件内不允许出现任何按 node type 的 if/switch 分叉。 */
import { Section } from "@/components/wf/controls"
import type { NodeDefinition, WfEdge, WfNode } from "@/services/wf-api"
import type { NodeCfgLoose } from "../designer-types"
import { FIELD_LABEL, fieldVisible, resolveNodeSchema, type PropertySchema } from "../schema/node-schemas"
import { controlFor } from "./FieldControlRegistry"
import type { InspectorContext } from "./inspector-types"

export function fieldLabel(key: string, schema: PropertySchema): string {
  return schema.title ?? FIELD_LABEL[key] ?? key
}

export function SchemaInspector(props: {
  node: WfNode
  def: NodeDefinition | undefined
  nodes: WfNode[]
  edges: WfEdge[]
  defs: NodeDefinition[]
  agentId?: string
  cfg: NodeCfgLoose
  set: (k: string, v: unknown) => void
  onChange: (n: WfNode) => void
  onRemoveBranchEdges?: InspectorContext["onRemoveBranchEdges"]
}) {
  const { node, def, nodes, edges, defs, agentId, cfg, set, onChange, onRemoveBranchEdges } = props
  const { sections, empty } = resolveNodeSchema(node.type, def)
  if (empty) {
    return <p className="py-2 text-xs" style={{ color: "var(--text-secondary)" }}>该节点暂无 schema 定义（暂未启用）</p>
  }
  const ctx: InspectorContext = { node, nodes, edges, defs, agentId, cfg, set, onChange, onRemoveBranchEdges }
  return (
    <>
      {sections.map((sec) => {
        const visible = sec.fields.filter((f) => fieldVisible(f.schema, cfg))
        if (visible.length === 0) return null
        return (
          <Section key={sec.title} title={sec.title} defaultOpen={sec.defaultOpen}>
            <div className="space-y-2">
              {visible.map((f) => {
                const Control = controlFor(f.schema)
                return (
                  <div key={f.key} data-field={f.key}>
                    <Control fieldKey={f.key} label={fieldLabel(f.key, f.schema)} schema={f.schema} ctx={ctx} />
                    {/* x-hint 统一由渲染器输出（hint-text 控件本身就是提示，跳过） */}
                    {f.schema["x-hint"] && f.schema["x-control"] !== "hint-text" && (
                      <p className="pt-1 text-[11px]" style={{ color: "var(--text-secondary)" }}>{f.schema["x-hint"]}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </Section>
        )
      })}
    </>
  )
}
