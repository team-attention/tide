import { createElement, type ReactElement, type ReactNode } from "react";

import type {
  AgentChatBlockView,
  AgentChatContextItem,
  AgentChatShellViewModel,
} from "../../../application/domains/agent-chat/agent-chat-shell-state.ts";

export interface AgentChatShellProps {
  viewModel: AgentChatShellViewModel;
}

export function AgentChatShell(props: AgentChatShellProps): ReactElement {
  const viewModel = props.viewModel;

  return createElement(
    "main",
    {
      className: "agent-chat-shell",
      "data-chat-state": viewModel.chatState,
      "data-runtime-state": viewModel.runtimeState,
    },
    createThreadHeader(viewModel),
    createProviderReadiness(viewModel),
    createAgentSession(viewModel.blocks),
    createComposer(viewModel),
  );
}

function createThreadHeader(viewModel: AgentChatShellViewModel): ReactElement {
  return createElement(
    "header",
    {
      className: "agent-chat-shell__thread",
      "aria-label": "Thread",
    },
    createElement("h1", null, viewModel.thread?.title ?? "New Thread"),
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

function createProviderReadiness(
  viewModel: AgentChatShellViewModel,
): ReactElement | null {
  if (viewModel.providerReadinessBlockers.length === 0) {
    return null;
  }

  return createElement(
    "section",
    {
      className: "agent-chat-shell__provider-readiness",
      "aria-label": "Provider Readiness",
    },
    createElement("h2", null, "Provider setup required"),
    viewModel.providerReadinessBlockers.map((blocker) =>
      createElement(
        "p",
        { key: `${blocker.kind}:${blocker.message}` },
        blocker.message,
      ),
    ),
  );
}

function createAgentSession(blocks: AgentChatBlockView[]): ReactElement {
  return createElement(
    "section",
    {
      className: "agent-session",
      "aria-label": "Agent Session",
    },
    blocks.length === 0
      ? createElement("p", { className: "agent-session__empty" }, "No Agent Session Blocks yet.")
      : blocks.map(createAgentSessionBlock),
  );
}

function createAgentSessionBlock(block: AgentChatBlockView): ReactElement {
  return createElement(
    "article",
    {
      key: block.blockId,
      className: "agent-session-block",
      "data-block-id": block.blockId,
      "data-block-kind": block.kind,
      "data-block-status": block.status,
    },
    createElement(
      "header",
      { className: "agent-session-block__header" },
      createElement("span", null, block.title),
      createElement("span", null, block.status),
    ),
    createElement("p", { className: "agent-session-block__body" }, block.body),
    block.rawFallback && block.rawFallback !== block.body
      ? createElement("pre", null, block.rawFallback)
      : null,
  );
}

function createComposer(viewModel: AgentChatShellViewModel): ReactElement {
  return createElement(
    "form",
    {
      className: "composer-shell",
      "aria-label": "Composer",
      "data-composer-mode": viewModel.composer.mode,
    },
    createElement(
      "dl",
      { className: "composer-shell__context" },
      viewModel.composer.contextItems.map(createContextItem),
    ),
    viewModel.prompt
      ? createElement(
          "section",
          {
            className: "composer-shell__prompt",
            "aria-label": "Prompt State",
          },
          createElement("h2", null, "Prompt State"),
          createElement("p", null, viewModel.prompt.message),
          createPromptChoices(viewModel.prompt.choices ?? []),
        )
      : null,
    createElement("textarea", {
      "aria-label": "Composer draft",
      className: "composer-shell__input",
      defaultValue: viewModel.composer.draft,
    }),
    createElement("button", { type: "submit" }, viewModel.composer.submitLabel),
  );
}

function createPromptChoices(
  choices: { choiceId: string; label: string; providerValue: string }[],
): ReactElement | null {
  if (choices.length === 0) {
    return null;
  }

  return createElement(
    "ul",
    { className: "composer-shell__choices" },
    choices.map((choice) =>
      createElement(
        "li",
        { key: choice.choiceId, "data-provider-value": choice.providerValue },
        choice.label,
      ),
    ),
  );
}

function createContextItem(item: AgentChatContextItem): ReactElement {
  return createDescription(item.label, item.value, `${item.label}:${item.value}`);
}

function createDescription(
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
