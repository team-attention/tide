import type { ProductShellAgentIdentity } from "../../../../application/domains/product-shell/product-shell-state.ts";
import { agentDescriptor } from "../../../../../shared/contracts/agent-descriptors.ts";
import { createElement } from "react";
import type { ReactElement } from "react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Two-letter monogram per provider (Codex/Claude both start with C, so we use
// a distinct 2-char code for each). Sourced from the agent descriptor registry.
export function agentMonogram(agentId: ProductShellAgentIdentity): string {
  return agentDescriptor(agentId)?.monogram ?? "Co";
}

export function AgentIdentityIcon(props: { agentId: ProductShellAgentIdentity | string }): ReactElement {
  const agentId = normalizeAgentId(props.agentId);

  return createElement(
    "span",
    {
      className: `agent-identity-icon agent-identity-icon--${agentId}`,
      "data-agent-icon": agentId,
      "aria-label": agentLabel(agentId),
      role: "img",
    },
    agentMonogram(agentId),
  );
}

function normalizeAgentId(agentId: string): ProductShellAgentIdentity {
  if (
    agentId === "claude" ||
    agentId === "gemini" ||
    agentId === "opencode" ||
    agentId === "openai_api"
  ) {
    return agentId;
  }
  return "codex";
}

function agentLabel(agentId: ProductShellAgentIdentity): string {
  return agentDescriptor(agentId)?.displayName ?? "Codex CLI";
}
