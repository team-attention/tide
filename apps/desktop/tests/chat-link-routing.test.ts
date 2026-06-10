// Chat links must open in the in-app Browser Pane, never navigate the top-level
// window (the freeze bug). These pin the two halves of that routing: the chat
// markdown marks http(s) links for in-app handling, and the product-shell state
// function emits an open_browser command (at the clicked URL) that opens the
// workbench browser tab.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createAgentChatShellState,
  createAgentChatShellViewModel,
} from "../src/desktop/application/domains/agent-chat/agent-chat-shell-state.ts";
import { applyBackendEventToAgentChatShell } from "../src/desktop/adapters/inbound/react-renderer/agent-chat-contract-adapter.ts";
import { AgentChatShell } from "../src/desktop/adapters/inbound/react-renderer/agent-chat-shell.ts";
import {
  openProductShellBrowserAtUrl,
  type ProductShellState,
} from "../src/desktop/application/domains/product-shell/product-shell-state.ts";
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
    createElement(AgentChatShell, {
      viewModel: createAgentChatShellViewModel(state),
      onOpenBrowserPane: () => undefined,
      onOpenFile: () => undefined,
    }),
  );

  // http(s) → in-app browser-pane marker (the click delegation reads this).
  assert.ok(markup.includes('data-open-browser-link="https://finance.yahoo.com/"'));
  assert.ok(markup.includes("md-ext-link"));
  // file:// still routes to the editor (unchanged), proving the two are distinct.
  assert.ok(markup.includes('data-open-file="/tmp/x.ts"'));
});

test("openProductShellBrowserAtUrl opens the workbench + emits open_browser with the url", () => {
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
    { url: "https://example.com/page" },
  );
});

test("openProductShellBrowserAtUrl is a no-op with no active thread or an empty url", () => {
  assert.equal(
    openProductShellBrowserAtUrl({ activeThreadId: null } as unknown as ProductShellState, "https://x").command,
    null,
  );
  assert.equal(
    openProductShellBrowserAtUrl({ activeThreadId: "t1" } as unknown as ProductShellState, "").command,
    null,
  );
});
