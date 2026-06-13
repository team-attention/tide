// Auth-safe START-PAGE file tree verification (spec: start-page-file-viewer):
// on the New Thread page (no thread opened), the composer-scoped tree must
// expand folders, open files into the read-only viewer, and follow the scope.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-start-"));
  const seed = spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot], {
    cwd: repo,
    stdio: "inherit",
  });
  if (seed.status !== 0) throw new Error("seed failed");

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1000);

  // Register the repo as a project so the start composer can scope to it.
  await page.evaluate(async (cwd) => {
    await window.tide.registerProject(cwd);
  }, repo);
  await page.waitForTimeout(500);

  // Stay on the START page (do NOT open the seeded thread). The scope chip
  // defaults to Scratch — switch it to the registered "tide" project, which
  // must reload the start-page tree (the user's "chip change refreshes" ask).
  const scopeChip = page.locator("button", { hasText: "Scratch" }).first();
  await scopeChip.click();
  await page.waitForTimeout(500);
  const projectRow = page.locator("button", { hasText: /tide/ }).last();
  await projectRow.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/pw-start-0-scoped.png" });

  const treeToggle = page.locator('[aria-label="Open FileTree"]');
  if (await treeToggle.count()) {
    await treeToggle.first().click();
    await page.waitForTimeout(1500);
  }
  const rows = await page.locator(".file-tree-row").count();
  console.log("tree rows after toggle:", rows);
  check("start-page tree lists the project root after the chip switch", rows > 0, `${rows} rows`);

  // Expand a folder — children must appear WITHOUT a thread.
  const folder = page.locator('.file-tree-row[data-file-kind="folder"]').first();
  const before = await page.locator(".file-tree-row").count();
  await folder.click();
  await page.waitForTimeout(600);
  const after = await page.locator(".file-tree-row").count();
  check("folder expands on the start page", after > before, `${before} -> ${after}`);
  await page.screenshot({ path: "/tmp/pw-start-1-expanded.png" });

  // Open a file — the read-only viewer must show its content.
  const fileRow = page.locator('.file-tree-row[data-file-kind="file"]').first();
  const fileName = (await fileRow.innerText()).trim();
  await fileRow.click();
  await page.waitForTimeout(1500);
  const viewer = page.locator(".start-file-viewer");
  check("file opens into the start-page viewer", (await viewer.count()) > 0, fileName);
  const viewerText = (await viewer.locator(".cm-content").innerText().catch(() => "")) ?? "";
  check("viewer renders file content", viewerText.length > 10, `${viewerText.length} chars`);
  const tokenCount = await viewer.locator("[class*='tok-']").count();
  console.log("viewer syntax tokens:", tokenCount);
  await page.screenshot({ path: "/tmp/pw-start-2-viewer.png" });

  // Esc closes the viewer.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape closes the viewer", (await viewer.count()) === 0);

  await app.close();
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error("verify failed:", error);
  process.exit(1);
});
