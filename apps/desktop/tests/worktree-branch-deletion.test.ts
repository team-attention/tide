// Spec: docs_v2/specs/worktree-branch-deletion.md
import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TideProductShell,
  WorktreeDeleteDialog,
  type WorktreeDeleteTarget,
} from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.ts";
import {
  applyProductShellBackendEvent,
  archiveProductShellWorktreeChats,
  createProductShellState,
  openProductShellLeftRailMenu,
  setProductShellGitContext,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

function render(target: WorktreeDeleteTarget): string {
  return renderToStaticMarkup(
    createElement(WorktreeDeleteDialog, { target, onConfirm: () => {}, onClose: () => {} }),
  );
}

function threadSummary(threadId: string, cwd: string) {
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
    pinned: false,
    archived: false,
    lastKnownState: "idle",
  };
}

function seedThreads(cwds: { threadId: string; cwd: string }[]) {
  return applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: cwds.map((entry) => threadSummary(entry.threadId, entry.cwd)) },
  });
}

// Render the whole product shell with a single thread living at `cwd`, with that
// thread's left-rail context menu open — so we can assert what the menu offers.
function renderThreadContextMenu(cwd: string): string {
  const seeded = seedThreads([{ threadId: "t1", cwd }]);
  const withMenu = openProductShellLeftRailMenu(seeded, { kind: "thread", threadId: "t1" });
  return renderToStaticMarkup(createElement(TideProductShell, { initialState: withMenu }));
}

test("worktree_delete_dialog_defaults_to_deleting_branch_with_keep_optout", () => {
  // D2: default action deletes worktree + branch; a "Keep branch" checkbox opts out.
  const markup = render({
    cwd: "/repo.worktree/fix-login",
    branch: "fix-login",
    branchMerged: true,
    threadCount: 1,
    anyRunning: false,
  });
  assert.match(markup, /Delete worktree \+ branch/);
  assert.match(markup, /Keep branch fix-login/);
  assert.match(markup, /type="checkbox"/);
});

test("worktree_delete_dialog_warns_on_unmerged_branch", () => {
  // D3: an unmerged branch (default = delete branch) shows the commit-loss warning.
  const markup = render({
    cwd: "/repo.worktree/spike",
    branch: "spike",
    branchMerged: false,
    threadCount: 0,
    anyRunning: false,
  });
  assert.match(markup, /unmerged commits/);
});

test("worktree_delete_blocked_while_a_thread_runs", () => {
  // D4: a running agent blocks deletion — confirm is disabled, with a stop hint.
  const markup = render({
    cwd: "/repo.worktree/busy",
    branch: "busy",
    branchMerged: true,
    threadCount: 2,
    anyRunning: true,
  });
  assert.match(markup, /Stop it first/);
  assert.match(markup, /disabled/);
  // The keep-branch checkbox is hidden while blocked (nothing to choose).
  assert.doesNotMatch(markup, /Keep branch/);
});

test("thread_row_exposes_context_menu_trigger", () => {
  // The ⋯ overflow on each thread row is the reachable opener for the menu.
  const markup = renderThreadContextMenu("/Users/you/repo.worktree/fix-login");
  assert.match(markup, /aria-label="Thread menu"/);
});

test("worktree_thread_menu_offers_archive_and_delete_worktree", () => {
  // D1: a thread living in a `<repo>.worktree/<branch>` worktree exposes both
  // Archive and a "Delete worktree (branch)" item in its context menu.
  const markup = renderThreadContextMenu("/Users/you/repo.worktree/fix-login");
  assert.match(markup, /Delete worktree \(fix-login\)/);
  assert.match(markup, /Archive/);
});

test("non_worktree_thread_menu_omits_delete_worktree", () => {
  // Invariant 4: a thread in the main repo (not a worktree) cannot delete a
  // worktree — its menu offers Pin / Archive only, no "Delete worktree".
  const markup = renderThreadContextMenu("/Users/you/repo");
  assert.match(markup, /Archive/);
  assert.doesNotMatch(markup, /Delete worktree/);
});

test("deleting_a_worktree_archives_its_threads_and_drops_it_from_lists", () => {
  // Deleting a worktree must archive the Threads that lived there AND remove the
  // worktree from the Composer's worktree list — both reflected without a refresh.
  const cwd = "/Users/you/repo.worktree/fix-login";
  let state = seedThreads([
    { threadId: "wt1", cwd },
    { threadId: "wt2", cwd },
    { threadId: "other", cwd: "/Users/you/repo" },
  ]);
  state = setProductShellGitContext(state, {
    branches: [],
    worktrees: [
      { path: cwd, branch: "fix-login", current: false },
      { path: "/Users/you/repo", branch: "main", current: true },
    ],
  });

  const result = archiveProductShellWorktreeChats(state, cwd);

  // The two worktree threads are dropped optimistically; the unrelated one stays.
  assert.deepEqual(
    result.state.threads.map((thread) => thread.threadId),
    ["other"],
  );
  // One thread.archive(true) command per worktree thread.
  assert.deepEqual(
    result.commands.map((command) => command.payload.threadId).sort(),
    ["wt1", "wt2"],
  );
  assert.ok(result.commands.every((command) => command.payload.archived === true));
  // The deleted worktree is gone from the Composer's worktree list; others remain.
  assert.deepEqual(
    result.state.gitWorktrees.map((worktree) => worktree.path),
    ["/Users/you/repo"],
  );
});
