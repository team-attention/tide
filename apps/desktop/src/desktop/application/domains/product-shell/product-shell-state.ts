import {
  applyAgentChatBackendEvent,
  createAgentChatShellState,
  createAgentChatShellViewModel,
  selectAgentChatChoiceSurfaceRow,
  setComposerActiveSurface,
  setComposerFolderScope,
  interruptComposer,
  submitComposer,
  updateComposerDraft,
  addComposerAttachment,
  removeComposerAttachment,
  type AgentChatComposerAttachment,
  type AgentChatBackendCommand,
  type AgentChatComposerSurfaceKind,
  type AgentChatBlock,
  type AgentChatBackendEvent,
  type AgentChatAgentBinding,
  type AgentChatPromptState,
  type AgentChatShellState,
  type AgentChatShellViewModel,
  type AgentChatThreadScope,
  type AgentChatThreadSummary,
  type AgentChatChoiceSurfaceView,
  type AgentChatBranchOption,
  type AgentChatWorktreeOption,
  type AgentChatCommandOption,
} from "../agent-chat/agent-chat-shell-state.ts";
import {
  applyAppChromeBackendEvent,
  closeWorkbenchPane,
  createAppChromeState,
  createAppChromeViewModel,
  focusWorkbenchPane,
  writeWorkbenchTerminalInput,
  resizeWorkbenchTerminal,
  type AppChromeBackendCommand,
  type AppChromeWorkbenchPaneRef,
  type AppChromeState,
  type AppChromeViewModel,
} from "../app-chrome/app-chrome-state.ts";
import { worktreeRepoRootForCwd } from "../../../../shared/worktree-path.ts";

export type ProductShellAgentIdentity = "codex" | "claude" | "antigravity" | "openai_api";

export type ProductShellLeftUiMenu =
  | { kind: "thread"; threadId: string }
  | { kind: "project"; projectId: string }
  | { kind: "list_settings" };

export interface ProductShellThread {
  threadId: string;
  title: string;
  agentId: ProductShellAgentIdentity;
  time: string;
  scope: AgentChatThreadScope;
  launchOptions?: Record<string, unknown>;
  workbenchPanes: AppChromeWorkbenchPaneRef[];
  pinned?: boolean;
  attention?: boolean;
  // Absolute timestamps for list sorting (the `time` field is a display string).
  createdAt?: string;
  updatedAt?: string;
}

export type ProductShellListGroupBy = "project" | "thread";
export type ProductShellListSortBy = "recent" | "created" | "name";

// User prefs for how the Left UI thread list is grouped and sorted.
// See docs_v2/specs/thread-list-display-settings.md.
export interface ProductShellListSettings {
  groupBy: ProductShellListGroupBy;
  sortBy: ProductShellListSortBy;
  groupWorktreesByRepo: boolean;
}

export const DEFAULT_PRODUCT_SHELL_LIST_SETTINGS: ProductShellListSettings = {
  groupBy: "project",
  sortBy: "recent",
  groupWorktreesByRepo: false,
};

// App-level worktree creation settings (persisted in the renderer; passed to Main
// on create). See docs_v2/specs/worktree-creation.md.
export interface ProductShellWorktreeSettings {
  // Directory pattern with {repo_root}/{branch} placeholders. Empty = v1 default
  // (`<repo>.worktree/<branch>`).
  baseDirPattern: string;
  // Repo-relative paths copied into a newly created worktree (e.g. ".env").
  copyFiles: string[];
}

export const DEFAULT_PRODUCT_SHELL_WORKTREE_SETTINGS: ProductShellWorktreeSettings = {
  baseDirPattern: "",
  copyFiles: [],
};

export interface ProductShellProject {
  projectId: string;
  name: string;
  cwd: string;
}

export interface ProductShellState {
  activeThreadId: string | null;
  leftUiOpen: boolean;
  workbenchOpen: boolean;
  fileTreeOpen: boolean;
  leftUiMenu: ProductShellLeftUiMenu | null;
  archiveConfirmThreadId: string | null;
  renamingThreadId: string | null;
  searchQuery: string;
  searchActive: boolean;
  // Project rows the user has collapsed. Projects are expanded by default; a
  // collapsed project hides its thread rows in the Left UI.
  collapsedProjectIds: string[];
  // Folder paths the user has expanded. Folders are collapsed by default. The
  // full tree is loaded upfront, so expanding only reveals loaded children.
  expandedFolderPaths: string[];
  // Projects derived from existing threads (implicit).
  projects: ProductShellProject[];
  // Projects the user explicitly opened/registered via the folder picker. These
  // persist (Main-owned registry) and appear even with no threads (Codex flow).
  registeredProjects: ProductShellProject[];
  // Real git branches/worktrees for the active Project cwd (fetched via Main IPC).
  gitBranches: AgentChatBranchOption[];
  gitWorktrees: AgentChatWorktreeOption[];
  // Real provider slash-commands/skills for the active cwd+agent (Main IPC).
  providerCommands: AgentChatCommandOption[];
  // Pinned projects (shown as shortcuts in the Pinned section) and the project
  // currently being inline-renamed.
  pinnedProjectIds: string[];
  renamingProjectId: string | null;
  // The project for which the inline "new worktree" name input is open (null =
  // none). See docs_v2/specs/worktree-creation.md.
  creatingWorktreeForProjectId: string | null;
  threads: ProductShellThread[];
  agentChat: AgentChatShellState;
  appChrome: AppChromeState;
  fileTree: ProductShellFileTreeView | null;
  editorDrafts: Record<string, ProductShellEditorDraft>;
  nextLocalThreadNumber: number;
  // How the Left UI thread list is grouped/sorted (persisted in the renderer).
  listSettings: ProductShellListSettings;
  // App-level worktree creation settings (persisted in the renderer).
  worktreeSettings: ProductShellWorktreeSettings;
  // Whether the Settings panel (modal) is open.
  settingsOpen: boolean;
}

export type ProductShellBackendCommand =
  | { kind: "thread.list"; payload: { includeArchived?: boolean } }
  | { kind: "thread.hydrate"; payload: { threadId: string } }
  | { kind: "thread.archive"; payload: { threadId: string; archived: boolean } }
  | { kind: "thread.setPinned"; payload: { threadId: string; pinned: boolean } }
  | { kind: "thread.rename"; payload: { threadId: string; title: string } }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "open_launcher" | "open_browser" | "open_terminal";
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "open_editor";
        data: {
          path: string;
        };
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "refresh_file_tree";
        data: {
          path?: string;
          maxDepth: number;
          maxEntries: number;
        };
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "save_editor_file";
        targetPaneId: string;
        data: {
          baseRevision: string;
          content: string;
        };
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "go_to_definition" | "go_to_references";
        targetPaneId: string;
        data: {
          line: number;
          character: number;
        };
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "update_browser_snapshot";
        targetPaneId: string;
        data: ProductShellBrowserSnapshot;
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "update_browser_action_result";
        targetPaneId: string;
        data: ProductShellBrowserActionResult;
      };
    }
  | AgentChatBackendCommand
  | AppChromeBackendCommand;

export interface CreateProductShellStateInput {
  includeFixtureData?: boolean;
  // Seed the persisted settings (renderer loads from localStorage).
  listSettings?: ProductShellListSettings;
  worktreeSettings?: ProductShellWorktreeSettings;
}

export interface ProductShellUpdateResult {
  state: ProductShellState;
  command: ProductShellBackendCommand | null;
}

export interface ProductShellThreadView extends ProductShellThread {
  active: boolean;
  archiveConfirming: boolean;
  renaming: boolean;
  contextMenuOpen: boolean;
}

export interface ProductShellProjectGroupView {
  projectId: string;
  name: string;
  cwd: string;
  expanded: boolean;
  contextMenuOpen: boolean;
  pinned: boolean;
  renaming: boolean;
  // True when the inline "new worktree" name input is open for this project.
  creatingWorktree: boolean;
  threads: ProductShellThreadView[];
  // True when a child thread needs attention (waiting for input/approval) — used
  // to bubble the indicator to the project row when it is collapsed.
  attention: boolean;
}

// Pinned projects render as full expandable groups, identical to the Projects
// section, so the shortcut can be expanded to reach its Threads.
export type ProductShellPinnedProjectView = ProductShellProjectGroupView;

export interface ProductShellViewModel {
  activeThreadId: string | null;
  leftUiOpen: boolean;
  workbenchOpen: boolean;
  fileTreeOpen: boolean;
  searchQuery: string;
  searchActive: boolean;
  pinnedThreads: ProductShellThreadView[];
  pinnedProjects: ProductShellPinnedProjectView[];
  projectGroups: ProductShellProjectGroupView[];
  scratchThreads: ProductShellThreadView[];
  // The active list-display settings + a flat sorted thread list for "thread"
  // group mode (project + scratch threads together). In "project" mode the
  // renderer uses projectGroups/scratchThreads; in "thread" mode it uses flatThreads.
  listSettings: ProductShellListSettings;
  worktreeSettings: ProductShellWorktreeSettings;
  settingsOpen: boolean;
  flatThreads: ProductShellThreadView[];
  agentChat: AgentChatShellViewModel;
  appChrome: AppChromeViewModel;
  fileTree: ProductShellFileTreeView;
  editorDrafts: Record<string, ProductShellEditorDraft>;
}

export interface ProductShellEditorDraft {
  paneId: string;
  baseRevision: string;
  content: string;
  dirty: boolean;
  cursorOffset?: number;
}

export interface ProductShellBrowserSnapshot {
  revision: string;
  url?: string;
  pageTitle?: string;
  bodyTextPreview?: string;
  loading: boolean;
}

export interface ProductShellBrowserActionResult extends ProductShellBrowserSnapshot {
  actionId: string;
  status: "completed" | "failed";
  message: string;
}

export interface ProductShellFileTreeView {
  root?: string;
  cwdLabel: string;
  revision?: string;
  updatedAt?: string;
  entries: ProductShellFileTreeEntryView[];
  truncated?: boolean;
}

export interface ProductShellFileTreeEntryView {
  id: string;
  name: string;
  relativePath: string;
  depth: number;
  kind: "folder" | "file";
  active?: boolean;
  expanded?: boolean;
}

const shellTimestamp = "2026-05-28T00:00:00.000Z";

const initialProjects: ProductShellProject[] = [
  { projectId: "tide", name: "tide", cwd: "/Users/eatnug/Workspace/tide" },
  { projectId: "slice", name: "slice", cwd: "/Users/eatnug/Workspace/slice" },
];

const initialThreads: ProductShellThread[] = [
  {
    threadId: "thread-master-plan",
    title: "v2 master plan implementation",
    agentId: "codex",
    time: "now",
    scope: { kind: "project", projectId: "tide", cwd: "/Users/eatnug/Workspace/tide" },
    workbenchPanes: [
      workbenchPane("pane-thread-master-plan-diff", "diff", "Master plan diff"),
    ],
    pinned: true,
  },
  {
    threadId: "thread-workbench",
    title: "Workbench MCP surface",
    agentId: "codex",
    time: "14m",
    scope: { kind: "project", projectId: "tide", cwd: "/Users/eatnug/Workspace/tide" },
    workbenchPanes: [
      workbenchPane("pane-thread-workbench-browser", "browser", "Browser preview"),
      workbenchPane("pane-thread-workbench-diff", "diff", "Review diff"),
    ],
  },
  {
    threadId: "thread-persistence",
    title: "Thread persistence cache",
    agentId: "claude",
    time: "1h",
    scope: { kind: "project", projectId: "tide", cwd: "/Users/eatnug/Workspace/tide" },
    workbenchPanes: [
      workbenchPane("pane-thread-persistence-editor", "editor", "Thread metadata"),
    ],
  },
  {
    threadId: "thread-visual",
    title: "Desktop shell visual pass",
    agentId: "antigravity",
    time: "2h",
    scope: { kind: "project", projectId: "slice", cwd: "/Users/eatnug/Workspace/slice" },
    workbenchPanes: [
      workbenchPane("pane-thread-visual-browser", "browser", "Visual preview"),
    ],
    attention: true,
  },
  {
    threadId: "thread-sketch",
    title: "Explore a compact composer",
    agentId: "codex",
    time: "yesterday",
    scope: { kind: "scratch", scratchCwd: "Scratch" },
    workbenchPanes: [],
  },
];

export function createProductShellState(
  input: CreateProductShellStateInput = {},
): ProductShellState {
  const includeFixtureData = input.includeFixtureData ?? true;
  return {
    activeThreadId: null,
    leftUiOpen: true,
    workbenchOpen: false,
    fileTreeOpen: false,
    leftUiMenu: null,
    archiveConfirmThreadId: null,
    renamingThreadId: null,
    searchQuery: "",
    searchActive: false,
    collapsedProjectIds: [],
    expandedFolderPaths: [],
    projects: includeFixtureData ? initialProjects : [],
    registeredProjects: [],
    gitBranches: [],
    gitWorktrees: [],
    providerCommands: [],
    pinnedProjectIds: [],
    renamingProjectId: null,
    creatingWorktreeForProjectId: null,
    threads: includeFixtureData ? initialThreads : [],
    agentChat: createStartAgentChatState(),
    appChrome: createAppChromeState(),
    fileTree: null,
    editorDrafts: {},
    nextLocalThreadNumber: 1,
    listSettings: input.listSettings ?? { ...DEFAULT_PRODUCT_SHELL_LIST_SETTINGS },
    worktreeSettings: input.worktreeSettings ?? { ...DEFAULT_PRODUCT_SHELL_WORKTREE_SETTINGS },
    settingsOpen: false,
  };
}

export function setProductShellWorktreeSettings(
  state: ProductShellState,
  patch: Partial<ProductShellWorktreeSettings>,
): ProductShellState {
  return { ...state, worktreeSettings: { ...state.worktreeSettings, ...patch } };
}

export function setProductShellSettingsOpen(
  state: ProductShellState,
  open: boolean,
): ProductShellState {
  return { ...state, settingsOpen: open };
}

export function setProductShellListSettings(
  state: ProductShellState,
  patch: Partial<ProductShellListSettings>,
): ProductShellState {
  return { ...state, listSettings: { ...state.listSettings, ...patch } };
}

// Open / close the inline "new worktree" name input for a project. The actual
// git worktree creation happens in Main (project registry) once a name is
// submitted. See docs_v2/specs/worktree-creation.md.
export function startProductShellWorktreeCreate(
  state: ProductShellState,
  projectId: string,
): ProductShellState {
  return { ...state, creatingWorktreeForProjectId: projectId, leftUiMenu: null };
}

export function cancelProductShellWorktreeCreate(
  state: ProductShellState,
): ProductShellState {
  return { ...state, creatingWorktreeForProjectId: null };
}

export function createProductShellViewModel(
  state: ProductShellState,
): ProductShellViewModel {
  const query = state.searchQuery.trim().toLowerCase();
  const matchesSearch = (thread: ProductShellThread): boolean =>
    query.length === 0 || thread.title.toLowerCase().includes(query);
  const searching = query.length > 0;
  const sortThreads = (threads: ProductShellThread[]): ProductShellThread[] =>
    sortProductShellThreads(threads, state.listSettings.sortBy);
  const visibleThreads = sortThreads(state.threads.filter(matchesSearch));

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
      state.leftUiMenu?.kind === "project" && state.leftUiMenu.projectId === project.projectId,
    pinned: state.pinnedProjectIds.includes(project.projectId),
    renaming: state.renamingProjectId === project.projectId,
    creatingWorktree: state.creatingWorktreeForProjectId === project.projectId,
    threads: visibleThreads
      .filter((thread) => inGroup(thread, project))
      .map((thread) => toThreadView(thread, state)),
    attention: state.threads.some(
      (thread) => inGroup(thread, project) && thread.attention === true,
    ),
  });
  // Worktree Projects folded into a repo no longer appear as their own group.
  const topLevelProjects = projects.filter((project) => !worktreeRemap.has(project.projectId));
  return {
    activeThreadId: state.activeThreadId,
    leftUiOpen: state.leftUiOpen,
    workbenchOpen: state.workbenchOpen,
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
    appChrome: createAppChromeViewModel(state.appChrome),
    fileTree: createFileTreeView(state),
    editorDrafts: state.editorDrafts,
  };
}

export function setProductShellSearchQuery(
  state: ProductShellState,
  query: string,
): ProductShellState {
  return { ...state, searchQuery: query, searchActive: true };
}

// The Left UI "Search" entry is a nav row by default (matching the canonical
// Figma frame); activating it reveals the inline filter input. Closing it
// clears any in-progress query so the row returns to its resting state.
export function toggleProductShellSearch(
  state: ProductShellState,
): ProductShellState {
  if (state.searchActive) {
    return { ...state, searchActive: false, searchQuery: "" };
  }
  return { ...state, searchActive: true };
}

// Starts a new Thread pre-scoped to Scratch (Tide-managed working dir).
export function startNewProductShellScratchThread(state: ProductShellState): ProductShellState {
  return {
    ...state,
    activeThreadId: null,
    workbenchOpen: false,
    fileTreeOpen: false,
    leftUiMenu: null,
    archiveConfirmThreadId: null,
    renamingThreadId: null,
    agentChat: createStartAgentChatState({ kind: "scratch", scratchCwd: "Scratch" }),
    appChrome: createAppChromeState(),
    fileTree: null,
    editorDrafts: {},
  };
}

export function startNewProductShellThread(
  state: ProductShellState,
  projectId?: string,
): ProductShellState {
  // Starting from a Project Row pre-scopes the Start Composer to that Project's
  // cwd, so the resulting Thread groups under the same Project Row (UC-6b).
  const project = projectId
    ? state.projects.find((candidate) => candidate.projectId === projectId)
    : undefined;
  const scope: AgentChatThreadScope | undefined = project
    ? { kind: "project", projectId: project.projectId, cwd: project.cwd }
    : undefined;
  return {
    ...state,
    activeThreadId: null,
    workbenchOpen: false,
    fileTreeOpen: false,
    leftUiMenu: null,
    archiveConfirmThreadId: null,
    renamingThreadId: null,
    agentChat: createStartAgentChatState(scope),
    appChrome: createAppChromeState(),
    fileTree: null,
    editorDrafts: {},
  };
}

export function toggleProductShellLeftUi(state: ProductShellState): ProductShellState {
  return {
    ...state,
    leftUiOpen: !state.leftUiOpen,
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

export function toggleProductShellWorkbench(state: ProductShellState): ProductShellState {
  return {
    ...state,
    workbenchOpen: !state.workbenchOpen,
  };
}

export function toggleProductShellWorkbenchWithLauncher(
  state: ProductShellState,
): ProductShellUpdateResult {
  const nextState = toggleProductShellWorkbench(state);
  if (state.workbenchOpen || state.activeThreadId === null) {
    return { state: nextState, command: null };
  }

  const hasVisiblePane = state.appChrome.workbenchPanes.some((pane) => pane.visible);
  if (hasVisiblePane) {
    return { state: nextState, command: null };
  }

  return {
    state: nextState,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "open_launcher",
      },
    },
  };
}

// Opens the Workbench (if needed) and asks Backend to open the Launcher Pane,
// the entry point for creating Browser/Terminal/Editor/Diff Panes. This is the
// "New Pane" Tab Strip action; it never closes an already-open Workbench.
export function openProductShellWorkbenchLauncher(
  state: ProductShellState,
): ProductShellUpdateResult {
  if (state.activeThreadId === null) {
    return { state, command: null };
  }
  return {
    state: { ...state, workbenchOpen: true },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "open_launcher",
      },
    },
  };
}

export function toggleProductShellFileTree(state: ProductShellState): ProductShellState {
  return {
    ...state,
    fileTreeOpen: !state.fileTreeOpen,
  };
}

export function toggleProductShellFileTreeWithRefresh(
  state: ProductShellState,
): ProductShellUpdateResult {
  const nextState = toggleProductShellFileTree(state);
  if (state.fileTreeOpen || state.activeThreadId === null) {
    return { state: nextState, command: null };
  }

  return {
    state: nextState,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "refresh_file_tree",
        data: {
          maxDepth: 12,
          maxEntries: 4000,
        },
      },
    },
  };
}

// The Projects shown in the Left UI and Project menu: the union of explicitly
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
      leftUiMenu: null,
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

// Injects the product shell's real projects/branches/worktrees into the
// agent-chat state so the composer menus list actual data (never hardcoded).
function agentChatWithProjects(state: ProductShellState): AgentChatShellState {
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

export function setProductShellProviderCommands(
  state: ProductShellState,
  commands: AgentChatCommandOption[],
): ProductShellState {
  return { ...state, providerCommands: commands };
}

export function setProductShellComposerActiveSurface(
  state: ProductShellState,
  surface: AgentChatComposerSurfaceKind | null,
): ProductShellState {
  return {
    ...state,
    agentChat: setComposerActiveSurface(state.agentChat, surface).state,
  };
}

// Scopes the Start Composer to a chip-picked folder without registering it as a
// persisted project. It surfaces in the left Projects list only once a Thread is
// started in it (thread-derived).
export function setProductShellComposerFolderScope(
  state: ProductShellState,
  cwd: string,
): ProductShellState {
  return {
    ...state,
    agentChat: setComposerFolderScope(state.agentChat, cwd).state,
  };
}

export function selectProductShellChoiceSurfaceRow(
  state: ProductShellState,
  surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
  rowId: string,
): ProductShellUpdateResult {
  const result = selectAgentChatChoiceSurfaceRow(
    agentChatWithProjects(state),
    surfaceKind,
    rowId,
    state.activeThreadId ?? undefined,
  );
  return {
    state: {
      ...state,
      agentChat: result.state,
    },
    command: result.command,
  };
}

export function selectProductShellLauncherAction(
  state: ProductShellState,
  actionId: string,
): ProductShellUpdateResult {
  if (state.activeThreadId === null) {
    return { state, command: null };
  }
  const launcher = state.appChrome.workbenchPanes.find(
    (pane) => pane.kind === "launcher" && pane.visible,
  );
  const action = launcher?.actions?.find((candidate) => candidate.actionId === actionId);
  if (action === undefined || !action.enabled) {
    return { state, command: null };
  }
  if (action.actionId === "open_terminal") {
    return {
      state,
      command: {
        kind: "workbench.command",
        payload: {
          threadId: state.activeThreadId,
          command: "open_terminal",
        },
      },
    };
  }
  if (action.actionId === "open_browser") {
    return {
      state,
      command: {
        kind: "workbench.command",
        payload: {
          threadId: state.activeThreadId,
          command: "open_browser",
        },
      },
    };
  }
  if (action.actionId === "open_editor") {
    // The Editor launcher entry is a file picker: open the FileTree column so the
    // user can choose which file to open in an Editor Pane (clicking a file row
    // dispatches open_editor for that path).
    return {
      state: {
        ...state,
        fileTreeOpen: true,
      },
      command: {
        kind: "workbench.command",
        payload: {
          threadId: state.activeThreadId,
          command: "refresh_file_tree",
          data: {
            maxDepth: 12,
            maxEntries: 4000,
          },
        },
      },
    };
  }
  return { state, command: null };
}

// Opens an arbitrary file path (e.g. a Read tool's file chip) in the Workbench
// editor, opening the Workbench column if needed.
export function openProductShellFileInEditor(
  state: ProductShellState,
  path: string,
): ProductShellUpdateResult {
  if (state.activeThreadId === null || path.length === 0) {
    return { state, command: null };
  }
  return {
    state: { ...state, workbenchOpen: true },
    command: {
      kind: "workbench.command",
      payload: { threadId: state.activeThreadId, command: "open_editor", data: { path } },
    },
  };
}

export function selectProductShellFileTreeEntry(
  state: ProductShellState,
  entryId: string,
): ProductShellUpdateResult {
  if (state.activeThreadId === null || state.fileTree === null) {
    return { state, command: null };
  }
  const entry = state.fileTree.entries.find(
    (candidate) => candidate.id === entryId || candidate.relativePath === entryId,
  );
  if (entry === undefined) {
    return { state, command: null };
  }

  // Folders toggle expansion; files open. The whole tree is already loaded, so
  // expanding only reveals already-fetched children — no backend round-trip.
  if (entry.kind === "folder") {
    const expanded = new Set(state.expandedFolderPaths);
    if (expanded.has(entry.relativePath)) {
      expanded.delete(entry.relativePath);
    } else {
      expanded.add(entry.relativePath);
    }
    const nextState = { ...state, expandedFolderPaths: [...expanded] };
    return { state: nextState, command: null };
  }

  return {
    state: {
      ...state,
      workbenchOpen: true,
    },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "open_editor",
        data: {
          path: entry.relativePath,
        },
      },
    },
  };
}

// An entry is visible only when every ancestor folder on its path is expanded.
function fileTreePathHasCollapsedAncestor(
  relativePath: string,
  expanded: ReadonlySet<string>,
): boolean {
  const parts = relativePath.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    if (!expanded.has(parts.slice(0, i).join("/"))) {
      return true;
    }
  }
  return false;
}

export function openProductShellLeftUiMenu(
  state: ProductShellState,
  menu: ProductShellLeftUiMenu | null,
): ProductShellState {
  return {
    ...state,
    leftUiMenu: menu,
    archiveConfirmThreadId: null,
  };
}

export function showProductShellThreadArchiveConfirm(
  state: ProductShellState,
  threadId: string,
): ProductShellState {
  return {
    ...state,
    leftUiMenu: null,
    archiveConfirmThreadId: threadId,
  };
}

export function clearProductShellLeftUiTransientState(
  state: ProductShellState,
): ProductShellState {
  return {
    ...state,
    leftUiMenu: null,
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
      leftUiMenu: null,
      archiveConfirmThreadId: null,
    },
    command: { kind: "thread.archive", payload: { threadId, archived: true } },
  };
}

export function startProductShellProjectRename(
  state: ProductShellState,
  projectId: string,
): ProductShellState {
  return { ...state, leftUiMenu: null, renamingProjectId: projectId };
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
  return { ...state, leftUiMenu: null, pinnedProjectIds: pinned };
}

export function startProductShellThreadRename(
  state: ProductShellState,
  threadId: string,
): ProductShellState {
  return { ...state, leftUiMenu: null, archiveConfirmThreadId: null, renamingThreadId: threadId };
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

function applyProductShellThreadRenamedEvent(
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
    state: { ...state, threads, leftUiMenu: null },
    command: { kind: "thread.setPinned", payload: { threadId, pinned: nextPinned } },
  };
}

function applyProductShellThreadPinChangedEvent(
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

function applyProductShellThreadArchivedEvent(
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

export function applyProductShellPromptState(
  state: ProductShellState,
  prompt: AgentChatPromptState | null,
): ProductShellState {
  return {
    ...state,
    agentChat: applyAgentChatBackendEvent(state.agentChat, {
      kind: "prompt.changed",
      payload: { prompt },
    }),
    appChrome: applyAppChromeBackendEvent(state.appChrome, {
      kind: "prompt.changed",
      payload: { prompt },
    }),
  };
}

export function openProductShellThread(
  state: ProductShellState,
  threadId: string,
): ProductShellState {
  const thread = state.threads.find((candidate) => candidate.threadId === threadId);
  if (!thread) {
    return state;
  }

  return hydrateProductShellThread(state, thread, previewBlocksForThread(thread));
}

export function openProductShellThreadFromLeftUi(
  state: ProductShellState,
  threadId: string,
  input: { backendTransportAvailable: boolean },
): ProductShellUpdateResult {
  if (!input.backendTransportAvailable) {
    return { state: openProductShellThread(state, threadId), command: null };
  }

  return {
    state: {
      ...state,
      leftUiMenu: null,
      archiveConfirmThreadId: null,
    },
    command: {
      kind: "thread.hydrate",
      payload: { threadId },
    },
  };
}

export function updateProductShellComposerDraft(
  state: ProductShellState,
  draft: string,
): ProductShellState {
  return {
    ...state,
    agentChat: updateComposerDraft(state.agentChat, draft).state,
  };
}

export function sendProductShellComposerDraft(
  state: ProductShellState,
): ProductShellState {
  return submitProductShellComposerDraft(state).state;
}

export function addProductShellComposerAttachment(
  state: ProductShellState,
  attachment: AgentChatComposerAttachment,
): ProductShellState {
  return {
    ...state,
    agentChat: addComposerAttachment(state.agentChat, attachment).state,
  };
}

export function removeProductShellComposerAttachment(
  state: ProductShellState,
  attachmentId: string,
): ProductShellState {
  return {
    ...state,
    agentChat: removeComposerAttachment(state.agentChat, attachmentId).state,
  };
}

export function submitProductShellComposerDraft(
  state: ProductShellState,
): ProductShellUpdateResult {
  const input = state.agentChat.composer.draft.trim();
  // A message with no text but with pasted images is still a valid send.
  if (input.length === 0 && state.agentChat.composer.attachments.length === 0) {
    return { state, command: null };
  }

  const result = submitComposer(state.agentChat);
  return {
    state: result.state === state.agentChat ? state : { ...state, agentChat: result.state },
    command: result.command,
  };
}

export function interruptProductShellRuntime(
  state: ProductShellState,
): ProductShellUpdateResult {
  const result = interruptComposer(state.agentChat);
  return {
    state: result.state === state.agentChat ? state : { ...state, agentChat: result.state },
    command: result.command,
  };
}

export function applyProductShellBackendEvent(
  state: ProductShellState,
  event: AgentChatBackendEvent,
): ProductShellState {
  const applyToActiveSurfaces = shouldApplyBackendEventToActiveSurfaces(state, event);
  const agentChat = applyToActiveSurfaces
    ? applyAgentChatBackendEvent(state.agentChat, event)
    : state.agentChat;
  const appChrome = applyToActiveSurfaces
    ? applyAppChromeBackendEvent(state.appChrome, event)
    : state.appChrome;
  const nextState = {
    ...state,
    agentChat,
    appChrome,
  };

  switch (event.kind) {
    case "thread.listed":
      return applyProductShellThreadListEvent(nextState, event);
    case "thread.started":
    case "thread.hydrated":
      return applyProductShellThreadEvent(nextState, event);
    case "thread.archived":
      return applyProductShellThreadArchivedEvent(nextState, event);
    case "thread.pinChanged":
      return applyProductShellThreadPinChangedEvent(nextState, event);
    case "thread.renamed":
      return applyProductShellThreadRenamedEvent(nextState, event);
    case "agentRuntime.stateChanged": {
      const payload = event.payload as { state?: string };
      if (!applyToActiveSurfaces) {
        return nextState;
      }
      return payload.state === "running"
        ? {
            ...nextState,
            agentChat: updateComposerDraft(nextState.agentChat, "").state,
          }
        : nextState;
    }
    case "workbench.changed": {
      const payload = event.payload as {
        threadId?: string;
        panes?: AppChromeWorkbenchPaneRef[];
        fileTree?: unknown;
      };
      if (
        state.activeThreadId !== null &&
        payload.threadId !== undefined &&
        payload.threadId !== state.activeThreadId
      ) {
        return state;
      }
      const panes = payload.panes ?? [];
      const threadId = payload.threadId ?? state.activeThreadId;
      // Only a real (non-launcher) visible pane auto-opens the workbench; an empty
      // launcher pane must not (e.g. a refresh_file_tree from opening the FileTree
      // emits workbench.changed with just the launcher — that shouldn't pop the
      // workbench open). Otherwise preserve the user's open/closed intent, and
      // close only when nothing is visible at all.
      const hasRealPane = panes.some((pane) => pane.visible && pane.kind !== "launcher");
      const anyVisible = panes.some((pane) => pane.visible);
      return {
        ...nextState,
        threads:
          threadId === null
            ? nextState.threads
            : nextState.threads.map((thread) =>
                thread.threadId === threadId
                  ? { ...thread, workbenchPanes: panes }
                  : thread,
              ),
        workbenchOpen: hasRealPane ? true : anyVisible ? nextState.workbenchOpen : false,
        fileTree:
          payload.fileTree === undefined
            ? nextState.fileTree
            : productShellFileTreeFromPayload(payload.fileTree),
        editorDrafts: reconcileEditorDrafts(nextState.editorDrafts, panes),
      };
    }
    default:
      return nextState;
  }
}

function shouldApplyBackendEventToActiveSurfaces(
  state: ProductShellState,
  event: AgentChatBackendEvent,
): boolean {
  // thread.listed updates the whole rail, never a single chat surface.
  if (event.kind === "thread.listed") {
    return true;
  }
  // Every other event (including thread.started/thread.hydrated, which carry a
  // thread summary + blocks) must only touch the active chat surface when it is
  // for the active thread. Otherwise a background thread finishing — and emitting
  // thread.hydrated with ITS blocks — overwrites the chat the user is viewing,
  // so another thread's answer appears in the wrong thread. The thread-list/state
  // update for these events still runs regardless (handled in the switch below).
  const eventThreadId = threadIdFromBackendEvent(event);
  if (eventThreadId === undefined || state.activeThreadId === null) {
    return true;
  }
  return eventThreadId === state.activeThreadId;
}

function threadIdFromBackendEvent(event: AgentChatBackendEvent): string | undefined {
  switch (event.kind) {
    case "agentRuntime.stateChanged":
    case "providerReadiness.changed":
    case "prompt.changed":
    case "agentSessionBlock.completed":
    case "workbench.changed": {
      const payload = event.payload as { threadId?: unknown };
      return typeof payload.threadId === "string" ? payload.threadId : undefined;
    }
    case "agentSessionBlock.upserted": {
      const payload = event.payload as { block?: { threadId?: unknown } };
      return typeof payload.block?.threadId === "string" ? payload.block.threadId : undefined;
    }
    case "thread.started":
    case "thread.hydrated": {
      const payload = event.payload as { thread?: { threadId?: unknown } };
      return typeof payload.thread?.threadId === "string" ? payload.thread.threadId : undefined;
    }
    default:
      return undefined;
  }
}

function applyProductShellThreadListEvent(
  state: ProductShellState,
  event: AgentChatBackendEvent,
): ProductShellState {
  const payload = event.payload as { threads?: AgentChatThreadSummary[] };
  const threads = (payload.threads ?? [])
    .filter((thread) => !thread.archived)
    .map(toProductShellThreadFromSummary);
  const activeThreadId = threads.some((thread) => thread.threadId === state.activeThreadId)
    ? state.activeThreadId
    : null;

  return {
    ...state,
    activeThreadId,
    projects: projectsFromThreads(threads),
    threads,
    leftUiMenu: null,
    archiveConfirmThreadId: null,
    fileTree: null,
    editorDrafts: {},
  };
}

export function focusProductShellWorkbenchPane(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  const result = focusWorkbenchPane(state.appChrome, paneId);
  return {
    state: {
      ...state,
      appChrome: result.state,
    },
    command: result.command,
  };
}

export function closeProductShellWorkbenchPane(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  const result = closeWorkbenchPane(state.appChrome, paneId);
  return {
    state: {
      ...state,
      appChrome: result.state,
    },
    command: result.command,
  };
}

export function writeProductShellTerminalInput(
  state: ProductShellState,
  paneId: string,
  bytes: string,
): ProductShellUpdateResult {
  const result = writeWorkbenchTerminalInput(state.appChrome, paneId, bytes);
  return {
    state: {
      ...state,
      appChrome: result.state,
    },
    command: result.command,
  };
}

export function resizeProductShellTerminal(
  state: ProductShellState,
  paneId: string,
  cols: number,
  rows: number,
): ProductShellUpdateResult {
  const result = resizeWorkbenchTerminal(state.appChrome, paneId, cols, rows);
  return {
    state: { ...state, appChrome: result.state },
    command: result.command,
  };
}

export function editProductShellWorkbenchEditorPane(
  state: ProductShellState,
  paneId: string,
  content: string,
): ProductShellState {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "editor",
  );
  if (pane === undefined || pane.truncated === true) {
    return state;
  }
  const baseContent = pane.bodyText ?? pane.bodyTextPreview ?? "";
  return {
    ...state,
    editorDrafts: {
      ...state.editorDrafts,
      [paneId]: {
        paneId,
        baseRevision: pane.revision,
        content,
        dirty: content !== baseContent,
        cursorOffset: Math.min(
          state.editorDrafts[paneId]?.cursorOffset ?? content.length,
          content.length,
        ),
      },
    },
  };
}

export function moveProductShellEditorCursor(
  state: ProductShellState,
  paneId: string,
  cursorOffset: number,
): ProductShellState {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "editor",
  );
  if (pane === undefined || pane.truncated === true) {
    return state;
  }
  const currentDraft = state.editorDrafts[paneId];
  const content = currentDraft?.content ?? pane.bodyText ?? pane.bodyTextPreview ?? "";
  const boundedOffset = Math.max(0, Math.min(Math.floor(cursorOffset), content.length));

  return {
    ...state,
    editorDrafts: {
      ...state.editorDrafts,
      [paneId]: {
        paneId,
        baseRevision: currentDraft?.baseRevision ?? pane.revision,
        content,
        dirty: currentDraft?.dirty ?? false,
        cursorOffset: boundedOffset,
      },
    },
  };
}

export function goToProductShellEditorDefinition(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "editor",
  );
  if (state.activeThreadId === null || pane === undefined || pane.truncated === true) {
    return { state, command: null };
  }
  const draft = state.editorDrafts[paneId];
  const content = draft?.content ?? pane.bodyText ?? pane.bodyTextPreview ?? "";
  const position = offsetToLineCharacter(content, draft?.cursorOffset ?? 0);

  return {
    state: {
      ...state,
      appChrome: {
        ...state.appChrome,
        activeWorkbenchPaneId: paneId,
      },
    },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "go_to_definition",
        targetPaneId: paneId,
        data: position,
      },
    },
  };
}

export function goToProductShellEditorReferences(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "editor",
  );
  if (state.activeThreadId === null || pane === undefined || pane.truncated === true) {
    return { state, command: null };
  }
  const draft = state.editorDrafts[paneId];
  const content = draft?.content ?? pane.bodyText ?? pane.bodyTextPreview ?? "";
  const position = offsetToLineCharacter(content, draft?.cursorOffset ?? 0);

  return {
    state: {
      ...state,
      appChrome: {
        ...state.appChrome,
        activeWorkbenchPaneId: paneId,
      },
    },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "go_to_references",
        targetPaneId: paneId,
        data: position,
      },
    },
  };
}

export function updateProductShellBrowserSnapshot(
  state: ProductShellState,
  paneId: string,
  snapshot: ProductShellBrowserSnapshot,
): ProductShellUpdateResult {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "browser",
  );
  if (
    state.activeThreadId === null ||
    pane === undefined ||
    snapshot.revision !== pane.revision
  ) {
    return { state, command: null };
  }

  return {
    state,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "update_browser_snapshot",
        targetPaneId: paneId,
        data: snapshot,
      },
    },
  };
}

export function updateProductShellBrowserActionResult(
  state: ProductShellState,
  paneId: string,
  result: ProductShellBrowserActionResult,
): ProductShellUpdateResult {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "browser",
  );
  if (
    state.activeThreadId === null ||
    pane === undefined ||
    result.revision !== pane.revision ||
    pane.pendingAction?.actionId !== result.actionId
  ) {
    return { state, command: null };
  }

  return {
    state,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "update_browser_action_result",
        targetPaneId: paneId,
        data: result,
      },
    },
  };
}

export function saveProductShellWorkbenchEditorPane(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "editor",
  );
  const draft = state.editorDrafts[paneId];
  if (
    state.activeThreadId === null ||
    pane === undefined ||
    pane.truncated === true ||
    draft === undefined ||
    !draft.dirty
  ) {
    return { state, command: null };
  }
  return {
    state,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "save_editor_file",
        targetPaneId: paneId,
        data: {
          baseRevision: draft.baseRevision,
          content: draft.content,
        },
      },
    },
  };
}

function toProductShellThreadFromSummary(
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
    createdAt: threadSummary.createdAt,
    updatedAt: threadSummary.updatedAt,
  };
}

// Sort threads for the Left UI list. "recent"/"created" newest-first by the
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
function formatRelativeThreadTime(iso: string | undefined): string {
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

function projectsFromThreads(threads: ProductShellThread[]): ProductShellProject[] {
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

function reconcileEditorDrafts(
  drafts: Record<string, ProductShellEditorDraft>,
  panes: AppChromeWorkbenchPaneRef[],
): Record<string, ProductShellEditorDraft> {
  const next: Record<string, ProductShellEditorDraft> = {};
  for (const pane of panes) {
    if (pane.kind !== "editor" || pane.visible === false || pane.truncated === true) {
      continue;
    }
    const draft = drafts[pane.paneId];
    if (draft === undefined) {
      continue;
    }
    const baseContent = pane.bodyText ?? pane.bodyTextPreview ?? "";
    if (draft.baseRevision === pane.revision) {
      next[pane.paneId] = draft;
      continue;
    }
    if (draft.content !== baseContent) {
      next[pane.paneId] = {
        paneId: pane.paneId,
        baseRevision: pane.revision,
        content: baseContent,
        dirty: false,
        cursorOffset: 0,
      };
    }
  }
  return next;
}

function offsetToLineCharacter(
  content: string,
  offset: number,
): { line: number; character: number } {
  const boundedOffset = Math.max(0, Math.min(Math.floor(offset), content.length));
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < boundedOffset; index += 1) {
    if (content[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return {
    line,
    character: boundedOffset - lineStart,
  };
}

function hydrateProductShellThread(
  state: ProductShellState,
  thread: ProductShellThread,
  blocks: AgentChatBlock[],
): ProductShellState {
  const threadSummary = toAgentChatThreadSummary(thread);
  const agentChat = applyAgentChatBackendEvent(createStartAgentChatState(), {
    kind: "thread.hydrated",
    payload: {
      thread: threadSummary,
      blocks,
      runtimeState: "idle",
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
      runtimeState: "idle",
      workbenchPanes: thread.workbenchPanes.filter((pane) => pane.visible),
    },
  });

  return {
    ...state,
    activeThreadId: thread.threadId,
    agentChat: updateComposerDraft(agentChat, "").state,
    appChrome,
    workbenchOpen: thread.workbenchPanes.some((pane) => pane.visible),
    leftUiMenu: null,
    archiveConfirmThreadId: null,
    fileTree: null,
    editorDrafts: {},
  };
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

  return {
    cwdLabel,
    entries: [],
  };
}

function productShellFileTreeFromPayload(
  payload: unknown,
): ProductShellFileTreeView | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const entries = Array.isArray(record.entries)
    ? record.entries.flatMap(productShellFileTreeEntryFromPayload)
    : [];
  const view: ProductShellFileTreeView = {
    cwdLabel:
      typeof record.cwdLabel === "string" && record.cwdLabel.length > 0
        ? record.cwdLabel
        : "tide",
    entries,
  };

  if (typeof record.root === "string") {
    view.root = record.root;
  }
  if (typeof record.revision === "string") {
    view.revision = record.revision;
  }
  if (typeof record.updatedAt === "string") {
    view.updatedAt = record.updatedAt;
  }
  if (typeof record.truncated === "boolean") {
    view.truncated = record.truncated;
  }

  return view;
}

function productShellFileTreeEntryFromPayload(
  payload: unknown,
): ProductShellFileTreeEntryView[] {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.relativePath !== "string" ||
    typeof record.depth !== "number" ||
    !Number.isInteger(record.depth) ||
    (record.kind !== "folder" && record.kind !== "file")
  ) {
    return [];
  }

  return [
    {
      id: record.id,
      name: record.name,
      relativePath: record.relativePath,
      depth: Math.max(0, record.depth),
      kind: record.kind,
      active: record.active === true,
    },
  ];
}

function cloneProductShellFileTree(
  fileTree: ProductShellFileTreeView,
): ProductShellFileTreeView {
  return {
    ...fileTree,
    entries: fileTree.entries.map((entry) => ({ ...entry })),
  };
}

function applyProductShellThreadEvent(
  state: ProductShellState,
  event: AgentChatBackendEvent,
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
    // A thread.started/hydrated event is a data update, NOT a focus command —
    // focus is owned by user actions (open/new thread set activeThreadId locally).
    // Only adopt the thread as active when nothing is focused yet; otherwise a
    // background thread emitting started/hydrated would steal focus and surface
    // its answer in the thread the user is currently viewing.
    activeThreadId: state.activeThreadId ?? threadSummary.threadId,
    threads,
    // Recompute projects so a thread started in a not-yet-listed project (e.g.
    // slice) appears in the rail immediately.
    projects: projectsFromThreads(threads),
    agentChat: updateComposerDraft(state.agentChat, "").state,
    workbenchOpen: shellThread.workbenchPanes.some((pane) => pane.visible),
    fileTree:
      payload.fileTree === undefined
        ? null
        : productShellFileTreeFromPayload(payload.fileTree),
  };
}

function createStartAgentChatState(scope?: AgentChatThreadScope): AgentChatShellState {
  return createAgentChatShellState({
    startOptions: {
      agentBinding: agentBindingForShellAgent("codex"),
      scope: scope ?? { kind: "project", projectId: "tide", cwd: "/Users/eatnug/Workspace/tide" },
      launchOptions: {
        model: "gpt-5.5",
        permission: "Auto-review",
        worktree: "current folder",
        branch: "main",
      },
    },
  });
}

function toThreadView(
  thread: ProductShellThread,
  state: ProductShellState,
): ProductShellThreadView {
  return {
    ...thread,
    active: thread.threadId === state.activeThreadId,
    archiveConfirming: state.archiveConfirmThreadId === thread.threadId,
    renaming: state.renamingThreadId === thread.threadId,
    contextMenuOpen:
      state.leftUiMenu?.kind === "thread" && state.leftUiMenu.threadId === thread.threadId,
  };
}

function toAgentChatThreadSummary(thread: ProductShellThread): AgentChatThreadSummary {
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
    lastKnownState: thread.attention ? "waiting_for_input" : "idle",
  };
}

function previewBlocksForThread(thread: ProductShellThread): AgentChatBlock[] {
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

function normalizeAgentId(agentId: string): ProductShellAgentIdentity {
  if (agentId === "claude" || agentId === "antigravity" || agentId === "openai_api") {
    return agentId;
  }
  return "codex";
}

function agentBindingForShellAgent(agentId: ProductShellAgentIdentity): AgentChatAgentBinding {
  if (agentId === "openai_api") {
    return {
      agentId,
      runtimeSource: { kind: "tide_api", provider: "openai" },
    };
  }
  return {
    agentId,
    runtimeSource: { kind: "provider_cli", integrationId: agentId },
  };
}

function cloneLaunchOptions(
  launchOptions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return launchOptions === undefined ? undefined : { ...launchOptions };
}

function workbenchPane(
  paneId: string,
  kind: AppChromeWorkbenchPaneRef["kind"],
  title: string,
): AppChromeWorkbenchPaneRef {
  return {
    paneId,
    kind,
    title,
    visible: true,
    revision: "preview-1",
    updatedAt: shellTimestamp,
  };
}
