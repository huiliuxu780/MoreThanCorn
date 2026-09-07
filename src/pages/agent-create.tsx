/** 新建 Agent（09-07 重设计，原站 recruitment-market 同构）：
 *  预置 Module 模板卡 + 【自定义角色】对话框（头像、名称、职责、角色配置三 tab：智能生成/上传 Markdown/手动填写、Skills、模型）。
 *  旧"空白模板"假按钮退役（moduleKey=blank 必失败）。 */
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Paperclip, Sparkles, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FilePicker } from "@/components/ui/file-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { PageContainer, PageHeader } from "@/components/app/page"
import { cn } from "@/lib/utils"
import { AVATARS, avatarFor } from "@/lib/agent-avatar"
import { agentApi, wfApi } from "@/services/wf-api"
import { resApi } from "@/services/resource-api"

interface ModuleMeta {
  key: string; version: string; displayName: string; description: string;
  riskClass: string; providers: string[]; logicalTools: string[]; criteria: string[]
}
interface SkillOpt { id: string; name: string }

export default function AgentCreatePage() {
  const navigate = useNavigate()
  const [modules, setModules] = useState<ModuleMeta[]>([])
  const [models, setModels] = useState<{ modelKey: string }[]>([])
  const [picked, setPicked] = useState<string>("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [avatar, setAvatar] = useState("")
  const [model, setModel] = useState("")
  const [creating, setCreating] = useState(false)

  // 自定义角色对话框状态
  const [customOpen, setCustomOpen] = useState(false)
  const [cName, setCName] = useState("")
  const [cDesc, setCDesc] = useState("")
  const [cAvatar, setCAvatar] = useState("")
  const [cPrompt, setCPrompt] = useState("")
  const [cSkills, setCSkills] = useState<string[]>([])
  const [cModel, setCModel] = useState("")
  const [skillOpts, setSkillOpts] = useState<SkillOpt[]>([])
  const [drafting, setDrafting] = useState(false)
  const [cCreating, setCCreating] = useState(false)

  useMemo(() => {
    agentApi.modules().then((r) => { setModules(r.items); }).catch(() => undefined)
    wfApi.models().then((r) => {
      const arr = Array.isArray(r) ? r : (r as { items?: { modelKey: string }[] }).items ?? []
      setModels(arr)
      if (arr[0]) { setModel(arr[0].modelKey); setCModel(arr[0].modelKey) }
    }).catch(() => undefined)
    resApi.registry("skill", false).then((r) => setSkillOpts(r.items.map((s) => ({ id: s.id, name: s.name })))).catch(() => undefined)
  }, [])

  const create = async () => {
    if (!name.trim() || !picked) return
    setCreating(true)
    try {
      const mod = modules.find((m) => m.key === picked)
      const a = await agentApi.create({
        name: name.trim(),
        moduleKey: picked,
        moduleVersion: mod?.version,
        description: description.trim() || undefined,
        avatar: avatar || undefined,
        modelRef: model ? { modelId: model, provider: "openai-compatible" } : undefined,
      })
      toast.success(`已创建 Agent「${a.name}」`)
      navigate(`/agents/${a.id}`)
    } catch (e) {
      toast.error((e as Error).message || "创建失败")
    } finally { setCreating(false) }
  }

  const createCustom = async () => {
    if (!cName.trim() || !cDesc.trim()) { toast.error("角色名称与职责描述必填"); return }
    setCCreating(true)
    try {
      const a = await agentApi.create({
        type: "custom",
        name: cName.trim(),
        description: cDesc.trim(),
        avatar: cAvatar || undefined,
        rolePrompt: cPrompt,
        skills: cSkills,
        modelRef: cModel ? { modelId: cModel } : undefined,
      } as Parameters<typeof agentApi.create>[0])
      toast.success(`已创建自定义角色「${a.name}」`)
      navigate(`/agents/${a.id}`)
    } catch (e) {
      toast.error((e as Error).message || "创建失败")
    } finally { setCCreating(false) }
  }

  const draft = async () => {
    if (!cName.trim() || !cDesc.trim()) { toast.error("先填写角色名称与职责描述"); return }
    setDrafting(true)
    try {
      const r = await agentApi.draftRole({ name: cName.trim(), description: cDesc.trim() })
      setCPrompt(r.rolePrompt)
      toast.success("已生成角色配置，可继续手动修改")
    } catch (e) {
      toast.error((e as Error).message || "生成失败")
    } finally { setDrafting(false) }
  }

  const readMd = (f: File) => {
    if (!/\.md$/i.test(f.name)) { toast.error("仅支持 .md 文件"); return }
    f.text().then((t) => { setCPrompt(t); toast.success(`已载入 ${f.name}`) })
  }

  return (
    <PageContainer className="max-w-4xl space-y-5">
      <PageHeader title="新建 Agent" description="选择适合工作场景的预置 Module 模板；若没有合适的角色，创建自定义角色。" />
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCustomOpen(true)}>
        <UserPlus className="size-4" /> 自定义角色
      </Button>
      <div className="grid gap-3 md:grid-cols-2">
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
          <Label>预置模板 <span className="text-(--status-danger)">*</span></Label>
          <p className="text-xs text-(--text-tertiary)">
            {picked ? `已选：${modules.find((m) => m.key === picked)?.displayName}` : "请在上方卡片中选择一个 Module 模板，或改用自定义角色。"}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-name">名称</Label>
          <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：热线质检员" />
        </div>
        <div className="space-y-2">
          <Label>头像</Label>
          <div className="grid w-fit grid-cols-8 gap-2">
            {AVATARS.map((a) => (
              <button
                key={a}
                type="button"
                aria-label={`选择头像 ${a}`}
                onClick={() => setAvatar(a)}
                className={cn("rounded-full border-2 p-0.5", avatar === a ? "border-brand" : "border-transparent")}
              >
                <img src={a} alt="" className="size-10 rounded-full object-cover" />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            预览：<img src={avatarFor("preview", avatar || null)} alt="" className="size-8 rounded-full object-cover" />
          </div>
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
          <Button disabled={creating || !name.trim() || !picked} onClick={() => void create()}>创建并进入详情</Button>
        </div>
      </div>

      {/* 自定义角色对话框（原站【自定义 Waker】同构） */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>自定义角色</DialogTitle>
            <p className="text-xs text-muted-foreground">这里创建的是从 0 开始的自定义角色；保存后可在对话中直接使用，并继续补充技能与记忆。</p>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <img src={avatarFor("custom-preview", cAvatar || null)} alt="" className="size-14 rounded-full object-cover" />
              <div className="grid flex-1 grid-cols-8 gap-1.5">
                {AVATARS.map((a) => (
                  <button key={a} type="button" aria-label={`选择头像 ${a}`} onClick={() => setCAvatar(a)}
                    className={cn("rounded-full border-2 p-0.5", cAvatar === a ? "border-brand" : "border-transparent")}>
                    <img src={a} alt="" className="size-8 rounded-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>角色名称 <span className="text-(--status-danger)">*</span></Label>
              <Input value={cName} maxLength={20} onChange={(e) => setCName(e.target.value)} placeholder="例如：数据分析师、客服主管" />
            </div>
            <div className="space-y-1.5">
              <Label>它主要负责什么？ <span className="text-(--status-danger)">*</span></Label>
              <Textarea value={cDesc} onChange={(e) => setCDesc(e.target.value)}
                placeholder={"出现在角色卡片上，30-80 字最佳，回答“你是谁、解决什么类型的问题”。"} />
            </div>
            <Tabs defaultValue="gen">
              <TabsList>
                <TabsTrigger value="gen">智能生成</TabsTrigger>
                <TabsTrigger value="md">上传 Markdown</TabsTrigger>
                <TabsTrigger value="manual">手动填写</TabsTrigger>
              </TabsList>
              <TabsContent value="gen" className="space-y-2">
                <Button size="sm" variant="outline" className="gap-1.5" disabled={drafting} onClick={() => void draft()}>
                  <Sparkles className="size-3.5" /> {drafting ? "生成中…" : "生成配置"}
                </Button>
                <p className="text-[11px] text-(--text-tertiary)">填写角色名称和职责描述后生成配置；生成结果落入下方角色配置，可继续修改。</p>
              </TabsContent>
              <TabsContent value="md">
                <FilePicker ariaLabel="上传角色配置 Markdown" accept=".md" onPick={readMd}>
                  <span className="flex items-center gap-1.5 text-xs"><Paperclip className="size-3.5" /> 选择 .md 文件</span>
                </FilePicker>
              </TabsContent>
              <TabsContent value="manual">
                <p className="text-[11px] text-(--text-tertiary)">直接在下方角色配置中编写 Markdown（# 角色：/## 目标：/## 技能：/## 限制：）。</p>
              </TabsContent>
            </Tabs>
            <div className="space-y-1.5">
              <Label>角色配置</Label>
              <Textarea value={cPrompt} onChange={(e) => setCPrompt(e.target.value)} className="min-h-40 font-mono text-xs"
                placeholder={"# 角色：\n## 目标：\n## 技能：\n## 限制："} />
            </div>
            <div className="space-y-1.5">
              <Label>技能（{cSkills.length}）</Label>
              {skillOpts.length === 0
                ? <p className="text-[11px] text-(--text-tertiary)">技能市场暂无 Skill，可创建后在 Skill 子页上传。</p>
                : (
                  <div className="flex flex-wrap gap-1.5">
                    {skillOpts.map((s) => (
                      <button key={s.id} type="button"
                        onClick={() => setCSkills((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
                        className={cn("rounded-md border px-2 py-1 text-xs transition-colors",
                          cSkills.includes(s.id) ? "border-brand bg-brand-soft text-foreground" : "text-muted-foreground hover:border-brand/50")}>
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
            </div>
            <div className="space-y-1.5">
              <Label>模型</Label>
              <Select value={cModel || "__none__"} onValueChange={(v) => setCModel(v === "__none__" ? "" : v)}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">暂不绑定（对话时用平台默认）</SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.modelKey} value={m.modelKey}>{m.modelKey}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCustomOpen(false)}>取消</Button>
              <Button disabled={cCreating} onClick={() => void createCustom()}>创建角色</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
