const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path=require("node:path"),os=require("node:os"),fs=require("node:fs");
const repo=path.resolve(__dirname,"..");
(async()=>{
 const dr=fs.mkdtempSync(path.join(os.tmpdir(),"tide-ep-"));
 spawnSync("node",[path.join(repo,"scripts/seed-thread.cjs"),dr],{cwd:repo,stdio:"ignore"});
 const app=await _electron.launch({args:[path.join(repo,"out/main/electron-main.js")],env:{...process.env,TIDE_APP_DATA_ROOT:dr}});
 const p=await app.firstWindow(); await p.waitForSelector(".tide-product-shell",{timeout:20000}); await p.waitForTimeout(700);
 await p.locator(".thread-row__main").first().click(); await p.waitForTimeout(800);
 await p.locator('[aria-label="Open Workbench"]').first().click().catch(()=>{}); await p.waitForTimeout(500);
 await p.locator('[data-launcher-action="open_editor"]').first().click().catch(e=>console.log("click",e.message));
 await p.waitForTimeout(2500);
 const hasPicker = await p.locator('.editor-picker').count();
 const rows = await p.locator('.editor-picker__row').count();
 const ftColOpen = await p.locator('.file-tree-column').count();
 console.log("picker shown:", hasPicker, "| file rows:", rows, "| filetree column open:", ftColOpen);
 await p.screenshot({ path: "/tmp/pw-editor-picker.png" });
 // type a filter
 await p.locator('.editor-picker__input').first().fill("package");
 await p.waitForTimeout(500);
 const filtered = await p.locator('.editor-picker__row').count();
 const names = await p.locator('.editor-picker__name').allTextContents();
 console.log("after filter 'package': rows:", filtered, "| names:", JSON.stringify(names.slice(0,5)));
 await app.close();
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
