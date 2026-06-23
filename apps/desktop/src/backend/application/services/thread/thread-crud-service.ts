import type {
  AgentSessionBlockReference,
  ThreadId,
  ThreadSeed,
  ThreadSnapshot,
} from "../../domains/thread/thread.ts";
import { failure, type ServiceResult } from "../support/service-result.ts";
import { cloneBlocks, toAgentSessionBlockReference } from "./thread-runtime-clone.ts";
import { normalizeThreadSeed, snapshotThread } from "./thread-snapshot.ts";
import type { ThreadStore } from "./thread-store.ts";
import type {
  RecordStreamingBlockInput,
  RecordStreamingBlockResult,
} from "./thread-runtime-api.ts";

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

export interface SetThreadGoalInput {
  threadId: ThreadId;
  goal: string;
}

export interface SetThreadGoalResult {
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

  // Lazy block hydration. Live-backend restore seeds metadata only (so the rail
  // renders without parsing every thread's transcript on boot), leaving cachedBlocks
  // empty until a thread is first opened — this fills them then. Only when the thread
  // exists, its cachedBlocks are still empty, AND no live runtime owns it: a running
  // thread grows its own transcript and must never be clobbered. Returns whether it
  // seeded. See docs_v2/specs/thread-list-metadata-first-restore.md.
  seedCachedBlocksIfEmpty(
    threadId: ThreadId,
    blocks: AgentSessionBlockReference[],
  ): boolean {
    const thread = this.store.get(threadId);
    if (thread === undefined) {
      return false;
    }
    if (thread.cachedBlocks.length > 0 || thread.activeRuntimeHandle !== undefined) {
      return false;
    }
    thread.cachedBlocks = cloneBlocks(blocks);
    return true;
  }

  // Records a still-streaming Agent Session Block into the in-memory streaming tail ONLY
  // — never cachedBlocks, never persistence — so the durable Agent Session Cache stays
  // finalized-only while hydrate unions the in-flight tail onto it. Upsert by blockId
  // keeps repeated deltas idempotent; recordAgentSessionBlock (finalize) evicts the same
  // id. See docs_v2/specs/hydrate-live-streaming-tail.md.
  async recordStreamingBlock(
    input: RecordStreamingBlockInput,
  ): Promise<ServiceResult<RecordStreamingBlockResult>> {
    const thread = this.store.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    if (input.block.agentId !== thread.agentBinding.agentId) {
      return failure(
        "agent_binding_locked",
        "Agent Session Block must belong to the Thread Agent Binding.",
      );
    }
    const reference = toAgentSessionBlockReference(input.block);
    const existingIndex = thread.streamingBlocks.findIndex(
      (block) => block.blockId === reference.blockId,
    );
    if (existingIndex === -1) {
      thread.streamingBlocks.push(reference);
    } else {
      thread.streamingBlocks[existingIndex] = reference;
    }
    return {
      ok: true,
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
    };
  }

  async listThreads(
    input: ListThreadsInput,
  ): Promise<ServiceResult<ListThreadsResult>> {
    const threads = [...this.store.values()]
      // Draft Threads (composer, never sent) are not listed in the rail until they
      // start. See docs_v2/specs/composer-draft-thread.md.
      .filter((thread) => thread.lifecycleState !== "draft")
      .filter(
        (thread) =>
          input.includeArchived === true || thread.lifecycleState !== "archived",
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((thread) => snapshotThread(thread));
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

  // Set or clear (empty string) the user's thread goal. Tide-owned metadata; the
  // facade also pushes it to the live runtime's native goal mechanism. See
  // docs_v2/specs/thread-goal-and-checklist-panel.md.
  async setGoal(
    input: SetThreadGoalInput,
  ): Promise<ServiceResult<SetThreadGoalResult>> {
    const thread = this.store.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    const goal = input.goal.trim();
    thread.goal = goal.length > 0 ? goal : undefined;
    thread.updatedAt = this.clock();
    return { ok: true, thread: snapshotThread(thread) };
  }
}
