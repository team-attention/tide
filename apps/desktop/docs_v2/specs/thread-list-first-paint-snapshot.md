# Spec: Thread-list first-paint snapshot

## Scope

Defines how the Left Rail paints real Thread rows on the very first React render —
before any backend round-trip — so a warm launch never flashes the rail skeleton.

It covers:

- where the first-paint Thread list comes from and how it reaches the renderer.
- what shape the persisted Thread index must carry to answer it synchronously.
- how this stays consistent with the authoritative `thread.listed`.

It builds on `thread-list-metadata-first-restore.md` (the async first `thread.list`
path) and does not change conversation-block rebuild, adopted-session discovery, or the
rail's hydrate UX. It mirrors the Main-owned sendSync pattern already used for UI prefs
(`ui-prefs.ts`, `tide:get-ui-prefs`).

## Evidence

- The Left Rail skeleton is gated by `threadsLoaded`, flipped only by the first
  `thread.listed` (`left-rail.tsx`, `events.ts`). Until that async backend command
  resolves, the rail shows the skeleton even when a persisted list already exists on disk.
- The renderer dispatches `thread.list` once on mount (`product-shell.tsx`); the round
  trip spawns/awaits the backend utility process, so the skeleton is visible for that
  whole window on every launch.
- Main already owns the Thread store directory (`resolveAppDataRoot()/threads`) and can
  read it synchronously from the main process before the renderer's first paint — the
  same lever used to kill the boot localStorage stall for UI prefs.
- The persisted Thread index (`threads/index.json`) is the one small file that lists all
  Threads; enriching each entry with its full record lets a reader rebuild the rail from
  a single file read, with no `threads/*/thread.json` scan.
- `ThreadSummaryDto.live` / `queuedInputs` / `runtimeStartedAt` are optional and documented
  "absent ⇒ treat as false/empty". At boot no runtime is hydrated, so a snapshot that omits
  them is identical to what the authoritative list reports for persisted-but-not-live
  Threads — there is no first-paint→refresh flicker.

## Decisions

### D1. The index entry carries the full record

Each `ThreadIndexEntry` stores the full `ThreadStorageRecord` and nothing else
(`thread-persistence-service.ts`) — the rail's metadata is read straight from it, and no
field is duplicated outside `record`. `storageVersion` is unchanged: a pre-feature index
holds flat fields and no `record`, and the read path treats any record-less entry as a
miss (so it rebuilds rather than mis-reads).

`listThreadMetadata` reads the enriched index directly (`listThreadMetadataFromIndex`) and
never scans `threads/*/thread.json` on the warm path. A missing/legacy/corrupt index — any
entry without a valid `record` — falls back once to `listThreadMetadataFromFiles`, which
scans the records and rewrites the enriched index. `upsertThreadIndex` independently
rebuilds the index on the first save after an upgrade, and `rebuildThreadIndex` shares the
same file-scan path. This SUPERSEDES the old "first list reads every `thread.json`
concurrently" bound — that scan is now only the legacy/corrupt fallback.

### D2. Main reads an index-only snapshot synchronously

`readInitialThreadListSnapshot()` (`thread-list-snapshot.ts`) `readFileSync`s
`threads/index.json`, validates each embedded `record`, sorts by `updatedAt` desc, and maps
to `ThreadSummaryDto[]`. It NEVER scans `thread.json`. If the index is absent, legacy
(no `record`), or fails validation, it returns `null` and the renderer keeps the skeleton
until the authoritative list arrives. The mapping is a faithful subset of the backend's
`toThreadSummaryDto`: `live`/`queuedInputs`/`runtimeStartedAt` are omitted (correctly
false/empty at boot); `archived` and `lastKnownState` are derived defensively from the
record. Validation lives at this untrusted-file boundary, so it is stricter than (and
intentionally separate from) the backend service's own index validator.

### D3. The snapshot reaches the renderer over sendSync and seeds first render

Main exposes the snapshot over `ipcMain.on("tide:get-initial-thread-list")`
(`event.returnValue`). Preload reads it synchronously at construction
(`readInitialThreadListSync`) and publishes `window.tide.initialThreadList`. The renderer
passes `initialThreadList` into `TideProductShell`, which, when present, folds a synthetic
`thread.listed` into the INITIAL store state (`applyProductShellBackendEvent`) so the first
render already carries real rows. The renderer still dispatches `thread.list` on mount, so
the authoritative backend list refreshes the rail immediately and remains the source of
truth — the snapshot only removes the skeleton window.

## Verification

- `creating_thread_metadata_writes_thread_json_and_updates_index` — the index entry now
  embeds the full `record`.
- `listing_thread_metadata_uses_enriched_index_without_thread_json_reads` — the warm path
  answers from the index alone and never lists directories or reads `thread.json`.
- `listing_thread_metadata_rebuilds_legacy_index_once` — a flat (record-less) index falls
  back to the file scan and rewrites an enriched index.
- `initialThreadList paints real rail rows before backend list resolves` — first render
  shows the rows and no `rail-skeleton`.
- `initialThreadList still requests the authoritative backend list` — the renderer still
  dispatches `thread.list` on mount.
- Live: a warm launch shows populated rail rows with no skeleton flash; a deleted/missing
  index falls back to the skeleton then fills from the backend.
