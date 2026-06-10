// Spec: docs_v2/specs/local-provider-session-discovery.md
//
// Discovers coding-agent sessions that already exist in the user's local
// provider history (created by the provider CLIs outside Tide) and adopts them
// as Tide Threads scoped to the registered Project whose cwd they belong to.
//
// The core is pure: directory listing and file reads are injected so it can be
// unit-tested with a fake filesystem before touching real provider history.

import type { ThreadSeed } from "./thread-runtime-service.ts";

export type DiscoveredAgentId = "codex" | "claude";

export interface DiscoveredSession {
  agentId: DiscoveredAgentId;
  sessionId: string;
  transcriptPath: string;
  cwd: string;
  title: string;
  startedAtMs: number;
}

// Injected filesystem surface. Real implementations live in live-backend.
export interface DiscoveryFs {
  // Claude transcripts under the cwd-encoded project directory.
  listClaudeTranscripts(cwd: string): { path: string; sessionId: string; mtimeMs: number }[];
  // All recent codex rollouts (filtered to a cwd by reading session_meta).
  listCodexRollouts(): { path: string; mtimeMs: number }[];
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

// Antigravity readable transcript: USER_INPUT entries carry the prompt text.
export function antigravitySessionTitle(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const record = parseJsonObject(line);
    if (record === undefined) {
      continue;
    }
    const kind = stringField(record, "type") ?? stringField(record, "kind");
    if (kind === "USER_INPUT" || kind === "user_input") {
      const body = cleanTitle(
        stringField(record, "text") ?? stringField(record, "message") ?? joinTextContent(record.content),
      );
      if (body !== undefined && body.length > 0) {
        return body;
      }
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
          transcriptPath: session.transcriptPath,
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
