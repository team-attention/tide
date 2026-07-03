// Auth-safe LIVE verification of FileTree file operations + untitled New File
// (spec: workbench-filetree-file-operations). Operates entirely inside a throwaway
// temp project dir (so the real Trash move + mutations never touch the repo).
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
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-fileops-data-"));
  const seed = spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot], { cwd: repo, stdio: "inherit" });
  if (seed.status !== 0) throw new Error("seed failed");

  // A throwaway project the test freely creates / renames / trashes files in.
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "tide-fileops-proj-"));
  fs.writeFileSync(path.join(project, "readme.md"), "# hello\n");
  fs.mkdirSync(path.join(project, "src"));
  fs.writeFileSync(path.join(project, "src", "old-name.ts"), "export const x = 1;\n");
  fs.writeFileSync(path.join(project, "doomed.txt"), "delete me\n");

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForTimeout(800);

  // Register the throwaway project, then reload so the shell re-fetches the registry
  // on mount and the scope picker lists it.
  await page.evaluate(async (cwd) => { await window.tide.registerProject(cwd); }, project);
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForTimeout(1000);
  // Scope the start composer to the throwaway project.
  await page.locator("button", { hasText: "Scratch" }).first().click();
  await page.waitForTimeout(300);
  await page.locator("button", { hasText: new RegExp(path.basename(project)) }).last().click();
  await page.waitForTimeout(600);

  // Open the FileTree.
  const treeToggle = page.locator('[aria-label="Open FileTree"]');
  if (await treeToggle.count()) { await treeToggle.first().click(); await page.waitForTimeout(1200); }
  check("FileTree lists the project root", (await page.locator("[data-file-kind]").count()) > 0);
  check("FileTree toolbar shows New File / New Folder", (await page.locator('[aria-label="New File"]').count()) > 0 && (await page.locator('[aria-label="New Folder"]').count()) > 0);
  await page.screenshot({ path: "/tmp/pw-fileops-0-tree.png" });

  // --- New File → untitled pane → Save As → file on disk ---
  await page.locator('[aria-label="New File"]').first().click();
  await page.waitForTimeout(600);
  check("New File opens an untitled editor tab", (await page.locator("[data-workbench-tab-title]", { hasText: /Untitled-1/ }).count()) > 0);
  await page.locator(".cm-content").first().click();
  await page.keyboard.type("created via new file\n", { delay: 20 });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
  await page.waitForTimeout(400);
  const saveAs = page.locator('[aria-label="Save file as"]');
  check("Cmd+S on an untitled opens the Save As dialog", (await saveAs.count()) > 0);
  await page.screenshot({ path: "/tmp/pw-fileops-1-saveas.png" });
  await page.locator('[aria-label="File path"]').fill("notes/created.md");
  await page.locator("[data-worktree-create-confirm]", { hasText: "Save" }).first().click();
  await page.waitForTimeout(1000);
  check("Save As writes the untitled to disk", fs.existsSync(path.join(project, "notes/created.md")), "notes/created.md");
  check("the saved file's content is the typed buffer", fs.readFileSync(path.join(project, "notes/created.md"), "utf8").includes("created via new file"));

  // --- New Folder via toolbar inline input ---
  await page.locator('[aria-label="New Folder"]').first().click();
  await page.waitForTimeout(300);
  const folderInput = page.locator("[data-file-tree-inline-input]");
  check("New Folder shows an inline name input", (await folderInput.count()) > 0);
  await folderInput.first().fill("widgets");
  await folderInput.first().press("Enter");
  await page.waitForTimeout(900);
  check("New Folder creates the folder on disk", fs.existsSync(path.join(project, "widgets")) && fs.statSync(path.join(project, "widgets")).isDirectory());

  // --- Rename via context menu (right-click a file) ---
  // Expand src so old-name.ts is visible.
  const srcFolder = page.locator('[data-file-kind="folder"]', { hasText: "src" }).first();
  if (await srcFolder.count()) { await srcFolder.click(); await page.waitForTimeout(700); }
  const oldFile = page.locator("[data-file-kind]", { hasText: "old-name.ts" }).first();
  await oldFile.click({ button: "right" });
  await page.waitForTimeout(300);
  check("right-click opens the FileTree context menu", (await page.locator("[data-file-tree-context-menu]").count()) > 0);
  await page.screenshot({ path: "/tmp/pw-fileops-2-menu.png" });
  await page.locator("[data-file-tree-menu-item]", { hasText: "Rename" }).first().click();
  await page.waitForTimeout(300);
  const renameInput = page.locator("[data-file-tree-inline-input]");
  check("Rename prefills an inline input", (await renameInput.count()) > 0 && (await renameInput.first().inputValue()) === "old-name.ts");
  await renameInput.first().fill("new-name.ts");
  await renameInput.first().press("Enter");
  await page.waitForTimeout(900);
  check("Rename moves the file on disk", !fs.existsSync(path.join(project, "src/old-name.ts")) && fs.existsSync(path.join(project, "src/new-name.ts")));

  // --- Delete via context menu → confirm → OS Trash ---
  const doomed = page.locator("[data-file-kind]", { hasText: "doomed.txt" }).first();
  await doomed.click({ button: "right" });
  await page.waitForTimeout(300);
  await page.locator("[data-file-tree-menu-item]", { hasText: "Delete" }).first().click();
  await page.waitForTimeout(300);
  const delDialog = page.locator('[aria-label="Delete"]');
  check("Delete opens a confirm dialog", (await delDialog.count()) > 0);
  await page.screenshot({ path: "/tmp/pw-fileops-3-delete.png" });
  await page.locator('[data-variant="danger"]', { hasText: "Move to Trash" }).first().click();
  await page.waitForTimeout(1200);
  check("Delete moves the file to the Trash (gone from the project)", !fs.existsSync(path.join(project, "doomed.txt")));

  // --- Drag-and-drop move: drag readme.md onto the src folder ---
  const readmeRow = page.locator("[data-file-kind]", { hasText: "readme.md" }).first();
  const srcTarget = page.locator('[data-file-kind="folder"]', { hasText: "src" }).first();
  await readmeRow.dragTo(srcTarget);
  await page.waitForTimeout(1200);
  check(
    "drag-and-drop moves the file into the folder",
    fs.existsSync(path.join(project, "src/readme.md")) && !fs.existsSync(path.join(project, "readme.md")),
    "readme.md → src/",
  );

  await page.screenshot({ path: "/tmp/pw-fileops-4-final.png" });
  await app.close();
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error("verify failed:", error);
  process.exit(1);
});
