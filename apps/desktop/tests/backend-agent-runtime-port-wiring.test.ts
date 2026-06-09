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
} from "../src/backend/adapters/outbound/agent-runtime/agent-integration-agent-runtime-port.ts";
import type {
  AgentIntegrationPort,
  AgentIntegrationPreflightInput,
  AgentIntegrationPreflightResult,
  AgentPromptSignalInput,
  AgentResumePlanInput,
  AgentStartPlanInput,
  ProviderLaunchPlan,
  RuntimeReadinessGate,
} from "../src/backend/application/ports/outbound/agent-integration-port.ts";
import type { RuntimeReadinessRegistry } from "../src/backend/application/services/runtime-readiness-registry.ts";
import {
  antigravityProviderSessionRefFromTranscriptPath,
  claudeProviderSessionRefFromTranscriptPath,
  codexProviderSessionRefFromRolloutPath,
  createLiveAgentSessionEventProjector,
  providerSessionRefFromProviderSignalPayload,
  readCodexProviderSessionRefsFromHome,
  readCodexProviderHistoryFramesFromHome,
  readClaudeProviderHistoryFramesFromHome,
  readClaudeProviderSessionRefsFromHome,
  rebuildCodexConversation,
  rebuildClaudeConversation,
  rebuildAntigravityConversation,
  readProviderSignalFramesFromSpool,
  readAntigravityProviderHistoryFramesFromHome,
  readAntigravityProviderStateFromHome,
  readClaudeProviderStateFromHome,
  readCodexProviderStateFromHome,
  threadStorageRecordFromThreadSummary,
} from "../src/backend/infrastructure/node/live-backend.ts";
import { createFileAppStorage } from "../src/backend/adapters/outbound/app-storage/file-app-storage.ts";
import {
  ensureProviderBootstrapArtifacts,
  providerBootstrapArtifactsForHome,
} from "../src/backend/infrastructure/node/provider-bootstrap-artifacts.ts";
import { createPythonPtyProcessLauncher } from "../src/backend/adapters/outbound/pty/python-pty-process-launcher.ts";
import { createPtyProviderSetupSurfaceTerminalPort } from "../src/backend/adapters/outbound/pty/provider-setup-surface-pty-port.ts";
import type {
  AgentRuntimeHandle,
  AgentRuntimeStartInput,
  AgentRuntimeResumeInput,
  TerminalInput,
} from "../src/backend/application/domains/agent-runtime/agent-runtime.ts";
import type { PromptState } from "../src/backend/application/domains/thread/thread.ts";
import type { AgentRuntimePort } from "../src/backend/application/ports/outbound/agent-runtime-port.ts";
import type { ProviderReadinessPort } from "../src/backend/application/ports/outbound/provider-readiness-port.ts";
import type { PtyTranscriptPort } from "../src/backend/application/ports/outbound/pty-transcript-port.ts";
import {
  createThreadRuntimeService,
  type RawAgentFrame,
  type ThreadSeed,
} from "../src/backend/application/services/thread-runtime-service.ts";
import { createThreadPersistenceService } from "../src/backend/application/services/thread-persistence-service.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const now = "2026-05-29T00:00:00.000Z";

test("provider_readiness_port_uses_selected_agent_integration_preflight", async () => {
  const codex = fakeIntegration("codex", startPlan("codex"));
  const claude = fakeIntegration("claude", startPlan("claude"));
  const antigravity = fakeIntegration("antigravity", startPlan("antigravity"));
  const readiness = createAgentIntegrationProviderReadinessPort({
    integrations: { codex, claude, antigravity },
  });

  const result = await readiness.check({
    agentId: "antigravity",
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
    launchOptions: { model: "Antigravity default", permission: "default" },
  });

  assert.equal(result.ready, true);
  assert.equal(result.agentId, "antigravity");
  assert.equal(antigravity.preflightInputs.length, 1);
  assert.equal(codex.preflightInputs.length, 0);
  assert.equal(claude.preflightInputs.length, 0);
  assert.deepEqual(antigravity.preflightInputs[0].launchOptions, {
    model: "Antigravity default",
    permission: "default",
  });
});

test("provider_readiness_port_reports_provider_account_blocker_for_tide_api_agent", async () => {
  const codex = fakeIntegration("codex", startPlan("codex"));
  const claude = fakeIntegration("claude", startPlan("claude"));
  const antigravity = fakeIntegration("antigravity", startPlan("antigravity"));
  const readiness = createAgentIntegrationProviderReadinessPort({
    integrations: { codex, claude, antigravity },
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
  assert.equal(antigravity.preflightInputs.length, 0);
});

test("agent_runtime_port_starts_antigravity_launch_plan_and_writes_input", async () => {
  const antigravity = fakeIntegration("antigravity", startPlan("antigravity"));
  const launcher = new FakePtyProcessLauncher();
  const runtime = createAgentIntegrationAgentRuntimePort({
    integrations: {
      codex: fakeIntegration("codex", startPlan("codex")),
      claude: fakeIntegration("claude", startPlan("claude")),
      antigravity,
    },
    launcher,
    clock: () => now,
    idGenerator: sequentialIdGenerator("runtime"),
  });

  const handle = await runtime.start({
    threadId: "thread-ag",
    agentBinding: { agentId: "antigravity" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
    launchOptions: { model: "Antigravity default", permission: "default" },
  });
  await runtime.writeInput(handle, {
    kind: "composer_input",
    value: "Use Antigravity for this turn",
    submittedAt: now,
  });

  assert.equal(handle.agentId, "antigravity");
  assert.equal(antigravity.startInputs.length, 1);
  assert.equal(launcher.starts[0].plan.command, "agy");
  assert.deepEqual(launcher.starts[0].plan.args, []);
  assert.deepEqual(launcher.handles[0].writes, ["Use Antigravity for this turn\r"]);
});

test("agent_runtime_port_delivers_first_turn_only_after_tool_surface_ready", async () => {
  const codex = fakeIntegration("codex", startPlan("codex"));
  codex.readinessGate = { kind: "tool_surface_ready" };
  const launcher = new FakePtyProcessLauncher();
  const registry = new ControllableReadinessRegistry();
  const runtime = createAgentIntegrationAgentRuntimePort({
    integrations: {
      codex,
      claude: fakeIntegration("claude", startPlan("claude")),
      antigravity: fakeIntegration("antigravity", startPlan("antigravity")),
    },
    launcher,
    readinessRegistry: registry,
    clock: () => now,
    idGenerator: sequentialIdGenerator("runtime"),
  });

  const handle = await runtime.start({
    threadId: "thread-codex",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
    launchOptions: { model: "gpt-5.5", permission: "default" },
    initialPrompt: "open a browser",
  });

  // The first prompt is NOT in the launch plan argv.
  assert.ok(!launcher.starts[0].plan.args.includes("open a browser"));
  // And it is NOT written before the tool surface is ready.
  await flushMicrotasks();
  assert.deepEqual(launcher.handles[0].writes, []);

  // Marking the runtime's tool surface ready opens the gate and delivers the turn.
  registry.markToolSurfaceReady(handle.runtimeId);
  await flushMicrotasks();
  assert.deepEqual(launcher.handles[0].writes, ["open a browser\r"]);
});

test("agent_runtime_port_adds_runtime_identity_env_to_provider_process", async () => {
  const codex = fakeIntegration("codex", startPlan("codex"));
  const launcher = new FakePtyProcessLauncher();
  const runtime = createAgentIntegrationAgentRuntimePort({
    integrations: {
      codex,
      claude: fakeIntegration("claude", startPlan("claude")),
      antigravity: fakeIntegration("antigravity", startPlan("antigravity")),
    },
    launcher,
    idGenerator: sequentialIdGenerator("runtime"),
  });

  await runtime.start({
    threadId: "thread-codex",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });

  assert.equal(launcher.starts[0].plan.env.TIDE_THREAD_ID, "thread-codex");
  assert.equal(launcher.starts[0].plan.env.TIDE_RUNTIME_ID, "runtime-1");
  assert.equal(launcher.starts[0].plan.env.TIDE_AGENT_ID, "codex");
  assert.equal(launcher.starts[0].plan.env.TERM, "xterm-256color");
});

test("agent_runtime_port_keeps_one_live_process_per_thread", async () => {
  // Starting a runtime for a Thread that already has a live process tears the old one
  // down first — a Thread must never double-run (two PTYs/rollouts tangle the turn and
  // hang "Working"). Regression guard for the concurrent-spawn hang.
  const launcher = new FakePtyProcessLauncher();
  const runtime = createAgentIntegrationAgentRuntimePort({
    integrations: {
      codex: fakeIntegration("codex", startPlan("codex")),
      claude: fakeIntegration("claude", startPlan("claude")),
      antigravity: fakeIntegration("antigravity", startPlan("antigravity")),
    },
    launcher,
    idGenerator: sequentialIdGenerator("runtime"),
  });

  const binding = { agentId: "codex" as const };
  const scope = { kind: "project" as const, projectId: "tide", cwd: "/repo" };
  await runtime.start({ threadId: "thread-codex", agentBinding: binding, scope });
  await runtime.start({ threadId: "thread-codex", agentBinding: binding, scope });

  assert.equal(launcher.handles.length, 2, "a second start spawns a fresh process");
  assert.equal(launcher.handles[0].stopped, true, "the first process is reaped");
  assert.equal(launcher.handles[1].stopped, false, "the new process stays live");

  // A different Thread is untouched by the dedup.
  await runtime.start({
    threadId: "thread-other",
    agentBinding: binding,
    scope,
  });
  assert.equal(launcher.handles[1].stopped, false, "other-thread start did not reap it");
});

test("agent_runtime_port_notifies_runtime_start_with_identity", async () => {
  const runtimeStarts: Array<{
    threadId: string;
    agentId: "codex" | "claude" | "antigravity";
    runtimeId: string;
  }> = [];
  const launcher = new FakePtyProcessLauncher();
  const runtime = createAgentIntegrationAgentRuntimePort({
    integrations: {
      codex: fakeIntegration("codex", startPlan("codex")),
      claude: fakeIntegration("claude", startPlan("claude")),
      antigravity: fakeIntegration("antigravity", startPlan("antigravity")),
    },
    launcher,
    idGenerator: sequentialIdGenerator("runtime"),
    onRuntimeStarted: (event) => runtimeStarts.push(event),
  });

  await runtime.start({
    threadId: "thread-claude",
    agentBinding: { agentId: "claude" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });

  assert.deepEqual(runtimeStarts, [
    {
      threadId: "thread-claude",
      agentId: "claude",
      runtimeId: "runtime-1",
    },
  ]);
});

test("agent_runtime_port_resumes_provider_session_ref_before_follow_up_write", async () => {
  const codex = fakeIntegration("codex", startPlan("codex"));
  const launcher = new FakePtyProcessLauncher();
  const runtime = createAgentIntegrationAgentRuntimePort({
    integrations: {
      codex,
      claude: fakeIntegration("claude", startPlan("claude")),
      antigravity: fakeIntegration("antigravity", startPlan("antigravity")),
    },
    launcher,
    clock: () => now,
    idGenerator: sequentialIdGenerator("runtime"),
  });

  const handle = await runtime.resume({
    threadId: "thread-codex",
    agentBinding: {
      agentId: "codex",
      providerSessionRef: { kind: "codex_rollout", value: "session-1" },
    },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });
  await runtime.writeInput(handle, {
    kind: "composer_input",
    value: "Continue",
    submittedAt: now,
  });

  assert.equal(codex.resumeInputs[0].providerSessionRef.value, "session-1");
  assert.deepEqual(launcher.starts[0].plan.args, ["resume", "session-1"]);
  assert.deepEqual(launcher.handles[0].writes, ["Continue\r"]);
});

test("agent_runtime_port_writes_provider_native_prompt_value_before_ui_choice_id", async () => {
  const launcher = new FakePtyProcessLauncher();
  const runtime = createAgentIntegrationAgentRuntimePort({
    integrations: {
      codex: fakeIntegration("codex", startPlan("codex")),
      claude: fakeIntegration("claude", startPlan("claude")),
      antigravity: fakeIntegration("antigravity", startPlan("antigravity")),
    },
    launcher,
    clock: () => now,
    idGenerator: sequentialIdGenerator("runtime"),
  });

  const handle = await runtime.start({
    threadId: "thread-prompt-answer",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });
  await runtime.writeInput(handle, {
    kind: "prompt_answer",
    value: "allow_once",
    choiceId: "allow-once",
    promptId: "prompt-1",
    submittedAt: now,
  });
  await runtime.writeInput(handle, {
    kind: "prompt_answer",
    value: "",
    choiceId: "fallback-choice",
    promptId: "prompt-2",
    submittedAt: now,
  });

  assert.deepEqual(launcher.handles[0].writes, ["allow_once\r", "fallback-choice\r"]);
});

// Spec: docs_v2/specs/agent-prompt-surfacing.md — answering a codex TUI menu replays
// keyed navigation on the live PTY, not typed text.
test("agent_runtime_port_replays_codex_menu_navigation_for_tui_prompt_answers", async () => {
  const launcher = new FakePtyProcessLauncher();
  const runtime = createAgentIntegrationAgentRuntimePort({
    integrations: {
      codex: fakeIntegration("codex", startPlan("codex")),
      claude: fakeIntegration("claude", startPlan("claude")),
      antigravity: fakeIntegration("antigravity", startPlan("antigravity")),
    },
    launcher,
    clock: () => now,
    idGenerator: sequentialIdGenerator("runtime"),
  });

  const handle = await runtime.start({
    threadId: "thread-codex-menu",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });

  // Two rows down from the default cursor, then Enter.
  await runtime.writeInput(handle, {
    kind: "prompt_answer",
    value: "codex-menu:2",
    choiceId: "codex-opt-3",
    promptId: "codex-tui-1",
    submittedAt: now,
  });
  // Negative steps navigate up; zero steps is just Enter on the default.
  await runtime.writeInput(handle, {
    kind: "prompt_answer",
    value: "codex-menu:-1",
    choiceId: "codex-opt-1",
    promptId: "codex-tui-2",
    submittedAt: now,
  });
  await runtime.writeInput(handle, {
    kind: "prompt_answer",
    value: "codex-menu:0",
    choiceId: "codex-opt-2",
    promptId: "codex-tui-3",
    submittedAt: now,
  });

  assert.deepEqual(launcher.handles[0].writes, [
    "\x1b[B",
    "\x1b[B",
    "\r",
    "\x1b[A",
    "\r",
    "\r",
  ]);
});

test("agent_runtime_port_forwards_pty_output_with_thread_runtime_context", async () => {
  const outputFrames: {
    threadId: string;
    agentId: string;
    runtimeId: string;
    runtimePid?: number;
    source: PtyProcessOutput["source"];
    body: string;
  }[] = [];
  const launcher = new FakePtyProcessLauncher();
  const runtime = createAgentIntegrationAgentRuntimePort({
    integrations: {
      codex: fakeIntegration("codex", startPlan("codex")),
      claude: fakeIntegration("claude", startPlan("claude")),
      antigravity: fakeIntegration("antigravity", startPlan("antigravity")),
    },
    launcher,
    idGenerator: sequentialIdGenerator("runtime"),
    onOutputFrame: (frame) => {
      outputFrames.push(frame);
    },
  });

  await runtime.start({
    threadId: "thread-output",
    agentBinding: { agentId: "claude" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });
  launcher.emitOutput(0, { source: "stdout", body: "provider output" });

  assert.deepEqual(outputFrames, [
    {
      threadId: "thread-output",
      agentId: "claude",
      runtimeId: "runtime-1",
      runtimePid: undefined,
      source: "stdout",
      body: "provider output",
    },
  ]);
});

test("runtime_port_splits_composer_text_from_submit_key_when_launch_plan_requests_input_timing", async () => {
  const launcher = new FakePtyProcessLauncher();
  const runtime = createAgentIntegrationAgentRuntimePort({
    integrations: {
      codex: fakeIntegration("codex", {
        ...startPlan("codex"),
        inputTiming: { startupDelayMs: 0, preSubmitDelayMs: 0 },
      }),
      claude: fakeIntegration("claude", startPlan("claude")),
      antigravity: fakeIntegration("antigravity", startPlan("antigravity")),
    },
    launcher,
    idGenerator: sequentialIdGenerator("runtime"),
  });

  const handle = await runtime.start({
    threadId: "thread-timing",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });
  await runtime.writeInput(handle, {
    kind: "composer_input",
    value: "Text before submit",
    submittedAt: now,
  });

  assert.deepEqual(launcher.handles[0].writes, ["Text before submit", "\r"]);
});

test("python_pty_process_launcher_round_trips_terminal_input_with_real_pty", async () => {
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
      expectedSignalSources: [{ kind: "pty_transcript", description: "test" }],
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

test("python_pty_process_launcher_sets_terminal_window_size_for_provider_tuis", async () => {
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
      expectedSignalSources: [{ kind: "pty_transcript", description: "test" }],
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

test("python_pty_process_launcher_replies_to_basic_terminal_queries", async () => {
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
      expectedSignalSources: [{ kind: "pty_transcript", description: "test" }],
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
    path.join(repoRoot, "src/backend/infrastructure/node/live-backend.ts"),
    "utf8",
  );

  assert.match(source, /createPtyProviderSetupSurfaceTerminalPort/);
  assert.match(source, /providerSetupSurfaceTerminalPort/);
  assert.match(source, /launcher: ptyLauncher/);
});

test("live_agent_session_projection_emits_prompt_changed_for_prompt_state", () => {
  // Spec: docs_v2/specs/provider-signal-prompt-ingress.md
  const source = fs.readFileSync(
    path.join(repoRoot, "src/backend/infrastructure/node/live-backend.ts"),
    "utf8",
  );

  assert.match(source, /readResult\.promptState/);
  assert.match(source, /recordProviderPromptState/);
  assert.match(source, /kind:\s*"prompt\.changed"/);
});

test("provider_bootstrap_artifacts_create_provider_native_files", () => {
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
  assert.equal(fs.existsSync(artifacts.providerSignalRunnerPath), true);
  assert.equal(fs.existsSync(artifacts.codexHooksPath), true);
  assert.equal(fs.existsSync(artifacts.codexSkillPath), true);
  assert.equal(fs.existsSync(artifacts.claudeMcpConfigPath), true);
  assert.equal(fs.existsSync(artifacts.claudeSettingsPath), true);
  assert.equal(
    fs.existsSync(path.join(artifacts.antigravityPluginSourcePath, "plugin.json")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(artifacts.antigravityPluginSourcePath, "hooks.json")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(artifacts.antigravityPluginSourcePath, "mcp_config.json")),
    true,
  );
  assert.equal(fs.existsSync(artifacts.providerSignalHookPath), true);

  const claudeMcp = fs.readFileSync(artifacts.claudeMcpConfigPath, "utf8");
  assert.match(claudeMcp, /"mcpServers"/);
  assert.match(claudeMcp, /"tide"/);
  assert.match(claudeMcp, /tide-mcp-stdio/);
  assert.match(claudeMcp, /"args": \[\]/);
  assert.match(claudeMcp, /"TIDE_SOCKET": "\/tmp\/tide\.sock"/);
  const antigravityMcp = fs.readFileSync(
    path.join(artifacts.antigravityPluginSourcePath, "mcp_config.json"),
    "utf8",
  );
  assert.match(antigravityMcp, /tide-mcp-stdio/);
  assert.match(antigravityMcp, /"args": \[\]/);
  assert.match(antigravityMcp, /"TIDE_SOCKET": "\/tmp\/tide\.sock"/);
  const tideMcpCommand = fs.readFileSync(artifacts.tideMcpCommandPath, "utf8");
  assert.match(tideMcpCommand, /ELECTRON_RUN_AS_NODE=1 exec/);
  assert.match(tideMcpCommand, /backend-entrypoint\.js/);
  assert.match(tideMcpCommand, / mcp "\$@"/);
  const providerSignalRunner = fs.readFileSync(
    artifacts.providerSignalRunnerPath,
    "utf8",
  );
  assert.match(providerSignalRunner, /TIDE_PROVIDER_SIGNAL_DIR=/);
  assert.match(providerSignalRunner, /provider-signal-hook\.mjs/);
  assert.match(providerSignalRunner, / "\$@"/);
  const codexHooks = fs.readFileSync(artifacts.codexHooksPath, "utf8");
  assert.match(codexHooks, /"PermissionRequest"/);
  assert.match(codexHooks, /provider-signal-runner/);
  assert.doesNotMatch(codexHooks, /provider-signal-hook\.mjs/);
  const codexConfigPath = path.join(artifacts.codexHome, "config.toml");
  const codexConfig = fs.readFileSync(codexConfigPath, "utf8");
  assert.equal(fs.lstatSync(codexConfigPath).isSymbolicLink(), false);
  assert.match(codexConfig, /model = "gpt-5\.5"/);
  assert.match(codexConfig, /\[projects\."\/repo"\]/);
  assert.doesNotMatch(codexConfig, /mcp_servers/);
  assert.doesNotMatch(codexConfig, /paper/);
  assert.equal(
    fs.lstatSync(path.join(artifacts.codexHome, "auth.json")).isSymbolicLink(),
    true,
  );
  assert.equal(
    fs.lstatSync(path.join(artifacts.codexHome, "sessions")).isSymbolicLink(),
    true,
  );
  // D17: the overlay mirrors the full real ~/.codex (minus Tide-owned entries),
  // so Codex's state DBs, plugins, caches, and vendor imports are all linked in —
  // a fixed allow-list would omit version-suffixed state DBs and break Codex startup.
  for (const entry of ["plugins", "vendor_imports", "cache", "state_5.sqlite"]) {
    assert.equal(
      fs.lstatSync(path.join(artifacts.codexHome, entry)).isSymbolicLink(),
      true,
      `${entry} should be mirrored into the overlay CODEX_HOME`,
    );
  }
  // skills stays Tide-owned: the real Codex skills are not linked into the overlay.
  assert.equal(
    fs.existsSync(path.join(artifacts.codexHome, "skills", "impeccable")),
    false,
  );

  // A stale overlay entry (absent from real ~/.codex, not Tide-owned) is pruned on
  // rewrite; the Tide-owned skills dir keeps only the tide skill.
  writeFile(path.join(artifacts.codexHome, "legacy-stray.json"), "{}");
  writeFile(path.join(artifacts.codexHome, "skills", ".system", "SKILL.md"), "# System\n");
  appendCodexOverlayHookTrust(artifacts);
  ensureProviderBootstrapArtifacts({
    homeDir: home,
    tideCommand: "/Applications/Tide.app/Contents/MacOS/Tide",
    tideMcpEntrypoint: "/Applications/Tide.app/Contents/Resources/backend-entrypoint.js",
    tideSocket: "/tmp/tide.sock",
  });
  const codexConfigAfterRewrite = fs.readFileSync(codexConfigPath, "utf8");
  assert.match(codexConfigAfterRewrite, /hooks\.state/);
  assert.match(codexConfigAfterRewrite, /permission_request:0:0/);
  assert.match(codexConfigAfterRewrite, /trusted_hash = "sha256:permission"/);
  assert.equal(fs.existsSync(path.join(artifacts.codexHome, "legacy-stray.json")), false);
  assert.equal(
    fs.existsSync(path.join(artifacts.codexHome, "skills", ".system")),
    false,
  );
  // Real-home entries stay mirrored across rewrites.
  assert.equal(
    fs.lstatSync(path.join(artifacts.codexHome, "cache")).isSymbolicLink(),
    true,
  );
});

test("provider_bootstrap_artifacts_drop_stale_codex_hook_trust_when_hooks_change", () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-provider-state-"));
  const cwd = "/repo";
  writeProviderFiles(home, cwd);
  const artifacts = ensureProviderBootstrapArtifacts({
    homeDir: home,
    tideCommand: "/Applications/Tide.app/Contents/MacOS/Tide",
    tideMcpEntrypoint: "/Applications/Tide.app/Contents/Resources/backend-entrypoint.js",
    tideSocket: "/tmp/tide.sock",
  });
  appendCodexOverlayHookTrust(artifacts);
  fs.writeFileSync(
    artifacts.codexHooksPath,
    JSON.stringify({ hooks: { Stop: [] } }, null, 2) + "\n",
    "utf8",
  );

  ensureProviderBootstrapArtifacts({
    homeDir: home,
    tideCommand: "/Applications/Tide.app/Contents/MacOS/Tide",
    tideMcpEntrypoint: "/Applications/Tide.app/Contents/Resources/backend-entrypoint.js",
    tideSocket: "/tmp/tide.sock",
  });

  const codexConfig = fs.readFileSync(
    path.join(artifacts.codexHome, "config.toml"),
    "utf8",
  );
  assert.doesNotMatch(codexConfig, /hooks\.state/);
  assert.equal(readCodexProviderStateFromHome(home, cwd).hookBootstrapReady, true);
});

test("live_backend_provider_state_readers_require_tide_owned_bootstrap_artifacts", () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-provider-state-"));
  const cwd = "/repo";
  writeProviderFiles(home, cwd);

  assert.equal(readCodexProviderStateFromHome(home, cwd).hookBootstrapReady, false);
  assert.equal(readClaudeProviderStateFromHome(home, cwd).hookBootstrapReady, false);
  assert.equal(
    readAntigravityProviderStateFromHome(home, cwd).pluginBootstrapReady,
    false,
  );
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
  writeFile(path.join(artifacts.antigravityInstalledPluginPath, "plugin.json"), "{}");
  writeFile(path.join(artifacts.antigravityInstalledPluginPath, "hooks.json"), "{}");
  writeFile(path.join(artifacts.antigravityInstalledPluginPath, "mcp_config.json"), "{}");

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
  assert.deepEqual(readAntigravityProviderStateFromHome(home, cwd), {
    authenticated: true,
    onboardingComplete: true,
    trustedCwds: [cwd],
    pluginBootstrapReady: true,
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
  writeFile(
    path.join(home, ".gemini", "antigravity-cli", "cache", "onboarding.json"),
    JSON.stringify({ onboardingComplete: true }),
  );
  writeFile(
    path.join(home, ".gemini", "antigravity-cli", "settings.json"),
    JSON.stringify({ trustedWorkspaces: [cwd] }),
  );
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

test("antigravity_history_reader_reads_only_the_bound_transcript_under_concurrency", () => {
  // Two concurrent antigravity sessions write separate transcripts. A thread bound
  // to one must read ONLY that one — never the other session's content (the recency
  // scan would have mixed them, leaving concurrent agy threads broken).
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-agy-multi-"));
  const transcriptFor = (conversationId: string) =>
    path.join(home, ".gemini", "antigravity-cli", "brain", conversationId, ".system_generated", "logs", "transcript.jsonl");
  const mine = transcriptFor("conv-mine");
  const theirs = transcriptFor("conv-theirs");
  writeFile(mine, JSON.stringify({ step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: "MINE" }));
  writeFile(theirs, JSON.stringify({ step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: "THEIRS" }));

  const frames = readAntigravityProviderHistoryFramesFromHome({
    homeDir: home,
    threadId: "thread-mine",
    runtimeId: "runtime-mine",
    sinceMs: Date.now() - 10_000,
    seenKeys: new Set<string>(),
    boundTranscriptPath: mine,
  });

  assert.ok(frames.some((frame) => frame.body === "MINE"));
  assert.ok(!frames.some((frame) => frame.body === "THEIRS"), "must not read another session's transcript");
});

test("antigravity_provider_history_reader_projects_planner_response_as_agent_message_frame", () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-agy-history-"));
  const transcriptPath = path.join(
    home,
    ".gemini",
    "antigravity-cli",
    "brain",
    "conversation-1",
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );
  writeFile(
    transcriptPath,
    [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        content: "Reply exactly with TIDE_AGY_HISTORY",
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        content: "TIDE_AGY_HISTORY",
      }),
    ].join("\n"),
  );
  const seenKeys = new Set<string>();

  const frames = readAntigravityProviderHistoryFramesFromHome({
    homeDir: home,
    threadId: "thread-agy-history",
    runtimeId: "runtime-agy-history",
    sinceMs: Date.now() - 10_000,
    seenKeys,
    boundTranscriptPath: transcriptPath,
  });

  assert.equal(frames.length, 1);
  assert.equal(frames[0].source, "provider_history");
  assert.equal(frames[0].sourceRef, transcriptPath);
  assert.equal(frames[0].body, "TIDE_AGY_HISTORY");
  assert.deepEqual(frames[0].payload, {
    type: "message",
    role: "agent",
    status: "complete",
    blockId: "provider:thread-agy-history:conversation-1:2",
    body: "TIDE_AGY_HISTORY",
    sourceRuntimeId: "runtime-agy-history",
  });
  assert.deepEqual(
    readAntigravityProviderHistoryFramesFromHome({
      homeDir: home,
      threadId: "thread-agy-history",
      runtimeId: "runtime-agy-history",
      sinceMs: Date.now() - 10_000,
      seenKeys,
      boundTranscriptPath: transcriptPath,
    }),
    [],
  );
});

test("antigravity_provider_history_reader_marks_a_terminal_planner_response_as_turn_complete", () => {
  // Spec: docs_v2/specs/antigravity-turn-completion.md
  // Antigravity has no turn-end hook, so the turn end is read from the transcript:
  // a PLANNER_RESPONSE with content and NO tool_calls is the final answer. An
  // intermediate PLANNER_RESPONSE carries a tool_call and is NOT the turn end.
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-agy-complete-"));
  const transcriptPath = path.join(
    home,
    ".gemini",
    "antigravity-cli",
    "brain",
    "conversation-1",
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );
  writeFile(
    transcriptPath,
    [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        content: "Look around and summarize",
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        tool_calls: [{ name: "list_dir", args: { DirectoryPath: "/repo" } }],
      }),
      JSON.stringify({
        step_index: 3,
        source: "MODEL",
        type: "LIST_DIRECTORY",
        status: "DONE",
        content: "package.json",
      }),
      JSON.stringify({
        step_index: 4,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        content: "It is a battleship game.",
      }),
    ].join("\n"),
  );

  const frames = readAntigravityProviderHistoryFramesFromHome({
    homeDir: home,
    threadId: "thread-agy-complete",
    runtimeId: "runtime-agy-complete",
    sinceMs: Date.now() - 10_000,
    seenKeys: new Set<string>(),
    boundTranscriptPath: transcriptPath,
  });

  const toolCallFrame = frames.find((frame) => frame.payload.type === "tool_call");
  const terminalMessageFrame = frames.find(
    (frame) => frame.payload.type === "message" && frame.body === "It is a battleship game.",
  );

  // The intermediate planner response (a tool call) is not a turn end.
  assert.ok(toolCallFrame, "expected a tool_call frame");
  assert.notEqual(toolCallFrame?.turnComplete, true);
  // The final planner message (content, no tool_calls) IS the turn end.
  assert.ok(terminalMessageFrame, "expected a terminal agent message frame");
  assert.equal(terminalMessageFrame?.turnComplete, true);
});

test("antigravity_provider_history_reader_derives_provider_session_ref_from_transcript_path", () => {
  // Spec: docs_v2/specs/live-provider-session-reference-discovery.md
  const transcriptPath = path.join(
    "/Users/you",
    ".gemini",
    "antigravity-cli",
    "brain",
    "conversation-1",
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );

  assert.deepEqual(
    antigravityProviderSessionRefFromTranscriptPath(transcriptPath),
    {
      agentId: "antigravity",
      kind: "antigravity_conversation",
      value: "conversation-1",
      transcriptPath,
    },
  );
});

test("live_backend_projector_persists_antigravity_provider_session_ref", async () => {
  // Spec: docs_v2/specs/live-provider-session-reference-discovery.md
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-live-agy-ref-"));
  const appDataRoot = fs.mkdtempSync(path.join(tmpdir(), "tide-live-agy-ref-data-"));
  const threadId = "thread-live-agy-ref";
  const runtimeId = "runtime-live-agy-ref";
  const conversationId = "conversation-live-agy";
  const transcriptPath = path.join(
    home,
    ".gemini",
    "antigravity-cli",
    "brain",
    conversationId,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );
  writeFile(
    transcriptPath,
    JSON.stringify({
      step_index: 4,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      content: "Persisted Antigravity output",
    }),
  );
  const service = createThreadRuntimeService({
    agentRuntimePort: new CapturingAgentRuntimePort(),
    providerReadinessPort: readyProviderReadinessPort(),
    ptyTranscriptPort: new CapturingPtyTranscriptPort(),
    clock: () => now,
    idGenerator: sequentialIdGenerator("live-agy"),
    initialThreads: [
      liveProviderThreadSeed({
        threadId,
        runtimeId,
        agentId: "antigravity",
      }),
    ],
  });
  const persistence = createThreadPersistenceService({
    storage: createFileAppStorage({ appDataRoot }),
    clock: () => now,
    readerVersion: "test-live-agy-ref",
  });
  const saved = await persistence.saveThreadMetadata(
    threadStorageRecordFromThreadSummary({
      threadId,
      title: "Live Antigravity ref",
      agentBinding: {
        agentId: "antigravity",
        runtimeSource: { kind: "provider_cli", integrationId: "antigravity" },
      },
      scope: { kind: "project", projectId: "tide", cwd: "/repo" },
      launchOptions: { model: "Antigravity default" },
      createdAt: now,
      updatedAt: now,
      pinned: false,
      archived: false,
      lastKnownState: "running",
    }),
  );
  assert.equal(saved.ok, true);
  const projector = createLiveAgentSessionEventProjector({
    service: () => service,
    persistence,
    homeDir: home,
    integrations: {
      codex: fakeIntegration("codex", startPlan("codex")),
      claude: fakeIntegration("claude", startPlan("claude")),
      antigravity: fakeIntegration("antigravity", startPlan("antigravity")),
    },
    providerSignalSpoolDir: path.join(home, ".tide", "agent-bootstrap", "provider-signals"),
  });

  // Model: the provider session is bound to the thread by the agent's HOOK (which
  // reports its conversation + transcript path), not by scanning recent files. Feed
  // that agent-running signal so the projector binds, then reads the bound transcript.
  writeFile(
    path.join(home, ".tide", "agent-bootstrap", "provider-signals", `${runtimeId}.jsonl`),
    JSON.stringify({
      threadId,
      runtimeId,
      agent: "antigravity",
      event: "agent-running",
      payload: { conversationId, transcriptPath },
    }),
  );

  await projector.ingestOutput({
    threadId,
    agentId: "antigravity",
    runtimeId,
    source: "stdout",
    body: "provider output tick",
  });
  const hydrated = await service.hydrateThread({ threadId });
  const loaded = await persistence.loadThreadMetadata(threadId);

  assert.equal(hydrated.ok, true);
  if (!hydrated.ok) {
    assert.fail("Expected hydrated Thread.");
  }
  assert.equal(
    hydrated.thread.agentBinding.providerSessionRef?.kind,
    "antigravity_conversation",
  );
  assert.equal(hydrated.thread.agentBinding.providerSessionRef?.value, conversationId);
  assert.equal(hydrated.thread.agentBinding.providerSessionRef?.transcriptPath, transcriptPath);
  assert.equal(
    hydrated.blocks.some((block) => block.body === "Persisted Antigravity output"),
    true,
  );
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("Expected persisted Thread metadata.");
  }
  assert.equal(loaded.value.providerSessionRef?.kind, "antigravity_conversation");
  assert.equal(loaded.value.providerSessionRef?.value, conversationId);
  assert.equal(loaded.value.providerSessionRef?.transcriptPath, transcriptPath);
  assert.equal(
    loaded.value.agentBinding.providerSessionRef?.value,
    conversationId,
  );
});

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

test("antigravity_provider_history_reader_emits_tool_call_and_tool_result_frames", () => {
  // Spec: docs_v2/specs/agent-session-block-rendering-path.md D12
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-agy-tool-"));
  const transcriptPath = path.join(
    home,
    ".gemini",
    "antigravity-cli",
    "brain",
    "11111111-2222-3333-4444-555555555555",
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );
  writeFile(
    transcriptPath,
    [
      JSON.stringify({ step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", content: "list it" }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        tool_calls: [{ name: "list_dir", args: { DirectoryPath: "/tmp", toolSummary: "List directory" } }],
      }),
      JSON.stringify({ step_index: 3, source: "MODEL", type: "LIST_DIRECTORY", content: "a.txt\nb.txt\n" }),
      JSON.stringify({
        step_index: 4,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        content: "Two files.",
      }),
    ].join("\n"),
  );

  const frames = readAntigravityProviderHistoryFramesFromHome({
    homeDir: home,
    threadId: "thread-agy-tool",
    runtimeId: "runtime-agy-tool",
    sinceMs: Date.now() - 10_000,
    seenKeys: new Set<string>(),
    boundTranscriptPath: transcriptPath,
  });

  assert.deepEqual(
    frames.map((frame) => (frame.payload as { type: string }).type),
    ["tool_call", "tool_result", "message"],
  );
  const call = frames[0].payload as Record<string, unknown>;
  assert.equal(call.toolName, "list_dir");
  assert.match(String(call.body), /DirectoryPath|tmp|List directory/);
  const result = frames[1].payload as Record<string, unknown>;
  assert.equal(result.toolName, "list_dir", "result inherits the preceding call's tool name");
  assert.match(String(result.body), /a\.txt/);
  assert.equal(frames[2].body, "Two files.");
});

test("rebuilt_antigravity_conversation_includes_ordered_tool_blocks", () => {
  // Spec: docs_v2/specs/agent-session-block-rendering-path.md UC-5 D12
  const text = [
    JSON.stringify({ step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", content: "<USER_REQUEST>\nlist it\n</USER_REQUEST>" }),
    JSON.stringify({
      step_index: 2,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      tool_calls: [{ name: "view_file", args: { AbsolutePath: "/tmp/x.json" } }],
    }),
    JSON.stringify({ step_index: 3, source: "MODEL", type: "VIEW_FILE", content: "1: {}\n" }),
    JSON.stringify({ step_index: 4, source: "MODEL", type: "PLANNER_RESPONSE", content: "Read it." }),
  ].join("\n");

  const blocks = rebuildAntigravityConversation(text, "thread-agy", "conv-agy", "antigravity");

  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["user_message", "tool_call", "tool_result", "agent_message"],
  );
  assert.equal(blocks[0].body, "list it", "user prompt is unwrapped from <USER_REQUEST>");
  assert.equal(blocks[1].title, "view_file");
  assert.equal(blocks[2].title, "view_file");
  assert.match(String(blocks[2].body), /\{\}/);
  assert.equal(blocks[3].body, "Read it.");
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

test("provider_signal_spool_reader_reads_runtime_scoped_hook_records_once", () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-provider-signals-"));
  const artifacts = ensureProviderBootstrapArtifacts({
    homeDir: home,
    tideCommand: "/Applications/Tide.app/Contents/MacOS/Tide",
  });
  const spoolPath = path.join(artifacts.providerSignalSpoolDir, "runtime-signal-1.jsonl");
  writeFile(
    spoolPath,
    [
      JSON.stringify({
        agent: "codex",
        event: "PermissionRequest",
        threadId: "thread-signal",
        runtimeId: "runtime-signal-1",
        payload: { call_id: "call-1", tool_input: { command: "npm test" } },
      }),
      JSON.stringify({
        agent: "claude",
        event: "Notification",
        threadId: "other-thread",
        runtimeId: "other-runtime",
        payload: { message: "ignore me" },
      }),
    ].join("\n"),
  );
  const seenKeys = new Set<string>();

  const firstRead = readProviderSignalFramesFromSpool({
    spoolDir: artifacts.providerSignalSpoolDir,
    threadId: "thread-signal",
    agentId: "codex",
    runtimeId: "runtime-signal-1",
    seenKeys,
  });
  const secondRead = readProviderSignalFramesFromSpool({
    spoolDir: artifacts.providerSignalSpoolDir,
    threadId: "thread-signal",
    agentId: "codex",
    runtimeId: "runtime-signal-1",
    seenKeys,
  });

  assert.equal(firstRead.length, 1);
  assert.equal(firstRead[0].eventName, "PermissionRequest");
  assert.deepEqual(firstRead[0].payload, {
    call_id: "call-1",
    tool_input: { command: "npm test" },
  });
  assert.deepEqual(secondRead, []);
});

test("live_provider_signal_spool_prompt_roundtrip_records_prompt_and_preserves_provider_value", async () => {
  // Spec: docs_v2/specs/provider-signal-prompt-ingress.md
  // Spec: docs_v2/specs/provider-signal-spool-ingress.md
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-live-provider-signal-"));
  const appDataRoot = fs.mkdtempSync(path.join(tmpdir(), "tide-live-provider-data-"));
  const artifacts = ensureProviderBootstrapArtifacts({
    homeDir: home,
    tideCommand: "/Applications/Tide.app/Contents/MacOS/Tide",
  });
  const runtime = new CapturingAgentRuntimePort();
  const service = createThreadRuntimeService({
    agentRuntimePort: runtime,
    providerReadinessPort: readyProviderReadinessPort(),
    ptyTranscriptPort: new CapturingPtyTranscriptPort(),
    clock: () => now,
    idGenerator: sequentialIdGenerator("live"),
    initialThreads: [
      liveProviderThreadSeed({
        threadId: "thread-live-prompt",
        runtimeId: "runtime-live-prompt",
        agentId: "codex",
      }),
    ],
  });
  const persistence = createThreadPersistenceService({
    storage: createFileAppStorage({ appDataRoot }),
    clock: () => now,
    readerVersion: "test-live-provider-signal",
  });
  const events: { kind: string; payload: unknown }[] = [];
  const projector = createLiveAgentSessionEventProjector({
    service: () => service,
    persistence,
    onEvent: (event) => events.push({ kind: event.kind, payload: event.payload }),
    homeDir: home,
    integrations: {
      codex: fakeIntegration("codex", startPlan("codex"), (input) => {
        if (input.eventName !== "PermissionRequest") {
          return null;
        }
        return {
          promptId: "prompt-live-permission",
          threadId: input.threadId,
          agentId: "codex",
          kind: "permission",
          message: "Allow provider command?",
          source: "provider_hook",
          choices: [
            {
              choiceId: "allow-once",
              label: "Allow once",
              providerValue: "allow_once",
            },
            {
              choiceId: "deny",
              label: "Deny",
              providerValue: "deny",
            },
          ],
        };
      }),
      claude: fakeIntegration("claude", startPlan("claude")),
      antigravity: fakeIntegration("antigravity", startPlan("antigravity")),
    },
    providerSignalSpoolDir: artifacts.providerSignalSpoolDir,
  });
  writeFile(
    path.join(artifacts.providerSignalSpoolDir, "runtime-live-prompt.jsonl"),
    JSON.stringify({
      agent: "codex",
      event: "PermissionRequest",
      threadId: "thread-live-prompt",
      runtimeId: "runtime-live-prompt",
      payload: { call_id: "call-live", tool_input: { command: "npm test" } },
    }),
  );

  await projector.ingestOutput({
    threadId: "thread-live-prompt",
    agentId: "codex",
    runtimeId: "runtime-live-prompt",
    source: "stdout",
    body: "provider output tick",
  });
  const hydrated = await service.hydrateThread({ threadId: "thread-live-prompt" });
  const promptEvent = events.find((event) => event.kind === "prompt.changed");

  assert.equal(hydrated.ok, true);
  assert.equal(hydrated.thread.runtimeState, "waiting_for_approval");
  assert.equal(hydrated.thread.promptState?.promptId, "prompt-live-permission");
  assert.equal(hydrated.thread.promptState?.source, "provider_hook");
  assert.notEqual(promptEvent, undefined);

  const answer = await service.answerPrompt({
    threadId: "thread-live-prompt",
    promptId: "prompt-live-permission",
    choiceId: "allow-once",
  });

  assert.equal(answer.ok, true);
  assert.equal(runtime.writes[0]?.handle.runtimeId, "runtime-live-prompt");
  assert.equal(runtime.writes[0]?.input.kind, "prompt_answer");
  assert.equal(runtime.writes[0]?.input.value, "allow_once");
  assert.equal(runtime.writes[0]?.input.choiceId, "allow-once");
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
  agentId: "codex" | "claude" | "antigravity",
  plan: ProviderLaunchPlan,
  promptDetector?: (input: AgentPromptSignalInput) => PromptState | null,
) {
  return new FakeAgentIntegration(agentId, plan, promptDetector);
}

class FakeAgentIntegration implements AgentIntegrationPort {
  preflightInputs: AgentIntegrationPreflightInput[] = [];
  startInputs: AgentStartPlanInput[] = [];
  resumeInputs: AgentResumePlanInput[] = [];
  private readonly agentId: "codex" | "claude" | "antigravity";
  private readonly plan: ProviderLaunchPlan;
  private readonly promptDetector?: (input: AgentPromptSignalInput) => PromptState | null;
  readinessGate: RuntimeReadinessGate = { kind: "immediate" };

  constructor(
    agentId: "codex" | "claude" | "antigravity",
    plan: ProviderLaunchPlan,
    promptDetector?: (input: AgentPromptSignalInput) => PromptState | null,
  ) {
    this.agentId = agentId;
    this.plan = plan;
    this.promptDetector = promptDetector;
  }

  async preflight(input: AgentIntegrationPreflightInput): Promise<AgentIntegrationPreflightResult> {
    this.preflightInputs.push(input);
    return {
      agentId: this.agentId,
      ready: true,
      blockers: [],
      capabilities: {
        supportsHiddenPty: true,
        supportsResume: true,
        supportsTideMcp: true,
        supportsHooks: true,
        supportsReadableHistory: true,
        requiresTerminalKeyProtocol: this.agentId === "claude",
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

  detectPromptState(input: AgentPromptSignalInput) {
    return this.promptDetector?.(input) ?? null;
  }

  initialTurnReadiness(): RuntimeReadinessGate {
    return this.readinessGate;
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
  agentId: "codex" | "claude" | "antigravity";
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

function startPlan(agentId: "codex" | "claude" | "antigravity"): ProviderLaunchPlan {
  return {
    command:
      agentId === "antigravity" ? "agy" : agentId === "claude" ? "claude" : "codex",
    args: [],
    env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
    cwd: "/repo",
    expectedSignalSources: [{ kind: "pty_transcript", description: "test" }],
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
