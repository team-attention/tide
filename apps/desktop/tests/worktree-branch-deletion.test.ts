// Spec: docs_v2/specs/worktree-branch-deletion.md
import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  WorktreeDeleteDialog,
  type WorktreeDeleteTarget,
} from "../src/desktop/adapters/inbound/react-renderer/tide-product-shell.ts";

function render(target: WorktreeDeleteTarget): string {
  return renderToStaticMarkup(
    createElement(WorktreeDeleteDialog, { target, onConfirm: () => {}, onClose: () => {} }),
  );
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
