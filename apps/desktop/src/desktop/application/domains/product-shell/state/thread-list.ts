import type { ProductShellBackendEventSource, ProductShellLeftRailMenu, ProductShellProject, ProductShellState, ProductShellThread, ProductShellUpdateResult } from "./types.ts";
import { formatRelativeThreadTime, previewBlocksForThread, projectsFromThreads, toAgentChatThreadSummary } from "./view-model.ts";
import { applyAgentChatBackendEvent, updateComposerDraft } from "../../agent-chat/agent-chat-shell-state.ts";
import type { AgentChatBackendEvent, AgentChatBlock, AgentChatBranchOption, AgentChatShellState, AgentChatThreadSummary, AgentChatWorktreeOption } from "../../agent-chat/agent-chat-shell-state.ts";
import { agentBindingForShellAgent, cloneLaunchOptions, createStartAgentChatState, normalizeAgentId } from "./start.ts";
import { applyAppChromeBackendEvent, createAppChromeState } from "../../app-chrome/app-chrome-state.ts";
import type { AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
import { productShellFileTreeFromPayload } from "./file-tree.ts";
// Extracted from product-shell-state.ts (spec: navigable-source-structure).

// External Sessions (agent sessions Tide did not start) are surfaced by backend
// discovery as Threads whose id is prefixed `adopted-`.
export function isExternalSessionThread(threadId: string): boolean {
  return threadId.startsWith("adopted-");
}

export function toggleProductShellLeftRail(state: ProductShellState): ProductShellState {
  return {
    ...state,
    leftRailOpen: !state.leftRailOpen,
  };
}

export function toggleProductShellProject(
  state: ProductShellState,
  projectId: string,
): ProductShellState {
  const collapsed = new Set(state.collapsedProjectIds);
  if (collapsed.has(projectId)) {
    collapsed.delete(projectId);
  } else {
    collapsed.add(projectId);
  }
  return { ...state, collapsedProjectIds: [...collapsed] };
}

// Threads that just finished a turn IN THE BACKGROUND — they were running, are no
// longer running, are not now waiting on the user (that's the separate attention
// path), and are not the thread the user is currently viewing. Uniform across
// every agent: it reads only the per-thread `running` flag the runtime lifecycle
// sets. Used to notify the user that off-screen agent work completed (so they
// don't have to babysit a background thread to know it's done).
export function selectBackgroundCompletions(
  previousRunning: ReadonlySet<string>,
  threads: ProductShellThread[],
  activeThreadId: string | null,
): ProductShellThread[] {
  return threads.filter(
    (thread) =>
      previousRunning.has(thread.threadId) &&
      thread.running !== true &&
      thread.attention !== true &&
      thread.threadId !== activeThreadId,
  );
}

// Archives every thread in a project (optimistically drops them; the backend
// thread.archived events confirm). Returns one thread.archive command per thread.
export function archiveProductShellProjectChats(
  state: ProductShellState,
  projectId: string,
): { state: ProductShellState; commands: { kind: "thread.archive"; payload: { threadId: string; archived: boolean } }[] } {
  const inProject = (thread: ProductShellThread) =>
    thread.scope.kind === "project" && thread.scope.projectId === projectId;
  const archived = state.threads.filter(inProject);
  const remaining = state.threads.filter((thread) => !inProject(thread));
  return {
    state: {
      ...state,
      threads: remaining,
      projects: projectsFromThreads(remaining),
      leftRailMenu: null,
      activeThreadId: archived.some((thread) => thread.threadId === state.activeThreadId)
        ? null
        : state.activeThreadId,
    },
    commands: archived.map((thread) => ({
      kind: "thread.archive" as const,
      payload: { threadId: thread.threadId, archived: true },
    })),
  };
}

// Deleting a worktree removes its directory, so the Threads that lived there can
// no longer run. Archive them (optimistically dropping them; the backend
// thread.archived events confirm) and drop the worktree from the Composer's
// worktree list, so the sidebar AND the Composer reflect the deletion immediately
// — no manual refresh. Threads are matched by cwd (the worktree path).
export function archiveProductShellWorktreeChats(
  state: ProductShellState,
  cwd: string,
): { state: ProductShellState; commands: { kind: "thread.archive"; payload: { threadId: string; archived: boolean } }[] } {
  const inWorktree = (thread: ProductShellThread) =>
    thread.scope.kind === "project" && thread.scope.cwd === cwd;
  const archived = state.threads.filter(inWorktree);
  const remaining = state.threads.filter((thread) => !inWorktree(thread));
  return {
    state: {
      ...state,
      threads: remaining,
      projects: projectsFromThreads(remaining),
      gitWorktrees: state.gitWorktrees.filter((worktree) => worktree.path !== cwd),
      activeThreadId: archived.some((thread) => thread.threadId === state.activeThreadId)
        ? null
        : state.activeThreadId,
    },
    commands: archived.map((thread) => ({
      kind: "thread.archive" as const,
      payload: { threadId: thread.threadId, archived: true },
    })),
  };
}

// Replaces the registered-project set (from the Main-owned registry) and keeps
// it deduped by projectId.
export function setProductShellRegisteredProjects(
  state: ProductShellState,
  entries: ProductShellProject[],
): ProductShellState {
  const byId = new Map<string, ProductShellProject>();
  for (const entry of entries) {
    byId.set(entry.projectId, { projectId: entry.projectId, name: entry.name, cwd: entry.cwd });
  }
  return { ...state, registeredProjects: [...byId.values()] };
}

// Replaces the real git branches/worktrees for the active Project cwd (fetched
// from the Main process). Cleared when the scope is non-git/Scratch.
export function setProductShellGitContext(
  state: ProductShellState,
  context: { branches: AgentChatBranchOption[]; worktrees: AgentChatWorktreeOption[] },
): ProductShellState {
  return { ...state, gitBranches: context.branches, gitWorktrees: context.worktrees };
}

export function openProductShellLeftRailMenu(
  state: ProductShellState,
  menu: ProductShellLeftRailMenu | null,
): ProductShellState {
  return {
    ...state,
    leftRailMenu: menu,
    archiveConfirmThreadId: null,
  };
}

export function showProductShellThreadArchiveConfirm(
  state: ProductShellState,
  threadId: string,
): ProductShellState {
  return {
    ...state,
    leftRailMenu: null,
    archiveConfirmThreadId: threadId,
  };
}

export function clearProductShellLeftRailTransientState(
  state: ProductShellState,
): ProductShellState {
  return {
    ...state,
    leftRailMenu: null,
    archiveConfirmThreadId: null,
    renamingThreadId: null,
  };
}

export function confirmProductShellThreadArchive(
  state: ProductShellState,
  threadId: string,
): ProductShellUpdateResult {
  // Optimistically drop the archived Thread from the visible list; the backend
  // thread.archived event confirms and persists it.
  const threads = state.threads.filter((thread) => thread.threadId !== threadId);
  return {
    state: {
      ...state,
      threads,
      projects: projectsFromThreads(threads),
      activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
      leftRailMenu: null,
      archiveConfirmThreadId: null,
    },
    command: { kind: "thread.archive", payload: { threadId, archived: true } },
  };
}

export function startProductShellProjectRename(
  state: ProductShellState,
  projectId: string,
): ProductShellState {
  return { ...state, leftRailMenu: null, renamingProjectId: projectId };
}

export function cancelProductShellProjectRename(state: ProductShellState): ProductShellState {
  return { ...state, renamingProjectId: null };
}

export function toggleProductShellProjectPin(
  state: ProductShellState,
  projectId: string,
): ProductShellState {
  const pinned = state.pinnedProjectIds.includes(projectId)
    ? state.pinnedProjectIds.filter((id) => id !== projectId)
    : [...state.pinnedProjectIds, projectId];
  return { ...state, leftRailMenu: null, pinnedProjectIds: pinned };
}

export function startProductShellThreadRename(
  state: ProductShellState,
  threadId: string,
): ProductShellState {
  return { ...state, leftRailMenu: null, archiveConfirmThreadId: null, renamingThreadId: threadId };
}

export function cancelProductShellThreadRename(
  state: ProductShellState,
): ProductShellState {
  return { ...state, renamingThreadId: null };
}

export function submitProductShellThreadRename(
  state: ProductShellState,
  threadId: string,
  title: string,
): ProductShellUpdateResult {
  const trimmed = title.replace(/\s+/g, " ").trim();
  const target = state.threads.find((thread) => thread.threadId === threadId);
  if (!target || trimmed.length === 0 || trimmed === target.title) {
    return { state: { ...state, renamingThreadId: null }, command: null };
  }
  const threads = state.threads.map((thread) =>
    thread.threadId === threadId ? { ...thread, title: trimmed } : thread,
  );
  return {
    state: { ...state, threads, renamingThreadId: null },
    command: { kind: "thread.rename", payload: { threadId, title: trimmed } },
  };
}

export function applyProductShellThreadRenamedEvent(
  state: ProductShellState,
  event: AgentChatBackendEvent,
): ProductShellState {
  const payload = event.payload as { thread?: AgentChatThreadSummary };
  const summary = payload.thread;
  if (!summary) {
    return state;
  }
  return {
    ...state,
    threads: state.threads.map((thread) =>
      thread.threadId === summary.threadId ? { ...thread, title: summary.title } : thread,
    ),
  };
}

// Keep the rail's thread summaries in sync with a mid-thread Launch Options
// change so reopening the thread re-derives the right model/permission chips.
export function applyProductShellThreadLaunchOptionsChangedEvent(
  state: ProductShellState,
  event: AgentChatBackendEvent,
): ProductShellState {
  const payload = event.payload as { thread?: AgentChatThreadSummary };
  const summary = payload.thread;
  if (!summary) {
    return state;
  }
  return {
    ...state,
    threads: state.threads.map((thread) =>
      thread.threadId === summary.threadId
        ? { ...thread, launchOptions: cloneLaunchOptions(summary.launchOptions) }
        : thread,
    ),
  };
}

export function toggleProductShellThreadPin(
  state: ProductShellState,
  threadId: string,
): ProductShellUpdateResult {
  const target = state.threads.find((thread) => thread.threadId === threadId);
  if (!target) {
    return { state, command: null };
  }
  const nextPinned = !target.pinned;
  const threads = state.threads.map((thread) =>
    thread.threadId === threadId ? { ...thread, pinned: nextPinned } : thread,
  );
  return {
    state: { ...state, threads, leftRailMenu: null },
    command: { kind: "thread.setPinned", payload: { threadId, pinned: nextPinned } },
  };
}

export function applyProductShellThreadPinChangedEvent(
  state: ProductShellState,
  event: AgentChatBackendEvent,
): ProductShellState {
  const payload = event.payload as { thread?: AgentChatThreadSummary };
  const summary = payload.thread;
  if (!summary) {
    return state;
  }
  return {
    ...state,
    threads: state.threads.map((thread) =>
      thread.threadId === summary.threadId
        ? { ...thread, pinned: summary.pinned }
        : thread,
    ),
  };
}

export function applyProductShellThreadArchivedEvent(
  state: ProductShellState,
  event: AgentChatBackendEvent,
): ProductShellState {
  const payload = event.payload as { thread?: AgentChatThreadSummary };
  const summary = payload.thread;
  if (!summary) {
    return { ...state, archiveConfirmThreadId: null };
  }
  const threads = summary.archived
    ? state.threads.filter((thread) => thread.threadId !== summary.threadId)
    : state.threads;
  return {
    ...state,
    threads,
    projects: projectsFromThreads(threads),
    activeThreadId:
      summary.archived && state.activeThreadId === summary.threadId
        ? null
        : state.activeThreadId,
    archiveConfirmThreadId: null,
  };
}

// Stash the currently active thread's agent-chat state into the per-thread map so it
// is preserved when we switch away (and can be restored intact on return).
export function preserveActiveAgentChat(
  state: ProductShellState,
  nextThreadId: string,
): Record<string, AgentChatShellState> {
  if (state.activeThreadId === null || state.activeThreadId === nextThreadId) {
    return state.agentChatByThreadId;
  }
  return { ...state.agentChatByThreadId, [state.activeThreadId]: state.agentChat };
}

export function openProductShellThread(
  state: ProductShellState,
  threadId: string,
): ProductShellState {
  const thread = state.threads.find((candidate) => candidate.threadId === threadId);
  if (!thread) {
    return state;
  }

  const agentChatByThreadId = preserveActiveAgentChat(state, threadId);
  return {
    // Drop the previous thread's file tree so the new thread never flashes stale
    // files; the refresh_file_tree dispatched on switch repopulates it.
    ...hydrateProductShellThread(
      { ...state, agentChatByThreadId },
      thread,
      previewBlocksForThread(thread),
      "idle",
      agentChatByThreadId[threadId],
    ),
    fileTree: null,
    expandedFolderPaths: [],
    editorPickerFilter: null,
  };
}

export function openProductShellThreadFromLeftRail(
  state: ProductShellState,
  threadId: string,
  input: { backendTransportAvailable: boolean },
): ProductShellUpdateResult {
  if (!input.backendTransportAvailable) {
    return { state: openProductShellThread(state, threadId), command: null };
  }

  // Web pattern: a click switches focus instantly (locally), then refreshes from
  // the backend. Focus is owned by this action — backend events never move focus,
  // so a late answer can't drag the view away. Show the thread header + the real
  // running state right away (no fake "local preview" block, and keep the Working
  // indicator if it's running) with an empty body until thread.hydrated fills the
  // real blocks.
  const thread = state.threads.find((candidate) => candidate.threadId === threadId);
  // Preserve the thread we are leaving and restore the target's preserved state, so
  // its blocker / blocks / draft survive the switch instead of being rebuilt blank.
  const agentChatByThreadId = preserveActiveAgentChat(state, threadId);
  const stateWithMap = { ...state, agentChatByThreadId };
  const optimistic =
    thread === undefined
      ? { ...stateWithMap, activeThreadId: threadId }
      : hydrateProductShellThread(
          stateWithMap,
          thread,
          [],
          thread.running ? "running" : "idle",
          agentChatByThreadId[threadId],
          // Awaiting the real hydrate below → show the loading skeleton (unless we
          // restored preserved content, which renders instantly).
          agentChatByThreadId[threadId] === undefined,
        );
  return {
    state: {
      ...optimistic,
      leftRailMenu: null,
      archiveConfirmThreadId: null,
      // Stale-free file tree: clear on switch; the refresh_file_tree dispatched by
      // the caller (and on thread.hydrated) fills in the new thread's files.
      fileTree: null,
      expandedFolderPaths: [],
      editorPickerFilter: null,
    },
    command: {
      kind: "thread.hydrate",
      payload: { threadId },
    },
  };
}

export function toProductShellThreadFromSummary(
  threadSummary: AgentChatThreadSummary,
): ProductShellThread {
  return {
    threadId: threadSummary.threadId,
    title: threadSummary.title,
    agentId: normalizeAgentId(threadSummary.agentBinding.agentId),
    time: formatRelativeThreadTime(threadSummary.updatedAt),
    scope: threadSummary.scope,
    launchOptions: cloneLaunchOptions(threadSummary.launchOptions),
    workbenchPanes: [],
    pinned: threadSummary.pinned,
    attention:
      threadSummary.lastKnownState === "waiting_for_input" ||
      threadSummary.lastKnownState === "waiting_for_approval",
    running: threadSummary.lastKnownState === "running",
    runtimeStartedAt: threadSummary.runtimeStartedAt,
    createdAt: threadSummary.createdAt,
    updatedAt: threadSummary.updatedAt,
  };
}

function hydrateProductShellThread(
  state: ProductShellState,
  thread: ProductShellThread,
  blocks: AgentChatBlock[],
  runtimeState: "idle" | "running" = "idle",
  // When this thread already has preserved per-thread state (we are switching back
  // to it), restore that full state instead of rebuilding a fresh one — so its
  // readiness blocker, blocks, prompt, and draft are not lost on the round-trip.
  preservedAgentChat?: AgentChatShellState,
  // True for an optimistic open awaiting the backend hydrate — drives the loading
  // skeleton until the real blocks arrive. Not set when restoring preserved state.
  hydrating = false,
): ProductShellState {
  const threadSummary = toAgentChatThreadSummary(thread);
  const agentChat =
    preservedAgentChat ??
    applyAgentChatBackendEvent(createStartAgentChatState(), {
      kind: "thread.hydrated",
      payload: {
        thread: threadSummary,
        blocks,
        runtimeState,
        workbenchPanes: thread.workbenchPanes.filter((pane) => pane.visible),
      },
    });
  const appChrome = applyAppChromeBackendEvent(createAppChromeState(), {
    kind: "thread.hydrated",
    payload: {
      thread: {
        threadId: thread.threadId,
        title: thread.title,
        agentBinding: agentBindingForShellAgent(thread.agentId),
        launchOptions: cloneLaunchOptions(thread.launchOptions),
      },
      runtimeState,
      workbenchPanes: thread.workbenchPanes.filter((pane) => pane.visible),
    },
  });

  return {
    ...state,
    activeThreadId: thread.threadId,
    agentChat:
      preservedAgentChat !== undefined
        ? agentChat
        : { ...updateComposerDraft(agentChat, "").state, hydrating },
    appChrome,
    workbenchOpen: thread.workbenchPanes.some((pane) => pane.visible),
    leftRailMenu: null,
    archiveConfirmThreadId: null,
    fileTree: null,
    editorDrafts: {},
  };
}

export function applyProductShellThreadEvent(
  state: ProductShellState,
  event: AgentChatBackendEvent,
  source: ProductShellBackendEventSource = "command",
): ProductShellState {
  const payload = event.payload as {
    thread?: AgentChatThreadSummary;
    workbenchPanes?: AppChromeWorkbenchPaneRef[];
    fileTree?: unknown;
  };
  const threadSummary = payload.thread;
  if (!threadSummary) {
    return state;
  }

  const shellThread: ProductShellThread = {
    threadId: threadSummary.threadId,
    title: threadSummary.title,
    agentId: normalizeAgentId(threadSummary.agentBinding.agentId),
    time: formatRelativeThreadTime(threadSummary.updatedAt),
    scope: threadSummary.scope,
    launchOptions: cloneLaunchOptions(threadSummary.launchOptions),
    workbenchPanes: payload.workbenchPanes ?? [],
    pinned: threadSummary.pinned,
    attention:
      threadSummary.lastKnownState === "waiting_for_input" ||
      threadSummary.lastKnownState === "waiting_for_approval",
    running: threadSummary.lastKnownState === "running",
    runtimeStartedAt: threadSummary.runtimeStartedAt,
  };
  const existingThread = state.threads.find(
    (candidate) => candidate.threadId === threadSummary.threadId,
  );
  const threads = existingThread
    ? state.threads.map((thread) =>
        thread.threadId === threadSummary.threadId ? { ...thread, ...shellThread } : thread,
      )
    : [shellThread, ...state.threads];

  return {
    ...state,
    // Focus is owned by user actions (click / new-thread set activeThreadId
    // locally). A thread.started/hydrated event is a DATA update only and never
    // moves focus — otherwise a late answer for another thread drags the view away.
    activeThreadId: state.activeThreadId,
    threads,
    // Recompute projects so a thread started in a not-yet-listed project (e.g.
    // slice) appears in the rail immediately.
    projects: projectsFromThreads(threads),
    // Keep the active thread's composer as-is: a thread.started/hydrated is a DATA
    // update, not a reason to wipe an in-progress draft + attachments (a send already
    // clears the composer itself). Clobbering it lost the composer on switch-back.
    agentChat: state.agentChat,
    workbenchOpen: shellThread.workbenchPanes.some((pane) => pane.visible),
    fileTree:
      payload.fileTree === undefined
        ? null
        : productShellFileTreeFromPayload(payload.fileTree),
  };
}
