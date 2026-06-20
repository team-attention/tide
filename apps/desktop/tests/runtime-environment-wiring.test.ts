import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAgentIntegrationAgentRuntimePort,
  type AgentIntegrationRegistry,
} from "../src/backend/adapters/outbound/agent-runtime/runtime-ports/agent-integration-agent-runtime-port.ts";
import type {
  AgentIntegrationPort,
  AgentIntegrationPreflightInput,
  AgentIntegrationPreflightResult,
  AgentResumePlanInput,
  AgentStartPlanInput,
  ProviderLaunchPlan,
} from "../src/backend/application/ports/outbound/agent-integration-port.ts";
import type { ProviderCliAgentId } from "../src/backend/application/domains/thread/thread.ts";

test("agent_runtime_port_applies_cwd_runtime_environment_to_all_structured_spawns", async () => {
  await assertRuntimeEnvironmentApplied("codex", "codex_app_server");
  await assertRuntimeEnvironmentApplied("claude", "claude_stream_json");
  await assertRuntimeEnvironmentApplied("gemini", "acp");
  await assertRuntimeEnvironmentApplied("opencode", "acp");
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
