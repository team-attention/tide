import type { ProductShellAgentIdentity } from "../../../../../application/domains/product-shell/product-shell.ts";
import { agentDescriptor } from "../../../../../../shared/agent-descriptors.ts";
import type { ReactElement } from "react";
import { styled } from "styled-components";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Two-letter monogram per provider (Codex/Claude both start with C, so we use
// a distinct 2-char code for each). Sourced from the agent descriptor registry.
export function agentMonogram(agentId: ProductShellAgentIdentity): string {
  return agentDescriptor(agentId)?.monogram ?? "Co";
}

export function AgentIdentityIcon(props: { agentId: ProductShellAgentIdentity | string }): ReactElement {
  const agentId = normalizeAgentId(props.agentId);

  return (
    <AgentIdentityBadge
      data-agent-icon={agentId}
      aria-label={agentLabel(agentId)}
      role="img"
    >
      {agentMonogram(agentId)}
    </AgentIdentityBadge>
  );
}

function normalizeAgentId(agentId: string): ProductShellAgentIdentity {
  if (
    agentId === "claude" ||
    agentId === "opencode"
  ) {
    return agentId;
  }
  return "codex";
}

function agentLabel(agentId: ProductShellAgentIdentity): string {
  return agentDescriptor(agentId)?.displayName ?? "Codex CLI";
}

const AgentIdentityBadge = styled.span`
  width: 18px;
  height: 18px;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--tide-selection);
  color: var(--tide-muted);
  box-shadow: inset 0 0 0 1px var(--tide-line);
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: 0.01em;
  line-height: 1;
  text-transform: none;
  user-select: none;
`;
