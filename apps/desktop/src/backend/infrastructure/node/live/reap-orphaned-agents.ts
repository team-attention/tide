import { spawnSync } from "node:child_process";

// Compatibility cleanup for children launched before exact owner manifests.
// New managed processes carry TIDE_PROCESS_OWNER_TOKEN and are exclusively
// reclaimed by their owner-scoped manifest. Keeping the two authorities disjoint
// prevents this broad legacy sweep from killing a managed descendant merely
// because it inherited TIDE_RUNTIME_ID.

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
    // TIDE_RUNTIME_ID is sufficient only for pre-manifest children. A process
    // with the new owner token must be validated by the exact manifest reaper.
    if (!line.includes("TIDE_RUNTIME_ID=") || line.includes("TIDE_PROCESS_OWNER_TOKEN=")) {
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
