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

test("thread_row_exposes_direct_pin_and_archive_without_opening_menu", () => {
  // master-plan:120 — pin + archive are direct hover actions on the row, so they
  // cost one click and are present in the row markup even with the menu closed.
  const markup = renderRow(false);
  assert.match(markup, /aria-label="Pin"/);
  assert.match(markup, /aria-label="Archive"/);
  // The ⋯ overflow button is gone — three direct buttons fit, so the full menu is
  // reachable on right-click only (no visible ⋯ on the row).
  assert.doesNotMatch(markup, /aria-label="Thread menu"/);
});

test("pinned_thread_row_shows_unpin_quick_action", () => {
  // The pin quick-action reflects state: a pinned thread offers Unpin.
  const markup = renderRow(true);
  assert.match(markup, /aria-label="Unpin"/);
  assert.doesNotMatch(markup, /aria-label="Pin"/);
});

test("pinned_worktree_thread_row_shows_repo_and_worktree_context", () => {
  const markup = renderRow(true, "/Users/you/repo.worktree/feature-x");
  assert.match(markup, /repo \/ feature-x/);
  assert.match(markup, /title="\/Users\/you\/repo\.worktree\/feature-x"/);
});

test("pinned_thread_row_scope_label_handles_windows_paths", () => {
  const markup = renderRow(true, "C:\\Users\\you\\repo");
  assert.match(markup, /p1 \/ repo/);
  assert.doesNotMatch(markup, /p1 \/ C:\\Users\\you\\repo/);
});

test("delete_worktree_is_a_direct_action_for_worktree_threads_only", () => {
  // A plain (non-worktree) thread shows only Pin + Archive — nothing to delete.
  assert.doesNotMatch(renderRow(false), /aria-label="Delete worktree"/);
  // A worktree thread (cwd under <repo>.worktree/<branch>) gets the third direct
  // button: Delete worktree, which opens the confirm dialog (deletes dir + branch).
  assert.match(
    renderRow(false, "/Users/you/repo.worktree/feature-x"),
    /aria-label="Delete worktree"/,
  );
});
