/** 自动任务「可执行对象」唯一判定（审计返工 P0-1，2026-09-10 二轮）。
 *
 *  与后端 server/app/routers/as_automations.py::_validate_target 同一语义：
 *  - Agent：未归档 且 存在 active prod Release —— 由后端 /api/agents 列表的
 *    `executable` 字段表达（server/app/routers/agents.py 同源计算），前端不得
 *    自行用 `!archived` 近似；
 *  - Workflow：status === "published"（发布时同时落 current_version_id，
 *    与 create_run(trigger=schedule) 的 NO_PUBLISHED_VERSION 要求一致）；
 *  - AgentFlow：存在 active Release（active_release_id 非空，
 *    与 resolve_agentflow_release 一致）。
 *
 *  选择器只列可执行对象；默认执行者只能取自该列表；空列表 → 空态+发布引导，
 *  禁止提交（后端 422 校验保留兜底）。 */

export interface ExecutableAgentOpt {
  id: string
  name: string
  executable?: boolean
  archived?: boolean
}

export interface ExecutableWorkflowOpt {
  id: string
  name: string
  status?: string
}

export interface ExecutableFlowOpt {
  id: string
  name: string
  active_release_id?: string | null
}

export function executableAgents(items: ExecutableAgentOpt[]): { id: string; name: string }[] {
  return items
    .filter((a) => a.executable === true)
    .map((a) => ({ id: a.id, name: a.name }))
}

export function executableWorkflows(items: ExecutableWorkflowOpt[]): { id: string; name: string }[] {
  return items
    .filter((w) => w.status === "published")
    .map((w) => ({ id: w.id, name: w.name }))
}

export function executableAgentFlows(items: ExecutableFlowOpt[]): { id: string; name: string }[] {
  return items
    .filter((f) => Boolean(f.active_release_id))
    .map((f) => ({ id: f.id, name: f.name }))
}

/** 默认执行者 = 第一个真正可执行对象；空列表返回 ""（由空态接管，不得回填草稿）。 */
export function defaultExecutorId(opts: { id: string }[]): string {
  return opts[0]?.id ?? ""
}
