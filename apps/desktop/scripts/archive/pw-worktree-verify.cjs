const { _electron } = require("playwright");
const { spawnSync, execSync } = require("node:child_process");
const path = require("node:path"); const os = require("node:os"); const fs = require("node:fs");
const repo = require("path").resolve(__dirname, "..");
(async () => {
  // Isolated temp git repo with one commit (so worktree add works).
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "tide-wt-proj-"));
  execSync("git init -q && git config user.email t@t.t && git config user.name t && echo hi > a.txt && git add -A && git commit -qm init", { cwd: proj });
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-wt-data-"));
  fs.writeFileSync(path.join(dataRoot, "project-registry.json"),
    JSON.stringify([{ projectId: path.basename(proj), name: path.basename(proj), cwd: proj }], null, 2));
  const app = await _electron.launch({ args: [path.join(repo, "out/main/electron-main.js")], env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot } });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1000);
  const projId = path.basename(proj);
  await page.locator(`[data-project-row="${projId}"]`).hover();
  await page.locator(`[data-project-row="${projId}"] [aria-label="Project menu"]`).click();
  await page.waitForSelector('[data-left-ui-menu-kind="project"]', { timeout: 5000 });
  const before = await page.locator(".project-row__title").count();
  await page.locator('[data-left-ui-menu-kind="project"] button', { hasText: "Create permanent worktree" }).click();
  await page.waitForTimeout(1500);
  const after = await page.locator(".project-row__title").count();
  await app.close();
  const wt = execSync("git worktree list", { cwd: proj }).toString().trim().split("\n");
  console.log("projects before:", before, "after:", after);
  console.log("git worktrees in temp repo:", wt.length);
  console.log("WORKTREE OK?", after === before + 1 && wt.length === 2);
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
