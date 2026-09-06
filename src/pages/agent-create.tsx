import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { PageContainer, PageHeader } from "@/components/app/page"
import { cn } from "@/lib/utils"
import { agentApi, wfApi } from "@/services/wf-api"
import { AVATARS, avatarFor } from "@/pages/wf-agents-list"

interface ModuleMeta {
  key: string; version: string; displayName: string; description: string;
  riskClass: string; providers: string[]; logicalTools: string[]; criteria: string[]
}

/** MTC-005：新建 Agent = 选择官方 Module 模板或空白模板 → 名称/头像/描述/模型 → 创建 → 详情。 */
export default function AgentCreatePage() {
  const navigate = useNavigate()
  const [modules, setModules] = useState<ModuleMeta[]>([])
  const [models, setModels] = useState<{ modelKey: string }[]>([])
  const [picked, setPicked] = useState<string | "">("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [avatar, setAvatar] = useState("")
  const [model, setModel] = useState("")
  const [creating, setCreating] = useState(false)

  useMemo(() => {
    agentApi.modules().then((r) => { setModules(r.items); }).catch(() => undefined)
    wfApi.models().then((r) => {
      const arr = Array.isArray(r) ? r : (r as { items?: { modelKey: string }[] }).items ?? []
      setModels(arr)
      if (arr[0]) setModel(arr[0].modelKey)
    }).catch(() => undefined)
  }, [])

  const create = async () => {
    if (!name.trim() || (!picked && picked !== "")) return
    setCreating(true)
    try {
      const mod = modules.find((m) => m.key === picked)
      const a = await agentApi.create({
        name: name.trim(),
        moduleKey: picked || "blank",
        moduleVersion: mod?.version,
        description: description.trim() || undefined,
        modelRef: model ? { modelId: model, provider: "openai-compatible" } : undefined,
      })
      toast.success(`已创建 Agent「${a.name}」`)
      navigate(`/agents/${a.id}`)
    } catch (e) {
      toast.error((e as Error).message || "创建失败")
    } finally { setCreating(false) }
  }

  return (
    <PageContainer className="max-w-4xl space-y-5">
      <PageHeader title="新建 Agent" description="选择官方 Module 模板或空白模板；创建后进入 Agent 详情继续搭建。" />
      <div className="grid gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => setPicked("")}
          className={cn(
            "rounded-lg border bg-surface p-4 text-left transition-colors",
            picked === "" ? "border-brand bg-brand-soft" : "hover:border-brand/50",
          )}
        >
          <div className="text-sm font-semibold">空白模板</div>
          <div className="mt-1 text-xs text-muted-foreground">从零开始定义执行目标与能力绑定</div>
        </button>
        {modules.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setPicked(m.key)}
            className={cn(
              "rounded-lg border bg-surface p-4 text-left transition-colors",
              picked === m.key ? "border-brand bg-brand-soft" : "hover:border-brand/50",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{m.displayName}</span>
              <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">{m.riskClass}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{m.description}</div>
            <div className="mt-2 text-[10px] text-muted-foreground">
              Module 内置能力：{m.logicalTools.slice(0, 3).join("、") || "—"}
            </div>
          </button>
        ))}
      </div>
      <div className="space-y-4 rounded-lg border bg-surface p-5">
        <div className="space-y-2">
          <Label htmlFor="agent-name">名称</Label>
          <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：热线质检员" />
        </div>
        <div className="space-y-2">
          <Label>头像</Label>
          <div className="flex flex-wrap gap-2">
            {AVATARS.slice(0, 10).map((a) => (
              <button
                key={a}
                type="button"
                aria-label={`选择头像 ${a}`}
                onClick={() => setAvatar(a)}
                className={cn("rounded-md border p-0.5", avatar === a ? "border-brand" : "border-transparent")}
              >
                <img src={a} alt="" className="size-8 rounded-md object-cover" />
              </button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">预览：{avatarFor("preview", avatar || null)}</div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-desc">描述</Label>
          <Textarea id="agent-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="该数字员工的职责与边界" />
        </div>
        <div className="space-y-2">
          <Label>模型</Label>
          <Select value={model || "__none__"} onValueChange={(v) => setModel(v === "__none__" ? "" : v)}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">暂不绑定</SelectItem>
              {models.map((m) => (
                <SelectItem key={m.modelKey} value={m.modelKey}>{m.modelKey}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end">
          <Button disabled={creating || !name.trim()} onClick={() => void create()}>创建并进入详情</Button>
        </div>
      </div>
    </PageContainer>
  )
}
