import { writeFileSync } from "node:fs";
const BASE = "http://127.0.0.1:9222";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lst0 = await (await fetch(`${BASE}/json/list`)).json();
const t0 = lst0.find(t => t.type === "page" && /localhost:5173/.test(t.url || ""));
const ws = new WebSocket(t0.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise(r => (ws.onopen = r));
await send("Page.enable");
const ev = e => send("Runtime.evaluate", { expression: e, returnByValue: true }).then(m => m.result?.result?.value);
const click = (x, y) => send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }).then(() => sleep(60)).then(() => send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }));
const shot = n => send("Page.captureScreenshot", { format: "png" }).then(m => writeFileSync(`/tmp/qACC-${n}.png`, Buffer.from(m.result.data, "base64")));
const F = `function findT(text){const vis=e=>e.offsetParent!==null;for(const sel of ['button','input','div','span']){for(const e of [...document.querySelectorAll(sel)].filter(vis)){if((e.innerText||e.placeholder||'').trim()===text){const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}}}return null}`;
await send("Page.navigate", { url: "http://localhost:5173/config/agents" }); await sleep(3000);
await shot("1-list");
await send("Page.navigate", { url: "http://localhost:5173/config/agents/4ff0d5c570004437b3e5332fe0030f9d" }); await sleep(4000);
// collapse 开始 node chevron
const ch = await ev(`(()=>{const n=[...document.querySelectorAll('.react-flow__node')].find(n=>(n.innerText||'').includes('开始'));if(!n)return null;const b=n.querySelector('button');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
if (ch) { await click(ch.x, ch.y); await sleep(600); }
await shot("2-collapsed");
// minimap toggle
const mm = await ev(`${F};findT('')`) ; // noop
const mmb = await ev(`(()=>{const b=[...document.querySelectorAll('button[title]')].find(b=>b.title==='缩略图');if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
if (mmb) { await click(mmb.x, mmb.y); await sleep(600); }
await shot("3-minimap-off");
console.log("done");
process.exit(0);
