import type { AgentChatBackendEvent, AgentChatBlock, AgentChatPromptState, AgentChatProviderReadiness, AgentChatShellState, AgentChatThreadSummary, AgentRuntimeStateName, LaunchOptionFeedback } from "./types.ts";
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
        workbenchPanes?: unknown[];
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
        // Launch-option chip feedback is per-thread and transient — a fresh hydrate
        // (thread switch) must not carry the previous thread's badges.
        launchOptionFeedback: {},
        workbenchOpen:
          payload.workbenchPanes === undefined
            ? state.workbenchOpen
            : payload.workbenchPanes.length > 0,
      };
    }
    case "agentRuntime.usageChanged": {
      const payload = event.payload as {
        usage?: {
          totalTokens?: number;
          contextWindow?: number;
          contextUsedPercent?: number;
          model?: string;
          rateLimits?: Array<{
            label?: string;
            usedPercent?: number;
            windowMinutes?: number;
            resetsAt?: number;
          }>;
        };
      };
      if (payload.usage === undefined) {
        return state;
      }
      const previous: NonNullable<AgentChatShellState["usage"]> = state.usage ?? {};
      return {
        ...state,
        usage: {
          totalTokens: payload.usage.totalTokens ?? previous.totalTokens,
          contextWindow: payload.usage.contextWindow ?? previous.contextWindow,
          contextUsedPercent: payload.usage.contextUsedPercent ?? previous.contextUsedPercent,
          model: payload.usage.model ?? previous.model,
          rateLimits: payload.usage.rateLimits ?? previous.rateLimits,
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
        launchOptionFeedback: {},
      };
    }
    case "thread.launchOptionsChanged": {
      // Backend confirmation of a mid-thread model/permission/effort change
      // (this surface patched optimistically; another window or a send-time
      // merge may not have). Only for the thread on screen.
      const payload = event.payload as {
        thread?: AgentChatThreadSummary;
        applied?: "live" | "next_turn" | "none";
        changedKeys?: string[];
      };
      const summary = payload.thread;
      if (
        summary === undefined ||
        state.thread === null ||
        state.thread.threadId !== summary.threadId
      ) {
        return state;
      }
      // Chip feedback: "live" → applied (brief flash); a real change that is not
      // live ("next_turn", or "none" with changed keys = no live runtime yet) →
      // pending (applies on the next message). No changed keys ⇒ leave feedback
      // untouched. See docs_v2/specs/mid-thread-launch-option-feedback.md.
      const changedKeys = payload.changedKeys ?? [];
      const feedbackState: LaunchOptionFeedback["state"] =
        payload.applied === "live" ? "applied" : "pending";
      // A deterministic, monotonically increasing token (NOT Date.now() — the
      // reducer stays pure) so a repeat change to the same chip re-arms its flash.
      const at =
        Math.max(0, ...Object.values(state.launchOptionFeedback).map((f) => f.at)) + 1;
      const feedback =
        changedKeys.length === 0
          ? state.launchOptionFeedback
          : changedKeys.reduce<Record<string, LaunchOptionFeedback>>(
              (acc, key) => ({ ...acc, [key]: { state: feedbackState, at } }),
              { ...state.launchOptionFeedback },
            );
      return {
        ...state,
        thread: { ...state.thread, launchOptions: summary.launchOptions },
        launchOptionFeedback: feedback,
      };
    }
    case "thread.goalSet": {
      // Backend confirmation that the goal was set/cleared. Reflect it on the active
      // thread so the Goal & Checklist panel updates. Only for the thread on screen.
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
        thread: { ...state.thread, goal: summary.goal },
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
      const turnStarting = !wasActive && isActive;
      const nextThread =
        turnStarting && state.thread !== null && payload.changedAt !== undefined
          ? { ...state.thread, runtimeStartedAt: payload.changedAt }
          : state.thread;
      return {
        ...state,
        runtimeState: payload.state,
        thread: nextThread,
        // The backend is authoritative for the follow-up queue: reflect it on every
        // transition (a flush shrinks it). Absent → keep the optimistic list.
        queuedInputs: payload.queuedInputs ?? state.queuedInputs,
        // A new turn started — any "applies on the next message" (pending) chip
        // change has now been applied (the restart respawns at turn start), and an
        // "applied" flash has long faded. Clear the chip feedback on this edge only.
        launchOptionFeedback: turnStarting ? {} : state.launchOptionFeedback,
      };
    }
    case "providerReadiness.changed": {
      const payload = event.payload as { readiness: AgentChatProviderReadiness };
      return {
        ...state,
        providerReadiness: payload.readiness,
        // The readiness re-check came back; the trust/readiness action is done.
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
      const payload = event.payload as { panes?: unknown[] };
      return {
        ...state,
        workbenchOpen: (payload.panes ?? []).length > 0,
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
