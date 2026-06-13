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

// The synthetic Workbench editor pane id for the start (New Thread) page's open
// file. There is no thread/backend pane to host an editor before a thread
// exists, so the view-model derives a single read/write editor pane under this
// id from `startPageFile`, and the editor draft/save/close handlers special-case
// it (keyed on a null activeThreadId). See docs_v2/specs/start-page-file-viewer.md.
export const START_FILE_PANE_ID = "start-file";

export interface ProductShellState {
  activeThreadId: string | null;
  leftRailOpen: boolean;
  workbenchOpen: boolean;
  // The active workbench pane is expanded to fill the window (focus mode). The
  // left rail / chat / filetree columns are hidden while on.
  workbenchFullscreen: boolean;
  // Tab-group mode (default: one visible pane + tab strip) vs split mode (panes
  // arranged in a draggable binary split-tree). Like the Tide Terminal workspace.
  workbenchLayoutMode: "tabs" | "split";
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
  startPageFile: ProductShellStartPageFile | null;
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
        command: "open_launcher" | "open_terminal";
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "open_browser";
        // Optional initial URL/title — set when opening the pane AT a link (a
        // chat link click). Absent for a blank "open browser" launcher action.
        data?: { url?: string; title?: string };
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
  workbenchLayoutMode: "tabs" | "split";
  workbenchLayoutTree: WorkbenchSplitNode | null;
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
