import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
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

test("codex_preflight_reports_not_installed_when_codex_executable_is_missing", async () => {
  const integration = codexIntegration({
    executablePath: undefined,
    providerState: readyCodexState(),
  });

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, false);
  assert.equal(result.blockers[0]?.kind, "not_installed");
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
  assert.equal(result.blockers[0]?.setup?.cwd, "/repo");
});

test("codex_preflight_requires_hook_bootstrap_before_ready_launch", async () => {
  const integration = codexIntegration({
    providerState: readyCodexState({ hookBootstrapReady: false }),
  });

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, false);
  assert.equal(result.blockers[0]?.kind, "hook_bootstrap_required");
  assert.equal(result.blockers[0]?.scope, "integration");
  assert.equal(result.launchPlan, undefined);
});

test("codex_ready_preflight_returns_hidden_pty_start_plan_with_hooks_mcp_and_terminal_env", async () => {
  const integration = codexIntegration();

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, true);
  assert.equal(result.launchPlan?.command, "/usr/local/bin/codex");
  assert.equal(result.launchPlan?.cwd, "/repo");
  assert.equal(result.launchPlan?.env.TERM, "xterm-256color");
  assert.equal(result.launchPlan?.env.COLORTERM, "truecolor");
  assert.deepEqual(result.launchPlan?.args.slice(0, 1), ["--no-alt-screen"]);
  assert.ok(result.launchPlan?.args.includes("-c"));
  assert.ok(
    result.launchPlan?.args.includes("features.hooks=true"),
    "Codex hooks must be enabled by launch config.",
  );
  assert.ok(
    result.launchPlan?.args.some((arg) =>
      arg.startsWith("mcp_servers.tide.command="),
    ),
    "Tide MCP Tool Surface command must be attached to the Codex session.",
  );
  assert.deepEqual(
    result.launchPlan?.expectedSignalSources.map((source) => source.kind),
    ["pty_transcript", "provider_hook", "provider_history", "tide_mcp"],
  );
});

test("codex_resume_plan_uses_provider_native_session_ref", async () => {
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

  assert.deepEqual(plan.args.slice(0, 3), [
    "resume",
    "--no-alt-screen",
    "019e683e-6ca4-7422-9c36-3a929746c5ec",
  ]);
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

test("codex_permission_prompt_detection_requires_permission_request_hook_payload", () => {
  const integration = codexIntegration();

  const prompt = integration.detectPromptState({
    threadId: "thread-1",
    source: "provider_hook",
    eventName: "PermissionRequest",
    payload: {
      tool_name: "Bash",
      tool_input: {
        description: "Run a fixture command",
        command: "python3 -c 'print(\"CODEX_PERMISSION_FIXTURE\")'",
      },
    },
  });
  const unknown = integration.detectPromptState({
    threadId: "thread-1",
    source: "pty_transcript",
    text: "Allow command?",
  });

  assert.equal(prompt?.kind, "permission");
  assert.equal(prompt?.source, "provider_hook");
  assert.equal(prompt?.message, "Run a fixture command");
  assert.equal(unknown, null);
});

test("codex_launch_plan_does_not_use_exec_json_app_server_or_remote_runtime", async () => {
  const integration = codexIntegration();

  const result = await integration.preflight(basePreflightInput);
  const args = result.launchPlan?.args ?? [];

  assert.equal(args.includes("exec"), false);
  assert.equal(args.includes("app-server"), false);
  assert.equal(args.includes("--remote"), false);
  assert.equal(args.includes("--json"), false);
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
} = {}) {
  const executablePath = Object.hasOwn(options, "executablePath")
    ? options.executablePath
    : "/usr/local/bin/codex";

  return createCodexAgentIntegration({
    resolveExecutable: async () => executablePath,
    readProviderState: async () => options.providerState ?? readyCodexState(),
    tideMcp: {
      command: "/Applications/Tide.app/Contents/MacOS/tide",
      args: ["mcp"],
      env: {
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
