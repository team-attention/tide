# Spec: Thread-list metadata-first restore

## Scope

Defines how the live backend restores persisted Threads at boot so the Left Rail
renders without waiting on per-Thread conversation rebuilds or local-history scans.

It covers:

- what the first `thread.list` (which clears the rail skeleton) is allowed to block on.
- when a Thread's conversation blocks are rebuilt.
- where adopted (external) session discovery runs.

It does not change provider history formats, the rebuild logic itself
(`rebuildConversationFromProviderHistory`, `discoverAdoptedThreadSeeds`), or the
renderer's hydrate/loading UX. See `persistence.md` and `agent-session-rendering.md`.

## Evidence

- The Left Rail skeleton is gated only by `threadsLoaded`, flipped by the first
  `thread.listed` (`left-rail.tsx`, `events.ts`).
- The renderer dispatches `thread.list` once on mount (`product-shell.tsx`).
- The persistent live-backend wrapper made the first command `await` a full restore
  that, per Thread, read + parsed the provider transcript (up to 1 MB) and then scanned
  local provider history to adopt external sessions (`live-backend.ts`).
- Measured on a real store of 313 Threads: the gating restore touched hundreds of
  transcript/cache files plus ~1100 candidate history files (~100 MB of head reads),
  so the skeleton persisted for seconds on a cold boot and grew with Thread count.
- `service.hydrateThread` returns `thread.cachedBlocks` from memory and never rebuilds
  from disk (`thread-runtime-service.ts`), so blocks must be seeded before hydrate.
- `ThreadSummaryDto` carries no blocks and the rail preview is a synthetic placeholder
  (`view-model.ts`), so a metadata-only list blanks nothing the rail shows.

## Decisions

### D1. The first list blocks on metadata only

Restore seeds Thread metadata (`threadSeedFromStorageRecord`) and nothing else before
answering `thread.list`. Boot latency is bounded by reading the per-Thread `thread.json`
records, which are read concurrently (`listThreadMetadata` uses `Promise.all`).

### D2. Conversation blocks are rebuilt lazily on open

A Thread's blocks are rebuilt the first time it is opened. The wrapper intercepts the
`thread.hydrate` command, and if the target Thread has no cached blocks it rebuilds from
the provider's own session (or Tide's Agent Session Cache) and seeds the store via
`seedCachedBlocksIfEmpty` before the adapter hydrates — so `thread.hydrated` carries the
real transcript and there is no empty flash. The cost is one file read + parse, paid
inside the existing hydrate loading window. The tangled-worktree banner is applied here.

`seedCachedBlocksIfEmpty` only fills when the Thread has no blocks AND no live runtime
owns it: a running Thread grows its own transcript and must never be clobbered. Per-open
loads are deduped so concurrent/repeat opens share one rebuild.

### D3. Adopted session discovery runs off the critical path

Discovering provider sessions started outside Tide walks the local filesystem, so it
runs in the background after the metadata restore. When it finds new sessions it restores
them and PUSHES a refreshed `thread.listed` (no requestId), so external sessions appear
in the rail without a manual reload. They surface slightly after first paint rather than
gating it.

## Verification

- `live_backend_restores_persisted_threads_before_thread_list` — first list returns
  persisted metadata.
- `live_backend_rebuilds_thread_blocks_lazily_on_open_not_at_boot` — a Thread whose
  conversation lives only in a provider rollout is listed without blocks, then
  `thread.hydrate` returns the rebuilt blocks.
- `seed_cached_blocks_fills_an_empty_thread_but_never_clobbers_loaded_blocks` — the seed
  guard fills an empty Thread once and is a no-op afterwards / for unknown Threads.
