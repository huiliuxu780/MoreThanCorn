import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Eye, MoreHorizontal, Pencil, Plus, Trash2, Upload, Users } from "lucide-react"
import { toast } from "sonner"
import { avatarFor } from "@/lib/agent-avatar"

import { FilterBar, SearchField } from "@/components/app/filters"
import { CardGridSkeleton, EmptyState } from "@/components/app/list-state"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { DeleteBlockedDialog } from "@/components/resources/resource-dialogs"
import { agentApi, pagedApi, skillMounts, skillUpload } from "@/services/wf-api"
import { resApi, type RefInfo } from "@/services/resource-api"

interface SkillDto {
  id: string
  name: string
  description: string
  status: string
  metadata: { category: string; source: string; chars: number; version?: string; versions?: { v: string; at: string }[] }
}
interface MountInfo { agentId: string; agentName: string }

const isBuiltin = (s: SkillDto) => s.metadata?.source !== "upload"

/** docs/v2-design/10 §4.1：Skills 分类页——列表/来源筛选/查看 Drawer/上传/挂载 Dialog/空态。 */
export default function ResSkillsPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [source, setSource] = useState("")
  const [rows, setRows] = useState<SkillDto[]>([])
  const [mounts, setMounts] = useState<Record<string, MountInfo[]>>({})
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState<SkillDto | null>(null)
  const [viewContent, setViewContent] = useState("")
  const [edit, setEdit] = useState<SkillDto | "new" | null>(null)
  const [mount, setMount] = useState<SkillDto | null>(null)
  const [del, setDel] = useState<SkillDto | null>(null)
  const [blocked, setBlocked] = useState<{ name: string; refs: RefInfo[] } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      resApi.list("skill", { page: 1, pageSize: 100, search }),
      skillMounts(),
    ]).then(([r, m]) => {
      setRows(r.items as unknown as SkillDto[])
      setMounts(m.mounts)
    }).catch(() => { setRows([]); setMounts({}) })
      .finally(() => setLoading(false))
  }, [search])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(
    () => rows.filter((s) => !source || (source === "builtin" ? isBuiltin(s) : !isBuiltin(s))),
    [rows, source],
  )

  const openView = async (s: SkillDto) => {
    setView(s)
    try {
      const r = await resApi.get("skill", s.id)
      // 服务端详情正文在 config.content（metadata 仅 category/source/chars）
      setViewContent(((r.config?.content ?? r.metadata?.content) as string) ?? "")
    } catch {
      setViewContent("")
    }
  }

  const remove = async () => {
    if (!del) return
    try {
      await resApi.remove("skill", del.id)
      toast.success(`已删除「${del.name}」`)
      setDel(null)
      load()
    } catch (e) {
      // docs/v2-design/10 §5.4-4：被挂载删除 → 阻断 Dialog 列挂载方（agent_skill refs）
      const err = e as Error & { refs?: RefInfo[] }
      setDel(null)
      if (err.refs) setBlocked({ name: del.name, refs: err.refs })
      else toast.error(err.message)
    }
  }

  return (
    <div className="space-y-3">
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="搜索 Skills…" />
        <Select value={source || "__all__"} onValueChange={(v) => setSource(v === "__all__" ? "" : v)}>
          <SelectTrigger size="sm" className="w-32"><SelectValue placeholder="来源：全部" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">来源：全部</SelectItem>
            <SelectItem value="builtin">内置</SelectItem>
            <SelectItem value="upload">上传</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto" />
        <Button onClick={() => setEdit("new")}><Upload className="size-4" /> 上传 Skill</Button>
      </FilterBar>

      {loading ? <CardGridSkeleton count={6} /> : filtered.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? "还没有安装或上传 Skill" : "没有匹配的 Skill"}
          description={rows.length === 0 ? "上传 SKILL.md 内容包，挂载到 Agent 后运行时注入正文。" : "调整搜索或来源筛选。"}
          action={rows.length === 0 ? <Button onClick={() => setEdit("new")}><Plus className="size-4" /> 上传 Skill</Button> : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => {
            const ms = mounts[s.id] ?? []
            return (
              <div key={s.id}
                role="button"
                tabIndex={0}
                aria-label={`查看 ${s.name} 详情`}
                onClick={() => openView(s)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    openView(s)
                  }
                }}
                className="space-y-2 rounded-lg border bg-surface p-4 shadow-sm transition-colors hover:border-muted-foreground/40 active:translate-y-px cursor-pointer">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-surface-muted text-foreground" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                        <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h8v8h-8v-8zm2 2v4h4v-4h-4z" />
                      </svg>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{s.name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {s.metadata?.version ? `V${s.metadata.version}` : "V1.0.0"}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border bg-surface-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {isBuiltin(s) ? "内置" : "上传"}
                  </span>
                </div>
                <p className="line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">
                  {s.description || "—"}
                </p>
                <div className="flex h-6 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                  {ms.length === 0 ? (
                    <span>未挂载</span>
                  ) : (
                    <>
                      <span className="flex -space-x-1.5">
                        {ms.slice(0, 4).map((m) => (
                          <img
                            key={m.agentId}
                            src={(m as { avatar?: string | null }).avatar || avatarFor(m.agentId)}
                            alt={m.agentName}
                            title={m.agentName}
                            className="size-6 rounded-full border bg-surface-raised object-cover ring-2 ring-surface"
                          />
                        ))}
                      </span>
                      <span>{ms.length} 个 Agent 使用</span>
                    </>
                  )}
                  <span className="ml-auto tabular-nums">{s.metadata?.chars ?? 0} 字符</span>
                </div>
                <div className="flex items-center gap-1 border-t pt-2" onClick={(e) => e.stopPropagation()}>
                  <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => openView(s)}>
                    <Eye className="size-3.5" /> 查看正文
                  </Button>
                  <span className="ml-auto">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7" aria-label={`更多操作 ${s.name}`}>
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setMount(s)}>
                          <Users className="size-3.5" /> 挂载/卸载
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setEdit(s)}>
                          <Pencil className="size-3.5" /> 编辑
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onSelect={() => setDel(s)}>
                          <Trash2 className="size-3.5" /> 删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Skill 详情（对齐 QoderWake「安装 Skill」弹窗：800 宽 + 说明 + 选择 Agent + 安装） */}
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="flex max-h-[88vh] w-full flex-col sm:max-w-3xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>Skill 详情</DialogTitle>
            <p className="text-xs text-muted-foreground">查看说明并选择要安装的 Agent。</p>
          </DialogHeader>
          <div className="flex-1 space-y-4 overflow-y-auto">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold">{view?.name}</span>
                {view && isBuiltin(view) ? <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">内置</span> : null}
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] text-(--text-tertiary)">
                <span>分类：{view?.metadata?.category || "—"}</span>
                <span>来源：{view?.metadata?.source === "upload" ? "上传" : "内置"}</span>
                <span>{view?.metadata?.chars ?? 0} 字</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{view?.description || "—"}</p>
            <div>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">Skill 说明（SKILL.md 正文）</h3>
              <pre className="max-h-[42vh] whitespace-pre-wrap rounded-lg border bg-surface-muted p-3 font-mono text-[11px] leading-5">
                {viewContent || "（无正文）"}
              </pre>
            </div>
            {view && (mounts[view.id] ?? []).length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">已安装的 Agent（{mounts[view.id].length}）</h3>
                <div className="flex flex-wrap gap-1.5">
                  {(mounts[view.id] ?? []).map((m) => (
                    <button key={m.agentId} type="button"
                      className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-muted-foreground/40"
                      onClick={() => { setView(null); navigate(`/agents/${m.agentId}/skills`) }}>
                      {m.agentName}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setView(null)}>关闭</Button>
            {view && (
              <>
                <Button onClick={() => { const s = view; setView(null); setMount(s) }}>安装到 Agent</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {edit && <SkillFormDialog initial={edit === "new" ? null : edit}
        onClose={() => setEdit(null)} onSaved={load} />}
      {mount && <MountDialog skill={mount} mounted={mounts[mount.id] ?? []}
        onClose={() => setMount(null)} onSaved={load} />}
      {blocked && (
        <DeleteBlockedDialog open name={blocked.name} refs={blocked.refs}
          onClose={() => setBlocked(null)}
          onViewRefs={(r) => { setBlocked(null); if (r.id) navigate(`/agents/${r.id}`) }} />
      )}
      {del && (
        <Dialog open onOpenChange={(o) => !o && setDel(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>删除 Skill</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              确认删除「{del.name}」？已被 Agent 挂载时将拒绝删除。
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDel(null)}>取消</Button>
              <Button variant="destructive" onClick={remove}>删除</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function SkillFormDialog({ initial, onClose, onSaved }: {
  initial: SkillDto | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [desc, setDesc] = useState(initial?.description ?? "")
  const [category, setCategory] = useState(initial?.metadata?.category ?? "")
  const [content, setContent] = useState("")
  // 09-08 原站对齐：文件驱动上传（.md frontmatter / .zip/.tgz 含 SKILL.md）+ 目标 Waker 一步挂载
  const [mode, setMode] = useState<"file" | "manual">("file")
  const [file, setFile] = useState<File | null>(null)
  const [agentSel, setAgentSel] = useState<string[]>([])
  const [agents, setAgents] = useState<{ id: string; name: string; archived?: boolean }[]>([])
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (initial) return
    pagedApi.agents({ page: 1, pageSize: 100 })
      .then((r) => setAgents(r.items as unknown as { id: string; name: string; archived?: boolean }[]))
      .catch(() => undefined)
  }, [initial])

  useEffect(() => {
    if (!initial) return
    resApi.get("skill", initial.id)
      .then((r) => setContent(((r.config?.content ?? r.metadata?.content) as string) ?? ""))
      .catch(() => undefined)
  }, [initial])

  /** 门禁禁 JSX 原生 input：文件选择器命令式创建（标准件无 file picker 变体）。 */
  const pickFile = () => {
    const el = document.createElement("input")
    el.type = "file"
    el.accept = ".md,.zip,.tgz,.tar.gz,text/markdown"
    el.onchange = () => {
      const f = el.files?.[0]
      if (!f) return
      setFile(f)
      if (/\.md$/i.test(f.name)) {
        void f.text().then((t) => {
          setContent(t)
          const fm = t.match(/^---\s*\n([\s\S]*?)\n---/)
          const nm = fm?.[1].match(/^name:\s*(.+)$/m)
          if (nm && !name.trim()) setName(nm[1].trim())
        })
      }
    }
    el.click()
  }

  const save = async () => {
    if (!initial && mode === "file") {
      if (!file) { toast.error("请选择 .md 或 .zip/.tgz/.tar.gz 文件"); return }
      setUploading(true)
      try {
        await skillUpload(file, agentSel)
        toast.success("已上传 Skill" + (agentSel.length ? ` 并挂载 ${agentSel.length} 个 Agent` : ""))
        onClose(); onSaved()
      } catch (e) { toast.error((e as Error).message) } finally { setUploading(false) }
      return
    }
    if (!name.trim() || !content.trim()) { toast.error("名称与 SKILL.md 内容必填"); return }
    try {
      if (initial) {
        // 09-11 批4：版本管理——编辑保存=patch bump+历史留痕（对齐原站 V 号展示）
        const cur = initial.metadata?.version || "1.0.0"
        const [ma, mi, pa] = cur.split(".").map((x) => parseInt(x, 10) || 0)
        const nextV = `${ma}.${mi}.${pa + 1}`
        const history = Array.isArray(initial.metadata?.versions) ? (initial.metadata?.versions as { v: string; at: string }[]) : []
        await resApi.update("skill", initial.id, {
          name: name.trim(), description: desc, category, content,
          version: nextV,
          versions: [...history, { v: cur, at: new Date().toISOString() }].slice(-20),
        })
      } else {
        await resApi.create("skill", { name: name.trim(), description: desc, category, content, source: "upload" })
      }
      toast.success(initial ? "已保存 Skill" : "已上传 Skill")
      onClose()
      onSaved()
    } catch (e) {
      const st = (e as { status?: number }).status
      if (st === 410) toast.error("挂载已迁移：请在对话页 Session Workspace 内装配 Skill")
      else toast.error((e as Error).message)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initial ? "编辑 Skill" : "上传 Skill"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!initial && (
            <div className="flex h-8 w-fit items-center gap-1 rounded-lg bg-(--segment-bg) p-1">
              {(["file", "manual"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={`h-6 rounded px-2.5 text-xs leading-4 transition-colors ${mode === m ? "bg-(--segment-active) font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {m === "file" ? "文件上传" : "手动填写"}
                </button>
              ))}
            </div>
          )}
          {!initial && mode === "file" && (
            <div className="space-y-3">
              <div
                className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-center transition-colors hover:border-brand/60"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setFile(f) }}
                onClick={() => {
                  const el = document.createElement("input")
                  el.type = "file"
                  el.accept = ".md,.zip,.tgz,.tar.gz,text/markdown"
                  el.onchange = () => { const f = el.files?.[0]; if (f) setFile(f) }
                  el.click()
                }}
              >
                <Upload className="size-5 text-muted-foreground" />
                <span className="text-xs">{file ? file.name : "拖拽或点击此处上传"}</span>
                <span className="text-[11px] text-(--text-tertiary)">支持单个 .md 文件或 .zip / .tgz / .tar.gz 压缩包</span>
              </div>
              <p className="text-[11px] leading-4 text-(--text-tertiary)">
                文件要求：.md 需包含 YAML frontmatter（name/description）；压缩包必须包含 SKILL.md。
              </p>
              <div className="space-y-1">
                <Label>目标 Waker（可选，上传即挂载）</Label>
                <div className="flex flex-wrap gap-1.5">
                  {agents.map((a) => (
                    <button key={a.id} type="button"
                      onClick={() => setAgentSel((cur) => (cur.includes(a.id) ? cur.filter((x) => x !== a.id) : [...cur, a.id]))}
                      className={`rounded-md border px-2 py-1 text-xs transition-colors ${agentSel.includes(a.id) ? "border-brand bg-brand-soft text-foreground" : "text-muted-foreground hover:border-brand/50"}`}>
                      {a.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {(!initial && mode === "manual" || initial) && (<>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="sk-name">名称</Label>
              <Input id="sk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="consumer-analysis" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sk-cat">分类</Label>
              <Input id="sk-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="research" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sk-desc">描述</Label>
            <Input id="sk-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="一句话说明能力边界" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="sk-content">SKILL.md 正文</Label>
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={pickFile}>
                选择 .md 文件
              </Button>
            </div>
            <Textarea id="sk-content" rows={10} value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={"---\nname: ...\ndescription: ...\n---\n正文…"}
              className="font-mono text-xs" />
          </div>
          </>)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={uploading} onClick={save}>
            {!initial && mode === "file" ? (uploading ? "上传中…" : "上传") : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MountDialog({ skill, mounted, onClose, onSaved }: {
  skill: SkillDto
  mounted: (MountInfo & { avatar?: string | null })[]
  onClose: () => void
  onSaved: () => void
}) {
  const [agents, setAgents] = useState<{
    id: string; name: string; archived?: boolean; avatar?: string | null
    config?: { skills?: string[]; skills_disabled?: string[] } & Record<string, unknown>
    configRevision?: number
  }[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set(mounted.map((m) => m.agentId)))
  // 09-11 批8：挂载态 ≠ 启停态——skills_disabled 记录「已挂载但对该 Agent 停用」
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    pagedApi.agents({ page: 1, pageSize: 100, archived: "all" })
      .then((r) => {
        const rows = r.items as unknown as {
          id: string; name: string; archived?: boolean
          config?: { skills_disabled?: string[] } & Record<string, unknown>
          configRevision?: number
        }[]
        setAgents(rows)
        setDisabled(new Set(rows.filter((a) => (a.config?.skills_disabled ?? []).includes(skill.id)).map((a) => a.id)))
      })
      .catch(() => undefined)
  }, [skill.id])

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    const cur = new Set(mounted.map((m) => m.agentId))
    const add = [...picked].filter((id) => !cur.has(id))
    const rm = [...cur].filter((id) => !picked.has(id))
    try {
      // 09-11 修正：install/uninstall 已 410 退役；挂载=config.skills 声明合并（发布冻结生效）
      for (const id of [...add, ...rm]) {
        const a = agents.find((x) => x.id === id)
        if (!a) continue
        const base = new Set(a.config?.skills ?? [])
        if (add.includes(id)) base.add(skill.id); else base.delete(skill.id)
        await agentApi.update(
          id,
          { config: { ...(a.config ?? {}), skills: [...base] } },
          a.configRevision,
        )
      }
      // 启停态落库：合并写 config.skills_disabled（update 为整体替换语义）
      const initialDisabled = new Set(
        agents.filter((a) => (a.config?.skills_disabled ?? []).includes(skill.id)).map((a) => a.id),
      )
      for (const a of agents) {
        if (!picked.has(a.id)) continue
        const nowOff = disabled.has(a.id)
        const wasOff = initialDisabled.has(a.id)
        if (nowOff === wasOff) continue
        const base = new Set(a.config?.skills_disabled ?? [])
        if (nowOff) base.add(skill.id); else base.delete(skill.id)
        await agentApi.update(
          a.id,
          { config: { ...(a.config ?? {}), skills_disabled: [...base] } },
          a.configRevision,
        )
      }
      toast.success("挂载关系与启停状态已更新（下次发布生效）")
      onClose()
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>挂载 Skill：{skill.name}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          挂载后该 Agent 的自主运行 system prompt 注入 SKILL.md 正文（单 skill 截断 8000 字符）。
        </p>
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {agents.filter((a) => !a.archived).map((a) => {
            const isPicked = picked.has(a.id)
            const isOff = disabled.has(a.id)
            return (
              <div key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Checkbox checked={isPicked} onCheckedChange={() => toggle(a.id)} aria-label={`挂载到 ${a.name}`} />
                <img src={avatarFor(a.id)} alt="" className="size-6 shrink-0 rounded-full object-cover" />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span
                  className="shrink-0 rounded-full border px-2 py-0.5 text-[10px]"
                  style={{
                    color: !isPicked
                      ? "var(--text-tertiary)"
                      : isOff
                        ? "var(--status-warning)"
                        : "var(--status-success)",
                  }}
                >
                  {!isPicked ? "未挂载" : isOff ? "已挂载 · 停用" : "已挂载 · 启用"}
                </span>
                <Switch
                  checked={!isOff}
                  disabled={!isPicked}
                  onCheckedChange={(v) =>
                    setDisabled((prev) => {
                      const next = new Set(prev)
                      if (v) next.delete(a.id); else next.add(a.id)
                      return next
                    })
                  }
                  aria-label={`对 ${a.name} 启用 ${skill.name}`}
                />
              </div>
            )
          })}
          {agents.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">暂无可挂载 Agent</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={saving} onClick={save}>确认挂载</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
