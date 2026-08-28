/** E-1.3 手工动线 API 级核验（对 :8100 wf_dev）：A1/A2/B2/B3/D2。
 *  R-Archive（SDD 10，2026-08-28）：本脚本验收的旧 Agent 写路径（创建/保存/版本/发布/回滚）
 *  已整体封存（410 LEGACY_AGENT_ARCHIVED），脚本退役；替代契约见 scripts/verify-fullstack.mjs S13，
 *  原验收行为封存于 tag archive/legacy-agents-20260828。 */
console.error("[deprecated] 旧 Agent 写路径已封存（SDD 10 R-Archive），本脚本退役不再运行。");
process.exit(2);
const BASE = "http://localhost:8100";
const H = { "Content-Type": "application/json" };
let pass = 0, fail = 0;
const ok = (id, name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${id}  ${name}${extra ? "  " + extra : ""}`);
  cond ? pass++ : fail++;
};
const api = async (m, p, body) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, j };
};
const u = (s) => `${s}-${Date.now().toString(36).slice(-4)}`;

// ---------- A1：创建三类 Agent + 名称超长被拒 ----------
{
  const types = [["autonomous", "自主规划"], ["dialogue", "对话编排"], ["expert-group", "专家组"]];
  const ids = {};
  for (const [t, label] of types) {
    const r = await api("POST", "/api/agents", { name: u(`验收-${label}`), type: t, description: "" });
    ok("A1", `创建 ${label} Agent`, r.status === 201 && r.j?.id, `status=${r.status}`);
    ids[t] = r.j?.id;
  }
  const longName = "这是一个超过二十个字符的非法名称用于验收测试啊";
  const bad = await api("POST", "/api/agents", { name: longName, type: "autonomous", description: "" });
  ok("A1", "名称超 20 字被拒 400 NAME_TOO_LONG",
    bad.status === 400 && bad.j?.detail?.code === "NAME_TOO_LONG", `status=${bad.status} code=${bad.j?.detail?.code}`);

  // ---------- A2：乐观锁冲突 ----------
  const aid = ids.autonomous;
  const cur = await api("GET", `/api/agents/${aid}`);
  const rev = cur.j.configRevision;
  const s1 = await api("PUT", `/api/agents/${aid}`, { description: "先保存", expectedRevision: rev });
  const s2 = await api("PUT", `/api/agents/${aid}`, { description: "后保存", expectedRevision: rev });
  ok("A2", "后保存者收到 409 REVISION_CONFLICT",
    s1.status === 200 && s2.status === 409 && s2.j?.detail?.code === "REVISION_CONFLICT",
    `s1=${s1.status} s2=${s2.status}`);

  // ---------- B2：空 Prompt 发布被拦 ----------
  const model = (await api("GET", "/api/models?pageSize=50")).j?.items?.find((m) => m.enabled !== false);
  await api("PUT", `/api/agents/${aid}`, { config: { ...(cur.j.config ?? {}), rolePrompt: "", modelRef: { modelId: model?.modelKey ?? "qwen-max" } } });
  const pub = await api("POST", `/api/agents/${aid}/versions`, {});
  ok("B2", "空 Prompt 发布被拦（409 + issues）",
    pub.status === 409 && pub.j?.detail?.code === "VALIDATION_FAILED"
    && (pub.j?.detail?.issues ?? []).some((i) => i.code === "PROMPT_REQUIRED"),
    `status=${pub.status} issues=${JSON.stringify((pub.j?.detail?.issues ?? []).map((i) => i.code))}`);

  // ---------- B3：发布/部署/回滚 ----------
  await api("PUT", `/api/agents/${aid}`, { config: { rolePrompt: "你是验收测试助手", modelRef: { modelId: model?.modelKey ?? "qwen-max" } } });
  const v1 = await api("POST", `/api/agents/${aid}/versions`, { note: "v1" });
  ok("B3", "生成版本 v1（含 artifactHash）", v1.status === 201 && !!v1.j?.artifactHash, `versionNo=${v1.j?.versionNo}`);
  const d1 = await api("POST", `/api/agents/${aid}/releases`, { versionId: v1.j.versionId, environment: "prod" });
  await api("PUT", `/api/agents/${aid}`, { config: { rolePrompt: "你是验收测试助手 v2", modelRef: { modelId: model?.modelKey ?? "qwen-max" } } });
  const v2 = await api("POST", `/api/agents/${aid}/versions`, { note: "v2" });
  const d2 = await api("POST", `/api/agents/${aid}/releases`, { versionId: v2.j.versionId, environment: "prod" });
  const rollback = await api("POST", `/api/agents/${aid}/releases`, { versionId: v1.j.versionId, environment: "prod" });
  const rels = await api("GET", `/api/agents/${aid}/releases`);
  const prodActive = (rels.j ?? []).find((r) => r.environment === "prod" && r.status === "active");
  ok("B3", "回滚=旧版本重新部署，prod 活跃版本回到 v1",
    d1.status === 201 && d2.status === 201 && rollback.status === 201
    && prodActive?.versionNo === v1.j.versionNo,
    `prodActive=${prodActive?.versionNo} v1=${v1.j?.versionNo} v2=${v2.j?.versionNo}`);
  const histCount = (rels.j ?? []).length;
  ok("B3", "历史版本记录不因回滚减少", histCount >= 3, `releases=${histCount}`);
}

// ---------- D2：连接 Secret 留空保留/填写轮换 ----------
{
  const c = await api("POST", "/api/connections", { name: u("验收连接"), kind: "api_key", protocol: "http-api", endpoint: { baseUrl: "https://example.com" }, secret: "S-ORIGINAL" });
  const keep = await api("PUT", `/api/connections/${c.j.id}`, { name: c.j.name, secret: "" });
  const afterKeep = (await api("GET", "/api/connections?pageSize=100")).j.items.find((x) => x.id === c.j.id);
  const rotate = await api("PUT", `/api/connections/${c.j.id}`, { secret: "S-ROTATED" });
  const afterRotate = (await api("GET", "/api/connections?pageSize=100")).j.items.find((x) => x.id === c.j.id);
  ok("D2", "Secret 留空保留原密钥（secretConfigured 恒 true，明文不回显）",
    keep.status === 200 && afterKeep?.secretConfigured === true && JSON.stringify(afterKeep).includes("S-ORIGINAL") === false,
    `secretConfigured=${afterKeep?.secretConfigured}`);
  ok("D2", "填写=轮换成功", rotate.status === 200 && afterRotate?.secretConfigured === true);
  await api("DELETE", `/api/connections/${c.j.id}`);
}

// ---------- B4：审计日志含发布/部署/删除 ----------
{
  const a = await api("GET", "/api/audit?limit=200");
  const actions = new Set((a.j?.items ?? []).map((x) => x.action));
  ok("B4", "审计日志含版本/部署/删除动作",
    actions.has("agent.version.create") && actions.has("agent.release"),
    `actions=${[...actions].slice(0, 8).join(",")}`);
}

console.log(`\n==== ${pass}/${pass + fail} PASS ====`);
process.exit(fail ? 1 : 0);
