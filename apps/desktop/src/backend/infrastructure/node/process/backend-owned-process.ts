import { randomUUID } from "node:crypto";
import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import {
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export type BackendOwnedProcessKind =
  | "agent_runtime"
  | "provider_helper"
  | "command_probe"
  | "language_server"
  | "workbench_terminal";

export type BackendOwnedProcessScope =
  | { kind: "backend" }
  | { kind: "runtime"; threadId: string; runtimeId: string; agentId: string }
  | { kind: "workspace"; cwd: string }
  | { kind: "pane"; threadId: string; paneId: string }
  | { kind: "operation"; operationId: string };

export type BackendOwnedProcessState =
  | "planned"
  | "active"
  | "stopping"
  | "released"
  | "failed"
  | "indeterminate";

export type BackendOwnedProcessTreePolicy = "owned_tree" | "root_only";
export type BackendOwnedProcessStopReason =
  | "runtime_stop"
  | "duplicate_runtime"
  | "readiness_failed"
  | "idle_expired"
  | "backend_shutdown";

export interface BackendOwnedProcessExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface BackendOwnedProcessSnapshot {
  backendInstanceId: string;
  ownerPid: number;
  resourceId: string;
  ownerToken: string;
  kind: BackendOwnedProcessKind;
  scope: BackendOwnedProcessScope;
  state: BackendOwnedProcessState;
  executable: string;
  pid?: number;
  processGroupId?: number;
  treePolicy: BackendOwnedProcessTreePolicy;
  createdAt: string;
  updatedAt: string;
  exit?: BackendOwnedProcessExit;
  failure?: { code: string; message: string };
}

export interface BackendOwnedProcessStopReport {
  resourceId: string;
  outcome: "exited" | "already_exited" | "indeterminate";
  escalatedTo?: "SIGTERM" | "SIGKILL";
  exit?: BackendOwnedProcessExit;
}

export interface ManagedBackendOwnedProcess {
  readonly child: ChildProcess;
  readonly snapshot: BackendOwnedProcessSnapshot;
  readonly exited: Promise<BackendOwnedProcessExit>;
  stop(reason: BackendOwnedProcessStopReason): Promise<BackendOwnedProcessStopReport>;
}

export interface BackendOwnedProcessSpawnInput {
  resourceId: string;
  kind: BackendOwnedProcessKind;
  scope: BackendOwnedProcessScope;
  command: string;
  args: string[];
  options: SpawnOptions;
  treePolicy?: BackendOwnedProcessTreePolicy;
  beforeSignal?: (reason: BackendOwnedProcessStopReason) => Promise<void> | void;
}

export interface BackendOwnedProcessSpawner {
  readonly registry: BackendOwnedProcessRegistry;
  spawn(input: BackendOwnedProcessSpawnInput): ManagedBackendOwnedProcess;
  shutdown(reason?: BackendOwnedProcessStopReason): Promise<BackendOwnedProcessStopReport[]>;
}

interface RegistryEntry {
  snapshot: BackendOwnedProcessSnapshot;
  stop?: (reason: BackendOwnedProcessStopReason) => Promise<BackendOwnedProcessStopReport>;
}

export class BackendOwnedProcessRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private quiescing = false;
  private shutdownPromise?: Promise<BackendOwnedProcessStopReport[]>;
  private readonly onChange?: (snapshots: readonly BackendOwnedProcessSnapshot[]) => void;

  constructor(onChange?: (snapshots: readonly BackendOwnedProcessSnapshot[]) => void) {
    this.onChange = onChange;
  }

  plan(snapshot: BackendOwnedProcessSnapshot): void {
    if (this.quiescing) {
      throw new Error("Backend process registry is shutting down.");
    }
    const existing = this.entries.get(snapshot.resourceId);
    if (existing !== undefined && (
      existing.snapshot.state === "planned" ||
      existing.snapshot.state === "active" ||
      existing.snapshot.state === "stopping" ||
      existing.snapshot.state === "indeterminate"
    )) {
      throw new Error(`Owned process resource already exists: ${snapshot.resourceId}`);
    }
    this.entries.set(snapshot.resourceId, { snapshot });
    this.changed();
  }

  bind(
    resourceId: string,
    binding: { pid?: number; processGroupId?: number },
    stop: RegistryEntry["stop"],
  ): void {
    const entry = this.entryFor(resourceId);
    entry.snapshot = {
      ...entry.snapshot,
      state: "active",
      ...(binding.pid === undefined ? {} : { pid: binding.pid }),
      ...(binding.processGroupId === undefined ? {} : { processGroupId: binding.processGroupId }),
      updatedAt: new Date().toISOString(),
    };
    entry.stop = stop;
    this.changed();
  }

  markStopping(resourceId: string): void {
    const entry = this.entries.get(resourceId);
    if (entry === undefined || entry.snapshot.state === "released") return;
    entry.snapshot = { ...entry.snapshot, state: "stopping", updatedAt: new Date().toISOString() };
    this.changed();
  }

  markExited(resourceId: string, exit: BackendOwnedProcessExit): void {
    const entry = this.entries.get(resourceId);
    if (entry === undefined) return;
    entry.snapshot = {
      ...entry.snapshot,
      state: "released",
      exit,
      updatedAt: new Date().toISOString(),
    };
    this.changed();
  }

  markFailed(resourceId: string, code: string, message: string): void {
    const entry = this.entries.get(resourceId);
    if (entry === undefined) return;
    entry.snapshot = {
      ...entry.snapshot,
      state: "failed",
      failure: { code, message },
      updatedAt: new Date().toISOString(),
    };
    this.changed();
  }

  markIndeterminate(resourceId: string, message: string): void {
    const entry = this.entries.get(resourceId);
    if (entry === undefined) return;
    entry.snapshot = {
      ...entry.snapshot,
      state: "indeterminate",
      failure: { code: "exit_unconfirmed", message },
      updatedAt: new Date().toISOString(),
    };
    this.changed();
  }

  snapshots(): readonly BackendOwnedProcessSnapshot[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.snapshot }));
  }

  activeSnapshots(): readonly BackendOwnedProcessSnapshot[] {
    return this.snapshots().filter((entry) =>
      entry.state === "planned" || entry.state === "active" || entry.state === "stopping" || entry.state === "indeterminate"
    );
  }

  shutdown(
    reason: BackendOwnedProcessStopReason = "backend_shutdown",
  ): Promise<BackendOwnedProcessStopReport[]> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    this.quiescing = true;
    const stops = [...this.entries.values()]
      .filter((entry) => entry.stop !== undefined && entry.snapshot.state !== "released")
      .map((entry) => entry.stop!(reason));
    this.shutdownPromise = Promise.allSettled(stops).then((results) =>
      results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
    );
    return this.shutdownPromise;
  }

  private entryFor(resourceId: string): RegistryEntry {
    const entry = this.entries.get(resourceId);
    if (entry === undefined) throw new Error(`Unknown owned process resource: ${resourceId}`);
    return entry;
  }

  private changed(): void {
    this.onChange?.(this.snapshots());
  }
}

export interface CreateBackendOwnedProcessSpawnerInput {
  backendInstanceId: string;
  ownerPid?: number;
  registry?: BackendOwnedProcessRegistry;
  manifestPath?: string;
  spawnImpl?: typeof nodeSpawn;
  platform?: NodeJS.Platform;
  policy?: Partial<{
    beforeSignalMs: number;
    naturalExitMs: number;
    termMs: number;
    killMs: number;
  }>;
}

const DEFAULT_POLICY = {
  beforeSignalMs: 500,
  naturalExitMs: 50,
  termMs: 1_500,
  killMs: 500,
};

export function createBackendOwnedProcessSpawner(
  input: CreateBackendOwnedProcessSpawnerInput,
): BackendOwnedProcessSpawner {
  const platform = input.platform ?? process.platform;
  const ownerPid = input.ownerPid ?? process.pid;
  const registry = input.registry ?? new BackendOwnedProcessRegistry(
    input.manifestPath === undefined
      ? undefined
      : (snapshots) => writeOwnedProcessManifest(input.manifestPath!, input.backendInstanceId, ownerPid, snapshots),
  );
  const spawnImpl = input.spawnImpl ?? nodeSpawn;
  const policy = { ...DEFAULT_POLICY, ...input.policy };

  return {
    registry,
    spawn(spawnInput) {
      const now = new Date().toISOString();
      const ownerToken = randomUUID();
      const treePolicy = spawnInput.treePolicy ?? "owned_tree";
      const snapshot: BackendOwnedProcessSnapshot = {
        backendInstanceId: input.backendInstanceId,
        ownerPid,
        resourceId: spawnInput.resourceId,
        ownerToken,
        kind: spawnInput.kind,
        scope: spawnInput.scope,
        state: "planned",
        executable: spawnInput.command,
        treePolicy,
        createdAt: now,
        updatedAt: now,
      };
      registry.plan(snapshot);

      let child: ChildProcess;
      try {
        child = spawnImpl(spawnInput.command, spawnInput.args, {
          ...spawnInput.options,
          detached: treePolicy === "owned_tree" && platform !== "win32",
          env: {
            ...(spawnInput.options.env ?? process.env),
            TIDE_PROCESS_OWNER_ID: input.backendInstanceId,
            TIDE_PROCESS_OWNER_PID: String(ownerPid),
            TIDE_PROCESS_RESOURCE_ID: spawnInput.resourceId,
            TIDE_PROCESS_OWNER_TOKEN: ownerToken,
          },
        });
      } catch (error) {
        registry.markFailed(
          spawnInput.resourceId,
          "spawn_failed",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }

      const pid = child.pid;

      let exitValue: BackendOwnedProcessExit | undefined;
      let resolveExit!: (exit: BackendOwnedProcessExit) => void;
      const exited = new Promise<BackendOwnedProcessExit>((resolve) => {
        resolveExit = resolve;
      });
      const settleExit = (exit: BackendOwnedProcessExit, markReleased = true): void => {
        if (exitValue !== undefined) return;
        exitValue = exit;
        if (markReleased) registry.markExited(spawnInput.resourceId, exit);
        resolveExit(exit);
      };
      child.once("exit", (code, signal) => settleExit({ exitCode: code, signal }));
      child.once("error", (error) => {
        registry.markFailed(spawnInput.resourceId, "spawn_failed", error.message);
        settleExit({ exitCode: null, signal: null }, false);
      });

      let stopPromise: Promise<BackendOwnedProcessStopReport> | undefined;
      const managed: ManagedBackendOwnedProcess = {
        child,
        snapshot,
        exited,
        stop(reason) {
          if (stopPromise !== undefined) return stopPromise;
          stopPromise = (async () => {
            if (exitValue !== undefined) {
              return { resourceId: spawnInput.resourceId, outcome: "already_exited", exit: exitValue };
            }
            registry.markStopping(spawnInput.resourceId);
            if (spawnInput.beforeSignal !== undefined) {
              await bounded(spawnInput.beforeSignal(reason), policy.beforeSignalMs);
            }
            const natural = await observeExit(exited, policy.naturalExitMs);
            if (natural !== undefined) {
              return { resourceId: spawnInput.resourceId, outcome: "exited", exit: natural };
            }
            signalOwnedProcess(child, pid, treePolicy, platform, "SIGTERM");
            const terminated = await observeExit(exited, policy.termMs);
            if (terminated !== undefined) {
              return {
                resourceId: spawnInput.resourceId,
                outcome: "exited",
                escalatedTo: "SIGTERM",
                exit: terminated,
              };
            }
            signalOwnedProcess(child, pid, treePolicy, platform, "SIGKILL");
            const killed = await observeExit(exited, policy.killMs);
            if (killed !== undefined) {
              return {
                resourceId: spawnInput.resourceId,
                outcome: "exited",
                escalatedTo: "SIGKILL",
                exit: killed,
              };
            }
            registry.markIndeterminate(spawnInput.resourceId, "Process exit was not observed after SIGKILL.");
            return {
              resourceId: spawnInput.resourceId,
              outcome: "indeterminate",
              escalatedTo: "SIGKILL",
            };
          })();
          return stopPromise;
        },
      };

      registry.bind(
        spawnInput.resourceId,
        {
          ...(pid === undefined ? {} : { pid }),
          ...(pid !== undefined && treePolicy === "owned_tree" && platform !== "win32"
            ? { processGroupId: pid }
            : {}),
        },
        (reason) => managed.stop(reason),
      );
      return managed;
    },
    shutdown(reason = "backend_shutdown") {
      return registry.shutdown(reason);
    },
  };
}

export function createStandaloneOwnedProcessSpawner(): BackendOwnedProcessSpawner {
  return createBackendOwnedProcessSpawner({
    backendInstanceId: `standalone-${process.pid}-${randomUUID()}`,
  });
}

function signalOwnedProcess(
  child: ChildProcess,
  pid: number | undefined,
  treePolicy: BackendOwnedProcessTreePolicy,
  platform: NodeJS.Platform,
  signal: NodeJS.Signals,
): void {
  try {
    if (pid !== undefined && treePolicy === "owned_tree" && platform !== "win32") {
      process.kill(-pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Exit observation or the final deadline decides the result.
    }
  }
}

async function bounded(value: Promise<void> | void, timeoutMs: number): Promise<void> {
  await Promise.race([
    Promise.resolve(value).catch(() => undefined),
    delay(timeoutMs),
  ]);
}

async function observeExit(
  exited: Promise<BackendOwnedProcessExit>,
  timeoutMs: number,
): Promise<BackendOwnedProcessExit | undefined> {
  return Promise.race([
    exited,
    delay(timeoutMs).then(() => undefined),
  ]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    timer.unref?.();
  });
}

interface OwnedProcessManifest {
  schemaVersion: 1;
  backendInstanceId: string;
  ownerPid: number;
  updatedAt: string;
  processes: BackendOwnedProcessSnapshot[];
}

function writeOwnedProcessManifest(
  path: string,
  backendInstanceId: string,
  ownerPid: number,
  snapshots: readonly BackendOwnedProcessSnapshot[],
): void {
  const active = snapshots.filter((snapshot) =>
    snapshot.state === "planned" || snapshot.state === "active" || snapshot.state === "stopping" || snapshot.state === "indeterminate"
  );
  if (active.length === 0) {
    rmSync(path, { force: true });
    return;
  }
  const manifest: OwnedProcessManifest = {
    schemaVersion: 1,
    backendInstanceId,
    ownerPid,
    updatedAt: new Date().toISOString(),
    processes: active.map((snapshot) => ({ ...snapshot })),
  };
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}
