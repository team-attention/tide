import type { ProductShellState, ProductShellThread } from "./types.ts";

// Pure decision rules for aligning a Start Composer "Local + Branch" selection with
// the actual git checkout before the Thread starts.

export interface LocalBranchGitContext {
  isGitRepo: boolean;
  currentBranch: string | null;
  branches: { name: string; kind: "local" | "remote"; current: boolean }[];
}

export interface LocalBranchCheckoutRequest {
  cwd: string;
  branch: string;
}

export interface LocalBranchCheckoutTarget extends LocalBranchCheckoutRequest {
  currentBranch: string | null;
  runningThreadCount: number;
  error?: string;
}

export type LocalBranchCheckoutPlan =
  | { kind: "none" }
  | { kind: "checkout"; target: LocalBranchCheckoutTarget }
  | { kind: "warn_running"; target: LocalBranchCheckoutTarget }
  | { kind: "blocked"; target: LocalBranchCheckoutTarget };

export function localBranchCheckoutRequest(
  state: ProductShellState,
): LocalBranchCheckoutRequest | null {
  if (state.agentChat.thread !== null) {
    return null;
  }
  const scope = state.agentChat.composer.startOptions.scope;
  if (scope?.kind !== "project") {
    return null;
  }
  const launchOptions = state.agentChat.composer.startOptions.launchOptions ?? {};
  const worktree = launchOptions.worktree;
  if (
    typeof worktree === "string" &&
    worktree.length > 0 &&
    worktree !== "current folder"
  ) {
    return null;
  }
  const branch = typeof launchOptions.branch === "string"
    ? launchOptions.branch.trim()
    : "";
  return branch.length > 0 ? { cwd: scope.cwd, branch } : null;
}

export function planLocalBranchCheckout(input: {
  state: ProductShellState;
  request: LocalBranchCheckoutRequest;
  gitContext: LocalBranchGitContext;
  allowRunningCheckout?: boolean;
}): LocalBranchCheckoutPlan {
  const { request, gitContext } = input;
  if (!gitContext.isGitRepo || gitContext.currentBranch === request.branch) {
    return { kind: "none" };
  }

  const runningThreadCount = runningThreadsInCwd(input.state, request.cwd).length;
  const target: LocalBranchCheckoutTarget = {
    ...request,
    currentBranch: gitContext.currentBranch,
    runningThreadCount,
  };

  const localBranch = gitContext.branches.find(
    (branch) => branch.name === request.branch && branch.kind === "local",
  );
  if (localBranch === undefined) {
    return {
      kind: "blocked",
      target: {
        ...target,
        error: `Branch "${request.branch}" is not a local branch in this folder.`,
      },
    };
  }

  if (runningThreadCount > 0 && input.allowRunningCheckout !== true) {
    return { kind: "warn_running", target };
  }

  return { kind: "checkout", target };
}

function runningThreadsInCwd(
  state: ProductShellState,
  cwd: string,
): ProductShellThread[] {
  return state.threads.filter((thread) => {
    if (thread.running !== true || thread.scope.kind !== "project") {
      return false;
    }
    return sameCwd(thread.scope.cwd, cwd);
  });
}

function sameCwd(left: string, right: string): boolean {
  return normalizeCwd(left) === normalizeCwd(right);
}

function normalizeCwd(value: string): string {
  return value.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
}
