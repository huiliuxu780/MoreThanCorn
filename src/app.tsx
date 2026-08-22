import { lazy, Suspense } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
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
const AgentsPage = lazy(() => import("@/pages/agents"))
const AgentDesignerPage = lazy(() => import("@/pages/agent-designer"))
// 真 API 模式（P0，VITE_WF_API=1）：同一冻结路由，切换实现（15-development-plan.md）
const WfAgentsPage = lazy(() => import("@/pages/wf-agents-list"))
const WfAgentEditorPage = lazy(() => import("@/pages/wf-agent-editor"))
const WfWorkflowsPage = lazy(() => import("@/pages/wf-workflows-list"))
const WfWorkflowEditorPage = lazy(() => import("@/pages/wf-designer"))
const WfToolsPage = lazy(() => import("@/pages/wf-tools"))
const WfConnectionsPage = lazy(() => import("@/pages/wf-connections"))
const WF_API = import.meta.env.VITE_WF_API === "1"
const ToolsPage = lazy(() => import("@/pages/tools"))
const ToolEditorPage = lazy(() => import("@/pages/tool-editor"))
const DataAssetsPage = lazy(() => import("@/pages/data-assets"))
const DataAssetEditorPage = lazy(() => import("@/pages/data-asset-editor"))
const ResultRulesPage = lazy(() => import("@/pages/result-rules"))
const ResultRuleEditorPage = lazy(() => import("@/pages/result-rule-editor"))
const ConnectionsPage = lazy(() => import("@/pages/connections"))
const ForbiddenPage = lazy(() =>
  import("@/pages/system-pages").then((m) => ({ default: m.ForbiddenPage })),
)
const NotFoundPage = lazy(() =>
  import("@/pages/system-pages").then((m) => ({ default: m.NotFoundPage })),
)

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
          <Route path="/config/agents" element={WF_API ? <WfAgentsPage /> : <AgentsPage />} />
          <Route path="/config/agents/:agentId" element={WF_API ? <WfAgentEditorPage /> : <AgentDesignerPage />} />

          {/* 配置管理：Tools */}
          <Route path="/config/workflows" element={WF_API ? <WfWorkflowsPage /> : <WfWorkflowsPage />} />
          <Route path="/config/workflows/:agentId" element={WF_API ? <WfWorkflowEditorPage /> : <WfWorkflowEditorPage />} />
          <Route path="/config/tools" element={WF_API ? <WfToolsPage /> : <ToolsPage />} />
          <Route path="/config/tools/new" element={<ToolEditorPage />} />
          <Route path="/config/tools/:toolId" element={<ToolEditorPage />} />

          {/* 配置管理：数据定义 */}
          <Route path="/config/data-assets" element={<DataAssetsPage />} />
          <Route path="/config/data-assets/new" element={<DataAssetEditorPage />} />
          <Route path="/config/data-assets/:assetId" element={<DataAssetEditorPage />} />

          {/* 配置管理：结果规则 */}
          <Route path="/config/result-rules" element={<ResultRulesPage />} />
          <Route path="/config/result-rules/:ruleSetId" element={<ResultRuleEditorPage />} />

          {/* 系统级设置 */}
          <Route path="/settings/connections" element={WF_API ? <WfConnectionsPage /> : <ConnectionsPage />} />

          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
