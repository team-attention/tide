import type { AgentChatShellState, AgentChatShellUpdateResult, AgentChatStartOptions, AgentChatThreadScope, AgentChatWorktreeOption } from "./types.ts";
import { basenameOf } from "./path-labels.ts";
// Extracted from agent-chat-shell-state.ts (spec: navigable-source-structure).

export function launchOptionsForState(
  state: AgentChatShellState,
): Record<string, unknown> | undefined {
  return state.thread ? state.thread.launchOptions : state.composer.startOptions.launchOptions;
}

// The Environment chip label. A pending "create on send" intent (worktree === "new")
// renders as a new-worktree state, so the chip never shows the raw sentinel.
// Existing worktree paths compact to their branch or basename while the underlying
// launch option keeps the absolute path.
export function environmentContextValue(
  options: AgentChatStartOptions,
  worktrees: AgentChatWorktreeOption[],
): string {
  const launchOptions = options.launchOptions;
  const worktree = launchOptions?.worktree;
  if (worktree === "new") {
    const typed = launchOptions?.newWorktreeName;
    const name = typeof typed === "string" ? typed.trim() : "";
    return name.length > 0 ? `New worktree: ${name}` : "New worktree";
  }
  if (typeof worktree === "string" && worktree !== "current folder" && worktree.length > 0) {
    const existing = worktrees.find((entry) => entry.path === worktree);
    return existing?.branch ?? basenameOf(worktree);
  }
  return "Local";
}

// The Launch Option keys that affect a running Agent Runtime — a mid-thread
// change to these is sent to the backend (thread.setLaunchOptions) so it
// actually applies. Worktree/branch stay Start-Composer-local.
const RUNTIME_LAUNCH_OPTION_KEYS: ReadonlySet<string> = new Set([
  "model",
  "permission",
  "reasoning",
]);

export function updateComposerLaunchOptions(
  state: AgentChatShellState,
  patch: Record<string, unknown>,
): AgentChatShellUpdateResult {
  // For an active thread the launch options live on the thread (that's what
  // launchOptionsForState reads), so the chip updates optimistically here; the
  // backend command below persists the change and applies it to the live
  // runtime. See docs_v2/specs/mid-thread-launch-option-changes.md.
  const mergedThreadOptions = state.thread
    ? { ...state.thread.launchOptions, ...patch }
    : undefined;
  const sendToBackend =
    state.thread !== undefined &&
    state.thread !== null &&
    mergedThreadOptions !== undefined &&
    Object.keys(patch).some((key) => RUNTIME_LAUNCH_OPTION_KEYS.has(key));
  return {
    state: {
      ...state,
      thread:
        state.thread && mergedThreadOptions !== undefined
          ? { ...state.thread, launchOptions: mergedThreadOptions }
          : state.thread,
      composer: {
        ...state.composer,
        activeSurface: null,
        startOptions: {
          ...state.composer.startOptions,
          launchOptions: {
            ...state.composer.startOptions.launchOptions,
            ...patch,
          },
        },
      },
    },
    command:
      sendToBackend && state.thread
        ? {
            kind: "thread.setLaunchOptions",
            payload: {
              threadId: state.thread.threadId,
              launchOptions: mergedThreadOptions ?? {},
            },
          }
        : null,
  };
}

export function updateComposerScope(
  state: AgentChatShellState,
  scope: AgentChatThreadScope,
): AgentChatShellUpdateResult {
  if (state.thread) {
    return { state, command: null };
  }

  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        activeSurface: null,
        startOptions: {
          ...state.composer.startOptions,
          scope,
        },
      },
    },
    command: null,
  };
}

// Scopes the Start Composer to a folder picked via the chip's "Open folder"
// action WITHOUT registering it as a persisted project. The folder only becomes
// a left-list Project once a Thread is actually started in it (thread-derived).
export function setComposerFolderScope(
  state: AgentChatShellState,
  cwd: string,
): AgentChatShellUpdateResult {
  return updateComposerScope(state, {
    kind: "project",
    projectId: basenameOf(cwd),
    cwd,
  });
}

// Mark the Start Composer to create a new git worktree on send. The optional name
// is stored verbatim; the final worktree/branch name is resolved deterministically
// at send time (typed name → first-message slug → hash). The base branch comes
// from the Branch menu (`launchOptions.branch`). Start Composer only — an active
// Thread can't change its worktree. See docs_v2/specs/worktree-start-experience.md.
export function setComposerNewWorktreeIntent(
  state: AgentChatShellState,
  intent: { name?: string; baseBranch?: string },
): AgentChatShellUpdateResult {
  if (state.thread) {
    return { state, command: null };
  }
  const patch: Record<string, unknown> = {
    worktree: "new",
    newWorktreeName: intent.name?.trim() ?? "",
  };
  // The base branch the new worktree is created off is stored in `branch` (what
  // the send path reads as the `git worktree add` start point).
  if (intent.baseBranch !== undefined && intent.baseBranch.length > 0) {
    patch.branch = intent.baseBranch;
  }
  return updateComposerLaunchOptions(state, patch);
}

// After the worktree is created at send time, scope the Start Composer to it and
// reset the worktree launch option (the new cwd IS now its own "current folder").
// `branch` is the new worktree's branch (= the resolved name we created with).
export function resolveComposerNewWorktreeIntent(
  state: AgentChatShellState,
  resolved: { cwd: string; branch: string },
): AgentChatShellUpdateResult {
  const scoped = updateComposerScope(state, {
    kind: "project",
    projectId: basenameOf(resolved.cwd),
    cwd: resolved.cwd,
  }).state;
  const current = scoped.composer.startOptions.launchOptions ?? {};
  const nextOptions: Record<string, unknown> = { ...current };
  delete nextOptions.newWorktreeName;
  nextOptions.worktree = "current folder";
  nextOptions.branch = resolved.branch;
  return {
    state: {
      ...scoped,
      composer: {
        ...scoped.composer,
        startOptions: { ...scoped.composer.startOptions, launchOptions: nextOptions },
      },
    },
    command: null,
  };
}

export function cloneStringRecord(
  value: Record<string, string> | undefined,
): Record<string, string> | undefined {
  return value === undefined ? undefined : { ...value };
}
