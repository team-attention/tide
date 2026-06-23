import type { ProductShellBackendEventSource, ProductShellLeftRailMenu, ProductShellPinnedItemRef, ProductShellPinnedItemView, ProductShellProject, ProductShellProjectGroupView, ProductShellState, ProductShellThread, ProductShellThreadView, ProductShellUpdateResult } from "./types.ts";
import { formatRelativeThreadTime, previewBlocksForThread, projectsFromThreads, toAgentChatThreadSummary } from "./view-model.ts";
import type { ProductShellThreadListViewModel } from "./view-model.ts";
import { applyAgentChatBackendEvent, updateComposerDraft } from "../../agent-chat/agent-chat.ts";
import type { AgentChatBackendEvent, AgentChatBlock, AgentChatBranchOption, AgentChatShellState, AgentChatThreadSummary, AgentChatWorktreeOption } from "../../agent-chat/agent-chat.ts";
import { activeSurfaceThreadId, agentBindingForShellAgent, cloneLaunchOptions, createStartAgentChatState, normalizeAgentId, preserveActiveAgentChat, refocusStartComposerIfActiveDropped } from "./start.ts";
import { applyAppChromeBackendEvent, createAppChromeState } from "../../app-chrome/app-chrome-state.ts";
import type { AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
import { productShellFileTreeFromPayload } from "./file-tree.ts";
// Extracted from product-shell-state.ts (spec: navigable-source-structure).

// External Sessions (agent sessions Tide did not start) are surfaced by backend
// discovery as Threads whose id is prefixed `adopted-`.
export function isExternalSessionThread(threadId: string): boolean {
  return threadId.startsWith("adopted-");
}

// Final Left-Rail assembly. Builds the rail render order (top-to-bottom flattened
// sequence: "thread" mode = flat sorted list; "project" mode = pinned groups' threads,
// pinned threads, project groups' threads, scratch), then derives BOTH the live set
// (Decision 8) and the ⌥1..9 shortcut numbers from it. ⌥N numbers the first 9 threads
// in that order, deduped, regardless of pin status (#2 — so ⌥N reaches the top of the
// list, not just pinned). Extracted from view-model to stay under the file-size cap.
// Spec: docs_v2/specs/multitask-navigation.md.
export function finalizeThreadList(args: {
  groupBy: string;
  pinnedThreads: ProductShellThreadView[];
  pinnedProjects: ProductShellProjectGroupView[];
  pinnedItems: ProductShellPinnedItemView[];
  projectGroups: ProductShellProjectGroupView[];
  scratchThreads: ProductShellThreadView[];
  flatThreads: ProductShellThreadView[];
}): ProductShellThreadListViewModel {
  const { groupBy, pinnedThreads, pinnedProjects, pinnedItems, projectGroups, scratchThreads, flatThreads } =
    args;
  const railOrder =
    groupBy === "thread"
      ? flatThreads
      : [
          ...pinnedProjects.flatMap((group) => group.threads),
          ...pinnedThreads,
          ...projectGroups.flatMap((group) => group.threads),
          ...scratchThreads,
        ];
  // Live set: walk the rail order and keep the live threads, deduped (L3 / Decision 8).
  const liveSeen = new Set<string>();
  const liveThreads = railOrder.filter((thread) => {
    if (thread.live !== true || liveSeen.has(thread.threadId)) {
      return false;
    }
    liveSeen.add(thread.threadId);
    return true;
  });
  // ⌥1..9 numbering: first 9 threads in rail order, deduped — numbered regardless of pin.
  const SHORTCUT_COUNT = 9;
  const numberedThreads: ProductShellThreadView[] = [];
  const numberByThreadId = new Map<string, number>();
  for (const thread of railOrder) {
    if (numberByThreadId.has(thread.threadId) || numberByThreadId.size >= SHORTCUT_COUNT) {
      continue;
    }
    const pinNumber = numberByThreadId.size + 1;
    numberByThreadId.set(thread.threadId, pinNumber);
    numberedThreads.push({ ...thread, pinNumber });
  }
  // Stamp the number onto every section's copy so the badge shows wherever it renders.
  const withNumber = (thread: ProductShellThreadView): ProductShellThreadView => {
    const pinNumber = numberByThreadId.get(thread.threadId);
    return pinNumber === undefined ? thread : { ...thread, pinNumber };
  };
  return {
    pinnedThreads: pinnedThreads.map(withNumber),
    pinnedProjects,
    pinnedItems: pinnedItems.map((item) =>
      item.kind === "thread" ? { kind: "thread" as const, thread: withNumber(item.thread) } : item,
    ),
    projectGroups: projectGroups.map((group) => ({ ...group, threads: group.threads.map(withNumber) })),
    scratchThreads: scratchThreads.map(withNumber),
    flatThreads: flatThreads.map(withNumber),
    liveThreads,
    numberedThreads,
  };
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

// Threads that just finished a turn — they were running, are no longer running, and
// are not now waiting on the user (that's the separate attention path). Uniform across
// every agent: it reads only the per-thread `running` flag the runtime lifecycle sets.
// Used to notify the user that agent work completed. The focus gate (suppress when the
// user is actually looking at that thread) lives in the main process, which is
// authoritative for window focus — see specs/focus-aware-notifications.md.
export function selectCompletedThreads(
  previousRunning: ReadonlySet<string>,
  threads: ProductShellThread[],
): ProductShellThread[] {
  return threads.filter(
    (thread) =>
      previousRunning.has(thread.threadId) &&
      thread.running !== true &&
      thread.attention !== true,
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
  const next: ProductShellState = {
    ...state,
    threads: remaining,
    projects: projectsFromThreads(remaining),
    leftRailMenu: null,
    activeThreadId: archived.some((thread) => thread.threadId === state.activeThreadId)
      ? null
      : state.activeThreadId,
  };
  return {
    // Archiving a Project's chats can drop the Thread you're viewing → land on the
    // Start Composer, not its dead transcript. See refocusStartComposerIfActiveDropped.
    state: refocusStartComposerIfActiveDropped(state, next),
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
  const next: ProductShellState = {
    ...state,
    threads,
    projects: projectsFromThreads(threads),
    activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
    leftRailMenu: null,
    archiveConfirmThreadId: null,
  };
  return {
    // Archiving the Thread you're viewing lands you on the Start Composer instead of
    // its now-dead transcript. See refocusStartComposerIfActiveDropped.
    state: refocusStartComposerIfActiveDropped(state, next),
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

// --- Left Rail manual ordering (spec: left-rail-manual-ordering) ---

// Stable key for a pinned item — kind+id, since a thread id and a project id could
// otherwise collide. Shared by the view-model rank and the DnD handlers.
export function pinnedItemRefKey(ref: ProductShellPinnedItemRef): string {
  return ref.kind === "thread" ? `t:${ref.threadId}` : `p:${ref.projectId}`;
}

// Parse a pinned-item key (`t:<id>` / `p:<id>`) back to a ref, or null if malformed.
export function parsePinnedItemKey(key: string): ProductShellPinnedItemRef | null {
  if (key.startsWith("t:")) {
    return { kind: "thread", threadId: key.slice(2) };
  }
  if (key.startsWith("p:")) {
    return { kind: "project", projectId: key.slice(2) };
  }
  return null;
}

// Pure reorder: move `draggedKey` to `targetKey`'s slot within the current visual order
// of keys (drops dragged immediately before target). No-op if either key is missing or
// they're equal. The DnD handlers feed it the live rail order and store the result.
export function moveKeyInOrder(keys: string[], draggedKey: string, targetKey: string): string[] {
  if (draggedKey === targetKey) {
    return keys;
  }
  if (!keys.includes(draggedKey) || !keys.includes(targetKey)) {
    return keys;
  }
  const next = keys.filter((key) => key !== draggedKey);
  next.splice(next.indexOf(targetKey), 0, draggedKey);
  return next;
}

// Pure setters for the persisted manual-order arrays. The handler computes the new
// order from the live visual list (so these stay simple, and partial/empty stored
// orders self-heal to the full order on the first reorder).
export function setProductShellPinnedItemOrder(
  state: ProductShellState,
  order: ProductShellPinnedItemRef[],
): ProductShellState {
  return { ...state, pinnedItemOrder: order };
}

export function setProductShellProjectOrder(
  state: ProductShellState,
  order: string[],
): ProductShellState {
  return { ...state, projectOrder: order };
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
  const next: ProductShellState = {
    ...state,
    threads,
    projects: projectsFromThreads(threads),
    activeThreadId:
      summary.archived && state.activeThreadId === summary.threadId
        ? null
        : state.activeThreadId,
    archiveConfirmThreadId: null,
  };
  // If the Thread on screen was archived (e.g. externally, or as the backend
  // confirmation of an optimistic archive), navigate to the Start Composer. Idempotent
  // when the optimistic path already did so (activeThreadId is already null → no-op).
  return refocusStartComposerIfActiveDropped(state, next);
}

// Deleting a worktree archives every Thread that lived in it. If the Thread on screen
// was one of them it's gone now — navigate to the Start Composer instead of leaving its
// dead transcript visible. When the viewed Thread lived elsewhere, focus is untouched.
// Lives here (with archiveProductShellWorktreeChats) so start.ts needs no back-import.
export function deleteWorktreeAndRefocus(
  state: ProductShellState,
  cwd: string,
): {
  state: ProductShellState;
  commands: { kind: "thread.archive"; payload: { threadId: string; archived: boolean } }[];
} {
  const archived = archiveProductShellWorktreeChats(state, cwd);
  return {
    state: refocusStartComposerIfActiveDropped(state, archived.state),
    commands: archived.commands,
  };
}

export function openProductShellThread(
  state: ProductShellState,
  threadId: string,
): ProductShellState {
  // Already showing this thread (by what the surface DISPLAYS, not just activeThreadId,
  // which a thread.listed can transiently null) → keep the live chat, only re-assert focus.
  if (activeSurfaceThreadId(state) === threadId) {
    return state.activeThreadId === threadId ? state : { ...state, activeThreadId: threadId };
  }

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
  // Already showing this thread (by what the surface DISPLAYS, not just activeThreadId,
  // which a thread.listed can transiently null) → keep the live chat instead of rebuilding
  // it into a skeleton, and re-assert focus (activeThreadId may have been nulled).
  if (activeSurfaceThreadId(state) === threadId) {
    return {
      state: {
        ...state,
        activeThreadId: threadId,
        leftRailMenu: null,
        archiveConfirmThreadId: null,
        renamingThreadId: null,
      },
      command: input.backendTransportAvailable
        ? { kind: "thread.hydrate", payload: { threadId } }
        : null,
    };
  }

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
    live: threadSummary.live,
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
        workbenchPanes: thread.workbenchPanes,
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
      workbenchPanes: thread.workbenchPanes,
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
    // Respect the user's remembered open/closed choice for this thread; only derive
    // from pane visibility on the first visit (no entry yet).
    workbenchOpen:
      state.workbenchOpenByThreadId[thread.threadId] ??
      thread.workbenchPanes.length > 0,
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
    workbenchLayoutMode?: "stacked" | "split";
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
    live: threadSummary.live,
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

  // The file tree belongs to the ACTIVE thread's view. An already-loaded tree for the
  // SAME directory as the started/hydrated thread is not stale: the New Thread page
  // and the thread it starts share a cwd, so sending must not throw the tree away and
  // flash (or, if the agent start fails, stick on) a skeleton while a redundant reload
  // — coupled to agent startup — runs. A tree for a different cwd is stale and cleared.
  const isActiveThread = threadSummary.threadId === state.activeThreadId;
  const startedCwd =
    threadSummary.scope.kind === "project"
      ? threadSummary.scope.cwd
      : threadSummary.scope.scratchCwd;
  const sameDirTree =
    state.fileTree !== null &&
    state.fileTree.root !== undefined &&
    normalizeCwd(state.fileTree.root) === normalizeCwd(startedCwd);

  // Background per-thread chat state (incl. a NON-active thread's hydrate/started seeding
  // its blocks + clearing `hydrating`) is folded into agentChatByThreadId upstream in
  // applyProductShellBackendEvent (authoritative per-thread state), so this rail/data
  // reducer no longer special-cases it.
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
    // A DATA refresh must not re-open a workbench the user closed: for the active
    // thread respect its remembered choice (else pane visibility); a background
    // thread's refresh never touches the active view's open state.
    workbenchOpen: isActiveThread
      ? state.workbenchOpenByThreadId[threadSummary.threadId] ??
        shellThread.workbenchPanes.length > 0
      : state.workbenchOpen,
    // Reflect the opened thread's Stacked/Split presentation (per-Thread, backend
    // owned). Only for the active thread, so a background thread.started doesn't
    // flip the composer's current mode.
    workbenchLayoutMode:
      isActiveThread && payload.workbenchLayoutMode !== undefined
        ? payload.workbenchLayoutMode
        : state.workbenchLayoutMode,
    fileTree: !isActiveThread
      ? state.fileTree
      : payload.fileTree !== undefined
        ? productShellFileTreeFromPayload(payload.fileTree)
        : sameDirTree
          ? state.fileTree
          : null,
  };
}

// File-tree roots and thread cwds are absolute paths from the same source; normalize a
// trailing slash before comparing so "/repo" and "/repo/" still match.
function normalizeCwd(cwd: string): string {
  return cwd.replace(/\/+$/, "");
}
