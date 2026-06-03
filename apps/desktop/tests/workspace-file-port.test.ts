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

test("file_tree_listing_respects_root_gitignore_subset", async () => {
  // D7: ignored entries are hidden; wanted source (src) stays visible.
  const root = fixtureRoot(
    {
      ".gitignore": [
        "# comment",
        "",
        "node_modules/",
        ".env",
        "*.log",
        "/build",
        ".secret-dir/",
      ].join("\n"),
      "src/app.ts": "export const x = 1;",
      "README.md": "# hello",
      ".env": "TOKEN=1",
      "debug.log": "noise",
      "keep.txt": "ok",
    },
    ["node_modules", "build", ".secret-dir"],
  );

  const names = await listNames(root);

  assert.ok(names.includes("src"), "src folder is visible");
  assert.ok(names.includes("src/app.ts"), "src descendant is visible");
  assert.ok(names.includes("README.md"), "non-ignored file is visible");
  assert.ok(names.includes("keep.txt"), "non-ignored file is visible");

  assert.ok(!names.includes("node_modules"), "gitignored dir hidden");
  assert.ok(!names.includes(".env"), "gitignored exact file hidden");
  assert.ok(!names.includes("debug.log"), "gitignored glob file hidden");
  assert.ok(!names.includes("build"), "anchored gitignored dir hidden");
  assert.ok(!names.includes(".secret-dir"), "gitignored dir hidden");
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
