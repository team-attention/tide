// Auth-safe START-PAGE file tree verification (spec: start-page-file-viewer):
// on the New Thread page (no thread opened), the composer-scoped tree must
// expand folders, open files as a real EDITABLE Workbench editor pane on the
// right (NOT a chat overlay), and follow the scope.
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
  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
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
  const rows = await page.locator("[data-file-kind]").count();
  console.log("tree rows after toggle:", rows);
  check("start-page tree lists the project root after the chip switch", rows > 0, `${rows} rows`);

  // Expand a folder — children must appear WITHOUT a thread.
  const folder = page.locator('[data-file-kind="folder"]').first();
  const before = await page.locator("[data-file-kind]").count();
  await folder.click();
  await page.waitForTimeout(600);
  const after = await page.locator("[data-file-kind]").count();
  check("folder expands on the start page", after > before, `${before} -> ${after}`);
  await page.screenshot({ path: "/tmp/pw-start-1-expanded.png" });

  // Open a file — it must open as a real Workbench EDITOR PANE on the right,
  // NOT the old chat overlay. The overlay class must be gone entirely.
  const fileRow = page.locator('[data-file-kind="file"]').first();
  const fileName = (await fileRow.innerText()).trim();
  await fileRow.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/pw-start-2-editor.png" });

  check("the old chat-overlay viewer is gone", (await page.locator("[data-start-file-viewer]").count()) === 0);
  const workbench = page.locator('[data-column="workbench"]');
  check("the workbench column opens with the file", (await workbench.count()) > 0);
  const tab = page.locator("[data-workbench-tab-title]", { hasText: fileName });
  check("a workbench editor tab shows the file name", (await tab.count()) > 0, fileName);
  // Content renders via the code editor OR the markdown preview.
  const editorText =
    ((await workbench.locator(".cm-content").first().innerText().catch(() => "")) || "") ||
    ((await workbench.locator("[data-md-preview]").first().innerText().catch(() => "")) || "");
  check("the editor renders file content", editorText.trim().length > 10, `${editorText.trim().length} chars`);
  // Editable affordance: markdown shows an Edit toggle; code shows a contenteditable
  // CodeMirror (NOT cm-readonly). Either proves the pane is editable, not a viewer.
  const hasEditToggle = (await workbench.locator("[data-md-mode-option]", { hasText: "Edit" }).count()) > 0;
  const editableCm = (await workbench.locator(".cm-content[contenteditable='true']").count()) > 0;
  check("the pane is editable (not read-only)", hasEditToggle || editableCm, hasEditToggle ? "markdown Edit toggle" : "editable code editor");

  // Code intelligence (autocomplete) works on the start page too: it is
  // thread-independent (workspace.codeIntel, keyed by cwd). Open a real .ts file
  // and type a member access — completions must surface with NO thread.
  const testsFolder = page.locator('[data-file-kind="folder"]', { hasText: "tests" }).first();
  if (await testsFolder.count()) {
    await testsFolder.click();
    await page.waitForTimeout(800);
  }
  const tsRow = page.locator('[data-file-kind="file"]').filter({ hasText: /\.ts$/ }).first();
  if (await tsRow.count()) {
    const tsName = (await tsRow.innerText()).trim();
    await tsRow.click();
    await page.waitForTimeout(1800);
    const codeEditor = workbench.locator("[data-code-editor-host] .cm-content");
    check("a .ts file opens in the start-page code editor", (await codeEditor.count()) > 0, tsName);

    // Find References on a clean buffer: right-click an identifier → "Find
    // References" → the references panel must populate (full path: editor →
    // workspace.codeIntel → backend findReferences → applied to startPageFile).
    const ident = page.locator("[data-code-editor-host] .cm-content .tok-variableName, [data-code-editor-host] .cm-content .tok-propertyName").first();
    if (await ident.count()) {
      await ident.click();
      await ident.click({ button: "right" });
      await page.waitForTimeout(300);
      const refItem = page.locator("[data-editor-menu-item]", { hasText: "Find References" }).first();
      if (await refItem.count()) {
        await refItem.click();
        await page.waitForTimeout(3200);
        const panel = workbench.locator("[data-editor-references]");
        const refCount = await panel.locator("[data-editor-reference-item]").count();
        await page.screenshot({ path: "/tmp/pw-start-3-references.png" });
        check("find-references populates the panel on the start-page editor (no thread)", (await panel.count()) > 0 && refCount > 0, `${refCount} refs`);
      }
    }

    // Autocomplete (dirties the buffer): type a member access — completions
    // must surface with NO thread.
    await codeEditor.first().click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("const probe = JSON.", { delay: 40 });
    await page.waitForTimeout(2800);
    const options = await page.locator(".cm-tooltip-autocomplete li").count();
    check("autocomplete surfaces on the start-page editor (no thread)", options > 0, `${options} options`);
    await page.screenshot({ path: "/tmp/pw-start-4-autocomplete.png" });
    await page.keyboard.press("Escape");
  } else {
    console.log("note: no .ts file in the start-page tree — skipping autocomplete check");
  }

  // Closing the editor tab collapses the workbench (no thread to fall back to).
  const closeTab = workbench.locator("[data-workbench-tab-close]").first();
  if (await closeTab.count()) {
    await closeTab.click();
    await page.waitForTimeout(400);
    check("closing the file collapses the workbench", (await page.locator('[data-column="workbench"]').count()) === 0);
  }

  await app.close();
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error("verify failed:", error);
  process.exit(1);
});
