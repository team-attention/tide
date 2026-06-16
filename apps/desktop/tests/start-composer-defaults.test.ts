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

test("with no remembered preference a new thread falls back to codex/gpt-5.5", () => {
  setPreferredStartComposer(null);
  const state = startNewProductShellThread(createProductShellState({ includeFixtureData: false }));
  const startOptions = state.agentChat.composer.startOptions;
  assert.equal(startOptions.agentBinding.agentId, "codex");
  assert.equal(startOptions.launchOptions?.model, "gpt-5.5");
});

test("preferredStartComposerFromState captures an opencode Start Composer pick", () => {
  // Regression: the SAVE-side guard once dropped opencode (and gemini), so a picked
  // opencode model was never persisted for the next New Thread.
  const state = startComposerStateWith("opencode", {
    model: "openai/gpt-5.5",
    permission: "build",
    reasoning: "high",
    worktree: "current folder",
  });
  assert.deepEqual(preferredStartComposerFromState(state), {
    agentId: "opencode",
    model: "openai/gpt-5.5",
    permission: "build",
    reasoning: "high",
  });
  setPreferredStartComposer(null);
});

test("preferredStartComposerFromState captures a gemini pick", () => {
  const pref = preferredStartComposerFromState(
    startComposerStateWith("gemini", { model: "gemini-3-pro-preview", permission: "default" }),
  );
  assert.equal(pref?.agentId, "gemini");
  assert.equal(pref?.model, "gemini-3-pro-preview");
  setPreferredStartComposer(null);
});

test("preferredStartComposerFromState ignores a focused thread (nothing to remember)", () => {
  const state: ProductShellState = {
    ...startComposerStateWith("opencode", { model: "openai/gpt-5.5" }),
    activeThreadId: "t-1",
  };
  assert.equal(preferredStartComposerFromState(state), null);
  setPreferredStartComposer(null);
});

test("preferredStartComposerFromState rejects an unknown agent", () => {
  assert.equal(preferredStartComposerFromState(startComposerStateWith("bogus", { model: "x" })), null);
  setPreferredStartComposer(null);
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
