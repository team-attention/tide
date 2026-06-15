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

// Time the Option key must be HELD before the passive ^N badges appear, so a quick
// Option+digit / Option+Tab tap (an explicit action) never flashes the badges. The
// actions themselves fire immediately on keydown; only the badge overlay waits.
const BADGE_HOLD_DELAY_MS = 320;

// Option-unified multitask navigation (spec: multitask-navigation L2 + L3). While
// Option is held this is "multitask mode": `active` drives the row ⌥N badges (after a
// short hold), Option+1..9 jumps to a pinned thread, and Option+Tab / Option+Shift+Tab
// cycle the live set through a HUD that commits on Option release. Everything is
// transient — nothing persists on release. (Option, not Control, per user pref; on
// macOS Option mangles event.key for digits, so digits are matched on event.code.)
export function useMultitaskNavigation(params: {
  pinnedThreads: ProductShellThreadView[];
  liveThreads: ProductShellThreadView[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
}): { active: boolean; hud: ReactElement | null } {
  const { pinnedThreads, liveThreads, activeThreadId, onSelectThread } = params;
  const [altActive, setAltActive] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const [switcher, setSwitcher] = useState<SwitcherState>({ open: false, index: 0 });

  // The keydown/keyup handlers subscribe once; read the latest inputs through a ref so
  // they never need to re-attach (and never close over stale lists).
  const latest = useRef({ pinnedThreads, liveThreads, activeThreadId, onSelectThread, switcher });
  // Refresh the ref in the commit phase (not during render) so an aborted/yielded
  // render can't leave it inconsistent. Review feedback.
  useEffect(() => {
    latest.current = { pinnedThreads, liveThreads, activeThreadId, onSelectThread, switcher };
  });

  const clearHoldTimer = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        // Show the passive ⌥N badges only after a deliberate hold (not on a quick tap).
        if (holdTimer.current === null) {
          holdTimer.current = window.setTimeout(() => {
            setAltActive(true);
            holdTimer.current = null;
          }, BADGE_HOLD_DELAY_MS);
        }
        return;
      }
      if (!event.altKey) {
        return;
      }
      const current = latest.current;
      // Option+Tab / Option+Shift+Tab → cycle the live set through the HUD.
      if (event.code === "Tab") {
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
      // Option+1..9 → jump to the N-th pinned thread (stable manual order). Match the
      // PHYSICAL key (event.code) — on macOS Option+1 reports event.key="¡", not "1".
      const digit = /^Digit([1-9])$/.exec(event.code);
      if (digit !== null) {
        // Swallow EVERY Option+digit (even out-of-range) so it can't fall through to a
        // browser/OS shortcut. Review feedback.
        event.preventDefault();
        const target = resolvePinJump(current.pinnedThreads, Number(digit[1]));
        if (target !== null) {
          // A pin jump ends multitask mode immediately; drop any open switcher so the
          // Option release does not override the jump with the highlighted live thread.
          setSwitcher({ open: false, index: 0 });
          current.onSelectThread(target);
        }
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Alt") {
        return;
      }
      clearHoldTimer();
      setAltActive(false);
      const current = latest.current;
      if (current.switcher.open) {
        const target = current.liveThreads[current.switcher.index];
        if (target !== undefined) {
          current.onSelectThread(target.threadId);
        }
        setSwitcher({ open: false, index: 0 });
      }
    };

    // Losing focus (Cmd+Tab away, devtools) can swallow the Option keyup — reset so
    // the badges/HUD never get stuck on.
    const onBlur = () => {
      clearHoldTimer();
      setAltActive(false);
      setSwitcher({ open: false, index: 0 });
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      clearHoldTimer();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const hud = switcher.open ? createLiveSwitcherHud(liveThreads, switcher.index) : null;
  return { active: altActive, hud };
}
