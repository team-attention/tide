import type {
  BackendCommandPayloadByKind,
  BackendEventEnvelope,
  JsonObject,
} from "../../../../../shared/contracts/index.ts";
import {
  applyAgentChatBackendEvent,
  type AgentChatBackendCommand,
  type AgentChatShellState,
} from "../../../../application/domains/agent-chat/agent-chat.ts";

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
} | {
  kind: "provider.opencodeConnectApiKey";
  payload: BackendCommandPayloadByKind["provider.opencodeConnectApiKey"];
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
    case "workbench.command": {
      const dataPayload: JsonObject = {
        blockerKind: command.payload.data.blockerKind,
        command: command.payload.data.command,
        args: [...command.payload.data.args],
        cwd: command.payload.data.cwd,
      };
      if (command.payload.data.terminalRole !== undefined) {
        dataPayload.terminalRole = command.payload.data.terminalRole;
      }
      if (command.payload.data.expectedCompletion !== undefined) {
        dataPayload.expectedCompletion = command.payload.data.expectedCompletion;
      }
      if (command.payload.data.env !== undefined) {
        dataPayload.env = { ...command.payload.data.env };
      }
      return {
        kind: "workbench.command",
        payload: {
          threadId: command.payload.threadId,
          command: command.payload.command,
          data: dataPayload,
        },
      };
    }
    case "provider.opencodeConnectApiKey":
      return {
        kind: "provider.opencodeConnectApiKey",
        payload: command.payload,
      };
  }
}
