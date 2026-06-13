import type { AgentBindingDto } from "./agent.ts";
import type { WorkspaceCodeIntelKindDto } from "./code-intel.ts";
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
  | "thread.setLaunchOptions"
  | "agentRuntime.resume"
  | "composer.sendInput"
  | "composer.editQueuedInput"
  | "prompt.answer"
  | "agentRuntime.stop"
  | "provider.trustWorkspace"
  | "workbench.command"
  | "workspace.readFileTree"
  | "workspace.searchContent"
  | "workspace.codeIntel"
  | "workspace.readFile"
  | "workspace.writeFile";

export const BACKEND_COMMAND_KINDS: BackendCommandKind[] = [
  "thread.list",
  "thread.hydrate",
  "thread.start",
  "thread.archive",
  "thread.setPinned",
  "thread.rename",
  "thread.setLaunchOptions",
  "agentRuntime.resume",
  "composer.sendInput",
  "composer.editQueuedInput",
  "prompt.answer",
  "agentRuntime.stop",
  "provider.trustWorkspace",
  "workbench.command",
  "workspace.readFileTree",
  "workspace.searchContent",
  "workspace.codeIntel",
  "workspace.readFile",
  "workspace.writeFile",
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
  // Update an active Thread's Launch Options (model/permission/reasoning). The
  // backend persists the merged options and applies them to the live Agent
  // Runtime (protocol-native update, or a deferred restart at the next turn).
  // See docs_v2/specs/mid-thread-launch-option-changes.md.
  "thread.setLaunchOptions": { threadId: ThreadId; launchOptions: JsonObject };
  "agentRuntime.resume": { threadId: ThreadId };
  "composer.sendInput": {
    threadId: ThreadId;
    input: string;
    launchOptions?: JsonObject;
    attachments?: ComposerAttachment[];
  };
  // Edit the queued (not-yet-sent) Composer message in place. A blank value
  // discards the queued input. `index` selects which queued message (0 = the
  // head/next to run; omitted = 0). See docs_v2/specs/composer-message-edit.md.
  "composer.editQueuedInput": {
    threadId: ThreadId;
    value: string;
    index?: number;
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
    // Lazy listing: descend only into these expanded folders. Absent => full walk.
    expandedPaths?: string[];
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
  // Read one text file under `cwd`, NOT tied to a thread — the start (New
  // Thread) page's file viewer (spec: start-page-file-viewer). Answered by a
  // workspace.fileLoaded event.
  "workspace.readFile": {
    cwd: string;
    path: string;
    byteLimit?: number;
  };
  // Write one text file under `cwd`, NOT tied to a thread — the start (New
  // Thread) page's editor save (spec: start-page-file-viewer). The thread-bound
  // editor uses workbench.command/save_editor_file instead. Answered by a
  // workspace.fileSaved event.
  "workspace.writeFile": {
    cwd: string;
    path: string;
    content: string;
    byteLimit?: number;
  };
  // Editor language-intelligence query (completion/hover/highlights/signature/
  // diagnostics) for one file under `cwd`. `content` carries the live (possibly
  // unsaved) buffer so results match what the user sees. Answered by a
  // workspace.codeIntelResult event with the same requestId — never stored in
  // Workbench state. Spec: workbench-editor-language-intelligence.
  "workspace.codeIntel": {
    cwd: string;
    path: string;
    kind: WorkspaceCodeIntelKindDto;
    content?: string;
    line?: number;
    character?: number;
  };
}
