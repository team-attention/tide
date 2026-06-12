import type { AgentChatShellState, AgentChatStartOptions, AgentChatThreadScope } from "./types.ts";
import { runtimeSourceForAgent } from "./agent-vocab.ts";
// Extracted from agent-chat-shell-state.ts (spec: navigable-source-structure).

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
    queuedInputs: [],
    usage: null,
  };
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
