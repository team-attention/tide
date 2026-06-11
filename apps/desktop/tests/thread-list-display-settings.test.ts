// Spec: docs_v2/specs/thread-list-display-settings.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductShellState,
  createProductShellViewModel,
  setProductShellListSettings,
  DEFAULT_PRODUCT_SHELL_LIST_SETTINGS,
  type ProductShellState,
  type ProductShellThread,
} from "../src/desktop/application/domains/product-shell/product-shell-state.ts";

function thread(
  threadId: string,
  title: string,
  overrides: Partial<ProductShellThread> = {},
): ProductShellThread {
  return {
    threadId,
    title,
    agentId: "codex",
    time: "1h",
    scope: { kind: "project", projectId: "p1", cwd: "/repo" },
    workbenchPanes: [],
    ...overrides,
  };
}

function stateWith(
  threads: ProductShellThread[],
  listSettings?: Partial<ProductShellState["listSettings"]>,
): ProductShellState {
  const base = createProductShellState({ includeFixtureData: false });
  return {
    ...base,
    projects: [
      { projectId: "p1", name: "repo", cwd: "/repo" },
      { projectId: "p2", name: "other", cwd: "/other" },
    ],
    threads,
    listSettings: { ...base.listSettings, ...listSettings },
  };
}

// --- UC-1: Group Mode ---

test("thread_group_mode_lists_all_threads_flat", () => {
  // UC-1 BR-1: "thread" mode yields a flat list of every thread, no grouping.
  const state = stateWith(
    [
      thread("t1", "Alpha", { scope: { kind: "project", projectId: "p1", cwd: "/repo" } }),
      thread("t2", "Beta", { scope: { kind: "project", projectId: "p2", cwd: "/other" } }),
      thread("t3", "Gamma", { scope: { kind: "scratch", scratchCwd: "Scratch" } }),
    ],
    { groupBy: "thread" },
  );

  const vm = createProductShellViewModel(state);
  assert.equal(vm.listSettings.groupBy, "thread");
  assert.deepEqual(
    vm.flatThreads.map((t) => t.threadId).sort(),
    ["t1", "t2", "t3"],
  );
});

test("external_sessions_are_hidden_by_default_and_shown_when_enabled", () => {
  // Default list = Threads started in Tide. Adopted (external) sessions Tide did
  // not start stay hidden until the user enables them in the list-config menu.
  const threads = [
    thread("t1", "Tide thread", { scope: { kind: "project", projectId: "p1", cwd: "/repo" } }),
    thread("adopted-sess-1", "External", {
      scope: { kind: "project", projectId: "p1", cwd: "/repo" },
    }),
  ];

  const hidden = createProductShellViewModel(stateWith(threads, { groupBy: "thread" }));
  assert.deepEqual(hidden.flatThreads.map((t) => t.threadId), ["t1"]);

  const shown = createProductShellViewModel(
    stateWith(threads, { groupBy: "thread", showExternalSessions: true }),
  );
  assert.deepEqual(
    shown.flatThreads.map((t) => t.threadId).sort(),
    ["adopted-sess-1", "t1"],
  );
});

test("project_group_mode_buckets_threads_by_project", () => {
  // UC-1 BR-2: "project" mode (default) buckets threads under their project.
  const state = stateWith([
    thread("t1", "Alpha", { scope: { kind: "project", projectId: "p1", cwd: "/repo" } }),
    thread("t2", "Beta", { scope: { kind: "project", projectId: "p2", cwd: "/other" } }),
  ]);

  const vm = createProductShellViewModel(state);
  assert.equal(vm.listSettings.groupBy, "project");
  const p1 = vm.projectGroups.find((g) => g.projectId === "p1");
  const p2 = vm.projectGroups.find((g) => g.projectId === "p2");
  assert.deepEqual(p1?.threads.map((t) => t.threadId), ["t1"]);
  assert.deepEqual(p2?.threads.map((t) => t.threadId), ["t2"]);
});

// --- UC-2: Sort ---

test("recent_sort_orders_threads_by_last_activity", () => {
  // UC-2 BR-3: "recent" orders newest updatedAt first.
  const state = stateWith(
    [
      thread("old", "Old", { updatedAt: "2026-01-01T00:00:00.000Z" }),
      thread("new", "New", { updatedAt: "2026-06-01T00:00:00.000Z" }),
      thread("mid", "Mid", { updatedAt: "2026-03-01T00:00:00.000Z" }),
    ],
    { groupBy: "thread", sortBy: "recent" },
  );

  const vm = createProductShellViewModel(state);
  assert.deepEqual(vm.flatThreads.map((t) => t.threadId), ["new", "mid", "old"]);
});

test("name_sort_orders_threads_alphabetically", () => {
  // UC-2 BR-4: "name" orders threads A–Z by title.
  const state = stateWith(
    [
      thread("c", "Charlie"),
      thread("a", "alpha"),
      thread("b", "Bravo"),
    ],
    { groupBy: "thread", sortBy: "name" },
  );

  const vm = createProductShellViewModel(state);
  assert.deepEqual(vm.flatThreads.map((t) => t.threadId), ["a", "b", "c"]);
});

// --- UC-3: Group worktrees by repo ---

test("worktree_projects_group_under_their_repo_when_enabled", () => {
  // UC-3 BR-5: with groupWorktreesByRepo on, a worktree Project's threads bucket
  // under its repo Project and the worktree Project is hidden from the top level.
  const base = createProductShellState({ includeFixtureData: false });
  const state: ProductShellState = {
    ...base,
    projects: [
      { projectId: "repo", name: "repo", cwd: "/repo" },
      { projectId: "wt", name: "feature", cwd: "/repo.worktree/feature" },
    ],
    threads: [
      thread("t-repo", "Repo thread", {
        scope: { kind: "project", projectId: "repo", cwd: "/repo" },
      }),
      thread("t-wt", "Worktree thread", {
        scope: { kind: "project", projectId: "wt", cwd: "/repo.worktree/feature" },
      }),
    ],
    listSettings: { ...base.listSettings, groupWorktreesByRepo: true },
  };

  const vm = createProductShellViewModel(state);
  // Only the repo Project shows at top level (the worktree Project is folded in).
  assert.deepEqual(vm.projectGroups.map((g) => g.projectId), ["repo"]);
  const repo = vm.projectGroups.find((g) => g.projectId === "repo");
  assert.deepEqual(repo?.threads.map((t) => t.threadId).sort(), ["t-repo", "t-wt"]);

  // With the setting off, the worktree Project is its own top-level group.
  const off = createProductShellViewModel({
    ...state,
    listSettings: { ...state.listSettings, groupWorktreesByRepo: false },
  });
  assert.deepEqual(off.projectGroups.map((g) => g.projectId).sort(), ["repo", "wt"]);
});

test("worktree_threads_group_under_repo_by_default", () => {
  // Spec: docs_v2/specs/worktree-start-experience.md D5 — the default flips on, so
  // a worktree Thread nests under its repo group (not a separate top-level Project)
  // and its view carries the branch badge derived from the worktree cwd.
  assert.equal(DEFAULT_PRODUCT_SHELL_LIST_SETTINGS.groupWorktreesByRepo, true);

  const base = createProductShellState({ includeFixtureData: false });
  const state: ProductShellState = {
    ...base,
    projects: [
      { projectId: "repo", name: "repo", cwd: "/repo" },
      { projectId: "wt", name: "feature", cwd: "/repo.worktree/feature-login" },
    ],
    threads: [
      thread("t-repo", "Repo thread", {
        scope: { kind: "project", projectId: "repo", cwd: "/repo" },
      }),
      thread("t-wt", "Worktree thread", {
        scope: { kind: "project", projectId: "wt", cwd: "/repo.worktree/feature-login" },
      }),
    ],
    // No listSettings override: rely on the default.
  };

  const vm = createProductShellViewModel(state);
  assert.deepEqual(vm.projectGroups.map((g) => g.projectId), ["repo"]);
  const repo = vm.projectGroups.find((g) => g.projectId === "repo");
  assert.deepEqual(repo?.threads.map((t) => t.threadId).sort(), ["t-repo", "t-wt"]);

  const worktreeView = repo?.threads.find((t) => t.threadId === "t-wt");
  assert.equal(worktreeView?.worktreeBranch, "feature-login");
  const repoView = repo?.threads.find((t) => t.threadId === "t-repo");
  assert.equal(repoView?.worktreeBranch, undefined);
});

test("setting_list_settings_patches_only_given_fields", () => {
  const state = stateWith([thread("t1", "A")]);
  const next = setProductShellListSettings(state, { sortBy: "name" });
  assert.equal(next.listSettings.sortBy, "name");
  assert.equal(next.listSettings.groupBy, "project");
});
