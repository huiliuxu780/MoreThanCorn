// 复刻补验：# 级联（caret 末尾）/ palette 外点关闭 / 发布模态橙图标
import { writeFileSync } from "node:fs";
const BASE = "http://127.0.0.1:9222";
const WF_LLM = "b2cf2b81d85b43e8bd386d48bd996c72";
const WF_COND = "4aaac0f1b549490f925e67bd0f1bd811";
const SHOT = "/tmp/qR";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const created = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`http://localhost:5173/config/agents/${WF_LLM}`)}`, { method: "PUT" })).json();
await sleep(4000);
let wsUrl = created.webSocketDebuggerUrl;
if (!wsUrl) { const lst = await (await fetch(`${BASE}/json/list`)).json(); wsUrl = lst.find(t => t.id === created.id)?.webSocketDebuggerUrl; }
const ws = new WebSocket(wsUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => rej(new Error("to:" + m)), 20000); });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise(r => (ws.onopen = r));
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
const ev = e => send("Runtime.evaluate", { expression: e, returnByValue: true }).then(m => m.result?.result?.value);
const click = (x, y) => send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }).then(() => sleep(60)).then(() => send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }));
const type = t => send("Input.insertText", { text: t });
const key = k => send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: k, windowsVirtualKeyCode: k === "End" ? 35 : 0 });
const shot = n => send("Page.captureScreenshot", { format: "png" }).then(m => writeFileSync(`${SHOT}-${n}.png`, Buffer.from(m.result.data, "base64")));
const log = (...a) => console.log(...a);
const F = `function findT(text){const vis=e=>e.offsetParent!==null;for(const sel of ['button','input','div','span']){for(const e of [...document.querySelectorAll(sel)].filter(vis)){if((e.innerText||e.placeholder||'').trim()===text){const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}}}return null}`;
await sleep(2500);
// LLM 抽屉
let nb = await ev(`(()=>{const n=[...document.querySelectorAll('.react-flow__node')].find(n=>(n.innerText||'').includes('大模型'));if(!n)return null;const r=n.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y})})()`);
nb = JSON.parse(nb);
await click(nb.x + 80, nb.y + 16); await sleep(900);
// prompt 末尾输入 #
let pt = await ev(`(()=>{const t=[...document.querySelectorAll('textarea')].find(t=>(t.placeholder||'').includes('提示词'));if(!t)return null;const r=t.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`);
pt = JSON.parse(pt);
await click(pt.x, pt.y); await sleep(200);
await key("End"); await sleep(150);
await type("#"); await sleep(600);
await shot("21-hash-cascader");
log("cascader-open", await ev(`document.body.innerText.includes('开始') && !!([...document.querySelectorAll('div')].find(d=>d.className.includes&&String(d.className).includes('absolute')&&(d.innerText||'').startsWith('开始')))`) );
// 关闭级联与抽屉
await key("Escape"); await sleep(300);
await click(500, 300); await sleep(500);
// palette 外点关闭
let an = await ev(`${F};JSON.stringify(findT('添加节点'))`); an = JSON.parse(an);
await click(an.x, an.y); await sleep(600);
log("palette-open", await ev(`document.body.innerText.includes('边界')`));
await click(400, 300); await sleep(600);
log("palette-closed", await ev(`!document.body.innerText.includes('边界') || null`));
// 发布模态橙图标
await send("Page.navigate", { url: `http://localhost:5173/config/agents/${WF_COND}` }); await sleep(3500);
let pb = await ev(`${F};JSON.stringify(findT('发布'))`); pb = JSON.parse(pb);
await click(pb.x, pb.y); await sleep(700);
await shot("22-publish-modal");
let cc = await ev(`${F};JSON.stringify(findT('取消'))`); cc = JSON.parse(cc);
if (cc) await click(cc.x, cc.y);
log("done");
process.exit(0);
