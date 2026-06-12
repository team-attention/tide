// Spec: docs_v2/specs/tide-mcp-workbench-observe-open-browser.md
// Spec: docs_v2/specs/tide-mcp-file-workbench-tools.md
// Spec: docs_v2/specs/tide-mcp-file-edit-diff-tools.md
// Spec: docs_v2/specs/tide-mcp-terminal-command-tool.md
// Spec: docs_v2/specs/tide-mcp-open-terminal-tool.md
// Spec: docs_v2/specs/tide-mcp-code-navigation-tool.md
// Spec: docs_v2/specs/tide-mcp-workbench-mutation-events.md
// Spec: docs_v2/specs/tide-mcp-browser-action-tool.md

import assert from "node:assert/strict";
import test from "node:test";

import { createTideMcpToolSurfaceAdapter } from "../src/backend/adapters/inbound/tide-mcp-tool-surface/tide-mcp-tool-surface-adapter.ts";
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
  type ThreadRuntimeAsyncEvent,
  type ThreadSeed,
} from "../src/backend/application/services/thread/thread-runtime-service.ts";
import type {
  WorkbenchTerminalHandle,
  WorkbenchTerminalPort,
  WorkbenchTerminalStartInput,
} from "../src/backend/application/ports/outbound/workbench-terminal-port.ts";
import type {
  WorkspaceCodeDefinitionResult,
  WorkspaceCodeIntelligencePort,
  WorkspaceCodeLocation,
  WorkspaceCodeReferencesResult,
} from "../src/backend/application/ports/outbound/workspace-code-intelligence-port.ts";
import type {
  WorkspaceCommandPort,
  WorkspaceCommandRunResult,
} from "../src/backend/application/ports/outbound/workspace-command-port.ts";
import type {
  WorkspaceFileEditResult,
  WorkspaceFilePort,
  WorkspaceFileReadResult,
  WorkspaceFileTreeResult,
  WorkspaceFileWriteResult,
} from "../src/backend/application/ports/outbound/workspace-file-port.ts";

const now = "2026-05-27T00:00:00.000Z";

// --- UC-1: Agent observes Thread ---

test("mcp_session_without_explicit_thread_id_resolves_thread_from_agent_runtime_session", async () => {
  // UC-1 BR-1: MCP Session resolves Thread.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-mcp", {
        activeRuntimeHandle: runtimeHandle("thread-mcp", "runtime-mcp"),
        runtimeState: "running",
      }),
    ],
  });

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-mcp", agentId: "codex" },
    toolName: "tide_observe_thread",
    input: { detail: "compact" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.output.kind, "observe_thread");
  assert.equal(result.ok && result.output.threadId, "thread-mcp");
  assert.equal(result.ok && result.output.agentId, "codex");
  assert.deepEqual(fakes.runtime.events, []);
});

test("tide_mcp_tool_surface_lists_bounded_workbench_tools", () => {
  // UC-1 BR-2: Tool list is bounded.
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
  });
  const adapter = createTideMcpToolSurfaceAdapter({ service });

  assert.deepEqual(
    adapter.listTools().map((tool) => tool.name),
    [
      "tide_observe_thread",
      "tide_observe_workbench",
      "tide_open_browser",
      "tide_observe_browser",
      "tide_act_browser",
      "tide_read_file",
      "tide_open_file",
      "tide_edit_file",
      "tide_go_to_definition",
      "tide_go_to_references",
      "tide_open_terminal",
      "tide_run_terminal_command",
    ],
  );
});

// --- UC-2: Agent observes Workbench ---

test("observing_workbench_returns_snapshot_without_mutating_panes", async () => {
  // UC-2 BR-1: Observe is read-only.
  const service = serviceWithActiveThread("thread-observe", "runtime-observe");
  await openBrowser(service, "runtime-observe", "https://example.test");

  const before = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-observe", agentId: "codex" },
    toolName: "tide_observe_workbench",
  });
  const after = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-observe", agentId: "codex" },
    toolName: "tide_observe_workbench",
  });

  assert.equal(before.ok, true);
  assert.equal(after.ok, true);
  assert.deepEqual(before.ok && before.output, after.ok && after.output);
});

// --- UC-3: Agent opens Browser Pane ---

test("opening_browser_creates_visible_browser_pane_in_thread_workbench", async () => {
  // UC-3 BR-1: Open Browser creates visible pane.
  const service = serviceWithActiveThread("thread-browser", "runtime-browser");

  const opened = await openBrowser(
    service,
    "runtime-browser",
    "https://example.test/docs",
  );
  const observed = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-browser", agentId: "codex" },
    toolName: "tide_observe_workbench",
  });

  assert.equal(opened.output.kind, "open_browser");
  assert.equal(opened.output.visibleSideEffect, "created");
  assert.equal(opened.output.pane.kind, "browser");
  assert.equal(opened.output.pane.visible, true);
  assert.equal(opened.output.pane.url, "https://example.test/docs");
  assert.equal(observed.ok, true);
  assert.equal(observed.ok && observed.output.panes.length, 1);
  assert.equal(
    observed.ok && observed.output.panes[0]?.paneId,
    opened.output.pane.paneId,
  );
});

test("mcp_mutating_workbench_tool_emits_workbench_changed_async_event", async () => {
  // Spec: docs_v2/specs/tide-mcp-workbench-mutation-events.md
  const events: ThreadRuntimeAsyncEvent[] = [];
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-browser-event", {
        activeRuntimeHandle: runtimeHandle("thread-browser-event", "runtime-browser-event"),
        runtimeState: "running",
      }),
    ],
    onAsyncEvent: (event) => events.push(event),
  });

  await openBrowser(service, "runtime-browser-event", "https://example.test/events");

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "workbench_changed");
  assert.equal(events[0]?.thread.threadId, "thread-browser-event");
  assert.equal(events[0]?.thread.workbench.panes[0]?.kind, "browser");
});

test("mcp_observe_tool_does_not_emit_workbench_changed_async_event", async () => {
  // Spec: docs_v2/specs/tide-mcp-workbench-mutation-events.md
  const events: ThreadRuntimeAsyncEvent[] = [];
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-observe-event", {
        activeRuntimeHandle: runtimeHandle("thread-observe-event", "runtime-observe-event"),
        runtimeState: "running",
      }),
    ],
    onAsyncEvent: (event) => events.push(event),
  });

  const observed = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-observe-event", agentId: "codex" },
    toolName: "tide_observe_workbench",
  });

  assert.equal(observed.ok, true);
  assert.deepEqual(events, []);
});

test("opening_browser_uses_tide_workbench_and_not_external_browser", async () => {
  // UC-3 BR-2: Open Browser does not open OS browser.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-no-external", {
        activeRuntimeHandle: runtimeHandle("thread-no-external", "runtime-no-external"),
        runtimeState: "running",
      }),
    ],
  });

  const opened = await openBrowser(
    service,
    "runtime-no-external",
    "https://example.test/no-external",
  );

  assert.equal(opened.output.pane.visible, true);
  assert.equal(opened.output.pane.kind, "browser");
  assert.deepEqual(fakes.runtime.events, []);
});

test("opening_browser_preserves_composer_focus_by_default", async () => {
  // UC-3 BR-3: Focus is preserved.
  const service = serviceWithActiveThread("thread-focus", "runtime-focus");

  await openBrowser(service, "runtime-focus", "https://example.test/focus");
  const observed = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-focus", agentId: "codex" },
    toolName: "tide_observe_workbench",
  });

  assert.equal(observed.ok, true);
  assert.equal(observed.ok && observed.output.focusOwner, "composer");
});

test("observing_browser_returns_backend_stored_webview_snapshot", async () => {
  // Spec: docs_v2/specs/workbench-browser-pane-evidence-loop.md
  const service = serviceWithActiveThread("thread-browser-evidence", "runtime-browser-evidence");
  const opened = await openBrowser(
    service,
    "runtime-browser-evidence",
    "https://example.test",
  );
  const snapshot = await service.handleWorkbenchCommand({
    threadId: "thread-browser-evidence",
    command: "update_browser_snapshot",
    targetPaneId: opened.output.pane.paneId,
    data: {
      revision: opened.output.pane.revision,
      url: "https://example.test/ready",
      pageTitle: "Example ready",
      bodyTextPreview: "Loaded page body",
      loading: false,
    },
  });
  assert.equal(snapshot.ok, true);

  const observed = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-browser-evidence", agentId: "codex" },
    toolName: "tide_observe_browser",
    input: { paneId: opened.output.pane.paneId },
  });

  assert.equal(observed.ok, true);
  assert.equal(observed.ok && observed.output.pane.pageTitle, "Example ready");
  assert.equal(observed.ok && observed.output.pane.url, "https://example.test/ready");
  assert.equal(observed.ok && observed.output.pane.bodyTextPreview, "Loaded page body");
});

test("browser_action_tool_schedules_pending_click_for_desktop_webview", async () => {
  // Spec: docs_v2/specs/tide-mcp-browser-action-tool.md
  const events: ThreadRuntimeAsyncEvent[] = [];
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-browser-action", {
        activeRuntimeHandle: runtimeHandle("thread-browser-action", "runtime-browser-action"),
        runtimeState: "running",
      }),
    ],
    onAsyncEvent: (event) => events.push(event),
  });
  const opened = await openBrowser(
    service,
    "runtime-browser-action",
    "https://example.test/action",
  );

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-browser-action", agentId: "codex" },
    toolName: "tide_act_browser",
    input: {
      paneId: opened.output.pane.paneId,
      revision: opened.output.pane.revision,
      action: "click",
      selector: "button.primary",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.output.kind, "act_browser");
  assert.equal(result.ok && result.output.action.kind, "click");
  assert.equal(result.ok && result.output.action.selector, "button.primary");
  assert.equal(result.ok && result.output.status, "pending");
  const pane = result.ok ? result.thread.workbench.panes[0] : undefined;
  assert.equal(pane?.kind, "browser");
  assert.deepEqual(
    pane?.kind === "browser" ? pane.pendingAction : undefined,
    result.ok ? result.output.action : undefined,
  );
  assert.equal(events.at(-1)?.kind, "workbench_changed");
});

test("browser_type_action_without_text_returns_structured_error", async () => {
  // Spec: docs_v2/specs/tide-mcp-browser-action-tool.md
  const service = serviceWithActiveThread("thread-browser-type", "runtime-browser-type");
  const opened = await openBrowser(
    service,
    "runtime-browser-type",
    "https://example.test/form",
  );

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-browser-type", agentId: "codex" },
    toolName: "tide_act_browser",
    input: {
      paneId: opened.output.pane.paneId,
      revision: opened.output.pane.revision,
      action: "type_text",
      selector: "input[name=q]",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "invalid_workbench_command");
});

test("browser_action_with_stale_revision_returns_structured_error", async () => {
  // Spec: docs_v2/specs/tide-mcp-browser-action-tool.md
  const service = serviceWithActiveThread("thread-browser-stale-action", "runtime-browser-stale-action");
  const first = await openBrowser(
    service,
    "runtime-browser-stale-action",
    "https://example.test/one",
  );
  await openBrowser(
    service,
    "runtime-browser-stale-action",
    "https://example.test/two",
  );

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-browser-stale-action", agentId: "codex" },
    toolName: "tide_act_browser",
    input: {
      paneId: first.output.pane.paneId,
      revision: first.output.pane.revision,
      action: "click",
      selector: "a.next",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "workbench_stale_reference");
});

test("browser_action_result_command_records_completion_and_snapshot", async () => {
  // Spec: docs_v2/specs/tide-mcp-browser-action-tool.md
  const service = serviceWithActiveThread("thread-browser-result", "runtime-browser-result");
  const opened = await openBrowser(
    service,
    "runtime-browser-result",
    "https://example.test/action",
  );
  const action = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-browser-result", agentId: "codex" },
    toolName: "tide_act_browser",
    input: {
      paneId: opened.output.pane.paneId,
      revision: opened.output.pane.revision,
      action: "type_text",
      selector: "input[name=q]",
      text: "tide",
    },
  });
  assert.equal(action.ok, true);

  const scheduledPane = action.ok
    ? action.thread.workbench.panes.find((pane) => pane.kind === "browser")
    : undefined;
  const result = await service.handleWorkbenchCommand({
    threadId: "thread-browser-result",
    command: "update_browser_action_result",
    targetPaneId: opened.output.pane.paneId,
    data: {
      revision: scheduledPane?.revision,
      actionId: action.ok ? action.output.action.actionId : "",
      status: "completed",
      message: "Typed input[name=q]",
      url: "https://example.test/action?q=tide",
      pageTitle: "Search results",
      bodyTextPreview: "Found Tide",
      loading: false,
    },
  });

  assert.equal(result.ok, true);
  const pane = result.ok
    ? result.thread.workbench.panes.find((candidate) => candidate.kind === "browser")
    : undefined;
  assert.equal(pane?.kind, "browser");
  assert.equal(pane?.kind === "browser" ? pane.pendingAction : undefined, undefined);
  assert.equal(pane?.kind === "browser" ? pane.lastAction?.status : undefined, "completed");
  assert.equal(pane?.kind === "browser" ? pane.pageTitle : undefined, "Search results");
  assert.equal(pane?.kind === "browser" ? pane.bodyTextPreview : undefined, "Found Tide");
});

// --- UC-5: Agent reads and opens File Workbench state ---

test("reading_file_returns_bounded_content_without_mutating_workbench", async () => {
  // Spec: docs_v2/specs/tide-mcp-file-workbench-tools.md
  const fakes = createFakes({
    files: {
      "notes/plan.md": "First line\nSecond line",
    },
  });
  const service = serviceWithActiveThread("thread-read-file", "runtime-read-file", fakes);

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-read-file", agentId: "codex" },
    toolName: "tide_read_file",
    input: { path: "notes/plan.md", byteLimit: 12 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.output.kind, "read_file");
  assert.equal(result.ok && result.output.relativePath, "notes/plan.md");
  assert.equal(result.ok && result.output.content, "First line\nS");
  assert.equal(result.ok && result.output.truncated, true);
  assert.equal(result.ok && result.thread.workbench.panes.length, 0);
});

test("opening_file_creates_visible_editor_pane_in_thread_workbench", async () => {
  // Spec: docs_v2/specs/tide-mcp-file-workbench-tools.md
  const fakes = createFakes({
    files: {
      "src/app.ts": "export const app = true;\n",
    },
  });
  const service = serviceWithActiveThread("thread-open-file", "runtime-open-file", fakes);

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-open-file", agentId: "codex" },
    toolName: "tide_open_file",
    input: { path: "src/app.ts" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.output.kind, "open_file");
  assert.equal(result.ok && result.output.pane.kind, "editor");
  assert.equal(result.ok && result.output.pane.relativePath, "src/app.ts");
  assert.equal(result.ok && result.thread.workbench.panes.length, 1);
  assert.equal(result.ok && result.thread.workbench.focusOwner, "composer");
});

test("opening_existing_file_reveals_existing_editor_pane", async () => {
  // Spec: docs_v2/specs/tide-mcp-file-workbench-tools.md
  const fakes = createFakes({
    files: {
      "README.md": "# Tide\n",
    },
  });
  const service = serviceWithActiveThread("thread-refresh-file", "runtime-refresh-file", fakes);

  const first = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-refresh-file", agentId: "codex" },
    toolName: "tide_open_file",
    input: { path: "README.md" },
  });
  const second = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-refresh-file", agentId: "codex" },
    toolName: "tide_open_file",
    input: { path: "README.md" },
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(
    first.ok && second.ok && first.output.pane.paneId,
    second.ok && second.output.pane.paneId,
  );
  assert.equal(second.ok && second.output.visibleSideEffect, "revealed");
  assert.equal(second.ok && second.thread.workbench.panes.length, 1);
});

test("mcp_go_to_definition_opens_target_editor_pane", async () => {
  // Spec: docs_v2/specs/tide-mcp-code-navigation-tool.md
  const fakes = createFakes({
    files: {
      "src/app.ts": "import { answer } from './answer';\nconsole.log(answer);\n",
      "src/answer.ts": "export const answer = 42;\n",
    },
    definition: {
      root: "/tmp/thread-goto-definition",
      path: "/tmp/thread-goto-definition/src/answer.ts",
      relativePath: "src/answer.ts",
      line: 0,
      character: 13,
      length: 6,
      label: "answer",
    },
  });
  const service = serviceWithActiveThread(
    "thread-goto-definition",
    "runtime-goto-definition",
    fakes,
  );
  const opened = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-goto-definition", agentId: "codex" },
    toolName: "tide_open_file",
    input: { path: "src/app.ts" },
  });
  assert.equal(opened.ok, true);

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-goto-definition", agentId: "codex" },
    toolName: "tide_go_to_definition",
    input: {
      paneId: opened.ok ? opened.output.pane.paneId : "",
      line: 1,
      character: 12,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.output.kind, "go_to_definition");
  assert.equal(result.ok && result.output.pane.kind, "editor");
  assert.equal(result.ok && result.output.pane.relativePath, "src/answer.ts");
  assert.deepEqual(result.ok && result.output.target, {
    line: 0,
    character: 13,
    length: 6,
    label: "answer",
  });
  assert.equal(result.ok && result.output.sourcePaneId, opened.ok && opened.output.pane.paneId);
  assert.deepEqual(fakes.codeIntelligence.definitionCalls, [
    {
      root: "/tmp/thread-goto-definition",
      path: "/tmp/thread-goto-definition/src/app.ts",
      line: 1,
      character: 12,
    },
  ]);
  const targetPane = result.ok
    ? result.thread.workbench.panes.find((pane) => pane.relativePath === "src/answer.ts")
    : undefined;
  assert.equal(targetPane?.kind, "editor");
  assert.deepEqual(
    targetPane?.kind === "editor" ? targetPane.navigationTarget : undefined,
    {
      line: 0,
      character: 13,
      length: 6,
      label: "answer",
      sourcePaneId: opened.ok ? opened.output.pane.paneId : "",
    },
  );
});

test("mcp_go_to_definition_without_result_returns_structured_error", async () => {
  // Spec: docs_v2/specs/tide-mcp-code-navigation-tool.md
  const fakes = createFakes({
    files: {
      "src/app.ts": "console.log('no symbol');\n",
    },
    definitionError: {
      code: "workspace_code_definition_not_found",
      message: "Definition target was not found.",
    },
  });
  const service = serviceWithActiveThread(
    "thread-goto-missing",
    "runtime-goto-missing",
    fakes,
  );
  const opened = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-goto-missing", agentId: "codex" },
    toolName: "tide_open_file",
    input: { path: "src/app.ts" },
  });
  assert.equal(opened.ok, true);
  const panesBefore = opened.ok ? opened.thread.workbench.panes : [];

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-goto-missing", agentId: "codex" },
    toolName: "tide_go_to_definition",
    input: {
      paneId: opened.ok ? opened.output.pane.paneId : "",
      line: 0,
      character: 4,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "workspace_code_definition_not_found");
  const observed = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-goto-missing", agentId: "codex" },
    toolName: "tide_observe_workbench",
  });
  assert.equal(observed.ok, true);
  assert.deepEqual(observed.ok && observed.output.panes, panesBefore);
});

test("reading_file_outside_thread_root_returns_structured_error", async () => {
  // Spec: docs_v2/specs/tide-mcp-file-workbench-tools.md
  const service = serviceWithActiveThread(
    "thread-outside-file",
    "runtime-outside-file",
    createFakes(),
  );

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-outside-file", agentId: "codex" },
    toolName: "tide_read_file",
    input: { path: "../secret.md" },
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "workspace_file_outside_scope");
});

test("editing_file_replaces_exact_text_and_opens_diff_pane", async () => {
  // Spec: docs_v2/specs/tide-mcp-file-edit-diff-tools.md
  const fakes = createFakes({
    files: {
      "src/app.ts": "export const version = 1;\n",
    },
  });
  const service = serviceWithActiveThread("thread-edit-file", "runtime-edit-file", fakes);

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-edit-file", agentId: "codex" },
    toolName: "tide_edit_file",
    input: {
      path: "src/app.ts",
      oldText: "version = 1",
      newText: "version = 2",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.output.kind, "edit_file");
  assert.equal(result.ok && result.output.relativePath, "src/app.ts");
  assert.equal(result.ok && result.output.replacementCount, 1);
  assert.equal(result.ok && result.output.afterContent, "export const version = 2;\n");
  assert.match(result.ok ? result.output.diff : "", /-export const version = 1;/);
  assert.match(result.ok ? result.output.diff : "", /\+export const version = 2;/);
  assert.equal(result.ok && result.output.pane.kind, "diff");
  assert.equal(result.ok && result.output.visibleSideEffect, "created");
  assert.equal(fakes.workspaceFiles.content("src/app.ts"), "export const version = 2;\n");
  assert.equal(result.ok && result.thread.workbench.panes.length, 1);
  assert.equal(result.ok && result.thread.workbench.panes[0]?.kind, "diff");
  assert.equal(result.ok && result.thread.workbench.focusOwner, "composer");
});

test("editing_file_refreshes_existing_editor_pane_preview", async () => {
  // Spec: docs_v2/specs/tide-mcp-file-edit-diff-tools.md
  const fakes = createFakes({
    files: {
      "README.md": "# Tide\nold sentence\n",
    },
  });
  const service = serviceWithActiveThread(
    "thread-edit-refresh",
    "runtime-edit-refresh",
    fakes,
  );

  const opened = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-edit-refresh", agentId: "codex" },
    toolName: "tide_open_file",
    input: { path: "README.md" },
  });
  const edited = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-edit-refresh", agentId: "codex" },
    toolName: "tide_edit_file",
    input: {
      path: "README.md",
      oldText: "old sentence",
      newText: "new sentence",
    },
  });

  assert.equal(opened.ok, true);
  assert.equal(edited.ok, true);
  const editorPane = edited.ok
    ? edited.thread.workbench.panes.find((pane) => pane.kind === "editor")
    : undefined;
  assert.equal(editorPane?.paneId, opened.ok && opened.output.pane.paneId);
  assert.equal(editorPane?.bodyTextPreview, "# Tide\nnew sentence\n");
  assert.equal(
    edited.ok && edited.thread.workbench.panes.some((pane) => pane.kind === "diff"),
    true,
  );
});

test("editing_file_with_missing_old_text_returns_conflict_without_mutating_workbench", async () => {
  // Spec: docs_v2/specs/tide-mcp-file-edit-diff-tools.md
  const fakes = createFakes({
    files: {
      "src/app.ts": "export const version = 1;\n",
    },
  });
  const service = serviceWithActiveThread(
    "thread-edit-conflict",
    "runtime-edit-conflict",
    fakes,
  );

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-edit-conflict", agentId: "codex" },
    toolName: "tide_edit_file",
    input: {
      path: "src/app.ts",
      oldText: "missing text",
      newText: "replacement",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "workspace_file_edit_conflict");
  assert.equal(fakes.workspaceFiles.content("src/app.ts"), "export const version = 1;\n");
  const observed = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-edit-conflict", agentId: "codex" },
    toolName: "tide_observe_workbench",
  });
  assert.equal(observed.ok, true);
  assert.equal(observed.ok && observed.output.panes.length, 0);
});

test("running_terminal_command_creates_completed_terminal_pane", async () => {
  // Spec: docs_v2/specs/tide-mcp-terminal-command-tool.md
  const fakes = createFakes({
    commands: [
      {
        command: "npm",
        args: ["run", "test:v2"],
        exitCode: 0,
        stdout: "all tests passed\n",
        stderr: "",
      },
    ],
  });
  const service = serviceWithActiveThread(
    "thread-run-command",
    "runtime-run-command",
    fakes,
  );

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-run-command", agentId: "codex" },
    toolName: "tide_run_terminal_command",
    input: { command: "npm", args: ["run", "test:v2"] },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.output.kind, "run_terminal_command");
  assert.equal(result.ok && result.output.status, "completed");
  assert.equal(result.ok && result.output.exitCode, 0);
  assert.match(result.ok ? result.output.transcript : "", /all tests passed/);
  assert.equal(result.ok && result.output.pane.kind, "terminal");
  assert.equal(result.ok && result.output.pane.status, "completed");
  assert.equal(result.ok && result.thread.workbench.panes.length, 1);
  assert.equal(result.ok && result.thread.workbench.panes[0]?.kind, "terminal");
  assert.equal(result.ok && result.thread.workbench.focusOwner, "composer");
  assert.equal(fakes.commands.runs.length, 1);
  assert.deepEqual(fakes.runtime.events, []);
});

test("opening_visible_terminal_from_mcp_creates_running_terminal_pane", async () => {
  // Spec: docs_v2/specs/tide-mcp-open-terminal-tool.md
  const fakes = createFakes();
  const service = serviceWithActiveThread(
    "thread-open-terminal",
    "runtime-open-terminal",
    fakes,
  );

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-open-terminal", agentId: "codex" },
    toolName: "tide_open_terminal",
    input: { command: "zsh", args: ["-l"], cwd: "tools" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.output.kind, "open_terminal");
  assert.equal(result.ok && result.output.visibleSideEffect, "created");
  assert.equal(result.ok && result.output.command, "zsh");
  assert.deepEqual(result.ok && result.output.args, ["-l"]);
  assert.equal(result.ok && result.output.cwd, "/tmp/thread-open-terminal/tools");
  assert.equal(result.ok && result.output.pane.kind, "terminal");
  assert.equal(result.ok && result.output.pane.status, "running");
  assert.equal(result.ok && result.thread.workbench.panes.length, 1);
  assert.equal(result.ok && result.thread.workbench.focusOwner, "composer");
  assert.equal(fakes.workbenchTerminal.starts.length, 1);
  assert.deepEqual(fakes.runtime.events, []);
});

test("running_terminal_command_with_nonzero_exit_returns_failed_result", async () => {
  // Spec: docs_v2/specs/tide-mcp-terminal-command-tool.md
  const fakes = createFakes({
    commands: [
      {
        command: "npm",
        args: ["run", "test:v2"],
        exitCode: 1,
        stdout: "",
        stderr: "failed tests\n",
      },
    ],
  });
  const service = serviceWithActiveThread(
    "thread-run-command-fail",
    "runtime-run-command-fail",
    fakes,
  );

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-run-command-fail", agentId: "codex" },
    toolName: "tide_run_terminal_command",
    input: { command: "npm", args: ["run", "test:v2"] },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.output.kind, "run_terminal_command");
  assert.equal(result.ok && result.output.status, "failed");
  assert.equal(result.ok && result.output.exitCode, 1);
  assert.match(result.ok ? result.output.stderr : "", /failed tests/);
  assert.equal(result.ok && result.output.pane.status, "failed");
});

test("running_terminal_command_outside_thread_root_is_rejected", async () => {
  // Spec: docs_v2/specs/tide-mcp-terminal-command-tool.md
  const fakes = createFakes();
  const service = serviceWithActiveThread(
    "thread-run-command-outside",
    "runtime-run-command-outside",
    fakes,
  );

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-run-command-outside", agentId: "codex" },
    toolName: "tide_run_terminal_command",
    input: { command: "npm", args: ["test"], cwd: "../outside" },
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "workspace_command_outside_scope");
  assert.equal(fakes.commands.runs.length, 0);
  const observed = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-run-command-outside", agentId: "codex" },
    toolName: "tide_observe_workbench",
  });
  assert.equal(observed.ok, true);
  assert.equal(observed.ok && observed.output.panes.length, 0);
});

// --- UC-4: Agent observes Browser Pane ---

test("observing_browser_pane_from_another_thread_returns_structured_error", async () => {
  // UC-4 BR-1: Browser observe checks ownership.
  const service = serviceWithActiveThreads([
    ["thread-a", "runtime-a"],
    ["thread-b", "runtime-b"],
  ]);
  const opened = await openBrowser(service, "runtime-a", "https://example.test/a");

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-b", agentId: "codex" },
    toolName: "tide_observe_browser",
    input: { paneId: opened.output.pane.paneId },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.error.code, "workbench_target_not_found");
});

test("observing_browser_with_stale_revision_returns_structured_error", async () => {
  // UC-4 BR-2: Stale revision is detected.
  const service = serviceWithActiveThread("thread-stale", "runtime-stale");
  const first = await openBrowser(service, "runtime-stale", "https://example.test/old");
  const second = await openBrowser(service, "runtime-stale", "https://example.test/new");

  assert.equal(first.output.pane.paneId, second.output.pane.paneId);
  assert.notEqual(first.output.pane.revision, second.output.pane.revision);

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-stale", agentId: "codex" },
    toolName: "tide_observe_browser",
    input: {
      paneId: first.output.pane.paneId,
      revision: first.output.pane.revision,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.error.code, "workbench_stale_reference");
});

function serviceWithActiveThread(
  threadId: string,
  runtimeId: string,
  fakes = createFakes(),
) {
  return serviceWithActiveThreads([[threadId, runtimeId]], fakes);
}

function serviceWithActiveThreads(
  entries: [string, string][],
  fakes = createFakes(),
) {
  return createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: entries.map(([threadId, runtimeId]) =>
      threadSeed(threadId, {
        activeRuntimeHandle: runtimeHandle(threadId, runtimeId),
        runtimeState: "running",
      }),
    ),
  });
}

async function openBrowser(
  service: ReturnType<typeof createThreadRuntimeService>,
  runtimeId: string,
  url: string,
) {
  const result = await service.handleTideMcpToolCall({
    session: { runtimeId, agentId: "codex" },
    toolName: "tide_open_browser",
    input: { url },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.output.kind, "open_browser");
  return result as Extract<typeof result, { ok: true }>;
}

function threadSeed(
  threadId: string,
  overrides: Partial<ThreadSeed> = {},
): ThreadSeed {
  return {
    threadId,
    title: "MCP Workbench thread",
    agentBinding: {
      agentId: "codex",
    },
    scope: { kind: "scratch", scratchCwd: `/tmp/${threadId}` },
    lifecycleState: "open",
    runtimeState: "not_started",
    lastKnownState: "idle",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function runtimeHandle(threadId: string, runtimeId: string): AgentRuntimeHandle {
  return {
    runtimeId,
    threadId,
    agentId: "codex",
  };
}

function createFakes(options: {
  readiness?: ProviderReadinessResult;
  files?: Record<string, string>;
  commands?: FakeCommandResult[];
  definition?: WorkspaceCodeLocation;
  definitionError?:
    | {
        code: "workspace_code_intelligence_unavailable" | "workspace_code_definition_not_found";
        message: string;
      }
    | undefined;
} = {}) {
  const runtime = new FakeAgentRuntimePort();
  const readiness = new FakeProviderReadinessPort(
    options.readiness ?? {
      ready: true,
      agentId: "codex",
      blockers: [],
    },
  );
  const transcript = new FakePtyTranscriptPort();
  const workspaceFiles = new FakeWorkspaceFilePort(options.files ?? {});
  const commands = new FakeWorkspaceCommandPort(options.commands ?? []);
  const workbenchTerminal = new FakeWorkbenchTerminalPort();
  const codeIntelligence = new FakeWorkspaceCodeIntelligencePort(
    options.definition,
    options.definitionError,
  );

  return {
    runtime,
    readiness,
    transcript,
    workspaceFiles,
    commands,
    workbenchTerminal,
    codeIntelligence,
    ports: {
      agentRuntimePort: runtime,
      providerReadinessPort: readiness,
      ptyTranscriptPort: transcript,
      workspaceFilePort: workspaceFiles,
      workspaceCommandPort: commands,
      workbenchTerminalPort: workbenchTerminal,
      workspaceCodeIntelligencePort: codeIntelligence,
    },
  };
}

class FakeAgentRuntimePort implements AgentRuntimePort {
  events: string[] = [];
  writes: { handle: AgentRuntimeHandle; input: TerminalInput }[] = [];

  async start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle> {
    this.events.push("start");
    return runtimeHandle(input.threadId, `runtime-start-${this.events.length}`);
  }

  async resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle> {
    this.events.push("resume");
    return runtimeHandle(input.threadId, `runtime-resume-${this.events.length}`);
  }

  async writeInput(
    handle: AgentRuntimeHandle,
    input: TerminalInput,
  ): Promise<void> {
    this.events.push("writeInput");
    this.writes.push({ handle, input });
  }

  async stop(_handle: AgentRuntimeHandle): Promise<void> {
    this.events.push("stop");
  }
}

class FakeProviderReadinessPort implements ProviderReadinessPort {
  private readonly result: ProviderReadinessResult;

  constructor(result: ProviderReadinessResult) {
    this.result = result;
  }

  async check(
    input: ProviderReadinessCheckInput,
  ): Promise<ProviderReadinessResult> {
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

class FakeWorkspaceFilePort implements WorkspaceFilePort {
  private readonly files: Record<string, string>;

  constructor(files: Record<string, string>) {
    this.files = files;
  }

  async listTree(input: {
    root: string;
    maxDepth: number;
    maxEntries: number;
  }): Promise<WorkspaceFileTreeResult> {
    const entries = Object.keys(this.files)
      .sort()
      .slice(0, input.maxEntries)
      .map((filePath) => ({
        id: filePath,
        name: filePath.split("/").at(-1) ?? filePath,
        relativePath: filePath,
        depth: Math.min(filePath.split("/").length - 1, input.maxDepth),
        kind: "file" as const,
      }));

    return {
      ok: true,
      fileTree: {
        root: input.root,
        cwdLabel: input.root.split("/").at(-1) ?? input.root,
        revision: "fake-tree-rev",
        updatedAt: now,
        entries,
        truncated: Object.keys(this.files).length > input.maxEntries,
      },
    };
  }

  async readTextFile(input: {
    root: string;
    path: string;
    byteLimit: number;
  }): Promise<WorkspaceFileReadResult> {
    if (input.path.includes("..")) {
      return {
        ok: false,
        error: {
          code: "workspace_file_outside_scope",
          message: "File path is outside the Thread root.",
        },
      };
    }

    const content = this.files[input.path];
    if (content === undefined) {
      return {
        ok: false,
        error: {
          code: "workspace_file_not_found",
          message: "File was not found.",
        },
      };
    }

    const preview = content.slice(0, input.byteLimit);
    return {
      ok: true,
      file: {
        root: input.root,
        path: `${input.root}/${input.path}`,
        relativePath: input.path,
        content: preview,
        byteLength: content.length,
        truncated: preview.length < content.length,
      },
    };
  }

  async replaceText(input: {
    root: string;
    path: string;
    oldText: string;
    newText: string;
    expectedOccurrences: number;
    byteLimit: number;
  }): Promise<WorkspaceFileEditResult> {
    if (input.path.includes("..")) {
      return {
        ok: false,
        error: {
          code: "workspace_file_outside_scope",
          message: "File path is outside the Thread root.",
        },
      };
    }

    const before = this.files[input.path];
    if (before === undefined) {
      return {
        ok: false,
        error: {
          code: "workspace_file_not_found",
          message: "File was not found.",
        },
      };
    }

    const replacementCount = occurrencesOf(before, input.oldText);
    if (
      input.oldText.length === 0 ||
      replacementCount !== input.expectedOccurrences
    ) {
      return {
        ok: false,
        error: {
          code: "workspace_file_edit_conflict",
          message: "File edit did not match the expected text.",
        },
      };
    }

    const after = before.split(input.oldText).join(input.newText);
    this.files[input.path] = after;
    const preview = after.slice(0, input.byteLimit);

    return {
      ok: true,
      file: {
        root: input.root,
        path: `${input.root}/${input.path}`,
        relativePath: input.path,
        replacementCount,
        beforeByteLength: before.length,
        afterByteLength: after.length,
        beforeContent: before,
        afterContent: preview,
        truncated: preview.length < after.length,
      },
    };
  }

  async writeTextFile(input: {
    root: string;
    path: string;
    content: string;
    byteLimit: number;
  }): Promise<WorkspaceFileWriteResult> {
    if (input.path.includes("..")) {
      return {
        ok: false,
        error: {
          code: "workspace_file_outside_scope",
          message: "File path is outside the Thread root.",
        },
      };
    }

    if (this.files[input.path] === undefined) {
      return {
        ok: false,
        error: {
          code: "workspace_file_not_found",
          message: "File was not found.",
        },
      };
    }

    this.files[input.path] = input.content;
    const preview = input.content.slice(0, input.byteLimit);
    return {
      ok: true,
      file: {
        root: input.root,
        path: `${input.root}/${input.path}`,
        relativePath: input.path,
        content: preview,
        byteLength: input.content.length,
        truncated: preview.length < input.content.length,
      },
    };
  }

  content(path: string): string | undefined {
    return this.files[path];
  }
}

class FakeWorkspaceCodeIntelligencePort implements WorkspaceCodeIntelligencePort {
  readonly definitionCalls: Array<{
    root: string;
    path: string;
    line: number;
    character: number;
  }> = [];
  private readonly definition: WorkspaceCodeLocation | undefined;
  private readonly definitionError:
    | {
        code: "workspace_code_intelligence_unavailable" | "workspace_code_definition_not_found";
        message: string;
      }
    | undefined;

  constructor(
    definition: WorkspaceCodeLocation | undefined,
    definitionError:
      | {
          code: "workspace_code_intelligence_unavailable" | "workspace_code_definition_not_found";
          message: string;
        }
      | undefined,
  ) {
    this.definition = definition;
    this.definitionError = definitionError;
  }

  async findDefinition(input: {
    root: string;
    path: string;
    line: number;
    character: number;
  }): Promise<WorkspaceCodeDefinitionResult> {
    this.definitionCalls.push(input);
    if (this.definitionError !== undefined) {
      return {
        ok: false,
        error: this.definitionError,
      };
    }
    if (this.definition === undefined) {
      return {
        ok: false,
        error: {
          code: "workspace_code_definition_not_found",
          message: "Definition target was not found.",
        },
      };
    }
    return {
      ok: true,
      location: this.definition,
    };
  }

  async findReferences(): Promise<WorkspaceCodeReferencesResult> {
    return {
      ok: false,
      error: {
        code: "workspace_code_references_not_found",
        message: "No references were found for the selected symbol.",
      },
    };
  }
}

function occurrencesOf(value: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  return value.split(needle).length - 1;
}

interface FakeCommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal?: string | null;
  timedOut?: boolean;
}

class FakeWorkspaceCommandPort implements WorkspaceCommandPort {
  private readonly results: FakeCommandResult[];
  readonly runs: {
    command: string;
    args: string[];
    cwd: string;
    timeoutMs: number;
    byteLimit: number;
  }[] = [];

  constructor(results: FakeCommandResult[]) {
    this.results = results;
  }

  async resolveCwd(input: {
    root: string;
    cwd?: string;
  }) {
    const requestedCwd = input.cwd ?? ".";
    if (requestedCwd.includes("..")) {
      return {
        ok: false as const,
        error: {
          code: "workspace_command_outside_scope" as const,
          message: "Command cwd is outside the Thread root.",
        },
      };
    }
    return {
      ok: true as const,
      cwd: {
        root: input.root,
        cwd: requestedCwd === "." ? input.root : `${input.root}/${requestedCwd}`,
        relativeCwd: requestedCwd,
      },
    };
  }

  async run(input: {
    command: string;
    args: string[];
    cwd: string;
    timeoutMs: number;
    byteLimit: number;
    startedAt: string;
  }): Promise<WorkspaceCommandRunResult> {
    this.runs.push({
      command: input.command,
      args: [...input.args],
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      byteLimit: input.byteLimit,
    });
    const result = this.results.shift() ?? {
      command: input.command,
      args: input.args,
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
    const transcript = commandTranscript({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      signal: result.signal ?? null,
    });

    return {
      ok: true,
      run: {
        command: input.command,
        args: [...input.args],
        cwd: input.cwd,
        exitCode: result.exitCode,
        signal: result.signal ?? null,
        stdout: result.stdout,
        stderr: result.stderr,
        transcript: transcript.slice(0, input.byteLimit),
        truncated: transcript.length > input.byteLimit,
        timedOut: result.timedOut ?? false,
        startedAt: input.startedAt,
        completedAt: now,
      },
    };
  }
}

class FakeWorkbenchTerminalPort implements WorkbenchTerminalPort {
  readonly starts: WorkbenchTerminalStartInput[] = [];
  readonly handles: WorkbenchTerminalHandle[] = [];

  async start(input: WorkbenchTerminalStartInput): Promise<WorkbenchTerminalHandle> {
    this.starts.push(input);
    const handle: WorkbenchTerminalHandle = {
      terminalRuntimeId: `terminal-${this.starts.length}`,
      write: () => {},
      stop: () => {},
    };
    this.handles.push(handle);
    return handle;
  }
}

function commandTranscript(input: {
  command: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
}): string {
  const prompt = `$ cd ${input.cwd}\n$ ${[input.command, ...input.args].join(" ")}\n`;
  const exit = `[exit ${input.exitCode ?? input.signal ?? "unknown"}]\n`;
  return `${prompt}${input.stdout}${input.stderr}${exit}`;
}

function fixedClock(): string {
  return now;
}

function sequentialIdGenerator(prefix: string): () => string {
  let nextId = 1;
  return () => `${prefix}-${nextId++}`;
}
