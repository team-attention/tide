import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

interface ManifestProcess {
  resourceId: string;
  ownerToken: string;
  executable: string;
  pid?: number;
  processGroupId?: number;
  treePolicy: "owned_tree" | "root_only";
}

interface OwnedProcessManifest {
  schemaVersion: 1;
  backendInstanceId: string;
  ownerPid: number;
  processes: ManifestProcess[];
}

interface ProcessObservation {
  pid: number;
  ppid: number;
  pgid: number;
  command: string;
}

export interface ReapOwnedProcessManifestDeps {
  isAlive?: (pid: number) => boolean;
  listProcesses?: () => string;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  platform?: NodeJS.Platform;
}

export function ownedProcessManifestRoot(appDataRoot: string): string {
  return join(appDataRoot, "runtime", "owned-processes");
}

export function ownedProcessManifestPath(appDataRoot: string, backendInstanceId: string): string {
  const safeId = backendInstanceId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(ownedProcessManifestRoot(appDataRoot), `${safeId}.json`);
}

export function reapOwnedProcessManifest(
  manifestPath: string,
  deps: ReapOwnedProcessManifestDeps = {},
): number {
  const manifest = readManifest(manifestPath);
  if (manifest === undefined) return 0;
  const isAlive = deps.isAlive ?? defaultIsAlive;
  if (isAlive(manifest.ownerPid)) return 0;

  const observations = parseProcessObservations(
    (deps.listProcesses ?? defaultListProcesses)(),
  );
  const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
  const platform = deps.platform ?? process.platform;
  const killedTargets = new Set<number>();

  for (const resource of manifest.processes) {
    const marker = `TIDE_PROCESS_OWNER_TOKEN=${resource.ownerToken}`;
    const resourceMarker = `TIDE_PROCESS_RESOURCE_ID=${resource.resourceId}`;
    const candidates = observations.filter((observation) =>
      observation.command.includes(marker) && observation.command.includes(resourceMarker)
    );
    const direct = resource.pid === undefined
      ? undefined
      : candidates.find((candidate) => candidate.pid === resource.pid);
    if (direct !== undefined && !direct.command.includes(resource.executable)) {
      continue;
    }
    const groups = new Set<number>();
    if (resource.treePolicy === "owned_tree" && platform !== "win32") {
      for (const candidate of candidates) {
        if (candidate.pgid > 1) groups.add(candidate.pgid);
      }
      if (direct !== undefined && resource.processGroupId !== undefined) {
        groups.add(resource.processGroupId);
      }
    }
    const targets = groups.size > 0
      ? [...groups].map((pgid) => -pgid)
      : direct === undefined ? [] : [direct.pid];
    for (const target of targets) {
      if (killedTargets.has(target)) continue;
      try {
        kill(target, "SIGKILL");
        killedTargets.add(target);
      } catch {
        // Already gone or not permitted. Identity validation has still prevented
        // a name/PID-only kill.
      }
    }
  }

  rmSync(manifestPath, { force: true });
  return killedTargets.size;
}

export function reapStaleOwnedProcessManifests(
  root: string,
  deps: ReapOwnedProcessManifestDeps = {},
): number {
  let names: string[];
  try {
    names = readdirSync(root).filter((name) => name.endsWith(".json"));
  } catch {
    return 0;
  }
  return names.reduce(
    (total, name) => total + reapOwnedProcessManifest(join(root, name), deps),
    0,
  );
}

function readManifest(path: string): OwnedProcessManifest | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<OwnedProcessManifest>;
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.backendInstanceId !== "string" ||
      typeof parsed.ownerPid !== "number" ||
      !Array.isArray(parsed.processes)
    ) {
      return undefined;
    }
    return parsed as OwnedProcessManifest;
  } catch {
    return undefined;
  }
}

function parseProcessObservations(output: string): ProcessObservation[] {
  return output.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\s\S]+)$/);
    if (match === null) return [];
    return [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      command: match[4],
    }];
  });
}

function defaultListProcesses(): string {
  if (process.platform === "win32") return "";
  try {
    const result = spawnSync("ps", ["-axwwE", "-o", "pid=,ppid=,pgid=,command="], {
      encoding: "utf8",
      timeout: 4_000,
    });
    return typeof result.stdout === "string" ? result.stdout : "";
  } catch {
    return "";
  }
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
