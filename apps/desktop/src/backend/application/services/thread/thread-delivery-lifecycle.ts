import { createLocalUserMessageBlock } from "../../domains/agent-session/agent-session-block.ts";
import type { AgentRuntimeHandle } from "../../domains/agent-runtime/agent-runtime.ts";
import type { AgentRuntimePort } from "../../ports/outbound/agent-runtime-port.ts";
import type { AgentSessionBlockReference, ComposerAttachmentRef, ThreadRecord } from "../../domains/thread/thread.ts";
import {
  cloneAgentBinding,
  cloneLaunchOptions,
  cloneRuntimeHandle,
  cloneScope,
  toAgentSessionBlockReference,
} from "./thread-runtime-clone.ts";
import { snapshotThread } from "./thread-snapshot.ts";
import type { ComposerQueueService } from "./composer-queue-service.ts";
import type { ThreadStore } from "./thread-store.ts";
import type { RecordDeliveryStateInput, RecordDeliveryStateResult } from "./thread-runtime-api.ts";
import type { ServiceResult } from "../support/service-result.ts";
import { failure } from "../support/service-result.ts";

export async function recordDeliveryStateInStore(input: {
  threads: ThreadStore;
  command: RecordDeliveryStateInput;
  clock: () => string;
}): Promise<ServiceResult<RecordDeliveryStateResult>> {
  const thread = input.threads.get(input.command.threadId);
  if (thread === undefined) return failure("thread_not_found", "Thread was not found.");
  const block = thread.cachedBlocks.find(
    (candidate) => candidate.localProvenance?.deliveryId === input.command.deliveryId,
  );
  if (block !== undefined) {
    block.localProvenance = {
      ...(block.localProvenance ?? {}),
      deliveryId: input.command.deliveryId,
      deliveryState: input.command.state,
      ...(input.command.providerMessageId !== undefined ? { providerMessageId: input.command.providerMessageId } : {}),
      ...(input.command.providerTurnId !== undefined ? { providerTurnId: input.command.providerTurnId } : {}),
      ...(input.command.nativeStatus !== undefined ? { nativeTerminalStatus: input.command.nativeStatus } : {}),
    };
    block.updatedAt = input.clock();
    thread.updatedAt = input.clock();
  }
  return { ok: true, thread: snapshotThread(thread), block };
}

export function appendDeliveryUserBlock(input: {
  thread: ThreadRecord;
  value: string;
  deliveryId?: string;
  deliveryState?: string;
  clock: () => string;
  idGenerator: () => string;
}): AgentSessionBlockReference {
  const submittedAt = input.clock();
  const block = createLocalUserMessageBlock({
    threadId: input.thread.threadId,
    agentId: input.thread.agentBinding.agentId,
    input: input.value,
    submittedAt,
    localId: input.deliveryId ?? input.idGenerator(),
    deliveryId: input.deliveryId,
    deliveryState: input.deliveryState,
  });
  const reference = toAgentSessionBlockReference(block);
  input.thread.cachedBlocks.push(reference);
  return reference;
}

export async function openRuntimeForPendingDelivery(input: {
  thread: ThreadRecord;
  launchOptions?: Record<string, unknown>;
  promptValue: string;
  promptAttachments?: ComposerAttachmentRef[];
  deliveryId?: string;
  composerQueue: ComposerQueueService;
  agentRuntimePort: AgentRuntimePort;
  activeOrResumedHandle: (thread: ThreadRecord) => Promise<AgentRuntimeHandle>;
}): Promise<{ handle: AgentRuntimeHandle; deliveredViaLaunch: boolean }> {
  await input.composerQueue.consumePendingRuntimeRestart(input.thread);
  if (input.thread.activeRuntimeHandle !== undefined) {
    return { handle: input.thread.activeRuntimeHandle, deliveredViaLaunch: false };
  }
  if (input.thread.agentBinding.providerSessionRef !== undefined) {
    return { handle: await input.activeOrResumedHandle(input.thread), deliveredViaLaunch: false };
  }
  const handle = await input.agentRuntimePort.start({
    threadId: input.thread.threadId,
    agentBinding: cloneAgentBinding(input.thread.agentBinding),
    scope: cloneScope(input.thread.scope),
    launchOptions: input.launchOptions,
    initialPrompt: input.promptValue,
    initialDeliveryId: input.deliveryId,
    initialGoal: input.thread.goal,
    initialAttachments: input.promptAttachments,
  });
  return { handle, deliveredViaLaunch: true };
}

export async function activeOrResumedRuntimeHandle(input: {
  thread: ThreadRecord;
  agentRuntimePort: AgentRuntimePort;
  clock: () => string;
}): Promise<AgentRuntimeHandle> {
  if (input.thread.activeRuntimeHandle !== undefined) return input.thread.activeRuntimeHandle;
  input.thread.runtimeState = "starting";
  input.thread.runtimeStartedAt = input.clock();
  input.thread.updatedAt = input.clock();
  const common = {
    threadId: input.thread.threadId,
    agentBinding: cloneAgentBinding(input.thread.agentBinding),
    scope: cloneScope(input.thread.scope),
  };
  const handle = input.thread.agentBinding.providerSessionRef === undefined
    ? await input.agentRuntimePort.start({
        ...common,
        launchOptions: input.thread.launchOptions,
        initialGoal: input.thread.goal,
      })
    : await input.agentRuntimePort.resume({
        ...common,
        launchOptions: cloneLaunchOptions(input.thread.launchOptions),
      });
  input.thread.activeRuntimeHandle = cloneRuntimeHandle(handle);
  return handle;
}
