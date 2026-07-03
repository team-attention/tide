// Auth-safe: boots the REAL built app on a seeded thread and verifies (1) the
// command popover opens on "/" and Escape dismisses it, and (2) opening a real
// source file in the FileTree renders an Editor pane with content. Never sends a
// message, never spawns a provider.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-te-"));
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
  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForTimeout(1000);
  const threadRows = page.locator("[data-thread-row-main]");
  if ((await threadRows.count()) > 0) {
    await threadRows.first().click();
    await page.waitForTimeout(1000);
  }

  // (1) Open the command popover via "/" then dismiss with Escape.
  const composer = page.locator("textarea").first();
  await composer.click();
  await composer.type("/", { delay: 40 });
  await page.waitForTimeout(700);
  const opened = await page.locator("[data-chip-popover]").count();
  console.log("popover open after '/' ?", opened > 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const afterEsc = await page.locator("[data-chip-popover]").count();
  console.log("popover closed after Escape?", afterEsc === 0);
  // Clear the stray "/".
  await composer.fill("");

  // (2) Editor for a real source file (proven FileTree-open sequence).
  const toggle = page.locator('[aria-label="Open FileTree"]');
  if (await toggle.count()) {
    await toggle.first().click();
    await page.waitForTimeout(1500);
  }
  const rows = page.locator('[data-file-kind="file"]');
  const total = await rows.count();
  console.log("file rows:", total);
  let openedFile = null;
  for (let i = 0; i < total; i += 1) {
    const name = (await rows.nth(i).innerText()).trim();
    if (/\.(json|md|mjs)$/.test(name)) {
      await rows.nth(i).click();
      openedFile = name;
      await page.waitForTimeout(1600);
      break;
    }
  }
  console.log("opened file:", openedFile);
  await page.screenshot({ path: "/tmp/pw-editor-1.png" });
  const editorPane = page.locator('[data-pane-kind="editor"]');
  const present = (await editorPane.count()) > 0;
  let hasText = false;
  if (present) {
    hasText = ((await editorPane.first().innerText()).trim().length) > 0;
  }
  console.log("editor pane present?", present, "hasText?", hasText);

  await app.close();
  console.log("DONE dataRoot=", dataRoot);
})().catch((e) => {
  console.error("PW ERROR", e);
  process.exit(1);
});
