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
  // Optional provenance, for display/debugging only (NOT used to filter the menu —
  // the menu mirrors the agent's full set). "builtin" = the provider CLI's own
  // command; "project"/"user" = a discovered command/skill file.
  source?: "project" | "user" | "builtin";
}

export interface AgentChatFileMentionOption {
  name: string;
  relativePath: string;
  cwd?: string;
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
  // Real files for the active cwd, injected by the product shell for Composer
  // @ mentions. Empty until the bounded file tree has been loaded.
  availableFileMentions?: AgentChatFileMentionOption[];
  // Composer inputs submitted during a live turn: held (queued) FIFO and shown as
  // a stack of "queued" rows until the turn ends and the backend flushes the head
  // as a real block (then the next runs). Empty when nothing is queued.
  queuedInputs: string[];
  // Last-known context/token usage for this thread's runtime (from the provider
  // transcript). Drives the quiet usage chip in the thread header.
  usage: AgentChatUsage | null;
  // Live in-flight-turn progress not carried by the chat stream
  // (agentRuntime.activityChanged): Claude Task fan-out counts (Slice B) and/or
  // codex/ACP plan progress (Slice B′). Folded into the Working indicator by the
  // view-model; cleared at turn end.
  liveActivityEnrichment?: {
    nestedAgents?: number;
    nestedToolCalls?: number;
    planTotal?: number;
    planCompleted?: number;
  };
  // Transient feedback for a mid-thread launch-option change, keyed by option key
  // (model | permission | reasoning). Renderer-only (never from a backend thread
  // summary, which would clobber it); thread-scoped; reset on thread switch.
  // "applied" = took effect live now (brief chip flash); "pending" = applies on the
  // next message (persistent chip badge until the next turn starts).
  // See docs_v2/specs/mid-thread-launch-option-feedback.md.
  launchOptionFeedback: Record<string, LaunchOptionFeedback>;
  errorMessage?: string;
}

export interface LaunchOptionFeedback {
  state: "applied" | "pending";
  // Monotonic token (event clock) so a repeat change re-triggers the flash.
  at: number;
}

export interface AgentChatUsage {
  totalTokens?: number;
  contextWindow?: number;
  contextUsedPercent?: number;
  model?: string;
  rateLimits?: AgentChatUsageRateLimit[];
}

export interface AgentChatUsageRateLimit {
  label?: string;
  usedPercent?: number;
  windowMinutes?: number;
  resetsAt?: number;
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

export type AgentChatAgentId = AgentChatProviderCliAgentId;

export interface AgentChatAgentRuntimeSource {
  kind: "provider_cli";
  integrationId: AgentChatProviderCliAgentId;
}

export type AgentChatComposerSurfaceKind =
  | "agent_menu"
  | "model_menu"
  | "permission_menu"
  | "project_menu"
  | "worktree_menu"
  | "branch_menu"
  | "composer_options"
  | "command_suggestions"
  // The opencode "Connect a model" on-ramp (Zen card + vendor grid). Opened from
  // the Model chip when opencode is selected but not yet usable, or via "Add a
  // vendor…" in the opencode model menu. See opencode-vendor-onramp.md.
  | "opencode_connect";

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
  // The user-set thread goal (objective). Shown in the Goal & Checklist panel.
  // Absent ⇒ unset. See docs_v2/specs/thread-goal-and-checklist-panel.md.
  goal?: string;
  lastKnownState: string;
  // True while a runtime for this thread is hydrated/alive in the backend process
  // now (regardless of running/waiting) — the multitask switcher's live set. Absent
  // on older payloads ⇒ false.
  live?: boolean;
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

export type AgentChatPromptChoiceKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

// What an approval/permission prompt is asking the user to approve (command/diff + paths).
export interface AgentChatPromptDetail {
  format: "text" | "diff";
  body: string;
  locations?: string[];
}

export interface AgentChatPromptState {
  promptId: string;
  threadId: string;
  agentId: string;
  kind: "question" | "approval" | "permission" | "choice" | "command_picker";
  message: string;
  // Short chip label for a question (claude AskUserQuestion header).
  header?: string;
  // Approval/permission detail: the command/diff being approved.
  detail?: AgentChatPromptDetail;
  choices?: AgentChatPromptChoice[];
  defaultChoiceId?: string;
  // Multi-select question: the card toggles several options and submits them together.
  multiSelect?: boolean;
  // A batched, multi-step prompt (claude AskUserQuestion). When present with length > 1 the
  // card is a navigable wizard; single prompts omit it. See multi-step-prompt-navigation.md.
  steps?: AgentChatPromptStep[];
  source: "pty" | "provider_signal" | "provider_hook";
}

export interface AgentChatPromptChoice {
  choiceId: string;
  label: string;
  providerValue: string;
  // Per-option explanation + preview (claude AskUserQuestion option.description/preview).
  description?: string;
  preview?: string;
  // Approval semantic (ACP options[].kind); undefined for claude/codex.
  kind?: AgentChatPromptChoiceKind;
}

export interface AgentChatPromptStep {
  stepId: string;
  message: string;
  // Short chip label for this question (claude AskUserQuestion header).
  header?: string;
  choices?: AgentChatPromptChoice[];
  defaultChoiceId?: string;
  multiSelect?: boolean;
}

// One resolved answer in a multi-step submit; `value` is the provider-native answer
// (a chosen option's providerValue, free text, or "" to skip).
export interface AgentChatPromptStepAnswer {
  stepId: string;
  value: string;
  // Free-text note the user attached to this question (claude AskUserQuestion annotations).
  notes?: string;
}

export interface AgentChatProviderReadiness {
  agentId: string;
  ready: boolean;
  blockers: AgentChatProviderReadinessBlocker[];
  // Non-blocking "a newer CLI is published" advisory; present independent of `ready`.
  update?: AgentChatProviderUpdateAdvisory;
}

export interface AgentChatProviderUpdateAdvisory {
  currentVersion: string;
  latestVersion: string;
  terminalAction: AgentChatProviderReadinessTerminalAction;
}

export interface AgentChatProviderReadinessBlocker {
  kind: string;
  message: string;
  scope?: string;
  action?: string;
  terminalAction?: AgentChatProviderReadinessTerminalAction;
}

export interface AgentChatProviderReadinessTerminalAction {
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
  // Structured block payload carried verbatim from the backend DTO. The Goal &
  // Checklist panel reads `data.entries` off the "plan" block. Absent for blocks
  // that carry no structured data.
  data?: Record<string, unknown>;
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
      // Set or clear (empty string) the thread goal from the Goal & Checklist panel.
      kind: "thread.setGoal";
      payload: { threadId: string; goal: string };
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
        // A multi-step prompt (wizard) submits one answer per step here.
        stepAnswers?: AgentChatPromptStepAnswer[];
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "open_terminal";
        data: {
          blockerKind: string;
          command: string;
          args: string[];
          env?: Record<string, string>;
          cwd: string;
          terminalRole?: "provider_readiness";
          expectedCompletion?: "process_exit" | "retry_preflight";
        };
      };
    }
  | {
      // Set an opencode vendor's API key the canonical way (backend → opencode server).
      kind: "provider.opencodeConnectApiKey";
      payload: { vendorId: string; key: string };
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
  // Display label of the agent the readiness card is for (e.g. "Codex"), so its terminal rows can
  // read "Install Codex" / "Sign in to Codex" instead of a generic prompt. Absent when ready.
  providerReadinessAgentLabel?: string;
  // True while a Provider Readiness action (e.g. trust grant) is in flight.
  providerReadinessActionPending: boolean;
  // Non-blocking agent-CLI update advisory (present even when ready), so the
  // composer can show an "Update <Agent>" nudge. Spec: version-management.md.
  providerUpdateAdvisory?: {
    agentLabel: string;
    currentVersion: string;
    latestVersion: string;
  };
  prompt: AgentChatPromptState | null;
  blocks: AgentChatBlockView[];
  // The agent's live checklist for the active thread, or null when there is none.
  // Rendered together with the goal in the pinned Goal & Checklist panel.
  checklist: AgentChatChecklistView | null;
  composer: AgentChatComposerView;
  workbenchOpen: boolean;
  queuedInputs: string[];
  usage: AgentChatUsageView | null;
  // Live activity for the in-flight turn, surfaced in the Working indicator so a
  // long tool/agent fan-out reads as alive (not hung). Present only while running.
  // See docs_v2/specs/live-turn-activity-visibility.md.
  liveActivity?: LiveTurnActivityView;
  errorMessage?: string;
}

export interface LiveTurnActivityView {
  // Pre-formatted one-line detail for the Working indicator, e.g. "3 agents running",
  // "WebSearch", "5 tools running". Present only when there is something to show.
  summaryLabel: string;
}

export interface AgentChatUsageView {
  // Pre-formatted, ready to render: e.g. "12.3k tokens".
  tokensLabel?: string;
  // e.g. "64%" when a context window is known.
  contextPercentLabel?: string;
  // 0–100, for the meter bar fill.
  contextUsedPercent?: number;
  // Provider quota windows for the active thread, framed as REMAINING (Codex
  // account-menu style). Drives both the compact chip summary and the popover
  // rows (label · remaining% · reset). See usage-remaining-popover.md.
  rateLimits?: AgentChatUsageRateLimitView[];
}

export interface AgentChatUsageRateLimitView {
  // "5h", "Weekly", "Daily", "<n>h", "<n>m" — provider label or derived from window.
  label: string;
  // 0–100 (= clamp(100 − usedPercent)); source of truth for the bar fill.
  remainingPercent: number;
  // Pre-formatted remaining percent, e.g. "42%".
  remainingLabel: string;
  // When the window resets, in the host locale: a clock time ("8:31 PM") for
  // sub-day windows, a calendar date ("Jun 28") for weekly/longer. Omitted when
  // the provider gave no reset timestamp.
  resetLabel?: string;
}

export interface AgentChatThreadView {
  threadId: string;
  title: string;
  agentLabel: string;
  runtimeStartedAt?: string;
  // The user-set goal, shown (and editable) in the Goal & Checklist panel.
  goal?: string;
}

export type AgentChatChecklistStatus = "pending" | "in_progress" | "done";

export interface AgentChatChecklistEntry {
  text: string;
  status: AgentChatChecklistStatus;
}

// The agent's live checklist for the active thread (derived from the latest "plan"
// block). Rendered by the pinned Goal & Checklist panel.
export interface AgentChatChecklistView {
  entries: AgentChatChecklistEntry[];
  doneCount: number;
  totalCount: number;
  // codex's optional plan explanation; absent for claude/ACP.
  title?: string;
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
  // Transient chip feedback after a mid-thread change (undefined = none). The Model
  // chip absorbs reasoning feedback too (the model label includes the effort).
  permissionFeedback?: LaunchOptionFeedback;
  modelFeedback?: LaunchOptionFeedback;
  // Which surface the Model chip opens: normally "model_menu", but "opencode_connect"
  // when opencode is selected and not yet usable (no connected vendor / no model).
  modelChipSurface: AgentChatComposerSurfaceKind;
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
  label: "Agent" | "Project" | "Scratch" | "Environment" | "Branch";
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
  // Structured data for the rich "opencode_connect" panel (Zen card + vendor grid).
  // Present only for that surface; the generic row list still gates the actions.
  opencodeConnect?: AgentChatOpencodeConnectView;
}

// One vendor tile in the opencode on-ramp grid (view shape).
export interface AgentChatOpencodeConnectVendorView {
  // rowId the panel dispatches on click ("connect-vendor:<id>").
  rowId: string;
  id: string;
  label: string;
  monogram: string;
  connected: boolean;
  popular: boolean;
  // Connected but opencode serves no models for it (e.g. expired auth) ⇒ the tile is
  // clickable and labeled "Reconnect" (spec: opencode-vendor-reconnect.md).
  needsReconnect: boolean;
}

// The opencode "Connect a model" panel data: Zen free-model count, how many vendors
// are already signed in (inherited from the opencode CLI), the curated vendor grid,
// and the opencode version.
export interface AgentChatOpencodeConnectView {
  version?: string;
  zenFreeCount: number;
  connectedCount: number;
  vendors: AgentChatOpencodeConnectVendorView[];
  // True when opencode is already usable (≥1 vendor / model) — the panel is being
  // shown to ADD a vendor, so it offers a "back to models" affordance.
  manageMode: boolean;
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
