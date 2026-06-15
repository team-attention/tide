import type { AgentChatBlock, AgentChatBlockView, AgentChatContextItem, AgentChatShellState, AgentChatShellViewModel, AgentChatStartOptions, AgentChatState, AgentChatThreadSummary, AgentChatUsage, AgentChatUsageView } from "./types.ts";
import { codexModelLabel, defaultModelValueForAgent, defaultPermissionForAgent, formatAgentLabel, modelLabelForAgent, permissionLabelForValue, runtimeSourceForBinding } from "./agent-vocab.ts";
import { createActiveComposerSurface } from "./choice-surfaces.ts";
import { isOpencodeUsable } from "./opencode-onramp.ts";
import { launchOptionsForState, worktreeContextValue } from "./launch-options.ts";
// Extracted from agent-chat-shell-state.ts (spec: navigable-source-structure).

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
      modelChipSurface: modelChipSurfaceForState(state),
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
        comment: chip.comment ?? "",
      })),
    },
    workbenchOpen: state.workbenchOpen,
    queuedInputs: state.queuedInputs,
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

// The Model chip opens the opencode on-ramp instead of the model menu when opencode
// is the selected agent and not yet usable (no connected vendor / no model).
function modelChipSurfaceForState(state: AgentChatShellState): "model_menu" | "opencode_connect" {
  const binding = state.thread?.agentBinding ?? state.composer.startOptions.agentBinding;
  return binding.agentId === "opencode" && !isOpencodeUsable() ? "opencode_connect" : "model_menu";
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
      value: worktreeContextValue(options.launchOptions),
    },
    { label: "Branch", value: String(options.launchOptions?.branch ?? "main") },
  ];
}

function formatBlockKind(kind: string): string {
  return kind
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
