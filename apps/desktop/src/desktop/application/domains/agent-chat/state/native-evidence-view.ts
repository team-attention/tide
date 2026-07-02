import type { AgentChatBlock, AgentChatNativeEvidenceView } from "./types.ts";

export function nativeEvidenceForBlock(block: AgentChatBlock): AgentChatNativeEvidenceView[] | undefined {
  const rawEvidence = block.localProvenance?.evidence;
  if (!Array.isArray(rawEvidence)) {
    return undefined;
  }
  const evidence = rawEvidence.map(nativeEvidenceEntry).filter((entry) => entry !== undefined);
  return evidence.length > 0 ? evidence : undefined;
}

export function nativeEvidenceLabel(evidence: AgentChatNativeEvidenceView[] | undefined): string | undefined {
  if (evidence === undefined || evidence.length === 0) {
    return undefined;
  }
  return evidence.map((entry) => entry.summary).join(" | ");
}

function nativeEvidenceEntry(value: unknown): AgentChatNativeEvidenceView | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const eventId = stringField(record.eventId);
  const provider = stringField(record.provider);
  const transport = stringField(record.transport);
  const nativeKind = stringField(record.nativeKind);
  const summary = stringField(record.summary);
  const receivedAt = stringField(record.receivedAt);
  if (
    eventId === undefined ||
    provider === undefined ||
    transport === undefined ||
    nativeKind === undefined ||
    summary === undefined ||
    receivedAt === undefined
  ) {
    return undefined;
  }
  return {
    eventId,
    provider,
    transport,
    nativeKind,
    summary,
    receivedAt,
    nativeIds: stringRecord(record.nativeIds),
    redactedFields: stringArray(record.redactedFields),
    rawRef: stringField(record.rawRef),
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return strings.length > 0 ? strings : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
