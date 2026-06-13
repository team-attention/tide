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
