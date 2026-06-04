// Auth-safe: opens the start composer's Model menu, verifies codex shows the
// reasoning-effort rows, clicks High, and confirms the chip label updates to
// "GPT-5.5 · High". Never sends a thread, never spawns an agent.
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = require("path").resolve(__dirname, "..");

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-modelpick-"));
  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(800);

  // Open the Model chip menu on the start composer.
  await page.locator('.composer-shell__choice-chip--model').first().click();
  await page.waitForSelector('[data-choice-surface="model_menu"]', { timeout: 5000 });

  const rowLabels = await page.locator('[data-choice-surface="model_menu"] .choice-surface__row-label').allInnerTexts();
  console.log("model menu rows:", JSON.stringify(rowLabels));

  const hasReasoning = ["Reasoning effort", "Low", "Medium", "High"].every((l) => rowLabels.includes(l));
  console.log("has reasoning section?", hasReasoning);

  // Click "High".
  await page.locator('[data-choice-surface="model_menu"] .choice-surface__row', { hasText: "High" }).first().click();
  await page.waitForTimeout(400);
  const chip = await page.locator('.composer-shell__choice-chip--model span').first().innerText();
  console.log("chip label after High:", chip);

  await page.screenshot({ path: "/tmp/pw-model-picker.png" });
  await app.close();
  console.log("MODEL PICKER OK?", hasReasoning && chip.includes("High"));
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
