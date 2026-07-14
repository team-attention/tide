// Spec: docs_v2/specs/thread-row-quick-actions.md
import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import { TideProductShell } from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx";
import {
  applyProductShellBackendEvent,
  createProductShellState,
  openProductShellLeftRailMenu,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { AgentChatThreadSummary } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const globals = globalThis as unknown as {
  window: Window;
  document: Document;
  HTMLElement: typeof HTMLElement;
  Element: typeof Element;
  MutationObserver: typeof MutationObserver;
  ResizeObserver: typeof ResizeObserver;
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
globals.window = dom.window as unknown as Window;
globals.document = dom.window.document;
globals.HTMLElement = dom.window.HTMLElement;
globals.Element = dom.window.Element;
globals.MutationObserver = dom.window.MutationObserver;
globals.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
globals.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});

function threadSummary(
  threadId: string,
  pinned: boolean,
  cwd = "/Users/you/repo",
  overrides: Partial<AgentChatThreadSummary> = {},
): AgentChatThreadSummary {
  return {
    threadId,
    title: `Thread ${threadId}`,
    agentBinding: {
      agentId: "claude",
      runtimeSource: { kind: "provider_cli", integrationId: "claude" },
    },
    scope: { kind: "project", projectId: "p1", cwd },
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:01:00.000Z",
    pinned,
    archived: false,
    lastKnownState: "idle",
    ...overrides,
  };
}

// Render the whole shell with a single thread — NO context menu open — so we can
// assert the row's DIRECT (hover) quick-actions, not the right-click menu.
function renderRow(
  pinned: boolean,
  cwd = "/Users/you/repo",
  overrides: Partial<AgentChatThreadSummary> = {},
): string {
  const seeded = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    { kind: "thread.listed", payload: { threads: [threadSummary("t1", pinned, cwd, overrides)] } },
  );
  return renderToStaticMarkup(<TideProductShell initialState={seeded} />);
}

function renderThreadMenu(
  cwd = "/Users/you/repo",
  overrides: Partial<AgentChatThreadSummary> = {},
): string {
  const seeded = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    { kind: "thread.listed", payload: { threads: [threadSummary("t1", false, cwd, overrides)] } },
  );
  return renderToStaticMarkup(
    <TideProductShell
      initialState={openProductShellLeftRailMenu(seeded, { kind: "thread", threadId: "t1" })}
    />,
  );
}

test("thread_row_exposes_direct_pin_archive_actions_plus_menu", () => {
  const markup = renderRow(false);
  assert.match(markup, /aria-label="Pin"/);
  assert.match(markup, /aria-label="Archive"/);
  assert.match(markup, /aria-label="Thread menu"/);
  assert.doesNotMatch(markup, /aria-label="Unpin"/);
  assert.doesNotMatch(markup, /aria-label="Delete worktree"/);
  assert.doesNotMatch(markup, /data-thread-leading-status/);
});

test("pinned_thread_row_exposes_direct_unpin_without_leading_marker", () => {
  const markup = renderRow(true);
  assert.match(markup, /aria-label="Unpin"/);
  assert.match(markup, /aria-label="Archive"/);
  assert.match(markup, /aria-label="Thread menu"/);
  assert.doesNotMatch(markup, /data-thread-leading-status/);
});

test("thread_row_leading_status_is_only_for_running_or_attention", () => {
  const running = renderRow(true, "/Users/you/repo", { lastKnownState: "running" });
  assert.match(running, /data-thread-leading-status="running"/);

  const attention = renderRow(true, "/Users/you/repo", { lastKnownState: "waiting_for_input" });
  assert.match(attention, /data-thread-leading-status="attention"/);

  const live = renderRow(true, "/Users/you/repo", { live: true });
  assert.doesNotMatch(live, /data-thread-leading-status/);
});

test("thread_row_does_not_mount_a_second_hover_context_popover", () => {
  const markup = renderRow(true, "/Users/you/repo.worktree/feature-x");
  assert.doesNotMatch(markup, /data-thread-context-popover/);
  assert.doesNotMatch(markup, /aria-describedby="thread-row-context-t1"/);
  assert.doesNotMatch(markup, /repo \/ feature-x/);
});

test("thread_menu_contains_secondary_utilities_not_duplicate_hover_actions", () => {
  const markup = renderThreadMenu("/Users/you/repo", {
    agentBinding: {
      agentId: "claude",
      runtimeSource: { kind: "provider_cli", integrationId: "claude" },
      providerSessionRef: { kind: "claude_transcript", value: "provider-session-1" },
    },
  });
  assert.match(markup, /data-left-rail-menu-kind="thread"/);
  assert.match(markup, /Review changes/);
  assert.match(markup, /Rename task/);
  assert.match(markup, /Reveal in Finder/);
  assert.match(markup, /Copy working directory/);
  assert.match(markup, /Copy session ID/);
  assert.match(markup, /Copy thread ID/);
  assert.doesNotMatch(markup, /data-left-rail-menu-item="Pin"/);
  assert.doesNotMatch(markup, /data-left-rail-menu-item="Archive"/);
  assert.doesNotMatch(markup, /data-left-rail-menu-item="Delete worktree/);
});

test("thread_menu_copy_session_id_writes_provider_session_ref", async () => {
  let copied = "";
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: async (value: string) => {
        copied = value;
      },
    },
    configurable: true,
  });
  const seeded = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    {
      kind: "thread.listed",
      payload: {
        threads: [
          threadSummary("t1", false, "/Users/you/repo", {
            agentBinding: {
              agentId: "claude",
              runtimeSource: { kind: "provider_cli", integrationId: "claude" },
              providerSessionRef: { kind: "claude_transcript", value: "provider-session-1" },
            },
          }),
        ],
      },
    },
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TideProductShell
        initialState={openProductShellLeftRailMenu(seeded, { kind: "thread", threadId: "t1" })}
      />,
    );
  });

  const copyButton = container.querySelector<HTMLButtonElement>(
    '[data-left-rail-menu-item="Copy session ID"]',
  );
  assert.ok(copyButton);
  await act(async () => {
    copyButton.click();
  });

  assert.equal(copied, "provider-session-1");
  assert.equal(container.querySelector('[data-left-rail-menu-kind="thread"]'), null);

  await act(async () => root.unmount());
  container.remove();
});

test("delete_worktree_is_direct_only_for_worktree_rows", () => {
  assert.doesNotMatch(renderRow(false), /aria-label="Delete worktree"/);
  assert.match(renderRow(false, "/Users/you/repo.worktree/feature-x"), /aria-label="Delete worktree"/);
});
