import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/app/form-field"
import { NODE_KIND_META } from "@/components/agents/flow-node"
import { collectVariables, VariablePicker } from "@/components/agents/variable-picker"
import type { AgentDetail, AgentNodeDef } from "@/domain/types"
import { tools } from "@/mocks/data"

/**
 * Inspector：只提供容器与布局骨架；字段由 Node Schema 决定（Master §8.6）。
 * 不人为规定所有节点拥有相同 Tabs。
 */
export function NodeInspector({
  node,
  agent,
  upstreamNames,
  readOnly,
  onChange,
}: {
  node: AgentNodeDef | null
  agent: AgentDetail | null
  upstreamNames: string[]
  readOnly: boolean
  onChange: (nodeId: string, patch: Partial<AgentNodeDef>) => void
}) {
  const [config, setConfig] = useState<Record<string, unknown>>({})
  useEffect(() => {
    setConfig(node?.config ?? {})
  }, [node?.id, node?.config])

  if (!node) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        选中节点后在此编辑配置。详细配置进入 Inspector，画布保持轻、薄、精密。
      </div>
    )
  }

  const meta = NODE_KIND_META[node.kind]
  const variables = collectVariables(agent, upstreamNames)
  const set = (key: string, value: unknown) => {
    const next = { ...config, [key]: value }
    setConfig(next)
    onChange(node.id, { config: next })
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-md"
          style={{ backgroundColor: meta.accent, color: meta.fg }}
        >
          <meta.icon className="size-3.5" />
        </span>
        <div>
          <Input
            className="h-7 w-full border-transparent px-1 text-sm font-medium shadow-none hover:border-input"
            value={node.name}
            disabled={readOnly}
            onChange={(e) => onChange(node.id, { name: e.target.value })}
          />
          <div className="px-1 text-[11px] text-muted-foreground">{meta.label} Node</div>
        </div>
      </div>

      <fieldset disabled={readOnly} className="space-y-4">
        {node.kind === "llm" ? (
          <>
            <FormField label="Model">
              <Select value={(config.model as string) ?? "qwen-max"} onValueChange={(v) => set("model", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="qwen-max">qwen-max</SelectItem>
                  <SelectItem value="qwen-plus">qwen-plus</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Prompt" description="出现变量占位符时，系统在下方生成变量绑定区">
              <Textarea
                className="min-h-32 font-mono text-xs"
                value={(config.prompt as string) ?? ""}
                onChange={(e) => set("prompt", e.target.value)}
              />
            </FormField>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Variables</Label>
              {(((config.prompt as string) ?? "").match(/\{\{\s*([\w.]+)\s*\}\}/g) ?? []).length > 0 ||
              ((config.variables as string[]) ?? []).length > 0 ? (
                <div className="space-y-1.5">
                  {([
                    ...new Set([
                      ...(((config.prompt as string) ?? "").match(/\{\{\s*([\w.]+)\s*\}\}/g) ?? []).map((m) =>
                        m.replace(/[{} ]/g, ""),
                      ),
                      ...((config.variables as string[]) ?? []),
                    ]),
                  ] as string[]).map((variable) => (
                    <VariablePicker
                      key={variable}
                      value={variable}
                      options={variables}
                      onChange={() => undefined}
                    />
                  ))}
                </div>
              ) : (
                <VariablePicker
                  value=""
                  options={variables}
                  placeholder="+ 绑定变量"
                  onChange={(v) => set("variables", [...((config.variables as string[]) ?? []), v])}
                />
              )}
            </div>
            <FormField label="Structured Output">
              <Select
                value={(config.structuredOutput as string) ?? "quality_result"}
                onValueChange={(v) => set("structuredOutput", v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(agent?.structuredOutputs ?? []).map((o) => (
                    <SelectItem key={o.name} value={o.name}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </>
        ) : null}

        {node.kind === "tool" ? (
          <>
            <FormField label="Tool Reference">
              <Select value={(config.toolId as string) ?? ""} onValueChange={(v) => {
                const tool = tools.find((t) => t.id === v)
                set("toolId", v)
                set("toolVersion", tool?.currentVersion)
              }}>
                <SelectTrigger><SelectValue placeholder="选择 Tool" /></SelectTrigger>
                <SelectContent>
                  {tools.filter((t) => t.governance === "Enabled").map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Tool Version" description="Published Agent 永远锁定具体 Tool Version">
              <Select value={(config.toolVersion as string) ?? ""} onValueChange={(v) => set("toolVersion", v)}>
                <SelectTrigger><SelectValue placeholder="锁定版本" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="V1">V1</SelectItem>
                  <SelectItem value="V2">V2</SelectItem>
                  <SelectItem value="V4">V4</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Input Mapping</Label>
              <VariablePicker
                value={(config.inputVariable as string) ?? ""}
                options={variables}
                placeholder="Tool 输入变量"
                onChange={(v) => set("inputVariable", v)}
              />
            </div>
            <FormField label="Error Handling">
              <Select value={(config.errorHandling as string) ?? "fail"} onValueChange={(v) => set("errorHandling", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fail">Fail（交给 Graph 处理）</SelectItem>
                  <SelectItem value="branch">Error Branch</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </>
        ) : null}

        {node.kind === "condition" ? (
          <FormField label="Expression">
            <Input
              className="font-mono text-xs"
              value={(config.expression as string) ?? ""}
              onChange={(e) => set("expression", e.target.value)}
            />
          </FormField>
        ) : null}

        {node.kind === "create-record" ? (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Input Mapping（Structured Output → Record）</Label>
              <VariablePicker
                value={(config.source as string) ?? ""}
                options={variables}
                placeholder="消费哪个 Structured Output"
                onChange={(v) => set("source", v)}
              />
            </div>
            <FormField label="Idempotency Key">
              <Input
                className="font-mono text-xs"
                value={(config.idempotency as string) ?? ""}
                onChange={(e) => set("idempotency", e.target.value)}
              />
            </FormField>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="text-xs">
                <div className="font-medium">Requires Approval</div>
                <div className="text-muted-foreground">Sink / Effect Node：Test Run 强制 Approval</div>
              </div>
              <Switch checked disabled />
            </div>
          </>
        ) : null}

        {node.kind === "input" ? (
          <p className="text-xs text-muted-foreground">
            输入由 Agent Input Schema 决定：
            {(agent?.inputSchema ?? []).map((i) => i.key).join("、")}
          </p>
        ) : null}

        {node.kind === "transform" || node.kind === "notification" || node.kind === "human-interrupt" || node.kind === "router" || node.kind === "end" ? (
          <FormField label="说明">
            <Textarea
              className="min-h-20 text-xs"
              value={(config.note as string) ?? node.description ?? ""}
              onChange={(e) => set("note", e.target.value)}
            />
          </FormField>
        ) : null}
      </fieldset>
    </div>
  )
}
