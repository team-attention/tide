import type { AgentRuntimeState } from "../../domains/agent-runtime/agent-runtime.ts";
import type { ProviderReadinessResult } from "../../domains/provider-readiness/provider-readiness.ts";
import type {
  AgentSessionBlockReference,
  ProviderCliAgentId,
  ThreadId,
  ThreadSnapshot,
} from "../../domains/thread/thread.ts";
import type { WorkbenchPaneId } from "../../domains/workbench/workbench.ts";

// The async event vocabulary the Backend pushes to Desktop outside a direct
// command response (background turns, terminal output, readiness/state changes).
// Extracted from thread-runtime-service.ts so collaborators can emit events
// without importing the facade.

export type ThreadRuntimeAsyncEvent =
  | {
      kind: "workbench_changed";
      thread: ThreadSnapshot;
    }
  | {
      kind: "provider_readiness_changed";
      threadId: ThreadId;
      readiness: ProviderReadinessResult;
    }
  | {
      kind: "provider_catalog_refresh_requested";
      agentId: ProviderCliAgentId;
    }
  | {
      kind: "agent_session_block_upserted";
      thread: ThreadSnapshot;
      block: AgentSessionBlockReference;
    }
  | {
      kind: "agent_runtime_state_changed";
      thread: ThreadSnapshot;
      runtimeState: AgentRuntimeState;
    }
  | {
      kind: "thread_hydrated";
      thread: ThreadSnapshot;
      runtimeState: AgentRuntimeState;
      blocks: AgentSessionBlockReference[];
    }
  | {
      kind: "workbench_terminal_output";
      threadId: ThreadId;
      paneId: WorkbenchPaneId;
      source: "stdout" | "stderr";
      chunk: string;
    };
