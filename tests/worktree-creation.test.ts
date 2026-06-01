// Spec: docs_v2/specs/worktree-creation.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  computeWorktreePath,
  sanitizeWorktreeBranch,
} from "../src/backend/application/domains/worktree/worktree-path.ts";

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
