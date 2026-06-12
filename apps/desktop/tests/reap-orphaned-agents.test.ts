import assert from "node:assert/strict";
import test from "node:test";

import { reapOrphanedTideAgentProcesses } from "../src/backend/infrastructure/node/live/reap-orphaned-agents.ts";

// A startup sweep that reaps Tide-spawned agents orphaned by a hard kill, without
// ever touching a live session's agents.

const processList = [
  // Orphaned (ppid 1) Tide agent — a leftover from a dead session. Reap it.
  "42001     1 /Users/me/.local/bin/gemini --prompt-interactive hi TIDE_RUNTIME_ID=runtime-abc TIDE_THREAD_ID=id-1",
  // Orphaned (ppid 1) python PTY bridge carrying the tag. Reap it.
  "42002     1 python3 -c <bridge> gemini TIDE_RUNTIME_ID=runtime-xyz",
  // LIVE Tide agent — still has a live parent (ppid != 1). Must NOT be touched.
  "42003 42002 /Users/me/.local/bin/claude TIDE_RUNTIME_ID=runtime-live",
  // Unrelated orphan without the tag. Must NOT be touched.
  "42004     1 /Applications/Some.app/Contents/MacOS/Some --flag",
].join("\n");

test("reaps only orphaned Tide-tagged processes, never live or untagged ones", () => {
  const killed: number[] = [];
  const reaped = reapOrphanedTideAgentProcesses({
    listProcesses: () => processList,
    kill: (pid) => killed.push(pid),
    selfPid: 999,
  });

  assert.equal(reaped, 2);
  assert.deepEqual(killed.sort(), [42001, 42002]);
  // Live agent (ppid != 1) and the untagged orphan are left alone.
  assert.ok(!killed.includes(42003));
  assert.ok(!killed.includes(42004));
});

test("never reaps its own process", () => {
  const killed: number[] = [];
  reapOrphanedTideAgentProcesses({
    listProcesses: () => "5005     1 backend TIDE_RUNTIME_ID=runtime-self",
    kill: (pid) => killed.push(pid),
    selfPid: 5005,
  });
  assert.deepEqual(killed, []);
});
