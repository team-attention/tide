// Phase 3 ratchet (docs_v2/implementation/codebase-issues-and-remediation-plan.md).
//
// The product goal demands structurally simple, small files. This guard makes that
// mechanical: any NEW source file must be <= MAX_LINES; the existing oversized files
// are pinned at their current line counts and may only SHRINK, never grow. As the
// decomposition phases land, lower each pin (or delete the entry once it drops under
// the global cap). A file that grows past its pin fails the suite with a pointer to
// extract a collaborator instead of piling on.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const srcDir = path.join(root, "src");

// New files must stay under this. The working target is ~500; 800 is the hard cap.
const MAX_LINES = 800;

// Pinned ceilings for the known god-files (the Phase 3 decomposition backlog).
// Each may shrink or hold, never grow. Lower these as collaborators are extracted.
const PINNED_MAX: Record<string, number> = {
  "backend/application/services/thread/thread-runtime-service.ts": 1479,
};

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function lineCount(file: string): number {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

test("no source file grows past the global cap or its pinned ceiling", () => {
  const violations: string[] = [];
  for (const file of listSourceFiles(srcDir)) {
    const rel = path.relative(srcDir, file);
    const lines = lineCount(file);
    const ceiling = PINNED_MAX[rel] ?? MAX_LINES;
    if (lines > ceiling) {
      const which = PINNED_MAX[rel] !== undefined
        ? `pinned ceiling ${ceiling} (extract a collaborator; lower the pin)`
        : `cap ${MAX_LINES} (split this file before merging)`;
      violations.push(`${rel}: ${lines} lines > ${which}`);
    }
  }
  assert.deepEqual(violations, [], `\n${violations.join("\n")}`);
});

test("the ratchet allowlist has no stale entries (every pinned file still exists and is still oversized)", () => {
  const stale: string[] = [];
  for (const [rel, ceiling] of Object.entries(PINNED_MAX)) {
    const full = path.join(srcDir, rel);
    if (!fs.existsSync(full)) {
      stale.push(`${rel}: pinned but no longer exists — remove the entry`);
      continue;
    }
    if (lineCount(full) <= MAX_LINES) {
      stale.push(`${rel}: now under the global cap — remove the pin (ceiling ${ceiling})`);
    }
  }
  assert.deepEqual(stale, [], `\n${stale.join("\n")}`);
});
