import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyGitHunk } from "../src/desktop/infrastructure/electron/main/git-hunk-actions.ts";
import { extractGitDiffHunks } from "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/git-diff-hunks.ts";

test("applyGitHunk stages exactly the selected hunk in a scratch repo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-git-hunk-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "tide@example.test"]);
    git(dir, ["config", "user.name", "Tide Test"]);
    const file = join(dir, "app.txt");
    writeFileSync(file, numberedLines({ line1: "line 01", line12: "line 12" }), "utf8");
    git(dir, ["add", "app.txt"]);
    git(dir, ["commit", "-m", "initial"]);

    writeFileSync(file, numberedLines({ line1: "line 01 changed", line12: "line 12 changed" }), "utf8");
    const diff = git(dir, ["diff", "--no-color", "HEAD", "--", "app.txt"]);
    const hunks = extractGitDiffHunks(diff);
    assert.equal(hunks.length, 2);

    const result = await applyGitHunk({
      cwd: dir,
      relPath: "app.txt",
      patch: hunks[0].patch,
      action: "stage",
    });

    assert.equal(result.ok, true);
    const staged = git(dir, ["diff", "--cached", "--no-color", "HEAD", "--", "app.txt"]);
    const unstaged = git(dir, ["diff", "--no-color", "--", "app.txt"]);
    assert.match(staged, /line 01 changed/);
    assert.doesNotMatch(staged, /line 12 changed/);
    assert.match(unstaged, /line 12 changed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function numberedLines(input: { line1: string; line12: string }): string {
  return [
    input.line1,
    "line 02",
    "line 03",
    "line 04",
    "line 05",
    "line 06",
    "line 07",
    "line 08",
    "line 09",
    "line 10",
    "line 11",
    input.line12,
    "",
  ].join("\n");
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}
