#!/usr/bin/env node
/** 审计补证（P0-2，09-10 二轮扩展）：Agent 创建页真实模型选择全链证据。
 *  证明点：
 *  1) 未选模型时【创建】按钮禁用（不存在 models[0] 静默绑定）；
 *  2) 下拉展示真实模型列表（/api/registry/models）；
 *  3) 显式选择第二个真实模型后 UI 创建 → 拦截 POST /api/agents 真实 payload（modelRef.modelId）；
 *  4) GET 详情服务端绑定一致；进入配置页并刷新后 UI 仍显示正确模型；
 *  5) 发布链不丢失模型：POST versions → POST releases(prod) → release.runtime_binding_snapshot
 *     .frozen_model_id == 所选模型（psql 直查 DB，非 API 转述）；
 *  6) 发布后该 Agent executable=true（与 P0-1 判定联动）；
 *  7) 清理：release rolled_back（psql 单事务+audit_log 留痕）→ Agent 归档 → executable=false。
 *  截图：evidence/model-selection/{01-before-select,02-dropdown-open,03-model-picked,04-config-after-refresh}.png
 *  JSON：evidence/model-selection.json */
import fs from "node:fs";
import { execSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:5199";
const API = "http://127.0.0.1:8120";
const EV = "research/morethancorn/11-p0-rework-20260910/evidence/model-selection";
fs.mkdirSync(EV, { recursive: true });
const RESULTS = [];
const TIMELINE = [];
const t0 = Date.now();
const mark = (name) => TIMELINE.push({ name, at: new Date().toISOString(), elapsed_ms: Date.now() - t0 });
const check = (name, ok, detail = "", expected = "", actual = "") => {
  RESULTS.push({ name, pass: !!ok, expected: String(expected).slice(0, 300), actual: String(actual).slice(0, 300), detail: String(detail).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${String(detail).slice(0, 160)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (sql) => execSync(`psql -d wf_dev -At -c "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));

let createPayload = null;
let createStatus = null;
page.on("request", (r) => {
  if (r.url().endsWith("/api/agents") && r.method() === "POST") createPayload = r.postData();
});
page.on("response", (r) => {
  if (r.url().endsWith("/api/agents") && r.request().method() === "POST") createStatus = r.status();
});

const api = async (path, init) => {
  const r = await fetch(`${API}${path}`, {
    ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  let json = null; try { json = await r.json(); } catch { /* noop */ }
  return { status: r.status, json };
};

mark("script_start");
await page.goto(`${BASE}/agents/new?template=preset-frontend`, { waitUntil: "networkidle2" });
await page.waitForFunction(() => document.querySelectorAll("input, textarea").length >= 2);
mark("create_page_loaded");

const nameInput = await page.$('input[placeholder="请输入 Agent 名称"]');
if (!nameInput) throw new Error("name input not found");
await nameInput.click({ clickCount: 3 });
await nameInput.type("EVID-MODEL-TEST");
await sleep(300);

// 1) 未选模型 → 创建按钮禁用
const findBtn = () => page.$$eval("button", (bs) => {
  const b = bs.find((x) => { const t = (x.textContent || "").trim(); return t === "创建" || t.startsWith("创建中"); });
  return b ? b.disabled : null;
});
const btnDisabledBefore = await findBtn();
check("create_button_disabled_without_model", btnDisabledBefore === true, `disabled=${btnDisabledBefore}`, "true", String(btnDisabledBefore));
await page.screenshot({ path: `${EV}/01-before-select.png`, fullPage: true });

// 2) 打开模型下拉（真实鼠标点击）
const triggerBox = await page.evaluate(() => {
  const els = [...document.querySelectorAll('button[role="combobox"]')];
  const t = els.find((e) => /请选择模型|模型/.test(e.textContent || "")) || els[0];
  if (!t) return null;
  const r = t.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (!triggerBox) throw new Error("model select trigger not found");
await page.mouse.click(triggerBox.x, triggerBox.y);
await sleep(600);
const optionTexts = await page.$$eval('[role="option"]', (os) => os.map((o) => (o.textContent || "").trim()).slice(0, 10));
const realOpts = optionTexts.filter((t) => t && t !== "请选择模型");
check("model_dropdown_lists_real_models", realOpts.length >= 2, `options=${optionTexts.join("|")}`, ">=2 个真实模型", `${realOpts.length}`);
await page.screenshot({ path: `${EV}/02-dropdown-open.png` });

// 3) 选第二个真实模型（刻意非 models[0]）
const picked = realOpts[1] || realOpts[0];
const optBox = await page.evaluate((label) => {
  const o = [...document.querySelectorAll('[role="option"]')].find((x) => (x.textContent || "").trim() === label);
  if (!o) return null;
  const r = o.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, picked);
if (!optBox) throw new Error(`option not found: ${picked}`);
await page.mouse.click(optBox.x, optBox.y);
await sleep(500);
mark("model_picked");
await page.screenshot({ path: `${EV}/03-model-picked.png`, fullPage: true });

// 4) 创建
const btnDisabledAfter = await findBtn();
check("create_button_enabled_after_model", btnDisabledAfter === false, `disabled=${btnDisabledAfter}`, "false", String(btnDisabledAfter));
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => { const t = (x.textContent || "").trim(); return t === "创建" || t.startsWith("创建中"); });
  if (b && !b.disabled) b.click();
});
await page.waitForFunction(() => /\/agents\/[a-f0-9]{32}/.test(location.pathname), { timeout: 20000 }).catch(() => {});
await sleep(800);
mark("agent_created");
const newId = (page.url().match(/\/agents\/([a-f0-9]{32})/) || [])[1] || null;
check("agent_created_via_ui", Boolean(newId) && (createStatus === 200 || createStatus === 201), `id=${newId} status=${createStatus}`, "201 + id", `${createStatus} ${newId}`);
const payloadOk = Boolean(createPayload) && createPayload.includes('"modelRef"') && createPayload.includes(picked);
check("post_payload_contains_modelRef", payloadOk, `payload=${createPayload}`, `modelRef.modelId=${picked}`, createPayload || "null");

// 5) 服务端绑定 + 配置页刷新后仍显示
let serverModel = null;
if (newId) {
  const g = await api(`/api/agents/${newId}`);
  serverModel = g.json?.config?.modelRef?.modelId ?? g.json?.modelRef?.modelId ?? null;
  check("server_binding_matches_picked", serverModel === picked, `server=${serverModel}`, picked, String(serverModel));

  await page.goto(`${BASE}/agents/${newId}/config`, { waitUntil: "networkidle2" });
  await sleep(1200);
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1200);
  mark("config_page_refreshed");
  const cfgHasModel = await page.evaluate((m) => document.body.innerText.includes(m), picked);
  check("config_page_shows_model_after_refresh", cfgHasModel, `config 页刷新后包含 ${picked}`, picked, cfgHasModel ? "visible" : "missing");
  await page.screenshot({ path: `${EV}/04-config-after-refresh.png`, fullPage: true });
}

// 6) 发布链：version → prod release → frozen_model_id（DB 直查）
let releaseId = null; let frozenModel = null; let frozenModelId = null; let execAfterPublish = null;
if (newId) {
  const v = await api(`/api/agents/${newId}/versions`, { method: "POST", body: JSON.stringify({ note: "evid-model-selection" }) });
  const versionId = v.json?.versionId ?? null;
  const rel = await api(`/api/agents/${newId}/releases`, {
    method: "POST",
    body: JSON.stringify({ environment: "prod", versionId, actor: "evid-model-selection" }),
  });
  releaseId = rel.json?.releaseId ?? null;
  mark("prod_release_published");
  if (releaseId) {
    // frozen_model_key = 注册表 modelKey（与所选直接可比）；frozen_model_id = 平台 Model 资源行 id
    frozenModel = psql(`SELECT runtime_binding_snapshot->>'frozen_model_key' FROM release WHERE id='${releaseId}'`);
    frozenModelId = psql(`SELECT runtime_binding_snapshot->>'frozen_model_id' FROM release WHERE id='${releaseId}'`);
    const agents = await api("/api/agents?pageSize=500&archived=all");
    execAfterPublish = (agents.json?.items ?? []).find((a) => a.id === newId)?.executable ?? null;
  }
  check("release_snapshot_frozen_model_matches", frozenModel === picked && releaseId !== null,
    `release=${releaseId} frozen_key=${frozenModel} frozen_id=${frozenModelId}`, `frozen_model_key=${picked}`, `${frozenModel}`);
  check("executable_true_after_publish", execAfterPublish === true, `executable=${execAfterPublish}`, "true", String(execAfterPublish));
}

// 7) 清理：release rolled_back（psql 单事务+审计留痕）→ Agent 归档 → executable=false
let archived = null; let execAfterCleanup = null; let rolledBack = null;
if (newId && releaseId) {
  psql(`BEGIN; UPDATE release SET status='rolled_back' WHERE id='${releaseId}'; INSERT INTO audit_log (id, actor, action, target_type, target_id, detail, created_at) VALUES (md5(random()::text), 'evid', 'evid.cleanup.release_rollback', 'agent', '${newId}', jsonb_build_object('note','模型选择补证清理（审计返工 P0-2）','releaseId','${releaseId}'), now()); COMMIT;`);
  rolledBack = psql(`SELECT status FROM release WHERE id='${releaseId}'`);
  const p = await api(`/api/agents/${newId}`, { method: "PUT", body: JSON.stringify({ archived: true }) });
  archived = p.json?.archived ?? null;
  const agents2 = await api("/api/agents?pageSize=500&archived=all");
  execAfterCleanup = (agents2.json?.items ?? []).find((a) => a.id === newId)?.executable ?? null;
  mark("cleanup_done");
}
check("cleanup_release_rolled_back_agent_archived", rolledBack === "rolled_back" && archived === true && execAfterCleanup === false,
  `release=${rolledBack} archived=${archived} executable=${execAfterCleanup}`, "rolled_back+archived+false",
  `${rolledBack}+${archived}+${execAfterCleanup}`);

fs.writeFileSync(`${EV.replace("/model-selection", "")}/model-selection.json`, JSON.stringify({
  collected_at: new Date().toISOString(),
  page: `${BASE}/agents/new?template=preset-frontend`,
  models_endpoint: `${API}/api/registry/models`,
  picked_model: picked,
  create_request_payload: createPayload ? JSON.parse(createPayload) : null,
  create_response_status: createStatus,
  created_agent_id: newId,
  server_model_binding: serverModel,
  prod_release_id: releaseId,
  release_frozen_model_key: frozenModel,
  release_frozen_model_id: frozenModelId,
  executable_after_publish: execAfterPublish,
  cleanup: { release_status: rolledBack, agent_archived: archived, executable_after_cleanup: execAfterCleanup },
  timeline: TIMELINE,
  results: RESULTS,
  failures: RESULTS.filter((r) => !r.pass).length,
  screenshots: ["model-selection/01-before-select.png", "model-selection/02-dropdown-open.png", "model-selection/03-model-picked.png", "model-selection/04-config-after-refresh.png"],
}, null, 2));

await browser.close();
const failed = RESULTS.filter((r) => !r.pass).length;
console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILURES`} (${RESULTS.length} checks) → evidence/model-selection.json`);
process.exit(failed === 0 ? 0 : 1);
