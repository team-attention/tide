import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ReactElement } from "react";
import { styled } from "styled-components";
import { createDescription } from "../start-surface/start-surface.tsx";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

export function createThreadHeader(viewModel: AgentChatShellViewModel): ReactElement {
  const isFirstLaunch = viewModel.thread === null;

  return (
    <ThreadHeaderFrame
      aria-label="Thread"
      data-thread-mode={isFirstLaunch ? "start" : "active"}
      data-thread-header="true"
    >
      <ThreadEyebrow>
        {isFirstLaunch ? "Codex-style local agent workbench" : "Active Thread"}
      </ThreadEyebrow>
      <h1>{viewModel.thread?.title ?? "What should Tide work on?"}</h1>
      <ThreadStateList>
        {createDescription("Runtime", viewModel.runtimeState)}
        {createDescription("Chat", viewModel.chatState)}
        {viewModel.thread ? createDescription("Agent", viewModel.thread.agentLabel) : null}
      </ThreadStateList>
      {viewModel.errorMessage ? <p role="alert">{viewModel.errorMessage}</p> : null}
    </ThreadHeaderFrame>
  );
}

const ThreadHeaderFrame = styled.header`
  display: grid;
  gap: 8px;

  h1 {
    max-width: 760px;
    margin: 0;
    color: var(--tide-text);
    font-size: 28px;
    font-weight: 650;
    line-height: 1.12;
  }
`;

const ThreadEyebrow = styled.span`
  color: var(--tide-muted);
  font-size: 12px;
  font-weight: 520;
`;

const ThreadStateList = styled.dl`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  margin: 0;
`;
