import { lazy } from "react"
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom"
import { AppShell } from "@/components/app/app-shell"

const QualityOverviewPage = lazy(() => import("@/pages/quality-overview"))
const QualityResultsPage = lazy(() => import("@/pages/quality-results"))
const QualityResultDetailPage = lazy(() => import("@/pages/quality-result-detail"))
const AgentAnalysisPage = lazy(() => import("@/pages/agent-analysis"))
const TasksPage = lazy(() => import("@/pages/tasks"))
const TaskWizardPage = lazy(() => import("@/pages/task-wizard"))
const TaskDetailPage = lazy(() => import("@/pages/task-detail"))
const TaskEditPage = lazy(() => import("@/pages/task-edit"))
const RunDetailPage = lazy(() => import("@/pages/run-detail"))
// SDD 13：运行中心（批次历史/批次详情）canonical routes；今日运行 → MTC-001 /tasks
const OperationsHistoryPage = lazy(() => import("@/pages/operations-history"))
const TaskRunDetailPage = lazy(() => import("@/pages/task-run-detail"))
const OperationsTodayPage = lazy(() => import("@/pages/operations-today"))
const TaskBoardPage = lazy(() => import("@/pages/task-board"))
const AutomationsV2Page = lazy(() => import("@/pages/automations-v2"))
const AutomationDetailPage = lazy(() => import("@/pages/automation-detail"))
const AgentFlowsPage = lazy(() => import("@/pages/agentflows"))
const AgentFlowDetailPage = lazy(() => import("@/pages/agentflow-detail"))
const DataSourcesPage = lazy(() => import("@/pages/data-sources"))
const DataSourceDetailPage = lazy(() => import("@/pages/data-source-detail"))
// A-14：agent 轨道 mock 双轨已清退——/agents 固定走真 API 页面
const WfAgentsPage = lazy(() => import("@/pages/wf-agents-list"))
const AgentCreatePage = lazy(() => import("@/pages/agent-create"))
const WfAgentEditorPage = lazy(() => import("@/pages/wf-agent-editor"))
const AgentChatPage = lazy(() => import("@/pages/agent-chat"))
const WfWorkflowsPage = lazy(() => import("@/pages/wf-workflows-list"))
const WfFormsPage = lazy(() => import("@/pages/wf-forms"))
const WfFormEditorPage = lazy(() => import("@/pages/wf-forms").then((m) => ({ default: m.WfFormEditorPage })))
const WfWorkflowEditorPage = lazy(() => import("@/features/designer/DesignerPage"))
// docs/v2-design/10：能力与资源持久壳 + 五分类页（Connections 归设置、规则/表单归 Workflow 域）
const ResourcesShell = lazy(() => import("@/components/app/resources-shell").then((m) => ({ default: m.ResourcesShell })))
const ResSkillsPage = lazy(() => import("@/pages/res-skills"))
const ResModelsPage = lazy(() => import("@/pages/res-category-pages").then((m) => ({ default: m.ResModelsPage })))
const ResToolsPage = lazy(() => import("@/pages/res-category-pages").then((m) => ({ default: m.ResToolsPage })))
const ResKnowledgePage = lazy(() => import("@/pages/res-category-pages").then((m) => ({ default: m.ResKnowledgePage })))
const ResDataPage = lazy(() => import("@/pages/res-category-pages").then((m) => ({ default: m.ResDataPage })))
const AuditLogPage = lazy(() => import("@/pages/audit-log"))
const ReleaseGovernancePage = lazy(() => import("@/pages/release-governance"))
const ResultRulesPage = lazy(() => import("@/pages/result-rules"))
const ResultRuleEditorPage = lazy(() => import("@/pages/result-rule-editor"))
// 资源管理一期（uiux/01–03）：AI Resources / Data Resources 统一资源域
const ResWizardPage = lazy(() => import("@/pages/res-wizard"))
const ResDetailPage = lazy(() => import("@/pages/res-detail"))
const DataDefinitionsPage = lazy(() => import("@/pages/data-definitions"))
const DataDefinitionEditorPage = lazy(() => import("@/pages/data-definition-editor"))
// MTC-001：系统设置（能力与资源 Hub 门厅已退役 → 持久壳，docs/v2-design/10）
const SettingsPage = lazy(() => import("@/pages/settings"))
const ForbiddenPage = lazy(() =>
  import("@/pages/system-pages").then((m) => ({ default: m.ForbiddenPage })),
)
const NotFoundPage = lazy(() =>
  import("@/pages/system-pages").then((m) => ({ default: m.NotFoundPage })),
)

/** 旧 Tools 详情路由 → AI Resources Tool 详情。 */
function ToolRedirect() {
  const { toolId } = useParams()
  return <Navigate to={`/resources/ai/tool/${toolId}`} replace />
}

/** docs/v2-design/10 §2.3：旧 /resources/ai 入口 → 新分类路由（按 tab 映射）。 */
function AiLegacyRedirect() {
  const location = useLocation()
  const tab = new URLSearchParams(location.search).get("tab")
  const to = tab === "tools" || tab === "mcp" ? "/resources/tools"
    : tab === "knowledge" ? "/resources/knowledge"
      : "/resources/models"
  return <Navigate to={`${to}${location.search}`} replace />
}

/** SDD 13 §10.2：旧批次路由 → canonical route（replace redirect，不维护双页面）。 */
function TaskRunRedirect() {
  const { taskRunId } = useParams()
  return <Navigate to={`/operations/task-runs/${taskRunId}`} replace />
}

/** SDD 13 §10.2：旧 Run 路由 → canonical route。 */
function RunRedirect() {
  const { runId } = useParams()
  return <Navigate to={`/operations/runs/${runId}`} replace />
}

/**
 * MTC-001：旧路由前缀 → 新 canonical 前缀（保留子路径与查询参数）。
 * 例：/config/tasks/42/edit?x=1 → /autonomous-tasks/42/edit?x=1
 */
function PrefixRedirect({ from, to }: { from: string; to: string }) {
  const location = useLocation()
  const rest = location.pathname.slice(from.length)
  return <Navigate to={`${to}${rest}${location.search}`} replace />
}

/**
 * MTC-001 Route Map：
 * 一级路由 = /tasks /autonomous-tasks /agents /resources /workflows /settings。
 * 旧路由不删除： promoted 树走 replace redirect，其余页面原路径保留挂载。
 * Version / Revision History 使用 Sheet，不创建独立 route。
 *
 * 09-13 审计修复（eng#13/UI#22）：外层 Suspense 已下沉到 AppShell 内容区
 * （懒加载时导航壳常驻），并在那里套 RouteErrorBoundary——此处不再包 Suspense。
 */
export function App() {
  return (
    <>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/tasks" replace />} />

          {/* ---- 2026-09-09 换底一级入口（QoderWake 同构） ---- */}
          {/* 任务看板：只读投影（Session 索引 + Workflow Run + AgentFlow Run） */}
          <Route path="/tasks" element={<TaskBoardPage />} />
          {/* 自动任务 v2：AutomationDefinition + AgentScope Schedule */}
          <Route path="/autonomous-tasks" element={<AutomationsV2Page />} />
          <Route path="/autonomous-tasks/:taskId" element={<AutomationDetailPage />} />
          {/* 旧批量分析任务树（SDD-13 业务批次）移 /batch-tasks 深链保留 */}
          <Route path="/batch-tasks" element={<TasksPage />} />
          <Route path="/batch-tasks/new" element={<TaskWizardPage />} />
          <Route path="/batch-tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/batch-tasks/:taskId/edit" element={<TaskEditPage />} />
          <Route path="/batch-tasks/:taskId/runs/:runId" element={<RunRedirect />} />
          <Route path="/batch-tasks/:taskId/batches/:taskRunId" element={<TaskRunRedirect />} />
          {/* AgentFlow / 数据接入（换底新增控制面） */}
          <Route path="/agentflows" element={<AgentFlowsPage />} />
          <Route path="/agentflows/:fid" element={<AgentFlowDetailPage />} />
          <Route path="/data-sources" element={<DataSourcesPage />} />
          <Route path="/data-sources/:sid" element={<DataSourceDetailPage />} />
          <Route path="/operations/today" element={<OperationsTodayPage />} />
          {/* Agent 管理 */}
          <Route path="/agents" element={<WfAgentsPage />} />
          <Route path="/agents/new" element={<AgentCreatePage />} />
          <Route path="/agents/:agentId/runs/:runId" element={<RunDetailPage />} />
          <Route path="/agents/:agentId" element={<WfAgentEditorPage />} />
          <Route path="/agents/:agentId/chat" element={<AgentChatPage />} />
          <Route path="/agents/:agentId/:section" element={<WfAgentEditorPage />} />
          {/* 能力与资源持久壳（docs/v2-design/10）：五分类壳内切换 */}
          <Route path="/resources/connections" element={<Navigate to="/settings/connections" replace />} />
          <Route path="/resources" element={<ResourcesShell />}>
            <Route index element={<Navigate to="/resources/skills" replace />} />
            <Route path="skills" element={<ResSkillsPage />} />
            <Route path="models" element={<ResModelsPage />} />
            <Route path="tools" element={<ResToolsPage />} />
            <Route path="knowledge" element={<ResKnowledgePage />} />
            <Route path="data" element={<ResDataPage />} />
          </Route>
          {/* Workflow */}
          <Route path="/workflows" element={<WfWorkflowsPage />} />
          <Route path="/workflows/:agentId" element={<WfWorkflowEditorPage />} />
          {/* 系统设置 */}
          <Route path="/settings" element={<SettingsPage />} />

          {/* ---- 保留挂载（非一级入口，URL/深链可达） ---- */}
          {/* 智能质检 */}
          <Route path="/quality/overview" element={<QualityOverviewPage />} />
          <Route path="/quality/results" element={<QualityResultsPage />} />
          <Route path="/quality/results/:interactionId" element={<QualityResultDetailPage />} />
          <Route path="/quality/agent-analysis" element={<AgentAnalysisPage />} />

          {/* 运行中心：批次历史 / 批次详情 / Run 详情 */}
          <Route path="/operations/task-runs/today" element={<Navigate to="/tasks" replace />} />
          <Route path="/operations/task-runs" element={<OperationsHistoryPage />} />
          <Route path="/operations/task-runs/:taskRunId" element={<TaskRunDetailPage />} />
          <Route path="/operations/runs/:runId" element={<RunDetailPage />} />

          {/* 资源详情/向导（任务流，不进壳；MTC-006 canonical 保持） */}
          <Route path="/resources/ai" element={<AiLegacyRedirect />} />
          <Route path="/resources/ai/new" element={<ResWizardPage scope="ai" />} />
          <Route path="/resources/ai/:type/:id" element={<ResDetailPage />} />
          <Route path="/resources/data/new" element={<ResWizardPage scope="data" />} />
          <Route path="/resources/data/:type/:id" element={<ResDetailPage />} />
          {/* docs/v2-design/10 §2.3：Connections 归设置（路由反转） */}
          
          {/* docs/v2-design/10 §4.7：规则/表单出壳归 Workflow 域 */}
          <Route path="/workflows/rules" element={<ResultRulesPage />} />
          <Route path="/workflows/rules/:ruleSetId" element={<ResultRuleEditorPage />} />
          <Route path="/workflows/forms" element={<WfFormsPage />} />
          <Route path="/workflows/forms/new" element={<WfFormEditorPage />} />
          <Route path="/workflows/forms/:formId" element={<WfFormEditorPage />} />

          {/* 旧入口 replace redirect（深链/历史保留） */}
          <Route path="/config/ai-resources/*" element={<PrefixRedirect from="/config/ai-resources" to="/resources/ai" />} />
          <Route path="/config/data-resources/*" element={<PrefixRedirect from="/config/data-resources" to="/resources/data" />} />
          <Route path="/config/result-rules/*" element={<PrefixRedirect from="/config/result-rules" to="/workflows/rules" />} />
          <Route path="/config/forms/*" element={<PrefixRedirect from="/config/forms" to="/workflows/forms" />} />
          <Route path="/resources/rules/*" element={<PrefixRedirect from="/resources/rules" to="/workflows/rules" />} />
          <Route path="/resources/forms/*" element={<PrefixRedirect from="/resources/forms" to="/workflows/forms" />} />
          <Route path="/settings/connections" element={<SettingsPage fixedSection="connections" />} />
          <Route path="/config/tools" element={<Navigate to="/resources/ai?tab=tools" replace />} />
          <Route path="/config/tools/new" element={<Navigate to="/resources/ai/new" replace />} />
          <Route path="/config/tools/:toolId" element={<ToolRedirect />} />
          <Route path="/settings/models" element={<Navigate to="/resources/ai?tab=models" replace />} />
          <Route path="/settings/audit" element={<AuditLogPage />} />
          <Route path="/settings/governance" element={<ReleaseGovernancePage />} />

          {/* 数据定义（深链保留） */}
          <Route path="/config/data-assets" element={<DataDefinitionsPage />} />
          <Route path="/config/data-assets/:defId" element={<DataDefinitionEditorPage />} />

          {/* ---- MTC-001 旧路由 → 新 canonical（replace redirect，页面不删除） ---- */}
          <Route path="/config/tasks/*" element={<PrefixRedirect from="/config/tasks" to="/autonomous-tasks" />} />
          <Route path="/config/agents/*" element={<PrefixRedirect from="/config/agents" to="/agents" />} />
          <Route path="/config/workflows/*" element={<PrefixRedirect from="/config/workflows" to="/workflows" />} />

          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  )
}
