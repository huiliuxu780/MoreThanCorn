// 16-ui-replication-spec §10 验收 e2e（CDP 打用户 Chrome :9222 → localhost:5173）
import { writeFileSync } from "node:fs";
const BASE = "http://127.0.0.1:9222";
const LIST = "http://localhost:5173/config/agents";
const WF_LLM = "b2cf2b81d85b43e8bd386d48bd996c72";   // start+end+llm
const WF_COND = "4aaac0f1b549490f925e67bd0f1bd811";  // start+end+condition(未连接)
const SHOT = "/tmp/qR";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const created = await (await fetch(`${BASE}/json/new?${encodeURIComponent(LIST)}`, { method: "PUT" })).json();
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
const shot = n => send("Page.captureScreenshot", { format: "png" }).then(m => writeFileSync(`${SHOT}-${n}.png`, Buffer.from(m.result.data, "base64")));
const log = (...a) => console.log(...a);
const F = `function findT(text){const vis=e=>e.offsetParent!==null;for(const sel of ['button','input','div','span']){for(const e of [...document.querySelectorAll(sel)].filter(vis)){if((e.innerText||e.placeholder||'').trim()===text){const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}}}return null}`;
const FT = `function findTitle(t){const e=document.querySelector('[title=\"'+t+'\"]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}`;
const NODE = `function nodeBox(name){const n=[...document.querySelectorAll('.react-flow__node')].find(n=>(n.innerText||'').includes(name));if(!n)return null;const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}`;
const drag = async (a, b) => { await send("Input.dispatchMouseEvent", { type: "mousePressed", x: a.x, y: a.y, button: "left", clickCount: 1 }); for (let i = 1; i <= 8; i++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8, button: "left" }); await sleep(40); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 }); };

await sleep(2000);
// ---- 15 列表卡 ----
await shot("00-list");
log("list-cards", await ev("document.querySelectorAll('.grid button').length"));

// ---- 进入 #2（LLM） ----
await send("Page.navigate", { url: `${LIST}/${WF_LLM}` }); await sleep(4000);
// 1 顶栏 + 自动保存时间
log("topbar", await ev(`document.body.innerText.includes('自动保存于') && document.body.innerText.includes('待发布')`));
const t0 = await ev(`document.body.innerText.match(/自动保存于[^·]*/)?.[0]`);
await shot("01-editor");
// 2 节点卡（行/chip/未配置灰在 #1 更明显，这里看 LLM 已配置）
// 4 工具条 8 控件
log("toolbar", await ev(`['添加节点','缩略图','优化布局','适应画布','节点搜索','试运行'].every(t=>document.body.innerText.includes(t)) || !!document.querySelector('[title=\"缩略图\"]')`));
// 3 收起 ∨
let nb = await ev(`${NODE};JSON.stringify(nodeBox('大模型'))`); nb = JSON.parse(nb);
if (nb) {
  const chev = await ev(`(()=>{const n=[...document.querySelectorAll('.react-flow__node')].find(n=>(n.innerText||'').includes('大模型'));const bs=n.querySelectorAll('button');const r=bs[bs.length-1].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await click(chev.x, chev.y); await sleep(600); await shot("02-collapsed");
  await click(chev.x, chev.y); await sleep(400);
}
// 5 缩略图开关
let mm0 = await ev("!!document.querySelector('.react-flow__minimap')");
let tb = await ev(`${FT};JSON.stringify(findTitle('缩略图'))`); tb = JSON.parse(tb);
await click(tb.x, tb.y); await sleep(600);
let mm1 = await ev("!!document.querySelector('.react-flow__minimap')");
log("minimap-toggle", mm0, "->", mm1); await shot("03-minimap-off");
await click(tb.x, tb.y); await sleep(400);
// 6 优化布局
let ol = await ev(`${FT};JSON.stringify(findTitle('优化布局'))`); ol = JSON.parse(ol);
await click(ol.x, ol.y); await sleep(800); await shot("04-layout");
// 7 节点搜索
let ns = await ev(`${FT};JSON.stringify(findTitle('节点搜索'))`); ns = JSON.parse(ns);
await click(ns.x, ns.y); await sleep(500);
await type("大模型"); await sleep(400); await shot("05-search");
let hit = await ev(`${F};JSON.stringify(findT('大模型'))`); hit = JSON.parse(hit);
if (hit) { await click(hit.x, hit.y); await sleep(800); }
await shot("06-search-located");
await click(500, 850); await sleep(400);
// 8 palette 分组
let an = await ev(`${F};JSON.stringify(findT('添加节点'))`); an = JSON.parse(an);
await click(an.x, an.y); await sleep(600); await shot("07-palette");
await click(500, 850); await sleep(400);
// 9 LLM 抽屉：模型下拉 + 提示词 # 级联
nb = await ev(`${NODE};JSON.stringify(nodeBox('大模型'))`); nb = JSON.parse(nb);
if (nb) { await click(nb.x + 80, nb.y + 16); await sleep(900); }
await shot("08-drawer-llm");
let mrow = await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/(deepseek|Qwen|GPT|请选择模型)/.test(b.innerText||'')&&b.closest('.absolute'));if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
if (mrow) { await click(mrow.x, mrow.y); await sleep(500); await shot("09-model-dropdown"); await click(mrow.x, mrow.y + 40); await sleep(400); }
let pt = await ev(`(()=>{const t=[...document.querySelectorAll('textarea')].find(t=>(t.placeholder||'').includes('提示词'));if(!t)return null;const r=t.getBoundingClientRect();return {x:r.x+20,y:r.y+12}})()`);
if (pt) { await click(pt.x, pt.y); await type("#"); await sleep(500); await shot("10-hash-cascader"); await click(500, 850); await sleep(400); }
// 连线 start->llm（补全校验）并观察自动保存时间刷新
let geo = await ev(`(()=>{const out={};for(const n of document.querySelectorAll('.react-flow__node')){const t=n.innerText||'';const k=t.includes('开始')?'开始':t.includes('大模型')?'大模型':null;if(!k)continue;const r=n.getBoundingClientRect();out[k]={l:{x:r.x+2,y:r.y+r.height/2},r:{x:r.x+r.width-2,y:r.y+r.height/2}}}return JSON.stringify(out)})()`);
geo = JSON.parse(geo);
if (geo["开始"] && geo["大模型"]) { await drag(geo["开始"].r, geo["大模型"].l); await sleep(2500); }
const t1 = await ev(`document.body.innerText.match(/自动保存于[^·]*/)?.[0]`);
log("autosave-refresh", JSON.stringify(t0), "->", JSON.stringify(t1));
// 11 调试配置 + demo 环 + 12 成功 toast
let tr = await ev(`${F};JSON.stringify(findT('试运行'))`); tr = JSON.parse(tr);
await click(tr.x, tr.y); await sleep(800); await shot("11-debug-drawer");
let sr = await ev(`${F};JSON.stringify(findT('开始运行'))`); sr = JSON.parse(sr);
await click(sr.x, sr.y); await sleep(900); await shot("12-running");
await sleep(2200); await shot("13-success-toast");
// 14 历史空态
let hb = await ev(`${FT};JSON.stringify(findTitle('历史版本'))`); hb = JSON.parse(hb);
await click(hb.x, hb.y); await sleep(700); await shot("14-history");

// ---- 进入 #1（condition，issues>0） ----
await send("Page.navigate", { url: `${LIST}/${WF_COND}` }); await sleep(4000);
await shot("15-editor-issues");
// 检查红点 popover + 定位
let ck = await ev(`${FT};JSON.stringify(findTitle('检查'))`); ck = JSON.parse(ck);
await click(ck.x, ck.y); await sleep(600); await shot("16-check-popover");
let iss = await ev(`${F};JSON.stringify(findT('节点未连接完整'))`); iss = JSON.parse(iss);
if (iss) { await click(iss.x, iss.y); await sleep(900); await shot("17-locate-node"); }
// 10 条件分支三件套
let cb2 = await ev(`${NODE};JSON.stringify(nodeBox('条件判断'))`); cb2 = JSON.parse(cb2);
if (cb2) { await click(cb2.x + 80, cb2.y + 16); await sleep(900); }
await shot("18-condition-drawer");
// 12 红 toast：试运行→开始运行（校验不过）
tr = await ev(`${F};JSON.stringify(findT('试运行'))`); tr = JSON.parse(tr);
await click(tr.x, tr.y); await sleep(700);
sr = await ev(`${F};JSON.stringify(findT('开始运行'))`); sr = JSON.parse(sr);
if (sr) { await click(sr.x, sr.y); await sleep(700); }
await shot("19-red-toast");
// 13 发布模态三按钮
let pb = await ev(`${F};JSON.stringify(findT('发布'))`); pb = JSON.parse(pb);
await click(pb.x, pb.y); await sleep(700); await shot("20-publish-modal");
let cc = await ev(`${F};JSON.stringify(findT('取消'))`); cc = JSON.parse(cc);
if (cc) { await click(cc.x, cc.y); await sleep(400); }
log("done");
process.exit(0);
