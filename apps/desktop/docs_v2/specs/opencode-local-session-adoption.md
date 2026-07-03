# Spec: opencode Local Session Adoption

## Scope

Adopt opencode sessions that were created outside Tide as Tide Threads, scoped to
the registered Project whose cwd matches the opencode session directory.

This extends `local-provider-session-discovery.md`, which currently covers
Codex and Claude only. The user-facing behavior should match those adopted
threads: local opencode history appears in the Left Rail, opens as an Agent
Session, and resumes through the provider-native opencode session reference.

## Evidence

- `local-provider-session-discovery.md` explicitly lists "Gemini/opencode
  external-session discovery" as out of scope.
- `provider-session-discovery.ts` currently defines
  `DiscoveredAgentId = "codex" | "claude"`.
- `live-provider-discovery.ts` already runs background adopted-session
  discovery after the first thread list, maps discovered sessions to
  `ThreadSeed`s, and can seed cached blocks.
- `provider-conversation-rebuilders.ts` currently returns `[]` for
  `opencode_session` with a comment saying opencode has no rebuilder yet.
- Shared contracts and backend domain types already include
  `ProviderSessionRef.kind = "opencode_session"`.
- `agent-descriptors.ts` already declares opencode's `sessionRefKind` as
  `opencode_session`.
- Local opencode 1.17.3 provides a CLI-level discovery/export interface:
  - `opencode session list --format json --max-count 3` returns records with
    `id`, `title`, `updated`, `created`, `projectId`, and `directory`.
  - `opencode export <sessionID> --sanitize` returns JSON with `info` and
    `messages`; the command prints an "Exporting session: ..." line before the
    JSON, so the parser must trim to the first `{`.
  - Exported `messages[]` contain `info.role`, message ids, timestamps, model
    metadata, and `parts[]` such as `text`, `reasoning`, `tool`,
    `step-start`, and `step-finish`.
- `opencode db path` exists, but the CLI export is the safer public boundary for
  Tide. Tide should not depend on opencode's private SQLite schema for this
  slice.
- opencode runtime resume is already structured around ACP: the runtime port
  passes `resumeRef` to the ACP client as `resumeSessionId`, and the ACP client
  calls `session/load`.

## Decisions

1. **Use opencode CLI commands, not the DB.** Discovery uses
   `opencode session list --format json --max-count <N>`. Rebuilding uses
   `opencode export <sessionID>`. Direct DB reads are out of scope.
2. **Bound discovery.** Start with a fixed max count of 200 sessions. The command
   is local but still a subprocess; it runs in the existing background adoption
   phase, never before first paint.
3. **Filter by cwd from the list output.** `directory` is matched against the
   registered Project cwds and persisted project cwds already used by
   `local-provider-session-discovery.md`.
4. **Provider session ref stores the opencode session id.** Adopted opencode
   Threads use:
   `{ kind: "opencode_session", value: sessionId }`.
   `transcriptPath` remains undefined because the canonical read path is
   `opencode export`, not a stable file path.
5. **Title source.** Prefer the `title` field from `opencode session list` when
   it is meaningful. If it is empty or a generic "New session..." title, use
   the first user text part from export, then `opencode session <date>`.
6. **Rebuild from unsanitized local export.** Tide may call plain
   `opencode export <sessionID>` for local rendering because the data stays on
   the user's machine. Sanitized export is only for fixtures, logs, or shareable
   debugging.
7. **No raw export persistence.** Tide stores Thread metadata and may store the
   existing Agent Session cache, but it does not store opencode's raw export as a
   second conversation source of truth.
8. **Resume through existing opencode ACP.** Starting from an adopted opencode
   Thread resumes with `providerSessionRef.value` and the existing
   `session/load` path. This slice must verify that an adopted
   `opencode_session` ref reaches ACP resume.

## Out Of Scope

- Live watching for new opencode sessions while Tide is already running.
- Importing all opencode database tables or reading `opencode.db` directly.
- Persisting rename/archive/pin metadata for adopted opencode sessions beyond
  the behavior already available for adopted Codex/Claude sessions.
- Cross-machine sync or cloud import.
- Sanitized sharing/export UI.
- Pixel-perfect rendering of every opencode part kind. Unknown parts still
  render as explicit raw evidence blocks.

## Completion Definition

This slice is complete only when an opencode session created outside Tide can
be discovered, adopted as a Tide Thread, opened with visible Agent Session
history, and resumed through the same opencode session id for a follow-up turn.

The implementation must include:

- opencode session list command execution with bounded subprocess behavior;
- opencode export command execution and parser support for the leading
  non-JSON command line;
- Project cwd filtering, deduplication, deterministic adopted Thread identity,
  and normal Left Rail visibility;
- Agent Session Block rebuilding for user text, assistant text, reasoning,
  tool evidence, step boundaries, and unknown parts as raw evidence blocks;
- hydrate/open behavior that shows the rebuilt history instead of an empty
  adopted Thread;
- runtime resume wiring that passes the adopted `opencode_session` id to ACP
  `session/load`;
- an opt-in integration smoke path
  (`npm run test:smoke:opencode-adoption -- --cwd <path>`) that adopts a real
  local opencode session, opens it, sends a follow-up, and verifies the same
  session export contains the follow-up.

This slice is not complete if it only lists opencode sessions, only creates
metadata-only Threads, opens adopted Threads without history, requires a manual
copy/paste import step, or postpones resume/follow-up to another slice.

## Domain Model

Pure discovery model:

```ts
interface OpencodeSessionListEntry {
  id: string;
  title?: string;
  created: number;
  updated: number;
  projectId?: string;
  directory: string;
}

interface OpencodeExport {
  info: {
    id: string;
    title?: string;
    directory?: string;
    agent?: string;
    model?: { id?: string; providerID?: string; variant?: string };
    time?: { created?: number; updated?: number };
  };
  messages: OpencodeExportMessage[];
}

interface OpencodeExportMessage {
  info: {
    id?: string;
    role?: "user" | "assistant";
    time?: { created?: number; completed?: number };
    modelID?: string;
    providerID?: string;
    variant?: string;
  };
  parts: OpencodeExportPart[];
}
```

`DiscoveredAgentId` expands to `"codex" | "claude" | "opencode"`.

`DiscoveryFs` or a sibling injected port gains:

```ts
listOpencodeSessions(): OpencodeSessionListEntry[];
exportOpencodeSession(sessionId: string): string | undefined;
```

The pure parser strips any leading non-JSON command text before parsing export
JSON.

## Contracts

- No new Desktop/Backend process contract is required.
- Existing `ThreadSeed.agentBinding.providerSessionRef` carries the opencode
  session reference:

```ts
{
  kind: "opencode_session",
  value: sessionId
}
```

- Existing `thread.listed` and `thread.hydrated` events carry the adopted Thread
  through the normal path.
- Existing `agentRuntime.resume` uses the Thread's provider session ref. No new
  resume command is introduced.

## Flow

1. Backend restores persisted Thread metadata and emits the first thread list as
   it does today.
2. Background adopted-session discovery starts.
3. Discovery collects candidate cwds from registered Projects and persisted
   project-scoped Threads.
4. Node infrastructure runs
   `opencode session list --format json --max-count 200`.
5. It filters entries whose `directory` is in the candidate cwd set.
6. It drops entries already owned by a persisted Thread or already restored in
   this discovery pass.
7. It maps each remaining entry to a `ThreadSeed`:
   - `agentId: "opencode"`
   - `runtimeSource.integrationId: "opencode"`
   - `providerSessionRef.kind: "opencode_session"`
   - `providerSessionRef.value: entry.id`
   - `scope.cwd: entry.directory`
   - timestamps from `created` and `updated`
8. For each newly adopted opencode seed, Backend calls
   `opencode export <sessionID>` and rebuilds Agent Session Blocks.
9. If blocks are available, they are attached as `cachedBlocks` before
   `restoreThreads`.
10. Backend restores adopted seeds and pushes a refreshed `thread.listed` event.
11. Opening the adopted Thread shows the rebuilt Agent Session.
12. Sending a follow-up or resuming the runtime uses the existing opencode ACP
    `session/load` path with the adopted session id.

## Invariants

- opencode session discovery never gates the first thread list.
- Tide never writes to opencode history during discovery or rebuild.
- Tide never reads opencode's private DB schema for this slice.
- One opencode session id maps to at most one Tide Thread.
- An adopted opencode Thread's Project cwd equals the opencode list entry's
  `directory`.
- Unknown export message parts are not dropped silently. They produce raw
  evidence blocks or are represented in a bounded raw field on a nearby block.
- Export parsing is bounded by timeout and stdout size. A failed export emits a
  per-session import diagnostic and does not create an empty adopted Thread; it
  must not abort the whole discovery pass.
- Resume uses the same opencode session id that was adopted.

## Tests

- CLI parser: `opencode session list` JSON maps to
  `OpencodeSessionListEntry[]`, ignoring malformed records.
- Export parser: strips the leading "Exporting session: ..." line and parses the
  JSON object from the first `{`.
- Discovery: filters opencode sessions to registered Project cwds.
- Discovery: maps an opencode entry to a ThreadSeed with
  `providerSessionRef.kind === "opencode_session"` and no `transcriptPath`.
- Dedup: skips opencode entries whose session id is already present in persisted
  Thread refs.
- Title: uses meaningful list title, then first user text part, then a dated
  generated title.
- Rebuilder: user `text` part becomes a `user_message` block.
- Rebuilder: assistant text part becomes an `agent_message` block.
- Rebuilder: `reasoning` part becomes a `reasoning` block.
- Rebuilder: `tool` part with completed state becomes tool call/result evidence
  or a bounded `tool_result` block.
- Rebuilder: `step-start` and `step-finish` do not create noisy standalone
  blocks unless they carry useful usage/finish data.
- Rebuilder: unknown part kind becomes `raw_block`.
- Failure handling: failed export creates an import diagnostic and no empty
  Thread.
- Runtime: resuming an adopted opencode Thread passes `providerSessionRef.value`
  to the ACP client as `resumeSessionId`.
- Integration smoke, user-approved:
  `npm run test:smoke:opencode-adoption -- --cwd <path>` adopts a local
  opencode session, opens it in Tide, sends a follow-up, and verifies the same
  opencode session export contains the follow-up token.

## Implementation Notes

- Add opencode support to the existing discovery core rather than creating a
  second adoption service. The current background phase and deterministic
  adopted Thread id behavior should remain.
- Keep command execution in Node infrastructure. The pure application service
  should receive parsed entries or injected command-reader functions.
- `opencode export` can return large transcripts. Use a bounded subprocess
  helper with timeout and max stdout. If the output exceeds the bound, emit a
  visible truncated-session evidence block; do not create an adopted Thread
  that opens as empty history.
- For local rendering, do not pass `--sanitize`; sanitized output redacts the
  content Tide needs to render. Tests can use sanitized fixtures because they
  validate structure.
- The existing `rebuildConversationFromProviderHistory` currently returns early
  when `transcriptPath` is missing. opencode support should branch on
  `ref.kind === "opencode_session"` before requiring a file path.
- Consider extracting provider rebuild helpers into per-provider files if
  `provider-conversation-rebuilders.ts` grows further.
