import type { AgentChatBackendEvent, AgentChatChoiceSurfaceView, AgentChatCommandOption, AgentChatComposerSurfaceKind } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { DropZone, ProductShellBackendCommand, ProductShellBrowserActionResult, ProductShellBrowserSnapshot, ProductShellFileTreeMenu, ProductShellLeftRailMenu, ProductShellListSettings, ProductShellState, ProductShellWorktreeSettings } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { TideThemePreference } from "../../support/theme.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export interface ProjectRegistryEntry {
  projectId: string;
  name: string;
  cwd: string;
}

// Native folder picker + persisted project registry, provided by the renderer
// entry from the Main process (absent in tests / non-Electron contexts).
export interface GitContextResult {
  isGitRepo: boolean;
  currentBranch: string | null;
  branches: { name: string; kind: "local" | "remote"; current: boolean }[];
  worktrees: { path: string; branch: string | null; current: boolean }[];
}

export type GitChangeStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface GitChangesResult {
  isGitRepo: boolean;
  files: { path: string; status: GitChangeStatus; additions?: number; deletions?: number }[];
}

// Branch + uncommitted files for the Changes pane (self-fetched from the pane's cwd).
export interface GitChangesViewResult {
  isGitRepo: boolean;
  branch: string | null;
  files: { path: string; status: GitChangeStatus; additions?: number; deletions?: number }[];
}

export interface ProjectRegistryBridge {
  openDirectory(): Promise<string | null>;
  listProjects(): Promise<ProjectRegistryEntry[]>;
  registerProject(cwd: string): Promise<ProjectRegistryEntry[]>;
  unregisterProject(cwd: string): Promise<ProjectRegistryEntry[]>;
  renameProject(cwd: string, name: string): Promise<ProjectRegistryEntry[]>;
  revealInFinder(cwd: string): Promise<void>;
  createWorktree(
    cwd: string,
    name: string,
    options?: { baseDirPattern?: string; copyFiles?: string[]; baseBranch?: string },
  ): Promise<{ entries: ProjectRegistryEntry[]; createdCwd: string | null }>;
  removeWorktree(cwd: string): Promise<{ entries: ProjectRegistryEntry[] }>;
  worktreeInfo(cwd: string): Promise<{
    repoRoot: string | null;
    branch: string | null;
    branchMerged: boolean;
    isWorktree: boolean;
  }>;
  deleteWorktree(
    cwd: string,
    options: { deleteBranch: boolean; force: boolean },
  ): Promise<{
    entries: ProjectRegistryEntry[];
    worktreeRemoved: boolean;
    branch: string | null;
    branchDeleted: boolean;
  }>;
  // Standalone local-branch delete (no worktree). branchInfo drives the confirm
  // dialog's unmerged warning; deleteBranch runs `git branch -d|-D`. See
  // docs_v2/specs/branch-deletion-from-picker.md.
  branchInfo(cwd: string, branch: string): Promise<{ exists: boolean; merged: boolean }>;
  deleteBranch(
    cwd: string,
    branch: string,
    options: { force: boolean },
  ): Promise<{ deleted: boolean; branch: string | null }>;
  gitContext(cwd: string): Promise<GitContextResult>;
  gitChanges(cwd: string): Promise<GitChangesResult>;
  gitFileDiff(cwd: string, relPath: string): Promise<string>;
  listCommands(cwd: string, agentId: string): Promise<AgentChatCommandOption[]>;
  // Structural FileTree mutations (Main-owned). `root` is the absolute workspace
  // root; paths are workspace-relative. Trash is the recoverable OS Trash.
  fsCreateFile(root: string, relativePath: string, content: string): Promise<WorkspaceFsResult>;
  fsCreateFolder(root: string, relativePath: string): Promise<WorkspaceFsResult>;
  fsMove(root: string, fromRel: string, toRel: string): Promise<WorkspaceFsResult>;
  fsTrash(root: string, relativePath: string): Promise<WorkspaceFsResult>;
}

// Result of a structural FileTree mutation, returned by Main (mirrors
// WorkspaceFsResult in main/workspace-fs.ts). Spec: workbench-filetree-file-operations.
export type WorkspaceFsResult =
  | { ok: true; relativePath: string }
  | { ok: false; code: string; message: string };

export interface TideProductShellProps {
  initialState?: ProductShellState;
  onBackendCommand?: (
    command: ProductShellBackendCommand,
  ) => Promise<AgentChatBackendEvent[]> | AgentChatBackendEvent[] | void;
  onBackendEvent?: (listener: (event: AgentChatBackendEvent) => void) => (() => void) | undefined;
  projectBridge?: ProjectRegistryBridge;
}

// Screen rect of a context-menu trigger, used to anchor the menu as a fixed
// popover so it is not clipped by the left rail's scroll overflow.
export interface MenuAnchorRect {
  left: number;
  top: number;
  bottom: number;
  right: number;
}

export interface ProductShellHandlers {
  onNewThread: () => void;
  onNewThreadInProject: (projectId: string) => void;
  onProjectToggle: (projectId: string) => void;
  onThreadSelect: (threadId: string) => void;
  onLeftRailToggle: () => void;
  onWorkbenchToggle: () => void;
  onWorkbenchFullscreenToggle: () => void;
  // Explicit Stacked/Split selection (segmented control), and per-pane maximize
  // (Split → Stacked focused on that pane — v1 header-maximize parity).
  onWorkbenchSetLayout: (mode: "stacked" | "split") => void;
  onWorkbenchMaximizePane: (paneId: string) => void;
  onWorkbenchPaneDrop: (draggedPaneId: string, targetPaneId: string, zone: DropZone) => void;
  onWorkbenchSplitRatio: (path: ("a" | "b")[], ratio: number) => void;
  onNewWorkbenchPane: () => void;
  onFileTreeToggle: () => void;
  onResizeStart: (
    edge: "left" | "workbench" | "fileTree",
    event: { clientX: number; preventDefault: () => void },
  ) => void;
  onDraftChange: (draft: string) => void;
  // Attach a content reference (editor selection, terminal output, browser, a
  // quoted message) to the composer as a removable chip.
  onAddContentToChat: (chip: { kind: "code" | "terminal" | "browser" | "message"; label: string; text: string }) => void;
  onRemoveContextChip: (id: string) => void;
  onSetContextChipComment: (id: string, comment: string) => void;
  onAnswerPromptText: (value: string) => void;
  onSubmit: () => void;
  onInterrupt: () => void;
  onEditQueued: (index: number) => void;
  onRemoveQueued: (index: number) => void;
  onResend: (text: string) => void;
  onQuote: (text: string) => void;
  onComposerSurfaceChange: (surface: AgentChatComposerSurfaceKind | null) => void;
  onChoiceSurfaceRowSelect: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void;
  // Set an opencode vendor's API key (the on-ramp panel's in-app key field) the
  // canonical way — backend PUTs it to opencode's own server.
  onOpencodeConnectApiKey: (vendorId: string, key: string) => void;
  onOpenFile: (path: string) => void;
  onOpenBrowserPane: (url: string, options?: { newPane?: boolean }) => void;
  onAddAttachment: (attachment: {
    name: string;
    mediaType: string;
    dataBase64: string;
  }) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onLauncherAction: (actionId: string) => void;
  // Open the read-only git Changes view (working-tree diff). Wired to the launcher's
  // Diff action + the top-bar branch badge. Inside a thread it opens the backend singleton
  // pane; on the composer (no thread) `cwd` opens a renderer-local draft Changes pane.
  // Spec: git-changes-view.
  onOpenChanges: (cwd?: string) => void;
  // The Changes pane self-fetches its data from its cwd (Main-process git).
  onGitChanges: (cwd: string) => Promise<GitChangesViewResult>;
  onGitFileDiff: (cwd: string, relPath: string) => Promise<string>;
  onEditorPickerFilter: (filter: string) => void;
  onEditorPickerSelect: (relativePath: string) => void;
  onLeftRailMenuOpen: (menu: ProductShellLeftRailMenu | null, rect?: MenuAnchorRect) => void;
  isSectionCollapsed: (title: string) => boolean;
  onToggleSection: (title: string) => void;
  onListSettingsChange: (patch: Partial<ProductShellListSettings>) => void;
  onProjectRevealInFinder: (projectId: string) => void;
  onProjectArchiveChats: (projectId: string) => void;
  onProjectRemove: (projectId: string) => void;
  onProjectDeleteWorktree: (projectId: string) => void;
  // A project that still has threads can't be "removed" (it's re-derived from
  // those threads) — so the menu only offers Remove when this returns true.
  isProjectRemovable: (projectId: string) => boolean;
  isProjectWorktree: (projectId: string) => boolean;
  onProjectPinToggle: (projectId: string) => void;
  // Drag-reorder of top-level rail items (spec: left-rail-manual-ordering). Keys are
  // `t:<threadId>` / `p:<projectId>` for the Pinned section; project ids for Projects.
  onReorderPinnedItem: (draggedKey: string, targetKey: string) => void;
  onReorderProject: (draggedProjectId: string, targetProjectId: string) => void;
  onProjectRenameStart: (projectId: string) => void;
  onProjectRenameSubmit: (projectId: string, name: string) => void;
  onProjectRenameCancel: () => void;
  onProjectCreateWorktree: (projectId: string) => void;
  onProjectCreateWorktreeSubmit: (projectId: string, name: string) => void;
  onProjectCreateWorktreeCancel: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onWorktreeSettingsChange: (patch: Partial<ProductShellWorktreeSettings>) => void;
  onThemeChange: (pref: TideThemePreference) => void;
  onPinnedProjectSelect: (projectId: string) => void;
  onAddProject: () => void;
  onNewScratchThread: () => void;
  onThreadArchiveIntent: (threadId: string) => void;
  onThreadArchiveConfirm: (threadId: string) => void;
  onThreadPinToggle: (threadId: string) => void;
  // The branch of the worktree a Thread runs in, or null when the Thread is not
  // in a (default-rule) worktree — drives the "Delete worktree" menu item.
  threadWorktreeBranch: (threadId: string) => string | null;
  onThreadDeleteWorktree: (threadId: string) => void;
  onThreadRenameStart: (threadId: string) => void;
  onThreadRenameSubmit: (threadId: string, title: string) => void;
  onThreadRenameCancel: () => void;
  onSearchQueryChange: (query: string) => void;
  onSearchToggle: () => void;
  onLeftRailTransientClear: () => void;
  onFocusWorkbenchPane: (paneId: string) => void;
  onCloseWorkbenchPane: (paneId: string) => void;
  onFileTreeEntryOpen: (entryId: string) => void;
  // New File: create a blank file at the given relative path under the current folder
  // and open it for editing (spec: workbench-new-file.md).
  onCreateFile: (relativePath: string) => void;
  // --- FileTree file operations + untitled (spec: workbench-filetree-file-operations) ---
  // New File: open a blank untitled buffer (VSCode-style; named on save). From the
  // FileTree toolbar/menu and the Workbench launcher.
  onNewUntitledFile: () => void;
  // Save As for an untitled pane: write the typed path, then open the real file.
  onUntitledSaveAs: (paneId: string, relativePath: string) => void;
  onUntitledSaveAsCancel: () => void;
  // Inline tree edits (new folder under `parentPath`, or rename the entry at the path).
  onFileTreeNewFolder: (parentPath: string) => void;
  onFileTreeRenameStart: (relativePath: string) => void;
  onTreeEditDraftChange: (draft: string) => void;
  onTreeEditConfirm: () => void;
  onTreeEditCancel: () => void;
  // Delete: open the confirm dialog, then trash on confirm.
  onFileTreeDeleteIntent: (target: ProductShellFileTreeMenu) => void;
  onFileTreeDeleteConfirm: () => void;
  onFileTreeDeleteCancel: () => void;
  // Right-click context menu open/close.
  onFileTreeMenuOpen: (menu: ProductShellFileTreeMenu) => void;
  onFileTreeMenuClose: () => void;
  // Drag-and-drop move: move `fromRel` so it lands at `toRel`.
  onFileTreeMove: (fromRel: string, toRel: string) => void;
  // Toolbar refresh + transient-notice dismiss.
  onFileTreeRefresh: () => void;
  onFileTreeNoticeClear: () => void;
  onTerminalInput: (paneId: string, bytes: string) => void;
  onTerminalResize: (paneId: string, cols: number, rows: number) => void;
  onEditorDraftChange: (paneId: string, content: string) => void;
  onEditorCursorChange: (paneId: string, cursorOffset: number) => void;
  onEditorSave: (paneId: string) => void;
  // `position` (0-based line/character) is supplied by the editor for the
  // thread-less start-page editor, whose cursor isn't tracked in shell state;
  // thread panes ignore it and resolve from their tracked cursor.
  onEditorGoToDefinition: (paneId: string, position?: { line: number; character: number }) => void;
  onEditorGoToReferences: (paneId: string, position?: { line: number; character: number }) => void;
  // Editor language-intelligence query (workspace.codeIntel round-trip). The
  // result payload goes straight back to the calling CodeMirror extension —
  // it never enters shell state, so typing/hovering can't re-render the shell.
  // Returns the workspace.codeIntelResult payload, or null on miss/error.
  onEditorCodeIntel: (input: {
    paneId: string;
    kind: "completion" | "hover" | "highlights" | "signature" | "diagnostics";
    content: string;
    line?: number;
    character?: number;
  }) => Promise<Record<string, unknown> | null>;
  onBrowserSnapshot: (paneId: string, snapshot: ProductShellBrowserSnapshot) => void;
  onBrowserActionResult: (paneId: string, result: ProductShellBrowserActionResult) => void;
  // Background (non-active thread) Browser Pane updates, routed by the pane's threadId.
  onBackgroundBrowserSnapshot: (threadId: string, paneId: string, snapshot: ProductShellBrowserSnapshot) => void;
  onBackgroundBrowserActionResult: (threadId: string, paneId: string, result: ProductShellBrowserActionResult) => void;
  // User takeover (D5): release agent driving on a foregrounded driven Browser Pane.
  onReleaseAgentBrowserControl: (paneId: string) => void;
}
