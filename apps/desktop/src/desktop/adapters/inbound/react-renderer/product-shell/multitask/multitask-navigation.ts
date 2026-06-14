// Pure resolvers for multitask keyboard navigation (spec: multitask-navigation).
// No React / no DOM, so the switching math is unit-testable in isolation. The React
// hook (use-multitask-navigation) wires these to key events + onThreadSelect.

export interface MultitaskTarget {
  threadId: string;
}

// The most pin shortcuts we surface: Ctrl+1..Ctrl+9 (Decision 9 — pin #10+ have no
// number, reached via the rail/peek).
export const MAX_PIN_SHORTCUTS = 9;

// Ctrl+N → the N-th pinned THREAD (1-based) in the caller's pinned order (pinned
// projects are not passed here — they are not switch targets). Out of range ⇒ null.
export function resolvePinJump(
  pinnedThreads: ReadonlyArray<MultitaskTarget>,
  digit: number,
): string | null {
  if (!Number.isInteger(digit) || digit < 1 || digit > MAX_PIN_SHORTCUTS) {
    return null;
  }
  return pinnedThreads[digit - 1]?.threadId ?? null;
}

// Wrap an index into [0, count).
function wrap(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return ((index % count) + count) % count;
}

// The highlight when the switcher OPENS (first Ctrl+Tab): step one off the active
// thread in `direction` (forward = next, backward = previous), like the macOS app
// switcher. If the active thread isn't in the live set, start at the first (forward)
// or last (backward) entry.
export function initialLiveHighlight(
  liveThreads: ReadonlyArray<MultitaskTarget>,
  activeThreadId: string | null,
  direction: 1 | -1,
): number {
  const count = liveThreads.length;
  if (count === 0) {
    return 0;
  }
  const current = liveThreads.findIndex((thread) => thread.threadId === activeThreadId);
  if (current === -1) {
    return direction === 1 ? 0 : count - 1;
  }
  return wrap(current + direction, count);
}

// Advance the highlight while the switcher is already open.
export function advanceLiveHighlight(
  count: number,
  current: number,
  direction: 1 | -1,
): number {
  return wrap(current + direction, count);
}
