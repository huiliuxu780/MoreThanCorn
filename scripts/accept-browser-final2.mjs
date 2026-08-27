import puppeteer from "puppeteer-core";
const BASE="http://localhost:5173"; const SHOT=(n)=>`/tmp/accept-evidence/${n}.png`;
const log=(...a)=>console.log("[f2]",...a); const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new",defaultViewport:{width:1500,height:1000}});
const p=await b.newPage(); p.on("pageerror",e=>log("PAGEERROR",String(e).slice(0,100)));
async function login(){ await p.goto(`${BASE}/config/result-rules`,{waitUntil:"networkidle2"}); await sleep(800);
  if(await p.$('input[placeholder="用户名"]')){ await p.type('input[placeholder="用户名"]',"admin"); await p.type('input[placeholder="密码"]',"admin");
    for(const x of await p.$$('[role="dialog"] button')){const t=await x.evaluate(e=>e.textContent.trim()); if(t==="登录"){await x.click();break;}} await sleep(1000);} }
async function clickBtn(text){ for(const x of await p.$$("button")){ const t=await x.evaluate(e=>e.textContent); if(t.includes(text)){ if(!(await x.evaluate(e=>e.disabled))){await x.click(); return true;}}} return false; }
async function clickDialogBtn(text){ for(const x of await p.$$('[role="dialog"] button')){ const t=await x.evaluate(e=>e.textContent); if(t.includes(text)){ if(!(await x.evaluate(e=>e.disabled))){await x.click(); return true;}}} return false; }
async function kbSelect(triggerMatch, typeChar){ for(const x of await p.$$("button")){ const t=await x.evaluate(e=>e.textContent); if(t.includes(triggerMatch)){ await x.click(); break; } } await sleep(400); await p.keyboard.press(typeChar); await sleep(300); await p.keyboard.press("Enter"); await sleep(400); }
async function fillLabel(label,val){ for(const l of await p.$$("label")){ const t=await l.evaluate(e=>e.textContent.trim()); if(t.replace("*","").trim().startsWith(label)){ const inp=await p.evaluateHandle((el)=>el.closest("div").querySelector("input"),l); if(inp.asElement()){await inp.asElement().click({clickCount:3}); await inp.asElement().type(val); return true;}}} return false; }
await login();
// ---- Rule publish (open r4-rule row) ----
const row = await p.evaluate(()=>{ const r=[...document.querySelectorAll("table tbody tr, a, [role=button], div")].find(x=>x.textContent.includes("r4-rule")&&x.textContent.length<300); if(r){r.click();return true;} return false;});
log("open rule editor:", row); await sleep(1200);
log("rule 发布(open):", await clickBtn("发布")); await sleep(600);
log("rule 发布(dialog confirm):", await clickDialogBtn("发布") || await clickDialogBtn("确认")); await sleep(1500);
await p.screenshot({path:SHOT("j1-rule-published")});
// ---- Task ----
await p.goto(`${BASE}/config/tasks/new`,{waitUntil:"networkidle2"}); await sleep(1000);
log("task name:", await fillLabel("任务名称","r4-task") || await fillLabel("名称","r4-task"));
log("wf:", await kbSelect("选择 Evaluation Agent","r"));
log("def:", await kbSelect("选择 Data Definition","r"));
log("ruleset:", await kbSelect("选择规则集","r"));
await p.screenshot({path:SHOT("j2-task-form")});
log("task 创建并启用:", await clickBtn("创建并启用")); await sleep(1800);
log("url:", p.url());
await p.screenshot({path:SHOT("j3-task-created")});
await b.close(); log("done");
