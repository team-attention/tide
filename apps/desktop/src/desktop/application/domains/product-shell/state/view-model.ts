import type { ProductShellEditorDraft, ProductShellEditorPickerView, ProductShellFileTreeView, ProductShellListSortBy, ProductShellPinnedItemView, ProductShellProject, ProductShellProjectGroupView, ProductShellState, ProductShellThread, ProductShellThreadView, ProductShellUsageModelView, ProductShellViewModel } from "./types.ts";
import { finalizeThreadList, isExternalSessionThread, pinnedItemRefKey } from "./thread-list.ts";
import { worktreeRepoRootForCwd } from "../../../../../shared/worktree/path.ts";
import { reconcileTree } from "./workbench-split-tree.ts";
import { codexModelLabel, createAgentChatShellViewModel, createAgentChatUsageView, defaultModelValueForAgent, formatAgentLabel, modelLabelForAgent } from "../../agent-chat/agent-chat.ts";
import type { AgentChatBlock, AgentChatShellState, AgentChatThreadSummary } from "../../agent-chat/agent-chat.ts";
import { createAppChromeViewModel } from "../../app-chrome/app-chrome-state.ts";
import type { AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
import { cloneProductShellFileTree, fileTreePathHasCollapsedAncestor } from "./file-tree.ts";
import { appendUntitledPanes, composerWorkbenchAppChrome, untitledEditorDraft } from "./workbench-pane-view.ts";
import { agentBindingForShellAgent, cloneLaunchOptions } from "./start.ts";
import { shellTimestamp } from "./create.ts";
import { createSelectorFor } from "./create-selector.ts";
// Extracted from product-shell-state.ts (spec: navigable-source-structure).

const shellSelector = createSelectorFor<ProductShellState>();

// Memoized per-area view-model selectors (spec: desktop-product-shell-render-isolation).
// Each returns a reference-stable slice so a column subscribing to it re-renders only
// when ITS inputs change — a chat token (state.agentChat) never invalidates the
// workbench/file-tree slices, so the editor isn't reconfigured. createProductShellViewModel
// composes these, so the whole-VM read stays cheap too (unchanged slices are reused).
//
// Each combiner reconstructs a minimal state object and runs the ORIGINAL logic, so the
// output is byte-identical to the pre-decomposition view model (pinned by the static
// render tests) — only the memoization boundary is new.

export interface ProductShellThreadListViewModel {
  pinnedThreads: ProductShellThreadView[];
  pinnedProjects: ProductShellProjectGroupView[];
  // The Pinned section as one manually-ordered, intermixed list (threads + projects).
  pinnedItems: ProductShellPinnedItemView[];
  projectGroups: ProductShellProjectGroupView[];
  scratchThreads: ProductShellThreadView[];
  flatThreads: ProductShellThreadView[];
  // Live threads (in-process runtime alive) in Left Rail render order — cycled by
  // the multitask switcher. Spec: multitask-navigation L3.
  liveThreads: ProductShellThreadView[];
  // The ⌥1..9 jump targets: the first 9 threads in Left Rail render order (deduped,
  // pin status irrelevant), each carrying its pinNumber. index N-1 = ⌥N. Spec #2.
  numberedThreads: ProductShellThreadView[];
}

export const selectThreadListViewModel = shellSelector(
  [
    (state: ProductShellState) => state.threads,
    (state: ProductShellState) => state.searchQuery,
    (state: ProductShellState) => state.listSettings,
    (state: ProductShellState) => state.registeredProjects,
    (state: ProductShellState) => state.projects,
    (state: ProductShellState) => state.collapsedProjectIds,
    (state: ProductShellState) => state.pinnedProjectIds,
    (state: ProductShellState) => state.pinnedItemOrder,
    (state: ProductShellState) => state.projectOrder,
    (state: ProductShellState) => state.renamingProjectId,
    (state: ProductShellState) => state.creatingWorktreeForProjectId,
    (state: ProductShellState) => state.leftRailMenu,
    (state: ProductShellState) => state.activeThreadId,
    (state: ProductShellState) => state.agentChat.hydrating,
    (state: ProductShellState) => state.archiveConfirmThreadId,
    (state: ProductShellState) => state.renamingThreadId,
  ],
  (
    threads,
    searchQuery,
    listSettings,
    registeredProjects,
    projects,
    collapsedProjectIds,
    pinnedProjectIds,
    pinnedItemOrder,
    projectOrder,
    renamingProjectId,
    creatingWorktreeForProjectId,
    leftRailMenu,
    activeThreadId,
    activeThreadHydrating,
    archiveConfirmThreadId,
    renamingThreadId,
  ): ProductShellThreadListViewModel => {
    const view = {
      threads,
      searchQuery,
      listSettings,
      registeredProjects,
      projects,
      collapsedProjectIds,
      pinnedProjectIds,
      pinnedItemOrder,
      projectOrder,
      renamingProjectId,
      creatingWorktreeForProjectId,
      leftRailMenu,
      activeThreadId,
      archiveConfirmThreadId,
      renamingThreadId,
    } as ProductShellState;
    return buildThreadListViewModel(view, { activeThreadHydrating });
  },
);

export const selectAgentChatViewModel = shellSelector(
  [
    (state: ProductShellState) => state.agentChat,
    (state: ProductShellState) => state.registeredProjects,
    (state: ProductShellState) => state.projects,
    (state: ProductShellState) => state.gitBranches,
    (state: ProductShellState) => state.gitWorktrees,
    (state: ProductShellState) => state.providerCommands,
    (state: ProductShellState) => state.providerCapabilities,
    (state: ProductShellState) => state.providerInventory,
    (state: ProductShellState) => state.providerCatalogs,
    (state: ProductShellState) => state.composerFileMentions,
  ],
  (agentChat, registeredProjects, projects, gitBranches, gitWorktrees, providerCommands, providerCapabilities, providerInventory, providerCatalogs, composerFileMentions) =>
    createAgentChatShellViewModel(
      agentChatWithProjects({
        agentChat,
        registeredProjects,
        projects,
        gitBranches,
        gitWorktrees,
        providerCommands,
        providerCapabilities,
        providerInventory,
        providerCatalogs,
        composerFileMentions,
      } as ProductShellState),
    ),
);

export interface ProductShellWorkbenchViewModel {
  activeThreadId: ProductShellViewModel["activeThreadId"];
  appChrome: ProductShellViewModel["appChrome"];
  editorDrafts: ProductShellViewModel["editorDrafts"];
  editorPicker: ProductShellViewModel["editorPicker"];
  workbenchLayoutMode: ProductShellViewModel["workbenchLayoutMode"];
  workbenchLayoutTree: ProductShellViewModel["workbenchLayoutTree"];
  workbenchFullscreen: ProductShellViewModel["workbenchFullscreen"];
}

export const selectWorkbenchViewModel = shellSelector(
  [
    (state: ProductShellState) => state.appChrome,
    (state: ProductShellState) => state.activeThreadId,
    (state: ProductShellState) => state.editorDrafts,
    (state: ProductShellState) => state.workbenchLayoutTree,
    (state: ProductShellState) => state.workbenchLayoutMode,
    (state: ProductShellState) => state.workbenchFullscreen,
    (state: ProductShellState) => state.fileTree,
    (state: ProductShellState) => state.editorPickerFilter,
    (state: ProductShellState) => state.draftActiveWorkbenchPaneId,
    (state: ProductShellState) => state.untitledFiles,
  ],
  (
    appChrome,
    activeThreadId,
    editorDrafts,
    workbenchLayoutTree,
    workbenchLayoutMode,
    workbenchFullscreen,
    fileTree,
    editorPickerFilter,
    draftActiveWorkbenchPaneId,
    untitledFiles,
  ): ProductShellWorkbenchViewModel => {
    // Untitled files show only in the context (thread/start) they were created in.
    const untitledForView = untitledFiles.filter((file) => file.threadId === activeThreadId);
    // Composer (New Thread) page before a Draft Thread exists: derive only the
    // synthetic Launcher. Browser/Changes/Terminal/Editor actions create a backend
    // Draft Thread and then render through the normal active-thread appChrome path.
    const appChromeForView =
      activeThreadId !== null
        ? appendUntitledPanes(appChrome, untitledForView, draftActiveWorkbenchPaneId)
        : composerWorkbenchAppChrome(
            appChrome,
            untitledForView,
            draftActiveWorkbenchPaneId,
          );
    return {
      activeThreadId,
      // The Workbench's Stacked tab strip (workbench.tsx) scrolls horizontally, so it
      // shows EVERY open pane as a tab — it has no overflow menu. Uncap the view model
      // here (the 6-tab cap + overflow split belongs to the legacy AppChrome surface)
      // so panes past the 6th aren't silently dropped from the strip.
      appChrome: createAppChromeViewModel(appChromeForView, { maxVisibleTabs: Number.POSITIVE_INFINITY }),
      workbenchLayoutMode,
      workbenchFullscreen,
      // Reconcile the split tree against the panes actually shown: the real panes
      // when a thread is active, the composer-derived panes otherwise (so Split mode
      // works on the New Thread page too).
      workbenchLayoutTree: reconcileTree(
        workbenchLayoutTree,
        appChromeForView.workbenchPanes.map((pane) => pane.paneId),
      ),
      editorPicker: createEditorPickerView({ editorPickerFilter, fileTree } as ProductShellState),
      editorDrafts:
        untitledForView.length === 0
          ? editorDrafts
          : {
              ...editorDrafts,
              ...Object.fromEntries(
                untitledForView.map((file) => [file.id, untitledEditorDraft(file)]),
              ),
            },
    };
  },
);

export const selectFileTreeViewModel = shellSelector(
  [
    (state: ProductShellState) => state.fileTree,
    (state: ProductShellState) => state.expandedFolderPaths,
    (state: ProductShellState) => state.activeThreadId,
    (state: ProductShellState) => state.threads,
  ],
  (fileTree, expandedFolderPaths, activeThreadId, threads) =>
    createFileTreeView({ fileTree, expandedFolderPaths, activeThreadId, threads } as ProductShellState),
);

// The Left Rail reads the thread list plus a few scalars. Composing the memoized
// thread-list selector keeps the rail stable while only chat/workbench change.
export type ProductShellLeftRailViewModel = ProductShellThreadListViewModel &
  Pick<ProductShellViewModel, "listSettings" | "searchActive" | "searchQuery" | "threadsLoaded">;

export const selectLeftRailViewModel = shellSelector(
  [
    selectThreadListViewModel,
    (state: ProductShellState) => state.listSettings,
    (state: ProductShellState) => state.searchActive,
    (state: ProductShellState) => state.searchQuery,
    (state: ProductShellState) => state.threadsLoaded,
  ],
  (threadList, listSettings, searchActive, searchQuery, threadsLoaded): ProductShellLeftRailViewModel => ({
    ...threadList,
    listSettings,
    searchActive,
    searchQuery,
    threadsLoaded,
  }),
);

// The Chat column reads the agent chat plus the thread switcher's flat/pinned/project
// lists (and the rail-open flag for the toggle). A streaming token changes agentChat —
// and so this slice — but never the workbench/file-tree slices.
export type ProductShellChatColumnViewModel = Pick<
  ProductShellViewModel,
  "agentChat" | "flatThreads" | "pinnedThreads" | "projectGroups" | "leftRailOpen"
>;

export const selectChatColumnViewModel = shellSelector(
  [
    selectAgentChatViewModel,
    selectThreadListViewModel,
    (state: ProductShellState) => state.leftRailOpen,
  ],
  (agentChat, threadList, leftRailOpen): ProductShellChatColumnViewModel => ({
    agentChat,
    flatThreads: threadList.flatThreads,
    pinnedThreads: threadList.pinnedThreads,
    projectGroups: threadList.projectGroups,
    leftRailOpen,
  }),
);

export function createProductShellViewModel(
  state: ProductShellState,
): ProductShellViewModel {
  // Composed from the memoized per-area selectors above: each slice keeps its reference
  // while its own inputs are unchanged, so this whole-VM read is cheap AND a column
  // subscribing to one selector re-renders independently of the others.
  const threadList = selectThreadListViewModel(state);
  const workbench = selectWorkbenchViewModel(state);
  return {
    activeThreadId: state.activeThreadId,
    leftRailOpen: state.leftRailOpen,
    threadsLoaded: state.threadsLoaded,
    workbenchOpen: state.workbenchOpen,
    workbenchFullscreen: workbench.workbenchFullscreen,
    workbenchLayoutMode: workbench.workbenchLayoutMode,
    workbenchLayoutTree: workbench.workbenchLayoutTree,
    fileTreeOpen: state.fileTreeOpen,
    searchQuery: state.searchQuery,
    searchActive: state.searchActive,
    pinnedThreads: threadList.pinnedThreads,
    pinnedProjects: threadList.pinnedProjects,
    pinnedItems: threadList.pinnedItems,
    projectGroups: threadList.projectGroups,
    scratchThreads: threadList.scratchThreads,
    listSettings: state.listSettings,
    worktreeSettings: state.worktreeSettings,
    usageByModel: deriveUsageByModel(state),
    providerInventory: state.providerInventory,
    providerCatalogs: state.providerCatalogs,
    settingsOpen: state.settingsOpen,
    flatThreads: threadList.flatThreads,
    liveThreads: threadList.liveThreads,
    numberedThreads: threadList.numberedThreads,
    agentChat: selectAgentChatViewModel(state),
    appChrome: workbench.appChrome,
    fileTree: selectFileTreeViewModel(state),
    contentSearch: state.contentSearch,
    editorPicker: workbench.editorPicker,
    editorDrafts: workbench.editorDrafts,
  };
}

function deriveUsageByModel(state: ProductShellState): ProductShellUsageModelView[] {
  const byModel = new Map<string, ProductShellUsageModelView & { sortMs: number }>();

  for (const snapshot of state.providerUsage) {
    const usage = createAgentChatUsageView(snapshot.usage);
    if (usage === null) {
      continue;
    }
    if ((usage.rateLimits?.length ?? 0) === 0) {
      continue;
    }
    const agentId = snapshot.agentId;
    const modelValue = usageModelValue(snapshot.usage.model, agentId);
    const key = `${agentId}:${modelValue}`;
    const sortMs = Date.parse(snapshot.observedAt ?? "") || 0;
    const row: ProductShellUsageModelView & { sortMs: number } = {
      key,
      agentId,
      agentLabel: formatAgentLabel(agentId),
      modelLabel: usageModelLabel(agentId, modelValue),
      usage,
      sortMs,
    };
    const previous = byModel.get(key);
    if (previous === undefined || sortMs >= previous.sortMs) {
      byModel.set(key, row);
    }
  }

  return [...byModel.values()]
    .sort((a, b) => b.sortMs - a.sortMs || a.agentLabel.localeCompare(b.agentLabel))
    .map(({ sortMs: _sortMs, ...row }) => row);
}

function usageModelValue(usageModel: string | undefined, agentId: string): string {
  if (usageModel !== undefined && usageModel.length > 0) {
    return usageModel;
  }
  return defaultModelValueForAgent(agentId);
}

function usageModelLabel(agentId: string, modelValue: string): string {
  return agentId === "codex" ? codexModelLabel(modelValue) : modelLabelForAgent(agentId, modelValue);
}

// Stable key so a pinned item view compares by kind+id against the persisted order
// (pinnedItemRefKey, from thread-list). Spec: left-rail-manual-ordering.
function pinnedItemViewKey(item: ProductShellPinnedItemView): string {
  return item.kind === "thread" ? `t:${item.thread.threadId}` : `p:${item.project.projectId}`;
}

// Lifted out of createProductShellViewModel so selectThreadListViewModel can run the
// EXACT original Left-Rail thread-list logic (output pinned by the static render tests).
function buildThreadListViewModel(
  state: ProductShellState,
  options: { activeThreadHydrating?: boolean } = {},
): ProductShellThreadListViewModel {
  const query = state.searchQuery.trim().toLowerCase();
  const matchesSearch = (thread: ProductShellThread): boolean =>
    query.length === 0 || thread.title.toLowerCase().includes(query);
  const searching = query.length > 0;
  // External Sessions (agent sessions Tide did not start) stay hidden unless the
  // user opts in via the list-config menu — the default list is Tide-made Threads.
  const matchesExternalFilter = (thread: ProductShellThread): boolean =>
    state.listSettings.showExternalSessions || !isExternalSessionThread(thread.threadId);
  const sortThreads = (threads: ProductShellThread[]): ProductShellThread[] =>
    sortProductShellThreads(threads, state.listSettings.sortBy);
  const visibleThreads = sortThreads(
    state.threads.filter((thread) => matchesSearch(thread) && matchesExternalFilter(thread)),
  );

  // When "group worktrees by repo" is on, a worktree Project (cwd
  // `<repo>.worktree/<branch>`) is folded into its repo Project: its threads
  // bucket under the repo and the worktree Project is hidden from the top level.
  const projects = displayedProjects(state);
  const worktreeRemap = new Map<string, string>();
  if (state.listSettings.groupWorktreesByRepo) {
    const projectIdByCwd = new Map(projects.map((project) => [project.cwd, project.projectId]));
    for (const project of projects) {
      const repoRoot = worktreeRepoRootForCwd(project.cwd);
      const repoProjectId = repoRoot === null ? undefined : projectIdByCwd.get(repoRoot);
      if (repoProjectId !== undefined && repoProjectId !== project.projectId) {
        worktreeRemap.set(project.projectId, repoProjectId);
      }
    }
  }
  const groupingProjectId = (projectId: string): string =>
    worktreeRemap.get(projectId) ?? projectId;
  const inGroup = (thread: ProductShellThread, project: ProductShellProject): boolean =>
    thread.scope.kind === "project" &&
    groupingProjectId(thread.scope.projectId) === project.projectId;

  const toGroup = (project: ProductShellProject): ProductShellProjectGroupView => {
    // Pinned threads are lifted to the Pinned section (spec:
    // left-rail-manual-ordering), so their row state should not also bubble to the
    // source project group.
    const groupThreads = visibleThreads.filter(
      (thread) => inGroup(thread, project) && thread.pinned !== true,
    );
    return {
      projectId: project.projectId,
      name: project.name,
      cwd: project.cwd,
      // Projects are expanded by default. Searching force-expands every group so
      // matches are visible without manual expansion. Expand state is keyed by
      // projectId, so a project pinned + listed expands consistently in both.
      expanded: searching || !state.collapsedProjectIds.includes(project.projectId),
      contextMenuOpen:
        state.leftRailMenu?.kind === "project" && state.leftRailMenu.projectId === project.projectId,
      pinned: state.pinnedProjectIds.includes(project.projectId),
      renaming: state.renamingProjectId === project.projectId,
      creatingWorktree: state.creatingWorktreeForProjectId === project.projectId,
      threads: groupThreads.map((thread) =>
        toThreadView(thread, state, options.activeThreadHydrating === true),
      ),
      attention: groupThreads.some((thread) => thread.attention === true || thread.unread === true),
      running: groupThreads.some((thread) => thread.running === true),
    };
  };
  // Worktree Projects folded into a repo no longer appear as their own group.
  const topLevelProjects = projects.filter((project) => !worktreeRemap.has(project.projectId));

  // Pinned section: ONE manually-ordered, intermixed list of pinned threads + pinned
  // projects (spec: left-rail-manual-ordering), independent of sortBy. Pins are lifted
  // OUT of their project groups (toGroup excludes pinned threads above). Base order
  // when unranked = projects then threads (the pre-manual default); V8's stable sort
  // keeps unranked items in that order so newly-pinned items append predictably.
  const pinnedBase: ProductShellPinnedItemView[] = [
    ...topLevelProjects
      .filter((project) => state.pinnedProjectIds.includes(project.projectId))
      .map(toGroup)
      .filter((group) => !searching || group.threads.length > 0)
      .map((project) => ({ kind: "project" as const, project })),
    ...visibleThreads
      .filter((thread) => thread.pinned)
      .map((thread) => ({
        kind: "thread" as const,
        thread: toThreadView(thread, state, options.activeThreadHydrating === true),
      })),
  ];
  const pinnedRank = new Map(
    state.pinnedItemOrder.map((ref, index) => [pinnedItemRefKey(ref), index] as const),
  );
  const rankOfPinned = (item: ProductShellPinnedItemView): number =>
    pinnedRank.get(pinnedItemViewKey(item)) ?? Number.MAX_SAFE_INTEGER;
  // The Pinned section in manual order. ⌥N shortcut numbers are NOT assigned here —
  // they are computed below across the FULL rail order (#2: top-9, not just pinned).
  const pinnedItems: ProductShellPinnedItemView[] = [...pinnedBase].sort(
    (a, b) => rankOfPinned(a) - rankOfPinned(b),
  );
  const pinnedThreads = pinnedItems.flatMap((item) => (item.kind === "thread" ? [item.thread] : []));
  const pinnedProjects = pinnedItems.flatMap((item) => (item.kind === "project" ? [item.project] : []));
  // Projects section: top-level folders in manual order (independent of sortBy; nested
  // threads still follow sortBy). Spec: left-rail-manual-ordering.
  const projectRank = new Map(state.projectOrder.map((id, index) => [id, index] as const));
  const projectGroups = topLevelProjects
    .map(toGroup)
    // While searching, hide project groups with no matching threads.
    .filter((group) => !searching || group.threads.length > 0)
    .sort(
      (a, b) =>
        (projectRank.get(a.projectId) ?? Number.MAX_SAFE_INTEGER) -
        (projectRank.get(b.projectId) ?? Number.MAX_SAFE_INTEGER),
    );
  const scratchThreads = visibleThreads
    // Pinned scratch threads are lifted to the Pinned section too (review feedback).
    .filter((thread) => thread.scope.kind === "scratch" && thread.pinned !== true)
    .map((thread) => toThreadView(thread, state, options.activeThreadHydrating === true));
  // "thread" group mode: one flat, already-sorted list of every visible thread.
  const flatThreads = visibleThreads.map((thread) =>
    toThreadView(thread, state, options.activeThreadHydrating === true),
  );
  // Rail render order, live set, and ⌥1..9 shortcut numbering — see finalizeThreadList.
  return finalizeThreadList({
    groupBy: state.listSettings.groupBy,
    pinnedThreads,
    pinnedProjects,
    pinnedItems,
    projectGroups,
    scratchThreads,
    flatThreads,
  });
}

// The Projects shown in the Left Rail and Project menu: the union of explicitly
// registered projects and thread-derived projects, deduped by projectId.
function displayedProjects(state: ProductShellState): ProductShellProject[] {
  const byId = new Map<string, ProductShellProject>();
  for (const project of [...state.registeredProjects, ...state.projects]) {
    if (!byId.has(project.projectId)) {
      byId.set(project.projectId, project);
    }
  }
  return [...byId.values()];
}

// Injects the product shell's real projects/branches/worktrees into the
// agent-chat state so the composer menus list actual data (never hardcoded).
export function agentChatWithProjects(state: ProductShellState): AgentChatShellState {
  return {
    ...state.agentChat,
    // A Tide worktree (cwd `<repo>.worktree/<branch>`) registers as a Project so the
    // Left Rail can group it under its repo, but it must NOT be offered as a "start
    // here" target in the composer — new Threads start in a real Project, worktrees
    // are created via the dedicated worktree flow (spec: project-open-folder-registry
    // D6). The Left Rail keeps using the unfiltered displayedProjects, so its worktree
    // grouping is unchanged. A worktree that is the active scope is re-added by
    // projectOptionsForState, so a worktree Thread keeps its own folder selectable.
    // Boolean(cwd) drops malformed projects (no cwd) instead of letting them reach
    // worktreeRepoRootForCwd's string .replace() — a garbage project can't scope a
    // Thread, so excluding it from the menu is also the right behavior.
    availableProjects: displayedProjects(state)
      .filter((project) => Boolean(project.cwd) && worktreeRepoRootForCwd(project.cwd) === null)
      .map((project) => ({
        projectId: project.projectId,
        name: project.name,
        cwd: project.cwd,
      })),
    availableBranches: state.gitBranches,
    availableWorktrees: state.gitWorktrees,
    availableCommands: state.providerCommands,
    availableCapabilities: state.providerCapabilities,
    availableProviderInventory: state.providerInventory,
    availableProviderCatalogs: state.providerCatalogs,
    availableFileMentions: fileMentionsForActiveScope(state),
  };
}

function fileMentionsForActiveScope(state: ProductShellState) {
  const scope = state.agentChat.thread?.scope ?? state.agentChat.composer.startOptions.scope;
  const cwd = scope?.kind === "project" ? scope.cwd : undefined;
  if (cwd === undefined || state.composerFileMentions?.cwd !== cwd) {
    return [];
  }
  return state.composerFileMentions.entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => ({
      name: entry.name,
      relativePath: entry.relativePath,
      cwd,
    }));
}

// Sort threads for the Left Rail list. "recent"/"created" newest-first by the
// matching timestamp (missing timestamps sort last, preserving stable order);
// "name" is title A–Z. See docs_v2/specs/thread-list-display-settings.md.
function sortProductShellThreads(
  threads: ProductShellThread[],
  sortBy: ProductShellListSortBy,
): ProductShellThread[] {
  const indexed = threads.map((thread, index) => ({ thread, index }));
  const timeOf = (thread: ProductShellThread, iso: string | undefined): number => {
    const parsed = iso === undefined ? NaN : Date.parse(iso);
    return Number.isNaN(parsed) ? -Infinity : parsed;
  };
  indexed.sort((a, b) => {
    let cmp = 0;
    if (sortBy === "name") {
      cmp = a.thread.title.localeCompare(b.thread.title, undefined, {
        sensitivity: "base",
      });
    } else {
      const key = sortBy === "created" ? "createdAt" : "updatedAt";
      cmp = timeOf(b.thread, b.thread[key]) - timeOf(a.thread, a.thread[key]);
    }
    // Stable: fall back to original order on ties.
    return cmp !== 0 ? cmp : a.index - b.index;
  });
  return indexed.map((entry) => entry.thread);
}

// Compact relative timestamp for thread rows ("now", "5m", "2h", "3d").
export function formatRelativeThreadTime(iso: string | undefined): string {
  if (iso === undefined) {
    return "now";
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "now";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 45) {
    return "now";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h`;
  }
  return `${Math.floor(seconds / 86400)}d`;
}

export function projectsFromThreads(threads: ProductShellThread[]): ProductShellProject[] {
  const projects = new Map<string, ProductShellProject>();
  for (const thread of threads) {
    if (thread.scope.kind !== "project") {
      continue;
    }
    if (!projects.has(thread.scope.projectId)) {
      projects.set(thread.scope.projectId, {
        projectId: thread.scope.projectId,
        name: thread.scope.projectId,
        cwd: thread.scope.cwd,
      });
    }
  }
  return [...projects.values()];
}

// The in-pane editor picker's view: a flat, filtered list of files from the loaded
// tree (folders excluded), matched case-insensitively against name or path.
function createEditorPickerView(
  state: ProductShellState,
): ProductShellEditorPickerView | null {
  if (state.editorPickerFilter === null) {
    return null;
  }
  const query = state.editorPickerFilter.trim().toLowerCase();
  const files = (state.fileTree?.entries ?? [])
    .filter((entry) => entry.kind === "file")
    .filter(
      (entry) =>
        query.length === 0 ||
        entry.name.toLowerCase().includes(query) ||
        entry.relativePath.toLowerCase().includes(query),
    )
    .slice(0, 300)
    .map((entry) => ({
      relativePath: entry.relativePath,
      name: entry.name,
      depth: entry.depth,
    }));
  return { filter: state.editorPickerFilter, files };
}

// Quick Open (Cmd+P) searches EVERY loaded file. It must read the raw state
// tree: createFileTreeView strips collapsed folders' children for RENDERING,
// and folders start collapsed — deriving search candidates from the rendered
// view left Quick Open blind to every nested file.
export function quickOpenFilesFromState(
  state: ProductShellState,
): Array<{ relativePath: string; name: string }> {
  return (state.fileTree?.entries ?? [])
    .filter((entry) => entry.kind === "file")
    .map((entry) => ({ relativePath: entry.relativePath, name: entry.name }));
}

function createFileTreeView(state: ProductShellState): ProductShellFileTreeView {
  if (state.fileTree !== null) {
    const cloned = cloneProductShellFileTree(state.fileTree);
    const expanded = new Set(state.expandedFolderPaths);
    cloned.entries = cloned.entries
      .filter((entry) => !fileTreePathHasCollapsedAncestor(entry.relativePath, expanded))
      .map((entry) =>
        entry.kind === "folder"
          ? { ...entry, expanded: expanded.has(entry.relativePath) }
          : entry,
      );
    return cloned;
  }

  const thread = state.threads.find((candidate) => candidate.threadId === state.activeThreadId);
  const cwdLabel =
    thread?.scope.kind === "project"
      ? thread.scope.projectId
      : thread?.scope.scratchCwd || "tide";

  // fileTree === null while a thread is active means "not loaded yet" (just switched
  // / cleared, awaiting refresh_file_tree), which the UI renders as a loading state
  // rather than an empty folder.
  return {
    cwdLabel,
    entries: [],
    loading: state.activeThreadId !== null,
  };
}

function toThreadView(
  thread: ProductShellThread,
  state: ProductShellState,
  activeThreadHydrating = false,
): ProductShellThreadView {
  const worktreeCwd =
    thread.scope.kind === "project" && worktreeRepoRootForCwd(thread.scope.cwd) !== null
      ? thread.scope.cwd
      : null;
  return {
    ...thread,
    active: thread.threadId === state.activeThreadId,
    hydrating: thread.threadId === state.activeThreadId && activeThreadHydrating,
    archiveConfirming: state.archiveConfirmThreadId === thread.threadId,
    renaming: state.renamingThreadId === thread.threadId,
    contextMenuOpen:
      state.leftRailMenu?.kind === "thread" && state.leftRailMenu.threadId === thread.threadId,
    worktreeBranch:
      worktreeCwd === null
        ? undefined
        : (worktreeCwd.split("/").filter((seg) => seg.length > 0).pop() ?? undefined),
  };
}

export function toAgentChatThreadSummary(thread: ProductShellThread): AgentChatThreadSummary {
  const agentBinding = agentBindingForShellAgent(thread.agentId);
  return {
    threadId: thread.threadId,
    title: thread.title,
    agentBinding:
      thread.providerSessionRef === undefined
        ? agentBinding
        : { ...agentBinding, providerSessionRef: { ...thread.providerSessionRef } },
    scope: thread.scope,
    launchOptions: cloneLaunchOptions(thread.launchOptions),
    context: { worktree: "current folder", branch: "main" },
    createdAt: shellTimestamp,
    updatedAt: shellTimestamp,
    pinned: Boolean(thread.pinned),
    archived: false,
    lastKnownState: thread.running
      ? "running"
      : thread.attention
        ? "waiting_for_input"
        : "idle",
    runtimeStartedAt: thread.runtimeStartedAt,
  };
}

export function previewBlocksForThread(thread: ProductShellThread): AgentChatBlock[] {
  return [
    {
      blockId: `${thread.threadId}-preview`,
      threadId: thread.threadId,
      agentId: thread.agentId,
      kind: "agent_text",
      role: "agent",
      status: "complete",
      title: "Thread ready",
      body: `${thread.title} is loaded as a local Product Shell preview.`,
      updatedAt: shellTimestamp,
    },
  ];
}
