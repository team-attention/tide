// Verifies block persistence across a restart: seed a claude thread, send one
// read-only prompt, wait for the answer, CLOSE the app, relaunch against the
// SAME data dir, reopen the thread, and confirm the conversation is restored.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = require("path").resolve(__dirname, "..");
const PROMPT = "Without using any tools, reply with exactly: PERSIST_OK";

async function launch(dataRoot) {
  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1000);
  return { app, page };
}

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-restart-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot, "claude"], { cwd: repo, stdio: "inherit" });

  // --- Session 1: send + get answer (persists blocks) ---
  let { app, page } = await launch(dataRoot);
  await page.locator(".thread-row__main").first().click();
  await page.waitForTimeout(1000);
  await page.locator('[aria-label="Composer draft"]').first().fill(PROMPT);
  await page.locator(".composer-shell__send").first().click();
  const deadline = Date.now() + 120000;
  let answered = false;
  while (Date.now() < deadline) {
    const txt = await page.locator('[data-block-role="agent"]').last().innerText().catch(() => "");
    if (txt.includes("PERSIST_OK")) { answered = true; break; }
    await page.waitForTimeout(2500);
  }
  const blocksBefore = await page.locator("[data-block-id]").count();
  console.log("session1 answered?", answered, "blocks:", blocksBefore);
  await app.close();
  await new Promise((r) => setTimeout(r, 1500));

  // --- Session 2: relaunch same data dir, reopen, expect restored blocks ---
  ({ app, page } = await launch(dataRoot));
  const rows = page.locator(".thread-row__main");
  console.log("session2 thread rows:", await rows.count());
  await rows.first().click();
  await page.waitForTimeout(1500);
  const blocksAfter = await page.locator("[data-block-id]").count();
  const restoredText = await page
    .locator('[data-block-role="agent"]').last().innerText().catch(() => "");
  console.log("session2 restored blocks:", blocksAfter);
  console.log("restored answer present?", restoredText.includes("PERSIST_OK"));
  await page.screenshot({ path: "/tmp/pw-restart.png" });
  await app.close();
  console.log("RESTART PERSISTENCE OK?", blocksAfter >= blocksBefore && blocksBefore > 0);
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
