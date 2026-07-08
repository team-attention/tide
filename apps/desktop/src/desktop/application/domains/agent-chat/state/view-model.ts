import type { AgentChatBlock, AgentChatBlockPhase, AgentChatBlockView, AgentChatChecklistEntry, AgentChatChecklistStatus, AgentChatChecklistView, AgentChatContextItem, AgentChatShellState, AgentChatShellViewModel, AgentChatStartOptions, AgentChatState, AgentChatThreadSummary, AgentChatUsage, AgentChatUsageRateLimitView, AgentChatUsageView, LaunchOptionFeedback, LiveTurnActivityView } from "./types.ts";
import { codexModelLabel, defaultModelValueForAgent, defaultPermissionForAgent, formatAgentLabel, modelLabelForAgent, permissionLabelForValue, runtimeSourceForBinding } from "./agent-vocab.ts";
import { createActiveComposerSurface } from "./choice-surfaces.ts";
import { environmentContextValue, launchOptionsForState } from "./launch-options.ts";
import { nativeEvidenceForBlock, nativeEvidenceLabel } from "./native-evidence-view.ts";
// Extracted from agent-chat-shell-state.ts (spec: navigable-source-structure).

export function createAgentChatShellViewModel(
  state: AgentChatShellState,
): AgentChatShellViewModel {
  const visibleBlocks = visibleBlocksForState(state);
  const chatState = deriveChatState(state, visibleBlocks);
  const blockViews = blockViewsForVisibleBlocks(visibleBlocks);
  return {
    chatState,
    runtimeState: state.runtimeState,
    thread: state.thread
      ? {
          threadId: state.thread.threadId,
          title: state.thread.title,
          agentLabel: formatAgentLabel(state.thread.agentBinding.agentId),
          runtimeStartedAt: state.thread.runtimeStartedAt,
          goal: state.thread.goal,
          goalState: state.thread.goalState,
        }
      : null,
    providerReadinessBlockers:
      state.providerReadiness && !state.providerReadiness.ready
        ? state.providerReadiness.blockers
        : [],
    providerReadinessAgentLabel:
      state.providerReadiness && !state.providerReadiness.ready
        ? formatAgentLabel(state.providerReadiness.agentId)
        : undefined,
    providerReadinessActionPending: state.providerReadinessActionPending,
    // The update advisory shows regardless of `ready` (an outdated CLI still works),
    // so it is derived straight from the readiness state, not gated on blockers.
    providerUpdateAdvisory: state.providerReadiness?.update
      ? {
          agentLabel: formatAgentLabel(state.providerReadiness.agentId),
          currentVersion: state.providerReadiness.update.currentVersion,
          latestVersion: state.providerReadiness.update.latestVersion,
        }
      : undefined,
    prompt: state.promptState,
    blocks: blockViews,
    checklist: deriveChecklist(visibleBlocks),
    composer: {
      mode: state.thread ? "follow_up" : "start",
      draft: state.composer.draft,
      submitLabel: state.promptState ? "Answer" : "Send",
      permissionLabel: permissionLabelForState(state),
      modelLabel: modelLabelForState(state),
      permissionFeedback: state.launchOptionFeedback.permission,
      // The Model chip shows model + reasoning, so it absorbs either change's
      // feedback (the more recent one wins when both are pending).
      modelFeedback: mostRecentFeedback(
        state.launchOptionFeedback.model,
        state.launchOptionFeedback.reasoning,
      ),
      modelChipSurface: modelChipSurfaceForState(state),
      activeSurface: createActiveComposerSurface(state),
      contextControlsEditable: state.thread === null,
      contextItems: state.thread
        ? readOnlyThreadContextItems(state.thread)
        : startContextItems(state.composer.startOptions, state),
      attachments: state.composer.attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        previewUrl: `data:${attachment.mediaType};base64,${attachment.dataBase64}`,
      })),
      contextChips: state.composer.contextChips.map((chip) => ({
        id: chip.id,
        kind: chip.kind,
        label: chip.label,
        comment: chip.comment ?? "",
      })),
    },
    workbenchOpen: state.workbenchOpen,
    queuedInputs: state.queuedInputs,
    usage: createAgentChatUsageView(state.usage),
    liveActivity: liveTurnActivityView(state, chatState, visibleBlocks),
    errorMessage: state.errorMessage,
  };
}

// The "spawn a subagent" tool names that read as agents (Claude `Task`/`Agent`).
const AGENT_TOOL_TITLES = new Set(["task", "agent"]);

// Summarize the running turn's in-flight tool/agent activity for the Working
// indicator, so a long fan-out reads as alive rather than hung. Uses block status
// (pending/streaming) — the live signal codex and ACP stream as tools run. Claude
// marks tool_call `complete` on arrival and streams nothing during a Task fan-out,
// so its running-agent count is owned by the subagents watcher (Slice B), not here.
// Returns undefined when not running or nothing is in flight (the indicator then
// shows just the elapsed timer). See live-turn-activity-visibility.md.
function liveTurnActivityView(
  state: AgentChatShellState,
  chatState: AgentChatState,
  blocks: AgentChatBlock[],
): LiveTurnActivityView | undefined {
  if (chatState !== "running") {
    return undefined;
  }
  // Slice B: Claude `Task` fan-out subagent counts (from the subagents watcher) are
  // the richest signal for the case that streams nothing — they win when present.
  const nestedAgents = state.liveActivityEnrichment?.nestedAgents ?? 0;
  if (nestedAgents > 0) {
    const agentsLabel = `${nestedAgents} ${nestedAgents === 1 ? "agent" : "agents"}`;
    const calls = state.liveActivityEnrichment?.nestedToolCalls ?? 0;
    return {
      summaryLabel:
        calls > 0
          ? `${agentsLabel} · ${calls} tool ${calls === 1 ? "call" : "calls"}`
          : `${agentsLabel} running`,
    };
  }
  // Slice B′: codex/ACP plan step progress, for turns that report a plan.
  const planTotal = state.liveActivityEnrichment?.planTotal ?? 0;
  if (planTotal > 0) {
    const done = state.liveActivityEnrichment?.planCompleted ?? 0;
    return { summaryLabel: `${done}/${planTotal} steps` };
  }
  const inFlight = blocks.filter(
    (block) =>
      block.role === "tool" && (block.status === "pending" || block.status === "streaming"),
  );
  if (inFlight.length === 0) {
    return undefined;
  }
  const agentCount = inFlight.filter((block) =>
    AGENT_TOOL_TITLES.has((block.title ?? "").trim().toLowerCase()),
  ).length;
  if (agentCount > 0) {
    return { summaryLabel: `${agentCount} ${agentCount === 1 ? "agent" : "agents"} running` };
  }
  if (inFlight.length === 1) {
    const label = inFlight[0].title?.trim();
    if (label !== undefined && label.length > 0) {
      return { summaryLabel: label };
    }
  }
  return { summaryLabel: `${inFlight.length} tools running` };
}

// Formats raw usage into ready-to-render labels. Returns null when there is
// nothing meaningful to show (no tokens, no context percent, and no quota windows).
export function createAgentChatUsageView(usage: AgentChatUsage | null): AgentChatUsageView | null {
  if (usage === null) {
    return null;
  }
  const tokensLabel =
    usage.totalTokens !== undefined ? `${formatTokenCount(usage.totalTokens)} tokens` : undefined;
  const contextTokens = usage.contextTokens ?? usage.totalTokens;
  const contextTokensLabel =
    contextTokens !== undefined ? `${formatTokenCount(contextTokens)} tokens` : undefined;
  const contextPercentLabel =
    usage.contextUsedPercent !== undefined ? `${usage.contextUsedPercent}%` : undefined;
  const contextRemainingPercent =
    usage.contextUsedPercent !== undefined
      ? clampPercent(Math.round(100 - usage.contextUsedPercent))
      : undefined;
  const contextDetailLabel =
    contextTokens !== undefined && usage.contextWindow !== undefined
      ? `${formatTokenCount(contextTokens)} / ${formatTokenCount(usage.contextWindow)} tokens`
      : contextTokensLabel;
  const rateLimits = (usage.rateLimits ?? [])
    .map(rateLimitView)
    .filter((view): view is AgentChatUsageRateLimitView => view !== undefined);
  if (
    tokensLabel === undefined &&
    contextTokensLabel === undefined &&
    contextPercentLabel === undefined &&
    rateLimits.length === 0
  ) {
    return null;
  }
  return {
    ...(tokensLabel !== undefined ? { tokensLabel } : {}),
    ...(contextTokensLabel !== undefined ? { contextTokensLabel } : {}),
    ...(contextPercentLabel !== undefined ? { contextPercentLabel } : {}),
    ...(usage.contextUsedPercent !== undefined
      ? { contextUsedPercent: usage.contextUsedPercent }
      : {}),
    ...(contextRemainingPercent !== undefined
      ? {
          contextRemainingPercent,
          contextRemainingLabel: `${contextRemainingPercent}%`,
        }
      : {}),
    ...(contextDetailLabel !== undefined ? { contextDetailLabel } : {}),
    ...(rateLimits.length > 0 ? { rateLimits } : {}),
  };
}

// 1234 -> "1.2k", 12345 -> "12.3k", 999 -> "999".
function formatTokenCount(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens);
  }
  const thousands = tokens / 1000;
  if (thousands >= 100 || Number.isInteger(thousands)) {
    return `${Math.round(thousands)}k`;
  }
  return `${thousands.toFixed(1)}k`;
}

// Maps a provider quota window to a view row. Dropped when the provider gave no
// usage percent, since neither used nor remaining can be stated.
function rateLimitView(
  limit: NonNullable<AgentChatUsage["rateLimits"]>[number],
): AgentChatUsageRateLimitView | undefined {
  const label = limit.label ?? rateLimitWindowLabel(limit.windowMinutes);
  if (label === undefined || limit.usedPercent === undefined) {
    return undefined;
  }
  const usedPercent = clampPercent(Math.round(limit.usedPercent));
  const remainingPercent = clampPercent(Math.round(100 - limit.usedPercent));
  const resetLabel = formatResetLabel(limit.resetsAt, limit.windowMinutes);
  return {
    label,
    usedPercent,
    usedLabel: `${usedPercent}%`,
    remainingPercent,
    remainingLabel: `${remainingPercent}%`,
    ...(resetLabel !== undefined ? { resetLabel } : {}),
  };
}

function rateLimitWindowLabel(windowMinutes: number | undefined): string | undefined {
  if (windowMinutes === undefined) {
    return undefined;
  }
  if (windowMinutes === 10080) {
    return "Weekly";
  }
  if (windowMinutes === 1440) {
    return "Daily";
  }
  if (windowMinutes % 60 === 0) {
    return `${windowMinutes / 60}h`;
  }
  return `${windowMinutes}m`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

// When a quota window resets, formatted for the host locale. Sub-day windows
// (<= 1 day, e.g. the 5h window) show a clock time; weekly/longer windows show a
// calendar date — matching the Codex account menu. The time/date choice is
// driven by windowMinutes (deterministic); only the rendered string is locale
// dependent. Undefined when the provider gave no reset timestamp.
function formatResetLabel(
  resetsAt: number | undefined,
  windowMinutes: number | undefined,
): string | undefined {
  // Guard non-finite timestamps (NaN/Infinity from a malformed provider field):
  // an Invalid Date would otherwise render as the literal "Invalid Date".
  if (resetsAt === undefined || !Number.isFinite(resetsAt)) {
    return undefined;
  }
  const date = new Date(resetsAt * 1000);
  if (windowMinutes !== undefined && windowMinutes <= 1440) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// The Model chip opens the opencode on-ramp instead of the model menu when opencode
// is the selected agent and not yet usable (no connected vendor / no model).
function modelChipSurfaceForState(state: AgentChatShellState): "model_menu" | "opencode_model_provider" {
  const binding = state.thread?.agentBinding ?? state.composer.startOptions.agentBinding;
  return binding.agentId === "opencode" ? "opencode_model_provider" : "model_menu";
}

function modelLabelForState(state: AgentChatShellState): string {
  const binding = state.thread?.agentBinding ?? state.composer.startOptions.agentBinding;
  const launchOptions = launchOptionsForState(state);
  const model = String(launchOptions?.model ?? defaultModelValueForAgent(binding.agentId));
  const catalog = state.availableProviderCatalogs?.[binding.agentId];
  // codex exposes a reasoning effort; show it next to the model so the chip
  // reflects the real setting (not a hardcoded level).
  if (binding.agentId === "codex") {
    const reasoning = String(launchOptions?.reasoning ?? "medium");
    return `${codexModelLabel(model)} · ${reasoningLabel(reasoning)}`;
  }
  if (binding.agentId === "claude") {
    const effort = String(launchOptions?.reasoning ?? "high");
    return `${modelLabelForAgent("claude", model, catalog)} · ${reasoningLabel(effort)}`;
  }
  return modelLabelForAgent(binding.agentId, model, catalog);
}

function reasoningLabel(reasoning: string): string {
  return reasoning === "xhigh" ? "Extra High" : capitalize(reasoning);
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

// The most recent of several chip-feedback entries (largest `at`), or undefined
// when none is set. Used to fold model + reasoning feedback onto the Model chip.
function mostRecentFeedback(
  ...feedback: Array<LaunchOptionFeedback | undefined>
): LaunchOptionFeedback | undefined {
  return feedback
    .filter((entry): entry is LaunchOptionFeedback => entry !== undefined)
    .sort((a, b) => b.at - a.at)[0];
}

function deriveChatState(
  state: AgentChatShellState,
  visibleBlocks: AgentChatBlock[],
): AgentChatState {
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
  if (
    state.runtimeState === "starting" ||
    state.runtimeState === "running" ||
    (state.thread?.live === true && state.thread?.lastKnownState === "running")
  ) {
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
  if (state.hydrating && visibleBlocks.length === 0) {
    return "hydrating";
  }
  return "ready";
}

type VisibleBlocksCache = {
  sourceBlocks: AgentChatBlock[];
  threadId: string | undefined;
  visibleBlocks: AgentChatBlock[];
};

type BlockViewsCache = {
  visibleBlocks: AgentChatBlock[];
  blockViews: AgentChatBlockView[];
};

let visibleBlocksCache: VisibleBlocksCache | undefined;
let blockViewsCache: BlockViewsCache | undefined;
// Reducers replace a block object when provider output changes, so the same object
// reference can safely reuse its derived view across draft-only state updates.
const blockViewBySource = new WeakMap<AgentChatBlock, AgentChatBlockView>();

function visibleBlocksForState(state: AgentChatShellState): AgentChatBlock[] {
  const threadId = state.thread?.threadId;
  if (
    visibleBlocksCache !== undefined &&
    visibleBlocksCache.sourceBlocks === state.blocks &&
    visibleBlocksCache.threadId === threadId
  ) {
    return visibleBlocksCache.visibleBlocks;
  }
  const visibleBlocks =
    threadId === undefined
      ? state.blocks
      : state.blocks.filter((block) => block?.threadId === threadId);
  visibleBlocksCache = {
    sourceBlocks: state.blocks,
    threadId,
    visibleBlocks,
  };
  return visibleBlocks;
}

function blockViewsForVisibleBlocks(blocks: AgentChatBlock[]): AgentChatBlockView[] {
  if (blockViewsCache !== undefined && blockViewsCache.visibleBlocks === blocks) {
    return blockViewsCache.blockViews;
  }
  const blockViews = blocks.map(blockViewForSourceBlock);
  blockViewsCache = { visibleBlocks: blocks, blockViews };
  return blockViews;
}

function blockViewForSourceBlock(block: AgentChatBlock): AgentChatBlockView {
  const cached = blockViewBySource.get(block);
  if (cached !== undefined) {
    return cached;
  }
  const view = toBlockView(block);
  blockViewBySource.set(block, view);
  return view;
}

// The agent's live checklist = the latest "plan" block's entries. Providers re-emit
// the whole list to one stable block, so the last plan block is the current state.
// Returns null when there is no plan block or it has no entries (panel hides the
// checklist then). See docs_v2/specs/thread-goal-and-checklist-panel.md.
function deriveChecklist(blocks: AgentChatBlock[]): AgentChatChecklistView | null {
  let planBlock: AgentChatBlock | undefined;
  for (const block of blocks) {
    if (block.kind === "plan") {
      planBlock = block;
    }
  }
  if (planBlock === undefined) {
    return null;
  }
  const entries = checklistEntries(planBlock.data);
  if (entries.length === 0) {
    return null;
  }
  const doneCount = entries.filter((entry) => entry.status === "done").length;
  const title = typeof planBlock.data?.title === "string" ? planBlock.data.title : undefined;
  return {
    entries,
    doneCount,
    totalCount: entries.length,
    ...(title !== undefined ? { title } : {}),
  };
}

function checklistEntries(data: Record<string, unknown> | undefined): AgentChatChecklistEntry[] {
  const raw = data?.entries;
  if (!Array.isArray(raw)) {
    return [];
  }
  const entries: AgentChatChecklistEntry[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const fields = item as Record<string, unknown>;
    const text = typeof fields.text === "string" ? fields.text : undefined;
    if (text === undefined || text.trim().length === 0) {
      continue;
    }
    entries.push({ text, status: checklistStatus(fields.status) });
  }
  return entries;
}

function checklistStatus(value: unknown): AgentChatChecklistStatus {
  return value === "in_progress" || value === "done" ? value : "pending";
}

function toBlockView(block: AgentChatBlock): AgentChatBlockView {
  const body = block.body ?? block.rawFallback ?? block.title ?? "";
  const nativeEvidence = nativeEvidenceForBlock(block);
  const view: AgentChatBlockView = {
    blockId: block.blockId,
    kind: block.kind,
    role: block.role,
    status: block.status,
    phase: agentBlockPhase(block),
    title: block.title ?? formatBlockKind(block.kind),
    body,
    rawFallback: block.rawFallback,
    nativeEvidence,
    nativeEvidenceLabel: nativeEvidenceLabel(nativeEvidence),
  };
  if (block.parentBlockId !== undefined) {
    view.parentBlockId = block.parentBlockId;
  }
  return view;
}

function agentBlockPhase(block: AgentChatBlock): AgentChatBlockPhase | undefined {
  if (block.role !== "agent") {
    return undefined;
  }
  const phase = block.data?.phase;
  if (phase === "commentary" || phase === "final_answer") {
    return phase;
  }
  return undefined;
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

  if (thread.context?.branch) {
    items.push({ label: "Branch", value: thread.context.branch });
  }
  if (thread.context?.worktree) {
    items.push({
      label: "Environment",
      value: thread.context.worktree === "current folder" ? "Local" : thread.context.worktree,
    });
  }

  return items;
}

function startContextItems(
  options: AgentChatStartOptions,
  state: AgentChatShellState,
): AgentChatContextItem[] {
  const scope = options.scope;
  const projectOrScratch =
    scope?.kind === "project"
      ? { label: "Project" as const, value: scope.projectId }
      : { label: "Scratch" as const, value: scope?.scratchCwd || "Scratch" };

  const branch = String(options.launchOptions?.branch ?? "main");
  const pendingWorktreeBranch =
    options.launchOptions?.worktree === "new" && typeof options.launchOptions?.newWorktreeName === "string"
      ? options.launchOptions.newWorktreeName.trim()
      : "";
  const branchValue = pendingWorktreeBranch.length > 0 ? pendingWorktreeBranch : branch;

  return [
    {
      label: "Agent",
      value: formatAgentLabel(options.agentBinding.agentId),
      runtimeSourceKind: runtimeSourceForBinding(options.agentBinding).kind,
      agentId: options.agentBinding.agentId,
    },
    projectOrScratch,
    { label: "Branch", value: branchValue },
    {
      label: "Environment",
      value: environmentContextValue(options, state.availableWorktrees ?? []),
    },
  ];
}

function formatBlockKind(kind: string): string {
  return kind
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
