import assert from "node:assert/strict";
import test from "node:test";

import {
  claudeTranscriptPathForPid,
  codexRolloutPathForPid,
} from "../src/backend/infrastructure/node/codex-rollout-for-pid.ts";

// Deterministic binding: find the rollout the spawned process's codex descendant
// actually has open — not a guess by recency/prompt text.

test("finds the rollout the codex descendant process has open", () => {
  // PTY host pid 100 (python) -> codex pid 200 holding the rollout open.
  const childPidsOf = (pid: number) => (pid === 100 ? [200] : []);
  const openFilesOf = (pid: number) =>
    pid === 200
      ? [
          "/dev/null",
          "/Users/me/.codex/sessions/2026/06/04/rollout-2026-06-04T01-02-14-abc.jsonl",
        ]
      : ["/opt/homebrew/lib/python"];

  const result = codexRolloutPathForPid(100, { childPidsOf, openFilesOf });
  assert.equal(
    result,
    "/Users/me/.codex/sessions/2026/06/04/rollout-2026-06-04T01-02-14-abc.jsonl",
  );
});

test("returns undefined when no descendant has a rollout open yet", () => {
  // Not open yet → caller waits for the next poll; never guesses.
  const result = codexRolloutPathForPid(100, {
    childPidsOf: () => [],
    openFilesOf: () => ["/some/other/file"],
  });
  assert.equal(result, undefined);
});

test("does not loop forever on a cyclic process graph", () => {
  const result = codexRolloutPathForPid(1, {
    childPidsOf: (pid) => (pid === 1 ? [2] : [1]),
    openFilesOf: () => [],
  });
  assert.equal(result, undefined);
});

test("returns undefined for a missing pid", () => {
  assert.equal(codexRolloutPathForPid(undefined), undefined);
});

test("finds the transcript the claude descendant process has open", () => {
  // PTY host pid 100 (python) -> claude pid 200 holding its transcript open.
  const childPidsOf = (pid: number) => (pid === 100 ? [200] : []);
  const openFilesOf = (pid: number) =>
    pid === 200
      ? [
          "/dev/null",
          "/Users/me/.claude/projects/-Users-me-Workspace-app/eb786349-5c07-434b-a6b7-c51e80058f9a.jsonl",
        ]
      : ["/opt/homebrew/lib/node"];

  const result = claudeTranscriptPathForPid(100, { childPidsOf, openFilesOf });
  assert.equal(
    result,
    "/Users/me/.claude/projects/-Users-me-Workspace-app/eb786349-5c07-434b-a6b7-c51e80058f9a.jsonl",
  );
});

test("claude binding does not match a codex rollout (and vice versa)", () => {
  // A claude run must never bind a codex rollout path, even if it is open.
  const openFilesOf = () => [
    "/Users/me/.codex/sessions/2026/06/04/rollout-2026-06-04T01-02-14-abc.jsonl",
  ];
  assert.equal(
    claudeTranscriptPathForPid(100, { childPidsOf: () => [], openFilesOf }),
    undefined,
  );
});
