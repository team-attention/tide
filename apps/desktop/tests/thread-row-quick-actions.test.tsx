// Spec: docs_v2/specs/thread-row-quick-actions.md
import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { TideProductShell } from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx";
import {
  applyProductShellBackendEvent,
  createProductShellState,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

function threadSummary(threadId: string, pinned: boolean, cwd = "/Users/you/repo") {
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
  };
}

// Render the whole shell with a single thread — NO context menu open — so we can
// assert the row's DIRECT (hover) quick-actions, not the right-click menu.
function renderRow(pinned: boolean, cwd = "/Users/you/repo"): string {
  const seeded = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    { kind: "thread.listed", payload: { threads: [threadSummary("t1", pinned, cwd)] } },
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
