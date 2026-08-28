/** Agent 版本状态钩子（SDD 02 §7 头部版本徽标数据）。
 *  R-Archive（SDD 10）：旧 Agent 发布对话框已退役（发布/部署入口封存），
 *  仅保留只读的版本/部署状态查询供头部徽标使用。 */
import { useEffect, useState } from "react"

import { agentApi, type AgentVersionInfo } from "@/services/wf-api"

/** 头部版本徽标数据：最新版本 + 各环境部署的版本号。 */
export function useAgentVersionState(agentId: string | undefined) {
  const [latest, setLatest] = useState<AgentVersionInfo | null>(null)
  const [envs, setEnvs] = useState<{ sandbox: number | null; prod: number | null }>({ sandbox: null, prod: null })
  const refresh = () => {
    if (!agentId) return
    agentApi.versions(agentId).then((vs) => setLatest(vs[0] ?? null)).catch(() => undefined)
    agentApi.releases(agentId).then((rels) => {
      const sb = rels.find((r) => r.environment === "sandbox" && r.status === "active")
      const pd = rels.find((r) => r.environment === "prod" && r.status === "active")
      setEnvs({ sandbox: sb?.versionNo ?? null, prod: pd?.versionNo ?? null })
    }).catch(() => undefined)
  }
  useEffect(() => { refresh() }, [agentId])  // eslint-disable-line react-hooks/exhaustive-deps
  return { latest, envs, refresh }
}
