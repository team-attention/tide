import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createAntigravityAgentIntegration,
  type AntigravityProviderState,
} from "../src/backend/adapters/outbound/agent-integrations/antigravity/antigravity-agent-integration.ts";
import type {
  AgentIntegrationPreflightInput,
  ProviderSessionRef,
} from "../src/backend/application/ports/outbound/agent-integration-port.ts";

// Spec: docs_v2/specs/provider-integration-bootstrap.md

const projectScope = {
  kind: "project" as const,
  projectId: "project-1",
  cwd: "/repo",
};
const basePreflightInput: AgentIntegrationPreflightInput = {
  agentId: "antigravity",
  scope: projectScope,
};

test("antigravity_preflight_reports_not_installed_when_agy_executable_is_missing", async () => {
  const integration = antigravityIntegration({
    executablePath: undefined,
    providerState: readyAntigravityState(),
  });

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, false);
  assert.equal(result.blockers[0]?.kind, "not_installed");
  assert.equal(result.launchPlan, undefined);
});

test("antigravity_preflight_reports_auth_onboarding_directory_trust_and_plugin_bootstrap_blockers", async () => {
  const integration = antigravityIntegration({
    providerState: readyAntigravityState({
      authenticated: false,
      onboardingComplete: false,
      trustedCwds: ["/trusted-repo"],
      pluginBootstrapReady: false,
    }),
  });

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, false);
  assert.deepEqual(
    result.blockers.map((blocker) => [blocker.kind, blocker.scope]),
    [
      ["not_authenticated", "provider"],
      ["onboarding_required", "provider"],
      ["directory_trust_required", "execution_context"],
      ["hook_bootstrap_required", "integration"],
    ],
  );
  assert.equal(result.blockers[2]?.setup?.command, "/usr/local/bin/agy");
  assert.equal(result.blockers[2]?.setup?.cwd, "/repo");
  assert.deepEqual(result.blockers[3]?.setup?.args, [
    "plugin",
    "install",
    "/Applications/Tide.app/Contents/Resources/antigravity/tide-bootstrap",
  ]);
  assert.equal(result.launchPlan, undefined);
});

test("antigravity_ready_preflight_returns_hidden_pty_start_plan_with_plugin_mcp_hooks_and_terminal_env", async () => {
  const integration = antigravityIntegration();

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, true);
  assert.equal(result.capabilities.supportsTideMcp, true);
  assert.equal(result.capabilities.requiresTerminalKeyProtocol, true);
  assert.equal(result.launchPlan?.command, "/usr/local/bin/agy");
  assert.deepEqual(result.launchPlan?.args, []);
  assert.equal(result.launchPlan?.cwd, "/repo");
  assert.equal(result.launchPlan?.env.TERM, "xterm-256color");
  assert.equal(result.launchPlan?.env.COLORTERM, "truecolor");
  assert.deepEqual(result.launchPlan?.inputTiming, {
    startupDelayMs: 7000,
    preSubmitDelayMs: 500,
  });
  assert.deepEqual(
    result.launchPlan?.expectedSignalSources.map((source) => source.kind),
    ["pty_transcript", "provider_hook", "provider_history", "tide_mcp"],
  );
});

test("antigravity_launch_plan_applies_provider_native_permission_flags", async () => {
  const integration = antigravityIntegration();

  const sandboxPlan = await integration.buildStartPlan({
    agentId: "antigravity",
    scope: projectScope,
    launchOptions: {
      model: "Antigravity default",
      permission: "sandbox",
    },
  });
  const unsafePlan = await integration.buildStartPlan({
    agentId: "antigravity",
    scope: projectScope,
    launchOptions: {
      model: "Antigravity default",
      permission: "dangerously-skip-permissions",
    },
  });

  assert.deepEqual(sandboxPlan.args, ["--sandbox"]);
  assert.deepEqual(unsafePlan.args, ["--dangerously-skip-permissions"]);
});

test("antigravity_resume_plan_uses_provider_native_conversation_ref", async () => {
  const integration = antigravityIntegration();
  const providerSessionRef: ProviderSessionRef = {
    kind: "antigravity_conversation",
    value: "ede860c4-e4ee-4f61-8017-29598b924020",
    transcriptPath:
      "/Users/example/.gemini/antigravity-cli/brain/ede860c4-e4ee-4f61-8017-29598b924020/.system_generated/logs/transcript.jsonl",
  };

  const plan = await integration.buildResumePlan({
    agentId: "antigravity",
    providerSessionRef,
    scope: projectScope,
  });

  assert.deepEqual(plan.args, [
    "--conversation",
    "ede860c4-e4ee-4f61-8017-29598b924020",
  ]);
  assert.equal(plan.cwd, "/repo");
});

test("antigravity_launch_plan_does_not_use_print_prompt_interactive_or_gemini_runtime", async () => {
  const integration = antigravityIntegration();

  const result = await integration.preflight(basePreflightInput);
  const args = result.launchPlan?.args ?? [];
  const joinedArgs = args.join(" ");

  assert.equal(args.includes("--print"), false);
  assert.equal(args.includes("-p"), false);
  assert.equal(args.includes("--prompt"), false);
  assert.equal(args.includes("--prompt-interactive"), false);
  assert.equal(args.includes("-i"), false);
  assert.equal(joinedArgs.includes("stream-json"), false);
  assert.equal(joinedArgs.includes("gemini"), false);
  assert.equal(args.includes("app-server"), false);
});

test("antigravity_launch_plan_does_not_use_gemini_settings_for_mcp", async () => {
  const integration = antigravityIntegration();

  const result = await integration.preflight(basePreflightInput);
  const plan = result.launchPlan;

  assert.ok(plan);
  assert.equal(plan.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH, undefined);
  assert.equal(JSON.stringify(plan.args).includes("settings.json"), false);
  assert.equal(JSON.stringify(plan.args).includes("gemini"), false);
});

test("antigravity_permission_prompt_detection_uses_pretooluse_run_command_payload", () => {
  const integration = antigravityIntegration();

  const prompt = integration.detectPromptState({
    threadId: "thread-1",
    source: "provider_hook",
    eventName: "PreToolUse",
    payload: {
      conversationId: "ede860c4-e4ee-4f61-8017-29598b924020",
      stepIdx: 3,
      toolCall: {
        name: "run_command",
        args: {
          CommandLine: "python3 -c 'print(\"AGY_TOOL_ALLOW_FIXTURE\")'",
        },
      },
    },
  });
  const rawPtyPrompt = integration.detectPromptState({
    threadId: "thread-1",
    source: "pty_transcript",
    text: "Requesting permission for: python3 -c 'print(\"AGY_TOOL_ALLOW_FIXTURE\")'",
  });
  const directShellPreToolUse = integration.detectPromptState({
    threadId: "thread-1",
    source: "provider_hook",
    eventName: "PreToolUse",
    payload: {
      toolCall: {
        name: "shell",
        args: {
          CommandLine: "python3 -c 'print(\"AGY_TOOL_ALLOW_FIXTURE\")'",
        },
      },
    },
  });

  assert.equal(prompt?.kind, "permission");
  assert.equal(prompt?.source, "provider_hook");
  assert.equal(
    prompt?.message,
    "python3 -c 'print(\"AGY_TOOL_ALLOW_FIXTURE\")'",
  );
  assert.equal(rawPtyPrompt, null);
  assert.equal(directShellPreToolUse, null);
});

test("backend_application_does_not_import_antigravity_adapter_or_shared_contracts", () => {
  assert.deepEqual(
    findSourceMentions(["src/backend/application"], [
      /from\s+["'][^"']*agent-integrations\/antigravity/,
      /import\(["'][^"']*agent-integrations\/antigravity/,
      /from\s+["'][^"']*shared\/contracts/,
      /import\(["'][^"']*shared\/contracts/,
    ]),
    [],
  );
});

test("antigravity_provider_specific_agent_integration_stays_under_backend_adapters", () => {
  assert.deepEqual(
    findSourceMentions(["src/desktop", "src/shared/contracts"], [
      /agent-integrations\/antigravity/,
      /antigravity-agent-integration/,
      /createAntigravityAgentIntegration/,
    ]),
    [],
  );
});

test("antigravity_turn_end_from_transcript_terminal_planner_response", () => {
  const integration = antigravityIntegration();
  // Antigravity has no turn-end hook; its turn-end + final answer come from the
  // transcript's terminal PLANNER_RESPONSE (content, no tool_calls).
  assert.equal(integration.turnEndFromHook("agent-running", {}), null);
  const transcript = [
    JSON.stringify({ source: "USER", type: "USER_INPUT", content: "hi" }),
    JSON.stringify({ source: "MODEL", type: "PLANNER_RESPONSE", content: "the reply", tool_calls: [] }),
  ].join("\n");
  assert.deepEqual(integration.turnEndFromHistory(transcript, undefined), {
    finalMessage: "the reply",
  });
  // A PLANNER_RESPONSE that still has tool_calls is mid-turn, not the end.
  const midTurn = JSON.stringify({
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    content: "calling a tool",
    tool_calls: [{ name: "x" }],
  });
  assert.equal(integration.turnEndFromHistory(midTurn, undefined), null);
});

function antigravityIntegration(options: {
  executablePath?: string;
  providerState?: AntigravityProviderState;
} = {}) {
  const executablePath = Object.hasOwn(options, "executablePath")
    ? options.executablePath
    : "/usr/local/bin/agy";

  return createAntigravityAgentIntegration({
    resolveExecutable: async () => executablePath,
    readProviderState: async () =>
      options.providerState ?? readyAntigravityState(),
    tidePlugin: {
      installSourcePath:
        "/Applications/Tide.app/Contents/Resources/antigravity/tide-bootstrap",
    },
  });
}

function readyAntigravityState(
  overrides: Partial<AntigravityProviderState> = {},
): AntigravityProviderState {
  return {
    authenticated: true,
    onboardingComplete: true,
    trustedCwds: ["/repo"],
    pluginBootstrapReady: true,
    ...overrides,
  };
}

function findSourceMentions(relativeRoots: string[], patterns: RegExp[]): string[] {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const violations: string[] = [];

  for (const relativeRoot of relativeRoots) {
    const absoluteRoot = path.join(repoRoot, relativeRoot);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }
    for (const filePath of sourceFiles(absoluteRoot)) {
      const source = fs.readFileSync(filePath, "utf8");
      if (patterns.some((pattern) => pattern.test(source))) {
        violations.push(path.relative(repoRoot, filePath));
      }
    }
  }

  return violations.sort();
}

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(fullPath));
      continue;
    }
    if (/\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}
