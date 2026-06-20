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
  type PtyProcessHandle,
  type PtyProcessLauncher,
  type PtyProcessOutput,
  type PtyProcessSpawnInput,
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
import {
  createGeminiHistoryConnector,
} from "../src/backend/adapters/outbound/agent-integrations/gemini/gemini-history-connector.ts";
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
import { createPtyProviderSetupSurfaceTerminalPort } from "../src/backend/adapters/outbound/pty/provider-setup-surface-pty-port.ts";
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
  const gemini = fakeIntegration("gemini", startPlan("gemini"));
  const readiness = createAgentIntegrationProviderReadinessPort({
    integrations: { codex, claude, gemini },
  });

  const result = await readiness.check({
    agentId: "gemini",
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
    launchOptions: { model: "Gemini default", permission: "default" },
  });

  assert.equal(result.ready, true);
  assert.equal(result.agentId, "gemini");
  assert.equal(gemini.preflightInputs.length, 1);
  assert.equal(codex.preflightInputs.length, 0);
  assert.equal(claude.preflightInputs.length, 0);
  assert.deepEqual(gemini.preflightInputs[0].launchOptions, {
    model: "Gemini default",
    permission: "default",
  });
});

test("provider_readiness_port_reports_provider_account_blocker_for_tide_api_agent", async () => {
  const codex = fakeIntegration("codex", startPlan("codex"));
  const claude = fakeIntegration("claude", startPlan("claude"));
  const gemini = fakeIntegration("gemini", startPlan("gemini"));
  const readiness = createAgentIntegrationProviderReadinessPort({
    integrations: { codex, claude, gemini },
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
      kind: "provider_account_required",
      message: "OpenAI Provider Account setup is required before starting this Tide API Agent.",
      scope: "provider",
      action: "open_provider",
    },
  ]);
  assert.equal(codex.preflightInputs.length, 0);
  assert.equal(claude.preflightInputs.length, 0);
  assert.equal(gemini.preflightInputs.length, 0);
});

// Spec: docs_v2/specs/mid-thread-launch-option-changes.md — a session-config
// update for a runtime the port does not know degrades to restart_required
// (the conservative default), never to a silent "applied".
test("apply_session_config_without_a_live_runtime_requires_restart", async () => {
  const codex = fakeIntegration("codex", startPlan("codex"));
  const claude = fakeIntegration("claude", startPlan("claude"));
  const gemini = fakeIntegration("gemini", startPlan("gemini"));
  const port = createAgentIntegrationAgentRuntimePort({
    integrations: { codex, claude, gemini },
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

test("provider_setup_surface_pty_port_uses_pty_launcher_and_forwards_output", async () => {
  // Spec: docs_v2/specs/provider-setup-surface-terminal-lifecycle.md
  const launcher = new FakePtyProcessLauncher();
  const port = createPtyProviderSetupSurfaceTerminalPort({
    launcher,
    idGenerator: () => "setup-runtime-1",
  });
  const outputs: PtyProcessOutput[] = [];

  const handle = await port.start({
    threadId: "thread-setup",
    paneId: "pane-setup",
    command: "/bin/echo",
    args: ["hello"],
    env: { TIDE_SETUP_TEST: "1" },
    cwd: repoRoot,
    onOutput: (output) => outputs.push(output),
  });
  launcher.starts[0].onOutput?.({ source: "stdout", body: "hello\n" });
  await handle.stop();

  assert.equal(handle.surfaceRuntimeId, "setup-runtime-1");
  assert.equal(launcher.starts[0].runtimeId, "setup-runtime-1");
  assert.equal(launcher.starts[0].plan.command, "/bin/echo");
  assert.deepEqual(launcher.starts[0].plan.args, ["hello"]);
  assert.equal(launcher.starts[0].plan.env.TIDE_SETUP_TEST, "1");
  assert.equal(launcher.starts[0].plan.cwd, repoRoot);
  assert.deepEqual(outputs, [{ source: "stdout", body: "hello\n" }]);
  assert.equal(launcher.handles[0].stopped, true);
});

test("provider_setup_surface_pty_port_forwards_terminal_input_and_exit", async () => {
  // Spec: docs_v2/specs/provider-setup-surface-input-and-retry.md
  const launcher = new FakePtyProcessLauncher();
  const port = createPtyProviderSetupSurfaceTerminalPort({
    launcher,
    idGenerator: () => "setup-runtime-input",
  });
  const exits: { exitCode: number | null; signal: string | null }[] = [];

  const handle = await port.start({
    threadId: "thread-setup",
    paneId: "pane-setup",
    command: "/bin/cat",
    args: [],
    cwd: repoRoot,
    onExit: (exit) => exits.push(exit),
  });
  await handle.write("\u001b[B\r");
  launcher.emitExit(0, { exitCode: 0, signal: null });

  assert.deepEqual(launcher.handles[0].writes, ["\u001b[B\r"]);
  assert.deepEqual(exits, [{ exitCode: 0, signal: null }]);
});

test("live_backend_uses_pty_port_for_provider_setup_surface", () => {
  // Spec: docs_v2/specs/provider-setup-surface-terminal-lifecycle.md
  const source = fs.readFileSync(
    path.join(repoRoot, "src/backend/infrastructure/node/live/live-backend.ts"),
    "utf8",
  );

  assert.match(source, /createPtyProviderSetupSurfaceTerminalPort/);
  assert.match(source, /providerSetupSurfaceTerminalPort/);
  assert.match(source, /launcher: ptyLauncher/);
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
  writeFile(path.join(home, ".gemini", "oauth_creds.json"), "{}");
}

function appendCodexOverlayHookTrust(
  artifacts: ReturnType<typeof providerBootstrapArtifactsForHome>,
): void {
  fs.appendFileSync(
    path.join(artifacts.codexHome, "config.toml"),
    `\n[hooks.state."${artifacts.codexHooksPath}:permission_request:0:0"]\ntrusted_hash = "sha256:permission"\n\n[hooks.state."${artifacts.codexHooksPath}:user_prompt_submit:0:0"]\ntrusted_hash = "sha256:prompt"\n\n[hooks.state."${artifacts.codexHooksPath}:stop:0:0"]\ntrusted_hash = "sha256:stop"\n`,
    "utf8",
  );
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

test("provider_history_reader_finds_codex_rollouts_written_under_tide_overlay_home", () => {
  // Spec: docs_v2/specs/backend-agent-runtime-port-wiring.md
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-provider-ref-overlay-"));
  const artifacts = providerBootstrapArtifactsForHome({ homeDir: home });
  const overlayRolloutPath = path.join(
    artifacts.codexHome,
    "sessions",
    "2026",
    "05",
    "30",
    "rollout-2026-05-30T10-11-12-019e7000-0000-7000-a000-000000000001.jsonl",
  );
  writeFile(
    overlayRolloutPath,
    [
      JSON.stringify({
        type: "event_msg",
        payload: { type: "user_message", message: "Overlay Codex Thread" },
      }),
    ].join("\n"),
  );

  assert.deepEqual(
    readCodexProviderSessionRefsFromHome({
      homeDir: home,
      sinceMs: Date.now() - 10_000,
      seenKeys: new Set<string>(),
      expectedUserMessage: "Overlay Codex Thread",
    }),
    [
      {
        agentId: "codex",
        kind: "codex_rollout",
        value: "019e7000-0000-7000-a000-000000000001",
        transcriptPath: overlayRolloutPath,
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
  agentId: "codex" | "claude" | "gemini",
  plan: ProviderLaunchPlan,
) {
  return new FakeAgentIntegration(agentId, plan);
}

class FakeAgentIntegration implements AgentIntegrationPort {
  preflightInputs: AgentIntegrationPreflightInput[] = [];
  startInputs: AgentStartPlanInput[] = [];
  resumeInputs: AgentResumePlanInput[] = [];
  private readonly agentId: "codex" | "claude" | "gemini";
  private readonly plan: ProviderLaunchPlan;
  readinessGate: RuntimeReadinessGate = { kind: "immediate" };

  constructor(
    agentId: "codex" | "claude" | "gemini",
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
    if (this.agentId === "gemini") {
      return createGeminiHistoryConnector({});
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
  agentId: "codex" | "claude" | "gemini";
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

function startPlan(agentId: "codex" | "claude" | "gemini"): ProviderLaunchPlan {
  return {
    command:
      agentId === "gemini" ? "gemini" : agentId === "claude" ? "claude" : "codex",
    args: [],
    env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
    cwd: "/repo",
    transport:
      agentId === "gemini"
        ? "acp"
        : agentId === "claude"
          ? "claude_stream_json"
          : "codex_app_server",
  };
}

class FakePtyProcessLauncher implements PtyProcessLauncher {
  starts: PtyProcessSpawnInput[] = [];
  handles: FakePtyProcessHandle[] = [];

  async spawn(input: PtyProcessSpawnInput): Promise<PtyProcessHandle> {
    this.starts.push(input);
    const handle = new FakePtyProcessHandle(input.runtimeId);
    this.handles.push(handle);
    return handle;
  }

  emitOutput(index: number, output: PtyProcessOutput): void {
    this.starts[index].onOutput?.(output);
  }

  emitExit(index: number, exit: { exitCode: number | null; signal: string | null }): void {
    this.starts[index].onExit?.(exit);
  }
}

class FakePtyProcessHandle implements PtyProcessHandle {
  readonly runtimeId: string;
  writes: string[] = [];
  stopped = false;

  constructor(runtimeId: string) {
    this.runtimeId = runtimeId;
  }

  async write(data: string): Promise<void> {
    this.writes.push(data);
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
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
