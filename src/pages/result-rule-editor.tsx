import { ArrowLeft, History, ShieldCheck, Upload } from "lucide-react"
import { useState } from "react"
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
import { StatusBadge } from "@/components/app/status-badge"
import { StatusIcon } from "@/components/app/status-indicator"
import { useAsyncData } from "@/hooks/use-async-data"
import { getResultRule } from "@/services/mock-service"
import { rbac } from "@/services/rbac"

/**
 * Result Rules Editor（Design Spec §27）：
 * 单页编辑；不做拖拽 Workflow / 多层 Wizard / 复杂 DSL。
 */
export default function ResultRuleEditorPage() {
  const { ruleSetId = "" } = useParams()
  const navigate = useNavigate()
  const { data: rule } = useAsyncData(() => getResultRule(ruleSetId), [ruleSetId])

  const [validateOpen, setValidateOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versionNote, setVersionNote] = useState("")
  const [priority, setPriority] = useState<string | null>(null)

  const canManage = rbac.can("rules.manage")
  const readOnly = rule?.versionStatus === "Published" || !canManage

  if (!rule) {
    return <PageContainer className="max-w-4xl"><p className="text-sm text-muted-foreground">加载中...</p></PageContainer>
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
              <Badge variant={rule.versionStatus === "Published" ? "success" : "neutral"}>{rule.currentVersion}</Badge>
              {readOnly ? <Badge variant="info">只读</Badge> : null}
            </>
          }
          description="管理 Effective Result 如何被解释与计算为 Derived Result"
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}><History className="size-3.5" /> 版本历史</Button>
              <Button variant="outline" size="sm" onClick={() => setValidateOpen(true)}><ShieldCheck className="size-3.5" /> 验证</Button>
              {!readOnly ? (
                <Button size="sm" onClick={() => setPublishOpen(true)}><Upload className="size-3.5" /> 发布</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => toast.info("已基于当前版本创建 Draft（原型）")}>基于当前版本创建 Draft</Button>
              )}
            </>
          }
        />
      </div>

      <fieldset disabled={readOnly} className="space-y-5">
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader title="基本信息" />
          <div className="grid grid-cols-2 gap-4">
            <FormField label="名称" required><Input defaultValue={rule.name} /></FormField>
            <FormField label="Agent" description="Selection Filter 的评价来源；Result Rules ≠ Agent">
              <Select defaultValue={rule.agentId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={rule.agentId}>{rule.agentName}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField label="描述"><Textarea className="min-h-16" defaultValue={rule.description} /></FormField>
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader title="Evaluation Selection" description="先 Filter，再 Priority；V1 默认 Most Recent Completed" />
          <div className="grid grid-cols-2 gap-4">
            <FormField label="候选状态">
              <Input value="Completed" disabled />
            </FormField>
            <FormField label="Priority">
              <Select value={priority ?? rule.evaluationPriority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Most Recent Completed">最新完成的评价（Most Recent Completed）</SelectItem>
                  <SelectItem value="Initial Completed">首次完成的评价（Initial Completed）</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <p className="text-xs text-muted-foreground">Human Review 属于具体 Evaluation，不进入 Selection Priority。</p>
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader title="Score / Weight" description="规则源来自 Effective Result 中可用于业务解释的 Criterion / Field" />
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>评价项 / 字段</TableHead>
                  <TableHead>结果类型</TableHead>
                  <TableHead>评分规则</TableHead>
                  <TableHead className="text-right">权重</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rule.scoreRules.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">{row.criterion}</TableCell>
                    <TableCell className="text-xs">{row.resultType}</TableCell>
                    <TableCell className="font-mono text-xs">{row.scoringRule}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.weight}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader title="Overall / Critical" description="Critical 是业务派生规则，不回写 AI Structured Result" />
          <FormField label="Overall Rule">
            <Input defaultValue={rule.overall.rule} />
          </FormField>
          <div className="space-y-1.5">
            {rule.criticalRules.map((row) => (
              <div key={row.id} className="flex items-center justify-between rounded-md border border-red-200 bg-red-50/60 px-3 py-2 text-xs dark:border-red-500/20 dark:bg-red-500/10">
                <span className="font-mono">{row.condition}</span>
                <span className="text-muted-foreground">→ {row.effect}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4 rounded-lg border bg-card p-4">
          <SectionHeader title="Risk / Level / Derived Labels" />
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Risk Mapping</div>
            <div className="space-y-1.5">
              {rule.riskMapping.map((row) => (
                <div key={row.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs">
                  <span>{row.condition}</span>
                  <StatusBadge status={row.risk === "Critical" ? "FAILED" : row.risk === "High" ? "PARTIAL_SUCCESS" : "SUCCESS"} label={row.risk} />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Level</div>
              <div className="space-y-1.5">
                {rule.levels.map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs">
                    <span className="tabular-nums">{row.range}</span>
                    <span className="font-medium">{row.level}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Derived Labels</div>
              <div className="space-y-1.5">
                {rule.derivedLabels.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无派生标签</p>
                ) : (
                  rule.derivedLabels.map((row) => (
                    <div key={row.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs">
                      <span>{row.condition}</span>
                      <Badge variant="outline">{row.label}</Badge>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </fieldset>

      {/* Validate Sheet */}
      <Sheet open={validateOpen} onOpenChange={setValidateOpen}>
        <SheetContent className="w-[400px]">
          <SheetHeader>
            <SheetTitle>验证</SheetTitle>
            <SheetDescription>只做规则完整性与可执行性检查，不运行生产 Analysis Task</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {[
              { label: "Evaluation Selection 完整", ok: true },
              { label: "规则引用有效（Criterion 来自正式 Schema）", ok: true },
              { label: "必填配置完整（权重合计 = 100）", ok: rule.scoreRules.reduce((a, r) => a + r.weight, 0) === 100 },
              { label: "Mapping 可执行", ok: true },
              { label: "不存在明显冲突 / 无效规则", ok: true },
            ].map((check) => (
              <div key={check.label} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <StatusIcon tone={check.ok ? "success" : "danger"} />
                {check.label}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Publish Dialog */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发布 Result Rules</DialogTitle>
            <DialogDescription>新 Rules Version 不覆盖历史 Run / Derived Result</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md bg-muted/60 px-3 py-2 text-xs">
              <div>Agent：{rule.agentName}</div>
              <div>Priority：{priority ?? rule.evaluationPriority}</div>
              <div>变更摘要：权重 / Critical / Risk Mapping 调整</div>
            </div>
            <Textarea placeholder="Version Note（必填）" className="min-h-16 text-xs" value={versionNote} onChange={(e) => setVersionNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>取消</Button>
            <Button disabled={!versionNote.trim()} onClick={() => { setPublishOpen(false); toast.success("Rules 已发布新版本") }}>发布</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version History Sheet */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-[380px]">
          <SheetHeader>
            <SheetTitle>版本历史</SheetTitle>
            <SheetDescription>历史 Published Version 只读，可基于此版本创建 Draft</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {rule.versions.map((v) => (
              <div key={v.version} className="rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{v.version}</span>
                  <StatusBadge status={v.status} />
                </div>
                {v.versionNote ? <div className="mt-1 text-xs text-muted-foreground">{v.versionNote}</div> : null}
                {v.publishedBy ? <div className="mt-0.5 text-[11px] text-muted-foreground">{v.publishedBy}</div> : null}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}
