// Spec: docs_v2/specs/worktree-creation.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  computeWorktreePath,
  sanitizeWorktreeBranch,
} from "../src/shared/worktree-path.ts";
import {
  createProductShellState,
  createProductShellViewModel,
  startProductShellWorktreeCreate,
  cancelProductShellWorktreeCreate,
} from "../src/desktop/application/domains/product-shell/product-shell-state.ts";

// --- UC-1: Worktree Path Rule ---

test("computes_default_worktree_path_as_repo_sibling", () => {
  // UC-1 BR-1: default is `{repo_root}.worktree/{branch}`, branch / -> -.
  assert.equal(
    computeWorktreePath("/Users/me/repo", "feature/login"),
    "/Users/me/repo.worktree/feature-login",
  );
  assert.equal(sanitizeWorktreeBranch("a/b/c"), "a-b-c");
  // A trailing slash on the root doesn't double up.
  assert.equal(
    computeWorktreePath("/Users/me/repo/", "fix"),
    "/Users/me/repo.worktree/fix",
  );
});

test("applies_configured_worktree_path_pattern", () => {
  // UC-1 BR-2: base_dir_pattern overrides with {repo_root}/{branch} placeholders.
  assert.equal(
    computeWorktreePath("/Users/me/repo", "feature/login", {
      baseDirPattern: "{repo_root}/.worktrees/{branch}",
    }),
    "/Users/me/repo/.worktrees/feature-login",
  );
});

// --- UC-3: Inline worktree name input (Desktop) ---

test("opening_worktree_create_marks_the_project_row_for_a_name_input", () => {
  const base = createProductShellState({ includeFixtureData: false });
  const state = {
    ...base,
    projects: [{ projectId: "p1", name: "repo", cwd: "/repo" }],
  };
  const opened = startProductShellWorktreeCreate(state, "p1");
  assert.equal(opened.creatingWorktreeForProjectId, "p1");
  const group = createProductShellViewModel(opened).projectGroups.find((g) => g.projectId === "p1");
  assert.equal(group?.creatingWorktree, true);

  const cancelled = cancelProductShellWorktreeCreate(opened);
  assert.equal(cancelled.creatingWorktreeForProjectId, null);
});
