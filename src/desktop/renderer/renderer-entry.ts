import { createElement } from "react";

import {
  createAgentChatShellState,
  createAgentChatShellViewModel,
} from "../application/domains/agent-chat/agent-chat-shell-state.ts";
import { AgentChatShell } from "../adapters/inbound/react-renderer/agent-chat-shell.ts";

export function createInitialRendererElement() {
  return createElement(AgentChatShell, {
    viewModel: createAgentChatShellViewModel(createAgentChatShellState()),
  });
}
