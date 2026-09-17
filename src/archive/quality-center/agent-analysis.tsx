import { CircleAlert } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageContainer, PageHeader, SectionHeader } from "@/components/app/page"
import { TableSkeleton } from "@/components/app/list-state"
import { TableFrame } from "@/components/app/table-frame"
import { GlobalFilters } from "@/components/quality/global-filters"
import { useAsyncData } from "@/hooks/use-async-data"
import { useListQuery } from "@/hooks/use-list-query"
import { formatCompactDateTime, formatCallDuration } from "@/lib/time"
import { parseListFilters, serializeListFilters } from "@/lib/list-filters"
import { realAgentAnalysis } from "@/services/wf-api"
import { RiskBadge } from "@/components/app/status-badge"

const trendConfig = { value: { label: "指标", color: "var(--chart-2)" } } satisfies ChartConfig

export default function AgentAnalysisPage() {
  const navigate = useNavigate()
  const { params, update } = useListQuery(20)
  const filters = useMemo(() => parseListFilters(params.filters), [params.filters])
  const [view, setView] = useState<"team" | "agent">("team")

  const { data, loading, error, retry } = useAsyncData(
    () => realAgentAnalysis(), [params.filters])

  const setFilters = (next: Record<string, string>) => update({ filters: serializeListFilters(next) }, true)
  const drillTo = (extra: Record<string, string>) => {
    const merged = { ...filters, ...extra }
    delete merged.time
    navigate(`/quality/results?filters=${encodeURIComponent(serializeListFilters(merged))}`)
  }

  const agentScope = filters.agent

  return (
    <PageContainer wide className="space-y-4">
      <PageHeader title="坐席分析" description="从组织和坐席维度定位服务质量问题" />

      <Tabs value={agentScope ? "agent" : view} onValueChange={(v) => { setView(v as "team" | "agent"); if (v === "team" || v === "agent") { const next = { ...filters }; delete next.agent; setFilters(next) } }}>
        <TabsList>
          <TabsTrigger value="team">班组</TabsTrigger>
          <TabsTrigger value="agent">坐席</TabsTrigger>
        </TabsList>
      </Tabs>

      <GlobalFilters value={filters} onChange={setFilters} />

      {error ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm">
          坐席分析加载失败
          <div className="mt-3"><Button variant="outline" size="sm" onClick={retry}>重新加载</Button></div>
        </div>
      ) : loading || !data ? (
        <TableSkeleton rows={6} columns={8} />
      ) : (
        <>
          {/* Scope Summary */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {data.scopeSummary.map((k) => (
              <Card key={k.label} className="py-0">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">{k.label}</div>
                  <div className="mt-1.5 text-2xl font-semibold tabular-nums">{k.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Trend + 需要关注 */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">质量趋势</CardTitle></CardHeader>
              <CardContent>
                <ChartContainer config={trendConfig} className="h-56 w-full">
                  <AreaChart data={data.trend} margin={{ left: 0, right: 12 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} width={32} />
                    <Tooltip content={<ChartTooltipContent />} />
                    <Area type="monotone" dataKey="avgScore" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.12} strokeWidth={2} name="平均质量得分" />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">需要关注</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {data.attentionAgents.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">当前没有需要关注的坐席</p>
                ) : (
                  data.attentionAgents.map((a) => (
                    <div key={a.agent} className="rounded-md border px-3 py-2">
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        <CircleAlert className="size-3.5 text-amber-600" />
                        {a.agent}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{a.reason}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">对应 Criterion：{a.criterion}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* 班组 / 坐席 Data Table */}
          {view === "team" && !agentScope ? (
            <div className="space-y-2">
              <SectionHeader title="班组" description="点击班组切换到坐席视图" />
              <TableFrame>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>班组</TableHead>
                      <TableHead className="text-right">有效质检</TableHead>
                      <TableHead className="text-right">平均分</TableHead>
                      <TableHead className="text-right">问题交互率</TableHead>
                      <TableHead className="text-right">Critical</TableHead>
                      <TableHead>主要质量问题</TableHead>
                      <TableHead>问题集中场景</TableHead>
                      <TableHead className="text-right">趋势</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.teams.map((t) => (
                      <TableRow
                        key={t.team}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => { setView("agent"); setFilters({ ...filters, team: t.team }) }}
                      >
                        <TableCell>
                          <div className="text-sm font-medium">{t.team}</div>
                          <div className="text-xs text-muted-foreground">{t.department}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{t.valid}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.avgScore}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.issueRate}%</TableCell>
                        <TableCell className="text-right tabular-nums">{t.critical}</TableCell>
                        <TableCell>
                          <button type="button" className="underline-offset-4 hover:underline" onClick={(e) => { e.stopPropagation(); drillTo({ team: t.team, criterion: t.topProblem }) }}>
                            {t.topProblem}
                          </button>
                        </TableCell>
                        <TableCell>
                          <button type="button" className="underline-offset-4 hover:underline" onClick={(e) => { e.stopPropagation(); drillTo({ team: t.team, serviceType: t.topScene }) }}>
                            {t.topScene}
                          </button>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{t.delta}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableFrame>
            </div>
          ) : (
            <div className="space-y-2">
              <SectionHeader title={agentScope ? `坐席 · ${agentScope}` : "坐席"} description="点击坐席查看其 Scope" />
              <TableFrame>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>坐席</TableHead>
                      <TableHead>班组</TableHead>
                      <TableHead className="text-right">有效质检</TableHead>
                      <TableHead className="text-right">平均分</TableHead>
                      <TableHead className="text-right">问题交互率</TableHead>
                      <TableHead className="text-right">Critical</TableHead>
                      <TableHead>主要质量问题</TableHead>
                      <TableHead>问题集中场景</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.agents
                      .filter((a) => !filters.team || a.team === filters.team)
                      .map((a) => (
                        <TableRow
                          key={a.agent}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setFilters({ ...filters, agent: a.agent })}
                        >
                          <TableCell className="text-sm font-medium">{a.agent}</TableCell>
                          <TableCell className="text-sm">{a.team}</TableCell>
                          <TableCell className="text-right tabular-nums">{a.valid}</TableCell>
                          <TableCell className="text-right tabular-nums">{a.avgScore}</TableCell>
                          <TableCell className="text-right tabular-nums">{a.issueRate}%</TableCell>
                          <TableCell className="text-right tabular-nums">{a.critical}</TableCell>
                          <TableCell>
                            <button type="button" className="underline-offset-4 hover:underline" onClick={(e) => { e.stopPropagation(); drillTo({ agent: a.agent, criterion: a.topProblem }) }}>
                              {a.topProblem}
                            </button>
                          </TableCell>
                          <TableCell>
                            <button type="button" className="underline-offset-4 hover:underline" onClick={(e) => { e.stopPropagation(); drillTo({ agent: a.agent, serviceType: a.topScene }) }}>
                              {a.topScene}
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </TableFrame>
            </div>
          )}

          {/* 主要质量问题 + 问题集中场景 */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">主要质量问题</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.problems.map((p) => (
                  <button
                    key={p.criterion}
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
                    onClick={() => drillTo(agentScope ? { agent: agentScope, criterion: p.criterion } : { criterion: p.criterion })}
                  >
                    <span>{p.criterion}</span>
                    <span className="text-xs text-muted-foreground">{p.affected} 条 · {p.rate}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">问题集中场景</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.scenes.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
                    onClick={() => drillTo({ serviceType: s.name })}
                  >
                    <span>{s.name}</span>
                    <span className="text-xs text-muted-foreground">平均 {s.avgScore} 分 · {s.count} 条</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* 坐席 Scope：相关 Interaction */}
          {agentScope ? (
            <div className="space-y-2">
              <SectionHeader
                title="相关 Interaction"
                description={`${agentScope} 最近的问题交互`}
                actions={
                  <Button variant="outline" size="sm" onClick={() => drillTo({ agent: agentScope })}>
                    查看全部质量结果
                  </Button>
                }
              />
              <TableFrame>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>业务场景</TableHead>
                      <TableHead>消费者诉求</TableHead>
                      <TableHead className="text-right">质量结果</TableHead>
                      <TableHead>风险</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.related.map((r) => (
                      <TableRow key={r.interactionId} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/quality/results/${r.interactionId}`)}>
                        <TableCell className="text-sm tabular-nums">{formatCompactDateTime(r.interactionTime)}</TableCell>
                        <TableCell>
                          <div className="text-sm">{r.businessContext.serviceType}</div>
                          <div className="text-xs text-muted-foreground">{r.businessContext.productCategory} · {r.businessContext.issueTopic}</div>
                        </TableCell>
                        <TableCell><div className="line-clamp-1 max-w-md text-sm">{r.requestSummary}</div></TableCell>
                        <TableCell className="text-right">
                          <div className="text-sm tabular-nums">{r.score !== undefined ? `${r.score} 分` : "—"}</div>
                          {r.durationSeconds ? <div className="text-xs text-muted-foreground">{formatCallDuration(r.durationSeconds)}</div> : null}
                        </TableCell>
                        <TableCell><RiskBadge risk={r.risk} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableFrame>
            </div>
          ) : null}
        </>
      )}
    </PageContainer>
  )
}
