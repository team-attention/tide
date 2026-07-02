import type {
  NativeProviderId,
  NativeRedactionLevel,
  NativeRuntimeEvent,
  NativeRuntimeIds,
  NativeTransport,
} from "../../../../application/domains/native-agent/native-runtime-event.ts";
import {
  isNativeProviderId,
  nativeTransportFromLaunchTransport,
} from "../../../../application/domains/native-agent/native-runtime-event.ts";
import type { SemanticAgentBlock } from "../../../../application/domains/native-agent/semantic-agent-block.ts";
import { createInMemoryNativeEvidenceStore } from "./native-evidence-store.ts";
import { createNativeRuntimePipeline } from "../projectors/native-runtime-pipeline.ts";

export interface NativeFixtureReplaySummary {
  frames: number;
  nativeKinds: Record<string, number>;
  semanticKinds: Record<string, number>;
  semanticBlocks: NativeFixtureReplayBlockSummary[];
  evidenceSnapshots: number;
}

export interface NativeFixtureReplayBlockSummary {
  blockId: string;
  kind: SemanticAgentBlock["kind"];
  status: SemanticAgentBlock["status"];
  parentBlockId?: string;
  title?: string;
  body?: string;
  evidenceCount: number;
}

export function replayNativeFixtureText(text: string): NativeFixtureReplaySummary {
  return replayNativeEvents(parseNativeFixtureJsonl(text));
}

export function replayNativeEvents(events: NativeRuntimeEvent[]): NativeFixtureReplaySummary {
  const evidenceStore = createInMemoryNativeEvidenceStore();
  const pipeline = createNativeRuntimePipeline({ evidenceStore });
  const nativeKinds = new Map<string, number>();
  const semanticKinds = new Map<string, number>();
  const latestBlocks = new Map<string, SemanticAgentBlock>();
  const threadIds = new Set<string>();

  for (const event of events) {
    nativeKinds.set(event.nativeKind, (nativeKinds.get(event.nativeKind) ?? 0) + 1);
    threadIds.add(event.tideThreadId);
    for (const block of pipeline.ingest(event)) {
      semanticKinds.set(block.kind, (semanticKinds.get(block.kind) ?? 0) + 1);
      latestBlocks.set(block.blockId, block);
    }
  }

  return {
    frames: events.length,
    nativeKinds: sortedCountRecord(nativeKinds),
    semanticKinds: sortedCountRecord(semanticKinds),
    semanticBlocks: [...latestBlocks.values()].map(blockSummary).sort((a, b) => a.blockId.localeCompare(b.blockId)),
    evidenceSnapshots: [...threadIds].reduce((total, threadId) => total + evidenceStore.snapshotsForThread(threadId).length, 0),
  };
}

export function parseNativeFixtureJsonl(text: string): NativeRuntimeEvent[] {
  const events: NativeRuntimeEvent[] = [];
  let lineNumber = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    lineNumber += 1;
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    events.push(nativeEventFromFixtureLine(JSON.parse(line), lineNumber));
  }
  return events;
}

function nativeEventFromFixtureLine(value: unknown, lineNumber: number): NativeRuntimeEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Fixture line ${lineNumber} is not an object.`);
  }
  const record = value as Record<string, unknown>;
  const provider = requiredString(record, "provider", lineNumber);
  const transport = requiredString(record, "transport", lineNumber);
  if (!isNativeProviderId(provider)) {
    throw new Error(`Fixture line ${lineNumber} has unsupported provider '${provider}'.`);
  }
  const nativeTransport = nativeTransportFromLaunchTransport(transport);
  if (nativeTransport === undefined) {
    throw new Error(`Fixture line ${lineNumber} has unsupported transport '${transport}'.`);
  }
  return {
    eventId: requiredString(record, "eventId", lineNumber),
    provider: provider as NativeProviderId,
    transport: nativeTransport as NativeTransport,
    runtimeId: requiredString(record, "runtimeId", lineNumber),
    tideThreadId: requiredString(record, "tideThreadId", lineNumber),
    providerSessionId: optionalString(record.providerSessionId),
    nativeSequence: requiredNumber(record, "nativeSequence", lineNumber),
    receivedAt: requiredString(record, "receivedAt", lineNumber),
    nativeKind: requiredString(record, "nativeKind", lineNumber),
    nativeIds: nativeIds(record.nativeIds),
    payload: record.payload,
    redaction: redactionLevel(record.redaction),
  };
}

function blockSummary(block: SemanticAgentBlock): NativeFixtureReplayBlockSummary {
  const summary: NativeFixtureReplayBlockSummary = {
    blockId: block.blockId,
    kind: block.kind,
    status: block.status,
    evidenceCount: block.evidence.length,
  };
  if (block.title !== undefined) {
    summary.title = block.title;
  }
  if (block.parentBlockId !== undefined) {
    summary.parentBlockId = block.parentBlockId;
  }
  if (block.body !== undefined) {
    summary.body = block.body;
  }
  return summary;
}

function sortedCountRecord(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function requiredString(record: Record<string, unknown>, key: string, lineNumber: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Fixture line ${lineNumber} is missing string field '${key}'.`);
  }
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string, lineNumber: number): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Fixture line ${lineNumber} is missing numeric field '${key}'.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nativeIds(value: unknown): NativeRuntimeIds {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: NativeRuntimeIds = {};
  for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
    if (
      isNativeIdKey(key) &&
      typeof fieldValue === "string" &&
      fieldValue.length > 0
    ) {
      out[key] = fieldValue;
    }
  }
  return out;
}

function isNativeIdKey(key: string): key is keyof NativeRuntimeIds {
  return (
    key === "threadId" ||
    key === "turnId" ||
    key === "itemId" ||
    key === "requestId" ||
    key === "callId" ||
    key === "messageId" ||
    key === "blockId" ||
    key === "sessionId" ||
    key === "activityId"
  );
}

function redactionLevel(value: unknown): NativeRedactionLevel {
  return value === "raw" || value === "summary_only" ? value : "reduced";
}
