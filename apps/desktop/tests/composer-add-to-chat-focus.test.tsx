// Spec: docs_v2/specs/composer-block-only-send-and-focus.md
// "Add to chat" appends a context chip to the composer; the cursor must land in THAT
// chip's comment field so the user can immediately note what they want about the
// selection. Uses a real jsdom + react-dom/client mount so the focus effect actually
// runs (renderToStaticMarkup runs no effects).
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";

import {
  addComposerContextChip,
  createAgentChatShellState,
  createAgentChatShellViewModel,
} from "../src/desktop/application/domains/agent-chat/agent-chat.ts";
import { applyBackendEventToAgentChatShell } from "../src/desktop/adapters/inbound/react-renderer/agent-chat/contract-adapter.ts";
import { AgentChatShell } from "../src/desktop/adapters/inbound/react-renderer/agent-chat/agent-chat.tsx";
import {
  CONTRACT_VERSION,
  type BackendEventEnvelope,
  type BackendEventKind,
  type BackendEventPayloadByKind,
  type ThreadSummaryDto,
} from "../src/shared/contracts/index.ts";

// jsdom globals must exist before react-dom/client renders (imported dynamically below).
const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as unknown as { window: unknown }).window = dom.window;
(globalThis as unknown as { document: unknown }).document = dom.window.document;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function backendEvent<TKind extends BackendEventKind>(
  kind: TKind,
  payload: BackendEventPayloadByKind[TKind],
): BackendEventEnvelope<TKind> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: `evt-${kind}`,
    kind,
    emittedAt: "2026-05-27T00:00:01.000Z",
    payload,
  };
}

const thread: ThreadSummaryDto = {
  threadId: "thread-shell",
  title: "Desktop shell",
  agentBinding: { agentId: "codex" },
  scope: { kind: "project", projectId: "project-tide", cwd: "/repo/tide" },
  createdAt: "2026-05-27T00:00:00.000Z",
  updatedAt: "2026-05-27T00:00:00.000Z",
  pinned: false,
  archived: false,
  lastKnownState: "idle",
};

test("adding_a_context_chip_focuses_that_chips_comment_field", async () => {
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const base = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "idle" }),
  );

  // Mount with no chips — there is no chip comment field, and nothing is auto-focused.
  await act(async () => {
    root.render(<AgentChatShell viewModel={createAgentChatShellViewModel(base)} />);
  });
  assert.equal(
    document.activeElement?.getAttribute("data-chip-comment-id"),
    null,
    "a fresh thread must not focus a chip comment field",
  );

  // "Add to chat" appends a chip → the cursor lands in THAT chip's comment field.
  const withChip = addComposerContextChip(base, {
    id: "chip-1",
    kind: "code",
    label: "snippet.ts",
    text: "const x = 1;",
  }).state;
  await act(async () => {
    root.render(<AgentChatShell viewModel={createAgentChatShellViewModel(withChip)} />);
  });

  assert.equal(
    document.activeElement?.getAttribute("data-chip-comment-id"),
    "chip-1",
    "adding a context chip focuses that chip's comment field",
  );

  await act(async () => root.unmount());
});

test("switching_to_a_thread_whose_composer_holds_a_chip_does_not_steal_focus", async () => {
  // Spec invariant: thread switching never steals focus. AgentChatShell is REUSED across
  // threads, so the chip-count ref persists; opening a thread whose composer already holds
  // a chip (count 0 → 1 across the switch) must NOT read as an "add". The threadId gate
  // re-baselines the count when the thread changes.
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const threadA = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "idle" }),
  );
  const otherThread: ThreadSummaryDto = { ...thread, threadId: "thread-other", title: "Other" };
  const threadBWithChip = addComposerContextChip(
    applyBackendEventToAgentChatShell(
      createAgentChatShellState(),
      backendEvent("thread.hydrated", { thread: otherThread, blocks: [], runtimeState: "idle" }),
    ),
    { id: "chip-b", kind: "code", label: "other.ts", text: "const y = 2;" },
  ).state;

  // Mount thread A (no chips), then SWITCH to thread B (which already carries a chip).
  await act(async () => {
    root.render(<AgentChatShell viewModel={createAgentChatShellViewModel(threadA)} />);
  });
  await act(async () => {
    root.render(<AgentChatShell viewModel={createAgentChatShellViewModel(threadBWithChip)} />);
  });

  assert.equal(
    document.activeElement?.getAttribute("data-chip-comment-id"),
    null,
    "switching threads must not focus the new thread's chip comment field",
  );

  await act(async () => root.unmount());
});

test("switching_threads_closes_the_agent_chat_find_bar", async () => {
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const threadA = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "idle" }),
  );
  const threadB = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", {
      thread: { ...thread, threadId: "thread-other", title: "Other" },
      blocks: [],
      runtimeState: "idle",
    }),
  );

  await act(async () => {
    root.render(<AgentChatShell viewModel={createAgentChatShellViewModel(threadA)} />);
  });
  await act(async () => {
    container
      .querySelector("[data-agent-chat-shell]")
      ?.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
    window.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "f",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  assert.ok(
    container.querySelector('input[placeholder="Search this thread"]'),
    "Cmd+F opens the current thread find bar",
  );

  await act(async () => {
    root.render(<AgentChatShell viewModel={createAgentChatShellViewModel(threadB)} />);
  });
  assert.equal(
    container.querySelector('input[placeholder="Search this thread"]'),
    null,
    "switching threads closes the scoped find bar",
  );

  await act(async () => root.unmount());
});
