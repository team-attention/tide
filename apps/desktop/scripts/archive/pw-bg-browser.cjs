// Verify a Browser Pane stays alive offscreen after its thread goes background.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path=require("node:path"),os=require("node:os"),fs=require("node:fs");
const repo=path.resolve(__dirname,"..");
(async()=>{
 const dr=fs.mkdtempSync(path.join(os.tmpdir(),"tide-bg-"));
 spawnSync("node",[path.join(repo,"scripts/seed-thread.cjs"),dr],{cwd:repo,stdio:"ignore"});
 const app=await _electron.launch({args:[path.join(repo,"out/main/electron-main.js")],env:{...process.env,TIDE_APP_DATA_ROOT:dr}});
 const p=await app.firstWindow(); await p.waitForSelector(".tide-product-shell",{timeout:20000}); await p.waitForTimeout(700);
 await p.locator(".thread-row__main").first().click(); await p.waitForTimeout(800);
 await p.locator('[aria-label="Open Workbench"]').first().click().catch(()=>{}); await p.waitForTimeout(400);
 await p.locator('[data-launcher-action="open_browser"]').first().click().catch(()=>{}); await p.waitForTimeout(400);
 await p.locator(".workbench-browser-bar__input").first().fill("https://example.com");
 await p.locator(".workbench-browser-bar__go").first().click();
 await p.waitForTimeout(3000);
 const fg = await p.evaluate(()=>{const w=document.querySelectorAll(".workbench-browser-webview").length;const b=document.querySelectorAll(".background-browser-host__webview").length;return{fg:w,bg:b};});
 console.log("BEFORE switch:", JSON.stringify(fg));
 // Switch away -> seeded thread becomes background
 await p.getByText("New thread",{exact:false}).first().click();
 await p.waitForTimeout(1500);
 const after = await p.evaluate(()=>{
   const fgN=document.querySelectorAll(".workbench-browser-webview").length;
   const bgEls=[...document.querySelectorAll(".background-browser-host__webview")];
   const urls=bgEls.map(w=> typeof w.getURL==="function"? w.getURL():null);
   return {fg:fgN, bg:bgEls.length, bgUrls:urls};
 });
 console.log("AFTER switch:", JSON.stringify(after));
 await app.close();
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
