import type { AgentSessionBlock } from "../domains/agent-session/agent-session-block.ts";
import type {
  AgentBinding,
  AgentId,
  LastKnownState,
  ThreadId,
  ThreadScope,
} from "../domains/thread/thread.ts";
import type { AppStoragePort } from "../ports/outbound/app-storage-port.ts";

export const THREAD_STORAGE_VERSION = 1;

export interface ThreadStorageRecord {
  storageVersion: typeof THREAD_STORAGE_VERSION;
  threadId: ThreadId;
  title: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  agentBinding: AgentBinding;
  scope: ThreadScope;
  launchOptions?: Record<string, unknown>;
  executionContext: ExecutionContextRecord;
  providerSessionRef?: ProviderSessionRefRecord;
  lastKnownState: LastKnownState;
  cache?: AgentSessionCacheRecord;
  readiness?: ProviderReadinessRecord;
}

export interface ExecutionContextRecord {
  cwd: string;
  branch?: string;
  worktree?: string;
}

export interface ProviderSessionRefRecord {
  agentId: AgentId;
  kind:
    | "codex_rollout"
    | "claude_transcript"
    | "antigravity_conversation"
    | "gemini_session"
    | "provider_native";
  value: string;
  transcriptPath?: string;
  logPath?: string;
  observedAt: string;
}

export interface AgentSessionCacheRecord {
  cachePath: string;
  readerVersion: string;
  sourceFingerprint: string;
  blockCount: number;
  updatedAt: string;
}

export interface ProviderReadinessRecord {
  agentId: AgentId;
  ready: boolean;
  blockers: ProviderReadinessBlockerRecord[];
  observedAt: string;
}

export interface ProviderReadinessBlockerRecord {
  kind: string;
  message: string;
  scope?: string;
  action?: string;
}

export interface ThreadIndexRecord {
  storageVersion: typeof THREAD_STORAGE_VERSION;
  threads: ThreadIndexEntry[];
}

export interface ThreadIndexEntry {
  threadId: ThreadId;
  title: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  agentId: AgentId;
  scopeKind: ThreadScope["kind"];
  lastKnownState: LastKnownState;
}

export interface AgentSessionCacheRow {
  storageVersion: typeof THREAD_STORAGE_VERSION;
  block: AgentSessionBlock;
}

export type PersistenceErrorCode =
  | "thread_not_found"
  | "unsupported_storage_version"
  | "cache_rebuild_unavailable"
  | "cache_malformed";

export interface PersistenceError {
  code: PersistenceErrorCode;
  message: string;
}

export type PersistenceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PersistenceError };

export interface ThreadPersistenceService {
  listThreadMetadata(): Promise<PersistenceResult<ThreadStorageRecord[]>>;
  saveThreadMetadata(
    record: ThreadStorageRecord,
  ): Promise<PersistenceResult<ThreadStorageRecord>>;
  loadThreadMetadata(
    threadId: ThreadId,
  ): Promise<PersistenceResult<ThreadStorageRecord>>;
  attachProviderSessionRef(
    threadId: ThreadId,
    providerSessionRef: ProviderSessionRefRecord,
  ): Promise<PersistenceResult<ThreadStorageRecord>>;
  writeAgentSessionCache(
    threadId: ThreadId,
    input: WriteAgentSessionCacheInput,
  ): Promise<PersistenceResult<ThreadStorageRecord>>;
  deleteAgentSessionCache(
    threadId: ThreadId,
  ): Promise<PersistenceResult<ThreadStorageRecord>>;
  hydrateThread(
    threadId: ThreadId,
    input: HydratePersistedThreadInput,
  ): Promise<PersistenceResult<HydratePersistedThreadResult>>;
  rebuildThreadIndex(): Promise<PersistenceResult<ThreadIndexRecord>>;
}

export interface CreateThreadPersistenceServiceInput {
  storage: AppStoragePort;
  clock: () => string;
  readerVersion: string;
}

export interface WriteAgentSessionCacheInput {
  blocks: AgentSessionBlock[];
  sourceFingerprint: string;
}

export interface HydratePersistedThreadInput {
  currentSourceFingerprint?: string;
  rebuildBlocks?: (thread: ThreadStorageRecord) => Promise<AgentSessionBlock[]>;
}

export interface HydratePersistedThreadResult {
  thread: ThreadStorageRecord;
  blocks: AgentSessionBlock[];
  rebuilt: boolean;
}

export interface PtyTranscriptRing {
  push(frame: string): void;
  frames(): string[];
  byteLength(): number;
}

export interface CreatePtyTranscriptRingInput {
  maxFrames: number;
  maxBytes: number;
}

export function createThreadPersistenceService(
  input: CreateThreadPersistenceServiceInput,
): ThreadPersistenceService {
  return new FileBackedThreadPersistenceService(input);
}

export function createPtyTranscriptRing(
  input: CreatePtyTranscriptRingInput,
): PtyTranscriptRing {
  return new BoundedPtyTranscriptRing(input);
}

export function shouldRecheckProviderReadinessBeforeInput(
  _record: ThreadStorageRecord,
): boolean {
  return true;
}

class FileBackedThreadPersistenceService implements ThreadPersistenceService {
  private readonly storage: AppStoragePort;
  private readonly clock: () => string;
  private readonly readerVersion: string;

  constructor(input: CreateThreadPersistenceServiceInput) {
    this.storage = input.storage;
    this.clock = input.clock;
    this.readerVersion = input.readerVersion;
  }

  async listThreadMetadata(): Promise<PersistenceResult<ThreadStorageRecord[]>> {
    const threadIds = await this.storage.listDirectories("threads");
    const records: ThreadStorageRecord[] = [];

    for (const threadId of threadIds) {
      const loaded = await this.loadThreadMetadata(threadId);
      if (!loaded.ok) {
        if (loaded.error.code === "thread_not_found") {
          continue;
        }
        return loaded;
      }
      records.push(loaded.value);
    }

    records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return { ok: true, value: records };
  }

  async saveThreadMetadata(
    record: ThreadStorageRecord,
  ): Promise<PersistenceResult<ThreadStorageRecord>> {
    const versionCheck = validateStorageVersion(record);
    if (!versionCheck.ok) {
      return versionCheck;
    }

    await this.storage.writeJsonAtomic(threadRecordPath(record.threadId), record);
    await this.upsertThreadIndex(record);
    return { ok: true, value: record };
  }

  async loadThreadMetadata(
    threadId: ThreadId,
  ): Promise<PersistenceResult<ThreadStorageRecord>> {
    const value = await this.storage.readJson(threadRecordPath(threadId));
    if (value === undefined) {
      return failure("thread_not_found", "Thread metadata was not found.");
    }

    const record = value as ThreadStorageRecord;
    const versionCheck = validateStorageVersion(record);
    if (!versionCheck.ok) {
      return versionCheck;
    }

    return { ok: true, value: record };
  }

  async attachProviderSessionRef(
    threadId: ThreadId,
    providerSessionRef: ProviderSessionRefRecord,
  ): Promise<PersistenceResult<ThreadStorageRecord>> {
    const loaded = await this.loadThreadMetadata(threadId);
    if (!loaded.ok) {
      return loaded;
    }

    return this.saveThreadMetadata({
      ...loaded.value,
      agentBinding: {
        ...loaded.value.agentBinding,
        providerSessionRef: {
          kind: providerSessionRef.kind,
          value: providerSessionRef.value,
          transcriptPath: providerSessionRef.transcriptPath,
          logPath: providerSessionRef.logPath,
        },
      },
      providerSessionRef,
      updatedAt: this.clock(),
    });
  }

  async writeAgentSessionCache(
    threadId: ThreadId,
    input: WriteAgentSessionCacheInput,
  ): Promise<PersistenceResult<ThreadStorageRecord>> {
    const loaded = await this.loadThreadMetadata(threadId);
    if (!loaded.ok) {
      return loaded;
    }

    const cachePath = agentSessionCachePath(threadId);
    const rows = input.blocks.map((block): AgentSessionCacheRow => ({
      storageVersion: THREAD_STORAGE_VERSION,
      block,
    }));
    await this.storage.writeJsonlAtomic(cachePath, rows);

    return this.saveThreadMetadata({
      ...loaded.value,
      updatedAt: this.clock(),
      cache: {
        cachePath,
        readerVersion: this.readerVersion,
        sourceFingerprint: input.sourceFingerprint,
        blockCount: input.blocks.length,
        updatedAt: this.clock(),
      },
    });
  }

  async deleteAgentSessionCache(
    threadId: ThreadId,
  ): Promise<PersistenceResult<ThreadStorageRecord>> {
    const loaded = await this.loadThreadMetadata(threadId);
    if (!loaded.ok) {
      return loaded;
    }

    if (loaded.value.cache) {
      await this.storage.remove(loaded.value.cache.cachePath);
    }
    const { cache: _cache, ...withoutCache } = loaded.value;
    return this.saveThreadMetadata({
      ...withoutCache,
      updatedAt: this.clock(),
    });
  }

  async hydrateThread(
    threadId: ThreadId,
    input: HydratePersistedThreadInput,
  ): Promise<PersistenceResult<HydratePersistedThreadResult>> {
    const loaded = await this.loadThreadMetadata(threadId);
    if (!loaded.ok) {
      return loaded;
    }
    const thread = loaded.value;

    if (await this.cacheIsValid(thread, input.currentSourceFingerprint)) {
      const cachedBlocks = await this.readAgentSessionCache(thread);
      if (!cachedBlocks.ok) {
        return cachedBlocks;
      }
      return {
        ok: true,
        value: {
          thread,
          blocks: cachedBlocks.value,
          rebuilt: false,
        },
      };
    }

    if (thread.providerSessionRef && input.rebuildBlocks) {
      const rebuiltBlocks = await input.rebuildBlocks(thread);
      const saved = await this.writeAgentSessionCache(threadId, {
        blocks: rebuiltBlocks,
        sourceFingerprint: input.currentSourceFingerprint ?? "",
      });
      if (!saved.ok) {
        return saved;
      }
      return {
        ok: true,
        value: {
          thread: saved.value,
          blocks: rebuiltBlocks,
          rebuilt: true,
        },
      };
    }

    return {
      ok: true,
      value: {
        thread,
        blocks: [],
        rebuilt: false,
      },
    };
  }

  async rebuildThreadIndex(): Promise<PersistenceResult<ThreadIndexRecord>> {
    const threadIds = await this.storage.listDirectories("threads");
    const records: ThreadStorageRecord[] = [];

    for (const threadId of threadIds) {
      const loaded = await this.loadThreadMetadata(threadId);
      if (!loaded.ok) {
        if (loaded.error.code === "thread_not_found") {
          continue;
        }
        return loaded;
      }
      records.push(loaded.value);
    }

    const index = createThreadIndex(records);
    await this.storage.writeJsonAtomic(threadIndexPath(), index);
    return { ok: true, value: index };
  }

  private async cacheIsValid(
    thread: ThreadStorageRecord,
    currentSourceFingerprint: string | undefined,
  ): Promise<boolean> {
    if (!thread.cache) {
      return false;
    }
    if (thread.cache.readerVersion !== this.readerVersion) {
      return false;
    }
    if (
      currentSourceFingerprint !== undefined &&
      thread.cache.sourceFingerprint !== currentSourceFingerprint
    ) {
      return false;
    }
    return this.storage.exists(thread.cache.cachePath);
  }

  private async readAgentSessionCache(
    thread: ThreadStorageRecord,
  ): Promise<PersistenceResult<AgentSessionBlock[]>> {
    if (!thread.cache) {
      return { ok: true, value: [] };
    }

    const rows = await this.storage.readJsonl(thread.cache.cachePath);
    const blocks: AgentSessionBlock[] = [];
    for (const row of rows) {
      const cacheRow = row as AgentSessionCacheRow;
      if (cacheRow.storageVersion !== THREAD_STORAGE_VERSION) {
        return failure(
          "unsupported_storage_version",
          "Agent Session Cache row uses an unsupported storage version.",
        );
      }
      if (!cacheRow.block) {
        return failure("cache_malformed", "Agent Session Cache row is malformed.");
      }
      blocks.push(cacheRow.block);
    }
    return { ok: true, value: blocks };
  }

  private async upsertThreadIndex(record: ThreadStorageRecord): Promise<void> {
    const existing = await this.readThreadIndex();
    const others = existing.threads.filter(
      (thread) => thread.threadId !== record.threadId,
    );
    const index = createThreadIndex([...others.map(indexEntryToRecord), record]);
    await this.storage.writeJsonAtomic(threadIndexPath(), index);
  }

  private async readThreadIndex(): Promise<ThreadIndexRecord> {
    const value = await this.storage.readJson(threadIndexPath());
    if (value === undefined) {
      return {
        storageVersion: THREAD_STORAGE_VERSION,
        threads: [],
      };
    }
    const index = value as ThreadIndexRecord;
    if (index.storageVersion !== THREAD_STORAGE_VERSION) {
      return {
        storageVersion: THREAD_STORAGE_VERSION,
        threads: [],
      };
    }
    return index;
  }
}

class BoundedPtyTranscriptRing implements PtyTranscriptRing {
  private readonly maxFrames: number;
  private readonly maxBytes: number;
  private readonly entries: string[] = [];
  private currentBytes = 0;

  constructor(input: CreatePtyTranscriptRingInput) {
    this.maxFrames = input.maxFrames;
    this.maxBytes = input.maxBytes;
  }

  push(frame: string): void {
    this.entries.push(frame);
    this.currentBytes += byteLength(frame);
    this.trim();
  }

  frames(): string[] {
    return [...this.entries];
  }

  byteLength(): number {
    return this.currentBytes;
  }

  private trim(): void {
    while (
      this.entries.length > this.maxFrames ||
      this.currentBytes > this.maxBytes
    ) {
      const removed = this.entries.shift();
      if (removed === undefined) {
        return;
      }
      this.currentBytes -= byteLength(removed);
    }
  }
}

function validateStorageVersion(
  record: Pick<ThreadStorageRecord, "storageVersion">,
): PersistenceResult<ThreadStorageRecord> | { ok: true } {
  if (record.storageVersion !== THREAD_STORAGE_VERSION) {
    return failure(
      "unsupported_storage_version",
      "Thread metadata uses an unsupported storage version.",
    );
  }
  return { ok: true };
}

function createThreadIndex(records: ThreadStorageRecord[]): ThreadIndexRecord {
  return {
    storageVersion: THREAD_STORAGE_VERSION,
    threads: records
      .map(threadIndexEntry)
      .sort((left, right) => left.threadId.localeCompare(right.threadId)),
  };
}

function threadIndexEntry(record: ThreadStorageRecord): ThreadIndexEntry {
  return {
    threadId: record.threadId,
    title: record.title,
    pinned: record.pinned,
    archived: record.archived,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    agentId: record.agentBinding.agentId,
    scopeKind: record.scope.kind,
    lastKnownState: record.lastKnownState,
  };
}

function indexEntryToRecord(entry: ThreadIndexEntry): ThreadStorageRecord {
  return {
    storageVersion: THREAD_STORAGE_VERSION,
    threadId: entry.threadId,
    title: entry.title,
    pinned: entry.pinned,
    archived: entry.archived,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    agentBinding: { agentId: entry.agentId },
    scope:
      entry.scopeKind === "project"
        ? { kind: "project", projectId: "", cwd: "" }
        : { kind: "scratch", scratchCwd: "" },
    executionContext: { cwd: "" },
    lastKnownState: entry.lastKnownState,
  };
}

function threadRecordPath(threadId: ThreadId): string {
  return `threads/${threadId}/thread.json`;
}

function threadIndexPath(): string {
  return "threads/index.json";
}

function agentSessionCachePath(threadId: ThreadId): string {
  return `threads/${threadId}/agent-session-cache.jsonl`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function failure(
  code: PersistenceErrorCode,
  message: string,
): PersistenceResult<never> {
  return {
    ok: false,
    error: { code, message },
  };
}
