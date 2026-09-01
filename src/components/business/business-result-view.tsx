import type { BusinessResultDTO } from "@/services/api-types"

const STATUS_LABELS: Record<string, string> = {
  "in-scope": "业务范围内",
  "partially-in-scope": "部分在业务范围内",
  "out-of-scope": "业务范围外",
  "insufficient-content": "内容不足",
  available: "已产出",
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{children}</span>
}

export function BusinessResultSummary({ result }: { result: BusinessResultDTO }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="truncate text-sm font-medium">{result.title || "结构化业务结果"}</div>
      {result.summary ? <div className="line-clamp-2 max-w-2xl text-xs text-muted-foreground">{result.summary}</div> : null}
      {result.scenarios.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {result.scenarios.map((scenario) => <Tag key={scenario.id}>{scenario.label}</Tag>)}
        </div>
      ) : null}
    </div>
  )
}

export function BusinessResultView({ result }: { result: BusinessResultDTO }) {
  if (result.kind !== "consumer-analysis") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{result.title}</h3>
            <Tag>{STATUS_LABELS[result.status] ?? result.status}</Tag>
          </div>
          {result.summary ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{result.summary}</p> : null}
        </div>
        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">查看原始结构化输出</summary>
          <pre className="max-h-[520px] overflow-auto border-t p-4 text-xs">{JSON.stringify(result.output, null, 2)}</pre>
        </details>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{result.title}</h3>
          <Tag>{STATUS_LABELS[result.status] ?? result.status}</Tag>
          {result.callId ? <span className="ml-auto font-mono text-xs text-muted-foreground">{result.callId}</span> : null}
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{result.summary || "暂无摘要"}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {result.scenarios.map((scenario) => <Tag key={scenario.id}>场景：{scenario.label}</Tag>)}
          {result.intentions.map((intention) => <Tag key={intention}>诉求：{intention}</Tag>)}
        </div>
      </div>

      {result.segments.map((segment, index) => (
        <div key={segment.id || index} className="rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">片段 {index + 1}</span>
            <Tag>{segment.scenarioLabel}</Tag>
            <Tag>{segment.usefulnessLabel}</Tag>
            <span className="ml-auto text-xs text-muted-foreground">
              消息 {segment.startIndex ?? "—"}–{segment.endIndex ?? "—"}
            </span>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">消费者诉求</div>
              <div className="mt-1 text-sm">{segment.intention || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">回应有用性依据</div>
              <div className="mt-1 text-sm">{segment.usefulnessReason || "—"}</div>
            </div>
          </div>
          {segment.entities.length > 0 ? (
            <div className="mt-3 border-t pt-3">
              <div className="mb-2 text-xs text-muted-foreground">识别实体</div>
              <div className="flex flex-wrap gap-2">
                {segment.entities.map((entity, entityIndex) => (
                  <span key={`${entity.typeId}-${entity.subtypeId}-${entity.mention}-${entityIndex}`} className="rounded-md border px-2 py-1 text-xs">
                    {entity.normalizedName || entity.mention}
                    {entity.masterCode ? ` · ${entity.masterCode}` : ""}
                    {entity.resolutionStatus ? ` · ${entity.resolutionStatus}` : ""}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {segment.evidenceMessageIndexes.length > 0 ? (
            <div className="mt-2 text-xs text-muted-foreground">证据消息：{segment.evidenceMessageIndexes.join("、")}</div>
          ) : null}
        </div>
      ))}

      <details className="rounded-lg border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">查看原始结构化输出</summary>
        <pre className="max-h-[520px] overflow-auto border-t p-4 text-xs">{JSON.stringify(result.output, null, 2)}</pre>
      </details>
    </div>
  )
}
