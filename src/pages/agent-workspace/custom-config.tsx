/** 自定义角色配置子页（09-07）：角色配置 Markdown + 模型 + 核心能力 + 技能挂载；保存走乐观锁。 */
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { agentApi, wfApi, type AgentInfo } from "@/services/wf-api"
import { resApi } from "@/services/resource-api"
import { cn } from "@/lib/utils"

interface Cfg {
  rolePrompt?: string; skills?: string[]; capabilities?: { name: string; description: string }[];
  modelRef?: { modelId?: string }
}

export function CustomAgentConfig({ agent }: { agent: AgentInfo }) {
  const cfg = (agent.config ?? {}) as Cfg
  const [prompt, setPrompt] = useState(cfg.rolePrompt ?? "")
  const [caps, setCaps] = useState<{ name: string; description: string }[]>(cfg.capabilities ?? [])
  const [skills, setSkills] = useState<string[]>(cfg.skills ?? [])
  const [model, setModel] = useState(cfg.modelRef?.modelId ?? "")
  const [models, setModels] = useState<{ modelKey: string }[]>([])
  const [skillOpts, setSkillOpts] = useState<{ id: string; name: string }[]>([])
  const [revision, setRevision] = useState(agent.configRevision)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    wfApi.models().then((r) => setModels(Array.isArray(r) ? r : (r as { items?: { modelKey: string }[] }).items ?? [])).catch(() => undefined)
    resApi.registry("skill", false).then((r) => setSkillOpts(r.items.map((s) => ({ id: s.id, name: s.name })))).catch(() => undefined)
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const r = await agentApi.update(agent.id, {
        config: { ...(agent.config as object), rolePrompt: prompt, capabilities: caps, skills, modelRef: { modelId: model } },
      }, revision)
      setRevision(r.configRevision)
      toast.success("已保存")
    } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium leading-6">自定义角色配置</h3>
        <Button size="sm" disabled={saving} onClick={() => void save()}>保存</Button>
      </div>
      <div className="space-y-1.5 rounded-lg border bg-surface p-4">
        <Label>角色配置（Markdown）</Label>
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-56 font-mono text-xs"
          placeholder={"# 角色：\n## 目标：\n## 技能：\n## 限制："} />
        <p className="text-[11px] text-(--text-tertiary)">该配置作为对话 system prompt 的角色主体。</p>
      </div>
      <div className="space-y-1.5 rounded-lg border bg-surface p-4">
        <Label>模型</Label>
        <Select value={model || "__none__"} onValueChange={(v) => setModel(v === "__none__" ? "" : v)}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">平台默认</SelectItem>
            {models.map((m) => <SelectItem key={m.modelKey} value={m.modelKey}>{m.modelKey}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5 rounded-lg border bg-surface p-4">
        <Label>核心能力（概览页展示）</Label>
        {caps.map((c, i) => (
          <div key={i} className="flex gap-2">
            <Input value={c.name} placeholder="能力名" className="w-40"
              onChange={(e) => setCaps((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <Input value={c.description} placeholder="一句话描述"
              onChange={(e) => setCaps((s) => s.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2" aria-label="删除该能力"
              onClick={() => setCaps((s) => s.filter((_, j) => j !== i))}>删除</Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setCaps((s) => [...s, { name: "", description: "" }])}>添加能力</Button>
      </div>
      <div className="space-y-1.5 rounded-lg border bg-surface p-4">
        <Label>技能（{skills.length}）</Label>
        {skillOpts.length === 0
          ? <p className="text-[11px] text-(--text-tertiary)">技能市场暂无 Skill；可在 Skill 子页上传后再回来挂载。</p>
          : (
            <div className="flex flex-wrap gap-1.5">
              {skillOpts.map((s) => (
                <button key={s.id} type="button"
                  onClick={() => setSkills((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
                  className={cn("rounded-md border px-2 py-1 text-xs transition-colors",
                    skills.includes(s.id) ? "border-brand bg-brand-soft text-foreground" : "text-muted-foreground hover:border-brand/50")}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
      </div>
    </div>
  )
}
