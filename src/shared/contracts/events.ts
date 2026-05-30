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
import type { WorkbenchFileTreeDto, WorkbenchPaneRefDto } from "./workbench.ts";

export type BackendEventKind =
  | "backend.connectionChanged"
  | "backend.snapshotRequested"
  | "backend.snapshotReady"
  | "command.accepted"
  | "command.completed"
  | "contract.error"
  | "thread.listed"
  | "thread.hydrated"
  | "thread.started"
  | "thread.archived"
  | "thread.pinChanged"
  | "thread.renamed"
  | "agentRuntime.stateChanged"
  | "providerReadiness.changed"
  | "prompt.changed"
  | "agentSessionBlock.upserted"
  | "agentSessionBlock.completed"
  | "workbench.changed"
  | "workbench.terminalOutput";

export const BACKEND_EVENT_KINDS: BackendEventKind[] = [
  "backend.connectionChanged",
  "backend.snapshotRequested",
  "backend.snapshotReady",
  "command.accepted",
  "command.completed",
  "contract.error",
  "thread.listed",
  "thread.hydrated",
  "thread.started",
  "thread.archived",
  "thread.pinChanged",
  "thread.renamed",
  "agentRuntime.stateChanged",
  "providerReadiness.changed",
  "prompt.changed",
  "agentSessionBlock.upserted",
  "agentSessionBlock.completed",
  "workbench.changed",
  "workbench.terminalOutput",
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
  "thread.listed": {
    threads: ThreadSummaryDto[];
  };
  "thread.hydrated": {
    thread: ThreadSummaryDto;
    blocks?: AgentSessionBlockDto[];
    providerReadiness?: ProviderReadinessDto;
    runtimeState?: AgentRuntimeStateDto;
    workbenchPanes?: WorkbenchPaneRefDto[];
    fileTree?: WorkbenchFileTreeDto;
  };
  "thread.started": {
    thread: ThreadSummaryDto;
    runtimeState: AgentRuntimeStateDto;
  };
  "thread.archived": {
    thread: ThreadSummaryDto;
  };
  "thread.pinChanged": {
    thread: ThreadSummaryDto;
  };
  "thread.renamed": {
    thread: ThreadSummaryDto;
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
    activePaneId?: string;
    fileTree?: WorkbenchFileTreeDto;
  };
  "workbench.terminalOutput": {
    threadId: ThreadId;
    paneId: string;
    source: "stdout" | "stderr";
    chunk: string;
  };
}
