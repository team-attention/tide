import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ensureProviderBootstrapArtifacts,
  providerBootstrapArtifactsForHome,
} from "../src/backend/infrastructure/node/provider-bootstrap-artifacts.ts";
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
  assert.equal(result.blockers[0]?.setup?.env, undefined);
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
  assert.equal(result.blockers[0]?.setup?.env, undefined);
});

test("codex_preflight_requires_hook_bootstrap_before_ready_launch", async () => {
  const integration = codexIntegration({
    providerState: readyCodexState({ hookBootstrapReady: false }),
  });

  const result = await integration.preflight(basePreflightInput);

  assert.equal(result.ready, false);
  assert.equal(result.blockers[0]?.kind, "hook_bootstrap_required");
  assert.equal(result.blockers[0]?.scope, "integration");
  assert.deepEqual(result.blockers[0]?.setup?.env, {
    CODEX_HOME: "/tmp/tide-codex-home",
  });
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
  assert.deepEqual(result.launchPlan?.inputTiming, {
    startupDelayMs: 5000,
    preSubmitDelayMs: 350,
  });
  assert.deepEqual(result.launchPlan?.args.slice(0, 1), ["--no-alt-screen"]);
  assert.ok(
    result.launchPlan?.args.includes("--dangerously-bypass-hook-trust"),
    "Tide-generated Codex hooks must not stop the hidden PTY Thread at hook review.",
  );
  assert.ok(result.launchPlan?.args.includes("-c"));
  assert.ok(
    result.launchPlan?.args.includes("features.hooks=true"),
    "Codex hooks must be enabled by launch config.",
  );
  assert.ok(
    result.launchPlan?.args.some((arg) =>
      arg === 'mcp_servers.tide.command="/tmp/tide-mcp-stdio"',
    ),
    "Tide MCP Tool Surface command must be attached to the Codex session.",
  );
  assert.ok(result.launchPlan?.args.includes("mcp_servers.tide.args=[]"));
  assert.ok(
    result.launchPlan?.args.includes(
      'mcp_servers.tide.env.TIDE_SOCKET="/tmp/tide.sock"',
    ),
  );
  assert.deepEqual(
    result.launchPlan?.expectedSignalSources.map((source) => source.kind),
    ["pty_transcript", "provider_hook", "provider_history", "tide_mcp"],
  );
});

test("codex_launch_plan_applies_provider_native_model_sandbox_and_approval_options", async () => {
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
      permission: "on-request",
    },
  });

  assert.equal(sandboxPlan.args[sandboxPlan.args.indexOf("--model") + 1], "gpt-5.5-high");
  assert.equal(sandboxPlan.args[sandboxPlan.args.indexOf("--sandbox") + 1], "workspace-write");
  assert.equal(approvalPlan.args[approvalPlan.args.indexOf("--ask-for-approval") + 1], "on-request");
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

test("codex_declares_its_own_turn_end_hook_event", () => {
  assert.deepEqual(codexIntegration().turnEndSignalEvents(), ["codex-stop"]);
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
      command: "/tmp/tide-mcp-stdio",
      args: [],
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

// D17: the overlay CODEX_HOME mirrors the full real home (minus Tide-owned
// entries) so Codex's version-suffixed sqlite state DBs are available and it
// does not refuse to start with "its local database appears to be damaged".
test("codex_overlay_home_mirrors_real_codex_state_dbs_not_just_a_fixed_allowlist", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tide-codex-home-"));
  try {
    const realCodexHome = path.join(homeDir, ".codex");
    fs.mkdirSync(path.join(realCodexHome, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(realCodexHome, "auth.json"), "{}");
    fs.writeFileSync(path.join(realCodexHome, "config.toml"), "");
    const stateDbs = [
      "state_5.sqlite",
      "goals_1.sqlite",
      "logs_2.sqlite",
      "memories_1.sqlite",
      "logs_2.sqlite-wal",
    ];
    for (const db of stateDbs) {
      fs.writeFileSync(path.join(realCodexHome, db), "");
    }

    const rootDir = path.join(homeDir, ".tide", "agent-bootstrap");
    ensureProviderBootstrapArtifacts({ homeDir, rootDir });
    const overlay = providerBootstrapArtifactsForHome({ homeDir, rootDir }).codexHome;

    for (const entry of [...stateDbs, "auth.json", "sessions"]) {
      const dest = path.join(overlay, entry);
      assert.ok(
        fs.lstatSync(dest).isSymbolicLink(),
        `${entry} should be symlinked into the overlay CODEX_HOME`,
      );
      assert.equal(fs.readlinkSync(dest), path.join(realCodexHome, entry));
    }

    // Tide owns these overlay entries; they must be real files, not links to ~/.codex.
    assert.ok(
      !fs.lstatSync(path.join(overlay, "hooks.json")).isSymbolicLink(),
      "hooks.json is Tide-owned",
    );
    assert.ok(
      !fs.lstatSync(path.join(overlay, "config.toml")).isSymbolicLink(),
      "config.toml is a Tide overlay file, not a symlink",
    );
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

// D17: a stale REAL state DB left in the overlay by an older build (where the DB
// wasn't mirrored) must be replaced with a symlink — otherwise a real DB file
// next to symlinked -wal/-shm siblings is the inconsistent state Codex calls
// "damaged".
test("codex_overlay_replaces_a_stale_real_state_db_with_a_symlink", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tide-codex-home-"));
  try {
    const realCodexHome = path.join(homeDir, ".codex");
    fs.mkdirSync(realCodexHome, { recursive: true });
    fs.writeFileSync(path.join(realCodexHome, "auth.json"), "{}");
    fs.writeFileSync(path.join(realCodexHome, "state_5.sqlite"), "real-db");

    const rootDir = path.join(homeDir, ".tide", "agent-bootstrap");
    const overlay = providerBootstrapArtifactsForHome({ homeDir, rootDir }).codexHome;
    // Simulate an old-build leftover: a real DB file sitting in the overlay.
    fs.mkdirSync(overlay, { recursive: true });
    fs.writeFileSync(path.join(overlay, "state_5.sqlite"), "stale-overlay-copy");

    ensureProviderBootstrapArtifacts({ homeDir, rootDir });

    const dest = path.join(overlay, "state_5.sqlite");
    assert.ok(
      fs.lstatSync(dest).isSymbolicLink(),
      "stale real DB in the overlay should be replaced by a symlink",
    );
    assert.equal(fs.readlinkSync(dest), path.join(realCodexHome, "state_5.sqlite"));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
