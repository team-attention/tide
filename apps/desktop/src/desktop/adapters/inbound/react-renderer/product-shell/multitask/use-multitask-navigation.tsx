import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell.ts";
import {
  advanceLiveHighlight,
  initialLiveHighlight,
  resolvePinJump,
} from "./multitask-navigation.ts";
import { createLiveSwitcherHud } from "./live-switcher-hud.tsx";

interface SwitcherState {
  open: boolean;
  index: number;
}

// Ctrl-unified multitask navigation (spec: multitask-navigation L2 + L3). While Ctrl
// is held this is "multitask mode": `active` drives the row ^N badges, Ctrl+1..9 jumps
// to a pinned thread, and Ctrl+Tab / Ctrl+Shift+Tab cycle the live set through a HUD
// that commits on Ctrl release. Everything is transient — nothing persists on release.
export function useMultitaskNavigation(params: {
  pinnedThreads: ProductShellThreadView[];
  liveThreads: ProductShellThreadView[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
}): { active: boolean; hud: ReactElement | null } {
  const { pinnedThreads, liveThreads, activeThreadId, onSelectThread } = params;
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [switcher, setSwitcher] = useState<SwitcherState>({ open: false, index: 0 });

  // The keydown/keyup handlers subscribe once; read the latest inputs through a ref so
  // they never need to re-attach (and never close over stale lists).
  const latest = useRef({ pinnedThreads, liveThreads, activeThreadId, onSelectThread, switcher });
  // Refresh the ref in the commit phase (not during render) so an aborted/yielded
  // render can't leave it inconsistent. Review feedback.
  useEffect(() => {
    latest.current = { pinnedThreads, liveThreads, activeThreadId, onSelectThread, switcher };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Control") {
        setCtrlHeld(true);
        return;
      }
      if (!event.ctrlKey) {
        return;
      }
      const current = latest.current;
      // Ctrl+Tab / Ctrl+Shift+Tab → cycle the live set through the HUD.
      if (event.key === "Tab") {
        event.preventDefault();
        if (current.liveThreads.length === 0) {
          return;
        }
        const direction: 1 | -1 = event.shiftKey ? -1 : 1;
        setSwitcher((prev) =>
          prev.open
            ? { open: true, index: advanceLiveHighlight(current.liveThreads.length, prev.index, direction) }
            : { open: true, index: initialLiveHighlight(current.liveThreads, current.activeThreadId, direction) },
        );
        return;
      }
      // Ctrl+1..9 → jump to the N-th pinned thread (stable manual order).
      if (/^[1-9]$/.test(event.key)) {
        // Swallow EVERY Ctrl+digit (even out-of-range, e.g. Ctrl+9 with <9 pins) so it
        // can't fall through to a browser/OS shortcut. Review feedback.
        event.preventDefault();
        const target = resolvePinJump(current.pinnedThreads, Number(event.key));
        if (target !== null) {
          // A pin jump ends multitask mode immediately; drop any open switcher so the
          // Ctrl release does not override the jump with the highlighted live thread.
          setSwitcher({ open: false, index: 0 });
          current.onSelectThread(target);
        }
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Control") {
        return;
      }
      setCtrlHeld(false);
      const current = latest.current;
      if (current.switcher.open) {
        const target = current.liveThreads[current.switcher.index];
        if (target !== undefined) {
          current.onSelectThread(target.threadId);
        }
        setSwitcher({ open: false, index: 0 });
      }
    };

    // Losing focus (Cmd+Tab away, devtools) can swallow the Control keyup — reset so
    // the badges/HUD never get stuck on.
    const onBlur = () => {
      setCtrlHeld(false);
      setSwitcher({ open: false, index: 0 });
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const hud = switcher.open ? createLiveSwitcherHud(liveThreads, switcher.index) : null;
  return { active: ctrlHeld, hud };
}
