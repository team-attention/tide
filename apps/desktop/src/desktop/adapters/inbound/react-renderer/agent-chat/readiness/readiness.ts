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
                  label: "Set up in the provider terminal instead",
                  detail: "opens the provider's own setup; your draft is kept",
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
