// Extracted from agent-chat-shell-state.ts (spec: navigable-source-structure).

export type AgentChatState =
  | "empty"
  | "hydrating"
  | "ready"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "provider_not_ready"
  | "failed";

export type AgentRuntimeStateName =
  | "not_started"
  | "starting"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "idle"
  | "stopping"
  | "stopped"
  | "failed";

// A real project the composer can scope a new Thread to (sourced from the
// product shell's known projects — never hardcoded).
export interface AgentChatProjectOption {
  projectId: string;
  name: string;
  cwd: string;
}

export interface AgentChatBranchOption {
  name: string;
  kind: "local" | "remote";
  current: boolean;
}

export interface AgentChatWorktreeOption {
  path: string;
  branch: string | null;
  current: boolean;
}

export interface AgentChatCommandOption {
  name: string;
  description: string;
  trigger: "/" | "$";
}

export interface AgentChatShellState {
  thread: AgentChatThreadSummary | null;
  runtimeState: AgentRuntimeStateName;
  // True from the optimistic open of a thread until its real hydrate returns from the
  // backend. Drives the loading skeleton — cleared on hydrate even if the thread has
  // zero blocks (a genuinely empty thread shows empty, not a skeleton forever).
  hydrating: boolean;
  providerReadiness: AgentChatProviderReadiness | null;
  // True between dispatching a Provider Readiness action (e.g. "Trust this folder")
  // and the resulting providerReadiness.changed — so the UI can show it is working.
  providerReadinessActionPending: boolean;
  promptState: AgentChatPromptState | null;
  blocks: AgentChatBlock[];
  composer: AgentChatComposerState;
  workbenchOpen: boolean;
  // Projects the Project menu lists, injected by the product shell from its real
  // project set. Empty until provided (then the menu shows only the current scope).
  availableProjects?: AgentChatProjectOption[];
  // Real git branches/worktrees for the active Project cwd, injected by the
  // product shell. Empty for Scratch / non-git scopes (menus fall back).
  availableBranches?: AgentChatBranchOption[];
  availableWorktrees?: AgentChatWorktreeOption[];
  // Real provider slash-commands/skills for the active cwd+agent, injected by
  // the product shell (discovered from provider files). Empty until provided.
  availableCommands?: AgentChatCommandOption[];
  // Composer inputs submitted during a live turn: held (queued) FIFO and shown as
  // a stack of "queued" rows until the turn ends and the backend flushes the head
  // as a real block (then the next runs). Empty when nothing is queued.
  queuedInputs: string[];
  // Last-known context/token usage for this thread's runtime (from the provider
  // transcript). Drives the quiet usage chip in the thread header.
  usage: AgentChatUsage | null;
  errorMessage?: string;
}

export interface AgentChatUsage {
  totalTokens?: number;
  contextWindow?: number;
  contextUsedPercent?: number;
  model?: string;
}

export interface AgentChatComposerState {
  draft: string;
  activeSurface: AgentChatComposerSurfaceKind | null;
  startOptions: AgentChatStartOptions;
  // Images pasted into the Composer, shown as preview chips and sent with the
  // next message. See docs_v2/specs/composer-image-attachments.md.
  attachments: AgentChatComposerAttachment[];
  // Content references attached from the Workbench/session (a code selection,
  // terminal output, a browser snapshot, a quoted message), shown as removable
  // chips and prepended to the next message as context.
  contextChips: AgentChatContextChip[];
}

export interface AgentChatComposerAttachment {
  id: string;
  name: string;
  mediaType: string;
  dataBase64: string;
}

export type AgentChatContextChipKind = "code" | "terminal" | "browser" | "message";

export interface AgentChatContextChip {
  id: string;
  kind: AgentChatContextChipKind;
  label: string;
  text: string;
  // An optional note the user attaches specifically to this region/selection,
  // distinct from the general message.
  comment?: string;
}

// The wire shape carried in a BackendCommand (no renderer-only `id`). Matches the
// contract ComposerAttachment so the contract adapter can cast it through.
export interface AgentChatComposerMessageAttachment {
  name: string;
  mediaType: string;
  dataBase64: string;
}

export interface AgentChatStartOptions {
  agentBinding: AgentChatAgentBinding;
  scope?: AgentChatThreadScope;
  launchOptions?: Record<string, unknown>;
}

export interface AgentChatAgentBinding {
  agentId: string;
  runtimeSource?: AgentChatAgentRuntimeSource;
  providerSessionRef?: {
    kind: string;
    value: string;
    transcriptPath?: string;
    logPath?: string;
  };
}

export type AgentChatProviderCliAgentId = "codex" | "claude" | "gemini" | "opencode";

export type AgentChatAgentId = AgentChatProviderCliAgentId | "openai_api";

export type AgentChatAgentRuntimeSource =
  | {
      kind: "provider_cli";
      integrationId: AgentChatProviderCliAgentId;
    }
  | {
      kind: "tide_api";
      provider: "openai";
      accountId?: string;
    };

export type AgentChatComposerSurfaceKind =
  | "agent_menu"
  | "model_menu"
  | "permission_menu"
  | "project_menu"
  | "worktree_menu"
  | "branch_menu"
  | "composer_options"
  | "command_suggestions";

export interface AgentChatThreadSummary {
  threadId: string;
  title: string;
  agentBinding: AgentChatAgentBinding;
  scope: AgentChatThreadScope;
  launchOptions?: Record<string, unknown>;
  context?: AgentChatThreadContext;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  lastKnownState: string;
  // When the current turn started running (from the backend). The Working
  // indicator shows elapsed since this, so reopening a running thread keeps the
  // real time instead of resetting to 0.
  runtimeStartedAt?: string;
  // The backend's authoritative follow-up queue (head-first) at hydrate time.
  queuedInputs?: string[];
}

export type AgentChatThreadScope =
  | { kind: "project"; projectId: string; cwd: string }
  | { kind: "scratch"; scratchCwd: string };

export interface AgentChatThreadContext {
  worktree?: string;
  branch?: string;
}

export interface AgentChatPromptState {
  promptId: string;
  threadId: string;
  agentId: string;
  kind: "question" | "approval" | "permission" | "choice" | "command_picker";
  message: string;
  choices?: AgentChatPromptChoice[];
  defaultChoiceId?: string;
  source: "pty" | "provider_signal" | "provider_hook";
}

export interface AgentChatPromptChoice {
  choiceId: string;
  label: string;
  providerValue: string;
}

export interface AgentChatProviderReadiness {
  agentId: string;
  ready: boolean;
  blockers: AgentChatProviderReadinessBlocker[];
}

export interface AgentChatProviderReadinessBlocker {
  kind: string;
  message: string;
  scope?: string;
  action?: string;
  setup?: AgentChatProviderSetupSurfaceAction;
}

export interface AgentChatProviderSetupSurfaceAction {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd: string;
  expectedCompletion: "process_exit" | "retry_preflight";
}

export interface AgentChatBlock {
  blockId: string;
  threadId: string;
  agentId?: string;
  kind: string;
  role?: "user" | "agent" | "reasoning" | "tool" | "system" | "runtime";
  sourceFrameIds?: string[];
  status: "pending" | "streaming" | "complete" | "failed" | "needs_input";
  title?: string;
  body?: string;
  rawFallback?: string;
  updatedAt: string;
}

export type AgentChatBackendCommand =
  | {
      kind: "thread.start";
      payload: {
        threadId?: string;
        initialMessage: string;
        agentBinding: AgentChatAgentBinding;
        scope?: AgentChatThreadScope;
        launchOptions?: Record<string, unknown>;
        attachments?: AgentChatComposerMessageAttachment[];
      };
    }
  | {
      kind: "composer.sendInput";
      payload: {
        threadId: string;
        input: string;
        launchOptions?: Record<string, unknown>;
        attachments?: AgentChatComposerMessageAttachment[];
      };
    }
  | {
      kind: "composer.editQueuedInput";
      payload: { threadId: string; value: string; index?: number };
    }
  | {
      kind: "thread.setLaunchOptions";
      payload: { threadId: string; launchOptions: Record<string, unknown> };
    }
  | {
      kind: "agentRuntime.stop";
      payload: { threadId: string };
    }
  | {
      kind: "provider.trustWorkspace";
      payload: { threadId: string };
    }
  | {
      kind: "prompt.answer";
      payload: {
        threadId: string;
        promptId: string;
        choiceId?: string;
        value?: string;
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "open_provider_setup_surface";
        data: {
          blockerKind: string;
          setup: AgentChatProviderSetupSurfaceAction;
        };
      };
    };

export interface AgentChatShellUpdateResult {
  state: AgentChatShellState;
  command: AgentChatBackendCommand | null;
}

export interface AgentChatShellViewModel {
  chatState: AgentChatState;
  runtimeState: AgentRuntimeStateName;
  thread: AgentChatThreadView | null;
  providerReadinessBlockers: AgentChatProviderReadinessBlocker[];
  // True while a Provider Readiness action (e.g. trust grant) is in flight.
  providerReadinessActionPending: boolean;
  prompt: AgentChatPromptState | null;
  blocks: AgentChatBlockView[];
  composer: AgentChatComposerView;
  workbenchOpen: boolean;
  queuedInputs: string[];
  usage: AgentChatUsageView | null;
  errorMessage?: string;
}

export interface AgentChatUsageView {
  // Pre-formatted, ready to render: e.g. "12.3k tokens".
  tokensLabel?: string;
  // e.g. "64%" when a context window is known.
  contextPercentLabel?: string;
  // 0–100, for the meter bar fill.
  contextUsedPercent?: number;
}

export interface AgentChatThreadView {
  threadId: string;
  title: string;
  agentLabel: string;
  runtimeStartedAt?: string;
}

export interface AgentChatBlockView {
  blockId: string;
  kind: string;
  role?: string;
  status: string;
  title: string;
  body: string;
  rawFallback?: string;
}

export interface AgentChatComposerView {
  mode: "start" | "follow_up";
  draft: string;
  submitLabel: string;
  permissionLabel: string;
  modelLabel: string;
  activeSurface: AgentChatChoiceSurfaceView | null;
  contextControlsEditable: boolean;
  contextItems: AgentChatContextItem[];
  attachments: AgentChatComposerAttachmentView[];
  contextChips: AgentChatContextChipView[];
}

export interface AgentChatComposerAttachmentView {
  id: string;
  name: string;
  // A data: URL the renderer can use directly as an <img> src for the thumbnail.
  previewUrl: string;
}

export interface AgentChatContextChipView {
  id: string;
  kind: AgentChatContextChipKind;
  label: string;
  comment: string;
}

export interface AgentChatContextItem {
  label: "Agent" | "Project" | "Scratch" | "Worktree" | "Branch";
  value: string;
  runtimeSourceKind?: AgentChatAgentRuntimeSource["kind"];
  // For the Agent chip: the agent id, so the renderer can show the per-agent
  // identity icon (the same one used in Thread rows).
  agentId?: string;
}

export interface AgentChatChoiceSurfaceView {
  surfaceKind: AgentChatComposerSurfaceKind | "provider_readiness" | "prompt_state";
  title: string;
  sourceLabel: string;
  rows: AgentChatChoiceSurfaceRowView[];
}

export interface AgentChatChoiceSurfaceRowView {
  rowId: string;
  label: string;
  detail?: string;
  meta?: string;
  icon?: string;
  selected?: boolean;
  danger?: boolean;
  // A row for a real feature that is not wired up yet: shown greyed and
  // non-interactive instead of silently doing nothing when clicked.
  disabled?: boolean;
  // An optional trailing affordance (e.g. a trash button) rendered beside the
  // row. Clicking it routes through the same row-select callback with this
  // `rowId`, so no extra handler plumbing is needed. See
  // docs_v2/specs/worktree-branch-deletion.md.
  action?: { rowId: string; label: string; icon?: string };
}

export interface AgentChatBackendEvent {
  kind: string;
  payload: Record<string, unknown>;
}
