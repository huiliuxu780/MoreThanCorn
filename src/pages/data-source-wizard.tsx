/** 16 号稿 B3：新建接入一站式向导（类型→凭据→源配置→路由(可跳过)→完成）。
 *
 * 单次 apply 顺序落库：Connection?(内联) → Source → Route?；任一失败停在该实体、
 * 显示后端错误原文、可重试；按名称幂等防撞由服务端保证（重名 4xx 明错）。
 * 表单构件全部复用共享组件（SourceKindFields / EndpointFields / SecretFields），禁平行重写。
 */
import * as React from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import {
  EMPTY_SOURCE_FORM, KIND_ICON, KIND_LABEL, PULL_KINDS,
  SourceKindFields, deriveSourcePayload,
  type SourceFormState, type SourceKind,
} from "@/components/ingress/source-kind-fields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  EMPTY_EP, EndpointFields, SecretFields, endpointOf, type EpFields,
} from "@/pages/wf-connections"
import { asApi, type CreateSourceBody } from "@/services/as-api"
import { connApi, type ConnSecret } from "@/services/resource-api"
import { bizApi } from "@/services/wf-api"

const AUTH_KINDS = ["none", "api_key", "bearer", "basic", "aksk", "script"] as const
const protocolFor = (k: SourceKind) =>
  k === "maxcompute" || k === "sls" ? k : "http-api"

const STEP_LABEL = ["类型", "凭据", "源配置", "路由", "完成"]

interface ApplyResult {
  conn?: { id: string; name: string; created: boolean }
  source?: { id: string; name: string }
  route?: { id: string; name: string }
}

export default function DataSourceWizardPage() {
  const navigate = useNavigate()
  const [step, setStep] = React.useState(1)
  const [kind, setKind] = React.useState<SourceKind>("webhook")
  const [form, setForm] = React.useState<SourceFormState>(EMPTY_SOURCE_FORM)
  const set = (patch: Partial<SourceFormState>) => setForm((f) => ({ ...f, ...patch }))

  /* ── 凭据步 ── */
  const [credMode, setCredMode] = React.useState<"reuse" | "new" | "none">("reuse")
  const [conns, setConns] = React.useState<{ id: string; name: string; protocol: string }[]>([])
  const [catalogItems, setCatalogItems] = React.useState<{ name: string; kind: string }[]>([])
  const [catalogErr, setCatalogErr] = React.useState<string | null>(null)
  const loadCatalog = async (cid: string) => {
    setCatalogItems([]); setCatalogErr(null)
    try {
      const r = await connApi.catalog(cid)
      setCatalogItems(r.items)
    } catch (e) {
      setCatalogErr((e as Error).message)
    }
  }
  React.useEffect(() => {
    connApi.list({}).then((r) => setConns(r.items)).catch(() => setConns([]))
  }, [])
  /* 内联新建连接 */
  const [connName, setConnName] = React.useState("")
  const [authKind, setAuthKind] = React.useState<string>("aksk")
  const [ep, setEp] = React.useState<EpFields>(EMPTY_EP)
  const [secret, setSecret] = React.useState<ConnSecret | "">("")
  const [authScript, setAuthScript] = React.useState("")

  /* ── 路由步 ── */
  const [wantRoute, setWantRoute] = React.useState(true)
  const [routeName, setRouteName] = React.useState("")
  const [destKind, setDestKind] = React.useState<"automation" | "analysis_task">("automation")
  const [destId, setDestId] = React.useState("")
  const [automations, setAutomations] = React.useState<{ id: string; name: string }[]>([])
  const [tasks, setTasks] = React.useState<{ id: string; name: string }[]>([])
  React.useEffect(() => {
    asApi.automations({}).then((r) => setAutomations(
      ((r.items ?? []) as { id: string; name?: string }[])
        .map((a) => ({ id: a.id, name: a.name ?? a.id })))).catch(() => setAutomations([]))
    bizApi.analysisTasks.list(1, 100).then((r) => setTasks(
      (r.items ?? []).map((t) => ({ id: t.id, name: t.name })))).catch(() => setTasks([]))
  }, [])

  /* ── apply ── */
  const [applying, setApplying] = React.useState(false)
  const [applyErr, setApplyErr] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ApplyResult | null>(null)

  const pickKind = (k: SourceKind) => {
    setKind(k)
    setForm((f) => ({ ...f, kind: k, connId: "", tablePick: "" }))
    setCatalogItems([]); setCatalogErr(null)
    setAuthKind(k === "maxcompute" || k === "sls" ? "aksk" : "bearer")
  }

  const apply = async () => {
    setApplying(true); setApplyErr(null)
    const out: ApplyResult = {}
    try {
      /* 1) Connection（内联新建才建） */
      let connId = credMode === "reuse" ? form.connId : ""
      if (credMode === "new") {
        const name = connName.trim() || `${form.name.trim() || "ingress"}-conn`
        const body = {
          name, protocol: protocolFor(kind), kind: authKind,
          endpoint: endpointOf(protocolFor(kind), ep),
          secret: secret === "" ? undefined : secret,
          authScript: authKind === "script" ? authScript : null,
        }
        const r = await connApi.create(body)
        connId = r.id
        out.conn = { id: r.id, name, created: true }
      } else if (credMode === "reuse" && connId) {
        const c = conns.find((x) => x.id === connId)
        out.conn = { id: connId, name: c?.name ?? connId, created: false }
      }
      /* 2) Source */
      if (!form.name.trim()) throw new Error("源名称必填")
      const derived = deriveSourcePayload({ ...form, kind, connId })
      if (derived.error || !derived.payload) throw new Error(derived.error ?? "配置不合法")
      const src = await asApi.createSource({
        name: form.name.trim(), kind,
        config: derived.payload.config as CreateSourceBody["config"],
        ...(connId ? { connection_id: connId } : {}),
        ...(derived.payload.secret ? { secret: derived.payload.secret } : {}),
      })
      out.source = { id: src.id, name: form.name.trim() }
      /* 3) Route（可跳过） */
      if (wantRoute) {
        if (!destId) throw new Error("路由已启用但未选目的地实例")
        const rname = routeName.trim() || `${form.name.trim()} → ${destKind === "automation" ? "自动任务" : "分析批次"}`
        const r = await asApi.createRoute({
          sourceId: src.id,
          destination: { kind: destKind, id: destId },
        })
        out.route = { id: r.id, name: rname }
      }
      setResult(out)
      setStep(5)
    } catch (e) {
      setApplyErr((e as Error).message)
      toast.error(`创建中断：${(e as Error).message}`)
    } finally {
      setApplying(false)
    }
  }

  const steps = (
    <div className="flex items-center gap-0 mb-5">
      {STEP_LABEL.map((lb, i) => {
        const n = i + 1
        const state = n === step ? "on" : n < step ? "done" : ""
        return (
          <React.Fragment key={lb}>
            <div className="flex items-center gap-2 text-xs font-medium"
                 style={{ color: state === "on" ? "var(--text-primary)" : "var(--text-tertiary)" }}>
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border text-[11px] font-semibold"
                    style={state === "on"
                      ? { background: "var(--brand-primary)", borderColor: "var(--brand-primary)", color: "#fff" }
                      : state === "done"
                        ? { background: "var(--brand-soft)", borderColor: "var(--brand-subtle)", color: "var(--brand-primary)" }
                        : { borderColor: "var(--border)" }}>
                {state === "done" ? "✓" : n}
              </span>
              {lb}
            </div>
            {n < 5 && <div className="mx-2 h-px w-8" style={{ background: "var(--border)" }} />}
          </React.Fragment>
        )
      })}
    </div>
  )

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold">新建接入</h1>
          <p className="text-sm text-muted-foreground">
            向导 {step}/5 · 连接→源→路由一次走完；老入口「新建数据源」保留不变。
          </p>
        </div>
        <Button variant="outline" className="ml-auto" onClick={() => navigate("/data-sources")}>
          返回列表
        </Button>
      </header>
      {steps}

      {step === 1 && (
        <div className="grid grid-cols-3 gap-3">
          {(Object.keys(KIND_LABEL) as SourceKind[]).map((k) => {
            const Icon = KIND_ICON[k as keyof typeof KIND_ICON]
            return (
              <button key={k} type="button" onClick={() => pickKind(k)}
                      className="rounded-lg border p-3.5 text-left transition-colors hover:bg-muted/40"
                      style={kind === k
                        ? { borderColor: "var(--brand-primary)", boxShadow: "0 0 0 3px var(--brand-soft)" }
                        : { borderColor: "var(--border)" }}>
                <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-md"
                      style={{ background: "var(--brand-soft)", color: "var(--brand-primary)" }}>
                  <Icon className="size-3.5" />
                </span>
                <span className="block text-[12.5px] font-semibold">{KIND_LABEL[k]}</span>
                <span className="mt-1 block text-[11.5px] leading-relaxed text-muted-foreground">
                  {k === "webhook" && "对方系统主动推事件给你（工单变更/告警）。无需凭据，保存后交付一次性 token。"}
                  {k === "api_pull" && "对方是 HTTP JSON 接口，平台按间隔轮询（游标分页）。"}
                  {k === "sls" && "阿里云日志服务 logstore；凭据挂 Connection 后可目录发现。"}
                  {k === "maxcompute" && "ODPS 表（分区自动取最新，或 config.sql 只读）；目录发现表清单。"}
                  {k === "feishu_bitable" && "Bitable 记录分页拉取；app_id/app_secret + app_token/table_id。"}
                  {k === "test_event" && "仅链路验证：不接真实系统，验证 接收→去重→路由→投递 全链。"}
                </span>
              </button>
            )
          })}
          <div className="col-span-3 flex justify-end">
            <Button onClick={() => setStep(2)}>下一步：凭据</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="grid max-w-[820px] gap-3">
          {kind === "webhook" ? (
            <div className="rounded-lg border p-4 text-sm text-muted-foreground"
                 style={{ borderColor: "var(--border)" }}>
              Webhook 为推送型：无需凭据。保存后交付一次性 token（仅显示一次），把 URL 与
              X-Source-Token 头交给推送方即可。
            </div>
          ) : (
            <>
              {([["reuse", "复用已有 Connection", "凭据正主在 设置→连接：一套凭据接 N 个源，轮换只换一处。"],
                 ["new", "内联新建 Connection", "表单与 设置→连接 同源（共享组件）；保存为普通可复用连接。"],
                 ["none", "不用 Connection（源级凭据 / 匿名）", "兼容路径：凭据 JSON 加密存在源上；不与别处共享、轮换要改源。"]] as const)
                .map(([mode, t, d]) => (
                  <button key={mode} type="button"
                          onClick={() => setCredMode(mode)}
                          className="rounded-lg border p-3 text-left transition-colors hover:bg-muted/40"
                          style={credMode === mode
                            ? { borderColor: "var(--brand-primary)", boxShadow: "0 0 0 3px var(--brand-soft)" }
                            : { borderColor: "var(--border)" }}>
                    <span className="block text-[12.5px] font-semibold">{t}</span>
                    <span className="mt-1 block text-[11.5px] text-muted-foreground">{d}</span>
                    {mode === "reuse" && credMode === "reuse" && (
                      <span className="mt-2 block" onClick={(e) => e.stopPropagation()}>
                        <Select value={form.connId} onValueChange={(v) => { set({ connId: v, tablePick: "" }); void loadCatalog(v) }}>
                          <SelectTrigger><SelectValue placeholder={`选择连接（protocol=${protocolFor(kind)}）`} /></SelectTrigger>
                          <SelectContent>
                            {conns.filter((c) => c.protocol === protocolFor(kind)).map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </span>
                    )}
                    {mode === "new" && credMode === "new" && (
                      <span className="mt-2 grid gap-2" onClick={(e) => e.stopPropagation()}>
                        <Input placeholder="连接名称（留空自动建议）" value={connName}
                               onChange={(e) => setConnName(e.target.value)} />
                        <Select value={authKind} onValueChange={setAuthKind}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {AUTH_KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <EndpointFields protocol={protocolFor(kind)} v={ep}
                                        onChange={(p) => setEp((f) => ({ ...f, ...p }))} />
                        <SecretFields kind={authKind} value={secret} onChange={setSecret} />
                        {authKind === "script" && (
                          <Input placeholder="鉴权脚本（QuickJS 沙箱，产请求头）" value={authScript}
                                 onChange={(e) => setAuthScript(e.target.value)} />
                        )}
                      </span>
                    )}
                  </button>
                ))}
            </>
          )}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>上一步</Button>
            <Button onClick={() => {
              if (kind !== "webhook" && credMode === "reuse" && !form.connId
                  && (kind === "maxcompute" || kind === "sls")) {
                /* maxcompute/sls 允许步③再选或手工配置，不强制 */
              }
              setStep(3)
            }}>下一步：源配置</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="grid max-w-[820px] gap-3">
          <div className="grid gap-1">
            <Label htmlFor="wz-name">名称</Label>
            <Input id="wz-name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <SourceKindFields form={{ ...form, kind }} set={set} idp="wz"
                            cat={{ conns, items: catalogItems, err: catalogErr, load: loadCatalog }} />
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}>上一步</Button>
            <Button onClick={() => setStep(4)}>下一步：路由</Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="grid max-w-[820px] gap-3">
          <div className="flex items-center gap-2">
            <input id="wz-wantroute" type="checkbox" checked={wantRoute}
                   onChange={(e) => setWantRoute(e.target.checked)} />
            <Label htmlFor="wz-wantroute">配置 EventRoute（事件给谁消费）</Label>
          </div>
          {!wantRoute && (
            <p className="rounded-md border px-3 py-2 text-xs"
               style={{ borderColor: "var(--status-warning)", color: "var(--status-warning-text)", background: "var(--status-warning-soft)" }}>
              暂不配置：事件仅留 filtered 存证，概览带挂「未配置·事件积压」；稍后可在源详情页补。
            </p>
          )}
          {wantRoute && (
            <>
              <div className="grid gap-1">
                <Label htmlFor="wz-rname">路由名称</Label>
                <Input id="wz-rname" value={routeName} onChange={(e) => setRouteName(e.target.value)}
                       placeholder={`${form.name || "源"} → …`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label id="wz-dk-label">目的地类型（XOR）</Label>
                  <Select value={destKind} onValueChange={(v) => { setDestKind(v as typeof destKind); setDestId("") }}>
                    <SelectTrigger id="wz-dk" aria-labelledby="wz-dk-label"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="automation">自动任务（AutomationDefinition）</SelectItem>
                      <SelectItem value="analysis_task">分析批次（AnalysisTask）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label id="wz-di-label">目的地实例</Label>
                  <Select value={destId} onValueChange={setDestId}>
                    <SelectTrigger id="wz-di" aria-labelledby="wz-di-label"><SelectValue placeholder="选择目的地" /></SelectTrigger>
                    <SelectContent>
                      {(destKind === "automation" ? automations : tasks).map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(3)}>上一步</Button>
            <Button disabled={applying} onClick={() => void apply()}>
              {applying ? "创建中…" : "创建并继续"}
            </Button>
          </div>
          {applyErr && (
            <p className="rounded-md border px-3 py-2 text-xs"
               style={{ borderColor: "var(--status-danger)", color: "var(--status-danger-text)", background: "var(--status-danger-soft)" }}>
              创建中断：{applyErr}（已创建实体保留，修正后可重试；重名会报明错不静默覆盖）
            </p>
          )}
        </div>
      )}

      {step === 5 && result && (
        <div className="grid max-w-[820px] gap-3">
          <div className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
            {result.conn && (
              <div className="flex gap-3 border-b px-3 py-2 text-[12.5px]" style={{ borderColor: "var(--border-soft, #EFEFEB)" }}>
                <span className="w-24 shrink-0 text-[10.5px] font-semibold tracking-wide text-muted-foreground">CONNECTION</span>
                <span className="font-semibold">{result.conn.name}</span>
                <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
                  {result.conn.id.slice(0, 8)}…（{result.conn.created ? "新建" : "复用"}）
                </span>
              </div>
            )}
            {result.source && (
              <div className="flex gap-3 border-b px-3 py-2 text-[12.5px]" style={{ borderColor: "var(--border-soft, #EFEFEB)" }}>
                <span className="w-24 shrink-0 text-[10.5px] font-semibold tracking-wide text-muted-foreground">SOURCE</span>
                <span className="font-semibold">{result.source.name} · {KIND_LABEL[kind]} · active</span>
                <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{result.source.id.slice(0, 8)}…（新建）</span>
              </div>
            )}
            {result.route && (
              <div className="flex gap-3 px-3 py-2 text-[12.5px]">
                <span className="w-24 shrink-0 text-[10.5px] font-semibold tracking-wide text-muted-foreground">ROUTE</span>
                <span className="font-semibold">{result.route.name} · destination={destKind}</span>
                <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{result.route.id.slice(0, 8)}…（新建）</span>
              </div>
            )}
            {!result.route && (
              <div className="px-3 py-2 text-xs" style={{ color: "var(--status-warning-text)" }}>
                未配路由：事件仅留 filtered 存证；到源详情页「路由治理」补配。
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {PULL_KINDS.includes(kind) && result.source && (
              <Button onClick={() => {
                void asApi.pollSource(result.source!.id).then(
                  (r) => toast.success(`拉取完成：${r.polled} 条，派发 ${r.dispatched} 条`),
                  (e) => toast.error(`拉取失败：${(e as Error).message}`))
              }}>立即拉取验证</Button>
            )}
            <Button variant="outline" onClick={() => navigate("/data-sources?tab=events")}>查看事件流水</Button>
            <Button variant="ghost" onClick={() => navigate("/data-sources")}>回列表看概览带</Button>
          </div>
        </div>
      )}
    </div>
  )
}
