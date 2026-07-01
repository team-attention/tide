// Spec: docs_v2/specs/worktree-start-experience.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductShellState,
  localBranchCheckoutRequest,
  planLocalBranchCheckout,
  setProductShellRegisteredProjects,
  startNewProductShellThread,
  type ProductShellState,
  type ProductShellThread,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import { branchCheckoutArgs } from "../src/shared/worktree/path.ts";

function localStartState(options: {
  branch?: string;
  worktree?: string;
  threads?: ProductShellThread[];
} = {}): ProductShellState {
  const registered = setProductShellRegisteredProjects(
    createProductShellState({ includeFixtureData: false }),
    [{ projectId: "repo", name: "repo", cwd: "/repo" }],
  );
  const scoped = startNewProductShellThread(registered, "repo");
  return {
    ...scoped,
    threads: options.threads ?? [],
    agentChat: {
      ...scoped.agentChat,
      composer: {
        ...scoped.agentChat.composer,
        startOptions: {
          ...scoped.agentChat.composer.startOptions,
          launchOptions: {
            worktree: options.worktree ?? "current folder",
            ...(options.branch !== undefined ? { branch: options.branch } : {}),
          },
        },
      },
    },
  };
}

function runningThread(cwd: string): ProductShellThread {
  return {
    threadId: "running-thread",
    title: "running",
    agentId: "codex",
    time: "now",
    scope: { kind: "project", projectId: "repo", cwd },
    launchOptions: { branch: "feature-x", worktree: "current folder" },
    workbenchPanes: [],
    running: true,
  };
}

test("local_branch_checkout_plan_switches_current_folder_before_start", () => {
  const state = localStartState({ branch: "main" });
  const request = localBranchCheckoutRequest(state);
  assert.deepEqual(request, { cwd: "/repo", branch: "main" });

  const plan = planLocalBranchCheckout({
    state,
    request: request!,
    gitContext: {
      isGitRepo: true,
      currentBranch: "feature-x",
      branches: [
        { name: "main", kind: "local", current: false },
        { name: "feature-x", kind: "local", current: true },
      ],
    },
  });

  assert.equal(plan.kind, "checkout");
  assert.equal(plan.kind === "checkout" ? plan.target.branch : null, "main");
});

test("local_branch_checkout_plan_warns_when_running_thread_shares_cwd", () => {
  const state = localStartState({
    branch: "main",
    threads: [runningThread("/repo")],
  });
  const request = localBranchCheckoutRequest(state);
  assert.notEqual(request, null);

  const plan = planLocalBranchCheckout({
    state,
    request: request!,
    gitContext: {
      isGitRepo: true,
      currentBranch: "feature-x",
      branches: [
        { name: "main", kind: "local", current: false },
        { name: "feature-x", kind: "local", current: true },
      ],
    },
  });

  assert.equal(plan.kind, "warn_running");
  assert.equal(plan.kind === "warn_running" ? plan.target.runningThreadCount : 0, 1);

  const confirmed = planLocalBranchCheckout({
    state,
    request: request!,
    allowRunningCheckout: true,
    gitContext: {
      isGitRepo: true,
      currentBranch: "feature-x",
      branches: [
        { name: "main", kind: "local", current: false },
        { name: "feature-x", kind: "local", current: true },
      ],
    },
  });
  assert.equal(confirmed.kind, "checkout");
});

test("local_branch_checkout_plan_blocks_remote_only_branch", () => {
  const state = localStartState({ branch: "origin/main" });
  const request = localBranchCheckoutRequest(state);
  assert.notEqual(request, null);

  const plan = planLocalBranchCheckout({
    state,
    request: request!,
    gitContext: {
      isGitRepo: true,
      currentBranch: "feature-x",
      branches: [
        { name: "origin/main", kind: "remote", current: false },
        { name: "feature-x", kind: "local", current: true },
      ],
    },
  });

  assert.equal(plan.kind, "blocked");
  assert.match(plan.kind === "blocked" ? plan.target.error ?? "" : "", /not a local branch/);
});

test("local_branch_checkout_request_ignores_new_or_existing_worktree_starts", () => {
  assert.equal(localBranchCheckoutRequest(localStartState({ branch: "main", worktree: "new" })), null);
  assert.equal(
    localBranchCheckoutRequest(localStartState({ branch: "main", worktree: "/repo.worktree/main" })),
    null,
  );
});

test("branch_checkout_args_switch_to_branch", () => {
  assert.deepEqual(branchCheckoutArgs("/repo", "main"), ["-C", "/repo", "switch", "main"]);
});
