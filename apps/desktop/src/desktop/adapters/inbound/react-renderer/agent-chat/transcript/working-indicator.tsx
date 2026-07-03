import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { keyframes, styled } from "styled-components";
import { TranscriptTurn, TurnLabel } from "./transcript.parts.tsx";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// Live working indicator with an elapsed timer, so a long turn reads as active
// progress (like "Working… 12s") rather than a static spinner.
export function AgentWorkingIndicator({
  runtimeStartedAt,
  liveActivitySummary,
}: {
  runtimeStartedAt?: string;
  // A pre-formatted one-line activity hint (e.g. "3 agents running", "WebSearch"),
  // appended after the elapsed timer so a long fan-out reads as alive.
  liveActivitySummary?: string;
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
  const elapsed = seconds > 0 ? `Working… ${seconds}s` : "Working…";
  const detail = liveActivitySummary?.trim();
  const text = detail ? `${elapsed} · ${detail}` : elapsed;
  return (
    <TranscriptTurn
      $role="agent"
      data-transcript-turn="true"
      data-block-role="agent"
      data-working={true}
      aria-live="polite"
    >
      <TurnLabel>Agent</TurnLabel>
      <WorkingStatus>
        <WorkingDot />
        <WorkingDot />
        <WorkingDot />
        <WorkingText data-working-text="true">{text}</WorkingText>
      </WorkingStatus>
    </TranscriptTurn>
  );
}

const workingPulse = keyframes`
  0%,
  80%,
  100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
`;

const WorkingStatus = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--tide-muted);
  font-size: 13px;
`;

const WorkingDot = styled.span`
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--tide-muted);
  animation: ${workingPulse} 1.1s ease-in-out infinite;

  &:nth-child(2) {
    animation-delay: 0.18s;
  }

  &:nth-child(3) {
    animation-delay: 0.36s;
  }
`;

const WorkingText = styled.span`
  margin-left: 4px;
`;
