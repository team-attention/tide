import type { AgentChatShellViewModel } from "../../../../application/domains/agent-chat/agent-chat-shell-state.ts";
import type { ComposerHandlers } from "./types.ts";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { createComposer } from "./composer/composer.ts";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

export function createNewThreadStartSurface(
  viewModel: AgentChatShellViewModel,
  handlers: ComposerHandlers,
): ReactElement {
  return createElement(
    "section",
    {
      className: "agent-chat-shell__start-surface",
      "aria-label": "New Thread Start",
    },
    createElement("h1", null, `What should we build in ${startSurfaceTarget(viewModel)}?`),
    // The chip dropdown is rendered as an anchored popover by AgentChatShell, not
    // here in flow — so it no longer pushes the composer down.
    createComposer(viewModel, handlers),
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
  return createElement(
    "div",
    { key, className: "description-pair" },
    createElement("dt", null, term),
    createElement("dd", null, value),
  );
}
