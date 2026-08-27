import { ArrowLeft, History, Plus, ShieldCheck, Trash2, Upload } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/app/form-field"
import { PageContainer, PageHeader, SectionHeader } from "@/components/app/page"
import { StatusIcon } from "@/components/app/status-indicator"
import { useAsyncData } from "@/hooks/use-async-data"
import { bizApi } from "@/services/wf-api"
import { rbac } from "@/services/rbac"

/**
 * Result Rules Editor（09 P0-B4 契约对齐版）：
 * 后端 DTO = {id,name,description,version,status,rules{scoreRules,issueRules},versions[]}。
 * 规则结构即后端引擎求值结构（_match：field/op/value；op ∈ eq|neq|contains|gt|lt|exists）。
 */

interface ScoreRuleRow { id: string; field: string; op: string; value: string; weight: number }
interface IssueRuleRow { id: string; criterion: string; field: string; op: string; value: string; severity: string }

const OPS = ["eq", "neq", "contains", "gt", "lt", "exists"] as const
const SEVERITIES = ["Low", "Medium", "High", "Critical"] as const

function normalizeRows(rules: Record<string, unknown> | undefined): { scoreRules: ScoreRuleRow[]; issueRules: IssueRuleRow[] } {
  const scoreRules = ((rules?.scoreRules ?? []) as Partial<ScoreRuleRow>[]).map((r, i) => ({
    id: r.id ?? `s${i}`, field: r.field ?? "", op: r.op ?? "eq",
    value: String(r.value ?? ""), weight: Number(r.weight ?? 10),
  }))
  const issueRules = ((rules?.issueRules ?? []) as Partial<IssueRuleRow>[]).map((r, i) => ({
    id: r.id ?? `i${i}`, criterion: r.criterion ?? "", field: r.field ?? "",
    op: r.op ?? "contains", value: String(r.value ?? ""), severity: r.severity ?? "Medium",
  }))
  return { scoreRules, issueRules }
}

/** 真实校验（不再写死成功）：字段/权重/问题项完整性。 */
function validateRules(scoreRules: ScoreRuleRow[], issueRules: IssueRuleRow[]) {
  const checks: { label: string; ok: boolean }[] = []
  checks.push({
    label: "每条评分规则都有 field 与 op",
    ok: scoreRules.every((r) => r.field.trim() !== "" && r.op.trim() !== ""),
  })
  checks.push({
    label: "权重为 0–100 数字",
    ok: scoreRules.every((r) => Number.isFinite(r.weight) && r.weight >= 0 && r.weight <= 100),
  })
  checks.push({
    label: "每条问题规则有 criterion 与 severity",
    ok: issueRules.every((r) => r.criterion.trim() !== "" && SEVERITIES.includes(r.severity as typeof SEVERITIES[number])),
  })
  checks.push({
    label: "非 exists 运算都有比较值",
    ok: [...scoreRules, ...issueRules].every((r) => r.op === "exists" || String(r.value).trim() !== ""),
  })
  return checks
}

export default function ResultRuleEditorPage() {
  const { ruleSetId = "" } = useParams()
  const navigate = useNavigate()
  const { data: rule, retry } = useAsyncData(() => bizApi.rule(ruleSetId), [ruleSetId])

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [scoreRules, setScoreRules] = useState<ScoreRuleRow[]>([])
  const [issueRules, setIssueRules] = useState<IssueRuleRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const [validateOpen, setValidateOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (!rule) return
    setName(rule.name)
    setDescription(rule.description ?? "")
    const rows = normalizeRows(rule.rules)
    setScoreRules(rows.scoreRules)
    setIssueRules(rows.issueRules)
    setDirty(false)
  }, [rule])

  const canManage = rbac.can("rules.manage")
  const readOnly = !canManage

  if (!rule) {
    return <PageContainer className="max-w-4xl"><p className="text-sm text-muted-foreground">加载中...</p></PageContainer>
  }

  const checks = validateRules(scoreRules, issueRules)

  const saveDraft = async () => {
    setSaving(true)
    try {
      await bizApi.updateRule(ruleSetId, {
        name: name.trim() || rule.name,
        rules: { scoreRules, issueRules },
      })
      setDirty(false)
      toast.success("草稿已保存")
      retry()
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageContainer className="max-w-4xl space-y-5">
      <div>
        <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate("/config/result-rules")}>
          <ArrowLeft className="size-4" /> 结果规则
        </Button>
        <PageHeader
          className="mt-2"
          title={rule.name}
          status={
            <>
              <Badge variant={rule.status === "published" ? "success" : "neutral"}>V{rule.version}</Badge>
              <Badge variant={rule.status === "published" ? "success" : "neutral"}>
                {rule.status === "published" ? "Published" : "Draft"}
              </Badge>
              {readOnly ? <Badge variant="info">只读</Badge> : null}
            </>
          }
          description="发布生成不可变规则版本；存量结果保留各自冻结版本（09 P0-07，不再全库重算）"
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}><History className="size-3.5" /> 版本历史</Button>
              <Button variant="outline" size="sm" onClick={() => setValidateOpen(true)}><ShieldCheck className="size-3.5" /> 验证</Button>
              {!readOnly ? (
                <>
                  <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={saveDraft}>保存草稿</Button>
                  <Button size="sm" onClick={() => setPublishOpen(true)}><Upload className="size-3.5" /> 发布</Button>
                </>
              ) : null}
            </>
          }
        />
      </div>

      <fieldset disabled={readOnly} className="space-y-5">
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader title="基本信息" />
          <FormField label="名称" required>
            <Input value={name} onChange={(e) => { setName(e.target.value); setDirty(true) }} />
          </FormField>
          <FormField label="描述">
            <Textarea className="min-h-16" value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true) }} />
          </FormField>
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader
            title="评分规则（Score Rules）"
            description="条件不满足时扣减对应权重；起始分 100"
            actions={
              <Button variant="outline" size="sm" onClick={() => { setScoreRules([...scoreRules, { id: `s${Date.now()}`, field: "", op: "eq", value: "", weight: 10 }]); setDirty(true) }}>
                <Plus className="size-3.5" /> 添加
              </Button>
            }
          />
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>字段</TableHead>
                  <TableHead>运算</TableHead>
                  <TableHead>比较值</TableHead>
                  <TableHead className="text-right">扣分权重</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {scoreRules.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-4 text-center text-xs text-muted-foreground">暂无评分规则</TableCell></TableRow>
                ) : scoreRules.map((row, idx) => (
                  <TableRow key={row.id}>
                    <TableCell><Input className="h-8" value={row.field} onChange={(e) => { setScoreRules(scoreRules.map((r, i) => i === idx ? { ...r, field: e.target.value } : r)); setDirty(true) }} /></TableCell>
                    <TableCell>
                      <Select value={row.op} onValueChange={(v) => { setScoreRules(scoreRules.map((r, i) => i === idx ? { ...r, op: v } : r)); setDirty(true) }}>
                        <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>{OPS.map((op) => <SelectItem key={op} value={op}>{op}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input className="h-8" value={row.value} disabled={row.op === "exists"} onChange={(e) => { setScoreRules(scoreRules.map((r, i) => i === idx ? { ...r, value: e.target.value } : r)); setDirty(true) }} /></TableCell>
                    <TableCell><Input type="number" className="h-8 w-20 text-right" value={row.weight} onChange={(e) => { setScoreRules(scoreRules.map((r, i) => i === idx ? { ...r, weight: Number(e.target.value) } : r)); setDirty(true) }} /></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => { setScoreRules(scoreRules.filter((_, i) => i !== idx)); setDirty(true) }}><Trash2 className="size-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader
            title="问题规则（Issue Rules）"
            description="条件命中时记录问题并派生风险等级"
            actions={
              <Button variant="outline" size="sm" onClick={() => { setIssueRules([...issueRules, { id: `i${Date.now()}`, criterion: "", field: "", op: "contains", value: "", severity: "Medium" }]); setDirty(true) }}>
                <Plus className="size-3.5" /> 添加
              </Button>
            }
          />
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>问题描述</TableHead>
                  <TableHead>字段</TableHead>
                  <TableHead>运算</TableHead>
                  <TableHead>比较值</TableHead>
                  <TableHead>严重度</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {issueRules.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-4 text-center text-xs text-muted-foreground">暂无问题规则</TableCell></TableRow>
                ) : issueRules.map((row, idx) => (
                  <TableRow key={row.id}>
                    <TableCell><Input className="h-8" value={row.criterion} onChange={(e) => { setIssueRules(issueRules.map((r, i) => i === idx ? { ...r, criterion: e.target.value } : r)); setDirty(true) }} /></TableCell>
                    <TableCell><Input className="h-8" value={row.field} onChange={(e) => { setIssueRules(issueRules.map((r, i) => i === idx ? { ...r, field: e.target.value } : r)); setDirty(true) }} /></TableCell>
                    <TableCell>
                      <Select value={row.op} onValueChange={(v) => { setIssueRules(issueRules.map((r, i) => i === idx ? { ...r, op: v } : r)); setDirty(true) }}>
                        <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>{OPS.map((op) => <SelectItem key={op} value={op}>{op}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input className="h-8" value={row.value} disabled={row.op === "exists"} onChange={(e) => { setIssueRules(issueRules.map((r, i) => i === idx ? { ...r, value: e.target.value } : r)); setDirty(true) }} /></TableCell>
                    <TableCell>
                      <Select value={row.severity} onValueChange={(v) => { setIssueRules(issueRules.map((r, i) => i === idx ? { ...r, severity: v } : r)); setDirty(true) }}>
                        <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                        <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => { setIssueRules(issueRules.filter((_, i) => i !== idx)); setDirty(true) }}><Trash2 className="size-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </fieldset>

      {/* Validate Sheet：真实校验（不再写死成功） */}
      <Sheet open={validateOpen} onOpenChange={setValidateOpen}>
        <SheetContent className="w-[400px]">
          <SheetHeader>
            <SheetTitle>验证</SheetTitle>
            <SheetDescription>规则完整性检查（后端引擎按 field/op/value 求值）</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {checks.map((check) => (
              <div key={check.label} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <StatusIcon tone={check.ok ? "success" : "danger"} />
                {check.label}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Publish Dialog：09 P0-07 发布=冻结不可变版本 */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发布 Result Rules</DialogTitle>
            <DialogDescription>
              发布将当前草稿冻结为新的不可变版本；存量结果保留各自绑定版本，不触发重算。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="rounded-md bg-muted/60 px-3 py-2 text-xs">
              <div>评分规则：{scoreRules.length} 条 · 问题规则：{issueRules.length} 条</div>
              {checks.some((c) => !c.ok) ? <div className="mt-1 text-amber-600">存在未通过的校验项，建议先修复</div> : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>取消</Button>
            <Button disabled={publishing} onClick={async () => {
              setPublishing(true)
              try {
                if (dirty) await saveDraft()
                const r = await bizApi.publishRule(ruleSetId)
                setPublishOpen(false)
                toast.success(`已发布 V${r.version}（版本 ${r.ruleVersionId.slice(0, 8)}），不触发历史重算`)
                retry()
              } catch (e) {
                toast.error(`发布失败：${(e as Error).message}`)
              } finally {
                setPublishing(false)
              }
            }}>{publishing ? "发布中…" : "发布"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version History Sheet：真实版本列表 */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-[420px]">
          <SheetHeader>
            <SheetTitle>版本历史</SheetTitle>
            <SheetDescription>不可变版本快照；任务可绑定任一版本</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {(rule.versions ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">尚未发布过版本</p>
            ) : (rule.versions ?? []).map((v) => (
              <div key={v.id} className="rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">V{v.versionNo}</span>
                  <span className="text-xs text-muted-foreground">{v.id.slice(0, 8)}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  评分 {((v.rules?.scoreRules as unknown[] | undefined) ?? []).length} 条 ·
                  问题 {((v.rules?.issueRules as unknown[] | undefined) ?? []).length} 条 · {v.createdAt}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}
