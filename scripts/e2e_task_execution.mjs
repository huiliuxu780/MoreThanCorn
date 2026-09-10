#!/usr/bin/env node
/** Task 真执行 E2E（审计返工 P0-3，09-10 二轮扩展版）。
 *
 * 全链（任务书 12 步）：
 *  A. 产品页面（/batch-tasks/new 向导）选择已发布 Agent 并创建 Task（UI 真点击，含
 *     「草稿/归档 Agent 不出现在选择器」断言）；
 *  B. Task 详情页（/batch-tasks/:id）UI【立即运行】启动 → TaskRun；
 *  C. 轮询真实终态 → GET /api/runs?taskRunId= → Run 行 + AgentScope Session + 输出
 *     （非空、两条不同、含真实打标内容）→ session_index；
 *  D. UI 恢复：详情页最近运行=已完成 → reload 仍在 → /operations/task-runs?taskId= 可见 → reload；
 *  E. 失败路径：临时 Agent 发布后回滚 Release → UI【立即运行】→ 明确报错（toast/失败态），
 *     页面不永久 loading，无 queued/running 悬挂 TaskRun；
 *  F. 清理：两个 Task 归档 + 临时 Agent 归档（release 已 rolled_back + audit_log 留痕）；
 *     清理失败 → 脚本失败（exit 1）。
 * 证据：evidence/e2e-task-execution.json（name/pass/expected/actual/evidence + timeline + 全部 ID）。
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:5199";
const API = "http://127.0.0.1:8120";
const AGENT_ID = "e773172b6b434ed1a3011af443bb0f55"; // 业务分析-通话打标（active prod Release）
const AGENT_NAME = "业务分析-通话打标";
const ASSET_ID = "96fd99a44a314677ac956f9bdbf36aae"; // DSH真实回归集V1
const DEFVER_ID = "1235c197a7d54c8a909d16bc195dee80"; // 已知可用定义版本（latestVersionId 缺失时兜底）
const RULE_SET_PREFIX = "d9da60a9"; // DSH回归候选规则V1（完整 id 从 /api/result-rules 解析）
const OUT = "research/morethancorn/11-p0-rework-20260910/evidence/e2e-task-execution.json";

const RESULTS = [];
const TIMELINE = [];
const IDS = {};
const t0 = Date.now();
const mark = (name) => TIMELINE.push({ name, at: new Date().toISOString(), elapsed_ms: Date.now() - t0 });
const check = (name, ok, expected = "", actual = "", evidence = "") => {
  RESULTS.push({ name, pass: !!ok, expected: String(expected).slice(0, 300), actual: String(actual).slice(0, 300), evidence: String(evidence).slice(0, 500) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} | expected=${String(expected).slice(0, 80)} actual=${String(actual).slice(0, 80)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (sql) => execSync(`psql -d wf_dev -At -c "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const txt = await res.text();
  let json = null; try { json = JSON.parse(txt); } catch { /* noop */ }
  return { status: res.status, json, txt };
}

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));

// ---- Radix 操作助手（真实鼠标） ----
async function clickText(selector, text, { exact = false } = {}) {
  const box = await page.evaluate((sel, t, ex) => {
    const els = [...document.querySelectorAll(sel)];
    const el = els.find((e) => {
      const s = (e.textContent || "").trim();
      return ex ? s === t : s.includes(t);
    });
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector, text, exact);
  if (!box) throw new Error(`element not found: ${selector} ~ "${text}"`);
  await page.mouse.click(box.x, box.y);
}
async function openSelect(nearText) {
  // 找到包含 nearText 的 form 区域内的 combobox 触发器；nearText 为空则取第一个含 placeholder 的
  const box = await page.evaluate((t) => {
    const trig = [...document.querySelectorAll('button[role="combobox"]')].find((e) => (e.textContent || "").includes(t));
    if (!trig) return null;
    trig.scrollIntoView({ block: "center" });
    const r = trig.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, nearText);
  if (!box) throw new Error(`select trigger not found near "${nearText}"`);
  await page.mouse.click(box.x, box.y);
  await sleep(500);
}
async function pickOption(contains) {
  const box = await page.evaluate((t) => {
    const o = [...document.querySelectorAll('[role="option"]')].find((x) => (x.textContent || "").includes(t));
    if (!o) return null;
    const r = o.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, contains);
  if (!box) throw new Error(`option not found: "${contains}"`);
  await page.mouse.click(box.x, box.y);
  await sleep(400);
}
async function optionTexts() {
  return page.$$eval('[role="option"]', (os) => os.map((o) => ({ text: (o.textContent || "").trim(), disabled: o.getAttribute("aria-disabled") === "true" || o.dataset.disabled !== undefined })));
}
async function waitToast(contains, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const t = await page.evaluate(() =>
      [...document.querySelectorAll('[data-sonner-toast]')].map((x) => (x.textContent || "")).join(" | "));
    if (t.includes(contains)) return t;
    await sleep(400);
  }
  return null;
}

let cleanupOk = true;
mark("script_start");

// ===== 预解析：数据定义 / 规则集（供向导选择） =====
const defs = await api(`/api/data-definitions?assetId=${ASSET_ID}&pageSize=50`);
const def = (defs.json?.items ?? []).find((d) => d.lifecycle === "Ready");
const ruleSets = await api("/api/result-rules");
const ruleArr = Array.isArray(ruleSets.json) ? ruleSets.json : (ruleSets.json?.items ?? []);
const ruleSet = ruleArr.find((s) => String(s.id).startsWith(RULE_SET_PREFIX)) ?? null;
IDS.data_definition_id = def?.id ?? null;
IDS.result_rule_set_id = ruleSet?.id ?? null;
if (!def || !ruleSet) throw new Error(`definition/ruleset not found: def=${def?.id} ruleset=${ruleSet?.id}`);

// ===== A. UI 向导创建 Task =====
let taskId = null;
let TASK_NAME = "";
try {
  await page.goto(`${BASE}/batch-tasks/new`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.body.innerText.includes("新建自主任务"));
  mark("wizard_opened");

  // Step0：名称 + 领域 Agent + 已发布 custom Agent + 最新线上发布
  const nameBox = await page.evaluate(() => {
    const i = [...document.querySelectorAll("input")].find((x) => (x.placeholder || "").includes("每日热线"));
    if (!i) return null;
    const r = i.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!nameBox) throw new Error("wizard name input not found");
  await page.mouse.click(nameBox.x, nameBox.y);
  const ts = Date.now();
  TASK_NAME = `E2E-TASK-EXEC-${ts}`;
  await page.keyboard.type(TASK_NAME);
  await clickText("button", "领域 Agent");
  await sleep(300);
  await openSelect("选择 Agent");
  const opts = await optionTexts();
  IDS.wizard_agent_options = opts.map((o) => o.text);
  const prodOpt = opts.find((o) => o.text.includes(AGENT_NAME));
  const draftLeak = opts.filter((o) => /数据分析师|前端工程师|EVID|E2E/.test(o.text));
  check("wizard_agent_selector_lists_published_only",
    Boolean(prodOpt) && !prodOpt.disabled && draftLeak.length === 0,
    `${AGENT_NAME} 可选且无草稿/归档泄漏`,
    `prod=${prodOpt?.text ?? "MISSING"} leak=${JSON.stringify(draftLeak.map((o) => o.text))}`,
    JSON.stringify(opts.map((o) => o.text)));
  await pickOption(AGENT_NAME);
  await page.evaluate(() => document.querySelector('label[for="avp-prod"]')?.click());
  await sleep(300);
  await clickText("button", "下一步");
  await sleep(600);

  // Step1：Data Definition（自动带出资产与映射）
  await openSelect("选择 Data Definition");
  await pickOption(def.name.split("（")[0].slice(0, 12));
  await sleep(600);
  await clickText("button", "下一步");
  await sleep(600);

  // Step2：规则集 + 固定数量抽样 2 条（控制真实 LLM 成本）
  await openSelect("选择规则集");
  await pickOption(ruleSet.name.slice(0, 12));
  await page.evaluate(() => document.querySelector('label[for="sp-fixed"]')?.click());
  await sleep(300);
  await page.evaluate(() => {
    const inp = [...document.querySelectorAll('input[type="number"]')].find((i) => i.className.includes("w-24"));
    if (inp) { inp.focus(); inp.select(); }
  });
  await page.keyboard.type("2");
  await sleep(300);
  await clickText("button", "下一步");
  await sleep(600);

  // Step3：创建
  await clickText("button", "创建", { exact: true });
  await page.waitForFunction(() => /\/autonomous-tasks\/[a-f0-9]{32}/.test(location.pathname), { timeout: 20000 }).catch(() => {});
  taskId = (page.url().match(/\/autonomous-tasks\/([a-f0-9]{32})/) || [])[1] ?? null;
  mark("task_created_via_ui_wizard");
  IDS.task_id = taskId;
  const createdToast = await waitToast("自主任务已创建", 8000);
  check("ui_wizard_create_task", Boolean(taskId) && Boolean(createdToast),
    "跳转 /autonomous-tasks/<id> + toast 自主任务已创建", `${taskId} toast=${createdToast ? "yes" : "no"}`, page.url());

  // 服务端核对执行目标绑定
  const t = await api(`/api/tasks/${taskId}`);
  const et = t.json?.taskVersion?.executionTarget ?? t.json?.executionTarget ?? {};
  IDS.task_name = TASK_NAME;
  check("task_target_binding",
    et.type === "agent" && et.agentId === AGENT_ID && String(et.versionPolicy ?? "").includes("prod"),
    "executionTarget=agent/e773172b/latest_prod_release",
    JSON.stringify(et), `GET /api/tasks/${taskId}`);
} catch (e) {
  check("ui_wizard_create_task", false, "向导创建成功", `EXCEPTION ${String(e).slice(0, 200)}`, "");
}

// ===== B. UI 启动（详情页【立即运行】） =====
let taskRunId = null;
try {
  if (!taskId) throw new Error("no taskId");
  await page.goto(`${BASE}/batch-tasks/${taskId}`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.body.innerText.includes("立即运行"), { timeout: 10000 });
  // 详情页「执行目标」渲染原始 agentId（类型/目标/版本策略三元组）
  const detailHasAgent = await page.evaluate((p) => document.body.innerText.includes(p), AGENT_ID.slice(0, 8));
  check("task_detail_shows_executor", detailHasAgent, `执行目标区展示 agentId ${AGENT_ID.slice(0, 8)}… + 类型/版本策略`, String(detailHasAgent), `/batch-tasks/${taskId}`);
  await clickText("button", "立即运行");
  mark("ui_start_clicked");
  const startedToast = await waitToast("批次已启动", 15000);
  check("ui_start_task_run", Boolean(startedToast), "toast 批次已启动（taskRunId 前 8 位）", startedToast ?? "NO TOAST", "");
  // 取完整 taskRunId
  const r = await api(`/api/tasks/${taskId}/runs`);
  const first = (r.json?.items ?? [])[0] ?? null;
  taskRunId = first?.id ?? null;
  IDS.task_run_id = taskRunId;
  check("taskrun_created", Boolean(taskRunId), "TaskRun 行存在", String(taskRunId), `GET /api/tasks/${taskId}/runs`);
} catch (e) {
  check("ui_start_task_run", false, "UI 启动成功", `EXCEPTION ${String(e).slice(0, 200)}`, "");
}

// ===== C. 真实终态 + Run/Session/输出 =====
let tr = null;
try {
  if (!taskRunId) throw new Error("no taskRunId");
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const r = await api(`/api/tasks/${taskId}/runs`);
    tr = (r.json?.items ?? []).find((x) => x.id === taskRunId) ?? null;
    if (tr && ["succeeded", "failed", "partial", "cancelled"].includes(tr.status)) break;
    await sleep(5000);
  }
  mark("taskrun_terminal");
  check("taskrun_terminal_succeeded", tr?.status === "succeeded",
    "succeeded（抽样 2/2，failed=0）",
    JSON.stringify({ status: tr?.status, total: tr?.total, succeeded: tr?.succeeded, failed: tr?.failed }), "");
  IDS.taskrun_resolved_release = tr?.resolvedReleaseId ?? null;
  check("taskrun_frozen_release", Boolean(tr?.resolvedReleaseId), "冻结 active prod Release id", String(tr?.resolvedReleaseId), "");

  const runs = await api(`/api/runs?taskRunId=${taskRunId}`);
  const runRows = Array.isArray(runs.json) ? runs.json : (runs.json?.items ?? []);
  IDS.run_ids = runRows.map((x) => x.runId ?? x.id);
  IDS.agentscope_session_ids = runRows.map((x) => x.agentscopeSessionId);
  check("runs_exist_with_session", runRows.length === 2 && runRows.every((x) => x.agentscopeSessionId),
    "2 条 Run 均挂真实 AgentScope Session", `${runRows.length} runs, sessions=${JSON.stringify(IDS.agentscope_session_ids)}`, `GET /api/runs?taskRunId=${taskRunId}`);

  const outs = runRows.map((x) => JSON.stringify(x.output ?? null));
  const nonEmpty = runRows.every((x) => x.status === "succeeded" && x.output && Object.keys(x.output).length > 0 && JSON.stringify(x.output).length > 20);
  const distinct = outs[0] !== outs[1];
  check("outputs_real_not_fixed", nonEmpty && distinct,
    "两条输出非空且互不相同（真实逐条打标，非固定假结果）",
    `nonEmpty=${nonEmpty} distinct=${distinct} sizes=${outs.map((o) => o.length).join("/")}`,
    JSON.stringify(runRows.map((x) => String(JSON.stringify(x.output ?? "")).slice(0, 120))));

  const sessions = await api(`/api/v2/agents/${AGENT_ID}/sessions`);
  const sessIds = new Set((sessions.json?.items ?? []).map((s) => s.session_id));
  const indexed = IDS.agentscope_session_ids.filter((s) => sessIds.has(s)).length;
  check("sessions_indexed", indexed === IDS.agentscope_session_ids.length,
    "全部 Session 可在 Agent 会话索引查回", `${indexed}/${IDS.agentscope_session_ids.length}`, "");
} catch (e) {
  check("taskrun_terminal_succeeded", false, "终态 succeeded", `EXCEPTION ${String(e).slice(0, 200)}`, "");
}

// ===== D. UI 恢复：详情页 + 运行记录 + 刷新 =====
try {
  if (!taskId || !taskRunId) throw new Error("no task/run");
  await page.goto(`${BASE}/batch-tasks/${taskId}`, { waitUntil: "networkidle2" });
  await sleep(1500);
  const showsCompleted = await page.evaluate(() => document.body.innerText.includes("已完成"));
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1500);
  const stillCompleted = await page.evaluate(() => document.body.innerText.includes("已完成"));
  mark("detail_refresh_verified");
  check("detail_refresh_recovery", showsCompleted && stillCompleted,
    "详情页最近运行=已完成，reload 后仍在", `before=${showsCompleted} after=${stillCompleted}`, `/batch-tasks/${taskId}`);

  await page.goto(`${BASE}/operations/task-runs?taskId=${taskId}`, { waitUntil: "networkidle2" });
  await sleep(1200);
  // 运行记录行渲染 时间+任务名+触发（不显示裸 TaskRun id），按任务名断言
  const listHasRun = await page.evaluate((p) => document.body.innerText.includes(p), TASK_NAME);
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1200);
  const listStill = await page.evaluate((p) => document.body.innerText.includes(p), TASK_NAME);
  check("taskrun_list_refresh_recovery", listHasRun && listStill,
    "运行记录页（taskId 过滤）含该任务批次行，reload 后仍在", `before=${listHasRun} after=${listStill}`, `/operations/task-runs?taskId=${taskId}`);
} catch (e) {
  check("detail_refresh_recovery", false, "刷新恢复", `EXCEPTION ${String(e).slice(0, 200)}`, "");
}

// ===== E. 失败路径：无 active Release → 明确报错，不永久 loading =====
let failTaskId = null; let failAgentId = null; let failReleaseId = null;
try {
  const ts2 = Date.now();
  const ag = await api("/api/agents", {
    method: "POST",
    body: JSON.stringify({
      name: `E2E-FAILPATH-${String(ts2).slice(-6)}`, description: "P0-3 失败路径取证（创建即清理）",
      type: "custom", rolePrompt: "# 角色：失败路径取证\n## 限制：仅用于验收", modelRef: { modelId: "qwen-plus" },
    }),
  });
  failAgentId = ag.json?.id ?? null;
  IDS.failpath_agent_id = failAgentId;
  if (!failAgentId) throw new Error(`agent create failed ${ag.status} ${ag.txt.slice(0, 120)}`);
  const v = await api(`/api/agents/${failAgentId}/versions`, { method: "POST", body: JSON.stringify({ note: "failpath" }) });
  const rel = await api(`/api/agents/${failAgentId}/releases`, { method: "POST", body: JSON.stringify({ environment: "prod", versionId: v.json?.versionId, actor: "e2e-failpath" }) });
  failReleaseId = rel.json?.releaseId ?? null;
  const tk = await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      name: `E2E-FAILPATH-TASK-${String(ts2).slice(-6)}`, description: "失败路径取证",
      executionTarget: { type: "agent", agentId: failAgentId, versionPolicy: "latest_prod_release" },
      dataAssetId: ASSET_ID, dataDefinitionVersionId: def.latestVersionId ?? DEFVER_ID,
      sampling: { mode: "count", count: 1 }, dataWindow: { mode: "all" },
      rulePolicy: "follow_latest", resultRuleSetId: ruleSet.id,
    }),
  });
  failTaskId = tk.json?.id ?? null;
  IDS.failpath_task_id = failTaskId;
  if (!failTaskId) throw new Error(`task create failed ${tk.status} ${tk.txt.slice(0, 120)}`);
  // 回滚 Release（显式 ID 单事务 + audit 留痕）→ Agent 失去可执行性
  psql(`BEGIN; UPDATE release SET status='rolled_back' WHERE id='${failReleaseId}'; INSERT INTO audit_log (id, actor, action, target_type, target_id, detail, created_at) VALUES (md5(random()::text), 'e2e', 'e2e.failpath.release_rollback', 'agent', '${failAgentId}', jsonb_build_object('note','P0-3 失败路径取证'), now()); COMMIT;`);
  mark("failpath_release_rolled_back");

  await page.goto(`${BASE}/batch-tasks/${failTaskId}`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.body.innerText.includes("立即运行"), { timeout: 10000 });
  await clickText("button", "立即运行");
  const errToast = await waitToast("启动失败", 12000);
  // 不永久 loading：按钮仍在、页面可交互
  const stillInteractive = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("立即运行")));
  const runsAfter = await api(`/api/tasks/${failTaskId}/runs`);
  const dangling = (runsAfter.json?.items ?? []).filter((x) => ["queued", "running"].includes(x.status));
  check("failpath_explicit_error_no_loading",
    Boolean(errToast) && stillInteractive && dangling.length === 0,
    "明确报错 toast + 页面可交互 + 无 queued/running 悬挂",
    `toast=${errToast ? "yes" : "NO"} interactive=${stillInteractive} dangling=${dangling.length}`,
    String(errToast ?? "").slice(0, 200));
  mark("failpath_verified");
} catch (e) {
  check("failpath_explicit_error_no_loading", false, "失败路径明确报错", `EXCEPTION ${String(e).slice(0, 200)}`, "");
}

// ===== F. 清理（失败即脚本失败） =====
try {
  if (taskId) {
    const a1 = await api(`/api/tasks/${taskId}/status`, { method: "POST", body: JSON.stringify({ status: "archived" }) });
    IDS.task_archived = a1.status;
    if (a1.status !== 200) cleanupOk = false;
  } else cleanupOk = false;
  if (failTaskId) {
    const a2 = await api(`/api/tasks/${failTaskId}/status`, { method: "POST", body: JSON.stringify({ status: "archived" }) });
    IDS.failpath_task_archived = a2.status;
    if (a2.status !== 200) cleanupOk = false;
  } else cleanupOk = false;
  if (failAgentId) {
    const a3 = await api(`/api/agents/${failAgentId}`, { method: "PUT", body: JSON.stringify({ archived: true }) });
    IDS.failpath_agent_archived = a3.json?.archived ?? null;
    if (a3.json?.archived !== true) cleanupOk = false;
  } else cleanupOk = false;
  mark("cleanup_done");
} catch (e) {
  cleanupOk = false;
  console.log("CLEANUP_EXCEPTION", String(e).slice(0, 200));
}
check("cleanup_all_archived", cleanupOk, "task×2 归档 + 临时 Agent 归档 + release rolled_back", JSON.stringify(IDS), "");

fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  mode: "UI wizard create + UI start + real AgentScope execution (no mocks)",
  ids: IDS,
  timeline: TIMELINE,
  results: RESULTS,
  failures: RESULTS.filter((r) => !r.pass).length,
  cleanup_ok: cleanupOk,
}, null, 2));

await browser.close();
const failed = RESULTS.filter((r) => !r.pass).length;
console.log(`\n${failed === 0 && cleanupOk ? "ALL PASS" : `${failed} FAILURES / cleanupOk=${cleanupOk}`} (${RESULTS.length} checks) → ${OUT}`);
process.exit(failed === 0 && cleanupOk ? 0 : 1);
