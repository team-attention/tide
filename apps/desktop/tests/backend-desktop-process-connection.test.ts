// Spec: docs_v2/specs/backend-desktop-process-connection.md

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createFileAppStorage } from "../src/backend/adapters/outbound/app-storage/file-app-storage.ts";
import { createBackendContractMessageAdapter } from "../src/backend/adapters/inbound/contract-message-adapter/contract-message-adapter.ts";
import {
  backendEventsFromThreadRuntimeAsyncEvent,
  createLiveBackendContractMessageAdapter,
  threadSeedFromStorageRecord,
  threadStorageRecordFromThreadSummary,
} from "../src/backend/infrastructure/node/live/live-backend.ts";
import { createThreadPersistenceService } from "../src/backend/application/services/thread/thread-persistence-service.ts";
import {
  createThreadRuntimeService,
  type AgentRuntimeHandle,
  type AgentRuntimePort,
  type AgentRuntimeResumeInput,
  type AgentRuntimeStartInput,
  type ProviderReadinessCheckInput,
  type ProviderReadinessPort,
  type ProviderReadinessResult,
  type PtyTranscriptPort,
  type RawAgentFrame,
  type TerminalInput,
  type ThreadSeed,
  type ThreadRuntimeAsyncEvent,
} from "../src/backend/application/services/thread/thread-runtime-service.ts";
import { createMessagePortBackendClient } from "../src/desktop/adapters/outbound/backend-client/message-port-backend-client.ts";
import {
  createProductShellState,
  selectProductShellChoiceSurfaceRow,
  setProductShellComposerActiveSurface,
  submitProductShellComposerDraft,
  updateProductShellComposerDraft,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import {
  createBackendProcessSupervisor,
  type BackendProcessExit,
  type BackendProcessHandle,
  type BackendProcessLauncher,
} from "../src/desktop/infrastructure/electron/main/backend-process-supervisor.ts";
import {
  CONTRACT_VERSION,
  type BackendCommandEnvelope,
  type BackendCommandKind,
  type BackendCommandPayloadByKind,
  type BackendEventEnvelope,
  type BackendHandshake,
  type RendererHandshake,
  validateBackendEventEnvelope,
} from "../src/shared/contracts/index.ts";

const now = "2026-05-27T00:00:00.000Z";
const later = "2026-05-27T00:00:01.000Z";

test("main_starts_backend_and_brokers_contract_handshake", async () => {
  const backend = new FakeBackendProcess();
  const launcher = new FakeBackendProcessLauncher(backend);
  const supervisor = createBackendProcessSupervisor({
    launcher,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });
  const events = collectSupervisorEvents(supervisor);

  const result = await supervisor.start();

  assert.equal(result.ok, true);
  assert.equal(launcher.spawnCount, 1);
  assert.equal(result.ok && result.handshake.backendInstanceId, "backend-process-1");
  assert.deepEqual(
    events.map((event) => event.payload.state),
    ["starting", "handshaking", "connected"],
  );
});

test("unsupported_contract_version_fails_handshake_before_command_handling", async () => {
  const backend = new FakeBackendProcess({
    handshake: {
      contractVersion: 2 as 1,
      backendInstanceId: "backend-process-2",
      startedAt: now,
      supportedTransports: ["message_port"],
    },
  });
  const supervisor = createBackendProcessSupervisor({
    launcher: new FakeBackendProcessLauncher(backend),
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });
  const events = collectSupervisorEvents(supervisor);

  const result = await supervisor.start();

  assert.equal(result.ok, false);
  assert.equal(backend.receivedMessages.length, 0);
  assert.equal(events.at(-2)?.kind, "contract.error");
  assert.equal(events.at(-2)?.payload.code, "unsupported_contract_version");
  assert.equal(events.at(-1)?.kind, "backend.connectionChanged");
  assert.equal(events.at(-1)?.payload.state, "backend_disconnected");
});

test("message_port_backend_client_rejects_non_envelope_payloads", () => {
  const port = new FakeMessagePort();
  const client = createMessagePortBackendClient({ port });

  const result = client.postCommandEnvelope({
    kind: "composer.sendInput",
    payload: { threadId: "thread-process", input: "continue" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.error.code, "invalid_command");
  assert.deepEqual(port.postedMessages, []);
});

test("renderer_command_reaches_backend_adapter_and_returns_backend_events", async () => {
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
    initialThreads: [threadSeed("thread-process")],
  });
  const adapter = createBackendContractMessageAdapter({
    service,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });
  const port = new LoopbackMessagePort(async (message) =>
    adapter.handleMessage(message),
  );
  const received: BackendEventEnvelope[] = [];
  const client = createMessagePortBackendClient({
    port,
    onEvent: (event) => received.push(event),
  });

  const result = client.postCommandEnvelope(
    commandEnvelope("thread.hydrate", { threadId: "thread-process" }),
  );
  await port.flush();

  assert.equal(result.ok, true);
  assert.deepEqual(
    received.map((event) => event.kind),
    ["command.accepted", "thread.hydrated", "command.completed"],
  );
  assertBackendEventsAreContractEnvelopes(received);
  assert.deepEqual(
    received.map((event) => event.requestId),
    ["req-thread.hydrate", "req-thread.hydrate", "req-thread.hydrate"],
  );
  assert.equal(received[1].payload.thread.threadId, "thread-process");
});

// Spec: workbench-editor-language-intelligence — a workspace.codeIntel query
// round-trips to a requestId-correlated workspace.codeIntelResult event. With
// no engine configured the result is a QUIET miss (ok:false + message), never
// a contract.error per keystroke.
test("workspace_code_intel_query_round_trips_as_code_intel_result_event", async () => {
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
    initialThreads: [threadSeed("thread-process")],
  });
  const adapter = createBackendContractMessageAdapter({
    service,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });
  const port = new LoopbackMessagePort(async (message) =>
    adapter.handleMessage(message),
  );
  const received: BackendEventEnvelope[] = [];
  const client = createMessagePortBackendClient({
    port,
    onEvent: (event) => received.push(event),
  });

  const result = client.postCommandEnvelope(
    commandEnvelope("workspace.codeIntel", {
      cwd: "/repo/tide",
      path: "/repo/tide/src/index.ts",
      kind: "completion",
      content: "const a = 1;",
      line: 0,
      character: 5,
    }),
  );
  await port.flush();

  assert.equal(result.ok, true);
  assert.deepEqual(
    received.map((event) => event.kind),
    ["command.accepted", "workspace.codeIntelResult", "command.completed"],
  );
  assertBackendEventsAreContractEnvelopes(received);
  assert.equal(received[1].requestId, "req-workspace.codeIntel");
  assert.equal(received[1].payload.kind, "completion");
  assert.equal(received[1].payload.ok, false);
  assert.equal(typeof received[1].payload.message, "string");
});

// Regression: completion items carry nested OPTIONAL fields (insertText/detail
// may be undefined). The result event must be deep-sanitized or the envelope
// fails JSON validation in the bridge and silently never reaches the editor —
// autocomplete then looks "empty" while hover (no nested undefineds) works.
test("workspace_code_intel_result_with_nested_undefined_fields_survives_the_contract_boundary", async () => {
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
    initialThreads: [threadSeed("thread-process")],
    workspaceCodeIntelligencePort: {
      async findDefinition() {
        return { ok: false, error: { code: "workspace_code_definition_not_found", message: "x" } };
      },
      async findReferences() {
        return { ok: false, error: { code: "workspace_code_references_not_found", message: "x" } };
      },
      async getCompletions() {
        return {
          ok: true,
          completions: [
            { label: "parse", kind: "method", detail: undefined, insertText: undefined, sortText: "11" },
          ],
        };
      },
      async getHover() {
        return { ok: true, hover: null };
      },
      async getDocumentHighlights() {
        return { ok: true, highlights: [] };
      },
      async getSignatureHelp() {
        return { ok: true, signature: null };
      },
      async getDiagnostics() {
        return { ok: true, diagnostics: [] };
      },
    },
  });
  const adapter = createBackendContractMessageAdapter({
    service,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });
  const port = new LoopbackMessagePort(async (message) =>
    adapter.handleMessage(message),
  );
  const received: BackendEventEnvelope[] = [];
  const client = createMessagePortBackendClient({
    port,
    onEvent: (event) => received.push(event),
  });

  client.postCommandEnvelope(
    commandEnvelope("workspace.codeIntel", {
      cwd: "/repo/tide",
      path: "/repo/tide/src/index.ts",
      kind: "completion",
      content: "JSON.",
      line: 0,
      character: 5,
    }),
  );
  await port.flush();

  // The result event must SURVIVE envelope validation (it is the second event).
  assert.deepEqual(
    received.map((event) => event.kind),
    ["command.accepted", "workspace.codeIntelResult", "command.completed"],
  );
  assertBackendEventsAreContractEnvelopes(received);
  assert.equal(received[1].payload.ok, true);
  assert.deepEqual(received[1].payload.completions, [
    { label: "parse", kind: "method", sortText: "11" },
  ]);
});

test("thread_start_contract_events_include_local_user_message_block_before_completion", async () => {
  // Spec: docs_v2/specs/thread-launch-options-contract.md
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
  });
  const adapter = createBackendContractMessageAdapter({
    service,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });

  const events = await adapter.handleMessage(
    commandEnvelope("thread.start", {
      initialMessage: "Start a real runtime path",
      agentBinding: { agentId: "codex" },
      scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
      launchOptions: { model: "GPT-5.5 High", permission: "workspace-write" },
    }),
  );

  assert.deepEqual(
    events.map((event) => event.kind),
    ["command.accepted", "agentSessionBlock.upserted", "thread.started", "command.completed"],
  );
  assertBackendEventsAreContractEnvelopes(events);
  assert.equal(events[1].payload.block.kind, "user_message");
  assert.equal(events[1].payload.block.role, "user");
  assert.equal(events[1].payload.block.body, "Start a real runtime path");
  assert.deepEqual(events[2].payload.thread.launchOptions, {
    model: "GPT-5.5 High",
    permission: "workspace-write",
  });
});

test("composer_edit_queued_input_command_routes_to_service_and_completes", async () => {
  // Spec: docs_v2/specs/composer-message-edit.md
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
  });
  const adapter = createBackendContractMessageAdapter({
    service,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });

  await adapter.handleMessage(
    commandEnvelope("thread.start", {
      threadId: "th-edit",
      initialMessage: "first",
      agentBinding: { agentId: "codex" },
      scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    }),
  );
  // Queue a follow-up while the first turn is still running.
  await adapter.handleMessage(
    commandEnvelope("composer.sendInput", { threadId: "th-edit", input: "teh typo" }),
  );

  const events = await adapter.handleMessage(
    commandEnvelope("composer.editQueuedInput", { threadId: "th-edit", value: "the fix" }),
  );

  assertBackendEventsAreContractEnvelopes(events);
  assert.deepEqual(
    events.map((event) => event.kind),
    ["command.accepted", "command.completed"],
  );
  const completed = events.find((event) => event.kind === "command.completed");
  assert.equal(completed?.payload.result?.status, "edited");
});

test("product_shell_thread_start_command_reaches_backend_with_selected_agent_binding", async () => {
  // Spec: docs_v2/specs/backend-desktop-process-connection.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
  });
  const adapter = createBackendContractMessageAdapter({
    service,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });
  const withAgentMenu = setProductShellComposerActiveSurface(
    createProductShellState({ includeFixtureData: false }),
    "agent_menu",
  );
  const selected = selectProductShellChoiceSurfaceRow(
    withAgentMenu,
    "agent_menu",
    "gemini",
  );
  const withDraft = updateProductShellComposerDraft(
    selected.state,
    "Run Gemini through the Backend",
  );
  const submitted = submitProductShellComposerDraft(withDraft);

  assert.equal(submitted.command?.kind, "thread.start");

  const events = await adapter.handleMessage(
    commandEnvelope("thread.start", submitted.command.payload),
  );

  assertBackendEventsAreContractEnvelopes(events);
  assert.equal(fakes.readiness.checks[0]?.agentId, "gemini");
  assert.deepEqual(fakes.readiness.checks[0]?.launchOptions, {
    model: "Gemini default",
    permission: "default",
    worktree: "current folder",
    branch: "main",
  });
  assert.equal(fakes.runtime.starts[0]?.agentBinding.agentId, "gemini");
  assert.deepEqual(fakes.runtime.starts[0]?.agentBinding.runtimeSource, {
    kind: "provider_cli",
    integrationId: "gemini",
  });
  assert.deepEqual(fakes.runtime.starts[0]?.launchOptions, {
    model: "Gemini default",
    permission: "default",
    worktree: "current folder",
    branch: "main",
  });
  // Provider CLIs receive the first message as the launch-time initial prompt
  // (reliably starts a turn), not by typing it into the TUI after launch.
  assert.equal(fakes.runtime.starts[0]?.initialPrompt, "Run Gemini through the Backend");
  assert.equal(fakes.runtime.writes.length, 0);
  assert.equal(events[2].kind, "thread.started");
  assert.equal(events[2].payload.thread.agentBinding.agentId, "gemini");
  assert.equal(events[2].payload.thread.launchOptions?.model, "Gemini default");
});

test("thread_list_contract_events_return_backend_thread_summaries", async () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
    initialThreads: [
      threadSeed("thread-visible", {
        title: "Visible thread",
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
      }),
      threadSeed("thread-archived", {
        lifecycleState: "archived",
        lastKnownState: "archived",
      }),
    ],
  });
  const adapter = createBackendContractMessageAdapter({
    service,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });

  const events = await adapter.handleMessage(
    commandEnvelope("thread.list", {}),
  );

  assert.deepEqual(
    events.map((event) => event.kind),
    ["command.accepted", "thread.listed", "command.completed"],
  );
  assert.equal(events[1].payload.threads.length, 1);
  assert.equal(events[1].payload.threads[0]?.threadId, "thread-visible");
  assert.equal(events[1].payload.threads[0]?.scope.kind, "project");
  assert.equal(events[1].payload.threads[0]?.agentBinding.runtimeSource?.kind, "provider_cli");
});

test("thread_hydrate_contract_omits_undefined_provider_session_ref_fields", async () => {
  // Spec: docs_v2/specs/backend-desktop-process-connection.md
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
    initialThreads: [
      threadSeed("thread-provider-ref", {
        agentBinding: {
          agentId: "gemini",
          runtimeSource: { kind: "provider_cli", integrationId: "gemini" },
          providerSessionRef: {
            kind: "gemini_session",
            value: "conversation-1",
            transcriptPath: undefined,
            logPath: undefined,
          },
        },
      }),
    ],
  });
  const adapter = createBackendContractMessageAdapter({
    service,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });

  const events = await adapter.handleMessage(
    commandEnvelope("thread.hydrate", { threadId: "thread-provider-ref" }),
  );

  assertBackendEventsAreContractEnvelopes(events);
  const ref = events[1].payload.thread.agentBinding.providerSessionRef;
  assert.deepEqual(ref, {
    kind: "gemini_session",
    value: "conversation-1",
  });
});

test("agent_runtime_resume_contract_events_resume_without_input_write", async () => {
  // Spec: docs_v2/specs/backend-thread-agent-runtime-lifecycle.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
    initialThreads: [
      threadSeed("thread-resume", {
        agentBinding: {
          agentId: "codex",
          providerSessionRef: {
            kind: "codex_rollout",
            value: "rollout-1",
          },
        },
      }),
    ],
  });
  const adapter = createBackendContractMessageAdapter({
    service,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });

  const events = await adapter.handleMessage(
    commandEnvelope("agentRuntime.resume", { threadId: "thread-resume" }),
  );

  assert.deepEqual(
    events.map((event) => event.kind),
    ["command.accepted", "agentRuntime.stateChanged", "command.completed"],
  );
  assert.equal(events[1].payload.threadId, "thread-resume");
  assert.equal(events[1].payload.state, "running");
  assert.equal(fakes.runtime.resumes[0]?.threadId, "thread-resume");
  assert.equal(fakes.runtime.writes.length, 0);
});

test("workbench_command_open_provider_setup_surface_emits_workbench_changed", async () => {
  // Spec: docs_v2/specs/provider-setup-surface-workbench-command.md
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-setup-surface")],
  });
  const adapter = createBackendContractMessageAdapter({
    service,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });

  const events = await adapter.handleMessage(
    commandEnvelope("workbench.command", {
      threadId: "thread-setup-surface",
      command: "open_provider_setup_surface",
      data: {
        setup: {
          command: "/usr/local/bin/codex",
          args: [],
          cwd: "/repo",
          expectedCompletion: "retry_preflight",
        },
      },
    }),
  );

  assert.deepEqual(
    events.map((event) => event.kind),
    ["command.accepted", "workbench.changed", "command.completed"],
  );
  assertBackendEventsAreContractEnvelopes(events);
  assert.equal(events[1].payload.activePaneId, "id-1");
  assert.equal(events[1].payload.panes[0]?.kind, "terminal");
  assert.equal(events[1].payload.panes[0]?.title, "Provider setup: codex");
  assert.equal(events[1].payload.panes[0]?.command, "/usr/local/bin/codex");
  assert.equal(events[2].payload.result?.handled, true);
});

test("renderer_reconnect_receives_active_thread_snapshot", async () => {
  const backend = new FakeBackendProcess();
  const supervisor = createBackendProcessSupervisor({
    launcher: new FakeBackendProcessLauncher(backend),
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });
  const events = collectSupervisorEvents(supervisor);

  await supervisor.start();
  const reconnectEvents = await supervisor.connectRenderer({
    contractVersion: CONTRACT_VERSION,
    rendererInstanceId: "renderer-reload-1",
    activeThreadId: "thread-process",
  });

  assert.deepEqual(
    reconnectEvents.map((event) => event.kind),
    ["backend.snapshotRequested", "thread.hydrated", "backend.snapshotReady"],
  );
  assert.deepEqual(backend.snapshotRequests, ["thread-process"]);
  assert.equal(
    events.some(
      (event) =>
        event.kind === "backend.connectionChanged" &&
        event.payload.state === "renderer_reconnecting",
    ),
    true,
  );
});

test("backend_keeps_runtime_events_while_renderer_is_disconnected", async () => {
  const backend = new FakeBackendProcess();
  const supervisor = createBackendProcessSupervisor({
    launcher: new FakeBackendProcessLauncher(backend),
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });

  await supervisor.start();
  supervisor.disconnectRenderer();
  backend.observeRuntimeEvent("output collected while renderer was gone");

  const reconnectEvents = await supervisor.connectRenderer({
    contractVersion: CONTRACT_VERSION,
    rendererInstanceId: "renderer-reload-2",
    activeThreadId: "thread-process",
  });

  assert.equal(backend.runtimeObservations.length, 1);
  assert.equal(reconnectEvents[1].kind, "thread.hydrated");
  assert.equal(reconnectEvents[1].payload.blocks?.[0]?.body, "output collected while renderer was gone");
});

test("backend_crash_emits_disconnected_state_without_survived_runtime_claim", async () => {
  const backend = new FakeBackendProcess();
  const supervisor = createBackendProcessSupervisor({
    launcher: new FakeBackendProcessLauncher(backend),
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });
  const events = collectSupervisorEvents(supervisor);

  await supervisor.start();
  backend.emitExit({ reason: "crashed", exitCode: 9 });

  assert.equal(backend.runtimeHandlesLost, true);
  assert.equal(events.at(-1)?.kind, "backend.connectionChanged");
  assert.equal(events.at(-1)?.payload.state, "backend_disconnected");
});

test("app_close_requests_backend_shutdown_before_terminate_path", async () => {
  const backend = new FakeBackendProcess({ neverResolveShutdown: true });
  const supervisor = createBackendProcessSupervisor({
    launcher: new FakeBackendProcessLauncher(backend),
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });

  await supervisor.start();
  await supervisor.shutdownApp({ timeoutMs: 1 });

  assert.deepEqual(backend.lifecycleActions, ["shutdown", "terminate"]);
});

test("desktop_main_supervisor_does_not_import_provider_or_pty_modules", () => {
  const source = readRepoFile(
    "src/desktop/infrastructure/electron/main/backend-process-supervisor.ts",
  );

  assert.doesNotMatch(source, /node-pty|pty-port|agent-integrations|AgentRuntimePort/);
  assert.doesNotMatch(source, /backend\/application\/services/);
  assert.doesNotMatch(source, /backend\/adapters\/outbound/);
});

test("electron_main_uses_utility_process_for_backend_without_importing_backend_internals", () => {
  const source = readMainProcessSource();

  assert.match(source, /utilityProcess\.fork/);
  assert.match(source, /backend-entrypoint\.js/);
  assert.match(source, /validateBackendHandshake/);
  assert.match(source, /validateBackendEventEnvelope/);
  assert.match(source, /ipcMain\.handle\("tide:backend-command"/);
  assert.match(source, /unwrapPortMessage/);
  assert.match(source, /stdio:\s*"pipe"/);
  assert.match(source, /rejectBackendHandshake\?\.\(new Error\(message\)\)/);
  assert.doesNotMatch(source, /from\s+["'][^"']*src\/backend/);
  assert.doesNotMatch(source, /createLiveBackendContractMessageAdapter/);
  assert.doesNotMatch(source, /Backend process bridge is not connected/);
});

test("backend_entrypoint_reads_utility_process_parent_port", () => {
  const source = readRepoFile("src/backend/infrastructure/node/entrypoints/backend-entrypoint.ts");

  assert.match(source, /process[\s\S]*parentPort/);
  assert.match(source, /processParentPort !== undefined/);
  assert.match(source, /unwrapPortMessage/);
  assert.match(source, /await import\("electron"\)/);
});

test("backend_entrypoint_buffers_unscoped_backend_events_emitted_during_command_handling", () => {
  // Spec: docs_v2/specs/backend-desktop-process-connection.md
  const source = readRepoFile("src/backend/infrastructure/node/entrypoints/backend-entrypoint.ts");

  assert.match(source, /onEvent:\s*postOrBufferBackendEvent/);
  assert.match(source, /activeParentCommandCount/);
  assert.match(source, /bufferedBackendEvents/);
  assert.match(source, /event\.requestId === undefined/);
  assert.match(source, /flushBufferedBackendEvents\(\)/);
});

test("electron_main_passes_app_data_root_to_backend_process", () => {
  // Spec: docs_v2/specs/live-backend-persistence-bootstrap.md
  const source = readMainProcessSource();

  assert.match(source, /app\.getPath\("userData"\)/);
  assert.match(source, /TIDE_APP_DATA_ROOT/);
  assert.match(source, /utilityProcess\.fork\(resolveBackendEntrypointPath\(\),\s*\[\],\s*{/s);
});

test("live_backend_wires_file_storage_restore_and_thread_event_persistence", () => {
  // Spec: docs_v2/specs/live-backend-persistence-bootstrap.md
  const source = readRepoFile("src/backend/infrastructure/node/live/live-backend.ts");

  assert.match(source, /createFileAppStorage/);
  assert.match(source, /createThreadPersistenceService/);
  assert.match(source, /restoreThreads/);
  assert.match(source, /listThreadMetadata/);
  assert.match(source, /persistThreadEvents/);
});

test("live_backend_projects_provider_setup_async_events_to_backend_events", async () => {
  // Spec: docs_v2/specs/provider-setup-surface-input-and-retry.md
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-provider-setup-async", {
        launchOptions: { model: "GPT-5.5 High", permission: "workspace-write" },
      }),
    ],
  });
  const hydrated = await service.hydrateThread({
    threadId: "thread-provider-setup-async",
  });
  assert.equal(hydrated.ok, true);
  if (!hydrated.ok) {
    throw new Error("Expected hydrated Thread.");
  }
  const block = {
    blockId: "local-user-1",
    kind: "user_message",
    role: "user" as const,
    status: "complete" as const,
    body: "Run after setup",
    updatedAt: now,
  };
  const asyncEvents: ThreadRuntimeAsyncEvent[] = [
    { kind: "workbench_changed", thread: hydrated.thread },
    {
      kind: "provider_readiness_changed",
      threadId: hydrated.thread.threadId,
      readiness: {
        ready: false,
        agentId: "codex",
        blockers: [
          {
            kind: "directory_trust_required",
            message: "Directory Trust is still required.",
          },
        ],
      },
    },
    {
      kind: "agent_session_block_upserted",
      thread: hydrated.thread,
      block,
    },
    {
      kind: "agent_runtime_state_changed",
      thread: hydrated.thread,
      runtimeState: "running",
    },
    {
      kind: "thread_hydrated",
      thread: hydrated.thread,
      runtimeState: "running",
      blocks: [block],
    },
  ];

  const events = asyncEvents.flatMap(backendEventsFromThreadRuntimeAsyncEvent);

  assert.deepEqual(
    events.map((event) => event.kind),
    [
      "workbench.changed",
      "providerReadiness.changed",
      "agentSessionBlock.upserted",
      "agentRuntime.stateChanged",
      "thread.hydrated",
    ],
  );
  assertBackendEventsAreContractEnvelopes(events);
  const readinessEvent = events.find(
    (event): event is BackendEventEnvelope<"providerReadiness.changed"> =>
      event.kind === "providerReadiness.changed",
  );
  const blockEvent = events.find(
    (event): event is BackendEventEnvelope<"agentSessionBlock.upserted"> =>
      event.kind === "agentSessionBlock.upserted",
  );
  const threadEvent = events.find(
    (event): event is BackendEventEnvelope<"thread.hydrated"> =>
      event.kind === "thread.hydrated",
  );
  assert.equal(readinessEvent?.payload.readiness.blockers[0]?.kind, "directory_trust_required");
  assert.equal(blockEvent?.payload.block.body, "Run after setup");
  assert.equal(threadEvent?.payload.thread.launchOptions?.model, "GPT-5.5 High");
});

test("workbench_terminal_output_async_event_maps_to_a_streaming_contract_event", () => {
  // Spec: docs_v2/specs/workbench-terminal-pane-session.md — live terminal stream.
  const events = backendEventsFromThreadRuntimeAsyncEvent({
    kind: "workbench_terminal_output",
    threadId: "thread-term",
    paneId: "pane-term",
    source: "stdout",
    chunk: "hello[31m world[0m\r\n",
  });

  assert.deepEqual(
    events.map((event) => event.kind),
    ["workbench.terminalOutput"],
  );
  assertBackendEventsAreContractEnvelopes(events);
  const output = events[0] as BackendEventEnvelope<"workbench.terminalOutput">;
  assert.equal(output.payload.threadId, "thread-term");
  assert.equal(output.payload.paneId, "pane-term");
  assert.equal(output.payload.source, "stdout");
  // Escape sequences are preserved for the live terminal renderer.
  assert.equal(output.payload.chunk, "hello[31m world[0m\r\n");
});

test("live_backend_records_runtime_output_blocks_before_hydrate_snapshots", () => {
  // Spec: docs_v2/specs/agent-session-block-rendering-path.md
  // The projection path lives in live-projector.ts (navigable-source-structure).
  const source = readRepoFile("src/backend/infrastructure/node/live/live-projector.ts");

  assert.match(source, /const appendFrameAndEmit = async/);
  // Blocks are recorded into the service's authoritative in-memory state before
  // snapshots; the disk write is COALESCED behind a debounced schedule (Phase 4.1)
  // rather than a full-conversation write per block update.
  assert.match(source, /await recordBlockUpdateInService\(service,\s*update\)/);
  assert.match(source, /schedulePersist\(frameInput\.threadId\)/);
});

test("live_backend_awaits_tide_api_structured_frame_projection_for_push_events", () => {
  // Spec: docs_v2/specs/tide-api-agent-runtime.md
  const source = readRepoFile("src/backend/infrastructure/node/live/live-backend.ts");

  assert.match(source, /onRawFrame:\s*\(frame\)\s*=>\s*{\s*return projector\.ingestStructuredFrame\(frame\);\s*}/s);
  assert.doesNotMatch(source, /onRawFrame:\s*\(frame\)\s*=>\s*{\s*void projector\.ingestStructuredFrame\(frame\);/s);
});

test("thread_summary_storage_record_preserves_scope_and_agent_binding", () => {
  // Spec: docs_v2/specs/thread-launch-options-contract.md
  const record = threadStorageRecordFromThreadSummary({
    threadId: "thread-summary",
    title: "Summary Thread",
    agentBinding: {
      agentId: "codex",
      runtimeSource: { kind: "provider_cli", integrationId: "codex" },
      providerSessionRef: {
        kind: "codex_rollout",
        value: "rollout-1",
        transcriptPath: "/provider/transcript.jsonl",
      },
    },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    launchOptions: { model: "GPT-5.5 High", permission: "workspace-write" },
    createdAt: now,
    updatedAt: later,
    pinned: true,
    archived: false,
    lastKnownState: "idle",
  });
  const seed = threadSeedFromStorageRecord(record);

  assert.equal(record.storageVersion, 1);
  assert.equal(record.executionContext.cwd, "/repo/tide");
  assert.equal(record.providerSessionRef?.observedAt, later);
  assert.equal(seed.threadId, "thread-summary");
  // The persisted pin must survive restore, else reopening the thread writes
  // pinned=false back to disk and erases it.
  assert.equal(seed.pinned, true);
  assert.equal(seed.agentBinding.providerSessionRef?.value, "rollout-1");
  assert.deepEqual(seed.scope, { kind: "project", projectId: "tide", cwd: "/repo/tide" });
  assert.deepEqual(record.launchOptions, {
    model: "GPT-5.5 High",
    permission: "workspace-write",
  });
  assert.deepEqual(seed.launchOptions, {
    model: "GPT-5.5 High",
    permission: "workspace-write",
  });
});

test("live_backend_restores_persisted_threads_before_thread_list", async () => {
  // Spec: docs_v2/specs/thread-launch-options-contract.md
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tide-live-backend-"));
  const storage = createFileAppStorage({ appDataRoot: root });
  const persistence = createThreadPersistenceService({
    storage,
    clock: fixedClock,
    readerVersion: "reader-v1",
  });
  await persistence.saveThreadMetadata(threadStorageRecordFromThreadSummary({
    threadId: "thread-persisted-live",
    title: "Persisted Live",
    agentBinding: {
      agentId: "codex",
      runtimeSource: { kind: "provider_cli", integrationId: "codex" },
    },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    launchOptions: { model: "GPT-5.5 High", permission: "workspace-write" },
    createdAt: now,
    updatedAt: later,
    pinned: false,
    archived: false,
    lastKnownState: "idle",
  }));
  const adapter = createLiveBackendContractMessageAdapter({
    appDataRoot: root,
    env: {
      HOME: root,
      TIDE_SOCKET: path.join(root, "mcp.sock"),
      TIDE_MCP_ENTRYPOINT: path.join(root, "backend-entrypoint.js"),
    },
    startMcpSocket: false,
  });

  const events = await adapter.handleMessage(commandEnvelope("thread.list", {}));

  assert.deepEqual(
    events.map((event) => event.kind),
    ["command.accepted", "thread.listed", "command.completed"],
  );
  assert.equal(events[1].payload.threads[0]?.threadId, "thread-persisted-live");
  assert.equal(events[1].payload.threads[0]?.scope.kind, "project");
  assert.deepEqual(events[1].payload.threads[0]?.launchOptions, {
    model: "GPT-5.5 High",
    permission: "workspace-write",
  });
});

test("electron_main_and_preload_expose_backend_event_push_channel", () => {
  const mainSource = readMainProcessSource();
  const preloadSource = readRepoFile("src/desktop/infrastructure/electron/preload/index.ts");
  const rendererSource = readRepoFile("src/desktop/infrastructure/electron/renderer/renderer-entry.tsx");

  assert.match(mainSource, /webContents\.send\("tide:backend-event"/);
  assert.match(preloadSource, /onBackendEvent/);
  assert.match(preloadSource, /ipcRenderer\.on\("tide:backend-event"/);
  assert.match(rendererSource, /subscribeBackendEvents/);
  assert.match(rendererSource, /onBackendEvent/);
});

test("electron_main_defers_unscoped_backend_events_emitted_during_pending_command", () => {
  // Spec: docs_v2/specs/backend-desktop-process-connection.md
  const mainSource = readMainProcessSource();

  assert.match(mainSource, /deferredBackendBroadcastEvents/);
  assert.match(mainSource, /function deferBackendEventBroadcast/);
  assert.match(mainSource, /pendingBackendRequests\.size > 0/s);
  assert.match(mainSource, /scheduleDeferredBackendBroadcastFlush\(\)/);
  assert.match(mainSource, /setTimeout\(\(\) =>/);
});

test("renderer_entry_surfaces_missing_backend_transport", () => {
  const rendererSource = readRepoFile("src/desktop/infrastructure/electron/renderer/renderer-entry.tsx");

  assert.match(rendererSource, /backend_transport_unavailable/);
  assert.match(rendererSource, /Run Tide through the Electron app to start Agents/);
  assert.match(
    rendererSource,
    /function dispatchBackendCommand[\s\S]*if\s*\(window\.tide === undefined\)\s*{\s*return \[/,
  );
});

function collectSupervisorEvents(
  supervisor: ReturnType<typeof createBackendProcessSupervisor>,
): BackendEventEnvelope[] {
  const events: BackendEventEnvelope[] = [];
  supervisor.onEvent((event) => events.push(event));
  return events;
}

function assertBackendEventsAreContractEnvelopes(events: BackendEventEnvelope[]): void {
  for (const event of events) {
    const validated = validateBackendEventEnvelope(event);
    assert.equal(
      validated.ok,
      true,
      validated.ok ? undefined : `${event.kind}: ${validated.error.message}`,
    );
  }
}

function commandEnvelope<TKind extends BackendCommandKind>(
  kind: TKind,
  payload: BackendCommandPayloadByKind[TKind],
): BackendCommandEnvelope<TKind> {
  return {
    contractVersion: CONTRACT_VERSION,
    requestId: `req-${kind}`,
    kind,
    issuedAt: now,
    payload,
  };
}

function threadSeed(
  threadId: string,
  overrides: Partial<ThreadSeed> = {},
): ThreadSeed {
  return {
    threadId,
    title: "Process connection thread",
    agentBinding: {
      agentId: "codex",
    },
    scope: { kind: "scratch", scratchCwd: `/tmp/${threadId}` },
    lifecycleState: "open",
    runtimeState: "idle",
    lastKnownState: "idle",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createFakes(options: { readiness?: ProviderReadinessResult } = {}) {
  const runtime = new FakeAgentRuntimePort();
  const readiness = new FakeProviderReadinessPort(
    options.readiness ?? {
      ready: true,
      agentId: "codex",
      blockers: [],
    },
  );
  const transcript = new FakePtyTranscriptPort();

  return {
    runtime,
    readiness,
    transcript,
    ports: {
      agentRuntimePort: runtime,
      providerReadinessPort: readiness,
      ptyTranscriptPort: transcript,
    },
  };
}

class FakeAgentRuntimePort implements AgentRuntimePort {
  starts: AgentRuntimeStartInput[] = [];
  resumes: AgentRuntimeResumeInput[] = [];
  writes: { handle: AgentRuntimeHandle; input: TerminalInput }[] = [];

  async start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle> {
    this.starts.push(input);
    return {
      runtimeId: "runtime-start-1",
      threadId: input.threadId,
      agentId: input.agentBinding.agentId,
    };
  }

  async resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle> {
    this.resumes.push(input);
    return {
      runtimeId: "runtime-resume-1",
      threadId: input.threadId,
      agentId: input.agentBinding.agentId,
    };
  }

  async writeInput(
    handle: AgentRuntimeHandle,
    input: TerminalInput,
  ): Promise<void> {
    this.writes.push({ handle, input });
  }

  async stop(_handle: AgentRuntimeHandle): Promise<void> {}
}

class FakeProviderReadinessPort implements ProviderReadinessPort {
  private readonly result: ProviderReadinessResult;
  checks: ProviderReadinessCheckInput[] = [];

  constructor(result: ProviderReadinessResult) {
    this.result = result;
  }

  async check(
    input: ProviderReadinessCheckInput,
  ): Promise<ProviderReadinessResult> {
    this.checks.push(input);
    return {
      ...this.result,
      agentId: input.agentId,
    };
  }
}

class FakePtyTranscriptPort implements PtyTranscriptPort {
  frames: RawAgentFrame[] = [];

  async append(frame: RawAgentFrame): Promise<void> {
    this.frames.push(frame);
  }
}

class FakeMessagePort {
  postedMessages: unknown[] = [];
  private listeners: ((event: { data: unknown }) => void)[] = [];

  postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }

  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void {
    if (type === "message") {
      this.listeners.push(listener);
    }
  }

  removeEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void {
    if (type === "message") {
      this.listeners = this.listeners.filter((current) => current !== listener);
    }
  }

  emit(message: unknown): void {
    for (const listener of this.listeners) {
      listener({ data: message });
    }
  }
}

class LoopbackMessagePort extends FakeMessagePort {
  private pending: Promise<void>[] = [];
  private readonly dispatch: (message: unknown) => Promise<BackendEventEnvelope[]>;

  constructor(dispatch: (message: unknown) => Promise<BackendEventEnvelope[]>) {
    super();
    this.dispatch = dispatch;
  }

  override postMessage(message: unknown): void {
    super.postMessage(message);
    this.pending.push(
      this.dispatch(message).then((events) => {
        for (const event of events) {
          this.emit(event);
        }
      }),
    );
  }

  async flush(): Promise<void> {
    await Promise.all(this.pending);
  }
}

class FakeBackendProcessLauncher implements BackendProcessLauncher {
  spawnCount = 0;
  private readonly process: FakeBackendProcess;

  constructor(process: FakeBackendProcess) {
    this.process = process;
  }

  spawn(): BackendProcessHandle {
    this.spawnCount += 1;
    return this.process;
  }
}

class FakeBackendProcess implements BackendProcessHandle {
  readonly handshake: BackendHandshake;
  readonly neverResolveShutdown: boolean;
  receivedMessages: unknown[] = [];
  snapshotRequests: (string | undefined)[] = [];
  runtimeObservations: string[] = [];
  runtimeHandlesLost = false;
  lifecycleActions: string[] = [];
  private exitListeners: ((exit: BackendProcessExit) => void)[] = [];

  constructor(input: {
    handshake?: BackendHandshake;
    neverResolveShutdown?: boolean;
  } = {}) {
    this.handshake =
      input.handshake ?? {
        contractVersion: CONTRACT_VERSION,
        backendInstanceId: "backend-process-1",
        startedAt: now,
        supportedTransports: ["message_port"],
      };
    this.neverResolveShutdown = input.neverResolveShutdown ?? false;
  }

  async readHandshake(): Promise<BackendHandshake> {
    return this.handshake;
  }

  postMessage(message: unknown): void {
    this.receivedMessages.push(message);
  }

  onExit(listener: (exit: BackendProcessExit) => void): () => void {
    this.exitListeners.push(listener);
    return () => {
      this.exitListeners = this.exitListeners.filter((current) => current !== listener);
    };
  }

  async requestSnapshot(
    handshake: RendererHandshake,
  ): Promise<BackendEventEnvelope[]> {
    this.snapshotRequests.push(handshake.activeThreadId);
    const activeThreadId = handshake.activeThreadId ?? "thread-process";

    return [
      backendEvent("backend.snapshotRequested", {
        activeThreadId,
      }),
      backendEvent("thread.hydrated", {
        thread: {
          threadId: activeThreadId,
          title: "Process connection thread",
          agentBinding: { agentId: "codex" },
          scope: { kind: "scratch", scratchCwd: `/tmp/${activeThreadId}` },
          createdAt: now,
          updatedAt: later,
          pinned: false,
          archived: false,
          lastKnownState: "idle",
        },
        blocks: this.runtimeObservations.map((body, index) => ({
          blockId: `runtime-observation-${index + 1}`,
          threadId: activeThreadId,
          agentId: "codex",
          kind: "raw_fallback",
          role: "runtime",
          status: "complete",
          body,
          updatedAt: later,
        })),
        runtimeState: "idle",
      }),
      backendEvent("backend.snapshotReady", {
        activeThreadId,
      }),
    ];
  }

  observeRuntimeEvent(body: string): void {
    this.runtimeObservations.push(body);
  }

  markRuntimeHandlesLost(): void {
    this.runtimeHandlesLost = true;
  }

  async shutdownGracefully(): Promise<void> {
    this.lifecycleActions.push("shutdown");
    if (this.neverResolveShutdown) {
      return new Promise(() => {});
    }
  }

  terminate(): void {
    this.lifecycleActions.push("terminate");
  }

  emitExit(exit: BackendProcessExit): void {
    for (const listener of this.exitListeners) {
      listener(exit);
    }
  }
}

function backendEvent<TKind extends BackendEventEnvelope["kind"]>(
  kind: TKind,
  payload: Extract<BackendEventEnvelope, { kind: TKind }>["payload"],
): BackendEventEnvelope<TKind> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: `evt-${kind}`,
    kind,
    emittedAt: later,
    payload,
  } as BackendEventEnvelope<TKind>;
}

function fixedClock(): string {
  return now;
}

function sequentialIdGenerator(prefix: string): () => string {
  let nextId = 1;
  return () => `${prefix}-${nextId++}`;
}


// The Electron main process is electron-main.ts plus its sibling main/ modules
// (spec: navigable-source-structure); spec assertions read the whole unit.
function readMainProcessSource(): string {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dir = path.join(repoRoot, "src/desktop/infrastructure/electron/main");
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
    .join("\n");
}

function readRepoFile(relativePath: string): string {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}
