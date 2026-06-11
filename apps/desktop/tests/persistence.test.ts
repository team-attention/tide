// Spec: docs_v2/specs/persistence.md

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AgentSessionBlock } from "../src/backend/application/domains/agent-session/agent-session-block.ts";
import {
  createPtyTranscriptRing,
  createThreadPersistenceService,
  shouldRecheckProviderReadinessBeforeInput,
  type ThreadStorageRecord,
} from "../src/backend/application/services/thread-persistence-service.ts";
import { createFileAppStorage } from "../src/backend/adapters/outbound/app-storage/file-app-storage.ts";

const now = "2026-05-27T00:00:00.000Z";
const later = "2026-05-27T00:00:01.000Z";

test("creating_thread_metadata_writes_thread_json_and_updates_index", async () => {
  const { service, storage } = await createService();

  const saved = await service.saveThreadMetadata(threadRecord("thread-persist"));
  const threadJson = await storage.readJson("threads/thread-persist/thread.json");
  const indexJson = await storage.readJson("threads/index.json");

  assert.equal(saved.ok, true);
  assert.equal((threadJson as ThreadStorageRecord).threadId, "thread-persist");
  assert.deepEqual(
    (indexJson as { threads: { threadId: string }[] }).threads.map((thread) => thread.threadId),
    ["thread-persist"],
  );
});

test("provider_session_reference_attaches_after_thread_creation", async () => {
  const { service } = await createService();
  await service.saveThreadMetadata(threadRecord("thread-provider"));

  const attached = await service.attachProviderSessionRef("thread-provider", {
    agentId: "codex",
    kind: "codex_rollout",
    value: "/provider/rollout.jsonl",
    transcriptPath: "/provider/transcript.jsonl",
    observedAt: later,
  });
  const loaded = await service.loadThreadMetadata("thread-provider");

  assert.equal(attached.ok, true);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.ok && loaded.value.providerSessionRef?.kind, "codex_rollout");
  assert.equal(loaded.ok && loaded.value.providerSessionRef?.value, "/provider/rollout.jsonl");
  assert.deepEqual(loaded.ok && loaded.value.agentBinding.providerSessionRef, {
    kind: "codex_rollout",
    value: "/provider/rollout.jsonl",
    transcriptPath: "/provider/transcript.jsonl",
  });
});

test("deleting_agent_session_cache_preserves_thread_metadata_and_provider_ref", async () => {
  const { service } = await createService();
  await service.saveThreadMetadata(threadRecord("thread-cache"));
  await service.attachProviderSessionRef("thread-cache", providerRef());
  await service.writeAgentSessionCache("thread-cache", {
    blocks: [block("block-1", "cached")],
    sourceFingerprint: "source-a",
  });

  const deleted = await service.deleteAgentSessionCache("thread-cache");
  const loaded = await service.loadThreadMetadata("thread-cache");

  assert.equal(deleted.ok, true);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.ok && loaded.value.cache, undefined);
  assert.equal(loaded.ok && loaded.value.providerSessionRef?.value, "provider-session-1");
});

test("reopening_thread_uses_valid_agent_session_cache_without_rebuild", async () => {
  const { service } = await createService();
  await service.saveThreadMetadata(threadRecord("thread-reopen"));
  await service.writeAgentSessionCache("thread-reopen", {
    blocks: [block("block-1", "cached")],
    sourceFingerprint: "source-a",
  });
  let rebuildCalls = 0;

  const hydrated = await service.hydrateThread("thread-reopen", {
    currentSourceFingerprint: "source-a",
    rebuildBlocks: async () => {
      rebuildCalls += 1;
      return [block("block-rebuilt", "rebuilt")];
    },
  });

  assert.equal(hydrated.ok, true);
  assert.equal(hydrated.ok && hydrated.value.rebuilt, false);
  assert.deepEqual(
    hydrated.ok && hydrated.value.blocks.map((cachedBlock) => cachedBlock.body),
    ["cached"],
  );
  assert.equal(rebuildCalls, 0);
});

test("stale_agent_session_cache_rebuilds_from_provider_history", async () => {
  const { service } = await createService();
  await service.saveThreadMetadata(threadRecord("thread-stale"));
  await service.attachProviderSessionRef("thread-stale", providerRef());
  await service.writeAgentSessionCache("thread-stale", {
    blocks: [block("block-1", "old")],
    sourceFingerprint: "source-a",
  });
  let rebuildCalls = 0;

  const hydrated = await service.hydrateThread("thread-stale", {
    currentSourceFingerprint: "source-b",
    rebuildBlocks: async () => {
      rebuildCalls += 1;
      return [block("block-2", "rebuilt")];
    },
  });

  assert.equal(hydrated.ok, true);
  assert.equal(hydrated.ok && hydrated.value.rebuilt, true);
  assert.deepEqual(
    hydrated.ok && hydrated.value.blocks.map((cachedBlock) => cachedBlock.body),
    ["rebuilt"],
  );
  assert.equal(rebuildCalls, 1);
});

test("hydrate_recovers_blocks_when_the_cache_pointer_was_dropped", async () => {
  // Regression: a metadata-only save (thread.hydrated/renamed/pinned) used to
  // overwrite thread.json without the `cache` pointer, orphaning the cache file
  // and making a reopened thread look empty. Hydrate now recovers from the file.
  const { service } = await createService();
  await service.saveThreadMetadata(threadRecord("thread-orphan"));
  await service.writeAgentSessionCache("thread-orphan", {
    blocks: [block("block-1", "kept")],
    sourceFingerprint: "source-a",
  });
  // Simulate the clobber: a wholesale metadata save with no cache pointer.
  await service.saveThreadMetadata(threadRecord("thread-orphan"));
  const cleared = await service.loadThreadMetadata("thread-orphan");
  assert.equal(cleared.ok && cleared.value.cache, undefined);

  const hydrated = await service.hydrateThread("thread-orphan", {});
  assert.equal(hydrated.ok, true);
  assert.deepEqual(
    hydrated.ok && hydrated.value.blocks.map((cachedBlock) => cachedBlock.body),
    ["kept"],
  );
});

test("preserving_save_keeps_the_cache_pointer_through_metadata_only_events", async () => {
  const { service } = await createService();
  await service.saveThreadMetadata(threadRecord("thread-keep"));
  await service.writeAgentSessionCache("thread-keep", {
    blocks: [block("block-1", "kept")],
    sourceFingerprint: "source-a",
  });
  // A summary-derived record (no cache pointer) saved via the preserving path
  // must keep the existing pointer, so the fast valid-cache path still works.
  const preserved = await service.saveThreadMetadataPreservingCache(threadRecord("thread-keep"));
  assert.equal(preserved.ok, true);
  const loaded = await service.loadThreadMetadata("thread-keep");
  assert.equal(
    loaded.ok && loaded.value.cache?.cachePath,
    "threads/thread-keep/agent-session-cache.jsonl",
  );

  let rebuildCalls = 0;
  const hydrated = await service.hydrateThread("thread-keep", {
    currentSourceFingerprint: "source-a",
    rebuildBlocks: async () => {
      rebuildCalls += 1;
      return [];
    },
  });
  assert.deepEqual(
    hydrated.ok && hydrated.value.blocks.map((cachedBlock) => cachedBlock.body),
    ["kept"],
  );
  assert.equal(rebuildCalls, 0);
});

test("preserving_save_keeps_the_runtime_transcript_path_on_the_provider_ref", async () => {
  const { service } = await createService();
  await service.saveThreadMetadata(threadRecord("thread-ref"));
  await service.attachProviderSessionRef("thread-ref", {
    agentId: "claude",
    kind: "claude_transcript",
    value: "sess-1",
    transcriptPath: "/home/.claude/projects/x/sess-1.jsonl",
    observedAt: later,
  });
  // The summary-derived record carries the session value but not the machine-
  // specific transcriptPath; the preserving save keeps the prior path.
  await service.saveThreadMetadataPreservingCache(
    threadRecord("thread-ref", {
      agentBinding: {
        agentId: "claude",
        providerSessionRef: { kind: "claude_transcript", value: "sess-1" },
      },
      providerSessionRef: {
        agentId: "claude",
        kind: "claude_transcript",
        value: "sess-1",
        observedAt: later,
      },
    }),
  );
  const loaded = await service.loadThreadMetadata("thread-ref");
  assert.equal(
    loaded.ok && loaded.value.providerSessionRef?.transcriptPath,
    "/home/.claude/projects/x/sess-1.jsonl",
  );
  assert.equal(
    loaded.ok && loaded.value.agentBinding.providerSessionRef?.transcriptPath,
    "/home/.claude/projects/x/sess-1.jsonl",
  );
});

test("pty_transcript_ring_enforces_frame_and_byte_limits", () => {
  const ring = createPtyTranscriptRing({ maxFrames: 3, maxBytes: 8 });

  ring.push("abc");
  ring.push("def");
  ring.push("ghi");
  ring.push("jkl");

  assert.deepEqual(ring.frames(), ["ghi", "jkl"]);
  assert.equal(ring.byteLength(), 6);
});

test("stored_provider_readiness_is_returned_but_preflight_is_still_required", async () => {
  const { service } = await createService();
  const record = threadRecord("thread-readiness", {
    readiness: {
      agentId: "codex",
      ready: false,
      blockers: [
        {
          kind: "directory_trust_required",
          message: "Directory Trust required.",
        },
      ],
      observedAt: now,
    },
  });
  await service.saveThreadMetadata(record);

  const loaded = await service.loadThreadMetadata("thread-readiness");

  assert.equal(loaded.ok, true);
  assert.equal(loaded.ok && loaded.value.readiness?.ready, false);
  assert.equal(loaded.ok && shouldRecheckProviderReadinessBeforeInput(loaded.value), true);
});

test("unsupported_storage_version_returns_visible_storage_error", async () => {
  const { storage, service } = await createService();
  await storage.writeJsonAtomic("threads/thread-future/thread.json", {
    ...threadRecord("thread-future"),
    storageVersion: 2,
  });

  const loaded = await service.loadThreadMetadata("thread-future");

  assert.equal(loaded.ok, false);
  assert.equal(loaded.ok ? undefined : loaded.error.code, "unsupported_storage_version");
});

test("thread_index_rebuilds_from_thread_json_files", async () => {
  const { storage, service } = await createService();
  await service.saveThreadMetadata(threadRecord("thread-one", { title: "One" }));
  await service.saveThreadMetadata(threadRecord("thread-two", { title: "Two" }));
  await storage.remove("threads/index.json");

  const rebuilt = await service.rebuildThreadIndex();
  const indexJson = await storage.readJson("threads/index.json");

  assert.equal(rebuilt.ok, true);
  assert.deepEqual(
    (indexJson as { threads: { threadId: string }[] }).threads.map((thread) => thread.threadId),
    ["thread-one", "thread-two"],
  );
});

test("listing_thread_metadata_reads_thread_json_records", async () => {
  // Spec: docs_v2/specs/live-backend-persistence-bootstrap.md
  const { service } = await createService();
  await service.saveThreadMetadata(threadRecord("thread-older", {
    title: "Older",
    updatedAt: now,
  }));
  await service.saveThreadMetadata(threadRecord("thread-newer", {
    title: "Newer",
    updatedAt: later,
    scope: { kind: "scratch", scratchCwd: "/tmp/scratch" },
  }));

  const listed = await service.listThreadMetadata();

  assert.equal(listed.ok, true);
  assert.deepEqual(
    listed.ok && listed.value.map((thread) => thread.threadId),
    ["thread-newer", "thread-older"],
  );
  assert.equal(listed.ok && listed.value[0]?.scope.kind, "scratch");
  assert.equal(listed.ok && listed.value[1]?.scope.kind, "project");
  assert.equal(listed.ok && listed.value[1]?.scope.kind === "project" && listed.value[1].scope.cwd, "/repo/tide");
});

async function createService() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tide-persistence-"));
  const storage = createFileAppStorage({ appDataRoot: root });
  const service = createThreadPersistenceService({
    storage,
    clock: fixedClock,
    readerVersion: "reader-v1",
  });
  return { root, storage, service };
}

function threadRecord(
  threadId: string,
  overrides: Partial<ThreadStorageRecord> = {},
): ThreadStorageRecord {
  return {
    storageVersion: 1,
    threadId,
    title: "Persisted Thread",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: later,
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "project-tide", cwd: "/repo/tide" },
    executionContext: { cwd: "/repo/tide" },
    lastKnownState: "idle",
    ...overrides,
  };
}

function providerRef(): NonNullable<ThreadStorageRecord["providerSessionRef"]> {
  return {
    agentId: "codex",
    kind: "codex_rollout",
    value: "provider-session-1",
    observedAt: later,
  };
}

function block(blockId: string, body: string): AgentSessionBlock {
  return {
    blockId,
    threadId: "thread-cache",
    agentId: "codex",
    kind: "agent_message",
    role: "agent",
    sourceFrameIds: [],
    status: "complete",
    body,
    createdAt: now,
    updatedAt: later,
  };
}

function fixedClock(): string {
  return later;
}
