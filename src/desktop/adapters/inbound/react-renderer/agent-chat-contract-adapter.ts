import type {
  BackendCommandPayloadByKind,
  BackendEventEnvelope,
} from "../../../../shared/contracts/index.ts";
import {
  applyAgentChatBackendEvent,
  type AgentChatBackendCommand,
  type AgentChatShellState,
} from "../../../application/domains/agent-chat/agent-chat-shell-state.ts";

export type AgentChatBackendCommandDraft = {
  kind: "thread.start";
  payload: BackendCommandPayloadByKind["thread.start"];
} | {
  kind: "composer.sendInput";
  payload: BackendCommandPayloadByKind["composer.sendInput"];
} | {
  kind: "prompt.answer";
  payload: BackendCommandPayloadByKind["prompt.answer"];
};

export function applyBackendEventToAgentChatShell(
  state: AgentChatShellState,
  event: BackendEventEnvelope,
): AgentChatShellState {
  return applyAgentChatBackendEvent(state, {
    kind: event.kind,
    payload: event.payload as Record<string, unknown>,
  });
}

export function toBackendCommandDraft(
  command: AgentChatBackendCommand,
): AgentChatBackendCommandDraft {
  switch (command.kind) {
    case "thread.start":
      return {
        kind: "thread.start",
        payload: command.payload,
      };
    case "composer.sendInput":
      return {
        kind: "composer.sendInput",
        payload: command.payload,
      };
    case "prompt.answer":
      return {
        kind: "prompt.answer",
        payload: command.payload,
      };
  }
}
