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
  activeSurface: AgentChatComposerSurfaceKind | null;
  startOptions: AgentChatStartOptions;
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
  permissionLabel: string;
  modelLabel: string;
  activeSurface: AgentChatChoiceSurfaceView | null;
  contextControlsEditable: boolean;
  contextItems: AgentChatContextItem[];
}

export interface AgentChatContextItem {
  label: "Agent" | "Project" | "Scratch" | "Worktree" | "Branch";
  value: string;
  runtimeSourceKind?: AgentChatAgentRuntimeSource["kind"];
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
      activeSurface: null,
      startOptions: input?.startOptions ?? {
        agentBinding: {
          agentId: "codex",
          runtimeSource: runtimeSourceForAgent("codex"),
        },
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
    const blocker = state.providerReadiness?.blockers.find(
      (candidate) => `${candidate.kind}:setup` === rowId,
    );
    if (blocker?.setup === undefined || state.thread === null) {
      return { state, command: null };
    }
    return {
      state,
      command: {
        kind: "workbench.command",
        payload: {
          threadId: state.thread.threadId,
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
      const model = modelForRow(rowId, runtimeSourceForBinding(state.composer.startOptions.agentBinding).kind);
      return model ? updateComposerLaunchOptions(state, { model }) : { state, command: null };
    }
    case "permission_menu": {
      const permission = permissionForRow(rowId);
      return permission ? updateComposerLaunchOptions(state, { permission }) : { state, command: null };
    }
    case "project_menu": {
      const scope = scopeForProjectRow(rowId);
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
    case "composer_options":
    case "command_suggestions":
      return setComposerActiveSurface(state, null);
  }
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
        workbenchPanes?: { visible?: boolean }[];
      };
      return {
        ...state,
        thread: payload.thread,
        blocks: payload.blocks ?? state.blocks,
        providerReadiness: payload.providerReadiness ?? state.providerReadiness,
        runtimeState: payload.runtimeState ?? state.runtimeState,
        workbenchOpen:
          payload.workbenchPanes === undefined
            ? state.workbenchOpen
            : payload.workbenchPanes.some((pane) => pane.visible === true),
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
      permissionLabel: permissionLabelForState(state),
      modelLabel: modelLabelForState(state),
      activeSurface: createActiveComposerSurface(state),
      contextControlsEditable: state.thread === null,
      contextItems: state.thread
        ? readOnlyThreadContextItems(state.thread)
        : startContextItems(state.composer.startOptions),
    },
    workbenchOpen: state.workbenchOpen,
    errorMessage: state.errorMessage,
  };
}

function launchOptionsForState(
  state: AgentChatShellState,
): Record<string, unknown> | undefined {
  return state.thread ? state.thread.launchOptions : state.composer.startOptions.launchOptions;
}

function modelLabelForState(state: AgentChatShellState): string {
  const binding = state.thread?.agentBinding ?? state.composer.startOptions.agentBinding;
  const model = String(
    launchOptionsForState(state)?.model ?? defaultModelValueForAgent(binding.agentId),
  );
  return modelLabelForAgent(binding.agentId, model);
}

function permissionLabelForState(state: AgentChatShellState): string {
  const binding = state.thread?.agentBinding ?? state.composer.startOptions.agentBinding;
  return String(
    launchOptionsForState(state)?.permission ?? defaultPermissionForAgent(binding.agentId),
  );
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
    {
      label: "Agent",
      value: formatAgentLabel(thread.agentBinding.agentId),
      runtimeSourceKind: runtimeSourceForBinding(thread.agentBinding).kind,
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
        rows: [
          row("provider-cli", "Provider CLI Agents", "hidden PTY", "source", "◆"),
          row("codex", "Codex CLI", "Agent Integration", "ready", "✓", binding.agentId === "codex"),
          row("claude", "Claude Code", "Agent Integration", "ready", "", binding.agentId === "claude"),
          row("antigravity", "Antigravity CLI", "Agent Integration", "ready", "", binding.agentId === "antigravity"),
          row("tide-api", "Tide API Agents", "Provider Account", "source", "◆"),
          row("openai-api", "OpenAI API", "Tide API runtime", "setup", "", binding.agentId === "openai_api"),
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
                row("gpt-55-high", "gpt-5.5", "OpenAI Provider Account", undefined, "✓", selectedModel === "gpt-5.5"),
                row("provider-model-catalog", "Provider model catalog", "from Tide API runtime"),
                row("custom-model", "Custom model id...", "API model id", undefined, "+"),
              ]
            : [
                row(
                  modelRowIdForAgent(binding.agentId),
                  defaultModelLabelForAgent(binding.agentId),
                  binding.agentId === "codex" ? "Codex Agent Integration" : `${agentLabel} Agent Integration`,
                  undefined,
                  "✓",
                  selectedModel === defaultModelValueForAgent(binding.agentId),
                ),
                row("provider-model-list", "Provider model list", "from selected CLI"),
                row("custom-model", "Custom model id...", "if provider accepts it", undefined, "+"),
              ],
      };
    case "permission_menu":
      return {
        surfaceKind,
        title: `${agentLabel} Permission`,
        sourceLabel: agentLabel,
        rows: permissionRowsForAgent(binding.agentId),
      };
    case "project_menu":
      return {
        surfaceKind,
        title: "Project",
        sourceLabel: "Execution Context",
        rows: [
          row("project-tide", "tide", "current", undefined, "✓", true),
          row("project-slice", "slice", undefined, undefined, "⌘"),
          row("scratch", "Scratch", undefined, undefined, "□"),
          row("create-project", "Create new project", undefined, undefined, "+"),
          row("use-existing-folder", "Use existing folder", undefined, undefined, "□"),
        ],
      };
    case "worktree_menu":
      return {
        surfaceKind,
        title: "Worktree",
        sourceLabel: "Execution Context",
        rows: [
          row("current-folder", "current folder", "selected", undefined, "✓", true),
          row("new-worktree", "new worktree", undefined, undefined, "+"),
          row("existing-worktree", "existing worktree", undefined, undefined, "□"),
        ],
      };
    case "branch_menu":
      return {
        surfaceKind,
        title: "Branch",
        sourceLabel: "Execution Context",
        rows: [
          row("filter-branches", "Filter branches...", undefined, undefined, "⌕"),
          row("main", "main", "current", undefined, "✓", true),
          row("feature-sidebar", "feature/sidebar", "local", undefined, "⌙"),
          row("codex-v2-shell", "codex/v2-shell", "local", undefined, "⌙"),
          row("origin-main", "origin/main", "remote", undefined, "⌙"),
          row("release-2026-05", "release/2026-05", "remote", undefined, "⌙"),
          row("create-branch", "Create new branch", undefined, undefined, "+"),
        ],
      };
    case "composer_options":
      return {
        surfaceKind,
        title: "Composer menu",
        sourceLabel: agentLabel,
        rows: [
          row("files-images", "Files and images", "Attach file or image", undefined, "+"),
          row("current-selection", "Current file or selection", "when available", undefined, "□"),
          row("context", "Browser, Diff, Terminal, or FileTree context", "when available", undefined, "─"),
          row("agent-tools", "Agent tools", "selected Agent features", undefined, "◆"),
        ],
      };
    case "command_suggestions":
      return {
        surfaceKind,
        title: "Command suggestions",
        sourceLabel: "selected Agent",
        rows: [
          row("code-review", "Code review", "Review unstaged changes or compare against a branch", agentLabel, "/"),
          row("compact", "Compact", "Compact this Thread context", agentLabel, "/"),
          row("context-mention", "Context mention", "files / panes / artifacts", "Tide", "@"),
          row("provider-command", "Provider command", "pass through when meaningful", "Agent", "$"),
        ],
      };
  }
}

function permissionRowsForAgent(agentId: string): AgentChatChoiceSurfaceRowView[] {
  switch (agentId) {
    case "openai_api":
      return [
        row("tide-auto-review", "Auto-review", "Tide tool policy", "Tide API", "✓", true),
        row("tide-ask-first", "Ask before tools", "Tide tool policy", "Tide API"),
        row("tide-read-only", "Read-only", "Tide workspace policy", "Tide API"),
      ];
    case "claude":
      return [
        row("default", "default", "provider-native", undefined, "✓", true),
        row("accept-edits", "acceptEdits", "provider-native"),
        row("auto", "auto", "provider-native"),
        row("dont-ask", "dontAsk", "provider-native"),
        row("plan", "plan", "provider-native"),
        row("bypass-permissions", "bypassPermissions", "provider-native", undefined, "!", false, true),
      ];
    case "antigravity":
      return [
        row("default", "default", "provider-native", undefined, "✓", true),
        row("sandbox", "sandbox", "provider-native"),
        row("dangerously-skip-permissions", "dangerously-skip-permissions", "provider-native", undefined, "!", false, true),
      ];
    default:
      return [
        row("read-only", "read-only", "Access"),
        row("workspace-write", "workspace-write", "Access", undefined, "✓", true),
        row("danger-full-access", "danger-full-access", "Access", undefined, "!", false, true),
        row("untrusted", "untrusted", "Approval"),
        row("on-request", "on-request", "Approval", undefined, "◇"),
        row("never", "never", "Approval", undefined, "!", false, true),
      ];
  }
}

function row(
  rowId: string,
  label: string,
  detail?: string,
  meta?: string,
  icon = "",
  selected = false,
  danger = false,
): AgentChatChoiceSurfaceRowView {
  return { rowId, label, detail, meta, icon, selected, danger };
}

function updateComposerLaunchOptions(
  state: AgentChatShellState,
  patch: Record<string, unknown>,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
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
  switch (rowId) {
    case "gpt-55-high":
      return "gpt-5.5";
    case "claude-default":
      return "Claude default";
    case "antigravity-default":
      return "Antigravity default";
    default:
      return undefined;
  }
}

function permissionForRow(rowId: string): string | undefined {
  switch (rowId) {
    case "read-only":
      return "read-only";
    case "workspace-write":
      return "workspace-write";
    case "danger-full-access":
      return "danger-full-access";
    case "untrusted":
      return "untrusted";
    case "on-request":
      return "on-request";
    case "never":
      return "never";
    case "accept-edits":
      return "acceptEdits";
    case "dont-ask":
      return "dontAsk";
    case "bypass-permissions":
      return "bypassPermissions";
    case "dangerously-skip-permissions":
      return "dangerously-skip-permissions";
    case "tide-auto-review":
      return "Auto-review";
    case "tide-ask-first":
      return "Ask before tools";
    case "tide-read-only":
      return "Read-only";
    case "default":
    case "auto":
    case "plan":
    case "sandbox":
      return rowId;
    default:
      return undefined;
  }
}

function scopeForProjectRow(rowId: string): AgentChatThreadScope | null {
  switch (rowId) {
    case "project-tide":
      return { kind: "project", projectId: "tide", cwd: "/Users/eatnug/Workspace/tide" };
    case "project-slice":
      return { kind: "project", projectId: "slice", cwd: "/Users/eatnug/Workspace/slice" };
    case "scratch":
      return { kind: "scratch", scratchCwd: "Scratch" };
    default:
      return null;
  }
}

function worktreeForRow(rowId: string): string | undefined {
  switch (rowId) {
    case "current-folder":
      return "current folder";
    case "new-worktree":
      return "new worktree";
    case "existing-worktree":
      return "existing worktree";
    default:
      return undefined;
  }
}

function branchForRow(rowId: string): string | undefined {
  switch (rowId) {
    case "main":
      return "main";
    case "feature-sidebar":
      return "feature/sidebar";
    case "codex-v2-shell":
      return "codex/v2-shell";
    case "origin-main":
      return "origin/main";
    case "release-2026-05":
      return "release/2026-05";
    default:
      return undefined;
  }
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
  if (agentId === "codex" && model === "gpt-5.5") {
    return "GPT-5.5 High";
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

function defaultPermissionForAgent(agentId: string): string {
  switch (agentId) {
    case "claude":
    case "antigravity":
      return "default";
    case "openai_api":
      return "Auto-review";
    default:
      return "workspace-write";
  }
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
