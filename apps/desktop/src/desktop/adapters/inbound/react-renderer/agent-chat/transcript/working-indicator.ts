import { createElement, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// Live working indicator with an elapsed timer, so a long turn reads as active
// progress (like "Working… 12s") rather than a static spinner.
export function AgentWorkingIndicator({
  runtimeStartedAt,
}: {
  runtimeStartedAt?: string;
}): ReactElement {
  // Base elapsed on when the turn actually started (from the backend), so the timer
  // is correct even after reopening a running thread. Fall back to mount time only
  // when the backend hasn't reported a start (e.g. an optimistic local turn).
  // Memoize so an undefined runtimeStartedAt doesn't re-anchor to Date.now() every
  // render (the mount-time fallback must stay stable for one turn).
  const startedMs = useMemo(() => {
    const parsed = runtimeStartedAt ? Date.parse(runtimeStartedAt) : NaN;
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }, [runtimeStartedAt]);
  // The interval only forces a re-render each second; the elapsed value is derived
  // straight from the injected start time every render, so switching threads shows
  // the new turn's elapsed immediately (no stale state to wait out).
  const [, forceTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
  return createElement(
    "article",
    {
      className: "agent-session-turn agent-session-turn--agent agent-session-turn--working",
      "data-block-role": "agent",
      "data-working": true,
      "aria-live": "polite",
    },
    createElement("span", { className: "agent-session-turn__label" }, "Agent"),
    createElement(
      "span",
      { className: "agent-session-working" },
      createElement("span", { className: "agent-session-working__dot" }),
      createElement("span", { className: "agent-session-working__dot" }),
      createElement("span", { className: "agent-session-working__dot" }),
      createElement(
        "span",
        { className: "agent-session-working__text" },
        seconds > 0 ? `Working… ${seconds}s` : "Working…",
      ),
    ),
  );
}
