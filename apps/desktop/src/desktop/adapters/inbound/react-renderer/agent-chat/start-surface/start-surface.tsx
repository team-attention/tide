import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ComposerHandlers } from "../support/types.ts";
import type { ReactElement, ReactNode } from "react";
import { styled } from "styled-components";
import { createComposer } from "../composer/composer.tsx";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

export function createNewThreadStartSurface(
  viewModel: AgentChatShellViewModel,
  handlers: ComposerHandlers,
): ReactElement {
  return (
    <NewThreadStartSurface data-chat-start-surface="true" aria-label="New Thread Start">
      <h1>{`What should we build in ${startSurfaceTarget(viewModel)}?`}</h1>
      {/* The chip dropdown is rendered as an anchored popover by AgentChatShell, not
          here in flow — so it no longer pushes the composer down. */}
      {createComposer(viewModel, handlers)}
    </NewThreadStartSurface>
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
    <DescriptionPair key={key}>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </DescriptionPair>
  );
}

const NewThreadStartSurface = styled.section`
  width: min(760px, calc(100% - 32px));
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 28px;

  h1 {
    margin: 0;
    color: var(--tide-text);
    font-size: 28px;
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: 0;
    text-align: center;
  }
`;

const DescriptionPair = styled.div`
  flex: 0 1 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--tide-selection);
  color: var(--tide-muted);
  font-size: 12px;

  dd {
    margin: 0;
    color: var(--tide-text);
    font-weight: 580;
  }
`;
