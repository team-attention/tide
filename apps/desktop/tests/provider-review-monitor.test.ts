import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { workbenchSnapshotPaneRef } from "../src/backend/application/services/workbench/workbench-snapshot.ts";
import type { ReviewPaneState } from "../src/backend/application/domains/workbench/workbench.ts";
import { AgentMonitorPanel } from "../src/desktop/adapters/inbound/react-renderer/product-shell/agent-monitor-panel.tsx";
import type { ProductShellHandlers } from "../src/desktop/adapters/inbound/react-renderer/product-shell/support/types.ts";
import {
  applyProductShellBackendEvent,
  createProductShellState,
  createProductShellViewModel,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { ProductShellAgentMonitorSession } from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { AgentChatPromptState, AgentChatThreadSummary } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as unknown as { window: unknown }).window = dom.window;
(globalThis as unknown as { document: unknown }).document = dom.window.document;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("review pane snapshots carry cwd and provider agent", () => {
  const pane: ReviewPaneState = {
    paneId: "pane-review",
    kind: "review",
    title: "Review",
    revision: "rev-1",
    updatedAt: "2026-07-04T00:00:00.000Z",
    cwd: "/repo/tide",
    agentId: "codex",
  };

  const ref = workbenchSnapshotPaneRef(pane);

  assert.equal(ref.kind, "review");
  assert.equal(ref.cwd, "/repo/tide");
  assert.equal(ref.agentId, "codex");
});

test("agent monitor sessions derive needs-attention state from background runtime events", () => {
  const listed = applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: [threadSummary()] },
  });
  const waiting = applyProductShellBackendEvent(listed, {
    kind: "agentRuntime.stateChanged",
    payload: {
      threadId: "thread-review",
      state: "waiting_for_approval",
      changedAt: "2026-07-04T00:03:00.000Z",
      queuedInputs: ["fix the review finding"],
    },
  });
  const prompted = applyProductShellBackendEvent(waiting, {
    kind: "prompt.changed",
    payload: { threadId: "thread-review", prompt: approvalPrompt() },
  });

  const view = createProductShellViewModel(prompted);

  assert.equal(view.agentMonitorSessions.length, 1);
  assert.equal(view.agentMonitorSessions[0]?.threadId, "thread-review");
  assert.equal(view.agentMonitorSessions[0]?.state, "waiting_for_approval");
  assert.equal(view.agentMonitorSessions[0]?.pendingPromptKind, "approval");
  assert.equal(view.agentMonitorSessions[0]?.queuedInputCount, 1);
  assert.equal(view.agentMonitorSessions[0]?.cwd, "/repo/tide");
});

test("agent monitor open-changes action targets the row thread", async () => {
  let openedThreadId: string | null = null;
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const handlers = {
    onAgentMonitorToggle: () => undefined,
    onThreadSelect: () => undefined,
    onOpenThreadChanges: (threadId: string) => {
      openedThreadId = threadId;
    },
    onInterrupt: () => undefined,
  } as Partial<ProductShellHandlers> as ProductShellHandlers;

  await act(async () => {
    root.render(
      createElement(AgentMonitorPanel, {
        sessions: [
          {
            threadId: "thread-review",
            agentId: "codex",
            title: "Review handoff",
            cwd: "/repo/tide",
            state: "running",
            active: false,
          } satisfies ProductShellAgentMonitorSession,
        ],
        handlers,
      }),
    );
  });
  const button = container.querySelector('button[aria-label="Open changes"]') as HTMLButtonElement | null;
  assert.notEqual(button, null);

  await act(async () => {
    button?.click();
  });
  await act(async () => {
    root.unmount();
  });

  assert.equal(openedThreadId, "thread-review");
});

function threadSummary(): AgentChatThreadSummary {
  return {
    threadId: "thread-review",
    title: "Review handoff",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:02:00.000Z",
    pinned: false,
    archived: false,
    lastKnownState: "idle",
    live: true,
    runtimeStartedAt: "2026-07-04T00:01:00.000Z",
  };
}

function approvalPrompt(): AgentChatPromptState {
  return {
    promptId: "prompt-review",
    threadId: "thread-review",
    agentId: "codex",
    kind: "approval",
    message: "Approve git command?",
    source: "provider_signal",
  };
}
