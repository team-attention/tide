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
  | "composer.editQueuedInput"
  | "prompt.answer"
  | "agentRuntime.stop"
  | "provider.trustWorkspace"
  | "workbench.command"
  | "workspace.readFileTree"
  | "workspace.searchContent";

export const BACKEND_COMMAND_KINDS: BackendCommandKind[] = [
  "thread.list",
  "thread.hydrate",
  "thread.start",
  "thread.archive",
  "thread.setPinned",
  "thread.rename",
  "agentRuntime.resume",
  "composer.sendInput",
  "composer.editQueuedInput",
  "prompt.answer",
  "agentRuntime.stop",
  "provider.trustWorkspace",
  "workbench.command",
  "workspace.readFileTree",
  "workspace.searchContent",
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
    // Client-generated id so the new thread can be shown optimistically and the
    // backend binds to the same thread (startThread honors input.threadId).
    threadId?: ThreadId;
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
  // Edit the queued (not-yet-sent) Composer message in place. A blank value
  // discards the queued input. See docs_v2/specs/composer-message-edit.md.
  "composer.editQueuedInput": {
    threadId: ThreadId;
    value: string;
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
  // Read a file tree for an arbitrary directory, NOT tied to a thread — used by the
  // start (New Thread) page to show the composer-selected project's files.
  "workspace.readFileTree": {
    cwd: string;
    maxDepth?: number;
    maxEntries?: number;
  };
  // Project-wide content search under `cwd` (the active thread root), for the
  // Cmd+Shift+F finder. Plain-text, case-insensitive.
  "workspace.searchContent": {
    cwd: string;
    query: string;
    maxResults?: number;
    maxFiles?: number;
  };
}
