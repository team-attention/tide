// Spec: docs_v2/specs/workbench-editor-code-navigation.md

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTypeScriptCodeIntelligencePort } from "../src/backend/adapters/outbound/code-intelligence/typescript-code-intelligence-port.ts";

function fixtureRoot(content: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tide-code-intel-"));
  for (const [relativePath, body] of Object.entries(content)) {
    fs.writeFileSync(path.join(root, relativePath), body, "utf8");
  }
  return root;
}

// A symbol declared once and used twice in the same file. `greet` starts at
// character 9 on line 0 ("function " is 9 characters).
const SAME_FILE_SOURCE = [
  "function greet(name: string): string {",
  "  return `Hi ${name}`;",
  "}",
  "",
  'const a = greet("a");',
  'const b = greet("b");',
  "",
].join("\n");

test("typescript_code_intelligence_finds_all_references_to_a_symbol", async () => {
  // workbench-editor-code-navigation: go-to-references returns every use site.
  const root = fixtureRoot({ "main.ts": SAME_FILE_SOURCE });
  const port = createTypeScriptCodeIntelligencePort();

  const result = await port.findReferences({
    root,
    path: "main.ts",
    line: 0,
    character: 9,
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  // Declaration plus two call sites.
  assert.ok(
    result.locations.length >= 3,
    `expected at least 3 references, got ${result.locations.length}`,
  );
  assert.ok(result.locations.every((location) => location.relativePath === "main.ts"));
  const referencedLines = result.locations.map((location) => location.line).sort((a, b) => a - b);
  assert.deepEqual(referencedLines, [0, 4, 5]);
  assert.equal(result.truncated, false);
});

test("typescript_code_intelligence_returns_not_found_for_a_non_symbol_position", async () => {
  const root = fixtureRoot({ "main.ts": SAME_FILE_SOURCE });
  const port = createTypeScriptCodeIntelligencePort();

  // Line 3 is blank.
  const result = await port.findReferences({
    root,
    path: "main.ts",
    line: 3,
    character: 0,
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.error.code, "workspace_code_references_not_found");
});

test("typescript_code_intelligence_rejects_references_outside_the_root", async () => {
  const root = fixtureRoot({ "main.ts": SAME_FILE_SOURCE });
  const port = createTypeScriptCodeIntelligencePort();

  const result = await port.findReferences({
    root,
    path: "../escape.ts",
    line: 0,
    character: 0,
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.error.code, "workspace_code_references_not_found");
});
