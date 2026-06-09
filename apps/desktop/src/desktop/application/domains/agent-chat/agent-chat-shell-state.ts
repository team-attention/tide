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
  // Composer input submitted during a live turn: held (queued) and shown as a
  // "queued" row until the turn ends and the backend flushes it as a real block.
  queuedInput: string | null;
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

export type AgentChatProviderCliAgentId = "codex" | "claude" | "antigravity";
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
      payload: { threadId: string; value: string };
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
  queuedInput: string | null;
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
}

export interface AgentChatBackendEvent {
  kind: string;
  payload: Record<string, unknown>;
}

export function createAgentChatShellState(input?: {
  startOptions?: AgentChatStartOptions;
}): AgentChatShellState {
  return {
    thread: null,
    runtimeState: "not_started",
    hydrating: false,
    providerReadiness: null,
    providerReadinessActionPending: false,
    promptState: null,
    blocks: [],
    composer: {
      draft: "",
      activeSurface: null,
      attachments: [],
      contextChips: [],
      startOptions: input?.startOptions ?? {
        agentBinding: {
          agentId: "codex",
          runtimeSource: runtimeSourceForAgent("codex"),
        },
        // A new thread must start in a real working directory, or the Agent has
        // no cwd and the FileTree has no root (empty tree, failed refresh).
        scope: defaultThreadScope(),
        launchOptions: {},
      },
    },
    workbenchOpen: false,
    queuedInput: null,
    usage: null,
  };
}

export function updateComposerDraft(
  state: AgentChatShellState,
  draft: string,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        draft,
        activeSurface:
          composerSurfaceForDraft(draft) ??
          (state.composer.activeSurface === "command_suggestions"
            ? null
            : state.composer.activeSurface),
      },
    },
    command: null,
  };
}

export function addComposerAttachment(
  state: AgentChatShellState,
  attachment: AgentChatComposerAttachment,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        attachments: [...state.composer.attachments, attachment],
      },
    },
    command: null,
  };
}

export function removeComposerAttachment(
  state: AgentChatShellState,
  attachmentId: string,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        attachments: state.composer.attachments.filter(
          (attachment) => attachment.id !== attachmentId,
        ),
      },
    },
    command: null,
  };
}

export function addComposerContextChip(
  state: AgentChatShellState,
  chip: AgentChatContextChip,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        contextChips: [...state.composer.contextChips, chip],
      },
    },
    command: null,
  };
}

export function removeComposerContextChip(
  state: AgentChatShellState,
  chipId: string,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        contextChips: state.composer.contextChips.filter((chip) => chip.id !== chipId),
      },
    },
    command: null,
  };
}

export function setComposerActiveSurface(
  state: AgentChatShellState,
  surface: AgentChatComposerSurfaceKind | null,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        activeSurface: surface,
      },
    },
    command: null,
  };
}

export function selectComposerAgent(
  state: AgentChatShellState,
  agentId: AgentChatAgentId,
): AgentChatShellUpdateResult {
  if (state.thread) {
    return { state, command: null };
  }

  const runtimeSource = runtimeSourceForAgent(agentId);
  const launchOptions = {
    ...state.composer.startOptions.launchOptions,
    model: defaultModelValueForAgent(agentId),
    permission: defaultPermissionForAgent(agentId),
  };

  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        activeSurface: null,
        startOptions: {
          ...state.composer.startOptions,
          agentBinding: {
            ...state.composer.startOptions.agentBinding,
            agentId,
            runtimeSource,
          },
          launchOptions,
        },
      },
    },
    command: null,
  };
}

export function selectAgentChatChoiceSurfaceRow(
  state: AgentChatShellState,
  surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
  rowId: string,
  activeThreadId?: string,
): AgentChatShellUpdateResult {
  if (surfaceKind === "prompt_state" && state.promptState) {
    const choice = state.promptState.choices?.find((candidate) => candidate.choiceId === rowId);
    return {
      state: {
        ...state,
        promptState: null,
        composer: {
          ...state.composer,
          draft: "",
        },
      },
      command: {
        kind: "prompt.answer",
        payload: {
          threadId: state.promptState.threadId,
          promptId: state.promptState.promptId,
          choiceId: choice?.choiceId ?? rowId,
          value: choice?.providerValue,
        },
      },
    };
  }

  if (surfaceKind === "provider_readiness") {
    // The directory-trust blocker offers a direct "Trust this folder" action that
    // writes the provider's trust config (no terminal). See workspace-trust-grant.
    if (rowId === "directory_trust_required:trust") {
      const threadId = state.thread?.threadId ?? activeThreadId;
      // Ignore re-clicks while a trust grant is already in flight.
      if (threadId === undefined || state.providerReadinessActionPending) {
        return { state, command: null };
      }
      return {
        state: { ...state, providerReadinessActionPending: true },
        command: {
          kind: "provider.trustWorkspace",
          payload: { threadId },
        },
      };
    }
    const blocker = state.providerReadiness?.blockers.find(
      (candidate) => `${candidate.kind}:setup` === rowId,
    );
    // Readiness can block before the agent-chat thread is hydrated, so fall back
    // to the active thread id the shell provides — otherwise "Open provider
    // setup" is a dead row.
    const threadId = state.thread?.threadId ?? activeThreadId;
    if (blocker?.setup === undefined || threadId === undefined) {
      return { state, command: null };
    }
    return {
      state,
      command: {
        kind: "workbench.command",
        payload: {
          threadId,
          command: "open_provider_setup_surface",
          data: {
            blockerKind: blocker.kind,
            setup: providerSetupCommandPayload(blocker.setup),
          },
        },
      },
    };
  }

  if (state.composer.activeSurface !== surfaceKind) {
    return { state, command: null };
  }
  const activeSurface = createActiveComposerSurface(state);
  if (!activeSurface?.rows.some((row) => row.rowId === rowId)) {
    return { state, command: null };
  }

  switch (surfaceKind) {
    case "agent_menu": {
      const agentId = composerAgentIdForRow(rowId);
      return agentId ? selectComposerAgent(state, agentId) : { state, command: null };
    }
    case "model_menu": {
      const reasoning = reasoningForRow(rowId);
      if (reasoning !== undefined) {
        return updateComposerLaunchOptions(state, { reasoning });
      }
      const model = modelForRow(rowId, runtimeSourceForBinding(state.composer.startOptions.agentBinding).kind);
      return model ? updateComposerLaunchOptions(state, { model }) : { state, command: null };
    }
    case "permission_menu": {
      const permission = permissionForRow(rowId);
      return permission ? updateComposerLaunchOptions(state, { permission }) : { state, command: null };
    }
    case "project_menu": {
      const scope = scopeForProjectRow(rowId, state);
      return scope ? updateComposerScope(state, scope) : { state, command: null };
    }
    case "worktree_menu": {
      const worktree = worktreeForRow(rowId);
      return worktree ? updateComposerLaunchOptions(state, { worktree }) : { state, command: null };
    }
    case "branch_menu": {
      const branch = branchForRow(rowId);
      return branch ? updateComposerLaunchOptions(state, { branch }) : { state, command: null };
    }
    case "command_suggestions": {
      // Selecting a command/skill row (rowId "command:/name" or "command:$name")
      // inserts the token into the draft and closes the surface.
      if (rowId.startsWith("command:")) {
        const token = rowId.slice("command:".length);
        return {
          state: {
            ...state,
            composer: { ...state.composer, draft: `${token} `, activeSurface: null },
          },
          command: null,
        };
      }
      return setComposerActiveSurface(state, null);
    }
    case "composer_options":
      return setComposerActiveSurface(state, null);
  }
}

// Explicit interrupt: stop the in-flight turn. The session stays resumable, so
// the next message continues via the agent's native resume. Any queued input is
// dropped (the user chose to interrupt).
export function interruptComposer(
  state: AgentChatShellState,
): AgentChatShellUpdateResult {
  if (state.thread === null) {
    return { state, command: null };
  }
  const busy = state.runtimeState === "running" || state.runtimeState === "starting";
  if (!busy) {
    return { state, command: null };
  }
  // With a queued follow-up, Stop CONSUMES it: the current turn ends and the queued
  // message runs next. Keep the optimistic row + stay running (the backend confirms
  // with the new turn). With no queue it's a plain interrupt: settle to idle instantly
  // so the Working indicator/timer stops and the next message is a fresh turn.
  if (state.queuedInput !== null) {
    return {
      state,
      command: {
        kind: "agentRuntime.stop",
        payload: { threadId: state.thread.threadId },
      },
    };
  }
  return {
    state: { ...state, runtimeState: "idle" },
    command: {
      kind: "agentRuntime.stop",
      payload: { threadId: state.thread.threadId },
    },
  };
}

function generateThreadId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `id-${random.slice(0, 12)}`;
}

export function submitComposer(
  state: AgentChatShellState,
): AgentChatShellUpdateResult {
  const draft = state.composer.draft.trim();
  const attachments = state.composer.attachments;
  const chips = state.composer.contextChips;
  // A message with no text but with pasted images or attached content chips is
  // still a valid send. Attached content is prepended to the message as context.
  if (draft.length === 0 && attachments.length === 0 && chips.length === 0) {
    return { state, command: null };
  }
  const input =
    chips.length === 0
      ? draft
      : `${chips.map((chip) => chip.text).join("\n\n")}${draft.length > 0 ? `\n\n${draft}` : ""}`;

  if (state.promptState) {
    return {
      state,
      command: {
        kind: "prompt.answer",
        payload: {
          threadId: state.promptState.threadId,
          promptId: state.promptState.promptId,
          value: input,
        },
      },
    };
  }

  const messageAttachments = attachmentsForMessage(attachments);
  // Clear the draft on send (every path) so re-clicking submit can't resend the
  // same message and spawn a duplicate thread / duplicate user row.
  const composerAfterSend = { ...state.composer, draft: "", attachments: [], contextChips: [] };

  if (state.thread) {
    // Show the sent message immediately as a pending row, whether the turn is busy
    // (genuinely queued) or idle (about to run) — it clears the instant the real
    // user block arrives. Without this a follow-up looked like it vanished until
    // the backend recorded it. Draft + attachments always clear on send.
    return {
      state: { ...state, queuedInput: input, composer: composerAfterSend },
      command: {
        kind: "composer.sendInput",
        payload: {
          threadId: state.thread.threadId,
          input,
          // Carry the current composer launch options (e.g. a changed model /
          // reasoning) so follow-ups honor them, not just the thread's original.
          launchOptions: launchOptionsForState(state),
          ...(messageAttachments ? { attachments: messageAttachments } : {}),
        },
      },
    };
  }

  // Optimistic new thread: open it instantly with a client-generated id and pass
  // that id to the backend (startThread honors it). The view switches to the new
  // thread immediately, so a slow backend can't leave the user clicking again and
  // spawning duplicate threads.
  const startOptions = state.composer.startOptions;
  const newThreadId = generateThreadId();
  const nowIso = new Date().toISOString();
  const optimisticThread: AgentChatThreadSummary = {
    threadId: newThreadId,
    title: input.length > 0 ? input.slice(0, 80) : "New thread",
    agentBinding: startOptions.agentBinding,
    scope: startOptions.scope ?? { kind: "scratch", scratchCwd: "Scratch" },
    launchOptions: startOptions.launchOptions,
    createdAt: nowIso,
    updatedAt: nowIso,
    pinned: false,
    archived: false,
    lastKnownState: "running",
  };

  return {
    state: {
      ...state,
      thread: optimisticThread,
      runtimeState: "starting",
      queuedInput: null,
      composer: composerAfterSend,
    },
    command: {
      kind: "thread.start",
      payload: {
        threadId: newThreadId,
        initialMessage: input,
        agentBinding: startOptions.agentBinding,
        scope: startOptions.scope,
        launchOptions: startOptions.launchOptions,
        ...(messageAttachments ? { attachments: messageAttachments } : {}),
      },
    },
  };
}

// Edit the queued (not-yet-sent) message shown as the queued row. The runtime has
// not seen it, so this only updates the optimistic queued row and asks the backend
// to correct its pendingInput. A blank value discards the queued message.
// Spec: docs_v2/specs/composer-message-edit.md.
export function editQueuedInput(
  state: AgentChatShellState,
  value: string,
): AgentChatShellUpdateResult {
  if (!state.thread || state.queuedInput === null) {
    return { state, command: null };
  }
  const discards = value.trim().length === 0;
  return {
    state: { ...state, queuedInput: discards ? null : value },
    command: {
      kind: "composer.editQueuedInput",
      payload: { threadId: state.thread.threadId, value },
    },
  };
}

function attachmentsForMessage(
  attachments: AgentChatComposerAttachment[],
): AgentChatComposerMessageAttachment[] | null {
  if (attachments.length === 0) {
    return null;
  }
  return attachments.map((attachment) => ({
    name: attachment.name,
    mediaType: attachment.mediaType,
    dataBase64: attachment.dataBase64,
  }));
}

export function applyAgentChatBackendEvent(
  state: AgentChatShellState,
  event: AgentChatBackendEvent,
): AgentChatShellState {
  switch (event.kind) {
    case "thread.hydrated": {
      const payload = event.payload as {
        thread: AgentChatThreadSummary;
        blocks?: AgentChatBlock[];
        providerReadiness?: AgentChatProviderReadiness;
        runtimeState?: AgentRuntimeStateName;
        workbenchPanes?: { visible?: boolean }[];
      };
      return {
        ...state,
        thread: payload.thread,
        blocks: payload.blocks ?? state.blocks,
        // The real hydrate has returned — stop the loading skeleton (even if there
        // are zero blocks, so an empty thread does not skeleton forever).
        hydrating: false,
        providerReadiness: payload.providerReadiness ?? state.providerReadiness,
        providerReadinessActionPending: false,
        runtimeState: payload.runtimeState ?? state.runtimeState,
        // Hydrate is the source of truth for this thread (its persisted blocks).
        // Drop any optimistic "queued input" row left over from before a thread
        // switch — otherwise the real user block (now in blocks) renders twice.
        // If the input is genuinely still queued, its user block arrives live.
        queuedInput: null,
        // Usage is per-thread; a fresh hydrate clears the previous thread's chip
        // until a usageChanged for this thread arrives.
        usage: null,
        workbenchOpen:
          payload.workbenchPanes === undefined
            ? state.workbenchOpen
            : payload.workbenchPanes.some((pane) => pane.visible === true),
      };
    }
    case "agentRuntime.usageChanged": {
      const payload = event.payload as {
        usage?: {
          totalTokens?: number;
          contextWindow?: number;
          contextUsedPercent?: number;
          model?: string;
        };
      };
      if (payload.usage === undefined) {
        return state;
      }
      return {
        ...state,
        usage: {
          totalTokens: payload.usage.totalTokens,
          contextWindow: payload.usage.contextWindow,
          contextUsedPercent: payload.usage.contextUsedPercent,
          model: payload.usage.model,
        },
      };
    }
    case "thread.started": {
      const payload = event.payload as {
        thread: AgentChatThreadSummary;
        runtimeState: AgentRuntimeStateName;
      };
      return {
        ...state,
        thread: payload.thread,
        runtimeState: payload.runtimeState,
        queuedInput: null,
      };
    }
    case "agentRuntime.stateChanged": {
      const payload = event.payload as { state: AgentRuntimeStateName };
      return {
        ...state,
        runtimeState: payload.state,
      };
    }
    case "providerReadiness.changed": {
      const payload = event.payload as { readiness: AgentChatProviderReadiness };
      return {
        ...state,
        providerReadiness: payload.readiness,
        // The readiness re-check came back; the trust/setup action is done.
        providerReadinessActionPending: false,
      };
    }
    case "prompt.changed": {
      const payload = event.payload as { prompt: AgentChatPromptState | null };
      return {
        ...state,
        promptState: payload.prompt,
      };
    }
    case "agentSessionBlock.upserted": {
      const payload = event.payload as { block: AgentChatBlock };
      // A real user block means a queued input was flushed — drop the optimistic
      // "queued" row so it isn't shown twice.
      const clearsQueue = payload.block.role === "user" && state.queuedInput !== null;
      return {
        ...state,
        blocks: upsertBlock(state.blocks, payload.block),
        queuedInput: clearsQueue ? null : state.queuedInput,
      };
    }
    case "agentSessionBlock.completed": {
      const payload = event.payload as {
        blockId: string;
        status: "complete" | "failed";
      };
      return {
        ...state,
        blocks: state.blocks.map((block) =>
          block.blockId === payload.blockId
            ? { ...block, status: payload.status }
            : block,
        ),
      };
    }
    case "workbench.changed": {
      const payload = event.payload as { panes?: { visible?: boolean }[] };
      return {
        ...state,
        workbenchOpen: (payload.panes ?? []).some((pane) => pane.visible === true),
      };
    }
    case "contract.error": {
      const payload = event.payload as { message?: string };
      return {
        ...state,
        runtimeState: "failed",
        errorMessage: payload.message ?? "Contract error",
      };
    }
    default:
      return state;
  }
}

export function createAgentChatShellViewModel(
  state: AgentChatShellState,
): AgentChatShellViewModel {
  return {
    chatState: deriveChatState(state),
    runtimeState: state.runtimeState,
    thread: state.thread
      ? {
          threadId: state.thread.threadId,
          title: state.thread.title,
          agentLabel: formatAgentLabel(state.thread.agentBinding.agentId),
          runtimeStartedAt: state.thread.runtimeStartedAt,
        }
      : null,
    providerReadinessBlockers:
      state.providerReadiness && !state.providerReadiness.ready
        ? state.providerReadiness.blockers
        : [],
    providerReadinessActionPending: state.providerReadinessActionPending,
    prompt: state.promptState,
    blocks: state.blocks.map(toBlockView),
    composer: {
      mode: state.thread ? "follow_up" : "start",
      draft: state.composer.draft,
      submitLabel: state.promptState ? "Answer" : "Send",
      permissionLabel: permissionLabelForState(state),
      modelLabel: modelLabelForState(state),
      activeSurface: createActiveComposerSurface(state),
      contextControlsEditable: state.thread === null,
      contextItems: state.thread
        ? readOnlyThreadContextItems(state.thread)
        : startContextItems(state.composer.startOptions),
      attachments: state.composer.attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        previewUrl: `data:${attachment.mediaType};base64,${attachment.dataBase64}`,
      })),
      contextChips: state.composer.contextChips.map((chip) => ({
        id: chip.id,
        kind: chip.kind,
        label: chip.label,
      })),
    },
    workbenchOpen: state.workbenchOpen,
    queuedInput: state.queuedInput,
    usage: usageView(state.usage),
    errorMessage: state.errorMessage,
  };
}

// Formats raw usage into ready-to-render labels. Returns null when there is
// nothing meaningful to show (no tokens and no context percent).
function usageView(usage: AgentChatUsage | null): AgentChatUsageView | null {
  if (usage === null) {
    return null;
  }
  const tokensLabel =
    usage.totalTokens !== undefined ? `${formatTokenCount(usage.totalTokens)} tokens` : undefined;
  const contextPercentLabel =
    usage.contextUsedPercent !== undefined ? `${usage.contextUsedPercent}%` : undefined;
  if (tokensLabel === undefined && contextPercentLabel === undefined) {
    return null;
  }
  return {
    tokensLabel,
    contextPercentLabel,
    contextUsedPercent: usage.contextUsedPercent,
  };
}

// 1234 -> "1.2k", 12345 -> "12.3k", 999 -> "999".
function formatTokenCount(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens);
  }
  const thousands = tokens / 1000;
  return `${thousands.toFixed(thousands < 100 ? 1 : 0)}k`;
}

function launchOptionsForState(
  state: AgentChatShellState,
): Record<string, unknown> | undefined {
  return state.thread ? state.thread.launchOptions : state.composer.startOptions.launchOptions;
}

function modelLabelForState(state: AgentChatShellState): string {
  const binding = state.thread?.agentBinding ?? state.composer.startOptions.agentBinding;
  const launchOptions = launchOptionsForState(state);
  const model = String(launchOptions?.model ?? defaultModelValueForAgent(binding.agentId));
  // codex exposes a reasoning effort; show it next to the model so the chip
  // reflects the real setting (not a hardcoded level).
  if (binding.agentId === "codex") {
    const reasoning = String(launchOptions?.reasoning ?? "medium");
    return `${codexModelLabel(model)} · ${reasoningLabel(reasoning)}`;
  }
  if (binding.agentId === "claude") {
    const effort = String(launchOptions?.reasoning ?? "high");
    return `${modelLabelForAgent("claude", model)} · ${reasoningLabel(effort)}`;
  }
  return modelLabelForAgent(binding.agentId, model);
}

function reasoningLabel(reasoning: string): string {
  return reasoning === "xhigh" ? "Extra High" : capitalize(reasoning);
}

// Codex models, read from the installed codex binary (matches the Codex app
// picker). codex's --model is free-form, so "Custom model id..." stays too.
const CODEX_MODELS: CliModelOption[] = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4-Mini" },
  { value: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
  { value: "gpt-5.3-codex-spark", label: "GPT-5.3-Codex-Spark" },
  { value: "gpt-5.2", label: "GPT-5.2" },
];

function codexModelLabel(model: string): string {
  return CODEX_MODELS.find((m) => m.value === model)?.label ?? model;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function permissionLabelForState(state: AgentChatShellState): string {
  const binding = state.thread?.agentBinding ?? state.composer.startOptions.agentBinding;
  const value = String(
    launchOptionsForState(state)?.permission ?? defaultPermissionForAgent(binding.agentId),
  );
  return permissionLabelForValue(binding.agentId, value);
}

function deriveChatState(state: AgentChatShellState): AgentChatState {
  if (state.providerReadiness && !state.providerReadiness.ready) {
    return "provider_not_ready";
  }
  if (state.promptState?.kind === "approval" || state.promptState?.kind === "permission") {
    return "waiting_for_approval";
  }
  if (state.promptState) {
    return "waiting_for_input";
  }
  if (state.runtimeState === "failed") {
    return "failed";
  }
  if (state.runtimeState === "starting" || state.runtimeState === "running") {
    return "running";
  }
  if (state.runtimeState === "waiting_for_approval") {
    return "waiting_for_approval";
  }
  if (state.runtimeState === "waiting_for_input") {
    return "waiting_for_input";
  }
  if (!state.thread) {
    return "empty";
  }
  // Still loading this thread's blocks from the backend (set on optimistic open,
  // cleared when the real hydrate returns). A preserved thread restored on switch-
  // back is not hydrating, so it renders instantly with no skeleton.
  if (state.hydrating && state.blocks.length === 0) {
    return "hydrating";
  }
  return "ready";
}

function toBlockView(block: AgentChatBlock): AgentChatBlockView {
  const body = block.body ?? block.rawFallback ?? block.title ?? "";
  return {
    blockId: block.blockId,
    kind: block.kind,
    role: block.role,
    status: block.status,
    title: block.title ?? formatBlockKind(block.kind),
    body,
    rawFallback: block.rawFallback,
  };
}

function upsertBlock(
  blocks: AgentChatBlock[],
  nextBlock: AgentChatBlock,
): AgentChatBlock[] {
  const existingIndex = blocks.findIndex((block) => block.blockId === nextBlock.blockId);
  if (existingIndex === -1) {
    return [...blocks, nextBlock];
  }

  return blocks.map((block, index) => (index === existingIndex ? nextBlock : block));
}

function readOnlyThreadContextItems(
  thread: AgentChatThreadSummary,
): AgentChatContextItem[] {
  const projectOrScratch =
    thread.scope.kind === "project"
      ? { label: "Project" as const, value: thread.scope.projectId }
      : { label: "Scratch" as const, value: thread.scope.scratchCwd || "Scratch" };

  const items: AgentChatContextItem[] = [
    {
      label: "Agent",
      value: formatAgentLabel(thread.agentBinding.agentId),
      runtimeSourceKind: runtimeSourceForBinding(thread.agentBinding).kind,
      agentId: thread.agentBinding.agentId,
    },
    projectOrScratch,
  ];

  if (thread.context?.worktree) {
    items.push({ label: "Worktree", value: thread.context.worktree });
  }
  if (thread.context?.branch) {
    items.push({ label: "Branch", value: thread.context.branch });
  }

  return items;
}

function startContextItems(options: AgentChatStartOptions): AgentChatContextItem[] {
  const scope = options.scope;
  const projectOrScratch =
    scope?.kind === "project"
      ? { label: "Project" as const, value: scope.projectId }
      : { label: "Scratch" as const, value: scope?.scratchCwd || "Scratch" };

  return [
    {
      label: "Agent",
      value: formatAgentLabel(options.agentBinding.agentId),
      runtimeSourceKind: runtimeSourceForBinding(options.agentBinding).kind,
      agentId: options.agentBinding.agentId,
    },
    projectOrScratch,
    {
      label: "Worktree",
      value: String(options.launchOptions?.worktree ?? "current folder"),
    },
    { label: "Branch", value: String(options.launchOptions?.branch ?? "main") },
  ];
}

function formatAgentLabel(agentId: string): string {
  switch (agentId) {
    case "codex":
      return "Codex CLI";
    case "claude":
      return "Claude Code";
    case "antigravity":
      return "Antigravity CLI";
    case "openai_api":
      return "OpenAI API";
    default:
      return agentId;
  }
}

function createActiveComposerSurface(
  state: AgentChatShellState,
): AgentChatChoiceSurfaceView | null {
  const surfaceKind = state.composer.activeSurface;
  if (!surfaceKind) {
    return null;
  }

  const binding = state.thread?.agentBinding ?? state.composer.startOptions.agentBinding;
  const source = runtimeSourceForBinding(binding);
  const agentLabel = formatAgentLabel(binding.agentId);
  const launchOptions = launchOptionsForState(state);
  const selectedModel = String(
    launchOptions?.model ?? defaultModelValueForAgent(binding.agentId),
  );

  switch (surfaceKind) {
    case "agent_menu":
      return {
        surfaceKind,
        title: "Agent",
        sourceLabel: "Agent Binding",
        // Tide API Agents / OpenAI API are hidden for now (provider-CLI only).
        // The openai_api binding + runtime still exist; they're just not offered here.
        rows: [
          row("codex", "Codex CLI", "Agent Integration", undefined, binding.agentId === "codex" ? "check" : "identity:codex", binding.agentId === "codex"),
          row("claude", "Claude Code", "Agent Integration", undefined, binding.agentId === "claude" ? "check" : "identity:claude", binding.agentId === "claude"),
          row("antigravity", "Antigravity CLI", "Agent Integration", undefined, binding.agentId === "antigravity" ? "check" : "identity:antigravity", binding.agentId === "antigravity"),
        ],
      };
    case "model_menu":
      return {
        surfaceKind,
        title: "Model",
        sourceLabel: agentLabel,
        rows:
          source.kind === "tide_api"
            ? [
                row("gpt-55-high", "gpt-5.5", "OpenAI Provider Account", undefined, "check", selectedModel === "gpt-5.5"),
              ]
            : binding.agentId === "codex"
              ? codexModelMenuRows(state, selectedModel)
              : binding.agentId === "claude"
                ? [
                    ...cliModelMenuRows("claude", agentLabel, selectedModel),
                    // The Claude Code app's "Effort" control → `--effort`.
                    row("effort-section", "Effort", "thinking effort", "source", "source"),
                    ...effortRows(
                      String(launchOptionsForState(state)?.reasoning ?? "high"),
                      ["low", "medium", "high", "xhigh", "max"],
                    ),
                  ]
                : cliModelMenuRows(binding.agentId, agentLabel, selectedModel),
      };
    case "permission_menu":
      return {
        surfaceKind,
        title: `${agentLabel} Permission`,
        sourceLabel: agentLabel,
        rows: permissionRowsForAgent(
          binding.agentId,
          String(launchOptionsForState(state)?.permission ?? defaultPermissionForAgent(binding.agentId)),
        ),
      };
    case "project_menu":
      return {
        surfaceKind,
        title: "Project",
        sourceLabel: "Execution Context",
        rows: projectMenuRows(state),
      };
    case "worktree_menu":
      return {
        surfaceKind,
        title: "Worktree",
        sourceLabel: "Execution Context",
        rows: worktreeMenuRows(state),
      };
    case "branch_menu":
      return {
        surfaceKind,
        title: "Branch",
        sourceLabel: "Execution Context",
        rows: branchMenuRows(state),
      };
    case "composer_options":
      return {
        surfaceKind,
        title: "Composer menu",
        sourceLabel: agentLabel,
        rows: [
          row("files-images", "Files and images", "Attach an image", undefined, "attach"),
          // Context-attach features are not wired yet — shown disabled, not as
          // silent no-ops. (selected=false, danger=false, disabled=true)
          row("current-selection", "Current file or selection", "coming soon", undefined, "file", false, false, true),
          row("context", "Browser, Diff, Terminal, or FileTree context", "coming soon", undefined, "panel", false, false, true),
        ],
      };
    case "command_suggestions": {
      // Real provider commands/skills for the active cwd+agent (discovered from
      // provider files, injected by the product shell), filtered by what the
      // user has typed after the leading / or $.
      const draft = state.composer.draft;
      const trigger = draft.startsWith("$") ? "$" : "/";
      const query = draft.slice(1).trim().toLowerCase();
      const commands = (state.availableCommands ?? []).filter(
        (command) =>
          command.trigger === trigger &&
          (query.length === 0 || command.name.toLowerCase().includes(query)),
      );
      return {
        surfaceKind,
        title: trigger === "$" ? "Skills" : "Commands",
        sourceLabel: agentLabel,
        rows:
          commands.length === 0
            ? [row("no-commands", `No ${trigger === "$" ? "skills" : "commands"} found`, "for this directory", agentLabel)]
            : commands.map((command) =>
                row(`command:${command.trigger}${command.name}`, `${command.trigger}${command.name}`, command.description, agentLabel),
              ),
      };
    }
  }
}

// Permission/approval modes, presented to match each provider's own app rather
// than exposing raw CLI flags: Codex mirrors the Codex app's 3 approval modes,
// Claude mirrors the Claude app's mode list, Antigravity uses the same friendly
// shape. `value` is what flows to the Agent Integration (which maps it to the
// provider's real flags); `label`/`detail` are the human presentation.
interface PermissionOption {
  id: string;
  value: string;
  label: string;
  detail: string;
  danger?: boolean;
}

const PERMISSION_OPTIONS: Record<string, { default: string; options: PermissionOption[] }> = {
  codex: {
    default: "approve-for-me",
    options: [
      { id: "codex-ask", value: "ask-for-approval", label: "Ask for approval", detail: "Edits & internet need approval" },
      { id: "codex-auto", value: "approve-for-me", label: "Approve for me", detail: "Only unsafe actions ask" },
      { id: "codex-full", value: "full-access", label: "Full access", detail: "Unrestricted files & internet", danger: true },
    ],
  },
  claude: {
    default: "default",
    options: [
      { id: "claude-ask", value: "default", label: "Ask permissions", detail: "Approve edits & tools" },
      { id: "claude-accept", value: "acceptEdits", label: "Accept edits", detail: "Auto-approve file edits" },
      { id: "claude-plan", value: "plan", label: "Plan mode", detail: "Plan without editing" },
      { id: "claude-auto", value: "auto", label: "Auto mode", detail: "Run autonomously" },
      { id: "claude-bypass", value: "bypassPermissions", label: "Bypass permissions", detail: "Skip all approvals", danger: true },
    ],
  },
  antigravity: {
    default: "default",
    options: [
      { id: "agy-ask", value: "default", label: "Ask for approval", detail: "Approve actions manually" },
      { id: "agy-sandbox", value: "sandbox", label: "Sandbox", detail: "Run inside a sandbox" },
      { id: "agy-bypass", value: "dangerously-skip-permissions", label: "Bypass permissions", detail: "Skip all approvals", danger: true },
    ],
  },
  openai_api: {
    default: "Auto-review",
    options: [
      { id: "tide-auto-review", value: "Auto-review", label: "Auto-review", detail: "Tide tool policy" },
      { id: "tide-ask-first", value: "Ask before tools", label: "Ask before tools", detail: "Tide tool policy" },
      { id: "tide-read-only", value: "Read-only", label: "Read-only", detail: "Tide workspace policy" },
    ],
  },
};

function permissionConfigForAgent(agentId: string): { default: string; options: PermissionOption[] } {
  return PERMISSION_OPTIONS[agentId] ?? PERMISSION_OPTIONS.codex;
}

// Legacy raw permission values (from threads created before the friendly modes)
// map to the closest current mode so the chip + selected row still make sense.
function normalizePermissionValue(agentId: string, value: string): string {
  const config = permissionConfigForAgent(agentId);
  if (config.options.some((option) => option.value === value)) {
    return value;
  }
  if (agentId === "codex") {
    if (value === "read-only" || value === "untrusted" || value === "on-request") return "ask-for-approval";
    if (value === "workspace-write" || value === "on-failure") return "approve-for-me";
    if (value === "danger-full-access" || value === "never" || value === "dangerously-bypass-approvals-and-sandbox") {
      return "full-access";
    }
  }
  if (agentId === "claude" && value === "dontAsk") return "acceptEdits";
  return value;
}

function permissionRowsForAgent(agentId: string, currentValue: string): AgentChatChoiceSurfaceRowView[] {
  const config = permissionConfigForAgent(agentId);
  const normalized = normalizePermissionValue(agentId, currentValue);
  return config.options.map((option) => {
    const selected = option.value === normalized;
    const icon = selected ? "check" : option.danger ? "!" : "";
    return row(option.id, option.label, option.detail, undefined, icon, selected, option.danger ?? false);
  });
}

function row(
  rowId: string,
  label: string,
  detail?: string,
  meta?: string,
  icon = "",
  selected = false,
  danger = false,
  disabled = false,
): AgentChatChoiceSurfaceRowView {
  return { rowId, label, detail, meta, icon, selected, danger, disabled };
}

function updateComposerLaunchOptions(
  state: AgentChatShellState,
  patch: Record<string, unknown>,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
      // For an active thread the launch options live on the thread (that's what
      // launchOptionsForState reads), so a model/reasoning/permission change must
      // patch there too — otherwise it has no effect on follow-ups.
      thread: state.thread
        ? { ...state.thread, launchOptions: { ...state.thread.launchOptions, ...patch } }
        : state.thread,
      composer: {
        ...state.composer,
        activeSurface: null,
        startOptions: {
          ...state.composer.startOptions,
          launchOptions: {
            ...state.composer.startOptions.launchOptions,
            ...patch,
          },
        },
      },
    },
    command: null,
  };
}

function updateComposerScope(
  state: AgentChatShellState,
  scope: AgentChatThreadScope,
): AgentChatShellUpdateResult {
  if (state.thread) {
    return { state, command: null };
  }

  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        activeSurface: null,
        startOptions: {
          ...state.composer.startOptions,
          scope,
        },
      },
    },
    command: null,
  };
}

// Scopes the Start Composer to a folder picked via the chip's "Open folder"
// action WITHOUT registering it as a persisted project. The folder only becomes
// a left-list Project once a Thread is actually started in it (thread-derived).
export function setComposerFolderScope(
  state: AgentChatShellState,
  cwd: string,
): AgentChatShellUpdateResult {
  return updateComposerScope(state, {
    kind: "project",
    projectId: basenameOf(cwd),
    cwd,
  });
}

function composerAgentIdForRow(
  rowId: string,
): AgentChatAgentId | null {
  switch (rowId) {
    case "codex":
      return "codex";
    case "claude":
      return "claude";
    case "antigravity":
      return "antigravity";
    case "openai-api":
      return "openai_api";
    default:
      return null;
  }
}

function modelForRow(
  rowId: string,
  sourceKind: AgentChatAgentRuntimeSource["kind"] = "provider_cli",
): string | undefined {
  // CLI model rows carry their provider-native value as `model:<value>`.
  if (rowId.startsWith("model:")) {
    return rowId.slice("model:".length);
  }
  switch (rowId) {
    case "gpt-55-high":
    case "codex-model":
      return "gpt-5.5";
    case "claude-default":
      return "Claude default";
    case "antigravity-default":
      return "Antigravity default";
    default:
      return undefined;
  }
}

interface CliModelOption {
  value: string;
  label: string;
  detail?: string;
}

// A maintained, provider-native model list per CLI agent (models change rarely).
// Claude values are the real `--model` aliases (verified via `/model`); "Claude
// default" passes no --model (uses the CLI's own default).
function cliModelOptionsForAgent(agentId: string): CliModelOption[] {
  switch (agentId) {
    case "claude":
      // Mirrors the Claude Code app's model list. "Claude default" passes no
      // --model (the CLI's own default, currently Opus 4.8); the rest pass an
      // explicit `--model` id.
      return [
        { value: "Claude default", label: "Default", detail: "Opus 4.8" },
        { value: "claude-opus-4-8", label: "Opus 4.8" },
        { value: "claude-opus-4-8[1m]", label: "Opus 4.8 (1M context)" },
        { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
        { value: "claude-haiku-4-5", label: "Haiku 4.5" },
        { value: "claude-opus-4-7", label: "Opus 4.7", detail: "Legacy" },
        { value: "claude-opus-4-7[1m]", label: "Opus 4.7 (1M context)", detail: "Legacy" },
        { value: "claude-opus-4-6", label: "Opus 4.6", detail: "Legacy" },
      ];
    case "antigravity":
      // Real models from the Antigravity CLI (`agy models`). Effort is baked into
      // the model variant (Low/Medium/High/Thinking), so there is no separate
      // effort control. Values are passed verbatim to `agy --model`.
      return [
        { value: "Antigravity default", label: "Default" },
        { value: "Gemini 3.1 Pro (High)", label: "Gemini 3.1 Pro", detail: "High" },
        { value: "Gemini 3.1 Pro (Low)", label: "Gemini 3.1 Pro", detail: "Low" },
        { value: "Gemini 3.5 Flash (High)", label: "Gemini 3.5 Flash", detail: "High" },
        { value: "Gemini 3.5 Flash (Medium)", label: "Gemini 3.5 Flash", detail: "Medium" },
        { value: "Gemini 3.5 Flash (Low)", label: "Gemini 3.5 Flash", detail: "Low" },
        { value: "Claude Sonnet 4.6 (Thinking)", label: "Claude Sonnet 4.6", detail: "Thinking" },
        { value: "Claude Opus 4.6 (Thinking)", label: "Claude Opus 4.6", detail: "Thinking" },
        { value: "GPT-OSS 120B (Medium)", label: "GPT-OSS 120B", detail: "Medium" },
      ];
    default:
      return [];
  }
}

function cliModelMenuRows(
  agentId: string,
  agentLabel: string,
  selectedModel: string,
): AgentChatChoiceSurfaceRowView[] {
  void agentLabel;
  // No noisy fallback detail (matches the provider apps' clean model lists): a
  // model shows its own detail (e.g. "Legacy") or nothing.
  const rows = cliModelOptionsForAgent(agentId).map((option) =>
    row(
      `model:${option.value}`,
      option.label,
      option.detail,
      undefined,
      option.value === selectedModel ? "check" : "",
      option.value === selectedModel,
    ),
  );
  return rows;
}

// Reasoning/thinking effort levels, shared by codex (`model_reasoning_effort`)
// and claude (`--effort`). Codex offers low–xhigh; claude adds "max".
const REASONING_LEVELS: Record<string, { label: string; detail: string }> = {
  low: { label: "Low", detail: "fastest, least thorough" },
  medium: { label: "Medium", detail: "balanced" },
  high: { label: "High", detail: "slower, more thorough" },
  xhigh: { label: "Extra High", detail: "slowest, most thorough" },
  max: { label: "Max", detail: "maximum effort" },
};

function effortRows(current: string, levels: string[]): AgentChatChoiceSurfaceRowView[] {
  return levels.map((level) =>
    row(
      `reasoning-${level}`,
      REASONING_LEVELS[level].label,
      REASONING_LEVELS[level].detail,
      undefined,
      current === level ? "check" : "",
      current === level,
    ),
  );
}

function reasoningForRow(rowId: string): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  switch (rowId) {
    case "reasoning-low":
      return "low";
    case "reasoning-medium":
      return "medium";
    case "reasoning-high":
      return "high";
    case "reasoning-xhigh":
      return "xhigh";
    case "reasoning-max":
      return "max";
    default:
      return undefined;
  }
}

// Codex has no enumerable model list (free-form `--model`); the real tuning knob
// is reasoning effort. Surface the active model plus the three effort levels.
function codexModelMenuRows(
  state: AgentChatShellState,
  selectedModel: string,
): AgentChatChoiceSurfaceRowView[] {
  const reasoning = String(launchOptionsForState(state)?.reasoning ?? "medium");
  const rows: AgentChatChoiceSurfaceRowView[] = [
    row("model-section", "Model", "Codex Agent Integration", "source", "source"),
  ];
  for (const model of CODEX_MODELS) {
    rows.push(
      row(
        `model:${model.value}`,
        model.label,
        undefined,
        undefined,
        model.value === selectedModel ? "check" : "",
        model.value === selectedModel,
      ),
    );
  }
  rows.push(
    row("reasoning-section", "Reasoning effort", "model_reasoning_effort", "source", "source"),
    ...effortRows(reasoning, ["low", "medium", "high", "xhigh"]),
  );
  return rows;
}

function permissionForRow(rowId: string): string | undefined {
  for (const config of Object.values(PERMISSION_OPTIONS)) {
    const option = config.options.find((candidate) => candidate.id === rowId);
    if (option) {
      return option.value;
    }
  }
  return undefined;
}

// Default working directory for a brand-new thread. Hardcoded to the primary
// project today (projects are not yet backend-provided); a new thread must have
// a real root so the Agent runs somewhere and the FileTree can list files.
function defaultThreadScope(): AgentChatThreadScope {
  // No hardcoded user path — the product shell injects a real project scope for new
  // threads. This bare fallback is Scratch so the Agent never lands in a
  // non-existent placeholder directory (which trips provider directory-trust).
  return { kind: "scratch", scratchCwd: "Scratch" };
}

// The real projects the Project menu lists: those injected from the product
// shell, plus the composer's current project if not already among them (so the
// active scope is always selectable). No hardcoded project list.
function projectOptionsForState(state: AgentChatShellState): AgentChatProjectOption[] {
  const options = [...(state.availableProjects ?? [])];
  const scope = state.thread?.scope ?? state.composer.startOptions.scope;
  if (scope?.kind === "project" && !options.some((option) => option.projectId === scope.projectId)) {
    options.unshift({ projectId: scope.projectId, name: scope.projectId, cwd: scope.cwd });
  }
  return options;
}

function projectMenuRows(state: AgentChatShellState): AgentChatChoiceSurfaceRowView[] {
  const scope = state.thread?.scope ?? state.composer.startOptions.scope;
  const activeProjectId = scope?.kind === "project" ? scope.projectId : undefined;
  const projectRows = projectOptionsForState(state).map((project) => {
    const selected = project.projectId === activeProjectId;
    return row(
      `project:${project.projectId}`,
      project.name,
      selected ? "current" : project.cwd,
      undefined,
      selected ? "check" : "folder",
      selected,
    );
  });
  return [
    ...projectRows,
    row("scratch", "Scratch", "scratch workspace", undefined, "scratch", scope?.kind === "scratch"),
    // Single registration action — opens the native directory picker (Codex flow).
    row("open-folder", "Open folder", "add a project directory", undefined, "folder-plus"),
  ];
}

// Real worktrees for the active scope: "current folder" (the main worktree)
// plus any additional git worktrees, then a "new worktree" affordance. Falls
// back to just "current folder" for Scratch / non-git scopes.
function worktreeMenuRows(state: AgentChatShellState): AgentChatChoiceSurfaceRowView[] {
  const selected = String(launchOptionsForState(state)?.worktree ?? "current folder");
  const worktrees = state.availableWorktrees ?? [];
  const rows: AgentChatChoiceSurfaceRowView[] = [
    row("worktree:current", "current folder", "main worktree", undefined, "folder", selected === "current folder"),
  ];
  for (const worktree of worktrees.filter((entry) => !entry.current)) {
    const label = worktree.branch ?? basenameOf(worktree.path);
    rows.push(
      row(`worktree:${worktree.path}`, label, worktree.path, undefined, "folder", selected === worktree.path),
    );
  }
  // Creating a worktree from the Composer isn't wired yet (worktrees are created
  // from the Project rail). Show it disabled rather than as a silent no-op.
  rows.push(row("new-worktree", "New worktree", "coming soon", undefined, "folder-plus", false, false, true));
  return rows;
}

// Real git branches (local before remote, current marked); falls back to just
// the current launch value when no git data is available.
function branchMenuRows(state: AgentChatShellState): AgentChatChoiceSurfaceRowView[] {
  const selected = String(launchOptionsForState(state)?.branch ?? "main");
  const branches = state.availableBranches ?? [];
  const rows: AgentChatChoiceSurfaceRowView[] = [];
  if (branches.length === 0) {
    rows.push(row(`branch:${selected}`, selected, "current", undefined, "check", true));
  } else {
    const ordered = [...branches].sort((a, b) => Number(a.kind === "remote") - Number(b.kind === "remote"));
    for (const branch of ordered) {
      const isSelected = branch.name === selected;
      rows.push(
        row(
          `branch:${branch.name}`,
          branch.name,
          branch.current ? "current" : branch.kind,
          undefined,
          isSelected ? "check" : "branch",
          isSelected,
        ),
      );
    }
  }
  // Creating a branch from the Composer isn't wired yet — show it disabled.
  rows.push(row("create-branch", "Create new branch", "coming soon", undefined, "plus", false, false, true));
  return rows;
}

function basenameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

function scopeForProjectRow(
  rowId: string,
  state: AgentChatShellState,
): AgentChatThreadScope | null {
  if (rowId === "scratch") {
    return { kind: "scratch", scratchCwd: "Scratch" };
  }
  if (rowId.startsWith("project:")) {
    const projectId = rowId.slice("project:".length);
    const project = projectOptionsForState(state).find((option) => option.projectId === projectId);
    return project ? { kind: "project", projectId: project.projectId, cwd: project.cwd } : null;
  }
  // create-project / use-existing-folder are folder-picker actions, wired later.
  return null;
}

function worktreeForRow(rowId: string): string | undefined {
  if (rowId === "worktree:current") {
    return "current folder";
  }
  if (rowId.startsWith("worktree:")) {
    return rowId.slice("worktree:".length);
  }
  // "new-worktree" is a create affordance, wired later.
  return undefined;
}

function branchForRow(rowId: string): string | undefined {
  // "create-branch" is a create affordance, wired later.
  return rowId.startsWith("branch:") ? rowId.slice("branch:".length) : undefined;
}

function runtimeSourceForBinding(binding: AgentChatAgentBinding): AgentChatAgentRuntimeSource {
  return binding.runtimeSource ?? runtimeSourceForAgent(binding.agentId);
}

function runtimeSourceForAgent(agentId: string): AgentChatAgentRuntimeSource {
  if (agentId === "openai_api") {
    return {
      kind: "tide_api",
      provider: "openai",
    };
  }

  const providerAgent =
    agentId === "claude" || agentId === "antigravity" ? agentId : "codex";
  return {
    kind: "provider_cli",
    integrationId: providerAgent,
  };
}

function defaultModelValueForAgent(agentId: string): string {
  switch (agentId) {
    case "claude":
      return "Claude default";
    case "antigravity":
      return "Antigravity default";
    case "openai_api":
      return "gpt-5.5";
    default:
      return "gpt-5.5";
  }
}

function defaultModelLabelForAgent(agentId: string): string {
  return modelLabelForAgent(agentId, defaultModelValueForAgent(agentId));
}

function modelLabelForAgent(agentId: string, model: string): string {
  // Show the friendly label for a known CLI model (e.g. "sonnet" -> "Sonnet").
  const option = cliModelOptionsForAgent(agentId).find((candidate) => candidate.value === model);
  if (option !== undefined) {
    return option.label;
  }
  return model;
}

function modelRowIdForAgent(agentId: string): string {
  switch (agentId) {
    case "claude":
      return "claude-default";
    case "antigravity":
      return "antigravity-default";
    default:
      return "gpt-55-high";
  }
}

export function defaultPermissionForAgent(agentId: string): string {
  return permissionConfigForAgent(agentId).default;
}

// The friendly label for a permission value (handles legacy raw values too), used
// for the composer permission chip.
function permissionLabelForValue(agentId: string, value: string): string {
  const config = permissionConfigForAgent(agentId);
  const normalized = normalizePermissionValue(agentId, value);
  return config.options.find((option) => option.value === normalized)?.label ?? value;
}

function composerSurfaceForDraft(draft: string): AgentChatComposerSurfaceKind | null {
  const first = draft.trimStart().slice(0, 1);
  return first === "/" || first === "$" || first === "@" || first === "!"
    ? "command_suggestions"
    : null;
}

function cloneStringRecord(
  value: Record<string, string> | undefined,
): Record<string, string> | undefined {
  return value === undefined ? undefined : { ...value };
}

function providerSetupCommandPayload(
  setup: AgentChatProviderSetupSurfaceAction,
): AgentChatProviderSetupSurfaceAction {
  const payload: AgentChatProviderSetupSurfaceAction = {
    command: setup.command,
    args: [...setup.args],
    cwd: setup.cwd,
    expectedCompletion: setup.expectedCompletion,
  };
  if (setup.env !== undefined) {
    payload.env = cloneStringRecord(setup.env);
  }
  return payload;
}

function formatBlockKind(kind: string): string {
  return kind
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
