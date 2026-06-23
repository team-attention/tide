import type { AgentRuntimeStateDto, AgentRuntimeUsageDto, LiveTurnActivityDto } from "./agent-runtime.ts";
import type { AgentSessionBlockDto } from "./agent-session-block.ts";
import type {
  WorkspaceCodeCompletionDto,
  WorkspaceCodeDiagnosticDto,
  WorkspaceCodeHoverDto,
  WorkspaceCodeIntelKindDto,
  WorkspaceCodeLocationDto,
  WorkspaceCodeRangeDto,
  WorkspaceCodeReferencesDto,
  WorkspaceCodeSignatureHelpDto,
} from "./code-intel.ts";
import type { ContractErrorPayload } from "./errors.ts";
import type {
  BackendConnectionChangedPayload,
  BackendSnapshotReadyPayload,
  BackendSnapshotRequestedPayload,
} from "./connection.ts";
import type { RequestId, ThreadId } from "./ids.ts";
import type { ProviderCliAgentId } from "./agent.ts";
import type { OpencodeEnvironmentDto, OpencodeVendorDto } from "./opencode-vendor.ts";
import type { ProviderModelDto } from "./provider-model-catalog.ts";
import type { JsonObject } from "./json.ts";
import type { PromptStateDto } from "./prompt.ts";
import type { ProviderReadinessDto } from "./provider-readiness.ts";
import type { ThreadSummaryDto } from "./thread.ts";
import type { WorkbenchFileTreeDto, WorkbenchLayoutModeDto, WorkbenchPaneRefDto } from "./workbench.ts";

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
  | "thread.launchOptionsChanged"
  | "agentRuntime.stateChanged"
  | "agentRuntime.usageChanged"
  | "agentRuntime.activityChanged"
  | "agentRuntime.commandsChanged"
  | "agentRuntime.modelCatalogChanged"
  | "agentRuntime.noticePosted"
  | "providerReadiness.changed"
  | "providerCatalog.changed"
  | "prompt.changed"
  | "agentSessionBlock.upserted"
  | "agentSessionBlock.completed"
  | "workbench.changed"
  | "workbench.terminalOutput"
  | "workspace.fileTreeLoaded"
  | "workspace.contentSearchResults"
  | "workspace.codeIntelResult"
  | "workspace.fileLoaded"
  | "workspace.imageLoaded"
  | "workspace.fileSaved";

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
  "thread.launchOptionsChanged",
  "agentRuntime.stateChanged",
  "agentRuntime.usageChanged",
  "agentRuntime.activityChanged",
  "agentRuntime.commandsChanged",
  "agentRuntime.modelCatalogChanged",
  "agentRuntime.noticePosted",
  "providerReadiness.changed",
  "providerCatalog.changed",
  "prompt.changed",
  "agentSessionBlock.upserted",
  "agentSessionBlock.completed",
  "workbench.changed",
  "workbench.terminalOutput",
  "workspace.fileTreeLoaded",
  "workspace.contentSearchResults",
  "workspace.codeIntelResult",
  "workspace.fileLoaded",
  "workspace.imageLoaded",
  "workspace.fileSaved",
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
    // Provider-CLI agents detected on the local system (their executable resolves).
    // The composer agent menu enables these and shows the rest disabled (never
    // removed). Absent = older backend; the UI then treats all as available. This is
    // `which`-based and fast, so thread.listed is never blocked behind opencode's
    // slower catalog subprocesses (delivered separately via providerCatalog.changed).
    availableAgents?: ProviderCliAgentId[];
  };
  // opencode's catalog (vendors / models / version), delivered OUT OF BAND from thread.listed
  // so the agent menu (availableAgents) is never gated behind opencode's slower subprocesses
  // (`opencode models`/`auth list`/`--version`). Pushed once at startup (off the critical path)
  // and again after a vendor connect. See provider-cli-setup-handoff.md.
  "providerCatalog.changed": {
    // opencode's authed model catalog (enumerated via `opencode models`); a multi-vendor router,
    // so per-user, not hand-curated. Absent ⇒ not yet enumerated (composer uses "opencode default").
    opencodeModels?: ProviderModelDto[];
    // opencode's vendor tiles (curated popular set + any connected-but-uncurated vendor) with
    // connected-state from `opencode auth list` — drives the "Connect a model" on-ramp grid.
    opencodeVendors?: OpencodeVendorDto[];
    // opencode version + tested-with + resolved executable path (for the readiness terminal auth login).
    opencodeEnvironment?: OpencodeEnvironmentDto;
  };
  "thread.hydrated": {
    thread: ThreadSummaryDto;
    blocks?: AgentSessionBlockDto[];
    providerReadiness?: ProviderReadinessDto;
    runtimeState?: AgentRuntimeStateDto;
    // The thread's pending prompt (approval/question), or null when none. Hydrate
    // is the source of truth on thread open: without it, switching into a thread
    // that is waiting on a prompt shows no card — an invisible hang.
    prompt?: PromptStateDto | null;
    workbenchPanes?: WorkbenchPaneRefDto[];
    // The Thread's Stacked/Split Workbench presentation (absent = older backend;
    // renderer keeps its current mode).
    workbenchLayoutMode?: WorkbenchLayoutModeDto;
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
  // The thread's Launch Options changed mid-thread (model/permission/reasoning).
  // Persisted like rename/pin so the change survives restart.
  "thread.launchOptionsChanged": {
    thread: ThreadSummaryDto;
    // How the change took effect, so the renderer can show the chip feedback:
    // "live" = the running session was reconfigured now; "next_turn" = a
    // transparent restart applies it at the next message; "none" = no live
    // change. Optional for backward compatibility (older backend ⇒ no feedback).
    applied?: "live" | "next_turn" | "none";
    // The Launch Option keys that actually differed (⊆ model/permission/reasoning).
    // Empty/absent ⇒ nothing changed ⇒ the renderer shows no feedback.
    changedKeys?: string[];
  };
  "agentRuntime.stateChanged": {
    threadId: ThreadId;
    state: AgentRuntimeStateDto;
    changedAt: string;
    // The thread's follow-up queue after this transition (head-first). Lets the
    // renderer reflect a flush (queue shrank) live. Absent → unchanged.
    queuedInputs?: string[];
  };
  "agentRuntime.usageChanged": {
    threadId: ThreadId;
    usage: AgentRuntimeUsageDto;
  };
  // Live in-flight-turn activity not carried by the provider stream (Claude Task
  // fan-out subagent counts). Emitted while running; an all-undefined activity
  // clears it at turn end. See live-turn-activity-visibility.md (Slice B).
  "agentRuntime.activityChanged": {
    threadId: ThreadId;
    activity: LiveTurnActivityDto;
  };
  // The agent's available slash-commands (trigger "/") and skills (trigger "$"),
  // captured from the provider protocol at session start. Per agent.
  "agentRuntime.commandsChanged": {
    // Present for a live thread's session; omitted for a Start-Composer command
    // probe (no thread yet) — see provider.discoverCommands. `cwd` scopes a probe
    // reply so a stale in-flight result can be ignored after the scope changes.
    threadId?: ThreadId;
    agentId: ProviderCliAgentId;
    cwd?: string;
    commands: Array<{ name: string; description: string; trigger: "/" | "$" }>;
  };
  // The agent self-reported its model catalog over the protocol (gemini ACP
  // availableModels / opencode configOptions) — the live current model + the real
  // available list, so the composer menu reflects reality not a static guess.
  "agentRuntime.modelCatalogChanged": {
    threadId: ThreadId;
    agentId: ProviderCliAgentId;
    models: ProviderModelDto[];
    currentModel?: string;
  };
  // A non-blocking, out-of-band runtime notice (e.g. an "update available"
  // banner the provider CLI printed). Surfaced as a native OS notification.
  "agentRuntime.noticePosted": {
    threadId: ThreadId;
    agentId: ProviderCliAgentId;
    level: "info";
    message: string;
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
    // The Thread's Stacked/Split presentation after this change (absent = unchanged).
    layoutMode?: WorkbenchLayoutModeDto;
    fileTree?: WorkbenchFileTreeDto;
  };
  "workbench.terminalOutput": {
    threadId: ThreadId;
    paneId: string;
    source: "stdout" | "stderr";
    chunk: string;
  };
  // A file tree read for an arbitrary directory (start page), not tied to a thread.
  "workspace.fileTreeLoaded": {
    cwd: string;
    fileTree: WorkbenchFileTreeDto;
  };
  // Project-wide content search results for the Cmd+Shift+F finder.
  "workspace.contentSearchResults": {
    cwd: string;
    query: string;
    matches: WorkspaceContentSearchMatchDto[];
    fileCount: number;
    truncated: boolean;
  };
  // A legacy thread-independent file read (same requestId as the workspace.readFile
  // command).
  "workspace.fileLoaded": {
    cwd: string;
    relativePath: string;
    content: string;
    truncated: boolean;
  };
  // A bounded base64 image read for Workbench Image Pane display (same requestId
  // as the workspace.readImageFile command).
  "workspace.imageLoaded": {
    cwd: string;
    relativePath: string;
    mimeType: string;
    dataBase64: string;
    byteLength: number;
  };
  // A legacy thread-independent file write completed (same requestId as the
  // workspace.writeFile command).
  "workspace.fileSaved": {
    cwd: string;
    relativePath: string;
    content: string;
    truncated: boolean;
  };
  // Answer to a workspace.codeIntel query (same requestId). `ok:false` carries
  // a human-readable `message` (e.g. no language support for the file); the
  // editor then simply shows nothing. Spec: workbench-editor-language-intelligence.
  "workspace.codeIntelResult": {
    kind: WorkspaceCodeIntelKindDto;
    ok: boolean;
    message?: string;
    completions?: WorkspaceCodeCompletionDto[];
    hover?: WorkspaceCodeHoverDto | null;
    highlights?: WorkspaceCodeRangeDto[];
    signature?: WorkspaceCodeSignatureHelpDto | null;
    diagnostics?: WorkspaceCodeDiagnosticDto[];
    definition?: WorkspaceCodeLocationDto | null;
    references?: WorkspaceCodeReferencesDto;
  };
}

export interface WorkspaceContentSearchMatchDto {
  relativePath: string;
  line: number;
  column: number;
  lineText: string;
}
