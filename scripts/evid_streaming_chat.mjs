#!/usr/bin/env node
/** 审计返工 P0-6（09-10 二轮）：流式输出与对话体验真实浏览器验证 + QoderWake 同视口对照。
 *
 *  在产品 Agent「业务分析-通话打标」（已发布，e773172b）上新建真实会话，完成 4 轮真实 LLM 对话：
 *  T1 长文流式：页内 fetch 补丁逐帧记录 UI 实际消费的 SSE 事件时间线
 *     （REPLY_START / TEXT_BLOCK_DELTA×N / REPLY_END），REPLY_END 前 DOM ≥3 次不同长度增长；
 *     流式中上滚（同一容器标记探测）→ 不被强制拉回底部；
 *  T2 工具调用：触发已挂载 Skill 的工具调用，验证工具卡按同一 tool_call_id 聚合（单卡不分裂）；
 *  T3 停止按钮：流式中点停止 → 流终止、composer 回 idle、不悬挂；
 *  T4 断线重连：流式中显式 abort 当前 SSE + CDP offline 2.5s → 恢复 → 至少一次重挂并完成回复，刷新后回复文本恰好出现一次
 *     （事件 id 去重 + 持久化回读补gap；配套产品修复：attachStreamInner 失败续接退避重试链）。
 *  刷新恢复：轮后 reload，持久化消息完整。
 *  几何对照（1440×900）：左历史栏 x/w、居中列宽（composer 实测）、右面板入口、发送钮 ——
 *  QW 侧数值取本日早轮活体实测（qoderwake-live-observations.md §2，本轮对 QW 产品零操作）。
 *  清理：删除本脚本创建的会话（平台+运行时），不动用户既有会话。
 *  证据：evidence/streaming-verification.json + evidence/streaming/*.png */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:5199";
const API = "http://127.0.0.1:8120";
const AGENT_ID = "e773172b6b434ed1a3011af443bb0f55";
const EV = "research/morethancorn/11-p0-rework-20260910/evidence";
const SHOT = `${EV}/streaming`;
fs.mkdirSync(SHOT, { recursive: true });

const RESULTS = [];
const TIMELINE = [];
const t0 = Date.now();
const mark = (n) => TIMELINE.push({ name: n, at: new Date().toISOString(), elapsed_ms: Date.now() - t0 });
const check = (name, ok, expected = "", actual = "", evidence = "") => {
  RESULTS.push({ name, pass: !!ok, expected: String(expected).slice(0, 300), actual: String(actual).slice(0, 300), evidence: String(evidence).slice(0, 500), ts: new Date().toISOString() });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} | expected=${String(expected).slice(0, 70)} | actual=${String(actual).slice(0, 90)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, init) => {
  const r = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  let json = null; try { json = await r.json(); } catch { /* noop */ }
  return { status: r.status, json };
};

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));

// 页内 fetch 补丁：tee UI 实际消费的 SSE 流（/sessions/{sid}/stream），逐帧记录 type+ts
await page.evaluateOnNewDocument(() => {
  window.__sseLog = [];
  window.__streamFetches = [];
  window.__streamOpens = [];
  window.__activeStreamAbort = null;
  window.__dropStream = () => {
    if (!window.__activeStreamAbort || window.__activeStreamAbort.signal.aborted) return false;
    window.__activeStreamAbort.abort();
    return true;
  };
  const origFetch = window.fetch;
  window.fetch = async (...args) => {
    const url = typeof args[0] === "string" ? args[0] : (args[0]?.url ?? "");
    const isStream = url.includes("/sessions/") && url.endsWith("/stream");
    let fetchArgs = args;
    if (isStream) {
      window.__streamFetches.push({ ts: Date.now() });
      const localAbort = new AbortController();
      window.__activeStreamAbort = localAbort;
      const init = { ...(args[1] || {}) };
      const upstream = init.signal;
      if (upstream && typeof AbortSignal.any === "function") {
        init.signal = AbortSignal.any([upstream, localAbort.signal]);
      } else {
        if (upstream) upstream.addEventListener("abort", () => localAbort.abort(), { once: true });
        init.signal = localAbort.signal;
      }
      fetchArgs = [args[0], init];
    }
    let res;
    try { res = await origFetch(...fetchArgs); }
    catch (e) { if (isStream) window.__sseLog.push({ type: "__FETCH_ERR__", ts: Date.now() }); throw e; }
    {
      if (isStream && res.body) {
        window.__streamOpens.push({ ts: Date.now(), status: res.status });
        const clone = res.clone();
        (async () => {
          const reader = clone.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf("\n\n")) >= 0) {
              const frame = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
              if (!dataLine) continue;
              try {
                const ev = JSON.parse(dataLine.slice(5).trim());
                if (ev && ev.type) window.__sseLog.push({ type: String(ev.type), ts: Date.now() });
              } catch { /* heartbeat */ }
            }
          }
          window.__sseLog.push({ type: "__STREAM_DONE__", ts: Date.now() });
        })().catch(() => window.__sseLog.push({ type: "__READ_ERR__", ts: Date.now() }));
      }
    }
    return res;
  };
});

const client = await page.createCDPSession();
await client.send("Network.enable");

const sseSince = async (ts) => page.evaluate((t0) => (window.__sseLog || []).filter((e) => e.ts >= t0), ts);
const sendText = async (text) => {
  await page.evaluate((t) => {
    const ta = document.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, t);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await sleep(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-label="发送"]')].find((x) => !x.disabled);
    b?.click();
  });
};
const liveLen = () => page.evaluate(() => document.querySelector('[data-testid="live-text"]')?.textContent?.length ?? 0);
const composerIdle = () => page.evaluate(() =>
  !document.querySelector('[data-testid="live-text"]') && !document.querySelector('button[aria-label="停止"]'));
const bodyHas = (t) => page.evaluate((x) => document.body.textContent.includes(x), t);
async function waitIdle(timeout = 150000) {
  const dl = Date.now() + timeout;
  while (Date.now() < dl) {
    if (await composerIdle()) return true;
    await sleep(800);
  }
  return false;
}
const sessionId = () => page.evaluate(() => new URLSearchParams(location.search).get("session"));

mark("script_start");
await page.goto(`${BASE}/agents/${AGENT_ID}/chat`, { waitUntil: "networkidle2" });
await sleep(1500);

// 事故修复（09-10 二轮）：对话页无 ?session= 时会自动挂到既有会话——脚本必须自建新会话，
// 且清理只允许删除"脚本开始后新建"的会话（白名单防误删用户/证据会话）。
const preSessions = new Set(((await api(`/api/v2/agents/${AGENT_ID}/sessions`)).json?.items ?? []).map((x) => x.session_id));
// 经正式 API 自建会话（POST /api/v2/agents/{id}/sessions），再带 ?session= 导航——
// 避免页面自动选中既有会话（UI「新建」按钮会被自动选中逻辑对冲）。
const opened = await api(`/api/v2/agents/${AGENT_ID}/sessions`, { method: "POST", body: JSON.stringify({}) });
const myNewSession = opened.json?.session_id ?? null;
if (!myNewSession || preSessions.has(myNewSession)) throw new Error(`无法自建新会话（${JSON.stringify(opened.json).slice(0, 120)}）——中止，避免污染既有会话`);
await page.goto(`${BASE}/agents/${AGENT_ID}/chat?session=${myNewSession}`, { waitUntil: "networkidle2" });
await sleep(1500);
console.log("fresh session:", myNewSession, "(preexisting:", preSessions.size, ")");

// ===== T1 长文流式 + SSE 事件时间线 + 上滚不回拉 =====
await page.evaluate(() => {
  window.__growths = [];
  const obs = new MutationObserver(() => {
    const el = document.querySelector('[data-testid="live-text"]');
    if (el) window.__growths.push({ len: el.textContent.length, ts: Date.now() });
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
});
const t1Start = Date.now();
await sendText("请用约一千字分十点介绍质量运营岗位的日常职责，每点给出一个具体例子，不要省略。");
mark("t1_sent");
// 等待流式展开且有足够滚动高度
const dlScroll = Date.now() + 60000;
while (Date.now() < dlScroll) {
  const ready = await page.evaluate(() => {
    const cands = [...document.querySelectorAll("main *")].filter((e) => e.scrollHeight > e.clientHeight + 200 && e.clientHeight > 200);
    return cands.length > 0 && !!document.querySelector('[data-testid="live-text"]');
  });
  if (ready) break;
  await sleep(500);
}
// 同一容器探测：main 内最大可滚容器（消息流 scroller），dataset 标记；读取时标记丢失则重选并如实记录
const pickScroller = () => {
  const cands = [...document.querySelectorAll("main *")].filter((e) => e.scrollHeight > e.clientHeight + 200 && e.clientHeight > 200);
  const c = cands.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
  return c ?? null;
};
const scrollSet = await page.evaluate((fnSrc) => {
  const pick = eval(fnSrc);
  const c = pick();
  if (!c) return null;
  c.dataset.scrollProbe = "1";
  c.scrollTop = 0;
  return { ok: true, max: c.scrollHeight - c.clientHeight };
}, pickScroller.toString());
await sleep(2000);
const scrollAfter = await page.evaluate((fnSrc) => {
  const pick = eval(fnSrc);
  const marked = document.querySelector('[data-scroll-probe="1"]');
  const c = marked ?? pick();
  if (!c) return null;
  return { top: c.scrollTop, max: c.scrollHeight - c.clientHeight, viaMarker: !!marked };
}, pickScroller.toString());
const notPulled = scrollSet !== null && scrollAfter !== null && scrollAfter.max > 0 && scrollAfter.top < Math.max(48, scrollAfter.max * 0.25);
const t1Done = await waitIdle(150000) && await bodyHas("质量运营");
mark("t1_completed");
const evs1 = await sseSince(t1Start);
const cnt = (evs, t) => evs.filter((e) => e.type === t).length;
const replyEndTs = (evs1.filter((e) => e.type === "REPLY_END").pop() ?? {}).ts ?? null;
const growths = await page.evaluate(() => window.__growths || []);
const beforeEnd = growths.filter((g) => !replyEndTs || g.ts <= replyEndTs + 300);
const distinctBeforeEnd = new Set(beforeEnd.map((g) => g.len));
check("t1_sse_event_timeline",
  cnt(evs1, "REPLY_START") >= 1 && cnt(evs1, "TEXT_BLOCK_DELTA") >= 3 && cnt(evs1, "REPLY_END") >= 1,
  "REPLY_START≥1 + TEXT_BLOCK_DELTA≥3 + REPLY_END≥1（页内 tee UI 实际消费的 SSE 帧）",
  `START=${cnt(evs1, "REPLY_START")} DELTA=${cnt(evs1, "TEXT_BLOCK_DELTA")} END=${cnt(evs1, "REPLY_END")} total=${evs1.length}`,
  JSON.stringify(evs1.slice(0, 5).map((e) => e.type)) + " … " + JSON.stringify(evs1.slice(-3).map((e) => e.type)));
check("t1_dom_growth_ge3_before_reply_end",
  t1Done && distinctBeforeEnd.size >= 3,
  "REPLY_END 前 DOM ≥3 次不同长度增长",
  `beforeEnd=${distinctBeforeEnd.size} total=${new Set(growths.map((g) => g.len)).size} completed=${t1Done}`,
  "MutationObserver(data-testid=live-text) 时间戳采样 vs REPLY_END 帧时间");
check("t1_scroll_up_not_pulled_back", notPulled,
  "流式中上滚至顶后 2s 不被强制拉回底部（同一标记容器实测）",
  `top=${scrollAfter?.top} max=${scrollAfter?.max}`, "data-scroll-probe 同元素 scrollTop 前后对照");
await page.screenshot({ path: `${SHOT}/t1-completed.png` });

// 刷新恢复（T1 后）
await page.reload({ waitUntil: "networkidle2" });
await sleep(2000);
const t1Restored = await bodyHas("质量运营");
const sid = await sessionId();
check("t1_refresh_restore", t1Restored && !!sid,
  "reload 后 T1 回复从持久化恢复且 session 入 URL", `restored=${t1Restored} session=${sid}`, page.url());

// ===== T2 工具调用：Skill 工具卡按同一 tool_call_id 聚合 =====
const t2Start = Date.now();
await sendText('按你挂载的 SKILL「客服话术质检」的步骤，质检这句话：「本产品绝对有效，七天无效全额退款再加赔一倍。」输出违禁词列表。');
mark("t2_sent");
let cardObs = [];
const dl2 = Date.now() + 120000;
while (Date.now() < dl2) {
  const snap = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("main div")].filter((d) => {
      const t = d.textContent || "";
      return t.includes("Skill") && (t.includes("调用") || t.includes("success") || t.includes("完成") || t.includes("参数")) && t.length < 500;
    });
    // 取最内层（最小面积）卡集合，避免外层容器重复计数
    const inner = cards.filter((c) => !cards.some((o) => o !== c && c.contains(o)));
    return inner.map((c) => ({ text: (c.textContent || "").replace(/\s+/g, " ").slice(0, 90), h: Math.round(c.getBoundingClientRect().height) }));
  });
  if (snap.length) cardObs.push({ n: snap.length, t: Date.now(), first: snap[0].text });
  if ((await composerIdle()) && cardObs.length) break;
  await sleep(700);
}
mark("t2_completed");
const evs2 = await sseSince(t2Start);
const toolEv = ["TOOL_CALL_START", "TOOL_CALL_END", "TOOL_RESULT_END"].map((t) => `${t}=${cnt(evs2, t)}`).join(",");
const singleCard = cardObs.length > 0 && cardObs.every((c) => c.n === 1);
check("t2_toolcard_aggregated_single_call",
  singleCard && cnt(evs2, "TOOL_CALL_START") >= 1,
  "工具调用发生（TOOL_CALL_START 帧）且工具卡恒为单卡（同 tool_call_id 聚合，状态演进不分裂）",
  `samples=${cardObs.length} allSingle=${singleCard} ${toolEv}`,
  JSON.stringify(cardObs.slice(0, 3).map((c) => `n=${c.n}:${c.first.slice(0, 50)}`)));
await page.screenshot({ path: `${SHOT}/t2-toolcard.png` });

// ===== T3 停止按钮 =====
await sendText("请非常详细地分十点展开讲解全面质量管理的演进历史，每点不少于一百字。");
mark("t3_sent");
let stopped = false;
const dl3 = Date.now() + 60000;
while (Date.now() < dl3) {
  if ((await liveLen()) > 20) {
    await page.evaluate(() => document.querySelector('button[aria-label="停止"]')?.click());
    stopped = true;
    break;
  }
  await sleep(400);
}
await sleep(2500);
const afterStop = await page.evaluate(() => ({
  idle: !document.querySelector('[data-testid="live-text"]') && !document.querySelector('button[aria-label="停止"]'),
  badge: [...document.querySelectorAll("main span, main div")].map((e) => (e.textContent || "").trim()).find((t) => ["已取消", "已停止", "interrupted"].includes(t)) ?? null,
}));
mark("t3_stopped");
check("t3_stop_button_cancels_stream", stopped && afterStop.idle,
  "流式中点停止 → 流终止、composer 回 idle（无悬挂 loading）",
  `clicked=${stopped} idle=${afterStop.idle} badge=${afterStop.badge}`,
  "停止按钮真实点击 + composer 状态实测");
await page.screenshot({ path: `${SHOT}/t3-stopped.png` });

// ===== T4 断线重连不重复 =====
const t4Start = Date.now();
await sendText("请用约两百字介绍数据打标工作的质量要点，回复开头必须以「质量要点五则」起句。");
mark("t4_sent");
const dl4a = Date.now() + 60000;
while (Date.now() < dl4a) {
  if ((await liveLen()) > 30) break;
  await sleep(400);
}
const t4OpensBeforeDrop = await page.evaluate(() => (window.__streamOpens || []).length);
await client.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
const streamDropped = await page.evaluate(() => window.__dropStream?.() ?? false);
await sleep(2500);
await client.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
mark("t4_network_restored");
const t4Done = await waitIdle(180000);
const evs4 = await sseSince(t4Start); // 必须在 reload 前采样（reload 会重置页内 __sseLog）
const t4sid = await sessionId();
// 失败诊断同样必须在 reload 前采样
const t4Diag = await page.evaluate(() => ({
  fetches: (window.__streamFetches || []).length,
  opens: (window.__streamOpens || []).length,
  hist: (window.__sseLog || []).reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {}),
  stopBtn: !!document.querySelector('button[aria-label="停止"]'),
  live: document.querySelector('[data-testid="live-text"]')?.textContent?.length ?? 0,
}));
const rtStatus = await api(`/api/v2/agents/${AGENT_ID}/sessions/${t4sid}/status`).then((r) => r.json?.status ?? "?").catch(() => "ERR");
console.log("T4 diag:", JSON.stringify(t4Diag), "runtime:", rtStatus);
// 持久化消息级查重：assistant 消息中含标记的恰好 1 条、且条内标记只出现 1 次（事件 id 去重的最终态证明）
const msgs = await api(`/api/v2/agents/${AGENT_ID}/sessions/${t4sid}/messages`);
const msgRows = msgs.json?.messages ?? [];
const assistantHits = msgRows
  .filter((m) => m.role === "assistant")
  .map((m) => (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join(""))
  .map((t) => t.split("质量要点五则").length - 1);
const t4Reply = assistantHits.filter((n) => n > 0).length === 1 && assistantHits.reduce((a, b) => a + b, 0) === 1;
await page.reload({ waitUntil: "networkidle2" });
await sleep(2500);
const dupProbe = await page.evaluate(() => {
  const body = document.body.textContent || "";
  return { occurrences: body.split("质量要点五则").length - 1 };
});
mark("t4_completed");
// 拆分两项（审计口径）：①不重复文本（持久化级+刷新全文级）②UI 终态不悬挂（看门狗收尾）
check("t4_reconnect_no_duplicate_text", streamDropped && t4Diag.opens > t4OpensBeforeDrop && t4Reply && dupProbe.occurrences === 2,
  "显式中止当前 SSE + 断网 2.5s 后新增至少 1 次成功 SSE open，回复完成且不重复：持久化 assistant 标记恰 1 条×1 次；刷新后全文=2",
  `dropped=${streamDropped} fetches=${t4Diag.fetches} opens=${t4OpensBeforeDrop}->${t4Diag.opens} hits=${JSON.stringify(assistantHits)} body=${dupProbe.occurrences} frames=${evs4.length}`,
  "页内 AbortController 强制断开现有 SSE + CDP offline→online + GET messages 持久化级计数 + reload 全文计数");
check("t4_ui_terminal_after_blip", t4Done && t4Diag.stopBtn === false,
  "强制断流并重挂后 UI 不永久悬挂：composer 回 idle、live 残片清除",
  `idle=${t4Done} stopBtn=${t4Diag.stopBtn} liveAtDiag=${t4Diag.live} rt=${rtStatus} fetches=${t4Diag.fetches}`,
  "产品修复=agent-chat.tsx 状态对账 + 看门狗 + 死通道重挂 + 退避重试链");
await page.screenshot({ path: `${SHOT}/t4-after-reconnect.png` });

// ===== 几何对照（MTC 实测 vs QW 本日早轮活体实测，1440×900） =====
const geo = await page.evaluate(() => {
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const asides = [...document.querySelectorAll("main *, aside")].map((e) => ({ el: e, r: e.getBoundingClientRect() }))
    .filter((o) => o.r.width > 150 && o.r.width < 360 && o.r.height > 400 && o.r.x >= 40 && o.r.x <= 120);
  const hist = asides.sort((a, b) => a.r.x - b.r.x)[0];
  const ta = document.querySelector("textarea");
  const sendBtn = [...document.querySelectorAll('button[aria-label="发送"]')][0] ?? [...document.querySelectorAll('button[aria-label="停止"]')][0];
  const taskBtn = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("当前任务"));
  const composerBtns = ta ? [...ta.closest("div[class*=border], footer, form")?.querySelectorAll("button") ?? []].map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim()).filter(Boolean).slice(0, 8) : [];
  return {
    history_sidebar: hist ? { x: Math.round(hist.r.x), w: Math.round(hist.r.width), h: Math.round(hist.r.height) } : null,
    textarea: rect(ta),
    send_button: rect(sendBtn),
    current_task_button: rect(taskBtn),
    composer_buttons: composerBtns,
  };
});
const qw = {
  history_sidebar: { x: 64, w: 240 },
  feed_column_w: 720,
  current_task_button: { w: 96, h: 28 },
  composer: "textarea + 底行（选择工作目录 + '+' + 模型选择 + 圆形发送按钮[空 disabled]）",
};
const geoOk =
  geo.history_sidebar && Math.abs(geo.history_sidebar.x - qw.history_sidebar.x) <= 8 &&
  Math.abs(geo.history_sidebar.w - qw.history_sidebar.w) <= 24 &&
  geo.textarea && Math.abs(geo.textarea.w - qw.feed_column_w) <= 80 &&
  geo.send_button != null && geo.current_task_button != null;
check("qw_geometry_alignment_1440", geoOk,
  "左历史栏 x≈64 w≈240 / 居中列（textarea 实测）≈720±80 / 「当前任务」入口 + 发送钮在场",
  JSON.stringify({ hist: geo.history_sidebar, ta: geo.textarea, send: !!geo.send_button, task: !!geo.current_task_button }),
  JSON.stringify({ qw, composer_buttons: geo.composer_buttons }));

// ===== 清理：仅删除脚本自建会话（白名单校验 + 平台 SESSION_REFERENCED_BY_RUN 守卫双保险） =====
const mySession = await sessionId();
const cleanup = { session_id: mySession, preexisting_guard: !preSessions.has(mySession ?? "") };
if (mySession && !preSessions.has(mySession)) {
  const del = await api(`/api/v2/agents/${AGENT_ID}/sessions/${mySession}`, { method: "DELETE" });
  cleanup.delete_status = del.status;
  cleanup.deleted = del.json?.deleted ?? null;
} else {
  cleanup.skipped = "session 属既有白名单，拒绝删除";
}
check("cleanup_session_deleted",
  cleanup.delete_status === 200 && cleanup.deleted !== false && cleanup.preexisting_guard === true,
  "仅脚本自建会话被清理；既有/用户会话零触碰",
  JSON.stringify(cleanup), `DELETE /api/v2/agents/${AGENT_ID}/sessions/${mySession}`);

fs.writeFileSync(`${EV}/streaming-verification.json`, JSON.stringify({
  generatedAt: new Date().toISOString(),
  agent: `${AGENT_ID}（业务分析-通话打标，已发布 prod）`,
  mode: "real browser + real LLM + 页内 SSE tee（无 mock）",
  geometry: { mtc_1440: geo, qw_1440: qw, qw_source: "qoderwake-live-observations.md §2（本日早轮活体实测；本轮对 QW 产品零操作）" },
  timeline: TIMELINE,
  results: RESULTS,
  failures: RESULTS.filter((r) => !r.pass).length,
  cleanup,
  screenshots: ["streaming/t1-completed.png", "streaming/t2-toolcard.png", "streaming/t3-stopped.png", "streaming/t4-after-reconnect.png"],
}, null, 2));

await browser.close();
const failed = RESULTS.filter((r) => !r.pass).length;
console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILURES`} (${RESULTS.length} checks) → evidence/streaming-verification.json`);
process.exit(failed === 0 ? 0 : 1);
