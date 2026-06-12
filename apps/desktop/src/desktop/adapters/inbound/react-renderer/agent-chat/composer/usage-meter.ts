import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat-shell-state.ts";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// A quiet context/token usage chip above the composer (Codex-app style): an
// optional thin context-window meter, then the percent + token labels. Shown
// only when the provider has reported usage for the active thread.
export function createUsageMeter(usage: NonNullable<AgentChatShellViewModel["usage"]>): ReactElement {
  const parts: ReactNode[] = [];
  if (usage.contextUsedPercent !== undefined) {
    parts.push(
      createElement(
        "span",
        { key: "bar", className: "agent-usage__bar", "aria-hidden": true },
        createElement("span", {
          className: "agent-usage__bar-fill",
          style: { width: `${Math.max(2, Math.min(100, usage.contextUsedPercent))}%` },
        }),
      ),
    );
  }
  const text = [
    usage.contextPercentLabel ? `${usage.contextPercentLabel} context` : undefined,
    usage.tokensLabel,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" · ");
  parts.push(createElement("span", { key: "text", className: "agent-usage__text" }, text));
  return createElement(
    "div",
    { className: "agent-usage", "aria-label": "Context usage" },
    ...parts,
  );
}
