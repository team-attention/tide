// Spec: docs_v2/specs/backend-agent-runtime-port-wiring.md

import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createAgentIntegrationAgentRuntimePort,
  createAgentIntegrationProviderReadinessPort,
} from "../src/backend/adapters/outbound/agent-runtime/runtime-ports/agent-integration-agent-runtime-port.ts";
import type {
  AgentIntegrationPort,
  AgentIntegrationPreflightInput,
  AgentIntegrationPreflightResult,
  AgentResumePlanInput,
  AgentStartPlanInput,
  AgentTurnOutcome,
  ProviderLaunchPlan,
  RuntimeReadinessGate,
} from "../src/backend/application/ports/outbound/agent-integration-port.ts";
import type { RuntimeReadinessRegistry } from "../src/backend/application/services/provider/runtime-readiness-registry.ts";
import {
  claudeProviderSessionRefFromTranscriptPath,
  codexProviderSessionRefFromRolloutPath,
  createLiveAgentSessionEventProjector,
  readCodexProviderSessionRefsFromHome,
  readClaudeProviderSessionRefsFromHome,
  rebuildCodexConversation,
  rebuildClaudeConversation,
  readClaudeProviderStateFromHome,
  readCodexProviderStateFromHome,
  threadStorageRecordFromThreadSummary,
} from "../src/backend/infrastructure/node/live/live-backend.ts";
import {
  createCodexHistoryConnector,
  readCodexHistoryFrames,
} from "../src/backend/adapters/outbound/agent-integrations/codex/codex-history-connector.ts";
import {
  createClaudeHistoryConnector,
  readClaudeHistoryFrames,
} from "../src/backend/adapters/outbound/agent-integrations/claude/claude-history-connector.ts";
import type { ProviderHistoryFrame } from "../src/backend/application/ports/outbound/agent-integration-port.ts";

// Test-side twins of the shared history loop: read the bound session file's tail
// and hand it to the adapter's pure readFrames — the same composition
// emitProviderHistory performs in live-backend.
function readCodexProviderHistoryFramesFromHome(input: {
  homeDir: string;
  threadId: string;
  runtimeId: string;
  sinceMs: number;
  seenKeys: Set<string>;
  expectedUserMessage?: string;
  boundRolloutPath?: string;
}): ProviderHistoryFrame[] {
  if (input.boundRolloutPath === undefined) {
    return [];
  }
  let tailText: string;
  try {
    tailText = fs.readFileSync(input.boundRolloutPath, "utf8");
  } catch {
    return [];
  }
  return readCodexHistoryFrames({
    threadId: input.threadId,
    runtimeId: input.runtimeId,
    sessionRef: codexProviderSessionRefFromRolloutPath(input.boundRolloutPath),
    tailText,
    seenKeys: input.seenKeys,
    expectedUserMessage: input.expectedUserMessage,
  });
}

function readClaudeProviderHistoryFramesFromHome(input: {
  homeDir: string;
  threadId: string;
  runtimeId: string;
  sinceMs: number;
  seenKeys: Set<string>;
  expectedUserMessage?: string;
  boundTranscriptPath?: string;
}): ProviderHistoryFrame[] {
  if (input.boundTranscriptPath === undefined) {
    return [];
  }
  let tailText: string;
  try {
    tailText = fs.readFileSync(input.boundTranscriptPath, "utf8");
  } catch {
    return [];
  }
  return readClaudeHistoryFrames({
    threadId: input.threadId,
    runtimeId: input.runtimeId,
    sessionRef: claudeProviderSessionRefFromTranscriptPath(input.boundTranscriptPath),
    tailText,
    seenKeys: input.seenKeys,
    expectedUserMessage: input.expectedUserMessage,
  });
}


// The hook-payload session-ref derivation moved into each adapter's history
// connector; this twin dispatches the same way tests used to.
function providerSessionRefFromProviderSignalPayload(
  agentId: "codex" | "claude",
  payload: unknown,
) {
  const connector =
    agentId === "codex" ? createCodexHistoryConnector() : createClaudeHistoryConnector();
  return connector.sessionRefFromHookPayload(payload);
}
import { createFileAppStorage } from "../src/backend/adapters/outbound/app-storage/file-app-storage.ts";
import {
  ensureProviderBootstrapArtifacts,
  providerBootstrapArtifactsForHome,
} from "../src/backend/infrastructure/node/provider/provider-bootstrap-artifacts.ts";
import { createPythonPtyProcessLauncher } from "../src/backend/adapters/outbound/pty/python-pty-process-launcher.ts";
import { SKIP_REAL_PTY_IN_CI } from "./pty-ci-gate.ts";
import type {
  AgentRuntimeHandle,
  AgentRuntimeStartInput,
  AgentRuntimeResumeInput,
  TerminalInput,
} from "../src/backend/application/domains/agent-runtime/agent-runtime.ts";
import type { AgentRuntimePort } from "../src/backend/application/ports/outbound/agent-runtime-port.ts";
import type { ProviderReadinessPort } from "../src/backend/application/ports/outbound/provider-readiness-port.ts";
import type { PtyTranscriptPort } from "../src/backend/application/ports/outbound/pty-transcript-port.ts";
import {
  createThreadRuntimeService,
  type RawAgentFrame,
  type ThreadSeed,
} from "../src/backend/application/services/thread/thread-runtime-service.ts";
import { createThreadPersistenceService } from "../src/backend/application/services/thread/thread-persistence-service.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const now = "2026-05-29T00:00:00.000Z";

test("provider_readiness_port_uses_selected_agent_integration_preflight", async () => {
  const codex = fakeIntegration("codex", startPlan("codex"));
  const claude = fakeIntegration("claude", startPlan("claude"));
  const opencode = fakeIntegration("opencode", startPlan("opencode"));
  const readiness = createAgentIntegrationProviderReadinessPort({
    integrations: { codex, claude, opencode },
  });

  const result = await readiness.check({
    agentId: "opencode",
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
    launchOptions: { model: "opencode default", permission: "build" },
  });

  assert.equal(result.ready, true);
  assert.equal(result.agentId, "opencode");
  assert.equal(opencode.preflightInputs.length, 1);
  assert.equal(codex.preflightInputs.length, 0);
  assert.equal(claude.preflightInputs.length, 0);
  assert.deepEqual(opencode.preflightInputs[0].launchOptions, {
    model: "opencode default",
    permission: "build",
  });
});

test("provider_readiness_port_rejects_non_provider_cli_agent", async () => {
  const codex = fakeIntegration("codex", startPlan("codex"));
  const claude = fakeIntegration("claude", startPlan("claude"));
  const opencode = fakeIntegration("opencode", startPlan("opencode"));
  const readiness = createAgentIntegrationProviderReadinessPort({
    integrations: { codex, claude, opencode },
  });

  const result = await readiness.check({
    agentId: "openai_api",
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
    launchOptions: { model: "gpt-5.5-high" },
  });

  assert.equal(result.ready, false);
  assert.equal(result.agentId, "openai_api");
  assert.deepEqual(result.blockers, [
    {
      kind: "unknown",
      message: "Unknown provider CLI agent.",
      scope: "provider",
      action: "none",
    },
  ]);
  assert.equal(codex.preflightInputs.length, 0);
  assert.equal(claude.preflightInputs.length, 0);
  assert.equal(opencode.preflightInputs.length, 0);
});

// Spec: docs_v2/specs/mid-thread-launch-option-changes.md — a session-config
// update for a runtime the port does not know degrades to restart_required
// (the conservative default), never to a silent "applied".
test("apply_session_config_without_a_live_runtime_requires_restart", async () => {
  const codex = fakeIntegration("codex", startPlan("codex"));
  const claude = fakeIntegration("claude", startPlan("claude"));
  const opencode = fakeIntegration("opencode", startPlan("opencode"));
  const port = createAgentIntegrationAgentRuntimePort({
    integrations: { codex, claude, opencode },
  });

  const result = await port.applySessionConfig(
    { runtimeId: "runtime-unknown", threadId: "thread-1", agentId: "codex" },
    { launchOptions: { model: "gpt-5.4" }, changedKeys: ["model"] },
  );

  assert.equal(result, "restart_required");
});

// Spec: docs_v2/specs/agent-prompt-surfacing.md — answering a codex TUI menu replays
// keyed navigation on the live PTY, not typed text.
test("python_pty_process_launcher_round_trips_terminal_input_with_real_pty", { skip: SKIP_REAL_PTY_IN_CI }, async () => {
  const launcher = createPythonPtyProcessLauncher();
  let output = "";
  let resolveSeen: (() => void) | undefined;
  const seen = new Promise<void>((resolve) => {
    resolveSeen = resolve;
  });

  const handle = await launcher.spawn({
    runtimeId: "runtime-python-pty",
    plan: {
      command: "/bin/cat",
      args: [],
      env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
      cwd: repoRoot,
    },
    onOutput: (chunk) => {
      output += chunk.body;
      if (output.includes("TIDE_PTY_TEST")) {
        resolveSeen?.();
      }
    },
  });

  await handle.write("TIDE_PTY_TEST\r");
  await Promise.race([
    seen,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error("PTY output was not observed.")), 3000),
    ),
  ]);
  await handle.stop();

  assert.match(output, /TIDE_PTY_TEST/);
  assert.doesNotMatch(output, /tcgetattr\/ioctl|Operation not supported on socket/);
});

test("python_pty_process_launcher_sets_terminal_window_size_for_provider_tuis", { skip: SKIP_REAL_PTY_IN_CI }, async () => {
  const launcher = createPythonPtyProcessLauncher();
  let output = "";
  let resolveSeen: (() => void) | undefined;
  const seen = new Promise<void>((resolve) => {
    resolveSeen = resolve;
  });

  const handle = await launcher.spawn({
    runtimeId: "runtime-python-pty-size",
    plan: {
      command: "python3",
      args: [
        "-c",
        "import os; size=os.get_terminal_size(); print(f'{size.columns}x{size.lines}', flush=True)",
      ],
      env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
      cwd: repoRoot,
    },
    onOutput: (chunk) => {
      output += chunk.body;
      if (output.includes("120x40")) {
        resolveSeen?.();
      }
    },
  });

  await Promise.race([
    seen,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error("PTY window size was not observed.")), 3000),
    ),
  ]);
  await handle.stop();

  assert.match(output, /120x40/);
});

test("python_pty_process_launcher_replies_to_basic_terminal_queries", { skip: SKIP_REAL_PTY_IN_CI }, async () => {
  const launcher = createPythonPtyProcessLauncher();
  let output = "";
  let resolveSeen: (() => void) | undefined;
  const seen = new Promise<void>((resolve) => {
    resolveSeen = resolve;
  });

  const handle = await launcher.spawn({
    runtimeId: "runtime-python-pty-query",
    plan: {
      command: "python3",
      args: [
        "-c",
        [
          "import os, select, sys, time, tty",
          "tty.setraw(sys.stdin.fileno())",
          "sys.stdout.buffer.write(b'\\x1b[6n\\x1b]10;?\\x1b\\\\\\x1b]11;?\\x1b\\\\\\x1b[c\\x1b[?u')",
          "sys.stdout.buffer.flush()",
          "deadline = time.time() + 2",
          "data = b''",
          "while time.time() < deadline:",
          "    ready, _, _ = select.select([sys.stdin], [], [], 0.1)",
          "    if ready:",
          "        data += os.read(sys.stdin.fileno(), 128)",
          "    if b'\\x1b[1;1R' in data and b'\\x1b]10;rgb:' in data and b'\\x1b]11;rgb:' in data and b'\\x1b[?1;2c' in data and b'\\x1b[?0u' in data:",
          "        break",
          "print(data.decode('latin1').encode('unicode_escape').decode(), flush=True)",
        ].join("\n"),
      ],
      env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
      cwd: repoRoot,
    },
    onOutput: (chunk) => {
      output += chunk.body;
      if (output.includes("\\x1b[1;1R") && output.includes("\\x1b[?0u")) {
        resolveSeen?.();
      }
    },
  });

  await Promise.race([
    seen,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error("PTY terminal query replies were not observed.")), 3000),
    ),
  ]);
  await handle.stop();

  assert.match(output, /\\x1b\[1;1R/);
  assert.match(output, /\\x1b\]10;rgb:/);
  assert.match(output, /\\x1b\]11;rgb:/);
  assert.match(output, /\\x1b\[\?1;2c/);
  assert.match(output, /\\x1b\[\?0u/);
});

test("live_backend_routes_provider_readiness_terminals_through_workbench_terminal_port", () => {
  // Spec: docs_v2/specs/thread-workbench-agent-model-cleanup.md
  const source = fs.readFileSync(
    path.join(repoRoot, "src/backend/infrastructure/node/live/live-backend.ts"),
    "utf8",
  );

  assert.match(source, /workbenchTerminalPort: createPtyWorkbenchTerminalPort/);
  assert.match(source, /resolveRuntimeEnvironment: \(\{ cwd, planEnv \}\) =>/);
});

test("terminal_command_tool_uses_workbench_terminal_runtime_not_workspace_command_spawn", () => {
  const workspaceCommandSource = fs.readFileSync(
    path.join(repoRoot, "src/backend/adapters/outbound/workspace-command/node-workspace-command-port.ts"),
    "utf8",
  );
  const workbenchExecSource = fs.readFileSync(
    path.join(repoRoot, "src/backend/application/services/workbench/workbench-exec-operations.ts"),
    "utf8",
  );

  assert.doesNotMatch(workspaceCommandSource, /node:child_process|spawn\(/);
  assert.doesNotMatch(workbenchExecSource, /workspaceCommandPort\.run/);
  assert.match(workbenchExecSource, /workbenchRuntime\.runTerminalCommand/);
});

test("live_agent_session_projection_emits_prompt_changed_for_prompt_state", () => {
  // Spec: docs_v2/specs/provider-signal-prompt-ingress.md
  // The projection path lives in live-projector.ts (navigable-source-structure).
  const source = fs.readFileSync(
    path.join(repoRoot, "src/backend/infrastructure/node/live/live-projector.ts"),
    "utf8",
  );

  assert.match(source, /readResult\.promptState/);
  assert.match(source, /recordProviderPromptState/);
  assert.match(source, /kind:\s*"prompt\.changed"/);
});

test("live_agent_session_projection_records_streaming_deltas_into_the_streaming_tail", () => {
  // Spec: docs_v2/specs/hydrate-live-streaming-tail.md
  // The content_delta (live streaming) branch must mirror each in-flight block into the
  // service's streaming tail so a re-hydrate mid-turn can union it onto cachedBlocks.
  const source = fs.readFileSync(
    path.join(repoRoot, "src/backend/infrastructure/node/live/live-projector.ts"),
    "utf8",
  );
  const contentDelta = source.slice(source.indexOf('event.kind === "content_delta"'));
  assert.match(contentDelta, /recordStreamingBlock\(\{\s*threadId:/);
});

test("a_turn_end_does_not_force_settle_a_live_prompt_card_only_a_runtime_exit_does", () => {
  // Regression (spec: waiting-state-recovery): a turn-end must NOT pass force based on
  // having produced a final message / notice. The AskUserQuestion pattern emits BOTH a
  // final message (the agent's text) AND a question card in the same turn; forcing on
  // finalMessage dropped that just-raised card (root of "card never showed / thread
  // stuck waiting"). Only runtime_exited force-settles (the card is then truly dead).
  const source = fs.readFileSync(
    path.join(repoRoot, "src/backend/infrastructure/node/live/live-projector.ts"),
    "utf8",
  );
  // The buggy heuristic must be gone.
  assert.doesNotMatch(source, /force:\s*args\.outcome\.finalMessage/);
  assert.doesNotMatch(source, /finalMessage\s*!==\s*undefined\s*\|\|\s*args\.outcome\.notice/);
  // A genuine runtime exit STILL forces the settle past a (now dead) card.
  assert.match(source, /runtime_exited[\s\S]*?force:\s*true/);
});

test("provider_bootstrap_artifacts_create_only_the_mcp_surface", () => {
  // Structured runtimes need ONLY the Tide MCP bridge bootstrapped — no hooks,
  // no signal spool, no codex config overlay (codex runs against its real
  // ~/.codex; MCP rides `-c` argv).
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-provider-state-"));
  const cwd = "/repo";
  writeProviderFiles(home, cwd);

  const artifacts = ensureProviderBootstrapArtifacts({
    homeDir: home,
    tideCommand: "/Applications/Tide.app/Contents/MacOS/Tide",
    tideMcpEntrypoint: "/Applications/Tide.app/Contents/Resources/backend-entrypoint.js",
    tideSocket: "/tmp/tide.sock",
  });

  assert.equal(fs.existsSync(artifacts.tideMcpCommandPath), true);
  assert.equal(fs.existsSync(artifacts.claudeMcpConfigPath), true);
  assert.equal(fs.existsSync(artifacts.claudeSettingsPath), true);
  // codexHome is the REAL ~/.codex — no overlay dir/config written by Tide.
  assert.equal(artifacts.codexHome, path.join(home, ".codex"));

  const claudeMcp = fs.readFileSync(artifacts.claudeMcpConfigPath, "utf8");
  assert.match(claudeMcp, /"mcpServers"/);
  assert.match(claudeMcp, /tide-mcp-stdio/);
  assert.match(claudeMcp, /"TIDE_SOCKET": "\/tmp\/tide\.sock"/);
  // settings.json pre-allows the tide MCP server and carries NO hooks.
  const claudeSettings = fs.readFileSync(artifacts.claudeSettingsPath, "utf8");
  assert.match(claudeSettings, /mcp__tide/);
  assert.doesNotMatch(claudeSettings, /hooks/);
  const tideMcpCommand = fs.readFileSync(artifacts.tideMcpCommandPath, "utf8");
  assert.match(tideMcpCommand, /ELECTRON_RUN_AS_NODE=1 exec/);
  assert.match(tideMcpCommand, /backend-entrypoint\.js/);
  assert.match(tideMcpCommand, / mcp "\$@"/);
});

test("live_backend_provider_state_readers_require_tide_owned_bootstrap_artifacts", () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-provider-state-"));
  const cwd = "/repo";
  writeProviderFiles(home, cwd);

  assert.equal(readCodexProviderStateFromHome(home, cwd).hookBootstrapReady, false);
  assert.equal(readClaudeProviderStateFromHome(home, cwd).hookBootstrapReady, false);
});

test("live_backend_provider_state_readers_use_local_provider_files", () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-provider-state-"));
  const cwd = "/repo";
  writeProviderFiles(home, cwd);
  ensureProviderBootstrapArtifacts({
    homeDir: home,
    tideCommand: "/Applications/Tide.app/Contents/MacOS/Tide",
  });
  const artifacts = providerBootstrapArtifactsForHome({ homeDir: home });

  assert.deepEqual(readCodexProviderStateFromHome(home, cwd), {
    authenticated: true,
    onboardingComplete: true,
    trustedCwds: [cwd],
    hookBootstrapReady: true,
    codexHome: artifacts.codexHome,
  });
  assert.deepEqual(readClaudeProviderStateFromHome(home, cwd), {
    authenticated: true,
    onboardingComplete: true,
    trustedCwds: [cwd],
    hookBootstrapReady: true,
  });
});

test("live_backend_codex_state_reader_uses_effective_codex_home", () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-provider-state-"));
  const codexHome = fs.mkdtempSync(path.join(tmpdir(), "tide-effective-codex-home-"));
  const cwd = "/repo";
  ensureProviderBootstrapArtifacts({
    homeDir: home,
    tideCommand: "/Applications/Tide.app/Contents/MacOS/Tide",
  });
  writeFile(
    path.join(codexHome, "auth.json"),
    JSON.stringify({ auth_mode: "chatgpt", tokens: { id_token: "token" } }),
  );
  writeFile(
    path.join(codexHome, "config.toml"),
    `[projects."${cwd}"]\ntrust_level = "trusted"\n`,
  );

  assert.deepEqual(readCodexProviderStateFromHome(home, cwd, codexHome), {
    authenticated: true,
    onboardingComplete: true,
    trustedCwds: [cwd],
    hookBootstrapReady: true,
    codexHome,
  });
});

test("live_backend_codex_bootstrap_ready_uses_generated_artifacts_without_hook_trust", () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-provider-state-"));
  const cwd = "/repo";
  writeProviderFiles(home, cwd);
  const artifacts = ensureProviderBootstrapArtifacts({
    homeDir: home,
    tideCommand: "/Applications/Tide.app/Contents/MacOS/Tide",
  });

  const codexConfig = fs.readFileSync(
    path.join(artifacts.codexHome, "config.toml"),
    "utf8",
  );

  assert.doesNotMatch(codexConfig, /hooks\.state/);
  assert.deepEqual(readCodexProviderStateFromHome(home, cwd), {
    authenticated: true,
    onboardingComplete: true,
    trustedCwds: [cwd],
    hookBootstrapReady: true,
    codexHome: artifacts.codexHome,
  });
});

function writeProviderFiles(home: string, cwd: string): void {
  writeFile(
    path.join(home, ".codex", "auth.json"),
    JSON.stringify({ auth_mode: "chatgpt", tokens: { id_token: "token" } }),
  );
  writeFile(
    path.join(home, ".codex", "config.toml"),
    'model = "gpt-5.5"\nnotify = ["external-app"]\n\n[projects."/repo"]\ntrust_level = "trusted"\n\n[mcp_servers.paper]\nurl = "http://127.0.0.1:29979/mcp"\n',
  );
  writeFile(path.join(home, ".codex", "sessions", ".keep"), "");
  writeFile(path.join(home, ".codex", "history.jsonl"), "{}\n");
  writeFile(path.join(home, ".codex", "models_cache.json"), "{}");
  writeFile(path.join(home, ".codex", "plugins", "codex-apps", "plugin.json"), "{}");
  writeFile(path.join(home, ".codex", "vendor_imports", "codex_apps", "index.js"), "");
  writeFile(path.join(home, ".codex", "cache", "app-state.json"), "{}");
  writeFile(path.join(home, ".codex", "state_5.sqlite"), "");
  writeFile(path.join(home, ".codex", "skills", "impeccable", "SKILL.md"), "# Skill\n");
  writeFile(
    path.join(home, ".claude.json"),
    JSON.stringify({
      oauthAccount: { emailAddress: "user@example.com" },
      hasCompletedOnboarding: true,
      projects: { "/repo": { hasTrustDialogAccepted: true } },
    }),
  );
  writeFile(path.join(home, ".claude", "settings.json"), "{}");
}

test("codex_provider_history_reader_derives_provider_session_ref_from_rollout_path", () => {
  // Spec: docs_v2/specs/live-provider-session-reference-discovery.md
  const rolloutPath = path.join(
    "/Users/you",
    ".codex",
    "sessions",
    "2026",
    "05",
    "27",
    "rollout-2026-05-27T16-03-02-019e683e-6ca4-7422-9c36-3a929746c5ec.jsonl",
  );

  assert.deepEqual(codexProviderSessionRefFromRolloutPath(rolloutPath), {
    agentId: "codex",
    kind: "codex_rollout",
    value: "019e683e-6ca4-7422-9c36-3a929746c5ec",
    transcriptPath: rolloutPath,
  });
});

test("claude_provider_history_reader_derives_provider_session_ref_from_transcript_path", () => {
  // Spec: docs_v2/specs/live-provider-session-reference-discovery.md
  const transcriptPath = path.join(
    "/Users/you",
    ".claude",
    "projects",
    "-Users-you-Workspace-tide",
    "6a26b8ab-c91e-4846-aae5-f51ce6b04a39.jsonl",
  );

  assert.deepEqual(claudeProviderSessionRefFromTranscriptPath(transcriptPath), {
    agentId: "claude",
    kind: "claude_transcript",
    value: "6a26b8ab-c91e-4846-aae5-f51ce6b04a39",
    transcriptPath,
  });
});

test("provider_signal_payload_derives_provider_session_refs_for_codex_and_claude", () => {
  // Spec: docs_v2/specs/live-provider-session-reference-discovery.md
  assert.deepEqual(
    providerSessionRefFromProviderSignalPayload("codex", {
      session_id: "019e68ba-86a7-7a20-8946-173af0377df3",
      transcript_path:
        "/Users/you/.codex/sessions/2026/05/27/rollout-2026-05-27T18-18-31-019e68ba-86a7-7a20-8946-173af0377df3.jsonl",
    }),
    {
      agentId: "codex",
      kind: "codex_rollout",
      value: "019e68ba-86a7-7a20-8946-173af0377df3",
      transcriptPath:
        "/Users/you/.codex/sessions/2026/05/27/rollout-2026-05-27T18-18-31-019e68ba-86a7-7a20-8946-173af0377df3.jsonl",
    },
  );
  assert.deepEqual(
    providerSessionRefFromProviderSignalPayload("claude", {
      session_id: "09a10091-c9d4-4479-832d-6bef29703ff5",
      transcript_path:
        "/Users/you/.claude/projects/-Users-you-Workspace-tide/09a10091-c9d4-4479-832d-6bef29703ff5.jsonl",
    }),
    {
      agentId: "claude",
      kind: "claude_transcript",
      value: "09a10091-c9d4-4479-832d-6bef29703ff5",
      transcriptPath:
        "/Users/you/.claude/projects/-Users-you-Workspace-tide/09a10091-c9d4-4479-832d-6bef29703ff5.jsonl",
    },
  );
});

test("provider_history_readers_return_recent_codex_and_claude_session_refs_once", () => {
  // Spec: docs_v2/specs/live-provider-session-reference-discovery.md
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-provider-ref-history-"));
  const codexRolloutPath = path.join(
    home,
    ".codex",
    "sessions",
    "2026",
    "05",
    "27",
    "rollout-2026-05-27T16-03-02-019e683e-6ca4-7422-9c36-3a929746c5ec.jsonl",
  );
  const claudeTranscriptPath = path.join(
    home,
    ".claude",
    "projects",
    "-Users-you-Workspace-tide",
    "6a26b8ab-c91e-4846-aae5-f51ce6b04a39.jsonl",
  );
  writeFile(codexRolloutPath, JSON.stringify({ type: "session_meta" }));
  writeFile(claudeTranscriptPath, JSON.stringify({ type: "mode" }));
  const codexSeen = new Set<string>();
  const claudeSeen = new Set<string>();

  assert.deepEqual(
    readCodexProviderSessionRefsFromHome({
      homeDir: home,
      sinceMs: Date.now() - 10_000,
      seenKeys: codexSeen,
    }),
    [
      {
        agentId: "codex",
        kind: "codex_rollout",
        value: "019e683e-6ca4-7422-9c36-3a929746c5ec",
        transcriptPath: codexRolloutPath,
      },
    ],
  );
  assert.deepEqual(
    readCodexProviderSessionRefsFromHome({
      homeDir: home,
      sinceMs: Date.now() - 10_000,
      seenKeys: codexSeen,
    }),
    [],
  );
  assert.deepEqual(
    readClaudeProviderSessionRefsFromHome({
      homeDir: home,
      sinceMs: Date.now() - 10_000,
      seenKeys: claudeSeen,
    }),
    [
      {
        agentId: "claude",
        kind: "claude_transcript",
        value: "6a26b8ab-c91e-4846-aae5-f51ce6b04a39",
        transcriptPath: claudeTranscriptPath,
      },
    ],
  );
  assert.deepEqual(
    readClaudeProviderSessionRefsFromHome({
      homeDir: home,
      sinceMs: Date.now() - 10_000,
      seenKeys: claudeSeen,
    }),
    [],
  );
});

test("provider_history_reader_finds_codex_rollouts_written_under_effective_codex_home", () => {
  // Spec: docs_v2/specs/backend-agent-runtime-port-wiring.md
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-provider-ref-home-"));
  const codexHome = fs.mkdtempSync(path.join(tmpdir(), "tide-effective-codex-home-"));
  const rolloutPath = path.join(
    codexHome,
    "sessions",
    "2026",
    "05",
    "30",
    "rollout-2026-05-30T10-11-12-019e7000-0000-7000-a000-000000000001.jsonl",
  );
  writeFile(
    rolloutPath,
    [
      JSON.stringify({
        type: "event_msg",
        payload: { type: "user_message", message: "Effective Codex Home Thread" },
      }),
    ].join("\n"),
  );

  assert.deepEqual(
    readCodexProviderSessionRefsFromHome({
      homeDir: home,
      codexHome,
      sinceMs: Date.now() - 10_000,
      seenKeys: new Set<string>(),
      expectedUserMessage: "Effective Codex Home Thread",
    }),
    [
      {
        agentId: "codex",
        kind: "codex_rollout",
        value: "019e7000-0000-7000-a000-000000000001",
        transcriptPath: rolloutPath,
      },
    ],
  );
});

test("codex_provider_history_reader_projects_agent_message_frame", () => {
  // Spec: docs_v2/specs/live-provider-session-reference-discovery.md
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-codex-history-frame-"));
  const rolloutPath = path.join(
    providerBootstrapArtifactsForHome({ homeDir: home }).codexHome,
    "sessions",
    "2026",
    "05",
    "30",
    "rollout-2026-05-30T10-11-12-019e7000-0000-7000-a000-000000000002.jsonl",
  );
  writeFile(
    rolloutPath,
    [
      JSON.stringify({
        type: "event_msg",
        payload: { type: "user_message", message: "Reply exactly: Codex history" },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "Codex history",
          phase: "final_answer",
        },
      }),
    ].join("\n"),
  );
  const seenKeys = new Set<string>();

  const frames = readCodexProviderHistoryFramesFromHome({
    homeDir: home,
    threadId: "thread-codex-history",
    runtimeId: "runtime-codex-history",
    sinceMs: Date.now() - 10_000,
    seenKeys,
    expectedUserMessage: "Reply exactly: Codex history",
    boundRolloutPath: rolloutPath,
  });

  assert.equal(frames.length, 1);
  assert.equal(frames[0].source, "provider_history");
  assert.equal(frames[0].sourceRef, rolloutPath);
  assert.equal(frames[0].body, "Codex history");
  assert.deepEqual(frames[0].payload, {
    type: "message",
    role: "agent",
    status: "complete",
    blockId: "provider:thread-codex-history:019e7000-0000-7000-a000-000000000002:1",
    body: "Codex history",
    sourceRuntimeId: "runtime-codex-history",
    phase: "final_answer",
  });
  assert.deepEqual(
    readCodexProviderHistoryFramesFromHome({
      homeDir: home,
      threadId: "thread-codex-history",
      runtimeId: "runtime-codex-history",
      sinceMs: Date.now() - 10_000,
      seenKeys,
      expectedUserMessage: "Reply exactly: Codex history",
      boundRolloutPath: rolloutPath,
    }),
    [],
  );
});

test("codex_provider_history_reader_emits_only_the_current_turns_reply", () => {
  // Regression: a codex rollout accumulates the whole session, so prior turns'
  // replies must NOT leak. Only the agent message(s) after the latest matching
  // user message should emit. (Repro of the "gd" stale-reply bug.)
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-codex-history-stale-"));
  const rolloutPath = path.join(
    providerBootstrapArtifactsForHome({ homeDir: home }).codexHome,
    "sessions",
    "2026",
    "05",
    "30",
    "rollout-2026-05-30T10-11-12-019e7000-0000-7000-a000-000000000003.jsonl",
  );
  writeFile(
    rolloutPath,
    [
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "gd" } }),
      JSON.stringify({
        type: "event_msg",
        payload: { type: "agent_message", message: "I do not know what you mean by `gd`." },
      }),
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "hi" } }),
      JSON.stringify({
        type: "event_msg",
        payload: { type: "agent_message", message: "Hello! How can I help?" },
      }),
    ].join("\n"),
  );

  const frames = readCodexProviderHistoryFramesFromHome({
    homeDir: home,
    threadId: "thread-stale",
    runtimeId: "runtime-stale",
    sinceMs: Date.now() - 10_000,
    seenKeys: new Set<string>(),
    expectedUserMessage: "hi",
    boundRolloutPath: rolloutPath,
  });

  assert.equal(frames.length, 1, "only the current turn's reply is emitted");
  assert.equal(frames[0].body, "Hello! How can I help?");
});

test("codex_provider_history_reader_emits_tool_call_and_tool_result_frames", () => {
  // Spec: docs_v2/specs/agent-session-block-rendering-path.md D12
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-codex-tool-"));
  const rolloutPath = path.join(
    providerBootstrapArtifactsForHome({ homeDir: home }).codexHome,
    "sessions",
    "2026",
    "06",
    "01",
    "rollout-2026-06-01T10-11-12-019e7000-0000-7000-a000-00000000000a.jsonl",
  );
  writeFile(
    rolloutPath,
    [
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "list files" } }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: '{"cmd":["ls","-la"]}',
          call_id: "call_abc",
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: { type: "function_call_output", call_id: "call_abc", output: "total 0\n" },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: { type: "agent_message", message: "Listed the files." },
      }),
    ].join("\n"),
  );

  const frames = readCodexProviderHistoryFramesFromHome({
    homeDir: home,
    threadId: "thread-codex-tool",
    runtimeId: "runtime-codex-tool",
    sinceMs: Date.now() - 10_000,
    seenKeys: new Set<string>(),
    expectedUserMessage: "list files",
    boundRolloutPath: rolloutPath,
  });

  // Ordered: tool_call, tool_result, then the agent message.
  assert.deepEqual(
    frames.map((frame) => (frame.payload as { type: string }).type),
    ["tool_call", "tool_result", "message"],
  );
  const call = frames[0].payload as Record<string, unknown>;
  assert.equal(call.toolName, "exec_command");
  assert.equal(call.callId, "call_abc");
  assert.match(String(call.body), /ls/);
  const result = frames[1].payload as Record<string, unknown>;
  assert.equal(result.toolName, "exec_command", "result inherits the matching call's tool name");
  assert.equal(result.callId, "call_abc");
  assert.match(String(result.body), /total 0/);
});

test("claude_provider_history_reader_emits_tool_call_and_tool_result_frames", () => {
  // Spec: docs_v2/specs/agent-session-block-rendering-path.md D12
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-claude-tool-"));
  const transcriptPath = path.join(
    home,
    ".claude",
    "projects",
    "-Users-you-Workspace-tide",
    "7a26b8ab-c91e-4846-aae5-f51ce6b04a40.jsonl",
  );
  writeFile(
    transcriptPath,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "list files" } }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Running ls." },
            { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls -la" } },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "total 0\n" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
      }),
    ].join("\n"),
  );

  const frames = readClaudeProviderHistoryFramesFromHome({
    homeDir: home,
    threadId: "thread-claude-tool",
    runtimeId: "runtime-claude-tool",
    sinceMs: Date.now() - 10_000,
    seenKeys: new Set<string>(),
    expectedUserMessage: "list files",
    boundTranscriptPath: transcriptPath,
  });

  const types = frames.map((frame) => (frame.payload as { type: string }).type);
  // The assistant text, its tool_use, the tool_result, and the final text.
  assert.deepEqual(types, ["message", "tool_call", "tool_result", "message"]);
  const call = frames[1].payload as Record<string, unknown>;
  assert.equal(call.toolName, "Bash");
  assert.equal(call.callId, "toolu_1");
  assert.match(String(call.body), /ls -la/);
  const result = frames[2].payload as Record<string, unknown>;
  assert.equal(result.callId, "toolu_1");
  assert.match(String(result.body), /total 0/);
});

test("rebuilt_codex_conversation_includes_ordered_tool_blocks", () => {
  // Spec: docs_v2/specs/agent-session-block-rendering-path.md UC-5 D12
  const text = [
    JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "list files" } }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: '{"cmd":["ls"]}',
        call_id: "call_z",
      },
    }),
    JSON.stringify({
      type: "response_item",
      payload: { type: "function_call_output", call_id: "call_z", output: "a.txt\n" },
    }),
    JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "Done." } }),
  ].join("\n");

  const blocks = rebuildCodexConversation(text, "thread-x", "session-x", "codex");

  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["user_message", "tool_call", "tool_result", "agent_message"],
  );
  const call = blocks[1];
  assert.equal(call.role, "tool");
  assert.equal(call.title, "exec_command");
  assert.match(String(call.body), /ls/);
  assert.equal(blocks[2].title, "exec_command", "result inherits the call's tool name");
  assert.match(String(blocks[2].body), /a\.txt/);
});

test("rebuilt_claude_conversation_pairs_tool_use_and_tool_result_blocks", () => {
  // Spec: docs_v2/specs/agent-session-block-rendering-path.md UC-5 D12
  const text = [
    JSON.stringify({ type: "user", message: { role: "user", content: "list files" } }),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Running ls." },
          { type: "tool_use", id: "toolu_9", name: "Bash", input: { command: "ls" } },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "a.txt\n" }],
      },
    }),
  ].join("\n");

  const blocks = rebuildClaudeConversation(text, "thread-y", "session-y", "claude");

  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["user_message", "agent_message", "tool_call", "tool_result"],
  );
  assert.equal(blocks[2].title, "Bash");
  assert.match(String(blocks[2].body), /ls/);
  assert.equal(blocks[3].title, "Bash", "result inherits the call's tool name");
  assert.match(String(blocks[3].body), /a\.txt/);
});

test("claude_provider_history_reader_projects_agent_message_frame", () => {
  // Spec: docs_v2/specs/live-provider-session-reference-discovery.md
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-claude-history-frame-"));
  const transcriptPath = path.join(
    home,
    ".claude",
    "projects",
    "-Users-you-Workspace-tide",
    "6a26b8ab-c91e-4846-aae5-f51ce6b04a40.jsonl",
  );
  writeFile(
    transcriptPath,
    [
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: "Reply exactly: Claude history",
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Claude history" }],
        },
      }),
    ].join("\n"),
  );
  const seenKeys = new Set<string>();

  const frames = readClaudeProviderHistoryFramesFromHome({
    homeDir: home,
    threadId: "thread-claude-history",
    runtimeId: "runtime-claude-history",
    sinceMs: Date.now() - 10_000,
    seenKeys,
    expectedUserMessage: "Reply exactly: Claude history",
    boundTranscriptPath: transcriptPath,
  });

  assert.equal(frames.length, 1);
  assert.equal(frames[0].source, "provider_history");
  assert.equal(frames[0].sourceRef, transcriptPath);
  assert.equal(frames[0].body, "Claude history");
  assert.deepEqual(frames[0].payload, {
    type: "message",
    role: "agent",
    status: "complete",
    blockId: "provider:thread-claude-history:6a26b8ab-c91e-4846-aae5-f51ce6b04a40:1",
    body: "Claude history",
    sourceRuntimeId: "runtime-claude-history",
  });
  assert.deepEqual(
    readClaudeProviderHistoryFramesFromHome({
      homeDir: home,
      threadId: "thread-claude-history",
      runtimeId: "runtime-claude-history",
      sinceMs: Date.now() - 10_000,
      seenKeys,
      expectedUserMessage: "Reply exactly: Claude history",
    }),
    [],
  );
});

test("provider_history_readers_ignore_recent_codex_and_claude_files_without_thread_prompt", () => {
  // Spec: docs_v2/specs/live-provider-session-reference-discovery.md
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-provider-ref-correlate-"));
  const codexRolloutPath = path.join(
    home,
    ".codex",
    "sessions",
    "2026",
    "05",
    "27",
    "rollout-2026-05-27T16-03-02-019e683e-6ca4-7422-9c36-3a929746c5ec.jsonl",
  );
  const claudeTranscriptPath = path.join(
    home,
    ".claude",
    "projects",
    "-Users-you-Workspace-tide",
    "6a26b8ab-c91e-4846-aae5-f51ce6b04a39.jsonl",
  );
  writeFile(
    codexRolloutPath,
    [
      JSON.stringify({
        type: "event_msg",
        payload: { type: "user_message", message: "Other active Codex Thread" },
      }),
    ].join("\n"),
  );
  writeFile(
    claudeTranscriptPath,
    [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Other active Claude Thread" },
      }),
    ].join("\n"),
  );

  assert.deepEqual(
    readCodexProviderSessionRefsFromHome({
      homeDir: home,
      sinceMs: Date.now() - 10_000,
      seenKeys: new Set<string>(),
      expectedUserMessage: "Reply exactly: Tide-owned Codex Thread",
    }),
    [],
  );
  assert.deepEqual(
    readClaudeProviderSessionRefsFromHome({
      homeDir: home,
      sinceMs: Date.now() - 10_000,
      seenKeys: new Set<string>(),
      expectedUserMessage: "Reply exactly: Tide-owned Claude Thread",
    }),
    [],
  );
  assert.deepEqual(
    readCodexProviderSessionRefsFromHome({
      homeDir: home,
      sinceMs: Date.now() - 10_000,
      seenKeys: new Set<string>(),
      expectedUserMessage: "Other active Codex Thread",
    }),
    [
      {
        agentId: "codex",
        kind: "codex_rollout",
        value: "019e683e-6ca4-7422-9c36-3a929746c5ec",
        transcriptPath: codexRolloutPath,
      },
    ],
  );
  assert.deepEqual(
    readClaudeProviderSessionRefsFromHome({
      homeDir: home,
      sinceMs: Date.now() - 10_000,
      seenKeys: new Set<string>(),
      expectedUserMessage: "Other active Claude Thread",
    }),
    [
      {
        agentId: "claude",
        kind: "claude_transcript",
        value: "6a26b8ab-c91e-4846-aae5-f51ce6b04a39",
        transcriptPath: claudeTranscriptPath,
      },
    ],
  );
});

test("agent_runtime_wiring_stays_out_of_desktop_and_shared_contracts", () => {
  assert.deepEqual(
    findSourceMentions(["src/desktop", "src/shared/contracts"], [
      /agent-integration-agent-runtime-port/,
      /adapters\/outbound\/agent-runtime/,
      /PtyProcessLauncher/,
    ]),
    [],
  );
});

function fakeIntegration(
  agentId: "codex" | "claude" | "opencode",
  plan: ProviderLaunchPlan,
) {
  return new FakeAgentIntegration(agentId, plan);
}

class FakeAgentIntegration implements AgentIntegrationPort {
  preflightInputs: AgentIntegrationPreflightInput[] = [];
  startInputs: AgentStartPlanInput[] = [];
  resumeInputs: AgentResumePlanInput[] = [];
  private readonly agentId: "codex" | "claude" | "opencode";
  private readonly plan: ProviderLaunchPlan;
  readinessGate: RuntimeReadinessGate = { kind: "immediate" };

  constructor(
    agentId: "codex" | "claude" | "opencode",
    plan: ProviderLaunchPlan,
  ) {
    this.agentId = agentId;
    this.plan = plan;
  }

  async preflight(input: AgentIntegrationPreflightInput): Promise<AgentIntegrationPreflightResult> {
    this.preflightInputs.push(input);
    return {
      agentId: this.agentId,
      ready: true,
      blockers: [],
      capabilities: {
        supportsResume: true,
        supportsTideMcp: true,
        supportsHooks: true,
        supportsReadableHistory: true,
        supportsTurnSteer: this.agentId === "codex",
      },
      launchPlan: this.plan,
    };
  }

  async buildStartPlan(input: AgentStartPlanInput): Promise<ProviderLaunchPlan> {
    this.startInputs.push(input);
    return this.plan;
  }

  async buildResumePlan(input: AgentResumePlanInput): Promise<ProviderLaunchPlan> {
    this.resumeInputs.push(input);
    return {
      ...this.plan,
      args: this.agentId === "codex"
        ? ["resume", input.providerSessionRef.value]
        : ["--conversation", input.providerSessionRef.value],
    };
  }

  turnEndFromHook(): AgentTurnOutcome | null {
    return null;
  }

  turnEndFromHistory(): AgentTurnOutcome | null {
    return null;
  }

  initialTurnReadiness(): RuntimeReadinessGate {
    return this.readinessGate;
  }

  history() {
    // Use the real per-provider connectors so projector tests exercise the same
    // parsing/binding the live loop does.
    if (this.agentId === "codex") {
      return createCodexHistoryConnector();
    }
    if (this.agentId === "claude") {
      return createClaudeHistoryConnector();
    }
    return {
      readFrames: () => [],
      sessionRefFromHookPayload: () => undefined,
    };
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

class ControllableReadinessRegistry implements RuntimeReadinessRegistry {
  private readonly resolvers = new Map<string, () => void>();
  private readonly marked = new Set<string>();

  markToolSurfaceReady(runtimeId: string): void {
    this.marked.add(runtimeId);
    const resolve = this.resolvers.get(runtimeId);
    if (resolve !== undefined) {
      this.resolvers.delete(runtimeId);
      resolve();
    }
  }

  awaitToolSurface(runtimeId: string): Promise<void> {
    if (this.marked.has(runtimeId)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.resolvers.set(runtimeId, resolve));
  }

  forget(runtimeId: string): void {
    this.resolvers.delete(runtimeId);
    this.marked.delete(runtimeId);
  }
}

class CapturingAgentRuntimePort implements AgentRuntimePort {
  writes: { handle: AgentRuntimeHandle; input: TerminalInput }[] = [];

  async start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle> {
    return {
      runtimeId: "runtime-live-prompt",
      threadId: input.threadId,
      agentId: input.agentBinding.agentId,
    };
  }

  async resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle> {
    return {
      runtimeId: "runtime-live-prompt",
      threadId: input.threadId,
      agentId: input.agentBinding.agentId,
    };
  }

  async writeInput(handle: AgentRuntimeHandle, input: TerminalInput): Promise<void> {
    this.writes.push({ handle, input });
  }

  async stop(_handle: AgentRuntimeHandle): Promise<void> {}
}

class CapturingPtyTranscriptPort implements PtyTranscriptPort {
  frames: RawAgentFrame[] = [];

  async append(frame: RawAgentFrame): Promise<void> {
    this.frames.push(frame);
  }
}

function readyProviderReadinessPort(): ProviderReadinessPort {
  return {
    async check(input) {
      return {
        agentId: input.agentId,
        ready: true,
        blockers: [],
      };
    },
  };
}

function liveProviderThreadSeed(input: {
  threadId: string;
  runtimeId: string;
  agentId: "codex" | "claude" | "opencode";
}): ThreadSeed {
  return {
    threadId: input.threadId,
    title: "Live provider prompt",
    agentBinding: {
      agentId: input.agentId,
      runtimeSource: { kind: "provider_cli", integrationId: input.agentId },
    },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
    launchOptions: { model: "provider-default" },
    lifecycleState: "running",
    runtimeState: "running",
    lastKnownState: "running",
    createdAt: now,
    updatedAt: now,
    activeRuntimeHandle: {
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      agentId: input.agentId,
    },
  };
}

function startPlan(agentId: "codex" | "claude" | "opencode"): ProviderLaunchPlan {
  return {
    command:
      agentId === "opencode" ? "opencode" : agentId === "claude" ? "claude" : "codex",
    args: [],
    env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
    cwd: "/repo",
    transport:
      agentId === "opencode"
        ? "acp"
        : agentId === "claude"
          ? "claude_stream_json"
          : "codex_app_server",
  };
}

function sequentialIdGenerator(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function findSourceMentions(relativeRoots: string[], patterns: RegExp[]): string[] {
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
  return violations;
}

function sourceFiles(root: string): string[] {
  const output: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...sourceFiles(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      output.push(fullPath);
    }
  }
  return output;
}
