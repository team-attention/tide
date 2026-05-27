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

export interface AgentChatShellState {
  thread: AgentChatThreadSummary | null;
  runtimeState: AgentRuntimeStateName;
  providerReadiness: AgentChatProviderReadiness | null;
  promptState: AgentChatPromptState | null;
  blocks: AgentChatBlock[];
  composer: AgentChatComposerState;
  workbenchOpen: boolean;
  errorMessage?: string;
}

export interface AgentChatComposerState {
  draft: string;
  startOptions: AgentChatStartOptions;
}

export interface AgentChatStartOptions {
  agentBinding: AgentChatAgentBinding;
  scope?: AgentChatThreadScope;
  launchOptions?: Record<string, unknown>;
}

export interface AgentChatAgentBinding {
  agentId: string;
  providerSessionRef?: {
    kind: string;
    value: string;
    transcriptPath?: string;
    logPath?: string;
  };
}

export interface AgentChatThreadSummary {
  threadId: string;
  title: string;
  agentBinding: AgentChatAgentBinding;
  scope: AgentChatThreadScope;
  context?: AgentChatThreadContext;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  lastKnownState: string;
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
}

export interface AgentChatBlock {
  blockId: string;
  threadId: string;
  agentId?: string;
  kind: string;
  role?: "user" | "agent" | "tool" | "system" | "runtime";
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
        initialMessage: string;
        agentBinding: AgentChatAgentBinding;
        scope?: AgentChatThreadScope;
        launchOptions?: Record<string, unknown>;
      };
    }
  | {
      kind: "composer.sendInput";
      payload: { threadId: string; input: string };
    }
  | {
      kind: "prompt.answer";
      payload: {
        threadId: string;
        promptId: string;
        choiceId?: string;
        value?: string;
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
  prompt: AgentChatPromptState | null;
  blocks: AgentChatBlockView[];
  composer: AgentChatComposerView;
  workbenchOpen: boolean;
  errorMessage?: string;
}

export interface AgentChatThreadView {
  threadId: string;
  title: string;
  agentLabel: string;
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
  contextControlsEditable: boolean;
  contextItems: AgentChatContextItem[];
}

export interface AgentChatContextItem {
  label: "Agent" | "Project" | "Scratch" | "Worktree" | "Branch";
  value: string;
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
    providerReadiness: null,
    promptState: null,
    blocks: [],
    composer: {
      draft: "",
      startOptions: input?.startOptions ?? {
        agentBinding: { agentId: "codex" },
        scope: { kind: "scratch", scratchCwd: "" },
        launchOptions: {},
      },
    },
    workbenchOpen: false,
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
      },
    },
    command: null,
  };
}

export function submitComposer(
  state: AgentChatShellState,
): AgentChatShellUpdateResult {
  const input = state.composer.draft.trim();
  if (input.length === 0) {
    return { state, command: null };
  }

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

  if (state.thread) {
    return {
      state,
      command: {
        kind: "composer.sendInput",
        payload: {
          threadId: state.thread.threadId,
          input,
        },
      },
    };
  }

  return {
    state,
    command: {
      kind: "thread.start",
      payload: {
        initialMessage: input,
        agentBinding: state.composer.startOptions.agentBinding,
        scope: state.composer.startOptions.scope,
        launchOptions: state.composer.startOptions.launchOptions,
      },
    },
  };
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
      };
      return {
        ...state,
        thread: payload.thread,
        blocks: payload.blocks ?? state.blocks,
        providerReadiness: payload.providerReadiness ?? state.providerReadiness,
        runtimeState: payload.runtimeState ?? state.runtimeState,
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
      return {
        ...state,
        blocks: upsertBlock(state.blocks, payload.block),
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
      const payload = event.payload as { panes?: unknown[] };
      return {
        ...state,
        workbenchOpen: (payload.panes?.length ?? 0) > 0,
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
        }
      : null,
    providerReadinessBlockers:
      state.providerReadiness && !state.providerReadiness.ready
        ? state.providerReadiness.blockers
        : [],
    prompt: state.promptState,
    blocks: state.blocks.map(toBlockView),
    composer: {
      mode: state.thread ? "follow_up" : "start",
      draft: state.composer.draft,
      submitLabel: state.promptState ? "Answer" : "Send",
      contextControlsEditable: state.thread === null,
      contextItems: state.thread
        ? readOnlyThreadContextItems(state.thread)
        : startContextItems(state.composer.startOptions),
    },
    workbenchOpen: state.workbenchOpen,
    errorMessage: state.errorMessage,
  };
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
    { label: "Agent", value: formatAgentLabel(thread.agentBinding.agentId) },
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
    { label: "Agent", value: formatAgentLabel(options.agentBinding.agentId) },
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
    default:
      return agentId;
  }
}

function formatBlockKind(kind: string): string {
  return kind
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
