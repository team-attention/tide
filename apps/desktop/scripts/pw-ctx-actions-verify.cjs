const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = require("path").resolve(__dirname, "..");
(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-ctx-"));
  // A registered project with no threads (removable).
  fs.writeFileSync(path.join(dataRoot, "project-registry.json"),
    JSON.stringify([{ projectId: "demo", name: "demo", cwd: "/tmp/demo-proj-xyz" }], null, 2));
  const app = await _electron.launch({ args: [path.join(repo, "out/main/electron-main.js")], env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot } });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1000);

  const before = await page.locator(".project-row__title").allInnerTexts();
  console.log("projects before:", JSON.stringify(before));

  // Open the demo project's context menu.
  await page.locator('[data-project-row="demo"]').hover();
  await page.locator('[data-project-row="demo"] [aria-label="Project menu"]').click();
  await page.waitForSelector('[data-left-ui-menu-kind="project"]', { timeout: 5000 });
  const enabled = await page.locator('[data-left-ui-menu-kind="project"] button:not([disabled])').allInnerTexts();
  const disabled = await page.locator('[data-left-ui-menu-kind="project"] button[disabled]').allInnerTexts();
  console.log("enabled items:", JSON.stringify(enabled.map(s=>s.trim())));
  console.log("disabled items:", JSON.stringify(disabled.map(s=>s.trim())));

  // Click Remove.
  await page.locator('[data-left-ui-menu-kind="project"] button', { hasText: "Remove" }).click();
  await page.waitForTimeout(600);
  const after = await page.locator(".project-row__title").allInnerTexts();
  console.log("projects after Remove:", JSON.stringify(after));

  // Confirm the registry file no longer has demo.
  const registry = JSON.parse(fs.readFileSync(path.join(dataRoot, "project-registry.json"), "utf8"));
  await app.close();
  const removed = !after.includes("demo") && !registry.some(e => e.projectId === "demo");
  console.log("CTX ACTIONS OK?", removed && enabled.includes("Open in Finder") && enabled.includes("Remove") && enabled.includes("Archive chats") && disabled.includes("Pin project"));
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
