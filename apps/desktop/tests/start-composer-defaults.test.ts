import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductShellState,
  setProductShellRegisteredProjects,
  startNewProductShellThread,
  setPreferredStartComposer,
  preferredStartComposerFromState,
  type ProductShellAgentIdentity,
  type ProductShellState,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

// Build a Start Composer state (activeThreadId null) whose composer is set to the
// given agent + launch options — so the SAVE-side capture decision can be tested
// without mounting the React effect that calls it.
function startComposerStateWith(
  agentId: string,
  launchOptions: Record<string, unknown>,
): ProductShellState {
  setPreferredStartComposer(null);
  const base = startNewProductShellThread(createProductShellState({ includeFixtureData: false }));
  const composer = base.agentChat.composer;
  return {
    ...base,
    agentChat: {
      ...base.agentChat,
      composer: {
        ...composer,
        startOptions: {
          ...composer.startOptions,
          agentBinding: { ...composer.startOptions.agentBinding, agentId: agentId as ProductShellAgentIdentity },
          launchOptions,
        },
      },
    },
  };
}

// Spec: the Start Composer remembers the last-used agent + model so the next New
// Thread defaults to it. Module-level preference is set by the Desktop adapter
// from persisted storage; reset to null after each test so it can't leak.

test("a new thread defaults to the remembered agent and model", () => {
  setPreferredStartComposer({ agentId: "claude", model: "claude-opus-4-8", permission: "default" });
  try {
    const state = startNewProductShellThread(createProductShellState({ includeFixtureData: false }));
    const startOptions = state.agentChat.composer.startOptions;
    assert.equal(startOptions.agentBinding.agentId, "claude");
    assert.equal(startOptions.launchOptions?.model, "claude-opus-4-8");
    assert.equal(startOptions.launchOptions?.permission, "default");
  } finally {
    setPreferredStartComposer(null);
  }
});

test("a new thread defaults to the remembered worktree environment", () => {
  setPreferredStartComposer({
    agentId: "codex",
    model: "gpt-5.5",
    permission: "default",
    worktree: "new",
  });
  try {
    const registered = setProductShellRegisteredProjects(
      createProductShellState({ includeFixtureData: false }),
      [{ projectId: "repo", name: "repo", cwd: "/repo" }],
    );
    const state = startNewProductShellThread(registered, "repo");
    const launch = state.agentChat.composer.startOptions.launchOptions;
    assert.equal(launch?.worktree, "new");
    assert.equal(launch?.branch, "main");
    assert.equal(launch?.newWorktreeName, undefined);
  } finally {
    setPreferredStartComposer(null);
  }
});

test("a new thread defaults to the remembered local environment", () => {
  setPreferredStartComposer({
    agentId: "codex",
    model: "gpt-5.5",
    permission: "default",
    worktree: "current folder",
  });
  try {
    const registered = setProductShellRegisteredProjects(
      createProductShellState({ includeFixtureData: false }),
      [{ projectId: "repo", name: "repo", cwd: "/repo" }],
    );
    const state = startNewProductShellThread(registered, "repo");
    assert.equal(state.agentChat.composer.startOptions.launchOptions?.worktree, "current folder");
    assert.equal(state.agentChat.composer.startOptions.launchOptions?.branch, "main");
  } finally {
    setPreferredStartComposer(null);
  }
});

test("remembered_new_worktree_falls_back_to_local_without_project_scope", () => {
  setPreferredStartComposer({
    agentId: "codex",
    model: "gpt-5.5",
    permission: "default",
    worktree: "new",
  });
  try {
    const state = startNewProductShellThread(createProductShellState({ includeFixtureData: false }));
    assert.equal(state.agentChat.composer.startOptions.scope?.kind, "scratch");
    assert.equal(state.agentChat.composer.startOptions.launchOptions?.worktree, "current folder");
    assert.equal(state.agentChat.composer.startOptions.launchOptions?.branch, "main");
  } finally {
    setPreferredStartComposer(null);
  }
});

test("existing_worktree_paths_are_not_restored_as_global_start_defaults", () => {
  // Spec: docs_v2/specs/worktree-start-experience.md D7. Existing worktree paths
  // are repo-scoped, so persisting/restoring them globally can start a Thread in
  // the wrong repository.
  setPreferredStartComposer({
    agentId: "codex",
    model: "gpt-5.5",
    permission: "default",
    worktree: "/repo-a.worktree/fix-login",
  });
  try {
    const registered = setProductShellRegisteredProjects(
      createProductShellState({ includeFixtureData: false }),
      [{ projectId: "repo-b", name: "repo-b", cwd: "/repo-b" }],
    );
    const state = startNewProductShellThread(registered, "repo-b");
    assert.equal(state.agentChat.composer.startOptions.launchOptions?.worktree, "current folder");
  } finally {
    setPreferredStartComposer(null);
  }
});

test("with no remembered preference a new thread falls back to codex/gpt-5.5", () => {
  setPreferredStartComposer(null);
  const state = startNewProductShellThread(createProductShellState({ includeFixtureData: false }));
  const startOptions = state.agentChat.composer.startOptions;
  assert.equal(startOptions.agentBinding.agentId, "codex");
  assert.equal(startOptions.launchOptions?.model, "gpt-5.5");
});

test("preferredStartComposerFromState captures an opencode Start Composer pick", () => {
  // Regression: the SAVE-side guard once dropped opencode, so a picked
  // opencode model was never persisted for the next New Thread.
  const state = startComposerStateWith("opencode", {
    model: "openai/gpt-5.5",
    permission: "build",
    reasoning: "high",
    worktree: "current folder",
    branch: undefined,
  });
  assert.deepEqual(preferredStartComposerFromState(state), {
    agentId: "opencode",
    model: "openai/gpt-5.5",
    permission: "build",
    reasoning: "high",
    worktree: "current folder",
  });
  setPreferredStartComposer(null);
});

test("preferredStartComposerFromState normalizes an existing worktree path to Local", () => {
  const state = startComposerStateWith("codex", {
    model: "gpt-5.5",
    permission: "default",
    worktree: "/repo.worktree/fix-login",
  });
  assert.equal(preferredStartComposerFromState(state)?.worktree, "current folder");
  setPreferredStartComposer(null);
});

test("preferredStartComposerFromState ignores a focused thread (nothing to remember)", () => {
  // A real focused thread has agentChat.thread set (the chat shows its transcript). That
  // is the "not composing" signal — NOT activeThreadId, which the Composer's Draft Thread
  // also sets while the user is still composing. See docs_v2/specs/composer-draft-thread.md.
  const base = startComposerStateWith("opencode", { model: "openai/gpt-5.5" });
  const state: ProductShellState = {
    ...base,
    activeThreadId: "t-1",
    agentChat: {
      ...base.agentChat,
      thread: {
        threadId: "t-1",
        title: "Focused",
        agentBinding: base.agentChat.composer.startOptions.agentBinding,
        scope: base.agentChat.composer.startOptions.scope,
        launchOptions: base.agentChat.composer.startOptions.launchOptions,
        createdAt: "2026-06-16T00:00:00.000Z",
        updatedAt: "2026-06-16T00:00:00.000Z",
        pinned: false,
        archived: false,
        lastKnownState: "running",
      },
    },
  };
  assert.equal(preferredStartComposerFromState(state), null);
  setPreferredStartComposer(null);
});

test("preferredStartComposerFromState still remembers while a Draft Thread is active", () => {
  // Composing with a backend Draft Thread: activeThreadId is the draft, but the chat has no
  // thread yet (still the start Composer) — so the agent/model preference must persist.
  const base = startComposerStateWith("opencode", { model: "openai/gpt-5.5" });
  const state: ProductShellState = { ...base, activeThreadId: "draft-1", draftThreadId: "draft-1" };
  assert.equal(preferredStartComposerFromState(state)?.agentId, "opencode");
  setPreferredStartComposer(null);
});

test("preferredStartComposerFromState rejects an unknown agent", () => {
  assert.equal(preferredStartComposerFromState(startComposerStateWith("bogus", { model: "x" })), null);
  setPreferredStartComposer(null);
});

test("a new thread defaults to a real project, never a worktree directory", () => {
  // Spec: project-open-folder-registry D6 / Inv-5. A worktree registers as a Project
  // (for the Left Rail) but must not be the default start scope, or the composer's
  // Project chip would read a worktree dir. The real repo project is preferred even
  // when the worktree is listed first.
  setPreferredStartComposer(null);
  const registered = setProductShellRegisteredProjects(
    createProductShellState({ includeFixtureData: false }),
    [
      { projectId: "wt", name: "feature", cwd: "/repo.worktree/feature" },
      { projectId: "repo", name: "repo", cwd: "/repo" },
    ],
  );
  const state = startNewProductShellThread(registered);
  const scope = state.agentChat.composer.startOptions.scope;
  assert.equal(scope?.kind, "project");
  assert.equal(scope?.kind === "project" ? scope.cwd : null, "/repo");
});

test("a new thread falls back to a worktree only when there is no real project", () => {
  // Conservative fallback: if every registered Project is a worktree, the new Thread
  // still starts in a folder the user has (not Scratch).
  setPreferredStartComposer(null);
  const registered = setProductShellRegisteredProjects(
    createProductShellState({ includeFixtureData: false }),
    [{ projectId: "wt", name: "feature", cwd: "/repo.worktree/feature" }],
  );
  const state = startNewProductShellThread(registered);
  const scope = state.agentChat.composer.startOptions.scope;
  assert.equal(scope?.kind, "project");
  assert.equal(scope?.kind === "project" ? scope.cwd : null, "/repo.worktree/feature");
});

test("starting in a freshly-added (threadless) project scopes the composer to its directory", () => {
  setPreferredStartComposer(null);
  // A registered project with no threads yet (added via the folder picker) lives in
  // registeredProjects, not the thread-derived projects list.
  const registered = setProductShellRegisteredProjects(
    createProductShellState({ includeFixtureData: false }),
    [{ projectId: "p-new", name: "new-proj", cwd: "/repo/new-proj" }],
  );
  const state = startNewProductShellThread(registered, "p-new");
  const scope = state.agentChat.composer.startOptions.scope;
  assert.equal(scope?.kind, "project");
  assert.equal(scope?.kind === "project" ? scope.cwd : null, "/repo/new-proj");
  assert.equal(scope?.kind === "project" ? scope.projectId : null, "p-new");
  // …and it shows as the New Thread composer (no active thread).
  assert.equal(state.activeThreadId, null);
});
