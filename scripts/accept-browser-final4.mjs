import puppeteer from "puppeteer-core";
const BASE="http://localhost:5173"; const SHOT=(n)=>`/tmp/accept-evidence/${n}.png`;
const RULE="05dd2653f8c4451ea8ff158f4e9a059a";
const log=(...a)=>console.log("[f4]",...a); const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new",defaultViewport:{width:1500,height:1000}});
const p=await b.newPage(); p.on("pageerror",e=>log("PAGEERROR",String(e).slice(0,100)));
async function login(){ await p.goto(`${BASE}/config/result-rules`,{waitUntil:"networkidle2"}); await sleep(800);
  if(await p.$('input[placeholder="用户名"]')){ await p.type('input[placeholder="用户名"]',"admin"); await p.type('input[placeholder="密码"]',"admin");
    for(const x of await p.$$('[role="dialog"] button')){const t=await x.evaluate(e=>e.textContent.trim()); if(t==="登录"){await x.click();break;}} await sleep(1000);} }
async function clickBtn(text){ for(const x of await p.$$("button")){ const t=await x.evaluate(e=>e.textContent); if(t.includes(text)){ if(!(await x.evaluate(e=>e.disabled))){await x.click(); return true;}}} return false; }
async function clickDialogBtn(re){ for(const x of await p.$$('[role="dialog"] button')){ const t=await x.evaluate(e=>e.textContent); if(re.test(t)){ if(!(await x.evaluate(e=>e.disabled))){await x.click(); return true;}}} return false; }
async function fillLabel(label,val){ for(const l of await p.$$("label")){ const t=await l.evaluate(e=>e.textContent.trim()); if(t.replace("*","").trim().startsWith(label)){ const inp=await p.evaluateHandle((el)=>el.closest("div").querySelector("input"),l); if(inp.asElement()){await inp.asElement().click({clickCount:3}); await inp.asElement().type(val); return true;}}} return false; }
async function selectExact(triggerText, optionMatch){
  let trig=null; for(const x of await p.$$("button")){ const t=await x.evaluate(e=>e.textContent); if(t.includes(triggerText)){trig=x;break;} }
  if(!trig){ log("  trigger NF:",triggerText); return false; }
  const bb=await trig.boundingBox(); await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await sleep(500);
  const opts=await p.$$('[role="option"]'); const dump=[];
  for(const o of opts) dump.push((await o.evaluate(e=>e.textContent)).trim());
  log("  opts["+triggerText+"]:",JSON.stringify(dump));
  for(const o of opts){ const t=await o.evaluate(e=>e.textContent); if(t.includes(optionMatch)){ const ob=await o.boundingBox(); await p.mouse.click(ob.x+ob.width/2,ob.y+ob.height/2); await sleep(400); return true; } }
  await p.keyboard.press("Escape"); return false;
}
await login();
// Rule publish
await p.goto(`${BASE}/config/result-rules/${RULE}`,{waitUntil:"networkidle2"}); await sleep(1200);
log("rule 发布(open):", await clickBtn("发布")); await sleep(600);
log("rule 发布(confirm):", await clickDialogBtn(/发布|确认/)); await sleep(1500);
await p.screenshot({path:SHOT("m1-rule-published")});
// Task 4-step
await p.goto(`${BASE}/config/tasks/new`,{waitUntil:"networkidle2"}); await sleep(800); await p.reload({waitUntil:"networkidle2"}); await sleep(1200);
await fillLabel("任务名称","r5-task");
log("wf:", await selectExact("选择 Evaluation Agent","r4-wf"));
log("step1->2:", await clickBtn("下一步")); await sleep(700);
log("def:", await selectExact("选择 Data Definition","r4-def"));
await p.screenshot({path:SHOT("m2-step2")});
log("step2->3:", await clickBtn("下一步")); await sleep(700);
log("ruleset:", await selectExact("选择规则集","r4-rule"));
await p.screenshot({path:SHOT("m3-step3")});
log("step3->4:", await clickBtn("下一步")); await sleep(700);
await p.screenshot({path:SHOT("m4-step4")});
log("创建并启用:", await clickBtn("创建并启用")); await sleep(1800);
log("url:", p.url());
await p.screenshot({path:SHOT("m5-task-created")});
await b.close(); log("done");
