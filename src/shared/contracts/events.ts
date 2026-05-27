import type { AgentRuntimeStateDto } from "./agent-runtime.ts";
import type { AgentSessionBlockDto } from "./agent-session-block.ts";
import type { ContractErrorPayload } from "./errors.ts";
import type {
  BackendConnectionChangedPayload,
  BackendSnapshotReadyPayload,
  BackendSnapshotRequestedPayload,
} from "./connection.ts";
import type { RequestId, ThreadId } from "./ids.ts";
import type { JsonObject } from "./json.ts";
import type { PromptStateDto } from "./prompt.ts";
import type { ProviderReadinessDto } from "./provider-readiness.ts";
import type { ThreadSummaryDto } from "./thread.ts";
import type { WorkbenchPaneRefDto } from "./workbench.ts";

export type BackendEventKind =
  | "backend.connectionChanged"
  | "backend.snapshotRequested"
  | "backend.snapshotReady"
  | "command.accepted"
  | "command.completed"
  | "contract.error"
  | "thread.hydrated"
  | "thread.started"
  | "agentRuntime.stateChanged"
  | "providerReadiness.changed"
  | "prompt.changed"
  | "agentSessionBlock.upserted"
  | "agentSessionBlock.completed"
  | "workbench.changed";

export const BACKEND_EVENT_KINDS: BackendEventKind[] = [
  "backend.connectionChanged",
  "backend.snapshotRequested",
  "backend.snapshotReady",
  "command.accepted",
  "command.completed",
  "contract.error",
  "thread.hydrated",
  "thread.started",
  "agentRuntime.stateChanged",
  "providerReadiness.changed",
  "prompt.changed",
  "agentSessionBlock.upserted",
  "agentSessionBlock.completed",
  "workbench.changed",
];

export interface BackendEventPayloadByKind {
  "backend.connectionChanged": BackendConnectionChangedPayload;
  "backend.snapshotRequested": BackendSnapshotRequestedPayload;
  "backend.snapshotReady": BackendSnapshotReadyPayload;
  "command.accepted": {
    requestId: RequestId;
    acceptedAt: string;
  };
  "command.completed": {
    result?: JsonObject;
  };
  "contract.error": ContractErrorPayload;
  "thread.hydrated": {
    thread: ThreadSummaryDto;
    blocks?: AgentSessionBlockDto[];
    providerReadiness?: ProviderReadinessDto;
    runtimeState?: AgentRuntimeStateDto;
    workbenchPanes?: WorkbenchPaneRefDto[];
  };
  "thread.started": {
    thread: ThreadSummaryDto;
    runtimeState: AgentRuntimeStateDto;
  };
  "agentRuntime.stateChanged": {
    threadId: ThreadId;
    state: AgentRuntimeStateDto;
    changedAt: string;
  };
  "providerReadiness.changed": {
    threadId?: ThreadId;
    readiness: ProviderReadinessDto;
  };
  "prompt.changed": {
    threadId: ThreadId;
    prompt: PromptStateDto | null;
  };
  "agentSessionBlock.upserted": {
    block: AgentSessionBlockDto;
  };
  "agentSessionBlock.completed": {
    blockId: string;
    threadId: ThreadId;
    status: "complete" | "failed";
    completedAt: string;
    error?: ContractErrorPayload;
  };
  "workbench.changed": {
    threadId: ThreadId;
    panes: WorkbenchPaneRefDto[];
  };
}
