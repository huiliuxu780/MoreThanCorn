/** Agent 档案子页（09-16 合并版；用户指认「配置和档案重叠，去看看 QoderWake」）。
 *  原站活体实测(19830)：/wakers/<id>/settings = 「Waker 档案」页本体，导航无独立「配置」；
 *  三段 = 角色摘要（修改→名称/头像/简介）+ 角色源文件（identity/persona/bible：查看→
 *  真实内容渲染、编辑）+ 角色管理（删除；我方=归档，历史只读保留）。
 *  平台扩展段（真实能力，原站无对应位）：模型与推理（新 Session 默认模型）、Module 冻结
 *  资产、能力挂载。六工具族开关→「安全与权限」页；发布/对比→「发布治理」页。
 *  字段唯一编辑入口：名称+头像+核心能力=修改对话框；描述=identity.md；config.persona=
 *  persona.md；业务定位 spec.purpose(module)/rolePrompt(custom)=bible.md；modelRef=模型段。
 *  编译预览复刻后端 compile_system_prompt 规则（分区标签 + module instructions 追加）。 */
import * as React from "react"
import { useNavigate } from "react-router-dom"
import { FileText, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Markdown } from "@/components/chat/markdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { FilePicker } from "@/components/ui/file-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { AVATARS, avatarFor } from "@/lib/agent-avatar"
import { cn } from "@/lib/utils"
import { agentApi, wfApi, type AgentInfo } from "@/services/wf-api"

export interface MountRow { kind: string; name?: string; ref?: string; status?: string; valid?: boolean; version?: string | null }

interface ModuleMeta {
  key: string; version: string; displayName: string; providers: string[]; logicalTools: string[]
  criteria: string[]; defaultInstructions?: string
  inputSchema?: { required?: string[]; properties?: Record<string, unknown> }
  outputSchema?: Record<string, unknown>
}

type SourceKey = "identity" | "persona" | "bible"
type Caps = { name: string; description: string }[]

const SOURCE_KEYS: SourceKey[] = ["identity", "persona", "bible"]
const SOURCE_HINT: Record<SourceKey, string> = {
  identity: "职责与边界 · 『我负责什么』的主要来源",
  persona: "人格、沟通方式与反模式 · 『我工作的原则』的主要来源",
  bible: "执行流程、审批规则与完成标准 · 『工作原则』的来源",
}

export function AgentProfileSection({ agent, archived, onSaved }: {
  agent: AgentInfo; archived?: boolean; onSaved?: () => void
}) {
  const navigate = useNavigate()
  const cfg = (agent.config ?? {}) as Record<string, unknown>
  const isModule = Boolean(agent.moduleKey)

  const [meta, setMeta] = React.useState<ModuleMeta | null>(null)
  const [models, setModels] = React.useState<{ modelKey: string; capabilities?: string[] }[]>([])
  const [mounts, setMounts] = React.useState<MountRow[]>([])
  const [busy, setBusy] = React.useState(false)

  // 修改对话框（名称/头像/核心能力）
  const [editOpen, setEditOpen] = React.useState(false)
  const [eName, setEName] = React.useState("")
  const [eAvatar, setEAvatar] = React.useState<string | null>(null)
  const [eCaps, setECaps] = React.useState<Caps>([])

  // 源文件对话框
  const [srcKey, setSrcKey] = React.useState<SourceKey | null>(null)
  const [srcEditing, setSrcEditing] = React.useState(false)
  const [srcDraft, setSrcDraft] = React.useState("")
  const [purposeDraft, setPurposeDraft] = React.useState("")
  const [previewOpen, setPreviewOpen] = React.useState(false)

  // 模型与推理
  const [modelId, setModelId] = React.useState("")
  const [thinking, setThinking] = React.useState(false)
  const [budget, setBudget] = React.useState<number | "">("")

  const [delOpen, setDelOpen] = React.useState(false)

  React.useEffect(() => {
    agentApi.mountsHealth(agent.id).then((r) => setMounts((r.items as MountRow[]) ?? [])).catch(() => setMounts([]))
  }, [agent.id])
  React.useEffect(() => {
    if (agent.moduleKey) {
      agentApi.modules().then((r) => setMeta(r.items.find((m) => m.key === agent.moduleKey) ?? null)).catch(() => undefined)
    }
    wfApi.models()
      .then((r) => setModels(Array.isArray(r) ? r : (r as { items?: { modelKey: string; capabilities?: string[] }[] }).items ?? []))
      .catch(() => undefined)
  }, [agent.id, agent.moduleKey])
  React.useEffect(() => {
    const c = (agent.config ?? {}) as Record<string, unknown>
    const mref = (c.modelRef ?? {}) as { modelId?: string; params?: Record<string, unknown> }
    setModelId(mref.modelId ?? "")
    setThinking(mref.params?.thinking_enable === true)
    const b = mref.params?.thinking_budget
    setBudget(typeof b === "number" ? b : "")
  }, [agent.configRevision, agent.id, agent.config])

  // ---- 真实字段读取（单一事实来源，无合成占位） ----
  const personaText = typeof cfg.persona === "string" ? cfg.persona : ""
  const purpose = String(((cfg.spec as Record<string, unknown>) ?? {}).purpose ?? "")
  const rolePrompt = typeof cfg.rolePrompt === "string" ? cfg.rolePrompt : ""
  const caps = ((cfg.capabilities as Caps) ?? [])

  const bibleContent = isModule
    ? `${meta?.defaultInstructions ?? "（Module 未加载）"}${purpose ? `\n\n## 本实例业务定位\n${purpose}` : ""}`
    : rolePrompt
  const contentFor = (k: SourceKey) =>
    k === "identity" ? (agent.description || "") : k === "persona" ? personaText : bibleContent

  const save = async (patch: Record<string, unknown>, okMsg = "已保存") => {
    setBusy(true)
    try {
      await agentApi.update(agent.id, patch, agent.configRevision)
      toast.success(okMsg)
      setEditOpen(false)
      setSrcEditing(false)
      onSaved?.()
    } catch (e) {
      toast.error((e as Error).message)
    } finally { setBusy(false) }
  }

  const openEdit = () => {
    setEName(agent.name); setEAvatar(agent.avatar ?? null); setECaps(caps.map((c) => ({ ...c })))
    setEditOpen(true)
  }
  const saveEdit = () => void save({
    name: eName, avatar: eAvatar,
    config: { ...cfg, capabilities: eCaps },
  })

  const openSource = (k: SourceKey) => {
    setSrcDraft(k === "identity" ? (agent.description || "") : k === "persona" ? personaText : rolePrompt)
    setPurposeDraft(purpose)
    setSrcEditing(false)
    setSrcKey(k)
  }
  const saveSource = () => {
    if (srcKey === "identity") return void save({ description: srcDraft })
    if (srcKey === "persona") return void save({ config: { ...cfg, persona: srcDraft } })
    if (isModule) {
      return void save({ config: { ...cfg, spec: { ...((cfg.spec as Record<string, unknown>) ?? {}), purpose: purposeDraft } } })
    }
    return void save({ config: { ...cfg, rolePrompt: srcDraft } })
  }

  /** 复刻后端 compile_system_prompt（草稿口径）：persona 分区 + module instructions 追加；
   *  custom 的 rolePrompt 在存在其他分区时以 <identity> 并入，否则原文即全文。 */
  const compilePreview = () => {
    const p = (srcKey === "persona" && srcEditing ? srcDraft : personaText).trim()
    const parts: string[] = []
    if (p) parts.push(`<persona>\n${p}\n</persona>`)
    if (isModule) {
      const instr = meta?.defaultInstructions ?? ""
      const pur = (srcKey === "bible" && srcEditing ? purposeDraft : purpose).trim()
      const full = pur ? `${instr}\n\n## 本实例业务定位\n${pur}` : instr
      if (full.trim()) parts.push(full)
    } else {
      const rp = (srcKey === "bible" && srcEditing ? srcDraft : rolePrompt).trim()
      if (rp) {
        if (!parts.length) parts.push(rp)
        else parts.unshift(`<identity>\n${rp}\n</identity>`)
      }
    }
    return parts.join("\n\n") || "You are a helpful assistant."
  }

  const saveModel = () => void save({
    config: {
      ...cfg,
      modelRef: {
        ...((cfg.modelRef as Record<string, unknown>) ?? {}), modelId,
        params: {
          ...(((cfg.modelRef as { params?: Record<string, unknown> }) ?? {}).params ?? {}),
          thinking_enable: thinking,
          ...(thinking && budget !== "" ? { thinking_budget: budget } : {}),
        },
      },
    },
  }, "已保存；对运行生效需重新发布")

  const archive = async () => {
    setBusy(true)
    try {
      await agentApi.update(agent.id, { archived: true })
      toast.success("已归档；历史数据保留，仅支持历史查询")
      setDelOpen(false)
      navigate("/agents")
    } catch (e) {
      toast.error((e as Error).message)
    } finally { setBusy(false) }
  }

  const thinkingSupported = !modelId || (models.find((m) => m.modelKey === modelId)?.capabilities ?? []).includes("thinking")
  const inputProps = Object.keys((meta?.inputSchema?.properties ?? {}) as object)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h2 className="text-[28px] font-semibold leading-[38px]">Agent 档案</h2>
        <p className="mt-1 text-sm text-muted-foreground">查看并管理此 Agent 的资料。</p>
      </div>

      {/* 角色摘要（原站同构：头像+名称+个人简介+修改） */}
      <section className="rounded-lg border bg-surface p-4">
        <div className="flex items-start gap-3">
          <img src={avatarFor(agent.id, eAvatar !== null && editOpen ? eAvatar : agent.avatar)} alt="avatar"
            className="size-12 shrink-0 rounded-full object-cover" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold">{agent.name}</h3>
              <Badge variant="secondary" className="shrink-0 text-[10px]">{agent.typeLabel}</Badge>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">个人简介</div>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
              {agent.description || "（尚未填写——在 identity.md「查看 → 编辑」中补充）"}
            </p>
            {caps.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {caps.filter((c) => c.name).map((c, i) => (
                  <span key={i} className="rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground" title={c.description}>
                    {c.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          {!archived && (
            <Button variant="outline" size="sm" className="shrink-0" onClick={openEdit}>修改</Button>
          )}
        </div>
      </section>

      {/* 角色源文件（原站同构：三份文件 查看→真实内容+编辑） */}
      <section className="rounded-lg border bg-surface p-4">
        <h3 className="text-sm font-semibold">角色源文件</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          system_prompt 的三份编译来源；保存写入配置草稿，重新发布后对运行生效。
        </p>
        <div className="mt-3 space-y-2">
          {SOURCE_KEYS.map((k) => {
            const content = contentFor(k)
            return (
              <div key={k} className="rounded-md border px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-mono text-xs font-medium">{k}.md</span>
                  <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">{SOURCE_HINT[k]}</span>
                  <Button variant="outline" size="sm" className="ml-auto h-7 shrink-0" onClick={() => openSource(k)}>
                    查看
                  </Button>
                </div>
                <p className="mt-1.5 line-clamp-2 pl-[22px] text-xs text-muted-foreground">
                  {content.trim() ? content.trim().replace(/\s+/g, " ").slice(0, 120) : "（未填写）"}
                </p>
              </div>
            )
          })}
        </div>
      </section>

      {/* 模型与推理（平台扩展：新 Session 默认模型；原站模型在对话内选择，我方按 Agent 绑定） */}
      <section className="rounded-lg border bg-surface p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">模型与推理</h3>
          <span className="text-[11px] text-muted-foreground">
            新 Session 默认模型{isModule ? "；发布时随版本冻结，需重新发布生效" : ""}
          </span>
          {!archived && (
            <Button size="sm" variant="outline" className="ml-auto shrink-0" disabled={busy} onClick={saveModel}>
              保存
            </Button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Select value={modelId || "__default__"} onValueChange={(v) => setModelId(v === "__default__" ? "" : v)} disabled={archived}>
            <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">平台默认</SelectItem>
              {models.map((m, i) => <SelectItem key={`${m.modelKey}-${i}`} value={m.modelKey}>{m.modelKey}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Switch checked={thinking} disabled={archived || !thinkingSupported}
              onCheckedChange={setThinking} aria-label="深度思考" />
            <span className="text-xs text-muted-foreground">深度思考</span>
            {thinking && (
              <Input type="number" min={1} className="h-8 w-36" placeholder="思考预算 token（可选）"
                value={budget} disabled={archived}
                onChange={(e) => setBudget(e.target.value === "" ? "" : Number(e.target.value))} />
            )}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          开启后回复携带推理过程（对话页以「深度思考」折叠块展示）；发布时冻结进版本快照。
          {!thinkingSupported ? "当前所选模型不支持深度思考。" : ""}
        </p>
      </section>

      {/* Module 冻结资产（module 型专属，只读；由 Module 版本管理） */}
      {isModule && (
        <section className="rounded-lg border bg-surface p-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Module 冻结资产</h3>
            <Badge variant="outline" className="text-[10px]">代码版本管理 · 只读</Badge>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[
              { t: "逻辑工具", d: `${(meta?.logicalTools ?? []).length} 个` },
              { t: "输入 Schema", d: `${inputProps.length} 字段 · ${(meta?.inputSchema?.required ?? []).length} 必填` },
              { t: "输出 Schema", d: meta?.outputSchema ? "已冻结" : "—" },
              { t: "Provider 实现", d: (meta?.providers ?? []).join(" / ") || "—" },
            ].map((x) => (
              <div key={x.t} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div>
                  <b className="block text-[12px]">{x.t}</b>
                  <small className="block text-[10px] text-muted-foreground">{x.d}</small>
                </div>
                <Badge variant="outline" className="text-[10px]">已冻结</Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 能力挂载（平台扩展：真实冻结清单） */}
      <section className="rounded-lg border bg-surface p-4">
        <h3 className="text-sm font-semibold">能力挂载（真实冻结清单）</h3>
        {mounts.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">暂无挂载（Skill / 连接器 / 知识库 / 工具）。</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {mounts.map((m, i) => (
              <Badge key={i} variant={m.valid === false ? "outline" : "secondary"}>
                {m.kind}·{String(m.name ?? m.ref ?? "").slice(0, 20)}
                {m.valid === false ? "（无效）" : ""}
              </Badge>
            ))}
          </div>
        )}
      </section>

      {/* 角色管理（原站=删除 Waker；我方=归档，历史只读保留） */}
      {!archived && (
        <section className="rounded-lg border border-destructive/40 bg-surface p-4">
          <h3 className="text-sm font-semibold text-destructive">角色管理</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            归档后该 Agent 退出产品运行面（列表/选择器/新建任务不再出现），历史运行与版本只读保留。
          </p>
          <Button variant="outline" size="sm" className="mt-2 text-destructive" onClick={() => setDelOpen(true)}>
            <Trash2 className="size-3.5" /> 归档 Agent
          </Button>
        </section>
      )}

      {/* 修改对话框（原站「编辑 Waker」同构：头像/名称；核心能力为平台扩展） */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑 Agent</DialogTitle>
            <DialogDescription>职责描述请在 identity.md 中编辑；此处管理基础资料。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <img src={avatarFor(agent.id, eAvatar)} alt="avatar" className="size-14 shrink-0 rounded-full object-cover" />
              <div>
                <FilePicker ariaLabel="上传头像" accept="image/*" onPick={(f) => {
                  const reader = new FileReader()
                  reader.onload = () => setEAvatar(String(reader.result))
                  reader.readAsDataURL(f)
                }}>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Upload className="size-3.5" /> 上传头像
                  </span>
                </FilePicker>
                <div className="mt-2 grid grid-cols-5 gap-1.5">
                  {AVATARS.map((a) => (
                    <button key={a} type="button" aria-label={`选择头像 ${a}`} onClick={() => setEAvatar(a)}
                      className={cn("rounded-full border-2 p-0.5", eAvatar === a ? "border-brand" : "border-transparent")}>
                      <img src={a} alt="" className="size-7 rounded-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">名称</Label>
              <Input value={eName} maxLength={20} onChange={(e) => setEName(e.target.value)} placeholder="请输入 Agent 名称" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">核心能力（概览页展示）</Label>
              {eCaps.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={c.name} placeholder="能力名" className="w-40"
                    onChange={(e) => setECaps((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <Input value={c.description} placeholder="一句话描述"
                    onChange={(e) => setECaps((s) => s.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                  <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2" aria-label="删除该能力"
                    onClick={() => setECaps((s) => s.filter((_, j) => j !== i))}>删除</Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setECaps((s) => [...s, { name: "", description: "" }])}>
                添加能力
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button disabled={busy || !eName.trim()} onClick={saveEdit}>{busy ? "保存中…" : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 源文件对话框：查看=真实内容渲染；编辑=对应字段唯一入口 */}
      <Dialog open={srcKey !== null} onOpenChange={(o) => { if (!o) { setSrcKey(null); setSrcEditing(false) } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono">{srcKey ?? ""}.md</DialogTitle>
            <DialogDescription>{srcKey ? SOURCE_HINT[srcKey] : ""}</DialogDescription>
          </DialogHeader>
          {!srcEditing ? (
            <div className="max-h-[50vh] min-h-24 overflow-y-auto rounded-md border p-3">
              {srcKey && contentFor(srcKey).trim()
                ? <Markdown content={contentFor(srcKey)} />
                : <p className="text-sm text-muted-foreground">（未填写）</p>}
            </div>
          ) : (
            <div className="space-y-3">
              {srcKey === "bible" && isModule && (
                <div className="space-y-1">
                  <Label className="text-xs">Module 冻结指令（由 Module 版本管理，实例不可改写）</Label>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-(--surface-muted) p-2 text-[11px]">
                    {meta?.defaultInstructions || "（Module 未加载）"}
                  </pre>
                </div>
              )}
              {srcKey === "bible" && isModule ? (
                <div className="space-y-1">
                  <Label className="text-xs">本实例业务定位（追加到指令尾部）</Label>
                  <Textarea value={purposeDraft} onChange={(e) => setPurposeDraft(e.target.value)}
                    className="min-h-24" placeholder="如：面向售后退款场景" />
                </div>
              ) : (
                <Textarea value={srcDraft} onChange={(e) => setSrcDraft(e.target.value)}
                  className="min-h-56 font-mono text-xs"
                  placeholder={srcKey === "identity" ? "职责与边界：我负责什么、不负责什么" : srcKey === "persona" ? "如：结论先行、证据附引用、不确定时显式说不确定" : "# 角色：\n## 目标：\n## 技能：\n## 限制："} />
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(true)}>编译预览</Button>
            {!srcEditing ? (
              !archived && <Button onClick={() => setSrcEditing(true)}>编辑</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setSrcEditing(false)}>取消</Button>
                <Button disabled={busy} onClick={saveSource}>{busy ? "保存中…" : "保存"}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编译预览（与后端 compile_system_prompt 同规则） */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编译预览（system_prompt 草稿口径）</DialogTitle>
            <DialogDescription>发布时按版本快照重新编译并冻结；此处为当前草稿的等价预览。</DialogDescription>
          </DialogHeader>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border p-3 text-[11px]">
            {compilePreview()}
          </pre>
        </DialogContent>
      </Dialog>

      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>归档这个 Agent？</DialogTitle>
            <DialogDescription>
              归档后停止出现在产品运行面；历史版本、运行与产物只读保留。此操作不可撤销（如需复用请新建）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelOpen(false)}>取消</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void archive()}>
              {busy ? "归档中…" : "归档"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
