import type { AgentChatBackendCommand, AgentChatBranchOption, AgentChatCommandOption, AgentChatShellState, AgentChatShellViewModel, AgentChatThreadScope, AgentChatWorktreeOption } from "../../agent-chat/agent-chat.ts";
import type { AppChromeBackendCommand, AppChromeEditorNavigationTarget, AppChromeEditorReferenceList, AppChromeState, AppChromeViewModel, AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
import type { WorkbenchSplitNode } from "./workbench-split-tree.ts";
// Extracted from product-shell-state.ts (spec: navigable-source-structure).

export type ProductShellAgentIdentity = "codex" | "claude" | "gemini" | "opencode" | "openai_api";

export type ProductShellLeftRailMenu =
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
  // True while this thread's agent runtime is actively running — shown as a live
  // rail indicator for every thread (incl. background ones), independent of focus.
  running?: boolean;
  // True while a runtime for this thread is hydrated/alive in THIS process, whatever
  // its state (running OR waiting OR idle-but-alive) — the set the multitask switcher
  // (Ctrl+Tab) cycles. Distinct from `running` (mid-turn only). Absent ⇒ false.
  live?: boolean;
  // When the current turn started (from the backend). Carried so the Working timer
  // shows real elapsed time even after switching threads, instead of resetting.
  runtimeStartedAt?: string;
  // Absolute timestamps for list sorting (the `time` field is a display string).
  createdAt?: string;
  updatedAt?: string;
}

export type ProductShellListGroupBy = "project" | "thread";

export type ProductShellListSortBy = "recent" | "created" | "name";

// User prefs for how the Left Rail thread list is grouped and sorted.
// See docs_v2/specs/thread-list-display-settings.md.
export interface ProductShellListSettings {
  groupBy: ProductShellListGroupBy;
  sortBy: ProductShellListSortBy;
  groupWorktreesByRepo: boolean;
  // When false (default), the list shows only Threads started in Tide. When true,
  // it also shows External Sessions — agent sessions found in the provider's local
  // history that Tide did not start (surfaced as `adopted-*` Threads).
  showExternalSessions: boolean;
}

export const DEFAULT_PRODUCT_SHELL_LIST_SETTINGS: ProductShellListSettings = {
  groupBy: "project",
  sortBy: "recent",
  // Worktree Threads nest under their parent repo Project by default; the new
  // worktree start flow scopes new work to a `<repo>.worktree/<branch>` cwd, and
  // a per-worktree top-level Project would fragment the repo's threads. The Left
  // UI "Group under repo" toggle can flip this off. See
  // docs_v2/specs/worktree-start-experience.md (supersedes the prior default).
  groupWorktreesByRepo: true,
  showExternalSessions: false,
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

// A top-level pinned item: a standalone pinned Thread or a pinned Project. The Pinned
// section is ONE manually-ordered, intermixed list of these (spec:
// left-rail-manual-ordering); the order lives in ProductShellState.pinnedItemOrder.
export type ProductShellPinnedItemRef =
  | { kind: "thread"; threadId: string }
  | { kind: "project"; projectId: string };

export interface ProductShellStartPageFile {
  cwd: string;
  relativePath: string;
  // The file as it is on disk (the editor's save base). Updated on load + save.
  content: string;
  // Truncated reads are partial, so they stay read-only — saving would clobber
  // the unread tail.
  truncated: boolean;
  // The live (possibly unsaved) editor buffer; undefined = clean (showing
  // `content`). `dirty` is true when `draft` diverges from `content`.
  draft?: string;
  dirty?: boolean;
  // Go-to-definition result for the editor to scroll/select to (same-file jump,
  // or carried in after a cross-file open).
  navigationTarget?: AppChromeEditorNavigationTarget;
  // Find-references result rendered as the editor's references panel.
  references?: AppChromeEditorReferenceList;
}

// The synthetic Workbench editor pane id base for the start (New Thread) page's
// open files. There is no thread/backend pane to host an editor before a thread
// exists, so the view-model derives one read/write editor pane PER open file from
// `startPageFiles`, each under a per-path id (`start-file:<relativePath>`), and the
// editor draft/save/close handlers special-case start-file panes (keyed on a null
// activeThreadId). The bare base is kept for back-compat / prefix checks.
// See docs_v2/specs/start-page-file-viewer.md.
export const START_FILE_PANE_ID = "start-file";

// A start-page editor pane id is per-file (so opening a second file is a new tab,
// not a replace; reopening the same file focuses the existing tab).
export function startFilePaneId(relativePath: string): string {
  return `${START_FILE_PANE_ID}:${relativePath}`;
}

export function isStartFilePaneId(paneId: string): boolean {
  return paneId === START_FILE_PANE_ID || paneId.startsWith(`${START_FILE_PANE_ID}:`);
}

// The synthetic Launcher pane shown FIRST on the composer (New Thread) page, before
// any thread exists. Like START_FILE_PANE_ID it has no backend pane; the view-model
// derives it. See docs_v2/specs/workbench-dock-parity.md.
export const COMPOSER_LAUNCHER_PANE_ID = "composer-launcher";

// A pane the user opened on the composer (New Thread) page, before any thread
// exists. Rendered live in the renderer (a Browser Pane owns its own <webview>);
// adopted by the Thread the first send creates (seeded via thread.start). Only
// browsers are supported pre-thread (editor uses startPageFile; terminal/diff need
// a thread).
export interface ProductShellDraftPane {
  paneId: string;
  kind: "browser";
  title: string;
  url?: string;
}

export interface ProductShellState {
  activeThreadId: string | null;
  leftRailOpen: boolean;
  workbenchOpen: boolean;
  // The user's explicit open/closed choice for the Workbench column, per thread.
  // Switching threads otherwise re-derives `workbenchOpen` from pane visibility, which
  // re-opened a workbench the user had closed when they returned to the thread. No
  // entry = derive from pane visibility (the first-visit default).
  workbenchOpenByThreadId: Record<string, boolean>;
  // The active workbench pane is expanded to fill the window (focus mode). The
  // left rail / chat / filetree columns are hidden while on.
  workbenchFullscreen: boolean;
  // Tab-group mode (default: one visible pane + tab strip) vs split mode (panes
  // arranged in a draggable binary split-tree). Like the Tide Terminal workspace.
  workbenchLayoutMode: "stacked" | "split";
  // The split-mode layout tree (null until entering split). Reconciled against
  // the live visible panes on read.
  workbenchLayoutTree: WorkbenchSplitNode | null;
  fileTreeOpen: boolean;
  leftRailMenu: ProductShellLeftRailMenu | null;
  archiveConfirmThreadId: string | null;
  renamingThreadId: string | null;
  searchQuery: string;
  searchActive: boolean;
  // Project rows the user has collapsed. Projects are expanded by default; a
  // collapsed project hides its thread rows in the Left Rail.
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
  // Manual order of the Pinned section's top-level items (pinned threads + pinned
  // projects, intermixed) and of the Projects section's folders — both independent of
  // sortBy and persisted. Ids absent from an array fall to the end. Nested threads
  // always follow sortBy. Spec: left-rail-manual-ordering.
  pinnedItemOrder: ProductShellPinnedItemRef[];
  projectOrder: string[];
  renamingProjectId: string | null;
  // The project for which the inline "new worktree" name input is open (null =
  // none). See docs_v2/specs/worktree-creation.md.
  creatingWorktreeForProjectId: string | null;
  threads: ProductShellThread[];
  // False until the first thread.listed arrives, so a cold boot shows a rail skeleton
  // instead of a flash of "empty". Once listed (even with zero threads) it stays true.
  threadsLoaded: boolean;
  // When non-null, the Workbench Launcher shows an in-pane file picker (the string is
  // the current filter text) so "Editor" picks a file to open right where you clicked.
  editorPickerFilter: string | null;
  // The active thread's agent-chat state (what is rendered).
  agentChat: AgentChatShellState;
  // Per-thread agent-chat state, keyed by threadId. Each thread's content (blocks,
  // readiness blocker, prompt, composer draft) lives here independently, so switching
  // threads is a pure selection — it never mutates or loses another thread's state.
  // Switching preserves the current `agentChat` here and restores the target's.
  agentChatByThreadId: Record<string, AgentChatShellState>;
  appChrome: AppChromeState;
  fileTree: ProductShellFileTreeView | null;
  // The start (New Thread) page's open editor file — a thread-independent
  // read/write of one file under the composer-selected project (spec:
  // start-page-file-viewer). Null when nothing is open.
  // Open files on the start (New Thread) page, one editor tab each (no thread yet).
  startPageFiles: ProductShellStartPageFile[];
  // A cross-file go-to-definition target awaiting its file load: set when the
  // definition is in a DIFFERENT file (we dispatch workspace.readFile first), and
  // consumed by workspace.fileLoaded to scroll the newly-opened file to it.
  startPagePendingNavigation: { relativePath: string; target: AppChromeEditorNavigationTarget } | null;
  // Latest project content-search (Cmd+Shift+F) results for the active thread.
  contentSearch: ProductShellContentSearch | null;
  editorDrafts: Record<string, ProductShellEditorDraft>;
  nextLocalThreadNumber: number;
  // How the Left Rail thread list is grouped/sorted (persisted in the renderer).
  listSettings: ProductShellListSettings;
  // App-level worktree creation settings (persisted in the renderer).
  worktreeSettings: ProductShellWorktreeSettings;
  // Whether the Settings panel (modal) is open.
  settingsOpen: boolean;
  // Composer (New Thread) page Workbench, used only while activeThreadId === null:
  // panes opened from the Launcher before any thread exists. Adopted by the Thread
  // the first send creates, then cleared. See docs_v2/specs/workbench-dock-parity.md.
  draftWorkbenchPanes: ProductShellDraftPane[];
  draftActiveWorkbenchPaneId: string | null;
}

export type ProductShellBackendCommand =
  | { kind: "thread.list"; payload: { includeArchived?: boolean } }
  | { kind: "thread.hydrate"; payload: { threadId: string } }
  | {
      kind: "workspace.readFile";
      payload: { cwd: string; path: string; byteLimit?: number };
    }
  | {
      // Start-page editor save (thread-independent write under the composer cwd).
      kind: "workspace.writeFile";
      payload: { cwd: string; path: string; content: string; byteLimit?: number };
    }
  | {
      kind: "workspace.readFileTree";
      payload: { cwd: string; expandedPaths?: string[]; maxDepth?: number; maxEntries?: number };
    }
  | {
      kind: "workspace.searchContent";
      payload: { cwd: string; query: string; maxResults?: number; maxFiles?: number };
    }
  | {
      // Editor language-intelligence query (spec:
      // workbench-editor-language-intelligence). Answered by a
      // workspace.codeIntelResult event returned to the CALLER (the awaiting
      // CodeMirror extension) — the result never enters shell state.
      kind: "workspace.codeIntel";
      payload: {
        cwd: string;
        path: string;
        kind: "completion" | "hover" | "highlights" | "signature" | "diagnostics" | "definition" | "references";
        content?: string;
        line?: number;
        character?: number;
      };
    }
  | { kind: "thread.archive"; payload: { threadId: string; archived: boolean } }
  | { kind: "thread.setPinned"; payload: { threadId: string; pinned: boolean } }
  | { kind: "thread.rename"; payload: { threadId: string; title: string } }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "open_launcher" | "open_terminal" | "open_diff";
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "open_browser";
        // Optional initial URL/title — set when opening the pane AT a link (a
        // chat link click). Absent for a blank "open browser" launcher action.
        // disposition "new_browser_pane" forces a fresh pane (Launcher Browser
        // action, cmd/ctrl+click); default reuses the active Browser Pane.
        data?: { url?: string; title?: string; disposition?: "new_browser_pane" | "reuse_active_browser" };
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "set_layout_mode";
        data: { mode: "stacked" | "split" };
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
          // Lazy mode: descend only into these expanded folders. Quick Open omits
          // it and passes maxDepth for the depth-bounded full walk.
          expandedPaths?: string[];
          maxDepth?: number;
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
          // The pane's live draft content when dirty — the backend resolves
          // against what's on screen instead of the file on disk.
          content?: string;
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
  // Seed the persisted Left Rail manual order (spec: left-rail-manual-ordering).
  pinnedItemOrder?: ProductShellPinnedItemRef[];
  projectOrder?: string[];
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
  // 1-based number for the Ctrl+N pin-jump badge, set on the first 9 pinned threads
  // (spec: multitask-navigation L2). Shown only while Ctrl is held (CSS-gated).
  pinNumber?: number;
  // Set when this Thread's scope cwd is a `<repo>.worktree/<branch>` worktree:
  // the branch (= worktree dir basename), shown as a badge so a worktree Thread
  // is identifiable when nested under its parent repo's group.
  worktreeBranch?: string;
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
  // True when a child thread's agent is actively running — bubbled to a collapsed
  // project row so background activity is visible without expanding.
  running: boolean;
}

// Pinned projects render as full expandable groups, identical to the Projects
// section, so the shortcut can be expanded to reach its Threads.
export type ProductShellPinnedProjectView = ProductShellProjectGroupView;

// One entry in the intermixed, manually-ordered Pinned section (spec:
// left-rail-manual-ordering) — a pinned Thread row or a pinned Project group.
export type ProductShellPinnedItemView =
  | { kind: "thread"; thread: ProductShellThreadView }
  | { kind: "project"; project: ProductShellProjectGroupView };

// A non-active thread's Browser Pane, carried with its owning threadId so its
// offscreen <webview> can route snapshots/actions back to the right thread.
export type ProductShellBackgroundBrowserPane = AppChromeWorkbenchPaneRef & {
  threadId: string;
};

export interface ProductShellEditorPickerFileView {
  relativePath: string;
  name: string;
  depth: number;
}

export interface ProductShellEditorPickerView {
  filter: string;
  files: ProductShellEditorPickerFileView[];
}

export interface ProductShellViewModel {
  activeThreadId: string | null;
  leftRailOpen: boolean;
  // False on a cold boot until the first thread list arrives — drives the rail skeleton.
  threadsLoaded: boolean;
  workbenchOpen: boolean;
  workbenchFullscreen: boolean;
  workbenchLayoutMode: "stacked" | "split";
  workbenchLayoutTree: WorkbenchSplitNode | null;
  fileTreeOpen: boolean;
  searchQuery: string;
  searchActive: boolean;
  pinnedThreads: ProductShellThreadView[];
  pinnedProjects: ProductShellPinnedProjectView[];
  // The Pinned section as one manually-ordered, intermixed list (threads + projects).
  pinnedItems: ProductShellPinnedItemView[];
  projectGroups: ProductShellProjectGroupView[];
  scratchThreads: ProductShellThreadView[];
  // The active list-display settings + a flat sorted thread list for "thread"
  // group mode (project + scratch threads together). In "project" mode the
  // renderer uses projectGroups/scratchThreads; in "thread" mode it uses flatThreads.
  listSettings: ProductShellListSettings;
  worktreeSettings: ProductShellWorktreeSettings;
  settingsOpen: boolean;
  flatThreads: ProductShellThreadView[];
  // Threads with a live in-process runtime, in Left Rail render order — the set the
  // multitask switcher (⌥Tab) cycles. See specs/multitask-navigation.md.
  liveThreads: ProductShellThreadView[];
  // The ⌥1..9 jump targets: first 9 threads in Left Rail render order (index N-1 = ⌥N).
  numberedThreads: ProductShellThreadView[];
  agentChat: AgentChatShellViewModel;
  appChrome: AppChromeViewModel;
  fileTree: ProductShellFileTreeView;
  contentSearch: ProductShellContentSearch | null;
  // In-pane editor file picker (the Workbench Launcher's "Editor" mode), or null.
  editorPicker: ProductShellEditorPickerView | null;
  // Browser Panes of non-active threads, kept alive offscreen for background agents.
  backgroundBrowserPanes: ProductShellBackgroundBrowserPane[];
  editorDrafts: Record<string, ProductShellEditorDraft>;
}

export interface ProductShellEditorDraft {
  paneId: string;
  baseRevision: string;
  content: string;
  dirty: boolean;
  cursorOffset?: number;
}

export interface ProductShellBrowserScreenshot {
  data: string;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface ProductShellBrowserSnapshot {
  revision: string;
  url?: string;
  pageTitle?: string;
  bodyTextPreview?: string;
  loading: boolean;
  // Pixel-vision capture (webview.capturePage), cached backend-side for
  // tide_observe_browser mode=screenshot|both. Omitted from backend→renderer snapshots.
  screenshot?: ProductShellBrowserScreenshot;
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
  // True while the tree for the active thread is being (re)loaded — e.g. right after
  // a thread switch cleared it — so the UI can show a skeleton instead of "empty".
  loading?: boolean;
  // The folder whose children are being lazily fetched (an expand round-trip is in
  // flight); the UI shows a skeleton child row under it. Cleared when the next
  // FileTree payload replaces this view.
  loadingFolderPath?: string | null;
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

export interface ProductShellContentSearchMatch {
  relativePath: string;
  line: number;
  column: number;
  lineText: string;
}

export interface ProductShellContentSearch {
  query: string;
  matches: ProductShellContentSearchMatch[];
  fileCount: number;
  truncated: boolean;
}

// Where a backend event came from. "command" events are the direct response to a
// user action in THIS shell (open/start/send) and own focus + the active surface.
// "broadcast" events are pushed asynchronously (including other threads running in
// the background) and must never populate a surface they don't belong to.
export type ProductShellBackendEventSource = "command" | "broadcast";
