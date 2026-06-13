import type { ProductShellBackgroundBrowserPane, ProductShellEditorDraft, ProductShellEditorPickerView, ProductShellFileTreeView, ProductShellListSortBy, ProductShellProject, ProductShellProjectGroupView, ProductShellStartPageFile, ProductShellState, ProductShellThread, ProductShellThreadView, ProductShellViewModel } from "./types.ts";
import { START_FILE_PANE_ID } from "./types.ts";
import { isExternalSessionThread } from "./thread-list.ts";
import { worktreeRepoRootForCwd } from "../../../../../shared/worktree/path.ts";
import { reconcileTree } from "./workbench-split-tree.ts";
import { createAgentChatShellViewModel } from "../../agent-chat/agent-chat.ts";
import type { AgentChatBlock, AgentChatShellState, AgentChatThreadSummary } from "../../agent-chat/agent-chat.ts";
import { createAppChromeViewModel } from "../../app-chrome/app-chrome-state.ts";
import type { AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
import { cloneProductShellFileTree, fileTreePathHasCollapsedAncestor } from "./file-tree.ts";
import { agentBindingForShellAgent, cloneLaunchOptions } from "./start.ts";
import { shellTimestamp } from "./create.ts";
// Extracted from product-shell-state.ts (spec: navigable-source-structure).

export function createProductShellViewModel(
  state: ProductShellState,
): ProductShellViewModel {
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
      .filter((thread) => inGroup(thread, project))
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

  // Start (New Thread) page: the open file has no thread-bound Workbench pane, so
  // synthesize one read/write editor pane from startPageFile and render it through
  // the normal Workbench column (spec: start-page-file-viewer).
  const startFile = state.activeThreadId === null ? state.startPageFile : null;
  const appChromeForView =
    startFile === null
      ? state.appChrome
      : {
          ...state.appChrome,
          workbenchPanes: [startFileEditorPane(startFile)],
          activeWorkbenchPaneId: START_FILE_PANE_ID,
        };
  return {
    activeThreadId: state.activeThreadId,
    leftRailOpen: state.leftRailOpen,
    threadsLoaded: state.threadsLoaded,
    workbenchOpen: state.workbenchOpen,
    workbenchFullscreen: state.workbenchFullscreen,
    workbenchLayoutMode: state.workbenchLayoutMode,
    workbenchLayoutTree: reconcileTree(
      state.workbenchLayoutTree,
      state.appChrome.workbenchPanes.filter((pane) => pane.visible).map((pane) => pane.paneId),
    ),
    fileTreeOpen: state.fileTreeOpen,
    searchQuery: state.searchQuery,
    searchActive: state.searchActive,
    pinnedThreads: visibleThreads
      .filter((thread) => thread.pinned)
      .map((thread) => toThreadView(thread, state)),
    // Pinned projects render as full expandable groups (same component as the
    // Projects section), so their Threads are reachable from the Pinned shortcut.
    pinnedProjects: topLevelProjects
      .filter((project) => state.pinnedProjectIds.includes(project.projectId))
      .map(toGroup)
      .filter((group) => !searching || group.threads.length > 0),
    projectGroups: topLevelProjects
      .map(toGroup)
      // While searching, hide project groups with no matching threads.
      .filter((group) => !searching || group.threads.length > 0),
    scratchThreads: visibleThreads
      .filter((thread) => thread.scope.kind === "scratch")
      .map((thread) => toThreadView(thread, state)),
    listSettings: state.listSettings,
    worktreeSettings: state.worktreeSettings,
    settingsOpen: state.settingsOpen,
    // "thread" group mode: one flat, already-sorted list of every visible thread.
    flatThreads: visibleThreads.map((thread) => toThreadView(thread, state)),
    agentChat: createAgentChatShellViewModel(agentChatWithProjects(state)),
    appChrome: createAppChromeViewModel(appChromeForView),
    fileTree: createFileTreeView(state),
    contentSearch: state.contentSearch,
    editorPicker: createEditorPickerView(state),
    editorDrafts:
      startFile === null
        ? state.editorDrafts
        : { ...state.editorDrafts, [START_FILE_PANE_ID]: startFileEditorDraft(startFile) },
    // Visible Browser Panes that need an offscreen live <webview> so a background
    // agent can drive its own Browser Pane (observe / act) without a visible view.
    backgroundBrowserPanes: deriveBackgroundBrowserPanes(state),
  };
}

// The start (New Thread) page's open file, as a Workbench editor pane. There is
// no thread/backend pane before a thread exists, so this single pane is derived
// from startPageFile each render; the editor's draft/save/close handlers
// special-case START_FILE_PANE_ID. A truncated read stays read-only.
function startFileEditorPane(file: ProductShellStartPageFile): AppChromeWorkbenchPaneRef {
  const name = file.relativePath.slice(file.relativePath.lastIndexOf("/") + 1);
  return {
    paneId: START_FILE_PANE_ID,
    kind: "editor",
    title: name,
    visible: true,
    // Stable: the editor is value-controlled, so the revision only identifies the
    // pane; it never drives a remount here.
    revision: START_FILE_PANE_ID,
    updatedAt: shellTimestamp,
    relativePath: file.relativePath,
    filePath: `${file.cwd.replace(/\/+$/, "")}/${file.relativePath}`,
    bodyText: file.content,
    truncated: file.truncated,
    navigationTarget: file.navigationTarget,
    references: file.references,
  };
}

function startFileEditorDraft(file: ProductShellStartPageFile): ProductShellEditorDraft {
  return {
    paneId: START_FILE_PANE_ID,
    baseRevision: START_FILE_PANE_ID,
    content: file.draft ?? file.content,
    dirty: file.dirty ?? false,
    cursorOffset: 0,
  };
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
