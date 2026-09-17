/** Module Agent 配置页（SDD 10 R4 对位参考图 v3；R8-UI 增强 11 §7-⑤）。
 *  三 Tab（概览/运行观测/版本）保持 R4 验收 IA；概览=编号分区卡+右侧测试面板。
 *  R8-UI：头部 Draft/Last-published 对照卡+对比；模型可选；资源 2×2 冻结；
 *  测试面板环境=Release 绑定（草稿须显式 Provider）；运行结果可跳 Run 详情。
 *  Module 资产（criteria/工具/主数据/Schema）只读；实例仅编辑名称/描述/业务定位/模型。 */
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
const PERM_LABELS: [string, string][] = [
  ["shell", "Shell 命令（Bash）"],
  ["file_write", "文件写入（Write/Edit）"],
  ["file_read", "文件读取与检索（Read/Grep/Glob）"],
  ["schedule", "调度管理（Schedule 四件）"],
  ["subagent", "子 Agent 与团队（AgentCreate/Team…）"],
  ["platform_tools", "平台工具（run_workflow/run_agent_flow）"],
]
const DEFAULT_PERMS: Record<string, boolean> = {
  shell: true, file_write: true, file_read: true,
  schedule: true, subagent: true, platform_tools: true,
}
import { toast } from "sonner"

import { AgentVersionDiffDialog } from "@/components/agent-version-diff"
import { ModulePublishDialog } from "@/components/module-publish-dialog"
import { useAgentVersionState } from "@/components/agent-publish-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { agentApi, wfApi, type AgentInfo, type AgentVersionInfo } from "@/services/wf-api"


interface ModuleMeta { key: string; version: string; displayName: string; description: string; riskClass: string; providers: string[]; logicalTools: string[]; criteria: string[]; inputSchema?: { required?: string[]; properties?: Record<string, unknown> }; outputSchema?: Record<string, unknown> }
interface ProviderOpt { id: string; name: string; kind: string; status: string; healthStatus: string | null }
interface ReleaseOpt { releaseId: string; environment: string; status: string; canaryPercent: number; versionNo: number | null; createdAt: string }
interface RunResult { status: string; output?: Record<string, unknown>; usage?: Record<string, unknown>; calls?: { kind: string; targetType?: string; targetId?: string }[] }

function Card({ no, title, children, right }: { no: number; title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-surface p-4" style={{ borderColor: "var(--border)" }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-md bg-(--surface-muted) text-[11px] text-(--text-secondary)" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>{no}</span>
          <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{title}</span>
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

export default function ModuleAgentConfigPage({ agent }: { agent: AgentInfo }) {
  const navigate = useNavigate()
  const vs = useAgentVersionState(agent.id)
  const [meta, setMeta] = useState<ModuleMeta | null>(null)
  const [name, setName] = useState(agent.name)
  const [desc, setDesc] = useState(agent.description ?? "")
  const [purpose, setPurpose] = useState<string>((agent.config as { spec?: { purpose?: string } })?.spec?.purpose ?? "")
  const [modelId, setModelId] = useState<string>(((agent.config as { modelRef?: { modelId?: string } })?.modelRef?.modelId) ?? "")
  const [thinking, setThinking] = useState(
    ((agent.config as { modelRef?: { params?: Record<string, unknown> } })?.modelRef?.params?.thinking_enable) === true)
  const [thinkingBudget, setThinkingBudget] = useState<number | "">(() => {
    const b = (agent.config as { modelRef?: { params?: Record<string, unknown> } })?.modelRef?.params?.thinking_budget
    return typeof b === "number" ? b : ""
  })
  const [models, setModels] = useState<{ modelKey: string; capabilities?: string[] }[]>([])
  const [versions, setVersions] = useState<AgentVersionInfo[]>([])
  const [releases, setReleases] = useState<ReleaseOpt[]>([])
  const [diffOpen, setDiffOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  // 09-07：核心能力（原站概览块数据源；config JSONB 手填一等字段）
  const [caps, setCaps] = useState<{ name: string; description: string }[]>(
    ((agent.config as { capabilities?: { name: string; description: string }[] }).capabilities) ?? [])
  // 测试面板：环境=Release 绑定；草稿=Provider 必选（R3 语义）
  const [providers, setProviders] = useState<ProviderOpt[]>([])
  const [providerId, setProviderId] = useState("")
  const [envSel, setEnvSel] = useState("")
  const [sample, setSample] = useState('{"sample_id": "S1", "dialogues": []}')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<(RunResult & { runId?: string }) | null>(null)
  const [callsOpen, setCallsOpen] = useState(true)
  const [perms, setPerms] = useState<Record<string, boolean>>({
    ...DEFAULT_PERMS,
    ...(((agent.config as { permissions?: Record<string, boolean> }).permissions) ?? {}),
  })

  useEffect(() => {
    agentApi.modules().then((r) => setMeta(r.items.find((m) => m.key === agent.moduleKey) ?? null)).catch(() => undefined)
    agentApi.providers().then((r) => {
      const en = r.items.filter((p) => p.status === "enabled")
      setProviders(en); if (!providerId && en[0]) setProviderId(en[0].id)
    }).catch(() => undefined)
    agentApi.versions(agent.id).then(setVersions).catch(() => undefined)
    agentApi.releases(agent.id).then((rs) => { setReleases(rs.filter((x) => x.status === "active")); }).catch(() => undefined)
    wfApi.models().then(setModels).catch(() => undefined)
  }, [agent.id, agent.moduleKey])  // eslint-disable-line react-hooks/exhaustive-deps

  const activeReleases = releases.filter((r) => r.versionNo != null)
  const hasRelease = activeReleases.length > 0

  const save = async () => {
    try {
      await agentApi.update(agent.id, {
        name, description: desc,
        config: {
          ...(agent.config as object), spec: { purpose }, capabilities: caps,
          permissions: perms,
          modelRef: {
            ...(agent.config as { modelRef?: object })?.modelRef, modelId,
            params: {
              ...((agent.config as { modelRef?: { params?: Record<string, unknown> } })?.modelRef?.params ?? {}),
              thinking_enable: thinking,
              ...(thinking && thinkingBudget !== "" ? { thinking_budget: thinkingBudget } : {}),
            },
          },
        },
      }, agent.configRevision)
      toast.success("已保存")
    } catch (e) { toast.error((e as Error).message) }
  }

  const runTest = async () => {
    // 已发布：环境=Release 绑定（解析 versionId）；草稿：Provider 必选
    const extra: Record<string, unknown> = {}
    if (hasRelease) {
      const rel = activeReleases.find((r) => `${r.environment}:${r.versionNo}` === envSel)
      if (!rel) { toast.error("请选择环境（Release 绑定）"); return }
      const ver = versions.find((v) => v.versionNo === rel.versionNo)
      if (!ver) { toast.error("该 Release 的版本不存在"); return }
      extra.versionId = ver.versionId
    } else {
      if (!providerId) { toast.error("草稿预览须选择 Provider"); return }
      extra.providerId = providerId
    }
    setRunning(true); setResult(null)
    try {
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(sample) } catch { /* keep {} */ }
      const { runId } = await agentApi.run(agent.id, input, "test", extra)
      const deadline = Date.now() + 30000
      for (; ;) {
        const d = await agentApi.runDetail(agent.id, runId)
        if (["succeeded", "failed", "cancelled"].includes(d.status)) {
          setResult({ status: d.status, output: (d.output as Record<string, unknown>) ?? undefined, usage: d.usage, calls: (d.calls as RunResult["calls"]) ?? [], runId })
          break
        }
        if (Date.now() > deadline) { setResult({ status: "timeout", runId }); break }
        await new Promise((r) => setTimeout(r, 400))
      }
    } catch (e) { toast.error((e as Error).message) } finally { setRunning(false) }
  }

  const inputProps = Object.keys((meta?.inputSchema?.properties ?? {}) as object)
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 09-07：头部/发布入口上移至 AgentWorkspaceShell hero；此处保留 Draft vs Last-published 对照 */}
      <div className="flex shrink-0 items-center justify-end gap-2 px-4 pt-2">
        <Button size="sm" variant="outline" onClick={save}>保存</Button>
        <Button size="sm" onClick={() => setPublishOpen(true)}>发布 ▾</Button>
      </div>
      {/* R8-UI D-1：Draft vs Last-published 对照卡 */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-surface px-4 py-2" style={{ borderColor: "var(--border)" }}>
        <span className="truncate text-[11px]" style={{ color: "var(--text-tertiary)" }}>{desc || meta?.description || ""}</span>
        <div className="flex shrink-0 items-center gap-5 rounded-lg border px-3 py-1.5" style={{ borderColor: "var(--border)" }}>
          <div>
            <b className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--text-primary)" }}>
              <span className="inline-block size-1.5 rounded-full bg-(--status-warning)" />草稿版本
            </b>
            <small className="block text-[10px]" style={{ color: "var(--text-tertiary)" }}>rev {agent.configRevision}</small>
          </div>
          <div>
            <b className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--text-primary)" }}>
              <span className="inline-block size-1.5 rounded-full bg-(--status-success)" />最近发布
            </b>
            <small className="block text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              {vs.latest ? `V${vs.latest.versionNo} · ${vs.latest.createdAt.slice(0, 10)}` : "（无）"}
            </small>
          </div>
          <Button size="sm" variant="outline" disabled={!vs.latest} onClick={() => setDiffOpen(true)}>对比</Button>
        </div>
      </div>
      {/* 09-07：运行观测/版本/效果评测拆为工作区子页（board/governance），此处仅配置表单+测试面板 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4" style={{ background: "var(--surface-muted)" }}>
          <div className="flex gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <Card no={1} title="Agent 身份">
                <div className="space-y-2">
                  <div className="flex gap-3"><Label className="w-16 pt-2 text-xs">名称</Label>
                    <Input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} /></div>
                  <div className="flex gap-3"><Label className="w-16 pt-2 text-xs">描述</Label>
                    <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">核心能力（概览页展示）</Label>
                    {caps.map((c, i) => (
                      <div key={i} className="flex gap-2">
                        <Input value={c.name} placeholder="能力名" className="w-40"
                          onChange={(e) => setCaps((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                        <Input value={c.description} placeholder="一句话描述"
                          onChange={(e) => setCaps((s) => s.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                        <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2" aria-label="删除该能力"
                          onClick={() => setCaps((s) => s.filter((_, j) => j !== i))}>删除</Button>
                      </div>
                    ))}
                    <Button variant="outline" size="sm"
                      onClick={() => setCaps((s) => [...s, { name: "", description: "" }])}>添加能力</Button>
                  </div>
                </div>
              </Card>
              <Card no={2} title="模型与推理（实例配置）">
                <div className="flex items-center gap-3">
                  <Label className="w-16 text-xs">模型</Label>
                  <Select value={modelId || undefined} onValueChange={setModelId}>
                    <SelectTrigger className="h-8 w-56"><SelectValue placeholder="选择模型" /></SelectTrigger>
                    <SelectContent>
                      {models.map((m, i) => <SelectItem key={`${m.modelKey}-${i}`} value={m.modelKey}>{m.modelKey}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>模型随版本冻结；凭据由平台 Connection 注入</span>
                </div>
                <div className="flex items-center gap-3 pt-3">
                  <Label className="w-16 text-xs">深度思考</Label>
                  <Switch
                    checked={thinking}
                    disabled={!!modelId && !(models.find((m) => m.modelKey === modelId)?.capabilities ?? []).includes("thinking")}
                    onCheckedChange={setThinking}
                    aria-label="深度思考"
                  />
                  {thinking && (
                    <Input
                      type="number" min={1} className="h-8 w-36" placeholder="思考预算 token（可选）"
                      value={thinkingBudget}
                      onChange={(e) => setThinkingBudget(e.target.value === "" ? "" : Number(e.target.value))}
                    />
                  )}
                  <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    开启后回复携带推理过程；发布时冻结进版本快照，需重新发布生效
                  </span>
                </div>
              </Card>
              <Card no={3} title="能力与权限（发布时冻结）">
                <div className="grid gap-2 sm:grid-cols-2">
                  {PERM_LABELS.map(([key, label]) => (
                    <div key={key} className="flex items-center gap-2">
                      <Switch
                        checked={perms[key] !== false}
                        onCheckedChange={(v) => setPerms((cur) => ({ ...cur, [key]: v }))}
                        aria-label={label}
                      />
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  关闭后该工具族不装配进 Agent；需重新发布生效。
                </p>
              </Card>
              <Card no={4} title="指令（Module 资产 · 只读）"
                right={<span className="rounded bg-(--status-warning-soft) px-1.5 py-0.5 text-[10px] text-(--status-warning-text)">只读</span>}>
                <div className="mb-2 rounded bg-(--status-warning-soft) px-2 py-1 text-[11px] text-(--status-warning-text)">
                  criteria/工具/主数据由 Module 版本冻结；实例仅可追加「业务定位」。
                </div>
                <pre className="max-h-40 overflow-auto rounded border p-2 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                  {meta ? meta.criteria.map((c) => `- ${c}`).join("\n") : "（Module 未加载）"}
                </pre>
                <div className="mt-2 space-y-1">
                  <Label className="text-xs">业务定位（实例追加）</Label>
                  <Textarea value={purpose} placeholder="如：面向售后退款场景" onChange={(e) => setPurpose(e.target.value)} />
                </div>
              </Card>
              <Card no={5} title="资源（Module 冻结 · 只读）">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { t: "工具", d: `${(meta?.logicalTools ?? []).length} 个逻辑工具` },
                    { t: "输入 Schema", d: `${inputProps.length} 字段 · ${(meta?.inputSchema?.required ?? []).length} 必填` },
                    { t: "输出 Schema", d: meta?.outputSchema ? "已冻结" : "—" },
                    { t: "Provider 实现", d: (meta?.providers ?? []).join(" / ") || "—" },
                  ].map((x) => (
                    <div key={x.t} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}>
                      <div><b className="block text-[12px]" style={{ color: "var(--text-primary)" }}>{x.t}</b>
                        <small className="block text-[10px]" style={{ color: "var(--text-tertiary)" }}>{x.d}</small></div>
                      <Badge variant="outline" className="text-[10px]">已冻结</Badge>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
            {/* 右：测试面板 */}
            <div className="w-[360px] shrink-0">
              <div className="rounded-lg border bg-surface" style={{ borderColor: "var(--border)" }}>
                <div className="border-b px-3 py-2 text-[13px] font-semibold" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>测试 Agent</div>
                <div className="space-y-3 p-3">
                  {hasRelease ? (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">环境</Label>
                      <Select value={envSel || undefined} onValueChange={setEnvSel}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="选择 Release 绑定" /></SelectTrigger>
                        <SelectContent>
                          {activeReleases.map((r) => (
                            <SelectItem key={r.releaseId} value={`${r.environment}:${r.versionNo}`}>
                              {r.environment === "prod" ? "线上" : "沙箱"} V{r.versionNo}{r.canaryPercent > 0 ? ` · 灰度 ${r.canaryPercent}%` : " · 稳定"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">Provider</Label>
                      <Select value={providerId} onValueChange={setProviderId}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="草稿预览须选择" /></SelectTrigger>
                        <SelectContent>{providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}（{p.kind}）</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                  <Textarea value={sample} onChange={(e) => setSample(e.target.value)} className="min-h-20 font-mono text-[11px]" />
                  <Button size="sm" className="w-full" disabled={running} onClick={runTest}>
                    {running ? "运行中…" : "运行"}
                  </Button>
                  {result && (
                    <div className="space-y-2 rounded border p-2 text-[11px]" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-center gap-2">状态：<b>{result.status}</b>
                        {result.runId && (
                          <Button variant="outline" size="sm" className="ml-auto h-6 text-[10px]"
                            onClick={() => navigate(`/agents/${agent.id}/runs/${result.runId}`)}>查看 Run 详情 ↗</Button>
                        )}
                      </div>
                      {result.output && <pre className="max-h-40 overflow-auto text-[10px]" style={{ color: "var(--text-secondary)" }}>{JSON.stringify(result.output, null, 1)}</pre>}
                      {result.usage && (
                        <div style={{ color: "var(--text-tertiary)" }}>
                          {String((result.usage as { total?: number }).total ?? "")} tokens
                          · 模型 {String((result.usage as { modelCalls?: number }).modelCalls ?? "—")} 次
                          · 工具 {String((result.usage as { toolCalls?: number }).toolCalls ?? "—")} 次
                        </div>
                      )}
                      {(result.calls?.length ?? 0) > 0 && (
                        <div className="rounded border" style={{ borderColor: "var(--border)" }}>
                          <button className="flex w-full items-center gap-1 px-2 py-1 text-[11px]" style={{ color: "var(--text-secondary)" }}
                            onClick={() => setCallsOpen((o) => !o)}>
                            工具调用（{result.calls!.length}）{callsOpen ? "⌃" : "⌄"}
                          </button>
                          {callsOpen && result.calls!.map((c, i) => (
                            <div key={i} className="flex items-center gap-2 border-t px-2 py-1" style={{ borderColor: "var(--border)" }}>
                              <span style={{ color: "var(--status-success-text)" }}>✓</span>
                              <span className="font-mono" style={{ color: "var(--text-secondary)" }}>{c.targetId ?? c.kind}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
      </div>
      <ModulePublishDialog agentId={agent.id} open={publishOpen} onClose={() => setPublishOpen(false)} onPublished={vs.refresh} />
      <AgentVersionDiffDialog agentId={agent.id} open={diffOpen} onClose={() => setDiffOpen(false)}
        versions={versions.map((v) => ({ versionId: v.versionId, versionNo: v.versionNo }))}
        defaultLeft="draft" defaultRight={versions[0]?.versionId ?? "draft"} />
    </div>
  )
}
