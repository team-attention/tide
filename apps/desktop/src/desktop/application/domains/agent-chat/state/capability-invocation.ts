import { setComposerActiveSurface } from "./composer.ts";
import type { AgentChatShellState, AgentChatShellUpdateResult } from "./types.ts";

export function invokeComposerCapabilityRow(
  state: AgentChatShellState,
  capabilityId: string,
  activeThreadId?: string,
): AgentChatShellUpdateResult {
  const capability = state.availableCapabilities?.find((candidate) => candidate.capabilityId === capabilityId);
  if (capability === undefined || !capability.available) {
    return setComposerActiveSurface(state, null);
  }
  const threadId = state.thread?.threadId ?? activeThreadId;
  if (threadId === undefined) {
    return setComposerActiveSurface(state, null);
  }
  if (capability.invoke.kind === "tide_surface" && capability.invoke.surface === "review") {
    return {
      state: {
        ...state,
        composer: { ...state.composer, activeSurface: null },
      },
      command: {
        kind: "workbench.command",
        payload: {
          threadId,
          command: "open_review",
        },
      },
    };
  }
  if (capability.invoke.kind !== "provider_method") {
    return setComposerActiveSurface(state, null);
  }
  return {
    state: {
      ...state,
      composer: { ...state.composer, activeSurface: null },
    },
    command: {
      kind: "provider.invokeCapability",
      payload: {
        threadId,
        capabilityId: capability.capabilityId,
        invoke: capability.invoke,
      },
    },
  };
}
