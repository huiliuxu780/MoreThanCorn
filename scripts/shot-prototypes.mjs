/** 渲染 Module Agent UI 原型截图（逐屏评审用）：v1 四帧 / v2 四 Tab+发布对话框 / v3 全页。 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/proto-shots";
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--window-size=1600,1200"],
  defaultViewport: { width: 1600, height: 1200 },
});

const shot = async (page, name) => {
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log("saved", name);
};

// ---- v1：四帧，逐帧元素截图 ----
{
  const page = await browser.newPage();
  await page.goto(`file:///Users/rivers/MoreThanCorn/uiux/prototypes/module-agent-r4-screens.html`);
  await new Promise((r) => setTimeout(r, 500));
  const frames = await page.$$(".frame");
  const names = ["v1-1-catalog", "v1-2-providers", "v1-3-rundetail", "v1-4-task-wizard"];
  for (let i = 0; i < frames.length && i < names.length; i++) {
    await frames[i].screenshot({ path: `${OUT}/${names[i]}.png` });
    console.log("saved", names[i]);
  }
  await page.close();
}

// ---- v2：四个 Tab + 发布对话框 ----
{
  const page = await browser.newPage();
  await page.goto(`file:///Users/rivers/MoreThanCorn/uiux/prototypes/module-agent-config.html`);
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, "v2-1-config-tab");
  for (const tab of ["runs", "versions", "eval"]) {
    await page.evaluate((t) => document.querySelector(`.tab[data-tab="${t}"]`).click(), tab);
    await shot(page, `v2-2-tab-${tab}`);
  }
  await page.evaluate(() => document.querySelector('.tab[data-tab="config"]').click());
  await page.evaluate(() => openPublish());
  await new Promise((r) => setTimeout(r, 400));
  const dlg = await page.$("#publishDlg .dialog");
  if (dlg) {
    await dlg.screenshot({ path: `${OUT}/v2-3-publish-dialog.png` });
    console.log("saved v2-3-publish-dialog");
  }
  await page.close();
}

// ---- v3：全页 ----
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1100 });
  await page.goto(`file:///Users/rivers/MoreThanCorn/uiux/prototypes/module-agent-config-v3.html`);
  await shot(page, "v3-config-page");
  await page.close();
}

await browser.close();
