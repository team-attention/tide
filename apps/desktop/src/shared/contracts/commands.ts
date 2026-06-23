import type { AgentBindingDto } from "./agent.ts";
import type { WorkspaceCodeIntelKindDto } from "./code-intel.ts";
import type { ThreadId, WorkbenchPaneId } from "./ids.ts";
import type { PromptStepAnswerDto } from "./prompt.ts";
import type { JsonObject } from "./json.ts";
import type { ThreadScopeDto } from "./thread.ts";

export type BackendCommandKind =
  | "thread.list"
  | "thread.hydrate"
  | "thread.createDraft"
  | "thread.discardDraft"
  | "thread.start"
  | "thread.archive"
  | "thread.setPinned"
  | "thread.rename"
  | "thread.setGoal"
  | "thread.setLaunchOptions"
  | "agentRuntime.resume"
  | "composer.sendInput"
  | "composer.editQueuedInput"
  | "prompt.answer"
  | "agentRuntime.stop"
  | "provider.trustWorkspace"
  | "provider.opencodeConnectApiKey"
  | "provider.discoverCommands"
  | "provider.checkReadiness"
  | "workbench.command"
  | "workspace.readFileTree"
  | "workspace.searchContent"
  | "workspace.codeIntel"
  | "workspace.readFile"
  | "workspace.readImageFile"
  | "workspace.writeFile";

export const BACKEND_COMMAND_KINDS: BackendCommandKind[] = [
  "thread.list",
  "thread.hydrate",
  "thread.createDraft",
  "thread.discardDraft",
  "thread.start",
  "thread.archive",
  "thread.setPinned",
  "thread.rename",
  "thread.setGoal",
  "thread.setLaunchOptions",
  "agentRuntime.resume",
  "composer.sendInput",
  "composer.editQueuedInput",
  "prompt.answer",
  "agentRuntime.stop",
  "provider.trustWorkspace",
  "provider.opencodeConnectApiKey",
  "provider.discoverCommands",
  "provider.checkReadiness",
  "workbench.command",
  "workspace.readFileTree",
  "workspace.searchContent",
  "workspace.codeIntel",
  "workspace.readFile",
  "workspace.readImageFile",
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
  // Create a Draft Thread for the Composer (New Thread): a real backend thread with full
  // context + a live Workbench but NO agent runtime, so Browser/Editor/Terminal/Diff work
  // pre-send via workbench.command. threadId is client-generated so the renderer binds its
  // Composer to it immediately. Send later calls thread.start with the same id (starts it
  // in place). See docs_v2/specs/composer-draft-thread.md.
  "thread.createDraft": {
    threadId: ThreadId;
    agentBinding: AgentBindingDto;
    scope?: ThreadScopeDto;
    launchOptions?: JsonObject;
  };
  // Discard a never-sent Draft Thread (chip change / leaving the Composer): tears down its
  // Workbench (kills visible-terminal PTYs) and removes it.
  "thread.discardDraft": { threadId: ThreadId };
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
  // Set (or clear, with an empty string) the user's thread goal. Persisted as
  // Tide metadata and pushed to the provider's native goal mechanism where one
  // exists. Answered by a thread.goalSet event. See
  // docs_v2/specs/thread-goal-and-checklist-panel.md.
  "thread.setGoal": { threadId: ThreadId; goal: string };
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
    // Free-text note attached to a single-question AskUserQuestion answer (→ claude
    // annotations). Wizard notes ride inside each PromptStepAnswerDto instead.
    notes?: string;
    // A multi-step prompt (wizard) submits one answer per step here, replacing the
    // single `value`/`choiceId`. Absent for ordinary single prompts.
    stepAnswers?: PromptStepAnswerDto[];
  };
  "agentRuntime.stop": { threadId: ThreadId };
  "provider.trustWorkspace": { threadId: ThreadId };
  // Set an opencode vendor's API-key credential the canonical way: the backend PUTs
  // { type:"api", key } to opencode's own server (`opencode serve` → /auth/{id}),
  // identical to `opencode auth login` but non-interactive. Refreshes the catalog so
  // the vendor's models appear. See opencode-vendor-onramp.md.
  "provider.opencodeConnectApiKey": { vendorId: string; key: string };
  // Discover an agent's REAL command set (the list the provider CLI itself
  // exposes) for the composer's / and $ menu, by probing a handshake-only
  // runtime. The backend replies with an agentRuntime.commandsChanged event.
  // See docs_v2/specs/live-provider-command-mirroring.md.
  "provider.discoverCommands": { agentId: string; cwd: string };
  // Run Provider Readiness for an agent on demand (Composer slot select) so the
  // install/sign-in card surfaces immediately. Backend replies providerReadiness.changed.
  // See docs_v2/specs/provider-cli-setup-handoff.md.
  "provider.checkReadiness": { threadId: ThreadId; agentId: string };
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
  // Legacy thread-independent text read under `cwd`. Product Shell editors now
  // open through workbench.command/open_editor on a thread Workbench. Answered by
  // a workspace.fileLoaded event.
  "workspace.readFile": {
    cwd: string;
    path: string;
    byteLimit?: number;
    // Legacy New File path: when true and the file is missing, create an empty
    // file (and parent dirs) first, then read it. Thread Workbench new-file now
    // uses open_editor { create: true }.
    create?: boolean;
  };
  // Read one image file under `cwd` as bounded base64, for Workbench Image Pane
  // display. Answered by a workspace.imageLoaded event with the same requestId.
  "workspace.readImageFile": {
    cwd: string;
    path: string;
    byteLimit?: number;
  };
  // Legacy thread-independent text write under `cwd`. Product Shell editors now
  // save through workbench.command/save_editor_file. Answered by a workspace.fileSaved
  // event.
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
