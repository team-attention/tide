# Spec: Local Provider Session Discovery & Adoption

## Scope

Surface coding-agent sessions that already exist in the user's local provider
history — created by the provider CLIs **outside** Tide — as Threads in the Tide
thread list, scoped to the registered Project whose cwd they belong to.

Currently covers Codex (rollout JSONL) and Claude Code (transcript JSONL).
Discovered sessions are **adopted** as
read-only Threads that open, render their conversation (via the existing
provider-history rebuild), and resume through the provider's native resume.

## Evidence

- `live-backend.ts` builds the thread list only from `input.persistence`
  (Tide-owned records) via `restorePersistedThreads`; it never scans provider
  history to *discover* sessions. So a session started by the `claude`/`codex`
  CLI directly is invisible (e.g. this conversation's transcript
  `~/.claude/projects/-Users-you-Workspace-tide/cc2ec012-…jsonl` exists but is
  not listed).
- cwd mapping per provider (verified on disk):
  - **Claude**: `~/.claude/projects/<cwd with '/'→'-'>/<sessionId>.jsonl`. The
    directory name encodes the cwd.
  - **Codex**: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`; the first line is
    `{"type":"session_meta","payload":{"cwd":"/Users/you/Workspace/tide",…}}`.
- Conversation rebuild already exists: `rebuildCodexConversation`,
  `rebuildClaudeConversation`, driven by a Thread's
  `providerSessionRef.transcriptPath`.
- `ThreadSeed` / `threadSeedFromStorageRecord` define the adopted-thread shape;
  `restoreThreads` adds seeds to the in-memory thread map and lists them.

## Decisions

- **cwd source**: the registered Project cwds (read-only from
  `project-registry.json` under the app data root) ∪ cwds already present in
  persisted thread scopes. Backend owns discovery (it owns Threads + provider
  history); it reads the registry file read-only as infrastructure wiring.
- **Adopted threadId** is deterministic from the provider session id
  (`adopted-<sessionId>`), so re-discovery across restarts is idempotent.
- **Dedup**: skip a discovered session if a persisted Tide thread already
  references the same `providerSessionRef.value`, or if its deterministic
  threadId is already present.
- **Title**: first user message of the session, trimmed to one line and capped;
  fallback to `<Provider> session <date>` when no user text is found.
- **agentId** from the provider; **createdAt/updatedAt** from the file mtime;
  **providerSessionRef** `{ kind, value, transcriptPath }` for resume.
- Adopted threads are **not persisted** by discovery; they are re-derived each
  startup from provider history (the durable source of truth). Lifecycle =
  `open`, runtimeState = `not_started`, lastKnownState = `idle`.
## Out Of Scope

- Live updates when a new external session appears while Tide is running.
- Gemini/opencode external-session discovery.
- Persisting edits (pin/rename) to adopted threads.

## Domain Model

`DiscoveredSession`:
```
agentId: "codex" | "claude"
sessionId: string
transcriptPath: string
cwd: string
title: string
startedAtMs: number   // file mtime fallback for createdAt/updatedAt
```

## Contracts

No new process-boundary contract. Discovered sessions become `ThreadSeed`s fed
through the existing `restoreThreads` path, emitted to Desktop as the normal
`thread.listed` payload.

## Flow

1. On backend restore, list persisted Tide threads (unchanged).
2. Collect candidate cwds = registered project cwds ∪ persisted thread scope cwds.
3. For each cwd, discover provider sessions:
   - Claude: scan the encoded project dir for `*.jsonl`.
   - Codex: scan recent rollouts, keep those whose `session_meta.cwd === cwd`.
4. Map each `DiscoveredSession` to an adopted `ThreadSeed` (deterministic id,
   provider ref, derived title, mtime timestamps, project scope).
5. Drop seeds that collide with a persisted thread (by ref value or threadId).
6. `restoreThreads([...persistedSeeds, ...adoptedSeeds])`.

## Invariants

- A provider session is listed at most once (dedup by ref value + threadId).
- An adopted thread's `scope.cwd` equals the session's provider-local cwd.
- Discovery never writes to provider history or the project cwd (read-only).

## Tests

`tests/local-provider-session-discovery.test.ts`:
- `codex_session_descriptor_extracts_cwd_and_first_user_message`
- `claude_session_descriptor_extracts_first_user_message`
- `discovery_maps_sessions_to_adopted_seeds_scoped_to_the_project`
- `discovery_dedups_sessions_already_owned_by_a_tide_thread`
- `discovery_threadId_is_deterministic_for_idempotent_restart`
- `discovery_falls_back_to_a_dated_title_when_no_user_message`

## Location

- `src/backend/application/services/provider-session-discovery.ts` — pure
  discovery core (injected fs readers; descriptor parsers).
- `src/backend/infrastructure/node/live/live-backend.ts` — wiring: registry read,
  directory scans, seed merge in `restorePersistedThreads`.
