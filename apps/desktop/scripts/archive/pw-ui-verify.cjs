// Auth-safe interaction checks for the new UI: project collapse/expand and
// drag-resize. Never sends a message (no codex).
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = require("path").resolve(__dirname, "..");

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-uiv-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot], { cwd: repo, stdio: "inherit" });

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(900);

  // --- Project collapse/expand ---
  const threadRowsBefore = await page.locator(".project-group__threads .thread-row").count();
  const chevron = page.locator('.project-row__toggle').first();
  await chevron.click();
  await page.waitForTimeout(400);
  const threadRowsCollapsed = await page.locator(".project-group__threads .thread-row").count();
  await chevron.click();
  await page.waitForTimeout(400);
  const threadRowsReExpanded = await page.locator(".project-group__threads .thread-row").count();
  console.log(`project threads: before=${threadRowsBefore} collapsed=${threadRowsCollapsed} reexpanded=${threadRowsReExpanded}`);
  console.log("collapse works?", threadRowsBefore > 0 && threadRowsCollapsed === 0 && threadRowsReExpanded === threadRowsBefore);

  // Open the thread + filetree so there is a resizable right column.
  await page.locator(".thread-row__main").first().click();
  await page.waitForTimeout(800);
  await page.locator('[aria-label="Open FileTree"]').first().click();
  await page.waitForTimeout(900);

  // --- Drag-resize the filetree column ---
  const col = page.locator('[data-column="file-tree"]');
  const handle = col.locator('.column-resize-handle').first();
  const widthBefore = (await col.boundingBox())?.width ?? 0;
  const hb = await handle.boundingBox();
  if (hb) {
    await page.mouse.move(hb.x + hb.width / 2, hb.y + 200);
    await page.mouse.down();
    await page.mouse.move(hb.x - 120, hb.y + 200, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  const widthAfter = (await col.boundingBox())?.width ?? 0;
  console.log(`filetree width: before=${Math.round(widthBefore)} after=${Math.round(widthAfter)}`);
  console.log("resize works?", Math.abs(widthAfter - widthBefore) > 40);

  // --- Workbench (middle) handle + horizontal-overflow guard ---
  await page.locator('[aria-label="Open Workbench"]').first().click().catch(() => {});
  await page.waitForTimeout(700);
  const wb = page.locator('[data-column="workbench"]');
  const wbHandle = wb.locator(".column-resize-handle").first();
  const wbBefore = (await wb.boundingBox())?.width ?? 0;
  const whb = await wbHandle.boundingBox();
  if (whb) {
    // Drag the middle handle RIGHT — workbench should SHRINK (boundary moves right).
    await page.mouse.move(whb.x + whb.width / 2, whb.y + 200);
    await page.mouse.down();
    await page.mouse.move(whb.x + 150, whb.y + 200, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  const wbAfter = (await wb.boundingBox())?.width ?? 0;
  console.log(`workbench width drag-right: before=${Math.round(wbBefore)} after=${Math.round(wbAfter)} (shrank=${wbAfter < wbBefore})`);
  const overflow = await page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth,
    bodyClient: document.body.clientWidth,
  }));
  console.log("overflow:", JSON.stringify(overflow));
  console.log("no horizontal overflow?", overflow.docScroll <= overflow.docClient && overflow.bodyScroll <= overflow.bodyClient);

  await page.screenshot({ path: "/tmp/pw-ui-verify.png" });
  await app.close();
  console.log("DONE");
})().catch((e) => {
  console.error("PW ERROR", e);
  process.exit(1);
});
