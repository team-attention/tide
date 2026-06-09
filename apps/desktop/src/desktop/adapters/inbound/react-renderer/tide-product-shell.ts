import { createElement, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type ReactElement, type ReactNode } from "react";
import {
  Archive,
  Check,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  GitBranchPlus,
  GitCompare,
  Globe,
  LayoutGrid,
  Maximize2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { fileIconFor } from "./file-icons.ts";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";
// xterm core is CommonJS and safe to import in any environment (it does not
// touch browser globals at load). default-import the module namespace so both
// the Vite build and Node's ESM test loader resolve it. The fit/webgl addons
// are UMD bundles that reference `self` at load, so they are browser-only and
// are dynamically imported inside the mount effect (and gracefully skipped when
// unavailable, e.g. headless/jsdom/no-GPU).
import * as xtermModule from "@xterm/xterm";

// `@xterm/xterm` is CommonJS, and its export shape differs across loaders: the
// `Terminal` class is a named export under Vite's ESM interop and Node's ESM
// loader, but lives under `.default` in some bundling paths. Default-importing
// the module gave `undefined` under Vite (dev optimizeDeps), white-screening
// the whole shell. Resolve the constructor defensively so the same source works
// in the Vite dev server, the Vite/rollup production build, and Node ESM tests.
const xtermNamespace = xtermModule as unknown as {
  Terminal?: typeof import("@xterm/xterm").Terminal;
  default?: { Terminal?: typeof import("@xterm/xterm").Terminal };
};
const XtermTerminal =
  xtermNamespace.Terminal ?? xtermNamespace.default?.Terminal;
import { javascript } from "@codemirror/lang-javascript";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { rust } from "@codemirror/lang-rust";
import { css as cssLanguage } from "@codemirror/lang-css";
import { markdown as markdownLang } from "@codemirror/lang-markdown";
import MarkdownIt from "markdown-it";
import { guessLanguage, highlightToHtml } from "./code-highlight.ts";
import { renderMarkdownCached, taskListPlugin } from "./markdown-rendering.ts";

// Markdown rendering for the Editor Pane Preview. `html: false` escapes raw HTML
// in file content so rendering local/agent-authored files cannot execute markup.
// Tables + strikethrough come from markdown-it's default preset; task lists are
// added by the shared plugin; fenced code is highlighted by the bundled
// CodeMirror/Lezer highlighter (no new highlighter dependency).
// Spec: docs_v2/specs/workbench-markdown-preview-editor.md (D5, D6).
const markdownRenderer = new MarkdownIt({ html: false, linkify: true, typographer: true });
markdownRenderer.use(taskListPlugin);
markdownRenderer.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const lang = (token.info.trim().split(/\s+/)[0] ?? "") || guessLanguage(token.content) || "";
  const codeHtml = highlightToHtml(token.content, lang || undefined);
  // Only emit a language class for safe identifiers (avoids attribute injection
  // from an arbitrary fence info string).
  const langAttr = /^[\w-]+$/.test(lang) ? ` class="language-${lang}"` : "";
  return `<pre class="md-fence"><code${langAttr}>${codeHtml}</code></pre>`;
};

import {
  applyProductShellBackendEvent,
  closeProductShellWorkbenchPane,
  clearProductShellLeftUiTransientState,
  confirmProductShellThreadArchive,
  createProductShellState,
  createProductShellViewModel,
  editProductShellWorkbenchEditorPane,
  focusProductShellWorkbenchPane,
  goToProductShellEditorDefinition,
  goToProductShellEditorReferences,
  moveProductShellEditorCursor,
  openProductShellLeftUiMenu,
  openProductShellThread,
  openProductShellThreadFromLeftUi,
  selectProductShellFileTreeEntry,
  openProductShellFileInEditor,
  setProductShellSearchQuery,
  toggleProductShellSearch,
  selectProductShellChoiceSurfaceRow,
  selectProductShellLauncherAction,
  setProductShellEditorPickerFilter,
  selectProductShellEditorPickerFile,
  archiveProductShellProjectChats,
  cancelProductShellProjectRename,
  setProductShellComposerActiveSurface,
  setProductShellComposerFolderScope,
  setProductShellGitContext,
  setProductShellProviderCommands,
  setProductShellRegisteredProjects,
  startProductShellProjectRename,
  startNewProductShellScratchThread,
  toggleProductShellProjectPin,
  showProductShellThreadArchiveConfirm,
  startProductShellThreadRename,
  submitProductShellThreadRename,
  cancelProductShellThreadRename,
  startNewProductShellThread,
  openProductShellWorkbenchLauncher,
  interruptProductShellRuntime,
  editProductShellQueuedInput,
  submitProductShellComposerDraft,
  addProductShellComposerAttachment,
  removeProductShellComposerAttachment,
  saveProductShellWorkbenchEditorPane,
  toggleProductShellFileTreeWithRefresh,
  refreshStartPageFileTree,
  toggleProductShellLeftUi,
  toggleProductShellProject,
  toggleProductShellThreadPin,
  toggleProductShellWorkbenchWithLauncher,
  updateProductShellBrowserActionResult,
  updateProductShellBrowserSnapshot,
  updateProductShellBackgroundBrowserActionResult,
  updateProductShellBackgroundBrowserSnapshot,
  updateProductShellComposerDraft,
  writeProductShellTerminalInput,
  resizeProductShellTerminal,
  setProductShellListSettings,
  startProductShellWorktreeCreate,
  cancelProductShellWorktreeCreate,
  setProductShellWorktreeSettings,
  setProductShellSettingsOpen,
  setPreferredStartComposer,
  type PreferredStartComposer,
  DEFAULT_PRODUCT_SHELL_LIST_SETTINGS,
  DEFAULT_PRODUCT_SHELL_WORKTREE_SETTINGS,
  type ProductShellListSettings,
  type ProductShellWorktreeSettings,
  type ProductShellBackendCommand,
  type ProductShellAgentIdentity,
  type ProductShellBrowserActionResult,
  type ProductShellBrowserSnapshot,
  type ProductShellLeftUiMenu,
  type ProductShellProjectGroupView,
  type ProductShellPinnedProjectView,
  type ProductShellState,
  type ProductShellThreadView,
  type ProductShellViewModel,
} from "../../../application/domains/product-shell/product-shell-state.ts";
import { AgentChatShell } from "./agent-chat-shell.ts";
import type {
  AgentChatBackendEvent,
  AgentChatChoiceSurfaceView,
  AgentChatCommandOption,
  AgentChatComposerSurfaceKind,
} from "../../../application/domains/agent-chat/agent-chat-shell-state.ts";

const LIST_SETTINGS_STORAGE_KEY = "tide.listSettings";

// List-display settings are a renderer-local pref (no backend contract); persist
// them in localStorage so the grouping/sort choice survives reloads.
function loadListSettings(): ProductShellListSettings {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_PRODUCT_SHELL_LIST_SETTINGS };
  }
  try {
    const raw = localStorage.getItem(LIST_SETTINGS_STORAGE_KEY);
    if (raw === null) {
      return { ...DEFAULT_PRODUCT_SHELL_LIST_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<ProductShellListSettings>;
    return { ...DEFAULT_PRODUCT_SHELL_LIST_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_PRODUCT_SHELL_LIST_SETTINGS };
  }
}

function persistListSettings(settings: ProductShellListSettings): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(LIST_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort; ignore quota/serialization errors.
  }
}

const WORKTREE_SETTINGS_STORAGE_KEY = "tide.worktreeSettings";
const START_COMPOSER_STORAGE_KEY = "tide.startComposerDefaults";

// Remembers the agent + model the user last chose in the Start Composer, so the
// next New Thread defaults to it instead of always codex/gpt-5.5.
function loadPreferredStartComposer(): PreferredStartComposer | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem(START_COMPOSER_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PreferredStartComposer>;
    const agentId = parsed.agentId;
    if (agentId !== "codex" && agentId !== "claude" && agentId !== "antigravity" && agentId !== "openai_api") {
      return null;
    }
    return {
      agentId,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      permission: typeof parsed.permission === "string" ? parsed.permission : undefined,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    };
  } catch {
    return null;
  }
}

function persistPreferredStartComposer(defaults: PreferredStartComposer): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(START_COMPOSER_STORAGE_KEY, JSON.stringify(defaults));
  } catch {
    // Best-effort.
  }
}

function loadWorktreeSettings(): ProductShellWorktreeSettings {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_PRODUCT_SHELL_WORKTREE_SETTINGS };
  }
  try {
    const raw = localStorage.getItem(WORKTREE_SETTINGS_STORAGE_KEY);
    if (raw === null) {
      return { ...DEFAULT_PRODUCT_SHELL_WORKTREE_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<ProductShellWorktreeSettings>;
    return {
      baseDirPattern:
        typeof parsed.baseDirPattern === "string" ? parsed.baseDirPattern : "",
      copyFiles: Array.isArray(parsed.copyFiles)
        ? parsed.copyFiles.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  } catch {
    return { ...DEFAULT_PRODUCT_SHELL_WORKTREE_SETTINGS };
  }
}

function persistWorktreeSettings(settings: ProductShellWorktreeSettings): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(WORKTREE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort.
  }
}

// Slightly longer than the CSS grid transition (260ms) so a closing column stays
// mounted until its collapse animation finishes, then unmounts.
const COLUMN_TRANSITION_MS = 300;

// Animated presence for a layout column: keeps it mounted through an exit
// transition so opening/closing animates the grid track (0 <-> width) smoothly
// instead of snapping. `mounted` gates rendering + the grid track; `visible`
// drives the open (full) vs collapsed (0) track width.
function useColumnPresence(open: boolean): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      // Reveal after the collapsed (0px) track has actually painted, or the grid
      // jumps straight to full width with no transition. A single rAF runs before
      // paint (React batches setVisible into the same frame), so use a double rAF:
      // frame 1 lets 0px paint, frame 2 flips to full width -> the track animates.
      // No rAF in tests -> reveal immediately.
      if (typeof requestAnimationFrame === "undefined") {
        setVisible(true);
        return;
      }
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        // Force the collapsed (0px) track to commit to layout BEFORE revealing.
        // Without this, the very first open after launch can coalesce the 0px and
        // full-width frames into one paint, so the grid snaps instead of animating
        // (subsequent opens are already warmed up). A reflow read fixes the first.
        if (typeof document !== "undefined" && document.body) {
          void document.body.offsetHeight;
        }
        inner = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), COLUMN_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return { mounted, visible };
}

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
    options?: { baseDirPattern?: string; copyFiles?: string[] },
  ): Promise<{ entries: ProjectRegistryEntry[]; createdCwd: string | null }>;
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
interface MenuAnchorRect {
  left: number;
  top: number;
  bottom: number;
  right: number;
}

interface ProductShellHandlers {
  onNewThread: () => void;
  onNewThreadInProject: (projectId: string) => void;
  onProjectToggle: (projectId: string) => void;
  onThreadSelect: (threadId: string) => void;
  onLeftUiToggle: () => void;
  onWorkbenchToggle: () => void;
  onNewWorkbenchPane: () => void;
  onFileTreeToggle: () => void;
  onResizeStart: (
    edge: "left" | "workbench" | "fileTree",
    event: { clientX: number; preventDefault: () => void },
  ) => void;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  onInterrupt: () => void;
  onEditQueued: () => void;
  onResend: (text: string) => void;
  onComposerSurfaceChange: (surface: AgentChatComposerSurfaceKind | null) => void;
  onChoiceSurfaceRowSelect: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void;
  onOpenFile: (path: string) => void;
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
  onPinnedProjectSelect: (projectId: string) => void;
  onAddProject: () => void;
  onNewScratchThread: () => void;
  onThreadArchiveIntent: (threadId: string) => void;
  onThreadArchiveConfirm: (threadId: string) => void;
  onThreadPinToggle: (threadId: string) => void;
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


export function TideProductShell(props: TideProductShellProps): ReactElement {
  const [shellState, setShellState] = useState(() => {
    // Apply the remembered agent/model BEFORE the first Start Composer is built,
    // so a fresh launch already shows the user's last choice.
    setPreferredStartComposer(loadPreferredStartComposer());
    return (
      props.initialState ??
      createProductShellState({
        includeFixtureData: false,
        listSettings: loadListSettings(),
        worktreeSettings: loadWorktreeSettings(),
      })
    );
  });
  // Remember the Start Composer's agent/model choice: whenever it changes while no
  // thread is active, persist it so the NEXT New Thread (this launch or the next)
  // defaults to it.
  const startBinding = shellState.activeThreadId === null
    ? shellState.agentChat.composer.startOptions
    : undefined;
  const startAgentId = startBinding?.agentBinding.agentId;
  const startModel = startBinding?.launchOptions?.model;
  const startPermission = startBinding?.launchOptions?.permission;
  const startReasoning = startBinding?.launchOptions?.reasoning;
  useEffect(() => {
    if (
      startAgentId !== "codex" &&
      startAgentId !== "claude" &&
      startAgentId !== "antigravity" &&
      startAgentId !== "openai_api"
    ) {
      return;
    }
    const defaults: PreferredStartComposer = {
      agentId: startAgentId,
      model: typeof startModel === "string" ? startModel : undefined,
      permission: typeof startPermission === "string" ? startPermission : undefined,
      reasoning: typeof startReasoning === "string" ? startReasoning : undefined,
    };
    setPreferredStartComposer(defaults);
    persistPreferredStartComposer(defaults);
  }, [startAgentId, startModel, startPermission, startReasoning]);
  // Resizable column widths (agent chat is the flexible middle track). Drag
  // handles on column edges update these via pointer capture.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const lastSubmitAtRef = useRef(0);
  // Screen rect of the trigger that opened the left-rail context menu, so the
  // menu can anchor to it as a fixed popover (escaping the rail's scroll clip).
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchorRect | null>(null);
  // Collapsed left-rail sections (Pinned / Projects / Scratch), keyed by title.
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [columnWidths, setColumnWidths] = useState({ left: 220, workbench: 480, fileTree: 280 });
  const [isResizing, setIsResizing] = useState(false);
  // Track the window width so the layout can auto-collapse columns that no
  // longer fit (responsive narrow-screen handling).
  const [windowWidth, setWindowWidth] = useState(
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Load the persisted project registry on mount so opened folders appear even
  // before any thread exists (Codex flow).
  useEffect(() => {
    const bridge = props.projectBridge;
    if (bridge === undefined) {
      return;
    }
    let cancelled = false;
    bridge
      .listProjects()
      .then((entries) => {
        if (!cancelled) {
          setShellState((state) => setProductShellRegisteredProjects(state, entries));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.projectBridge]);

  // Open the native directory picker, register the chosen folder as a persisted
  // project, then scope the Start Composer to it.
  const openFolderAsProject = async () => {
    const bridge = props.projectBridge;
    if (bridge === undefined) {
      return;
    }
    const cwd = await bridge.openDirectory();
    if (cwd === null) {
      return;
    }
    const entries = await bridge.registerProject(cwd);
    setShellState((state) => {
      const withRegistry = setProductShellRegisteredProjects(state, entries);
      const project = entries.find((entry) => entry.cwd === cwd);
      return project === undefined
        ? withRegistry
        : selectProductShellChoiceSurfaceRow(withRegistry, "project_menu", `project:${project.projectId}`)
            .state;
    });
  };

  // The chip's "Open folder" only sets this Thread's Execution Context (cwd); it
  // does NOT register a persisted project. The folder appears in the left
  // Projects list only once a Thread is actually started in it.
  const openFolderForScope = async () => {
    const bridge = props.projectBridge;
    if (bridge === undefined) {
      return;
    }
    const cwd = await bridge.openDirectory();
    if (cwd === null) {
      return;
    }
    setShellState((state) => {
      const next = setProductShellComposerFolderScope(state, cwd);
      // Reflect the newly picked folder in the start-page file tree if it's open.
      dispatchBackendCommand(refreshStartPageFileTree(next));
      return next;
    });
  };

  // Fetch real git branches/worktrees whenever the active Project cwd changes,
  // so the Worktree/Branch menus reflect the actual repo (cleared for Scratch).
  const activeScope = shellState.agentChat.thread?.scope ?? shellState.agentChat.composer.startOptions.scope;
  const activeProjectCwd = activeScope?.kind === "project" ? activeScope.cwd : null;
  useEffect(() => {
    const bridge = props.projectBridge;
    if (bridge === undefined || activeProjectCwd === null) {
      setShellState((state) => setProductShellGitContext(state, { branches: [], worktrees: [] }));
      return;
    }
    let cancelled = false;
    bridge
      .gitContext(activeProjectCwd)
      .then((context) => {
        if (!cancelled) {
          setShellState((state) =>
            setProductShellGitContext(state, {
              branches: context.branches,
              worktrees: context.worktrees,
            }),
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.projectBridge, activeProjectCwd]);

  // Fetch real provider commands/skills whenever the active cwd or agent changes,
  // so the composer's / (and $) menu reflects this directory's actual commands.
  const activeAgentId =
    shellState.agentChat.thread?.agentBinding.agentId ??
    shellState.agentChat.composer.startOptions.agentBinding.agentId;
  useEffect(() => {
    const bridge = props.projectBridge;
    if (bridge === undefined || activeProjectCwd === null) {
      setShellState((state) => setProductShellProviderCommands(state, []));
      return;
    }
    let cancelled = false;
    bridge
      .listCommands(activeProjectCwd, activeAgentId)
      .then((commands) => {
        if (!cancelled) {
          setShellState((state) => setProductShellProviderCommands(state, commands));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.projectBridge, activeProjectCwd, activeAgentId]);

  // Fire a native OS notification when a thread newly needs attention (waiting
  // for input/approval), so the user is pulled back even when Tide is in the
  // background. Re-notifies if a thread returns to attention after resolving.
  const notifiedAttentionRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (typeof Notification === "undefined") {
      return;
    }
    if (Notification.permission === "default") {
      void Notification.requestPermission();
    }
    const waiting = shellState.threads.filter((thread) => thread.attention === true);
    const current = new Set(waiting.map((thread) => thread.threadId));
    for (const thread of waiting) {
      if (!notifiedAttentionRef.current.has(thread.threadId) && Notification.permission === "granted") {
        new Notification("Tide — a thread needs your input", { body: thread.title });
      }
    }
    notifiedAttentionRef.current = current;
  }, [shellState.threads]);

  // The agent-chat column never shrinks below the composer's usable width.
  const CHAT_MIN = 440;
  const startColumnResize = (
    edge: "left" | "workbench" | "fileTree",
    event: { clientX: number; preventDefault: () => void },
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const start = columnWidths;
    const clamp = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(max, value));
    // Coalesce pointermove into one state update per animation frame. Raw
    // pointermove fires ~60–120x/sec and each setState re-renders the whole shell
    // (chat + workbench webview + file tree), which is the main resize jank.
    let frame: number | null = null;
    let latestDx = 0;
    const applyWidth = () => {
      frame = null;
      const dx = latestDx;
      // Keep every column inside the viewport: the flexible chat track must keep
      // at least CHAT_MIN, so a resizable column can't grow past the space left
      // by the other open columns. This prevents horizontal overflow/scroll.
      const total = bodyRef.current?.clientWidth ?? window.innerWidth;
      setColumnWidths((current) => {
        if (edge === "left") {
          const reserved =
            (viewModel.workbenchOpen ? current.workbench : 0) +
            (viewModel.fileTreeOpen ? current.fileTree : 0);
          const max = Math.max(200, total - reserved - CHAT_MIN);
          return { ...current, left: clamp(start.left + dx, 200, max) };
        }
        if (edge === "workbench") {
          // Handle on the workbench's left edge: dragging right shrinks it.
          const reserved =
            (viewModel.leftUiOpen ? current.left : 0) +
            (viewModel.fileTreeOpen ? current.fileTree : 0);
          const max = Math.max(320, total - reserved - CHAT_MIN);
          return { ...current, workbench: clamp(start.workbench - dx, 320, max) };
        }
        const reserved =
          (viewModel.leftUiOpen ? current.left : 0) +
          (viewModel.workbenchOpen ? current.workbench : 0);
        const max = Math.max(240, total - reserved - CHAT_MIN);
        return { ...current, fileTree: clamp(start.fileTree - dx, 240, max) };
      });
    };
    const onMove = (move: PointerEvent) => {
      latestDx = move.clientX - startX;
      if (frame === null) {
        frame = requestAnimationFrame(applyWidth);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setIsResizing(true);
  };
  useEffect(() => {
    return props.onBackendEvent?.((event) => {
      // Terminal output is a hot path: write it straight to the GPU terminal and
      // skip the React reducer so streaming bytes never re-render the shell.
      if (event.kind === "workbench.terminalOutput") {
        const payload = event.payload as { paneId?: unknown; chunk?: unknown };
        if (typeof payload.paneId === "string" && typeof payload.chunk === "string") {
          routeProductShellTerminalOutput(payload.paneId, payload.chunk);
        }
        return;
      }
      setShellState((state) => {
        // These arrive over the async push channel — including other threads
        // running in the background — so they must never populate a surface they
        // don't belong to (e.g. drop another thread's answer into the thread the
        // user is viewing, or into the empty New Thread composer).
        const next = applyProductShellBackendEvent(state, event, "broadcast");
        // When a thread becomes active (started/hydrated) with the FileTree
        // shown, populate it — covers the new-thread first message and any
        // thread activation, not just manual toggle. refresh_file_tree is
        // idempotent, so a duplicate dispatch is harmless.
        if (
          (event.kind === "thread.started" || event.kind === "thread.hydrated") &&
          next.fileTreeOpen &&
          next.activeThreadId
        ) {
          dispatchBackendCommand({
            kind: "workbench.command",
            payload: {
              threadId: next.activeThreadId,
              command: "refresh_file_tree",
              data: { maxDepth: 1, maxEntries: 400 },
            },
          });
        }
        return next;
      });
    });
  }, [props.onBackendEvent]);
  // Deriving the view model sorts threads, clones the file tree, and builds project
  // groups — too expensive to redo when only transient UI state (column widths during
  // a resize drag, menu anchor, window width) changes. Memoize it on shellState.
  const viewModel = useMemo(() => createProductShellViewModel(shellState), [shellState]);
  const applyBackendEvents = (events: AgentChatBackendEvent[] | undefined) => {
    if (events === undefined || events.length === 0) {
      return;
    }
    setShellState((state) =>
      events.reduce((nextState, event) => applyProductShellBackendEvent(nextState, event), state),
    );
  };
  const dispatchBackendCommand = (command: ProductShellBackendCommand | null) => {
    if (command === null) {
      return;
    }
    const backendResult = props.onBackendCommand?.(command);
    if (backendResult instanceof Promise) {
      void backendResult.then((events) => applyBackendEvents(events));
    } else if (backendResult !== undefined) {
      applyBackendEvents(backendResult);
    }
  };
  useEffect(() => {
    if (props.initialState !== undefined) {
      return;
    }
    dispatchBackendCommand({ kind: "thread.list", payload: {} });
  }, []);
  const handlers: ProductShellHandlers = {
    onNewThread: () => setShellState((state) => startNewProductShellThread(state)),
    onNewThreadInProject: (projectId) =>
      setShellState((state) => startNewProductShellThread(state, projectId)),
    onProjectToggle: (projectId) =>
      setShellState((state) => toggleProductShellProject(state, projectId)),
    onThreadSelect: (threadId) =>
      setShellState((state) => {
        const result = openProductShellThreadFromLeftUi(state, threadId, {
          backendTransportAvailable: props.onBackendCommand !== undefined,
        });
        dispatchBackendCommand(result.command);
        // Populate the FileTree for the newly active thread (the refresh path
        // only fired on manual toggle before, leaving the tree empty on open).
        if (result.state.fileTreeOpen && result.state.activeThreadId) {
          dispatchBackendCommand({
            kind: "workbench.command",
            payload: {
              threadId: result.state.activeThreadId,
              command: "refresh_file_tree",
              data: { maxDepth: 1, maxEntries: 400 },
            },
          });
        }
        return result.state;
      }),
    onLeftUiToggle: () => setShellState((state) => toggleProductShellLeftUi(state)),
    onWorkbenchToggle: () =>
      setShellState((state) => {
        const result = toggleProductShellWorkbenchWithLauncher(state);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onNewWorkbenchPane: () =>
      setShellState((state) => {
        const result = openProductShellWorkbenchLauncher(state);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onResizeStart: startColumnResize,
    onFileTreeToggle: () =>
      setShellState((state) => {
        const result = toggleProductShellFileTreeWithRefresh(state);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onDraftChange: (draft) => setShellState((state) => updateProductShellComposerDraft(state, draft)),
    onSubmit: () => {
      // Throttle to swallow accidental double-clicks / double Enter so the same
      // draft is never submitted twice in quick succession.
      const now = Date.now();
      if (now - lastSubmitAtRef.current < 700) {
        return;
      }
      lastSubmitAtRef.current = now;
      setShellState((state) => {
        const result = submitProductShellComposerDraft(state);
        dispatchBackendCommand(result.command);
        return result.state;
      });
    },
    onInterrupt: () =>
      setShellState((state) => {
        const result = interruptProductShellRuntime(state);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onEditQueued: () =>
      setShellState((state) => {
        const result = editProductShellQueuedInput(state);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onResend: (text) =>
      setShellState((state) => {
        const drafted = updateProductShellComposerDraft(state, text);
        const result = submitProductShellComposerDraft(drafted);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onComposerSurfaceChange: (surface) =>
      setShellState((state) => setProductShellComposerActiveSurface(state, surface)),
    onChoiceSurfaceRowSelect: (surfaceKind, rowId) => {
      // "Open folder" in the chip only scopes the Start Composer to the picked
      // folder (Execution Context). It is NOT registered as a persisted project
      // here — registration/left-list appearance happens via the Projects "+"
      // button or when a Thread is actually started in the folder.
      if (surfaceKind === "project_menu" && rowId === "open-folder") {
        openFolderForScope();
        setShellState((state) => setProductShellComposerActiveSurface(state, null));
        return;
      }
      setShellState((state) => {
        const result = selectProductShellChoiceSurfaceRow(state, surfaceKind, rowId);
        dispatchBackendCommand(result.command);
        // Changing the start-page scope chip reloads the file tree for that directory.
        dispatchBackendCommand(refreshStartPageFileTree(result.state));
        return result.state;
      });
    },
    onOpenFile: (path) =>
      setShellState((state) => {
        const result = openProductShellFileInEditor(state, path);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onAddAttachment: (attachment) =>
      setShellState((state) => {
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return addProductShellComposerAttachment(state, { id, ...attachment });
      }),
    onRemoveAttachment: (attachmentId) =>
      setShellState((state) =>
        removeProductShellComposerAttachment(state, attachmentId),
      ),
    onLauncherAction: (actionId) =>
      setShellState((state) => {
        const result = selectProductShellLauncherAction(state, actionId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onEditorPickerFilter: (filter) =>
      setShellState((state) => setProductShellEditorPickerFilter(state, filter)),
    onEditorPickerSelect: (relativePath) =>
      setShellState((state) => {
        const result = selectProductShellEditorPickerFile(state, relativePath);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onLeftUiMenuOpen: (menu, rect) => {
      setMenuAnchor(rect ?? null);
      setShellState((state) => openProductShellLeftUiMenu(state, menu));
    },
    isSectionCollapsed: (title) => collapsedSections[title] === true,
    onToggleSection: (title) =>
      setCollapsedSections((current) => ({ ...current, [title]: !current[title] })),
    onListSettingsChange: (patch) =>
      setShellState((state) => {
        const next = setProductShellListSettings(state, patch);
        persistListSettings(next.listSettings);
        return next;
      }),
    onProjectRevealInFinder: (projectId) => {
      const cwd = projectCwdById(shellState, projectId);
      if (cwd !== undefined) {
        props.projectBridge?.revealInFinder(cwd);
      }
      setShellState((state) => openProductShellLeftUiMenu(state, null));
    },
    onProjectArchiveChats: (projectId) =>
      setShellState((state) => {
        const result = archiveProductShellProjectChats(state, projectId);
        for (const command of result.commands) {
          dispatchBackendCommand(command);
        }
        return result.state;
      }),
    onProjectRemove: (projectId) => {
      const cwd = projectCwdById(shellState, projectId);
      const bridge = props.projectBridge;
      if (cwd !== undefined && bridge !== undefined) {
        bridge
          .unregisterProject(cwd)
          .then((entries) => setShellState((state) => setProductShellRegisteredProjects(state, entries)))
          .catch(() => {});
      }
      setShellState((state) => openProductShellLeftUiMenu(state, null));
    },
    onProjectPinToggle: (projectId) =>
      setShellState((state) => toggleProductShellProjectPin(state, projectId)),
    onProjectRenameStart: (projectId) =>
      setShellState((state) => startProductShellProjectRename(state, projectId)),
    onProjectRenameCancel: () =>
      setShellState((state) => cancelProductShellProjectRename(state)),
    onProjectRenameSubmit: (projectId, name) => {
      const cwd = projectCwdById(shellState, projectId);
      const bridge = props.projectBridge;
      const trimmed = name.trim();
      if (cwd !== undefined && bridge !== undefined && trimmed.length > 0) {
        bridge
          .renameProject(cwd, trimmed)
          .then((entries) => setShellState((state) => setProductShellRegisteredProjects(state, entries)))
          .catch(() => {});
      }
      setShellState((state) => cancelProductShellProjectRename(state));
    },
    // Opens the inline "new worktree" name input on the project row. One name
    // drives the worktree/branch/dir (v1). Actual creation happens on submit.
    onProjectCreateWorktree: (projectId) =>
      setShellState((state) => startProductShellWorktreeCreate(state, projectId)),
    onProjectCreateWorktreeSubmit: (projectId, name) => {
      const trimmed = name.trim();
      const cwd = projectCwdById(shellState, projectId);
      const bridge = props.projectBridge;
      if (trimmed.length > 0 && cwd !== undefined && bridge !== undefined) {
        const { baseDirPattern, copyFiles } = shellState.worktreeSettings;
        bridge
          .createWorktree(cwd, trimmed, { baseDirPattern, copyFiles })
          .then((result) =>
            setShellState((state) => setProductShellRegisteredProjects(state, result.entries)),
          )
          .catch(() => {});
      }
      setShellState((state) => cancelProductShellWorktreeCreate(state));
    },
    onProjectCreateWorktreeCancel: () =>
      setShellState((state) => cancelProductShellWorktreeCreate(state)),
    onOpenSettings: () => setShellState((state) => setProductShellSettingsOpen(state, true)),
    onCloseSettings: () => setShellState((state) => setProductShellSettingsOpen(state, false)),
    onWorktreeSettingsChange: (patch) =>
      setShellState((state) => {
        const next = setProductShellWorktreeSettings(state, patch);
        persistWorktreeSettings(next.worktreeSettings);
        return next;
      }),
    onPinnedProjectSelect: (projectId) =>
      setShellState((state) => {
        const result = selectProductShellChoiceSurfaceRow(
          state,
          "project_menu",
          `project:${projectId}`,
        );
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onAddProject: () => openFolderAsProject(),
    onNewScratchThread: () =>
      setShellState((state) => startNewProductShellScratchThread(state)),
    onThreadArchiveIntent: (threadId) =>
      setShellState((state) => showProductShellThreadArchiveConfirm(state, threadId)),
    onThreadArchiveConfirm: (threadId) =>
      setShellState((state) => {
        const result = confirmProductShellThreadArchive(state, threadId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onThreadPinToggle: (threadId) =>
      setShellState((state) => {
        const result = toggleProductShellThreadPin(state, threadId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onThreadRenameStart: (threadId) =>
      setShellState((state) => startProductShellThreadRename(state, threadId)),
    onThreadRenameSubmit: (threadId, title) =>
      setShellState((state) => {
        const result = submitProductShellThreadRename(state, threadId, title);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onThreadRenameCancel: () =>
      setShellState((state) => cancelProductShellThreadRename(state)),
    onSearchQueryChange: (query) =>
      setShellState((state) => setProductShellSearchQuery(state, query)),
    onSearchToggle: () =>
      setShellState((state) => toggleProductShellSearch(state)),
    onLeftUiTransientClear: () =>
      setShellState((state) => clearProductShellLeftUiTransientState(state)),
    onFocusWorkbenchPane: (paneId) =>
      setShellState((state) => {
        const result = focusProductShellWorkbenchPane(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onCloseWorkbenchPane: (paneId) =>
      setShellState((state) => {
        const result = closeProductShellWorkbenchPane(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onFileTreeEntryOpen: (entryId) =>
      setShellState((state) => {
        const result = selectProductShellFileTreeEntry(state, entryId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onTerminalInput: (paneId, bytes) =>
      setShellState((state) => {
        const result = writeProductShellTerminalInput(state, paneId, bytes);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onTerminalResize: (paneId, cols, rows) =>
      setShellState((state) => {
        const result = resizeProductShellTerminal(state, paneId, cols, rows);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onEditorDraftChange: (paneId, content) =>
      setShellState((state) => editProductShellWorkbenchEditorPane(state, paneId, content)),
    onEditorCursorChange: (paneId, cursorOffset) =>
      setShellState((state) => moveProductShellEditorCursor(state, paneId, cursorOffset)),
    onEditorSave: (paneId) =>
      setShellState((state) => {
        const result = saveProductShellWorkbenchEditorPane(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onEditorGoToDefinition: (paneId) =>
      setShellState((state) => {
        const result = goToProductShellEditorDefinition(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onEditorGoToReferences: (paneId) =>
      setShellState((state) => {
        const result = goToProductShellEditorReferences(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onBrowserSnapshot: (paneId, snapshot) =>
      setShellState((state) => {
        const result = updateProductShellBrowserSnapshot(state, paneId, snapshot);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onBrowserActionResult: (paneId, actionResult) =>
      setShellState((state) => {
        const result = updateProductShellBrowserActionResult(state, paneId, actionResult);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onBackgroundBrowserSnapshot: (threadId, paneId, snapshot) =>
      setShellState((state) => {
        const result = updateProductShellBackgroundBrowserSnapshot(state, threadId, paneId, snapshot);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onBackgroundBrowserActionResult: (threadId, paneId, actionResult) =>
      setShellState((state) => {
        const result = updateProductShellBackgroundBrowserActionResult(state, threadId, paneId, actionResult);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
  };

  // Auto-collapse columns that no longer fit the window at their min widths.
  const eff = fitColumnsToWidth({
    windowWidth,
    leftUiOpen: viewModel.leftUiOpen,
    workbenchOpen: viewModel.workbenchOpen,
    fileTreeOpen: viewModel.fileTreeOpen,
  });
  const layoutVm =
    eff.workbenchOpen === viewModel.workbenchOpen && eff.fileTreeOpen === viewModel.fileTreeOpen
      ? viewModel
      : { ...viewModel, workbenchOpen: eff.workbenchOpen, fileTreeOpen: eff.fileTreeOpen };

  // Animate columns open/closed by keeping them mounted across an exit transition.
  const leftPresence = useColumnPresence(layoutVm.leftUiOpen);
  const workbenchPresence = useColumnPresence(layoutVm.workbenchOpen);
  const fileTreePresence = useColumnPresence(layoutVm.fileTreeOpen);

  return createElement(
    "div",
    {
      className: [
        "tide-product-shell",
        layoutVm.leftUiOpen ? "tide-product-shell--left-open" : "tide-product-shell--left-closed",
        layoutVm.workbenchOpen ? "tide-product-shell--workbench-open" : "tide-product-shell--workbench-closed",
        layoutVm.fileTreeOpen ? "tide-product-shell--file-tree-open" : "tide-product-shell--file-tree-closed",
        isResizing ? "tide-product-shell--resizing" : "",
      ]
        .filter(Boolean)
        .join(" "),
    },
    createElement(
      "div",
      {
        className: "tide-product-shell__body",
        ref: bodyRef,
        // Agent chat is the flexible middle track; the other columns use
        // minmax(min, dragWidth) so they honour the dragged width when there is
        // room but shrink toward their min when several columns are open at once
        // (so workbench + filetree can both show without overflowing).
        style: {
          // A mounted-but-closing column keeps its track (collapsing to 0) so the
          // grid width animates rather than snapping; unmounted columns drop out.
          // Side tracks are minmax(0px, dragWidth): they honour the dragged/default
          // width when there is room but SHRINK below it when several columns are open
          // on a narrow window, so the file tree is never clipped off the right edge
          // (a plain `${width}px` track can't shrink and overflows). The max animates
          // dragWidth<->0 for the open<->close transition (both ends stay minmax, so it
          // interpolates instead of snapping).
          gridTemplateColumns: [
            leftPresence.mounted
              ? `${leftPresence.visible ? columnWidths.left : 0}px`
              : null,
            // Never shrink the agent-chat column below the composer's usable width.
            `minmax(${CHAT_MIN}px, 1fr)`,
            workbenchPresence.mounted
              ? `minmax(0px, ${workbenchPresence.visible ? columnWidths.workbench : 0}px)`
              : null,
            fileTreePresence.mounted
              ? `minmax(0px, ${fileTreePresence.visible ? columnWidths.fileTree : 0}px)`
              : null,
          ]
            .filter(Boolean)
            .join(" "),
        } as CSSProperties,
      },
      leftPresence.mounted
        ? createLeftUi(layoutVm, handlers, { menu: shellState.leftUiMenu, anchor: menuAnchor })
        : null,
      createAgentChatColumn(layoutVm, handlers),
      workbenchPresence.mounted ? createWorkbenchColumn(layoutVm, handlers) : null,
      fileTreePresence.mounted ? createFileTreeColumn(layoutVm, handlers) : null,
    ),
    // Workbench + FileTree toggles live in a single fixed cluster at the window's
    // top-right, so they never jump between column headers as panels open/close.
    createWindowChromeToggles(layoutVm, handlers),
    // Offscreen host keeping background threads' Browser Panes alive for their agents.
    createElement(BackgroundBrowserHost, {
      panes: layoutVm.backgroundBrowserPanes,
      handlers,
    }),
    viewModel.settingsOpen ? createSettingsModal(viewModel.worktreeSettings, handlers) : null,
  );
}

// Fixed top-right window controls: open/close the Workbench and the FileTree. These
// are window-level affordances, not column content, so their position is stable
// regardless of which panels are currently open.
function createWindowChromeToggles(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
): ReactElement {
  const toggle = (
    label: string,
    icon: ReactElement,
    active: boolean,
    onClick: () => void,
  ): ReactElement =>
    createElement(
      "button",
      {
        className: ["top-row-button", "window-toggle", active ? "window-toggle--active" : ""]
          .filter(Boolean)
          .join(" "),
        type: "button",
        "aria-label": label,
        "aria-pressed": active,
        title: label,
        onClick,
      },
      icon,
    );
  return createElement(
    "div",
    { className: "tide-window-toggles", "aria-label": "Window panels" },
    toggle(
      viewModel.workbenchOpen ? "Close Workbench" : "Open Workbench",
      viewModel.workbenchOpen
        ? createElement(PanelRightClose, { size: 15, strokeWidth: 1.9 })
        : createElement(PanelRightOpen, { size: 15, strokeWidth: 1.9 }),
      viewModel.workbenchOpen,
      handlers.onWorkbenchToggle,
    ),
    toggle(
      viewModel.fileTreeOpen ? "Close FileTree" : "Open FileTree",
      createElement(FolderOpen, { size: 15, strokeWidth: 1.9 }),
      viewModel.fileTreeOpen,
      handlers.onFileTreeToggle,
    ),
  );
}

// App Settings modal (centered overlay). Currently hosts worktree creation
// options: the directory pattern and files to copy into a new worktree.
// See docs_v2/specs/worktree-creation.md.
function createSettingsModal(
  worktree: ProductShellWorktreeSettings,
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "div",
    { className: "settings-modal-backdrop", onMouseDown: handlers.onCloseSettings },
    createElement(
      "div",
      {
        className: "settings-modal",
        role: "dialog",
        "aria-label": "Settings",
        onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
      },
      createElement(
        "header",
        { className: "settings-modal__header" },
        createElement("h2", null, "Settings"),
        createIconButton(
          "Close Settings",
          createElement(X, { size: 16, strokeWidth: 1.9 }),
          handlers.onCloseSettings,
          "settings-modal__close",
        ),
      ),
      createElement(
        "section",
        { className: "settings-modal__section" },
        createElement("h3", { className: "settings-modal__section-title" }, "Worktrees"),
        createElement(
          "label",
          { className: "settings-modal__field" },
          createElement("span", { className: "settings-modal__label" }, "Directory pattern"),
          createElement("input", {
            className: "settings-modal__input",
            value: worktree.baseDirPattern,
            placeholder: "{repo_root}.worktree/{branch}",
            "aria-label": "Worktree directory pattern",
            onChange: (event: ChangeEvent<HTMLInputElement>) =>
              handlers.onWorktreeSettingsChange({ baseDirPattern: event.currentTarget.value }),
          }),
          createElement(
            "span",
            { className: "settings-modal__hint" },
            "Use {repo_root} and {branch}. Empty = default sibling <repo>.worktree/<branch>.",
          ),
        ),
        createElement(
          "label",
          { className: "settings-modal__field" },
          createElement("span", { className: "settings-modal__label" }, "Files to copy"),
          createElement("textarea", {
            className: "settings-modal__textarea",
            value: worktree.copyFiles.join("\n"),
            placeholder: ".env\n.env.local",
            rows: 4,
            "aria-label": "Files to copy into new worktrees",
            onChange: (event: ChangeEvent<HTMLTextAreaElement>) =>
              handlers.onWorktreeSettingsChange({
                copyFiles: event.currentTarget.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => line.length > 0),
              }),
          }),
          createElement(
            "span",
            { className: "settings-modal__hint" },
            "Repo-relative paths, one per line, copied into each new worktree.",
          ),
        ),
      ),
    ),
  );
}

// Min widths used to decide which columns fit (mirrors the body grid minmax).
const COLUMN_MINS = { left: 180, chat: 440, workbench: 280, fileTree: 220 } as const;

// Responsive auto-collapse: given the window width and the user's open/closed
// intent, returns which of Workbench/FileTree actually fit. Drops the lowest
// priority first (FileTree, then Workbench). Intent is preserved by the caller,
// so columns reappear when the window widens again.
export function fitColumnsToWidth(input: {
  windowWidth: number;
  leftUiOpen: boolean;
  workbenchOpen: boolean;
  fileTreeOpen: boolean;
}): { workbenchOpen: boolean; fileTreeOpen: boolean } {
  const base = (input.leftUiOpen ? COLUMN_MINS.left : 0) + COLUMN_MINS.chat;
  const fits = (wb: boolean, ft: boolean): boolean =>
    base + (wb ? COLUMN_MINS.workbench : 0) + (ft ? COLUMN_MINS.fileTree : 0) <= input.windowWidth;
  let workbenchOpen = input.workbenchOpen;
  let fileTreeOpen = input.fileTreeOpen;
  if (!fits(workbenchOpen, fileTreeOpen)) {
    fileTreeOpen = false;
  }
  if (!fits(workbenchOpen, fileTreeOpen)) {
    workbenchOpen = false;
  }
  return { workbenchOpen, fileTreeOpen };
}

// Two-letter monogram per provider (Codex/Claude both start with C, so we use
// a distinct 2-char code for each). Rendered as a small rounded text badge.
export function agentMonogram(agentId: ProductShellAgentIdentity): string {
  switch (agentId) {
    case "codex":
      return "Co";
    case "claude":
      return "Cl";
    case "antigravity":
      return "Ag";
    case "openai_api":
      return "AI";
  }
}

export function AgentIdentityIcon(props: { agentId: ProductShellAgentIdentity | string }): ReactElement {
  const agentId = normalizeAgentId(props.agentId);

  return createElement(
    "span",
    {
      className: `agent-identity-icon agent-identity-icon--${agentId}`,
      "data-agent-icon": agentId,
      "aria-label": agentLabel(agentId),
      role: "img",
    },
    agentMonogram(agentId),
  );
}

function createLeftUi(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
  contextMenu: { menu: ProductShellLeftUiMenu | null; anchor: MenuAnchorRect | null },
): ReactElement {
  return createElement(
    "aside",
    { className: "left-ui", "aria-label": "Left UI", "data-column": "left-ui" },
    createColumnResizeHandle("left", "right", handlers),
    contextMenu.menu
      ? createLeftUiContextMenuOverlay(
          contextMenu.menu,
          contextMenu.anchor ?? { left: 12, top: 120, bottom: 150, right: 256 },
          () => handlers.onLeftUiMenuOpen(null),
          handlers,
          viewModel.listSettings,
        )
      : null,
    createElement(
      "header",
      { className: "left-ui__top-row column-top-row", "aria-label": "Left UI Top Row" },
      createTrafficControls(),
      createIconButton(
        "Close Left UI",
        createElement(PanelLeftClose, { size: 15, strokeWidth: 1.9 }),
        handlers.onLeftUiToggle,
        "top-row-button",
      ),
    ),
    createElement(
      "nav",
      { className: "left-ui__nav", "aria-label": "Left UI actions" },
      createLeftNavRow("New thread", createElement(MessageSquarePlus, { size: 16, strokeWidth: 1.9 }), handlers.onNewThread),
      createElement(
        "div",
        { className: "left-ui__search-row" },
        viewModel.searchActive
          ? createElement(
              "div",
              { className: "left-ui-search" },
              createElement(Search, { size: 16, strokeWidth: 1.9, "aria-hidden": true }),
              createElement("input", {
                className: "left-ui-search__input",
                type: "search",
                "aria-label": "Search threads",
                placeholder: "Search",
                autoFocus: true,
                value: viewModel.searchQuery,
                onChange: (event: { currentTarget: { value: string } }) =>
                  handlers.onSearchQueryChange(event.currentTarget.value),
                onKeyDown: (event: { key: string }) => {
                  if (event.key === "Escape") {
                    handlers.onSearchToggle();
                  }
                },
              }),
            )
          : createLeftNavRow("Search", createElement(Search, { size: 16, strokeWidth: 1.9 }), handlers.onSearchToggle),
        createListSettingsButton(handlers),
      ),
    ),
    createElement(
      "div",
      { className: "left-ui__sections" },
      ...(!viewModel.threadsLoaded
        ? [createRailSkeleton()]
        : viewModel.listSettings.groupBy === "thread"
        ? [
            // Thread mode still surfaces pinned threads in a Pinned section (no
            // project groups); the flat list then excludes them to avoid dupes.
            createPinnedSection([], viewModel.pinnedThreads, handlers),
            createThreadSection(
              "Threads",
              viewModel.flatThreads.filter((thread) => !thread.pinned),
              handlers,
            ),
          ]
        : [
            createPinnedSection(viewModel.pinnedProjects, viewModel.pinnedThreads, handlers),
            createProjectSection(viewModel.projectGroups, handlers),
            createThreadSection("Scratch", viewModel.scratchThreads, handlers),
          ]),
    ),
    createElement(
      "div",
      { className: "left-ui__footer" },
      createLeftNavRow(
        "Settings",
        createElement(Settings, { size: 16, strokeWidth: 1.9 }),
        handlers.onOpenSettings,
      ),
    ),
  );
}

function createAgentChatColumn(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
): ReactElement {
  const title = viewModel.agentChat.thread?.title ?? "New Thread";

  return createElement(
    "section",
    {
      className: "tide-product-shell__stage",
      "aria-label": "Agent Chat",
      "data-column": "agent-chat",
    },
    createElement(
      "header",
      { className: "agent-chat-top-row column-top-row", "aria-label": "Agent Chat Top Row" },
      createElement(
        "div",
        { className: "column-top-row__leading" },
        viewModel.leftUiOpen ? null : createTrafficControls(),
        viewModel.leftUiOpen
          ? null
          : createIconButton(
              "Open Left UI",
              createElement(PanelLeftOpen, { size: 15, strokeWidth: 1.9 }),
              handlers.onLeftUiToggle,
              "top-row-button",
            ),
        createElement(Pin, { size: 14, strokeWidth: 1.9, "aria-hidden": true }),
        createElement("span", { className: "column-top-row__title" }, title),
      ),
      // Trailing kept as a spacer; the Workbench/FileTree toggles now live in the
      // fixed window-level cluster at the top-right.
      createElement("div", { className: "column-top-row__trailing" }),
    ),
    createElement(AgentChatShell, {
      viewModel: viewModel.agentChat,
      showThreadHeader: false,
      onDraftChange: handlers.onDraftChange,
      onSubmit: handlers.onSubmit,
      onInterrupt: handlers.onInterrupt,
      onEditQueued: handlers.onEditQueued,
      onResend: handlers.onResend,
      onComposerSurfaceChange: handlers.onComposerSurfaceChange,
      onChoiceSurfaceRowSelect: handlers.onChoiceSurfaceRowSelect,
      onOpenFile: handlers.onOpenFile,
      onAddAttachment: handlers.onAddAttachment,
      onRemoveAttachment: handlers.onRemoveAttachment,
    }),
  );
}

function createWorkbenchColumn(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
): ReactElement {
  const tabs = viewModel.appChrome.workbenchTabStrip.visibleTabs;
  const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
  const activePane = viewModel.appChrome.activeWorkbenchPane;
  const tabIconSize = 13;
  const workbenchTabIcon = (kind: string): ReactElement => {
    switch (kind) {
      case "browser":
        return createElement(Globe, { size: tabIconSize, strokeWidth: 1.85 });
      case "terminal":
        return createElement(Terminal, { size: tabIconSize, strokeWidth: 1.85 });
      case "diff":
        return createElement(GitCompare, { size: tabIconSize, strokeWidth: 1.85 });
      case "launcher":
        return createElement(LayoutGrid, { size: tabIconSize, strokeWidth: 1.85 });
      default:
        return createElement(FileText, { size: tabIconSize, strokeWidth: 1.85 });
    }
  };

  return createElement(
    "aside",
    { className: "workbench-column", "aria-label": "Workbench", "data-column": "workbench" },
    createColumnResizeHandle("workbench", "left", handlers),
    createElement(
      "header",
      { className: "workbench-column__top-row column-top-row", "aria-label": "Workbench Top Row" },
      createElement(
        "div",
        { className: "workbench-tabs", role: "tablist", "aria-label": "Workbench Tab Strip" },
        tabs.length === 0
          ? createElement("span", { className: "workbench-tabs__empty" }, "Workbench")
          : tabs.map((tab) =>
              createElement(
                "div",
                {
                  key: tab.paneId,
                  className: "workbench-tab",
                  "data-active": tab.active,
                  "data-kind": tab.kind,
                  role: "tab",
                  "aria-selected": tab.active,
                },
                createElement(
                  "button",
                  {
                    className: "workbench-tab__label",
                    type: "button",
                    onClick: () => handlers.onFocusWorkbenchPane(tab.paneId),
                  },
                  createElement(
                    "span",
                    { className: "workbench-tab__icon", "aria-hidden": true },
                    workbenchTabIcon(tab.kind),
                  ),
                  createElement("span", { className: "workbench-tab__title" }, tab.title),
                ),
                // Every tab carries a close button (revealed on hover; always shown
                // on the active tab) so closing a pane is always one obvious click.
                createElement(
                  "button",
                  {
                    className: "workbench-tab__close",
                    type: "button",
                    title: "Close Pane",
                    "aria-label": "Close Pane",
                    onClick: () => handlers.onCloseWorkbenchPane(tab.paneId),
                  },
                  createElement(X, { size: 14, strokeWidth: 2.2, "aria-hidden": true }),
                ),
              ),
            ),
      ),
      // The + (New Pane) opens a Launcher tab to pick what to open; it always lives
      // in the Workbench header. Open/close is handled by the fixed window toggles.
      createElement(
        "div",
        { className: "column-top-row__trailing" },
        createIconButton("New Pane", createElement(Plus, { size: 16, strokeWidth: 1.9 }), handlers.onNewWorkbenchPane, "top-row-button"),
      ),
    ),
    viewModel.editorPicker !== null
      ? createElement(
          "section",
          { className: "workbench-column__pane", "data-pane-kind": "editor-picker" },
          createEditorPickerPane(viewModel.editorPicker, handlers),
        )
      : activeTab && activePane
      ? createElement(
          "section",
          {
            className: "workbench-column__pane",
            "data-pane-id": activeTab.paneId,
            "data-pane-kind": activeTab.kind,
          },
          createWorkbenchPaneContent(
            activePane,
            handlers,
            viewModel.editorDrafts[activePane.paneId],
          ),
        )
      : createElement(
          "section",
          { className: "workbench-column__pane", "data-pane-kind": "launcher" },
          // An empty Workbench presents the Launcher rather than a dead empty
          // state, so there is always a way to open a Pane.
          createElement(WorkbenchLauncherPane, {
            pane: emptyWorkbenchLauncherPane(),
            handlers,
          }),
        ),
  );
}

// In-pane editor file picker: the Launcher pad becomes a searchable file list. The
// search input is autofocused; clicking a file opens it in the Editor (the backend
// consumes the launcher). Mirrors the preview the user approved.
function createEditorPickerPane(
  editorPicker: NonNullable<ProductShellViewModel["editorPicker"]>,
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "div",
    { className: "workbench-pane-content editor-picker" },
    createElement(
      "label",
      { className: "editor-picker__search" },
      createElement(Search, { size: 14, strokeWidth: 1.9, "aria-hidden": true }),
      createElement("input", {
        className: "editor-picker__input",
        type: "search",
        "aria-label": "Filter files to open",
        placeholder: "Filter files…",
        autoFocus: true,
        spellCheck: false,
        value: editorPicker.filter,
        onChange: (event: { currentTarget: { value: string } }) =>
          handlers.onEditorPickerFilter(event.currentTarget.value),
      }),
    ),
    createElement(
      "div",
      { className: "editor-picker__list", role: "listbox", "aria-label": "Files" },
      editorPicker.files.length === 0
        ? createElement(
            "p",
            { className: "editor-picker__empty" },
            editorPicker.filter.trim().length === 0 ? "No files here." : "No matching files.",
          )
        : editorPicker.files.map((file) =>
            createElement(
              "button",
              {
                key: file.relativePath,
                type: "button",
                className: "editor-picker__row",
                role: "option",
                title: file.relativePath,
                onClick: () => handlers.onEditorPickerSelect(file.relativePath),
              },
              createElement(fileIconFor(file.name), { size: 14, strokeWidth: 1.8, "aria-hidden": true }),
              createElement("span", { className: "editor-picker__name" }, file.name),
              createElement("span", { className: "editor-picker__path" }, file.relativePath),
            ),
          ),
    ),
  );
}

function createWorkbenchPaneContent(
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>,
  handlers: ProductShellHandlers,
  editorDraft: ProductShellViewModel["editorDrafts"][string] | undefined,
): ReactElement {
  switch (pane.kind) {
    case "browser":
      return createElement(WorkbenchBrowserPane, { pane, handlers });
    case "editor":
      return createElement(WorkbenchEditorPane, { pane, draft: editorDraft, handlers });
    case "diff":
      return createElement(WorkbenchDiffPane, { pane });
    case "terminal":
      return createElement(WorkbenchTerminalPane, { pane, handlers });
    case "launcher":
      return createElement(WorkbenchLauncherPane, { pane, handlers });
    default:
      return createElement(
        "div",
        { className: "workbench-pane-content workbench-pane-content--generic" },
        createElement("div", { className: "workbench-column__kind" }, pane.kind),
        createElement("h2", null, pane.title),
      );
  }
}

// Default Launcher shown when the Workbench has no visible Pane yet. Mirrors the
// backend launcher action set so the empty Workbench is never a dead end.
function emptyWorkbenchLauncherPane(): NonNullable<
  ProductShellViewModel["appChrome"]["activeWorkbenchPane"]
> {
  return {
    paneId: "workbench-launcher-empty",
    kind: "launcher",
    title: "Workbench launcher",
    revision: "workbench-launcher-empty",
    actions: [
      { actionId: "open_browser", label: "Browser", description: "Open a Browser Pane", enabled: true },
      { actionId: "open_editor", label: "Editor", description: "Pick a file from the FileTree to edit", enabled: true },
      { actionId: "open_terminal", label: "Terminal", description: "Open a visible Terminal Pane", enabled: true },
      { actionId: "open_diff", label: "Diff", description: "Available after a file edit or review target", enabled: false },
    ],
  } as NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
}

function WorkbenchLauncherPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
}): ReactElement {
  const actions = props.pane.actions ?? [];
  return createElement(
    "div",
    { className: "workbench-pane-content workbench-pane-content--launcher" },
    createElement("p", { className: "workbench-launcher-hint" }, "Open a pane"),
    createElement(
      "div",
      { className: "workbench-launcher-actions", "aria-label": "Workbench Launcher Actions" },
      actions.map((action) =>
        createElement(
          "button",
          {
            key: action.actionId,
            className: "workbench-launcher-action",
            type: "button",
            disabled: !action.enabled,
            "data-launcher-action": action.actionId,
            onClick: () => props.handlers.onLauncherAction(action.actionId),
          },
          createElement(
            "span",
            { className: "workbench-launcher-action__icon", "aria-hidden": true },
            launcherActionIcon(action.actionId),
          ),
          createElement(
            "span",
            { className: "workbench-launcher-action__copy" },
            createElement("span", { className: "workbench-launcher-action__label" }, action.label),
            createElement(
              "span",
              { className: "workbench-launcher-action__description" },
              action.description,
            ),
          ),
        ),
      ),
    ),
  );
}

function launcherActionIcon(actionId: string): ReactElement {
  switch (actionId) {
    case "open_browser":
      return createElement(ExternalLink, { size: 15, strokeWidth: 1.9 });
    case "open_editor":
      return createElement(FileText, { size: 15, strokeWidth: 1.9 });
    case "open_terminal":
      return createElement(Terminal, { size: 15, strokeWidth: 1.9 });
    case "open_diff":
      return createElement(GitBranchPlus, { size: 15, strokeWidth: 1.9 });
    case "open_file_tree":
      return createElement(FolderOpen, { size: 15, strokeWidth: 1.9 });
    default:
      return createElement(Square, { size: 15, strokeWidth: 1.9 });
  }
}

function WorkbenchBrowserPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
}): ReactElement {
  const webviewRef = useRef<BrowserWebViewElement | null>(null);
  const executedActionIdsRef = useRef<Set<string>>(new Set());
  const [address, setAddress] = useState(props.pane.url ?? "");
  // Keep the address bar in sync when the backend reports a navigated URL.
  useEffect(() => {
    if (props.pane.url !== undefined) {
      setAddress(props.pane.url);
    }
  }, [props.pane.url]);
  const navigate = () => {
    const url = normalizeBrowserUrl(address);
    if (url.length === 0) {
      return;
    }
    setAddress(url);
    const webview = webviewRef.current;
    if (webview?.loadURL !== undefined) {
      void webview.loadURL(url).catch(() => undefined);
    }
    // Report the navigation so the backend pane reflects it; did-finish-load
    // will follow up with the resolved title/body snapshot.
    props.handlers.onBrowserSnapshot(props.pane.paneId, {
      revision: props.pane.revision,
      url,
      loading: true,
    });
  };
  useEffect(() => {
    const webview = webviewRef.current;
    if (webview === null) {
      return;
    }
    const paneId = props.pane.paneId;
    const revision = props.pane.revision;
    const emitSnapshot = () => {
      void readBrowserWebViewSnapshot(webview).then((snapshot) => {
        props.handlers.onBrowserSnapshot(paneId, {
          revision,
          loading: false,
          ...snapshot,
        });
      });
    };
    webview.addEventListener("did-finish-load", emitSnapshot);
    webview.addEventListener("did-stop-loading", emitSnapshot);
    return () => {
      webview.removeEventListener("did-finish-load", emitSnapshot);
      webview.removeEventListener("did-stop-loading", emitSnapshot);
    };
  }, [props.handlers, props.pane.paneId, props.pane.revision, props.pane.url]);
  useEffect(() => {
    const webview = webviewRef.current;
    const action = props.pane.pendingAction;
    if (
      webview === null ||
      props.pane.url === undefined ||
      action === undefined ||
      executedActionIdsRef.current.has(action.actionId)
    ) {
      return;
    }
    executedActionIdsRef.current.add(action.actionId);
    const paneId = props.pane.paneId;
    const revision = props.pane.revision;
    void executeBrowserWebViewAction(webview, action)
      .then(async (actionResult) => {
        const snapshot = await readBrowserWebViewSnapshot(webview);
        props.handlers.onBrowserActionResult(paneId, {
          revision,
          actionId: action.actionId,
          status: actionResult.ok ? "completed" : "failed",
          message: actionResult.message,
          loading: false,
          ...snapshot,
        });
      })
      .catch((error: unknown) => {
        props.handlers.onBrowserActionResult(paneId, {
          revision,
          actionId: action.actionId,
          status: "failed",
          message: error instanceof Error ? error.message : "Browser action failed.",
          loading: false,
        });
      });
  }, [
    props.handlers,
    props.pane.paneId,
    props.pane.pendingAction?.actionId,
    props.pane.revision,
    props.pane.url,
  ]);
  return createElement(
    "div",
    { className: "workbench-pane-content workbench-pane-content--browser" },
    // Slim editable address bar — the page fills the pane below it.
    createElement(
      "form",
      {
        className: "workbench-browser-bar",
        "aria-label": "Browser address",
        onSubmit: (event: { preventDefault: () => void }) => {
          event.preventDefault();
          navigate();
        },
      },
      createElement("input", {
        className: "workbench-browser-bar__input",
        "aria-label": "Browser address input",
        value: address,
        placeholder: "Enter a URL and press Enter",
        spellCheck: false,
        autoCapitalize: "off",
        autoCorrect: "off",
        onChange: (event: { currentTarget: { value: string } }) =>
          setAddress(event.currentTarget.value),
      }),
      props.pane.loading
        ? createElement("span", { className: "workbench-browser-bar__status" }, "loading")
        : null,
      createElement(
        "button",
        { type: "submit", className: "workbench-browser-bar__go", "aria-label": "Go" },
        "Go",
      ),
    ),
    createElement("webview", {
      ref: webviewRef,
      className: "workbench-browser-webview",
      "data-browser-pane-webview": props.pane.paneId,
      src: props.pane.url ?? "about:blank",
      partition: "persist:tide-workbench-browser",
    }),
  );
}

// Persistent offscreen host for Browser Panes owned by NON-active threads. Each
// pane's <webview> stays mounted (alive) so a background agent keeps driving its own
// browser (snapshots + scheduled actions) without being visible or stealing focus.
function BackgroundBrowserHost(props: {
  panes: ProductShellViewModel["backgroundBrowserPanes"];
  handlers: ProductShellHandlers;
}): ReactElement | null {
  if (props.panes.length === 0) {
    return null;
  }
  return createElement(
    "div",
    { className: "background-browser-host", "aria-hidden": true },
    ...props.panes.map((pane) =>
      createElement(BackgroundBrowserWebView, {
        key: `${pane.threadId}:${pane.paneId}`,
        pane,
        handlers: props.handlers,
      }),
    ),
  );
}

function BackgroundBrowserWebView(props: {
  pane: ProductShellViewModel["backgroundBrowserPanes"][number];
  handlers: ProductShellHandlers;
}): ReactElement {
  const webviewRef = useRef<BrowserWebViewElement | null>(null);
  const executedActionIdsRef = useRef<Set<string>>(new Set());
  const { threadId, paneId, revision, url, pendingAction } = props.pane;
  const handlers = props.handlers;

  // Report a snapshot when the offscreen page settles, routed to the pane's thread.
  useEffect(() => {
    const webview = webviewRef.current;
    if (webview === null) {
      return;
    }
    const emitSnapshot = () => {
      void readBrowserWebViewSnapshot(webview).then((snapshot) => {
        handlers.onBackgroundBrowserSnapshot(threadId, paneId, {
          revision,
          loading: false,
          ...snapshot,
        });
      });
    };
    webview.addEventListener("did-finish-load", emitSnapshot);
    webview.addEventListener("did-stop-loading", emitSnapshot);
    return () => {
      webview.removeEventListener("did-finish-load", emitSnapshot);
      webview.removeEventListener("did-stop-loading", emitSnapshot);
    };
  }, [handlers, threadId, paneId, revision, url]);

  // Execute a scheduled background action (click/type) against the offscreen webview.
  useEffect(() => {
    const webview = webviewRef.current;
    if (
      webview === null ||
      url === undefined ||
      pendingAction === undefined ||
      executedActionIdsRef.current.has(pendingAction.actionId)
    ) {
      return;
    }
    executedActionIdsRef.current.add(pendingAction.actionId);
    void executeBrowserWebViewAction(webview, pendingAction)
      .then(async (actionResult) => {
        const snapshot = await readBrowserWebViewSnapshot(webview);
        handlers.onBackgroundBrowserActionResult(threadId, paneId, {
          revision,
          actionId: pendingAction.actionId,
          status: actionResult.ok ? "completed" : "failed",
          message: actionResult.message,
          loading: false,
          ...snapshot,
        });
      })
      .catch((error: unknown) => {
        handlers.onBackgroundBrowserActionResult(threadId, paneId, {
          revision,
          actionId: pendingAction.actionId,
          status: "failed",
          message: error instanceof Error ? error.message : "Browser action failed.",
          loading: false,
        });
      });
  }, [handlers, threadId, paneId, revision, url, pendingAction?.actionId]);

  return createElement("webview", {
    ref: webviewRef,
    className: "background-browser-host__webview",
    "data-browser-pane-webview": paneId,
    src: url ?? "about:blank",
    partition: "persist:tide-workbench-browser",
  });
}

type BrowserWebViewElement = HTMLElement & {
  executeJavaScript?: (code: string) => Promise<unknown>;
  getURL?: () => string;
  loadURL?: (url: string) => Promise<void>;
};

// Turn a user-typed address into a navigable URL: keep explicit schemes, treat a
// dotted token as a bare host (https://), and fall back to a web search.
function normalizeBrowserUrl(input: string): string {
  const value = input.trim();
  if (value.length === 0) {
    return "";
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith("about:")) {
    return value;
  }
  if (/^[^\s/]+\.[^\s/]+/.test(value)) {
    return `https://${value}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

type BrowserWebViewSnapshot = Omit<ProductShellBrowserSnapshot, "revision" | "loading">;
type BrowserWebViewAction = NonNullable<
  NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>["pendingAction"]
>;
type BrowserWebViewActionExecution = { ok: boolean; message: string };

async function readBrowserWebViewSnapshot(
  webview: BrowserWebViewElement,
): Promise<BrowserWebViewSnapshot> {
  const script = `(() => ({
    url: window.location.href,
    pageTitle: document.title,
    bodyTextPreview: (document.body?.innerText ?? "").slice(0, 65536)
  }))()`;
  const rawSnapshot = await webview.executeJavaScript?.(script).catch(() => undefined);
  const snapshot =
    rawSnapshot !== null && typeof rawSnapshot === "object"
      ? (rawSnapshot as Record<string, unknown>)
      : {};
  return {
    url: stringRecordField(snapshot, "url") ?? webview.getURL?.(),
    pageTitle: stringRecordField(snapshot, "pageTitle"),
    bodyTextPreview: stringRecordField(snapshot, "bodyTextPreview"),
  };
}

async function executeBrowserWebViewAction(
  webview: BrowserWebViewElement,
  action: BrowserWebViewAction,
): Promise<BrowserWebViewActionExecution> {
  if (webview.executeJavaScript === undefined) {
    return { ok: false, message: "Browser WebView does not expose script execution." };
  }
  const payload = JSON.stringify({
    kind: action.kind,
    selector: action.selector,
    text: action.text ?? "",
  });
  const script = `((payload) => {
    const target = document.querySelector(payload.selector);
    if (!target) {
      return { ok: false, message: "Selector not found: " + payload.selector };
    }
    target.scrollIntoView?.({ block: "center", inline: "center" });
    if (payload.kind === "click") {
      target.click();
      return { ok: true, message: "Clicked " + payload.selector };
    }
    if (payload.kind === "type_text") {
      target.focus?.();
      if ("value" in target) {
        target.value = payload.text;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, message: "Typed " + payload.selector };
      }
      target.textContent = payload.text;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true, message: "Typed " + payload.selector };
    }
    return { ok: false, message: "Unsupported Browser action." };
  })(${payload})`;
  return browserActionExecutionFromUnknown(await webview.executeJavaScript(script));
}

function browserActionExecutionFromUnknown(value: unknown): BrowserWebViewActionExecution {
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const ok = typeof record.ok === "boolean" ? record.ok : false;
    const message =
      typeof record.message === "string" ? record.message : "Browser action finished.";
    return { ok, message };
  }
  return { ok: false, message: "Browser action returned an invalid result." };
}

function stringRecordField(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

function WorkbenchEditorPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  draft: ProductShellViewModel["editorDrafts"][string] | undefined;
  handlers: ProductShellHandlers;
}): ReactElement {
  const readOnly = props.pane.truncated === true;
  const value = props.draft?.content ?? props.pane.bodyText ?? props.pane.bodyTextPreview ?? "";
  const language = inferEditorLanguage(props.pane.relativePath ?? props.pane.filePath);
  const isMarkdown = language === "markdown";
  return createElement(
    "div",
    {
      className: "workbench-pane-content workbench-pane-content--editor",
      "data-editor-readonly": readOnly ? "readonly" : "editable",
    },
    createEditorBreadcrumb(props.pane, props.draft?.dirty === true),
    isMarkdown
      ? createElement(WorkbenchMarkdownView, {
          paneId: props.pane.paneId,
          value,
          readOnly,
          dirty: props.draft?.dirty === true,
          revision: props.pane.revision,
          handlers: props.handlers,
        })
      : createElement(
          "div",
          { className: "workbench-editor-stack" },
          createElement(WorkbenchCodeEditor, {
            paneId: props.pane.paneId,
            value,
            readOnly,
            dirty: props.draft?.dirty === true,
            language,
            revision: props.pane.revision,
            navigationTarget: props.pane.navigationTarget,
            handlers: props.handlers,
          }),
          createWorkbenchEditorReferences(props.pane.references),
        ),
  );
}

// Breadcrumb path bar matching the Figma editor (`tide › CLAUDE.md`): the
// workspace root name followed by the file's path segments.
function createEditorBreadcrumb(
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>,
  dirty: boolean,
): ReactElement {
  const relativePath = pane.relativePath ?? pane.title;
  const segments = relativePath.split("/").filter((segment) => segment.length > 0);
  if (pane.filePath && pane.relativePath && pane.filePath.endsWith(pane.relativePath)) {
    const root = pane.filePath.slice(0, pane.filePath.length - pane.relativePath.length);
    const rootName = root.replace(/\/+$/, "").split("/").pop();
    if (rootName) {
      segments.unshift(rootName);
    }
  }
  return createElement(
    "div",
    { className: "workbench-editor-breadcrumb", "aria-label": "Editor breadcrumb" },
    ...segments.flatMap((segment, index) =>
      index < segments.length - 1
        ? [
            createElement("span", { key: `crumb-${index}`, className: "workbench-editor-breadcrumb__crumb" }, segment),
            createElement("span", { key: `sep-${index}`, className: "workbench-editor-breadcrumb__sep" }, "›"),
          ]
        : [createElement("span", { key: `crumb-${index}`, className: "workbench-editor-breadcrumb__crumb" }, segment)],
    ),
    dirty
      ? createElement("span", { className: "workbench-editor-breadcrumb__dirty", title: "Unsaved changes" }, "●")
      : null,
  );
}

// Markdown Editor Pane: a pretty rendered Preview (Obsidian-style reading view)
// by default, toggleable to a raw-source Edit mode that saves on Cmd/Ctrl+S.
function WorkbenchMarkdownView(props: {
  paneId: string;
  value: string;
  readOnly: boolean;
  dirty: boolean;
  revision: string;
  handlers: ProductShellHandlers;
}): ReactElement {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  // Render once per source string (cached), so unrelated re-renders don't
  // re-parse the whole file. Spec D8.
  const previewHtml = useMemo(() => renderMarkdownCached(markdownRenderer, props.value), [props.value]);
  const toggle = (target: "preview" | "edit", label: string) =>
    createElement(
      "button",
      {
        type: "button",
        className: "workbench-md-toggle__option",
        "data-active": mode === target ? "true" : "false",
        "aria-pressed": mode === target,
        onClick: () => setMode(target),
      },
      label,
    );
  return createElement(
    "div",
    { className: "workbench-md", "data-md-mode": mode },
    createElement(
      "div",
      { className: "workbench-md-toggle", role: "group", "aria-label": "Markdown view mode" },
      toggle("preview", "Preview"),
      props.readOnly ? null : toggle("edit", "Edit"),
    ),
    mode === "preview" || props.readOnly
      ? createElement("div", {
          className: "workbench-md-preview markdown-body",
          "aria-label": "Markdown preview",
          dangerouslySetInnerHTML: { __html: previewHtml },
        })
      : createElement(WorkbenchCodeEditor, {
          paneId: props.paneId,
          value: props.value,
          readOnly: props.readOnly,
          dirty: props.dirty,
          language: "markdown",
          revision: props.revision,
          navigationTarget: undefined,
          handlers: props.handlers,
        }),
  );
}

function createWorkbenchEditorReferences(
  references: NonNullable<
    ProductShellViewModel["appChrome"]["activeWorkbenchPane"]
  >["references"],
): ReactElement | null {
  if (references === undefined) {
    return null;
  }
  const heading = `References${references.query ? ` to ${references.query}` : ""} (${references.items.length}${references.truncated ? "+" : ""})`;
  return createElement(
    "div",
    { className: "workbench-editor-references", "aria-label": "References" },
    createElement("div", { className: "workbench-editor-references__heading" }, heading),
    references.items.length === 0
      ? createElement("div", { className: "workbench-editor-references__empty" }, "No references found.")
      : createElement(
          "ul",
          { className: "workbench-editor-references__list" },
          references.items.map((item, index) =>
            createElement(
              "li",
              {
                key: `${item.relativePath}:${item.line}:${item.character}:${index}`,
                className: "workbench-editor-references__item",
              },
              createElement(
                "span",
                { className: "workbench-editor-references__location" },
                `${item.relativePath}:${item.line + 1}:${item.character + 1}`,
              ),
              item.label
                ? createElement("span", { className: "workbench-editor-references__label" }, item.label)
                : null,
            ),
          ),
        ),
  );
}

function inferEditorLanguage(path: string | undefined): string {
  const ext = (path ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mts", "cts"].includes(ext)) return "ts";
  if (ext === "json") return "json";
  if (ext === "rs") return "rust";
  if (ext === "css") return "css";
  if (["md", "markdown", "mdx"].includes(ext)) return "markdown";
  return "text";
}

function editorLanguageExtensions(language: string) {
  switch (language) {
    case "ts":
      return [javascript({ jsx: true, typescript: true })];
    case "json":
      return [jsonLanguage()];
    case "rust":
      return [rust()];
    case "css":
      return [cssLanguage()];
    case "markdown":
      return [markdownLang()];
    default:
      return [];
  }
}

// Real code editor: CodeMirror 6 (MIT). Grammar-based highlighting, line
// numbers, selection, editing. Read-only Panes still render highlighted via
// CodeMirror with editing disabled.
function WorkbenchCodeEditor(props: {
  paneId: string;
  value: string;
  readOnly: boolean;
  dirty: boolean;
  language: string;
  revision: string;
  navigationTarget?: NonNullable<
    ProductShellViewModel["appChrome"]["activeWorkbenchPane"]
  >["navigationTarget"];
  handlers: ProductShellHandlers;
}): ReactElement {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const nav = props.navigationTarget;
  useEffect(() => {
    const view = editorRef.current?.view;
    if (nav === undefined || view === undefined) {
      return;
    }
    const lineNumber = Math.min(Math.max(nav.line + 1, 1), view.state.doc.lines);
    const lineInfo = view.state.doc.line(lineNumber);
    const from = Math.min(lineInfo.from + Math.max(nav.character, 0), lineInfo.to);
    const to = Math.min(from + Math.max(nav.length ?? 0, 0), view.state.doc.length);
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    view.focus();
  }, [nav?.line, nav?.character, nav?.length, props.revision]);

  // Cmd/Ctrl+S saves — like a real editor, instead of a Save button.
  const saveKeymap = keymap.of([
    {
      key: "Mod-s",
      preventDefault: true,
      run: () => {
        props.handlers.onEditorSave(props.paneId);
        return true;
      },
    },
  ]);

  // Right-click targets the symbol under the pointer (move the caret there so
  // the LSP query resolves the clicked identifier), then opens the editor
  // context menu with Go to Definition / Find References.
  const openContextMenu = (event: {
    preventDefault: () => void;
    clientX: number;
    clientY: number;
  }) => {
    event.preventDefault();
    const view = editorRef.current?.view;
    if (view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos !== null && pos !== undefined) {
        view.dispatch({ selection: { anchor: pos } });
        props.handlers.onEditorCursorChange(props.paneId, pos);
      }
    }
    setContextMenu({ x: event.clientX, y: event.clientY });
  };
  const closeMenu = () => setContextMenu(null);

  const menuItem = (label: string, onSelect: () => void, disabled = false) =>
    createElement(
      "button",
      {
        type: "button",
        className: "workbench-editor-menu__item",
        disabled,
        onClick: () => {
          onSelect();
          closeMenu();
        },
      },
      label,
    );

  return createElement(
    "div",
    {
      className: "workbench-editor-surface",
      "aria-label": "Editor Pane text",
      "data-editor-language": props.language,
      "data-navigation-target": nav?.label,
      onContextMenu: openContextMenu,
    },
    createElement(CodeMirror, {
      ref: editorRef,
      className: "workbench-editor-cm",
      value: props.value,
      editable: !props.readOnly,
      readOnly: props.readOnly,
      basicSetup: {
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: !props.readOnly,
      },
      extensions: [saveKeymap, EditorView.lineWrapping, ...editorLanguageExtensions(props.language)],
      onChange: (next: string) => props.handlers.onEditorDraftChange(props.paneId, next),
      onUpdate: (update: ViewUpdate) => {
        if (update.selectionSet) {
          props.handlers.onEditorCursorChange(props.paneId, update.state.selection.main.head);
        }
      },
    }),
    contextMenu === null
      ? null
      : createElement(
          "div",
          {
            className: "workbench-editor-menu-backdrop",
            onClick: closeMenu,
            onContextMenu: (event: { preventDefault: () => void }) => {
              event.preventDefault();
              closeMenu();
            },
          },
          createElement(
            "div",
            {
              className: "workbench-editor-menu",
              role: "menu",
              "aria-label": "Editor actions",
              style: { left: `${contextMenu.x}px`, top: `${contextMenu.y}px` } as CSSProperties,
            },
            menuItem("Go to Definition", () => props.handlers.onEditorGoToDefinition(props.paneId)),
            menuItem("Find References", () => props.handlers.onEditorGoToReferences(props.paneId)),
            props.readOnly
              ? null
              : menuItem("Save", () => props.handlers.onEditorSave(props.paneId), !props.dirty),
          ),
        ),
  );
}

function WorkbenchDiffPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
}): ReactElement {
  return createElement(
    "div",
    { className: "workbench-pane-content workbench-pane-content--diff" },
    createWorkbenchPaneHeading("diff", props.pane.title, props.pane.truncated ? "truncated" : "bounded"),
    createWorkbenchPaneMeta([
      ["Path", props.pane.relativePath ?? props.pane.filePath],
      ["Bytes", formatBeforeAfterBytes(props.pane.beforeByteLength, props.pane.afterByteLength)],
      ["Revision", props.pane.revision],
    ]),
    props.pane.diffText ? createDiffView(props.pane.diffText) : null,
  );
}

type DiffLineKind = "header" | "hunk" | "added" | "removed" | "context";

function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "header";
  }
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("+")) {
    return "added";
  }
  if (line.startsWith("-")) {
    return "removed";
  }
  return "context";
}

interface DiffRow {
  kind: DiffLineKind;
  oldNo?: number;
  newNo?: number;
  text: string;
}

// Parses a unified diff into rows carrying old/new line numbers (from the @@
// hunk ranges), so the view can render GitHub/VS Code-style line-number gutters.
function parseDiffRows(diffText: string): { rows: DiffRow[]; adds: number; dels: number } {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let adds = 0;
  let dels = 0;
  for (const line of diffText.split("\n")) {
    const kind = classifyDiffLine(line);
    if (kind === "header") {
      // The +++/--- file lines duplicate the pane's path breadcrumb — skip them.
      continue;
    }
    if (kind === "hunk") {
      const match = line.match(/@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
      if (match) {
        oldNo = Number(match[1]);
        newNo = Number(match[2]);
      }
      rows.push({ kind, text: line });
      continue;
    }
    if (kind === "added") {
      adds += 1;
      rows.push({ kind, newNo, text: line.slice(1) });
      newNo += 1;
      continue;
    }
    if (kind === "removed") {
      dels += 1;
      rows.push({ kind, oldNo, text: line.slice(1) });
      oldNo += 1;
      continue;
    }
    const text = line.startsWith(" ") ? line.slice(1) : line;
    rows.push({ kind: "context", oldNo, newNo, text });
    oldNo += 1;
    newNo += 1;
  }
  return { rows, adds, dels };
}

// Renders the bounded unified diff GitHub/VS Code-style: a stat header, then
// rows with old/new line-number gutters, a change marker, and syntax-highlighted
// code. Added/removed lines read distinctly; hunk headers act as separators.
function createDiffView(diffText: string): ReactElement {
  const { rows, adds, dels } = parseDiffRows(diffText);
  const lang = guessLanguage(
    rows
      .filter((row) => row.kind === "added" || row.kind === "removed" || row.kind === "context")
      .map((row) => row.text)
      .join("\n"),
  );
  return createElement(
    "div",
    { className: "workbench-diff", "aria-label": "Diff view", role: "group" },
    createElement(
      "div",
      { className: "workbench-diff__stat" },
      adds > 0 ? createElement("span", { className: "workbench-diff__stat-add" }, `+${adds}`) : null,
      dels > 0 ? createElement("span", { className: "workbench-diff__stat-del" }, `−${dels}`) : null,
      createElement("span", { className: "workbench-diff__stat-label" }, adds + dels === 1 ? "1 change" : `${adds + dels} changes`),
    ),
    createElement(
      "div",
      { className: "workbench-diff__body" },
      rows.map((row, index) => {
        if (row.kind === "hunk") {
          return createElement(
            "div",
            { key: index, className: "workbench-diff-row workbench-diff-row--hunk" },
            createElement("span", { className: "workbench-diff-row__text" }, row.text),
          );
        }
        const marker = row.kind === "added" ? "+" : row.kind === "removed" ? "−" : "";
        return createElement(
          "div",
          { key: index, className: `workbench-diff-row workbench-diff-row--${row.kind}` },
          createElement("span", { className: "workbench-diff-row__gutter", "aria-hidden": "true" }, row.oldNo ?? ""),
          createElement("span", { className: "workbench-diff-row__gutter", "aria-hidden": "true" }, row.newNo ?? ""),
          createElement("span", { className: "workbench-diff-row__marker", "aria-hidden": "true" }, marker),
          createElement("span", {
            className: "workbench-diff-row__text",
            dangerouslySetInnerHTML: { __html: highlightToHtml(row.text, lang) },
          }),
        );
      }),
    ),
  );
}

function createWorkbenchPaneHeading(kind: string, title: string, status?: string): ReactElement {
  return createElement(
    "div",
    { className: "workbench-pane-heading" },
    createElement("div", { className: "workbench-column__kind" }, kind),
    createElement(
      "div",
      { className: "workbench-pane-heading__row" },
      createElement("h2", null, title),
      status ? createElement("span", { className: "workbench-pane-heading__status" }, status) : null,
    ),
  );
}

function createWorkbenchPaneMeta(rows: Array<[string, string | undefined]>): ReactElement | null {
  const visibleRows = rows.filter(([, value]) => value !== undefined && value.length > 0);
  if (visibleRows.length === 0) {
    return null;
  }
  return createElement(
    "dl",
    { className: "workbench-pane-meta" },
    visibleRows.flatMap(([label, value]) => [
      createElement("dt", { key: `${label}-label` }, label),
      createElement("dd", { key: `${label}-value` }, value),
    ]),
  );
}

function createPreviewBlock(label: string, text: string, extraClassName = ""): ReactElement {
  return createElement(
    "pre",
    {
      className: `workbench-preview ${extraClassName}`.trim(),
      "aria-label": label,
    },
    text,
  );
}

function formatBeforeAfterBytes(before: number | undefined, after: number | undefined): string | undefined {
  return typeof before === "number" && typeof after === "number"
    ? `${before} -> ${after} bytes`
    : undefined;
}

// Live terminal byte sinks keyed by paneId. Terminal output is a hot path, so
// it is written straight to the GPU terminal and never funneled through React
// state (which would re-render the whole shell per chunk).
const terminalOutputSinks = new Map<string, (chunk: string) => void>();

function routeProductShellTerminalOutput(paneId: string, chunk: string): boolean {
  const sink = terminalOutputSinks.get(paneId);
  if (sink === undefined) {
    return false;
  }
  sink(chunk);
  return true;
}

// Real GPU-accelerated terminal: xterm.js with the WebGL addon (MIT). Drawing
// many cells is a simple, parallel job — like v1's WGPU cell rendering — so it
// belongs on the GPU, not per-cell DOM. Falls back to xterm's default renderer
// when WebGL is unavailable (headless/jsdom/no-GPU).
function WorkbenchTerminalView(props: {
  paneId: string;
  initialText: string;
  onInput: (paneId: string, bytes: string) => void;
  onResize?: (paneId: string, cols: number, rows: number) => void;
}): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (host === null || XtermTerminal === undefined) {
      return;
    }
    // xterm core mounts synchronously so the terminal is visible immediately.
    const term = new XtermTerminal({
      convertEol: true,
      fontSize: 12,
      fontFamily: '"Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      scrollback: 5000,
      theme: {
        background: "#1b1b1d",
        foreground: "#e4e4e6",
        cursor: "#e4e4e6",
        selectionBackground: "#3a3a40",
      },
    });
    term.open(host);
    if (props.initialText.length > 0) {
      term.write(props.initialText);
    }
    const dataSub = term.onData((data) => props.onInput(props.paneId, data));
    terminalOutputSinks.set(props.paneId, (chunk) => term.write(chunk));

    let active = true;
    let fitAddon: { fit: () => void } | undefined;
    let observer: ResizeObserver | undefined;
    // Attach the fit + GPU (WebGL) addons asynchronously; they only upgrade an
    // already-visible terminal, so there is no first-open delay.
    void (async () => {
      try {
        const fitMod = (await import("@xterm/addon-fit")) as {
          FitAddon?: new () => { fit: () => void };
          default?: { FitAddon: new () => { fit: () => void } };
        };
        const FitAddonCtor = fitMod.FitAddon ?? fitMod.default?.FitAddon;
        if (active && FitAddonCtor !== undefined) {
          fitAddon = new FitAddonCtor();
          term.loadAddon(fitAddon as never);
          // After fitting, tell the backend the real grid size so the PTY/shell
          // matches the rendered terminal (otherwise prompts wrap/redraw wrong).
          const emitResize = () => {
            const dims = term as { cols?: number; rows?: number };
            if (typeof dims.cols === "number" && typeof dims.rows === "number") {
              props.onResize?.(props.paneId, dims.cols, dims.rows);
            }
          };
          fitAddon.fit();
          emitResize();
          if (typeof ResizeObserver !== "undefined" && hostRef.current !== null) {
            observer = new ResizeObserver(() => {
              try {
                fitAddon?.fit();
                emitResize();
              } catch {
                // measurement unavailable
              }
            });
            observer.observe(hostRef.current);
          }
        }
      } catch {
        // fit addon unavailable (headless/jsdom) — terminal still renders.
      }
      try {
        const webglMod = (await import("@xterm/addon-webgl")) as {
          WebglAddon?: new () => { onContextLoss: (cb: () => void) => void; dispose: () => void };
          default?: { WebglAddon: new () => { onContextLoss: (cb: () => void) => void; dispose: () => void } };
        };
        const WebglAddonCtor = webglMod.WebglAddon ?? webglMod.default?.WebglAddon;
        if (active && WebglAddonCtor !== undefined) {
          const webgl = new WebglAddonCtor();
          webgl.onContextLoss(() => webgl.dispose());
          term.loadAddon(webgl as never);
        }
      } catch {
        // No WebGL (headless/jsdom/no-GPU) — xterm uses its default renderer.
      }
    })();

    return () => {
      active = false;
      terminalOutputSinks.delete(props.paneId);
      dataSub.dispose();
      observer?.disconnect();
      term.dispose();
    };
  }, [props.paneId]);
  return createElement("div", {
    className: "workbench-terminal-xterm",
    "data-terminal-xterm": props.paneId,
    ref: hostRef,
  });
}

function WorkbenchTerminalPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
}): ReactElement {
  // A real dark terminal: the xterm surface fills the pane and takes keystrokes
  // directly (xterm.onData routes to onTerminalInput). No metadata chrome.
  return createElement(
    "div",
    { className: "workbench-terminal", "data-terminal-status": props.pane.status ?? "ready" },
    createElement(WorkbenchTerminalView, {
      paneId: props.pane.paneId,
      initialText: props.pane.transcriptPreview ?? "",
      onInput: props.handlers.onTerminalInput,
      onResize: props.handlers.onTerminalResize,
    }),
  );
}

// Shimmer rows shown while the active thread's file tree is (re)loading, so a thread
// switch shows motion instead of a blank/empty tree.
function createFileTreeSkeleton(): ReactElement {
  const widths = [82, 64, 73, 58, 70, 50, 66, 60];
  return createElement(
    "div",
    { className: "file-tree-skeleton", "aria-hidden": true, "aria-label": "Loading files" },
    ...widths.map((width, index) =>
      createElement(
        "div",
        { key: index, className: "file-tree-skeleton__row", style: { "--depth": index % 3 } as CSSProperties },
        createElement("span", { className: "file-tree-skeleton__icon" }),
        createElement("span", { className: "file-tree-skeleton__label", style: { width: `${width}%` } as CSSProperties }),
      ),
    ),
  );
}

// Rail shimmer shown on a cold boot until the first thread list arrives.
function createRailSkeleton(): ReactElement {
  const groups: number[][] = [[78, 60], [70, 84, 52], [66]];
  return createElement(
    "div",
    { className: "rail-skeleton", "aria-hidden": true, "aria-label": "Loading threads" },
    ...groups.map((rows, groupIndex) =>
      createElement(
        "div",
        { key: groupIndex, className: "rail-skeleton__group" },
        createElement("span", { className: "rail-skeleton__heading", style: { width: "38%" } as CSSProperties }),
        ...rows.map((width, rowIndex) =>
          createElement(
            "div",
            { key: rowIndex, className: "rail-skeleton__row" },
            createElement("span", { className: "rail-skeleton__dot" }),
            createElement("span", { className: "rail-skeleton__label", style: { width: `${width}%` } as CSSProperties }),
          ),
        ),
      ),
    ),
  );
}

function createFileTreeColumn(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "aside",
    { className: "file-tree-column", "aria-label": "FileTree", "data-column": "file-tree" },
    createColumnResizeHandle("fileTree", "left", handlers),
    createElement(
      "header",
      { className: "file-tree-column__top-row column-top-row", "aria-label": "FileTree Top Row" },
      createElement(
        "div",
        { className: "column-top-row__leading" },
        createElement(FolderOpen, { size: 15, strokeWidth: 1.9, "aria-hidden": true }),
        createElement("span", { className: "column-top-row__title" }, viewModel.fileTree.cwdLabel),
      ),
      // Spacer; the FileTree toggle now lives in the fixed window cluster.
      createElement("div", { className: "column-top-row__trailing" }),
    ),
    createElement(
      "div",
      { className: "file-tree-column__body" },
      createElement(
        "label",
        { className: "file-tree-column__search" },
        createElement(Search, { size: 14, strokeWidth: 1.9, "aria-hidden": true }),
        createElement("span", null, "Filter files..."),
      ),
      createElement(
        "div",
        { className: "file-tree-column__entries" },
        viewModel.fileTree.loading
          ? createFileTreeSkeleton()
          : viewModel.fileTree.entries.map((entry) =>
          createElement(
            "button",
            {
              key: entry.id,
              type: "button",
              className: `file-tree-row${entry.active ? " file-tree-row--active" : ""}`,
              "data-depth": entry.depth,
              "data-file-kind": entry.kind,
              "data-expanded": entry.kind === "folder" ? String(entry.expanded ?? true) : undefined,
              "aria-expanded": entry.kind === "folder" ? (entry.expanded ?? true) : undefined,
              style: { "--file-tree-depth": entry.depth } as CSSProperties,
              onClick: () => handlers.onFileTreeEntryOpen(entry.id),
            },
            // Folders show a disclosure chevron + open/closed folder icon; both
            // are clickable to toggle. Files open in the editor.
            entry.kind === "folder"
              ? createElement(ChevronRight, {
                  size: 12,
                  strokeWidth: 2,
                  className: `file-tree-row__chevron${entry.expanded === false ? "" : " file-tree-row__chevron--expanded"}`,
                  "aria-hidden": true,
                })
              : createElement("span", { className: "file-tree-row__chevron-spacer", "aria-hidden": true }),
            entry.kind === "folder"
              ? createElement(entry.expanded === false ? Folder : FolderOpen, { size: 14, strokeWidth: 1.8, "aria-hidden": true })
              : createElement(fileIconFor(entry.name), { size: 14, strokeWidth: 1.8, "aria-hidden": true }),
            createElement("span", null, entry.name),
          ),
        ),
      ),
    ),
  );
}

function createProjectSection(
  projectGroups: ProductShellProjectGroupView[],
  handlers: ProductShellHandlers,
): ReactElement {
  const collapsed = handlers.isSectionCollapsed("Projects");
  return createElement(
    "section",
    { className: "left-ui-section", "aria-label": "Projects" },
    createSectionHeader(
      "Projects",
      projectGroups.length,
      collapsed,
      () => handlers.onToggleSection("Projects"),
      { label: "Add project", onClick: handlers.onAddProject },
    ),
    collapsed ? null : projectGroups.map((project) => createProjectGroup(project, handlers)),
  );
}

// One expandable Project group: the project row (toggle + folder + actions) and,
// when expanded, its Thread rows. Shared by the Projects and Pinned sections.
function createProjectGroup(
  project: ProductShellProjectGroupView,
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "div",
    { key: project.projectId, className: "project-group" },
    createElement(
      "div",
      { className: "project-row-wrap" },
      createElement(
        "div",
        {
          className: `project-row${project.contextMenuOpen ? " project-row--menu-open" : ""}`,
          "data-left-row-kind": "project",
          "data-project-row": project.projectId,
          "data-expanded": project.expanded,
        },
        createElement(
          "button",
          {
            className: "project-row__toggle",
            type: "button",
            "aria-label": project.expanded ? "Collapse project" : "Expand project",
            "aria-expanded": project.expanded,
            onClick: () => handlers.onProjectToggle(project.projectId),
          },
          createElement(ChevronRight, {
            size: 13,
            strokeWidth: 2,
            className: `project-row__chevron${project.expanded ? " project-row__chevron--expanded" : ""}`,
            "aria-hidden": true,
          }),
          project.expanded
            ? createElement(FolderOpen, { size: 16, strokeWidth: 1.85, "aria-hidden": true })
            : createElement(Folder, { size: 16, strokeWidth: 1.85, "aria-hidden": true }),
          project.renaming
            ? createElement("input", {
                className: "project-row__rename-input",
                "aria-label": "Rename project",
                defaultValue: project.name,
                autoFocus: true,
                onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
                onKeyDown: (event: {
                  key: string;
                  currentTarget: { value: string };
                  preventDefault: () => void;
                }) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handlers.onProjectRenameSubmit(project.projectId, event.currentTarget.value);
                  } else if (event.key === "Escape") {
                    handlers.onProjectRenameCancel();
                  }
                },
                onBlur: (event: { currentTarget: { value: string } }) =>
                  handlers.onProjectRenameSubmit(project.projectId, event.currentTarget.value),
              })
            : project.creatingWorktree
              ? createElement("input", {
                  className: "project-row__rename-input",
                  "aria-label": "New worktree name",
                  placeholder: "worktree name…",
                  autoFocus: true,
                  onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
                  onKeyDown: (event: {
                    key: string;
                    currentTarget: { value: string };
                    preventDefault: () => void;
                  }) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handlers.onProjectCreateWorktreeSubmit(
                        project.projectId,
                        event.currentTarget.value,
                      );
                    } else if (event.key === "Escape") {
                      handlers.onProjectCreateWorktreeCancel();
                    }
                  },
                  onBlur: () => handlers.onProjectCreateWorktreeCancel(),
                })
              : createElement("span", { className: "project-row__title" }, project.name),
          // When collapsed, bubble a child thread's attention to the project row.
          !project.expanded && project.attention
            ? createElement("span", {
                className: "project-row__attention",
                "aria-label": "A thread in this project needs attention",
              })
            : null,
          // Likewise bubble live running activity so background work is visible.
          !project.expanded && project.running && !project.attention
            ? createElement("span", {
                className: "project-row__running",
                "aria-label": "A thread in this project is running",
              })
            : null,
        ),
        createElement(
          "span",
          { className: "project-row__actions" },
          createIconButton(
            "Project menu",
            createElement(MoreHorizontal, { size: 15, strokeWidth: 1.9 }),
            (event) =>
              handlers.onLeftUiMenuOpen(
                { kind: "project", projectId: project.projectId },
                menuAnchorFromEvent(event),
              ),
            "project-row__action",
          ),
          createIconButton(
            "New thread in project",
            createElement(MessageSquarePlus, { size: 15, strokeWidth: 1.9 }),
            () => handlers.onNewThreadInProject(project.projectId),
            "project-row__action",
          ),
        ),
      ),
    ),
    // Kept mounted and height-animated (grid-rows) so the folder expands AND
    // collapses smoothly in both directions.
    createElement(
      "div",
      { className: "collapsible", "data-expanded": project.expanded },
      createElement(
        "div",
        { className: "collapsible__inner" },
        createElement(ProjectThreadList, { threads: project.threads, handlers }),
      ),
    ),
  );
}

// How many threads a project shows before collapsing the rest behind "Show more"
// (projects can accumulate many adopted local sessions).
const THREAD_PREVIEW_LIMIT = 8;

// The thread list under a project: shows the first N, with a "Show N more"
// toggle to reveal the rest (and "Show less" to re-collapse).
function ProjectThreadList({
  threads,
  handlers,
}: {
  threads: ProductShellThreadView[];
  handlers: ProductShellHandlers;
}): ReactElement {
  const [showAll, setShowAll] = useState(false);
  if (threads.length === 0) {
    return createElement(
      "div",
      { className: "project-group__threads" },
      createElement("p", { className: "project-group__empty" }, "No threads yet"),
    );
  }
  const visible = showAll ? threads : threads.slice(0, THREAD_PREVIEW_LIMIT);
  const hidden = threads.length - visible.length;
  return createElement(
    "div",
    { className: "project-group__threads" },
    ...visible.map((thread) => createThreadRow(thread, handlers)),
    hidden > 0
      ? createElement(
          "button",
          {
            key: "show-more",
            type: "button",
            className: "project-group__show-more",
            onClick: () => setShowAll(true),
          },
          `Show ${hidden} more`,
        )
      : showAll && threads.length > THREAD_PREVIEW_LIMIT
        ? createElement(
            "button",
            {
              key: "show-less",
              type: "button",
              className: "project-group__show-more",
              onClick: () => setShowAll(false),
            },
            "Show less",
          )
        : null,
  );
}

// The Pinned section: pinned project shortcuts (folder icon) then pinned
// threads. Hidden entirely when nothing is pinned (per the empty-Pinned rule).
function createPinnedSection(
  pinnedProjects: ProductShellPinnedProjectView[],
  pinnedThreads: ProductShellThreadView[],
  handlers: ProductShellHandlers,
): ReactElement | null {
  const total = pinnedProjects.length + pinnedThreads.length;
  if (total === 0) {
    return null;
  }
  const collapsed = handlers.isSectionCollapsed("Pinned");
  return createElement(
    "section",
    { className: "left-ui-section", "aria-label": "Pinned" },
    createSectionHeader("Pinned", total, collapsed, () => handlers.onToggleSection("Pinned")),
    collapsed
      ? null
      : [
          ...pinnedProjects.map((project) => createProjectGroup(project, handlers)),
          ...pinnedThreads.map((thread) => createThreadRow(thread, handlers)),
        ],
  );
}

// A single icon button (sits inline at the right of the Search row) that opens
// the list-display settings dropdown (group + sort). See
// docs_v2/specs/thread-list-display-settings.md.
function createListSettingsButton(handlers: ProductShellHandlers): ReactElement {
  return createElement(
    "button",
    {
      type: "button",
      className: "list-settings-bar__button",
      title: "List display settings",
      "aria-label": "List display settings",
      onClick: (event: { currentTarget: HTMLElement }) =>
        handlers.onLeftUiMenuOpen({ kind: "list_settings" }, menuAnchorFromEvent(event)),
    },
    createElement(SlidersHorizontal, { size: 15, strokeWidth: 1.9, "aria-hidden": true }),
  );
}

// The list-display settings dropdown content (Group by / Sort by), rendered in
// the shared Left UI menu overlay with a check on the active option.
function createListSettingsMenu(
  settings: ProductShellListSettings,
  handlers: ProductShellHandlers,
): ReactElement {
  const close = () => handlers.onLeftUiMenuOpen(null);
  const optionRow = (
    label: string,
    selected: boolean,
    onPick: () => void,
  ): ReactElement =>
    createElement(
      "button",
      {
        key: label,
        type: "button",
        className: "left-ui-context-menu__item",
        onClick: () => {
          onPick();
          close();
        },
      },
      createElement(
        "span",
        { className: "left-ui-context-menu__icon", "aria-hidden": true },
        selected ? createElement(Check, { size: 14, strokeWidth: 2 }) : null,
      ),
      createElement("span", null, label),
    );

  const sectionLabel = (text: string): ReactElement =>
    createElement("div", { key: `label-${text}`, className: "left-ui-context-menu__label" }, text);

  return createElement(
    "div",
    { className: "left-ui-context-menu left-ui-context-menu--list_settings" },
    sectionLabel("Group by"),
    optionRow("By project", settings.groupBy === "project", () =>
      handlers.onListSettingsChange({ groupBy: "project" }),
    ),
    optionRow("By thread", settings.groupBy === "thread", () =>
      handlers.onListSettingsChange({ groupBy: "thread" }),
    ),
    sectionLabel("Sort by"),
    optionRow("Recent activity", settings.sortBy === "recent", () =>
      handlers.onListSettingsChange({ sortBy: "recent" }),
    ),
    optionRow("Created", settings.sortBy === "created", () =>
      handlers.onListSettingsChange({ sortBy: "created" }),
    ),
    optionRow("Name", settings.sortBy === "name", () =>
      handlers.onListSettingsChange({ sortBy: "name" }),
    ),
    // Worktree grouping only applies to project mode (no project groups in thread mode).
    ...(settings.groupBy === "project"
      ? [
          sectionLabel("Worktrees"),
          optionRow("Group under repo", settings.groupWorktreesByRepo, () =>
            handlers.onListSettingsChange({
              groupWorktreesByRepo: !settings.groupWorktreesByRepo,
            }),
          ),
        ]
      : []),
    sectionLabel("Sessions"),
    // Off by default: the list shows only Threads started in Tide. On reveals
    // External Sessions (agent history Tide did not start).
    optionRow("Show external sessions", settings.showExternalSessions, () =>
      handlers.onListSettingsChange({
        showExternalSessions: !settings.showExternalSessions,
      }),
    ),
  );
}

function createThreadSection(
  title: string,
  threads: ProductShellThreadView[],
  handlers: ProductShellHandlers,
): ReactElement | null {
  // The Pinned section is hidden entirely when nothing is pinned.
  if (title === "Pinned" && threads.length === 0) {
    return null;
  }
  const collapsed = handlers.isSectionCollapsed(title);
  return createElement(
    "section",
    { className: "left-ui-section", "aria-label": title },
    createSectionHeader(
      title,
      threads.length,
      collapsed,
      () => handlers.onToggleSection(title),
      title === "Scratch"
        ? { label: "New scratch thread", onClick: handlers.onNewScratchThread }
        : undefined,
    ),
    collapsed ? null : threads.map((thread) => createThreadRow(thread, handlers)),
  );
}

function createThreadRow(
  thread: ProductShellThreadView,
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "div",
    { key: thread.threadId, className: "thread-row-wrap" },
    createElement(
      "div",
      {
        className: [
          "thread-row",
          thread.active ? "thread-row--active" : "",
          thread.contextMenuOpen ? "thread-row--menu-open" : "",
          thread.archiveConfirming ? "thread-row--archive-confirming" : "",
        ]
          .filter(Boolean)
          .join(" "),
        "data-left-row-kind": "thread",
        "data-thread-row": thread.threadId,
        "data-active": thread.active,
        onMouseLeave: thread.archiveConfirming ? handlers.onLeftUiTransientClear : undefined,
      },
      thread.renaming
        ? createElement("input", {
            className: "thread-row__rename-input",
            "aria-label": "Rename thread",
            defaultValue: thread.title,
            autoFocus: true,
            onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
            onKeyDown: (event: {
              key: string;
              currentTarget: { value: string };
              preventDefault: () => void;
            }) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handlers.onThreadRenameSubmit(thread.threadId, event.currentTarget.value);
              } else if (event.key === "Escape") {
                event.preventDefault();
                handlers.onThreadRenameCancel();
              }
            },
            onBlur: (event: { currentTarget: { value: string } }) =>
              handlers.onThreadRenameSubmit(thread.threadId, event.currentTarget.value),
          })
        : createElement(
            "button",
            {
              className: "thread-row__main",
              type: "button",
              "aria-pressed": thread.active,
              onClick: () => handlers.onThreadSelect(thread.threadId),
              onDoubleClick: () => handlers.onThreadRenameStart(thread.threadId),
            },
            createElement(AgentIdentityIcon, { agentId: thread.agentId }),
            createElement("span", { className: "thread-row__title" }, thread.title),
          ),
      thread.archiveConfirming
        ? createElement(
            "button",
            {
              className: "thread-row__confirm",
              type: "button",
              "aria-label": "Confirm Archive Thread",
              onClick: () => handlers.onThreadArchiveConfirm(thread.threadId),
            },
            "Confirm",
          )
        : [
            thread.attention ? createElement("span", { key: "attention", className: "thread-row__attention" }) : null,
            thread.running && !thread.attention
              ? createElement("span", {
                  key: "running",
                  className: "thread-row__running",
                  "aria-label": "Agent is running",
                })
              : null,
            createElement("span", { key: "time", className: "thread-row__time" }, thread.time),
            createElement(
              "span",
              { key: "actions", className: "thread-row__actions" },
              createIconButton(
                thread.pinned ? "Unpin Thread" : "Pin Thread",
                thread.pinned
                  ? createElement(PinOff, { size: 14, strokeWidth: 1.9 })
                  : createElement(Pin, { size: 14, strokeWidth: 1.9 }),
                () => handlers.onThreadPinToggle(thread.threadId),
                "thread-row__action",
              ),
              createIconButton(
                "Archive Thread",
                createElement(Archive, { size: 14, strokeWidth: 1.9 }),
                () => handlers.onThreadArchiveIntent(thread.threadId),
                "thread-row__action",
              ),
            ),
          ],
    ),
  );
}

function createLeftNavRow(label: string, icon: ReactNode, onClick?: () => void): ReactElement {
  return createElement(
    "button",
    { className: "left-ui-nav-row", type: "button", onClick },
    icon,
    createElement("span", null, label),
  );
}

function createSectionHeader(
  title: string,
  itemCount: number,
  collapsed: boolean,
  onToggle: () => void,
  action?: { label: string; onClick: () => void },
): ReactElement {
  // Collapsible only when there are items below; otherwise a static label.
  const toggle =
    itemCount === 0
      ? createElement("span", { className: "left-ui-section__title" }, title)
      : createElement(
          "button",
          {
            type: "button",
            className: `left-ui-section__toggle${collapsed ? " left-ui-section__toggle--collapsed" : ""}`,
            "aria-expanded": !collapsed,
            onClick: onToggle,
          },
          createElement(ChevronRight, {
            size: 12,
            strokeWidth: 2.2,
            className: "left-ui-section__chevron",
            "aria-hidden": true,
          }),
          createElement("span", { className: "left-ui-section__title" }, title),
        );
  return createElement(
    "div",
    { className: "left-ui-section__header" },
    toggle,
    action
      ? createIconButton(
          action.label,
          createElement(Plus, { size: 15, strokeWidth: 2 }),
          action.onClick,
          "left-ui-section__action",
        )
      : null,
  );
}

function createColumnResizeHandle(
  edge: "left" | "workbench" | "fileTree",
  side: "left" | "right",
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement("div", {
    className: `column-resize-handle column-resize-handle--${side}`,
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Resize column",
    "data-resize-edge": edge,
    onPointerDown: (event: { clientX: number; preventDefault: () => void }) =>
      handlers.onResizeStart(edge, event),
  });
}

// Renders the left-rail context menu as a fixed popover anchored to its trigger
// (escaping the rail's scroll-overflow clip), behind a transparent full-viewport
// backdrop that closes it on outside click.
function createLeftUiContextMenuOverlay(
  menu: ProductShellLeftUiMenu,
  anchor: MenuAnchorRect,
  onClose: () => void,
  handlers: ProductShellHandlers,
  listSettings: ProductShellListSettings,
): ReactElement {
  const viewportH = typeof window === "undefined" ? 900 : window.innerHeight;
  const width = menu.kind === "project" ? 244 : menu.kind === "list_settings" ? 200 : 200;
  const estimated = menu.kind === "project" ? 230 : menu.kind === "list_settings" ? 230 : 110;
  const openUp = anchor.bottom + estimated > viewportH;
  const style: Record<string, string> = {
    position: "fixed",
    left: `${anchor.left}px`,
    zIndex: "60",
  };
  if (openUp) {
    style.bottom = `${viewportH - anchor.top + 4}px`;
  } else {
    style.top = `${anchor.bottom + 4}px`;
  }
  return createElement(
    "div",
    { className: "left-ui-context-menu-backdrop", onMouseDown: onClose },
    createElement(
      "div",
      {
        onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
        style: { ...style, width: `${width}px` } as unknown as CSSProperties,
      },
      menu.kind === "list_settings"
        ? createListSettingsMenu(listSettings, handlers)
        : createLeftUiContextMenu(menu, handlers),
    ),
  );
}

interface ContextMenuItem {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}

function createLeftUiContextMenu(
  menu: Exclude<ProductShellLeftUiMenu, { kind: "list_settings" }>,
  handlers: ProductShellHandlers,
): ReactElement {
  const items: ContextMenuItem[] =
    menu.kind === "thread"
      ? [
          {
            label: "Pin / unpin",
            icon: createElement(Pin, { size: 15, strokeWidth: 1.9 }),
            onClick: () => handlers.onThreadPinToggle(menu.threadId),
          },
          {
            label: "Archive",
            icon: createElement(Archive, { size: 15, strokeWidth: 1.9 }),
            onClick: () => handlers.onThreadArchiveIntent(menu.threadId),
          },
        ]
      : [
          {
            label: "Pin project",
            icon: createElement(Pin, { size: 16, strokeWidth: 1.9 }),
            onClick: () => handlers.onProjectPinToggle(menu.projectId),
          },
          {
            label: "Open in Finder",
            icon: createElement(FolderOpen, { size: 16, strokeWidth: 1.9 }),
            onClick: () => handlers.onProjectRevealInFinder(menu.projectId),
          },
          {
            label: "Create permanent worktree",
            icon: createElement(GitBranchPlus, { size: 16, strokeWidth: 1.9 }),
            onClick: () => handlers.onProjectCreateWorktree(menu.projectId),
          },
          {
            label: "Rename project",
            icon: createElement(Pencil, { size: 16, strokeWidth: 1.9 }),
            onClick: () => handlers.onProjectRenameStart(menu.projectId),
          },
          {
            label: "Archive chats",
            icon: createElement(Archive, { size: 16, strokeWidth: 1.9 }),
            onClick: () => handlers.onProjectArchiveChats(menu.projectId),
          },
          {
            label: "Remove",
            icon: createElement(Trash2, { size: 16, strokeWidth: 1.9 }),
            onClick: () => handlers.onProjectRemove(menu.projectId),
            danger: true,
          },
        ];

  return createElement(
    "div",
    {
      className: `left-ui-context-menu left-ui-context-menu--${menu.kind}`,
      "data-left-ui-menu-kind": menu.kind,
    },
    items.map((item) =>
      createElement(
        "button",
        {
          key: item.label,
          className: `left-ui-context-menu__item${item.danger ? " left-ui-context-menu__item--danger" : ""}${item.onClick ? "" : " left-ui-context-menu__item--disabled"}`,
          type: "button",
          disabled: item.onClick === undefined,
          onClick: item.onClick,
        },
        createElement("span", { className: "left-ui-context-menu__icon", "aria-hidden": true }, item.icon),
        createElement("span", null, item.label),
      ),
    ),
  );
}

// The window is frameless (titleBarStyle: "hidden") and the macOS traffic lights
// are positioned by Electron inside this top row. Reserve their footprint with a
// drag-region spacer instead of drawing our own dots (which would double them).
function createTrafficControls(): ReactElement {
  return createElement("div", { className: "traffic-controls", "aria-hidden": "true" });
}

// Looks up a project's cwd by id across registered + thread-derived projects.
function projectCwdById(state: ProductShellState, projectId: string): string | undefined {
  return [...state.registeredProjects, ...state.projects].find(
    (project) => project.projectId === projectId,
  )?.cwd;
}

function menuAnchorFromEvent(event: { currentTarget: HTMLElement }): MenuAnchorRect {
  const rect = event.currentTarget.getBoundingClientRect();
  return { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right };
}

function createIconButton(
  label: string,
  icon: ReactNode,
  onClick?: (event: { currentTarget: HTMLElement }) => void,
  className = "icon-button",
): ReactElement {
  return createElement(
    "button",
    { className, type: "button", title: label, "aria-label": label, onClick },
    icon,
  );
}

function normalizeAgentId(agentId: string): ProductShellAgentIdentity {
  if (agentId === "claude" || agentId === "antigravity" || agentId === "openai_api") {
    return agentId;
  }
  return "codex";
}

function agentLabel(agentId: ProductShellAgentIdentity): string {
  switch (agentId) {
    case "codex":
      return "Codex CLI";
    case "claude":
      return "Claude Code";
    case "antigravity":
      return "Antigravity CLI";
    case "openai_api":
      return "OpenAI API";
  }
}
