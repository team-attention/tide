// Spec: docs_v2/specs/thread-row-quick-actions.md
import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { TideProductShell } from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx";
import {
  applyProductShellBackendEvent,
  createProductShellState,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { AgentChatThreadSummary } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

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

test("thread_row_uses_one_menu_action_instead_of_direct_pin_archive_buttons", () => {
  const markup = renderRow(false);
  assert.match(markup, /aria-label="Thread menu"/);
  assert.doesNotMatch(markup, /aria-label="Pin"/);
  assert.doesNotMatch(markup, /aria-label="Archive"/);
  assert.doesNotMatch(markup, /aria-label="Delete worktree"/);
});

test("pinned_thread_row_uses_pinned_leading_marker_not_unpin_button", () => {
  const markup = renderRow(true);
  assert.match(markup, /thread-row__leading--pinned/);
  assert.match(markup, /aria-label="Thread menu"/);
  assert.doesNotMatch(markup, /aria-label="Unpin"/);
  assert.doesNotMatch(markup, /aria-label="Pin"/);
});

test("pinned_thread_row_prioritizes_dynamic_status_over_pinned_marker", () => {
  const running = renderRow(true, "/Users/you/repo", { lastKnownState: "running" });
  assert.match(running, /thread-row__leading--running/);
  assert.doesNotMatch(running, /thread-row__leading--pinned/);

  const attention = renderRow(true, "/Users/you/repo", { lastKnownState: "waiting_for_input" });
  assert.match(attention, /thread-row__leading--attention/);
  assert.doesNotMatch(attention, /thread-row__leading--pinned/);

  const live = renderRow(true, "/Users/you/repo", { live: true });
  assert.match(live, /thread-row__leading--live/);
  assert.doesNotMatch(live, /thread-row__leading--pinned/);
});

test("worktree_thread_row_does_not_render_hover_context_popover", () => {
  const markup = renderRow(true, "/Users/you/repo.worktree/feature-x");
  assert.doesNotMatch(markup, /id="thread-row-context-t1"/);
  assert.doesNotMatch(markup, /thread-row__context-popover/);
  assert.doesNotMatch(markup, />Project</);
  assert.doesNotMatch(markup, />Worktree</);
  assert.doesNotMatch(markup, />feature-x</);
  assert.doesNotMatch(markup, /title="\/Users\/you\/repo\.worktree\/feature-x"/);
  assert.doesNotMatch(markup, /repo \/ feature-x/);
});

test("thread_row_default_markup_does_not_surface_scope_paths", () => {
  const markup = renderRow(true, "C:\\Users\\you\\repo");
  assert.match(markup, /aria-label="Thread menu"/);
  assert.doesNotMatch(markup, /p1 \/ C:\\Users\\you\\repo/);
  assert.doesNotMatch(markup, /p1 \/ repo/);
});

test("delete_worktree_is_not_a_direct_row_action", () => {
  assert.doesNotMatch(renderRow(false), /aria-label="Delete worktree"/);
  assert.doesNotMatch(
    renderRow(false, "/Users/you/repo.worktree/feature-x"),
    /aria-label="Delete worktree"/,
  );
});
