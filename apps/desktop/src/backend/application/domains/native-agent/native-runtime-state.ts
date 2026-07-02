import type { ThreadId } from "../thread/thread.ts";
import type {
  NativeEvidenceSnapshot,
  NativeLifecycleStatus,
  NativeProviderId,
  NativeRuntimeEvent,
  NativeTransport,
} from "./native-runtime-event.ts";
import type { SemanticAgentBlockKind } from "./semantic-agent-block.ts";

export interface NativeSemanticStateEntry {
  key: string;
  blockId: string;
  kind: SemanticAgentBlockKind;
  provider: NativeProviderId;
  transport: NativeTransport;
  tideThreadId: ThreadId;
  runtimeId: string;
  providerSessionId?: string;
  nativeIds: NativeRuntimeEvent["nativeIds"];
  parentKey?: string;
  parentBlockId?: string;
  status: NativeLifecycleStatus;
  title?: string;
  body?: string;
  data: Record<string, unknown>;
  evidence: NativeEvidenceSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface NativeProviderRuntimeState {
  provider: NativeProviderId;
  transport: NativeTransport;
  runtimeId: string;
  tideThreadId: ThreadId;
  providerSessionId?: string;
  lastSequence: number;
  entries: Map<string, NativeSemanticStateEntry>;
}

export interface NativeStatePatch {
  provider: NativeProviderId;
  transport: NativeTransport;
  runtimeId: string;
  tideThreadId: ThreadId;
  providerSessionId?: string;
  affectedNativeIds: NativeRuntimeEvent["nativeIds"][];
  semanticDirtyKeys: string[];
  evidence: NativeEvidenceSnapshot[];
}

export interface NativeReducerResult {
  state: NativeProviderRuntimeState;
  patch: NativeStatePatch;
}

export type NativeRuntimeReducer = (
  state: NativeProviderRuntimeState,
  event: NativeRuntimeEvent,
) => NativeReducerResult;

export function createNativeProviderRuntimeState(input: {
  provider: NativeProviderId;
  transport: NativeTransport;
  runtimeId: string;
  tideThreadId: ThreadId;
  providerSessionId?: string;
}): NativeProviderRuntimeState {
  return {
    provider: input.provider,
    transport: input.transport,
    runtimeId: input.runtimeId,
    tideThreadId: input.tideThreadId,
    providerSessionId: input.providerSessionId,
    lastSequence: 0,
    entries: new Map<string, NativeSemanticStateEntry>(),
  };
}
