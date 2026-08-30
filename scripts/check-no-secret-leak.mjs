#!/usr/bin/env node
/** SDD-12 §19.3 / 验收 B-04、J-03：Secret 泄漏扫描（静态 + 动态金丝雀）。
 *
 * 静态规则：
 *   1. routers 层不得出现 decrypt_payload/decrypt_secret（响应面永不接触明文）；
 *   2. reveal 兼容路由必须恒 410 SECRET_REVEAL_DISABLED；
 *   3. 审计写入辅助不得拼接 secret 入参。
 * 动态金丝雀（默认对 http://127.0.0.1:8120，可用 LEAK_BASE 覆盖）：
 *   创建带唯一 canary 的连接（根+环境），扫 列表/详情/测试/轮换/清除/审计 全响应面，
 *   canary 出现即失败；随后清理测试数据。
 *
 * 用法：node scripts/check-no-secret-leak.mjs   （违规 → 非零退出）
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const APP = join(ROOT, "server", "app");
const BASE = process.env.LEAK_BASE ?? "http://127.0.0.1:8120";
const violations = [];

function* pyFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "__pycache__") continue;
      yield* pyFiles(p);
    } else if (name.endsWith(".py")) yield p;
  }
}

// ---- 静态 1：routers 层禁止解密调用（响应面不接触明文） ----
for (const file of pyFiles(join(APP, "routers"))) {
  const text = readFileSync(file, "utf8");
  if (/decrypt_payload|decrypt_secret/.test(text)) {
    violations.push(`${file}: router 层出现解密调用（Secret 明文不得进入 HTTP 响应）`);
  }
}

// ---- 静态 2：reveal 路由恒 410 ----
{
  const admin = readFileSync(join(APP, "routers", "admin.py"), "utf8");
  const m = admin.match(/def reveal_connection[\s\S]*?(?=\n@router\.|\ndef )/);
  if (!m) violations.push("admin.py: reveal 路由缺失（兼容期路由必须保留并恒 410）");
  else if (!/410/.test(m[0]) || !/SECRET_REVEAL_DISABLED/.test(m[0])) {
    violations.push("admin.py: reveal 路由未恒 410 SECRET_REVEAL_DISABLED");
  } else if (/decrypt_payload|decrypt_secret/.test(m[0])) {
    violations.push("admin.py: reveal 路由仍在解密 Secret");
  }
}

// ---- 静态 3：审计辅助不拼接 secret ----
{
  const admin = readFileSync(join(APP, "routers", "admin.py"), "utf8");
  const auditCalls = admin.match(/audit\([^)]*secret[^)]*\)/gi) ?? [];
  for (const a of auditCalls) {
    if (/payload\.secret|e\.secret|\bsecret\b\s*[,}]/.test(a) && !/envCode|versionNo|retired|configured/i.test(a)) {
      violations.push(`admin.py: 审计调用疑似包含 secret 值：${a.slice(0, 80)}`);
    }
  }
}

console.log("check-no-secret-leak：静态扫描完成");
if (violations.length) {
  for (const v of violations) console.error("  ✗ " + v);
  process.exit(1);
}
console.log("  ✓ routers 无解密调用 / reveal 恒 410 / 审计不含明文");

// ---- 动态金丝雀 ----
const CANARY = `CANARY-${Math.random().toString(36).slice(2)}-${Date.now()}`;
let seq = 0;
const u = (p) => `${p}-${Math.random().toString(36).slice(2, 7)}-${seq++}`;

async function req(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, text, json: (() => { try { return JSON.parse(text) } catch { return null } })() };
}

const surfaces = [];
let failed = false;

try {
  const h = await req("GET", "/healthz");
  if (h.status !== 200) throw new Error(`healthz ${h.status}`);
} catch (e) {
  console.error(`✗ 无法连接 ${BASE}（${e.message}）：动态泄漏扫描需运行中的服务`);
  process.exit(1);
}

const conn = await req("POST", "/api/connections", {
  name: u("leak"), protocol: "http-api", kind: "api_key",
  endpoint: { base_url: "https://invalid.example/" },
  secret: CANARY,
  environments: [{ code: "dev", label: "日常", endpoint: { base_url: "https://dev.example/" }, secret: CANARY }],
  default_env: "dev",
});
if (conn.status !== 201) {
  console.error(`✗ 无法创建金丝雀连接：${conn.status} ${conn.text}`);
  process.exit(1);
}
const cid = conn.json.id;
surfaces.push(["create", conn.text]);

const list = await req("GET", `/api/connections?search=${encodeURIComponent(conn.json.name)}`);
surfaces.push(["list", list.text]);
const detail = await req("GET", `/api/connections/${cid}`);
surfaces.push(["detail", detail.text]);
const reveal = await req("GET", `/api/connections/${cid}/reveal`);
surfaces.push(["reveal", reveal.text]);
if (reveal.status !== 410) { console.error("✗ reveal 未返回 410"); failed = true; }
const test = await req("POST", `/api/connections/${cid}/test`, {});
surfaces.push(["test", test.text]);
const rotate = await req("POST", `/api/connections/${cid}/secret:rotate`, { secret: `${CANARY}-rotated` });
surfaces.push(["rotate", rotate.text]);
const usage = await req("GET", `/api/connections/${cid}/usage`);
surfaces.push(["usage", usage.text]);
const audit = await req("GET", "/api/audit?limit=200");
surfaces.push(["audit", audit.text]);
const clear = await req("POST", `/api/connections/${cid}/secret:clear`, { confirm: "CLEAR_SECRET" });
surfaces.push(["clear", clear.text]);

for (const [name, text] of surfaces) {
  if (text.includes(CANARY)) {
    console.error(`✗ 金丝雀明文泄漏于 [${name}] 响应`);
    failed = true;
  }
}

// 清理：无引用连接硬删（连接已被 clear，仍为 draft/active 无引用）
await req("DELETE", `/api/connections/${cid}?hard=true`);

if (failed) process.exit(1);
console.log(`  ✓ 动态金丝雀扫描通过（${surfaces.length} 个响应面无明文；reveal=410）`);
console.log("check-no-secret-leak：PASS");
