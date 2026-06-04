const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = require("path").resolve(__dirname, "..");

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-wb-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot], { cwd: repo, stdio: "inherit" });
  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(800);

  // --- Empty workbench shows a Launcher: New thread, open workbench ---
  await page.getByText("New thread", { exact: false }).first().click();
  await page.waitForTimeout(600);
  await page.locator('[aria-label="Open Workbench"]').first().click().catch(() => {});
  await page.waitForTimeout(700);
  const launcherActions = await page.locator(".workbench-launcher-action").count();
  console.log("empty workbench launcher actions:", launcherActions, "->", launcherActions > 0 ? "LAUNCHER SHOWN" : "EMPTY");
  await page.screenshot({ path: "/tmp/pw-wb-empty.png" });

  // --- Tab overflow keeps Close Workbench visible: open a seeded thread, many editor tabs ---
  await page.locator(".thread-row__main").first().click();
  await page.waitForTimeout(900);
  await page.locator('[aria-label="Open FileTree"]').first().click();
  await page.waitForTimeout(900);
  const files = page.locator('.file-tree-row[data-file-kind="file"]');
  const open = Math.min(8, await files.count());
  for (let i = 0; i < open; i += 1) {
    await files.nth(i).click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(400);
  const tabs = await page.locator(".workbench-tab").count();
  const closeBtn = page.locator('[aria-label="Close Workbench"]').first();
  const cb = await closeBtn.boundingBox();
  const winW = await page.evaluate(() => window.innerWidth);
  const closeVisible = cb ? cb.x >= 0 && cb.x + cb.width <= winW : false;
  console.log(`workbench tabs=${tabs}, Close Workbench within viewport? ${closeVisible} (x=${cb ? Math.round(cb.x) : "?"}, win=${winW})`);
  const ftClose = await page.locator('[aria-label="Close FileTree"]').count();
  console.log("Close FileTree present?", ftClose > 0);
  await page.screenshot({ path: "/tmp/pw-wb-tabs.png" });

  await app.close();
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
