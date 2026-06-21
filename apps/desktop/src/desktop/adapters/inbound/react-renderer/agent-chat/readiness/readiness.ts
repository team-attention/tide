import type { AgentChatChoiceSurfaceView, AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ReactElement } from "react";
import { createChoiceSurface } from "../composer/choice-surface.tsx";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

export function createProviderReadiness(
  viewModel: AgentChatShellViewModel,
  onRowSelect?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void,
): ReactElement[] {
  if (viewModel.providerReadinessBlockers.length === 0) {
    return [];
  }
  const agentLabel = viewModel.providerReadinessAgentLabel ?? "the provider";

  return [
    createChoiceSurface({
      key: "provider-readiness",
      onRowSelect,
      surface: {
        surfaceKind: "provider_readiness",
        title: "Provider readiness required",
        sourceLabel: "Provider Readiness",
        rows: viewModel.providerReadinessBlockers.flatMap((blocker) => [
          {
            rowId: blocker.kind,
            label: blocker.message,
            detail: blocker.scope,
            icon: "□",
          },
          // The directory-trust blocker gets a one-click in-app trust action that
          // writes the provider's own trust config (no terminal drop). While the
          // grant is in flight the row shows it is working (re-clicks are ignored).
          ...(blocker.kind === "directory_trust_required"
            ? [
                viewModel.providerReadinessActionPending
                  ? {
                      rowId: "directory_trust_required:trust",
                      label: "Trusting this folder…",
                      detail: "writing workspace trust",
                      icon: "⋯",
                    }
                  : {
                      rowId: "directory_trust_required:trust",
                      label: "Trust this folder",
                      detail: "lets this agent run here — one click, nothing else changes",
                      icon: "✓",
                    },
              ]
            : []),
          ...(blocker.terminalAction
            ? [
                {
                  rowId: `${blocker.kind}:terminal`,
                  label: readinessTerminalRowLabel(blocker.kind, agentLabel),
                  detail: readinessTerminalRowDetail(blocker.kind),
                  icon: "+",
                },
              ]
            : blocker.action
              ? [
                  {
                    rowId: `${blocker.kind}:${blocker.action}`,
                    label: blocker.action,
                    detail: "preserve draft",
                    icon: "+",
                  },
                ]
            : []),
        ]),
      },
      message: viewModel.providerReadinessBlockers.map((blocker) => blocker.message).join("\n"),
    }),
  ];
}

// The non-blocking agent-CLI update advisory is no longer a choice-surface card —
// it renders as a compact `↑ Update <Agent>` chip in the composer toolbar
// (composer.tsx), which fires the same `update_available:terminal` readiness terminal
// handoff on click. Spec: version-management.md (Lane 2), D2.

// Actionable label for a provider readiness terminal row, so the user reads exactly what clicking does.
// ("Install Codex" / "Sign in to Codex") instead of a generic prompt. Spec: provider-cli-setup-handoff.
function readinessTerminalRowLabel(kind: string, agentLabel: string): string {
  switch (kind) {
    case "not_installed":
      return `Install ${agentLabel}`;
    case "not_authenticated":
      return `Sign in to ${agentLabel}`;
    case "onboarding_required":
      return `Finish setting up ${agentLabel}`;
    case "hook_bootstrap_required":
      return `Set up ${agentLabel} for Tide`;
    default:
      return `Set up ${agentLabel} in a terminal`;
  }
}

function readinessTerminalRowDetail(kind: string): string {
  switch (kind) {
    case "not_installed":
      return "installs the CLI in a terminal, then continues — your draft is kept";
    case "not_authenticated":
      return "opens its sign-in in a terminal, then continues — your draft is kept";
    default:
      return "opens the provider's own flow; your draft is kept";
  }
}
