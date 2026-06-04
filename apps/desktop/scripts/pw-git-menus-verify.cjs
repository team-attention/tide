// Auth-safe: verifies the Branch and Worktree menus show REAL git data for the
// active project cwd (the tide repo). No agent spawned.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = require("path").resolve(__dirname, "..");

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-gitmenu-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot, "codex"], { cwd: repo, stdio: "inherit" });

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1500); // allow git-context fetch

  // Branch menu
  await page.locator('.composer-shell__context-chip[data-context-kind="branch"]').first().click();
  await page.waitForSelector('[data-choice-surface="branch_menu"]', { timeout: 5000 });
  await page.waitForTimeout(300);
  const branchRows = await page.locator('[data-choice-surface="branch_menu"] .choice-surface__row-label').allInnerTexts();
  console.log("branch menu rows (first 8):", JSON.stringify(branchRows.slice(0, 8)));
  await page.screenshot({ path: "/tmp/pw-branch-menu.png" });
  await page.mouse.click(5, 5);
  await page.waitForTimeout(300);

  // Worktree menu
  await page.locator('.composer-shell__context-chip[data-context-kind="worktree"]').first().click();
  await page.waitForSelector('[data-choice-surface="worktree_menu"]', { timeout: 5000 });
  await page.waitForTimeout(300);
  const wtRows = await page.locator('[data-choice-surface="worktree_menu"] .choice-surface__row-label').allInnerTexts();
  console.log("worktree menu rows:", JSON.stringify(wtRows));
  await page.screenshot({ path: "/tmp/pw-worktree-menu.png" });
  await app.close();

  const hasRealBranch = branchRows.some((r) => r.startsWith("codex/") || r === "archive-main");
  const noPlaceholders = !branchRows.includes("feature/sidebar") && !branchRows.includes("release/2026-05");
  const hasMain = branchRows.includes("main");
  const wtOk = wtRows.includes("current folder") && wtRows.includes("New worktree");
  console.log("GIT MENUS OK?", hasMain && hasRealBranch && noPlaceholders && wtOk);
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
