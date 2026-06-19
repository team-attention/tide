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
  await assertRuntimeEnvironmentApplied("gemini", "acp");
  await assertRuntimeEnvironmentApplied("opencode", "acp");
});

test("workspace_command_port_applies_cwd_runtime_environment_to_commands", async () => {
  const cwd = fs.mkdtempSync(path.join(tmpdir(), "tide-command-env-"));
  const envFile = path.join(cwd, "env.json");
  const resolverCalls: Array<{ cwd: string; planEnv: Record<string, string> }> = [];
  const port = createNodeWorkspaceCommandPort({
    resolveRuntimeEnvironment: (input) => {
      resolverCalls.push(input);
      return {
        ...process.env,
        PROJECT_ENV: "from-cwd-shell",
        COMMAND_ONLY: "visible-to-command",
      };
    },
  });

  const result = await port.run({
    command: process.execPath,
    args: [
      "-e",
      [
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.argv[1], JSON.stringify({",
        "  cwd: process.cwd(),",
        "  projectEnv: process.env.PROJECT_ENV,",
        "  commandOnly: process.env.COMMAND_ONLY,",
        "  explicit: process.env.EXPLICIT_COMMAND_ENV",
        "}));",
      ].join("\n"),
      envFile,
    ],
    cwd,
    env: { EXPLICIT_COMMAND_ENV: "plan-wins" },
    timeoutMs: 5000,
    byteLimit: 64_000,
    startedAt: new Date(0).toISOString(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.run.exitCode, 0);
  assert.equal(resolverCalls.length, 1);
  assert.equal(resolverCalls[0].cwd, cwd);
  assert.deepEqual(resolverCalls[0].planEnv, { EXPLICIT_COMMAND_ENV: "plan-wins" });
  const captured = JSON.parse(fs.readFileSync(envFile, "utf8")) as Record<string, string>;
  assert.equal(captured.cwd, fs.realpathSync(cwd));
  assert.equal(captured.projectEnv, "from-cwd-shell");
  assert.equal(captured.commandOnly, "visible-to-command");
  assert.equal(captured.explicit, "plan-wins");
  fs.rmSync(cwd, { recursive: true, force: true });
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
      runtimeId: process.env.TIDE_RUNTIME_ID
    }));
    setTimeout(() => {}, 200);
  `;
  const plan: ProviderLaunchPlan = {
    command: process.execPath,
    args: ["-e", captureScript, envFile],
    env: { TERM: "plan-term", TIDE_SOCKET: "plan-socket" },
    cwd,
    transport,
    expectedSignalSources: [{ kind: "provider_history", description: "test" }],
  };
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
      };
    },
  });

  const handle = await port.start({
    threadId: `thread-env-${agentId}`,
    agentBinding: { agentId },
    scope: { kind: "project", projectId: cwd, cwd },
    launchOptions: {},
    initialPrompt: "capture env",
  });
  await waitForFile(envFile);
  await port.stop(handle);

  const captured = JSON.parse(fs.readFileSync(envFile, "utf8")) as Record<string, string>;
  assert.equal(resolverCalls.length, 1);
  assert.equal(resolverCalls[0].cwd, cwd);
  assert.equal(resolverCalls[0].planEnv.TIDE_RUNTIME_ID, `runtime-env-${agentId}`);
  assert.equal(captured.cwd, fs.realpathSync(cwd));
  assert.equal(captured.projectEnv, "from-cwd-shell");
  assert.equal(captured.term, "plan-term");
  assert.equal(captured.tideSocket, "plan-socket");
  assert.equal(captured.runtimeId, `runtime-env-${agentId}`);
  fs.rmSync(cwd, { recursive: true, force: true });
}

function integrationRegistry(plan: ProviderLaunchPlan): AgentIntegrationRegistry {
  return {
    codex: fakeIntegration("codex", plan),
    claude: fakeIntegration("claude", plan),
    gemini: fakeIntegration("gemini", plan),
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
          supportsHiddenPty: true,
          supportsResume: true,
          supportsTideMcp: true,
          supportsHooks: true,
          supportsReadableHistory: true,
          requiresTerminalKeyProtocol: agentId === "claude",
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
