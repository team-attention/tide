import type { ProductShellBackgroundBrowserPane, ProductShellEditorDraft, ProductShellEditorPickerView, ProductShellFileTreeView, ProductShellListSortBy, ProductShellPinnedItemView, ProductShellProject, ProductShellProjectGroupView, ProductShellState, ProductShellThread, ProductShellThreadView, ProductShellViewModel } from "./types.ts";
import { startFilePaneId } from "./types.ts";
import { finalizeThreadList, isExternalSessionThread, pinnedItemRefKey } from "./thread-list.ts";
import { worktreeRepoRootForCwd } from "../../../../../shared/worktree/path.ts";
import { reconcileTree } from "./workbench-split-tree.ts";
import { createAgentChatShellViewModel } from "../../agent-chat/agent-chat.ts";
import type { AgentChatBlock, AgentChatShellState, AgentChatThreadSummary } from "../../agent-chat/agent-chat.ts";
import { createAppChromeViewModel } from "../../app-chrome/app-chrome-state.ts";
import type { AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
import { cloneProductShellFileTree, fileTreePathHasCollapsedAncestor } from "./file-tree.ts";
import { appendUntitledPanes, composerWorkbenchAppChrome, startFileEditorDraft, untitledEditorDraft } from "./workbench-pane-view.ts";
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
    return buildThreadListViewModel(view);
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
  ],
  (agentChat, registeredProjects, projects, gitBranches, gitWorktrees, providerCommands) =>
    createAgentChatShellViewModel(
      agentChatWithProjects({
        agentChat,
        registeredProjects,
        projects,
        gitBranches,
        gitWorktrees,
        providerCommands,
      } as ProductShellState),
    ),
);

export interface ProductShellWorkbenchViewModel {
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
    (state: ProductShellState) => state.startPageFiles,
    (state: ProductShellState) => state.editorDrafts,
    (state: ProductShellState) => state.workbenchLayoutTree,
    (state: ProductShellState) => state.workbenchLayoutMode,
    (state: ProductShellState) => state.workbenchFullscreen,
    (state: ProductShellState) => state.fileTree,
    (state: ProductShellState) => state.editorPickerFilter,
    (state: ProductShellState) => state.draftWorkbenchPanes,
    (state: ProductShellState) => state.draftActiveWorkbenchPaneId,
    (state: ProductShellState) => state.untitledFiles,
  ],
  (
    appChrome,
    activeThreadId,
    startPageFiles,
    editorDrafts,
    workbenchLayoutTree,
    workbenchLayoutMode,
    workbenchFullscreen,
    fileTree,
    editorPickerFilter,
    draftWorkbenchPanes,
    draftActiveWorkbenchPaneId,
    untitledFiles,
  ): ProductShellWorkbenchViewModel => {
    const startFiles = activeThreadId === null ? startPageFiles : [];
    // Untitled files show only in the context (thread/start) they were created in.
    const untitledForView = untitledFiles.filter((file) => file.threadId === activeThreadId);
    // Composer (New Thread) page: there are no backend panes yet, so the view-model
    // derives the Workbench — a synthetic Launcher FIRST, then live draft Browser
    // Panes, then the start-page editor + untitled tabs. These are renderer-local
    // and get adopted by the Thread the first send creates. Inside a thread, untitled
    // tabs are appended onto the backend snapshot (never stored in it, so never
    // clobbered).
    const appChromeForView =
      activeThreadId !== null
        ? appendUntitledPanes(appChrome, untitledForView, draftActiveWorkbenchPaneId)
        : composerWorkbenchAppChrome(
            appChrome,
            draftWorkbenchPanes,
            startFiles,
            untitledForView,
            draftActiveWorkbenchPaneId,
          );
    return {
      appChrome: createAppChromeViewModel(appChromeForView),
      workbenchLayoutMode,
      workbenchFullscreen,
      // Reconcile the split tree against the panes actually shown: the real panes
      // when a thread is active, the composer-derived panes otherwise (so Split mode
      // works on the New Thread page too).
      workbenchLayoutTree: reconcileTree(
        workbenchLayoutTree,
        appChromeForView.workbenchPanes.filter((pane) => pane.visible).map((pane) => pane.paneId),
      ),
      editorPicker: createEditorPickerView({ editorPickerFilter, fileTree } as ProductShellState),
      editorDrafts:
        startFiles.length === 0 && untitledForView.length === 0
          ? editorDrafts
          : {
              ...editorDrafts,
              ...Object.fromEntries(
                startFiles.map((file) => [startFilePaneId(file.relativePath), startFileEditorDraft(file)]),
              ),
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

const selectBackgroundBrowserPanes = shellSelector(
  [
    (state: ProductShellState) => state.threads,
    (state: ProductShellState) => state.activeThreadId,
    (state: ProductShellState) => state.workbenchOpen,
    (state: ProductShellState) => state.appChrome.activeWorkbenchPaneId,
  ],
  (threads, activeThreadId, workbenchOpen, activeWorkbenchPaneId) =>
    deriveBackgroundBrowserPanes({
      threads,
      activeThreadId,
      workbenchOpen,
      appChrome: { activeWorkbenchPaneId },
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
    backgroundBrowserPanes: selectBackgroundBrowserPanes(state),
  };
}

// Stable key so a pinned item view compares by kind+id against the persisted order
// (pinnedItemRefKey, from thread-list). Spec: left-rail-manual-ordering.
function pinnedItemViewKey(item: ProductShellPinnedItemView): string {
  return item.kind === "thread" ? `t:${item.thread.threadId}` : `p:${item.project.projectId}`;
}

// Lifted out of createProductShellViewModel so selectThreadListViewModel can run the
// EXACT original Left-Rail thread-list logic (output pinned by the static render tests).
function buildThreadListViewModel(state: ProductShellState): ProductShellThreadListViewModel {
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

  const toGroup = (project: ProductShellProject): ProductShellProjectGroupView => ({
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
    threads: visibleThreads
      // Pinned threads are lifted to the Pinned section (spec: left-rail-manual-ordering),
      // so they no longer nest under their project group.
      .filter((thread) => inGroup(thread, project) && thread.pinned !== true)
      .map((thread) => toThreadView(thread, state)),
    attention: state.threads.some(
      (thread) => inGroup(thread, project) && thread.attention === true,
    ),
    running: state.threads.some(
      (thread) => inGroup(thread, project) && thread.running === true,
    ),
  });
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
      .map((thread) => ({ kind: "thread" as const, thread: toThreadView(thread, state) })),
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
    .map((thread) => toThreadView(thread, state));
  // "thread" group mode: one flat, already-sorted list of every visible thread.
  const flatThreads = visibleThreads.map((thread) => toThreadView(thread, state));
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

// Every visible agent-owned Browser Pane needs exactly one live <webview> so its
// agent-scheduled actions actually execute (otherwise tide_act_browser sits `pending`
// forever and the turn hangs). The foreground workbench hosts a webview ONLY for the
// active thread's currently-shown pane (workbench open + that pane active); every other
// visible Browser Pane — non-active threads, AND the active thread's panes that aren't
// foregrounded (workbench closed, or a different pane active) — needs an offscreen
// webview here. The one pane already foregrounded is excluded to avoid a duplicate.
// See docs_v2/specs/browser-pane-action-liveness.md.
export function deriveBackgroundBrowserPanes(
  state: Pick<ProductShellState, "threads" | "activeThreadId" | "workbenchOpen"> & {
    appChrome: Pick<ProductShellState["appChrome"], "activeWorkbenchPaneId">;
  },
): ProductShellBackgroundBrowserPane[] {
  return state.threads.flatMap((thread) => {
    const isActive = thread.threadId === state.activeThreadId;
    return thread.workbenchPanes
      .filter((pane) => pane.kind === "browser" && pane.visible)
      .filter(
        (pane) =>
          !(
            isActive &&
            state.workbenchOpen &&
            state.appChrome.activeWorkbenchPaneId === pane.paneId
          ),
      )
      .map((pane) => ({ ...pane, threadId: thread.threadId }));
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
    availableProjects: displayedProjects(state).map((project) => ({
      projectId: project.projectId,
      name: project.name,
      cwd: project.cwd,
    })),
    availableBranches: state.gitBranches,
    availableWorktrees: state.gitWorktrees,
    availableCommands: state.providerCommands,
  };
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
): ProductShellThreadView {
  const worktreeCwd =
    thread.scope.kind === "project" && worktreeRepoRootForCwd(thread.scope.cwd) !== null
      ? thread.scope.cwd
      : null;
  return {
    ...thread,
    active: thread.threadId === state.activeThreadId,
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
  return {
    threadId: thread.threadId,
    title: thread.title,
    agentBinding: agentBindingForShellAgent(thread.agentId),
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
