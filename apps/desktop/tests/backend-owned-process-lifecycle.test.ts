// Spec: docs_v2/specs/backend-owned-process-lifecycle.md

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChildProcess } from "node:child_process";

import {
  createBackendOwnedProcessSpawner,
} from "../src/backend/infrastructure/node/process/backend-owned-process.ts";
import {
  reapOwnedProcessManifest,
} from "../src/backend/infrastructure/node/process/reap-owned-process-manifests.ts";
import {
  processListArgsWithEnvironment,
} from "../src/backend/infrastructure/node/process/process-observation.ts";

class FakeChild extends EventEmitter {
  readonly pid: number;
  readonly signals: NodeJS.Signals[] = [];
  exitOn?: NodeJS.Signals;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(signal);
    if (this.exitOn === signal) {
      queueMicrotask(() => this.emit("exit", null, signal));
    }
    return true;
  }
}

function fakeSpawn(child: FakeChild) {
  return (() => child as unknown as ChildProcess) as typeof import("node:child_process").spawn;
}

test("owned_process_stop_runs_provider_hook_then_awaits_natural_exit", async () => {
  const child = new FakeChild(4101);
  const order: string[] = [];
  const spawner = createBackendOwnedProcessSpawner({
    backendInstanceId: "backend-test",
    spawnImpl: fakeSpawn(child),
    platform: "win32",
    policy: { beforeSignalMs: 20, naturalExitMs: 20, termMs: 20, killMs: 20 },
  });
  const managed = spawner.spawn({
    resourceId: "runtime:codex:r1",
    kind: "agent_runtime",
    scope: { kind: "runtime", threadId: "t1", runtimeId: "r1", agentId: "codex" },
    command: "/bin/codex",
    args: ["app-server"],
    options: { stdio: "pipe" },
    beforeSignal: () => {
      order.push("hook");
      child.emit("exit", 0, null);
    },
  });

  const report = await managed.stop("runtime_stop");

  assert.deepEqual(order, ["hook"]);
  assert.deepEqual(child.signals, []);
  assert.equal(report.outcome, "exited");
  assert.equal(spawner.registry.activeSnapshots().length, 0);
});

test("owned_process_stop_escalates_once_and_concurrent_callers_share_result", async () => {
  const child = new FakeChild(4102);
  child.exitOn = "SIGKILL";
  const spawner = createBackendOwnedProcessSpawner({
    backendInstanceId: "backend-test",
    spawnImpl: fakeSpawn(child),
    platform: "win32",
    policy: { beforeSignalMs: 1, naturalExitMs: 1, termMs: 1, killMs: 20 },
  });
  const managed = spawner.spawn({
    resourceId: "runtime:claude:r2",
    kind: "agent_runtime",
    scope: { kind: "runtime", threadId: "t2", runtimeId: "r2", agentId: "claude" },
    command: "/bin/claude",
    args: ["--print"],
    options: { stdio: "pipe" },
  });

  const [first, second] = await Promise.all([
    managed.stop("runtime_stop"),
    managed.stop("backend_shutdown"),
  ]);

  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(first, second);
  assert.equal(first.escalatedTo, "SIGKILL");
});

test("registry_shutdown_quiesces_new_spawns_and_stops_every_active_child", async () => {
  let nextPid = 4200;
  const children: FakeChild[] = [];
  const spawner = createBackendOwnedProcessSpawner({
    backendInstanceId: "backend-test",
    platform: "win32",
    spawnImpl: (() => {
      const child = new FakeChild(nextPid++);
      child.exitOn = "SIGTERM";
      children.push(child);
      return child as unknown as ChildProcess;
    }) as typeof import("node:child_process").spawn,
    policy: { beforeSignalMs: 1, naturalExitMs: 1, termMs: 20, killMs: 20 },
  });
  for (const resourceId of ["runtime:codex:1", "helper:opencode-auth"]) {
    spawner.spawn({
      resourceId,
      kind: resourceId.startsWith("helper") ? "provider_helper" : "agent_runtime",
      scope: resourceId.startsWith("helper") ? { kind: "backend" } : {
        kind: "runtime", threadId: "t1", runtimeId: "r1", agentId: "codex",
      },
      command: "/bin/fake",
      args: [],
      options: { stdio: "pipe" },
    });
  }

  const reports = await spawner.shutdown();

  assert.equal(reports.length, 2);
  assert.ok(children.every((child) => child.signals[0] === "SIGTERM"));
  assert.throws(() => spawner.spawn({
    resourceId: "late",
    kind: "provider_helper",
    scope: { kind: "backend" },
    command: "/bin/fake",
    args: [],
    options: {},
  }), /shutting down/);
});

test("owner_manifest_contains_no_process_environment_or_command_output", () => {
  const root = mkdtempSync(join(tmpdir(), "tide-owned-process-test-"));
  const manifestPath = join(root, "backend.json");
  const child = new FakeChild(4301);
  const spawner = createBackendOwnedProcessSpawner({
    backendInstanceId: "backend-manifest",
    ownerPid: 999,
    manifestPath,
    spawnImpl: fakeSpawn(child),
    platform: "win32",
  });
  spawner.spawn({
    resourceId: "helper:opencode-auth",
    kind: "provider_helper",
    scope: { kind: "backend" },
    command: "/bin/opencode",
    args: ["serve", "--secret-not-recorded"],
    options: { env: { SUPER_SECRET_KEY: "secret" } },
  });

  const text = readFileSync(manifestPath, "utf8");
  assert.doesNotMatch(text, /SUPER_SECRET_KEY|secret-not-recorded/);
  assert.match(text, /helper:opencode-auth/);
  rmSync(root, { recursive: true, force: true });
});

test("manifest_persistence_failure_is_reported_without_crashing_registry_transitions", () => {
  const root = mkdtempSync(join(tmpdir(), "tide-owned-manifest-failure-test-"));
  const blockingFile = join(root, "not-a-directory");
  writeFileSync(blockingFile, "block");
  const errors: unknown[] = [];
  const child = new FakeChild(4302);
  const spawner = createBackendOwnedProcessSpawner({
    backendInstanceId: "backend-manifest-failure",
    manifestPath: join(blockingFile, "backend.json"),
    spawnImpl: fakeSpawn(child),
    platform: "win32",
    onManifestError: (error) => errors.push(error),
  });

  assert.doesNotThrow(() => spawner.spawn({
    resourceId: "helper:manifest-failure",
    kind: "provider_helper",
    scope: { kind: "backend" },
    command: "/bin/fake",
    args: [],
    options: {},
  }));
  assert.ok(errors.length >= 1);
  assert.equal(spawner.registry.activeSnapshots().length, 1);
  rmSync(root, { recursive: true, force: true });
});

test("process_observation_uses_platform_specific_environment_flags", () => {
  assert.deepEqual(processListArgsWithEnvironment("darwin"), [
    "-axwwE", "-o", "pid=,ppid=,pgid=,command=",
  ]);
  assert.deepEqual(processListArgsWithEnvironment("linux"), [
    "axwwe", "-o", "pid=,ppid=,pgid=,command=",
  ]);
  assert.equal(processListArgsWithEnvironment("win32"), undefined);
});

test("manifest_reaper_requires_dead_owner_and_exact_owner_token", () => {
  const root = mkdtempSync(join(tmpdir(), "tide-owned-reaper-test-"));
  const manifestPath = join(root, "backend.json");
  writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    backendInstanceId: "backend-dead",
    ownerPid: 99,
    processes: [{
      resourceId: "helper:opencode-auth",
      ownerToken: "token-exact",
      executable: "/bin/opencode",
      pid: 501,
      processGroupId: 501,
      treePolicy: "owned_tree",
    }],
  }));
  const killed: number[] = [];
  const processList = [
    "501 1 501 /bin/opencode serve TIDE_PROCESS_RESOURCE_ID=helper:opencode-auth TIDE_PROCESS_OWNER_TOKEN=token-exact",
    "502 1 502 /bin/opencode serve TIDE_PROCESS_RESOURCE_ID=helper:opencode-auth TIDE_PROCESS_OWNER_TOKEN=wrong",
  ].join("\n");

  const reaped = reapOwnedProcessManifest(manifestPath, {
    isAlive: () => false,
    listProcesses: () => processList,
    kill: (pid) => killed.push(pid),
    platform: "darwin",
  });

  assert.equal(reaped, 1);
  assert.deepEqual(killed, [-501]);
  rmSync(root, { recursive: true, force: true });
});

test("raw_long_lived_node_spawn_is_confined_to_owned_spawner_and_guardian", () => {
  const backendRoot = join(process.cwd(), "src", "backend");
  const files = walkTypeScriptFiles(backendRoot);
  const rawSpawnImports = files
    .filter((file) => /import\s*\{[^}]*\bspawn(?:\s+as\s+\w+)?\b[^}]*\}\s*from\s*["']node:child_process["']/.test(readFileSync(file, "utf8")))
    .map((file) => file.slice(backendRoot.length + 1))
    .sort();

  assert.deepEqual(rawSpawnImports, [
    "infrastructure/node/live/agent-reaper-guardian.ts",
    "infrastructure/node/process/backend-owned-process.ts",
  ]);

  const electronMain = readFileSync(
    join(process.cwd(), "src", "desktop", "infrastructure", "electron", "main", "electron-main.ts"),
    "utf8",
  );
  assert.doesNotMatch(electronMain, /backendProcess\?\.kill\(/);
  assert.match(electronMain, /shutdownBackendProcess\(\)/);
});

function walkTypeScriptFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory()
      ? walkTypeScriptFiles(path)
      : path.endsWith(".ts") ? [path] : [];
  });
}
