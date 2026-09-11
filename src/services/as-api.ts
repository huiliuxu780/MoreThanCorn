/**
 * AgentScope 换底 v2 API 客户端（2026-09-09）。
 * 所有 Agent 运行事实来自运行时（8301 原生 AgentScope），平台只做控制面与索引。
 */
import { ApiError } from "./wf-api";
import { wfApiToken } from "./wf-api";

const BASE = import.meta.env.VITE_WF_API_BASE ?? "http://127.0.0.1:8120";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = wfApiToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      detail = await res.text();
    }
    throw new ApiError(res.status, detail.slice(0, 400));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface RuntimeView {
  editing: { digest: string } | null;
  published: { release_id: string; version_id: string; digest: string } | null;
  running: {
    agentscope_agent_id: string;
    digest?: string;
    matches_published?: boolean;
    missing?: boolean;
  } | null;
}

export interface SessionRow {
  session_id: string;
  trigger_kind: string;
  conversation_key: string | null;
  automation_id: string | null;
  agentflow_node_run_id?: string | null;
  created_at: string;
}

export interface BoardTask {
  id: string;
  kind: string;
  title: string;
  executor: string;
  executor_id?: string | null;
  source: string;
  source_label: string;
  lane: string;
  ended: boolean;
  status_label: string;
  updated_at: string;
  session_id?: string | null;
  detail_route: string;
}

export const asApi = {
  // Agent 控制面 + 运行时代理
  createRelease: (aid: string, agentVersionId: string) =>
    req<{ release_id: string; agentscope_agent_id: string }>(
      `/api/v2/agents/${aid}/releases`,
      { method: "POST", body: JSON.stringify({ agent_version_id: agentVersionId }) },
    ),
  runtimeView: (aid: string) => req<RuntimeView>(`/api/v2/agents/${aid}/runtime-view`),
  listSessions: (aid: string) =>
    req<{ items: SessionRow[] }>(`/api/v2/agents/${aid}/sessions`),
  openSession: (aid: string, conversationKey?: string) =>
    req<{ session_id: string }>(`/api/v2/agents/${aid}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        conversation_key: conversationKey ?? null,
        policy: conversationKey ? "conversation" : "fresh",
      }),
    }),
  turn: (aid: string, sid: string, text: string) =>
    req<{ status: string }>(`/api/v2/agents/${aid}/sessions/${sid}/turns`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  messages: (aid: string, sid: string) =>
    req<{ messages: Record<string, unknown>[] }>(
      `/api/v2/agents/${aid}/sessions/${sid}/messages`,
    ),
  status: (aid: string, sid: string) =>
    req<Record<string, unknown>>(`/api/v2/agents/${aid}/sessions/${sid}/status`),
  interrupt: (aid: string, sid: string) =>
    req<Record<string, unknown>>(`/api/v2/agents/${aid}/sessions/${sid}/interrupt`, {
      method: "POST",
    }),
  // 2026-09-10：对话任务删除（运行时 Session + 平台索引）
  deleteSession: (aid: string, sid: string) =>
    req<{ deleted: boolean; session_id: string; runtime_error: string | null }>(
      `/api/v2/agents/${aid}/sessions/${sid}`,
      { method: "DELETE" },
    ),
  // P0-H（09-10）：HITL 批准/拒绝（awaiting_permission 时提交确认事件）
  confirm: (aid: string, sid: string, confirmed: boolean) =>
    req<Record<string, unknown>>(`/api/v2/agents/${aid}/sessions/${sid}/confirm`, {
      method: "POST",
      body: JSON.stringify({ confirmed }),
    }),
  // P0-5：SSE 经平台代理（同源 + 服务端鉴权），不直连 Runtime
  streamUrl: (aid: string, sid: string) =>
    Promise.resolve({
      url: `${BASE}/api/v2/agents/${aid}/sessions/${sid}/stream`,
    }),
  singleRun: (aid: string, text: string, schema?: Record<string, unknown>) =>
    req<{ session_id: string; structured_output?: unknown; text?: string }>(
      `/api/v2/agents/${aid}/runs`,
      { method: "POST", body: JSON.stringify({ text, output_schema: schema ?? null }) },
    ),
  workspaceSkills: (aid: string, sid: string) =>
    req<unknown[]>(`/api/v2/agents/${aid}/sessions/${sid}/skills`),
  workspaceMcps: (aid: string, sid: string) =>
    req<unknown[]>(`/api/v2/agents/${aid}/sessions/${sid}/mcps`),
  addMcp: (aid: string, sid: string, name: string, url: string) =>
    req<{ status: string }>(`/api/v2/agents/${aid}/sessions/${sid}/mcps`, {
      method: "POST",
      body: JSON.stringify({ name, url }),
    }),
  mcpLibrary: (aid: string, sid: string) =>
    req<unknown[]>(`/api/v2/agents/${aid}/sessions/${sid}/mcp-library`),

  // 看板
  boardSummary: (period = "30d") =>
    req<Record<string, unknown>>(`/api/board/summary?period=${period}`),
  boardTasks: (params: Record<string, string>) =>
    req<{ items: BoardTask[]; total: number }>(
      `/api/board/tasks?${new URLSearchParams(params).toString()}`,
    ),
  boardFilters: () => req<Record<string, unknown>>("/api/board/filter-options"),

  // 自动任务（P0-G 09-10：列表支持筛选/排序/分页）
  automations: (params?: Record<string, string>) =>
    req<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number }>(
      `/api/v2/automations${params && Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : ""}`,
    ),
  automation: (id: string) => req<Record<string, unknown>>(`/api/v2/automations/${id}`),
  createAutomation: (body: Record<string, unknown>) =>
    req<Record<string, unknown>>("/api/v2/automations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAutomation: (id: string, body: Record<string, unknown>) =>
    req<Record<string, unknown>>(`/api/v2/automations/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  setEnabled: (id: string, enabled: boolean) =>
    req<Record<string, unknown>>(`/api/v2/automations/${id}/enabled?enabled=${enabled}`, {
      method: "PATCH",
    }),
  runNow: (id: string) =>
    req<Record<string, unknown>>(`/api/v2/automations/${id}/run-now`, { method: "POST" }),
  history: (id: string) => req<Record<string, unknown>>(`/api/v2/automations/${id}/history`),
  createApiKey: (id: string) =>
    req<{ key: string; id: string }>(`/api/v2/automations/${id}/api-keys`, {
      method: "POST",
    }),
  addTrigger: (id: string, kind: string, config: Record<string, unknown>) =>
    req<Record<string, unknown>>(`/api/v2/automations/${id}/triggers`, {
      method: "POST",
      body: JSON.stringify({ kind, config }),
    }),
  deleteAutomation: (id: string) =>
    req<{ status: string }>(`/api/v2/automations/${id}`, { method: "DELETE" }),

  // AgentFlow
  flows: () => req<{ items: Record<string, unknown>[] }>("/api/v2/agentflows"),
  deleteFlow: (fid: string) =>
    req<{ ok: boolean }>(`/api/v2/agentflows/${fid}`, { method: "DELETE" }),
  patchFlow: (fid: string, p: { name?: string; description?: string }) =>
    req<{ id: string; name: string; description: string }>(`/api/v2/agentflows/${fid}`, {
      method: "PATCH",
      body: JSON.stringify(p),
    }),
  createFlow: (name: string, description = "") =>
    req<{ id: string }>("/api/v2/agentflows", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  flowVersions: (fid: string) =>
    req<{ items: Record<string, unknown>[] }>(`/api/v2/agentflows/${fid}/versions`),
  flowRuns: (fid: string) =>
    req<{ items: Record<string, unknown>[] }>(`/api/v2/agentflows/${fid}/runs`),
  createFlowVersion: (fid: string, definition: Record<string, unknown>) =>
    req<{ id: string; version_no: number }>(`/api/v2/agentflows/${fid}/versions`, {
      method: "POST",
      body: JSON.stringify({ definition }),
    }),
  releaseFlow: (fid: string, versionId: string) =>
    req<{ id: string }>(`/api/v2/agentflows/${fid}/releases`, {
      method: "POST",
      body: JSON.stringify({ version_id: versionId }),
    }),
  runFlow: (releaseId: string, input: Record<string, unknown>) =>
    req<Record<string, unknown>>("/api/v2/agentflows/runs", {
      method: "POST",
      body: JSON.stringify({ release_id: releaseId, input }),
    }),
  flowRun: (rid: string) => req<Record<string, unknown>>(`/api/v2/agentflows/runs/${rid}`),
  rerunNode: (rid: string, nodeId: string) =>
    req<Record<string, unknown>>(`/api/v2/agentflows/runs/${rid}/nodes/${nodeId}/rerun`, {
      method: "POST",
    }),

  // 数据接入
  sources: () => req<{ items: Record<string, unknown>[] }>("/api/v2/data-sources"),
  createSource: (body: Record<string, unknown>) =>
    req<Record<string, unknown>>("/api/v2/data-sources", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  testEvent: (sid: string, payload: Record<string, unknown>) =>
    req<Record<string, unknown>>(`/api/v2/data-sources/${sid}/test-event`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // 知识库
  createKb: (name: string, modelId: string) =>
    req<{ knowledge_base_id: string }>("/api/v2/knowledge-bases", {
      method: "POST",
      body: JSON.stringify({ name, model_id: modelId }),
    }),
  kbStatus: (kbId: string, ids: string[]) =>
    req<Record<string, unknown>[]>(
      `/api/v2/knowledge-bases/${kbId}/documents/status?ids=${ids.join(",")}`,
    ),
};

/** 运行时 SSE：原生 AgentEvent 流（X-User-ID 头由平台登录态映射）。 */
export function openRuntimeStream(
  url: string,
  onEvent: (ev: Record<string, unknown>) => void,
  onDone?: () => void,
  external?: AbortController,
): AbortController {
  const ctrl = external ?? new AbortController();
  const token = wfApiToken();
  fetch(url, {
    headers: {
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: ctrl.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        onDone?.();
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = frame
            .split("\n")
            .find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            onEvent(JSON.parse(dataLine.slice(5).trim()));
          } catch {
            /* heartbeat/注释帧忽略 */
          }
        }
      }
      onDone?.();
    })
    .catch(() => onDone?.());
  return ctrl;
}
