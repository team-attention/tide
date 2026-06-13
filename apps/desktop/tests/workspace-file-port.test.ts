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

async function listNames(root: string): Promise<string[]> {
  const port = createNodeWorkspaceFilePort();
  const result = await port.listTree({ root, maxDepth: 12, maxEntries: 4000 });
  assert.ok(result.ok, "listTree should succeed");
  return result.fileTree.entries.map((entry) => entry.relativePath);
}

test("file_tree_listing_shows_gitignored_files_but_still_hides_heavy_dirs", async () => {
  // Gitignored and dot/hidden files ARE shown (the tree no longer consults
  // .gitignore); only the heavy vendor/build/VCS dirs stay hidden.
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
    ["node_modules", ".secret-dir"],
  );

  const names = await listNames(root);

  assert.ok(names.includes("src"), "src folder is visible");
  assert.ok(names.includes("README.md"), "non-ignored file is visible");
  assert.ok(names.includes("keep.txt"), "non-ignored file is visible");

  // Gitignored / hidden entries now show.
  assert.ok(names.includes(".gitignore"), "the .gitignore dotfile itself is visible");
  assert.ok(names.includes(".env"), "gitignored exact file is now visible");
  assert.ok(names.includes("debug.log"), "gitignored glob file is now visible");
  assert.ok(names.includes(".secret-dir"), "gitignored dir is now visible");

  // The fixed heavy-dir set is still the one exclusion.
  assert.ok(!names.includes("node_modules"), "heavy dir still hidden");
});

test("file_tree_listing_is_not_starved_by_a_huge_heavy_dir_that_sorts_first", async () => {
  // Regression: the walk is depth-first under a bounded entry budget. A single
  // giant machine dir that sorts before the real source (a pnpm content store,
  // a Python .venv / __pycache__) must not be descended into and consume the
  // whole budget — which would truncate the walk and hide every sibling and root
  // file that sorts after it. These dirs are excluded outright, so the budget is
  // spent on actual project files.
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
  // A small budget each heavy dir alone would exhaust if it were descended.
  const result = await port.listTree({ root, maxDepth: 12, maxEntries: 25 });
  assert.ok(result.ok, "listTree should succeed");
  const names = result.fileTree.entries.map((entry) => entry.relativePath);

  for (const heavy of [".pnpm-store", ".venv", "__pycache__"]) {
    assert.ok(
      !names.some((name) => name === heavy || name.startsWith(`${heavy}/`)),
      `${heavy} is excluded entirely`,
    );
  }
  assert.ok(names.includes("src"), "source dir survives the heavy dirs");
  assert.ok(names.includes("src/app.ts"), "nested source survives");
  assert.ok(names.includes("package.json"), "root file survives");
  assert.ok(names.includes("zzz-last.txt"), "the last-sorting root file survives");
  assert.equal(result.fileTree.truncated, false, "no truncation once heavy dirs are excluded");
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
  // Without `expandedPaths`, the depth-bounded full walk (Quick Open) descends so
  // fuzzy search sees every file.
  const root = fixtureRoot({ "a/b/c/deep.ts": "1", "top.md": "2" });
  const port = createNodeWorkspaceFilePort();
  const result = await port.listTree({ root, maxEntries: 4000, maxDepth: 12 });
  assert.ok(result.ok, "listTree should succeed");
  const names = result.fileTree.entries.map((entry) => entry.relativePath);
  assert.ok(names.includes("a/b/c/deep.ts"), "full walk reaches deep files");
  assert.ok(names.includes("top.md"));
});

test("file_tree_listing_without_gitignore_lists_everything_but_heavy_dirs", async () => {
  // D7: a root without a .gitignore still hides only the always-hidden heavy dirs.
  const root = fixtureRoot(
    { "src/main.ts": "1", "notes.md": "n" },
    ["node_modules", ".git"],
  );
  const names = await listNames(root);
  assert.ok(names.includes("src"));
  assert.ok(names.includes("notes.md"));
  assert.ok(!names.includes("node_modules"), "heavy dir hidden even without gitignore");
  assert.ok(!names.includes(".git"), "vcs dir hidden even without gitignore");
});
