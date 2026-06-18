import type {
  AgentBinding,
  ThreadId,
  ThreadLifecycleState,
  ThreadRecord,
  ThreadScope,
} from "../../domains/thread/thread.ts";
import type { TerminalPaneState } from "../../domains/workbench/workbench.ts";
import { failure, type ServiceResult } from "../support/service-result.ts";
import { titleFromMessage } from "../support/service-value-helpers.ts";
import {
  cloneAgentBinding,
  cloneLaunchOptions,
  cloneScope,
  defaultWorkbenchState,
} from "./thread-runtime-clone.ts";
import { snapshotThread } from "./thread-snapshot.ts";
import type { ThreadStore } from "./thread-store.ts";
import type {
  CreateDraftThreadInput,
  CreateDraftThreadResult,
  DiscardDraftThreadInput,
  DiscardDraftThreadResult,
  StartThreadInput,
} from "./thread-runtime-api.ts";

// Draft Thread lifecycle, split out of ThreadRuntimeService (spec:
// composer-draft-thread). A Draft Thread is a registered ThreadRecord with full
// Execution Context and a live Workbench but NO agent runtime — the Composer screen
// drives Workbench commands against it, and Send starts it in place. This collaborator
// owns create / discard / start-in-place over the shared ThreadStore; the agent-spawn
// itself stays in the service (it is shared with a fresh start). Port coupling is kept
// to the injected `stopTerminalPane` callback so the file stays metadata-focused.

// Build a fresh ThreadRecord with an empty Workbench and no runtime. Shared by the
// Draft create path (lifecycleState "draft") and a fresh startThread ("creating") so the
// record shape lives in one place.
export function newThreadRecord(input: {
  threadId: ThreadId;
  title: string;
  agentBinding: AgentBinding;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
  lifecycleState: ThreadLifecycleState;
  capturedAt: string;
}): ThreadRecord {
  return {
    threadId: input.threadId,
    title: input.title,
    agentBinding: cloneAgentBinding(input.agentBinding),
    scope: cloneScope(input.scope),
    launchOptions: cloneLaunchOptions(input.launchOptions),
    lifecycleState: input.lifecycleState,
    runtimeState: "not_started",
    lastKnownState: "idle",
    createdAt: input.capturedAt,
    updatedAt: input.capturedAt,
    cachedBlocks: [],
    streamingBlocks: [],
    rawFrameSequence: 0,
    mcpToolCallCount: 0,
    workbench: defaultWorkbenchState(),
  };
}

export interface DraftThreadServiceInput {
  store: ThreadStore;
  clock: () => string;
  idGenerator: () => string;
  // Stop a visible-terminal PTY a discarded draft owns (no orphan processes). Injected
  // so this collaborator never reaches into the WorkbenchRuntime / PTY port directly.
  stopTerminalPane: (pane: TerminalPaneState) => Promise<void>;
}

export class DraftThreadService {
  private readonly store: ThreadStore;
  private readonly clock: () => string;
  private readonly idGenerator: () => string;
  private readonly stopTerminalPane: (pane: TerminalPaneState) => Promise<void>;

  constructor(input: DraftThreadServiceInput) {
    this.store = input.store;
    this.clock = input.clock;
    this.idGenerator = input.idGenerator;
    this.stopTerminalPane = input.stopTerminalPane;
  }

  // Register a Draft Thread: full context + a live (empty) Workbench, lifecycleState
  // "draft", runtimeState "not_started". Never spawns an agent.
  async createDraftThread(
    input: CreateDraftThreadInput,
  ): Promise<ServiceResult<CreateDraftThreadResult>> {
    const capturedAt = this.clock();
    const threadId = input.threadId ?? this.idGenerator();
    const thread = newThreadRecord({
      threadId,
      title: "New Thread",
      agentBinding: input.agentBinding,
      scope: input.scope,
      launchOptions: input.launchOptions,
      lifecycleState: "draft",
      capturedAt,
    });
    this.store.set(threadId, thread);
    return { ok: true, thread: snapshotThread(thread) };
  }

  // Discard a never-sent Draft Thread: kill any visible-terminal PTYs it owns and remove
  // it from memory. No-op `discarded:false` when gone; refuses a started thread.
  async discardDraftThread(
    input: DiscardDraftThreadInput,
  ): Promise<ServiceResult<DiscardDraftThreadResult>> {
    const thread = this.store.get(input.threadId);
    if (thread === undefined) {
      return { ok: true, discarded: false };
    }
    if (thread.lifecycleState !== "draft") {
      return failure("thread_not_draft", "Only a Draft Thread can be discarded.");
    }
    // Stop every terminal PTY in parallel, swallowing individual failures, so one
    // rejecting stop can't abort the loop and leak the draft (in memory) + the remaining
    // PTYs (Gemini review). Removal from the store is then guaranteed.
    await Promise.all(
      thread.workbench.panes
        .filter((pane): pane is TerminalPaneState => pane.kind === "terminal")
        .map((pane) => this.stopTerminalPane(pane).catch(() => {})),
    );
    this.store.delete(input.threadId);
    return { ok: true, discarded: true };
  }

  // If `threadId` is an existing Draft Thread, start it in place: keep its Workbench (the
  // panes opened pre-send) and refresh its context from the Send, returning the mutated
  // record. Otherwise return undefined so the caller builds a fresh thread.
  prepareStartInPlace(
    threadId: ThreadId,
    input: StartThreadInput,
    capturedAt: string,
  ): ThreadRecord | undefined {
    const thread = this.store.get(threadId);
    if (thread === undefined || thread.lifecycleState !== "draft") {
      return undefined;
    }
    thread.title = titleFromMessage(input.initialMessage);
    thread.agentBinding = cloneAgentBinding(input.agentBinding);
    if (input.scope !== undefined) {
      thread.scope = cloneScope(input.scope);
    }
    thread.launchOptions = cloneLaunchOptions(input.launchOptions);
    thread.lifecycleState = "creating";
    thread.updatedAt = capturedAt;
    return thread;
  }
}
