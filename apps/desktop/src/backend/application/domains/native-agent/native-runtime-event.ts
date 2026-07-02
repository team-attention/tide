import type { ThreadId } from "../thread/thread.ts";

export type NativeProviderId = "codex" | "claude" | "opencode" | "qwen";

export type NativeTransport = "codex_app_server" | "claude_stream_json" | "acp";

export type NativeRedactionLevel = "raw" | "reduced" | "summary_only";

export interface NativeRuntimeIds {
  threadId?: string;
  turnId?: string;
  itemId?: string;
  requestId?: string;
  callId?: string;
  messageId?: string;
  blockId?: string;
  sessionId?: string;
  activityId?: string;
}

export interface NativeRuntimeEvent {
  eventId: string;
  provider: NativeProviderId;
  transport: NativeTransport;
  runtimeId: string;
  tideThreadId: ThreadId;
  providerSessionId?: string;
  nativeSequence: number;
  receivedAt: string;
  nativeKind: string;
  nativeIds: NativeRuntimeIds;
  payload: unknown;
  redaction: NativeRedactionLevel;
}

export interface NativeEvidenceSnapshot {
  eventId: string;
  provider: NativeProviderId;
  transport: NativeTransport;
  nativeKind: string;
  nativeIds: NativeRuntimeIds;
  receivedAt: string;
  summary: string;
  payloadShape: string[];
  redactedFields: string[];
  rawRef?: string;
}

export type NativeLifecycleStatus =
  | "pending"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "cancelled";

export function isNativeProviderId(value: string): value is NativeProviderId {
  return value === "codex" || value === "claude" || value === "opencode" || value === "qwen";
}

export function nativeTransportFromLaunchTransport(value: string): NativeTransport | undefined {
  switch (value) {
    case "codex_app_server":
    case "claude_stream_json":
    case "acp":
      return value;
    default:
      return undefined;
  }
}

export function stableNativeId(input: {
  provider: NativeProviderId;
  runtimeId: string;
  nativeKind: string;
  nativeIds: NativeRuntimeIds;
  fallback: string;
}): string {
  const candidate =
    input.nativeIds.itemId ??
    input.nativeIds.callId ??
    input.nativeIds.requestId ??
    input.nativeIds.messageId ??
    input.nativeIds.blockId ??
    input.nativeIds.activityId ??
    input.nativeIds.turnId ??
    input.nativeIds.sessionId;
  return `${input.provider}:${input.runtimeId}:${input.nativeKind}:${candidate ?? input.fallback}`;
}
