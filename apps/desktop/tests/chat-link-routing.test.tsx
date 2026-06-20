// Chat links must open in the in-app Browser Pane, never navigate the top-level
// window (the freeze bug). These pin the two halves of that routing: the chat
// markdown marks http(s) links for in-app handling, and the product-shell state
// function emits an open_browser command (at the clicked URL) that opens a new
// workbench browser pane.
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createAgentChatShellState,
  createAgentChatShellViewModel,
} from "../src/desktop/application/domains/agent-chat/agent-chat.ts";
import { applyBackendEventToAgentChatShell } from "../src/desktop/adapters/inbound/react-renderer/agent-chat/contract-adapter.ts";
import { AgentChatShell } from "../src/desktop/adapters/inbound/react-renderer/agent-chat/agent-chat.tsx";
import { createAgentSession } from "../src/desktop/adapters/inbound/react-renderer/agent-chat/transcript/transcript.tsx";
import {
  openProductShellBrowserAtUrl,
  type ProductShellState,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import {
  CONTRACT_VERSION,
  type BackendEventEnvelope,
  type BackendEventKind,
  type BackendEventPayloadByKind,
  type ThreadSummaryDto,
} from "../src/shared/contracts/index.ts";

const iso = "2026-06-10T00:00:00.000Z";
const thread: ThreadSummaryDto = {
  threadId: "t1",
  title: "Links",
  agentBinding: { agentId: "codex" },
  scope: { kind: "project", projectId: "p", cwd: "/repo" },
  createdAt: iso,
  updatedAt: iso,
  pinned: false,
  archived: false,
  lastKnownState: "idle",
};

function backendEvent<TKind extends BackendEventKind>(
  kind: TKind,
  payload: BackendEventPayloadByKind[TKind],
): BackendEventEnvelope<TKind> {
  return { contractVersion: CONTRACT_VERSION, eventId: `evt-${kind}`, kind, emittedAt: iso, payload };
}

test("an http link in an agent message is marked for the in-app browser pane (not a window-navigating anchor)", () => {
  let state = createAgentChatShellState();
  state = applyBackendEventToAgentChatShell(
    state,
    backendEvent("thread.hydrated", {
      thread,
      blocks: [
        {
          blockId: "b1",
          threadId: "t1",
          agentId: "codex",
          kind: "agent_message",
          role: "agent",
          status: "complete",
          body: "See [Yahoo](https://finance.yahoo.com/) and the [file](file:///tmp/x.ts).",
          updatedAt: iso,
        },
      ],
      runtimeState: "idle",
    }),
  );

  const markup = renderToStaticMarkup(
    <AgentChatShell
      viewModel={createAgentChatShellViewModel(state)}
      onOpenBrowserPane={() => undefined}
      onOpenFile={() => undefined}
    />,
  );

  // http(s) → in-app browser-pane marker (the click delegation reads this).
  assert.ok(markup.includes('data-open-browser-link="https://finance.yahoo.com/"'));
  assert.ok(markup.includes("md-ext-link"));
  // file:// still routes to the editor (unchanged), proving the two are distinct.
  assert.ok(markup.includes('data-open-file="/tmp/x.ts"'));
});

test("session link click requests a new in-app browser pane", () => {
  const dom = new JSDOM('<a data-open-browser-link="https://example.com/page">link</a>');
  const originalElement = (globalThis as unknown as { Element?: unknown }).Element;
  (globalThis as unknown as { Element: unknown }).Element = dom.window.Element;
  const anchor = dom.window.document.querySelector("a");
  assert.ok(anchor !== null);
  let opened: { url: string; options?: { newPane?: boolean } } | null = null;
  let prevented = false;

  try {
    const session = createAgentSession(
      [],
      "ready",
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (url, options) => {
        opened = { url, options };
      },
    );
    const onClick = (session.props as {
      onClick: (event: { target: EventTarget | null; preventDefault: () => void }) => void;
    }).onClick;
    onClick({
      target: anchor,
      preventDefault: () => {
        prevented = true;
      },
    });
  } finally {
    if (originalElement === undefined) {
      delete (globalThis as unknown as { Element?: unknown }).Element;
    } else {
      (globalThis as unknown as { Element: unknown }).Element = originalElement;
    }
  }

  assert.equal(prevented, true);
  assert.deepEqual(opened, {
    url: "https://example.com/page",
    options: { newPane: true },
  });
});

test("openProductShellBrowserAtUrl opens the workbench + emits open_browser in a new pane by default", () => {
  const result = openProductShellBrowserAtUrl(
    { activeThreadId: "t1", workbenchOpen: false } as unknown as ProductShellState,
    "https://example.com/page",
  );
  assert.equal(result.state.workbenchOpen, true);
  assert.equal(result.command?.kind, "workbench.command");
  assert.equal(
    result.command?.kind === "workbench.command" ? result.command.payload.command : null,
    "open_browser",
  );
  assert.deepEqual(
    result.command?.kind === "workbench.command" ? result.command.payload.data : null,
    { url: "https://example.com/page", disposition: "new_browser_pane" },
  );
});

test("openProductShellBrowserAtUrl opens a draft pane with no active thread; empty url is a no-op", () => {
  // Composer (New Thread) page: no backend thread, so a link opens a
  // renderer-owned draft pane, not a backend command.
  const draft = openProductShellBrowserAtUrl(
    { activeThreadId: null, draftWorkbenchPanes: [] } as unknown as ProductShellState,
    "https://x",
  );
  assert.equal(draft.command, null);
  assert.equal(draft.state.draftWorkbenchPanes.length, 1);
  assert.equal(draft.state.draftWorkbenchPanes[0]?.url, "https://x");
  // An empty url is a genuine no-op even with an active thread.
  assert.equal(
    openProductShellBrowserAtUrl({ activeThreadId: "t1" } as unknown as ProductShellState, "").command,
    null,
  );
});
