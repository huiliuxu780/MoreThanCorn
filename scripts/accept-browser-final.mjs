import puppeteer from "puppeteer-core";
const BASE="http://localhost:5173"; const SHOT=(n)=>`/tmp/accept-evidence/${n}.png`;
const log=(...a)=>console.log("[fin]",...a); const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new",defaultViewport:{width:1500,height:1000}});
const p=await b.newPage(); p.on("pageerror",e=>log("PAGEERROR",String(e).slice(0,100)));
async function login(){ await p.goto(`${BASE}/config/result-rules`,{waitUntil:"networkidle2"}); await sleep(800);
  if(await p.$('input[placeholder="用户名"]')){ await p.type('input[placeholder="用户名"]',"admin"); await p.type('input[placeholder="密码"]',"admin");
    for(const x of await p.$$('[role="dialog"] button')){const t=await x.evaluate(e=>e.textContent.trim()); if(t==="登录"){await x.click();break;}} await sleep(1000);} }
async function clickBtn(text){ for(const x of await p.$$("button")){ const t=await x.evaluate(e=>e.textContent); if(t.includes(text)){ if(!(await x.evaluate(e=>e.disabled))){await x.click(); return true;}}} return false; }
async function fillDialogInput(ph,val){ const h=await p.$(`[role="dialog"] input[placeholder="${ph}"]`)||await p.$(`input[placeholder="${ph}"]`); if(h){await h.click({clickCount:3}); await h.type(val); return true;} return false; }
async function fillLabel(label,val){ for(const l of await p.$$("label")){ const t=await l.evaluate(e=>e.textContent.trim()); if(t.replace("*","").trim().startsWith(label)){ const inp=await p.evaluateHandle((el)=>el.closest("div").querySelector("input"),l); if(inp.asElement()){await inp.asElement().click({clickCount:3}); await inp.asElement().type(val); return true;}}} return false; }
async function kbSelect(triggerMatch, typeChar){ for(const x of await p.$$("button")){ const t=await x.evaluate(e=>e.textContent); if(t.includes(triggerMatch)){ await x.click(); break; } } await sleep(400); await p.keyboard.press(typeChar); await sleep(300); await p.keyboard.press("Enter"); await sleep(400); }
await login();
// ---- Rule ----
log("rule 新建:", await clickBtn("新建结果规则")); await sleep(500);
log("rule name:", await fillDialogInput("","") || await fillLabel("名称","r4-rule"));
// dialog name input likely first input
await p.evaluate(()=>{ const d=document.querySelector('[role="dialog"]'); const i=d?.querySelector("input"); if(i){const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; s.call(i,"r4-rule"); i.dispatchEvent(new Event("input",{bubbles:true}));} });
await sleep(300);
log("rule 创建并编辑:", await clickBtn("创建并编辑")); await sleep(1200);
log("rule 发布:", await clickBtn("发布")); await sleep(600);
log("rule 发布确认:", await clickBtn("发布", ) ); await sleep(1200); // dialog confirm button also 发布/确认
await p.screenshot({path:SHOT("i1-rule-published")});
// ---- Task ----
await p.goto(`${BASE}/config/tasks/new`,{waitUntil:"networkidle2"}); await sleep(1000);
log("task name:", await fillLabel("任务名称","r4-task") || await fillLabel("名称","r4-task"));
await kbSelect("选择工作流","r");   // workflow r4-wf (auto-map mapping)
await kbSelect("选择数据资产","r"); // asset r3-asset
await kbSelect("选择定义版本","r") || await kbSelect("定义版本","r");
// rule: keep follow_latest (default) + ruleSet
await kbSelect("选择规则集","r");
await p.screenshot({path:SHOT("i2-task-form")});
log("task 提交:", await clickBtn("创建任务") || await clickBtn("提交") || await clickBtn("确认"));
await sleep(1500); await p.screenshot({path:SHOT("i3-task-created")});
log("url:", p.url());
await b.close(); log("done");
