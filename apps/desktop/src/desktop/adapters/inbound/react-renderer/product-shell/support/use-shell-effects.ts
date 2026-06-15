// Cross-cutting Product Shell effects extracted from product-shell.tsx to keep that
// file under the size cap (file-size-ratchet): the responsive rightmost-column
// measurement and the global search keyboard shortcuts.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { setProductShellGitContext } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellBackendCommand, ProductShellState } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { GitChangesResult, ProjectRegistryBridge } from "./types.ts";

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

// A Browser Pane link opened with Cmd/Ctrl+click (or window.open): Main denies the
// popup and forwards the URL here; open it as a new Browser Pane. The handler reads
// the latest state via setShellState, so subscribing once is safe.
export function useOpenBrowserPaneFromMain(
  onOpenBrowserPane: (url: string, options?: { newPane?: boolean }) => void,
): void {
  useEffect(() => {
    const off = window.tide?.onOpenBrowserPane?.((url: string) => onOpenBrowserPane(url, { newPane: true }));
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

// Escape for the two surfaces that don't manage their own: Workbench fullscreen and
// the Settings modal. (Quick Open / Content Search / worktree dialogs already close
// themselves on Escape.) Each listener subscribes only while its surface is open.
export function useEscapeShortcuts(params: {
  workbenchFullscreen: boolean;
  onExitFullscreen: () => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
}): void {
  const { workbenchFullscreen, onExitFullscreen, settingsOpen, onCloseSettings } = params;
  // Hold the latest callbacks in a ref (refreshed in the commit phase) so the listeners
  // re-bind only when their open flag flips, with no stale-closure risk. Review feedback.
  const latest = useRef({ onExitFullscreen, onCloseSettings });
  useEffect(() => {
    latest.current = { onExitFullscreen, onCloseSettings };
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
}

export interface GitChangesView {
  cwd: string;
  branch: string | null;
  files: GitChangesResult["files"];
}

// Everything the docked Changes pane needs. Memoized so the workbench column (a memo
// boundary) only re-renders when git state / open-ness changes, not on chat tokens.
export interface ChangesPaneData {
  open: boolean;
  isGitRepo: boolean;
  branch: string | null;
  files: GitChangesResult["files"];
  loadDiff: (relPath: string) => Promise<string>;
  onRefresh: () => void;
  onClose: () => void;
}

// Consolidated git state for the active repo/worktree. One fetch on cwd change / manual
// refresh feeds BOTH the composer's branch+worktree pickers (gitContext → shell state)
// and the top-bar badge + read-only Changes view (uncommitted files → gitInfo).
export function useGitState(
  projectBridge: ProjectRegistryBridge | undefined,
  activeProjectCwd: string | null,
  setShellState: Dispatch<SetStateAction<ProductShellState>>,
): {
  gitInfo: GitChangesView | null;
  setOpen: (open: boolean) => void;
  // Memoized badge (branch + summed +/- + file count) for the chat header; stable across
  // chat-token renders so the memoized chat column doesn't re-render on every token.
  gitBadge: { branch: string | null; additions: number; deletions: number; fileCount: number; onOpen: () => void } | null;
  // Memoized data for the docked Changes pane in the Workbench column.
  changes: ChangesPaneData;
} {
  const [gitInfo, setGitInfo] = useState<GitChangesView | null>(null);
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (projectBridge === undefined || activeProjectCwd === null) {
      setShellState((state) => setProductShellGitContext(state, { branches: [], worktrees: [] }));
      setGitInfo(null);
      return undefined;
    }
    const cwd = activeProjectCwd;
    let cancelled = false;
    Promise.all([projectBridge.gitContext(cwd), projectBridge.gitChanges(cwd)])
      .then(([context, changes]) => {
        if (cancelled) {
          return;
        }
        setShellState((state) =>
          setProductShellGitContext(state, { branches: context.branches, worktrees: context.worktrees }),
        );
        setGitInfo(context.isGitRepo ? { cwd, branch: context.currentBranch, files: changes.files } : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectBridge, activeProjectCwd, nonce]);
  const gitBadge = useMemo(
    () =>
      gitInfo === null
        ? null
        : {
            branch: gitInfo.branch,
            additions: gitInfo.files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
            deletions: gitInfo.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
            fileCount: gitInfo.files.length,
            onOpen: () => setOpen(true),
          },
    [gitInfo],
  );
  const changes = useMemo<ChangesPaneData>(
    () => ({
      open,
      isGitRepo: gitInfo !== null,
      branch: gitInfo?.branch ?? null,
      files: gitInfo?.files ?? [],
      loadDiff: (relPath: string) =>
        gitInfo === null || projectBridge === undefined
          ? Promise.resolve("")
          : projectBridge.gitFileDiff(gitInfo.cwd, relPath),
      onRefresh: () => setNonce((value) => value + 1),
      onClose: () => setOpen(false),
    }),
    [open, gitInfo, projectBridge],
  );
  return { gitInfo, setOpen, gitBadge, changes };
}
