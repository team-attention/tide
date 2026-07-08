import { ThreadStore } from "./thread-store.ts";
import type { AgentRuntimePort } from "../../ports/outbound/agent-runtime-port.ts";
import type { ProviderReadinessPort } from "../../ports/outbound/provider-readiness-port.ts";
import type { ComposerAttachmentInput, ComposerAttachmentStorePort } from "../../ports/outbound/composer-attachment-store-port.ts";
import type { AgentSessionBlockReference, ComposerAttachmentRef, PendingInput, ThreadRecord } from "../../domains/thread/thread.ts";
import type { AgentRuntimeHandle } from "../../domains/agent-runtime/agent-runtime.ts";
import { RUNTIME_LAUNCH_OPTION_KEYS } from "./thread-runtime-api.ts";
import type { EditPendingInputInput, EditPendingInputResult, RunQueuedInputNowInput, RunQueuedInputNowResult, SendComposerInput, SendComposerInputResult, StopAgentRuntimeInput, StopAgentRuntimeResult, UpdateThreadLaunchOptionsInput, UpdateThreadLaunchOptionsResult } from "./thread-runtime-api.ts";
import { failure } from "../support/service-result.ts";
import type { ServiceResult } from "../support/service-result.ts";
import { cloneLaunchOptions } from "./thread-runtime-clone.ts";
import { snapshotThread } from "./thread-snapshot.ts";
// Composer queue + launch-option operations extracted from
// thread-runtime-service.ts per docs_v2/specs/thread-runtime-service-decomposition.md:
// constructor-injected collaborator over the shared ThreadStore; runtime
// effects it cannot own arrive as callbacks (the established pattern).

export class ComposerQueueService {
  private readonly threads: ThreadStore;
  private readonly agentRuntimePort: AgentRuntimePort;
  private readonly providerReadinessPort: ProviderReadinessPort;
  private readonly composerAttachmentStorePort?: ComposerAttachmentStorePort;
  private readonly clock: () => string;
  private readonly idGenerator: () => string;
  private readonly appendLocalUserMessageBlock: (thread: ThreadRecord, input: string) => AgentSessionBlockReference;
  private readonly activeOrResumedHandle: (thread: ThreadRecord) => Promise<AgentRuntimeHandle>;

  constructor(input: {
    threads: ThreadStore;
    agentRuntimePort: AgentRuntimePort;
    providerReadinessPort: ProviderReadinessPort;
    composerAttachmentStorePort?: ComposerAttachmentStorePort;
    clock: () => string;
    idGenerator: () => string;
    appendLocalUserMessageBlock: (thread: ThreadRecord, input: string) => AgentSessionBlockReference;
    activeOrResumedHandle: (thread: ThreadRecord) => Promise<AgentRuntimeHandle>;
  }) {
    this.threads = input.threads;
    this.agentRuntimePort = input.agentRuntimePort;
    this.providerReadinessPort = input.providerReadinessPort;
    this.composerAttachmentStorePort = input.composerAttachmentStorePort;
    this.clock = input.clock;
    this.idGenerator = input.idGenerator;
    this.appendLocalUserMessageBlock = input.appendLocalUserMessageBlock;
    this.activeOrResumedHandle = input.activeOrResumedHandle;
  }

async composeMessageWithAttachments(
    thread: ThreadRecord,
    text: string,
    attachments: ComposerAttachmentInput[] | undefined,
  ): Promise<{ text: string; attachments: ComposerAttachmentRef[] }> {
    if (
      attachments === undefined ||
      attachments.length === 0 ||
      this.composerAttachmentStorePort === undefined
    ) {
      return { text, attachments: [] };
    }
    // Written under Tide's app-data dir (keyed by threadId), NEVER the user's
    // repo — so attachments never pollute git and need no .gitignore.
    const paths = await this.composerAttachmentStorePort.materialize({
      threadId: thread.threadId,
      attachments,
    });
    // Each client reads these bytes back into its NATIVE inline image input
    // (claude image block / codex localImage / ACP image ContentBlock); the path
    // also rides the message text as "[Attached image: <path>]" purely so the
    // transcript renders a thumbnail (claude strips it, having the image inline).
    const refs: ComposerAttachmentRef[] = paths.map((path, index) => ({
      path,
      mediaType: attachments[index]?.mediaType ?? "image/png",
    }));
    const lines = refs.map((ref) => `[Attached image: ${ref.path}]`);
    if (lines.length === 0) {
      return { text, attachments: [] };
    }
    const folded = text.length > 0 ? `${text}\n\n${lines.join("\n")}` : lines.join("\n");
    return { text: folded, attachments: refs };
  }

async sendComposerInput(
    input: SendComposerInput,
  ): Promise<ServiceResult<SendComposerInputResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    if (
      input.agentId !== undefined &&
      input.agentId !== thread.agentBinding.agentId
    ) {
      return failure(
        "agent_binding_locked",
        "Thread Agent Binding cannot be changed by follow-up input.",
      );
    }

    // Launch options carried on the send (the composer's current model/
    // permission/reasoning) route through the same merge/apply path as the
    // explicit thread.setLaunchOptions command — a follow-up send can never
    // silently drop a changed setting again.
    await this.mergeAndApplyLaunchOptions(thread, input.launchOptions);

    // Materialize pasted images and fold their paths into the message before any
    // readiness/busy branch, so a queued or deferred send still carries them.
    const { text: message, attachments: messageAttachments } =
      await this.composeMessageWithAttachments(thread, input.input, input.attachments);
    const attachmentsForRuntime = messageAttachments.length > 0 ? messageAttachments : undefined;

    const readiness = await this.providerReadinessPort.check({
      agentId: thread.agentBinding.agentId,
      scope: thread.scope,
      launchOptions: thread.launchOptions,
    });

    if (!readiness.ready) {
      this.enqueuePendingInput(thread, {
        kind: "composer_input",
        value: message,
        capturedAt: this.clock(),
        launchOptions: cloneLaunchOptions(thread.launchOptions),
        attachments: attachmentsForRuntime,
      });
      thread.updatedAt = this.clock();

      return {
        ok: true,
        status: "provider_not_ready",
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
        providerReadiness: readiness,
      };
    }

    // UNIFORM QUEUE: while a turn is genuinely in flight, EVERY provider's follow-up
    // input queues Tide-side and flushes when the turn completes (recordTurnComplete).
    // The user always sees their messages stack as the Composer's queued "steer" chips
    // (Queued + interrupt/edit/delete) — identical on codex, claude, and opencode
    // — and can interrupt to run the queue sooner. (An idle thread takes the path below
    // and sends immediately.) "Busy" also covers waiting on a prompt card: writing
    // composer text into the open box would blind-answer it (adversarial review finding).
    //
    // We deliberately do NOT live-steer even though codex's protocol can inject input
    // into the running turn (readiness.capabilities.supportsTurnSteer): the product
    // decision is one predictable, visible stacking model for ALL agents. The capability
    // is kept as accurate provider metadata — a future per-provider "steer now" opt-in
    // would gate on it again — but no send path acts on it today.
    const busy = isThreadBusyForComposerQueue(thread);
    if (busy) {
      this.enqueuePendingInput(thread, {
        kind: "composer_input",
        value: message,
        capturedAt: this.clock(),
        launchOptions: cloneLaunchOptions(thread.launchOptions),
        attachments: attachmentsForRuntime,
      });
      thread.updatedAt = this.clock();
      return {
        ok: true,
        status: "queued",
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
        providerReadiness: readiness,
      };
    }

    clearStaleIdleStreamingTail(thread);

    // A restart-required options change is consumed here, at the turn boundary:
    // the idle process is stopped and activeOrResumedHandle respawns it via the
    // provider-native resume with the new options (covered by the spinner).
    await this.consumePendingRuntimeRestart(thread);
    const handle = await this.activeOrResumedHandle(thread);
    // Fallback runtimes use goal_set as a send-time preamble refresh. Native
    // goal providers own their session goal state; re-sending /goal or
    // thread/goal/set before every normal message can start an unintended goal
    // turn.
    if (
      thread.goal !== undefined &&
      thread.goal.length > 0 &&
      handle.agentId !== "codex" &&
      handle.agentId !== "claude"
    ) {
      await this.agentRuntimePort.writeInput(handle, {
        kind: "goal_set",
        value: thread.goal,
        submittedAt: this.clock(),
      });
    }
    const submittedBlock = this.appendLocalUserMessageBlock(thread, message);
    thread.runtimeState = "running";
    thread.runtimeStartedAt = this.clock();
    thread.lifecycleState = "running";
    thread.lastKnownState = "running";
    thread.updatedAt = this.clock();

    await this.agentRuntimePort.writeInput(handle, {
      kind: "composer_input",
      value: message,
      submittedAt: this.clock(),
      attachments: attachmentsForRuntime,
    });

    return {
      ok: true,
      status: "sent",
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
      providerReadiness: readiness,
      submittedBlock,
    };
  }

// --- Composer follow-up queue (head = pendingInput, tail = pendingInputQueue) ---

  // Enqueue a follow-up: fill the empty head slot, else append to the FIFO tail.
  enqueuePendingInput(thread: ThreadRecord, pending: PendingInput): void {
    if (thread.pendingInput === undefined) {
      thread.pendingInput = pending;
    } else {
      (thread.pendingInputQueue ??= []).push(pending);
    }
  }

// Promote the next queued follow-up into the head slot once the head ran/was
  // dropped (FIFO). Clears the tail array when empty so the single-queue path stays
  // byte-identical (head undefined, no tail). Replaces `pendingInput = undefined`.
  promoteNextPendingInput(thread: ThreadRecord): void {
    thread.pendingInput = thread.pendingInputQueue?.shift();
    if (thread.pendingInputQueue !== undefined && thread.pendingInputQueue.length === 0) {
      thread.pendingInputQueue = undefined;
    }
  }

// The whole follow-up queue, head first — for index-addressed edits/removals.
  private pendingInputsOf(thread: ThreadRecord): PendingInput[] {
    return thread.pendingInput === undefined
      ? []
      : [thread.pendingInput, ...(thread.pendingInputQueue ?? [])];
  }

writePendingInputs(thread: ThreadRecord, queue: PendingInput[]): void {
    thread.pendingInput = queue[0];
    thread.pendingInputQueue = queue.length > 1 ? queue.slice(1) : undefined;
  }

// Mid-thread Launch Options change (model/permission/reasoning). Persists the
  // merged options on the thread record and applies them to the live runtime —
  // protocol-native when the provider supports it, otherwise via a transparent
  // restart at the next turn. Spec: mid-thread-launch-option-changes.md.
  async updateThreadLaunchOptions(
    input: UpdateThreadLaunchOptionsInput,
  ): Promise<ServiceResult<UpdateThreadLaunchOptionsResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    const { applied, changedKeys } = await this.mergeAndApplyLaunchOptions(
      thread,
      input.launchOptions,
    );
    return { ok: true, thread: snapshotThread(thread), applied, changedKeys };
  }

// Merge new Launch Options into the thread record and route the change to the
  // live runtime. Shared by the explicit thread.setLaunchOptions command and
  // the launch options piggybacked on composer.sendInput.
  private async mergeAndApplyLaunchOptions(
    thread: ThreadRecord,
    launchOptions: Record<string, unknown> | undefined,
  ): Promise<{ applied: "live" | "next_turn" | "none"; changedKeys: string[] }> {
    if (launchOptions === undefined) {
      return { applied: "none", changedKeys: [] };
    }
    const previous = thread.launchOptions ?? {};
    const changedKeys = RUNTIME_LAUNCH_OPTION_KEYS.filter(
      (key) => key in launchOptions && launchOptions[key] !== previous[key],
    );
    if (changedKeys.length === 0) {
      return { applied: "none", changedKeys };
    }
    thread.launchOptions = { ...previous, ...launchOptions };
    thread.updatedAt = this.clock();
    if (thread.activeRuntimeHandle === undefined) {
      // No live session — the next spawn/resume reads thread.launchOptions. The
      // change is real (changedKeys non-empty), so the renderer reads this as
      // "pending" (applies at the next message), not "no change".
      return { applied: "none", changedKeys };
    }
    const result = await this.agentRuntimePort.applySessionConfig(
      thread.activeRuntimeHandle,
      { launchOptions: { ...thread.launchOptions }, changedKeys },
    );
    if (result === "applied") {
      // NOTE: an earlier restart-required change stays pending — the restart
      // re-applies every current option at spawn, so nothing is lost.
      return {
        applied: thread.pendingRuntimeRestart === true ? "next_turn" : "live",
        changedKeys,
      };
    }
    thread.pendingRuntimeRestart = true;
    return { applied: "next_turn", changedKeys };
  }

// Consume a pending restart-required options change at a turn boundary: stop
  // the (idle — never mid-turn) process and clear the handle so the caller's
  // activeOrResumedHandle respawns via provider-native resume with the thread's
  // current options. No UI state of its own; the turn spinner covers it.
  async consumePendingRuntimeRestart(thread: ThreadRecord): Promise<void> {
    if (thread.pendingRuntimeRestart !== true) {
      return;
    }
    thread.pendingRuntimeRestart = false;
    const handle = thread.activeRuntimeHandle;
    if (handle === undefined) {
      return;
    }
    thread.activeRuntimeHandle = undefined;
    await this.agentRuntimePort.stop(handle);
  }

// Edit the queued (not-yet-sent) Composer message. The runtime has not seen the
  // queued input, so editing only mutates Tide-owned state — no provider rewind,
  // identical for every Agent. A blank value discards that queued message; `index`
  // (default 0 = the head/next to run) selects which one in the follow-up queue.
  // Spec: docs_v2/specs/composer-message-edit.md.
  async editPendingInput(
    input: EditPendingInputInput,
  ): Promise<ServiceResult<EditPendingInputResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    const index = input.index ?? 0;
    const queue = this.pendingInputsOf(thread);
    const pending = queue[index];
    if (pending === undefined || pending.kind !== "composer_input") {
      return failure(
        "no_pending_input",
        "There is no queued Composer input to edit.",
      );
    }

    const discards = input.value.trim().length === 0;
    if (discards) {
      queue.splice(index, 1);
    } else {
      queue[index] = {
        kind: "composer_input",
        value: input.value,
        capturedAt: this.clock(),
        // Preserve the queued message's launch options + attachments across the edit.
        launchOptions: cloneLaunchOptions(pending.launchOptions),
        attachments: pending.attachments,
      };
    }
    this.writePendingInputs(thread, queue);
    thread.updatedAt = this.clock();
    return {
      ok: true,
      thread: snapshotThread(thread),
      status: discards ? "discarded" : "edited",
    };
  }

  async promoteQueuedInputToHead(
    input: RunQueuedInputNowInput,
  ): Promise<ServiceResult<Omit<RunQueuedInputNowResult, "runtimeState">>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    const index = input.index ?? 0;
    const queue = this.pendingInputsOf(thread);
    const pending = queue[index];
    if (pending === undefined || pending.kind !== "composer_input") {
      return failure(
        "no_pending_input",
        "There is no queued Composer input to run.",
      );
    }
    if (index > 0) {
      queue.splice(index, 1);
      queue.unshift(pending);
      this.writePendingInputs(thread, queue);
      thread.updatedAt = this.clock();
    }
    return {
      ok: true,
      thread: snapshotThread(thread),
      status: index === 0 ? "already_head" : "selected",
    };
  }
}

export async function runQueuedInputNowThroughQueue(
  input: RunQueuedInputNowInput,
  composerQueue: ComposerQueueService,
  stopAgentRuntime: (input: StopAgentRuntimeInput) => Promise<ServiceResult<StopAgentRuntimeResult>>,
): Promise<ServiceResult<RunQueuedInputNowResult>> {
  const promoted = await composerQueue.promoteQueuedInputToHead(input);
  if (!promoted.ok) {
    return promoted;
  }
  const stopped = await stopAgentRuntime({ threadId: input.threadId });
  if (!stopped.ok) {
    return stopped;
  }
  return { ok: true, thread: stopped.thread, runtimeState: stopped.runtimeState, status: promoted.status };
}

function isThreadBusyForComposerQueue(thread: ThreadRecord): boolean {
  if (thread.activeRuntimeHandle === undefined) {
    return false;
  }
  return (
    isActiveRuntimeState(thread.runtimeState) ||
    isActiveLastKnownState(thread.lastKnownState) ||
    thread.promptState !== undefined ||
    thread.goalState?.status === "active"
  );
}

function clearStaleIdleStreamingTail(thread: ThreadRecord): void {
  if (
    thread.streamingBlocks.length > 0 &&
    !isActiveRuntimeState(thread.runtimeState) &&
    !isActiveLastKnownState(thread.lastKnownState) &&
    thread.promptState === undefined
  ) {
    thread.streamingBlocks = [];
  }
}

function isActiveRuntimeState(state: ThreadRecord["runtimeState"]): boolean {
  return (
    state === "running" ||
    state === "starting" ||
    state === "waiting_for_approval" ||
    state === "waiting_for_input"
  );
}

function isActiveLastKnownState(state: ThreadRecord["lastKnownState"]): boolean {
  return (
    state === "running" ||
    state === "waiting_for_approval" ||
    state === "waiting_for_input"
  );
}
