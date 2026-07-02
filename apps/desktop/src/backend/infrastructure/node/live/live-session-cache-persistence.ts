import type { AgentSessionBlock } from "../../../application/domains/agent-session/agent-session-block.ts";
import type { ThreadPersistenceService } from "../../../application/services/thread/thread-persistence-service.ts";
import type { ThreadRuntimeService } from "../../../application/services/thread/thread-runtime-service.ts";

// Persist the thread's full current Agent Session block list so a restart can
// restore the conversation. Blocks live as references in the service; fill the
// required block fields to write the durable cache.
export async function persistThreadBlocks(input: {
  persistence: ThreadPersistenceService;
  service: ThreadRuntimeService;
  threadId: string;
}): Promise<void> {
  try {
    await persistThreadBlocksUnsafe(input);
  } catch (error) {
    // The Agent Session cache is a best-effort restore optimization. The live
    // service holds authoritative blocks in memory and the next write persists
    // the full list again, so transient FS errors must not crash the backend.
    process.emitWarning(
      error instanceof Error ? error.message : String(error),
      { type: "TidePersistenceCacheWarning" },
    );
  }
}

async function persistThreadBlocksUnsafe(input: {
  persistence: ThreadPersistenceService;
  service: ThreadRuntimeService;
  threadId: string;
}): Promise<void> {
  const hydrated = input.service.peekThread(input.threadId);
  if (!hydrated.ok || hydrated.blocks.length === 0) {
    return;
  }
  const agentId = hydrated.thread.agentBinding.agentId;
  const blocks = hydrated.blocks.map((ref) => ({
    blockId: ref.blockId,
    threadId: input.threadId,
    agentId: ref.agentId ?? agentId,
    kind: ref.kind,
    parentBlockId: ref.parentBlockId,
    role: ref.role ?? "runtime",
    sourceFrameIds: ref.sourceFrameIds ?? [],
    localProvenance: ref.localProvenance,
    status: ref.status,
    title: ref.title,
    body: ref.body,
    data: ref.data,
    rawFallback: ref.rawFallback,
    createdAt: ref.createdAt ?? ref.updatedAt,
    updatedAt: ref.updatedAt,
  })) as AgentSessionBlock[];
  const saved = await input.persistence.writeAgentSessionCache(input.threadId, {
    blocks,
    sourceFingerprint: `local:${blocks.length}:${blocks[blocks.length - 1]?.updatedAt ?? ""}`,
  });
  if (!saved.ok) {
    process.emitWarning(saved.error.message, { type: "TidePersistenceCacheWarning" });
  }
}
