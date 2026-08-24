import { useState } from "react"

/* ─── Data ─── */
const DIMENSIONS = [
  { id: "task-understanding", label: "任务理解", score: 78, summary: "冻结基线文档和 SDD 提供了清晰的规格契约；Agent 约束分散在多文档中。" },
  { id: "controlled-execution", label: "受控执行", score: 62, summary: "基本启动命令可用；缺少 doctor/诊断命令和全栈启动编排。" },
  { id: "change-validation", label: "变更验证", score: 55, summary: "后端 pytest 62 项可用；前端零测试，门禁无自动执行。" },
  { id: "reliable-delivery", label: "可靠交付", score: 48, summary: "无 CI/CD、无合并保护；git 提供基本回退能力。" },
  { id: "learning-capture", label: "学习捕获", score: 35, summary: "无会话证据；无项目级 Skills/Hooks 配置。" },
] as const

const FINDINGS = [
  {
    id: "validation-pipeline-no-automation",
    title: "SDD 声明的机器门禁缺少自动化执行入口",
    severity: "Medium" as const,
    dimension: "变更验证",
    reason: "SDD 00 §4.2 明确要求 pytest + npm run build + verify-fullstack 三项作为完工机器门禁，但项目无 CI/CD 配置、无 git pre-commit hook、无合并保护。验证完全依赖人工纪律。",
    fix: "创建 .github/workflows/ci.yml 或 git pre-commit hook，串联 pytest + typecheck + lint + build。",
  },
  {
    id: "frontend-zero-behavioral-testing",
    title: "前端 17k+ 行 React/TypeScript 无任何行为测试覆盖",
    severity: "Medium" as const,
    dimension: "变更验证",
    reason: "前端 src/ 含约 17,595 行代码（37 UI 组件、26 页面、3 服务层、3 hooks），无 vitest/jest 配置。TypeScript 类型检查和 ESLint 无法验证业务逻辑行为。",
    fix: "安装 vitest + @testing-library/react，为 useListQuery、wf-api 状态映射等关键模块编写首批测试。",
  },
  {
    id: "agent-constraints-scattered-no-single-entry",
    title: "Agent 工作约束缺少单一聚合入口",
    severity: "Low" as const,
    dimension: "任务理解",
    reason: "冻结路由、禁止裸 fetch、URL Query 状态模式等关键约束分散在 SDD、Implementation Spec、wiki_plan.yaml 和代码注释中，无 AGENTS.md 聚合。",
    fix: "在项目根目录创建 AGENTS.md，聚合 Agent 必须遵守的约束清单和必读文档索引。",
  },
] as const

const ASSET_SURFACES = [
  { surface: "Rules", count: 0, active: false },
  { surface: "Skills", count: 0, active: false },
  { surface: "MCP", count: 0, active: false, note: "IDE 级可用" },
  { surface: "Memory", count: 5, active: true, note: "user-scope" },
  { surface: "Agents", count: 0, active: false },
  { surface: "Hooks", count: 0, active: false },
  { surface: "Commands", count: 0, active: false },
  { surface: "Workflows", count: 0, active: false },
  { surface: "Plugins", count: 0, active: false },
] as const

/* ─── Helpers ─── */
function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600"
  if (score >= 60) return "text-amber-600"
  if (score >= 40) return "text-orange-600"
  return "text-red-600"
}

function scoreBg(score: number): string {
  if (score >= 80) return "bg-emerald-500"
  if (score >= 60) return "bg-amber-500"
  if (score >= 40) return "bg-orange-500"
  return "bg-red-500"
}

function severityBadge(s: "High" | "Medium" | "Low") {
  const map = {
    High: "bg-red-100 text-red-700 border-red-200",
    Medium: "bg-amber-100 text-amber-700 border-amber-200",
    Low: "bg-sky-100 text-sky-700 border-sky-200",
  }
  return map[s]
}

/* ─── Components ─── */
function DimensionRadar() {
  return (
    <div className="space-y-3">
      {DIMENSIONS.map((d) => (
        <div key={d.id} className="flex items-center gap-3">
          <span className="w-20 text-xs font-medium text-zinc-600 text-right shrink-0">{d.label}</span>
          <div className="flex-1 h-5 bg-zinc-100 rounded-full overflow-hidden relative">
            <div
              className={`h-full rounded-full ${scoreBg(d.score)} transition-all duration-500`}
              style={{ width: `${d.score}%` }}
            />
            <span className={`absolute right-2 top-0 h-full flex items-center text-[10px] font-bold ${scoreColor(d.score)}`}>
              {d.score}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function AssetGrid() {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {ASSET_SURFACES.map((s) => (
        <div
          key={s.surface}
          className={`rounded-md px-2 py-1.5 text-center border ${
            s.active ? "bg-emerald-50 border-emerald-200" : "bg-zinc-50 border-zinc-200"
          }`}
        >
          <div className={`text-[10px] font-medium ${s.active ? "text-emerald-700" : "text-zinc-500"}`}>
            {s.surface}
          </div>
          <div className={`text-sm font-bold ${s.active ? "text-emerald-600" : "text-zinc-400"}`}>
            {s.count}
          </div>
          {s.note && <div className="text-[9px] text-zinc-400">{s.note}</div>}
        </div>
      ))}
    </div>
  )
}

function FindingCard({ finding, expanded, onToggle }: { finding: typeof FINDINGS[number]; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 transition-colors"
      >
        <span className={`shrink-0 inline-block px-2 py-0.5 text-[10px] font-semibold rounded-full border ${severityBadge(finding.severity)}`}>
          {finding.severity}
        </span>
        <span className="text-sm font-medium text-zinc-800 flex-1">{finding.title}</span>
        <svg
          className={`w-4 h-4 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-100">
          <div className="pt-3">
            <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">维度</div>
            <span className="text-xs text-zinc-600 bg-zinc-100 px-2 py-0.5 rounded">{finding.dimension}</span>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">证据与影响</div>
            <p className="text-xs text-zinc-700 leading-relaxed">{finding.reason}</p>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">修复方向</div>
            <p className="text-xs text-zinc-700 leading-relaxed">{finding.fix}</p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Main Report ─── */
export default function BetterHarnessReport() {
  const [expandedFinding, setExpandedFinding] = useState<string | null>(FINDINGS[0].id)

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-zinc-800" />
          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">Better Harness Report</span>
        </div>
        <h1 className="text-xl font-bold text-zinc-900">AI Quality Intelligence Platform</h1>
        <p className="text-sm text-zinc-500 mt-1">
          项目拥有扎实的规格驱动开发体系——冻结基线文档、SDD 路线图、清晰的领域模型和后端测试覆盖。主要缺口集中在变更验证的自动执行层。
        </p>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-zinc-200 rounded-lg px-3 py-2 text-center">
          <div className="text-2xl font-bold text-zinc-800">3</div>
          <div className="text-[10px] text-zinc-500">发现项</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg px-3 py-2 text-center">
          <div className="text-2xl font-bold text-amber-600">2</div>
          <div className="text-[10px] text-zinc-500">Medium</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg px-3 py-2 text-center">
          <div className="text-2xl font-bold text-sky-600">1</div>
          <div className="text-[10px] text-zinc-500">Low</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg px-3 py-2 text-center">
          <div className="text-lg font-bold text-violet-600">Bootstrap</div>
          <div className="text-[10px] text-zinc-500">支持轨道</div>
        </div>
      </div>

      {/* Dimension Scores */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">维度评分</h2>
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <DimensionRadar />
          <div className="mt-3 pt-3 border-t border-zinc-100 space-y-1">
            {DIMENSIONS.map((d) => (
              <p key={d.id} className="text-[11px] text-zinc-500">
                <span className="font-medium text-zinc-700">{d.label}:</span> {d.summary}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* Asset Coverage */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Agent 资产覆盖</h2>
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <AssetGrid />
          <p className="text-[11px] text-zinc-500 mt-3">
            仅 Memory（5 条 user-scope）为活跃项目资产；其余 8 个表面均为零配置。项目处于 Bootstrap 阶段，需建立基础验证和路由入口。
          </p>
        </div>
      </section>

      {/* Findings */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">发现项详情</h2>
        <div className="space-y-2">
          {FINDINGS.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              expanded={expandedFinding === f.id}
              onToggle={() => setExpandedFinding(expandedFinding === f.id ? null : f.id)}
            />
          ))}
        </div>
      </section>

      {/* Priority Moves */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">优先行动</h2>
        <div className="bg-white border border-zinc-200 rounded-lg p-4 space-y-3">
          <div className="flex gap-3">
            <span className="shrink-0 w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold flex items-center justify-center">1</span>
            <div>
              <div className="text-sm font-medium text-zinc-800">建立自动化验证门禁</div>
              <p className="text-xs text-zinc-500">创建 CI/CD 配置或 git hook，将 SDD 声明的 pytest + build + verify-fullstack 串联为自动执行入口。</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold flex items-center justify-center">2</span>
            <div>
              <div className="text-sm font-medium text-zinc-800">引入前端行为测试基础设施</div>
              <p className="text-xs text-zinc-500">安装 vitest，为 useListQuery、wf-api 状态映射等关键模块编写首批测试，纳入 CI 门禁。</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 w-5 h-5 rounded-full bg-sky-100 text-sky-700 text-[10px] font-bold flex items-center justify-center">3</span>
            <div>
              <div className="text-sm font-medium text-zinc-800">创建 AGENTS.md 聚合 Agent 约束</div>
              <p className="text-xs text-zinc-500">将分散在 SDD、Implementation Spec、wiki_plan.yaml 中的关键约束聚合到单一入口文件。</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <div className="text-center text-[10px] text-zinc-400 pt-4 border-t border-zinc-100">
        Better Harness · Agent Work Loop v4 · 2026-08-25 · session-limited review
      </div>
    </div>
  )
}
