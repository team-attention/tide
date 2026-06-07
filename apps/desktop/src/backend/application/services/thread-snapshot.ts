import type {
  ThreadRecord,
  ThreadSeed,
  ThreadSnapshot,
} from "../domains/thread/thread.ts";
import {
  cloneAgentBinding,
  cloneBlocks,
  cloneLaunchOptions,
  clonePendingInput,
  clonePromptState,
  cloneRuntimeHandle,
  cloneScope,
  cloneWorkbenchState,
  defaultWorkbenchState,
} from "./thread-runtime-clone.ts";
import { snapshotWorkbench } from "./workbench-snapshot.ts";

// Maps between Thread domain shapes: a persisted ThreadSeed into a live
// ThreadRecord, and a ThreadRecord into an immutable ThreadSnapshot DTO returned
// across the service boundary. Pure: depends only on domain types and leaf
// clone/snapshot helpers. Extracted from thread-runtime-service.ts so
// collaborators can map threads without importing the facade.

// The Execution Context root (cwd) of a Thread: the project cwd or the Scratch
// working directory. Used by workspace file/command/terminal operations.
export function threadRoot(thread: ThreadRecord): string | undefined {
  if (thread.scope?.kind === "project") {
    return thread.scope.cwd;
  }
  if (thread.scope?.kind === "scratch") {
    return thread.scope.scratchCwd;
  }
  return undefined;
}

export function normalizeThreadSeed(seed: ThreadSeed): ThreadRecord {
  return {
    threadId: seed.threadId,
    title: seed.title,
    agentBinding: cloneAgentBinding(seed.agentBinding),
    scope: cloneScope(seed.scope),
    launchOptions: cloneLaunchOptions(seed.launchOptions),
    lifecycleState: seed.lifecycleState,
    runtimeState: seed.runtimeState,
    lastKnownState: seed.lastKnownState,
    pinned: seed.pinned ?? false,
    createdAt: seed.createdAt,
    updatedAt: seed.updatedAt,
    cachedBlocks: cloneBlocks(seed.cachedBlocks ?? []),
    pendingInput: clonePendingInput(seed.pendingInput),
    promptState: clonePromptState(seed.promptState),
    activeRuntimeHandle: cloneRuntimeHandle(seed.activeRuntimeHandle),
    rawFrameSequence: seed.rawFrameSequence ?? 0,
    mcpToolCallCount: seed.mcpToolCallCount ?? 0,
    workbench: cloneWorkbenchState(seed.workbench ?? defaultWorkbenchState()),
  };
}

export function snapshotThread(thread: ThreadRecord): ThreadSnapshot {
  return {
    threadId: thread.threadId,
    title: thread.title,
    agentBinding: cloneAgentBinding(thread.agentBinding),
    scope: cloneScope(thread.scope),
    launchOptions: cloneLaunchOptions(thread.launchOptions),
    lifecycleState: thread.lifecycleState,
    runtimeState: thread.runtimeState,
    lastKnownState: thread.lastKnownState,
    runtimeStartedAt: thread.runtimeStartedAt,
    pinned: thread.pinned ?? false,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    cachedBlocks: cloneBlocks(thread.cachedBlocks),
    pendingInput: clonePendingInput(thread.pendingInput),
    promptState: clonePromptState(thread.promptState),
    workbench: snapshotWorkbench(thread.workbench),
  };
}
