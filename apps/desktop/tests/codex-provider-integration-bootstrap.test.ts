import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readCodexHistoryFrames } from "../src/backend/adapters/outbound/agent-integrations/codex/codex-history-connector.ts";

import {
  ensureProviderBootstrapArtifacts,
  providerBootstrapArtifactsForHome,
} from "../src/backend/infrastructure/node/provider/provider-bootstrap-artifacts.ts";
import {
  CODEX_GRANULAR_APPROVAL_POLICY,
  createCodexAgentIntegration,
  type CodexProviderState,
} from "../src/backend/adapters/outbound/agent-integrations/codex/codex-agent-integration.ts";
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
  agentId: "codex",
  scope: projectScope,
};

test("codex_granular_approval_policy_matches_app_server_wire_shape", () => {
  assert.deepEqual(CODEX_GRANULAR_APPROVAL_POLICY, {
    granular: {
      sandbox_approval: true,
      rules: true,
      skill_approval: true,
      request_permissions: true,
      mcp_elicitations: true,
    },
  });
});

test("codex_preflight_reports_not_installed_when_codex_executable_is_missing", async () => {
  const integration = codexIntegration({
    executablePath: undefined,
    providerState: readyCodexState(),
  });

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, false);
  assert.equal(result.blockers[0]?.kind, "not_installed");
  // Install handoff (npm unresolved here ⇒ "npm" fallback). Spec: provider-cli-setup-handoff.md
  assert.equal(result.blockers[0]?.terminalAction?.command, "npm");
  assert.deepEqual(result.blockers[0]?.terminalAction?.args, ["install", "-g", "@openai/codex"]);
  assert.equal(result.blockers[0]?.terminalAction?.expectedCompletion, "retry_preflight");
  assert.equal(result.launchPlan, undefined);
});

test("codex_preflight_reports_not_authenticated_before_launch_plan", async () => {
  const integration = codexIntegration({
    providerState: readyCodexState({ authenticated: false }),
  });

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, false);
  assert.equal(result.blockers[0]?.kind, "not_authenticated");
  assert.equal(result.blockers[0]?.scope, "provider");
  assert.equal(result.blockers[0]?.terminalAction?.env, undefined);
  assert.equal(result.launchPlan, undefined);
});

test("codex_directory_trust_is_checked_against_the_selected_execution_context", async () => {
  const integration = codexIntegration({
    providerState: readyCodexState({ trustedCwds: ["/trusted-repo"] }),
  });

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, false);
  assert.equal(result.blockers[0]?.kind, "directory_trust_required");
  assert.equal(result.blockers[0]?.scope, "execution_context");
  assert.equal(result.blockers[0]?.terminalAction?.cwd, "/repo");
  assert.equal(result.blockers[0]?.terminalAction?.env, undefined);
});

test("codex_preflight_requires_hook_bootstrap_before_ready_launch", async () => {
  const integration = codexIntegration({
    providerState: readyCodexState({ hookBootstrapReady: false }),
  });

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, false);
  assert.equal(result.blockers[0]?.kind, "hook_bootstrap_required");
  assert.equal(result.blockers[0]?.scope, "integration");
  assert.equal(result.blockers[0]?.terminalAction?.env, undefined);
  assert.equal(result.launchPlan, undefined);
});

test("codex_ready_preflight_does_not_build_launch_plan", async () => {
  const integration = codexIntegration();

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, true);
  assert.equal(result.launchPlan, undefined);
});

test("codex_build_start_plan_returns_app_server_plan_with_tide_mcp_config", async () => {
  const integration = codexIntegration();

  const plan = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
    runtimeId: "runtime-codex-test",
  });

  // Structured transport: the app-server protocol (the Codex IDE extension's).
  assert.equal(plan.transport, "codex_app_server");
  assert.equal(plan.command, "/usr/local/bin/codex");
  assert.equal(plan.cwd, "/repo");
  assert.deepEqual(plan.env, {});
  assert.equal(plan.args[0], "app-server");
  // Tide MCP rides direct `-c` config overrides (no global wrapper, no TUI).
  assert.ok(plan.args.includes("-c"));
  assert.ok(
    plan.args.some((arg) =>
      arg === 'mcp_servers.tide.command="/Applications/Tide.app/Contents/MacOS/Tide"',
    ),
    "Tide MCP Tool Surface command must be attached to the Codex session.",
  );
  assert.ok(
    plan.args.includes(
      'mcp_servers.tide.args=["/Applications/Tide.app/Contents/Resources/backend-entrypoint.js","mcp"]',
    ),
  );
  assert.ok(
    plan.args.includes(
      'mcp_servers.tide.env.ELECTRON_RUN_AS_NODE="1"',
    ),
  );
  assert.ok(
    plan.args.includes(
      'mcp_servers.tide.env.TIDE_SOCKET="/tmp/tide.sock"',
    ),
  );
  assert.ok(
    plan.args.includes(
      'mcp_servers.tide.env.TIDE_RUNTIME_ID="runtime-codex-test"',
    ),
  );
  assert.equal(
    typeof plan.protocolParams?.developerInstructions,
    "string",
  );
  assert.match(
    String(plan.protocolParams?.developerInstructions),
    /mcp__tide__tide_observe_browser/,
  );
  assert.match(
    String(plan.protocolParams?.developerInstructions),
    /background/,
  );
  // No TUI machinery on a structured plan.
  assert.equal(plan.args.includes("--dangerously-bypass-hook-trust"), false);
});

test("codex_launch_plan_applies_model_sandbox_and_approval_via_protocol_params", async () => {
  const integration = codexIntegration();

  const sandboxPlan = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
    launchOptions: {
      model: "gpt-5.5-high",
      permission: "workspace-write",
    },
  });
  const approvalPlan = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
    launchOptions: {
      model: "gpt-5.5-high",
      permission: "ask-for-approval",
    },
  });
  const autoPlan = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
    launchOptions: {
      model: "gpt-5.5-high",
      permission: "approve-for-me",
    },
  });
  const fullAccessPlan = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
    launchOptions: {
      model: "gpt-5.5-high",
      permission: "full-access",
    },
  });

  // Session parameters ride thread/start (protocolParams), not argv.
  assert.equal(sandboxPlan.protocolParams?.model, "gpt-5.5-high");
  assert.equal(sandboxPlan.protocolParams?.sandbox, "workspace-write");
  assert.equal(approvalPlan.protocolParams?.sandbox, "workspace-write");
  assert.equal(approvalPlan.protocolParams?.approvalPolicy, "on-request");
  assert.equal(autoPlan.protocolParams?.sandbox, "danger-full-access");
  assert.deepEqual(autoPlan.protocolParams?.approvalPolicy, CODEX_GRANULAR_APPROVAL_POLICY);
  assert.equal(fullAccessPlan.protocolParams?.sandbox, "danger-full-access");
  assert.equal(fullAccessPlan.protocolParams?.approvalPolicy, "never");
});

test("codex_launch_plan_enables_workspace_network_for_legacy_workspace_modes", async () => {
  const integration = codexIntegration();

  const approveForMePlan = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
    launchOptions: { permission: "approve-for-me" },
  });
  const legacyWorkspacePlan = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
    launchOptions: { permission: "workspace-write" },
  });
  const legacyApprovalPlan = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
    launchOptions: { permission: "on-failure" },
  });
  const askPlan = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
    launchOptions: { permission: "ask-for-approval" },
  });

  assert.equal(approveForMePlan.protocolParams?.sandbox, "danger-full-access");
  assert.deepEqual(approveForMePlan.protocolParams?.approvalPolicy, CODEX_GRANULAR_APPROVAL_POLICY);
  assert.deepEqual(legacyApprovalPlan.protocolParams?.approvalPolicy, CODEX_GRANULAR_APPROVAL_POLICY);
  assertWorkspaceNetworkNotConfigured(approveForMePlan.args);
  assertWorkspaceNetworkEnabled(legacyWorkspacePlan.args);
  assertWorkspaceNetworkEnabled(legacyApprovalPlan.args);
  assertWorkspaceNetworkEnabled(askPlan.args);
});

test("codex_launch_plan_adds_workspace_writable_roots_for_workspace_sandboxes", async () => {
  const integration = codexIntegration({
    workspaceWritableRoots: [
      "/repo/.git/worktrees/feature",
      "/repo/.git",
      "/repo/.git",
    ],
  });

  const askPlan = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
    launchOptions: { permission: "ask-for-approval" },
  });
  const approveForMePlan = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
    launchOptions: { permission: "approve-for-me" },
  });

  assertConfigOverride(
    askPlan.args,
    'sandbox_workspace_write.writable_roots=["/repo/.git/worktrees/feature","/repo/.git"]',
  );
  assert.equal(
    approveForMePlan.args.some((arg) => arg.startsWith("sandbox_workspace_write.writable_roots=")),
    false,
  );
});

test("codex_launch_plan_maps_reasoning_effort_to_config_override", async () => {
  const integration = codexIntegration();

  const plan = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
    launchOptions: {
      model: "gpt-5.5",
      reasoning: "high",
    },
  });

  // Reasoning maps to the codex `-c model_reasoning_effort=...` override.
  const overrideIndex = plan.args.findIndex(
    (arg) => arg === 'model_reasoning_effort="high"',
  );
  assert.ok(overrideIndex > 0, "expected model_reasoning_effort override");
  assert.equal(plan.args[overrideIndex - 1], "-c");

  const ignored = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
    launchOptions: { model: "gpt-5.5", reasoning: "turbo" },
  });
  assert.ok(
    !ignored.args.some((arg) => arg.startsWith("model_reasoning_effort=")),
    "unknown reasoning effort must not produce an override",
  );
});

// Spec: docs_v2/specs/mid-thread-launch-option-changes.md
test("codex_session_config_update_applies_model_and_effort_live", () => {
  const integration = codexIntegration();

  const plan = integration.buildSessionConfigUpdate?.({
    launchOptions: { model: "gpt-5.4", reasoning: "xhigh" },
    changedKeys: ["model", "reasoning"],
  });

  // turn/start overrides ("for this turn and subsequent turns").
  assert.deepEqual(plan, {
    kind: "live",
    protocolParams: { model: "gpt-5.4", effort: "xhigh" },
  });
});

test("codex_session_config_update_restarts_for_permission_changes", () => {
  const integration = codexIntegration();

  // permission = sandbox + approvalPolicy; the per-turn sandboxPolicy is a
  // structured object Tide can't construct — restart via thread/resume.
  assert.deepEqual(
    integration.buildSessionConfigUpdate?.({
      launchOptions: { permission: "full-access" },
      changedKeys: ["permission"],
    }),
    { kind: "restart" },
  );
});

test("codex_resume_plan_stays_on_app_server_transport", async () => {
  const integration = codexIntegration();
  const providerSessionRef: ProviderSessionRef = {
    kind: "codex_rollout",
    value: "019e683e-6ca4-7422-9c36-3a929746c5ec",
    transcriptPath: "/Users/example/.codex/sessions/rollout.jsonl",
  };

  const plan = await integration.buildResumePlan({
    agentId: "codex",
    providerSessionRef,
    scope: projectScope,
  });

  // Resume happens IN protocol (thread/resume with the rollout id, verified
  // cross-process in the evidence transcripts) — not via argv.
  assert.equal(plan.transport, "codex_app_server");
  assert.equal(plan.args[0], "app-server");
  assert.equal(plan.args.includes("resume"), false);
  assert.equal(plan.cwd, "/repo");
});

test("backend_application_does_not_import_codex_adapter_or_shared_contracts", () => {
  assert.deepEqual(
    findSourceMentions(["src/backend/application"], [
      /from\s+["'][^"']*agent-integrations\/codex/,
      /import\(["'][^"']*agent-integrations\/codex/,
      /from\s+["'][^"']*shared\/contracts/,
      /import\(["'][^"']*shared\/contracts/,
    ]),
    [],
  );
});

// Spec: docs_v2/specs/agent-prompt-surfacing.md — codex's boxed TUI approval menu has
// no hook, so the codex integration maps the scraped PTY frame into a PromptState.
const CODEX_TUI_APPROVAL_FRAME = [
  "\x1b[2J\x1b[H",
  '\x1b[38;5;252mAllow the playwright MCP server to run tool "browser_navigate"?\x1b[0m',
  "",
  "\x1b[36m> 1. Allow\x1b[0m                  Run the tool and continue.",
  "  2. Allow for this session   Remember this choice for this session.",
  "  3. Always allow             Remember for future tool calls.",
  "  4. Cancel                   Cancel this tool call",
  "",
  "\x1b[2menter to submit | esc to cancel\x1b[0m",
].join("\n");

test("codex_launch_plan_uses_app_server_not_one_shot_exec", async () => {
  // app-server is the PERSISTENT structured protocol (multi-turn, server-push
  // approvals). One-shot `exec --json` would fork a fresh process per turn and
  // lose the session; --remote leaves the machine. Both stay banned.
  const integration = codexIntegration();

  const result = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
  });
  const args = result.args;

  assert.equal(args[0], "app-server");
  assert.equal(args.includes("exec"), false);
  assert.equal(args.includes("--remote"), false);
  assert.equal(args.includes("--json"), false);
});

test("codex_launch_plan_does_not_disable_codex_plugins", async () => {
  const integration = codexIntegration();

  const result = await integration.buildStartPlan({
    agentId: "codex",
    scope: projectScope,
  });
  const args = result.args;

  assert.equal(
    args.some((arg) => arg.startsWith("plugins.")),
    false,
  );
});

test("provider_specific_agent_integrations_stay_under_backend_adapters", () => {
  assert.deepEqual(
    findSourceMentions(["src/desktop", "src/shared/contracts"], [
      /agent-integrations\/codex/,
      /codex-agent-integration/,
      /createCodexAgentIntegration/,
    ]),
    [],
  );
});

function codexIntegration(options: {
  executablePath?: string;
  providerState?: CodexProviderState;
  workspaceWritableRoots?: string[];
} = {}) {
  const executablePath = Object.hasOwn(options, "executablePath")
    ? options.executablePath
    : "/usr/local/bin/codex";

  return createCodexAgentIntegration({
    resolveExecutable: async () => executablePath,
    readProviderState: async () => options.providerState ?? readyCodexState(),
    resolveWorkspaceWritableRoots: options.workspaceWritableRoots === undefined
      ? undefined
      : () => options.workspaceWritableRoots ?? [],
    tideMcp: {
      command: "/Applications/Tide.app/Contents/MacOS/Tide",
      args: ["/Applications/Tide.app/Contents/Resources/backend-entrypoint.js", "mcp"],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        TIDE_SOCKET: "/tmp/tide.sock",
      },
    },
  });
}

function readyCodexState(
  overrides: Partial<CodexProviderState> = {},
): CodexProviderState {
  return {
    authenticated: true,
    onboardingComplete: true,
    trustedCwds: ["/repo"],
    hookBootstrapReady: true,
    codexHome: "/tmp/tide-codex-home",
    ...overrides,
  };
}

function assertWorkspaceNetworkEnabled(args: string[]): void {
  assertConfigOverride(args, "sandbox_workspace_write.network_access=true");
}

function assertWorkspaceNetworkNotConfigured(args: string[]): void {
  assert.equal(
    args.includes("sandbox_workspace_write.network_access=true"),
    false,
  );
}

function assertConfigOverride(args: string[], value: string): void {
  const overrideIndex = args.findIndex((arg) => arg === value);
  assert.ok(overrideIndex > 0, `expected config override: ${value}`);
  assert.equal(args[overrideIndex - 1], "-c");
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

test("codex_web_search_calls_render_as_tool_calls", () => {
  // Captured live: a research turn ran 36 web_search_call response_items with
  // NOTHING rendered (the reader only knew function_call/custom_tool_call), so
  // the UI sat on the intro text looking stuck for minutes.
  const tail = [
    JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message: "research something" },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "web_search_call",
        status: "completed",
        action: { type: "search", query: "Figma short interest 2026" },
      },
    }),
  ].join("\n");
  const seenKeys = new Set<string>();
  const frames = readCodexHistoryFrames({
    threadId: "thread-1",
    runtimeId: "runtime-1",
    sessionRef: {
      agentId: "codex",
      kind: "codex_rollout",
      value: "session-1",
      transcriptPath: "/rollouts/r.jsonl",
    },
    tailText: tail,
    seenKeys,
    expectedUserMessage: "research something",
  });
  const calls = frames.filter((f) => f.payload.type === "tool_call");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.payload.toolName, "web_search");
  assert.equal(calls[0]?.body, "Figma short interest 2026");
});
