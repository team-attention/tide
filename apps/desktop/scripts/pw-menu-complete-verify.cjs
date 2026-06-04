const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path"); const os = require("node:os"); const fs = require("node:fs");
const repo = require("path").resolve(__dirname, "..");
(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-menuc-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot, "codex"], { cwd: repo, stdio: "inherit" });
  const app = await _electron.launch({ args: [path.join(repo, "out/main/electron-main.js")], env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot } });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1000);

  await page.locator('[data-project-row="tide"]').hover();
  await page.locator('[data-project-row="tide"] [aria-label="Project menu"]').click();
  await page.waitForSelector('[data-left-ui-menu-kind="project"]', { timeout: 5000 });
  const disabled = await page.locator('[data-left-ui-menu-kind="project"] button[disabled]').count();
  const enabled = await page.locator('[data-left-ui-menu-kind="project"] button:not([disabled])').allInnerTexts();
  console.log("enabled items:", JSON.stringify(enabled.map(s=>s.trim())), "| disabled count:", disabled);

  // Click Pin project → should appear in a Pinned section.
  await page.locator('[data-left-ui-menu-kind="project"] button', { hasText: "Pin project" }).click();
  await page.waitForTimeout(500);
  const pinnedSection = await page.locator('.left-ui-section[aria-label="Pinned"]').count();
  const pinnedProject = await page.locator('[data-pinned-project="tide"]').count();
  console.log("pinned section present:", pinnedSection, "| tide pinned shortcut:", pinnedProject);
  await page.screenshot({ path: "/tmp/pw-menu-complete.png" });
  await app.close();
  console.log("MENU COMPLETE OK?", disabled === 0 && pinnedSection === 1 && pinnedProject === 1);
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
