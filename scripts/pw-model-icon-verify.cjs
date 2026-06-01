const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path"); const os = require("node:os"); const fs = require("node:fs");
const repo = "/Users/eatnug/Workspace/tide";
(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-mi-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot, "codex"], { cwd: repo, stdio: "inherit" });
  const app = await _electron.launch({ args: [path.join(repo, "out/main/electron-main.js")], env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot } });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(900);
  // Agent chip uses the identity icon?
  const identityIcon = await page.locator('.composer-shell__context-chip[data-context-kind="agent"] .agent-identity-icon').count();
  // Model menu: Extra High present, no Speed?
  await page.locator('.composer-shell__choice-chip--model').first().click();
  await page.waitForSelector('[data-choice-surface="model_menu"]', { timeout: 5000 });
  const rows = await page.locator('[data-choice-surface="model_menu"] .choice-surface__row-label').allInnerTexts();
  await app.close();
  console.log("agent chip identity icon:", identityIcon, "| model rows:", JSON.stringify(rows));
  console.log("OK?", identityIcon === 1 && rows.includes("Extra High") && !rows.some(r => /speed/i.test(r)));
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
