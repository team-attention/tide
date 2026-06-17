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
        title: "Provider setup required",
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
          ...(blocker.setup
            ? [
                {
                  rowId: `${blocker.kind}:setup`,
                  label: setupRowLabel(blocker.kind, agentLabel),
                  detail: setupRowDetail(blocker.kind),
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

// The non-blocking agent-CLI update nudge (spec: version-management.md, Lane 2).
// Separate from the blocking readiness card above: it renders whenever an update
// advisory is present — even when the agent is ready and has no blockers — and a
// single click runs the same Provider Setup Surface terminal handoff as install,
// updating the CLI in place (npm install -g <pkg>@latest).
export function createProviderUpdateNudge(
  viewModel: AgentChatShellViewModel,
  onRowSelect?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void,
): ReactElement[] {
  const advisory = viewModel.providerUpdateAdvisory;
  if (advisory === undefined) {
    return [];
  }
  return [
    createChoiceSurface({
      key: "provider-update",
      onRowSelect,
      surface: {
        surfaceKind: "provider_readiness",
        title: `Update ${advisory.agentLabel}`,
        sourceLabel: "Update available",
        rows: [
          {
            rowId: "update_available:setup",
            label: `Update ${advisory.agentLabel}`,
            detail: `v${advisory.currentVersion} → v${advisory.latestVersion} — updates the CLI in a terminal, your draft is kept`,
            icon: "↑",
          },
        ],
      },
      message: `A newer ${advisory.agentLabel} CLI is available (v${advisory.latestVersion}).`,
    }),
  ];
}

// Actionable label for a Provider Setup Surface row, so the user reads exactly what clicking does
// ("Install Codex" / "Sign in to Codex") instead of a generic prompt. Spec: provider-cli-setup-handoff.
function setupRowLabel(kind: string, agentLabel: string): string {
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

function setupRowDetail(kind: string): string {
  switch (kind) {
    case "not_installed":
      return "installs the CLI in a terminal, then continues — your draft is kept";
    case "not_authenticated":
      return "opens its sign-in in a terminal, then continues — your draft is kept";
    default:
      return "opens the provider's own setup; your draft is kept";
  }
}
