/** Agent「安全与权限」子页（14 号稿 P1，原型 agent-permissions-v1.html v3 同构）：
 *  四概览卡 tab（危险操作确认/敏感文件保护/工具使用权限/企业安全模式）+ 主开关联动灰化
 *  + 工具三态 + 六类守卫 22 规则（子串级；pattern=null 标「规划 P2」不假装生效）+ 诚实占位。
 *  保存写 config.permissions v2；对运行生效需重新发布（冻结进 release 快照）。 */
import * as React from "react"
import { Building2, Folder, ShieldCheck, Wrench } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { agentApi, type AgentInfo } from "@/services/wf-api"
import {
  ESCAPE_SUBRULES,
  GUARD_CATEGORIES,
  TOOL_ROWS,
  mergePermissions,
  type PermissionsV2,
  type ToolBehavior,
} from "@/domain/permission-catalog"
import { cn } from "@/lib/utils"

const BEHAVIOR_LABEL: Record<ToolBehavior, string> = { allow: "直接", ask: "询问", deny: "不可" }

/** 09-16 配置页退役：六工具族装配开关（后端 TOOL_POLICY_KEYS → frozen_tool_policy）
 *  并入本页统一编辑；保存时 v1 族开关与 v2 策略同写 config.permissions——修复此前
 *  本页保存纯 v2 结构导致六族开关被静默重置为全开（normalize_tool_policy 缺键视为开）。 */
const FAMILY_LABELS: [string, string][] = [
  ["shell", "Shell 命令（Bash）"],
  ["file_write", "文件写入（Write/Edit）"],
  ["file_read", "文件读取与检索（Read/Grep/Glob）"],
  ["schedule", "调度管理（Schedule 四件）"],
  ["subagent", "子 Agent 与团队（AgentCreate/Team…）"],
  ["platform_tools", "平台工具（run_workflow/run_agent_flow）"],
]

function OverviewCard({
  icon, status, title, desc, selected, onSelect,
}: {
  icon: React.ReactNode
  status: string
  title: string
  desc: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "rounded-xl border bg-surface p-4 text-left shadow-sm transition-colors",
        selected ? "border-(--status-success) bg-(--status-success-soft)" : "hover:border-brand/50",
      )}
    >
      <span className="mb-3 flex items-center justify-between">
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-lg border",
            selected ? "border-(--status-success) bg-surface text-(--status-success)" : "bg-(--segment-bg) text-muted-foreground",
          )}
        >
          {icon}
        </span>
        <span className={cn("text-[11px] font-semibold", selected ? "text-(--status-success)" : "text-muted-foreground")}>
          {status}
        </span>
      </span>
      <span className="block text-sm font-semibold">{title}</span>
      <span className="mt-1 block text-[11px] leading-[1.55] text-muted-foreground">{desc}</span>
    </button>
  )
}

export function AgentPermissionsSection({ agent, archived }: { agent: AgentInfo; archived?: boolean }) {
  const [perm, setPerm] = React.useState<PermissionsV2>(() =>
    mergePermissions((agent.config as { permissions?: unknown } | undefined)?.permissions),
  )
  const [fam, setFam] = React.useState<Record<string, boolean>>(() => {
    const raw = ((agent.config as { permissions?: Record<string, unknown> } | undefined)?.permissions ?? {}) as Record<string, unknown>
    return Object.fromEntries(FAMILY_LABELS.map(([k]) => [k, raw[k] !== false]))
  })
  const [rev, setRev] = React.useState(agent.configRevision)
  const [tab, setTab] = React.useState(0)
  const [saving, setSaving] = React.useState(false)
  const [newPath, setNewPath] = React.useState("")

  const counts = React.useMemo(() => {
    const c = { allow: 0, ask: 0, deny: 0 }
    for (const row of TOOL_ROWS) for (const n of row.names) c[perm.tools[n] ?? "allow"] += 1
    return c
  }, [perm.tools])

  const save = async () => {
    setSaving(true)
    try {
      const r = await agentApi.update(
        agent.id,
        { config: { ...(agent.config as object), permissions: { ...perm, ...fam } } },
        rev,
      )
      setRev(r.configRevision)
      toast.success("已保存配置草稿；对运行生效需重新发布")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const setTool = (names: string[], b: ToolBehavior) =>
    setPerm((p) => ({ ...p, tools: { ...p.tools, ...Object.fromEntries(names.map((n) => [n, b])) } }))

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h3 className="text-base font-medium leading-6">安全与权限</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          控制这个 Agent 能做什么，以及遇到风险操作时如何处理。保存后写入配置草稿，重新发布后对新的运行生效（已发布版本不可变）。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="tablist" aria-label="权限概览">
        <OverviewCard
          icon={<ShieldCheck className="size-4" />}
          status={perm.master ? "已开启" : "已关闭"}
          title="危险操作确认"
          desc="发现危险命令时暂停执行，由你确认（含六类守卫 22 规则）"
          selected={tab === 0}
          onSelect={() => setTab(0)}
        />
        <OverviewCard
          icon={<Folder className="size-4" />}
          status={`${perm.sensitive_enabled ? "已开启" : "已关闭"} · ${perm.sensitive_paths.length} 路径`}
          title="敏感文件保护"
          desc="访问指定文件或目录前请求确认"
          selected={tab === 1}
          onSelect={() => setTab(1)}
        />
        <OverviewCard
          icon={<Wrench className="size-4" />}
          status={`${counts.allow} 直接 · ${counts.ask} 询问 · ${counts.deny} 不可`}
          title="工具使用权限"
          desc="17 件工具三态策略；不可＝装配期摘除"
          selected={tab === 2}
          onSelect={() => setTab(2)}
        />
        <OverviewCard
          icon={<Building2 className="size-4" />}
          status="已关闭"
          title="企业安全模式"
          desc="使用企业模型，任务数据仅保留在本机（P3 占位）"
          selected={tab === 3}
          onSelect={() => setTab(3)}
        />
      </div>

      {tab === 0 && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-surface p-4">
            <div className="flex items-center gap-3">
              <Switch
                checked={perm.master}
                disabled={archived}
                onCheckedChange={(v) => setPerm((p) => ({ ...p, master: v }))}
                aria-label="危险操作需要确认"
              />
              <div>
                <div className="text-sm font-semibold">危险操作需要确认</div>
                <div className="text-xs text-muted-foreground">
                  开启后，Agent 检测到高风险命令会先暂停执行，并向你请求确认（对话页出现批准/拒绝卡）。
                </div>
              </div>
            </div>
            {!perm.master && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                当前不会检查危险操作，Agent 将按其他已有权限继续执行。严重级规则在 bypass 下自动转为「直接阻止」，不会被静默放行。
              </div>
            )}
          </div>

          <div className={cn("space-y-4", !perm.master && "pointer-events-none opacity-45")}>
            {(["A", "B", "C"] as const).map((g) => (
              <div key={g} className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  {g === "A" ? "A · 命令与系统安全" : g === "B" ? "B · 代码与网络" : "C · 文件与逃逸"}
                  <span className="h-px flex-1 bg-border" />
                </div>
                {GUARD_CATEGORIES.filter((c) => c.group === g).map((cat) => {
                  const st = perm.guards[cat.id]
                  return (
                    <div key={cat.id} className="overflow-hidden rounded-xl border bg-surface">
                      <div className="flex items-center gap-2 border-b bg-(--segment-bg) px-4 py-2.5">
                        <span className="text-sm font-semibold">{cat.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {st?.enabled ? `已启用 ${cat.rules.length}/${cat.rules.length}` : "已停用"}
                        </span>
                        <span className="ml-auto">
                          <Switch
                            checked={st?.enabled ?? true}
                            disabled={archived}
                            onCheckedChange={(v) =>
                              setPerm((p) => ({
                                ...p,
                                guards: { ...p.guards, [cat.id]: { ...(p.guards[cat.id] ?? { enabled: true, rules: {} }), enabled: v } },
                              }))
                            }
                            aria-label={`${cat.name} 启用`}
                          />
                        </span>
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {cat.rules.map((r) => {
                            const handling = st?.rules[r.id] ?? r.def
                            return (
                              <tr key={r.id} className="border-b last:border-0">
                                <td className="px-4 py-2.5 align-top">
                                  <div className="text-foreground">{r.desc}</div>
                                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{r.id}</div>
                                </td>
                                <td className="w-20 px-2 align-top">
                                  <span
                                    className={cn(
                                      "rounded px-1.5 py-0.5 text-[11px] font-semibold",
                                      r.risk === "crit"
                                        ? "bg-(--status-danger-soft) text-(--status-danger)"
                                        : "bg-(--status-warning-soft) text-(--status-warning)",
                                    )}
                                  >
                                    {r.risk === "crit" ? "严重" : "高"}
                                  </span>
                                </td>
                                <td className="w-44 px-2 align-top">
                                  {r.pattern === null ? (
                                    <span className="rounded border border-dashed px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      规划 P2 · 解析器层
                                    </span>
                                  ) : (
                                    <span className="inline-flex overflow-hidden rounded-lg border">
                                      {(["ask", "deny"] as const).map((b) => (
                                        <button
                                          key={b}
                                          type="button"
                                          disabled={archived || !st?.enabled}
                                          className={cn(
                                            "px-2 py-1 text-[11px] font-medium",
                                            handling === b
                                              ? b === "ask"
                                                ? "bg-(--status-warning) text-white"
                                                : "bg-(--status-danger) text-white"
                                              : "text-muted-foreground hover:bg-muted",
                                          )}
                                          onClick={() =>
                                            setPerm((p) => ({
                                              ...p,
                                              guards: {
                                                ...p.guards,
                                                [cat.id]: {
                                                  ...(p.guards[cat.id] ?? { enabled: true, rules: {} }),
                                                  rules: { ...(p.guards[cat.id]?.rules ?? {}), [r.id]: b },
                                                },
                                              },
                                            }))
                                          }
                                        >
                                          {b === "ask" ? "确认后执行" : "直接阻止"}
                                        </button>
                                      ))}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
                {g === "C" && (
                  <div className="overflow-hidden rounded-xl border bg-surface">
                    <div className="flex items-center gap-2 border-b bg-(--segment-bg) px-4 py-2.5">
                      <span className="text-sm font-semibold">Shell 逃逸检测</span>
                      <span className="text-[11px] text-muted-foreground">平台固定安全层 · 7 子规则 · 不可关闭</span>
                    </div>
                    <div className="space-y-2 p-4">
                      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                        {ESCAPE_SUBRULES.map((e) => (
                          <li key={e.name} className="text-[11px] leading-5 text-muted-foreground">
                            <b className="text-foreground">{e.name}</b>{" "}
                            <span className="rounded border px-1 text-[10px]">{e.native ? "原生" : "规划 P2"}</span>
                            ：{e.desc}
                          </li>
                        ))}
                      </ul>
                      <p className="rounded-lg border border-dashed bg-(--segment-bg) px-3 py-2 text-[11px] text-muted-foreground">
                        诚实标注：仅「命令替换」为官方解析器原生执行（bypass-immune）；其余 6 子规则为平台解析器扩展（P2），扩展前标「规划」不假装生效。本层不提供关闭开关。
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 1 && (
        <div className="rounded-xl border bg-surface p-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={perm.sensitive_enabled}
              disabled={archived}
              onCheckedChange={(v) => setPerm((p) => ({ ...p, sensitive_enabled: v }))}
              aria-label="敏感文件保护"
            />
            <div className="text-sm font-semibold">敏感文件保护</div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">访问以下路径（glob）前请求确认；工作目录内的普通读写不受影响。</p>
          <div className="mt-3 space-y-2">
            {perm.sensitive_paths.map((g, i) => (
              <div key={`${g}-${i}`} className="flex items-center gap-2">
                <code className="flex-1 rounded-md border bg-(--segment-bg) px-2.5 py-1.5 font-mono text-xs">{g}</code>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={archived}
                  onClick={() => setPerm((p) => ({ ...p, sensitive_paths: p.sensitive_paths.filter((_, k) => k !== i) }))}
                >
                  删除
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="**/.ssh/**"
                className="flex-1 font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={archived || !newPath.trim()}
                onClick={() => {
                  setPerm((p) => ({ ...p, sensitive_paths: [...p.sensitive_paths, newPath.trim()] }))
                  setNewPath("")
                }}
              >
                添加路径
              </Button>
            </div>
          </div>
        </div>
      )}

      {tab === 2 && (
        <div className="rounded-xl border bg-surface">
          {/* 工具族装配（原配置页卡 5 迁入）：族级开关决定整个工具族是否装配进 Agent */}
          <div className="border-b px-4 py-3">
            <div className="text-xs font-medium text-foreground">工具族装配（发布时冻结 tool_policy）</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {FAMILY_LABELS.map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <Switch
                    checked={fam[key] !== false}
                    disabled={archived}
                    onCheckedChange={(v) => setFam((cur) => ({ ...cur, [key]: v }))}
                    aria-label={label}
                  />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              关闭后该工具族整体不装配进 Agent（模型感知为无此能力）；下方三态策略只对已装配的族生效。需重新发布生效。
            </p>
          </div>
          <div className="flex items-center gap-3 border-b px-4 py-3 text-xs text-muted-foreground">
            直接使用 <b className="text-sm text-foreground">{counts.allow}</b> · 询问{" "}
            <b className="text-sm text-(--status-warning)">{counts.ask}</b> · 不可使用{" "}
            <b className="text-sm text-(--status-danger)">{counts.deny}</b>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-[11px] text-muted-foreground">
                <th className="px-4 py-2 font-medium">工具</th>
                <th className="w-20 px-2 font-medium">族</th>
                <th className="w-48 px-2 font-medium">策略</th>
                <th className="px-4 py-2 font-medium">说明</th>
              </tr>
            </thead>
            <tbody>
              {TOOL_ROWS.map((row) => {
                const b = perm.tools[row.names[0]] ?? "allow"
                return (
                  <tr key={row.names[0]} className="border-b last:border-0">
                    <td className="px-4 py-2.5 align-top">
                      <div className="text-foreground">{row.names.join(" / ")}</div>
                    </td>
                    <td className="px-2 align-top text-muted-foreground">{row.family}</td>
                    <td className="px-2 align-top">
                      <span className="inline-flex overflow-hidden rounded-lg border">
                        {(["allow", "ask", "deny"] as const).map((k) => (
                          <button
                            key={k}
                            type="button"
                            disabled={archived}
                            className={cn(
                              "px-2 py-1 text-[11px] font-medium",
                              b === k
                                ? k === "allow"
                                  ? "bg-foreground text-background"
                                  : k === "ask"
                                    ? "bg-(--status-warning) text-white"
                                    : "bg-(--status-danger) text-white"
                                : "text-muted-foreground hover:bg-muted",
                            )}
                            onClick={() => setTool(row.names, k)}
                          >
                            {BEHAVIOR_LABEL[k]}
                          </button>
                        ))}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 align-top text-muted-foreground">{row.desc}</td>
                  </tr>
                )
              })}
              <tr>
                <td colSpan={4} className="px-4 py-2 text-[11px] text-muted-foreground">
                  manifest 动态件（Skill / search_knowledge / MCP 工具）随发布快照冻结，治理页只读展示（P1 静态件先行）。
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === 3 && (
        <div className="rounded-xl border bg-surface p-4">
          <div className="flex items-center gap-3">
            <Switch checked={false} disabled aria-label="企业安全模式" />
            <div className="text-sm font-semibold">企业安全模式</div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">使用企业模型，任务数据仅保留在本机。</p>
          <p className="mt-2 rounded-lg border border-dashed bg-(--segment-bg) px-3 py-2 text-[11px] text-muted-foreground">
            P3 诚实占位：需连接治理联动（仅允许本地/指定 Connection 的 provider），当前不可开启，不伪造开关行为。
          </p>
        </div>
      )}

      <div className="flex items-center gap-3 border-t pt-4">
        <Button size="sm" disabled={saving || archived} onClick={() => void save()}>保存</Button>
        <Button size="sm" variant="outline" disabled={archived} onClick={() => setPerm(mergePermissions((agent.config as { permissions?: unknown } | undefined)?.permissions))}>
          重置为已存值
        </Button>
        <span className="text-[11px] text-muted-foreground">
          保存写入配置草稿；对运行生效需重新发布（冻结进 release 快照 v2）。发布治理页将显示「权限快照」chip。
        </span>
      </div>
    </div>
  )
}
