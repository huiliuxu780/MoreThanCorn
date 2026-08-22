// v7d: DOM-derived coordinates for drawer config + run
import { writeFileSync } from "node:fs";
const OUT = "/Users/rivers/MoreThanCorn/docs/research/lightweight-workflow-system/evidence/network/quickservice-capture-v7-sanitized.json";
const SHOT = "/tmp/q7i";
const BASE = "http://127.0.0.1:9222";
const SENS = /cookie|authorization|proxy-authorization|token|secret|api[-_]?key|password|passwd|phone|mobile|idcard|identity|session|credential/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g, PHONE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const maskStr = s => typeof s === "string" ? s.replace(EMAIL, "***@***").replace(PHONE, "1**********") : s;
const cleanObj = o => Array.isArray(o) ? o.map(cleanObj) : (o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, SENS.test(k) ? "***" : cleanObj(v)])) : maskStr(o));
const cleanBody = t => { try { return cleanObj(JSON.parse(t)); } catch { return maskStr(String(t)).slice(0, 200000); } };
const t0 = Date.now(); const steps = []; const conns = [];
const log = (s, i) => steps.push({ t: Date.now() - t0, step: s, info: String(i).slice(0, 220) });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function attach(match) {
  const targets = await (await fetch(`${BASE}/json/list`)).json();
  const target = targets.find(t => t.type === "page" && match(t.url || ""));
  if (!target) return null;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const reqs = new Map(); let mid = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => rej(new Error("timeout:" + method)), 15000); });
  ws.onmessage = async ev => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Network.requestWillBeSent") { const r = m.params.request; reqs.set(m.params.requestId, { dt: Date.now() - t0, method: r.method, url: r.url, postData: r.postData ? cleanBody(r.postData) : undefined, type: m.params.type }); }
    else if (m.method === "Network.responseReceived") { const rec = reqs.get(m.params.requestId); if (rec) { rec.status = m.params.response.status; rec.mimeType = m.params.response.mimeType; } }
    else if (m.method === "Network.loadingFinished") { const rec = reqs.get(m.params.requestId); if (rec && /json|event-stream|text/.test(rec.mimeType || "")) { try { const b = await send("Network.getResponseBody", { requestId: m.params.requestId }); if (b.result?.body) rec.resBody = cleanBody(b.result.body); } catch {} } } };
  await new Promise(r => (ws.onopen = r));
  await send("Network.enable", { maxTotalBufferSize: 150 * 1024 * 1024 }); await send("Page.enable");
  const c = { ws, send, reqs, id: target.id }; conns.push(c); return c;
}
const ev = (c, e) => c.send("Runtime.evaluate", { expression: e, returnByValue: true }).then(m => m.result?.result?.value);
const FINDER = `function findR(text){const vis=e=>{try{return e.offsetParent!==null}catch{return false}};for(const sel of ['button','a','span','div']){for(const e of [...document.querySelectorAll(sel)].filter(vis)){if((e.innerText||'').trim()===text){const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}}}return null}`;
const click = (c, x, y) => c.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }).then(() => sleep(60)).then(() => c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }));
const dblclick = (c, x, y) => click(c, x, y).then(() => sleep(90)).then(() => click(c, x, y));
const shot = (c, n) => c.send("Page.captureScreenshot", { format: "png" }).then(m => { writeFileSync(`${SHOT}-${n}.png`, Buffer.from(m.result.data, "base64")); log("shot", n); });
const key = (c, k) => c.send("Input.dispatchKeyEvent", { type: "keyDown", key: k }).then(() => c.send("Input.dispatchKeyEvent", { type: "keyUp", key: k }));
const save = () => { const entries = []; for (const c of conns) for (const r of c.reqs.values()) if (!/\.(js|css|png|jpe?g|svg|woff2?|ico|map|gif)(\?|$)/.test(r.url) && !/cnzz|umeng|alicdn|alipay|aliyuncs|oss-cn/.test(r.url)) entries.push(r); writeFileSync(OUT, JSON.stringify({ capturedAt: new Date().toISOString(), total: entries.length, steps, entries }, null, 1)); writeFileSync("/tmp/q7i-steps.json", JSON.stringify(steps, null, 1)); };
(async () => {
  try {
    const c = await attach(u => /4878e602/.test(u));
    await sleep(4000); log("phase", "editor");
    const nr = await ev(c, `(()=>{const n=[...document.querySelectorAll('.react-flow__node')].find(n=>(n.innerText||'').includes('大模型'));if(!n)return null;const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+16}})()`);
    await dblclick(c, nr.x, nr.y); await sleep(1800);
    const ml = await ev(c, `(()=>{const e=[...document.querySelectorAll('div,span')].find(e=>e.offsetParent&&(e.innerText||'').trim()==='模型');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y}})()`);
    log("model-label", JSON.stringify(ml));
    if (ml) { await click(c, ml.x + 150, ml.y + 40); await sleep(1800); }
    const opts = await ev(c, `(()=>{const vis=e=>{try{return e.offsetParent!==null&&e.getBoundingClientRect().height>0}catch{return false}};const o=[...document.querySelectorAll('div,span,li')].filter(vis).filter(e=>{const t=(e.innerText||'').trim();return /^(Qwen|Deepseek)/.test(t)&&t.length<60});o.sort((a,b)=>a.getBoundingClientRect().y-b.getBoundingClientRect().y);return o.slice(0,2).map(e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,text:e.innerText.slice(0,30)}})})()`);
    log("model-opts", JSON.stringify(opts));
    if (opts && opts[0]) { await click(c, opts[0].x, opts[0].y); await sleep(1500); }
    const mval = await ev(c, `(()=>{const e=[...document.querySelectorAll('div,span')].find(e=>e.offsetParent&&(e.innerText||'').trim()==='模型');return e?e.parentElement.innerText.slice(0,40):null})()`);
    log("model-after", mval);
    const pr = await ev(c, `(()=>{const t=document.querySelector('[contenteditable=true]');if(!t)return null;const r=t.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+20}})()`);
    log("prompt", JSON.stringify(pr));
    if (pr) { await click(c, pr.x, pr.y); await sleep(300); await c.send("Input.insertText", { text: "你是测试助手，请对用户输入给出一句中文回复。用户输入：" }); await sleep(800); }
    await shot(c, "llm-configured");
    await key(c, "Escape"); await sleep(800);
    const er = await ev(c, `(()=>{const n=[...document.querySelectorAll('.react-flow__node')].find(n=>(n.innerText||'').includes('结束'));if(!n)return null;const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+16}})()`);
    log("end-rect", JSON.stringify(er));
    await dblclick(c, er.x, er.y); await sleep(1800);
    log("end-drawer", await ev(c, "document.body.innerText.includes('变量值')"));
    log("end-inputs", await ev(c, `[...document.querySelectorAll('input')].map(i=>i.placeholder).filter(Boolean).slice(0,8)`));
    const evi = await ev(c, `(()=>{const t=document.querySelector('[contenteditable=true]');if(!t)return null;const r=t.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+12}})()`);
    log("end-value-ce", JSON.stringify(evi));
    if (evi) { await click(c, evi.x, evi.y); await sleep(300); await c.send("Input.insertText", { text: "done" }); await sleep(600); }
    await key(c, "Escape"); await sleep(800);
    await shot(c, "configured");
    const rb = await ev(c, `${FINDER};findR('试运行')`);
    if (rb) { await click(c, rb.x, rb.y); log("run-click", "ok"); }
    await sleep(2500);
    const go = await ev(c, `${FINDER};findR('开始运行')`);
    log("start-run-btn", JSON.stringify(go));
    if (go) { await click(c, go.x, go.y); log("start-run", "clicked"); }
    await sleep(3000); await shot(c, "run-1");
    await sleep(5000); await shot(c, "run-2");
    await sleep(8000); await shot(c, "run-3");
    await sleep(10000); await shot(c, "run-4");
    save(); console.log("DONE", steps.length); process.exit(0);
  } catch (e) { console.log("ERR", e.message); save(); process.exit(1); }
})();
setTimeout(() => { console.log("GLOBAL TIMEOUT"); save(); process.exit(1); }, 240000);
