import { spawnSync } from "node:child_process";

// Belt-and-suspenders for the PTY-bridge parent-death watchdog: on a hard kill
// (force quit / crash / power loss) the watchdog may not get to run, leaving a
// Tide-spawned agent reparented to launchd (ppid 1) — antigravity in particular
// then spins CPU on its dead PTY. Every agent launch is tagged with TIDE_RUNTIME_ID
// in its environment, so at backend startup any process that BOTH carries that tag
// AND is orphaned (ppid 1) is a leftover from a dead session — never a live agent
// (a live one still has its PTY-bridge/backend parent, so ppid != 1). Reap them.

export interface ReapOrphanedAgentsDeps {
  // One line per process: "<pid> <ppid> <command + environment>".
  listProcesses?: () => string;
  kill?: (pid: number) => void;
  selfPid?: number;
}

export function reapOrphanedTideAgentProcesses(deps: ReapOrphanedAgentsDeps = {}): number {
  if (process.platform === "win32" && deps.listProcesses === undefined) {
    return 0;
  }
  const listProcesses = deps.listProcesses ?? defaultListProcesses;
  const kill = deps.kill ?? ((pid: number) => process.kill(pid, "SIGKILL"));
  const selfPid = deps.selfPid ?? process.pid;

  let reaped = 0;
  for (const line of listProcesses().split("\n")) {
    // The tag is injected only into agent launch environments (see the agent
    // runtime port), so a line carrying it is one of our spawned processes.
    if (!line.includes("TIDE_RUNTIME_ID=")) {
      continue;
    }
    const match = line.trim().match(/^(\d+)\s+(\d+)\b/);
    if (match === null) {
      continue;
    }
    const pid = Number.parseInt(match[1], 10);
    const ppid = Number.parseInt(match[2], 10);
    // ppid 1 == orphaned (reparented to launchd). A live session's agents still
    // have a live parent, so this never touches the current session.
    if (!Number.isInteger(pid) || pid === selfPid || ppid !== 1) {
      continue;
    }
    try {
      kill(pid);
      reaped += 1;
    } catch {
      // Already gone or not permitted — nothing to reap.
    }
  }
  return reaped;
}

function defaultListProcesses(): string {
  try {
    // -E appends each process's environment to the command column (macOS/BSD), so
    // the TIDE_RUNTIME_ID tag is visible; -ww prevents truncation.
    const result = spawnSync("ps", ["-axwwE", "-o", "pid=,ppid=,command="], {
      encoding: "utf8",
      timeout: 4000,
    });
    return typeof result.stdout === "string" ? result.stdout : "";
  } catch {
    return "";
  }
}
