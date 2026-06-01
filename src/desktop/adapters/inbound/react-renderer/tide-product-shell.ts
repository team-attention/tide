import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import {
  Archive,
  Check,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  GitBranchPlus,
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

// Markdown rendering for the Editor Pane Preview. `html: false` escapes raw HTML
// in file content so rendering local/agent-authored files cannot execute markup.
const markdownRenderer = new MarkdownIt({ html: false, linkify: true, typographer: true });

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
  submitProductShellComposerDraft,
  addProductShellComposerAttachment,
  removeProductShellComposerAttachment,
  saveProductShellWorkbenchEditorPane,
  toggleProductShellFileTreeWithRefresh,
  toggleProductShellLeftUi,
  toggleProductShellProject,
  toggleProductShellThreadPin,
  toggleProductShellWorkbenchWithLauncher,
  updateProductShellBrowserActionResult,
  updateProductShellBrowserSnapshot,
  updateProductShellComposerDraft,
  writeProductShellTerminalInput,
  setProductShellListSettings,
  startProductShellWorktreeCreate,
  cancelProductShellWorktreeCreate,
  DEFAULT_PRODUCT_SHELL_LIST_SETTINGS,
  type ProductShellListSettings,
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
  createWorktree(cwd: string, name: string): Promise<{ entries: ProjectRegistryEntry[]; createdCwd: string | null }>;
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
  onEditorDraftChange: (paneId: string, content: string) => void;
  onEditorCursorChange: (paneId: string, cursorOffset: number) => void;
  onEditorSave: (paneId: string) => void;
  onEditorGoToDefinition: (paneId: string) => void;
  onEditorGoToReferences: (paneId: string) => void;
  onBrowserSnapshot: (paneId: string, snapshot: ProductShellBrowserSnapshot) => void;
  onBrowserActionResult: (paneId: string, result: ProductShellBrowserActionResult) => void;
}

type RightActionOwner = "agent-chat" | "workbench" | "file-tree";

export function TideProductShell(props: TideProductShellProps): ReactElement {
  const [shellState, setShellState] = useState(() =>
    props.initialState ??
      createProductShellState({
        includeFixtureData: false,
        listSettings: loadListSettings(),
      }),
  );
  // Resizable column widths (agent chat is the flexible middle track). Drag
  // handles on column edges update these via pointer capture.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const lastSubmitAtRef = useRef(0);
  // Screen rect of the trigger that opened the left-rail context menu, so the
  // menu can anchor to it as a fixed popover (escaping the rail's scroll clip).
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchorRect | null>(null);
  // Collapsed left-rail sections (Pinned / Projects / Scratch), keyed by title.
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [columnWidths, setColumnWidths] = useState({ left: 256, workbench: 480, fileTree: 344 });
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
    setShellState((state) => setProductShellComposerFolderScope(state, cwd));
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
    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - startX;
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
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
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
        const next = applyProductShellBackendEvent(state, event);
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
  const viewModel = createProductShellViewModel(shellState);
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
        bridge
          .createWorktree(cwd, trimmed)
          .then((result) =>
            setShellState((state) => setProductShellRegisteredProjects(state, result.entries)),
          )
          .catch(() => {});
      }
      setShellState((state) => cancelProductShellWorktreeCreate(state));
    },
    onProjectCreateWorktreeCancel: () =>
      setShellState((state) => cancelProductShellWorktreeCreate(state)),
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

  return createElement(
    "div",
    {
      className: [
        "tide-product-shell",
        layoutVm.leftUiOpen ? "tide-product-shell--left-open" : "tide-product-shell--left-closed",
        layoutVm.workbenchOpen ? "tide-product-shell--workbench-open" : "tide-product-shell--workbench-closed",
        layoutVm.fileTreeOpen ? "tide-product-shell--file-tree-open" : "tide-product-shell--file-tree-closed",
      ].join(" "),
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
          gridTemplateColumns: [
            layoutVm.leftUiOpen ? `minmax(180px, ${columnWidths.left}px)` : null,
            // Never shrink the agent-chat column below the composer's usable width.
            `minmax(${CHAT_MIN}px, 1fr)`,
            layoutVm.workbenchOpen ? `minmax(280px, ${columnWidths.workbench}px)` : null,
            layoutVm.fileTreeOpen ? `minmax(220px, ${columnWidths.fileTree}px)` : null,
          ]
            .filter(Boolean)
            .join(" "),
        } as CSSProperties,
      },
      layoutVm.leftUiOpen
        ? createLeftUi(layoutVm, handlers, { menu: shellState.leftUiMenu, anchor: menuAnchor })
        : null,
      createAgentChatColumn(layoutVm, handlers),
      layoutVm.workbenchOpen ? createWorkbenchColumn(layoutVm, handlers) : null,
      layoutVm.fileTreeOpen ? createFileTreeColumn(layoutVm, handlers) : null,
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
      ...(viewModel.listSettings.groupBy === "thread"
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
  );
}

function createAgentChatColumn(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
): ReactElement {
  const rightOwner = rightActionOwner(viewModel);
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
      createElement(
        "div",
        { className: "column-top-row__trailing" },
        rightOwner === "agent-chat"
          ? createRightWindowActions(rightOwner, viewModel.workbenchOpen, handlers)
          : null,
      ),
    ),
    createElement(AgentChatShell, {
      viewModel: viewModel.agentChat,
      showThreadHeader: false,
      onDraftChange: handlers.onDraftChange,
      onSubmit: handlers.onSubmit,
      onInterrupt: handlers.onInterrupt,
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
  const rightOwner = rightActionOwner(viewModel);

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
                  tab.title,
                ),
                tab.active
                  ? createElement(
                      "button",
                      {
                        className: "workbench-tab__close",
                        type: "button",
                        title: "Close Pane",
                        "aria-label": "Close Pane",
                        onClick: () => handlers.onCloseWorkbenchPane(tab.paneId),
                      },
                      createElement(X, { size: 12, strokeWidth: 2.2, "aria-hidden": true }),
                    )
                  : null,
              ),
            ),
      ),
      createElement(
        "div",
        { className: "column-top-row__trailing" },
        createIconButton("New Pane", createElement(Plus, { size: 16, strokeWidth: 1.9 }), handlers.onNewWorkbenchPane, "top-row-button"),
        createIconButton("Close Workbench", createElement(PanelRightClose, { size: 16, strokeWidth: 1.9 }), handlers.onWorkbenchToggle, "top-row-button"),
        rightOwner === "workbench"
          ? createRightWindowActions(rightOwner, viewModel.workbenchOpen, handlers)
          : null,
      ),
    ),
    activeTab && activePane
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
          dangerouslySetInnerHTML: { __html: markdownRenderer.render(props.value) },
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

// D4: render the bounded unified diff as change-type-tagged lines so added and
// removed lines read distinctly. Unknown markers fall back to context so no
// diff content (including a trailing "[diff truncated]" notice) is hidden.
function createDiffView(diffText: string): ReactElement {
  const lines = diffText.split("\n");
  return createElement(
    "div",
    { className: "workbench-diff", "aria-label": "Diff view", role: "group" },
    lines.map((line, index) => {
      const kind = classifyDiffLine(line);
      const marker = kind === "added" ? "+" : kind === "removed" ? "-" : kind === "context" ? " " : "";
      const text =
        kind === "added" || kind === "removed" || (kind === "context" && line.startsWith(" "))
          ? line.slice(1)
          : line;
      return createElement(
        "div",
        { key: index, className: `workbench-diff-line workbench-diff-line--${kind}` },
        createElement(
          "span",
          { className: "workbench-diff-line__marker", "aria-hidden": "true" },
          marker,
        ),
        createElement("span", { className: "workbench-diff-line__text" }, text),
      );
    }),
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
          fitAddon.fit();
          if (typeof ResizeObserver !== "undefined" && hostRef.current !== null) {
            observer = new ResizeObserver(() => {
              try {
                fitAddon?.fit();
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
    }),
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
      createRightWindowActions("file-tree", viewModel.workbenchOpen, handlers),
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
        viewModel.fileTree.entries.map((entry) =>
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

function createRightWindowActions(
  owner: RightActionOwner,
  workbenchOpen: boolean,
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "div",
    { className: "right-window-actions", "data-right-actions-owner": owner },
    // Workbench open affordance. When the Workbench is open its own column header
    // owns the close control, so we only surface "Open Workbench" here.
    workbenchOpen
      ? null
      : createIconButton(
          "Open Workbench",
          createElement(PanelRightOpen, { size: 15, strokeWidth: 1.9 }),
          handlers.onWorkbenchToggle,
          "top-row-button",
        ),
    createIconButton(
      owner === "file-tree" ? "Close FileTree" : "Open FileTree",
      owner === "file-tree"
        ? createElement(PanelRightClose, { size: 15, strokeWidth: 1.9 })
        : createElement(FolderOpen, { size: 15, strokeWidth: 1.9 }),
      handlers.onFileTreeToggle,
      "top-row-button",
    ),
  );
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

function rightActionOwner(viewModel: ProductShellViewModel): RightActionOwner {
  if (viewModel.fileTreeOpen) {
    return "file-tree";
  }
  if (viewModel.workbenchOpen) {
    return "workbench";
  }
  return "agent-chat";
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
