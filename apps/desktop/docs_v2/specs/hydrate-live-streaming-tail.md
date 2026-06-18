# Spec: Hydrate includes the live streaming tail

## Scope

Defines how a running Thread's still-streaming (not-yet-finalized) Agent Session
Blocks survive a re-hydration of that Thread, so the transcript never collapses to
its last-settled state while the Agent Runtime is mid-turn.

It covers:

- where in-flight streamed blocks live before they finalize.
- what `thread.hydrated` (and the `service.hydrateThread` it is built from) returns
  for a Thread whose turn is still streaming.
- what the persisted Agent Session Cache is allowed to contain.

It does not change reader/parsing logic, provider history formats, the metadata-first
restore (`thread-list-metadata-first-restore.md`), or the renderer's hydrate UX.

## Evidence

- `content_delta` (live streaming) emits the block to the renderer and the projector's
  local `blocksByThread`, but never calls `recordBlockUpdateInService` — so the streamed
  block is NOT written into `thread.cachedBlocks` (`live-projector.ts`, content_delta
  branch). The matching `content_record` finalizes the same `blockId` into `cachedBlocks`
  via `recordAgentSessionBlock` (`thread-runtime-service.ts`).
- `service.hydrateThread` returns `cloneBlocks(thread.cachedBlocks)` only
  (`thread-runtime-service.ts`). It has no access to the in-flight stream.
- The renderer's `thread.hydrated` handler REPLACES the visible transcript:
  `blocks: payload.blocks ?? state.blocks` (`agent-chat/state/events.ts`). It is not a
  merge, so any block the renderer holds that is absent from the payload is dropped.
- A re-hydration of the active/running Thread is triggered by opening or switching to it
  (`openProductShellThreadFromLeftRail` dispatches `thread.hydrate`), by the optimistic
  re-open, and by reconnect/restore snapshots — none of which stop the Agent Runtime
  (the process is Backend-owned and focus-independent; teardown is app-quit / dup reap,
  per `stopAgentRuntime`).
- A background Thread's streamed blocks are folded into the renderer's per-Thread store
  only when an entry already exists (`agentChatByThreadId[id] !== undefined`,
  `product-shell/state/events.ts`). A Thread never opened this session has no entry, so
  its streamed blocks are dropped by the renderer entirely and only a hydrate can show
  them — making a Backend-side fix necessary for that case.
- The model already names the layering: "Raw Agent Session remains the source of truth",
  "Agent Session Cache is derived state", "BR-1: Cache is an optimization, not source of
  truth" (`agent-session-rendering.md`). Blocks already carry `status` ∈ {pending,
  streaming, complete, failed, needs_input}; streamed blocks are `status: "streaming"`.

## Decisions

### D1. The persisted cache stays finalized-only; the streaming tail is a separate in-memory store

`thread.cachedBlocks` (and therefore the persisted Agent Session Cache and every
`snapshotThread` DTO) keeps containing ONLY finalized (`content_record`) blocks. The
fallible streaming accumulation must never pollute the durable derived cache. The
in-flight tail lives in a NEW in-memory-only field `thread.streamingBlocks`
(`AgentSessionBlockReference[]`), never persisted, never snapshotted — like the existing
in-memory-only turn fields (`promptAnsweredPendingSettle`, `pendingRuntimeRestart`).

### D2. content_delta records into the streaming tail; finalize evicts it; settle clears it

- The projector's `content_delta` branch additionally calls a new service method
  `recordStreamingBlock(threadId, block)` that upserts the block (by `blockId`) into
  `thread.streamingBlocks`. No persist, no `cachedBlocks` write.
- `recordAgentSessionBlock` (the existing finalize path) removes the same `blockId` from
  `thread.streamingBlocks` after pushing it to `cachedBlocks` — the block has graduated
  from in-flight to settled. Removal by `blockId` is a no-op when absent (safe for
  non-streamed blocks like tool calls and the local user message).
- `recordTurnComplete` (turn settle) clears `thread.streamingBlocks`. Anything left is an
  orphan from an aborted/interrupted stream and must not linger into the next turn.

### D3. hydrateThread returns the union (settled ∪ in-flight)

`hydrateThread` returns `cachedBlocks` followed by every `streamingBlocks` entry whose
`blockId` is not already in `cachedBlocks` (settled wins). The union is computed at read
time and never stored. `peekThread` (internal reader hot-path) is unchanged — it stays
`cachedBlocks`-only so reader context is not perturbed.

### D4. The renderer is unchanged

`thread.hydrated`'s REPLACE is now correct because the payload is complete (settled +
in-flight). No renderer merge logic is added, keeping the bug surface minimal.

## Out Of Scope

- Reader/boundary detection and provider history parsing.
- The persisted Agent Session Cache format and the metadata-first restore.
- Cosmetic lingering of an aborted half-streamed block in the renderer until the next
  hydrate (no clobber, self-heals on next hydrate/turn) — recorded as residual risk.
- Reaping duplicate live Agent Runtimes (separate concern surfaced during diagnosis).

## Domain Model

- `ThreadRecord.streamingBlocks: AgentSessionBlockReference[]` — in-memory only,
  finalize-evicted, settle-cleared. Holds blocks currently `status: "streaming"` that
  have no finalized counterpart in `cachedBlocks` yet.
- `cachedBlocks` — unchanged: finalized blocks only; the durable derived cache.
- Union view = `cachedBlocks` ++ `streamingBlocks`-not-in-`cachedBlocks` (by `blockId`).

## Contracts

No process-boundary DTO change. `HydrateThreadResult.blocks` carries the union; the wire
shape (`thread.hydrated` payload `blocks`) is unchanged. `ThreadSnapshot` is unchanged
(no `streamingBlocks`), so persistence and the rail list are untouched.

New service method on `ThreadRuntimeApi`:
`recordStreamingBlock(input: { threadId; block: AgentSessionBlock }): ServiceResult<...>`.

## Flow

1. Turn streams: `content_delta` → emit `agentSessionBlock.upserted` to renderer +
   `recordStreamingBlock` → `streamingBlocks`. `cachedBlocks` untouched.
2. Block finalizes: `content_record` → `recordAgentSessionBlock` → push to `cachedBlocks`
   + evict `blockId` from `streamingBlocks`.
3. Re-hydrate mid-turn (open/switch/reconnect): `hydrateThread` → `cachedBlocks` ∪
   `streamingBlocks` → renderer REPLACE shows the full live transcript.
4. Turn settles: `recordTurnComplete` clears `streamingBlocks`; `cachedBlocks` is the
   complete settled transcript and persists.

## Invariants

- I1. `cachedBlocks` and the persisted Agent Session Cache contain no `streaming`-only
  block — finalized blocks only.
- I2. `streamingBlocks` is empty whenever the Thread is not actively streaming (cleared
  at settle; evicted on finalize).
- I3. The hydrate payload ⊇ the live transcript at hydrate time (no in-flight loss).
- I4. A `blockId` present in both layers resolves to the `cachedBlocks` (settled) copy.
- I5. `streamingBlocks` never appears in a `ThreadSnapshot`, `ThreadSeed`, or persisted
  record.

## Tests

- `recordStreamingBlock` then `hydrateThread` → returned blocks include the streaming
  block (I3).
- `recordAgentSessionBlock` with the same `blockId` → `streamingBlocks` no longer holds
  it; `hydrateThread` returns exactly one (settled) copy (I4).
- two `recordStreamingBlock` for the same `blockId` → one entry (idempotent upsert).
- `recordTurnComplete` → subsequent `hydrateThread` returns `cachedBlocks` only (I2).
- `snapshotThread` / persisted seed round-trip carries no `streamingBlocks` (I1, I5).
- projector: a `content_delta` followed by a re-`hydrateThread` (no `content_record`
  between) returns the streamed block (integration over the live projector + service).

## Implementation Notes

- `ThreadRecord` field added in `application/domains/thread/thread.ts`; initialize
  `streamingBlocks: []` at every record construction site (`normalizeThreadSeed` in
  `thread-snapshot.ts`, the draft record in `thread-draft-service.ts`, any other).
- `snapshotThread` is NOT changed — it already lists explicit fields, so the new field is
  excluded from the DTO and persistence for free.
- Union helper (e.g. `blocksWithStreamingTail`) beside `cloneBlocks`; used only by
  `hydrateThread`.
- Projector change is one added call in the `content_delta` branch of `live-projector.ts`
  (alongside the existing emit + `blocksByThread.set`).
- Keep `recordStreamingBlock` cheap: in-memory upsert, no clock churn beyond what
  `cachedBlocks` updates already do, no persist scheduling.
