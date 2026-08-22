// CDP network capture for quickservice research. Sanitizes in-memory before writing.
import { writeFileSync } from "node:fs";

const OUT = "/Users/rivers/MoreThanCorn/docs/research/lightweight-workflow-system/evidence/network/quickservice-capture-sanitized.json";
const BASE = "http://127.0.0.1:9222";
const LIST = "https://config.quickservice.lydaas.com/intelligent-agent/ui/agent_store/blank/newWorkFlow";
const EDITOR = "https://config.quickservice.lydaas.com/ui/agent_store/blank/newWorkFlowDetail?processId=5fad0c7e24d247119508c85ee5f153d4";
const TOOLS = "https://config.quickservice.lydaas.com/intelligent-agent/ui/agent_store/blank/pluginBase";
const LOGS = "https://config.quickservice.lydaas.com/ui/agent_store/blank/McpUseLog?type=service";

const SENS = /cookie|authorization|proxy-authorization|token|secret|api[-_]?key|password|passwd|phone|mobile|idcard|identity|session|credential/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const PHONE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;

const maskStr = (s) => (typeof s === "string" ? s.replace(EMAIL, "***@***").replace(PHONE, "1**********") : s);
const cleanObj = (o) => {
  if (Array.isArray(o)) return o.map(cleanObj);
  if (o && typeof o === "object")
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, SENS.test(k) ? "***" : cleanObj(v)]));
  return maskStr(o);
};
const cleanHeaders = (hs) =>
  Object.fromEntries(
    Object.entries(hs || {})
      .filter(([k]) => !/^set-cookie$/i.test(k))
      .map(([k, v]) => [k, SENS.test(k) ? "***" : maskStr(String(v))])
  );
const cleanBodyText = (t) => { try { return cleanObj(JSON.parse(t)); } catch { return maskStr(String(t)).slice(0, 200000); } };

// find target
const targets = await (await fetch(`${BASE}/json/list`)).json();
const target = targets.find((t) => t.type === "page" && /quickservice/.test(t.url || "")) || targets.find((t) => t.type === "page");
if (!target) { console.log("NO TARGET"); process.exit(1); }
console.log("target:", target.url?.slice(0, 100));

const ws = new WebSocket(target.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => rej(new Error("timeout:" + method)), 15000);
});
const requests = new Map(); // requestId -> {method,url,reqHeaders,postData,status,resHeaders,resBody}
ws.onmessage = async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Network.requestWillBeSent") {
    const r = m.params.request;
    requests.set(m.params.requestId, {
      ts: m.params.timestamp, method: r.method, url: r.url,
      reqHeaders: cleanHeaders(r.headers),
      postData: r.postData ? cleanBodyText(r.postData) : undefined,
      type: m.params.type,
    });
  } else if (m.method === "Network.responseReceived") {
    const rec = requests.get(m.params.requestId);
    if (rec) { rec.status = m.params.response.status; rec.mimeType = m.params.response.mimeType; rec.resHeaders = cleanHeaders(m.params.response.headers); }
  } else if (m.method === "Network.loadingFinished") {
    const rec = requests.get(m.params.requestId);
    if (rec && /json|text/.test(rec.mimeType || "") && rec.status < 400) {
      try { const b = await send("Network.getResponseBody", { requestId: m.params.requestId }); if (b.result?.body) rec.resBody = cleanBodyText(b.result.body); } catch {}
    }
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = (text) => send("Runtime.evaluate", { expression: `(()=>{const els=[...document.querySelectorAll('button,span,div')].filter(e=>e.offsetParent!==null&&(e.innerText||'').trim()==='${text}');if(!els.length)return 'notfound:'+${JSON.stringify(text)};els.sort((a,b)=>(a.innerText.length-b.innerText.length)||(a.textContent.length-b.textContent.length));const el=els[0];el.click();return 'clicked:'+${JSON.stringify(text)}})()` });

ws.onopen = async () => {
  try {
    await send("Network.enable", { maxTotalBufferSize: 100 * 1024 * 1024 });
    await send("Page.enable");
    const steps = [
      ["goto list", () => send("Page.navigate", { url: LIST }), 7000],
      ["goto editor", () => send("Page.navigate", { url: EDITOR }), 9000],
      ["click 试运行", () => clickText("试运行"), 4000],
      ["click 发布", () => clickText("发布"), 3000],
      ["click 取消", () => clickText("取消"), 3000],
      ["goto tools", () => send("Page.navigate", { url: TOOLS }), 7000],
      ["click 调用日志", () => clickText("调用日志"), 5000],
      ["goto logs", () => send("Page.navigate", { url: LOGS }), 7000],
    ];
    for (const [name, fn, wait] of steps) {
      const r = await fn();
      console.log("step:", name, "→", JSON.stringify(r.result?.result?.value ?? r.result ?? {}).slice(0, 120));
      await sleep(wait);
    }
    await sleep(3000);
    const out = {
      capturedAt: new Date().toISOString(),
      target: target.url,
      total: requests.size,
      entries: [...requests.values()].map((r) => ({
        method: r.method, status: r.status, type: r.type, mimeType: r.mimeType, url: r.url,
        postData: r.postData, resBody: r.resBody,
      })).filter((r) => !/\.(js|css|png|jpe?g|svg|woff2?|ico|map|gif)(\?|$)/.test(r.url) && !/cnzz|u-meng|umeng|alicdn/.test(r.url)),
    };
    writeFileSync(OUT, JSON.stringify(out, null, 1));
    console.log("SAVED", OUT, "entries:", out.entries.length);
    process.exit(0);
  } catch (e) { console.log("ERR", e.message); process.exit(1); }
};
setTimeout(() => { console.log("GLOBAL TIMEOUT"); process.exit(1); }, 120000);
