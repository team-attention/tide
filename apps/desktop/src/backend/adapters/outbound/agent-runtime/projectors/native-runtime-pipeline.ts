import {
  createNativeProviderRuntimeState,
  type NativeProviderRuntimeState,
} from "../../../../application/domains/native-agent/native-runtime-state.ts";
import type { NativeRuntimeEvent } from "../../../../application/domains/native-agent/native-runtime-event.ts";
import type { SemanticAgentBlock } from "../../../../application/domains/native-agent/semantic-agent-block.ts";
import type { NativeEvidenceStore } from "../evidence/native-evidence-store.ts";
import { reduceAcpNativeEvent } from "../reducers/acp-native-reducer.ts";
import { reduceClaudeNativeEvent } from "../reducers/claude-native-reducer.ts";
import { reduceCodexNativeEvent } from "../reducers/codex-native-reducer.ts";
import { projectNativeStatePatchToSemanticBlocks } from "./native-to-semantic-blocks.ts";

export interface NativeRuntimePipeline {
  ingest(event: NativeRuntimeEvent): SemanticAgentBlock[];
  stateForRuntime(runtimeId: string): NativeProviderRuntimeState | undefined;
}

export function createNativeRuntimePipeline(input: {
  evidenceStore?: NativeEvidenceStore;
} = {}): NativeRuntimePipeline {
  const states = new Map<string, NativeProviderRuntimeState>();

  return {
    ingest(event) {
      input.evidenceStore?.recordReduced(event);
      const existing = states.get(event.runtimeId) ?? createNativeProviderRuntimeState({
        provider: event.provider,
        transport: event.transport,
        runtimeId: event.runtimeId,
        tideThreadId: event.tideThreadId,
        providerSessionId: event.providerSessionId,
      });
      const reducer = reducerForEvent(event);
      const result = reducer(existing, event);
      states.set(event.runtimeId, result.state);
      return projectNativeStatePatchToSemanticBlocks({
        state: result.state,
        patch: result.patch,
      });
    },
    stateForRuntime(runtimeId) {
      return states.get(runtimeId);
    },
  };
}

function reducerForEvent(event: NativeRuntimeEvent) {
  switch (event.provider) {
    case "codex":
      return reduceCodexNativeEvent;
    case "claude":
      return reduceClaudeNativeEvent;
    case "opencode":
    case "qwen":
      return reduceAcpNativeEvent;
  }
}
