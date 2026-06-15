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
// short hold), Option+1..9 jumps to the N-th rail thread (top-9), and Option+Tab / Option+Shift+Tab
// cycle the live set through a HUD that commits on Option release. Everything is
// transient — nothing persists on release. (Option, not Control, per user pref; on
// macOS Option mangles event.key for digits, so digits are matched on event.code.)
export function useMultitaskNavigation(params: {
  numberedThreads: ProductShellThreadView[];
  liveThreads: ProductShellThreadView[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
}): { active: boolean; hud: ReactElement | null } {
  const { numberedThreads, liveThreads, activeThreadId, onSelectThread } = params;
  const [altActive, setAltActive] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const [switcher, setSwitcher] = useState<SwitcherState>({ open: false, index: 0 });

  // The keydown/keyup handlers subscribe once; read the latest inputs through a ref so
  // they never need to re-attach (and never close over stale lists).
  const latest = useRef({ numberedThreads, liveThreads, activeThreadId, onSelectThread, switcher });
  // Refresh the ref in the commit phase (not during render) so an aborted/yielded
  // render can't leave it inconsistent. Review feedback.
  useEffect(() => {
    latest.current = { numberedThreads, liveThreads, activeThreadId, onSelectThread, switcher };
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
        // Cancel the pending badge hold-delay so the rail ⌥N badges don't flash on while
        // the switcher HUD is active.
        clearHoldTimer();
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
      // Option+1..9 → jump to the N-th thread in Left Rail order (top-9, not just
      // pinned). Match the PHYSICAL key (event.code) — on macOS Option+1 reports
      // event.key="¡", not "1".
      const digit = /^Digit([1-9])$/.exec(event.code);
      if (digit !== null) {
        // Swallow EVERY Option+digit (even out-of-range) so it can't fall through to a
        // browser/OS shortcut. Review feedback.
        event.preventDefault();
        const target = resolvePinJump(current.numberedThreads, Number(digit[1]));
        if (target !== null) {
          // A digit jump is an action WITHIN multitask mode, not an exit from it: while
          // Option stays physically held the ⌥N badges must remain so the user can chain
          // jumps (Option+1, Option+2, …). So leave the badge state alone — keep the hold
          // timer running (badges still appear iff Option is held past the threshold; a
          // genuine quick tap releases before then and keyup clears it) and don't force
          // `altActive` off. Only drop any open switcher, so the Option release doesn't
          // override this jump with the HUD's highlighted live thread.
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

    // A swallowed Option keyup must never leave the badges/HUD stuck on. It can be lost
    // two ways: the window loses OS focus (Cmd+Tab, devtools), or — since a digit jump
    // no longer tears multitask mode down — focus moves INTO a <webview> or terminal
    // (both eat keyboard events) in the jumped-to thread, so the keyup never reaches the
    // window and a pending hold timer would later fire onto a dead session. Reset on both.
    const resetMultitask = () => {
      clearHoldTimer();
      setAltActive(false);
      setSwitcher({ open: false, index: 0 });
    };
    const onBlur = () => resetMultitask();
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "WEBVIEW" || target.closest(".workbench-terminal") !== null)
      ) {
        resetMultitask();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focusin", onFocusIn);
    return () => {
      clearHoldTimer();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  const hud = switcher.open ? createLiveSwitcherHud(liveThreads, switcher.index) : null;
  return { active: altActive, hud };
}
