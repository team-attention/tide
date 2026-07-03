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
  // The install handoff: npm i -g the CLI's package, re-running preflight on exit
  // (npm unresolved in this test ⇒ "npm" fallback). Spec: provider-cli-setup-handoff.md
  assert.equal(result.blockers[0]?.terminalAction?.command, "npm");
  assert.deepEqual(result.blockers[0]?.terminalAction?.args, ["install", "-g", "@anthropic-ai/claude-code"]);
  assert.equal(result.blockers[0]?.terminalAction?.expectedCompletion, "retry_preflight");
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
  assert.equal(result.blockers[2]?.terminalAction?.command, "/usr/local/bin/claude");
  assert.equal(result.blockers[2]?.terminalAction?.cwd, "/repo");
  assert.equal(result.launchPlan, undefined);
});

test("claude_ready_preflight_does_not_build_launch_plan", async () => {
  const integration = claudeIntegration();

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, true);
  assert.equal(result.launchPlan, undefined);
});

test("claude_build_start_plan_returns_structured_stream_json_plan", async () => {
  const integration = claudeIntegration();

  const result = await integration.buildStartPlan({
    agentId: "claude",
    scope: projectScope,
  });

  // Structured transport: the stream-json control protocol over plain stdio.
  assert.equal(result.transport, "claude_stream_json");
  assert.equal(result.command, "/usr/local/bin/claude");
  assert.equal(result.cwd, "/repo");
  assert.deepEqual(result.env, {});
  const args = result.args;
  const joined = args.join(" ");
  assert.ok(joined.includes("--print"));
  assert.ok(joined.includes("--input-format stream-json"));
  assert.ok(joined.includes("--output-format stream-json"));
  // REQUIRED for can_use_tool permission requests (hidden flag; the official
  // Agent SDK passes exactly this).
  assert.ok(joined.includes("--permission-prompt-tool stdio"));
  // Grants the bypass-permissions CAPABILITY at launch (decoupled from the start
  // mode) so a mid-thread switch to Bypass applies live via set_permission_mode —
  // claude refuses a cold live switch into bypass otherwise. Spec:
  // docs_v2/specs/claude-bypass-live-capability.md
  assert.ok(joined.includes("--allow-dangerously-skip-permissions"));
  assert.ok(joined.includes(`--mcp-config /tmp/tide-claude-mcp.json`));
  assert.ok(joined.includes(`--settings /tmp/tide-claude-settings.json`));
  // No TUI: no startup delays, no terminal key protocol.
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

// Spec: docs_v2/specs/mid-thread-launch-option-changes.md
test("claude_session_config_update_applies_model_and_permission_live", () => {
  const integration = claudeIntegration();

  const plan = integration.buildSessionConfigUpdate?.({
    launchOptions: { model: "claude-sonnet-4-6", permission: "acceptEdits" },
    changedKeys: ["model", "permission"],
  });

  assert.deepEqual(plan, {
    kind: "live",
    protocolParams: { model: "claude-sonnet-4-6", permissionMode: "acceptEdits" },
  });
});

test("claude_session_config_update_restarts_for_effort_and_default_model", () => {
  const integration = claudeIntegration();

  // `--effort` is spawn argv only — no live control request.
  assert.deepEqual(
    integration.buildSessionConfigUpdate?.({
      launchOptions: { reasoning: "xhigh" },
      changedKeys: ["reasoning"],
    }),
    { kind: "restart" },
  );
  // The "Claude default" sentinel has no live "unset model" — restart and let
  // the spawn argv simply omit --model.
  assert.deepEqual(
    integration.buildSessionConfigUpdate?.({
      launchOptions: { model: "Claude default" },
      changedKeys: ["model"],
    }),
    { kind: "restart" },
  );
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

test("claude_start_plan_mints_session_id_and_keeps_initial_prompt_off_argv", async () => {
  // The structured client delivers the first user message over stdin AFTER the
  // protocol's init line — a positional [prompt] arg would race MCP/tool setup
  // and bypass the protocol's readiness signal.
  const integration = claudeIntegration();
  const plan = await integration.buildStartPlan({
    agentId: "claude",
    scope: projectScope,
    initialPrompt: "hello world",
  });
  assert.equal(plan.transport, "claude_stream_json");
  assert.equal(plan.args.includes("hello world"), false);
  const sessionFlag = plan.args.indexOf("--session-id");
  assert.notEqual(sessionFlag, -1);
  assert.equal(plan.providerSessionRef?.value, plan.args[sessionFlag + 1]);
});

// Legacy Claude shell-command permission fixture: the old PTY/TUI path exposed an
// interactive boxed menu while its Notification hook only signaled "needs input".
// Kept as parser regression coverage for historical frames captured live from
// Claude Code.
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
