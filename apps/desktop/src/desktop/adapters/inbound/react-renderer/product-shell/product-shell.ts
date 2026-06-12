import type { ProductShellHandlerContext } from "./handlers/context.ts";
import { createRailHandlers } from "./handlers/rail-handlers.ts";
import { createComposerHandlers } from "./handlers/composer-handlers.ts";
import { createWorkbenchHandlers } from "./handlers/workbench-handlers.ts";
import { createEditorHandlers } from "./handlers/editor-handlers.ts";
import { createChromeHandlers } from "./handlers/chrome-handlers.ts";
import type { MenuAnchorRect, ProductShellHandlers, TideProductShellProps } from "./types.ts";
import { createSettingsModal, loadListSettings, loadPreferredStartComposer, loadWorktreeSettings, persistListSettings, persistPreferredStartComposer, persistWorktreeSettings } from "./settings.ts";
import { WorktreeDeleteDialog } from "./dialogs/worktree-delete-dialog.ts";
import type { WorktreeDeleteTarget } from "./dialogs/worktree-delete-dialog.ts";
import { routeProductShellTerminalOutput } from "./workbench/terminal-pane.ts";
import { WorktreeNameInput, makeWorktreeHash } from "./dialogs/worktree-name-input.ts";
import { fitColumnsToWidth, useColumnPresence } from "./layout.ts";
import { QuickOpenPalette } from "./search/quick-open.ts";
import type { QuickOpenFile } from "./search/quick-open.ts";
import { createLeftRail } from "./left-rail/left-rail.ts";
import { createAgentChatColumn } from "./chat-column.ts";
import { createWorkbenchColumn } from "./workbench/workbench.ts";
import { createFileTreeColumn } from "./file-tree.ts";
import { createWindowChromeToggles } from "./chrome.ts";
import { BackgroundBrowserHost } from "./workbench/browser-pane.ts";
import { ContentSearchPanel } from "./search/content-search.ts";
import { createElement, Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from "react";

import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  Columns2,
  Rows2,
  ChevronRight,
  CornerDownRight,
  Minimize2,
  RotateCw,
  Crosshair,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
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
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";

import { fileIconFor } from "../file-icons.ts";

import { computeWorktreePath, worktreeDeleteRequest, worktreeRepoRootForCwd } from "../../../../../shared/worktree-path.ts";

import { resolveWorktreeName } from "../../../../../shared/worktree-name.ts";

import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";

// xterm core is CommonJS and safe to import in any environment (it does not
// touch browser globals at load). default-import the module namespace so both
// the Vite build and Node's ESM test loader resolve it. The fit/webgl addons
// are UMD bundles that reference `self` at load, so they are browser-only and
// are dynamically imported inside the mount effect (and gracefully skipped when
// unavailable, e.g. headless/jsdom/no-GPU).
import * as xtermModule from "@xterm/xterm";

import { javascript } from "@codemirror/lang-javascript";

import { json as jsonLanguage } from "@codemirror/lang-json";

import { rust } from "@codemirror/lang-rust";

import { css as cssLanguage } from "@codemirror/lang-css";

import { markdown as markdownLang } from "@codemirror/lang-markdown";

import MarkdownIt from "markdown-it";

import { guessLanguage, highlightToHtml } from "../code-highlight.ts";

import { renderMarkdownCached, taskListPlugin } from "../markdown-rendering.ts";

import {
  applyProductShellBackendEvent,
  closeProductShellWorkbenchPane,
  clearProductShellLeftRailTransientState,
  confirmProductShellThreadArchive,
  createProductShellState,
  createProductShellViewModel,
  editProductShellWorkbenchEditorPane,
  focusProductShellWorkbenchPane,
  goToProductShellEditorDefinition,
  goToProductShellEditorReferences,
  moveProductShellEditorCursor,
  openProductShellLeftRailMenu,
  openProductShellThread,
  openProductShellThreadFromLeftRail,
  selectProductShellFileTreeEntry,
  openProductShellFileInEditor,
  openProductShellBrowserAtUrl,
  setProductShellSearchQuery,
  toggleProductShellSearch,
  selectBackgroundCompletions,
  selectProductShellChoiceSurfaceRow,
  selectProductShellLauncherAction,
  setProductShellEditorPickerFilter,
  selectProductShellEditorPickerFile,
  archiveProductShellProjectChats,
  archiveProductShellWorktreeChats,
  cancelProductShellProjectRename,
  setProductShellComposerActiveSurface,
  setProductShellComposerFolderScope,
  setProductShellComposerNewWorktreeIntent,
  resolveProductShellComposerNewWorktree,
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
  removeProductShellQueuedInput,
  submitProductShellComposerDraft,
  addProductShellComposerAttachment,
  removeProductShellComposerAttachment,
  saveProductShellWorkbenchEditorPane,
  toggleProductShellFileTreeWithRefresh,
  refreshStartPageFileTree,
  searchProductShellContentCommand,
  type ProductShellContentSearch,
  toggleProductShellLeftRail,
  toggleProductShellProject,
  toggleProductShellThreadPin,
  toggleProductShellWorkbenchWithLauncher,
  toggleProductShellWorkbenchFullscreen,
  toggleProductShellWorkbenchLayoutMode,
  applyProductShellWorkbenchDrop,
  setProductShellWorkbenchSplitRatio,
  type WorkbenchSplitNode,
  type DropZone,
  type SplitDirection,
  updateProductShellBrowserActionResult,
  updateProductShellBrowserSnapshot,
  updateProductShellBackgroundBrowserActionResult,
  updateProductShellBackgroundBrowserSnapshot,
  updateProductShellComposerDraft,
  addProductShellComposerContextChip,
  removeProductShellComposerContextChip,
  setProductShellComposerContextChipComment,
  answerProductShellPromptText,
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
  type ProductShellLeftRailMenu,
  type ProductShellProjectGroupView,
  type ProductShellPinnedProjectView,
  type ProductShellState,
  type ProductShellThreadView,
  type ProductShellViewModel,
} from "../../../../application/domains/product-shell/product-shell-state.ts";

import { AgentChatShell } from "../agent-chat/agent-chat.ts";

import { agentDescriptor } from "../../../../../shared/contracts/agent-descriptors.ts";

import type {
  AgentChatBackendEvent,
  AgentChatChoiceSurfaceView,
  AgentChatCommandOption,
  AgentChatComposerSurfaceKind,
  AgentChatThreadScope,
} from "../../../../application/domains/agent-chat/agent-chat-shell-state.ts";

import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
  type TideThemePreference,
} from "../theme.ts";

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
  // Theme preference (light/dark/auto). Renderer-local: the DOM + localStorage are
  // the source of truth (applied at boot by renderer-entry / index.html); this
  // useState only drives the Settings radio's selected state.
  const [themePref, setThemePref] = useState<TideThemePreference>(loadThemePreference);

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
  // Quick Open (Cmd+P) file finder + content search (Cmd+Shift+F) visibility.
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [contentSearchVisible, setContentSearchVisible] = useState(false);
  // Inline "new worktree" name input opened from the composer worktree/branch menu.
  const [worktreeCreate, setWorktreeCreate] = useState<{ baseCwd: string } | null>(null);
  // Worktree delete confirmation (opened from a Thread row menu or the composer
  // worktree menu). See docs_v2/specs/worktree-branch-deletion.md.
  const [worktreeDelete, setWorktreeDelete] = useState<WorktreeDeleteTarget | null>(null);
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

  // "New worktree" is a deferred intent: record the (optional) name on the Start
  // Composer and create the worktree on send (see onSubmit), so the name can be
  // derived from the first message. No git command runs here.
  const submitWorktreeCreate = (name: string, baseBranch: string) => {
    setWorktreeCreate(null);
    setShellState((state) =>
      setProductShellComposerNewWorktreeIntent(state, {
        name,
        baseBranch: baseBranch.length > 0 ? baseBranch : undefined,
      }),
    );
  };

  // Open the worktree delete dialog for a worktree cwd: reads the branch + merged
  // status (Main IPC) and the threads-here/running facts (state). Shared by the
  // Thread-row menu and the Composer worktree-menu trash affordance.
  const openWorktreeDeleteByCwd = (cwd: string) => {
    const bridge = props.projectBridge;
    if (bridge === undefined) {
      return;
    }
    const here = shellState.threads.filter(
      (entry) => entry.scope.kind === "project" && entry.scope.cwd === cwd,
    );
    const fallbackBranch = cwd.split("/").filter((seg) => seg.length > 0).pop() ?? cwd;
    bridge
      .worktreeInfo(cwd)
      .then((info) => {
        // Only worktrees are deletable (never the main repo / a non-worktree cwd).
        if (!info.isWorktree) {
          return;
        }
        setWorktreeDelete({
          cwd,
          branch: info.branch ?? fallbackBranch,
          branchMerged: info.branchMerged,
          threadCount: here.length,
          anyRunning: here.some((entry) => entry.running === true),
        });
      })
      .catch(() => {});
  };

  // Delete the open worktree target: remove the dir and (unless "Keep branch")
  // its branch, forcing only when the user accepted the unmerged warning.
  const confirmWorktreeDelete = (keepBranch: boolean) => {
    const target = worktreeDelete;
    const bridge = props.projectBridge;
    setWorktreeDelete(null);
    if (target === null || bridge === undefined) {
      return;
    }
    bridge
      .deleteWorktree(target.cwd, worktreeDeleteRequest({ keepBranch, branchMerged: target.branchMerged }))
      .then((result) =>
        setShellState((state) => {
          // Update the registry from Main's authoritative entries, then archive the
          // Threads that lived in the deleted worktree and drop it from the Composer's
          // worktree list — both reflect the deletion instantly (no manual refresh).
          const withRegistry = setProductShellRegisteredProjects(state, result.entries);
          const archived = archiveProductShellWorktreeChats(withRegistry, target.cwd);
          for (const command of archived.commands) {
            dispatchBackendCommand(command);
          }
          return archived.state;
        }),
      )
      .catch(() => {});
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
  // Update-available notices already shown (dedupe across threads/runtimes).
  const notifiedUpdatesRef = useRef<Set<string>>(new Set());
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

  // Notify when a thread finishes a turn IN THE BACKGROUND (you were viewing
  // another thread), so off-screen agent work doesn't need babysitting to know
  // it's done. Uniform across agents — driven only by the per-thread running flag.
  const prevRunningRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (typeof Notification === "undefined") {
      return;
    }
    const nowRunning = new Set(
      shellState.threads.filter((thread) => thread.running === true).map((thread) => thread.threadId),
    );
    if (Notification.permission === "granted") {
      for (const thread of selectBackgroundCompletions(
        prevRunningRef.current,
        shellState.threads,
        shellState.activeThreadId,
      )) {
        new Notification("Tide — agent finished", { body: thread.title });
      }
    }
    prevRunningRef.current = nowRunning;
  }, [shellState.threads, shellState.activeThreadId]);

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
            (viewModel.leftRailOpen ? current.left : 0) +
            (viewModel.fileTreeOpen ? current.fileTree : 0);
          const max = Math.max(320, total - reserved - CHAT_MIN);
          return { ...current, workbench: clamp(start.workbench - dx, 320, max) };
        }
        const reserved =
          (viewModel.leftRailOpen ? current.left : 0) +
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
    // The async push channel can deliver one agentSessionBlock.upserted per
    // streamed chunk — applying each as its own setState re-renders the whole
    // shell at chunk rate (perf E3). Coalesce a burst into ONE state update per
    // animation frame: order is preserved (a single ordered buffer folded in
    // sequence), and the per-thread "broadcast" gating still keeps background
    // threads out of the viewed surface. Terminal output and update-notices stay
    // immediate — they early-return without touching shell state.
    const pending: AgentChatBackendEvent[] = [];
    let frame: number | null = null;

    const flushPending = (): void => {
      frame = null;
      if (pending.length === 0) {
        return;
      }
      const batch = pending.splice(0);
      setShellState((state) => {
        let next = state;
        let activated = false;
        for (const event of batch) {
          next = applyProductShellBackendEvent(next, event, "broadcast");
          if (event.kind === "thread.started" || event.kind === "thread.hydrated") {
            activated = true;
          }
        }
        // When a thread becomes active (started/hydrated) with the FileTree shown,
        // populate it. refresh_file_tree is idempotent, so one dispatch per batch
        // is enough even if several activations coalesced.
        if (activated && next.fileTreeOpen && next.activeThreadId) {
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
    };

    const scheduleFlush = (): void => {
      if (frame !== null) {
        return;
      }
      frame =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(flushPending)
          : (setTimeout(flushPending, 16) as unknown as number);
    };

    const unsubscribe = props.onBackendEvent?.((event) => {
      // Terminal output is a hot path: write it straight to the GPU terminal and
      // skip the React reducer so streaming bytes never re-render the shell.
      if (event.kind === "workbench.terminalOutput") {
        const payload = event.payload as { paneId?: unknown; chunk?: unknown };
        if (typeof payload.paneId === "string" && typeof payload.chunk === "string") {
          routeProductShellTerminalOutput(payload.paneId, payload.chunk);
        }
        return;
      }
      // An agent CLI printed an "update available" banner — surface it once as a
      // non-blocking native notification (no transcript noise, no React state).
      if (event.kind === "agentRuntime.noticePosted") {
        const payload = event.payload as { message?: unknown; agentId?: unknown };
        const message = typeof payload.message === "string" ? payload.message : "";
        if (
          message.length > 0 &&
          !notifiedUpdatesRef.current.has(message) &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          notifiedUpdatesRef.current.add(message);
          new Notification(`Tide — ${String(payload.agentId ?? "agent")} update available`, { body: message });
        }
        return;
      }
      pending.push(event);
      scheduleFlush();
    });

    return () => {
      if (frame !== null) {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(frame);
        } else {
          clearTimeout(frame);
        }
      }
      unsubscribe?.();
    };
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
  const handlerContext: ProductShellHandlerContext = { props, shellState, setShellState, viewModel, dispatchBackendCommand, applyBackendEvents, themePref, setThemePref, menuAnchor, setMenuAnchor, collapsedSections, setCollapsedSections, columnWidths, setColumnWidths, setIsResizing, quickOpenVisible, setQuickOpenVisible, contentSearchVisible, setContentSearchVisible, worktreeCreate, setWorktreeCreate, worktreeDelete, setWorktreeDelete, windowWidth, bodyRef, lastSubmitAtRef, openFolderAsProject, openFolderForScope, submitWorktreeCreate, openWorktreeDeleteByCwd, confirmWorktreeDelete, startColumnResize };
  const handlers: ProductShellHandlers = {
    ...createRailHandlers(handlerContext),
    ...createComposerHandlers(handlerContext),
    ...createWorkbenchHandlers(handlerContext),
    ...createEditorHandlers(handlerContext),
    ...createChromeHandlers(handlerContext),
  };

  // Auto-collapse columns that no longer fit the window at their min widths.
  const eff = fitColumnsToWidth({
    windowWidth,
    leftRailOpen: viewModel.leftRailOpen,
    workbenchOpen: viewModel.workbenchOpen,
    fileTreeOpen: viewModel.fileTreeOpen,
  });
  const layoutVm =
    eff.workbenchOpen === viewModel.workbenchOpen && eff.fileTreeOpen === viewModel.fileTreeOpen
      ? viewModel
      : { ...viewModel, workbenchOpen: eff.workbenchOpen, fileTreeOpen: eff.fileTreeOpen };

  // Animate columns open/closed by keeping them mounted across an exit transition.
  const leftPresence = useColumnPresence(layoutVm.leftRailOpen);
  const workbenchPresence = useColumnPresence(layoutVm.workbenchOpen);
  const fileTreePresence = useColumnPresence(layoutVm.fileTreeOpen);

  // Cmd+P opens Quick Open. It loads the FULL file list first (the FileTree is
  // lazy/shallow) so fuzzy search sees every file. Only inside an active thread.
  const activeThreadId = shellState.activeThreadId;
  useEffect(() => {
    if (activeThreadId === null) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        dispatchBackendCommand({
          kind: "workbench.command",
          payload: {
            threadId: activeThreadId,
            command: "refresh_file_tree",
            data: { maxDepth: 12, maxEntries: 5000 },
          },
        });
        setQuickOpenVisible(true);
      } else if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setContentSearchVisible(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  // Cmd+W (routed from the app menu as a "close intent"): close the focused
  // Workbench pane if one is open, else close the active thread by returning to
  // the start composer. Never closes the window (Shift+Cmd+W does that). A ref
  // keeps the latest state/handlers without re-subscribing the IPC each render.
  const closeIntentRef = useRef<{ paneId: string | undefined; workbenchOpen: boolean; hasThread: boolean }>({
    paneId: undefined,
    workbenchOpen: false,
    hasThread: false,
  });
  closeIntentRef.current = {
    paneId: shellState.appChrome.activeWorkbenchPaneId ?? undefined,
    workbenchOpen: shellState.workbenchOpen,
    hasThread: shellState.activeThreadId !== null,
  };
  useEffect(() => {
    const off = window.tide?.onCloseIntent?.(() => {
      const { paneId, workbenchOpen, hasThread } = closeIntentRef.current;
      if (workbenchOpen && paneId !== undefined) {
        handlers.onCloseWorkbenchPane(paneId);
      } else if (hasThread) {
        handlers.onNewThread();
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape exits workbench-pane fullscreen.
  useEffect(() => {
    if (!shellState.workbenchFullscreen) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShellState((state) => toggleProductShellWorkbenchFullscreen(state));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shellState.workbenchFullscreen]);

  const quickOpenFiles = useMemo<QuickOpenFile[]>(
    () =>
      (viewModel.fileTree?.entries ?? [])
        .filter((entry) => entry.kind === "file")
        .map((entry) => ({ relativePath: entry.relativePath, name: entry.name })),
    [viewModel.fileTree],
  );

  return createElement(
    "div",
    {
      className: [
        "tide-product-shell",
        layoutVm.leftRailOpen ? "tide-product-shell--left-open" : "tide-product-shell--left-closed",
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
        ? createLeftRail(layoutVm, handlers, { menu: shellState.leftRailMenu, anchor: menuAnchor })
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
    viewModel.settingsOpen ? createSettingsModal(viewModel.worktreeSettings, themePref, handlers) : null,
    quickOpenVisible
      ? createElement(QuickOpenPalette, {
          files: quickOpenFiles,
          onOpen: (relativePath: string) => handlers.onOpenFile(relativePath),
          onClose: () => setQuickOpenVisible(false),
        })
      : null,
    contentSearchVisible
      ? createElement(ContentSearchPanel, {
          results: viewModel.contentSearch,
          onSearch: (query: string) =>
            setShellState((state) => {
              dispatchBackendCommand(searchProductShellContentCommand(state, query));
              return state;
            }),
          onOpen: (relativePath: string) => handlers.onOpenFile(relativePath),
          onClose: () => setContentSearchVisible(false),
        })
      : null,
    worktreeCreate !== null
      ? createElement(WorktreeNameInput, {
          baseCwd: worktreeCreate.baseCwd,
          baseDirPattern: shellState.worktreeSettings.baseDirPattern,
          branches: shellState.gitBranches,
          onSubmit: submitWorktreeCreate,
          onClose: () => setWorktreeCreate(null),
        })
      : null,
    worktreeDelete !== null
      ? createElement(WorktreeDeleteDialog, {
          target: worktreeDelete,
          onConfirm: confirmWorktreeDelete,
          onClose: () => setWorktreeDelete(null),
        })
      : null,
  );
}

// Looks up a project's cwd by id across registered + thread-derived projects.
export function projectCwdById(state: ProductShellState, projectId: string): string | undefined {
  return [...state.registeredProjects, ...state.projects].find(
    (project) => project.projectId === projectId,
  )?.cwd;
}

// Decomposed into ./product-shell/ (spec: navigable-source-structure). The shell
// component stays here; moved pieces are re-exported for path compatibility.
export { WorktreeDeleteDialog, type WorktreeDeleteTarget } from "./dialogs/worktree-delete-dialog.ts";
export { AgentIdentityIcon, agentMonogram } from "./agent-identity.ts";
export { fitColumnsToWidth } from "./layout.ts";
export type { ProjectRegistryEntry, GitContextResult, ProjectRegistryBridge, TideProductShellProps } from "./types.ts";
