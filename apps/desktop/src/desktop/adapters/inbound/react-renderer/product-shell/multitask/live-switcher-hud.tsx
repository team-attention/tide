import type { ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ReactElement } from "react";
import { styled } from "styled-components";
import { AgentIdentityIcon } from "../support/agent-identity.tsx";

// The center ⌘-Tab-style HUD shown while cycling the live set with Ctrl+Tab
// (spec: multitask-navigation L3). Transient: rendered only while the switcher is
// open, so it is never persistent chrome. Returns null for an empty live set.
export function createLiveSwitcherHud(
  threads: ProductShellThreadView[],
  highlightIndex: number,
): ReactElement | null {
  if (threads.length === 0) {
    return null;
  }
  return (
    <LiveSwitcherBackdrop>
      <LiveSwitcherDialog role="dialog" aria-label="Switch running thread">
        <LiveThreadRail>
          {threads.map((thread, index) => (
            <LiveThreadCard
              key={thread.threadId}
              aria-current={index === highlightIndex}
              data-active={index === highlightIndex ? "true" : "false"}
              data-thread-id={thread.threadId}
            >
              <AgentIdentityIcon agentId={thread.agentId} />
              <LiveThreadTitle>{thread.title}</LiveThreadTitle>
              <LiveThreadState>{hudStateLabel(thread)}</LiveThreadState>
            </LiveThreadCard>
          ))}
        </LiveThreadRail>
        <LiveSwitcherHint>⌥Tab to cycle · release to switch</LiveSwitcherHint>
      </LiveSwitcherDialog>
    </LiveSwitcherBackdrop>
  );
}

function hudStateLabel(thread: ProductShellThreadView): string {
  if (thread.attention === true) {
    return "needs you";
  }
  if (thread.running === true) {
    return "working";
  }
  return "idle";
}

const LiveSwitcherBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: color-mix(in srgb, var(--tide-bg) 28%, transparent);
`;

const LiveSwitcherDialog = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: min(80vw, 720px);
  padding: 16px;
  border: 1px solid var(--tide-line);
  border-radius: 16px;
  background: var(--tide-elevated, var(--tide-bg));
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
`;

const LiveThreadRail = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
`;

const LiveThreadCard = styled.div`
  width: 132px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 10px;
  border: 1.5px solid transparent;
  border-radius: 12px;
  background: var(--tide-selection);
  color: var(--tide-text);

  &[data-active="true"] {
    border-color: var(--tide-action);
    background: color-mix(in srgb, var(--tide-action) 14%, var(--tide-selection));
  }

  [data-agent-icon] {
    width: 22px;
    height: 22px;
    border-radius: 7px;
  }
`;

const LiveThreadTitle = styled.span`
  max-width: 100%;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const LiveThreadState = styled.span`
  color: var(--tide-muted);
  font-size: 11px;
`;

const LiveSwitcherHint = styled.div`
  color: var(--tide-muted);
  font-size: 11px;
  text-align: center;
`;
