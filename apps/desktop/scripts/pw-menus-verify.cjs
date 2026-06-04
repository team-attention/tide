// Auth-safe: screenshots the two surfaces the user flagged as visually awkward —
// the composer Agent choice-surface (chip dropdown) and the project context menu.
// No agent is spawned (we only open menus).
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = require("path").resolve(__dirname, "..");

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-menus-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot, "codex"], { cwd: repo, stdio: "inherit" });

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(900);

  // 1) Agent choice surface — click the agent chip on the start composer.
  const composerBoxBefore = await page.locator(".composer-shell").boundingBox();
  await page.locator('.composer-shell__context-chip[data-context-kind="agent"]').first().click();
  await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/pw-agent-menu.png" });
  const surfaceBox = await page.locator('[data-choice-surface="agent_menu"]').boundingBox();
  const composerBoxAfter = await page.locator(".composer-shell").boundingBox();
  const popoverBox = await page.locator(".chip-popover").boundingBox();
  const chipBox = await page.locator('.composer-shell__context-chip[data-context-kind="agent"]').first().boundingBox();
  // Composer must NOT move; popover must anchor near the chip (above or below).
  const composerMoved = composerBoxBefore && composerBoxAfter
    ? Math.abs(composerBoxBefore.y - composerBoxAfter.y) > 2 : "n/a";
  const anchoredToChip = popoverBox && chipBox ? Math.abs(popoverBox.x - chipBox.x) < 40 : "n/a";
  console.log("agent surface width:", surfaceBox ? Math.round(surfaceBox.width) : "n/a",
    "| composer moved:", composerMoved, "| anchored to chip:", anchoredToChip);
  // Click outside (top-left) → must close.
  await page.mouse.click(5, 5);
  await page.waitForTimeout(300);
  const stillOpen = await page.locator('[data-choice-surface="agent_menu"]').count();
  console.log("agent menu closed on outside click:", stillOpen === 0);

  // 2) Project context menu — hover the project row, click its ⋯ menu button.
  await page.locator('[data-project-row]').first().hover();
  await page.waitForTimeout(200);
  await page.locator('[aria-label="Project menu"]').first().click();
  await page.waitForSelector('[data-left-ui-menu-kind="project"]', { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/pw-project-menu.png" });
  const menuBox = await page.locator('[data-left-ui-menu-kind="project"]').boundingBox();
  // The long item must render in full (it's a fixed popover now — can extend past
  // the rail without being clipped by the rail's scroll overflow).
  const longItem = page.locator('[data-left-ui-menu-kind="project"] button', { hasText: "Create permanent worktree" });
  const longVisible = await longItem.isVisible().catch(() => false);
  const longText = await longItem.innerText().catch(() => "");
  console.log("project menu width:", menuBox ? Math.round(menuBox.width) : "n/a",
    "| long item visible:", longVisible, "| full text:", JSON.stringify(longText));

  // Click outside → must close.
  await page.mouse.click(900, 400);
  await page.waitForTimeout(300);
  const menuStillOpen = await page.locator('[data-left-ui-menu-kind="project"]').count();
  console.log("project menu closed on outside click:", menuStillOpen === 0);

  await app.close();
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
