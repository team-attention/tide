import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ComposerHandlers } from "../support/types.ts";
import type { ReactElement, ReactNode } from "react";
import { createComposer } from "../composer/composer.tsx";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

export function createNewThreadStartSurface(
  viewModel: AgentChatShellViewModel,
  handlers: ComposerHandlers,
): ReactElement {
  return (
    <section className="agent-chat-shell__start-surface" aria-label="New Thread Start">
      <h1>{`What should we build in ${startSurfaceTarget(viewModel)}?`}</h1>
      {/* The chip dropdown is rendered as an anchored popover by AgentChatShell, not
          here in flow — so it no longer pushes the composer down. */}
      {createComposer(viewModel, handlers)}
    </section>
  );
}

function startSurfaceTarget(viewModel: AgentChatShellViewModel): string {
  const item = viewModel.composer.contextItems.find(
    (contextItem) => contextItem.label === "Project" || contextItem.label === "Scratch",
  );

  return item?.value || "Tide";
}

export function createDescription(
  term: string,
  value: ReactNode,
  key?: string,
): ReactElement {
  return (
    <div key={key} className="description-pair">
      <dt>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}
