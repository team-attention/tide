# Spec: Persistence

## Scope

This spec defines Tide-owned storage and provider-owned storage boundaries.

It covers:

- app data root.
- Thread metadata storage.
- provider session reference storage.
- Agent Session Cache storage.
- PTY Transcript retention policy.
- Provider Readiness cache policy.
- Scratch working directory ownership.
- cache invalidation.
- early migration policy.

It does not define provider history formats, provider auth storage, provider onboarding storage, Directory Trust mutation, or full-text search indexing.

## Evidence

- `docs_v2/glossary.md` defines Raw Agent Session as provider-owned session id, conversation id, log path, output, and resume identity.
- `docs_v2/glossary.md` defines Agent Session Cache as Tide's cached render model for fast Thread open while reconciling with Raw Agent Session.
- `docs_v2/glossary.md` defines Directory Trust as provider-owned state for a cwd/root path.
- `docs_v2/master-plan.md` says Tide stores a reference to Raw Agent Session, not copied provider history as the primary source of truth.
- `docs_v2/master-plan.md` says opening an old Thread can rebuild Agent Session from provider-owned history without starting a new turn.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says Tide stores Thread metadata, Agent Binding, Execution Context metadata, provider-native session reference, Last Known State, optional Agent Session Cache metadata, and app settings.
- `docs_v2/implementation/concrete-design-backlog.md` selects provider-owned history plus Tide metadata as the best persistence option.
- Provider integrations expose provider-owned history/session references Tide can
  store, including Codex rollout paths, Claude transcripts, Gemini sessions, and
  opencode sessions.

## Decisions

### D1. Provider history is source of truth

Raw Agent Session history remains provider-owned.

Tide stores provider session references and derived render cache, not a parallel conversation database.

### D2. Tide stores Thread metadata

Tide owns product navigation metadata:

- Thread id.
- title.
- pin/archive state.
- created/updated timestamps.
- Agent Binding.
- Project or Scratch scope.
- Execution Context metadata.
- provider session reference.
- Last Known State.
- Agent Session Cache metadata.

### D3. App data root comes from Desktop Main

Desktop Main resolves the Electron app data root and passes it to Backend at startup.

Backend does not hardcode platform-specific home paths.

### D4. First storage format is file-based

The first persistence slice uses file-based JSON/JSONL under the app data root.

SQLite or another database is deferred until Thread list scale, search, or transactional requirements prove the need.

### D5. Agent Session Cache is JSONL

Agent Session Cache stores derived Agent Session Blocks as JSONL per Thread.

It can be discarded and rebuilt from provider-owned Raw Agent Session when provider evidence is available.

### D6. PTY Transcript is bounded evidence

PTY Transcript is kept as:

- bounded in-memory ring buffer for active runtime recovery/debug.
- per-Thread file-backed transcript for active runtime evidence.

PTY Transcript is not the conversation source of truth.

### D7. Provider Readiness cache is advisory

Tide may store last observed Provider Readiness, including onboarding/trust blockers.

Provider remains authoritative. Tide rechecks before sending user input to a real Agent Runtime.

### D8. Migration is explicit and simple

Every Tide-owned storage record has `storageVersion`.

Unsupported future versions produce a visible storage error instead of silent downgrade.

Early migrations are additive and file-by-file.

## Out Of Scope

- Full-text search index.
- Cloud sync.
- Multi-device merge.
- Provider auth migration.
- Mutating provider Directory Trust.
- Copying provider transcript into a Tide-owned conversation database.
- Encryption policy.

## Storage Layout

App data root:

```text
<electron app userData>/
  threads/
    index.json
    <thread-id>/
      thread.json
      agent-session-cache.jsonl
      pty-transcript.log
      diagnostics/
  projects/
    index.json
  scratch/
    <thread-id>/
  settings.json
```

### `threads/index.json`

Purpose:

- fast Thread list loading.
- sort by created/updated.
- project/scratch grouping.

It may be rebuilt from `threads/*/thread.json`.

### `thread.json`

```ts
interface ThreadRecord {
  storageVersion: 1;
  threadId: ThreadId;
  title: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  agentBinding: AgentBindingRecord;
  scope: ThreadScopeRecord;
  executionContext: ExecutionContextRecord;
  providerSessionRef?: ProviderSessionRefRecord;
  lastKnownState: LastKnownStateRecord;
  cache?: AgentSessionCacheRecord;
  readiness?: ProviderReadinessRecord;
}
```

### Provider session reference

```ts
interface ProviderSessionRefRecord {
  agentId: AgentId;
  kind:
    | "codex_rollout"
    | "claude_transcript"
    | "gemini_session"
    | "opencode_session"
    | "provider_native";
  value: string;
  transcriptPath?: string;
  logPath?: string;
  observedAt: string;
}
```

### Agent Session Cache metadata

```ts
interface AgentSessionCacheRecord {
  cachePath: string;
  readerVersion: string;
  sourceFingerprint: string;
  blockCount: number;
  updatedAt: string;
}
```

### Agent Session Cache JSONL row

```ts
interface AgentSessionCacheRow {
  storageVersion: 1;
  block: AgentSessionBlock;
}
```

## Flow

### UC-1: Create Thread metadata

1. Backend accepts `thread.start`.
2. Backend creates `thread.json`.
3. Backend updates `threads/index.json`.
4. Provider session reference is absent until Agent Integration discovers it.

### UC-2: Attach provider session reference

1. Agent Integration observes rollout path, transcript path, session id, or conversation id.
2. Backend writes provider session reference into `thread.json`.
3. Backend updates cache source fingerprint.

### UC-3: Cache Agent Session Blocks

1. Backend reader emits Agent Session Blocks.
2. Backend writes derived blocks to `agent-session-cache.jsonl`.
3. Backend updates Agent Session Cache metadata.

### UC-4: Reopen Thread

1. Backend reads `thread.json`.
2. Backend validates Agent Session Cache metadata.
3. If cache is valid, Backend returns cached blocks.
4. If cache is stale or absent, Backend rebuilds from provider-owned history when available.
5. Backend does not start Agent Runtime by default.

### UC-5: Capture PTY Transcript

1. Agent Runtime is active.
2. Backend writes bounded PTY evidence to in-memory ring and `pty-transcript.log`.
3. On stop, Backend flushes and closes transcript file.
4. Future rendering uses provider history first and PTY Transcript as fallback evidence.

## Cache Invalidation

Agent Session Cache is invalid when any of these changes:

- provider session reference changes.
- reader version changes.
- provider source fingerprint changes.
- cache file is missing or malformed.
- Thread metadata indicates a newer runtime update than cache metadata.

Source fingerprint may use provider transcript path, file size, modified time, session id, conversation id, and last observed sequence depending on provider evidence.

## Invariants

1. Provider-owned Raw Agent Session remains source of truth.
2. Tide-owned Thread metadata is source of truth for product navigation.
3. Agent Session Cache is derived and discardable.
4. Provider Readiness cache is advisory and must be rechecked before runtime input.
5. Directory Trust remains provider-owned.
6. PTY Transcript is bounded evidence, not conversation database.
7. Storage records include `storageVersion`.
8. Unsupported storage versions fail visibly.
9. Thread index can be rebuilt from per-Thread metadata.
10. Reopening a Thread does not start Agent Runtime by default.

## Tests

| Rule | Test expectation |
|------|------------------|
| Thread metadata persists | `creating_thread_metadata_writes_thread_json_and_updates_index` writes `thread.json` and updates `threads/index.json`. |
| Provider ref attaches later | `provider_session_reference_attaches_after_thread_creation` stores a provider session reference after initial Thread metadata exists. |
| Cache is derived | `deleting_agent_session_cache_preserves_thread_metadata_and_provider_ref` removes derived cache without deleting Thread metadata or provider session reference. |
| Reopen uses cache | `reopening_thread_uses_valid_agent_session_cache_without_rebuild` returns cached blocks without calling rebuild. |
| Stale cache rebuilds | `stale_agent_session_cache_rebuilds_from_provider_history` detects changed source fingerprint and calls the rebuild path. |
| PTY Transcript is bounded | `pty_transcript_ring_enforces_frame_and_byte_limits` enforces configured byte and frame limits. |
| Readiness is advisory | `stored_provider_readiness_is_returned_but_preflight_is_still_required` returns stored readiness while still requiring provider recheck before input. |
| Unsupported version fails | `unsupported_storage_version_returns_visible_storage_error` rejects future `storageVersion` records. |
| Index is rebuildable | `thread_index_rebuilds_from_thread_json_files` rebuilds `threads/index.json` from per-Thread metadata. |

## Implementation Notes

- Use atomic write for JSON metadata files.
- Keep large raw payloads out of `thread.json`.
- Use JSONL for cache append/repair simplicity.
- Keep provider-owned absolute paths as references; validate existence when hydrating.
- Keep Scratch directories under app data root unless user explicitly selects a Project.
- Add storage tests before using real provider history.
- Defer SQLite until concrete query or transaction pressure exists.
