import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ReactElement } from "react";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// A quiet context/token usage chip above the composer (Codex-app style): an
// optional thin context-window meter, then the percent + token labels. Shown
// only when the provider has reported usage for the active thread.
export function createUsageMeter(usage: NonNullable<AgentChatShellViewModel["usage"]>): ReactElement {
  const text = [
    usage.contextPercentLabel ? `${usage.contextPercentLabel} context` : undefined,
    usage.tokensLabel,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" · ");
  return (
    <div className="agent-usage" aria-label="Context usage">
      {usage.contextUsedPercent !== undefined ? (
        <span className="agent-usage__bar" aria-hidden>
          <span
            className="agent-usage__bar-fill"
            style={{ width: `${Math.max(2, Math.min(100, usage.contextUsedPercent))}%` }}
          />
        </span>
      ) : null}
      <span className="agent-usage__text">{text}</span>
    </div>
  );
}
