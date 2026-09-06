/** 概览子页（原站 /wakers/{id}/home 同构）：工作日志四数字+触发类型环图+核心能力+记忆时间线。
 * 度量：section 卡 r6 边1 pad 18 22 gap22；metric 20/600 + label 12 三级色；cap 行 pad 16 20 gap4 border-b（台账 §2/§5）。 */
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { agentApi, type AgentInfo } from "@/services/wf-api"

interface RunStats {
  sinceDays: number; running: number; done: number; pending: number;
  byStatus: Record<string, number>; byTrigger: Record<string, number>;
  byDay: { date: string; count: number }[];
}
interface TimelineEvent { type: string; note: string; at: string; name?: string; version?: number }

const TRIGGER_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]

function Donut({ byTrigger }: { byTrigger: Record<string, number> }) {
  const entries = Object.entries(byTrigger).filter(([, n]) => n > 0)
  const total = entries.reduce((s, [, n]) => s + n, 0)
  const R = 40
  const C = 2 * Math.PI * R
  let acc = 0
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 100 100" className="size-28 -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--border)" strokeWidth="12" />
        {total > 0 && entries.map(([k, n], i) => {
          const frac = n / total
          const el = (
            <circle key={k} cx="50" cy="50" r={R} fill="none" stroke={TRIGGER_COLORS[i % TRIGGER_COLORS.length]}
              strokeWidth="12" strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-acc * C} />
          )
          acc += frac
          return el
        })}
      </svg>
      <div className="space-y-1">
        <div className="text-[13px] font-medium">任务类型</div>
        {entries.length === 0 && <div className="text-xs text-(--text-tertiary)">暂无运行</div>}
        {entries.map(([k, n], i) => (
          <div key={k} className="flex items-center gap-2 text-xs">
            <span className="size-2 rounded-full" style={{ background: TRIGGER_COLORS[i % TRIGGER_COLORS.length] }} />
            <span className="text-(--text-tertiary)">{k}</span>
            <span className="text-muted-foreground">{n}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AgentHomeSection({ agent }: { agent: AgentInfo }) {
  const [stats, setStats] = useState<RunStats | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const caps = ((agent.config as { capabilities?: { name: string; description: string }[] }).capabilities) ?? []

  useEffect(() => {
    agentApi.runStats(agent.id).then(setStats).catch(() => setStats(null))
    agentApi.memoryTimeline(agent.id).then((r) => setTimeline(r.items)).catch(() => setTimeline([]))
  }, [agent.id])

  const metrics = [
    { v: stats?.sinceDays ?? 0, unit: "天", label: "入职天数" },
    { v: stats?.running ?? 0, unit: "", label: "进行中" },
    { v: stats?.done ?? 0, unit: "", label: "已完成" },
    { v: stats?.pending ?? 0, unit: "", label: "待处理" },
  ]

  return (
    <div className="mx-auto max-w-[700px] space-y-4">
      {/* 工作日志 */}
      <section className="space-y-[22px] rounded-md border bg-surface p-[18px_22px]">
        <h3 className="text-base font-medium leading-6">工作日志</h3>
        <div className="grid grid-cols-4 rounded-md bg-(--segment-bg)">
          {metrics.map((m) => (
            <div key={m.label} className="space-y-1 px-4 py-3">
              <div className="flex items-baseline gap-1 text-xl font-semibold leading-6">
                {m.v}{m.unit && <span className="text-xs font-normal">{m.unit}</span>}
              </div>
              <div className="text-xs leading-4 text-(--text-tertiary)">{m.label}</div>
            </div>
          ))}
        </div>
        <Donut byTrigger={stats?.byTrigger ?? {}} />
      </section>

      {/* 核心能力 */}
      <section className="rounded-md border bg-surface">
        <h3 className="px-5 pt-[18px] text-base font-medium leading-6">核心能力（{caps.length}）</h3>
        {caps.length === 0 ? (
          <p className="px-5 py-4 text-xs text-(--text-tertiary)">
            尚未填写核心能力，去<Link className="underline" to={`/agents/${agent.id}/config`}>配置</Link>页补充。
          </p>
        ) : caps.map((c, i) => (
          <div key={i} className={`space-y-1 px-5 py-4 ${i < caps.length - 1 ? "border-b" : ""}`}
            style={{ borderColor: "var(--border)" }}>
            <div className="text-[15px] font-medium leading-6">{c.name}</div>
            <div className="text-xs leading-5 text-(--text-tertiary)">{c.description}</div>
          </div>
        ))}
      </section>

      {/* 记忆与学习时间线预览 */}
      <section className="space-y-3 rounded-md border bg-surface p-[18px_22px]">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium leading-6">记忆与学习</h3>
          <Link to={`/agents/${agent.id}/memory`} className="text-xs text-muted-foreground underline">查看完整记忆</Link>
        </div>
        {timeline.length === 0 ? (
          <p className="text-xs text-(--text-tertiary)">暂无记忆或 Skill 变更事件。</p>
        ) : timeline.slice(0, 5).map((e, i) => (
          <div key={i} className="flex items-center gap-3 text-xs">
            <span className="size-2 shrink-0 rounded-full bg-brand" />
            <span className="text-(--text-tertiary)">{e.type === "skill_installed" ? "学到新技能" : "记忆更新"}</span>
            <span className="truncate">{e.note}</span>
            <span className="ml-auto shrink-0 text-(--text-tertiary)">{e.at.slice(0, 10)}</span>
          </div>
        ))}
      </section>
    </div>
  )
}
