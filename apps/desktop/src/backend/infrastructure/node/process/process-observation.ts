import { spawnSync, type SpawnSyncReturns } from "node:child_process";

const PROCESS_COLUMNS = "pid=,ppid=,pgid=,command=";

export function processListArgsWithEnvironment(
  platform: NodeJS.Platform,
): string[] | undefined {
  if (platform === "win32") return undefined;
  return platform === "linux"
    ? ["axwwe", "-o", PROCESS_COLUMNS]
    : ["-axwwE", "-o", PROCESS_COLUMNS];
}

export function listProcessesWithEnvironment(
  platform: NodeJS.Platform = process.platform,
  spawn: typeof spawnSync = spawnSync,
): string {
  const args = processListArgsWithEnvironment(platform);
  if (args === undefined) return "";
  try {
    const result: SpawnSyncReturns<string> = spawn("ps", args, {
      encoding: "utf8",
      timeout: 4_000,
    });
    return typeof result.stdout === "string" ? result.stdout : "";
  } catch {
    return "";
  }
}
