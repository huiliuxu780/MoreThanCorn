/** 浏览器 E2E（2026-09-10 任务书 §十二；审计返工 P0-5 加固版）。
 *
 * 加固点（对首版"伪充分断言"的逐项纠正）：
 * - 每个断言验证**最终状态**（后端挂载/发布快照/运行时注入/页面持久内容），不是"点击过"；
 * - 模板市场分别统计 article 卡片与按钮，不再以按钮数冒充卡片数；
 * - Skill UI 安装后四连验证：后端 config.skills+GET /skills → 发布快照 _frozen_skills →
 *   AgentScope workspace 注入（session skills 端点）→ 真实执行行为生效（回复体现 SKILL 内容）；
 * - Automation 执行对象**真实打开选择器并点选**（断言选项含目标 Agent），不依赖默认预选巧合；
 * - Task 向导选择器以 UI 实开下拉断言（含已发布 custom Agent，P0-3 修复后语义）；
 * - 结果 JSON 每条含 name/pass/expected/actual/evidence/ts；
 * - 清理逐步验证（automation 删/task 归档/release psql 回滚+审计/agent 归档/mcp+conn 删），
 *   任一步失败 → 整个脚本失败；最后做残留守卫（e2e-mcp-conn 计数=0、active release=0）。
 *
 * 步骤：新建正式 Agent（UI 模板流）→ UI 安装 Skill（终态四连验证）→ 挂载本地安全 MCP
 * （in-page API-ASSISTED，记录为 API-ASSISTED）→ 创建版本+发布 prod（UI 治理页+快照核验）→
 * 新建对话（UI）→ 流式 ≥3 增量 → Skill 行为轮 → 工具调用+HITL 批准（UI）→ 刷新恢复 →
 * 一次性 run（API）+ Runs 面板（UI）→ Task 向导选择器（UI）+ 创建引用（API，执行 E2E 另见
 * e2e_task_execution.mjs）→ Automation UI 创建+手动运行+history → 清理+残留守卫。
 * 证据：research/morethancorn/11-p0-rework-20260910/evidence/e2e-browser.json + 截图。
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:5199";
const API = "http://127.0.0.1:8120";
const EV = "research/morethancorn/11-p0-rework-20260910/evidence";
const SKILL_NAME = "客服话术质检技能"; // 市场固定技能：行为验证提示词与其 SKILL.md 内容对应
const RESULTS = [];
const check = (name, ok, expected = "", actual = "", evidence = "") => {
  RESULTS.push({
    name, pass: !!ok,
    expected: String(expected).slice(0, 300),
    actual: String(actual).slice(0, 300),
    evidence: String(evidence).slice(0, 500),
    ts: new Date().toISOString(),
  });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} | expected=${String(expected).slice(0, 70)} | actual=${String(actual).slice(0, 70)}`);
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

const api = async (path, init) => {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch { /* noop */ }
  return { status: r.status, json, txt };
};

let agentId = null;
let mcpId = null;
let connId = null;
let taskId = null;
let autoId = null;
let installedSkillId = null;
let sessionId = null;

try {
  // ===== S1 新建正式 Agent（UI 统一创建页；P0-E 后卡片操作=查看详情/创建，创建走 ?template= 表单）=====
  await page.goto(`${BASE}/agents/new`, { waitUntil: "networkidle2" });
  await sleep(1200);
  const market = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("article")];
    const createBtns = cards.flatMap((c) => [...c.querySelectorAll("button")].filter((b) => (b.textContent || "").trim() === "创建"));
    const detailBtns = cards.flatMap((c) => [...c.querySelectorAll("button")].filter((b) => (b.textContent || "").includes("查看详情")));
    return { cards: cards.length, createBtns: createBtns.length, detailBtns: detailBtns.length };
  });
  check("template_market_cards", market.cards >= 8,
    "article 模板卡片 ≥8（与按钮分开计数，不以按钮数冒充卡片数）", `cards=${market.cards}`, "/agents/new DOM");
  check("template_market_card_buttons", market.createBtns === market.cards && market.detailBtns === market.cards,
    "每卡「查看详情」+「创建」各一", `create=${market.createBtns} detail=${market.detailBtns} cards=${market.cards}`,
    "/agents/new DOM（悬停操作区，DOM 常驻）");
  // 点第一张卡的「创建」→ 统一创建页（?template=）
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("article button")].find((x) => (x.textContent || "").trim() === "创建");
    b?.click();
  });
  await page.waitForFunction(() => location.pathname === "/agents/new" && location.search.includes("template="), { timeout: 10000 });
  await sleep(1000);
  // 填名称 + 必选模型（P0-2：真实下拉选择，无 models[0] 静默绑定）
  const nm = await page.$('input[placeholder="请输入 Agent 名称"]');
  if (!nm) throw new Error("unified create page: name input not found");
  await nm.click({ clickCount: 3 });
  await nm.type(`E2E-BROWSER-${String(Date.now()).slice(-6)}`);
  const mBox = await page.evaluate(() => {
    const t = [...document.querySelectorAll('button[role="combobox"]')].find((e) => (e.textContent || "").includes("请选择模型"));
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!mBox) throw new Error("model select not found on create page");
  await page.mouse.click(mBox.x, mBox.y);
  await sleep(500);
  const mOpt = await page.evaluate(() => {
    const os = [...document.querySelectorAll('[role="option"]')].filter((o) => (o.textContent || "").trim() && !(o.textContent || "").includes("请选择模型"));
    const o = os[0];
    if (!o) return null;
    const r = o.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!mOpt) throw new Error("no real model options");
  await page.mouse.click(mOpt.x, mOpt.y);
  await sleep(400);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => { const t = (x.textContent || "").trim(); return t === "创建" || t.startsWith("创建中"); });
    if (b && !b.disabled) b.click();
  });
  await page.waitForFunction(() => location.pathname.match(/^\/agents\/[0-9a-f]{32}$/), { timeout: 20000 });
  agentId = await page.evaluate(() => location.pathname.split("/")[2]);
  check("agent_created_via_ui", !!agentId,
    "统一创建页（模板→填名称→选模型→创建）跳转 /agents/<id>", String(agentId), page.url());

  // ===== S2 UI 安装 Skill（后端挂载终态验证） =====
  await page.goto(`${BASE}/agents/${agentId}/skills`, { waitUntil: "networkidle2" });
  await sleep(1500);
  const installClicked = await page.evaluate((skillName) => {
    const rows = [...document.querySelectorAll("li, div")].filter((r) => (r.textContent || "").includes(skillName));
    for (const r of rows.reverse()) {
      const b = [...r.querySelectorAll("button")].find((x) => x.textContent.trim() === "安装");
      if (b) { b.click(); return true; }
    }
    return false;
  }, SKILL_NAME);
  await sleep(1500);
  // 终态1：后端挂载（GET /api/agents/{id} config.skills 非空 + GET skills 列表含该技能）
  const ag1 = await api(`/api/agents/${agentId}`);
  const cfgSkills = ag1.json?.config?.skills ?? [];
  // legacy agent_skill 关联表已停写（agent_caps.py 410）；挂载权威 = config.skills（发布冻结链消费）。
  // 以 registry 名称对照确认所装即「客服话术质检技能」。
  const reg = await api("/api/registry/resources?types=skill&enabledOnly=false");
  const regSkills = reg.json?.items ?? [];
  const target = regSkills.find((x) => x.name === SKILL_NAME);
  installedSkillId = target?.id ?? cfgSkills[0] ?? null;
  check("skill_mount_via_ui_backend",
    installClicked && cfgSkills.length > 0 && !!target && cfgSkills.includes(target.id),
    `安装后 config.skills 含「${SKILL_NAME}」的 registry id（发布冻结链的权威挂载位）`,
    `clicked=${installClicked} config.skills=${JSON.stringify(cfgSkills)} registryId=${target?.id ?? "MISSING"}`,
    `GET /api/agents/${agentId} + /api/registry/resources?types=skill`);

  // ===== S3 挂载本地安全 MCP（API-ASSISTED）+ UI 发布 + 快照核验 =====
  const conn = await api("/api/connections", {
    method: "POST",
    body: JSON.stringify({ name: "e2e-mcp-conn", kind: "api_key", protocol: "mcp-http", endpoint: { base_url: "http://127.0.0.1:8310/mcp" }, environments: [], secret: null }),
  });
  connId = conn.json?.id;
  const mcp = await api("/api/ai-resources/mcp-servers", {
    method: "POST",
    body: JSON.stringify({ name: "e2e-safe-mcp", transport: "http", connectionId: connId, tested: true }),
  });
  mcpId = mcp.json?.id;
  const ag = await api(`/api/agents/${agentId}`);
  const cfg = { ...(ag.json?.config || {}), mcps: mcpId ? [mcpId] : [] };
  await api(`/api/agents/${agentId}`, { method: "PUT", body: JSON.stringify({ config: cfg }) });
  check("mcp_mount_api_assisted", !!mcpId && !!connId,
    "connection + mcp_server 创建并写入 agent.config.mcps（API-ASSISTED，如实标注）",
    `conn=${connId} mcp=${mcpId}`, "POST /api/connections + /api/ai-resources/mcp-servers");

  await page.goto(`${BASE}/agents/${agentId}/governance`, { waitUntil: "networkidle2" });
  await sleep(1200);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("发布新版本"));
    b?.click();
  });
  await sleep(600);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "生成版本");
    b?.click();
  });
  await sleep(2500);
  await page.evaluate(() => {
    const trig = [...document.querySelectorAll('[role="dialog"] [role="combobox"]')].pop();
    trig?.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((i) => i.textContent.trim() === "线上");
    opt?.click();
  });
  await sleep(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent.trim() === "发布");
    b?.click();
  });
  await sleep(3000);
  const rel = await api(`/api/agents/${agentId}/releases`);
  const prodActive = (rel.json || []).find((r) => r.environment === "prod" && r.status === "active");
  check("version_and_prod_release_via_ui", !!prodActive,
    "UI 发布后存在 prod active Release", JSON.stringify(prodActive ?? rel.json ?? []).slice(0, 160),
    `GET /api/agents/${agentId}/releases`);

  // 终态2：发布快照冻结 Skill + MCP（DB 直查 runtime_binding_snapshot）
  if (prodActive?.releaseId) {
    const snap = psql(`SELECT jsonb_pretty(runtime_binding_snapshot) FROM release WHERE id='${prodActive.releaseId}'`);
    const snapStr = snap || "";
    check("release_snapshot_frozen_skill_mcp",
      snapStr.includes(SKILL_NAME) && snapStr.includes("e2e-safe-mcp"),
      `runtime_binding_snapshot._frozen_skills 含「${SKILL_NAME}」且 _frozen_mcps 含 e2e-safe-mcp`,
      `skill=${snapStr.includes(SKILL_NAME)} mcp=${snapStr.includes("e2e-safe-mcp")}`,
      `psql release ${prodActive.releaseId}`);
  } else {
    check("release_snapshot_frozen_skill_mcp", false, "发布快照冻结 Skill+MCP", "NO ACTIVE RELEASE", "");
  }

  // ===== S4 对话：流式增量 + Skill 行为 + 工具调用 + HITL 批准 =====
  await page.goto(`${BASE}/agents/${agentId}/chat`, { waitUntil: "networkidle2" });
  await sleep(1500);
  await page.evaluate(() => {
    window.__growths = [];
    const obs = new MutationObserver(() => {
      const el = document.querySelector('[data-testid="live-text"]');
      if (el) window.__growths.push(el.textContent.length);
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  // S4a 长文流式：≥3 次增量
  await page.type("textarea", "请用约两百字分三点介绍前端工程师角色的职责与工作方式。");
  await page.keyboard.press("Enter");
  const growths = new Set();
  const deadline = Date.now() + 120000;
  let completed = false;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      const live = document.querySelector('[data-testid="live-text"]');
      return { len: live?.textContent?.length ?? 0 };
    });
    if (st.len > 0) growths.add(st.len);
    const done = await page.evaluate(() => {
      const live = document.querySelector('[data-testid="live-text"]');
      const persisted = [...document.querySelectorAll("main div")].some((d) =>
        d.textContent?.includes("工作方式") && d.textContent?.length > 200 && !d.querySelector('[data-testid="live-text"]'),
      );
      return !live && persisted;
    });
    if (done) { completed = true; break; }
    await sleep(700);
  }
  const observed = await page.evaluate(() => Array.from(new Set(window.__growths || [])));
  const distinct = Math.max(growths.size, observed.length);
  check("stream_increments_ge3", distinct >= 3 && completed,
    "REPLY_END 前 DOM ≥3 次不同长度增长且回复完成持久化",
    `distinct=${distinct} observer=${observed.length} completed=${completed}`,
    "MutationObserver 全程采样（data-testid=live-text）");

  // 会话 id（workspace 注入验证用）
  const sess = await api(`/api/v2/agents/${agentId}/sessions`);
  sessionId = (sess.json?.items ?? [])[0]?.session_id ?? null;

  // 终态3：AgentScope workspace Skill 注入（session 级 skills 端点）
  if (sessionId) {
    const ws = await api(`/api/v2/agents/${agentId}/sessions/${sessionId}/skills`);
    const wsStr = JSON.stringify(ws.json ?? []);
    check("skill_workspace_injected", ws.status === 200 && wsStr.includes("客服话术质检"),
      "运行时 session workspace 已注入所装 Skill", `status=${ws.status} body=${wsStr.slice(0, 160)}`,
      `GET /api/v2/agents/${agentId}/sessions/${sessionId}/skills`);
  } else {
    check("skill_workspace_injected", false, "session workspace 注入", "NO SESSION", "");
  }

  // 终态4：真实执行行为生效（回复体现 SKILL 内容：违禁词清单）
  const skillPrompt = "按你挂载的 SKILL「客服话术质检」的步骤，质检这句话：「我保证这个产品能用一辈子，无效全额退款再加赔一倍。」输出违禁词列表。";
  await page.evaluate((p) => {
    const ta = document.querySelector("textarea");
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, p);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, skillPrompt);
  await page.evaluate(() => {
    const send = [...document.querySelectorAll('button[aria-label="发送"]')].find((b) => !b.disabled);
    send?.click();
  });
  // 等待该轮真实完成：live-text 消失 + 助手回复（非用户消息）体现 SKILL 内容
  let skillReply = null;
  const dlSkill = Date.now() + 120000;
  while (Date.now() < dlSkill) {
    skillReply = await page.evaluate(() => {
      const live = document.querySelector('[data-testid="live-text"]');
      if (live) return null; // 仍在流式
      const divs = [...document.querySelectorAll("main div")].filter((d) => {
        const t = d.textContent || "";
        return t.includes("违禁") && !t.includes("质检这句话") && !t.includes("# SKILL") && !t.includes("SkillSkill") && t.length < 3000;
      });
      return divs.length ? divs[divs.length - 1].textContent.slice(0, 200) : null;
    });
    if (skillReply) break;
    await sleep(1000);
  }
  check("skill_behavior_followed", !!skillReply,
    "助手回复（排除用户消息）体现所装 SKILL 行为：违禁词清单", (skillReply ?? "no-reply").slice(0, 180),
    "UI 对话真实模型回复；runtime 侧 Skill 工具调用+SKILL.md 注入见 messages 表");

  // S4b 工具调用 + HITL 批准（UI）：单循环——确认空闲后发送，校验发送被接受，再等 HITL/echo
  let hitl2 = false;
  let toolDone = false;
  let sent = false;
  const deadline2 = Date.now() + 150000;
  while (Date.now() < deadline2) {
    if (!sent) {
      const ready = await page.evaluate(() => {
        const live = document.querySelector('[data-testid="live-text"]');
        const ta = document.querySelector("textarea");
        const stop = document.querySelector('button[aria-label="停止"]');
        return { idle: !live && !stop, hasTa: !!ta };
      });
      if (ready.idle && ready.hasTa) {
        await page.evaluate(() => {
          const ta = document.querySelector("textarea");
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
          setter.call(ta, "请调用 MCP 工具 safe_echo，参数 text=E2E-OK，并把返回原样告诉我。");
          ta.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await sleep(300);
        await page.evaluate(() => {
          const send = [...document.querySelectorAll('button[aria-label="发送"]')].find((b) => !b.disabled);
          send?.click();
        });
        await sleep(1200);
        // 发送被接受 = textarea 已清空（否则按钮当时实际不可用，重试）
        sent = await page.evaluate(() => {
          const ta = document.querySelector("textarea");
          return ta ? !ta.value : false;
        });
      }
    }
    const st = await page.evaluate(() => {
      const hitl = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("批准执行"));
      const echo = [...document.querySelectorAll("main div")].some((d) => d.textContent?.includes("ECHO:E2E-OK"));
      return { hitl: !!hitl, echo };
    });
    if (st.hitl && !hitl2) {
      hitl2 = true;
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("批准执行"));
        b?.click();
      });
    }
    if (sent && st.echo) { toolDone = true; break; }
    await sleep(1000);
  }
  check("hitl_card_and_approve_via_ui", sent && hitl2 && toolDone,
    "发送被接受→HITL 卡出现→UI 批准→工具结果 ECHO:E2E-OK 落屏",
    `sent=${sent} hitl=${hitl2} echo=${toolDone}`, "UI 真实点击批准");

  // ===== S5 刷新恢复 =====
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(2000);
  const restored = await page.evaluate(() => document.body.textContent.includes("E2E-OK") && document.body.textContent.includes("违禁"));
  check("refresh_restore", restored,
    "reload 后工具结果与 Skill 行为回复均从持久化恢复", `restored=${restored}`, "page.reload 后 DOM");

  // ===== S6 一次性 run（API）+ Runs 面板（UI） =====
  const run = await api(`/api/v2/agents/${agentId}/runs`, { method: "POST", body: JSON.stringify({ text: "回复 RUN-OK 即可" }) });
  check("single_run_returns_run_and_session", run.status === 200 && !!run.json?.run_id && !!run.json?.session_id,
    "200 + run_id + session_id（平台 Run 行 + 真实 Session）", JSON.stringify(run.json).slice(0, 160),
    `POST /api/v2/agents/${agentId}/runs`);
  await page.goto(`${BASE}/agents/${agentId}/board`, { waitUntil: "networkidle2" });
  await sleep(4000);
  // board 投影行标题 = "{agent 名} · {trigger_kind}"（as_flows_board.py:400），manual run 对应 manual 会话行；
  // run 终态另行以 API 核验（不以裸 id 文本冒充可见性）。
  const agentNameForBoard = (await api(`/api/agents/${agentId}`)).json?.name ?? "";
  const boardRowVisible = await page.evaluate((t) => document.body.textContent.includes(t), `${agentNameForBoard} · manual`);
  const runRow = await api(`/api/runs?agentId=${agentId}`);
  const runRows = Array.isArray(runRow.json) ? runRow.json : (runRow.json?.items ?? []);
  const runInList = runRows.find((r) => (r.runId ?? r.id) === run.json?.run_id);
  check("run_visible_in_board_panel", boardRowVisible && !!runInList,
    "board 出现该 run 的会话投影行（{agent} · manual）且 GET /api/runs?agentId= 可查回该 run",
    `boardRow=${boardRowVisible} runInList=${runInList?.status ?? "MISSING"}`,
    `/agents/${agentId}/board DOM + GET /api/runs?agentId=${agentId}`);

  // ===== S7 Task 向导选择器（UI 实开下拉）+ 创建引用（API；真执行 E2E 另见 e2e_task_execution.mjs） =====
  await page.goto(`${BASE}/batch-tasks/new`, { waitUntil: "networkidle2" });
  await sleep(1500);
  const agInfo = await api(`/api/agents/${agentId}`);
  const agentName = agInfo.json?.name ?? "";
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("领域 Agent"));
    b?.click();
  });
  await sleep(300);
  const comboBox = await page.evaluate(() => {
    const trig = [...document.querySelectorAll('button[role="combobox"]')].find((e) => (e.textContent || "").includes("选择 Agent"));
    if (!trig) return null;
    const r = trig.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  let wizardOpts = [];
  if (comboBox) {
    await page.mouse.click(comboBox.x, comboBox.y);
    await sleep(600);
    wizardOpts = await page.$$eval('[role="option"]', (os) => os.map((o) => (o.textContent || "").trim()));
    await page.keyboard.press("Escape");
  }
  check("task_wizard_selector_lists_published_agent",
    wizardOpts.some((t) => t.includes(agentName)),
    `向导执行目标下拉（UI 实开）含已发布 custom Agent「${agentName}」`,
    JSON.stringify(wizardOpts).slice(0, 200), "/batch-tasks/new DOM");

  const assets = await api("/api/data-assets?page=1&pageSize=5");
  const assetId = assets.json?.items?.[0]?.id;
  const defs = await api("/api/data-definitions?page=1&pageSize=5");
  const ddvId = defs.json?.items?.[0]?.latestVersionId;
  const rules = await api("/api/result-rules?page=1&pageSize=5");
  const ruleSetId = (rules.json?.items ?? rules.json ?? [])[0]?.id;
  const task = await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      name: "E2E-REF-TASK",
      executionTarget: { type: "agent", agentId, versionPolicy: "latest_prod_release" },
      dataAssetId: assetId,
      dataDefinitionVersionId: ddvId,
      sampling: { mode: "count", count: 1 },
      dataWindow: { mode: "all" },
      rulePolicy: "follow_latest",
      resultRuleSetId: ruleSetId,
    }),
  });
  taskId = task.json?.id;
  check("task_created_referencing_agent", (task.status === 200 || task.status === 201) && !!taskId,
    "创建验证：201 + task id（执行 E2E 由 e2e_task_execution.mjs 15 项覆盖，不在此重复）",
    `${task.status} ${taskId}`, task.txt.slice(0, 120));

  // ===== S8 Automation：UI 真实点选执行对象 + 手动运行 + history =====
  await page.goto(`${BASE}/autonomous-tasks`, { waitUntil: "networkidle2" });
  await sleep(1500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("新建自动任务"));
    b?.click();
  });
  await sleep(800);
  await page.evaluate(() => {
    const inp = [...document.querySelectorAll('[role="dialog"] input')][0];
    if (inp) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(inp, "E2E-REF-AUTO");
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.evaluate(() => {
    const ta = [...document.querySelectorAll('[role="dialog"] textarea')].pop();
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, "回复 AUTO-OK");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  // 真实打开执行对象下拉，断言选项含 E2E Agent（executable），并点选它
  // （触发器可能显示 placeholder，也可能已默认预选某个可执行 Agent——两种情况都要打开验证）
  const autoCombo = await page.evaluate((name) => {
    const trig = [...document.querySelectorAll('[role="dialog"] button[role="combobox"]')]
      .find((c) => (c.textContent || "").includes("选择已发布的 Agent") || (c.textContent || "").includes(name));
    if (!trig) return null;
    const r = trig.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, agentName);
  let autoOpts = [];
  if (autoCombo) {
    await page.mouse.click(autoCombo.x, autoCombo.y);
    await sleep(600);
    autoOpts = await page.$$eval('[role="option"]', (os) => os.map((o) => (o.textContent || "").trim()));
    await page.evaluate((name) => {
      const o = [...document.querySelectorAll('[role="option"]')].find((x) => (x.textContent || "").includes(name));
      o?.click();
    }, agentName);
    await sleep(400);
  }
  check("automation_selector_real_pick",
    autoOpts.some((t) => t.includes(agentName)),
    `自动任务执行对象下拉（UI 实开）含「${agentName}」并被点选`,
    JSON.stringify(autoOpts).slice(0, 200), "/autonomous-tasks 弹窗 DOM");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent.trim() === "保存");
    b?.click();
  });
  await sleep(2000);
  const autoList = await api("/api/v2/automations");
  const auto = (autoList.json?.items || []).find((a) => a.name === "E2E-REF-AUTO");
  autoId = auto?.id;
  check("automation_created_via_ui_with_selector", !!autoId && auto?.executor?.id === agentId,
    "保存成功且 executor=所选 E2E Agent", JSON.stringify(auto?.executor || {}).slice(0, 160),
    "GET /api/v2/automations");
  if (autoId) {
    const rn = await api(`/api/v2/automations/${autoId}/run-now`, { method: "POST" });
    check("automation_run_now", rn.status === 200 && !!rn.json?.trigger_log_id,
      "run-now 200 + trigger_log_id", JSON.stringify(rn.json).slice(0, 160), `POST /api/v2/automations/${autoId}/run-now`);
    await sleep(8000);
    const hist = await api(`/api/v2/automations/${autoId}/history`);
    const first = hist.json?.items?.[0] ?? null;
    check("automation_history_has_run", !!first && ["completed", "running", "failed"].includes(first.status),
      "history 出现真实触发记录（终态或进行中）", JSON.stringify(first ?? {}).slice(0, 160),
      `GET /api/v2/automations/${autoId}/history`);
  }

  fs.mkdirSync(EV, { recursive: true });
  await page.screenshot({ path: `${EV}/e2e-final-automations.png` });
} catch (e) {
  check("e2e_exception", false, "无异常", String(e).slice(0, 300), "");
}

// ===== 清理（逐步验证；任一失败 → 脚本失败）+ 残留守卫 =====
const cleanup = {};
try {
  if (autoId) cleanup.auto_delete = (await api(`/api/v2/automations/${autoId}`, { method: "DELETE" })).status;
  if (taskId) cleanup.task_archive = (await api(`/api/tasks/${taskId}/status`, { method: "POST", body: JSON.stringify({ status: "archived" }) })).status;
  if (agentId) {
    // 归档 Agent 的 active Release 一并 rolled_back（psql 单事务 + audit_log 留痕）
    const rbOut = psql(`BEGIN; UPDATE release SET status='rolled_back' WHERE agent_id='${agentId}' AND status='active'; INSERT INTO audit_log (id, actor, action, target_type, target_id, detail, created_at) VALUES (md5(random()::text), 'e2e', 'e2e.cleanup.release_rollback', 'agent', '${agentId}', jsonb_build_object('note','E2E 验收数据清理（P0-5 加固版脚本内执行）'), now()); COMMIT; SELECT count(*) FROM release WHERE agent_id='${agentId}' AND status='active';`);
    cleanup.release_rollback = rbOut.split("\n").pop();
    cleanup.agent_archive = (await api(`/api/agents/${agentId}`, { method: "PUT", body: JSON.stringify({ archived: true }) })).json?.archived;
  }
  if (mcpId) cleanup.mcp_delete = (await api(`/api/ai-resources/mcp-servers/${mcpId}`, { method: "DELETE" })).status;
  if (connId) cleanup.conn_delete = (await api(`/api/connections/${connId}`, { method: "DELETE" })).status;
} catch (e) {
  cleanup.exception = String(e).slice(0, 200);
}
const cleanupOk =
  (!autoId || cleanup.auto_delete < 300) &&
  (!taskId || cleanup.task_archive === 200) &&
  (!agentId || (cleanup.release_rollback === "0" && cleanup.agent_archive === true)) &&
  (!mcpId || cleanup.mcp_delete < 300) &&
  (!connId || cleanup.conn_delete < 300) &&
  !cleanup.exception;
check("e2e_cleanup_verified", cleanupOk,
  "automation 删除 / task 归档 / release rolled_back(余0) / agent 归档 / mcp+conn 删除 全部成功",
  JSON.stringify(cleanup), "逐步状态码验证");

// 残留守卫：e2e-mcp-conn 连接计数=0；E2E Agent 无 active release
try {
  // API DELETE /api/connections = 归档留痕（audit: connection.archived）；残留守卫按"未归档"计数
  const connCount = Number(psql(`SELECT count(*) FROM connection WHERE name='e2e-mcp-conn' AND archived_at IS NULL`));
  const activeRel = agentId ? Number(psql(`SELECT count(*) FROM release WHERE agent_id='${agentId}' AND status='active'`)) : -1;
  check("no_residue_after_cleanup", connCount === 0 && activeRel === 0,
    "未归档 e2e-mcp-conn 连接 0 条 + E2E Agent active Release 0 条",
    `conn_unarchived=${connCount} activeRel=${activeRel}`, "psql 直查（归档留痕行不计为残留）");
} catch (e) {
  check("no_residue_after_cleanup", false, "残留守卫", String(e).slice(0, 200), "");
}

fs.writeFileSync(`${EV}/e2e-browser.json`, JSON.stringify({
  generatedAt: new Date().toISOString(),
  mode: "hardened (P0-5): final-state assertions, structured results, verified cleanup, residue guard",
  ids: { agentId, mcpId, connId, taskId, autoId, installedSkillId, sessionId },
  results: RESULTS,
  failures: RESULTS.filter((r) => !r.pass).length,
}, null, 2));
const failed = RESULTS.filter((r) => !r.pass).map((r) => r.name);
console.log("E2E_RESULT", failed.length ? `FAIL:${failed.join(",")}` : `PASS (${RESULTS.length} checks)`);
await browser.close();
process.exit(failed.length ? 1 : 0);
