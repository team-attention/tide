import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAgentIntegrationAgentRuntimePort,
  type AgentIntegrationRegistry,
} from "../src/backend/adapters/outbound/agent-runtime/runtime-ports/agent-integration-agent-runtime-port.ts";
import { createPtyWorkbenchTerminalPort } from "../src/backend/adapters/outbound/pty/workbench-terminal-pty-port.ts";
import { createNodeWorkspaceCommandPort } from "../src/backend/adapters/outbound/workspace-command/node-workspace-command-port.ts";
import type {
  AgentIntegrationPort,
  AgentIntegrationPreflightInput,
  AgentIntegrationPreflightResult,
  AgentResumePlanInput,
  AgentStartPlanInput,
  ProviderLaunchPlan,
} from "../src/backend/application/ports/outbound/agent-integration-port.ts";
import type {
  PtyProcessHandle,
  PtyProcessLauncher,
  PtyProcessSpawnInput,
} from "../src/backend/adapters/outbound/pty/pty-process.ts";
import type { ProviderCliAgentId } from "../src/backend/application/domains/thread/thread.ts";

test("agent_runtime_port_applies_cwd_runtime_environment_to_all_structured_spawns", async () => {
  await assertRuntimeEnvironmentApplied("codex", "codex_app_server");
  await assertRuntimeEnvironmentApplied("claude", "claude_stream_json");
  await assertRuntimeEnvironmentApplied("opencode", "acp");
});

test("workspace_command_port_only_resolves_cwd_inside_the_thread_root", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "tide-command-cwd-"));
  const port = createNodeWorkspaceCommandPort();

  const inside = await port.resolveCwd({ root, cwd: "." });
  const outside = await port.resolveCwd({ root, cwd: "../outside" });

  assert.equal(inside.ok, true);
  assert.equal(inside.ok && inside.cwd.cwd, path.resolve(root));
  assert.equal(outside.ok, false);
  assert.equal(!outside.ok && outside.error.code, "workspace_command_outside_scope");
  fs.rmSync(root, { recursive: true, force: true });
});

test("workbench_terminal_port_applies_cwd_runtime_environment_without_overriding_terminal_plan_env", async () => {
  const launcher = new CapturingPtyLauncher();
  const resolverCalls: Array<{ cwd: string; planEnv: Record<string, string> }> = [];
  const port = createPtyWorkbenchTerminalPort({
    launcher,
    resolveRuntimeEnvironment: (input) => {
      resolverCalls.push(input);
      return {
        PROJECT_ENV: "from-cwd-shell",
        TERM: "shell-term",
        COLORTERM: "shell-color",
      };
    },
  });

  await port.start({
    threadId: "thread-terminal-env",
    paneId: "pane-terminal-env",
    command: "zsh",
    args: ["-l"],
    cwd: "/repo/tide",
    env: { EXPLICIT_TERMINAL_ENV: "plan-wins" },
  });

  assert.equal(resolverCalls.length, 1);
  assert.equal(resolverCalls[0].cwd, "/repo/tide");
  assert.equal(resolverCalls[0].planEnv.TERM, "xterm-256color");
  assert.equal(resolverCalls[0].planEnv.EXPLICIT_TERMINAL_ENV, "plan-wins");
  assert.equal(launcher.spawns.length, 1);
  const env = launcher.spawns[0].plan.env;
  assert.equal(env.PROJECT_ENV, "from-cwd-shell");
  assert.equal(env.EXPLICIT_TERMINAL_ENV, "plan-wins");
  assert.equal(env.TERM, "xterm-256color");
  assert.equal(env.COLORTERM, "truecolor");
});

async function assertRuntimeEnvironmentApplied(
  agentId: ProviderCliAgentId,
  transport: NonNullable<ProviderLaunchPlan["transport"]>,
): Promise<void> {
  const cwd = fs.mkdtempSync(path.join(tmpdir(), "tide-runtime-env-"));
  const envFile = path.join(cwd, "env.json");
  const captureScript = `
    const fs = require("node:fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      cwd: process.cwd(),
      projectEnv: process.env.PROJECT_ENV,
      term: process.env.TERM,
      tideSocket: process.env.TIDE_SOCKET,
      tideAppDataRoot: process.env.TIDE_APP_DATA_ROOT,
      tideBin: process.env.TIDE_BIN,
      electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE,
      runtimeId: process.env.TIDE_RUNTIME_ID
    }));
    setTimeout(() => {}, 200);
  `;
  const plan: ProviderLaunchPlan = {
    command: process.execPath,
    args: ["-e", captureScript, envFile],
    env: {
      TERM: "plan-term",
      TIDE_SOCKET: "plan-socket",
      TIDE_APP_DATA_ROOT: "/wrong-plan-data-root",
      ELECTRON_RUN_AS_NODE: "1",
    },
    cwd,
    transport,
  };
  const oldAppDataRoot = process.env.TIDE_APP_DATA_ROOT;
  const oldTideBin = process.env.TIDE_BIN;
  const oldElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
  process.env.TIDE_APP_DATA_ROOT = "/wrong-process-data-root";
  process.env.TIDE_BIN = "/wrong/tide";
  process.env.ELECTRON_RUN_AS_NODE = "1";
  const resolverCalls: Array<{ cwd: string; planEnv: Record<string, string> }> = [];
  const port = createAgentIntegrationAgentRuntimePort({
    integrations: integrationRegistry(plan),
    idGenerator: () => `runtime-env-${agentId}`,
    resolveRuntimeEnvironment: (input) => {
      resolverCalls.push(input);
      return {
        PROJECT_ENV: "from-cwd-shell",
        TERM: "shell-term",
        TIDE_SOCKET: "shell-socket",
        TIDE_APP_DATA_ROOT: "/wrong-shell-data-root",
        TIDE_BIN: "/wrong-shell-tide",
        ELECTRON_RUN_AS_NODE: "1",
      };
    },
  });

  try {
    const handle = await port.start({
      threadId: `thread-env-${agentId}`,
      agentBinding: { agentId },
      scope: { kind: "project", projectId: cwd, cwd },
      launchOptions: {},
      initialPrompt: "capture env",
    });
    await waitForFile(envFile);
    await port.stop(handle);
  } finally {
    restoreEnv("TIDE_APP_DATA_ROOT", oldAppDataRoot);
    restoreEnv("TIDE_BIN", oldTideBin);
    restoreEnv("ELECTRON_RUN_AS_NODE", oldElectronRunAsNode);
  }

  const captured = JSON.parse(fs.readFileSync(envFile, "utf8")) as Record<string, string>;
  assert.equal(resolverCalls.length, 1);
  assert.equal(resolverCalls[0].cwd, cwd);
  assert.equal(resolverCalls[0].planEnv.TIDE_RUNTIME_ID, `runtime-env-${agentId}`);
  assert.equal(captured.cwd, fs.realpathSync(cwd));
  assert.equal(captured.projectEnv, "from-cwd-shell");
  assert.equal(captured.term, "plan-term");
  assert.equal(captured.tideSocket, undefined);
  assert.equal(captured.tideAppDataRoot, undefined);
  assert.equal(captured.tideBin, undefined);
  assert.equal(captured.electronRunAsNode, undefined);
  assert.equal(captured.runtimeId, `runtime-env-${agentId}`);
  fs.rmSync(cwd, { recursive: true, force: true });
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function integrationRegistry(plan: ProviderLaunchPlan): AgentIntegrationRegistry {
  return {
    codex: fakeIntegration("codex", plan),
    claude: fakeIntegration("claude", plan),
    opencode: fakeIntegration("opencode", plan),
  };
}

class CapturingPtyLauncher implements PtyProcessLauncher {
  readonly spawns: PtyProcessSpawnInput[] = [];

  async spawn(input: PtyProcessSpawnInput): Promise<PtyProcessHandle> {
    this.spawns.push(input);
    return {
      runtimeId: input.runtimeId,
      write: () => {},
      stop: () => {},
    };
  }
}

function fakeIntegration(
  agentId: ProviderCliAgentId,
  plan: ProviderLaunchPlan,
): AgentIntegrationPort {
  return {
    async preflight(input: AgentIntegrationPreflightInput): Promise<AgentIntegrationPreflightResult> {
      return {
        agentId: input.agentId,
        ready: true,
        blockers: [],
        capabilities: {
          supportsResume: true,
          supportsTideMcp: true,
          supportsHooks: true,
          supportsReadableHistory: true,
          supportsTurnSteer: agentId === "codex",
        },
        launchPlan: plan,
      };
    },
    async buildStartPlan(_input: AgentStartPlanInput): Promise<ProviderLaunchPlan> {
      return plan;
    },
    async buildResumePlan(_input: AgentResumePlanInput): Promise<ProviderLaunchPlan> {
      return plan;
    },
  };
}

async function waitForFile(filePath: string, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}
