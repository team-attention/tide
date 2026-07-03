// Spec: docs_v2/specs/workbench-tab-focus-preservation.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProductShellBackendEvent,
  closeProductShellWorkbenchPane,
  createProductShellState,
  createProductShellViewModel,
  focusProductShellWorkbenchPane,
  openProductShellThread,
  openProductShellWorkbenchLauncher,
  toggleProductShellWorkbenchWithLauncher,
  type ProductShellState,
  type ProductShellThread,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { AppChromeWorkbenchPaneRef } from "../src/desktop/application/domains/app-chrome/app-chrome-state.ts";

const now = "2026-07-03T00:00:00.000Z";

test("reopening_workbench_preserves_selected_tab", () => {
  const focused = focusProductShellWorkbenchPane(
    stateWithActiveThread(
      [browserPane("browser-1"), launcherPane("launcher-1")],
      "browser-1",
    ),
    "launcher-1",
  ).state;

  const closed = toggleProductShellWorkbenchWithLauncher(focused).state;
  const reopened = toggleProductShellWorkbenchWithLauncher(closed).state;

  assert.equal(closed.workbenchOpen, false);
  assert.equal(reopened.workbenchOpen, true);
  assert.equal(activeWorkbenchTabId(reopened), "launcher-1");
  assert.equal(reopened.appChrome.activeWorkbenchPaneId, "launcher-1");
});

test("switching_threads_restores_selected_workbench_tab", () => {
  const state = stateWithThreads(
    [
      productThread("thread-a", [browserPane("a-browser"), launcherPane("a-launcher")], "a-launcher"),
      productThread("thread-b", [browserPane("b-browser"), launcherPane("b-launcher")], "b-browser"),
    ],
    "thread-a",
  );

  const onB = openProductShellThread(state, "thread-b");
  const backToA = openProductShellThread(onB, "thread-a");

  assert.equal(activeWorkbenchTabId(onB), "b-browser");
  assert.equal(activeWorkbenchTabId(backToA), "a-launcher");
  assert.equal(backToA.appChrome.activeWorkbenchPaneId, "a-launcher");
});

test("new_workbench_pane_focuses_existing_launcher", () => {
  const result = openProductShellWorkbenchLauncher(
    stateWithActiveThread(
      [browserPane("browser-1"), launcherPane("launcher-1")],
      "browser-1",
    ),
  );

  assert.equal(activeWorkbenchTabId(result.state), "launcher-1");
  assert.equal(result.state.appChrome.activeWorkbenchPaneId, "launcher-1");
  assert.equal(result.command?.kind, "workbench.command");
  assert.equal(
    result.command?.kind === "workbench.command" && result.command.payload.command,
    "open_launcher",
  );
});

test("closing_browser_with_launcher_remaining_keeps_workbench_open", () => {
  const result = closeProductShellWorkbenchPane(
    stateWithActiveThread(
      [browserPane("browser-1"), launcherPane("launcher-1")],
      "browser-1",
    ),
    "browser-1",
  );

  assert.equal(result.state.workbenchOpen, true);
  assert.equal(result.state.appChrome.activeWorkbenchPaneId, "launcher-1");
  assert.equal(activeWorkbenchTabId(result.state), "launcher-1");
  assert.equal(result.command?.kind, "workbench.command");
  assert.equal(
    result.command?.kind === "workbench.command" && result.command.payload.targetPaneId,
    "browser-1",
  );

  const confirmed = applyProductShellBackendEvent(result.state, {
    kind: "workbench.changed",
    payload: {
      threadId: "thread-1",
      panes: [launcherPane("launcher-1")],
      activePaneId: "launcher-1",
    },
  });

  assert.equal(confirmed.workbenchOpen, true);
  assert.equal(activeWorkbenchTabId(confirmed), "launcher-1");
});

function activeWorkbenchTabId(state: ProductShellState): string | undefined {
  return createProductShellViewModel(state).appChrome.workbenchTabStrip.visibleTabs.find(
    (tab) => tab.active,
  )?.paneId;
}

function stateWithActiveThread(
  panes: AppChromeWorkbenchPaneRef[],
  activePaneId: string,
): ProductShellState {
  return stateWithThreads([productThread("thread-1", panes, activePaneId)], "thread-1");
}

function stateWithThreads(
  threads: ProductShellThread[],
  activeThreadId: string,
): ProductShellState {
  const base = createProductShellState({ includeFixtureData: false });
  const activeThread = threads.find((thread) => thread.threadId === activeThreadId);
  if (activeThread === undefined) {
    throw new Error(`Missing active thread ${activeThreadId}`);
  }
  return {
    ...base,
    activeThreadId,
    workbenchOpen: true,
    threads,
    appChrome: {
      ...base.appChrome,
      thread: {
        threadId: activeThread.threadId,
        title: activeThread.title,
        agentBinding: { agentId: activeThread.agentId },
      },
      workbenchPanes: activeThread.workbenchPanes,
      activeWorkbenchPaneId: activeThread.activeWorkbenchPaneId,
    },
    workbenchOpenByThreadId: Object.fromEntries(
      threads.map((thread) => [thread.threadId, true]),
    ),
  };
}

function productThread(
  threadId: string,
  workbenchPanes: AppChromeWorkbenchPaneRef[],
  activeWorkbenchPaneId: string,
): ProductShellThread {
  return {
    threadId,
    title: `Thread ${threadId}`,
    agentId: "codex",
    time: "now",
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    workbenchPanes,
    activeWorkbenchPaneId,
  };
}

function browserPane(paneId: string): AppChromeWorkbenchPaneRef {
  return {
    paneId,
    kind: "browser",
    title: "Browser",
    revision: `${paneId}:rev`,
    updatedAt: now,
    loading: false,
  };
}

function launcherPane(paneId: string): AppChromeWorkbenchPaneRef {
  return {
    paneId,
    kind: "launcher",
    title: "Workbench launcher",
    revision: `${paneId}:rev`,
    updatedAt: now,
    actions: [
      {
        actionId: "open_browser",
        label: "Browser",
        description: "Open a Browser Pane",
        enabled: true,
      },
    ],
  };
}
