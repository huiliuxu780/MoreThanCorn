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
      {/* 身份区（原站 home identity：拍立得 + 名称 26/500 + 角色徽章 + 入职/描述） */}
      <div className="flex items-start gap-6">
        <div className="flex h-[197px] w-[176px] shrink-0 -rotate-3 flex-col items-center rounded-[7px] border bg-surface p-[11px_11px_8px]"
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
        <Donut byTrigger={stats?.byTrigger ?? {}} />
      </section>

      {/* 核心能力 */}
      <section className="flex flex-col gap-3 rounded-lg border bg-surface px-5 py-4">
        <h3 className="text-base font-medium leading-6">核心能力（{caps.length}）</h3>
        {caps.length === 0 ? (
          <p className="px-5 py-4 text-xs text-(--text-tertiary)">
            尚未填写核心能力，去<Link className="underline" to={`/agents/${agent.id}/config`}>配置</Link>页补充。
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
