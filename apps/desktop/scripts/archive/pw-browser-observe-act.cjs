// Verify the renderer primitives that tide_observe_browser / tide_act_browser rely on:
// the workbench <webview> can be read (observe) and scripted (act) from the host page.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path=require("node:path"),os=require("node:os"),fs=require("node:fs");
const repo=path.resolve(__dirname,"..");
(async()=>{
 const dr=fs.mkdtempSync(path.join(os.tmpdir(),"tide-oa-"));
 spawnSync("node",[path.join(repo,"scripts/seed-thread.cjs"),dr],{cwd:repo,stdio:"ignore"});
 const app=await _electron.launch({args:[path.join(repo,"out/main/electron-main.js")],env:{...process.env,TIDE_APP_DATA_ROOT:dr}});
 const p=await app.firstWindow(); await p.waitForSelector(".tide-product-shell",{timeout:20000}); await p.waitForTimeout(700);
 await p.locator(".thread-row__main").first().click(); await p.waitForTimeout(800);
 await p.locator('[aria-label="Open Workbench"]').first().click().catch(()=>{}); await p.waitForTimeout(500);
 await p.locator('[data-launcher-action="open_browser"]').first().click().catch(()=>{}); await p.waitForTimeout(500);
 const bar=p.locator(".workbench-browser-bar__input").first();
 await bar.fill("https://example.com"); await p.locator(".workbench-browser-bar__go").first().click();
 await p.waitForTimeout(3500);

 // OBSERVE: read the page body text via the webview (what readBrowserWebViewSnapshot does)
 const observed = await p.evaluate(async () => {
   const wv = document.querySelector(".workbench-browser-webview");
   if (!wv || !wv.executeJavaScript) return { ok:false };
   const text = await wv.executeJavaScript("document.body.innerText");
   const title = await wv.executeJavaScript("document.title");
   return { ok:true, title, sample: String(text).slice(0,60).replace(/\n/g," ") };
 });
 console.log("OBSERVE:", JSON.stringify(observed));

 // ACT: click the "More information..." link via the webview (what executeBrowserWebViewAction does)
 await p.evaluate(async () => {
   const wv = document.querySelector(".workbench-browser-webview");
   await wv.executeJavaScript(`(()=>{const a=document.querySelector('a');a&&a.click();return !!a;})()`);
 });
 await p.waitForTimeout(3500);
 const afterUrl = await p.evaluate(() => {
   const wv = document.querySelector(".workbench-browser-webview");
   return typeof wv.getURL === "function" ? wv.getURL() : null;
 });
 console.log("ACT navigated to:", afterUrl);
 await app.close();
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
