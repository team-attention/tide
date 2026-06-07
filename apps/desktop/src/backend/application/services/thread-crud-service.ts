import type {
  ThreadId,
  ThreadSeed,
  ThreadSnapshot,
} from "../domains/thread/thread.ts";
import { failure, type ServiceResult } from "./service-result.ts";
import { normalizeThreadSeed, snapshotThread } from "./thread-snapshot.ts";
import type { ThreadStore } from "./thread-store.ts";

// Thread store/list responsibility split out of ThreadRuntimeService. These
// operations only read/mutate Thread metadata via the shared ThreadStore and the
// clock — no Agent Runtime, ports, or lifecycle coupling. The facade delegates to
// this collaborator. See docs_v2/specs/thread-runtime-service-decomposition.md.

export interface ListThreadsInput {
  includeArchived?: boolean;
}

export interface ListThreadsResult {
  threads: ThreadSnapshot[];
}

export interface ArchiveThreadInput {
  threadId: ThreadId;
  archived: boolean;
}

export interface ArchiveThreadResult {
  thread: ThreadSnapshot;
}

export interface SetThreadPinnedInput {
  threadId: ThreadId;
  pinned: boolean;
}

export interface SetThreadPinnedResult {
  thread: ThreadSnapshot;
}

export interface RenameThreadInput {
  threadId: ThreadId;
  title: string;
}

export interface RenameThreadResult {
  thread: ThreadSnapshot;
}

export interface RestoreThreadsInput {
  threads: ThreadSeed[];
}

export interface RestoreThreadsResult {
  restoredCount: number;
}

export interface ThreadCrudServiceInput {
  store: ThreadStore;
  clock: () => string;
}

export class ThreadCrudService {
  private readonly store: ThreadStore;
  private readonly clock: () => string;

  constructor(input: ThreadCrudServiceInput) {
    this.store = input.store;
    this.clock = input.clock;
  }

  async restoreThreads(
    input: RestoreThreadsInput,
  ): Promise<ServiceResult<RestoreThreadsResult>> {
    let restoredCount = 0;
    for (const seed of input.threads) {
      if (this.store.has(seed.threadId)) {
        continue;
      }
      this.store.set(seed.threadId, normalizeThreadSeed(seed));
      restoredCount += 1;
    }
    return { ok: true, restoredCount };
  }

  async listThreads(
    input: ListThreadsInput,
  ): Promise<ServiceResult<ListThreadsResult>> {
    const threads = [...this.store.values()]
      .filter(
        (thread) =>
          input.includeArchived === true || thread.lifecycleState !== "archived",
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(snapshotThread);
    return { ok: true, threads };
  }

  async archiveThread(
    input: ArchiveThreadInput,
  ): Promise<ServiceResult<ArchiveThreadResult>> {
    const thread = this.store.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    thread.lifecycleState = input.archived ? "archived" : "open";
    thread.updatedAt = this.clock();
    return { ok: true, thread: snapshotThread(thread) };
  }

  async setThreadPinned(
    input: SetThreadPinnedInput,
  ): Promise<ServiceResult<SetThreadPinnedResult>> {
    const thread = this.store.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    thread.pinned = input.pinned;
    thread.updatedAt = this.clock();
    return { ok: true, thread: snapshotThread(thread) };
  }

  async renameThread(
    input: RenameThreadInput,
  ): Promise<ServiceResult<RenameThreadResult>> {
    const thread = this.store.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    // Manual rename: trim and collapse whitespace; ignore an empty title.
    const title = input.title.replace(/\s+/g, " ").trim();
    if (title.length === 0) {
      return failure("invalid_thread_title", "Thread title cannot be empty.");
    }
    thread.title = title;
    thread.updatedAt = this.clock();
    return { ok: true, thread: snapshotThread(thread) };
  }
}
