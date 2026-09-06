/** Inspector 控件的数据源 hooks：模型目录 / MCP 工具 / 工作流列表 / Agent 列表。
 *  全部来自真实注册表 API（A-15：无硬编码回退，失败=空态）。 */
import { useEffect, useState } from "react"
import { agentApi, wfApi } from "@/services/wf-api"
import { resApi } from "@/services/resource-api"

export interface ModelItem { id: string; caps: string[] }

export function useModelCatalog(): ModelItem[] {
  const [models, setModels] = useState<ModelItem[]>([])
  useEffect(() => {
    resApi.registry("model").then((r) => setModels(r.items.map((m) => ({
      id: (m.metadata.modelKey as string) || m.id,
      caps: (m.metadata.capabilities as string[]) ?? [],
    })))).catch(() => setModels([]))
  }, [])
  return models
}

export function useMcpTools(mcpServerId: string | undefined): string[] {
  const [tools, setTools] = useState<string[]>([])
  useEffect(() => {
    if (!mcpServerId) { setTools([]); return }
    resApi.get("mcp", mcpServerId)
      .then((d) => setTools(((d.config?.discoveredTools as { name?: string }[] | undefined) ?? []).map((t) => t.name ?? "")))
      .catch(() => undefined)
  }, [mcpServerId])
  return tools
}

export function useWorkflowList(): { id: string; name: string }[] {
  const [list, setList] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    wfApi.list({ pageSize: 100 }).then((r) => setList(r.items as { id: string; name: string }[])).catch(() => undefined)
  }, [])
  return list
}

export function useAgentList(): { id: string; name: string }[] {
  const [list, setList] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    agentApi.list({ pageSize: 100 }).then((r) => setList(r.items.map((a) => ({ id: a.id, name: a.name })))).catch(() => undefined)
  }, [])
  return list
}
