/** 自定义角色配置子页（09-07）：角色配置 Markdown + 模型 + 核心能力 + 技能挂载；保存走乐观锁。 */
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { agentApi, wfApi, type AgentInfo } from "@/services/wf-api"
import { resApi } from "@/services/resource-api"
const PERM_LABELS: [string, string][] = [
  ["shell", "Shell 命令（Bash）"],
  ["file_write", "文件写入（Write/Edit）"],
  ["file_read", "文件读取与检索（Read/Grep/Glob）"],
  ["schedule", "调度管理（Schedule 四件）"],
  ["subagent", "子 Agent 与团队（AgentCreate/Team…）"],
  ["platform_tools", "平台工具（run_workflow/run_agent_flow）"],
]
const DEFAULT_PERMS: Record<string, boolean> = {
  shell: true, file_write: true, file_read: true,
  schedule: true, subagent: true, platform_tools: true,
}
import { cn } from "@/lib/utils"

interface Cfg {
  rolePrompt?: string; skills?: string[]; capabilities?: { name: string; description: string }[];
  modelRef?: { modelId?: string; params?: Record<string, unknown> }
  permissions?: Record<string, boolean>
}

export function CustomAgentConfig({ agent }: { agent: AgentInfo }) {
  const cfg = (agent.config ?? {}) as Cfg
  const [prompt, setPrompt] = useState(cfg.rolePrompt ?? "")
  const [caps, setCaps] = useState<{ name: string; description: string }[]>(cfg.capabilities ?? [])
  const [skills, setSkills] = useState<string[]>(cfg.skills ?? [])
  const [model, setModel] = useState(cfg.modelRef?.modelId ?? "")
  const [thinking, setThinking] = useState(cfg.modelRef?.params?.thinking_enable === true)
  const [thinkingBudget, setThinkingBudget] = useState<number | "">(
    typeof cfg.modelRef?.params?.thinking_budget === "number" ? (cfg.modelRef.params.thinking_budget as number) : "",
  )
  const [models, setModels] = useState<{ modelKey: string; capabilities?: string[] }[]>([])
  const [skillOpts, setSkillOpts] = useState<{ id: string; name: string }[]>([])
  const [perms, setPerms] = useState<Record<string, boolean>>({
    ...DEFAULT_PERMS,
    ...(((agent.config as Cfg).permissions as Record<string, boolean> | undefined) ?? {}),
  })
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
        config: {
          ...(agent.config as object), rolePrompt: prompt, capabilities: caps, skills,
          // thinking 开关写入 modelRef.params：发布时经白名单冻结进 release 快照（frozen_model_params）
          permissions: perms,
          modelRef: {
            modelId: model,
            params: {
              ...(cfg.modelRef?.params ?? {}),
              thinking_enable: thinking,
              ...(thinking && thinkingBudget !== "" ? { thinking_budget: thinkingBudget } : {}),
            },
          },
        },
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
        <div className="flex items-center gap-3 pt-2">
          <Switch
            checked={thinking}
            disabled={!!model && !(models.find((m) => m.modelKey === model)?.capabilities ?? []).includes("thinking")}
            onCheckedChange={setThinking}
            aria-label="深度思考"
          />
          <Label className="text-sm">深度思考</Label>
          {thinking && (
            <Input
              type="number" min={1} className="h-8 w-32" placeholder="思考预算 token（可选）"
              value={thinkingBudget}
              onChange={(e) => setThinkingBudget(e.target.value === "" ? "" : Number(e.target.value))}
            />
          )}
        </div>
        <p className="text-[11px] text-(--text-tertiary)">
          开启后模型回复携带推理过程（对话页以「深度思考」折叠块展示）；发布时冻结进版本快照，需重新发布生效。
          {model && !(models.find((m) => m.modelKey === model)?.capabilities ?? []).includes("thinking")
            ? "当前所选模型不支持深度思考。" : ""}
        </p>
      </div>
      <div className="space-y-2 rounded-lg border bg-surface p-4">
        <Label>能力与权限（发布时冻结进版本快照）</Label>
        {PERM_LABELS.map(([key, label]) => (
          <div key={key} className="flex items-center gap-2">
            <Switch
              checked={perms[key] !== false}
              onCheckedChange={(v) => setPerms((cur) => ({ ...cur, [key]: v }))}
              aria-label={label}
            />
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        ))}
        <p className="text-[11px] text-(--text-tertiary)">关闭后该工具族不装配进 Agent，模型感知为无此能力；需重新发布生效。</p>
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
