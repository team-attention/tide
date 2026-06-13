import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ReactElement } from "react";
import { createDescription } from "../start-surface/start-surface.tsx";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

export function createThreadHeader(viewModel: AgentChatShellViewModel): ReactElement {
  const isFirstLaunch = viewModel.thread === null;

  return (
    <header
      className="agent-chat-shell__thread"
      aria-label="Thread"
      data-thread-mode={isFirstLaunch ? "start" : "active"}
    >
      <span className="agent-chat-shell__eyebrow">
        {isFirstLaunch ? "Codex-style local agent workbench" : "Active Thread"}
      </span>
      <h1>{viewModel.thread?.title ?? "What should Tide work on?"}</h1>
      <dl className="agent-chat-shell__state">
        {createDescription("Runtime", viewModel.runtimeState)}
        {createDescription("Chat", viewModel.chatState)}
        {viewModel.thread ? createDescription("Agent", viewModel.thread.agentLabel) : null}
      </dl>
      {viewModel.errorMessage ? <p role="alert">{viewModel.errorMessage}</p> : null}
    </header>
  );
}
