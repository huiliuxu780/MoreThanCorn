/** Skill 子页（原站 /skill 同构）：技能市场/我的技能 两 tab + 上传 Skill dialog + 安装/卸载。
 * 度量：子页 h2 28/650；行 border-b h67 14px（台账 §5）。 */
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { agentApi } from "@/services/wf-api"
import { resApi } from "@/services/resource-api"

interface SkillDto { id: string; name: string; description: string; status: string; metadata: { category: string; source: string; chars: number } }
interface InstalledSkill extends SkillDto { installedAt: string }

export function AgentSkillsSection({ agentId, readOnly }: { agentId: string; readOnly?: boolean }) {
  const [tab, setTab] = useState<"market" | "mine">("market")
  const [market, setMarket] = useState<SkillDto[]>([])
  const [mine, setMine] = useState<InstalledSkill[]>([])
  const [upOpen, setUpOpen] = useState(false)
  const [upName, setUpName] = useState("")
  const [upCat, setUpCat] = useState("")
  const [upContent, setUpContent] = useState("")

  const load = useCallback(() => {
    resApi.list("skill", { pageSize: 100 }).then((r) => setMarket(r.items as unknown as SkillDto[])).catch(() => setMarket([]))
    agentApi.skills(agentId).then((r) => setMine(r.items)).catch(() => setMine([]))
  }, [agentId])
  useEffect(() => { load() }, [load])

  const installedIds = new Set(mine.map((s) => s.id))

  const install = async (sid: string) => {
    try { await agentApi.installSkill(agentId, sid); toast.success("已安装"); load() }
    catch (e) { toast.error((e as Error).message) }
  }
  const uninstall = async (sid: string) => {
    try { await agentApi.uninstallSkill(agentId, sid); toast.success("已卸载"); load() }
    catch (e) { toast.error((e as Error).message) }
  }
  const upload = async () => {
    if (!upName.trim() || !upContent.trim()) { toast.error("名称与 SKILL.md 内容必填"); return }
    try {
      const r = await resApi.create("skill", { name: upName.trim(), category: upCat.trim(), content: upContent, source: "upload" })
      await agentApi.installSkill(agentId, r.id)
      toast.success("已上传并安装")
      setUpOpen(false); setUpName(""); setUpCat(""); setUpContent("")
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const Row = ({ s, right }: { s: SkillDto; right: React.ReactNode }) => (
    <div className="flex h-[67px] items-center gap-3 border-b px-1 text-sm" style={{ borderColor: "var(--border)" }}>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{s.name}</div>
        <div className="truncate text-xs text-(--text-tertiary)">
          {s.description || s.metadata?.category || "—"}
        </div>
      </div>
      {right}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[28px] font-semibold leading-[38px]">Skill</h2>
        {!readOnly && <Button size="sm" variant="outline" onClick={() => setUpOpen(true)}>上传 Skill</Button>}
      </div>
      <div className="flex h-8 w-fit items-center gap-1 rounded-md bg-(--segment-bg) p-1">
        {([["market", "技能市场"], ["mine", "我的技能"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`h-6 rounded px-2.5 text-xs leading-4 transition-colors ${tab === k
              ? "bg-(--segment-active) font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="max-w-3xl">
        {tab === "market"
          ? (market.length === 0 ? <p className="text-xs text-(--text-tertiary)">市场暂无 Skill，可上传第一个。</p>
            : market.map((s) => (
              <Row key={s.id} s={s} right={
                installedIds.has(s.id)
                  ? <span className="shrink-0 text-xs text-(--text-tertiary)">已安装</span>
                  : !readOnly && <Button variant="outline" size="sm" className="shrink-0" onClick={() => void install(s.id)}>安装</Button>
              } />
            )))
          : (mine.length === 0 ? <p className="text-xs text-(--text-tertiary)">尚未安装任何 Skill。</p>
            : mine.map((s) => (
              <Row key={s.id} s={s} right={
                !readOnly && <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void uninstall(s.id)}>卸载</Button>
              } />
            )))}
      </div>

      <Dialog open={upOpen} onOpenChange={setUpOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>上传 Skill</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={upName} placeholder="名称" onChange={(e) => setUpName(e.target.value)} />
            <Input value={upCat} placeholder="分类（如 研究与分析）" onChange={(e) => setUpCat(e.target.value)} />
            <Textarea value={upContent} placeholder="SKILL.md 全文" className="min-h-48 font-mono text-xs"
              onChange={(e) => setUpContent(e.target.value)} />
            <Button onClick={() => void upload()}>上传并安装</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
