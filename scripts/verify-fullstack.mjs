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

// ---------- S2 Connections ----------
let connId = "";
{
  const c = await req("POST", "/api/connections", { name: u("conn"), protocol: "mysql", endpoint: { host: "rm.internal", port: 3306 }, kind: "Basic Auth", secret: "ak-sk" });
  connId = c.json?.id ?? "";
  check("S2-1", "创建 Connection（protocol+endpoint+secret）", c.status === 201 && !!connId);
  const l = await req("GET", "/api/connections?type=mysql");
  check("S2-2", "Connection 按协议筛选且凭证掩码", l.json?.items?.some((i) => i.id === connId && i.secretConfigured === true));
  // R8-UI-6：09-P0 审计修复后连接探测 fail-closed（不可达诚实报错，禁假真）；
  // 正向路径用 http-api 自探活（本机服务 200）
  const t = await req("POST", `/api/connections/${connId}/test`);
  check("S2-3", "Connection fail-closed（不可达诚实报错）", t.json?.ok === false && !!t.json?.error);
  const hc = await req("POST", "/api/connections", { name: u("conn-http"), protocol: "http-api", endpoint: { base_url: `${BASE}/api/registry/models` }, kind: "none" });
  const ht = await req("POST", `/api/connections/${hc.json?.id}/test`);
  check("S2-3b", "Connection 真探活（自服务 200）", ht.json?.ok === true);
}

// ---------- S3 Datasource（测试门禁） ----------
let dsId = "";
{
  const d = await req("POST", "/api/data-resources/datasources", { name: u("ds"), type: "mysql", connectionId: connId, location: "db_cc" });
  dsId = d.json?.id ?? "";
  check("S3-1", "未测试创建 → Disabled（测试门禁）", d.json?.status === "disabled");
  const t = await req("POST", `/api/data-resources/datasources/${dsId}/test`, {});
  check("S3-2", "Datasource 测试执行器（mock 回落）", t.json?.ok === true && typeof t.json?.latencyMs === "number");
  await req("POST", `/api/data-resources/datasources/${dsId}/toggle`, { enabled: true });
  const g = await req("GET", `/api/data-resources/datasources/${dsId}`);
  check("S3-3", "启用后状态/健康度正确", g.json?.status === "enabled" && g.json?.health === "healthy");
  const lf = await req("GET", "/api/data-resources/datasources?type=mysql");
  check("S3-4", "Datasource 类型筛选", lf.json?.items?.some((i) => i.id === dsId));
}

// ---------- S4 Data Asset ----------
let assetId = "";
{
  // R8-UI-6：挂 datasource 的 asset 必须真实 reader（生产禁 mock）；dev 抽样正路径=
  // 无 datasource 的内联 rows asset（datasource 挂载语义在 S3/S11 覆盖）
  const a = await req("POST", "/api/data-resources/assets", { name: u("asset"), location: "t_call_session", recordMeaning: "一通客服对话", timeField: "call_start_at", tested: true, rows: [
    { call_id: "C-1", conversation: "客户：我要退款。坐席：已为您创建工单。", call_start_at: "2026-01-01T00:00:00Z" },
    { call_id: "C-2", conversation: "客户：咨询保修。坐席：保修一年。", call_start_at: "2026-01-02T00:00:00Z" },
  ] });
  assetId = a.json?.id ?? "";
  check("S4-1", "创建 Data Asset（内联 rows dev 路径）", a.status === 201 && a.json?.status === "enabled");
  const t = await req("POST", `/api/data-resources/assets/${assetId}/test`, {});
  check("S4-2", "Data Asset 抽样测试（内联 rows）", t.json?.ok === true);
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

// ---------- S6 AI Resources 六类 ----------
let toolId = "", toolVersionId = "", mcpId = "", ksId = "", modelKey = "qwen-plus";
{
  const m = await req("GET", "/api/ai-resources/models?pageSize=5");
  check("S6-1", "Models 列表（含 7 日调用聚合）", (m.json?.items ?? []).length > 0);
  const t = await req("POST", "/api/ai-resources/tools", { name: u("tool"), kind: "builtin", spec: { kind: "echo" }, tested: true });
  toolId = t.json?.id ?? "";
  const vs = await req("GET", `/api/ai-resources/tools/${toolId}/versions`);
  toolVersionId = vs.json?.[0]?.id ?? "";
  check("S6-2", "Tool 创建 + 版本列表", !!toolVersionId);
  const mc = await req("POST", "/api/ai-resources/mcp-servers", { name: u("mcp"), transport: "stdio", command: "npx -y demo", tested: true });
  mcpId = mc.json?.id ?? "";
  const mt = await req("POST", `/api/ai-resources/mcp-servers/${mcpId}/test`, {});
  check("S6-3", "MCP 握手+工具发现", mt.json?.ok === true && (mt.json?.output?.tools ?? []).length > 0);
  const k = await req("POST", "/api/ai-resources/knowledge-sources", { name: u("ks"), kind: "vector", tested: true });
  ksId = k.json?.id ?? "";
  const kt = await req("POST", `/api/ai-resources/knowledge-sources/${ksId}/test`, { query: "退款" });
  check("S6-4", "Knowledge 检索测试", kt.json?.ok === true);
  const tt = await req("POST", `/api/ai-resources/tools/${toolId}/test`, { input: "ping" });
  check("S6-5", "Tool 测试执行器", tt.json?.ok === true);
}

// ---------- S7 Workflow 全联动：kr + mcp + llm + tool + create-record ----------
let wfId = "", runId = "", qrId = "";
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
  check("S7-2", "校验通过（依赖校验含 kr/mcp）", va.json?.ok === true, (va.json?.issues ?? []).map((i) => i.message).join(";"));
  const pb = await req("POST", `/api/workflows/${wfId}/publish?note=verify`);
  check("S7-3", "发布成功", pb.status === 201);
  const rn = await req("POST", "/api/runs", { workflowId: wfId, trigger: "test", input: { userQuery: "我要退款", interactionId: "V-001" } });
  runId = rn.json?.runId ?? "";
  const done = await pollRun(runId);
  // R8-UI-6：真实 LLM Key 未配置（占位 key）时，诚实断言 fail-closed 401；
  // 配置真实 Key 后（QUALITY_REAL_LLM=1）要求端到端成功
  const realLlm = process.env.QUALITY_REAL_LLM === "1";
  check("S7-4", realLlm ? "Run 端到端执行成功（kr→mcp→llm→tool→record）"
    : "无真实 LLM Key 时诚实 fail-closed（401，不伪造成功）",
    realLlm ? done?.status === "succeeded"
      : (done?.status === "failed" && /401|Unauthorized/i.test(done?.error?.message ?? "")),
    done?.error?.message ?? "");
  const q = await req("GET", "/api/quality-results?page=1&pageSize=5");
  qrId = q.json?.items?.[0]?.id ?? "";
  check("S7-5", "质检结果落库（quality_result）", !!qrId);
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
  const t = await req("POST", "/api/tasks", { name: u("task"), workflowId: wfId, dataAssetId: assetId, dataDefinitionId: defId, dataDefinitionVersionId: defVersionId, rulePolicy: "pinned", resultRuleVersionId: ruleVersionId });
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
  // R8-UI-6：08-27 用户决策——连接始终可删（先解绑引用方再删），非 409
  const d7 = await req("DELETE", `/api/connections/${connId}`);
  const dsAfter = await req("GET", `/api/data-resources/datasources/${dsId}`);
  check("S11-7", "删 Connection 解绑后删除（08-27 决策）", d7.status === 200 && (dsAfter.json?.connectionId == null));
}

// ---------- S12 评测 ----------
{
  const e = await req("POST", "/api/eval-samples", { workflowId: wfId, name: u("eval"), input: { userQuery: "评测样本" }, dataAssetId: assetId });
  check("S12-1", "评测样本（可挂 Data Asset）", e.status === 201);
  // 79a8a08 起工作流级评测为同步执行：返回 results[]（每条含 runId/终态），不再有 runIds
  const er = await req("POST", `/api/workflows/${wfId}/eval-run`);
  check("S12-2", "评测运行触发", (er.json?.results ?? []).length > 0 && er.json.results.every((r) => r.runId));
  const es = await req("GET", `/api/workflows/${wfId}/eval-summary`);
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
