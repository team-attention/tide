import type { AgentChatAgentBinding, AgentChatBackendCommand, AgentChatBranchOption, AgentChatCommandOption, AgentChatShellState, AgentChatShellViewModel, AgentChatThreadScope, AgentChatUsage, AgentChatUsageView, AgentChatWorktreeOption } from "../../agent-chat/agent-chat.ts";
import type { AppChromeBackendCommand, AppChromeEditorNavigationTarget, AppChromeEditorReferenceList, AppChromeState, AppChromeViewModel, AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
import type { WorkbenchSplitNode } from "./workbench-split-tree.ts";
// Extracted from product-shell-state.ts (spec: navigable-source-structure).

export type ProductShellAgentIdentity = "codex" | "claude" | "opencode";

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
  // Local renderer-only acknowledgement state: a background thread finished and
  // notified the user, but the user has not opened that thread since.
  unread?: boolean;
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

export interface ProductShellProviderUsage {
  agentId: ProductShellAgentIdentity;
  usage: AgentChatUsage;
  observedAt?: string;
}

// A top-level pinned item: a standalone pinned Thread or a pinned Project. The Pinned
// section is ONE manually-ordered, intermixed list of these (spec:
// left-rail-manual-ordering); the order lives in ProductShellState.pinnedItemOrder.
export type ProductShellPinnedItemRef =
  | { kind: "thread"; threadId: string }
  | { kind: "project"; projectId: string };

// Legacy pre-Draft start-page file shape. Current Product Shell no longer creates
// these from user actions; files open through the Composer Draft Thread so the
// editor is a backend-owned Workbench pane. The field remains to tolerate older
// persisted/test snapshots while reducers drain it as no-op state.
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

// Legacy synthetic start-file pane id base. Kept only for migration/back-compat
// cleanup of old snapshots; current user paths create a Composer Draft Thread
// before opening an editor.
export const START_FILE_PANE_ID = "start-file";

export function startFilePaneId(relativePath: string): string {
  return `${START_FILE_PANE_ID}:${relativePath}`;
}

export function isStartFilePaneId(paneId: string): boolean {
  return paneId === START_FILE_PANE_ID || paneId.startsWith(`${START_FILE_PANE_ID}:`);
}

// A VSCode-style untitled (blank, not-yet-on-disk) file — opened immediately by
// "New File", named only on save (Save As). The transient buffer is renderer-owned,
// but it is bound to a thread (including the Composer Draft Thread) so saving
// reopens through backend `open_editor`. Spec: workbench-filetree-file-operations.
export interface ProductShellUntitledFile {
  // Synthetic, stable pane/sequence id: `untitled:<n>`.
  id: string;
  title: string;
  // The live buffer (starts ""). `dirty` is true once anything is typed.
  draft: string;
  dirty: boolean;
  // The context the untitled belongs to. Current paths set this to a real thread id;
  // null is tolerated only for old snapshots.
  threadId: string | null;
  // Absolute workspace root the file is saved under on Save As.
  scopeCwd: string;
}

export const UNTITLED_PANE_ID = "untitled";

export function untitledPaneId(sequence: number): string {
  return `${UNTITLED_PANE_ID}:${sequence}`;
}

export function isUntitledPaneId(paneId: string): boolean {
  return paneId === UNTITLED_PANE_ID || paneId.startsWith(`${UNTITLED_PANE_ID}:`);
}

// An in-progress inline FileTree edit: typing the name for a new folder under
// `parentPath`, or renaming the entry at `targetPath`. (New File is untitled, so it
// has no inline tree input.) Spec: workbench-filetree-file-operations.
export interface ProductShellTreeEdit {
  kind: "new-folder" | "rename";
  // For new-folder: the folder the new child goes under ("" = root). For rename: the
  // parent of the entry being renamed.
  parentPath: string;
  // For rename: the current relativePath of the entry being renamed.
  targetPath?: string;
  draft: string;
}

// The FileTree right-click context menu: anchored to a point, targeting one entry
// (or the root background when `targetPath` is null/`relativePath` is "").
export interface ProductShellFileTreeMenu {
  x: number;
  y: number;
  // The targeted entry; a root-background click targets relativePath "".
  relativePath: string;
  kind: "file" | "folder" | "root";
}

// The synthetic Launcher pane shown FIRST on the composer (New Thread) page, before
// any thread exists. Like START_FILE_PANE_ID it has no backend pane; the view-model
// derives it. See docs_v2/specs/workbench-dock-parity.md.
export const COMPOSER_LAUNCHER_PANE_ID = "composer-launcher";

export interface ProductShellState {
  activeThreadId: string | null;
  leftRailOpen: boolean;
  workbenchOpen: boolean;
  // The user's explicit open/closed choice for the Workbench column, per thread.
  // Switching threads otherwise re-derives `workbenchOpen` from open panes, which
  // re-opened a workbench the user had closed when they returned to the thread. No
  // entry = derive from whether the thread has panes (the first-visit default).
  workbenchOpenByThreadId: Record<string, boolean>;
  // The active workbench pane is expanded to fill the window (focus mode). The
  // left rail / chat / filetree columns are hidden while on.
  workbenchFullscreen: boolean;
  // Tab-group mode (default: one active pane + tab strip) vs split mode (panes
  // arranged in a draggable binary split-tree). Like the Tide Terminal workspace.
  workbenchLayoutMode: "stacked" | "split";
  // The split-mode layout tree (null until entering split). Reconciled against
  // the live open panes on read.
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
  // Most recent bounded file tree loaded for Composer @ mentions.
  composerFileMentions: ProductShellComposerFileMentions | null;
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
  // App/account-level provider quota snapshots. Settings reads this instead of
  // per-thread session context usage.
  providerUsage: ProductShellProviderUsage[];
  appChrome: AppChromeState;
  fileTree: ProductShellFileTreeView | null;
  // Legacy pre-Draft start-page editor files. Current UI keeps this empty and opens
  // files through the Composer Draft Thread instead.
  startPageFiles: ProductShellStartPageFile[];
  // Legacy pre-Draft start-page navigation. Current code intelligence is thread
  // Workbench scoped.
  startPagePendingNavigation: { relativePath: string; target: AppChromeEditorNavigationTarget } | null;
  // Latest project content-search (Cmd+Shift+F) results for the active thread.
  contentSearch: ProductShellContentSearch | null;
  // Renderer-only dismissals for editor reference lists, keyed by pane id and the
  // exact references payload. A fresh Find References result uses a new key.
  dismissedEditorReferenceKeys?: Record<string, string>;
  editorDrafts: Record<string, ProductShellEditorDraft>;
  nextLocalThreadNumber: number;
  // How the Left Rail thread list is grouped/sorted (persisted in the renderer).
  listSettings: ProductShellListSettings;
  // App-level worktree creation settings (persisted in the renderer).
  worktreeSettings: ProductShellWorktreeSettings;
  // Whether the Settings panel (modal) is open.
  settingsOpen: boolean;
  draftActiveWorkbenchPaneId: string | null;
  // The Composer's backend Draft Thread: a real (unstarted, no-agent) thread that hosts the
  // Terminal/Editor/Diff/Browser panes pre-send (their PTYs/files/webviews need a
  // backend thread). Created lazily on the first Launcher action, at which point it becomes
  // the ACTIVE thread (activeThreadId === draftThreadId) so the whole app operates on it
  // through the normal active-thread path; the chat stays the start Composer because
  // agentChat.thread is untouched. Discarded on chip change / leaving the Composer, and
  // started in place on Send. null when the Composer has no backend draft yet. See
  // docs_v2/specs/composer-draft-thread.md.
  draftThreadId: string | null;
  // VSCode-style untitled files (blank, named on save), one editor tab each. Shown
  // in the thread context they were created in. Spec: workbench-filetree-file-operations.
  untitledFiles: ProductShellUntitledFile[];
  // Monotonic sequence for naming Untitled-1, Untitled-2, … (never reused in a session).
  untitledSequence: number;
  // The untitled pane currently prompting for a save name (Save As bar open), or null.
  untitledSaveAsPaneId: string | null;
  // In-progress inline FileTree edit (new folder / rename), or null.
  fileTreeEdit: ProductShellTreeEdit | null;
  // Open FileTree right-click context menu, or null.
  fileTreeMenu: ProductShellFileTreeMenu | null;
  // The entry awaiting delete confirmation (confirm dialog open), or null.
  fileTreeDeleteTarget: ProductShellFileTreeMenu | null;
  // A transient FileTree error message (e.g. a name collision), or null.
  fileTreeNotice: string | null;
}

export type ProductShellBackendCommand =
  | { kind: "thread.list"; payload: { includeArchived?: boolean } }
  | { kind: "thread.hydrate"; payload: { threadId: string } }
  | {
      kind: "workspace.readFile";
      // Legacy thread-independent query. Product Shell editors now use
      // workbench.command/open_editor.
      payload: { cwd: string; path: string; byteLimit?: number; create?: boolean };
    }
  | {
      kind: "workspace.readImageFile";
      payload: { cwd: string; path: string; byteLimit?: number };
    }
  | {
      // Legacy thread-independent write. Product Shell editors now use
      // workbench.command/save_editor_file.
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
  // Composer Draft Thread (spec: composer-draft-thread). createDraft registers a backend
  // thread (no agent) so the Composer's Terminal/Editor/Diff have a thread to live in;
  // discardDraft tears it down on chip change / leaving the Composer.
  | {
      kind: "thread.createDraft";
      payload: {
        threadId: string;
        agentBinding: AgentChatAgentBinding;
        scope?: AgentChatThreadScope;
        launchOptions?: Record<string, unknown>;
      };
    }
  | { kind: "thread.discardDraft"; payload: { threadId: string } }
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
          // New File: touch a missing file before opening (spec: workbench-new-file.md).
          create?: boolean;
          // Optional navigation target used by project search and reference rows.
          line?: number;
          character?: number;
          length?: number;
          label?: string;
          sourcePaneId?: string;
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
      // Probe an agent's REAL command set for the composer menu (handshake-only).
      // The backend replies with agentRuntime.commandsChanged. See
      // docs_v2/specs/live-provider-command-mirroring.md.
      kind: "provider.discoverCommands";
      payload: { agentId: string; cwd: string };
    }
  | {
      // Run Provider Readiness for an agent on demand (Composer slot select) so its
      // install / sign-in card surfaces immediately. Backend replies providerReadiness.changed.
      // See docs_v2/specs/provider-cli-setup-handoff.md.
      kind: "provider.checkReadiness";
      payload: { threadId: string; agentId: string };
    }
  | {
      // Re-read provider-local account/rate-limit history for Settings.
      // Backend replies providerUsage.changed when it finds quota windows.
      kind: "provider.refreshUsage";
      payload: {};
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
  // True for the active row while the backend hydrate snapshot is still pending.
  // Selection is already local, but the row should not take the committed active
  // background until the Thread data has actually hydrated.
  hydrating: boolean;
  archiveConfirming: boolean;
  renaming: boolean;
  contextMenuOpen: boolean;
  // 1-based number for the Ctrl+N pin-jump badge, set on the first 9 pinned threads
  // (spec: multitask-navigation L2). Shown only while Ctrl is held (CSS-gated).
  pinNumber?: number;
  // Set when this Thread's scope cwd is a `<repo>.worktree/<branch>` worktree:
  // the branch (= worktree dir basename), shown in the row hover context so a
  // worktree Thread is identifiable without making every row multi-line.
  worktreeBranch?: string;
}

export interface ProductShellUsageModelView {
  key: string;
  agentId: string;
  agentLabel: string;
  modelLabel: string;
  threadTitle?: string;
  usage: AgentChatUsageView;
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
  // True when a child thread needs attention (waiting for input/approval) or has
  // unread completed output — used to bubble the indicator when collapsed.
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
  usageByModel: ProductShellUsageModelView[];
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

export interface ProductShellComposerFileMentions {
  cwd: string;
  entries: ProductShellFileTreeEntryView[];
  truncated?: boolean;
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
