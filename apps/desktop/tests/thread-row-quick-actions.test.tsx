// Spec: docs_v2/specs/thread-row-quick-actions.md
import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { TideProductShell } from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx";
import {
  applyProductShellBackendEvent,
  createProductShellState,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

function threadSummary(threadId: string, pinned: boolean) {
  return {
    threadId,
    title: `Thread ${threadId}`,
    agentBinding: {
      agentId: "claude",
      runtimeSource: { kind: "provider_cli", integrationId: "claude" },
    },
    scope: { kind: "project", projectId: "p1", cwd: "/Users/you/repo" },
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:01:00.000Z",
    pinned,
    archived: false,
    lastKnownState: "idle",
  };
}

// Render the whole shell with a single thread — NO context menu open — so we can
// assert the row's DIRECT (hover) quick-actions, not the overflow menu.
function renderRow(pinned: boolean): string {
  const seeded = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    { kind: "thread.listed", payload: { threads: [threadSummary("t1", pinned)] } },
  );
  return renderToStaticMarkup(<TideProductShell initialState={seeded} />);
}

test("thread_row_exposes_direct_pin_and_archive_without_opening_menu", () => {
  // master-plan:120 — pin + archive are direct hover actions on the row, so they
  // cost one click and are present in the row markup even with the menu closed.
  const markup = renderRow(false);
  assert.match(markup, /aria-label="Pin"/);
  assert.match(markup, /aria-label="Archive"/);
  // The ⋯ overflow still exists for the full menu / right-click parity.
  assert.match(markup, /aria-label="Thread menu"/);
});

test("pinned_thread_row_shows_unpin_quick_action", () => {
  // The pin quick-action reflects state: a pinned thread offers Unpin.
  const markup = renderRow(true);
  assert.match(markup, /aria-label="Unpin"/);
  assert.doesNotMatch(markup, /aria-label="Pin"/);
});

test("delete_worktree_is_never_a_direct_quick_action", () => {
  // Destructive Delete worktree stays menu-only (no direct quick-action button),
  // and a non-worktree thread has no worktree delete anywhere with the menu closed.
  const markup = renderRow(false);
  assert.doesNotMatch(markup, /Delete worktree/);
});
