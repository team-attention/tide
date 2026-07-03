// Spec: docs_v2/specs/app-chrome-workbench-tab-strip.md

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import {
  applyAppChromeBackendEvent,
  closeWorkbenchPane,
  createAppChromeState,
  createAppChromeViewModel,
  focusWorkbenchPane,
  setChromeActionLoading,
  writeWorkbenchTerminalInput,
  type AppChromeState,
} from "../src/desktop/application/domains/app-chrome/app-chrome-state.ts";
import {
  applyBackendEventToAppChrome,
  toBackendCommandDraft,
} from "../src/desktop/adapters/inbound/react-renderer/app-chrome/contract-adapter.ts";
import { AppChrome } from "../src/desktop/adapters/inbound/react-renderer/app-chrome/app-chrome.tsx";
import {
  CONTRACT_VERSION,
  type BackendEventEnvelope,
  type BackendEventKind,
  type BackendEventPayloadByKind,
  type ThreadSummaryDto,
  type WorkbenchPaneRefDto,
} from "../src/shared/contracts/index.ts";

const now = "2026-05-27T00:00:00.000Z";
const later = "2026-05-27T00:00:01.000Z";

test("status_bar_updates_runtime_state_without_global_queue", () => {
  // UC-1: Status Bar updates runtime state.
  const withThread = applyBackendEventToAppChrome(
    createAppChromeState(),
    backendEvent("thread.hydrated", {
      thread,
      runtimeState: "idle",
      blocks: [],
    }),
  );
  const running = applyBackendEventToAppChrome(
    withThread,
    backendEvent("agentRuntime.stateChanged", {
      threadId: "thread-chrome",
      state: "running",
      changedAt: later,
    }),
  );
  const html = renderChrome(running);

  assert.match(html, /aria-label="Status Bar"/);
  assert.match(html, /data-runtime-state="running"/);
  assert.doesNotMatch(html, /global queue/i);
});

test("workbench_tab_strip_excludes_hidden_agent_runtime", () => {
  // UC-3: Workbench opens Browser Pane.
  const state = stateWithWorkbenchPanes([
    browserPane("pane-browser-1", "Docs"),
    terminalPane("pane-terminal-1", "Visible terminal"),
  ]);
  const html = renderChrome(state);

  assert.match(html, /Docs/);
  assert.match(html, /Visible terminal/);
  assert.doesNotMatch(html, /Agent Runtime/);
});

test("workbench_changed_event_with_browser_pane_renders_tab_strip", () => {
  // UC-3: Workbench opens Browser Pane.
  const state = stateWithWorkbenchPanes([browserPane("pane-browser-1", "Local preview")]);
  const view = createAppChromeViewModel(state);
  const html = renderChrome(state);

  assert.equal(view.workbenchTabStrip.visibleTabs.length, 1);
  assert.equal(view.workbenchTabStrip.visibleTabs[0]?.title, "Local preview");
  assert.match(html, /aria-label="Workbench Tab Strip"/);
});

test("a browser pane with no page title falls back to a friendly tab name", () => {
  // UC-3: an about:blank / pre-title Browser Pane must never render a nameless tab.
  const view = createAppChromeViewModel(
    stateWithWorkbenchPanes([
      browserPane("pane-blank", ""),
      browserPane("pane-aboutblank", "about:blank"),
    ]),
  );

  assert.equal(view.workbenchTabStrip.visibleTabs[0]?.title, "New Tab");
  assert.equal(view.workbenchTabStrip.visibleTabs[1]?.title, "New Tab");
});

test("closing_workbench_tab_emits_workbench_command_with_pane_id", () => {
  // UC-3: Workbench opens Browser Pane.
  const state = stateWithWorkbenchPanes([browserPane("pane-browser-1", "Local preview")]);
  const result = closeWorkbenchPane(state, "pane-browser-1");
  const command = result.command ? toBackendCommandDraft(result.command) : null;

  assert.equal(command?.kind, "workbench.command");
  assert.deepEqual(command?.payload, {
    threadId: "thread-chrome",
    command: "close_pane",
    targetPaneId: "pane-browser-1",
  });
});

test("selecting_workbench_tab_emits_focus_workbench_command", () => {
  // UC-3: Workbench opens Browser Pane.
  const state = stateWithWorkbenchPanes([browserPane("pane-browser-1", "Local preview")]);
  const result = focusWorkbenchPane(state, "pane-browser-1");
  const command = result.command ? toBackendCommandDraft(result.command) : null;

  assert.equal(command?.kind, "workbench.command");
  assert.deepEqual(command?.payload, {
    threadId: "thread-chrome",
    command: "focus_pane",
    targetPaneId: "pane-browser-1",
  });
});

test("overflow_menu_lists_hidden_tabs_and_focuses_selected_pane", () => {
  // UC-4: Workbench tab overflow.
  const state = stateWithWorkbenchPanes([
    browserPane("pane-browser-1", "One"),
    browserPane("pane-browser-2", "Two"),
    browserPane("pane-browser-3", "Three"),
  ]);
  const view = createAppChromeViewModel(state, { maxVisibleTabs: 2 });
  const result = focusWorkbenchPane(state, "pane-browser-3");
  const command = result.command ? toBackendCommandDraft(result.command) : null;

  assert.deepEqual(
    view.workbenchTabStrip.visibleTabs.map((tab) => tab.title),
    ["One", "Two"],
  );
  assert.deepEqual(
    view.workbenchTabStrip.overflowTabs.map((tab) => tab.title),
    ["Three"],
  );
  assert.equal(command?.payload.targetPaneId, "pane-browser-3");
});

test("first_tab_strip_does_not_render_pin_or_split_actions", () => {
  // UC-3: Workbench opens Browser Pane.
  const html = renderChrome(
    stateWithWorkbenchPanes([browserPane("pane-browser-1", "Local preview")]),
  );

  assert.doesNotMatch(html, /Pin/i);
  assert.doesNotMatch(html, /Split/i);
});

test("chrome_action_buttons_have_tooltips_and_accessible_labels", () => {
  // UC-5: Chrome Action state.
  const html = renderChrome(
    stateWithWorkbenchPanes([browserPane("pane-browser-1", "Local preview")]),
  );

  assert.match(html, /aria-label="Focus Local preview"/);
  assert.match(html, /title="Focus Local preview"/);
  assert.match(html, /aria-label="Close Local preview"/);
  assert.match(html, /title="Close Local preview"/);
});

test("loading_chrome_action_disables_conflicting_action", () => {
  // UC-5: Chrome Action state.
  const state = setChromeActionLoading(
    stateWithWorkbenchPanes([browserPane("pane-browser-1", "Local preview")]),
    "close:pane-browser-1",
  );
  const view = createAppChromeViewModel(state);
  const tab = view.workbenchTabStrip.visibleTabs[0];

  assert.equal(tab?.closeAction.state, "loading");
  assert.equal(tab?.focusAction.disabled, true);
});

test("terminal_input_sends_to_ready_or_running_terminals_only", () => {
  // Spec: docs_v2/specs/workbench-launcher-terminal-usability.md
  const ready = stateWithWorkbenchPanes([
    { ...terminalPane("pane-terminal-ready", "Ready"), status: "ready" },
  ]);
  const readyInput = writeWorkbenchTerminalInput(ready, "pane-terminal-ready", "ls\n");
  assert.equal(readyInput.command?.kind, "workbench.command");
  assert.deepEqual(readyInput.command?.payload, {
    threadId: "thread-chrome",
    command: "write_terminal_input",
    targetPaneId: "pane-terminal-ready",
    data: { bytes: "ls\n" },
  });

  for (const status of ["completed", "failed"] as const) {
    const exited = stateWithWorkbenchPanes([
      { ...terminalPane(`pane-terminal-${status}`, status), status },
    ]);
    const result = writeWorkbenchTerminalInput(exited, `pane-terminal-${status}`, "x");
    assert.equal(result.command, null);
  }
});

function renderChrome(state: AppChromeState): string {
  return renderToStaticMarkup(<AppChrome viewModel={createAppChromeViewModel(state)} />);
}

function stateWithWorkbenchPanes(panes: WorkbenchPaneRefDto[]): AppChromeState {
  const withThread = applyAppChromeBackendEvent(createAppChromeState(), {
    kind: "thread.hydrated",
    payload: {
      thread,
      runtimeState: "idle",
      workbenchPanes: panes,
    },
  });

  return applyAppChromeBackendEvent(withThread, {
    kind: "workbench.changed",
    payload: {
      threadId: "thread-chrome",
      panes,
    },
  });
}

function backendEvent<TKind extends BackendEventKind>(
  kind: TKind,
  payload: BackendEventPayloadByKind[TKind],
): BackendEventEnvelope<TKind> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: `evt-${kind}`,
    kind,
    emittedAt: later,
    payload,
  };
}

const thread: ThreadSummaryDto = {
  threadId: "thread-chrome",
  title: "Chrome Thread",
  agentBinding: { agentId: "codex" },
  scope: { kind: "project", projectId: "project-tide", cwd: "/repo/tide" },
  createdAt: now,
  updatedAt: now,
  pinned: false,
  archived: false,
  lastKnownState: "idle",
};

function browserPane(paneId: string, title: string): WorkbenchPaneRefDto {
  return {
    paneId,
    kind: "browser",
    title,
    revision: `${paneId}:rev`,
    updatedAt: later,
    url: "http://localhost:3000",
    loading: false,
  };
}

function terminalPane(paneId: string, title: string): WorkbenchPaneRefDto {
  return {
    paneId,
    kind: "terminal",
    title,
    revision: `${paneId}:rev`,
    updatedAt: later,
  };
}
