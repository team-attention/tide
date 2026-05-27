import type { AgentBindingDto } from "./agent.ts";
import type { ThreadId, WorkbenchPaneId } from "./ids.ts";
import type { JsonObject } from "./json.ts";
import type { ThreadScopeDto } from "./thread.ts";

export type BackendCommandKind =
  | "thread.hydrate"
  | "thread.start"
  | "agentRuntime.resume"
  | "composer.sendInput"
  | "prompt.answer"
  | "agentRuntime.stop"
  | "workbench.command";

export const BACKEND_COMMAND_KINDS: BackendCommandKind[] = [
  "thread.hydrate",
  "thread.start",
  "agentRuntime.resume",
  "composer.sendInput",
  "prompt.answer",
  "agentRuntime.stop",
  "workbench.command",
];

export interface BackendCommandPayloadByKind {
  "thread.hydrate": { threadId: ThreadId };
  "thread.start": {
    initialMessage: string;
    agentBinding: AgentBindingDto;
    scope?: ThreadScopeDto;
    launchOptions?: JsonObject;
  };
  "agentRuntime.resume": { threadId: ThreadId };
  "composer.sendInput": { threadId: ThreadId; input: string };
  "prompt.answer": {
    promptId: string;
    threadId: ThreadId;
    choiceId?: string;
    value?: string;
  };
  "agentRuntime.stop": { threadId: ThreadId };
  "workbench.command": {
    threadId: ThreadId;
    command: string;
    targetPaneId?: WorkbenchPaneId;
    data?: JsonObject;
  };
}
