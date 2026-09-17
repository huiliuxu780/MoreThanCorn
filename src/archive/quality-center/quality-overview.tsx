import { ArrowDownRight, ArrowUpRight, CircleAlert, Minus } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Area,
  AreaChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { PageContainer, PageHeader, SectionHeader } from "@/components/app/page"
import { RiskBadge } from "@/components/app/status-badge"
import { TableSkeleton } from "@/components/app/list-state"
import { GlobalFilters } from "@/components/quality/global-filters"
import { useListQuery } from "@/hooks/use-list-query"
import { useAsyncData } from "@/hooks/use-async-data"
import { realQualityOverview } from "@/services/wf-api"
import { parseListFilters, serializeListFilters } from "@/lib/list-filters"
import { cn } from "@/lib/utils"

const trendChartConfig = {
  value: { label: "指标", color: "var(--chart-1)" },
} satisfies ChartConfig

const sceneChartConfig = {
  avgScore: { label: "平均质量得分", color: "var(--chart-3)" },
} satisfies ChartConfig

export default function QualityOverviewPage() {
  const navigate = useNavigate()
  const { params, update } = useListQuery(20)
  const [metric, setMetric] = useState<"avgScore" | "issueRate" | "critical">("avgScore")
  const [sceneDim, setSceneDim] = useState("serviceType")

  const { data, loading, error, retry } = useAsyncData(
    () => realQualityOverview(),
    [params.filters, sceneDim],
  )

  const filters = useMemo(() => parseListFilters(params.filters), [params.filters])

  const drillTo = (extra: Record<string, string>) => {
    const merged = { ...filters, ...extra }
    delete merged.time
    navigate(`/quality/results?filters=${encodeURIComponent(serializeListFilters(merged))}`)
  }

  const metricLabel =
    metric === "avgScore" ? "平均质量得分" : metric === "issueRate" ? "问题交互率" : "Critical"

  return (
    <PageContainer wide className="space-y-4">
      <PageHeader title="质量总览" description="查看坐席服务质量、主要问题与异常变化" />

      <GlobalFilters value={filters} onChange={(next) => update({ filters: serializeListFilters(next) }, true)} />

      {error ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm">
          质量总览加载失败
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={retry}>重新加载</Button>
          </div>
        </div>
      ) : loading || !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-24 rounded-lg border bg-card p-4">
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                <div className="mt-3 h-6 w-14 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
          <TableSkeleton rows={5} columns={6} />
        </div>
      ) : (
        <>
          {/* ② KPI ×5 */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {data.kpis.map((kpi) => (
              <Card key={kpi.label} className="py-0">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">{kpi.label}</div>
                  <div className="mt-1.5 text-2xl font-semibold tabular-nums">{kpi.value}</div>
                  <div
                    className={cn(
                      "mt-1 flex items-center gap-1 text-xs",
                      kpi.deltaTone === "success" && "text-emerald-600",
                      kpi.deltaTone === "danger" && "text-red-600",
                      kpi.deltaTone === "warning" && "text-amber-600",
                      kpi.deltaTone === "neutral" && "text-muted-foreground",
                    )}
                  >
                    {kpi.deltaTone === "success" ? (
                      <ArrowDownRight className="size-3" />
                    ) : kpi.deltaTone === "neutral" ? (
                      <Minus className="size-3" />
                    ) : (
                      <ArrowUpRight className="size-3" />
                    )}
                    {kpi.delta}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ③ Quality Trend + 需要关注 */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-semibold">质量趋势</CardTitle>
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={metric}
                  onValueChange={(v) => v && setMetric(v as typeof metric)}
                >
                  <ToggleGroupItem value="avgScore">平均质量得分</ToggleGroupItem>
                  <ToggleGroupItem value="issueRate">问题交互率</ToggleGroupItem>
                  <ToggleGroupItem value="critical">Critical</ToggleGroupItem>
                </ToggleGroup>
              </CardHeader>
              <CardContent>
                <ChartContainer config={trendChartConfig} className="h-64 w-full">
                  <AreaChart data={data.trend} margin={{ left: 0, right: 12 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} width={32} />
                    <Tooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey={metric}
                      stroke="var(--color-chart-1)"
                      fill="var(--color-chart-1)"
                      fillOpacity={0.12}
                      strokeWidth={2}
                      name={metricLabel}
                    />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">需要关注</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.attention.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">当前没有需要关注的异常</p>
                ) : (
                  data.attention.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => drillTo(item.link.filters)}
                      className="block w-full rounded-md border px-3 py-2 text-left hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        <CircleAlert className="size-3.5 text-amber-600" />
                        {item.title}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{item.detail}</div>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* ④ 主要质量问题 */}
          <div className="space-y-2">
            <SectionHeader title="主要质量问题" description="按受影响 Interaction 统计" />
            <div className="overflow-hidden rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>质量问题</TableHead>
                    <TableHead className="text-right">影响 Interaction</TableHead>
                    <TableHead className="text-right">影响率</TableHead>
                    <TableHead className="text-right">较上周期</TableHead>
                    <TableHead>风险</TableHead>
                    <TableHead>主要场景</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topIssues.map((issue) => (
                    <TableRow
                      key={issue.criterion}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => drillTo({ criterion: issue.criterion })}
                    >
                      <TableCell>
                        <div className="text-sm font-medium">{issue.criterion}</div>
                        <div className="text-xs text-muted-foreground">{issue.section}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{issue.affected}</TableCell>
                      <TableCell className="text-right tabular-nums">{issue.rate}</TableCell>
                      <TableCell className="text-right tabular-nums">{issue.delta}</TableCell>
                      <TableCell><RiskBadge risk={issue.risk} /></TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="text-sm text-foreground underline-offset-4 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation()
                            drillTo({ criterion: issue.criterion, serviceType: issue.scene })
                          }}
                        >
                          {issue.scene}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* ⑤ 场景质量 */}
          <div className="space-y-2">
            <SectionHeader
              title="场景质量"
              description="点击条目下钻质量结果"
              actions={
                <Select value={sceneDim} onValueChange={setSceneDim}>
                  <SelectTrigger className="h-8 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="serviceType">Service Type</SelectItem>
                    <SelectItem value="productCategory">Product Category</SelectItem>
                    <SelectItem value="issue">Issue / Topic</SelectItem>
                    <SelectItem value="brand">Brand</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            <Card>
              <CardContent className="pt-4">
                <ChartContainer config={sceneChartConfig} className="h-56 w-full">
                  <BarChart data={data.sceneQuality} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                    <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} domain={[0, 100]} />
                    <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} fontSize={12} width={88} />
                    <Tooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="avgScore"
                      fill="var(--color-chart-3)"
                      radius={[0, 4, 4, 0]}
                      barSize={14}
                      onClick={(entry) => {
                        const name = (entry as unknown as { name?: string }).name
                        if (!name) return
                        const key =
                          sceneDim === "productCategory" ? "productCategory" : sceneDim === "issue" ? "issue" : sceneDim === "brand" ? "brand" : "serviceType"
                        drillTo({ [key]: name })
                      }}
                      className="cursor-pointer"
                    />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </PageContainer>
  )
}
