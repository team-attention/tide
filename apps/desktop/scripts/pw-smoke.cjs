// Auth-safe interaction harness: drives the REAL built app via Playwright.
// Boots against a freshly-seeded data dir containing ONE persisted thread, opens
// it (hydrate only — never sends a message), and exercises the FileTree. It
// never spawns codex and never touches the OpenAI token.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = require("path").resolve(__dirname, "..");

async function dump(page, label) {
  await page.screenshot({ path: `/tmp/pw-${label}.png` });
}

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-"));
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
  await page.waitForTimeout(1200);
  await dump(page, "0-launch");

  // The seeded thread should appear in the rail. Open it (hydrate, no send).
  const threadRows = page.locator("[data-thread-row-main]");
  const rowCount = await threadRows.count();
  console.log("thread rows in rail:", rowCount);
  if (rowCount > 0) {
    await threadRows.first().click();
    await page.waitForTimeout(1200);
  }
  await dump(page, "1-thread-open");

  // Open the FileTree column via its real affordance.
  const toggle = page.locator('[aria-label="Open FileTree"]');
  if (await toggle.count()) {
    await toggle.first().click();
    console.log("clicked Open FileTree");
  } else {
    console.log("Open FileTree affordance NOT found");
  }
  await page.waitForTimeout(1500);
  await dump(page, "2-filetree-open");

  const fileRows = page.locator("[data-file-kind]");
  const n = await fileRows.count();
  const names = [];
  for (let i = 0; i < Math.min(n, 60); i += 1) {
    names.push((await fileRows.nth(i).innerText()).trim().replace(/\s+/g, " "));
  }
  console.log("file tree rows:", n);
  console.log("top-level entries:", JSON.stringify(names));
  console.log("src visible?", names.some((x) => x === "src" || x.endsWith(" src")));

  // Expand the first folder; rows should grow (children already loaded).
  const firstFolder = page.locator('[data-file-kind="folder"]').first();
  if (await firstFolder.count()) {
    const before = await page.locator("[data-file-kind]").count();
    await firstFolder.click();
    await page.waitForTimeout(700);
    const after = await page.locator("[data-file-kind]").count();
    console.log(`folder expand: rows ${before} -> ${after} (grew=${after > before})`);
  } else {
    console.log("no folder row to expand");
  }
  await dump(page, "3-folder-expanded");

  // --- Workbench: open it, then open a Browser pane via the Launcher ---
  const openWb = page.locator('[aria-label="Open Workbench"]');
  if (await openWb.count()) {
    await openWb.first().click();
    await page.waitForTimeout(1200);
    console.log("clicked Open Workbench");
  } else {
    console.log("Open Workbench affordance NOT found");
  }
  await dump(page, "4-workbench-open");

  const launcherActions = page.locator("[data-launcher-action]");
  const actionIds = [];
  for (let i = 0; i < (await launcherActions.count()); i += 1) {
    actionIds.push(await launcherActions.nth(i).getAttribute("data-launcher-action"));
  }
  console.log("launcher actions:", JSON.stringify(actionIds));
  const openBrowser = page.locator('[data-launcher-action="open_browser"]');
  if (await openBrowser.count()) {
    await openBrowser.first().click();
    await page.waitForTimeout(1500);
    console.log("clicked launcher open_browser");
  } else {
    console.log("open_browser launcher action NOT found");
  }
  await dump(page, "5-browser-pane");

  const browserPane = page.locator('[data-pane-kind="browser"]');
  const tabs = page.locator("[data-workbench-tab-label]");
  const tabTitles = [];
  for (let i = 0; i < (await tabs.count()); i += 1) {
    tabTitles.push((await tabs.nth(i).innerText()).trim());
  }
  console.log("browser pane present?", (await browserPane.count()) > 0);
  console.log("workbench tabs:", JSON.stringify(tabTitles));

  // --- Editor: click a file row in the tree, expect an editor pane with content ---
  const fileRow = page.locator('[data-file-kind="file"]').first();
  if (await fileRow.count()) {
    const name = (await fileRow.innerText()).trim();
    await fileRow.click();
    await page.waitForTimeout(1500);
    console.log("clicked file row:", name);
  } else {
    console.log("no file row to open");
  }
  await dump(page, "6-editor-open");
  const editorPane = page.locator('[data-pane-kind="editor"]');
  const editorPresent = (await editorPane.count()) > 0;
  let editorHasText = false;
  if (editorPresent) {
    const txt = (await editorPane.first().innerText()).trim();
    editorHasText = txt.length > 0;
  }
  console.log("editor pane present?", editorPresent, "hasText?", editorHasText);

  // --- Terminal: open via the launcher (+ New Pane), then open_terminal ---
  const newPane = page.locator('[aria-label="New Pane"]');
  if (await newPane.count()) {
    await newPane.first().click();
    await page.waitForTimeout(900);
  }
  const openTerm = page.locator('[data-launcher-action="open_terminal"]');
  if (await openTerm.count()) {
    await openTerm.first().click();
    await page.waitForTimeout(1500);
    console.log("clicked launcher open_terminal");
  } else {
    console.log("open_terminal launcher action NOT found");
  }
  await dump(page, "7-terminal-open");
  console.log("terminal pane present?", (await page.locator('[data-pane-kind="terminal"]').count()) > 0);

  // --- Diff: open via the launcher ---
  const newPane2 = page.locator('[aria-label="New Pane"]');
  if (await newPane2.count()) {
    await newPane2.first().click();
    await page.waitForTimeout(900);
  }
  const openDiff = page.locator('[data-launcher-action="open_diff"]');
  if (await openDiff.count()) {
    const disabled = await openDiff.first().isDisabled();
    if (disabled) {
      console.log("open_diff is disabled by design (needs a review target)");
    } else {
      await openDiff.first().click();
      await page.waitForTimeout(1200);
      console.log("clicked launcher open_diff; diff pane present?",
        (await page.locator('[data-pane-kind="diff"]').count()) > 0);
    }
  } else {
    console.log("open_diff launcher action NOT present");
  }
  await dump(page, "8-diff-open");

  await app.close();
  console.log("DONE dataRoot=", dataRoot);
})().catch((e) => {
  console.error("PW ERROR", e);
  process.exit(1);
});
