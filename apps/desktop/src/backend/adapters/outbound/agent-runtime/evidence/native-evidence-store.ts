import type {
  NativeEvidenceSnapshot,
  NativeRuntimeEvent,
} from "../../../../application/domains/native-agent/native-runtime-event.ts";

export interface NativeRawFrameRecord {
  rawRef: string;
  tideThreadId: string;
  eventId: string;
  receivedAt: string;
  byteLength: number;
  payload: unknown;
}

export interface NativeEvidenceStore {
  recordReduced(event: NativeRuntimeEvent): NativeEvidenceSnapshot;
  recordRaw?(event: NativeRuntimeEvent): NativeRawFrameRecord | undefined;
  snapshotsForThread(tideThreadId: string): NativeEvidenceSnapshot[];
  rawFramesForThread?(tideThreadId: string): NativeRawFrameRecord[];
  deleteThreadEvidence(tideThreadId: string): void;
}

export interface InMemoryNativeEvidenceStoreOptions {
  keepRawFrames?: boolean;
  rawFrameLimit?: number;
  rawByteLimit?: number;
  rawTtlMs?: number;
  now?: () => string;
}

export function createInMemoryNativeEvidenceStore(
  options: InMemoryNativeEvidenceStoreOptions = {},
): NativeEvidenceStore {
  const snapshots = new Map<string, NativeEvidenceSnapshot[]>();
  const rawFrames = new Map<string, NativeRawFrameRecord[]>();
  const rawFrameLimit = options.rawFrameLimit ?? 2000;
  const rawByteLimit = options.rawByteLimit ?? 10 * 1024 * 1024;
  const rawTtlMs = options.rawTtlMs ?? 7 * 24 * 60 * 60 * 1000;

  return {
    recordReduced(event) {
      const rawRecord = options.keepRawFrames ? recordRawFrame(event) : undefined;
      const snapshot = createReducedNativeEvidenceSnapshot(event, rawRecord?.rawRef);
      const existing = snapshots.get(event.tideThreadId) ?? [];
      existing.push(snapshot);
      snapshots.set(event.tideThreadId, existing);
      return snapshot;
    },
    recordRaw: options.keepRawFrames ? recordRawFrame : undefined,
    snapshotsForThread(tideThreadId) {
      return [...(snapshots.get(tideThreadId) ?? [])];
    },
    rawFramesForThread(tideThreadId) {
      const existing = rawFrames.get(tideThreadId) ?? [];
      pruneRawFrames(existing);
      if (existing.length === 0) {
        rawFrames.delete(tideThreadId);
      }
      return [...existing];
    },
    deleteThreadEvidence(tideThreadId) {
      snapshots.delete(tideThreadId);
      rawFrames.delete(tideThreadId);
    },
  };

  function recordRawFrame(event: NativeRuntimeEvent): NativeRawFrameRecord | undefined {
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(event.payload);
    } catch {
      payloadJson = "[unserializable]";
    }
    const record: NativeRawFrameRecord = {
      rawRef: `raw:${event.tideThreadId}:${event.eventId}`,
      tideThreadId: event.tideThreadId,
      eventId: event.eventId,
      receivedAt: options.now?.() ?? event.receivedAt,
      byteLength: Buffer.byteLength(payloadJson, "utf8"),
      payload: event.payload,
    };
    const existing = rawFrames.get(event.tideThreadId) ?? [];
    existing.push(record);
    pruneRawFrames(existing);
    rawFrames.set(event.tideThreadId, existing);
    return existing.includes(record) ? record : undefined;
  }

  function pruneRawFrames(records: NativeRawFrameRecord[]): void {
    const expiresBefore = currentTimeMs() - rawTtlMs;
    while (records.length > 0 && recordTimeMs(records[0]) < expiresBefore) {
      records.shift();
    }
    while (records.length > rawFrameLimit) {
      records.shift();
    }
    let bytes = records.reduce((total, record) => total + record.byteLength, 0);
    while (bytes > rawByteLimit && records.length > 0) {
      const removed = records.shift();
      bytes -= removed?.byteLength ?? 0;
    }
  }

  function currentTimeMs(): number {
    return Date.parse(options.now?.() ?? new Date().toISOString());
  }

  function recordTimeMs(record: NativeRawFrameRecord | undefined): number {
    const parsed = Date.parse(record?.receivedAt ?? "");
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  }
}

export function createReducedNativeEvidenceSnapshot(
  event: NativeRuntimeEvent,
  rawRef?: string,
): NativeEvidenceSnapshot {
  const { payloadShape, redactedFields } = describePayloadShape(event.payload);
  return {
    eventId: event.eventId,
    provider: event.provider,
    transport: event.transport,
    nativeKind: event.nativeKind,
    nativeIds: { ...event.nativeIds },
    receivedAt: event.receivedAt,
    summary: summarizeNativeEvent(event),
    payloadShape,
    redactedFields,
    rawRef,
  };
}

function summarizeNativeEvent(event: NativeRuntimeEvent): string {
  const ids = Object.entries(event.nativeIds)
    .filter(([, value]) => value !== undefined && value.length > 0)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return ids.length > 0
    ? `${event.provider}/${event.nativeKind} ${ids}`
    : `${event.provider}/${event.nativeKind}`;
}

function describePayloadShape(payload: unknown): {
  payloadShape: string[];
  redactedFields: string[];
} {
  const shape: string[] = [];
  const redacted = new Set<string>();
  walkShape(payload, "$", shape, redacted, 0);
  return {
    payloadShape: shape.slice(0, 80),
    redactedFields: [...redacted].sort(),
  };
}

function walkShape(
  value: unknown,
  path: string,
  shape: string[],
  redacted: Set<string>,
  depth: number,
): void {
  if (depth > 4) {
    shape.push(`${path}:depth_limit`);
    return;
  }
  if (value === null) {
    shape.push(`${path}:null`);
    return;
  }
  if (Array.isArray(value)) {
    shape.push(`${path}:array(${value.length})`);
    const first = value[0];
    if (first !== undefined) {
      walkShape(first, `${path}[]`, shape, redacted, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") {
    shape.push(`${path}:${typeof value}`);
    return;
  }
  if (!isPlainObject(value)) {
    shape.push(`${path}:object`);
    return;
  }
  let keys: string[];
  try {
    keys = Object.keys(value).sort();
  } catch {
    shape.push(`${path}:object`);
    return;
  }
  shape.push(`${path}:object(${keys.join(",")})`);
  for (const key of keys.slice(0, 40)) {
    const childPath = `${path}.${key}`;
    if (isSensitiveFieldName(key)) {
      redacted.add(childPath);
      shape.push(`${childPath}:redacted`);
      continue;
    }
    let childValue: unknown;
    try {
      childValue = value[key];
    } catch {
      shape.push(`${childPath}:unreadable`);
      continue;
    }
    walkShape(childValue, childPath, shape, redacted, depth + 1);
  }
}

function isSensitiveFieldName(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("secret") ||
    normalized.includes("token") ||
    isSensitiveCredentialKey(normalized) ||
    normalized.includes("password") ||
    normalized.includes("credential") ||
    normalized === "prompt" ||
    normalized === "body" ||
    normalized === "content" ||
    normalized === "text" ||
    normalized === "diff" ||
    normalized === "output" ||
    normalized === "stdout" ||
    normalized === "stderr" ||
    normalized === "env" ||
    normalized.endsWith("path")
  );
}

function isPlainObject(value: object): value is Record<string, unknown> {
  try {
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
  } catch {
    return false;
  }
}

function isSensitiveCredentialKey(normalized: string): boolean {
  const nonSensitiveKeySuffixes = new Set([
    "donkey",
    "donkeys",
    "hockey",
    "monkey",
    "monkeys",
    "turkey",
    "turkeys",
    "whiskey",
    "whiskeys",
  ]);
  return (
    normalized === "key" ||
    normalized === "keys" ||
    ((normalized.endsWith("key") || normalized.endsWith("keys")) && !nonSensitiveKeySuffixes.has(normalized))
  );
}
