import type { AgentBindingDto } from "./agent.ts";
import type { ThreadId, WorkbenchPaneId } from "./ids.ts";
import type { JsonObject } from "./json.ts";
import type { ThreadScopeDto } from "./thread.ts";

export type BackendCommandKind =
  | "thread.list"
  | "thread.hydrate"
  | "thread.start"
  | "thread.archive"
  | "thread.setPinned"
  | "thread.rename"
  | "agentRuntime.resume"
  | "composer.sendInput"
  | "prompt.answer"
  | "agentRuntime.stop"
  | "provider.trustWorkspace"
  | "workbench.command";

export const BACKEND_COMMAND_KINDS: BackendCommandKind[] = [
  "thread.list",
  "thread.hydrate",
  "thread.start",
  "thread.archive",
  "thread.setPinned",
  "thread.rename",
  "agentRuntime.resume",
  "composer.sendInput",
  "prompt.answer",
  "agentRuntime.stop",
  "provider.trustWorkspace",
  "workbench.command",
];

/**
 * An image the user attached to the next Composer message (paste). Backend
 * materializes it to a file in the Thread workspace and references its path in
 * the message text so the Agent can read it. See
 * docs_v2/specs/composer-image-attachments.md.
 */
export interface ComposerAttachment {
  name: string;
  mediaType: string;
  dataBase64: string;
}

export interface BackendCommandPayloadByKind {
  "thread.list": { includeArchived?: boolean };
  "thread.hydrate": { threadId: ThreadId };
  "thread.start": {
    initialMessage: string;
    agentBinding: AgentBindingDto;
    scope?: ThreadScopeDto;
    launchOptions?: JsonObject;
    attachments?: ComposerAttachment[];
  };
  "thread.archive": { threadId: ThreadId; archived: boolean };
  "thread.setPinned": { threadId: ThreadId; pinned: boolean };
  "thread.rename": { threadId: ThreadId; title: string };
  "agentRuntime.resume": { threadId: ThreadId };
  "composer.sendInput": {
    threadId: ThreadId;
    input: string;
    launchOptions?: JsonObject;
    attachments?: ComposerAttachment[];
  };
  "prompt.answer": {
    promptId: string;
    threadId: ThreadId;
    choiceId?: string;
    value?: string;
  };
  "agentRuntime.stop": { threadId: ThreadId };
  "provider.trustWorkspace": { threadId: ThreadId };
  "workbench.command": {
    threadId: ThreadId;
    command: string;
    targetPaneId?: WorkbenchPaneId;
    data?: JsonObject;
  };
}
