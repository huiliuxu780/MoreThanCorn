/** Agents 列表 — quickservice 复刻版（16 §8）。真 API（server/:8100）。 */
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useNavigate } from "react-router-dom"
import { ChevronDown, Plus, Search , Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { WF_BASE } from "@/services/wf-api"

export const AVATARS = Array.from({ length: 20 }, (_, i) => `/avatars/avatar-${i}.png`)

const INK2 = "#5A6472"
const INK3 = "#B9C2CF"
const ORANGE = "#F97E2B"

const TYPES = [
  { key: "autonomous", label: "自主规划 Agent", desc: "Agent具备自主思考与任务规划执行能力，适用于较为宽泛的会话场景" },
  { key: "dialogue", label: "对话编排 Agent", desc: "Agent严格按照人工编排的工作流进行对话，适用于较为严谨的会话场景" },
  { key: "expert-group", label: "编排 Agent 专家组", desc: "Agent专家组根据人工编排的流程进行协作，适用于稳定且复杂的业务流程" },
]

interface AgentRow { id: string; name: string; typeLabel: string; status: string; updatedAt: string; description?: string; avatar?: string | null }

export default function WfAgentsListPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [atype, setAtype] = useState("dialogue")
  const [creating, setCreating] = useState(false)

  const load = () => {
    setLoading(true)
    fetch(`${WF_BASE}/api/agents`).then((r) => r.json()).then((r: AgentRow[]) => { setRows(r); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const onCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    try {
      const a = await (await fetch(`${WF_BASE}/api/agents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), type: atype, description: "" }) })).json()
      setOpen(false)
      navigate(`/config/agents/${a.id}`)
    } finally {
      setCreating(false)
    }
  }
  const filtered = rows.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-5 p-6" style={{ background: "#F5F6FA", minHeight: "100%" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-4">
          <h1 className="text-lg font-semibold" style={{ color: "#1F2329" }}>我的Agent</h1>
          <span className="text-sm" style={{ color: INK2 }}>我的模板</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2 size-4" style={{ color: INK3 }} />
            <Input className="h-8 w-40 rounded-md bg-white pl-7" placeholder="搜索" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1 rounded-md bg-white">按更新时间 <ChevronDown className="size-3" /></Button>
          <Button variant="outline" size="sm" className="h-8 gap-1 rounded-md bg-white">全部 <ChevronDown className="size-3" /></Button>
          <Button size="sm" className="h-8 rounded-md bg-black text-white hover:bg-neutral-800" onClick={() => setOpen(true)}>
            <Plus className="size-4" /> 创建Agent
          </Button>
        </div>
      </div>


      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((w, i) => (
          <div
            key={w.id}
            role="button"
            tabIndex={0}
            className="group flex flex-col rounded-xl border bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md"
            style={{ borderColor: "#EDF0F4" }}
            onClick={() => navigate(`/config/agents/${w.id}`)}
          >
            <div className="flex items-start gap-3">
              <img src={w.avatar ?? AVATARS[i % AVATARS.length]} alt={w.name} className="size-14 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold" style={{ color: "#1F2329" }}>{w.name}</div>
                <span className="mt-1 inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[11px]" style={{ color: INK2 }}>{w.typeLabel}</span>
              </div>
            </div>
            <p className="line-clamp-2 pt-3 text-xs leading-5" style={{ color: INK2 }}>{w.description || "\u00A0"}</p>
            <div className="mt-auto flex items-center justify-between pt-4 text-[11px]">
              <span style={{ color: INK3 }}>更新时间： {new Date(w.updatedAt).toLocaleDateString("zh-CN")}</span>
              <button
                className="rounded p-1 opacity-0 transition-opacity hover:bg-neutral-100 group-hover:opacity-100"
                onClick={async (e) => {
                  e.stopPropagation()
                  if (!window.confirm(`删除 Agent「${w.name}」？`)) return
                  const r = await fetch(`${WF_BASE}/api/agents/${w.id}`, { method: "DELETE" })
                  if (r.ok) { toast.success("已删除"); load() } else toast.error((await r.json()).detail ?? "删除失败")
                }}
              ><Trash2 className="size-3.5 text-neutral-400" /></button>
              <span className="rounded px-1.5 py-0.5" style={w.status === "published" ? { background: "#F5F6FA", color: INK3 } : { background: "#FFF4EA", color: ORANGE }}>
                {w.status === "published" ? "已发布" : "未发布"}
              </span>
            </div>
          </div>
        ))}
      </div>
      {!loading && filtered.length === 0 && (
        <div className="py-20 text-center text-sm" style={{ color: INK3 }}>暂无 Agent，点击"创建Agent"开始</div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-xl">
          <DialogHeader><DialogTitle>创建Agent</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              {TYPES.map((t) => (
                <button key={t.key} className={`rounded-lg border p-2 text-left ${atype === t.key ? "border-neutral-800" : ""}`} style={{ borderColor: atype === t.key ? undefined : "#EDF0F4" }} onClick={() => setAtype(t.key)}>
                  <div className="text-sm font-medium" style={{ color: "#1F2329" }}>{t.label}</div>
                  <div className="pt-0.5 text-[11px]" style={{ color: INK3 }}>{t.desc}</div>
                </button>
              ))}
            </div>
            <Input placeholder="名称（必填）" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button className="bg-black text-white hover:bg-neutral-800" disabled={creating || !name.trim()} onClick={onCreate}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
