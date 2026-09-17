/**
 * AgentScope 换底 v2 API 客户端（2026-09-09）。
 * 所有 Agent 运行事实来自运行时（8301 原生 AgentScope），平台只做控制面与索引。
 */
import { ApiError, WF_BASE, combinedSignal, wfApiToken } from "./wf-api";

// 09-13 审计修复：基址单一事实源（原文件各自维护默认端口）
const BASE = WF_BASE;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = wfApiToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    signal: combinedSignal(init?.signal),  // 统一 30s 超时 + 调用方取消
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    // 09-13 审计修复：body 只消费一次（原实现 json() 失败后再 text() 必抛
    // "body already read"，二次异常吞掉原始状态与响应内容）
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      detail = JSON.stringify(JSON.parse(text));
    } catch {
      /* 非 JSON 响应保留原文 */
    }
    throw new ApiError(res.status, (detail || res.statusText).slice(0, 400));
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
  /** 09-16 f：LLM 短总结标题（空=尚未生成，前端回落触发类型文案） */
  title?: string | null;
  /** 09-16 a：置顶（列表已按置顶优先排序） */
  pinned?: boolean;
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

/** 09-14 D3：EventRoute / EventDelivery DTO（治理页）。 */
export interface EventRouteDTO {
  id: string; origin: "event_route" | "automation_trigger";
  sourceId: string; eventType: string;
  destination: { kind: "automation" | "analysis_task"; id: string };
  filter: { version: number; expression: Record<string, unknown> };
  mapping: { version: number; fields: Record<string, string> };
  dedupe: { keyPath?: string; windowSeconds?: number };
  completionPolicy: "accepted" | "terminal";
  retryPolicy: Record<string, unknown>;
  enabled: boolean; archived: boolean; revision: number;
}
/** 16 号稿 B1：概览带每源健康聚合行（/data-sources/health-summary）。 */
export interface SourceHealthRow {
  sourceId: string; name: string; kind: string; status: string;
  lastPollAt: string | null; lastPollOk: boolean; lastPollError: string;
  lastPollCount: number; events24h: number;
  /** 自动拉取间隔（秒）；0=仅手动（watcher 不 tick） */
  intervalSeconds: number;
  /** filtered=24h filtered 事件数（不产生 delivery 行） */
  deliveries24h: { completed: number; failed: number; dead: number; filtered: number };
  routeCount: number;
}
/** 路由创建体（POST /event-routes，camelCase 与 _validate_route_body 对齐）。 */
export interface CreateRouteBody {
  sourceId: string;
  destination: { kind: "automation" | "analysis_task"; id: string };
  eventType?: string;
  filter?: Record<string, unknown>;
  mapping?: Record<string, unknown>;
  dedupe?: { keyPath?: string; windowSeconds?: number };
  completionPolicy?: "accepted" | "terminal";
  retryPolicy?: Record<string, unknown>;
  enabled?: boolean;
}
export interface EventDeliveryDTO {
  id: string; eventId: string; source: string; status: string;
  routeId: string | null; routeRevision: number | null;
  destinationKind: string | null; destinationId: string | null;
  invocationId: string | null; taskRunId: string | null;
  completionPolicy: string; completionMeaning: string;
  attempts: number; maxAttempts: number;
  nextRetryAt: string | null; deadReason: string | null; error: string | null;
  createdAt: string | null; updatedAt: string | null;
}

/** 看板摘要契约（/api/board/summary，09-13 审计修复：替代页面宽泛 Record 转换）。
 *  lanes 语义（board_projection.py）：pending=排队中；waiting=运行时等待人工=需要操作。 */
export interface BoardSummary {
  period: string;
  total: number;
  running: number;
  needs_action: number;
  ended: number;
  lanes: Record<string, number>;
}

/** 数据接入源（/api/v2/data-sources，09-13 审计修复：强类型契约）。 */
export interface SourceRow {
  id: string;
  name: string;
  kind: "webhook" | "api_pull" | "maxcompute" | "feishu_bitable" | "sls" | "test_event";
  status: "active" | "paused" | "error";
  config: Record<string, unknown>;
  last_poll_at: string | null;
  created_at?: string;
}

export interface CreateSourceBody {
  name: string;
  kind: "webhook" | "api_pull" | "maxcompute" | "feishu_bitable" | "sls" | "test_event";
  config: {
    /** api_pull：拉取地址/间隔/游标/页大小 */
    url?: string; interval_seconds?: number; cursor_field?: string;
    cursor_param?: string; page_size?: number;
    /** maxcompute：endpoint/project/table */
    endpoint?: string; project?: string; table?: string;
    /** feishu_bitable：app_token/table_id/view_id */
    app_token?: string; table_id?: string; view_id?: string;
    /** sls：endpoint/project/logstore/query */
    logstore?: string; query?: string;
    /** 事件过滤 {field, op: eq|ne|contains|gt|lt, value  signing_secret?: string
} */
    filter?: { field: string; op: string; value: unknown };
    /** 字段映射：触发输入键 → payload 取值路径 */
    mapping?: Record<string, string>;
  };
  /** 非 webhook 凭据（加密落库，永不回显） */
  secret?: Record<string, unknown> | string;
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
  /** 09-16 a：对话任务重命名（原站⋯菜单同构） */
  renameSession: (aid: string, sid: string, title: string) =>
    req<{ session_id: string; title: string | null }>(`/api/v2/agents/${aid}/sessions/${sid}`, {
      method: "PATCH", body: JSON.stringify({ title }),
    }),
  /** 09-16 a：对话任务置顶/取消置顶 */
  pinSession: (aid: string, sid: string, pinned: boolean) =>
    req<{ session_id: string; pinned: boolean }>(`/api/v2/agents/${aid}/sessions/${sid}/pin`, {
      method: "POST", body: JSON.stringify({ pinned }),
    }),
  openSession: (aid: string, opts?: {
    conversationKey?: string; releaseId?: string; modelOverride?: { model: string }; compare?: boolean
  }) =>
    req<{ session_id: string }>(`/api/v2/agents/${aid}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        conversation_key: opts?.conversationKey ?? null,
        policy: opts?.conversationKey ? "conversation" : "fresh",
        release_id: opts?.releaseId ?? null,
        model_override: opts?.modelOverride ?? null,
        compare: opts?.compare ?? false,
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
  boardSummary: (period = "30d", signal?: AbortSignal) =>
    req<BoardSummary>(`/api/board/summary?period=${period}`, { signal }),
  boardTasks: (params: Record<string, string>, signal?: AbortSignal) =>
    req<{ items: BoardTask[]; total: number }>(
      `/api/board/tasks?${new URLSearchParams(params).toString()}`, { signal },
    ),
  boardFilters: (signal?: AbortSignal) =>
    req<Record<string, unknown>>("/api/board/filter-options", { signal }),

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
  answerFlowInput: (rid: string, nodeRunId: string, body: { value?: unknown; skipped?: boolean }) =>
    req<{ ok: boolean }>(`/api/v2/agentflows/runs/${rid}/inputs/${nodeRunId}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  generateScript: (body: {
    brief: string
    waker_ids: string[]
    waker_names?: Record<string, string>
    current_script?: string
  }) =>
    req<{ script: string; attempts: number }>("/api/v2/agentflows/generate-script", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  rerunNode: (rid: string, nodeId: string) =>
    req<Record<string, unknown>>(`/api/v2/agentflows/runs/${rid}/nodes/${nodeId}/rerun`, {
      method: "POST",
    }),

  // 数据接入（09-13 审计修复：强类型契约替代 Record<string, unknown> 宽转换）
  sources: (signal?: AbortSignal) =>
    req<{ items: SourceRow[] }>("/api/v2/data-sources", { signal }),
  kbConfigStatus: (signal?: AbortSignal) =>
    req<Record<string, unknown>>("/api/v2/knowledge-bases/config-status", { signal }),
  createSource: (body: CreateSourceBody) =>
    req<{ id: string; webhook_token?: string }>("/api/v2/data-sources", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  testEvent: (sid: string, payload: Record<string, unknown>) =>
    req<{ event_id: string; status: string; dispatch_ref: string | null }>(
      `/api/v2/data-sources/${sid}/test-event`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  pollSource: (sid: string) =>
    req<{ polled: number; dispatched: number; cursor: Record<string, unknown> }>(
      `/api/v2/data-sources/${sid}/poll`, { method: "POST" }),
  /* 09-14 D3：数据源治理页 */
  sourceGet: (sid: string) =>
    req<{ id: string; name: string; kind: string; config: Record<string, unknown>;
          status: string; archived: boolean; cursor: Record<string, unknown>;
          last_poll_at: string | null; has_token: boolean; has_secret: boolean;
          connectionId: string | null; assetId: string | null;
          created_at: string | null; has_signing: boolean;
          signing_prev_until: string | null }>(
      `/api/v2/data-sources/${sid}`),
  setSigningSecret: (sid: string, secret: string) =>
    req<{ rotated: boolean; prev_active_until: string | null }>(
      `/api/v2/data-sources/${sid}/signing-secret`,
      { method: "POST", body: JSON.stringify({ secret }) }),
  sourcePatch: (sid: string, body: { name?: string; config?: Record<string, unknown>;
                                     status?: "active" | "paused"; archived?: false;
                                     connection_id?: string | null; asset_id?: string | null }) =>
    req<{ id: string; name: string; kind: string; config: Record<string, unknown>;
          status: string; archived: boolean }>(`/api/v2/data-sources/${sid}`, {
      method: "PATCH", body: JSON.stringify(body),
    }),
  sourceDelete: (sid: string) =>
    req<{ id: string; archived: boolean } | { detail: { code: string; detail: string;
      references: { kind: string; count: number }[] } }>(
      `/api/v2/data-sources/${sid}`, { method: "DELETE" }),
  sourceSetSecret: (sid: string, secret: Record<string, unknown> | { clear: true }) =>
    req<{ id: string; has_secret: boolean }>(`/api/v2/data-sources/${sid}/secret`, {
      method: "POST", body: JSON.stringify({ secret }),
    }),
  sourceRegenerateToken: (sid: string) =>
    req<{ id: string; webhook_token: string; note: string }>(
      `/api/v2/data-sources/${sid}/regenerate-token`, { method: "POST" }),
  eventRoutes: (params: { sourceId?: string; includeArchived?: string } = {}) => {
    const q = new URLSearchParams()
    if (params.sourceId) q.set("sourceId", params.sourceId)
    if (params.includeArchived) q.set("includeArchived", params.includeArchived)
    return req<{ items: EventRouteDTO[]; total: number }>(
      `/api/v2/event-routes${q.toString() ? `?${q}` : ""}`)
  },
  /** 16 号稿 B1：概览带健康聚合（常数条查询）。 */
  healthSummary: () =>
    req<{ items: SourceHealthRow[] }>("/api/v2/data-sources/health-summary"),
  createRoute: (body: CreateRouteBody) =>
    req<EventRouteDTO>("/api/v2/event-routes", {
      method: "POST", body: JSON.stringify(body) }),
  eventDeliveries: (params: { sourceId?: string; sourceEventId?: string;
                              status?: string; pageSize?: number } = {}) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, String(v))
    return req<{ items: EventDeliveryDTO[]; total: number }>(
      `/api/v2/event-deliveries${q.toString() ? `?${q}` : ""}`)
  },
  deliveryRetry: (did: string) =>
    req<EventDeliveryDTO>(`/api/v2/event-deliveries/${did}/retry`, { method: "POST" }),

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
  onReconnect?: () => void,
): AbortController {
  const ctrl = external ?? new AbortController();
  const token = wfApiToken();
  // 09-17（用户指认「回答时不跟随」根因之二）：上游 SSE 结束/网络断（runtime 空闲断、
  // 后端重启）后自动重连——此前流一次性死掉，live 事件永久丢失。
  // !res.ok（鉴权/404 等配置性错误）不重连，交 onDone 由页面处置。
  let established = false;
  const run = async () => {
    for (;;) {
      if (ctrl.signal.aborted) return;
      try {
        const res = await fetch(url, {
          headers: {
            Accept: "text/event-stream",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          onDone?.();
          return;
        }
        if (established) onReconnect?.();
        established = true;
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
      } catch {
        if (ctrl.signal.aborted) return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  };
  void run();
  return ctrl;
}

// ---------------------------------------------------------------------------
// Group（多 Agent 群聊协作组）客户端（Spec group-capability v1.1 §4.1）
// ---------------------------------------------------------------------------

export interface GroupMemberView {
  agentId: string
  role: "leader" | "member"
  config: Record<string, unknown>
  agentName: string
}

export interface GroupView {
  id: string
  name: string
  description: string | null
  leaderAgentId: string
  avatar: string | null
  archived: boolean
  revision: number
  memberCount: number
  members: GroupMemberView[]
  activeSessionId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface GroupSessionView {
  id: string
  title: string | null
  status: "active" | "closed" | "failed"
  pinned?: boolean
  leaderSessionId: string | null
  runtimeTeamId: string | null
  closedAt: string | null
  createdAt: string | null
}

export interface GroupStreamEnvelope {
  id: number
  source: { agentId: string; name: string; role: "leader" | "member"; sessionId: string }
  payload: string
}

export const groupsApi = {
  list: (archived: "" | "true" | "all" = "") =>
    req<{ total: number; items: GroupView[] }>(
      `/api/v2/groups${archived ? `?archived=${archived}` : ""}`),
  get: (gid: string) => req<GroupView>(`/api/v2/groups/${gid}`),
  create: (body: {
    name: string
    description?: string | null
    leader_agent_id: string
    members: { agent_id: string; config?: Record<string, unknown> }[]
  }) =>
    req<GroupView>("/api/v2/groups", { method: "POST", body: JSON.stringify(body) }),
  patch: (gid: string, body: Record<string, unknown>) =>
    req<GroupView>(`/api/v2/groups/${gid}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (gid: string) =>
    req<{ id: string; deleted?: boolean; archived?: boolean }>(
      `/api/v2/groups/${gid}`, { method: "DELETE" }),
  archive: (gid: string) =>
    req<GroupView>(`/api/v2/groups/${gid}/archive`, { method: "POST" }),
  restore: (gid: string) =>
    req<GroupView>(`/api/v2/groups/${gid}/restore`, { method: "POST" }),
  sessions: (gid: string) =>
    req<{ items: GroupSessionView[] }>(`/api/v2/groups/${gid}/sessions`),
  setSigningSecret: (sid: string, secret: string) =>
    req<{ rotated: boolean; prev_active_until: string | null }>(
      `/api/v2/data-sources/${sid}/signing-secret`,
      { method: "POST", body: JSON.stringify({ secret }) }),
  sessionDetail: (gid: string, gsid: string) =>
    req<GroupSessionView & {
      leaderAgentId: string
      members: { agentId: string; sessionId: string; role: "leader" | "member" }[]
    }>(`/api/v2/groups/${gid}/sessions/${gsid}`),
  open: (gid: string) =>
    req<GroupSessionView & { id: string }>(`/api/v2/groups/${gid}/sessions`,
      { method: "POST" }),
  turn: (gid: string, gsid: string, text: string) =>
    req<{ status: string; session_id: string }>(
      `/api/v2/groups/${gid}/sessions/${gsid}/turns`,
      { method: "POST", body: JSON.stringify({ text }) }),
  confirm: (gid: string, gsid: string, agentId: string, confirmed: boolean) =>
    req<Record<string, unknown>>(
      `/api/v2/groups/${gid}/sessions/${gsid}/confirm`,
      { method: "POST", body: JSON.stringify({ agent_id: agentId, confirmed }) }),
  interrupt: (gid: string, gsid: string, scope: "leader" | "all" = "all") =>
    req<{ interrupted: number }>(
      `/api/v2/groups/${gid}/sessions/${gsid}/interrupt`,
      { method: "POST", body: JSON.stringify({ scope }) }),
  close: (gid: string, gsid: string) =>
    req<{ id: string; status: string }>(
      `/api/v2/groups/${gid}/sessions/${gsid}`, { method: "DELETE" }),
  /** 09-16 a：群任务重命名 */
  renameSession: (gid: string, gsid: string, title: string) =>
    req<{ id: string; title: string | null }>(`/api/v2/groups/${gid}/sessions/${gsid}`, {
      method: "PATCH", body: JSON.stringify({ title }),
    }),
  /** 09-16 a：群任务置顶/取消置顶 */
  pinSession: (gid: string, gsid: string, pinned: boolean) =>
    req<{ id: string; pinned: boolean }>(`/api/v2/groups/${gid}/sessions/${gsid}/pin`, {
      method: "POST", body: JSON.stringify({ pinned }),
    }),
  skills: (gid: string) =>
    req<{ items: { id: string; skillId: string; name: string; description: string }[] }>(
      `/api/v2/groups/${gid}/skills`),
  mountSkill: (gid: string, skillId: string) =>
    req<{ id: string }>(`/api/v2/groups/${gid}/skills`,
      { method: "POST", body: JSON.stringify({ skill_id: skillId }) }),
  unmountSkill: (gid: string, skillId: string) =>
    req<{ deleted: boolean }>(`/api/v2/groups/${gid}/skills/${skillId}`,
      { method: "DELETE" }),
  sops: (gid: string) =>
    req<{
      boundSopId: string | null
      items: { id: string; name: string; revision: number; status: string; content: string; publishedAt: string | null }[]
    }>(`/api/v2/groups/${gid}/sops`),
  createSop: (gid: string, name: string, content: string) =>
    req<{ id: string; status: string; revision: number }>(
      `/api/v2/groups/${gid}/sops`,
      { method: "POST", body: JSON.stringify({ name, content }) }),
  publishSop: (gid: string, sopId: string) =>
    req<{ id: string; status: string }>(
      `/api/v2/groups/${gid}/sops/${sopId}/publish`, { method: "POST" }),
  bindSop: (gid: string, sopId: string | null) =>
    req<{ boundSopId: string | null }>(`/api/v2/groups/${gid}/sop-bind`,
      { method: "POST", body: JSON.stringify({ sop_id: sopId }) }),
  /** 聚合 SSE（Spec §4.3）：envelope={id, source, payload(原 runtime 事件 JSON 串)}。 */
  streamUrl: (gid: string, gsid: string) =>
    `${BASE}/api/v2/groups/${gid}/sessions/${gsid}/stream`,
}

export function openGroupStream(
  gid: string,
  gsid: string,
  onEnvelope: (env: GroupStreamEnvelope) => void,
  onDone?: () => void,
  external?: AbortController,
  onReconnect?: () => void,
): AbortController {
  return openRuntimeStream(
    groupsApi.streamUrl(gid, gsid),
    (ev) => onEnvelope(ev as unknown as GroupStreamEnvelope),
    onDone,
    external,
    onReconnect,
  )
}
