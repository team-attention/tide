import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createClaudeAgentIntegration,
  type ClaudeProviderState,
} from "../src/backend/adapters/outbound/agent-integrations/claude/claude-agent-integration.ts";
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
  agentId: "claude",
  scope: projectScope,
};

test("claude_preflight_reports_not_installed_when_claude_executable_is_missing", async () => {
  const integration = claudeIntegration({
    executablePath: undefined,
    providerState: readyClaudeState(),
  });

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, false);
  assert.equal(result.blockers[0]?.kind, "not_installed");
  assert.equal(result.launchPlan, undefined);
});

test("claude_preflight_reports_auth_onboarding_directory_trust_and_hook_bootstrap_blockers", async () => {
  const integration = claudeIntegration({
    providerState: readyClaudeState({
      authenticated: false,
      onboardingComplete: false,
      trustedCwds: ["/trusted-repo"],
      hookBootstrapReady: false,
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
  assert.equal(result.blockers[2]?.setup?.command, "/usr/local/bin/claude");
  assert.equal(result.blockers[2]?.setup?.cwd, "/repo");
  assert.equal(result.launchPlan, undefined);
});

test("claude_ready_preflight_returns_hidden_pty_start_plan_with_settings_mcp_context_and_terminal_env", async () => {
  const integration = claudeIntegration();

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, true);
  assert.equal(result.capabilities.requiresTerminalKeyProtocol, true);
  assert.equal(result.launchPlan?.command, "/usr/local/bin/claude");
  assert.equal(result.launchPlan?.cwd, "/repo");
  assert.equal(result.launchPlan?.env.TERM, "xterm-256color");
  assert.equal(result.launchPlan?.env.COLORTERM, "truecolor");
  assert.deepEqual(result.launchPlan?.inputTiming, {
    startupDelayMs: 5000,
    preSubmitDelayMs: 350,
  });
  assert.deepEqual(result.launchPlan?.args.slice(0, 6), [
    "--mcp-config",
    "/tmp/tide-claude-mcp.json",
    "--settings",
    "/tmp/tide-claude-settings.json",
    "--append-system-prompt",
    "Use Tide MCP tools for Tide Workbench surfaces.",
  ]);
  assert.deepEqual(
    result.launchPlan?.expectedSignalSources.map((source) => source.kind),
    ["pty_transcript", "provider_hook", "provider_history", "tide_mcp"],
  );
});

test("claude_launch_plan_applies_provider_native_model_and_permission_mode", async () => {
  const integration = claudeIntegration();

  const plan = await integration.buildStartPlan({
    agentId: "claude",
    scope: projectScope,
    launchOptions: {
      model: "claude-sonnet-4-6",
      permission: "acceptEdits",
    },
  });

  assert.equal(plan.args[plan.args.indexOf("--model") + 1], "claude-sonnet-4-6");
  assert.equal(plan.args[plan.args.indexOf("--permission-mode") + 1], "acceptEdits");
});

test("claude_resume_plan_uses_provider_native_session_ref", async () => {
  const integration = claudeIntegration();
  const providerSessionRef: ProviderSessionRef = {
    kind: "claude_transcript",
    value: "6a26b8ab-c91e-4846-aae5-f51ce6b04a39",
    transcriptPath:
      "/Users/example/.claude/projects/-repo/6a26b8ab-c91e-4846-aae5-f51ce6b04a39.jsonl",
  };

  const plan = await integration.buildResumePlan({
    agentId: "claude",
    providerSessionRef,
    scope: projectScope,
  });

  assert.deepEqual(plan.args.slice(-2), [
    "--resume",
    "6a26b8ab-c91e-4846-aae5-f51ce6b04a39",
  ]);
  assert.equal(plan.cwd, "/repo");
});

test("claude_launch_plan_does_not_use_print_stream_json_or_remote_control_runtime", async () => {
  const integration = claudeIntegration();

  const result = await integration.preflight(basePreflightInput);
  const args = result.launchPlan?.args ?? [];
  const joinedArgs = args.join(" ");

  assert.equal(args.includes("--print"), false);
  assert.equal(args.includes("-p"), false);
  assert.equal(joinedArgs.includes("stream-json"), false);
  assert.equal(args.includes("--remote"), false);
});

test("claude_permission_prompt_detection_reads_hook_event_name_from_payload", () => {
  const integration = claudeIntegration();

  // Real signal shape: Tide normalizes the event to "agent-needs-input" and the actual
  // claude hook is in payload.hook_event_name. Keying off the normalized event (as the
  // code used to) surfaced nothing -> WebSearch/tool permission hung forever.
  const prompt = integration.detectPromptState({
    threadId: "thread-1",
    source: "provider_hook",
    eventName: "agent-needs-input",
    payload: {
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: {
        description: "Run a fixture command",
        command: "python3 -c 'print(\"CLAUDE_PERMISSION_FIXTURE\")'",
      },
    },
  });
  // A real WebSearch permission (no description/command) still surfaces, named by tool.
  const webSearch = integration.detectPromptState({
    threadId: "thread-1",
    source: "provider_hook",
    eventName: "agent-needs-input",
    payload: {
      hook_event_name: "PermissionRequest",
      tool_name: "WebSearch",
      tool_input: { query: "Figma FIG short interest" },
    },
  });
  const notification = integration.detectPromptState({
    threadId: "thread-1",
    source: "provider_hook",
    eventName: "agent-needs-input",
    payload: {
      hook_event_name: "Notification",
      message: "Claude needs your permission",
    },
  });

  assert.equal(prompt?.kind, "approval");
  assert.equal(prompt?.message, "Run a fixture command");
  // Allow drives the PTY box (Enter on default); Deny cancels it (Esc).
  assert.equal(prompt?.choices?.length, 2);
  assert.equal(prompt?.defaultChoiceId, "claude-perm-allow");
  assert.equal(webSearch?.kind, "approval");
  assert.equal(webSearch?.message, "Claude Code permission required for WebSearch.");
  // A bare Notification has no tool/choices to drive — not surfaced as an approval here.
  assert.equal(notification, null);
});

test("claude_question_prompt_detection_uses_pretooluse_ask_user_question", () => {
  const integration = claudeIntegration();

  const question = integration.detectPromptState({
    threadId: "thread-1",
    source: "provider_hook",
    eventName: "PreToolUse",
    payload: {
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: ["Which branch should Tide use?"],
      },
    },
  });
  const otherPreToolUse = integration.detectPromptState({
    threadId: "thread-1",
    source: "provider_hook",
    eventName: "PreToolUse",
    payload: {
      tool_name: "Bash",
      tool_input: {
        command: "git status",
      },
    },
  });

  assert.equal(question?.kind, "question");
  assert.equal(question?.message, "Which branch should Tide use?");
  assert.equal(otherPreToolUse, null);
});

// Claude's shell-command permission is an interactive boxed menu in the hidden PTY
// (its Notification hook only signals "needs input" without the choices), so the
// claude integration scrapes that frame — captured live from Claude Code.
const CLAUDE_TUI_APPROVAL_FRAME = [
  "\x1b[2J\x1b[H",
  "Bash command",
  "touch /tmp/tide_perm_probe.txt",
  "Create probe file in /tmp",
  "",
  "Do you want to proceed?",
  "\x1b[36m❯ 1. Yes\x1b[0m",
  "  2. Yes, and always allow access to tmp/ from this project",
  "  3. No",
  "",
  "\x1b[2mEsc to cancel · Tab to amend · ctrl+e to explain\x1b[0m",
].join("\n");

test("claude_maps_a_scraped_permission_box_into_a_prompt_state_with_choices", () => {
  const integration = claudeIntegration();

  const prompt = integration.detectPromptState({
    threadId: "thread-tui",
    source: "pty_transcript",
    text: CLAUDE_TUI_APPROVAL_FRAME,
  });

  assert.notEqual(prompt, null);
  assert.equal(prompt?.agentId, "claude");
  assert.equal(prompt?.kind, "approval");
  assert.equal(prompt?.source, "pty");
  assert.equal(prompt?.message, "Do you want to proceed?");
  // Cursor (❯) is on option 1 → that is the default choice.
  assert.equal(prompt?.defaultChoiceId, "claude-opt-1");
  assert.deepEqual(
    prompt?.choices?.map((choice) => ({
      label: choice.label,
      providerValue: choice.providerValue,
    })),
    [
      { label: "Yes", providerValue: "codex-menu:0" },
      {
        label: "Yes, and always allow access to tmp/ from this project",
        providerValue: "codex-menu:1",
      },
      { label: "No", providerValue: "codex-menu:2" },
    ],
  );
});

test("claude_elicitation_prompt_detection_uses_elicitation_event", () => {
  const integration = claudeIntegration();

  const elicitation = integration.detectPromptState({
    threadId: "thread-1",
    source: "provider_hook",
    eventName: "Elicitation",
    payload: {
      mcp_server_name: "tide",
      message: "Please choose a Workbench target.",
      mode: "form",
      elicitation_id: "elicit-1",
    },
  });
  const notification = integration.detectPromptState({
    threadId: "thread-1",
    source: "provider_hook",
    eventName: "Notification",
    payload: {
      notification_type: "question",
      message: "Please choose a Workbench target.",
    },
  });

  assert.equal(elicitation?.kind, "question");
  assert.equal(elicitation?.source, "provider_hook");
  assert.equal(elicitation?.message, "Please choose a Workbench target.");
  assert.equal(notification, null);
});

test("backend_application_does_not_import_claude_adapter_or_shared_contracts", () => {
  assert.deepEqual(
    findSourceMentions(["src/backend/application"], [
      /from\s+["'][^"']*agent-integrations\/claude/,
      /import\(["'][^"']*agent-integrations\/claude/,
      /from\s+["'][^"']*shared\/contracts/,
      /import\(["'][^"']*shared\/contracts/,
    ]),
    [],
  );
});

test("claude_provider_specific_agent_integration_stays_under_backend_adapters", () => {
  assert.deepEqual(
    findSourceMentions(["src/desktop", "src/shared/contracts"], [
      /agent-integrations\/claude/,
      /claude-agent-integration/,
      /createClaudeAgentIntegration/,
    ]),
    [],
  );
});

test("claude_agent_idle_hook_settles_without_carrying_content", () => {
  const integration = claudeIntegration();
  // agent-idle ends the turn but carries NO answer content: the transcript history
  // reader is the sole content source, so the hook only signals settle (empty outcome).
  assert.deepEqual(
    integration.turnEndFromHook("agent-idle", { last_assistant_message: "the answer" }),
    {},
  );
  // Other hook events are not turn-end; claude has no history-driven turn-end.
  assert.equal(integration.turnEndFromHook("agent-running", {}), null);
  assert.equal(integration.turnEndFromHistory("", undefined), null);
});

function claudeIntegration(options: {
  executablePath?: string;
  providerState?: ClaudeProviderState;
} = {}) {
  const executablePath = Object.hasOwn(options, "executablePath")
    ? options.executablePath
    : "/usr/local/bin/claude";

  return createClaudeAgentIntegration({
    resolveExecutable: async () => executablePath,
    readProviderState: async () => options.providerState ?? readyClaudeState(),
    mcpConfigPath: "/tmp/tide-claude-mcp.json",
    settingsPath: "/tmp/tide-claude-settings.json",
    tideContextPrompt: "Use Tide MCP tools for Tide Workbench surfaces.",
  });
}

function readyClaudeState(
  overrides: Partial<ClaudeProviderState> = {},
): ClaudeProviderState {
  return {
    authenticated: true,
    onboardingComplete: true,
    trustedCwds: ["/repo"],
    hookBootstrapReady: true,
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
