// Auth-safe: verifies the persisted project registry seeds the Projects rail on
// launch — a registered folder with NO threads still appears (Codex flow). Also
// confirms the Project menu offers a single "Open folder" action. No agent spawned.
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = "/Users/eatnug/Workspace/tide";

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-preg-"));
  // Pre-write a registry entry for a project that has no threads.
  fs.writeFileSync(
    path.join(dataRoot, "project-registry.json"),
    JSON.stringify([{ projectId: "demo-proj", name: "demo-proj", cwd: "/tmp/demo-proj" }], null, 2),
  );

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1200);

  const projectTitles = await page.locator(".project-row__title").allInnerTexts();
  console.log("project rail titles:", JSON.stringify(projectTitles));

  // Open the Project chip menu and confirm a single "Open folder" action.
  await page.locator('.composer-shell__context-chip[data-context-kind="project"]').first().click();
  await page.waitForSelector('[data-choice-surface="project_menu"]', { timeout: 5000 });
  const rows = await page.locator('[data-choice-surface="project_menu"] .choice-surface__row-label').allInnerTexts();
  console.log("project menu rows:", JSON.stringify(rows));
  await page.screenshot({ path: "/tmp/pw-project-registry.png" });
  await app.close();

  const railOk = projectTitles.includes("demo-proj");
  const menuOk = rows.includes("Open folder") && rows.includes("demo-proj")
    && !rows.includes("Create new project") && !rows.includes("Use existing folder");
  console.log("PROJECT REGISTRY OK?", railOk && menuOk);
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
