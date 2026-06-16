import assert from "node:assert/strict";
import test from "node:test";

import {
  runAgentReaperGuardian,
  runAgentReaperGuardianFromEnv,
  spawnAgentReaperGuardian,
} from "../src/backend/infrastructure/node/live/agent-reaper-guardian.ts";

// The detached force-quit guardian watches the backend pid and, the moment the backend
// is gone, runs ONE reap pass over the orphaned agents, then resolves so the guardian
// process can exit. While the backend is alive it must NEVER reap.

test("reaps exactly once after the watched backend exits", async () => {
  let aliveProbes = 0;
  let reapCalls = 0;
  const result = await runAgentReaperGuardian({
    targetPid: 4242,
    // Alive for the first two polls, then gone.
    isTargetAlive: () => {
      aliveProbes += 1;
      return aliveProbes < 3;
    },
    reap: () => {
      reapCalls += 1;
      return 2;
    },
    sleep: async () => {},
    now: () => 0,
  });

  assert.equal(result.reason, "target_exited");
  assert.equal(result.reaped, 2);
  assert.equal(reapCalls, 1, "reaps exactly one pass after the target dies");
});

test("never reaps while the target is alive — the lifetime cap stands down without killing", async () => {
  let clock = 0;
  let reapCalls = 0;
  const result = await runAgentReaperGuardian({
    targetPid: 4242,
    isTargetAlive: () => true, // a long-lived (or pid-reused) target that never dies
    reap: () => {
      reapCalls += 1;
      return 99;
    },
    sleep: async () => {
      clock += 1000;
    },
    now: () => clock,
    maxLifetimeMs: 5000,
  });

  assert.equal(result.reason, "max_lifetime");
  assert.equal(result.reaped, 0);
  assert.equal(reapCalls, 0, "must not kill a still-live session's agents");
});

test("spawns a detached guardian that re-runs the entrypoint in guardian mode", () => {
  const calls: Array<{
    command: string;
    args: string[];
    options: { detached: boolean; stdio: string; env: NodeJS.ProcessEnv };
  }> = [];
  let unrefs = 0;
  const launched = spawnAgentReaperGuardian({
    entrypointPath: "/app/backend-entrypoint.js",
    targetPid: 7777,
    command: "/Applications/Tide.app/Contents/MacOS/Tide",
    env: { PATH: "/usr/bin" },
    platform: "darwin",
    spawnGuardian: (command, args, options) => {
      calls.push({ command, args, options });
      return {
        unref: () => {
          unrefs += 1;
        },
      };
    },
  });

  assert.equal(launched, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/Applications/Tide.app/Contents/MacOS/Tide");
  assert.deepEqual(calls[0].args, ["/app/backend-entrypoint.js", "guardian"]);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, "ignore");
  assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(calls[0].options.env.TIDE_GUARDIAN_TARGET_PID, "7777");
  assert.equal(calls[0].options.env.PATH, "/usr/bin");
  assert.equal(unrefs, 1, "detaches from the parent lifecycle");
});

test("is a no-op on Windows (ppid==1 reaping is POSIX-only)", () => {
  let spawned = 0;
  const launched = spawnAgentReaperGuardian({
    entrypointPath: "C:/app/backend-entrypoint.js",
    targetPid: 1,
    platform: "win32",
    spawnGuardian: () => {
      spawned += 1;
      return { unref: () => {} };
    },
  });

  assert.equal(launched, false);
  assert.equal(spawned, 0);
});

test("guardian-from-env stands down when no valid target pid is set", async () => {
  assert.equal(await runAgentReaperGuardianFromEnv({}), undefined);
  assert.equal(
    await runAgentReaperGuardianFromEnv({ TIDE_GUARDIAN_TARGET_PID: "nope" }),
    undefined,
  );
  assert.equal(
    await runAgentReaperGuardianFromEnv({ TIDE_GUARDIAN_TARGET_PID: "0" }),
    undefined,
  );
});
