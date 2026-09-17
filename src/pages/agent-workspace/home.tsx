/** 概览子页（原站 /wakers/{id}/home 同构）：工作日志四数字+触发类型环图+核心能力+记忆时间线。
 * 度量：section 卡 r6 边1 pad 18 22 gap22；metric 20/600 + label 12 三级色；cap 行 pad 16 20 gap4 border-b（台账 §2/§5）。 */
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { agentApi, type AgentInfo } from "@/services/wf-api"
import { avatarFor } from "@/lib/agent-avatar"

interface RunStats {
  sinceDays: number; running: number; done: number; pending: number;
  byStatus: Record<string, number>; byTrigger: Record<string, number>;
  byDay: { date: string; count: number }[];
}
interface TimelineEvent { type: string; note: string; at: string; name?: string; version?: number }

const TRIGGER_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]


/** 活跃度热力图（原站 qc-wr-heatmap 同构：53 周 × 7、月标 13 列、周一/三/五行标、少多图例）。
 * 度量：panel fill-tertiary r6 p16 min-h188；cell 12×12 r3 gap4；levels 见 --heat-l*（台账 §14）。 */
function Heatmap({ byDay }: { byDay: { date: string; count: number }[] }) {
  const counts = new Map(byDay.map((d) => [d.date, d.count]))
  const today = new Date()
  const monday = new Date(today)
  const dow = (monday.getDay() + 6) % 7
  monday.setDate(monday.getDate() - dow)
  const start = new Date(monday)
  start.setDate(start.getDate() - 52 * 7)
  const weeks: { date: Date; count: number; future: boolean }[][] = []
  for (let w = 0; w < 53; w++) {
    const col: { date: Date; count: number; future: boolean }[] = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(start)
      day.setDate(start.getDate() + w * 7 + d)
      const key = day.toISOString().slice(0, 10)
      col.push({ date: day, count: counts.get(key) ?? 0, future: day > today })
    }
    weeks.push(col)
  }
  const months: string[] = []
  let lastMonth = -1
  let labelCount = 0
  for (let w = 0; w < 53; w++) {
    const m = weeks[w][0].date.getMonth()
    if (m !== lastMonth && labelCount < 13) { months.push(`${m + 1}月`); lastMonth = m; labelCount++ }
    else months.push("")
  }
  const level = (c: number) => (c <= 0 ? 0 : c === 1 ? 1 : c <= 3 ? 2 : 3)
  const LEVEL_BG = ["var(--fill-tertiary)", "var(--heat-l1)", "var(--heat-l2)", "var(--heat-l3)"]
  return (
    <div className="min-w-0 flex-1 overflow-x-auto rounded-md bg-(--fill-tertiary) p-4" style={{ minHeight: 188 }}>
      <div className="w-max min-w-full">
        <div className="mb-1.5 ml-[34px] grid gap-1" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
          {months.filter(Boolean).slice(0, 13).map((m, i) => (
            <span key={i} className="whitespace-nowrap text-xs leading-[18px] text-muted-foreground">{m}</span>
          ))}
        </div>
        <div className="flex items-start gap-2">
          <div className="grid w-[26px] shrink-0 grid-rows-7 gap-1" style={{ gridTemplateRows: "repeat(7, 12px)" }}>
            {["", "周一", "", "周三", "", "周五", ""].map((w, i) => (
              <span key={i} className="text-right text-xs leading-[12px] text-muted-foreground">{w}</span>
            ))}
          </div>
          <div className="grid grid-rows-7 gap-1" style={{ gridTemplateRows: "repeat(7, 12px)", gridAutoFlow: "column" }}>
            {weeks.flat().map((c, i) => (
              <span key={i} title={`${c.date.toISOString().slice(0, 10)}，当日任务数：${c.count}`}
                className="block size-3 rounded-[3px]"
                style={{ background: LEVEL_BG[level(c.count)], visibility: c.future ? "hidden" : undefined }} />
            ))}
          </div>
        </div>
        <div className="mt-3.5 flex items-center justify-center gap-1.5 text-xs leading-[18px]">
          <span>少</span>
          {LEVEL_BG.map((bg, i) => <span key={i} className="size-3 rounded-[3px]" style={{ background: bg }} />)}
          <span>多</span>
        </div>
      </div>
    </div>
  )
}

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
    <div className="w-full space-y-4 px-[34px]">
      {/* 身份区（原站 home identity：拍立得 + 名称 26/500 + 角色徽章 + 入职/描述） */}
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex h-[197px] w-[176px] shrink-0 -rotate-3 flex-col items-center rounded-[7px] border bg-surface p-[11px_11px_8px] transition-transform duration-300 hover:rotate-0"
          style={{ borderColor: "var(--border)" }}>
          <span className="block h-[154px] w-[154px] overflow-hidden rounded-[2px] bg-(--fill-tertiary)">
            <img src={avatarFor(agent.id, agent.avatar)} alt="" className="size-full object-cover" />
          </span>
          <span className="pt-2 text-[13px] leading-[19px] text-muted-foreground">ID: {agent.id.slice(0, 8)}</span>
        </div>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[26px] font-medium leading-8">{agent.name}</h2>
            <span className="inline-flex items-center gap-0.5 rounded-lg border px-1.5 py-0.5 text-xs font-medium leading-[14px] text-(--chip-fg)"
              style={{ borderColor: "var(--chip-border)" }}>{agent.typeLabel}</span>
          </div>
          {agent.createdAt
            ? <p className="text-[13px] leading-5 text-muted-foreground">入职时间：{agent.createdAt.slice(0, 10)}</p>
            : null}
          {agent.description
            ? <p className="text-[13px] leading-5 text-muted-foreground">{agent.description}</p>
            : null}
        </div>
      </div>
      {/* 工作日志 */}
      <section className="flex flex-col gap-3 rounded-lg border bg-surface px-5 py-4">
        <h3 className="text-base font-medium leading-6">工作日志</h3>
        <div className="grid grid-cols-4 rounded-lg bg-(--fill-tertiary) p-5">
          {metrics.map((m) => (
            <div key={m.label} className="flex flex-col justify-center gap-1 border-l px-5 first:border-l-0" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-baseline gap-1 text-xl font-semibold leading-6">
                {m.v}{m.unit && <span className="text-xs font-normal">{m.unit}</span>}
              </div>
              <div className="text-xs leading-4 text-(--text-tertiary)">{m.label}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-start gap-6">
          <Heatmap byDay={stats?.byDay ?? []} />
          <Donut byTrigger={stats?.byTrigger ?? {}} />
        </div>
      </section>

      {/* 核心能力 */}
      <section className="flex flex-col gap-3 rounded-lg border bg-surface px-5 py-4">
        <h3 className="text-base font-medium leading-6">核心能力（{caps.length}）</h3>
        {caps.length === 0 ? (
          <p className="px-5 py-4 text-xs text-(--text-tertiary)">
            尚未填写核心能力，去<Link className="underline" to={`/agents/${agent.id}/profile`}>Agent 档案</Link>页「修改」中补充。
          </p>
        ) : caps.map((c, i) => (
          <div key={i} className="flex min-h-[76px] flex-col justify-center gap-1 border-b border-dashed px-5 py-4 last:border-b-0"
            style={{ borderColor: "var(--border)" }}>
            <div className="text-[15px] font-medium leading-6">{c.name}</div>
            <div className="text-xs leading-5 text-(--text-tertiary)">{c.description}</div>
          </div>
        ))}
      </section>

      {/* 记忆与学习时间线预览 */}
      <section className="flex flex-col gap-3 rounded-lg border bg-surface px-5 py-4">
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
