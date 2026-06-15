import type { ProductShellHandlerContext } from "./handlers/context.ts";
import { createRailHandlers } from "./handlers/rail-handlers.ts";
import { createComposerHandlers } from "./handlers/composer-handlers.ts";
import { createWorkbenchHandlers } from "./handlers/workbench-handlers.ts";
import { createEditorHandlers } from "./handlers/editor-handlers.ts";
import { createChromeHandlers } from "./handlers/chrome-handlers.ts";
import type { MenuAnchorRect, ProductShellHandlers, TideProductShellProps } from "./support/types.ts";
import { createSettingsModal, loadListSettings, loadPreferredStartComposer, loadRailOrder, loadWorktreeSettings, persistPreferredStartComposer } from "./settings/settings.tsx";
import { WorktreeDeleteDialog } from "./dialogs/worktree-delete-dialog.tsx";
import type { WorktreeDeleteTarget } from "./dialogs/worktree-delete-dialog.tsx";
import { ChangesPanel } from "./workbench/changes-panel.tsx";
import { routeProductShellTerminalOutput } from "./workbench/terminal-pane.tsx";
import { WorktreeNameInput } from "./dialogs/worktree-name-input.tsx";
import { fitColumnsToWidth, useColumnPresence } from "./support/layout.ts";
import { useCloseIntentFromMenu, useEscapeShortcuts, useGitState, useGlobalSearchShortcuts, useOpenBrowserPaneFromMain, usePanelToggleFromMenu, useRightmostColumnWidth } from "./support/use-shell-effects.ts";
import { useMultitaskNavigation } from "./multitask/use-multitask-navigation.tsx";
import { RailPeek } from "./left-rail/rail-peek.tsx";
import { QuickOpenPalette } from "./search/quick-open.tsx";
import type { QuickOpenFile } from "./search/quick-open.tsx";
import { createWindowChromeToggles } from "./chrome/chrome.tsx";
import { BackgroundBrowserHost } from "./workbench/browser-pane.tsx";
import { ContentSearchPanel } from "./search/content-search.tsx";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { ProductShellStoreProvider, useShellStore, useStableHandlers } from "./store-context.ts";
import { AgentChatColumnView, FileTreeColumnView, LeftRailColumnView, WorkbenchColumnView } from "./product-shell-columns.ts";

import { worktreeDeleteRequest } from "../../../../../shared/worktree/path.ts";

import {
  applyProductShellBackendEvent,
  createProductShellState,
  createProductShellViewModel,
  quickOpenFilesFromState,
  selectBackgroundCompletions,
  archiveProductShellWorktreeChats,
  setProductShellComposerFolderScope,
  setProductShellComposerNewWorktreeIntent,
  setProductShellProviderCommands,
  setProductShellRegisteredProjects,
  startNewProductShellThread,
  refreshStartPageFileTree,
  searchProductShellContentCommand,
  toggleProductShellWorkbenchFullscreen,
  setPreferredStartComposer,
  type PreferredStartComposer,
  type ProductShellBackendCommand,
  type ProductShellState,
} from "../../../../application/domains/product-shell/product-shell.ts";

import type {
  AgentChatBackendEvent,
} from "../../../../application/domains/agent-chat/agent-chat.ts";

import {
  loadThemePreference,
  type TideThemePreference,
} from "../support/theme.ts";

export function TideProductShell(props: TideProductShellProps): ReactElement {
  // External store: columns subscribe per-slice; root keeps whole-state read (spec: render-isolation).
  const { store, shellState, setShellState } = useShellStore(() => {
    // Apply the remembered agent/model BEFORE the first Start Composer is built,
    // so a fresh launch already shows the user's last choice.
    setPreferredStartComposer(loadPreferredStartComposer());
    return (
      props.initialState ??
      createProductShellState({
        includeFixtureData: false,
        ...loadRailOrder(),
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
  const [worktreeDeleting, setWorktreeDeleting] = useState(false);
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
      // Adding a project drops you into a fresh New Thread composer SCOPED to it (its
      // directory selected), ready to start — not just a silent list entry.
      return project === undefined
        ? withRegistry
        : startNewProductShellThread(withRegistry, project.projectId);
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
    if (target === null || bridge === undefined) {
      return;
    }
    // Keep the dialog open with a "Deleting…" spinner while the (slow) git worktree +
    // branch removal runs — it used to close instantly and update only on completion,
    // leaving a confusing gap where nothing seemed to happen.
    setWorktreeDeleting(true);
    bridge
      .deleteWorktree(target.cwd, worktreeDeleteRequest({ keepBranch, branchMerged: target.branchMerged }))
      .then((result) => {
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
        });
        setWorktreeDeleting(false);
        setWorktreeDelete(null);
      })
      .catch(() => {
        // Leave the dialog open (re-enabled) so the user can retry or cancel.
        setWorktreeDeleting(false);
      });
  };

  // The active Project cwd (a thread's, or the start composer's) drives git state.
  const activeScope = shellState.agentChat.thread?.scope ?? shellState.agentChat.composer.startOptions.scope;
  const activeProjectCwd = activeScope?.kind === "project" ? activeScope.cwd : null;
  // Git for the active repo/worktree: branches+worktrees (composer pickers, → shell state)
  // and uncommitted changes (top-bar badge + Changes view), fetched together. See useGitState.
  const git = useGitState(props.projectBridge, activeProjectCwd, setShellState);

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
        // When a thread becomes active (started/hydrated) with the FileTree shown but
        // no tree loaded yet, populate it. A tree carried over from the New Thread page
        // (same cwd) is kept by the reducer, so the `fileTree === null` check skips the
        // redundant reload. refresh_file_tree is idempotent, so one dispatch per batch
        // is enough even if several activations coalesced.
        if (activated && next.fileTreeOpen && next.activeThreadId && next.fileTree === null) {
          dispatchBackendCommand({
            kind: "workbench.command",
            payload: {
              threadId: next.activeThreadId,
              command: "refresh_file_tree",
              data: { expandedPaths: next.expandedFolderPaths, maxEntries: 4000 }, // lazy: root level only
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
  // Composed from the memoized per-area selectors; memoize on shellState so a transient
  // UI change (column-width drag, menu anchor) doesn't rebuild it for the chrome/overlays.
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
  const stableHandlers = useStableHandlers(handlers);

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

  const showWorkbenchControls = layoutVm.workbenchOpen;

  // Animate columns open/closed by keeping them mounted across an exit transition.
  const leftPresence = useColumnPresence(layoutVm.leftRailOpen);
  const workbenchPresence = useColumnPresence(layoutVm.workbenchOpen);
  const fileTreePresence = useColumnPresence(layoutVm.fileTreeOpen);

  // Workbench chrome controls (layout toggle / fullscreen / New Pane) render INLINE by
  // default and only collapse into a single "…" hover-menu when the rightmost column
  // they float over gets too narrow to host them — so a cramped column keeps its tabs,
  // but on a normal layout every control is one click away. Keyed off the measured
  // width of the last column (re-measured on resize / column open-close).
  const rightColWidth = useRightmostColumnWidth(bodyRef, [
    leftPresence.mounted,
    workbenchPresence.mounted,
    fileTreePresence.mounted,
    layoutVm.workbenchOpen,
    layoutVm.fileTreeOpen,
  ]);
  const inlineWorkbenchControls = showWorkbenchControls && rightColWidth >= 400;

  // Cmd+P → Quick Open, Cmd+Shift+F → Content Search (active-thread only).
  const activeThreadId = shellState.activeThreadId;
  useGlobalSearchShortcuts({
    activeThreadId,
    dispatchBackendCommand,
    setQuickOpenVisible,
    setContentSearchVisible,
  });

  // Option-unified multitask navigation: ⌥1..9 jumps to the N-th thread in rail order
  // (top-9, not just pinned), ⌥Tab cycles the live switcher (spec: multitask-navigation).
  // `active` gates the row ⌥N badges; `hud` is the transient switcher overlay.
  const multitask = useMultitaskNavigation({
    numberedThreads: viewModel.numberedThreads,
    liveThreads: viewModel.liveThreads,
    activeThreadId,
    onSelectThread: handlers.onThreadSelect,
  });

  // Cmd+W "close intent" (app menu) — close the focused Workbench pane, else the thread.
  useCloseIntentFromMenu({
    activeWorkbenchPaneId: shellState.appChrome.activeWorkbenchPaneId,
    workbenchOpen: shellState.workbenchOpen,
    hasThread: shellState.activeThreadId !== null,
    onCloseWorkbenchPane: handlers.onCloseWorkbenchPane,
    onNewThread: handlers.onNewThread,
  });

  // A Browser Pane link opened with Cmd/Ctrl+click (or window.open) opens a new pane.
  useOpenBrowserPaneFromMain(handlers.onOpenBrowserPane);
  // Cmd+B / Cmd+E / Cmd+J (View menu) toggle Left Rail / File Tree / Workbench.
  usePanelToggleFromMenu(handlers);

  // Escape exits Workbench fullscreen / closes the Settings modal (extracted to
  // use-shell-effects to keep this file under the size cap).
  useEscapeShortcuts({
    workbenchFullscreen: shellState.workbenchFullscreen,
    onExitFullscreen: () => setShellState((state) => toggleProductShellWorkbenchFullscreen(state)),
    settingsOpen: shellState.settingsOpen,
    onCloseSettings: handlers.onCloseSettings,
  });

  const quickOpenFiles = useMemo<QuickOpenFile[]>(
    () => quickOpenFilesFromState(shellState),
    [shellState.fileTree],
  );

  return (
    <ProductShellStoreProvider value={store}>
      <div
        className={[
          "tide-product-shell",
          layoutVm.leftRailOpen ? "tide-product-shell--left-open" : "tide-product-shell--left-closed",
          layoutVm.workbenchOpen ? "tide-product-shell--workbench-open" : "tide-product-shell--workbench-closed",
          layoutVm.fileTreeOpen ? "tide-product-shell--file-tree-open" : "tide-product-shell--file-tree-closed",
          isResizing ? "tide-product-shell--resizing" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        // While Ctrl is held (multitask mode), rows reveal their ^N pin badges —
        // CSS-gated on this attribute. Spec: multitask-navigation L2.
        data-multitask={multitask.active ? "true" : undefined}
      >
        <div
          className="tide-product-shell__body"
          ref={bodyRef}
          // When the workbench controls are docked in the top-right cluster it's wider,
          // so the rightmost column's header reserves more right padding (product-shell.css).
          data-workbench-controls={
            inlineWorkbenchControls ? "inline" : showWorkbenchControls ? "menu" : "false"
          }
          // Agent chat is the flexible middle track; the other columns use
          // minmax(min, dragWidth) so they honour the dragged width when there is
          // room but shrink toward their min when several columns are open at once
          // (so workbench + filetree can both show without overflowing). A
          // mounted-but-closing column keeps its track (collapsing to 0) so the grid
          // width animates rather than snapping; unmounted columns drop out. Side
          // tracks are minmax(0px, dragWidth) so they shrink below their width on a
          // narrow window (the file tree is never clipped off the right edge), and the
          // max animates dragWidth<->0 for the open<->close transition.
          style={{
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
          } as CSSProperties}
        >
          {leftPresence.mounted ? (
            <LeftRailColumnView handlers={stableHandlers} anchor={menuAnchor} collapsedSections={collapsedSections} />
          ) : null}
          <AgentChatColumnView handlers={stableHandlers} gitBadge={git.gitBadge} />
          {workbenchPresence.mounted ? <WorkbenchColumnView handlers={stableHandlers} /> : null}
          {fileTreePresence.mounted ? <FileTreeColumnView handlers={stableHandlers} /> : null}
        </div>
        {/* Workbench + FileTree toggles live in a single fixed cluster at the window's
            top-right, so they never jump between column headers as panels open/close. */}
        {createWindowChromeToggles(layoutVm, handlers, showWorkbenchControls, inlineWorkbenchControls)}
        {/* Offscreen host keeping background threads' Browser Panes alive for their agents. */}
        <BackgroundBrowserHost panes={layoutVm.backgroundBrowserPanes} handlers={handlers} />
        {viewModel.settingsOpen
          ? createSettingsModal(viewModel.worktreeSettings, themePref, handlers)
          : null}
        {quickOpenVisible ? (
          <QuickOpenPalette
            files={quickOpenFiles}
            onOpen={(relativePath: string) => handlers.onOpenFile(relativePath)}
            onClose={() => setQuickOpenVisible(false)}
          />
        ) : null}
        {contentSearchVisible ? (
          <ContentSearchPanel
            results={viewModel.contentSearch}
            onSearch={(query: string) =>
              setShellState((state) => {
                dispatchBackendCommand(searchProductShellContentCommand(state, query));
                return state;
              })
            }
            onOpen={(relativePath: string) => handlers.onOpenFile(relativePath)}
            onClose={() => setContentSearchVisible(false)}
          />
        ) : null}
        {worktreeCreate !== null ? (
          <WorktreeNameInput
            baseCwd={worktreeCreate.baseCwd}
            baseDirPattern={shellState.worktreeSettings.baseDirPattern}
            branches={shellState.gitBranches}
            onSubmit={submitWorktreeCreate}
            onClose={() => setWorktreeCreate(null)}
          />
        ) : null}
        {worktreeDelete !== null ? (
          <WorktreeDeleteDialog
            target={worktreeDelete}
            deleting={worktreeDeleting}
            onConfirm={confirmWorktreeDelete}
            onClose={() => {
              setWorktreeDelete(null);
              setWorktreeDeleting(false);
            }}
          />
        ) : null}
        {/* Read-only git Changes overlay (opened from the top-bar branch badge). */}
        {git.open && git.gitInfo !== null ? (
          <ChangesPanel
            branch={git.gitInfo.branch}
            files={git.gitInfo.files}
            loadDiff={(relPath) =>
              props.projectBridge?.gitFileDiff(git.gitInfo!.cwd, relPath) ?? Promise.resolve("")
            }
            onRefresh={() => git.refresh()}
            onClose={() => git.setOpen(false)}
          />
        ) : null}
        {/* Collapsed-rail floating peek: hover the left edge, or hold Ctrl. */}
        {layoutVm.leftRailOpen ? null : (
          <RailPeek handlers={stableHandlers} anchor={menuAnchor} collapsedSections={collapsedSections} forceOpen={multitask.active} />
        )}
        {/* Transient ⌘-Tab-style live switcher (Ctrl+Tab), null unless cycling. */}
        {multitask.hud}
      </div>
    </ProductShellStoreProvider>
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
export { WorktreeDeleteDialog, type WorktreeDeleteTarget } from "./dialogs/worktree-delete-dialog.tsx";
export { AgentIdentityIcon, agentMonogram } from "./support/agent-identity.tsx";
export { fitColumnsToWidth } from "./support/layout.ts";
export type { ProjectRegistryEntry, GitContextResult, ProjectRegistryBridge, TideProductShellProps } from "./support/types.ts";
