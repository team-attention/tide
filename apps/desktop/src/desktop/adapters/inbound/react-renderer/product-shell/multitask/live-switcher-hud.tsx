import type { ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ReactElement } from "react";
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
    <div className="multitask-hud-backdrop">
      <div className="multitask-hud" role="dialog" aria-label="Switch running thread">
        <div className="multitask-hud__rail">
          {threads.map((thread, index) => (
            <div
              key={thread.threadId}
              className={`multitask-hud__card${index === highlightIndex ? " multitask-hud__card--active" : ""}`}
              aria-current={index === highlightIndex}
              data-thread-id={thread.threadId}
            >
              <AgentIdentityIcon agentId={thread.agentId} />
              <span className="multitask-hud__title">{thread.title}</span>
              <span className="multitask-hud__state">{hudStateLabel(thread)}</span>
            </div>
          ))}
        </div>
        <div className="multitask-hud__hint">Ctrl+Tab to cycle · release to switch</div>
      </div>
    </div>
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
