import type {
  BackendCommandPayloadByKind,
  BackendEventEnvelope,
  JsonObject,
} from "../../../../../shared/contracts/index.ts";
import {
  applyAgentChatBackendEvent,
  type AgentChatBackendCommand,
  type AgentChatShellState,
} from "../../../../application/domains/agent-chat/agent-chat-shell-state.ts";

export type AgentChatBackendCommandDraft = {
  kind: "thread.start";
  payload: BackendCommandPayloadByKind["thread.start"];
} | {
  kind: "composer.sendInput";
  payload: BackendCommandPayloadByKind["composer.sendInput"];
} | {
  kind: "composer.editQueuedInput";
  payload: BackendCommandPayloadByKind["composer.editQueuedInput"];
} | {
  kind: "thread.setLaunchOptions";
  payload: BackendCommandPayloadByKind["thread.setLaunchOptions"];
} | {
  kind: "agentRuntime.stop";
  payload: BackendCommandPayloadByKind["agentRuntime.stop"];
} | {
  kind: "provider.trustWorkspace";
  payload: BackendCommandPayloadByKind["provider.trustWorkspace"];
} | {
  kind: "prompt.answer";
  payload: BackendCommandPayloadByKind["prompt.answer"];
} | {
  kind: "workbench.command";
  payload: BackendCommandPayloadByKind["workbench.command"];
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
        payload: command.payload as BackendCommandPayloadByKind["thread.start"],
      };
    case "composer.sendInput":
      return {
        kind: "composer.sendInput",
        payload: command.payload as BackendCommandPayloadByKind["composer.sendInput"],
      };
    case "composer.editQueuedInput":
      return {
        kind: "composer.editQueuedInput",
        payload: command.payload,
      };
    case "thread.setLaunchOptions":
      return {
        kind: "thread.setLaunchOptions",
        payload: command.payload as BackendCommandPayloadByKind["thread.setLaunchOptions"],
      };
    case "agentRuntime.stop":
      return {
        kind: "agentRuntime.stop",
        payload: command.payload,
      };
    case "provider.trustWorkspace":
      return {
        kind: "provider.trustWorkspace",
        payload: command.payload,
      };
    case "prompt.answer":
      return {
        kind: "prompt.answer",
        payload: command.payload,
      };
    case "workbench.command":
      const setup = command.payload.data.setup;
      const setupPayload: JsonObject = {
        command: setup.command,
        args: [...setup.args],
        cwd: setup.cwd,
        expectedCompletion: setup.expectedCompletion,
      };
      if (setup.env !== undefined) {
        setupPayload.env = cloneStringRecord(setup.env);
      }
      return {
        kind: "workbench.command",
        payload: {
          threadId: command.payload.threadId,
          command: command.payload.command,
          data: {
            blockerKind: command.payload.data.blockerKind,
            setup: setupPayload,
          },
        },
      };
  }
}

function cloneStringRecord(
  value: Record<string, string>,
): JsonObject {
  const clone: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    clone[key] = entry;
  }
  return clone;
}
