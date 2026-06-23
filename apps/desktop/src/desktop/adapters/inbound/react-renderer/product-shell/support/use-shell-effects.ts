// Cross-cutting Product Shell effects extracted from product-shell.tsx to keep that
// file under the size cap (file-size-ratchet): the responsive rightmost-column
// measurement and the global search keyboard shortcuts.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { setProductShellGitContext, toggleProductShellWorkbenchFullscreen } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellBackendCommand, ProductShellState, ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import { activeComposerTrigger } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { GitChangesView, ProductShellHandlers, ProjectRegistryBridge } from "./types.ts";

// Measures the rightmost mounted column — the one the fixed top-right chrome cluster
// floats over — so the chrome can decide inline vs collapsed controls. A grid-track
// open/close animates a column's width WITHOUT resizing the body, so a one-shot read
// at mount catches the column mid-animation (≈0) and sticks; the observer tracks it
// to the settled width and through drag-resizes. `deps` re-attach the observer when
// the column set changes (open/close).
export function useRightmostColumnWidth(
  bodyRef: RefObject<HTMLDivElement | null>,
  deps: ReadonlyArray<unknown>,
): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const last = bodyRef.current?.lastElementChild as HTMLElement | null;
    if (last === null) {
      setWidth(0);
      return undefined;
    }
    const measure = () => setWidth(last.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(last);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return width;
}

// Cmd/Ctrl+P → Quick Open (loads the FULL file list first since the FileTree is
// lazy/shallow), Cmd/Ctrl+Shift+F → Content Search. Active-thread only.
export function useGlobalSearchShortcuts(params: {
  activeThreadId: string | null;
  dispatchBackendCommand: (command: ProductShellBackendCommand | null) => void;
  setQuickOpenVisible: (visible: boolean) => void;
  setContentSearchVisible: (visible: boolean) => void;
}): void {
  const { activeThreadId, dispatchBackendCommand, setQuickOpenVisible, setContentSearchVisible } = params;
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
}

// Composer @ file mentions use the same bounded full-tree read as Quick Open, but
// only when the @ surface is actually active. Cache request cwd in the hook so
// typing more query characters does not re-walk the same tree.
export function useComposerFileMentionRefresh(params: {
  draft: string;
  cwd: string | null;
  dispatchBackendCommand: (command: ProductShellBackendCommand | null) => void;
}): void {
  const requestedCwdRef = useRef<string | null>(null);
  const trigger = activeComposerTrigger(params.draft);
  useEffect(() => {
    if (trigger?.trigger !== "@" || params.cwd === null) {
      requestedCwdRef.current = null;
      return;
    }
    if (requestedCwdRef.current === params.cwd) {
      return;
    }
    requestedCwdRef.current = params.cwd;
    params.dispatchBackendCommand({
      kind: "workspace.readFileTree",
      payload: { cwd: params.cwd, maxDepth: 12, maxEntries: 5000 },
    });
  }, [params.cwd, params.dispatchBackendCommand, trigger?.trigger]);
}

// A Browser Pane link asked to open elsewhere: Main denies the stray popup window and
// forwards the URL here. `newPane` (Cmd/Ctrl/middle-click, window.open) opens a new
// Browser Pane; otherwise a plain target=_blank click navigates the active Browser
// Pane in place. The handler reads the latest state via setShellState, so subscribing
// once is safe.
export function useOpenBrowserPaneFromMain(
  onOpenBrowserPane: (url: string, options?: { newPane?: boolean }) => void,
): void {
  useEffect(() => {
    const off = window.tide?.onOpenBrowserPane?.((url: string, newPane: boolean) =>
      onOpenBrowserPane(url, { newPane }),
    );
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// Main asks the renderer to activate a thread (a clicked native notification). Route it
// through onThreadSelect — the same user-action path as a left-rail click. Subscribe once
// and read the latest handler via a ref so the IPC listener never re-binds or goes stale.
export function useActivateThreadFromMain(onThreadSelect: (threadId: string) => void): void {
  const latest = useRef(onThreadSelect);
  useEffect(() => {
    latest.current = onThreadSelect;
  });
  useEffect(() => {
    const off = window.tide?.onActivateThread?.((threadId: string) => latest.current(threadId));
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// View-menu panel toggles (Cmd+B left rail / Cmd+E file tree / Cmd+J workbench): Main
// sends the panel id from the application menu; route it to the matching toggle handler.
// Subscribe once and read the latest handlers via a ref (refreshed each commit) so the
// IPC listener never re-binds and never holds a stale handler.
export function usePanelToggleFromMenu(handlers: {
  onLeftRailToggle: () => void;
  onFileTreeToggle: () => void;
  onWorkbenchToggle: () => void;
}): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const off = window.tide?.onTogglePanel?.((panel) => {
      const current = latest.current;
      if (panel === "leftRail") {
        current.onLeftRailToggle();
      } else if (panel === "fileTree") {
        current.onFileTreeToggle();
      } else if (panel === "workbench") {
        current.onWorkbenchToggle();
      }
    });
    return off;
  }, []);
}

// Cmd+W "close intent" from the application menu: close the focused Workbench pane if
// one is open, else (a thread is active) return to the start composer. Never closes the
// window (Shift+Cmd+W does that). Subscribes once; reads the latest state/handlers via a
// commit-phase ref so the IPC listener never re-binds.
export function useCloseIntentFromMenu(params: {
  activeWorkbenchPaneId: string | undefined;
  workbenchOpen: boolean;
  hasThread: boolean;
  onCloseWorkbenchPane: (paneId: string) => void;
  onNewThread: () => void;
}): void {
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  });
  useEffect(() => {
    const off = window.tide?.onCloseIntent?.(() => {
      const current = latest.current;
      if (current.workbenchOpen && current.activeWorkbenchPaneId !== undefined) {
        current.onCloseWorkbenchPane(current.activeWorkbenchPaneId);
      } else if (current.hasThread) {
        current.onNewThread();
      }
    });
    return off;
  }, []);
}

// Escape for the surfaces that don't manage their own: Workbench fullscreen, the
// Settings modal, and — as a last resort — interrupting a running agent turn (spec:
// esc-interrupts-run.md). (Quick Open / Content Search / worktree dialogs / composer
// popovers already close themselves on Escape.) Each listener subscribes only while
// its condition holds. The interrupt listener is gated by `interruptSuppressed` so it
// YIELDS to any open transient UI (which owns Escape), never stealing it.
export function useEscapeShortcuts(params: {
  workbenchFullscreen: boolean;
  onExitFullscreen: () => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
  agentRunning: boolean;
  interruptSuppressed: boolean;
  onInterrupt: () => void;
}): void {
  const { workbenchFullscreen, onExitFullscreen, settingsOpen, onCloseSettings, agentRunning, interruptSuppressed, onInterrupt } = params;
  // Hold the latest callbacks in a ref (refreshed in the commit phase) so the listeners
  // re-bind only when their open flag flips, with no stale-closure risk. Review feedback.
  const latest = useRef({ onExitFullscreen, onCloseSettings, onInterrupt });
  useEffect(() => {
    latest.current = { onExitFullscreen, onCloseSettings, onInterrupt };
  });
  useEffect(() => {
    if (!workbenchFullscreen) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        latest.current.onExitFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workbenchFullscreen]);
  useEffect(() => {
    if (!settingsOpen) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        latest.current.onCloseSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);
  useEffect(() => {
    // Only while a turn is actually running and no transient UI is open — so Escape
    // first closes any popover/dialog/modal, and only otherwise stops the agent.
    if (!agentRunning || interruptSuppressed) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        latest.current.onInterrupt();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agentRunning, interruptSuppressed]);
}

// Product Shell wiring for useEscapeShortcuts: exit Workbench fullscreen / close the
// Settings modal / interrupt a running turn — the interrupt yields to any open transient
// UI (`otherOverlaysOpen` = Quick Open / Content Search / worktree dialogs, plus
// fullscreen / Settings / the composer surface read from state here). Extracted from
// product-shell.tsx for the size cap. Spec: esc-interrupts-run.md.
export function useProductShellEscape(
  shellState: ProductShellState,
  setShellState: Dispatch<SetStateAction<ProductShellState>>,
  viewModel: ProductShellViewModel,
  handlers: Pick<ProductShellHandlers, "onCloseSettings" | "onInterrupt">,
  otherOverlaysOpen: boolean,
): void {
  useEscapeShortcuts({
    workbenchFullscreen: shellState.workbenchFullscreen,
    onExitFullscreen: () => setShellState((state) => toggleProductShellWorkbenchFullscreen(state)),
    settingsOpen: shellState.settingsOpen,
    onCloseSettings: handlers.onCloseSettings,
    agentRunning: viewModel.agentChat.chatState === "running",
    interruptSuppressed:
      otherOverlaysOpen ||
      shellState.settingsOpen ||
      shellState.workbenchFullscreen ||
      viewModel.agentChat.composer.activeSurface !== null,
    onInterrupt: handlers.onInterrupt,
  });
}

export const GIT_STATE_REFRESH_MS = 3000;

// Git state for the top-bar branch BADGE only (the Changes view itself is a first-class
// backend Workbench pane now — see the "open_diff" command + ChangesPanel). The active
// cwd is refreshed periodically so the badge cannot keep stale +/- counts after a commit
// or external file change.
export function useGitState(
  projectBridge: ProjectRegistryBridge | undefined,
  activeProjectCwd: string | null,
  setShellState: Dispatch<SetStateAction<ProductShellState>>,
): {
  // Memoized badge (branch + summed +/- + file count) for the chat header; stable across
  // chat-token renders so the memoized chat column doesn't re-render on every token.
  gitBadge: { branch: string | null; additions: number; deletions: number; fileCount: number; cwd: string } | null;
  gitChanges: GitChangesView | null;
} {
  const [gitInfo, setGitInfo] = useState<GitChangesView | null>(null);
  useEffect(() => {
    if (projectBridge === undefined || activeProjectCwd === null) {
      setShellState((state) => setProductShellGitContext(state, { branches: [], worktrees: [] }));
      setGitInfo(null);
      return undefined;
    }
    // Clear the badge immediately so the previous repo's branch/count doesn't linger
    // while the new cwd's git state is fetched.
    setGitInfo(null);
    const cwd = activeProjectCwd;
    let cancelled = false;
    let requestSerial = 0;
    const refresh = () => {
      const requestId = ++requestSerial;
      Promise.all([projectBridge.gitContext(cwd), projectBridge.gitChanges(cwd)])
        .then(([context, changes]) => {
          if (cancelled || requestId !== requestSerial) {
            return;
          }
          if (!context.isGitRepo || !changes.isGitRepo) {
            setShellState((state) => setGitContextIfChanged(state, { branches: [], worktrees: [] }));
            setGitInfo(null);
            return;
          }
          setShellState((state) =>
            setGitContextIfChanged(state, { branches: context.branches, worktrees: context.worktrees }),
          );
          setGitInfo({ cwd, branch: context.currentBranch, revision: requestId, files: changes.files });
        })
        .catch(() => {
          if (!cancelled && requestId === requestSerial) {
            setShellState((state) => setGitContextIfChanged(state, { branches: [], worktrees: [] }));
            setGitInfo(null);
          }
        });
    };
    refresh();
    const intervalId = window.setInterval(refresh, GIT_STATE_REFRESH_MS);
    const refreshOnFocus = () => refresh();
    const refreshOnVisible = () => {
      if (document.visibilityState !== "hidden") {
        refresh();
      }
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [projectBridge, activeProjectCwd]);
  const gitBadge = useMemo(
    () =>
      gitInfo === null
        ? null
        : {
            branch: gitInfo.branch,
            additions: gitInfo.files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
            deletions: gitInfo.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
            fileCount: gitInfo.files.length,
            cwd: gitInfo.cwd,
          },
    [gitInfo],
  );
  return { gitBadge, gitChanges: gitInfo };
}

function setGitContextIfChanged(
  state: ProductShellState,
  context: { branches: ProductShellState["gitBranches"]; worktrees: ProductShellState["gitWorktrees"] },
): ProductShellState {
  if (sameBranches(state.gitBranches, context.branches) && sameWorktrees(state.gitWorktrees, context.worktrees)) {
    return state;
  }
  return setProductShellGitContext(state, context);
}

function sameBranches(
  current: ProductShellState["gitBranches"],
  next: ProductShellState["gitBranches"],
): boolean {
  return current.length === next.length && current.every((branch, index) => {
    const candidate = next[index];
    return candidate !== undefined
      && branch.name === candidate.name
      && branch.kind === candidate.kind
      && branch.current === candidate.current;
  });
}

function sameWorktrees(
  current: ProductShellState["gitWorktrees"],
  next: ProductShellState["gitWorktrees"],
): boolean {
  return current.length === next.length && current.every((worktree, index) => {
    const candidate = next[index];
    return candidate !== undefined
      && worktree.path === candidate.path
      && worktree.branch === candidate.branch
      && worktree.current === candidate.current;
  });
}
