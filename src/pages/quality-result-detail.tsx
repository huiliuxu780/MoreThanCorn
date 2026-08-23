import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/app/list-state"
import { ReviewBadge, RiskBadge, StatusBadge } from "@/components/app/status-badge"
import { useAsyncData } from "@/hooks/use-async-data"
import { formatDateTime, formatSeconds } from "@/lib/time"
import { getQualityResult, listQualityResults } from "@/services/mock-service"
import { bizApi, realQualityDetail, wfEnabled } from "@/services/wf-api"
import type { CriterionResult } from "@/domain/types"
import { cn } from "@/lib/utils"

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" })
}

export default function QualityResultDetailPage() {
  const { interactionId = "" } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fromQuery = searchParams.get("from") ?? ""

  const { data: detail, loading, error, retry } = useAsyncData(
    () => (wfEnabled() ? (realQualityDetail(interactionId) as unknown as ReturnType<typeof getQualityResult>) : getQualityResult(interactionId)),
    [interactionId],
  )
  const { data: siblingList } = useAsyncData(
    () =>
      listQualityResults({
        ...Object.fromEntries(new URLSearchParams(fromQuery)),
        page: 1,
        pageSize: 100,
      }),
    [fromQuery],
  )

  const [reviewMode, setReviewMode] = useState(searchParams.get("review") === "1")
  const [humanEdits, setHumanEdits] = useState<Record<string, { result?: string; comment?: string }>>({})
  const [completeOpen, setCompleteOpen] = useState(false)
  const [traceOpen, setTraceOpen] = useState(false)
  const [activeSegment, setActiveSegment] = useState<string | null>(null)
  const [activeCriterion, setActiveCriterion] = useState<string | null>(null)
  const [activeFact, setActiveFact] = useState<string | null>(null)
  const [openCriteria, setOpenCriteria] = useState<Record<string, boolean>>({})
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      setPlayhead((s) => {
        if (detail && s >= (detail.durationSeconds ?? 0)) {
          setPlaying(false)
          return s
        }
        return s + 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [playing, detail])

  const siblings = useMemo(() => siblingList?.items ?? [], [siblingList])
  const currentIndex = siblings.findIndex((r) => r.interactionId === interactionId)
  const prev = currentIndex > 0 ? siblings[currentIndex - 1] : null
  const next = currentIndex >= 0 && currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null

  const isCriterionOpen = (c: CriterionResult) =>
    openCriteria[c.id] ?? (c.result === "FAIL" || c.severity === "Critical")

  const editedCount = Object.keys(humanEdits).filter((id) => humanEdits[id].result || humanEdits[id].comment).length

  if (error) {
    return (
      <div className="p-6">
        <ErrorState title="质量结果加载失败" onRetry={retry} />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header / Context */}
      <div className="shrink-0 border-b bg-background px-5 pt-3 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate(-1)}>
            <ArrowLeft className="size-4" /> 质量结果
          </Button>
          <span className="text-sm font-semibold">Interaction #{interactionId}</span>
          {detail ? (
            <>
              <RiskBadge risk={detail.risk} />
              <ReviewBadge status={detail.review.status} />
              {detail.critical ? <Badge variant="danger">Critical</Badge> : null}
            </>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            {currentIndex >= 0 ? (
              <>
                <Button variant="outline" size="sm" disabled={!prev} onClick={() => prev && navigate(`/quality/results/${prev.interactionId}?from=${encodeURIComponent(fromQuery)}`)}>
                  ‹ 上一条
                </Button>
                <Button variant="outline" size="sm" disabled={!next} onClick={() => next && navigate(`/quality/results/${next.interactionId}?from=${encodeURIComponent(fromQuery)}`)}>
                  下一条 ›
                </Button>
                <Separator orientation="vertical" className="mx-1 h-5" />
              </>
            ) : null}
            {!reviewMode ? (
              <Button size="sm" onClick={() => setReviewMode(true)}>进入复核</Button>
            ) : (
              <>
                <Badge variant="info">复核中</Badge>
                <Button variant="outline" size="sm" onClick={() => setReviewMode(false)}>取消</Button>
                <Button size="sm" onClick={() => setCompleteOpen(true)}>完成复核</Button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8"><MoreHorizontal className="size-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setTraceOpen(true)}>查看运行详情</DropdownMenuItem>
                <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(interactionId); toast.success("已复制 Interaction ID") }}>
                  复制 Interaction ID
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {detail ? (
          <>
            <div className="mt-2 text-xs text-muted-foreground">
              {detail.org.agentName} · {detail.org.teamName}
              <span className="mx-1.5">·</span>
              {detail.businessContext.serviceType} · {detail.businessContext.productCategory} · {detail.businessContext.issueTopic}
              <span className="mx-1.5">·</span>
              {formatDateTime(detail.interactionTime)}
              {detail.durationSeconds ? <span> · {Math.floor(detail.durationSeconds / 60)}m {detail.durationSeconds % 60}s</span> : null}
            </div>
            <div className="mt-2 rounded-md bg-muted/60 px-3 py-2">
              <div className="text-[11px] font-medium text-muted-foreground">消费者诉求</div>
              <div className="mt-0.5 text-sm">{detail.requestSummary}</div>
            </div>
          </>
        ) : loading ? (
          <Skeleton className="mt-2 h-10 w-full" />
        ) : null}
      </div>

      {/* 三栏 Evidence Workspace */}
      <div className="min-h-0 flex-1">
        {loading || !detail ? (
          <div className="grid h-full grid-cols-3 gap-px bg-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-3 bg-background p-4">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            {/* Conversation 42% */}
            <ResizablePanel defaultSize={42} minSize={28}>
              <ScrollArea className="h-full">
                <div className="space-y-3 p-4">
                  <div className="text-sm font-semibold">Conversation</div>
                  {detail.hasAudio ? (
                    <div className="rounded-lg border bg-card px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => setPlaying((p) => !p)}>
                          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                        </Button>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatSeconds(playhead)} / {formatSeconds(detail.durationSeconds ?? 0)}
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="size-6" onClick={() => setPlayhead((s) => Math.max(0, s - 10))}>
                            <RotateCcw className="size-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-6" onClick={() => setPlayhead((s) => Math.min(detail.durationSeconds ?? 0, s + 10))}>
                            <RotateCw className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                      <Slider
                        className="mt-2"
                        value={[playhead]}
                        max={detail.durationSeconds ?? 0}
                        step={1}
                        onValueChange={([v]) => setPlayhead(v)}
                      />
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    {detail.transcript.map((seg) => {
                      const referenced = (seg.criterionRefs ?? []).length > 0
                      return (
                        <div
                          key={seg.id}
                          id={`seg-${seg.id}`}
                          onClick={() => referenced && seg.criterionRefs?.[0] && (setActiveCriterion(seg.criterionRefs[0]), scrollToId(`crit-${seg.criterionRefs[0]}`), setOpenCriteria((o) => ({ ...o, [seg.criterionRefs![0]]: true })))}
                          className={cn(
                            "rounded-md px-3 py-2 text-sm transition-colors",
                            referenced && "cursor-pointer border border-amber-200/70 bg-amber-50/60 dark:border-amber-500/20 dark:bg-amber-500/10",
                            activeSegment === seg.id && "ring-2 ring-ring/40",
                          )}
                        >
                          <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                            <span className={cn("font-medium", seg.speaker === "agent" ? "text-foreground" : "text-foreground")}>
                              {seg.speakerLabel}
                            </span>
                            <span className="tabular-nums">{formatSeconds(seg.startSeconds)}</span>
                          </div>
                          <div className="mt-0.5 leading-6">{seg.text}</div>
                          {referenced ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {seg.criterionRefs!.map((ref) => {
                                const crit = detail.sections.flatMap((s) => s.criteria).find((c) => c.id === ref)
                                return crit ? (
                                  <Badge key={ref} variant={crit.result === "FAIL" ? "danger" : "neutral"} className="text-[10px]">
                                    {crit.criterion}
                                  </Badge>
                                ) : null
                              })}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </ScrollArea>
            </ResizablePanel>
            <ResizableHandle withHandle />

            {/* Quality Evaluation 33% */}
            <ResizablePanel defaultSize={33} minSize={24}>
              <ScrollArea className="h-full">
                <div className="space-y-3 p-4">
                  <div className="text-sm font-semibold">Quality Evaluation</div>
                  <div className="rounded-lg border bg-card px-4 py-3">
                    <div className="flex items-baseline gap-3">
                      <span className="text-2xl font-semibold tabular-nums">
                        {detail.score !== undefined ? `${detail.score} 分` : "—"}
                      </span>
                      <RiskBadge risk={detail.risk} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {detail.issueCount} 个问题{detail.critical ? " · 1 个 Critical" : ""}
                    </div>
                  </div>

                  {detail.sections.map((section) => (
                    <div key={section.section} className="space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">{section.section}</div>
                      {section.criteria.map((criterion) => {
                        const human = humanEdits[criterion.id] ?? criterion.human
                        const open = isCriterionOpen(criterion) || reviewMode || activeCriterion === criterion.id
                        return (
                          <div
                            key={criterion.id}
                            id={`crit-${criterion.id}`}
                            className={cn(
                              "rounded-lg border bg-card",
                              activeCriterion === criterion.id && "ring-2 ring-ring/40",
                            )}
                          >
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-left"
                              onClick={() => setOpenCriteria((o) => ({ ...o, [criterion.id]: !open }))}
                            >
                              {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
                              <span className="flex-1 text-sm font-medium">{criterion.criterion}</span>
                              {criterion.severity === "Critical" ? <Badge variant="danger">Critical</Badge> : null}
                              <StatusBadge status={criterion.result} />
                            </button>
                            {open ? (
                              <div className="space-y-2 border-t px-3 py-2.5 text-sm">
                                {human?.result && human.result !== criterion.result ? (
                                  <div className="rounded-md bg-muted/60 px-2.5 py-1.5 text-xs">
                                    <div className="flex gap-4"><span className="w-14 text-muted-foreground">AI</span><StatusBadge status={criterion.result} /></div>
                                    <div className="mt-1 flex gap-4"><span className="w-14 text-muted-foreground">人工</span><StatusBadge status={human.result} /></div>
                                    <div className="mt-1 flex gap-4"><span className="w-14 text-muted-foreground">Effective</span><StatusBadge status={human.result} /></div>
                                    {detail.review.reviewer ? (
                                      <div className="mt-1 text-[11px] text-muted-foreground">已复核 · {detail.review.reviewer}</div>
                                    ) : null}
                                  </div>
                                ) : null}
                                {criterion.reason ? <p className="text-sm leading-6">{criterion.reason}</p> : null}
                                {(criterion.evidenceSegmentIds ?? []).length > 0 ? (
                                  <div className="space-y-1">
                                    <div className="text-xs text-muted-foreground">Conversation 证据</div>
                                    {(criterion.evidenceSegmentIds ?? []).map((segId) => {
                                      const seg = detail.transcript.find((s) => s.id === segId)
                                      return seg ? (
                                        <button
                                          key={segId}
                                          type="button"
                                          className="block w-full rounded-md border-l-2 border-amber-400 bg-muted/40 px-2.5 py-1.5 text-left text-xs hover:bg-muted/70"
                                          onClick={() => (setActiveSegment(segId), scrollToId(`seg-${segId}`))}
                                        >
                                          <span className="text-muted-foreground">{seg.speakerLabel} · {formatSeconds(seg.startSeconds)}</span>
                                          <span className="ml-1">{seg.text}</span>
                                        </button>
                                      ) : null
                                    })}
                                  </div>
                                ) : null}
                                {(criterion.businessEvidenceIds ?? []).length > 0 ? (
                                  <div className="space-y-1">
                                    <div className="text-xs text-muted-foreground">Business Evidence</div>
                                    {(criterion.businessEvidenceIds ?? []).map((factId) => {
                                      const fact = detail.businessFacts.find((f) => f.id === factId)
                                      return fact ? (
                                        <button
                                          key={factId}
                                          type="button"
                                          className="block w-full rounded-md border-l-2 border-sky-400 bg-muted/40 px-2.5 py-1.5 text-left text-xs hover:bg-muted/70"
                                          onClick={() => (setActiveFact(factId), scrollToId(`fact-${factId}`))}
                                        >
                                          {fact.title}
                                        </button>
                                      ) : null
                                    })}
                                  </div>
                                ) : null}
                                {criterion.confidence !== undefined ? (
                                  <div className="text-xs text-muted-foreground">Confidence {(criterion.confidence * 100).toFixed(0)}%</div>
                                ) : null}

                                {reviewMode ? (
                                  <div className="space-y-2 rounded-md border border-dashed p-2.5">
                                    <div className="flex items-center gap-2 text-xs">
                                      <span className="text-muted-foreground">人工结果</span>
                                      <Select
                                        value={humanEdits[criterion.id]?.result ?? criterion.result}
                                        onValueChange={(v) => setHumanEdits((e) => ({ ...e, [criterion.id]: { ...e[criterion.id], result: v } }))}
                                      >
                                        <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="PASS">PASS</SelectItem>
                                          <SelectItem value="FAIL">FAIL</SelectItem>
                                          <SelectItem value="N/A">N/A</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <Textarea
                                      placeholder="人工说明（可选）"
                                      className="min-h-16 text-xs"
                                      value={humanEdits[criterion.id]?.comment ?? ""}
                                      onChange={(e) => setHumanEdits((ed) => ({ ...ed, [criterion.id]: { ...ed[criterion.id], comment: e.target.value } }))}
                                    />
                                    <div className="flex gap-2 text-xs">
                                      <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => toast.info("已添加当前对话片段作为人工证据（原型）")}>
                                        + 添加当前对话片段
                                      </Button>
                                      <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => toast.info("已添加业务事实作为人工证据（原型）")}>
                                        + 添加业务事实
                                      </Button>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </ResizablePanel>
            <ResizableHandle withHandle />

            {/* Business Facts 25% */}
            <ResizablePanel defaultSize={25} minSize={18}>
              <ScrollArea className="h-full">
                <div className="space-y-3 p-4">
                  <div className="text-sm font-semibold">Business Facts</div>
                  {detail.businessFacts.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">暂无关联业务记录</p>
                  ) : (
                    detail.businessFacts.map((fact) => (
                      <div
                        key={fact.id}
                        id={`fact-${fact.id}`}
                        className={cn("rounded-lg border bg-card px-3 py-2.5", activeFact === fact.id && "ring-2 ring-ring/40")}
                      >
                        <div className="text-sm font-medium">{fact.title}</div>
                        <div className="mt-1.5 space-y-1">
                          {fact.fields.map((f) => (
                            <div key={f.label} className="grid grid-cols-[72px_1fr] gap-2 text-xs">
                              <span className="text-muted-foreground">{f.label}</span>
                              <span>{f.value}</span>
                            </div>
                          ))}
                        </div>
                        {(fact.usedByCriterionIds ?? []).length > 0 ? (
                          <button
                            type="button"
                            className="mt-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
                            onClick={() => {
                              const ref = fact.usedByCriterionIds![0]
                              setActiveCriterion(ref)
                              setOpenCriteria((o) => ({ ...o, [ref]: true }))
                              scrollToId(`crit-${ref}`)
                            }}
                          >
                            Used by {fact.usedByCriterionIds!.length} evaluation{fact.usedByCriterionIds!.length > 1 ? "s" : ""}
                          </button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>

      {/* 完成复核 Dialog */}
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认完成复核？</DialogTitle>
            <DialogDescription>
              已修改 {editedCount} 个评价项；未修改项继续沿用 AI 结果。完成后将基于当前 Result Rules 重新计算 Derived Result。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteOpen(false)}>取消</Button>
            <Button
              onClick={async () => {
                setCompleteOpen(false)
                setReviewMode(false)
                if (wfEnabled()) {
                  await bizApi.review(interactionId, { action: "effective", reviewer: "reviewer" })
                }
                toast.success("复核完成，Effective Result 已更新")
                retry()
              }}
            >
              完成复核
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Technical Trace Sheet */}
      <Sheet open={traceOpen} onOpenChange={setTraceOpen}>
        <SheetContent className="w-[440px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>运行详情</SheetTitle>
            <SheetDescription>高级排查入口：Execution / Agent Version / Tool Calls / Structured Output</SheetDescription>
          </SheetHeader>
          {detail ? (
            <div className="mt-4 space-y-4 text-sm">
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">Execution</div>
                <div className="rounded-md border px-3 py-2 text-xs">
                  <div>Run {detail.execution.runId} · Task {detail.execution.taskId}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusBadge status={detail.execution.status} />
                    <span className="text-muted-foreground">Agent Version {detail.execution.agentVersion}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">Tool Calls</div>
                <div className="rounded-md border px-3 py-2 text-xs">
                  <div className="flex justify-between py-1"><span>查询服务请求 V2</span><StatusBadge status="SUCCESS" /></div>
                  <div className="flex justify-between py-1"><span>搜索知识 V4</span><StatusBadge status="SUCCESS" /></div>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">Structured Output</div>
                <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-[11px] leading-5">
{JSON.stringify(detail.sections.map((s) => ({ section: s.section, criteria: s.criteria.map((c) => ({ criterion: c.criterion, result: c.result })) })), null, 2)}
                </pre>
              </div>
              <p className="text-xs text-muted-foreground">
                <Link className="underline underline-offset-4" to={`/config/tasks/${detail.execution.taskId}/runs/${detail.execution.runId}`}>
                  查看 Run Detail
                </Link>
              </p>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
