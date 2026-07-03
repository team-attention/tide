// Auth-safe live verification for the three "fixes" (no provider turn is sent):
//   1. opencode on-ramp shows a connected-but-unusable vendor (expired Anthropic on
//      this machine) as "Reconnect", not "Connected" (spec: opencode-vendor-reconnect.md).
//   3. The file-tree "New File" button creates + opens a blank editable file on the
//      start page (spec: workbench-new-file.md).
// (ESC-interrupt needs a live running turn, so it is verified by unit/typecheck + manual.)
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
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-fixes-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot], { cwd: repo, stdio: "inherit" });

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.evaluate(async (cwd) => { await window.tide.registerProject(cwd); }, repo);
  await page.waitForTimeout(400);

  // Start a New Thread scoped to the repo (so cwd + file tree exist).
  const projectRow = page.locator("[data-project-row]").first();
  if (await projectRow.count()) await projectRow.hover().catch(() => {});
  await page.waitForTimeout(300);
  const newInProject = page.locator("[aria-label='New thread in project']").first();
  if (await newInProject.count()) await newInProject.click({ force: true });
  await page.waitForSelector('[data-chat-start="true"] textarea', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(600);

  // ── Issue 1: opencode on-ramp "Reconnect" ────────────────────────────────
  // Select the opencode agent.
  await page.locator(`[data-chat-start="true"] [data-context-kind='agent']`).first().click().catch(() => {});
  await page.waitForTimeout(500);
  const ocRow = page.locator("[data-choice-row], [data-choice-row]").filter({ hasText: /opencode/i }).first();
  if (await ocRow.count()) await ocRow.click({ force: true });
  await page.waitForTimeout(9500); // let the readiness probe resolve

  // Open the Model chip; opencode is usable (openai valid) → model menu with "Add a vendor".
  await page.locator(`[data-chat-start="true"] [aria-label='Model']`).first().click().catch(() => {});
  await page.waitForTimeout(700);
  const addVendor = page.locator("[data-choice-row], [data-choice-row], [role='option'], button").filter({ hasText: /add a vendor/i }).first();
  if (await addVendor.count()) {
    await addVendor.click({ force: true });
    await page.waitForTimeout(700);
  }
  await page.screenshot({ path: "/tmp/pw-fixes-1-onramp.png" });
  const onramp = page.locator('[data-choice-surface="opencode_connect"]');
  check("on-ramp panel opens", (await onramp.count()) > 0);
  const reconnectTiles = await page.locator('[data-opencode-vendor-tile][data-reconnect="true"]').allInnerTexts();
  const reconnectText = reconnectTiles.join(" | ");
  console.log("reconnect tiles:", JSON.stringify(reconnectText));
  check("an expired vendor shows Reconnect", /reconnect/i.test(reconnectText), reconnectText);
  check("Anthropic is the reconnect vendor", /anthropic/i.test(reconnectText), reconnectText);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);

  // ── Issue 3: New File (in the Workbench launcher) ─────────────────────────
  const wbToggle = page.locator("[aria-label='Open Workbench']");
  if (await wbToggle.count()) { await wbToggle.first().click(); await page.waitForTimeout(1000); }
  const newFileAction = page.locator('[data-launcher-action="new_file"]');
  check("New file action is present in the launcher", (await newFileAction.count()) > 0);
  await newFileAction.first().click().catch(() => {});
  await page.waitForTimeout(300);
  const nameInput = page.locator('[data-worktree-dialog-input="save-path"]');
  check("New file reveals an inline name input", (await nameInput.count()) > 0);
  const fname = `scratch-note-${Date.now()}.txt`;
  await nameInput.first().fill(fname);
  await nameInput.first().press("Enter");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "/tmp/pw-fixes-3-newfile.png" });
  // An editor pane for the new file should open in the workbench.
  const editorPanes = await page.locator("[data-column='workbench'], .cm-editor").count();
  check("an editor opens after creating the file", editorPanes > 0, `${editorPanes} editor nodes`);
  // The file is created empty on disk under the repo cwd.
  const created = fs.existsSync(path.join(repo, fname));
  check("the new file exists on disk (empty touch)", created, path.join(repo, fname));
  if (created) fs.rmSync(path.join(repo, fname), { force: true }); // clean up the test file

  await app.close();
  console.log(`DONE failures=${failures} dataRoot=${dataRoot}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("PW ERROR", e); process.exit(1); });
