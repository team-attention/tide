import type { ThreadRecord } from "../../domains/thread/thread.ts";

export function markThreadStarting(thread: ThreadRecord, clock: () => string): void {
  thread.runtimeState = "starting";
  thread.runtimeStartedAt = clock();
  thread.lifecycleState = "running";
  thread.lastKnownState = "running";
  thread.updatedAt = clock();
}

export function markThreadFailed(thread: ThreadRecord, clock: () => string): void {
  thread.runtimeState = "failed";
  thread.lifecycleState = "failed";
  thread.lastKnownState = "failed";
  thread.updatedAt = clock();
}
