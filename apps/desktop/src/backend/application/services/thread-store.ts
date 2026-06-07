import type { ThreadId, ThreadRecord } from "../domains/thread/thread.ts";

// The single owner of in-memory Thread state. Every service collaborator shares
// ONE ThreadStore instance, so Thread state stays single-source with no copies or
// divergence. This is the linchpin of the ThreadRuntimeService decomposition
// (see docs_v2/specs/thread-runtime-service-decomposition.md). It deliberately
// mirrors the Map accessor surface the service already used (get/has/set/values)
// so call sites stay unchanged.

export class ThreadStore {
  private readonly threads = new Map<ThreadId, ThreadRecord>();

  get(threadId: ThreadId): ThreadRecord | undefined {
    return this.threads.get(threadId);
  }

  has(threadId: ThreadId): boolean {
    return this.threads.has(threadId);
  }

  set(threadId: ThreadId, record: ThreadRecord): void {
    this.threads.set(threadId, record);
  }

  values(): IterableIterator<ThreadRecord> {
    return this.threads.values();
  }
}
