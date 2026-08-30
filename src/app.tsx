import { lazy, Suspense } from "react"
import { Navigate, Route, Routes, useParams } from "react-router-dom"
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
// A-14：agent 轨道 mock 双轨已清退——/config/agents 固定走真 API 页面
const WfAgentsPage = lazy(() => import("@/pages/wf-agents-list"))
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
 * 固定 Route Map（Handoff §3 / Implementation Spec §1）。
 * Version / Revision History 使用 Sheet，不创建独立 route。
 */
export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/quality/overview" replace />} />

          {/* 智能质检 */}
          <Route path="/quality/overview" element={<QualityOverviewPage />} />
          <Route path="/quality/results" element={<QualityResultsPage />} />
          <Route path="/quality/results/:interactionId" element={<QualityResultDetailPage />} />
          <Route path="/quality/agent-analysis" element={<AgentAnalysisPage />} />

          {/* 配置管理：分析任务 */}
          <Route path="/config/tasks" element={<TasksPage />} />
          <Route path="/config/tasks/new" element={<TaskWizardPage />} />
          <Route path="/config/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/config/tasks/:taskId/edit" element={<TaskEditPage />} />
          <Route path="/config/tasks/:taskId/runs/:runId" element={<RunDetailPage />} />

          {/* 配置管理：Agents */}
          <Route path="/config/agents" element={<WfAgentsPage />} />
          {/* R8-UI：agent 视角 Run Detail（测试面板试运行可达） */}
          <Route path="/config/agents/:agentId/runs/:runId" element={<RunDetailPage />} />
          <Route path="/config/agents/:agentId" element={<WfAgentEditorPage />} />

          {/* 配置管理：工作流 */}
          <Route path="/config/workflows" element={<WfWorkflowsPage />} />
          <Route path="/config/forms" element={<WfFormsPage />} />
          <Route path="/config/forms/new" element={<WfFormEditorPage />} />
          <Route path="/config/forms/:formId" element={<WfFormEditorPage />} />
          <Route path="/config/workflows/:agentId" element={<WfWorkflowEditorPage />} />

          {/* 配置管理：AI Resources / Data Resources（资源管理一期） */}
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

          {/* 配置管理：数据定义（Data Definition 实体迭代） */}
          <Route path="/config/data-assets" element={<DataDefinitionsPage />} />
          <Route path="/config/data-assets/:defId" element={<DataDefinitionEditorPage />} />

          {/* 配置管理：结果规则 */}
          <Route path="/config/result-rules" element={<ResultRulesPage />} />
          <Route path="/config/result-rules/:ruleSetId" element={<ResultRuleEditorPage />} />

          {/* 系统级设置 */}
          <Route path="/settings/connections" element={<WfConnectionsPage />} />
          <Route path="/settings/audit" element={<AuditLogPage />} />
          <Route path="/settings/governance" element={<ReleaseGovernancePage />} />
          <Route path="/settings/models" element={<Navigate to="/config/ai-resources?tab=models" replace />} />

          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
