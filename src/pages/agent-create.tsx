/** 新建 Agent（2026-09-10 统一创建页，QoderWake /wakers/new?template= 同构）。
 *
 * 用户要求：任何类型的 Agent 都统一走同一个「创建/完善信息」页面。
 * 原站实测（/wakers/new?template=common-frontend-developer）：
 *  - 面包屑：创建 Waker › 完善信息；
 *  - 表单列（约 720px）：h2「创建 {模板}」+ 头像+上传头像 + 名称* + 我负责什么*（预填模板描述）
 *    + 运行环境（本地/当前设备/在线 + 切换运行环境 + 说明）+ Skills(N)（chip+移除 / 从市场添加 / 上传Skill）
 *    + 知识库（添加知识库）+ 连接器(N)（添加连接器）+ 创建 / 暂不创建；
 *  - 右侧「员工预览」aside（400px，#F9F9F9）：头像大图 + 员工名称 + 模板名 + 本地 chip + 日期 + 主要负责。
 * 入口：/agents/new（模板市场卡）→ 卡片「创建」/「查看详情」→ /agents/new?template=<id>；
 *        自定义 = ?template=custom（空模板）。模板数据源 = 内置 Module + 角色预设。
 */
import { useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Check, ChevronRight, Monitor, Plug, Search, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { FilePicker } from "@/components/ui/file-picker"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { AVATARS, avatarFor } from "@/lib/agent-avatar"
import { agentApi, skillUpload, wfApi } from "@/services/wf-api"
import { resApi } from "@/services/resource-api"

interface ModuleMeta {
  key: string; version: string; displayName: string; description: string;
  riskClass: string; providers: string[]; logicalTools: string[]; criteria: string[]
}
interface Opt { id: string; name: string; desc?: string }

interface Template {
  id: string
  kind: "module" | "preset" | "custom"
  name: string
  description: string
  tags: string[]
  moduleKey?: string
  moduleVersion?: string
  rolePrompt?: string
  style: string[]
  abilities: { name: string; detail: string }[]
}

/** 内置角色预设（与 Module 模板同构；custom = 空白自定义）。 */
const ROLE_PRESETS: Template[] = [
  {
    id: "preset-frontend", kind: "preset", name: "前端工程师",
    description: "专注界面设计与实现：组件架构、视觉语言打磨、响应式适配与性能调优，遵循增量交付与分层验证。",
    tags: ["前端设计", "组件架构", "响应式设计"],
    rolePrompt: "# 角色：前端工程师\n## 目标：以增量方式交付高质量前端界面。\n## 技能：组件架构、视觉打磨、响应式适配、无障碍与性能优化。\n## 限制：只做前端实现与验证，不擅自变更后端契约。",
    style: ["设计优先", "小步迭代", "证据驱动验证"],
    abilities: [
      { name: "组件架构", detail: "设计可复用的组件边界与状态模型。" },
      { name: "响应式适配", detail: "系统处理多端布局与交互差异。" },
      { name: "性能优化", detail: "关注渲染效率与包体控制。" },
    ],
  },
  {
    id: "preset-backend", kind: "preset", name: "后端工程师",
    description: "专注 API 开发、数据建模、服务集成、性能优化与线上稳定性，遵循测试验证与约定优先设计。",
    tags: ["代码审查", "调试排障", "架构"],
    rolePrompt: "# 角色：后端工程师\n## 目标：交付稳定、可测、约定优先的后端服务。\n## 技能：API 设计、数据建模、服务集成、性能与稳定性治理。\n## 限制：变更须有测试覆盖；不绕过鉴权与审计。",
    style: ["约定优先", "测试验证", "稳定性第一"],
    abilities: [
      { name: "API 设计", detail: "契约清晰、版本可控的接口设计。" },
      { name: "数据建模", detail: "面向查询与演进的模型设计。" },
      { name: "排障", detail: "基于日志与指标的定位与修复。" },
    ],
  },
  {
    id: "preset-qa", kind: "preset", name: "测试工程师",
    description: "面向命令行与 Web 产品的质量保障：测试计划、端到端验证、缺陷复现与基于证据的报告。",
    tags: ["测试计划", "端到端验证", "缺陷复现"],
    rolePrompt: "# 角色：测试工程师\n## 目标：以证据驱动的方式验证产品质量。\n## 技能：测试计划设计、端到端验证、缺陷复现与分诊。\n## 限制：不修复缺陷，只产出可复核的报告。",
    style: ["证据驱动", "可复核", "只验不修"],
    abilities: [
      { name: "测试计划", detail: "覆盖风险面的计划文档。" },
      { name: "端到端验证", detail: "真实路径的黑盒验证。" },
      { name: "缺陷报告", detail: "可复现步骤+证据的报告。" },
    ],
  },
  {
    id: "preset-pm", kind: "preset", name: "产品经理",
    description: "目标驱动的需求全生命周期管理：PRD 生成、用户反馈分析、竞品研究与发布沟通。",
    tags: ["需求全生命周期", "PRD 生成", "竞品研究"],
    rolePrompt: "# 角色：产品经理\n## 目标：把业务目标转化为可执行的需求与验收标准。\n## 技能：需求澄清、PRD 撰写、反馈分析、竞品研究。\n## 限制：共享工具写入须先获审批。",
    style: ["目标驱动", "证据化决策", "审批门禁"],
    abilities: [
      { name: "PRD 生成", detail: "结构完整、验收明确的需求文档。" },
      { name: "反馈分析", detail: "用户反馈归类与优先级。" },
      { name: "发布沟通", detail: "变更说明与干系人对齐。" },
    ],
  },
  {
    id: "preset-data", kind: "preset", name: "数据分析师",
    description: "问题框定、指标口径、数据收集与诊断、市场背景与证据化建议。",
    tags: ["问题框定", "指标口径", "数据诊断"],
    rolePrompt: "# 角色：数据分析师\n## 目标：以明确口径回答业务问题并给出证据化建议。\n## 技能：问题框定、指标口径定义、数据诊断与建议。\n## 限制：结论必须可回溯到数据证据。",
    style: ["口径先行", "证据化建议"],
    abilities: [
      { name: "指标口径", detail: "统一、可复算的指标定义。" },
      { name: "数据诊断", detail: "异常定位与归因。" },
    ],
  },
  {
    id: "custom", kind: "custom", name: "自定义 Agent",
    description: "从零定义角色：填写名称、职责与角色配置，挂载所需能力。",
    tags: ["自定义", "角色配置"],
    rolePrompt: "",
    style: [],
    abilities: [],
  },
]

export default function AgentCreatePage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const templateId = params.get("template") ?? ""

  const [modules, setModules] = useState<ModuleMeta[]>([])
  const [models, setModels] = useState<{ modelKey: string }[]>([])
  const [modelId, setModelId] = useState("")
  const [skillOpts, setSkillOpts] = useState<Opt[]>([])
  const [mcpOpts, setMcpOpts] = useState<Opt[]>([])
  const [kbOpts, setKbOpts] = useState<Opt[]>([])

  // 表单状态
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [avatar, setAvatar] = useState("")
  const [rolePrompt, setRolePrompt] = useState("")
  const [skills, setSkills] = useState<string[]>([])
  const [mcps, setMcps] = useState<string[]>([])
  const [kbs, setKbs] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [picker, setPicker] = useState<null | "skill" | "mcp" | "kb">(null)
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    agentApi.modules().then((r) => setModules(r.items)).catch(() => undefined)
    wfApi.models().then((r) => {
      const arr = Array.isArray(r) ? r : (r as { items?: { modelKey: string }[] }).items ?? []
      setModels(arr)
    }).catch(() => undefined)
    resApi.registry("skill", false).then((r) => setSkillOpts(r.items.map((s) => ({ id: s.id, name: s.name, desc: (s as { description?: string }).description })))).catch(() => undefined)
    resApi.registry("mcp", false).then((r) => setMcpOpts(r.items.map((s) => ({ id: s.id, name: s.name, desc: (s as { description?: string }).description })))).catch(() => undefined)
    resApi.registry("knowledge", false).then((r) => setKbOpts(r.items.map((s) => ({ id: s.id, name: s.name, desc: (s as { description?: string }).description })))).catch(() => undefined)
  }, [])

  const templates = useMemo<Template[]>(() => {
    const fromModules: Template[] = modules.map((m) => ({
      id: `module-${m.key}`,
      kind: "module",
      name: m.displayName,
      description: m.description,
      tags: m.logicalTools.slice(0, 3),
      moduleKey: m.key,
      moduleVersion: m.version,
      style: ["发布冻结", "结构化输出", "治理规则内置"],
      abilities: m.logicalTools.slice(0, 4).map((t) => ({ name: t, detail: "内置能力（模板默认）" })),
    }))
    return [...ROLE_PRESETS, ...fromModules]
  }, [modules])

  const template = templates.find((t) => t.id === templateId) ?? null

  // 进入表单页时按模板预填（仅一次）
  useEffect(() => {
    if (!template || applied) return
    setApplied(true)
    setName("")
    setDesc(template.description)
    setRolePrompt(template.rolePrompt ?? "")
    setSkills([])
    setMcps([])
    setKbs([])
  }, [template, applied])

  const uploadSkill = async (f: File) => {
    try {
      const r = await skillUpload(f, [])
      toast.success(`已上传 Skill「${(r as { name?: string }).name ?? f.name}」`)
      resApi.registry("skill", false).then((rr) => setSkillOpts(rr.items.map((s) => ({ id: s.id, name: s.name })))).catch(() => undefined)
    } catch (e) {
      toast.error(`上传失败：${(e as Error).message}`)
    }
  }

  const create = async () => {
    if (!template) return
    if (!name.trim()) { toast.error("请填写名称"); return }
    if (!desc.trim()) { toast.error("请填写「我负责什么」"); return }
    if (!models.length) { toast.error("尚无可用模型：请先到 设置·连接 或 资源·模型 配置并启用模型"); return }
    if (!modelId) { toast.error("请选择模型"); return }
    setCreating(true)
    try {
      const base = {
        name: name.trim(),
        description: desc.trim(),
        // 09-11：未手选头像时落库预览同款（hash(template.id)），杜绝新建页与保存后头像不一致
        avatar: avatar || avatarFor(template.id),
        modelRef: { modelId },
      }
      const a =
        template.kind === "module"
          ? await agentApi.create({
              ...base,
              moduleKey: template.moduleKey,
              moduleVersion: template.moduleVersion,
            })
          : await agentApi.create({
              ...base,
              type: "custom",
              rolePrompt: rolePrompt || desc.trim(),
              skills,
            } as Parameters<typeof agentApi.create>[0])
      // 挂载 Skill / 连接器 / 知识库（custom 走 config；module 走 config.skills 同源清单）
      if (template.kind !== "module" && (skills.length || mcps.length || kbs.length)) {
        await agentApi.update(a.id, {
          config: { skills, mcps, knowledges: kbs },
        } as Parameters<typeof agentApi.update>[1]).catch(() => undefined)
      }
      toast.success(`已创建「${a.name}」，进入详情完成配置与发布`)
      navigate(`/agents/${a.id}`)
    } catch (e) {
      toast.error((e as Error).message || "创建失败")
    } finally { setCreating(false) }
  }

  /* ---------- 模板市场（入口） ---------- */
  if (!template) {
    return (
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1200px] space-y-5 p-8">
          <nav className="flex items-center gap-1 text-xs text-muted-foreground" aria-label="创建导航">
            <span className="text-foreground">创建 Agent</span>
          </nav>
          <div className="flex flex-wrap items-start gap-3">
            <div>
              <h1 className="text-[28px] font-semibold leading-9">创建 Agent</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                选择适合工作场景的预置角色模板，或直接自定义；任何类型都进入同一个「完善信息」页。
              </p>
            </div>
          </div>
          <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,271px),1fr))]">
            {templates.map((t) => (
              <li key={t.id}>
                <article className="group/article flex h-full flex-col rounded-lg border bg-surface p-4 transition-shadow hover:shadow-sm">
                  <div className="flex items-center gap-3">
                    <img src={avatarFor(t.id)} alt="avatar" className="size-10 rounded-full" />
                    <button type="button" className="truncate text-sm font-semibold hover:underline"
                      onClick={() => setParams({ template: t.id })}>
                      {t.name}
                    </button>
                  </div>
                  <p className="mt-2 line-clamp-3 flex-1 text-xs text-muted-foreground">{t.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {t.tags.map((tag) => (
                      <span key={tag} className="rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-2 opacity-0 transition-opacity duration-200 group-hover/article:opacity-100 group-focus-within/article:opacity-100">
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => setParams({ template: t.id })}>
                      查看详情
                    </Button>
                    <Button size="sm" className="h-8" onClick={() => setParams({ template: t.id })}>创建</Button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  /* ---------- 统一创建/完善信息页 ---------- */
  const nameOf = (list: Opt[], id: string) => list.find((o) => o.id === id)?.name ?? id
  const today = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-8 py-6">
          <nav className="flex items-center gap-1 text-xs text-muted-foreground" aria-label="完善信息导航">
            <button type="button" className="hover:underline" onClick={() => setParams({})}>创建 Agent</button>
            <ChevronRight className="size-3" />
            <span className="text-foreground">完善信息</span>
          </nav>

          <h2 className="mt-6 text-[22px] font-semibold">创建 {template.name}</h2>

          {/* 头像 */}
          <div className="mt-5 flex items-center gap-4">
            <img src={avatarFor(template.id, avatar || null)} alt="avatar" className="size-14 rounded-full object-cover" />
            <div>
              <FilePicker ariaLabel="上传头像" accept="image/*" onPick={(f) => {
                const url = URL.createObjectURL(f)
                setAvatar(url)
              }}>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Upload className="size-3.5" /> 上传头像</span>
              </FilePicker>
              <div className="mt-2 grid grid-cols-8 gap-1.5">
                {AVATARS.map((a) => (
                  <button key={a} type="button" aria-label={`选择头像 ${a}`} onClick={() => setAvatar(a)}
                    className={cn("rounded-full border-2 p-0.5", avatar === a ? "border-brand" : "border-transparent")}>
                    <img src={a} alt="" className="size-7 rounded-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 名称 */}
          <div className="mt-5 space-y-1.5">
            <Label>名称 <span className="text-(--status-danger)">*</span></Label>
            <Input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="请输入 Agent 名称" />
          </div>

          {/* 我负责什么 */}
          <div className="mt-5 space-y-1.5">
            <Label>我负责什么 <span className="text-(--status-danger)">*</span></Label>
            <Textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)}
              placeholder="描述这个员工主要负责的工作内容与目标" />
          </div>

          {/* 模型选择（显式选择，禁止静默绑定 models[0]） */}
          <div className="mt-5 space-y-1.5">
            <Label>模型 <span className="text-(--status-danger)">*</span></Label>
            {models.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                尚无可用模型：请先到 设置·连接 或 资源·模型 配置并启用模型，否则无法创建。
              </p>
            ) : (
              <Select value={modelId || "__pick__"} onValueChange={(v) => setModelId(v === "__pick__" ? "" : v)}>
                <SelectTrigger className="w-full max-w-sm"><SelectValue placeholder="请选择模型" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__pick__" disabled>请选择模型</SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.modelKey} value={m.modelKey}>{m.modelKey}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">创建后绑定该模型；模型参数可在 Agent 详情「配置」中调整。</p>
          </div>

          {/* 角色配置（自定义/预设可编辑；module 模板只读说明） */}
          {template.kind !== "module" && (
            <div className="mt-5 space-y-1.5">
              <Label>角色配置（Markdown）</Label>
              <Textarea rows={6} value={rolePrompt} onChange={(e) => setRolePrompt(e.target.value)}
                className="font-mono text-xs" placeholder={"# 角色：\n## 目标：\n## 技能：\n## 限制："} />
            </div>
          )}
          {template.kind === "module" && (
            <div className="mt-5 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              该模板为内置 Module（{template.name}）：输入/输出 Schema、治理规则与结构化输出由模板内置，创建后在「发布治理」发布即可运行。
            </div>
          )}

          {/* Skills */}
          <div className="mt-6 space-y-2">
            <Label>Skills ({skills.length})</Label>
            {skills.length > 0 && (
              <ul className="grid gap-2 sm:grid-cols-3">
                {skills.map((id) => (
                  <li key={id} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-xs">
                    <span className="min-w-0 flex-1 truncate">{nameOf(skillOpts, id)}</span>
                    <button type="button" aria-label={`移除 ${nameOf(skillOpts, id)}`}
                      onClick={() => setSkills((cur) => cur.filter((x) => x !== id))}>
                      <X className="size-3.5 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPicker("skill")}>从市场添加</Button>
              <FilePicker ariaLabel="上传 Skill" accept=".md,.zip,.tgz" onPick={(f) => void uploadSkill(f)}>
                <span className="flex items-center gap-1.5 text-xs"><Upload className="size-3.5" /> 上传Skill</span>
              </FilePicker>
            </div>
          </div>

          {/* 知识库 */}
          <div className="mt-6 space-y-2">
            <Label>知识库</Label>
            {kbs.length === 0
              ? <p className="text-xs text-muted-foreground">还没有绑定知识库</p>
              : (
                <ul className="grid gap-2 sm:grid-cols-3">
                  {kbs.map((id) => (
                    <li key={id} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate">{nameOf(kbOpts, id)}</span>
                      <button type="button" aria-label={`移除 ${nameOf(kbOpts, id)}`}
                        onClick={() => setKbs((cur) => cur.filter((x) => x !== id))}>
                        <X className="size-3.5 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            <Button variant="outline" size="sm" onClick={() => setPicker("kb")}>添加知识库</Button>
          </div>

          {/* 连接器 */}
          <div className="mt-6 space-y-2">
            <Label>连接器 ({mcps.length})</Label>
            {mcps.length === 0
              ? <p className="text-xs text-muted-foreground">还没有添加连接器</p>
              : (
                <ul className="grid gap-2 sm:grid-cols-3">
                  {mcps.map((id) => (
                    <li key={id} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate">{nameOf(mcpOpts, id)}</span>
                      <button type="button" aria-label={`移除 ${nameOf(mcpOpts, id)}`}
                        onClick={() => setMcps((cur) => cur.filter((x) => x !== id))}>
                        <X className="size-3.5 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            <Button variant="outline" size="sm" onClick={() => setPicker("mcp")}>添加连接器</Button>
          </div>

          <div className="mt-8 flex items-center gap-3">
            <Button disabled={creating || !name.trim() || !desc.trim() || !modelId}
              title={!models.length ? "尚无可用模型：请先在 设置·连接 配置并启用模型" : !modelId ? "请选择模型" : undefined}
              onClick={() => void create()}>
              {creating ? "创建中…" : "创建"}
            </Button>
            <Button variant="outline" onClick={() => setParams({})}>暂不创建</Button>
          </div>
        </div>
      </div>

      {/* 员工预览（原站 cwc-preview 同构） */}
      <aside className="hidden w-[400px] shrink-0 overflow-y-auto lg:block" style={{ background: "var(--fill-tertiary)" }} aria-label="员工预览">
        <div className="p-6">
          <div className="text-xs text-muted-foreground">员工预览</div>
          <div className="mt-3 rounded-lg border bg-surface p-6 shadow-sm">
            <div className="mx-auto flex size-60 items-center justify-center overflow-hidden rounded-md" style={{ background: "var(--status-success-soft)" }}>
              <img src={avatarFor(template.id, avatar || null)} alt="avatar" className="size-full object-cover" />
            </div>
            <div className="mt-4 text-center text-lg font-semibold">{name.trim() || "员工名称"}</div>
            <div className="mt-1 text-center text-sm text-muted-foreground">{template.name}</div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1 rounded bg-status-success-soft px-1.5 py-0.5 text-status-success">
                <Monitor className="size-3" /> 本地
              </span>
              <span>{today}</span>
            </div>
          </div>
          <div className="mt-6">
            <div className="text-sm font-medium">主要负责</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{desc || template.description}</p>
          </div>
        </div>
      </aside>

      {/* 选择器弹窗（可搜索 + 复选 + 确认） */}
      <PickerDialog
        open={picker !== null}
        variant={picker === "skill" ? "skill" : picker === "mcp" ? "mcp" : "kb"}
        title={picker === "skill" ? "从市场添加 Skill" : picker === "mcp" ? "添加连接器" : "选择知识库"}
        desc={picker === "skill" ? "选择创建后可以使用的 Skill，支持多选。"
          : picker === "mcp" ? "选择创建后可以使用的连接器（MCP Server），支持多选。"
          : "选择创建后可以使用的知识库，支持多选。"}
        options={picker === "skill" ? skillOpts : picker === "mcp" ? mcpOpts : kbOpts}
        value={picker === "skill" ? skills : picker === "mcp" ? mcps : kbs}
        onChange={(next) => {
          if (picker === "skill") setSkills(next)
          else if (picker === "mcp") setMcps(next)
          else setKbs(next)
        }}
        onClose={() => setPicker(null)}
      />
    </div>
  )
}

/** 原站同构图标（QoderWake skill-market / knowledge-picker 的 fallback svg path 原值）。 */
function SkillGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 2c5.522 0 10 3.978 10 8.889a5.558 5.558 0 0 1-5.556 5.555h-1.966c-.922 0-1.667.745-1.667 1.667 0 .422.167.811.422 1.1.267.3.434.689.434 1.122C13.667 21.256 12.9 22 12 22 6.478 22 2 17.522 2 12S6.478 2 12 2zm-1.189 16.111a3.664 3.664 0 0 1 3.667-3.667h1.966A3.558 3.558 0 0 0 20 10.89C20 7.139 16.468 4 12 4a8 8 0 0 0-.676 15.972 3.648 3.648 0 0 1-.513-1.861zM7.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM12 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
    </svg>
  )
}
function KnowledgeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M13 21V23H11V21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H9C10.1947 3 11.2671 3.52375 12 4.35418C12.7329 3.52375 13.8053 3 15 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H13ZM20 19V5H15C13.8954 5 13 5.89543 13 7V19H20ZM11 19V7C11 5.89543 10.1046 5 9 5H4V19H11Z" />
    </svg>
  )
}

/** 多选弹窗（原站同构）：
 *  - skill = 卡片网格（icon + 名称 + checkbox + 描述两行截断）；
 *  - kb / mcp = 带 icon 的行卡（icon + 标题 + 来源 + 勾选指示）；
 *  公共：搜索 + 「已选 N 个」+ 取消/确认。 */
function PickerDialog({ open, variant, title, desc, options, value, onChange, onClose }: {
  open: boolean
  variant: "skill" | "kb" | "mcp"
  title: string
  desc: string
  options: Opt[]
  value: string[]
  onChange: (next: string[]) => void
  onClose: () => void
}) {
  const [q, setQ] = useState("")
  const [draft, setDraft] = useState<string[] | null>(null)
  useEffect(() => {
    if (open) { setQ(""); setDraft(null) }
  }, [open])
  const cur = draft ?? value
  const filtered = options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()))
  const toggle = (id: string) =>
    setDraft(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
  const Glyph = variant === "skill" ? SkillGlyph : variant === "kb" ? KnowledgeGlyph : Plug

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={variant === "skill" ? "搜索 Skill" : variant === "kb" ? "搜索知识库" : "搜索连接器"}
              className="pl-8" />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">已选择 {cur.length} 个</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-3">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">
              {options.length === 0 ? "暂无可选项" : "没有匹配项"}
            </p>
          ) : variant === "skill" ? (
            /* 卡片网格（原站 skill-market-card 同构） */
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((o) => {
                const on = cur.includes(o.id)
                return (
                  <button key={o.id} type="button" role="checkbox" aria-checked={on}
                    onClick={() => toggle(o.id)}
                    className={cn("flex flex-col gap-2 rounded-md border p-3 text-left transition-colors",
                      on ? "border-brand bg-brand-soft" : "hover:border-muted-foreground/40")}>
                    <span className="flex items-center gap-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                        <Glyph className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{o.name}</span>
                      <Checkbox checked={on} aria-label={`选择 ${o.name}`} className="pointer-events-none" />
                    </span>
                    <span className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {o.desc || "（无描述）"}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            /* 带 icon 的行卡（原站 knowledge-picker 同构） */
            <div className="space-y-1.5" role="listbox" aria-multiselectable="true">
              {filtered.map((o) => {
                const on = cur.includes(o.id)
                return (
                  <button key={o.id} type="button" role="option" aria-selected={on}
                    onClick={() => toggle(o.id)}
                    className={cn("flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors",
                      on ? "border-brand bg-brand-soft" : "hover:border-muted-foreground/40")}>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                      <Glyph className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{o.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{o.desc || (variant === "kb" ? "知识库" : "连接器")}</span>
                    </span>
                    {on && <Check className="size-4 shrink-0 text-brand" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => { onChange(cur); onClose() }}>确认</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
