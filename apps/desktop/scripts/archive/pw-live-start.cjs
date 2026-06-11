// Reproduces the user's exact flow: fresh New Thread -> select Claude -> type ->
// send (thread.start), wait for a response. claude only (never codex).
const { _electron } = require("playwright");
const path = require("node:path"); const os = require("node:os"); const fs = require("node:fs");
const repo = require("path").resolve(__dirname, "..");
(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-start-"));
  const app = await _electron.launch({ args: [path.join(repo, "out/main/electron-main.js")], env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot } });
  const page = await app.firstWindow();
  const errs = [];
  page.on("pageerror", e => errs.push("PAGEERR " + e.message));
  page.on("console", m => { if (m.type()==="error") errs.push("CONSOLE.ERR " + m.text().slice(0,200)); });
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(800);
  // Select Claude agent (avoid codex spawn).
  await page.locator('.composer-shell__context-chip[data-context-kind="agent"]').first().click();
  await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
  await page.locator('[data-choice-surface="agent_menu"] .choice-surface__row', { hasText: "Claude Code" }).click();
  await page.waitForTimeout(400);
  await page.locator('[aria-label="Composer draft"]').first().fill("Without using any tools, reply with exactly: TIDE_START_OK");
  await page.locator(".composer-shell__send").first().click();
  console.log("sent (start path); waiting...");
  let answered = false, sawWorking = false;
  const deadline = Date.now() + 130000;
  while (Date.now() < deadline) {
    if (await page.locator('[data-working="true"]').count()) sawWorking = true;
    const agent = await page.locator('[data-block-role="agent"]').count();
    const setup = await page.locator("text=/provider setup|Trust|not ready/i").count();
    const txt = await page.locator('[data-block-role="agent"]').last().innerText().catch(()=> "");
    if (Math.round((deadline-Date.now())/1000)%10===0) console.log(`agent=${agent} working=${sawWorking} setup=${setup}`);
    if (txt.includes("TIDE_START_OK")) { answered = true; break; }
    if (await page.locator('[data-block-role="agent"]').count() > 0 && !(await page.locator('[data-working="true"]').count())) break;
    await page.waitForTimeout(2500);
  }
  const setup = await page.locator("text=/provider setup|Trust|not ready/i").count();
  console.log("answered:", answered, "| sawWorking:", sawWorking, "| setupSurface:", setup);
  console.log("errors:", JSON.stringify(errs.slice(0,5)));
  await page.screenshot({ path: "/tmp/pw-live-start.png" });
  await app.close();
  console.log("START PATH OK?", answered);
  console.log("DONE");
})().catch(e => { console.error("ERR", e); process.exit(1); });
