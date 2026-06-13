import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createNodeWorkspaceFilePort } from "../src/backend/adapters/outbound/workspace-file/node-workspace-file-port.ts";

// Spec: project content search (Cmd+Shift+F) — case-insensitive; searches every
// file except the heavy vendor/build/VCS dirs (gitignored files ARE searched).

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "tide-search-"));
  writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
  writeFileSync(join(root, "a.ts"), "const Needle = 1;\nconst other = 2;\n");
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "sub", "b.ts"), "// find the needle here\n");
  writeFileSync(join(root, "ignored.txt"), "needle in ignored file\n");
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "node_modules", "dep.js"), "needle in node_modules\n");
  return root;
}

test("searchContent finds case-insensitive matches with line/column", async () => {
  const port = createNodeWorkspaceFilePort();
  const result = await port.searchContent({ root: fixtureRoot(), query: "needle", maxResults: 100, maxFiles: 100 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const paths = result.search.matches.map((m) => m.relativePath).sort();
  assert.deepEqual(paths, ["a.ts", "ignored.txt", "sub/b.ts"]);
  const a = result.search.matches.find((m) => m.relativePath === "a.ts");
  assert.equal(a?.line, 0);
  assert.equal(a?.column, 6);
  assert.equal(a?.lineText, "const Needle = 1;");
});

test("searchContent includes gitignored files but still skips node_modules", async () => {
  const port = createNodeWorkspaceFilePort();
  const result = await port.searchContent({ root: fixtureRoot(), query: "needle", maxResults: 100, maxFiles: 100 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const paths = result.search.matches.map((m) => m.relativePath);
  assert.ok(paths.includes("ignored.txt"), "gitignored file is now searched");
  assert.ok(!paths.some((p) => p.includes("node_modules")), "heavy dir still skipped");
});

test("searchContent returns empty for a blank query", async () => {
  const port = createNodeWorkspaceFilePort();
  const result = await port.searchContent({ root: fixtureRoot(), query: "  ", maxResults: 100, maxFiles: 100 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.search.matches.length, 0);
});
