/** DesignerTopbar：设计器顶栏（16 §2）。
 *  左：返回 + 图标 + 名称 + 版本/状态徽标；中：Agent 模式页签（搭建/观测/评测/指标）；
 *  右：基础信息/检查/历史/观测/评测/定时/编辑锁/保存/发布。
 *  Theme-R：表面=bg-surface，徽标软底=status-*-soft token，主操作=品牌绿。 */
import {
  Activity, ArrowLeft, CalendarDays, ChevronDown, Clock,
  ListChecks, LockKeyhole, Settings,
} from "lucide-react"
import { useReactFlow } from "@xyflow/react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { C, NEUTRAL } from "@/components/wf/controls"
import { WfIcon } from "@/components/wf/wf-icons"
import type { ValidationIssue, WfDefinition } from "@/services/wf-api"
import type { AgentMeta, DrawerKind } from "../designer-types"
import { TypeIcon } from "../node-meta"

export interface TopbarVersionState {
  latest: { versionNo: number } | null
  envs: { sandbox: number | null; prod: number | null }
}

export function DesignerTopbar(props: {
  def: WfDefinition
  agentMeta?: AgentMeta
  avatar?: string
  readOnly: boolean
  savedAt: string
  revision: number
  latestVersion: number | null
  agentVersionState: TopbarVersionState
  issues: ValidationIssue[]
  drawer: DrawerKind
  onDrawer: (d: DrawerKind) => void
  lockUser: string
  lockByOther: boolean
  canPublish: boolean
  canForceUnlock: boolean
  onBack: () => void
  onOpenMeta: () => void
  onOpenHistory: () => void
  onForceUnlock: () => void
  onSelectIssueNode: (nodeId: string) => void
  onSave: () => void
  onPublishClick: () => void
}) {
  const {
    def, agentMeta, avatar, readOnly, savedAt, revision, latestVersion, agentVersionState,
    issues, drawer, onDrawer, lockUser, lockByOther, canPublish, canForceUnlock,
    onBack, onOpenMeta, onOpenHistory, onForceUnlock, onSelectIssueNode, onSave, onPublishClick,
  } = props
  const rf = useReactFlow()
  return (
    <div className="z-30 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-surface px-4 py-1" data-testid="wf-topbar" style={{ borderColor: C.cardBorder }}>
      <button onClick={onBack} title="返回列表"><ArrowLeft className="size-4" style={{ color: C.ink2 }} /></button>
      {agentMeta && avatar ? (
        <img src={avatar} alt={agentMeta.name} className="size-8 shrink-0 rounded-md object-cover" />
      ) : (
        <WfIcon icon={(def.workflow as unknown as { icon?: string }).icon} className="size-7 shrink-0 rounded-lg" iconCls="size-4" />
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold" style={{ color: C.ink }}>{agentMeta ? agentMeta.name : def.workflow.name}</span>
          {agentMeta ? (
            <button className="flex items-center gap-1 rounded border bg-popover px-1.5 py-0.5 text-[11px]" style={{ borderColor: C.cardBorder, color: C.ink2 }} onClick={onOpenHistory}>
              {agentVersionState.latest ? `V${agentVersionState.latest.versionNo}` : (latestVersion ? `V${latestVersion}` : `草稿 V1.0.${revision}`)} <ChevronDown className="size-3" />
            </button>
          ) : null}
          {agentMeta && agentVersionState.envs.sandbox != null && (
            <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "var(--status-success-soft)", color: "var(--status-success)" }}>沙箱 V{agentVersionState.envs.sandbox}</span>
          )}
          {agentMeta && agentVersionState.envs.prod != null && (
            <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "var(--status-running-soft)", color: "var(--status-running)" }}>线上 V{agentVersionState.envs.prod}</span>
          )}
          {/* A-13：agentMeta 模式也显示发布状态 */}
          <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: C.tagBg, color: C.orange }}>
            {def.workflow.status === "published" ? "已发布" : "待发布"}
          </span>
          {agentMeta && (
            <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "var(--surface-muted)", color: C.ink2 }}>{agentMeta.typeLabel}</span>
          )}
          {readOnly && agentMeta && (
            <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "var(--status-warning-soft)", color: "var(--status-warning)" }}>已封存 · 只读</span>
          )}
        </div>
        <div className="text-[11px]" style={{ color: C.ink3 }}>
          自动保存于 {savedAt ? new Date(savedAt).toLocaleString() : "—"}
        </div>
      </div>
      {agentMeta && (
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg p-0.5" style={{ background: "var(--surface-muted)" }}>
          {/* bugfix 语义保留：选中态跟随 drawer 状态 */}
          {([["build", "Agent搭建", null], ["runs", "运行观测", "runs"], ["eval", "效果评测", "eval"], ["evo", "版本指标", "evo"]] as [string, string, null | "runs" | "eval" | "evo"][]).map(([key, label, target]) => {
            const active = (drawer === null && key === "build") || drawer === target
            return (
              <button key={key} className="rounded-md px-3 py-1 text-[13px]"
                style={active ? { background: "var(--surface-raised)", color: C.ink, boxShadow: "0 1px 3px color-mix(in srgb, var(--text-primary) 12%, transparent)" } : { color: C.ink2 }}
                onClick={() => onDrawer(target)}>{label}</button>
            )
          })}
        </div>
      )}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <button className="rounded p-1.5 hover:bg-accent" title="工作流基础信息" onClick={onOpenMeta}>
          <Settings className="size-4" style={{ color: C.ink2 }} />
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <button className="relative rounded p-1.5 hover:bg-accent" title="检查">
              <ListChecks className="size-4" style={{ color: C.ink2 }} />
              {issues.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] text-white" style={{ background: C.danger }}>
                  {issues.length}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72" align="end">
            <div className="pb-1 text-[13px] font-medium" style={{ color: C.ink }}>检查({issues.length})</div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {issues.length === 0 && <div className="text-xs" style={{ color: C.ink3 }}>暂无问题</div>}
              {issues.map((i, k) => {
                const nd = def.graph.nodes.find((n) => n.id === i.nodeId)
                return (
                  <button key={k} className="flex w-full items-start gap-2 rounded px-1 py-1 text-left text-xs hover:bg-accent" style={{ color: C.danger }}
                    onClick={() => {
                      const p = def.ui.positions[i.nodeId]
                      if (p) rf.setCenter(p.x + 150, p.y + 60, { zoom: 1, duration: 300 })
                      onSelectIssueNode(i.nodeId)
                    }}>
                    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded" style={{ background: NEUTRAL }}>
                      <TypeIcon type={nd?.type ?? ""} className="size-2.5 text-background" />
                    </span>
                    <span>{i.message}</span>
                  </button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
        <button className="rounded p-1.5 hover:bg-accent" title="历史版本" onClick={onOpenHistory}>
          <Clock className="size-4" style={{ color: C.ink2 }} />
        </button>
        <button className="rounded p-1.5 hover:bg-accent" title="运行观测" onClick={() => onDrawer("runs")}>
          <Activity className="size-4" style={{ color: C.ink2 }} />
        </button>
        {!agentMeta && (
          <button className="rounded p-1.5 hover:bg-accent" title="效果评测" onClick={() => onDrawer("eval")}>
            <ListChecks className="size-4" style={{ color: C.ink2 }} />
          </button>
        )}
        {!readOnly && (
          <button className="rounded p-1.5 hover:bg-accent" title="定时任务" onClick={() => onDrawer("schedule")}>
            <CalendarDays className="size-4" style={{ color: C.ink2 }} />
          </button>
        )}
        {!readOnly && lockUser && (
          <span className="flex items-center gap-1 text-xs" style={{ color: lockByOther ? "var(--status-warning)" : C.ink2 }}>
            {lockByOther ? `${lockUser} 编辑中` : lockUser} <LockKeyhole className="size-3.5" style={{ color: lockByOther ? "var(--status-warning)" : "var(--status-success)" }} />
            {lockByOther && canForceUnlock && (
              <button className="underline" onClick={onForceUnlock}>强制解锁</button>
            )}
          </span>
        )}
        {!readOnly && <Button variant="outline" size="sm" className="rounded-md" onClick={onSave}>保存</Button>}
        {!readOnly && (
          <Button size="sm" className="rounded-md bg-primary text-primary-foreground hover:bg-brand-hover"
            disabled={!canPublish} title={canPublish ? "" : "当前角色无发布权限（需 Publisher 及以上）"}
            onClick={onPublishClick}>发布</Button>
        )}
      </div>
    </div>
  )
}
