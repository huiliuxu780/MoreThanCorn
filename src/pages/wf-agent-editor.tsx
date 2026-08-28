/** Agent 编辑器路由：三型分发。
 *  R-Archive（SDD 10）：旧三类 Agent 已只读封存——本页退化为只读详情：
 *  移除保存/发布/停灰度/预览运行/编辑锁等全部写入口；历史版本、运行、结果仍可查看。 */
import { ArrowLeft } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { AgentEvalPanel, AgentEvolutionPanel, AgentRunsPanel, AgentVersionsPanel } from "@/components/agent-ops-panels"
import { useAgentVersionState } from "@/components/agent-publish-dialog"
import { Label } from "@/components/ui/label"
import { resApi } from "@/services/resource-api"
import { agentApi, wfApi, type AgentInfo } from "@/services/wf-api"
import WfDesignerPage from "./wf-designer"
import { avatarFor } from "./wf-agents-list"

const INK = "#1F2329"; const INK2 = "#5A6472"; const INK3 = "#B9C2CF"; const CARD = "#EDF0F4"

/** Agent 草稿配置（JSONB）的已知字段视图；09 P0-B4：边界类型化替代 any。 */
interface AgentDraftConfig {
  rolePrompt?: string
  modelRef?: { modelId?: string; diversity?: string; historyTurns?: number; toolCallModelId?: string }
  skills?: string[]
  tools?: string[]
  workflows?: string[]
  knowledges?: string[]
  memoriesSchema?: { name?: string; dataType?: string; description?: string; defaultValue?: string; duration?: string }[]
  conversation?: { autoFollowUp?: { enabled?: boolean; count?: number }; chitchatFallback?: { enabled?: boolean } }
  knowledgeAdvanced?: Record<string, { topK?: number; scoreThreshold?: number; mode?: string }>
  fallbackAgent?: string
  [key: string]: unknown
}

/** 只读挂载清单：注册表解析名称，失效项标记（mounts-health 只读保留）。 */
function ReadOnlyMounts({ title, ids, invalid, load }: {
  title: string; ids: string[]; invalid: string[]; load: () => Promise<{ id: string; name: string }[]>
}) {
  const [items, setItems] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (ids.length === 0) return
    load().then(setItems).catch(() => setItems([]))
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? id
  if (ids.length === 0) return null
  return (
    <div className="space-y-1">
      <Label className="text-xs">{title}</Label>
      {ids.map((id) => (
        <div key={id} className="flex items-center gap-1 text-xs">
          <span className="flex-1 truncate rounded border px-1 py-0.5" style={{ borderColor: CARD }}>{nameOf(id)}</span>
          {invalid.includes(id) && <span className="rounded bg-neutral-100 px-1 text-[10px]" style={{ color: "#F97E2B" }}>已失效</span>}
        </div>
      ))}
    </div>
  )
}

/** 旧 Agent（autonomous）只读详情（R-Archive：封存后仅展示，不再编辑/运行）。 */
function ArchivedAutonomousView({ agent }: { agent: AgentInfo }) {
  const cfg = (agent.config ?? {}) as AgentDraftConfig
  const [invalid, setInvalid] = useState<string[]>([])
  useEffect(() => {
    agentApi.mountsHealth(agent.id)
      .then((r) => setInvalid(r.items.filter((i) => !i.valid).map((i) => i.name)))
      .catch(() => undefined)
  }, [agent.id])
  const conv = cfg.conversation ?? {}
  const modelRef = cfg.modelRef ?? {}
  return (
    <div className="max-w-3xl space-y-4 overflow-y-auto p-6" data-testid="archived-agent-view">
      <div className="space-y-2">
        <Label className="text-xs">基本信息</Label>
        <div className="flex items-start gap-3">
          <img src={avatarFor(agent.id, agent.avatar)} alt="agent头像" className="size-20 rounded-md object-cover" />
          <div className="flex-1 space-y-1">
            <div className="text-sm font-medium" style={{ color: INK }}>{agent.name}</div>
            <div className="whitespace-pre-wrap text-xs" style={{ color: INK2 }}>{agent.description || "（无描述）"}</div>
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">角色能力描述</Label>
        <div className="min-h-10 whitespace-pre-wrap rounded border bg-neutral-50 p-2 text-xs" style={{ borderColor: CARD }}>
          {cfg.rolePrompt || "（空）"}
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">模型</Label>
        <div className="rounded border bg-neutral-50 px-2 py-1.5 text-xs" style={{ borderColor: CARD }}>
          {modelRef.modelId || "（未选择）"}
          <span className="pl-2 text-[11px]" style={{ color: INK3 }}>
            {`多样性 ${modelRef.diversity ?? "balanced"} · 历史轮次 ${modelRef.historyTurns ?? 5}`}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {(cfg.skills ?? []).length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs">技能说明</Label>
            {(cfg.skills ?? []).map((v, i) => (
              <div key={i} className="truncate rounded border px-1 py-0.5 text-xs" style={{ borderColor: CARD }}>{v}</div>
            ))}
          </div>
        )}
        <ReadOnlyMounts title="插件" ids={cfg.tools ?? []} invalid={invalid}
          load={() => resApi.registry("tool").then((r) => r.items)} />
        <ReadOnlyMounts title="工作流" ids={cfg.workflows ?? []} invalid={invalid}
          load={() => wfApi.list({ pageSize: 100 }).then((r) => r.items)} />
        <ReadOnlyMounts title="知识" ids={cfg.knowledges ?? []} invalid={invalid}
          load={() => resApi.registry("knowledge").then((r) => r.items)} />
        {(cfg.memoriesSchema ?? []).length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs">记忆 Schema</Label>
            {(cfg.memoriesSchema ?? []).map((m, i) => (
              <div key={i} className="truncate rounded border px-1 py-0.5 text-xs" style={{ borderColor: CARD }}>
                {`${m.name ?? "?"}（${m.dataType ?? "STRING"} · ${m.duration ?? "SESSION"}）`}
              </div>
            ))}
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">对话体验</Label>
          <div className="rounded border bg-neutral-50 px-2 py-1.5 text-xs" style={{ borderColor: CARD }}>
            {`自动续问 ${conv.autoFollowUp?.enabled ? `开（${conv.autoFollowUp.count ?? 3} 条）` : "关"} · 闲聊兜底 ${conv.chitchatFallback?.enabled ? "开" : "关"}`}
          </div>
        </div>
      </div>
      <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-600">
        该旧版 Agent 已封存，仅支持历史查询；配置与运行入口不再开放。
      </div>
    </div>
  )
}

/* ---------- 路由分发 ---------- */
export default function WfAgentEditorPage() {
  const { agentId = "" } = useParams()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [legacy, setLegacy] = useState(false)
  const [tab, setTab] = useState<"build" | "runs" | "eval" | "versions">("build")
  const vs = useAgentVersionState(agent && agent.type === "autonomous" ? agent.id : undefined)
  useEffect(() => {
    agentApi.get(agentId).then(setAgent).catch((e) => { if (String((e as Error).message).startsWith("404")) setLegacy(true) })
  }, [agentId])
  if (legacy) return <WfDesignerPage workflowId={agentId} />
  if (!agent) return <div className="p-8 text-sm" style={{ color: INK2 }}>加载中…</div>

  // 对话编排 / 专家组：画布只读（R-Archive：封存后不可编辑/发布，成员与节点仅查看）
  if (agent.type === "dialogue" || agent.type === "expert-group") {
    const avatar = avatarFor(agent.id, agent.avatar)
    return (
      <div className="h-[calc(100dvh-3.5rem)] min-h-0">
        <WfDesignerPage workflowId={agent.workflowId ?? agentId} agentId={agent.id}
          agentMeta={{ name: agent.name, typeLabel: agent.typeLabel, agentType: agent.type }}
          avatar={avatar} readOnly />
      </div>
    )
  }

  // 自主规划：四 Tab 壳层（SDD D-1；R-Archive 后搭建 Tab 为只读详情）
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b bg-white px-4" style={{ borderColor: CARD }}>
        <button onClick={() => navigate("/config/agents")}><ArrowLeft className="size-4" style={{ color: INK2 }} /></button>
        <img src={avatarFor(agent.id, agent.avatar)} alt="" className="size-6 rounded-md object-cover" />
        <span className="text-[15px] font-semibold" style={{ color: INK }}>{agent.name}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "#FFF4EA", color: "#F97E2B" }}>{agent.typeLabel}</span>
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-600">已封存 · 只读</span>
        <span className="rounded border px-1.5 py-0.5 text-[11px]" style={{ borderColor: CARD, color: INK2 }}>
          {vs.latest ? `V${vs.latest.versionNo}` : "草稿"}
        </span>
        {vs.envs.sandbox != null && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-600">沙箱 V{vs.envs.sandbox}</span>}
        {vs.envs.prod != null && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">线上 V{vs.envs.prod}</span>}
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg p-0.5" style={{ background: "#F1F3F7" }}>
          {([["build", "Agent搭建"], ["runs", "运行观测"], ["eval", "效果评测"], ["versions", "版本指标"]] as const).map(([k, label]) => (
            <button key={k} className="rounded-md px-3 py-1 text-[13px]"
              style={tab === k ? { background: "#fff", color: INK, boxShadow: "0 1px 3px rgba(31,35,41,.12)" } : { color: INK2 }}
              onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "build" && <ArchivedAutonomousView agent={agent} />}
        {tab === "runs" && <AgentRunsPanel agentId={agent.id} />}
        {tab === "eval" && <AgentEvalPanel agentId={agent.id} />}
        {tab === "versions" && (
          <div className="grid h-full grid-cols-2 divide-x" style={{ borderColor: CARD }}>
            <AgentVersionsPanel agentId={agent.id} />
            <AgentEvolutionPanel agentId={agent.id} />
          </div>
        )}
      </div>
    </div>
  )
}
