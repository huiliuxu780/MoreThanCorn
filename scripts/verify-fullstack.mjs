/**
 * 全链路真实运行验证（资源管理一期 + 平台主干）。
 * 用法：先启动后端（server: uvicorn app.main:app --port 8100），再 `node scripts/verify-fullstack.mjs`。
 * 输出每个用例 PASS/FAIL；存在 FAIL 时退出码 1。
 */
const BASE = process.env.VERIFY_BASE ?? "http://127.0.0.1:8100";
const results = [];
let seq = 0;

async function req(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json };
}

function check(id, name, cond, extra = "") {
  results.push({ id, name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${id}  ${name}${extra ? `  (${extra})` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const u = (p) => `${p}-${Math.random().toString(36).slice(2, 7)}`;

async function pollRun(runId, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { json } = await req("GET", `/api/runs/${runId}`);
    if (json && !["queued", "running", "pending"].includes(json.status)) return json;
    await sleep(500);
  }
  return null;
}

// ---------- S1 基础 ----------
{
  const h = await req("GET", "/healthz");
  check("S1-1", "后端健康检查 /healthz", h.status === 200 && h.json?.ok === true);
  const nd = await req("GET", "/api/registry/node-definitions");
  const keys = (nd.json ?? []).map((d) => d.type_key);
  check("S1-2", "节点注册表含 knowledge-retrieval / mcp-call", keys.includes("knowledge-retrieval") && keys.includes("mcp-call"));
}

// ---------- S2 Connections（SDD-12 P0：Draft/启用门禁/真实检查） ----------
let connId = "";
{
  // SDD-12 修复轮：basic 凭据必须结构化（含 username）
  const c = await req("POST", "/api/connections", { name: u("conn"), protocol: "mysql", endpoint: { host: "rm.internal", port: 3306 }, kind: "Basic Auth", secret: { username: "app", password: "ak-sk" } });
  connId = c.json?.id ?? "";
  check("S2-1", "创建 Connection（protocol+endpoint+secret）", c.status === 201 && !!connId);
  check("S2-1b", "新建连接默认 Draft（C-01）", c.json?.lifecycle === "draft");
  const l = await req("GET", "/api/connections?type=mysql");
  check("S2-2", "Connection 按协议筛选且凭证掩码", l.json?.items?.some((i) => i.id === connId && i.secretConfigured === true));
  // C-02：从未做过真实检查 → 启用被拒（422 CONNECTION_UNCHECKED）
  const en0 = await req("POST", `/api/connections/${connId}:enable`);
  check("S2-3a", "从未检查的连接不得启用（C-02 门禁，422）", en0.status === 422 && en0.json?.detail?.code === "CONNECTION_UNCHECKED");
  // R8-UI-6：09-P0 审计修复后连接探测 fail-closed（不可达诚实报错，禁假真）；
  // 正向路径用 http-api 自探活（本机服务 200）
  const t = await req("POST", `/api/connections/${connId}/test`);
  check("S2-3", "Connection fail-closed（不可达诚实报错）", t.json?.ok === false && !!t.json?.error);
  const en1f = await req("POST", `/api/connections/${connId}:enable`);
  check("S2-3a2", "检查失败后仍不得启用（409）", en1f.status === 409);
  const hc = await req("POST", "/api/connections", { name: u("conn-http"), protocol: "http-api", endpoint: { base_url: `${BASE}/api/registry/models` }, kind: "none" });
  const ht = await req("POST", `/api/connections/${hc.json?.id}/test`, {});
  check("S2-3b", "Connection 真探活（自服务 200，产出 CheckRun）", ht.json?.ok === true && !!ht.json?.checkRunId);
  const en1 = await req("POST", `/api/connections/${hc.json?.id}:enable`);
  check("S2-3c", "真实检查通过后启用（draft→active）", en1.status === 200 && en1.json?.lifecycle === "active");
  const rv = await req("GET", `/api/connections/${connId}/reveal`);
  check("S2-4", "Secret reveal 恒 410（B-01）", rv.status === 410 && rv.json?.detail?.code === "SECRET_REVEAL_DISABLED");
}

// ---------- S3 Datasource（SDD-12 P0：tested 无效 + 启用门禁） ----------
let dsId = "";
let dsHttpId = "";
let dsConnId = "";
{
  const d = await req("POST", "/api/data-resources/datasources", { name: u("ds"), type: "mysql", connectionId: connId, location: "db_cc", tested: true });
  dsId = d.json?.id ?? "";
  check("S3-1", "创建即 Disabled（tested 自报无效，P0-04）", d.json?.status === "disabled");
  const gate = await req("POST", `/api/data-resources/datasources/${dsId}/toggle`, { enabled: true });
  check("S3-2b", "从未测试不得启用（启用门禁，422）", gate.status === 422);
  const t = await req("POST", `/api/data-resources/datasources/${dsId}/test`, {});
  check("S3-2", "Datasource 测试 fail-closed（mysql 不可达，诚实报错）", t.json?.ok === false && !!t.json?.error);
  // 正向路径：指向本服务的 http 数据源（真实可达）
  const hc2 = await req("POST", "/api/connections", { name: u("ds-conn"), protocol: "http-api", endpoint: { base_url: `${BASE}/api/registry/models` }, kind: "none" });
  dsConnId = hc2.json?.id ?? "";
  const dh = await req("POST", "/api/data-resources/datasources", { name: u("ds-http"), type: "http", connectionId: dsConnId, location: "" });
  dsHttpId = dh.json?.id ?? "";
  const th = await req("POST", `/api/data-resources/datasources/${dsHttpId}/test`, {});
  check("S3-3", "http Datasource 真实测试通过（带 CheckRun）", th.json?.ok === true && !!th.json?.checkRunId);
  await req("POST", `/api/data-resources/datasources/${dsHttpId}/toggle`, { enabled: true });
  const g = await req("GET", `/api/data-resources/datasources/${dsHttpId}`);
  check("S3-4", "测试通过后启用：状态/健康度正确", g.json?.status === "enabled" && g.json?.health === "healthy");
}

// ---------- S4 Data Asset（SDD-12 P0：Draft→测试→Ready） ----------
let assetId = "";
{
  // R8-UI-6：挂 datasource 的 asset 必须真实 reader（生产禁 mock）；dev 抽样正路径=
  // 无 datasource 的内联 rows asset（datasource 挂载语义在 S3/S11 覆盖）
  const a = await req("POST", "/api/data-resources/assets", { name: u("asset"), location: "t_call_session", recordMeaning: "一通客服对话", timeField: "call_start_at", rows: [
    { call_id: "C-1", conversation: "客户：我要退款。坐席：已为您创建工单。", call_start_at: "2026-01-01T00:00:00Z" },
    { call_id: "C-2", conversation: "客户：咨询保修。坐席：保修一年。", call_start_at: "2026-01-02T00:00:00Z" },
  ] });
  assetId = a.json?.id ?? "";
  check("S4-1", "创建 Data Asset → Draft/Disabled（tested 不再采信）", a.status === 201 && a.json?.status === "disabled");
  const t = await req("POST", `/api/data-resources/assets/${assetId}/test`, {});
  check("S4-2", "Data Asset 抽样测试（内联 rows）", t.json?.ok === true);
  await req("POST", `/api/data-resources/assets/${assetId}/toggle`, { enabled: true });
  const g = await req("GET", `/api/data-resources/assets/${assetId}`);
  check("S4-3", "测试通过后转正（Ready）", g.json?.status === "enabled");
}

// ---------- S5 Data Definition ----------
let defId = "", defVersionId = "", ruleSetId = "", ruleVersionId = "";
{
  const d = await req("POST", "/api/data-definitions", { name: u("def"), assetId });
  defId = d.json?.id ?? "";
  check("S5-1", "创建 Data Definition（Draft）", d.status === 201);
  const inf = await req("POST", `/api/data-definitions/${defId}/infer`);
  check("S5-2", "字段推断（从 Asset 抽样）", (inf.json?.fieldSchema ?? []).length > 0);
  const def2 = await req("POST", "/api/data-definitions", { name: u("def-empty"), assetId });
  const pub0 = await req("POST", `/api/data-definitions/${def2.json?.id}/publish`);
  check("S5-3", "空 schema 发布被拒（422）", pub0.status === 422);
  const pub = await req("POST", `/api/data-definitions/${defId}/publish`);
  check("S5-4", "发布 Ready（revision+1）", pub.json?.lifecycle === "Ready" && (pub.json?.revision ?? 0) >= 2);
  defVersionId = pub.json?.versionId ?? "";
}

// ---------- S6 AI Resources 六类（SDD-12 P0：tested 无效 + fixture 门控） ----------
let toolId = "", toolVersionId = "", mcpId = "", ksId = "", modelKey = "qwen-plus";
{
  const m = await req("GET", "/api/ai-resources/models?pageSize=5");
  check("S6-1", "Models 列表（含 7 日调用聚合）", (m.json?.items ?? []).length > 0);
  const t = await req("POST", "/api/ai-resources/tools", { name: u("tool"), kind: "builtin", spec: { kind: "echo" }, fixture: true });
  toolId = t.json?.id ?? "";
  const te = await req("POST", "/api/ai-resources/tools", { name: u("tool-echo"), kind: "builtin", spec: { kind: "echo" }, tested: true });
  check("S6-1b", "普通新建 echo Tool 被拒（D-07；无 fixture 标记）", te.status === 422);
  const vs = await req("GET", `/api/ai-resources/tools/${toolId}/versions`);
  toolVersionId = vs.json?.[0]?.id ?? "";
  check("S6-2", "Tool 创建 + 版本列表", !!toolVersionId);
  const mc = await req("POST", "/api/ai-resources/mcp-servers", { name: u("mcp"), transport: "stdio", command: "npx -y demo" });
  mcpId = mc.json?.id ?? "";
  check("S6-2b", "MCP 创建即 Disabled（tested 自报无效）", mc.json?.status === "disabled");
  const mt = await req("POST", `/api/ai-resources/mcp-servers/${mcpId}/test`, {});
  check("S6-3", "MCP 无真协议实现失败关闭（P0-05，不返回示例工具）", mt.json?.ok === false && !!mt.json?.error);
  const k = await req("POST", "/api/ai-resources/knowledge-sources", { name: u("ks"), kind: "vector" });
  ksId = k.json?.id ?? "";
  const kt = await req("POST", `/api/ai-resources/knowledge-sources/${ksId}/test`, { query: "退款" });
  check("S6-4", "Knowledge 无真实后端失败关闭（无 [mock] 切片）", kt.json?.ok === false && !!kt.json?.error);
  const tt = await req("POST", `/api/ai-resources/tools/${toolId}/test`, { input: "ping" });
  check("S6-5", "echo Tool 非 fixture 运行失败关闭（J-02）", tt.json?.ok === false && !!tt.json?.error);
}

// ---------- S7 Workflow 全联动：kr + mcp + llm + tool + create-record ----------
let wfId = "", wfRecId = "", runId = "", qrId = "";
{
  const w = await req("POST", "/api/workflows", { name: u("wf"), description: "全链路验证" });
  wfId = w.json?.id ?? "";
  const det = await req("GET", `/api/workflows/${wfId}`);
  const defn = det.json.definition;
  defn.graph.nodes = [
    { id: "s", type: "input", name: "开始", config: {}, inputs: [] },
    { id: "kr", type: "knowledge-retrieval", name: "知识检索", config: { knowledgeSourceId: ksId, query: "{{s.outputs.userQuery}}", topK: 3 }, inputs: [] },
    { id: "mc", type: "mcp-call", name: "MCP 工具", config: { mcpServerId: mcpId, toolName: "search_docs", args: {} }, inputs: [] },
    { id: "llm", type: "llm", name: "判定", config: { modelRef: { modelId: modelKey }, prompt: "基于 {{kr.outputs.slices}} 判定 {{s.outputs.userQuery}}" }, inputs: [] },
    { id: "tl", type: "tool", name: "工单", config: { toolId, toolVersionId }, inputs: [] },
    { id: "cr", type: "create-record", name: "质检记录", config: { outputKey: "quality_result" }, inputs: [{ name: "output", type: "string", source: { kind: "upstream", nodeId: "llm", path: "outputs.output" } }] },
  ];
  defn.graph.edges = [
    { id: "e1", source: "s", target: "kr" }, { id: "e2", source: "kr", target: "mc" },
    { id: "e3", source: "mc", target: "llm" }, { id: "e4", source: "llm", target: "tl" },
    { id: "e5", source: "tl", target: "cr" },
  ];
  const sv = await req("PUT", `/api/workflows/${wfId}/draft`, { definition: defn, baseRevision: det.json.draftRevision });
  check("S7-1", "草稿保存（含新节点）", sv.status === 200);
  const va = await req("GET", `/api/workflows/${wfId}/validation`);
  // SDD-12 P0：Knowledge/MCP 无真实后端 → 资源无法启用 → 依赖校验必须如实拦截（禁假绿）。
  // 端到端 kr/mcp 成功运行属 P2（MCP 官方 SDK）/P3（Knowledge 接入）范围。
  check("S7-2", "外部资源停用时依赖校验如实拦截（不假通过）",
        va.json?.ok === false && (va.json?.issues ?? []).some((i) => /停用|不存在/.test(i.message)),
        (va.json?.issues ?? []).map((i) => i.message).join(";"));
  const pb = await req("POST", `/api/workflows/${wfId}/publish?note=verify`);
  check("S7-3", "外部资源未就绪时发布被拒（不产生不可运行的发布版本）", pb.status !== 201, `status=${pb.status}`);
  // 质检结果落库 + 可发布主链：用无外部依赖的记录链（input→create-record）真实走通
  const w2 = await req("POST", "/api/workflows", { name: u("wf-rec"), description: "记录链" });
  wfRecId = w2.json?.id ?? "";
  const det2 = await req("GET", `/api/workflows/${wfRecId}`);
  const defn2 = det2.json.definition;
  defn2.graph.nodes = [
    { id: "s", type: "input", name: "开始", config: {}, inputs: [] },
    { id: "cr", type: "create-record", name: "质检记录", config: { outputKey: "quality_result" },
      inputs: [{ name: "output", type: "string", source: { kind: "fixed", value: "P0 记录链" } }] },
  ];
  defn2.graph.edges = [{ id: "e1", source: "s", target: "cr" }];
  await req("PUT", `/api/workflows/${wfRecId}/draft`, { definition: defn2, baseRevision: det2.json.draftRevision });
  const pb2 = await req("POST", `/api/workflows/${wfRecId}/publish?note=verify`);
  check("S7-4", "无外部依赖主链发布成功", pb2.status === 201);
  const rn2 = await req("POST", "/api/runs", { workflowId: wfRecId, trigger: "test", input: { interactionId: "V-P0" } });
  runId = rn2.json?.runId ?? "";
  const done2 = await pollRun(runId);
  const q = await req("GET", "/api/quality-results?page=1&pageSize=5");
  qrId = q.json?.items?.[0]?.id ?? "";
  check("S7-5", "质检结果落库（quality_result，真实运行产生）", done2?.status === "succeeded" && !!qrId);
}

// ---------- S8 规则引擎 + S9 Review ----------
{
  const r = await req("POST", "/api/result-rules", { name: u("rules"), rules: { scoreRules: [{ field: "score", op: "exists", value: 1, weight: 0 }], issueRules: [] } });
  const rid = r.json?.id ?? "";
  const p = await req("POST", `/api/result-rules/${rid}/publish`);
  // R8-UI-6：P0-07 废止全库重算——发布=不可变版本快照冻结
  check("S8-1", "规则发布冻结版本（P0-07 不全库重算）", !!p.json?.ruleVersionId);
  ruleSetId = rid; ruleVersionId = p.json?.ruleVersionId ?? "";
  const rv = await req("POST", `/api/quality-results/${qrId}/review`, { action: "approve", reviewer: "verifier", note: "e2e" });
  check("S9-1", "Review 流（approve → REVIEWED）", rv.json?.review === "REVIEWED");
}

// ---------- S10 任务 × Definition ----------
{
  // R8-UI-6：09 闭环修复后规则绑定必须显式（pinned 版本或 follow_latest+RuleSet）
  // SDD-12 P0：任务挂可真实发布的主链工作流（记录链），外部依赖链待 P2/P3
  const t = await req("POST", "/api/tasks", { name: u("task"), workflowId: wfRecId, dataAssetId: assetId, dataDefinitionId: defId, dataDefinitionVersionId: defVersionId, rulePolicy: "pinned", resultRuleVersionId: ruleVersionId });
  const tid = t.json?.id ?? "";
  check("S10-1", "创建任务（带 dataDefinitionId+显式规则绑定）", t.status === 201, t.json?.detail?.message ?? t.json?.detail ?? "");
  // R8-UI-6：batch-run 契约为异步入队（taskRunId），run 由 worker 创建；
  // rows 解析以 taskRun.total>0 断言（Run 成败依赖真实 LLM，同 S7-4 口径）
  const b = await req("POST", `/api/tasks/${tid}/batch-run`, { limit: 2 });
  check("S10-2", "批量运行入队（taskRun 创建）", !!b.json?.taskRunId);
  let trTotal = 0;
  for (let i = 0; i < 12 && trTotal === 0; i++) {
    await new Promise((r) => setTimeout(r, 700));
    const trs = await req("GET", `/api/tasks/${tid}/runs`);
    trTotal = (trs.json?.items ?? []).reduce((m, x) => Math.max(m, x.total ?? 0), 0);
  }
  check("S10-2b", "Definition→Asset 解析 rows（taskRun.total>0）", trTotal > 0);
  const s = await req("POST", `/api/tasks/${tid}/schedule`, { cron: "0 2 * * *" });
  check("S10-4", "任务定时（nextRunAt 计算）", !!s.json?.nextRunAt);
}

// ---------- S11 删除防护矩阵 ----------
{
  // R8-UI-6：S4 的抽样 asset 走无 datasource 内联 rows 路径；此处补挂引用以验证删除防护
  await req("POST", "/api/data-resources/assets", { name: u("asset-ds"), datasourceId: dsId, location: "t", recordMeaning: "x", timeField: "t", tested: false });
  const d1 = await req("DELETE", `/api/data-resources/datasources/${dsId}`);
  check("S11-1", "删 Datasource 被 Asset 引用 → 409+refs", d1.status === 409 && (d1.json?.detail?.refs ?? []).some((r) => r.kind === "data_asset"));
  const d2 = await req("DELETE", `/api/data-resources/assets/${assetId}`);
  check("S11-2", "删 Asset 被 Definition/Task 引用 → 409", d2.status === 409);
  const d3 = await req("DELETE", `/api/data-definitions/${defId}`);
  check("S11-3", "删 Definition 被 Task 引用 → 409", d3.status === 409);
  const d4 = await req("DELETE", `/api/ai-resources/knowledge-sources/${ksId}`);
  check("S11-4", "删 Knowledge 被 Workflow 节点引用 → 409", d4.status === 409 && (d4.json?.detail?.refs ?? []).some((r) => r.kind === "workflow_node"));
  const d5 = await req("DELETE", `/api/ai-resources/mcp-servers/${mcpId}`);
  check("S11-5", "删 MCP 被节点引用 → 409", d5.status === 409);
  const d6 = await req("DELETE", `/api/ai-resources/tools/${toolId}`);
  check("S11-6", "删 Tool 被节点引用 → 409", d6.status === 409);
  // SDD-12 P0-03（取代 08-27"先解绑再删"决策）：有引用 Connection → 409 + refs，不静默解绑
  const d7 = await req("DELETE", `/api/connections/${dsConnId}`);
  check("S11-7", "删 Connection 被 Datasource 引用 → 409+refs（不静默解绑）",
        d7.status === 409 && d7.json?.detail?.code === "REFERENCE_CONFLICT"
        && (d7.json?.detail?.refs ?? []).some((r) => r.kind === "datasource" && r.id === dsHttpId));
  const dsAfter = await req("GET", `/api/data-resources/datasources/${dsHttpId}`);
  check("S11-7b", "引用方未被改动（connectionId 仍在）", dsAfter.json?.config?.connectionId === dsConnId);
  await req("DELETE", `/api/data-resources/datasources/${dsHttpId}`);
  const d8 = await req("DELETE", `/api/connections/${dsConnId}`);
  check("S11-7c", "解除引用后删除 = 归档（软删除，B-07）", d8.status === 200 && d8.json?.lifecycle === "archived");
  const d9 = await req("DELETE", `/api/connections/${dsConnId}?hard=true`);
  check("S11-7d", "归档连接不可硬删（硬删仅限无引用 draft）", d9.status === 422);
}

// ---------- S12 评测（挂可真实运行的记录链工作流） ----------
{
  const e = await req("POST", "/api/eval-samples", { workflowId: wfRecId, name: u("eval"), input: { userQuery: "评测样本" }, dataAssetId: assetId });
  check("S12-1", "评测样本（可挂 Data Asset）", e.status === 201);
  // 79a8a08 起工作流级评测为同步执行：返回 results[]（每条含 runId/终态），不再有 runIds
  const er = await req("POST", `/api/workflows/${wfRecId}/eval-run`);
  check("S12-2", "评测运行触发", (er.json?.results ?? []).length > 0 && er.json.results.every((r) => r.runId));
  const es = await req("GET", `/api/workflows/${wfRecId}/eval-summary`);
  check("S12-3", "评测汇总（成功率/时长）", es.json?.total > 0);
}

// （汇总移至文件末尾：S13/S14 的 check() 也计入退出码——修复此前"汇总先于尾部场景执行"的门禁漏洞）

// ---- S13 Legacy Agent 封存契约（SDD 10 R-Archive；原 Agent 运行层行为封存于
//      tag archive/legacy-agents-20260828，见 docs/archive/legacy-agents/manifest.md） ----
const H = { "Content-Type": "application/json" };
{
  const c1 = await req("POST", "/api/agents", { name: "verify-autonomous", type: "autonomous" });
  check("S13-1", "创建旧三类 Agent → 410 LEGACY_AGENT_ARCHIVED",
        c1.status === 410 && c1.json?.code === "LEGACY_AGENT_ARCHIVED", JSON.stringify(c1.json));
  const c2 = await req("POST", "/api/agents", { name: "verify-dialogue", type: "dialogue" });
  check("S13-1b", "创建对话编排 Agent → 410", c2.status === 410 && c2.json?.code === "LEGACY_AGENT_ARCHIVED");
  const arch = await req("GET", "/api/agents?archived=all&pageSize=50");
  check("S13-2", "旧 Agent 历史列表只读可查", arch.status === 200 && Array.isArray(arch.json?.items));
  // R2 起列表可能含新 Module Agent：封存断言只针对旧三类
  const LEGACY = ["autonomous", "dialogue", "expert-group"];
  const first = (arch.json?.items ?? []).find((i) => LEGACY.includes(i.type));
  if (first) {
    const det = await req("GET", `/api/agents/${first.id}`);
    check("S13-3", "历史 Agent 详情只读可查",
          det.status === 200 && ["autonomous", "dialogue", "expert-group"].includes(det.json?.type));
    const mh = await req("GET", `/api/agents/${first.id}/mounts-health`);
    check("S13-4", "mounts-health 只读保留", mh.status === 200 && Array.isArray(mh.json?.items));
  } else {
    check("S13-3", "历史 Agent 详情只读可查（库中无历史 Agent）", true);
    check("S13-4", "mounts-health 只读保留（库中无历史 Agent）", true);
  }
}

// ---- S14 运行认版本（SDD A-01） ----
{
  const mk = await (await fetch(`${BASE}/api/workflows`, { method: "POST", headers: H, body: JSON.stringify({ name: u("ver") }) })).json();
  const det = await (await fetch(`${BASE}/api/workflows/${mk.id}`)).json();
  const defn = det.definition;
  defn.graph.nodes = [
    { id: "s", type: "input", name: "开始", config: {}, inputs: [] },
    { id: "t", type: "transform", name: "转换", config: { template: "SNAP-V1" }, inputs: [] },
    { id: "e", type: "end", name: "结束", config: { outputKey: "quality_result" },
      inputs: [{ name: "output", type: "string", source: { kind: "upstream", nodeId: "t", path: "outputs.output" } }] },
  ];
  defn.graph.edges = [{ id: "e1", source: "s", target: "t" }, { id: "e2", source: "t", target: "e" }];
  await fetch(`${BASE}/api/workflows/${mk.id}/draft`, { method: "PUT", headers: H, body: JSON.stringify({ definition: defn, baseRevision: det.draftRevision }) });
  const pub = await (await fetch(`${BASE}/api/workflows/${mk.id}/publish`, { method: "POST" })).json();
  // 发布后漂移草稿
  const det2 = await (await fetch(`${BASE}/api/workflows/${mk.id}`)).json();
  det2.definition.graph.nodes.find(n => n.id === "t").config.template = "DRAFT-CHANGED";
  await fetch(`${BASE}/api/workflows/${mk.id}/draft`, { method: "PUT", headers: H, body: JSON.stringify({ definition: det2.definition, baseRevision: det2.draftRevision }) });

  const rPin = await (await fetch(`${BASE}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ workflowId: mk.id, trigger: "manual", versionId: pub.versionId, input: {} }) })).json();
  const dPin = await pollRun(rPin.runId);
  check("S14-1", "指定版本运行执行快照", dPin?.output?.output === "SNAP-V1", JSON.stringify(dPin?.output));
  const rDraft = await (await fetch(`${BASE}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ workflowId: mk.id, trigger: "manual", input: {} }) })).json();
  const dDraft = await pollRun(rDraft.runId);
  check("S14-2", "手动试运行仍走草稿", dDraft?.output?.output === "DRAFT-CHANGED", JSON.stringify(dDraft?.output));
  const rSch = await req("POST", "/api/runs", { workflowId: mk.id, trigger: "schedule", input: {} });
  check("S14-3", "schedule 优先已发布版本（存在即可运行）", rSch.status === 202);
  const mk2 = await (await fetch(`${BASE}/api/workflows`, { method: "POST", headers: H, body: JSON.stringify({ name: u("nopub") }) })).json();
  const rNo = await req("POST", "/api/runs", { workflowId: mk2.id, trigger: "schedule", input: {} });
  check("S14-4", "无发布版本的 schedule 被拦截（NO_PUBLISHED_VERSION）", rNo.status === 409 && String(rNo.json?.detail ?? "").includes("NO_PUBLISHED_VERSION"));
}

// ---------- 汇总 ----------
const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} PASS ====`);
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.id).join(", "));
  process.exit(1);
}
