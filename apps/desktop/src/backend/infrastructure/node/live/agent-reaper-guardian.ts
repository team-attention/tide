import { spawn } from "node:child_process";

import { reapOrphanedTideAgentProcesses } from "./reap-orphaned-agents.ts";

// A detached watchdog that OUTLIVES the backend. A clean quit already reaps agents via
// the backend's own shutdown (SIGTERM -> closed stdio -> providers exit on EOF), but a
// HARD kill (Force Quit / crash / power loss) skips every in-process handler and can
// strand a CPU-spinning agent until the NEXT launch, when the startup reaper finally
// runs. This guardian closes that window: the backend spawns it detached at startup
// with its own pid; the guardian polls that pid and — the moment the backend is gone —
// runs ONE reap pass over the orphaned, TIDE_RUNTIME_ID-tagged agents, then exits.
//
// It carries NO TIDE_RUNTIME_ID tag, so the reaper never targets it; it excludes its
// own pid regardless. Three layers of defense remain in place: clean-quit EOF, this
// live guardian (force quit / crash), and the next-launch startup sweep (total kill /
// power loss / a guardian that was itself destroyed).

const POLL_INTERVAL_MS = 750;
// After the backend dies the kernel reparents its surviving children to launchd
// (ppid 1). Give that a beat to settle before the single reap pass, so every orphan is
// already ppid 1 and therefore visible to the reaper's ppid==1 filter.
const REPARENT_SETTLE_MS = 750;
// Pids are recycled. If the watched pid is reused by an unrelated process the guardian
// could otherwise poll forever; cap its lifetime so a stuck guardian is eventually
// reclaimed. The next-launch startup reaper remains the ultimate backstop, so standing
// down here never loses an orphan permanently.
const MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export interface RunAgentReaperGuardianInput {
  targetPid: number;
  isTargetAlive?: (pid: number) => boolean;
  reap?: () => number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
  reparentSettleMs?: number;
  maxLifetimeMs?: number;
}

export interface AgentReaperGuardianResult {
  reaped: number;
  reason: "target_exited" | "max_lifetime";
}

export async function runAgentReaperGuardian(
  input: RunAgentReaperGuardianInput,
): Promise<AgentReaperGuardianResult> {
  const isAlive = input.isTargetAlive ?? defaultIsTargetAlive;
  const reap = input.reap ?? (() => reapOrphanedTideAgentProcesses());
  const sleep = input.sleep ?? defaultSleep;
  const now = input.now ?? Date.now;
  const pollInterval = input.pollIntervalMs ?? POLL_INTERVAL_MS;
  const settle = input.reparentSettleMs ?? REPARENT_SETTLE_MS;
  const maxLifetime = input.maxLifetimeMs ?? MAX_LIFETIME_MS;

  const startedAt = now();
  while (isAlive(input.targetPid)) {
    if (now() - startedAt >= maxLifetime) {
      // The target still looks alive past the lifetime cap — most likely a genuinely
      // long-running session (or a reused pid). Stand down WITHOUT reaping: killing a
      // possibly-live session's agents would be worse than leaving any real orphan to
      // the next-launch startup sweep.
      return { reaped: 0, reason: "max_lifetime" };
    }
    await sleep(pollInterval);
  }

  await sleep(settle);
  return { reaped: reap(), reason: "target_exited" };
}

// Entrypoint for `guardian` argv mode: read the watched pid from the environment the
// backend injected and run the watch loop. Stands down (no loop) if no valid pid is
// present, so a stray invocation can never block forever or reap a live session.
export async function runAgentReaperGuardianFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentReaperGuardianResult | undefined> {
  const targetPid = Number.parseInt(env.TIDE_GUARDIAN_TARGET_PID ?? "", 10);
  if (!Number.isInteger(targetPid) || targetPid <= 0) {
    return undefined;
  }
  return runAgentReaperGuardian({ targetPid });
}

export interface SpawnAgentReaperGuardianInput {
  // The backend entrypoint (backend-entrypoint.js) re-run in `guardian` argv mode —
  // the same self-relaunch recipe the Tide MCP stdio bridge uses.
  entrypointPath: string;
  targetPid: number;
  command?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  spawnGuardian?: (
    command: string,
    args: string[],
    options: { detached: boolean; stdio: "ignore"; env: NodeJS.ProcessEnv },
  ) => { unref: () => void };
}

// Returns true if a guardian was launched. The backend calls this once at startup.
export function spawnAgentReaperGuardian(input: SpawnAgentReaperGuardianInput): boolean {
  const platform = input.platform ?? process.platform;
  // ppid==1 orphan detection is POSIX semantics; the guardian is a no-op on Windows.
  if (platform === "win32") {
    return false;
  }
  const env = input.env ?? process.env;
  const command = input.command ?? env.TIDE_BIN ?? process.execPath;
  const spawnGuardian =
    input.spawnGuardian ?? ((cmd, args, options) => spawn(cmd, args, options));

  const child = spawnGuardian(command, [input.entrypointPath, "guardian"], {
    detached: true,
    stdio: "ignore",
    env: {
      ...env,
      // Run the Electron binary as a plain Node runtime (matches the MCP bridge).
      ELECTRON_RUN_AS_NODE: "1",
      TIDE_GUARDIAN_TARGET_PID: String(input.targetPid),
    },
  });
  // Detach from the parent's lifecycle so the guardian survives a hard-killed backend.
  child.unref();
  return true;
}

function defaultIsTargetAlive(pid: number): boolean {
  try {
    // Signal 0 probes existence without delivering a signal.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = the process is gone. EPERM = it exists but we can't signal it (treat as
    // alive so we never reap while the target is still up).
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function defaultSleep(ms: number): Promise<void> {
  // NOT unref'd: the polling delay is the guardian's only pending work between checks,
  // and unref'ing it would let the process exit mid-wait and abandon the watch.
  return new Promise((resolve) => setTimeout(resolve, ms));
}
