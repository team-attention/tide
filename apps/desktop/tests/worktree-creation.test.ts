// Spec: docs_v2/specs/worktree-creation.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  computeWorktreePath,
  sanitizeWorktreeBranch,
  worktreeAddArgs,
  worktreeRemoveArgs,
  branchDeleteArgs,
  branchMergedArgs,
  worktreeDeleteRequest,
  worktreeRepoRootForCwd,
} from "../src/shared/worktree/path.ts";
import {
  createProductShellState,
  createProductShellViewModel,
  startProductShellWorktreeCreate,
  cancelProductShellWorktreeCreate,
  setProductShellWorktreeSettings,
  setProductShellSettingsOpen,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

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

test("derives_repo_root_from_a_worktree_cwd", () => {
  // Inverse of the default rule, used to group worktree Projects under their repo.
  assert.equal(worktreeRepoRootForCwd("/Users/me/repo.worktree/feature-login"), "/Users/me/repo");
  assert.equal(worktreeRepoRootForCwd("/Users/me/repo"), null);
});

test("worktree_create_git_args_include_base_branch", () => {
  // Spec: docs_v2/specs/worktree-start-experience.md D4 — an optional base branch
  // is appended as the `git worktree add` start point; omitted args branch off HEAD.
  assert.deepEqual(
    worktreeAddArgs({ repoCwd: "/repo", branch: "fix-login", worktreePath: "/repo.worktree/fix-login" }),
    ["-C", "/repo", "worktree", "add", "-b", "fix-login", "/repo.worktree/fix-login"],
  );
  assert.deepEqual(
    worktreeAddArgs({
      repoCwd: "/repo",
      branch: "fix-login",
      worktreePath: "/repo.worktree/fix-login",
      baseBranch: "develop",
    }),
    ["-C", "/repo", "worktree", "add", "-b", "fix-login", "/repo.worktree/fix-login", "develop"],
  );
  // A blank base branch is treated as "off HEAD" (no trailing arg).
  assert.deepEqual(
    worktreeAddArgs({ repoCwd: "/repo", branch: "x", worktreePath: "/p", baseBranch: "  " }),
    ["-C", "/repo", "worktree", "add", "-b", "x", "/p"],
  );
});

// --- Deletion: docs_v2/specs/worktree-branch-deletion.md ---

test("worktree_remove_args_force_remove_the_path", () => {
  assert.deepEqual(
    worktreeRemoveArgs("/repo", "/repo.worktree/fix-login"),
    ["-C", "/repo", "worktree", "remove", "--force", "/repo.worktree/fix-login"],
  );
});

test("branch_delete_args_use_force_flag_only_when_forced", () => {
  // D3: merged branch → `-d` (safe); unmerged + acknowledged → `-D` (force).
  assert.deepEqual(branchDeleteArgs("/repo", "fix-login", false), [
    "-C", "/repo", "branch", "-d", "fix-login",
  ]);
  assert.deepEqual(branchDeleteArgs("/repo", "fix-login", true), [
    "-C", "/repo", "branch", "-D", "fix-login",
  ]);
});

test("branch_merged_args_test_ancestor_of_head", () => {
  assert.deepEqual(branchMergedArgs("/repo", "fix-login"), [
    "-C", "/repo", "merge-base", "--is-ancestor", "fix-login", "HEAD",
  ]);
});

test("worktree_delete_request_forces_only_for_unmerged_branch", () => {
  // D2: default (keepBranch=false) deletes the branch.
  // D3: force is requested ONLY when deleting an unmerged branch — never else.
  assert.deepEqual(worktreeDeleteRequest({ keepBranch: false, branchMerged: true }), {
    deleteBranch: true,
    force: false,
  });
  assert.deepEqual(worktreeDeleteRequest({ keepBranch: false, branchMerged: false }), {
    deleteBranch: true,
    force: true,
  });
  // Keep-branch never deletes and never forces, regardless of merge state.
  assert.deepEqual(worktreeDeleteRequest({ keepBranch: true, branchMerged: false }), {
    deleteBranch: false,
    force: false,
  });
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

// --- Worktree settings (Desktop) ---

test("worktree_settings_patch_and_settings_panel_toggle", () => {
  const base = createProductShellState({ includeFixtureData: false });
  assert.equal(base.settingsOpen, false);
  assert.deepEqual(base.worktreeSettings, { baseDirPattern: "", copyFiles: [] });

  const opened = setProductShellSettingsOpen(base, true);
  assert.equal(opened.settingsOpen, true);
  assert.equal(createProductShellViewModel(opened).settingsOpen, true);

  const patched = setProductShellWorktreeSettings(opened, {
    baseDirPattern: "{repo_root}/.worktrees/{branch}",
    copyFiles: [".env"],
  });
  assert.equal(patched.worktreeSettings.baseDirPattern, "{repo_root}/.worktrees/{branch}");
  assert.deepEqual(patched.worktreeSettings.copyFiles, [".env"]);
  assert.deepEqual(
    createProductShellViewModel(patched).worktreeSettings.copyFiles,
    [".env"],
  );
});
