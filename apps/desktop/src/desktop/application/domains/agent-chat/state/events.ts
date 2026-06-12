import type { AgentChatBackendEvent, AgentChatBlock, AgentChatPromptState, AgentChatProviderReadiness, AgentChatShellState, AgentChatThreadSummary, AgentRuntimeStateName } from "./types.ts";
// Extracted from agent-chat-shell-state.ts (spec: navigable-source-structure).

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
        prompt?: AgentChatPromptState | null;
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
        // Hydrate is the source of truth for the pending prompt: a thread opened
        // while waiting on an approval/question must show its card (it surfaced
        // as prompt.changed before this thread was on screen). `undefined` =
        // old-style payload without the field; keep whatever we had.
        promptState: payload.prompt !== undefined ? payload.prompt : state.promptState,
        // Seed the queue from the backend's authoritative snapshot (the renderer
        // never guesses it). Absent only on old payloads → keep what we have.
        queuedInputs: payload.thread.queuedInputs ?? state.queuedInputs,
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
        queuedInputs: [],
      };
    }
    case "thread.launchOptionsChanged": {
      // Backend confirmation of a mid-thread model/permission/effort change
      // (this surface patched optimistically; another window or a send-time
      // merge may not have). Only for the thread on screen.
      const payload = event.payload as { thread?: AgentChatThreadSummary };
      const summary = payload.thread;
      if (
        summary === undefined ||
        state.thread === null ||
        state.thread.threadId !== summary.threadId
      ) {
        return state;
      }
      return {
        ...state,
        thread: { ...state.thread, launchOptions: summary.launchOptions },
      };
    }
    case "agentRuntime.stateChanged": {
      const payload = event.payload as {
        state: AgentRuntimeStateName;
        changedAt?: string;
        queuedInputs?: string[];
      };
      // Re-anchor the working timer to the NEW turn's start. `changedAt` is when
      // the runtime went active (= the turn start). Only on the non-active →
      // active edge, so a redundant "running" event can't reset it mid-turn.
      // Without this, stateChanged only updated runtimeState and the timer kept
      // the FIRST turn's runtimeStartedAt — so "Working… Xs" counted from the
      // session start across every later turn.
      const wasActive = state.runtimeState === "running" || state.runtimeState === "starting";
      const isActive = payload.state === "running" || payload.state === "starting";
      const nextThread =
        !wasActive && isActive && state.thread !== null && payload.changedAt !== undefined
          ? { ...state.thread, runtimeStartedAt: payload.changedAt }
          : state.thread;
      return {
        ...state,
        runtimeState: payload.state,
        thread: nextThread,
        // The backend is authoritative for the follow-up queue: reflect it on every
        // transition (a flush shrinks it). Absent → keep the optimistic list.
        queuedInputs: payload.queuedInputs ?? state.queuedInputs,
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
      // The queue is backend-authoritative now (agentRuntime.stateChanged carries it),
      // so a user block never mutates queuedInputs here — no more guessing/desync.
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
      // A stale/duplicate prompt answer (double-click, card already promoted
      // away, runtime just stopped) is NOT a thread failure: the backend simply
      // rejected one command, and the authoritative prompt/runtime state arrives
      // via prompt.changed / stateChanged. Flipping the whole thread to "failed"
      // here marked HEALTHY threads failed (adversarial review finding).
      const message = payload.message ?? "Contract error";
      if (/Prompt State/.test(message)) {
        return state;
      }
      return {
        ...state,
        runtimeState: "failed",
        errorMessage: message,
      };
    }
    default:
      return state;
  }
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
