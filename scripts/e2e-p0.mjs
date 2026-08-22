// P0 e2e: create -> add node -> connect -> configure -> autosave -> reload -> checklist
import { writeFileSync } from "node:fs";
const BASE = "http://127.0.0.1:9222";
const APP = "http://localhost:5173/config/agents";
const SHOT = "/tmp/qE2E";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const created = await (await fetch(`${BASE}/json/new?${encodeURIComponent(APP)}`, { method: "PUT" })).json();
await sleep(5000);
let wsUrl = created.webSocketDebuggerUrl;
if (!wsUrl) { const lst = await (await fetch(`${BASE}/json/list`)).json(); wsUrl = lst.find(t => t.id === created.id)?.webSocketDebuggerUrl; }
const ws = new WebSocket(wsUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => rej(new Error("to:" + m)), 15000); });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise(r => (ws.onopen = r));
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(3000);
const ev = e => send("Runtime.evaluate", { expression: e, returnByValue: true }).then(m => m.result?.result?.value);
const evA = e => send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }).then(m => m.result?.result?.value);
const click = (x, y) => send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }).then(() => sleep(60)).then(() => send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }));
const type = t => send("Input.insertText", { text: t });
const shot = n => send("Page.captureScreenshot", { format: "png" }).then(m => writeFileSync(`${SHOT}-${n}.png`, Buffer.from(m.result.data, "base64")));
const log = (...a) => console.log(...a);
const F = `function findT(text){const vis=e=>e.offsetParent!==null;for(const sel of ['button','input','div','span']){for(const e of [...document.querySelectorAll(sel)].filter(vis)){if((e.innerText||e.placeholder||'').trim()===text){const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}}}return null}`;
await sleep(2000);
// 1 create
let p = await ev(`${F};findT('创建Agent')`); log("create-btn", !!p);
if (p) { await click(p.x, p.y); await sleep(800); }
let ni = await ev(`${F};findT('名称（必填）')`);
if (ni) { await click(ni.x, ni.y); await type("P0-E2E"); await sleep(300); }
let cb = await ev(`${F};findT('创建')`);
if (cb) { await click(cb.x, cb.y); await sleep(2500); }
log("url", await ev("location.href"));
await shot("1-designer");
log("nodes", await ev("document.querySelectorAll('.react-flow__node').length"));
// 2 add LLM
p = await ev(`${F};findT('添加节点')`); if (p) { await click(p.x, p.y); await sleep(800); }
let added = await ev(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.offsetParent&&(b.innerText||'').replace(/\\s+/g,'').endsWith('大模型'));if(e){e.click();return true}return false})()`);
log("palette-add-llm", added); await sleep(1200);
if (!(await ev("document.querySelectorAll('.react-flow__node').length") > 2)) { const p2 = await ev(`${F};findT('添加节点')`); if (p2) { await click(p2.x, p2.y); await sleep(800); } await ev(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.offsetParent&&(b.innerText||'').replace(/\\s+/g,'').endsWith('大模型'));if(e){e.click();return true}return false})()`); await sleep(1200); }
log("nodes-after-add", await ev("document.querySelectorAll('.react-flow__node').length"));
// validation badge before configure
log("issues-before", await ev("fetch('http://127.0.0.1:8100/api/workflows/'+location.pathname.split('/').pop()+'/validation').then(r=>r.json()).then(j=>j.issues.length)"));
// 3 connect
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});await sleep(500);
let geo = "{}";
for (let i = 0; i < 6; i++) { geo = await ev(`(()=>{const out={};for(const n of document.querySelectorAll('.react-flow__node')){const t=n.innerText||'';const k=t.includes('开始')?'开始':t.includes('大模型')?'大模型':t.includes('结束')?'结束':null;if(!k)continue;const r=n.getBoundingClientRect();out[k]={l:{x:r.x+2,y:r.y+r.height/2},r:{x:r.x+r.width-2,y:r.y+r.height/2}}}return JSON.stringify(out)})()`); if (Object.keys(JSON.parse(geo)).length >= 3) break; await sleep(600); }
const G = JSON.parse(geo); log("geo", Object.keys(G));
const drag = async (a, b) => { await send("Input.dispatchMouseEvent", { type: "mousePressed", x: a.x, y: a.y, button: "left", clickCount: 1 }); for (let i = 1; i <= 8; i++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8, button: "left" }); await sleep(40); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 }); };
const edgeCount = () => ev("document.querySelectorAll('.react-flow__edge').length");
const handles = async () => JSON.parse(await ev(`(()=>{const out=[];for(const n of document.querySelectorAll('.react-flow__node')){const t=n.innerText||'';const k=t.includes('开始')?'开始':t.includes('大模型')?'大模型':t.includes('结束')?'结束':null;if(!k)continue;for(const h of n.querySelectorAll('.react-flow__handle')){const r=h.getBoundingClientRect();out.push({k,t:h.classList.contains('source')?'s':'t',x:r.x+r.width/2,y:r.y+r.height/2})}}return JSON.stringify(out)})()`));
const tryDrag = async (fromK, toK) => { const before = await edgeCount(); for (let a = 0; a < 3; a++) { const hs = await handles(); const f = hs.find(h => h.k === fromK && h.t === 's'); const t2 = hs.find(h => h.k === toK && h.t === 't'); if (!f || !t2) break; await drag({x:f.x,y:f.y}, {x:t2.x,y:t2.y}); await sleep(700); if ((await edgeCount()) > before) break; } };
await tryDrag("开始", "大模型");
await tryDrag("大模型", "结束");
log("edges", await edgeCount());
await shot("2-connected");
// 4 configure LLM: click node
if (G["大模型"]) { await click(G["大模型"].l.x + 60, G["大模型"].l.y - 20); await sleep(1000); }
let mt = await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent&&(b.innerText||'').includes('请选择模型'));if(b){b.click();return true}return false})()`);
await sleep(800);
let mo = await ev(`(()=>{const b=[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&/deepseek|qwen/i.test(b.innerText)).sort((a,b)=>a.getBoundingClientRect().y-b.getBoundingClientRect().y)[0];if(b){b.click();return b.innerText.slice(0,30)}return null})()`);
log("model-pick", mo);
let pt = await ev(`(()=>{const t=[...document.querySelectorAll('textarea')].find(t=>(t.placeholder||'').includes('请输入提示词'));if(!t)return null;const r=t.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+12}})()`);
log("prompt-input", !!pt);
if (pt) { await click(pt.x, pt.y); await type("你是质检助手。输入：{{n_start.outputs.userQuery}}"); await sleep(300); }
await shot("3-configured");
// close sheet by clicking canvas empty area
await click(700, 700); await sleep(3000); // autosave debounce
const wid = await ev("location.pathname.split('/').pop()");
log("issues-after", await evA(`(async()=>{const r=await fetch('http://127.0.0.1:8100/api/workflows/${wid}/validation');const j=await r.json();return JSON.stringify(j.issues)})()`));
// 6 trial run demo
const tr = await ev(`${F};findT('试运行')`); if (tr) { await click(tr.x, tr.y); await sleep(1200); }
await shot("5-debug-drawer");
const sr = await ev(`${F};findT('开始运行')`); if (sr) { await click(sr.x, sr.y); log("start-run", true); }
await sleep(1500); await shot("6-running");
await sleep(2500); await shot("7-run-done");
// 5 reload persistence
await send("Page.reload"); await sleep(4000);
log("nodes-after-reload", await ev("document.querySelectorAll('.react-flow__node').length"));
log("edges-after-reload", await ev("document.querySelectorAll('.react-flow__edge').length"));
await shot("4-reloaded");
process.exit(0);
