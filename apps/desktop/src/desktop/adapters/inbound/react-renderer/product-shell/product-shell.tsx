import type { ProductShellHandlerContext } from "./handlers/context.ts";
import { createRailHandlers } from "./handlers/rail-handlers.ts";
import { createComposerHandlers } from "./handlers/composer-handlers.ts";
import { createWorkbenchHandlers } from "./handlers/workbench-handlers.ts";
import { createEditorHandlers } from "./handlers/editor-handlers.ts";
import { createFileOperationHandlers } from "./handlers/file-operation-handlers.ts";
import { createChromeHandlers } from "./handlers/chrome-handlers.ts";
import type { MenuAnchorRect, ProductShellHandlers, TideProductShellProps } from "./support/types.ts";
import { createSettingsModal, loadListSettings, loadPreferredStartComposer, loadRailOrder, loadWorktreeSettings, persistPreferredStartComposer } from "./settings/settings.tsx";
import { WorktreeDeleteDialog } from "./dialogs/worktree-delete-dialog.tsx";
import { BranchDeleteDialog } from "./dialogs/branch-delete-dialog.tsx";
import { useDeleteDialogs } from "./support/use-delete-dialogs.ts";
import { createProductShellFileDialogs } from "./product-shell-file-dialogs.tsx";
import { routeProductShellTerminalOutput } from "./workbench/terminal-pane.tsx";
import { WorktreeNameInput } from "./dialogs/worktree-name-input.tsx";
import { fitColumnsToWidth, useColumnPresence } from "./support/layout.ts";
import { useActivateThreadFromMain, useCloseIntentFromMenu, useComposerFileMentionRefresh, useGitState, useGlobalSearchShortcuts, useOpenBrowserPaneFromMain, usePanelToggleFromMenu, useProductShellEscape, useRightmostColumnWidth } from "./support/use-shell-effects.ts";
import { useMultitaskNavigation } from "./multitask/use-multitask-navigation.tsx";
import { RailPeek } from "./left-rail/rail-peek.tsx";
import { QuickOpenPalette } from "./search/quick-open.tsx";
import type { QuickOpenFile } from "./search/quick-open.tsx";
import { createWindowChromeToggles } from "./chrome/chrome.tsx";
import { BackgroundBrowserHost } from "./workbench/browser-pane.tsx";
import { ErrorBoundary } from "./support/error-boundary.tsx";
import { ContentSearchPanel } from "./search/content-search.tsx";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { ProductShellStoreProvider, useShellStore, useStableHandlers } from "./store-context.ts";
import { AgentChatColumnView, FileTreeColumnView, LeftRailColumnView, WorkbenchColumnView } from "./product-shell-columns.ts";

import {
  applyProductShellBackendEvent,
  createProductShellState,
  createProductShellViewModel,
  markProductShellThreadsUnread,
  quickOpenFilesFromState,
  selectCompletedThreads,
  reconcileAttentionNotifications,
  initialAttentionNotificationState,
  discardProductShellDraftThread,
  setProductShellComposerFolderScope,
  setProductShellComposerNewWorktreeIntent,
  setProductShellProviderCommands,
  setProductShellRegisteredProjects,
  startNewProductShellThread,
  refreshStartPageFileTree,
  searchProductShellContentCommand,
  setPreferredStartComposer,
  preferredStartComposerFromState,
  type PreferredStartComposer,
  type ProductShellBackendCommand,
  type ProductShellState,
} from "../../../../application/domains/product-shell/product-shell.ts";

import type { AgentChatBackendEvent } from "../../../../application/domains/agent-chat/agent-chat.ts";

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
    if (props.initialState !== undefined) {
      return props.initialState;
    }
    const baseState = createProductShellState({
      includeFixtureData: false,
      ...loadRailOrder(),
      listSettings: loadListSettings(),
      worktreeSettings: loadWorktreeSettings(),
    });
    return props.initialThreadList === undefined
      ? baseState
      : applyProductShellBackendEvent(baseState, {
          kind: "thread.listed",
          payload: { threads: props.initialThreadList },
        });
  });
  // Theme preference (light/dark/auto). Renderer-local: the DOM + localStorage are
  // the source of truth (applied at boot by renderer-entry / index.html); this
  // useState only drives the Settings radio's selected state.
  const [themePref, setThemePref] = useState<TideThemePreference>(loadThemePreference);

  // Remember the Start Composer's agent/model choice: whenever it changes while no
  // thread is active, persist it so the NEXT New Thread (this launch or the next)
  // defaults to it.
  // The preference to remember is null while a thread is focused or the agent isn't a
  // known one. preferredStartComposerFromState holds that DECISION (the spot the
  // opencode drop bug lived) so it's unit-tested directly; the serialized key
  // keeps the effect from re-persisting on every render. Persists for every real
  // agent — opencode included — just like codex/claude.
  const startPreference = preferredStartComposerFromState(shellState);
  const startPreferenceKey = startPreference === null ? null : JSON.stringify(startPreference);
  useEffect(() => {
    if (startPreferenceKey === null) {
      return;
    }
    // Parse the serialized key (rather than closing over the object) so the dep
    // array is exactly [startPreferenceKey] with no exhaustive-deps suppression.
    const preference = JSON.parse(startPreferenceKey) as PreferredStartComposer;
    setPreferredStartComposer(preference);
    persistPreferredStartComposer(preference);
  }, [startPreferenceKey]);
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
    if (bridge === undefined) { return; }
    const cwd = await bridge.openDirectory();
    if (cwd === null) { return; }
    setShellState((state) => {
      // New folder = new cwd → discard the Composer's Draft Thread (its panes belong to the
      // old cwd; spec: composer-draft-thread) before re-scoping + reloading the start tree.
      const discarded = discardProductShellDraftThread(state);
      if (discarded.command !== null) dispatchBackendCommand(discarded.command);
      const next = setProductShellComposerFolderScope(discarded.state, cwd);
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

  // The active Project cwd (a thread's, or the start composer's) drives git state.
  const activeScope = shellState.agentChat.thread?.scope ?? shellState.agentChat.composer.startOptions.scope;
  const activeProjectCwd = activeScope?.kind === "project" ? activeScope.cwd : null;
  const activeComposerFileMentionCwd = activeProjectCwd;
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

  // Native OS notification when a thread NEWLY needs attention (boot-safe: restored state only
  // seeds, never fires on launch — reconcileAttentionNotifications); Main gates on window focus.
  const attentionNotificationRef = useRef(initialAttentionNotificationState);
  // Update-available notices already shown (dedupe across threads/runtimes).
  const notifiedUpdatesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const { notifications, next } = reconcileAttentionNotifications(attentionNotificationRef.current, {
      threads: shellState.threads,
      activeThreadId: shellState.activeThreadId,
    });
    attentionNotificationRef.current = next;
    for (const notification of notifications) {
      window.tide?.notify?.({
        kind: "needs_attention",
        threadId: notification.threadId,
        title: "Tide — a thread needs your input",
        body: notification.title,
        isActiveThread: notification.isActiveThread,
      });
    }
  }, [shellState.threads, shellState.activeThreadId]);

  // Notify when a thread finishes a turn, so agent work doesn't need babysitting to know
  // it's done. Uniform across agents — driven only by the per-thread running flag. Main
  // applies the window-focus gate: a completion is suppressed only when the user is
  // actually looking at that thread (app focused + active), so a finish while Tide is in
  // the background always notifies (see specs/focus-aware-notifications.md).
  const prevRunningRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const nowRunning = new Set(
      shellState.threads.filter((thread) => thread.running === true).map((thread) => thread.threadId),
    );
    const completedThreads = selectCompletedThreads(prevRunningRef.current, shellState.threads);
    const unreadThreadIds: string[] = [];
    for (const thread of completedThreads) {
      window.tide?.notify?.({
        kind: "agent_finished",
        threadId: thread.threadId,
        title: "Tide — agent finished",
        body: thread.title,
        isActiveThread: thread.threadId === shellState.activeThreadId,
      });
      if (thread.threadId !== shellState.activeThreadId) {
        unreadThreadIds.push(thread.threadId);
      }
    }
    if (unreadThreadIds.length > 0) {
      setShellState((state) => markProductShellThreadsUnread(state, unreadThreadIds));
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
    // Event application is split by correctness sensitivity, NOT by a wall-clock window:
    //
    // - State/control/lifecycle events (prompt.changed, agentRuntime.stateChanged,
    //   thread.hydrated/started, workbench.changed, …) apply IMMEDIATELY and synchronously.
    //   A waiting/answer/turn transition must never sit in a timer — that was the root of
    //   "backend is waiting but the chat still says Working" (a state delta stranded behind
    //   a coalescing flush). No timing dependence on the correctness path.
    //
    // - Only `agentSessionBlock.upserted` (one per streamed token) is buffered + coalesced,
    //   because applying each as its own setState re-renders the chat column at token rate
    //   (perf E3). This buffer is PURELY a render throttle for streaming TEXT; it never
    //   carries state transitions. An immediate event first DRAINS the buffer (preserving
    //   order: streamed blocks before the transition), then applies itself.
    const pendingBlocks: AgentChatBackendEvent[] = [];
    let blockTimer: ReturnType<typeof setTimeout> | null = null;

    // Draining `pendingBlocks` is a SIDE EFFECT and must happen OUTSIDE the setShellState
    // updater: React invokes updaters twice in Strict Mode / concurrent rendering, and a
    // splice inside would leave the second invocation with an empty batch → lost blocks
    // So we splice here, capture the batch, and the updater stays pure.
    const foldEvents = (
      state: ProductShellState,
      batch: AgentChatBackendEvent[],
    ): ProductShellState =>
      batch.reduce((next, event) => applyProductShellBackendEvent(next, event, "broadcast"), state);

    const flushBlocks = (): void => {
      blockTimer = null;
      const batch = pendingBlocks.splice(0);
      if (batch.length === 0) {
        return;
      }
      setShellState((state) => foldEvents(state, batch));
    };

    const applyImmediate = (event: AgentChatBackendEvent): void => {
      if (blockTimer !== null) {
        clearTimeout(blockTimer);
        blockTimer = null;
      }
      // Drain buffered streamed blocks NOW (outside the updater) so the transition lands
      // after them and a double-invoked updater can't lose them.
      const batch = pendingBlocks.splice(0);
      setShellState((state) => {
        let next = applyProductShellBackendEvent(foldEvents(state, batch), event, "broadcast");
        // When a thread becomes active (started/hydrated) with the FileTree shown but no
        // tree loaded yet, populate it (a same-cwd tree carried from the New Thread page is
        // kept by the reducer; the null check skips a redundant reload).
        if (
          (event.kind === "thread.started" || event.kind === "thread.hydrated") &&
          next.fileTreeOpen &&
          next.activeThreadId &&
          next.fileTree === null
        ) {
          dispatchBackendCommand({
            kind: "workbench.command",
            payload: {
              threadId: next.activeThreadId,
              command: "refresh_file_tree",
              data: { expandedPaths: next.expandedFolderPaths, maxEntries: 4000 },
            },
          });
        }
        return next;
      });
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
        if (message.length > 0 && !notifiedUpdatesRef.current.has(message)) {
          notifiedUpdatesRef.current.add(message);
          window.tide?.notify?.({
            kind: "agent_update",
            threadId: null,
            title: `Tide — ${String(payload.agentId ?? "agent")} update available`,
            body: message,
            isActiveThread: false,
          });
        }
        return;
      }
      // Streamed token content: buffer + coalesce (render throttle only). Everything
      // else is a state transition → apply now.
      if (event.kind === "agentSessionBlock.upserted") {
        pendingBlocks.push(event);
        if (blockTimer === null) {
          blockTimer = setTimeout(flushBlocks, 16);
        }
        return;
      }
      applyImmediate(event);
    });

    return () => {
      if (blockTimer !== null) {
        clearTimeout(blockTimer);
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
  // Mirror the agent's REAL full command set in the composer menu: probe a
  // handshake-only runtime for (agent, cwd); the resulting agentRuntime.commandsChanged
  // replaces the instant file list (tide:list-commands). Re-runs when the active cwd or
  // agent changes. See docs_v2/specs/live-provider-command-mirroring.md.
  useEffect(() => {
    if (props.initialState !== undefined || activeProjectCwd === null) {
      return;
    }
    dispatchBackendCommand({
      kind: "provider.discoverCommands",
      payload: { agentId: activeAgentId, cwd: activeProjectCwd },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectCwd, activeAgentId]);
  useComposerFileMentionRefresh({
    draft: shellState.agentChat.composer.draft,
    cwd: activeComposerFileMentionCwd,
    dispatchBackendCommand,
  });
  // Worktree + branch delete dialogs (state + git orchestration) live in a hook so
  // the shell stays a thin composition root. Placed after dispatchBackendCommand
  // (which it needs) and before the handlers that consume it. See useDeleteDialogs.
  const {
    worktreeDelete,
    setWorktreeDelete,
    worktreeDeleting,
    setWorktreeDeleting,
    openWorktreeDeleteByCwd,
    confirmWorktreeDelete,
    branchDelete,
    setBranchDelete,
    branchDeleting,
    setBranchDeleting,
    branchDeleteError,
    setBranchDeleteError,
    openBranchDeleteByName,
    confirmBranchDelete,
  } = useDeleteDialogs({
    projectBridge: props.projectBridge,
    threads: shellState.threads,
    setShellState,
    dispatchBackendCommand,
  });
  const handlerContext: ProductShellHandlerContext = { props, shellState, getShellState: store.getState, setShellState, viewModel, dispatchBackendCommand, applyBackendEvents, themePref, setThemePref, menuAnchor, setMenuAnchor, collapsedSections, setCollapsedSections, columnWidths, setColumnWidths, setIsResizing, quickOpenVisible, setQuickOpenVisible, contentSearchVisible, setContentSearchVisible, worktreeCreate, setWorktreeCreate, worktreeDelete, setWorktreeDelete, branchDelete, setBranchDelete, windowWidth, bodyRef, lastSubmitAtRef, openFolderAsProject, openFolderForScope, submitWorktreeCreate, openWorktreeDeleteByCwd, confirmWorktreeDelete, openBranchDeleteByName, confirmBranchDelete, startColumnResize };
  const handlers: ProductShellHandlers = {
    ...createRailHandlers(handlerContext),
    ...createComposerHandlers(handlerContext),
    ...createWorkbenchHandlers(handlerContext),
    ...createEditorHandlers(handlerContext),
    ...createFileOperationHandlers(handlerContext),
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
  // Split: the cluster floats over the narrow top-right PANE so it collapses. When the
  // workbench is also the rightmost column (filetree closed) that pane can be ~140px — too
  // tight even for "…" + 2 toggles — so collapse the WHOLE cluster into one "…" there.
  const splitActive =
    layoutVm.workbenchLayoutMode === "split" &&
    layoutVm.workbenchLayoutTree !== null &&
    layoutVm.editorPicker === null &&
    layoutVm.appChrome.openWorkbenchPanes.length > 1;
  const inlineWorkbenchControls = showWorkbenchControls && !splitActive && rightColWidth >= 400;
  const collapseChromeToDots = showWorkbenchControls && splitActive && !layoutVm.fileTreeOpen;

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
  // A clicked native notification activates its thread (same path as a left-rail click).
  useActivateThreadFromMain(handlers.onThreadSelect);
  // Cmd+B / Cmd+E / Cmd+J (View menu) toggle Left Rail / File Tree / Workbench.
  usePanelToggleFromMenu(handlers);

  // Escape: exit Workbench fullscreen / close Settings / interrupt a running turn
  // (the interrupt yields to any open transient UI). Spec: esc-interrupts-run.md.
  useProductShellEscape(shellState, setShellState, viewModel, handlers,
    quickOpenVisible || contentSearchVisible || worktreeCreate !== null || worktreeDelete !== null || branchDelete !== null);

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
            collapseChromeToDots ? "dots" : inlineWorkbenchControls ? "inline" : showWorkbenchControls ? "menu" : "false"
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
          {workbenchPresence.mounted ? (
            <WorkbenchColumnView handlers={stableHandlers} gitChanges={git.gitChanges} />
          ) : null}
          {fileTreePresence.mounted ? (
            <FileTreeColumnView handlers={stableHandlers} gitChanges={git.gitChanges} />
          ) : null}
        </div>
        {/* Workbench + FileTree toggles live in a single fixed cluster at the window's
            top-right, so they never jump between column headers as panels open/close. */}
        {createWindowChromeToggles(layoutVm, handlers, showWorkbenchControls, inlineWorkbenchControls, collapseChromeToDots)}
        {/* Offscreen host keeping background threads' Browser Panes alive for their agents.
            It's invisible, so an error there must never surface UI — a crash just drops the
            host (the agents lose liveness) rather than taking down the app. */}
        <ErrorBoundary fallback={() => null}>
          <BackgroundBrowserHost
            panes={layoutVm.backgroundBrowserPanes}
            handlers={stableHandlers}
          />
        </ErrorBoundary>
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
        {branchDelete !== null ? (
          <BranchDeleteDialog
            target={branchDelete}
            deleting={branchDeleting}
            error={branchDeleteError}
            onConfirm={confirmBranchDelete}
            onClose={() => {
              setBranchDelete(null);
              setBranchDeleting(false);
              setBranchDeleteError(null);
            }}
          />
        ) : null}
        {createProductShellFileDialogs(shellState, handlers)}
        {/* The git Changes view is a docked Workbench pane (see WorkbenchColumnView),
            not an overlay. */}
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
