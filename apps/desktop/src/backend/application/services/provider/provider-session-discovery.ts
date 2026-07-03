// Spec: docs_v2/specs/local-provider-session-discovery.md
//
// Discovers coding-agent sessions that already exist in the user's local
// provider history (created by the provider CLIs outside Tide) and adopts them
// as Tide Threads scoped to the registered Project whose cwd they belong to.
//
// The core is pure: directory listing and file reads are injected so it can be
// unit-tested with a fake filesystem before touching real provider history.

import type { ThreadSeed } from "../thread/thread-runtime-service.ts";

export type DiscoveredAgentId = "codex" | "claude" | "opencode";

export interface DiscoveredSession {
  agentId: DiscoveredAgentId;
  sessionId: string;
  transcriptPath?: string;
  cwd: string;
  title: string;
  startedAtMs: number;
}

export interface OpencodeSessionListEntry {
  id: string;
  title?: string;
  created: number;
  updated: number;
  projectId?: string;
  directory: string;
}

export interface OpencodeExport {
  info: Record<string, unknown>;
  messages: OpencodeExportMessage[];
}

export interface OpencodeExportMessage {
  info: Record<string, unknown>;
  parts: Record<string, unknown>[];
}

// Injected filesystem surface. Real implementations live in live-backend.
export interface DiscoveryFs {
  // Claude transcripts under the cwd-encoded project directory.
  listClaudeTranscripts(cwd: string): { path: string; sessionId: string; mtimeMs: number }[];
  // All recent codex rollouts (filtered to a cwd by reading session_meta).
  listCodexRollouts(): { path: string; mtimeMs: number }[];
  listOpencodeSessions(): OpencodeSessionListEntry[];
  exportOpencodeSession(sessionId: string): string | undefined;
  readText(path: string): string | undefined;
}

const MAX_TITLE = 64;

// --- Descriptor parsers (pure, given file contents) ---

// Codex rollout: first line is session_meta with payload.cwd; the first user
// turn is an event_msg with payload.type === "user_message".
export function codexSessionDescriptor(text: string): { cwd?: string; title?: string } {
  let cwd: string | undefined;
  let title: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const record = parseJsonObject(line);
    if (record === undefined) {
      continue;
    }
    const payload = asRecord(record.payload);
    if (record.type === "session_meta" && cwd === undefined) {
      cwd = stringField(payload, "cwd");
    }
    if (record.type === "event_msg" && payload?.type === "user_message" && title === undefined) {
      title = cleanTitle(stringField(payload, "message") ?? joinTextContent(payload?.content));
    }
    if (cwd !== undefined && title !== undefined) {
      break;
    }
  }
  return { cwd, title };
}

// Claude transcript: first record with type === "user" and message.role "user".
// Skips command/meta envelopes that have no human text.
export function claudeSessionTitle(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const record = parseJsonObject(line);
    if (record?.type !== "user") {
      continue;
    }
    const message = asRecord(record.message);
    if (message?.role !== "user") {
      continue;
    }
    const body = cleanTitle(joinTextContent(message.content));
    if (body !== undefined && body.length > 0) {
      return body;
    }
  }
  return undefined;
}

// --- Discovery orchestrator (pure given injected fs) ---

export function discoverLocalSessions(input: {
  cwds: string[];
  fs: DiscoveryFs;
}): DiscoveredSession[] {
  const cwds = [...new Set(input.cwds)];
  const cwdSet = new Set(cwds);
  const sessions: DiscoveredSession[] = [];

  // Claude: per-cwd directory scan.
  for (const cwd of cwds) {
    for (const entry of input.fs.listClaudeTranscripts(cwd)) {
      const text = input.fs.readText(entry.path);
      const title = (text && claudeSessionTitle(text)) || datedTitle("Claude", entry.mtimeMs);
      if (isInternalSessionTitle(title)) continue;
      sessions.push({
        agentId: "claude",
        sessionId: entry.sessionId,
        transcriptPath: entry.path,
        cwd,
        title,
        startedAtMs: entry.mtimeMs,
      });
    }
  }

  // Codex: one pass over rollouts, bucketed by parsed cwd.
  for (const entry of input.fs.listCodexRollouts()) {
    const text = input.fs.readText(entry.path);
    if (text === undefined) {
      continue;
    }
    const descriptor = codexSessionDescriptor(text);
    if (descriptor.cwd === undefined || !cwdSet.has(descriptor.cwd)) {
      continue;
    }
    const title = descriptor.title || datedTitle("Codex", entry.mtimeMs);
    if (isInternalSessionTitle(title)) continue;
    sessions.push({
      agentId: "codex",
      sessionId: codexSessionIdFromPath(entry.path),
      transcriptPath: entry.path,
      cwd: descriptor.cwd,
      title,
      startedAtMs: entry.mtimeMs,
    });
  }

  // opencode: provider CLI list/export is injected by the Node infrastructure.
  for (const entry of input.fs.listOpencodeSessions()) {
    if (!cwdSet.has(entry.directory)) {
      continue;
    }
    const exported = input.fs.exportOpencodeSession(entry.id);
    const title =
      meaningfulOpencodeTitle(entry.title) ??
      (exported === undefined ? undefined : opencodeFirstUserTextFromExport(exported)) ??
      datedTitle("opencode", opencodeTimestampMs(entry.updated || entry.created));
    if (isInternalSessionTitle(title)) continue;
    sessions.push({
      agentId: "opencode",
      sessionId: entry.id,
      cwd: entry.directory,
      title,
      startedAtMs: opencodeTimestampMs(entry.created || entry.updated),
    });
  }

  return sessions;
}

// Auto-review / internal sub-sessions (e.g. Tide or Codex spawning a review pass
// to assess a planned action) are not real user conversations and must not be
// adopted as Threads. They are identifiable by their prompt markers.
const INTERNAL_SESSION_MARKERS = [
  "the following is the codex agent history",
  "approval request start",
  ">>> transcript",
  "reviewed codex session",
  "request action you must assess",
  "planned action json",
];

export function isInternalSessionTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return INTERNAL_SESSION_MARKERS.some((marker) => lower.includes(marker));
}

// Deterministic Thread id so re-discovery across restarts is idempotent.
export function adoptedThreadId(sessionId: string): string {
  return `adopted-${sessionId}`;
}

const SESSION_REF_KIND: Record<DiscoveredAgentId, string> = {
  codex: "codex_rollout",
  claude: "claude_transcript",
  opencode: "opencode_session",
};

// Maps discovered sessions to adopted ThreadSeeds, dropping any that a persisted
// Tide thread already owns (by ref value) or that already exist (by threadId).
export function adoptedThreadSeedsFromSessions(input: {
  sessions: DiscoveredSession[];
  projectIdForCwd: (cwd: string) => string;
  existingRefValues: ReadonlySet<string>;
  existingThreadIds: ReadonlySet<string>;
}): ThreadSeed[] {
  const seeds: ThreadSeed[] = [];
  const claimed = new Set<string>();
  for (const session of input.sessions) {
    const threadId = adoptedThreadId(session.sessionId);
    if (
      input.existingRefValues.has(session.sessionId) ||
      input.existingThreadIds.has(threadId) ||
      claimed.has(threadId)
    ) {
      continue;
    }
    claimed.add(threadId);
    const timestamp = new Date(session.startedAtMs).toISOString();
    seeds.push({
      threadId,
      title: session.title,
      agentBinding: {
        agentId: session.agentId,
        runtimeSource: { kind: "provider_cli", integrationId: session.agentId },
        providerSessionRef: {
          kind: SESSION_REF_KIND[session.agentId] as never,
          value: session.sessionId,
          ...(session.transcriptPath === undefined ? {} : { transcriptPath: session.transcriptPath }),
        },
      },
      scope: {
        kind: "project",
        projectId: input.projectIdForCwd(session.cwd),
        cwd: session.cwd,
      },
      lifecycleState: "open",
      runtimeState: "not_started",
      lastKnownState: "idle",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  return seeds;
}

export function parseOpencodeSessionListText(text: string): OpencodeSessionListEntry[] {
  const parsed = parseJsonValue(text);
  const parsedRecord = asRecord(parsed);
  const records: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsedRecord?.sessions)
      ? parsedRecord.sessions
      : [];
  return records.flatMap((record) => {
    const item = asRecord(record);
    const id = stringField(item, "id");
    const directory = stringField(item, "directory");
    if (id === undefined || directory === undefined) {
      return [];
    }
    return [{
      id,
      title: stringField(item, "title"),
      created: numberField(item, "created") ?? numberField(item, "timeCreated") ?? 0,
      updated: numberField(item, "updated") ?? numberField(item, "timeUpdated") ?? 0,
      projectId: stringField(item, "projectId"),
      directory,
    }];
  });
}

export function parseOpencodeExportText(text: string): OpencodeExport | undefined {
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) {
    return undefined;
  }
  const parsed = parseJsonValue(text.slice(jsonStart));
  const record = asRecord(parsed);
  const messages = Array.isArray(record?.messages) ? record.messages : undefined;
  if (record === undefined || messages === undefined) {
    return undefined;
  }
  const parsedMessages: OpencodeExportMessage[] = messages.flatMap((message) => {
      const messageRecord = asRecord(message);
      if (messageRecord === undefined) {
        return [];
      }
      const parts: Record<string, unknown>[] = Array.isArray(messageRecord.parts)
        ? messageRecord.parts.flatMap((part) => {
            const partRecord = asRecord(part);
            return partRecord === undefined ? [] : [partRecord];
          })
        : [];
      return [{
        info: asRecord(messageRecord.info) ?? {},
        parts,
      }];
    });
  return {
    info: asRecord(record.info) ?? {},
    messages: parsedMessages,
  };
}

export function opencodeFirstUserTextFromExport(text: string): string | undefined {
  const exported = parseOpencodeExportText(text);
  for (const message of exported?.messages ?? []) {
    if (stringField(message.info, "role") !== "user") {
      continue;
    }
    const title = cleanTitle(opencodeTextParts(message.parts));
    if (title !== undefined) {
      return title;
    }
  }
  return undefined;
}

// --- helpers ---

function codexSessionIdFromPath(path: string): string {
  const base = path.replace(/^.*\//, "").replace(/\.jsonl$/, "");
  // rollout-<ISO>-<uuid>; the uuid is the codex session id.
  const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? match[1] : base;
}

function datedTitle(provider: string, mtimeMs: number): string {
  const date = new Date(mtimeMs);
  const iso = Number.isFinite(mtimeMs) ? date.toISOString().slice(0, 10) : "session";
  return `${provider} session ${iso}`;
}

function meaningfulOpencodeTitle(value: string | undefined): string | undefined {
  const title = cleanTitle(value);
  if (title === undefined) {
    return undefined;
  }
  const lower = title.toLowerCase();
  return lower.startsWith("new session") ? undefined : title;
}

function cleanTitle(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return undefined;
  }
  return collapsed.length > MAX_TITLE ? `${collapsed.slice(0, MAX_TITLE - 1)}…` : collapsed;
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed[0] !== "{") {
    return undefined;
  }
  try {
    const value = JSON.parse(trimmed);
    return asRecord(value);
  } catch {
    return undefined;
  }
}

function parseJsonValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function opencodeTimestampMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return Date.now();
  }
  return value < 10_000_000_000 ? value * 1000 : value;
}

function opencodeTextParts(parts: Record<string, unknown>[]): string | undefined {
  const joined = parts
    .filter((part) => partKind(part) === "text")
    .map((part) => stringField(part, "text") ?? stringField(part, "content"))
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join("\n\n");
  return joined.length > 0 ? joined : undefined;
}

function partKind(part: Record<string, unknown>): string | undefined {
  return stringField(part, "type") ?? stringField(part, "kind");
}

// Joins an array of {type:"text", text} / {text} content items, or a plain
// string, into one string.
function joinTextContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const item of content) {
    const record = asRecord(item);
    if (record === undefined) {
      continue;
    }
    if (record.type === undefined || record.type === "text") {
      const text = stringField(record, "text");
      if (text !== undefined) {
        parts.push(text);
      }
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}
