const { _electron } = require("playwright");
const path = require("node:path"); const os = require("node:os"); const fs = require("node:fs");
const repo = path.resolve(__dirname);
(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-ocd3-"));
  const app = await _electron.launch({ args: [path.join(repo, "out/main/electron-main.js")], env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot } });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.locator('.composer-shell__context-chip[data-context-kind="agent"]').first().click();
  await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
  await page.locator('[data-choice-surface="agent_menu"] .choice-surface__row', { hasText: "opencode" }).click();
  await page.waitForTimeout(400);
  await page.locator('[aria-label="Composer draft"]').first().fill("Reply with exactly: OC_OK");
  await page.locator(".composer-shell__send").first().click();
  await page.waitForTimeout(22000);
  await app.close(); fs.rmSync(dataRoot, { recursive: true, force: true });
})().catch(e => { console.error("ERR:", String(e).slice(0,200)); });
