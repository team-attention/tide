import type { AgentChatBackendEvent, AgentChatChoiceSurfaceView, AgentChatCommandOption, AgentChatComposerSurfaceKind } from "../../../../application/domains/agent-chat/agent-chat-shell-state.ts";
import type { DropZone, ProductShellBackendCommand, ProductShellBrowserActionResult, ProductShellBrowserSnapshot, ProductShellLeftUiMenu, ProductShellListSettings, ProductShellState, ProductShellWorktreeSettings } from "../../../../application/domains/product-shell/product-shell-state.ts";
import type { TideThemePreference } from "../theme.ts";
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
  gitContext(cwd: string): Promise<GitContextResult>;
  listCommands(cwd: string, agentId: string): Promise<AgentChatCommandOption[]>;
}

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
  onLeftUiToggle: () => void;
  onWorkbenchToggle: () => void;
  onWorkbenchFullscreenToggle: () => void;
  onWorkbenchLayoutModeToggle: () => void;
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
  onOpenFile: (path: string) => void;
  onOpenBrowserPane: (url: string) => void;
  onAddAttachment: (attachment: {
    name: string;
    mediaType: string;
    dataBase64: string;
  }) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onLauncherAction: (actionId: string) => void;
  onEditorPickerFilter: (filter: string) => void;
  onEditorPickerSelect: (relativePath: string) => void;
  onLeftUiMenuOpen: (menu: ProductShellLeftUiMenu | null, rect?: MenuAnchorRect) => void;
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
  onLeftUiTransientClear: () => void;
  onFocusWorkbenchPane: (paneId: string) => void;
  onCloseWorkbenchPane: (paneId: string) => void;
  onFileTreeEntryOpen: (entryId: string) => void;
  onTerminalInput: (paneId: string, bytes: string) => void;
  onTerminalResize: (paneId: string, cols: number, rows: number) => void;
  onEditorDraftChange: (paneId: string, content: string) => void;
  onEditorCursorChange: (paneId: string, cursorOffset: number) => void;
  onEditorSave: (paneId: string) => void;
  onEditorGoToDefinition: (paneId: string) => void;
  onEditorGoToReferences: (paneId: string) => void;
  onBrowserSnapshot: (paneId: string, snapshot: ProductShellBrowserSnapshot) => void;
  onBrowserActionResult: (paneId: string, result: ProductShellBrowserActionResult) => void;
  // Background (non-active thread) Browser Pane updates, routed by the pane's threadId.
  onBackgroundBrowserSnapshot: (threadId: string, paneId: string, snapshot: ProductShellBrowserSnapshot) => void;
  onBackgroundBrowserActionResult: (threadId: string, paneId: string, result: ProductShellBrowserActionResult) => void;
}
