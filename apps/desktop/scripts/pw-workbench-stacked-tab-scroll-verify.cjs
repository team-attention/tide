// LIVE verification (workbench stacked tab scroll): in Stacked layout the Workbench tab
// strip must surface EVERY open pane (no 6-tab cap that silently drops panes past the
// 6th) AND scroll horizontally when the tabs overflow — both a vertical mouse wheel and
// a programmatic scroll move it.
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
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-tabscroll-"));
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
  await page.waitForTimeout(800);

  await page.evaluate(async (cwd) => { await window.tide.registerProject(cwd); }, repo);
  await page.waitForTimeout(400);

  // Fresh New Thread composer, scoped to the registered repo project.
  await page.locator("button", { hasText: /New thread/i }).first().click();
  await page.waitForTimeout(300);
  const scopeChip = page.locator("button", { hasText: "Scratch" }).first();
  if (await scopeChip.count()) {
    await scopeChip.click();
    await page.waitForTimeout(300);
    const projectRow = page.locator("button", { hasText: /tide/ }).last();
    if (await projectRow.count()) await projectRow.click();
    await page.waitForTimeout(400);
  }

  // Open the Workbench launcher, then the first Browser pane.
  const openWb = page.locator('[aria-label="Open Workbench"]').first();
  if (await openWb.count()) {
    await openWb.click();
    await page.waitForTimeout(500);
  }
  await page.locator('[data-launcher-action="open_browser"]').first().click();
  await page.waitForTimeout(700);

  // Open more Browser panes via New Pane → Browser, well past the old 6-tab cap.
  const TARGET = 9;
  for (let i = 2; i <= TARGET; i += 1) {
    await page.locator('[aria-label="New Pane"]').first().click();
    await page.waitForTimeout(300);
    await page.locator('[data-launcher-action="open_browser"]').first().click();
    await page.waitForTimeout(450);
  }

  // Must be Stacked (not Split) for this check.
  const layout = await page.locator('[data-column="workbench"]').first().getAttribute("data-layout");
  check("workbench is in Stacked layout", layout === "stacked", `data-layout=${layout}`);

  const tabCount = await page.locator(".workbench-tabs .workbench-tab").count();
  check("every opened pane keeps a tab (past the old 6-tab cap)", tabCount > 6, `${tabCount} tabs rendered`);

  // The strip overflows its width and scrolls horizontally (programmatic).
  const metrics = await page.locator(".workbench-tabs").first().evaluate((el) => {
    el.scrollLeft = 99999;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, afterSet: el.scrollLeft };
  });
  check(
    "tab strip overflows its width",
    metrics.scrollWidth > metrics.clientWidth,
    `scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`,
  );
  check("tab strip is horizontally scrollable", metrics.afterSet > 0, `scrollLeft 0 -> ${metrics.afterSet}`);

  // A vertical mouse wheel over the strip scrolls it horizontally (mouse, not trackpad).
  const strip = page.locator(".workbench-tabs").first();
  await strip.evaluate((el) => { el.scrollLeft = 0; });
  const box = await strip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(150);
  const afterWheel = await strip.evaluate((el) => el.scrollLeft);
  check("a vertical wheel scrolls the strip horizontally", afterWheel > 0, `scrollLeft after wheel = ${afterWheel}`);

  await page.screenshot({ path: "/tmp/pw-tabscroll.png" });
  console.log("note: eyeball /tmp/pw-tabscroll.png — many tabs in the strip, scrolled to the right");

  await app.close();
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error("verify failed:", error);
  process.exit(1);
});
