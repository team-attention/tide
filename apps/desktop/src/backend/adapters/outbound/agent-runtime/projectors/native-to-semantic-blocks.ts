import type { NativeStatePatch, NativeProviderRuntimeState } from "../../../../application/domains/native-agent/native-runtime-state.ts";
import type { SemanticAgentBlock } from "../../../../application/domains/native-agent/semantic-agent-block.ts";

export function projectNativeStatePatchToSemanticBlocks(input: {
  state: NativeProviderRuntimeState;
  patch: NativeStatePatch;
}): SemanticAgentBlock[] {
  const blocks: SemanticAgentBlock[] = [];
  for (const key of input.patch.semanticDirtyKeys) {
    const entry = input.state.entries.get(key);
    if (entry === undefined) {
      continue;
    }
    blocks.push({
      blockId: entry.blockId,
      kind: entry.kind,
      provider: entry.provider,
      transport: entry.transport,
      tideThreadId: entry.tideThreadId,
      runtimeId: entry.runtimeId,
      providerSessionId: entry.providerSessionId,
      nativeIds: entry.nativeIds,
      parentBlockId: entry.parentBlockId,
      status: entry.status,
      title: entry.title,
      body: entry.body,
      data: entry.data,
      evidence: entry.evidence,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
  }
  return blocks;
}
