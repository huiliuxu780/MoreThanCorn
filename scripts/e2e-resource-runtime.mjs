#!/usr/bin/env node
/** SDD-12 §19.3 / 验收 K：P0 资源运行时 E2E（对运行中的真实服务）。
 *
 * 覆盖：Draft→真实CheckRun→启用门禁、配置/凭据变化→Stale、Secret轮换/清除、
 * 删除防护（409+refs/归档/硬删限draft）、资源启用门禁、echo 防护、零 mock。
 *
 * 用法：先启动后端（默认 wf_dev，端口 8120），再
 *   node scripts/e2e-resource-runtime.mjs            （默认 E2E_BASE=http://127.0.0.1:8120）
 * 存在 FAIL 时退出码 1。
 */
const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:8120";
const results = [];

async function req(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json };
}
function check(id, name, cond, extra = "") {
  results.push({ id, name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${id}  ${name}${extra ? `  (${extra})` : ""}`);
}
const u = (p) => `${p}-${Math.random().toString(36).slice(2, 7)}`;
const code = (r) => r.json?.detail?.code ?? "";

// ---------- R0 前置 ----------
{
  const h = await req("GET", "/healthz");
  check("R0-1", "后端健康检查", h.status === 200 && h.json?.ok === true);
}

// ---------- R1 Draft 创建与启用门禁（C-01/C-02） ----------
let cid = "";
{
  const c = await req("POST", "/api/connections", {
    name: u("e2e-conn"), protocol: "http-api", kind: "none",
    endpoint: { base_url: `${BASE}/api/registry/models` },
    tested: true, // 客户端自报：必须被忽略
  });
  cid = c.json?.id ?? "";
  check("R1-1", "新建连接默认 Draft（客户端 tested 被忽略）",
        c.status === 201 && c.json?.lifecycle === "draft");
  const e = await req("POST", `/api/connections/${cid}:enable`);
  check("R1-2", "未检查启用被拒（CONNECTION_UNCHECKED）",
        e.status === 422 && code(e) === "CONNECTION_UNCHECKED");
  const row = await req("GET", `/api/connections/${cid}`);
  check("R1-3", "未检查连接健康度=untested（不显示 healthy）", row.json?.health === "untested");
}

// ---------- R2 真实 CheckRun 与启用（C-06） ----------
{
  const t = await req("POST", `/api/connections/${cid}/test`, {});
  check("R2-1", "真实探测通过（自服务 200）", t.json?.ok === true);
  check("R2-2", "CheckRun 证据：checkRunId/traceId/阶段诊断/指纹",
        !!t.json?.checkRunId && !!t.json?.traceId && t.json?.diagnostics?.statusCode === 200
        && !!t.json?.configFingerprint);
  const e = await req("POST", `/api/connections/${cid}:enable`);
  check("R2-3", "通过真实检查后启用成功", e.status === 200 && e.json?.lifecycle === "active");
  const g = await req("GET", `/api/connections/${cid}`);
  check("R2-4", "启用后健康度=healthy", g.json?.health === "healthy");
}

// ---------- R3 配置变化 → stale（C-03） ----------
{
  const upd = await req("PUT", `/api/connections/${cid}`, {
    endpoint: { base_url: `${BASE}/api/registry/models?v=2` },
  });
  check("R3-1", "配置更新成功", upd.status === 200);
  const g = await req("GET", `/api/connections/${cid}`);
  check("R3-2", "配置变化后健康度立即 Stale", g.json?.health === "stale");
  const e = await req("POST", `/api/connections/${cid}:enable`);
  check("R3-3", "Stale 状态启用被拒（RESOURCE_HEALTH_STALE）",
        e.status === 409 && code(e) === "RESOURCE_HEALTH_STALE");
  await req("POST", `/api/connections/${cid}/test`, {});
  check("R3-4", "重新检查后可再次启用",
        (await req("POST", `/api/connections/${cid}:enable`)).status === 200);
}

// ---------- R4 Secret 生命周期（B-01/B-02/B-03） ----------
let secCid = "";
{
  const c = await req("POST", "/api/connections", {
    name: u("e2e-sec"), protocol: "http-api", kind: "api_key",
    endpoint: { base_url: "https://invalid.example/" }, secret: "e2e-canary-1",
  });
  secCid = c.json?.id ?? "";
  const rv = await req("GET", `/api/connections/${secCid}/reveal`);
  check("R4-1", "reveal 恒 410 SECRET_REVEAL_DISABLED",
        rv.status === 410 && code(rv) === "SECRET_REVEAL_DISABLED");
  const rot = await req("POST", `/api/connections/${secCid}/secret:rotate`, { secret: "e2e-canary-2" });
  check("R4-2", "轮换产生新版本（versionNo=2，旧版退役）", rot.status === 200 && rot.json?.versionNo === 2);
  const g = await req("GET", `/api/connections/${secCid}`);
  check("R4-3", "轮换信息只回配置状态/版本/时间，不回明文",
        g.json?.secretRevision?.versionNo === 2 && !JSON.stringify(g.json).includes("e2e-canary"));
  const cl0 = await req("POST", `/api/connections/${secCid}/secret:clear`, { confirm: "WRONG" });
  check("R4-4", "清除缺二次确认被拒", cl0.status === 422);
  const cl = await req("POST", `/api/connections/${secCid}/secret:clear`, { confirm: "CLEAR_SECRET" });
  check("R4-5", "确认后清除成功", cl.status === 200 && cl.json?.retired === 1);
}

// ---------- R5 普通更新不丢密钥（P0-01/A-03） ----------
{
  const c = await req("POST", "/api/connections", {
    name: u("e2e-merge"), protocol: "http-api", kind: "api_key",
    endpoint: { base_url: "https://invalid.example/" }, secret: "keep-me",
    environments: [{ code: "prod", label: "生产", endpoint: { base_url: "https://p.example/" }, secret: "env-keep" }],
    default_env: "prod",
  });
  const id = c.json?.id ?? "";
  const upd = await req("PUT", `/api/connections/${id}`, {
    providerHint: "只改描述字段",
    environments: [{ code: "prod", label: "生产-改标签", endpoint: { base_url: "https://p2.example/" } }],
    default_env: "prod",
  });
  check("R5-1", "只改 label/endpoint 的更新成功", upd.status === 200);
  const g = await req("GET", `/api/connections/${id}`);
  check("R5-2", "根与环境密钥均未丢失（secretConfigured=true）",
        g.json?.secretConfigured === true && g.json?.environments?.[0]?.secretConfigured === true);
  check("R5-3", "普通更新不产生新 Secret revision（版本仍=1）",
        g.json?.secretRevision?.versionNo === 1 && g.json?.environments?.[0]?.secretRevision?.versionNo === 1);
  await req("DELETE", `/api/connections/${id}?hard=true`);
}

// ---------- R6 删除防护（B-05/B-06/B-07） ----------
{
  const t = await req("POST", "/api/tools", {
    name: u("e2e-tool"), connectionId: cid,
    spec: { kind: "http", request: { method: "GET", url: "https://invalid.example/x" } },
  });
  const tid = t.json?.id ?? "";
  const d1 = await req("DELETE", `/api/connections/${cid}`);
  check("R6-1", "有引用 Connection 删除 → 409 + 完整 refs",
        d1.status === 409 && code(d1) === "REFERENCE_CONFLICT"
        && (d1.json?.detail?.refs ?? []).some((r) => r.kind === "tool" && r.id === tid));
  const after = await req("GET", `/api/ai-resources/tools/${tid}`);
  check("R6-2", "引用方未被静默解绑（connectionId 仍在）",
        after.json?.config?.connectionId === cid);
  await req("DELETE", `/api/tools/${tid}`);
  const d2 = await req("DELETE", `/api/connections/${cid}`);
  check("R6-3", "无引用删除默认=归档", d2.status === 200 && d2.json?.lifecycle === "archived");
  const g = await req("GET", `/api/connections/${cid}`);
  check("R6-4", "归档后连接仍可查（软删除）", g.json?.lifecycle === "archived");
  const d3 = await req("DELETE", `/api/connections/${cid}?hard=true`);
  check("R6-5", "归档连接不可硬删（硬删仅限 draft）", d3.status === 422);
  check("R6-6", "归档连接不可再启用", (await req("POST", `/api/connections/${cid}:enable`)).status === 409);
}

// ---------- R7 资源启用门禁（P0-04） ----------
{
  const ds = await req("POST", "/api/data-resources/datasources", {
    name: u("e2e-ds"), type: "http", location: "", tested: true,
  });
  const id = ds.json?.id ?? "";
  check("R7-1", "资源创建不再信任 tested（状态=disabled）",
        ds.status === 201 && ds.json?.status === "disabled");
  const e0 = await req("POST", `/api/data-resources/datasources/${id}/toggle`, { enabled: true });
  check("R7-2", "未测试启用被拒（422）", e0.status === 422);
  // 真实可达的 http 数据源（指向本服务）
  const c2 = await req("POST", "/api/connections", {
    name: u("e2e-ds-conn"), protocol: "http-api", kind: "none",
    endpoint: { base_url: `${BASE}/api/registry/models` },
  });
  await req("PUT", `/api/data-resources/datasources/${id}`, { connectionId: c2.json?.id });
  const t = await req("POST", `/api/data-resources/datasources/${id}/test`, {});
  check("R7-3", "真实测试通过（http 数据源，带 CheckRun）", t.json?.ok === true && !!t.json?.checkRunId);
  const e1 = await req("POST", `/api/data-resources/datasources/${id}/toggle`, { enabled: true });
  check("R7-4", "真实测试通过后启用成功", e1.status === 200);
  const g = await req("GET", `/api/data-resources/datasources/${id}`);
  check("R7-5", "启用后健康度=healthy（指纹一致）", g.json?.health === "healthy");
}

// ---------- R8 echo 防护（D-07 / P0-05） ----------
{
  const t = await req("POST", "/api/ai-resources/tools", {
    name: u("e2e-echo"), kind: "http", spec: { kind: "echo" },
  });
  check("R8-1", "普通新建 echo Tool 被拒（422，非 fixture 环境）", t.status === 422);
  const m = await req("POST", "/api/ai-resources/mcp-servers", {
    name: u("e2e-mcp"), transport: "stdio", command: "npx -y x",
  });
  const mt = await req("POST", `/api/ai-resources/mcp-servers/${m.json?.id}/test`, {});
  check("R8-2", "MCP 无真协议实现时失败关闭（不返回示例工具）",
        mt.json?.ok === false && !!mt.json?.error);
  const k = await req("POST", "/api/ai-resources/knowledge-sources", { name: u("e2e-ks"), kind: "vector" });
  const kt = await req("POST", `/api/ai-resources/knowledge-sources/${k.json?.id}/test`, { query: "q" });
  check("R8-3", "Knowledge 无真实后端失败关闭（无 [mock] 切片）",
        kt.json?.ok === false && !!kt.json?.error);
}

// ---------- 汇总 ----------
const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} PASS ====`);
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.id).join(", "));
  process.exit(1);
}
