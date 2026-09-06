import { lazy, Suspense } from "react"
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom"
import { AppShell } from "@/components/app/app-shell"
import { TableSkeleton } from "@/components/app/list-state"

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
// A-14：agent 轨道 mock 双轨已清退——/agents 固定走真 API 页面
const WfAgentsPage = lazy(() => import("@/pages/wf-agents-list"))
const AgentCreatePage = lazy(() => import("@/pages/agent-create"))
const WfAgentEditorPage = lazy(() => import("@/pages/wf-agent-editor"))
const WfWorkflowsPage = lazy(() => import("@/pages/wf-workflows-list"))
const WfFormsPage = lazy(() => import("@/pages/wf-forms"))
const WfFormEditorPage = lazy(() => import("@/pages/wf-forms").then((m) => ({ default: m.WfFormEditorPage })))
const WfWorkflowEditorPage = lazy(() => import("@/pages/wf-designer"))
const WfConnectionsPage = lazy(() => import("@/pages/wf-connections"))
const AuditLogPage = lazy(() => import("@/pages/audit-log"))
const ReleaseGovernancePage = lazy(() => import("@/pages/release-governance"))
const ResultRulesPage = lazy(() => import("@/pages/result-rules"))
const ResultRuleEditorPage = lazy(() => import("@/pages/result-rule-editor"))
// 资源管理一期（uiux/01–03）：AI Resources / Data Resources 统一资源域
const ResAiResourcesPage = lazy(() => import("@/pages/res-list"))
const ResDataResourcesPage = lazy(() => import("@/pages/res-list").then((m) => ({ default: m.ResDataResourcesPage })))
const ResWizardPage = lazy(() => import("@/pages/res-wizard"))
const ResDetailPage = lazy(() => import("@/pages/res-detail"))
const DataDefinitionsPage = lazy(() => import("@/pages/data-definitions"))
const DataDefinitionEditorPage = lazy(() => import("@/pages/data-definition-editor"))
// MTC-001：能力与资源 Hub + 系统设置
const ResourcesHubPage = lazy(() => import("@/pages/resources-hub"))
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
  return <Navigate to={`/config/ai-resources/tool/${toolId}`} replace />
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

function RouteFallback() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-5">
      <div className="overflow-hidden rounded-lg border bg-card">
        <TableSkeleton rows={8} columns={6} />
      </div>
    </div>
  )
}

/**
 * MTC-001 Route Map：
 * 一级路由 = /tasks /autonomous-tasks /agents /resources /workflows /settings。
 * 旧路由不删除： promoted 树走 replace redirect，其余页面原路径保留挂载。
 * Version / Revision History 使用 Sheet，不创建独立 route。
 */
export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/tasks" replace />} />

          {/* ---- MTC-001 一级入口 ---- */}
          {/* 任务工作台（暂复用 Operations Today；看板重做属 MTC-003） */}
          <Route path="/tasks" element={<OperationsTodayPage />} />
          {/* 自主任务（承接原 AnalysisTask 页面树） */}
          <Route path="/autonomous-tasks" element={<TasksPage />} />
          <Route path="/autonomous-tasks/new" element={<TaskWizardPage />} />
          <Route path="/autonomous-tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/autonomous-tasks/:taskId/edit" element={<TaskEditPage />} />
          <Route path="/autonomous-tasks/:taskId/runs/:runId" element={<RunRedirect />} />
          <Route path="/autonomous-tasks/:taskId/batches/:taskRunId" element={<TaskRunRedirect />} />
          {/* Agent 管理 */}
          <Route path="/agents" element={<WfAgentsPage />} />
          <Route path="/agents/new" element={<AgentCreatePage />} />
          <Route path="/agents/:agentId/runs/:runId" element={<RunDetailPage />} />
          <Route path="/agents/:agentId" element={<WfAgentEditorPage />} />
          {/* 能力与资源 Hub（完整版属 MTC-011/012） */}
          <Route path="/resources" element={<ResourcesHubPage />} />
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

          {/* 表单（Workflow 输入契约） */}
          <Route path="/config/forms" element={<WfFormsPage />} />
          <Route path="/config/forms/new" element={<WfFormEditorPage />} />
          <Route path="/config/forms/:formId" element={<WfFormEditorPage />} />

          {/* AI Resources / Data Resources（资源管理一期） */}
          <Route path="/config/ai-resources" element={<ResAiResourcesPage />} />
          <Route path="/config/ai-resources/new" element={<ResWizardPage scope="ai" />} />
          <Route path="/config/ai-resources/:type/:id" element={<ResDetailPage />} />
          <Route path="/config/data-resources" element={<ResDataResourcesPage />} />
          <Route path="/config/data-resources/new" element={<ResWizardPage scope="data" />} />
          <Route path="/config/data-resources/:type/:id" element={<ResDetailPage />} />

          {/* 旧入口收敛：Tools / Models → AI Resources（重定向） */}
          <Route path="/config/tools" element={<Navigate to="/config/ai-resources?tab=tools" replace />} />
          <Route path="/config/tools/new" element={<Navigate to="/config/ai-resources/new" replace />} />
          <Route path="/config/tools/:toolId" element={<ToolRedirect />} />

          {/* 数据定义 / 结果规则 */}
          <Route path="/config/data-assets" element={<DataDefinitionsPage />} />
          <Route path="/config/data-assets/:defId" element={<DataDefinitionEditorPage />} />
          <Route path="/config/result-rules" element={<ResultRulesPage />} />
          <Route path="/config/result-rules/:ruleSetId" element={<ResultRuleEditorPage />} />

          {/* 系统级设置子页（保留原路径） */}
          <Route path="/settings/connections" element={<WfConnectionsPage />} />
          <Route path="/settings/audit" element={<AuditLogPage />} />
          <Route path="/settings/governance" element={<ReleaseGovernancePage />} />
          <Route path="/settings/models" element={<Navigate to="/config/ai-resources?tab=models" replace />} />

          {/* ---- MTC-001 旧路由 → 新 canonical（replace redirect，页面不删除） ---- */}
          <Route path="/config/tasks/*" element={<PrefixRedirect from="/config/tasks" to="/autonomous-tasks" />} />
          <Route path="/config/agents/*" element={<PrefixRedirect from="/config/agents" to="/agents" />} />
          <Route path="/config/workflows/*" element={<PrefixRedirect from="/config/workflows" to="/workflows" />} />

          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
