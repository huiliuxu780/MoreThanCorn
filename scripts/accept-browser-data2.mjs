import puppeteer from "puppeteer-core";
const BASE="http://localhost:5173"; const SHOT=(n)=>`/tmp/accept-evidence/${n}.png`;
const log=(...a)=>console.log("[d2]",...a); const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new",defaultViewport:{width:1500,height:1000}});
const p=await b.newPage(); p.on("pageerror",e=>log("PAGEERROR",String(e).slice(0,100)));
async function login(){ await p.goto(`${BASE}/config/data-resources`,{waitUntil:"networkidle2"}); await sleep(800);
  if(await p.$('input[placeholder="用户名"]')){ await p.type('input[placeholder="用户名"]',"admin"); await p.type('input[placeholder="密码"]',"admin");
    for(const x of await p.$$('[role="dialog"] button')){const t=await x.evaluate(e=>e.textContent.trim()); if(t==="登录"){await x.click();break;}} await sleep(1000);} }
async function fillPh(ph,val){ const h=await p.$(`input[placeholder="${ph}"]`); if(h){await h.click({clickCount:3}); await h.type(val); return true;} return false; }
async function fillLabel(label,val){ for(const l of await p.$$("label")){ const t=await l.evaluate(e=>e.textContent.trim()); if(t.startsWith(label)){ const inp=await p.evaluateHandle((el)=>el.closest("div").querySelector("input"),l); if(inp.asElement()){await inp.asElement().click({clickCount:3}); await inp.asElement().type(val); return true;}}} return false; }
async function clickBtn(text){ for(const x of await p.$$("button")){ const t=await x.evaluate(e=>e.textContent); if(t.includes(text)){ if(!(await x.evaluate(e=>e.disabled))){await x.click(); return true;}}} return false; }
async function kbSelect(triggerMatch, typeChar){ for(const x of await p.$$("button")){ const t=await x.evaluate(e=>e.textContent); if(t.includes(triggerMatch)){ await x.click(); break; } } await sleep(400); await p.keyboard.press(typeChar); await sleep(300); await p.keyboard.press("Enter"); await sleep(400); }
await login();
// Datasource
await p.goto(`${BASE}/config/data-resources/new`,{waitUntil:"networkidle2"}); await sleep(900);
await clickBtn("下一步"); await sleep(500);
await fillLabel("名称","r3-ds");
await kbSelect("MySQL","p");            // 类型 -> PostgreSQL (typeahead p)
await kbSelect("选择 Connection","r");  // conn -> r3-pg
await fillPh("db_cc","wf_accept");
await p.screenshot({path:SHOT("h1-ds")});
log("ds 下一步:", await clickBtn("下一步")); await sleep(600);
log("ds 执行测试:", await clickBtn("执行测试")); await sleep(2500);
await p.screenshot({path:SHOT("h2-ds-test")});
log("ds 保存并启用:", await clickBtn("保存并启用")); await sleep(900);
// Asset
await p.goto(`${BASE}/config/data-resources/new`,{waitUntil:"networkidle2"}); await sleep(900);
for(const x of await p.$$("button")){ const t=await x.evaluate(e=>e.textContent); if(/Data Asset/.test(t)){await x.click();break;} }
await sleep(400); await clickBtn("下一步"); await sleep(500);
await fillLabel("名称","r3-asset");
await kbSelect("选择数据源","r") || await kbSelect("选择 Datasource","r");
await fillPh("t_call_session","accept_input");
await fillPh("interactionTime","interactionTime");
await fillPh("interactionId","interactionId");
await p.screenshot({path:SHOT("h3-asset")});
log("asset 下一步:", await clickBtn("下一步")); await sleep(600);
log("asset 执行测试:", await clickBtn("执行测试")); await sleep(2500);
await p.screenshot({path:SHOT("h4-asset-test")});
log("asset 保存并启用:", await clickBtn("保存并启用")); await sleep(900);
await b.close(); log("done");
