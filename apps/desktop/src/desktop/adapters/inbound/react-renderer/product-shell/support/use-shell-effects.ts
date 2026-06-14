// Cross-cutting Product Shell effects extracted from product-shell.tsx to keep that
// file under the size cap (file-size-ratchet): the responsive rightmost-column
// measurement and the global search keyboard shortcuts.

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import type { ProductShellBackendCommand } from "../../../../../application/domains/product-shell/product-shell.ts";

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
  useEffect(() => {
    if (!workbenchFullscreen) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onExitFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbenchFullscreen]);
  useEffect(() => {
    if (!settingsOpen) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen]);
}
