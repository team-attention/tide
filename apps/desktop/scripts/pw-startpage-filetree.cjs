// On the New Thread (start) page, opening the file tree should show the composer's
// selected project's files. We seed a project scope by opening a thread's project,
// then start a New thread (keeps the project scope) and open the file tree.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path=require("node:path"),os=require("node:os"),fs=require("node:fs");
const repo=path.resolve(__dirname,"..");
(async()=>{
 const dr=fs.mkdtempSync(path.join(os.tmpdir(),"tide-sp-"));
 spawnSync("node",[path.join(repo,"scripts/seed-thread.cjs"),dr],{cwd:repo,stdio:"ignore"});
 const app=await _electron.launch({args:[path.join(repo,"out/main/electron-main.js")],env:{...process.env,TIDE_APP_DATA_ROOT:dr}});
 const p=await app.firstWindow(); await p.waitForSelector(".tide-product-shell",{timeout:20000}); await p.waitForTimeout(700);
 // Open the seeded thread to register its project scope (tide repo), then go to New thread.
 await p.locator(".thread-row__main").first().click(); await p.waitForTimeout(700);
 await p.getByText("New thread",{exact:false}).first().click(); await p.waitForTimeout(600);
 const active = await p.evaluate(()=>document.querySelector('.column-top-row__title')?.textContent);
 console.log("active title (should be New Thread):", JSON.stringify(active));
 // Open the file tree on the start page.
 await p.locator('[aria-label="Open FileTree"]').first().click().catch(e=>console.log("ftErr",e.message));
 await p.waitForTimeout(2500);
 const rows = await p.locator('.file-tree-row').count();
 const names = await p.locator('.file-tree-row span').allTextContents();
 console.log("file tree rows on start page:", rows, "| sample:", JSON.stringify(names.slice(0,8)));
 await app.close();
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
