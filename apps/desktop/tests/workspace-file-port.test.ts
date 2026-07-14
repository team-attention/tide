// Spec: docs_v2/specs/workbench-filetree-view.md

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createNodeWorkspaceFilePort } from "../src/backend/adapters/outbound/workspace-file/node-workspace-file-port.ts";

function fixtureRoot(files: Record<string, string>, dirs: string[] = []): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tide-fs-"));
  for (const dir of dirs) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  for (const [relativePath, body] of Object.entries(files)) {
    const full = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, "utf8");
  }
  return root;
}

async function listLazyNames(root: string, expandedPaths: string[] = []): Promise<string[]> {
  const port = createNodeWorkspaceFilePort();
  const result = await port.listTree({ root, expandedPaths, maxEntries: 1 });
  assert.ok(result.ok, "listTree should succeed");
  return result.fileTree.entries.map((entry) => entry.relativePath);
}

test("file_tree_listing_shows_gitignored_and_machine_dirs_in_lazy_mode", async () => {
  // Lazy FileTree is filesystem navigation: gitignored, dot/hidden, VCS,
  // virtualenv, and vendor dirs are all visible at their parent level.
  const root = fixtureRoot(
    {
      ".gitignore": [
        "node_modules/",
        ".env",
        "*.log",
        ".secret-dir/",
      ].join("\n"),
      "src/app.ts": "export const x = 1;",
      "README.md": "# hello",
      ".env": "TOKEN=1",
      "debug.log": "noise",
      "keep.txt": "ok",
    },
    [".git", ".secret-dir", ".venv", "node_modules"],
  );

  const names = await listLazyNames(root);

  assert.ok(names.includes("src"), "src folder is visible");
  assert.ok(names.includes("README.md"), "non-ignored file is visible");
  assert.ok(names.includes("keep.txt"), "non-ignored file is visible");

  // Gitignored / hidden entries now show.
  assert.ok(names.includes(".gitignore"), "the .gitignore dotfile itself is visible");
  assert.ok(names.includes(".env"), "gitignored exact file is now visible");
  assert.ok(names.includes("debug.log"), "gitignored glob file is now visible");
  assert.ok(names.includes(".secret-dir"), "gitignored dir is now visible");

  // Machine dirs are also visible in FileTree.
  assert.ok(names.includes(".git"), "VCS dir is visible");
  assert.ok(names.includes(".venv"), "virtualenv dir is visible");
  assert.ok(names.includes("node_modules"), "vendor dir is visible");
});

test("file_tree_listing_does_not_truncate_lazy_root_when_many_machine_dirs_sort_first", async () => {
  // Lazy FileTree lists root children completely and does not spend the caller's
  // full-walk budget inside collapsed machine dirs.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tide-fs-"));
  for (const heavy of [".pnpm-store", ".venv", "__pycache__"]) {
    for (let i = 0; i < 50; i += 1) {
      const full = path.join(root, heavy, `pkg-${i}`, "index.js");
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, "module.exports = 1;\n", "utf8");
    }
  }
  // Real project content (sorts after the dot/underscore-prefixed heavy dirs).
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), "export const x = 1;\n", "utf8");
  fs.writeFileSync(path.join(root, "package.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(root, "zzz-last.txt"), "ok\n", "utf8");

  const port = createNodeWorkspaceFilePort();
  // A tiny maxEntries would truncate the old full walk; lazy FileTree ignores it.
  const result = await port.listTree({ root, expandedPaths: [], maxDepth: 12, maxEntries: 2 });
  assert.ok(result.ok, "listTree should succeed");
  const names = result.fileTree.entries.map((entry) => entry.relativePath);

  for (const heavy of [".pnpm-store", ".venv", "__pycache__"]) {
    assert.ok(names.includes(heavy), `${heavy} root folder is visible`);
    assert.ok(!names.some((name) => name.startsWith(`${heavy}/pkg-`)), `${heavy} is collapsed until expanded`);
  }
  assert.ok(names.includes("src"), "source dir survives the machine dirs");
  assert.ok(!names.includes("src/app.ts"), "collapsed source dir is not walked");
  assert.ok(names.includes("package.json"), "root file survives");
  assert.ok(names.includes("zzz-last.txt"), "the last-sorting root file survives");
  assert.equal(result.fileTree.truncated, false, "lazy FileTree does not truncate root children");
});

test("file_tree_listing_descends_only_into_expanded_paths", async () => {
  // Lazy mode: with `expandedPaths`, descend ONLY into those folders. A collapsed
  // folder is one entry; its children are not listed until it is expanded.
  const root = fixtureRoot({
    "src/app.ts": "1",
    "src/util/helper.ts": "2",
    "docs/readme.md": "3",
  });
  const port = createNodeWorkspaceFilePort();

  const rootOnly = await port.listTree({ root, maxEntries: 4000, expandedPaths: [] });
  assert.ok(rootOnly.ok, "listTree should succeed");
  assert.deepEqual(
    rootOnly.fileTree.entries.map((entry) => entry.relativePath).sort(),
    ["docs", "src"],
    "root-only lists the two top folders, no children",
  );

  const expandSrc = await port.listTree({ root, maxEntries: 4000, expandedPaths: ["src"] });
  assert.ok(expandSrc.ok, "listTree should succeed");
  const names = expandSrc.fileTree.entries.map((entry) => entry.relativePath);
  assert.ok(names.includes("src/app.ts"), "expanded folder's file is shown");
  assert.ok(names.includes("src/util"), "nested folder is listed");
  assert.ok(!names.includes("src/util/helper.ts"), "collapsed nested folder is NOT walked");
  assert.ok(!names.includes("docs/readme.md"), "unexpanded sibling is NOT walked");

  const expandDeep = await port.listTree({
    root,
    maxEntries: 4000,
    expandedPaths: ["src", "src/util"],
  });
  assert.ok(expandDeep.ok, "listTree should succeed");
  assert.ok(
    expandDeep.fileTree.entries.some((entry) => entry.relativePath === "src/util/helper.ts"),
    "expanding the nested folder reveals its deep file",
  );
});

test("file_tree_full_listing_walks_to_max_depth_for_quick_open", async () => {
  // Without `expandedPaths`, the depth-bounded full walk (Quick Open) descends
  // into source folders so fuzzy search sees deep files.
  const root = fixtureRoot({ "a/b/c/deep.ts": "1", "top.md": "2" });
  const port = createNodeWorkspaceFilePort();
  const result = await port.listTree({ root, maxEntries: 4000, maxDepth: 12 });
  assert.ok(result.ok, "listTree should succeed");
  const names = result.fileTree.entries.map((entry) => entry.relativePath);
  assert.ok(names.includes("a/b/c/deep.ts"), "full walk reaches deep files");
  assert.ok(names.includes("top.md"));
});

test("file_tree_full_listing_keeps_heavy_dir_exclusions_for_quick_open", async () => {
  // The bounded full walk remains source-focused for Quick Open/file mentions.
  const root = fixtureRoot({
    "node_modules/dep/index.js": "dep",
    ".venv/site.py": "venv",
    "src/main.ts": "1",
  });
  const port = createNodeWorkspaceFilePort();
  const result = await port.listTree({ root, maxEntries: 4000, maxDepth: 12 });
  assert.ok(result.ok, "listTree should succeed");
  const names = result.fileTree.entries.map((entry) => entry.relativePath);
  assert.ok(names.includes("src/main.ts"));
  assert.ok(!names.some((name) => name === "node_modules" || name.startsWith("node_modules/")));
  assert.ok(!names.some((name) => name === ".venv" || name.startsWith(".venv/")));
});

test("file_tree_listing_expands_machine_dir_on_demand", async () => {
  const root = fixtureRoot({
    ".venv/pyvenv.cfg": "home = /usr/bin",
    ".venv/bin/python": "python",
    "node_modules/pkg/package.json": "{}",
  });
  const rootOnly = await listLazyNames(root);
  assert.ok(rootOnly.includes(".venv"));
  assert.ok(rootOnly.includes("node_modules"));
  assert.ok(!rootOnly.includes(".venv/pyvenv.cfg"), "collapsed machine dir is not walked");

  const expanded = await listLazyNames(root, [".venv", "node_modules"]);
  assert.ok(expanded.includes(".venv/pyvenv.cfg"), "expanded virtualenv file is visible");
  assert.ok(expanded.includes(".venv/bin"), "expanded virtualenv folder child is visible");
  assert.ok(expanded.includes("node_modules/pkg"), "expanded vendor folder child is visible");
  assert.ok(!expanded.includes("node_modules/pkg/package.json"), "nested vendor folder remains collapsed");
});

test("file_tree_listing_does_not_truncate_expanded_folder_children", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tide-fs-"));
  fs.mkdirSync(path.join(root, "many"), { recursive: true });
  for (let i = 0; i < 30; i += 1) {
    fs.writeFileSync(path.join(root, "many", `file-${String(i).padStart(2, "0")}.txt`), "x", "utf8");
  }
  const port = createNodeWorkspaceFilePort();
  const result = await port.listTree({ root, expandedPaths: ["many"], maxEntries: 5 });
  assert.ok(result.ok, "listTree should succeed");
  const children = result.fileTree.entries
    .map((entry) => entry.relativePath)
    .filter((name) => name.startsWith("many/file-"));
  assert.equal(children.length, 30, "expanded folder direct children are complete");
  assert.equal(result.fileTree.truncated, false);
});

test("file_tree_listing_without_gitignore_lists_machine_dirs_in_lazy_mode", async () => {
  // D7: FileTree does not need .gitignore to decide visibility.
  const root = fixtureRoot(
    { "src/main.ts": "1", "notes.md": "n" },
    ["node_modules", ".git"],
  );
  const names = await listLazyNames(root);
  assert.ok(names.includes("src"));
  assert.ok(names.includes("notes.md"));
  assert.ok(names.includes("node_modules"), "vendor dir visible even without gitignore");
  assert.ok(names.includes(".git"), "VCS dir visible even without gitignore");
});

// ---- New File: readTextFile create flag (spec: workbench-new-file.md) ----

test("readTextFile create:true makes a missing file (and parent dirs) and reads it empty", async () => {
  const root = fixtureRoot({});
  const port = createNodeWorkspaceFilePort();
  const result = await port.readTextFile({ root, path: "notes/new.txt", byteLimit: 4096, create: true });
  assert.ok(result.ok, "create:true should succeed for a missing file");
  if (result.ok) {
    assert.equal(result.file.content, "");
    assert.equal(result.file.relativePath, "notes/new.txt");
  }
  assert.equal(fs.readFileSync(path.join(root, "notes/new.txt"), "utf8"), "", "the file now exists on disk");
});

test("readTextFile create:true never clobbers an existing file", async () => {
  const root = fixtureRoot({ "keep.md": "DO NOT LOSE" });
  const port = createNodeWorkspaceFilePort();
  const result = await port.readTextFile({ root, path: "keep.md", byteLimit: 4096, create: true });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.file.content, "DO NOT LOSE", "existing content preserved");
  }
  assert.equal(fs.readFileSync(path.join(root, "keep.md"), "utf8"), "DO NOT LOSE");
});

test("readTextFile without create still reports a missing file as not found", async () => {
  const root = fixtureRoot({});
  const port = createNodeWorkspaceFilePort();
  const result = await port.readTextFile({ root, path: "ghost.txt", byteLimit: 4096 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "workspace_file_not_found");
  }
});

test("readImageFile_returns_base64_for_supported_image", async () => {
  // Spec: docs_v2/specs/workbench-open-polish-and-image-pane.md
  const root = fixtureRoot({});
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  fs.writeFileSync(path.join(root, "assets", "logo.png"), bytes);
  const port = createNodeWorkspaceFilePort();

  const result = await port.readImageFile({
    root,
    path: "assets/logo.png",
    byteLimit: 4096,
  });

  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.file.relativePath, "assets/logo.png");
    assert.equal(result.file.mimeType, "image/png");
    assert.equal(result.file.dataBase64, bytes.toString("base64"));
    assert.equal(result.file.byteLength, bytes.length);
  }
});

test("readImageFile_returns_unreadable_when_image_bytes_cannot_be_read", async (t) => {
  // Spec: docs_v2/specs/workbench-open-polish-and-image-pane.md
  const root = fixtureRoot({});
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  const imagePath = path.join(root, "assets", "locked.png");
  fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  try {
    fs.chmodSync(imagePath, 0o000);
  } catch {
    t.skip("chmod is unavailable in this environment");
    return;
  }
  const port = createNodeWorkspaceFilePort();

  try {
    const result = await port.readImageFile({
      root,
      path: "assets/locked.png",
      byteLimit: 4096,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "workspace_file_unreadable");
    }
  } finally {
    fs.chmodSync(imagePath, 0o600);
  }
});

test("readTextFile remaps repo absolute links into the active default worktree", async () => {
  const repoRoot = fixtureRoot({ "src/app.ts": "main copy" });
  const worktreeRoot = `${repoRoot}.worktree/feature-x`;
  fs.mkdirSync(path.join(worktreeRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(worktreeRoot, "src/app.ts"), "worktree copy", "utf8");

  const port = createNodeWorkspaceFilePort();
  const result = await port.readTextFile({
    root: worktreeRoot,
    path: path.join(repoRoot, "src/app.ts"),
    byteLimit: 4096,
  });

  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.file.root, worktreeRoot);
    assert.equal(result.file.path, path.join(worktreeRoot, "src/app.ts"));
    assert.equal(result.file.relativePath, "src/app.ts");
    assert.equal(result.file.content, "worktree copy");
  }
});
