import type { AgentChatShellViewModel } from "../../../../application/domains/agent-chat/agent-chat-shell-state.ts";
import { createElement } from "react";
import type { ReactElement } from "react";
import { createDescription } from "./start-surface.ts";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

export function createThreadHeader(viewModel: AgentChatShellViewModel): ReactElement {
  const isFirstLaunch = viewModel.thread === null;

  return createElement(
    "header",
    {
      className: "agent-chat-shell__thread",
      "aria-label": "Thread",
      "data-thread-mode": isFirstLaunch ? "start" : "active",
    },
    createElement(
      "span",
      { className: "agent-chat-shell__eyebrow" },
      isFirstLaunch ? "Codex-style local agent workbench" : "Active Thread",
    ),
    createElement("h1", null, viewModel.thread?.title ?? "What should Tide work on?"),
    createElement(
      "dl",
      { className: "agent-chat-shell__state" },
      createDescription("Runtime", viewModel.runtimeState),
      createDescription("Chat", viewModel.chatState),
      viewModel.thread ? createDescription("Agent", viewModel.thread.agentLabel) : null,
    ),
    viewModel.errorMessage
      ? createElement("p", { role: "alert" }, viewModel.errorMessage)
      : null,
  );
}
