import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewCommand } from "../src/desktop/infrastructure/electron/main/review-runner.ts";

test("codex review command maps every review target shape", async () => {
  assert.deepEqual(
    await buildReviewCommand({ cwd: "/repo", provider: "codex", target: { kind: "uncommitted" } }),
    { command: "codex", args: ["review", "--uncommitted"], source: "codex_cli", stdin: undefined },
  );
  assert.deepEqual(
    await buildReviewCommand({ cwd: "/repo", provider: "codex", target: { kind: "base_branch", baseBranch: "main" } }),
    { command: "codex", args: ["review", "--base", "main"], source: "codex_cli", stdin: undefined },
  );
  assert.deepEqual(
    await buildReviewCommand({
      cwd: "/repo",
      provider: "codex",
      target: { kind: "commit", sha: "abc123", title: "Fix bug" },
    }),
    {
      command: "codex",
      args: ["review", "--commit", "abc123", "--title", "Fix bug"],
      source: "codex_cli",
      stdin: undefined,
    },
  );

  const custom = await buildReviewCommand({
    cwd: "/repo",
    provider: "codex",
    target: { kind: "custom", instructions: "Review this patch.", diff: "diff --git a/a b/a" },
  });
  assert.equal(custom?.command, "codex");
  assert.deepEqual(custom?.args, ["review", "-"]);
  assert.equal(custom?.source, "codex_cli");
  assert.match(custom?.stdin ?? "", /Review this patch/);
  assert.match(custom?.stdin ?? "", /diff --git a\/a b\/a/);
});

test("claude review command uses ultrareview for base branch and prompts otherwise", async () => {
  assert.deepEqual(
    await buildReviewCommand({ cwd: "/repo", provider: "claude", target: { kind: "base_branch", baseBranch: "main" } }),
    {
      command: "claude",
      args: ["ultrareview", "main", "--timeout", "10"],
      source: "claude_ultrareview",
    },
  );

  const custom = await buildReviewCommand({
    cwd: "/repo",
    provider: "claude",
    target: { kind: "custom", instructions: "Focus on concurrency.", diff: "+new line" },
  });
  assert.equal(custom?.command, "claude");
  assert.deepEqual(custom?.args.slice(0, 4), ["-p", "--output-format", "text", "--permission-mode"]);
  assert.equal(custom?.args[4], "plan");
  assert.equal(custom?.source, "claude_prompt");
  assert.match(custom?.args.at(-1) ?? "", /Focus on concurrency/);
  assert.match(custom?.args.at(-1) ?? "", /\+new line/);
});

test("opencode review command builds a run prompt with the selected cwd", async () => {
  const command = await buildReviewCommand({
    cwd: "/repo",
    provider: "opencode",
    target: { kind: "custom", instructions: "Find regressions.", diff: "-old\n+new" },
  });

  assert.equal(command?.command, "opencode");
  assert.deepEqual(command?.args.slice(0, 6), ["run", "--format", "default", "--dir", "/repo", "--title"]);
  assert.equal(command?.args[6], "Tide Review");
  assert.equal(command?.source, "opencode_prompt");
  assert.match(command?.args.at(-1) ?? "", /Find regressions/);
  assert.match(command?.args.at(-1) ?? "", /-old\n\+new/);
});
