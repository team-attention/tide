// Auth-safe: verifies the left rail — Pinned header hidden when no pins, and
// Projects/Scratch sections collapse on header click. No agent spawned.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = require("path").resolve(__dirname, "..");

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-leftrail-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot, "codex"], { cwd: repo, stdio: "inherit" });

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(900);

  const pinnedVisible = await page.locator('.left-ui-section[aria-label="Pinned"]').count();
  const projectsHeader = page.locator('.left-ui-section[aria-label="Projects"] .left-ui-section__header');
  const threadRowsBefore = await page.locator('.left-ui-section[aria-label="Projects"] .thread-row').count();
  console.log("Pinned section present (no pins):", pinnedVisible, "(expect 0)");
  console.log("project threads before collapse:", threadRowsBefore);
  await page.screenshot({ path: "/tmp/pw-leftrail.png" });

  // Collapse Projects by clicking its header.
  await projectsHeader.click();
  await page.waitForTimeout(300);
  const threadRowsAfter = await page.locator('.left-ui-section[aria-label="Projects"] .thread-row').count();
  console.log("project threads after collapse:", threadRowsAfter, "(expect 0)");
  await page.screenshot({ path: "/tmp/pw-leftrail-collapsed.png" });

  await app.close();
  console.log("LEFT RAIL OK?", pinnedVisible === 0 && threadRowsBefore > 0 && threadRowsAfter === 0);
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
